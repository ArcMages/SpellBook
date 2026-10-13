// A small window that asks "are you sure?" before something that is hard to
// take back, such as moving a scene's note to the trash.
//
// Cancel is the button that starts out focused, so that a stray Enter does
// nothing. Escape, or closing the window, cancels as well.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';

export interface Confirmation {
  /** The window's title: the question, for example 'Delete "Opening"?'. */
  readonly title: string;
  /** What will happen, in a sentence or two. */
  readonly message: string;
  /** The text of the button that goes ahead, for example "Delete". */
  readonly confirm: string;
  /** Called once when the writer goes ahead. Not called on Cancel. */
  readonly onConfirm: () => void;
}

export class ConfirmModal extends Modal {
  private readonly question: Confirmation;
  private answered = false;
  private closed = false;

  constructor(app: App, question: Confirmation) {
    super(app);
    this.question = question;
  }

  override onOpen(): void {
    const { contentEl, question } = this;
    contentEl.empty();
    // The title names the scene, which is the writer's own text.
    this.titleEl.setText(question.title);
    this.titleEl.setAttr('dir', 'auto');
    this.modalEl.addClass('spellbook-confirm');
    contentEl.createEl('p', { cls: 'spellbook-confirm-message', text: question.message, attr: { dir: 'auto' } });

    let cancel: ButtonComponent | null = null;
    new Setting(contentEl)
      .addButton((button) => {
        cancel = button;
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button
          .setButtonText(question.confirm)
          .setWarning()
          .onClick(() => {
            if (this.answered) return;
            this.answered = true;
            this.close();
            question.onConfirm();
          });
      });
    (cancel as ButtonComponent | null)?.buttonEl.focus();

    // Escape cancels. Obsidian closes its windows on Escape by itself; this
    // makes sure of it, and is careful never to close a window twice.
    this.closed = false;
    contentEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.closed) return;
      event.preventDefault();
      this.close();
    });
  }

  override onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }
}
