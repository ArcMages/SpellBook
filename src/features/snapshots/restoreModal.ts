// The window that asks before a snapshot is restored. Restoring replaces the
// text of a scene, so it is never done without a yes, and Cancel is the
// button that starts out focused: a stray Enter does nothing.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';

export const RESTORE_TEXT = 'Restore';
export const RESTORE_MESSAGE =
  'The text of the scene will be replaced by the text of this snapshot. ' +
  'The text as it is now is saved first, as a snapshot of its own ("Before restore"), so you can always go back.';
export const PROPERTIES_NAME = 'Also restore properties';
export const PROPERTIES_DESC =
  'Off: the scene keeps the status, label, synopsis, target and other properties it has now. ' +
  'On: they are put back as they were when the snapshot was taken.';

export interface RestoreQuestion {
  /** The scene's title: the writer's own text. */
  readonly sceneTitle: string;
  /** The snapshot, as the list names it. */
  readonly snapshotName: string;
  /** Called once when the writer goes ahead. Not called on Cancel. */
  readonly onConfirm: (withProperties: boolean) => void;
}

export class RestoreModal extends Modal {
  private readonly question: RestoreQuestion;
  private answered = false;
  private closed = false;
  private withProperties = false;

  constructor(app: App, question: RestoreQuestion) {
    super(app);
    this.question = question;
  }

  override onOpen(): void {
    const { contentEl, question } = this;
    contentEl.empty();
    this.withProperties = false;
    this.titleEl.setText(`Restore "${question.sceneTitle}"?`);
    this.titleEl.setAttr('dir', 'auto');
    this.modalEl.addClass('spellbook-confirm', 'spellbook-snapshots-restore');
    contentEl.createEl('p', { cls: 'spellbook-snapshots-restore-which', text: question.snapshotName, attr: { dir: 'auto' } });
    contentEl.createEl('p', { cls: 'spellbook-confirm-message', text: RESTORE_MESSAGE });

    new Setting(contentEl)
      .setName(PROPERTIES_NAME)
      .setDesc(PROPERTIES_DESC)
      .addToggle((toggle) => {
        toggle.setValue(false).onChange((value) => {
          this.withProperties = value;
        });
      });

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
          .setButtonText(RESTORE_TEXT)
          .setWarning()
          .onClick(() => {
            if (this.answered) return;
            this.answered = true;
            this.close();
            question.onConfirm(this.withProperties);
          });
      });
    (cancel as ButtonComponent | null)?.buttonEl.focus();

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
