// The targets window: the project's word target, the daily target and the
// deadline, and the target of the scene that is open.
//
// Plain fields in a window of their own, because that is what works
// dependably with the keyboards of phones and tablets: the number fields ask
// for the number pad, the deadline is the device's own date picker. An empty
// field means "no target".
//
// The window only asks and checks (with the engine's own checks). What is
// done with the answer is up to the function it is given.

import { Modal, Platform, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { MAX_TARGET_WORDS, readWordTarget, validateTargets } from '../../core/progress/index';
import type { Targets } from '../../core/progress/index';
import { isInputMethodKey } from '../../ui/keys';

/** What the writer chose in the window. */
export interface TargetsChoice {
  /** The project's targets; null for one that is not set. */
  readonly targets: Targets;
  /**
   * The open scene's target: a number of words, or null for none. Left out
   * when the scene's field was not changed (or there is no scene).
   */
  readonly sceneTarget?: number | null;
}

/** What the window shows, and where the answer goes. */
export interface TargetsForm {
  /** The project's title: the writer's own text. */
  readonly projectTitle: string;
  /** The targets as they are stored now. */
  readonly targets: Targets;
  /** What in the stored targets could not be understood, in plain English. */
  readonly problems: readonly string[];
  /** A few lines saying where the writer stands against the targets. */
  readonly standing: readonly string[];
  /** The scene that is open, or null when the note in front is not a scene of the project. */
  readonly scene: { readonly title: string; readonly target: number | null } | null;
  /**
   * Called with the choice when the writer saves. Resolves with null when all
   * went well (the window closes), or with a message saying what did not
   * (shown in the window, which stays open).
   */
  readonly save: (choice: TargetsChoice) => Promise<string | null>;
}

type FieldName = 'project' | 'daily' | 'deadline' | 'scene';

interface Field {
  readonly input: HTMLInputElement;
  readonly message: HTMLElement;
}

/** What makes a field ask a phone for its number pad. */
const WORDS_FIELD = { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', placeholder: 'No target' };

const NOT_A_TARGET = 'Enter a whole number of words above zero, for example 1500.';
const TOO_MANY_WORDS = 'That is more words than a target can hold.';

export class TargetsModal extends Modal {
  private readonly form: TargetsForm;
  private readonly fields = new Map<FieldName, Field>();
  private message: HTMLElement | null = null;
  private saveButton: ButtonComponent | null = null;
  private busy = false;
  private closed = false;

  constructor(app: App, form: TargetsForm) {
    super(app);
    this.form = form;
  }

  override onOpen(): void {
    const { contentEl, form } = this;
    this.closed = false;
    contentEl.empty();
    this.fields.clear();
    this.titleEl.setText('Writing targets');
    this.modalEl.addClass('spellbook-targets');
    if (Platform.isMobile) this.modalEl.addClass('spellbook-is-mobile');

    // The project's title is the writer's own text, in any language.
    contentEl.createEl('p', { cls: 'spellbook-targets-project', text: form.projectTitle, attr: { dir: 'auto' } });
    for (const line of form.standing) contentEl.createEl('p', { cls: 'spellbook-targets-standing', text: line });
    for (const problem of form.problems) {
      contentEl.createEl('p', { cls: 'spellbook-targets-problem', text: problem, attr: { dir: 'auto' } });
    }

    const words = (target: number | null): string => (target === null ? '' : String(target));
    this.addField('project', 'Project target (words)', words(form.targets.project), WORDS_FIELD);
    this.addField('daily', 'Daily target (words)', words(form.targets.daily), WORDS_FIELD);
    this.addField('deadline', 'Deadline', form.targets.deadline ?? '', { type: 'date' });
    if (form.scene) {
      this.addField('scene', 'Target for the open scene (words)', words(form.scene.target), WORDS_FIELD, form.scene.title);
    }

    this.message = contentEl.createDiv({ cls: 'spellbook-targets-message', attr: { role: 'alert', dir: 'auto' } });

    // Escape cancels. Obsidian closes its windows on Escape by itself; this
    // makes sure of it, and is careful never to close a window twice.
    contentEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || isInputMethodKey(event) || this.closed) return;
      event.preventDefault();
      this.close();
    });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.saveButton = button;
        button
          .setButtonText('Save')
          .setCta()
          .onClick(() => {
            void this.submit();
          });
      });

    // On a phone the keyboard would cover the form at once: the writer taps the field wanted.
    if (!Platform.isMobile) {
      const first = this.fields.get('project')?.input;
      first?.focus();
      first?.select();
    }
  }

  override onClose(): void {
    this.closed = true;
    this.fields.clear();
    this.message = null;
    this.saveButton = null;
    this.contentEl.empty();
  }

  /**
   * One labelled field with room for a message under it.
   *
   * @param about a line of the writer's own text shown under the label (a scene's title)
   */
  private addField(name: FieldName, label: string, value: string, attr: Record<string, string>, about?: string): void {
    const id = `spellbook-targets-${name}`;
    const row = this.contentEl.createDiv({ cls: 'spellbook-targets-field' });
    row.createEl('label', { cls: 'spellbook-targets-label', text: label, attr: { for: id } });
    if (about !== undefined) row.createDiv({ cls: 'spellbook-targets-about', text: about, attr: { dir: 'auto' } });
    const input = row.createEl('input', {
      cls: 'spellbook-targets-input',
      // What a phone's keyboard shows on its Enter key.
      attr: { ...attr, id, enterkeyhint: 'done' },
    });
    input.value = value;
    input.addEventListener('keydown', (event) => {
      // Enter saves, except when it only accepts a word suggested by an input method.
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      void this.submit();
    });
    input.addEventListener('input', () => {
      this.say(name, null); // the writer is changing it: the old complaint no longer applies
    });
    const message = row.createDiv({ cls: 'spellbook-targets-field-message', attr: { role: 'alert' } });
    this.fields.set(name, { input, message });
  }

  /** Show a message under a field, or take it away (null). */
  private say(name: FieldName, message: string | null): void {
    const field = this.fields.get(name);
    if (!field) return;
    field.message.setText(message ?? '');
    field.input.toggleClass('spellbook-is-invalid', message !== null);
    field.input.setAttr('aria-invalid', message === null ? null : 'true');
  }

  private typedIn(name: FieldName): string {
    return this.fields.get(name)?.input.value ?? '';
  }

  private async submit(): Promise<void> {
    if (this.busy || this.closed) return;
    this.message?.setText('');

    const checked = validateTargets({
      project: this.typedIn('project'),
      daily: this.typedIn('daily'),
      deadline: this.typedIn('deadline'),
    });
    const errors: Partial<Record<FieldName, string>> = checked.ok ? {} : { ...checked.errors };

    // The scene's own target: saved only when the writer changed it.
    let sceneTarget: number | null | undefined;
    const scene = this.form.scene;
    if (scene && this.fields.has('scene')) {
      const typed = this.typedIn('scene').trim();
      const target = typed === '' ? null : readWordTarget(typed);
      if (typed !== '' && target === null) errors.scene = NOT_A_TARGET;
      else if (target !== null && target > MAX_TARGET_WORDS) errors.scene = TOO_MANY_WORDS;
      else if (target !== scene.target) sceneTarget = target;
    }

    let firstWrong: Field | null = null;
    for (const [name, field] of this.fields) {
      const error = errors[name] ?? null;
      this.say(name, error);
      if (error !== null) firstWrong ??= field;
    }
    if (!checked.ok || firstWrong !== null) {
      // Back to the field, so it can be put right straight away.
      firstWrong?.input.focus();
      return;
    }

    this.busy = true;
    this.saveButton?.setDisabled(true);
    let problem: string | null;
    try {
      problem = await this.form.save(sceneTarget === undefined ? { targets: checked.targets } : { targets: checked.targets, sceneTarget });
    } catch (error) {
      console.error('Spellbook: the targets could not be saved', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.saveButton?.setDisabled(false);
    }
    // The writer may have closed the window (Escape) while the saving was going on.
    if (this.closed) return;
    if (problem === null) this.close();
    else this.message?.setText(problem);
  }
}
