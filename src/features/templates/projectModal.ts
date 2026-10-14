// The window that saves the open project as a project template: its name, a
// line that says what it is, and whether the text of the scenes goes with it.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { isInputMethodKey } from '../../ui/keys';
import type { ProjectTemplateChoice } from './saving';

export const SAVE_PROJECT_TITLE = 'Save project as template';
export const INCLUDE_TEXT_NAME = 'Include the text of the scenes';
export const INCLUDE_TEXT_DESC = "Off: only the binder's folders, and each scene's title and synopsis, are saved.";

/**
 * Called when the writer presses Save. Resolves with null when the template
 * was saved (the window closes), or with why it was not (shown in the
 * window, which stays open).
 */
export type SaveProjectHandler = (choice: ProjectTemplateChoice) => Promise<string | null>;

export class SaveProjectTemplateModal extends Modal {
  private readonly save: SaveProjectHandler;
  private name: string;
  private description: string;
  private includeText = false;
  private busy = false;
  private message: HTMLElement | null = null;
  private saveButton: ButtonComponent | null = null;

  /**
   * @param title the project's title: the name and the description start from it
   */
  constructor(app: App, title: string, save: SaveProjectHandler) {
    super(app);
    this.save = save;
    this.name = title;
    this.description = `Saved from "${title}"`;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(SAVE_PROJECT_TITLE);
    this.modalEl.addClass('spellbook-template-save');

    const onEnter = (input: HTMLInputElement): void => {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || isInputMethodKey(event)) return;
        event.preventDefault();
        void this.submit();
      });
    };
    let first: HTMLInputElement | null = null;
    new Setting(contentEl)
      .setName('Name')
      .setDesc('What "Create project" will call it.')
      .addText((text) => {
        text.setValue(this.name).onChange((value) => {
          this.name = value;
        });
        text.inputEl.setAttr('dir', 'auto');
        onEnter(text.inputEl);
        first = text.inputEl;
      });
    new Setting(contentEl)
      .setName('Description')
      .setDesc('One line that says what it is.')
      .addText((text) => {
        text.setValue(this.description).onChange((value) => {
          this.description = value;
        });
        text.inputEl.setAttr('dir', 'auto');
        onEnter(text.inputEl);
      });
    new Setting(contentEl)
      .setName(INCLUDE_TEXT_NAME)
      .setDesc(INCLUDE_TEXT_DESC)
      .addToggle((toggle) => {
        toggle.setValue(this.includeText).onChange((value) => {
          this.includeText = value;
        });
      });
    this.message = contentEl.createDiv({ cls: 'spellbook-template-message', attr: { role: 'alert', dir: 'auto' } });
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
    (first as HTMLInputElement | null)?.focus();
  }

  override onClose(): void {
    this.message = null;
    this.saveButton = null;
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.saveButton?.setDisabled(true);
    let problem: string | null;
    try {
      problem = await this.save({ name: this.name, description: this.description, includeText: this.includeText });
    } catch (error) {
      console.error('Spellbook: the project template could not be saved', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.saveButton?.setDisabled(false);
    }
    if (problem === null) this.close();
    else this.message?.setText(problem);
  }
}
