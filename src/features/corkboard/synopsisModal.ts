// A small window with a field of several lines, for a scene's synopsis.
//
// The corkboard opens it from a card's menu. Like the windows that ask for a
// name (src/ui/textPromptModal.ts) it only asks: what happens to the text is
// the job of the function it is given, which answers with a message to show
// under the field when the text could not be saved.
//
// Enter starts a new line, as in any text of several lines; Cmd or Ctrl with
// Enter saves, and so does the Save button. Escape cancels.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { isInputMethodKey } from '../../ui/keys';

export interface SynopsisPrompt {
  /** The scene's title, shown in the window's title. The writer's own text. */
  readonly scene: string;
  /** The synopsis the field starts with ("" when the scene has none). */
  readonly value: string;
  /** Shown in the field while it is empty: the preview taken from the scene's text, if there is one. */
  readonly placeholder?: string;
  /**
   * Called with the text when the writer saves. Resolves with null when all
   * went well (the window closes), or with a short message saying why not
   * (shown under the field; the window stays open).
   */
  readonly submit: (value: string) => Promise<string | null> | string | null;
}

export class SynopsisModal extends Modal {
  private readonly prompt: SynopsisPrompt;
  private field: HTMLTextAreaElement | null = null;
  private message: HTMLElement | null = null;
  private saveButton: ButtonComponent | null = null;
  private busy = false;
  private closed = false;

  constructor(app: App, prompt: SynopsisPrompt) {
    super(app);
    this.prompt = prompt;
  }

  override onOpen(): void {
    const { contentEl, prompt } = this;
    this.closed = false;
    contentEl.empty();
    // The title names the scene, which is the writer's own text.
    this.titleEl.setText(`Synopsis: ${prompt.scene}`);
    this.titleEl.setAttr('dir', 'auto');
    this.modalEl.addClass('spellbook-synopsis');

    const holder = contentEl.createDiv({ cls: 'spellbook-synopsis-field' });
    const field = holder.createEl('textarea', {
      cls: 'spellbook-synopsis-input',
      attr: {
        // The text may be in any language; let it pick its own direction.
        dir: 'auto',
        rows: 6,
        'aria-label': 'Synopsis',
      },
    });
    if (prompt.placeholder !== undefined && prompt.placeholder !== '') field.setAttr('placeholder', prompt.placeholder);
    field.value = prompt.value;
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      // Enter alone is a new line.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      void this.submit();
    });
    field.addEventListener('input', () => {
      this.say(null);
    });
    // Escape cancels. Obsidian closes its windows on Escape by itself; this
    // makes sure of it, and is careful never to close a window twice.
    contentEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || isInputMethodKey(event) || this.closed) return;
      event.preventDefault();
      this.close();
    });
    this.field = field;
    this.message = holder.createDiv({ cls: 'spellbook-synopsis-message', attr: { role: 'alert', dir: 'auto' } });

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

    field.focus();
  }

  override onClose(): void {
    this.closed = true;
    this.field = null;
    this.message = null;
    this.saveButton = null;
    this.contentEl.empty();
  }

  private say(message: string | null): void {
    this.message?.setText(message ?? '');
    this.field?.setAttr('aria-invalid', message === null ? null : 'true');
  }

  private async submit(): Promise<void> {
    const field = this.field;
    if (this.busy || !field) return;
    this.busy = true;
    this.saveButton?.setDisabled(true);
    let problem: string | null;
    try {
      problem = await this.prompt.submit(field.value);
    } catch (error) {
      console.error('Spellbook: the synopsis could not be saved', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.saveButton?.setDisabled(false);
    }
    // The writer may have closed the window (Escape) while the work was going on.
    if (this.closed) return;
    if (problem === null) {
      this.close();
      return;
    }
    this.say(problem);
    this.field?.focus();
  }
}
