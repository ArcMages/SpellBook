// The inspector: the details of the scene that is open in the editor.
//
//   slot       an empty place at the top that another part of the plugin can
//              fill with a line of its own (word counts, on phones)
//   the scene  its title, then what can be edited: the synopsis, the status
//              and the label (chosen from the project's lists), the word
//              target, and whether it goes into the compiled manuscript;
//              then the dates it was created and last edited, as plain text
//
// Everything it shows comes from the host (src/features/corkboard/host.ts).
// An edit is saved when its field loses the keyboard, or a short pause after
// the last key; a choice from a list or the switch is saved at once. Saving
// means asking the host: the engine (src/core/cards) checks the edit and
// names only the properties that really change, and the host writes those.
// A value the engine does not accept is said beside its field and never
// written.
//
// While the writer is in a field, nothing that arrives from elsewhere (a
// sync, a word count) changes what they are typing: only the fields they are
// not editing are brought up to date.
//
// Text in any language: the scene's title, the synopsis and the names of
// statuses and labels are the writer's own text, and each takes the
// direction of its own text. The target is a number and reads left to right.

import { ItemView, Platform } from 'obsidian';
import { followLayout } from '../../ui/layout';
import type { WorkspaceLeaf } from 'obsidian';
import { applyFrontmatterPatch, buildInspector, inspectorPatch, isEmptyPatch } from '../../core/cards';
import type {
  CardLists,
  FrontmatterPatch,
  InspectorEdits,
  InspectorField,
  InspectorModel,
  TagOption,
} from '../../core/cards';
import type { Frontmatter } from '../../core/types';
import { isInputMethodKey } from '../../ui/keys';
import { safely } from '../../ui/safely';
import type { CardsChange, InspectorHost, SceneEntitiesPart } from './host';
import { setShown, settle } from './parts';
import { openTagLists } from './tagListsModal';

export const INSPECTOR_VIEW_TYPE = 'spellbook-inspector';
export const INSPECTOR_VIEW_NAME = 'Inspector';
export const INSPECTOR_ICON = 'info';

/** How long after the last key an edit is saved, in milliseconds. */
export const SAVE_PAUSE_MS = 800;

export const NO_SCENE_TEXT = 'No scene is open.';
export const NO_SCENE_HINT = 'Open a scene of the project to see and change its details here.';
export const INSPECTOR_NO_PROJECT_TEXT = 'No Spellbook project is open.';
export const INSPECTOR_STARTING_TEXT = 'Spellbook is still starting...';
/** What a date says when the scene does not have it. */
export const NO_DATE_TEXT = 'Not known';

/** The class of the empty place at the top of the inspector. */
export const SUMMARY_SLOT_CLASS = 'spellbook-inspector-slot';
/** The class of the place under the scene's dates where the entities in the scene are shown. */
export const ENTITIES_SLOT_CLASS = 'spellbook-inspector-entities-slot';

const FIELDS: readonly InspectorField[] = ['synopsis', 'status', 'label', 'target', 'compile'];

type Edits = { -readonly [Field in keyof InspectorEdits]: InspectorEdits[Field] };

interface Elements {
  readonly root: HTMLElement;
  readonly slot: HTMLElement;
  readonly message: HTMLElement;
  readonly hint: HTMLElement;
  readonly form: HTMLElement;
  readonly lists: HTMLButtonElement;
}

interface Form {
  readonly title: HTMLElement;
  readonly problems: HTMLElement;
  readonly synopsis: HTMLTextAreaElement;
  readonly status: HTMLSelectElement;
  readonly label: HTMLSelectElement;
  readonly target: HTMLInputElement;
  readonly compile: HTMLInputElement;
  /** Obsidian's own switch, which the compile box sits in. */
  readonly compileSwitch: HTMLElement;
  readonly created: HTMLElement;
  readonly edited: HTMLElement;
  /** Where each field says why its value will not do. */
  readonly errors: Readonly<Record<InspectorField, HTMLElement>>;
  /** What each list of choices was last drawn for. */
  readonly optionsDrawn: { status: string; label: string };
  problemsDrawn: string;
}

/** A change that the host was asked to make and has not answered yet. */
interface Sent {
  readonly path: string;
  readonly patch: FrontmatterPatch;
}

export class InspectorView extends ItemView {
  private readonly host: InspectorHost;
  private els: Elements | null = null;
  private form: Form | null = null;
  private closed = true;
  private stops: Array<() => void> = [];

  /** The scene on show, by its path relative to the project folder. */
  private shownPath: string | null = null;
  /** The project's lists the scene on show was drawn with. */
  private lists: CardLists | null = null;
  /** The fields the writer has changed and that are not saved yet. */
  private readonly dirty = new Set<InspectorField>();
  /** The timer of a save that is about to happen, if any. */
  private saveStop: (() => void) | null = null;
  private sent: Sent[] = [];
  /** The "In this scene" part, when the host has one. */
  private entities: SceneEntitiesPart | null = null;

  constructor(leaf: WorkspaceLeaf, host: InspectorHost) {
    super(leaf);
    this.host = host;
    this.navigation = false;
  }

  override getViewType(): string {
    return INSPECTOR_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return INSPECTOR_VIEW_NAME;
  }

  override getIcon(): string {
    return INSPECTOR_ICON;
  }

  /** The empty place at the top, for another part of the plugin to fill; null while the inspector is closed. */
  get summarySlot(): HTMLElement | null {
    return this.els?.slot ?? null;
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-inspector-pane');

    const root = pane.createDiv({ cls: 'spellbook-inspector' });
    followLayout(this, root);
    // On a phone, Obsidian's own bar floats over the bottom of the drawer.
    root.toggleClass('spellbook-is-phone', Platform.isPhone);
    const slot = root.createDiv({ cls: SUMMARY_SLOT_CLASS });
    const scroll = root.createDiv({ cls: 'spellbook-inspector-scroll' });
    const message = scroll.createDiv({ cls: 'spellbook-inspector-message' });
    const hint = scroll.createDiv({ cls: 'spellbook-inspector-message spellbook-inspector-hint' });
    const form = scroll.createDiv({ cls: 'spellbook-inspector-form' });
    this.form = this.buildForm(form);
    const lists = scroll.createEl('button', {
      cls: 'spellbook-inspector-lists',
      text: 'Statuses and labels',
      attr: { type: 'button' },
    });
    lists.addEventListener('click', () => {
      safely('Statuses and labels', () => {
        openTagLists(this.app, this.host);
      });
    });
    this.els = { root, slot, message, hint, form, lists };

    const unmount = this.host.mountSummary?.(slot);
    if (typeof unmount === 'function') this.stops.push(unmount);
    // Who and what is in the scene, under its dates: drawn by sceneEntities.ts when the world-building offers it.
    const entities = this.host.mountEntities?.(form.createDiv({ cls: ENTITIES_SLOT_CLASS }), () => this.shownPath) ?? null;
    this.entities = entities;
    if (entities) this.stops.push(() => entities.stop());
    this.stops.push(
      this.host.onChange((change) => {
        this.onHostChange(change);
      }),
    );
    this.syncScene();
  }

  protected override async onClose(): Promise<void> {
    // What was typed and not saved yet is saved now.
    this.saveEdits(false);
    this.closed = true;
    this.saveStop?.();
    this.saveStop = null;
    for (const stop of this.stops.splice(0)) stop();
    this.dirty.clear();
    this.shownPath = null;
    this.entities = null;
    this.lists = null;
    this.form = null;
    this.els = null;
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-inspector-pane');
  }

  private onHostChange(change: CardsChange): void {
    if (this.closed) return;
    if (change.type === 'cardSize') return;
    if (change.type === 'scenes' && (this.shownPath === null || !change.paths.includes(this.shownPath))) return;
    this.syncScene();
  }

  // ----------------------------------------------------------------- the form

  private buildForm(parent: HTMLElement): Form {
    const title = parent.createDiv({ cls: 'spellbook-inspector-title', attr: { dir: 'auto' } });
    const problems = parent.createDiv({ cls: 'spellbook-inspector-problems' });
    const errors = {} as Record<InspectorField, HTMLElement>;

    /** A field: its name above it, and a place under it for a message. */
    const field = <T extends HTMLElement>(name: InspectorField, text: string, make: (label: HTMLElement) => T): T => {
      const holder = parent.createDiv({ cls: `spellbook-field spellbook-field-${name}` });
      const label = holder.createEl('label', { cls: 'spellbook-field-label' });
      label.createSpan({ cls: 'spellbook-field-name', text });
      const control = make(label);
      errors[name] = holder.createDiv({ cls: 'spellbook-field-error', attr: { role: 'alert' } });
      return control;
    };

    const synopsis = field('synopsis', 'Synopsis', (label) =>
      label.createEl('textarea', {
        cls: 'spellbook-field-input spellbook-inspector-synopsis',
        // The synopsis may be in any language; let it pick its own direction.
        attr: { dir: 'auto', rows: 5 },
      }),
    );
    synopsis.addEventListener('input', () => {
      this.touched('synopsis', false);
    });
    synopsis.addEventListener('blur', () => {
      this.saveEdits(true);
    });

    const status = field('status', 'Status', (label) =>
      label.createEl('select', { cls: 'dropdown spellbook-field-input spellbook-inspector-status' }),
    );
    status.addEventListener('change', () => {
      this.touched('status', true);
    });

    const label = field('label', 'Label', (holder) =>
      holder.createEl('select', { cls: 'dropdown spellbook-field-input spellbook-inspector-label' }),
    );
    label.addEventListener('change', () => {
      this.touched('label', true);
    });

    const target = field('target', 'Target (words)', (holder) =>
      holder.createEl('input', {
        cls: 'spellbook-field-input spellbook-inspector-target',
        attr: {
          type: 'text',
          // A phone shows its number keys.
          inputmode: 'numeric',
          // Numbers read left to right in every language.
          dir: 'ltr',
          placeholder: 'No target',
          enterkeyhint: 'done',
        },
      }),
    );
    target.addEventListener('input', () => {
      this.touched('target', false);
    });
    target.addEventListener('blur', () => {
      this.saveEdits(true);
    });
    target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      this.saveEdits(true);
    });

    // The switch is built the way Obsidian builds its own, so that themes
    // style it; the box inside it is what the keyboard and screen readers use.
    let compileSwitch: HTMLElement = parent;
    const compile = field('compile', 'Include in compile', (holder) => {
      compileSwitch = holder.createDiv({ cls: 'checkbox-container spellbook-inspector-compile' });
      return compileSwitch.createEl('input', { attr: { type: 'checkbox', tabindex: 0 } });
    });
    compile.addEventListener('change', () => {
      compileSwitch.toggleClass('is-enabled', compile.checked);
      this.touched('compile', true);
    });

    const dates = parent.createDiv({ cls: 'spellbook-inspector-dates' });
    const date = (text: string): HTMLElement => {
      const row = dates.createDiv({ cls: 'spellbook-inspector-date' });
      row.createSpan({ cls: 'spellbook-inspector-date-name', text });
      return row.createSpan({ cls: 'spellbook-inspector-date-value' });
    };
    const created = date('Created');
    const edited = date('Edited');

    return {
      title,
      problems,
      synopsis,
      status,
      label,
      target,
      compile,
      compileSwitch,
      created,
      edited,
      errors,
      optionsDrawn: { status: '', label: '' },
      problemsDrawn: '',
    };
  }

  /** The field's own element, for marking it as wrong. */
  private inputOf(form: Form, field: InspectorField): HTMLElement {
    return form[field];
  }

  private setError(field: InspectorField, message: string | null): void {
    const form = this.form;
    if (!form) return;
    form.errors[field].setText(message ?? '');
    const input = this.inputOf(form, field);
    input.toggleClass('spellbook-is-invalid', message !== null);
    input.setAttr('aria-invalid', message === null ? null : 'true');
  }

  // ------------------------------------------------------------------ showing

  /**
   * A scene's properties as they will be once everything the host was asked
   * for is written: what the host holds now, with those changes on top.
   */
  private frontmatterOf(path: string): Readonly<Frontmatter> | null {
    const stored = this.host.sceneData(path)?.frontmatter ?? null;
    const waiting = this.sent.filter((entry) => entry.path === path);
    if (waiting.length === 0) return stored;
    const copy: Frontmatter = { ...(stored ?? {}) };
    for (const entry of waiting) applyFrontmatterPatch(copy, entry.patch);
    return copy;
  }

  /** Show the scene that is open in the editor now, or say that none is. */
  private syncScene(): void {
    const els = this.els;
    const form = this.form;
    if (!els || !form || this.closed) return;
    const project = this.host.ready ? this.host.project : null;
    const path = project ? this.host.activeScenePath : null;
    // The writer moved on: what was typed belongs to the scene that is being left.
    if (this.shownPath !== null && path !== this.shownPath) this.saveEdits(false);

    els.lists.disabled = project === null;
    setShown(els.lists, project !== null);
    if (!project || path === null) {
      this.leaveScene();
      let text = NO_SCENE_TEXT;
      if (!this.host.ready) text = INSPECTOR_STARTING_TEXT;
      else if (!project) text = INSPECTOR_NO_PROJECT_TEXT;
      els.message.setText(text);
      els.hint.setText(project ? NO_SCENE_HINT : '');
      setShown(els.message, true);
      setShown(els.hint, project !== null);
      setShown(els.form, false);
      return;
    }

    if (path !== this.shownPath) this.leaveScene();
    this.shownPath = path;
    this.lists = project.lists;
    setShown(els.message, false);
    setShown(els.hint, false);
    setShown(els.form, true);
    this.showScene(form, buildInspector({ path, frontmatter: this.frontmatterOf(path) }, project.lists), project.readOnly);
    this.entities?.refresh();
  }

  /** No scene is on show any more: nothing is being edited, and no field has a complaint. */
  private leaveScene(): void {
    this.saveStop?.();
    this.saveStop = null;
    this.shownPath = null;
    this.dirty.clear();
    for (const field of FIELDS) this.setError(field, null);
    this.entities?.refresh();
  }

  /** Fill the form in. A field the writer is in the middle of changing keeps what they typed. */
  private showScene(form: Form, model: InspectorModel, readOnly: boolean): void {
    form.title.setText(model.title);

    const problems = JSON.stringify(model.problems);
    if (problems !== form.problemsDrawn) {
      form.problemsDrawn = problems;
      form.problems.empty();
      for (const problem of model.problems) {
        // A problem may quote a property's value, which is the writer's own text.
        form.problems.createDiv({ cls: 'spellbook-inspector-problem', text: problem, attr: { dir: 'auto' } });
      }
    }
    setShown(form.problems, model.problems.length > 0);

    if (!this.dirty.has('synopsis') && form.synopsis.value !== model.synopsis) form.synopsis.value = model.synopsis;
    this.showOptions(form, 'status', model.statusOptions, model.status, 'No status');
    this.showOptions(form, 'label', model.labelOptions, model.label, 'No label');
    const target = model.target === null ? '' : String(model.target);
    if (!this.dirty.has('target') && form.target.value !== target) form.target.value = target;
    if (!this.dirty.has('compile')) {
      form.compile.checked = model.compile;
      form.compileSwitch.toggleClass('is-enabled', model.compile);
    }
    form.created.setText(model.createdText === '' ? NO_DATE_TEXT : model.createdText);
    form.edited.setText(model.editedText === '' ? NO_DATE_TEXT : model.editedText);

    // Nothing can be changed in a project whose index could not be understood.
    form.synopsis.disabled = readOnly;
    form.status.disabled = readOnly;
    form.label.disabled = readOnly;
    form.target.disabled = readOnly;
    form.compile.disabled = readOnly;
    form.compileSwitch.toggleClass('is-disabled', readOnly);
  }

  /**
   * The choices for a status or a label: none, then the project's list, then
   * the scene's own when the list does not have it.
   */
  private showOptions(
    form: Form,
    field: 'status' | 'label',
    options: readonly TagOption[],
    current: string | null,
    none: string,
  ): void {
    const select = form[field];
    const wanted = this.dirty.has(field) ? select.value : (current ?? '');
    // Built anew only when the choices changed: a list that is open is left alone.
    const drawn = JSON.stringify(options.map((option) => [option.name, option.listed]));
    if (drawn !== form.optionsDrawn[field]) {
      form.optionsDrawn[field] = drawn;
      select.empty();
      select.createEl('option', { value: '', text: none });
      for (const option of options) {
        select.createEl('option', {
          value: option.name,
          text: option.listed ? option.name : `${option.name} (not in the list)`,
          // A name is the writer's own text.
          attr: { dir: 'auto' },
        });
      }
    }
    if (select.value !== wanted) select.value = wanted;
  }

  // ------------------------------------------------------------------- saving

  /**
   * The writer changed a field.
   *
   * @param now save at once (a choice from a list, the switch); otherwise a short pause after the last key
   */
  private touched(field: InspectorField, now: boolean): void {
    if (this.shownPath === null || this.closed) return;
    this.dirty.add(field);
    // The writer is changing the value: the old complaint no longer applies.
    this.setError(field, null);
    if (now) {
      this.saveEdits(true);
      return;
    }
    this.saveStop?.();
    this.saveStop = this.host.clock.setTimer(() => {
      this.saveStop = null;
      this.saveEdits(true);
    }, SAVE_PAUSE_MS);
  }

  private readEdits(form: Form, fields: Iterable<InspectorField>): Edits {
    const edits: Edits = {};
    for (const field of fields) {
      switch (field) {
        case 'synopsis':
          edits.synopsis = form.synopsis.value;
          break;
        case 'status':
          edits.status = form.status.value === '' ? null : form.status.value;
          break;
        case 'label':
          edits.label = form.label.value === '' ? null : form.label.value;
          break;
        case 'target':
          edits.target = form.target.value;
          break;
        case 'compile':
          edits.compile = form.compile.checked;
          break;
      }
    }
    return edits;
  }

  /**
   * Save what the writer changed. The engine checks the edits against the
   * scene's properties as they are now and names only the keys that really
   * change; the host writes those. A value that will not do is said beside
   * its field and stays as typed; the other fields are saved all the same.
   *
   * @param show bring the form up to date afterwards
   */
  private saveEdits(show: boolean): void {
    this.saveStop?.();
    this.saveStop = null;
    const form = this.form;
    const path = this.shownPath;
    const lists = this.lists;
    if (!form || path === null || !lists || this.dirty.size === 0) return;

    const frontmatter = this.frontmatterOf(path);
    let result = inspectorPatch(frontmatter, this.readEdits(form, this.dirty), lists);
    if (!result.ok) {
      const refused = new Set<InspectorField>();
      for (const error of result.errors) {
        refused.add(error.field);
        this.setError(error.field, error.message);
      }
      const accepted = [...this.dirty].filter((field) => !refused.has(field));
      for (const field of accepted) this.dirty.delete(field);
      if (accepted.length === 0) return;
      result = inspectorPatch(frontmatter, this.readEdits(form, accepted), lists);
      if (!result.ok) return;
    } else {
      this.dirty.clear();
    }

    if (!isEmptyPatch(result.patch)) {
      const entry: Sent = { path, patch: result.patch };
      this.sent.push(entry);
      let answer: Promise<string | null>;
      try {
        answer = this.host.applyScenePatch(path, result.patch);
      } catch (error) {
        answer = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      void settle(answer).then(() => {
        this.sent = this.sent.filter((other) => other !== entry);
        // Written, or refused: either way the form shows what the scene says now.
        if (!this.closed) this.syncScene();
      });
    }
    if (show) this.syncScene();
  }
}

/** Make an inspector for a pane. What Obsidian's `registerView` is given for INSPECTOR_VIEW_TYPE. */
export function createInspectorView(leaf: WorkspaceLeaf, host: InspectorHost): InspectorView {
  return new InspectorView(leaf, host);
}
