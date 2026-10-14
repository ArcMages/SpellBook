// A small window that asks for one line of text: the name of a new scene or
// folder, or a new name for an existing one.
//
// A window with its own text field is used, not a field inside the list,
// because that is what works dependably with the keyboards of phones and
// tablets. Enter confirms, Escape cancels, and both can also be done with the
// two buttons.
//
// The window only asks. What the text is used for, and whether it will do, is
// the job of the function it is given: that function answers with a message
// to show under the field, and the window then stays open.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { isInputMethodKey } from './keys';

export interface TextPrompt {
  /** The window's title, for example "New scene". */
  readonly title: string;
  /** What the field is for; read out by screen readers. */
  readonly label: string;
  /** Shown in the field while it is empty. */
  readonly placeholder?: string;
  /** The text the field starts with (when renaming). It starts selected, so typing replaces it. */
  readonly value?: string;
  /** The text of the button that confirms, for example "Create". */
  readonly confirm: string;
  /** A line under the field that says what else will happen (a rename: what becomes of the links). Default: none. */
  readonly note?: string;
  /**
   * A list to choose one thing from, under the field (for example the
   * template a new scene starts from). Default: none.
   */
  readonly choice?: PromptChoice;
  /**
   * Called with the text when the writer confirms, and the value of what was
   * chosen in the list ("" when there is no list). Resolves with null when
   * all went well (the window closes), or with a short message saying why the
   * text will not do (shown under the field; the window stays open).
   */
  readonly submit: (value: string, chosen: string) => Promise<string | null> | string | null;
}

/** A list to choose from in the window. */
export interface PromptChoice {
  /** What the list is for, for example "Start from". */
  readonly label: string;
  /** The things to choose from, in order. Their texts may be the writer's own, in any language. */
  readonly options: ReadonlyArray<{ readonly value: string; readonly text: string }>;
  /** What is chosen at first. Default: the first. */
  readonly value?: string;
}

export class TextPromptModal extends Modal {
  private readonly prompt: TextPrompt;
  private input: HTMLInputElement | null = null;
  private message: HTMLElement | null = null;
  private confirmButton: ButtonComponent | null = null;
  private busy = false;
  private closed = false;
  private chosen = '';

  constructor(app: App, prompt: TextPrompt) {
    super(app);
    this.prompt = prompt;
  }

  override onOpen(): void {
    const { contentEl, prompt } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(prompt.title);
    this.modalEl.addClass('spellbook-prompt');

    const field = contentEl.createDiv({ cls: 'spellbook-prompt-field' });
    const input = field.createEl('input', {
      cls: 'spellbook-prompt-input',
      attr: {
        type: 'text',
        // The text may be in any language; let it pick its own direction.
        dir: 'auto',
        'aria-label': prompt.label,
        // What a phone's keyboard shows on its Enter key.
        enterkeyhint: 'done',
      },
    });
    if (prompt.placeholder !== undefined) input.setAttr('placeholder', prompt.placeholder);
    input.value = prompt.value ?? '';
    input.addEventListener('keydown', (event) => {
      // Enter confirms, except when it only accepts a word suggested by an
      // input method (Japanese, Chinese, Korean ...).
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      void this.submit();
    });
    input.addEventListener('input', () => {
      this.say(null); // the writer is changing the text: the old complaint no longer applies
    });
    // Escape cancels. Obsidian closes its windows on Escape by itself; this
    // makes sure of it, and is careful never to close a window twice.
    contentEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || isInputMethodKey(event) || this.closed) return;
      event.preventDefault();
      this.close();
    });
    this.input = input;
    this.message = field.createDiv({ cls: 'spellbook-prompt-message', attr: { role: 'alert', dir: 'auto' } });
    if (prompt.note !== undefined && prompt.note !== '') {
      field.createDiv({ cls: 'spellbook-prompt-note', text: prompt.note });
    }

    const choice = prompt.choice;
    this.chosen = choice?.value ?? choice?.options[0]?.value ?? '';
    if (choice !== undefined && choice.options.length > 0) {
      // In a place of its own: the window's own row of buttons stays its first row.
      const place = contentEl.createDiv({ cls: 'spellbook-prompt-choice-row' });
      new Setting(place).setName(choice.label).addDropdown((dropdown) => {
        for (const option of choice.options) {
          dropdown.selectEl.createEl('option', { value: option.value, text: option.text, attr: { dir: 'auto' } });
        }
        dropdown.selectEl.addClass('spellbook-prompt-choice');
        dropdown.setValue(this.chosen).onChange((value) => {
          this.chosen = value;
        });
      });
    }

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.confirmButton = button;
        button
          .setButtonText(prompt.confirm)
          .setCta()
          .onClick(() => {
            void this.submit();
          });
      });

    input.focus();
    input.select();
  }

  override onClose(): void {
    this.closed = true;
    this.input = null;
    this.message = null;
    this.confirmButton = null;
    this.contentEl.empty();
  }

  /** Show a message under the field, or take it away (null). */
  private say(message: string | null): void {
    this.message?.setText(message ?? '');
    this.input?.toggleClass('spellbook-is-invalid', message !== null);
    this.input?.setAttr('aria-invalid', message === null ? null : 'true');
  }

  private async submit(): Promise<void> {
    const input = this.input;
    if (this.busy || !input) return;
    this.busy = true;
    this.confirmButton?.setDisabled(true);
    let problem: string | null;
    try {
      problem = await this.prompt.submit(input.value, this.chosen);
    } catch (error) {
      console.error('Spellbook: the name could not be used', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.confirmButton?.setDisabled(false);
    }
    // The writer may have closed the window (Escape) while the work was going on.
    if (this.closed) return;
    if (problem === null) {
      this.close();
      return;
    }
    this.say(problem);
    // Back to the field, so the name can be put right straight away.
    this.input?.focus();
  }
}
