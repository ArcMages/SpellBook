// A small window that asks for a date, with the device's own date field: a
// wheel on a phone, a little calendar on a computer.
//
// It is the date-shaped twin of the window that asks for a name
// (src/ui/textPromptModal.ts): Enter confirms, Escape cancels, both can be
// done with the two buttons, and the function it is given may answer with a
// message, which is shown under the field while the window stays open.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { isInputMethodKey } from '../../ui/keys';

export interface DatePrompt {
  /** The window's title, for example "Set date". */
  readonly title: string;
  /** What the field is for; read out by screen readers. */
  readonly label: string;
  /** The date the field starts with, as YYYY-MM-DD; null or left out for an empty field. */
  readonly value?: string | null;
  /** The text of the button that confirms, for example "Set date". */
  readonly confirm: string;
  /**
   * Called with the date (YYYY-MM-DD; "" when the field was left empty) when
   * the writer confirms. Resolves with null when all went well (the window
   * closes), or with a short message saying why not (shown under the field).
   */
  readonly submit: (value: string) => Promise<string | null> | string | null;
}

export class DatePromptModal extends Modal {
  private readonly prompt: DatePrompt;
  private input: HTMLInputElement | null = null;
  private message: HTMLElement | null = null;
  private confirmButton: ButtonComponent | null = null;
  private busy = false;
  private closed = false;

  constructor(app: App, prompt: DatePrompt) {
    super(app);
    this.prompt = prompt;
  }

  override onOpen(): void {
    const { contentEl, prompt } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(prompt.title);
    // The window borrows the looks of the one that asks for a name.
    this.modalEl.addClass('spellbook-prompt', 'spellbook-date-prompt');

    const field = contentEl.createDiv({ cls: 'spellbook-prompt-field' });
    const input = field.createEl('input', {
      cls: 'spellbook-prompt-input spellbook-date-input',
      attr: { type: 'date', 'aria-label': prompt.label },
    });
    input.value = prompt.value ?? '';
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      void this.submit();
    });
    input.addEventListener('input', () => {
      this.say(null);
    });
    contentEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || isInputMethodKey(event) || this.closed) return;
      event.preventDefault();
      this.close();
    });
    this.input = input;
    this.message = field.createDiv({ cls: 'spellbook-prompt-message', attr: { role: 'alert' } });

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
      problem = await this.prompt.submit(input.value);
    } catch (error) {
      console.error('Spellbook: the date could not be used', error);
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
    this.input?.focus();
  }
}
