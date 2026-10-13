// The "Create project" window: asks for the project's name and where to put it.
//
// It only collects the two answers. Creating the project, and saying why it
// could not be created, is the job of the function it is given.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { isInputMethodKey } from './keys';

/** How the top of the vault is shown in the list of folders. */
export const VAULT_ROOT_LABEL = '/ (top of the vault)';

/**
 * Called when the writer presses Create. Resolves with true when the project
 * was created (the window then closes) or false when it was not (the window
 * stays open so the name can be changed).
 */
export type CreateProjectHandler = (name: string, parentFolder: string) => Promise<boolean>;

export class CreateProjectModal extends Modal {
  private readonly folders: readonly string[];
  private readonly create: CreateProjectHandler;
  private name = '';
  private parentFolder = '';
  private busy = false;
  private createButton: ButtonComponent | null = null;
  private nameInput: HTMLInputElement | null = null;

  /**
   * @param folders the folders the project may be created in, as vault paths;
   *                "" stands for the top of the vault and is chosen at first
   * @param create  creates the project
   */
  constructor(app: App, folders: readonly string[], create: CreateProjectHandler) {
    super(app);
    this.folders = folders.includes('') ? folders : ['', ...folders];
    this.create = create;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Create project');
    this.modalEl.addClass('spellbook-create-project');

    new Setting(contentEl)
      .setName('Name')
      .setDesc('The project gets its own folder with this name.')
      .addText((text) => {
        text.setPlaceholder('My novel').onChange((value) => {
          this.name = value;
        });
        // The name may be in any language; let the text pick its own direction.
        text.inputEl.setAttr('dir', 'auto');
        text.inputEl.addEventListener('keydown', (event) => {
          // Enter creates the project, except when it only accepts a word
          // suggested by an input method (Japanese, Chinese, Korean ...).
          if (event.key !== 'Enter' || isInputMethodKey(event)) return;
          event.preventDefault();
          void this.submit();
        });
        this.nameInput = text.inputEl;
      });

    new Setting(contentEl)
      .setName('Location')
      .setDesc('The folder to create the project in.')
      .addDropdown((dropdown) => {
        for (const folder of this.folders) {
          dropdown.selectEl.createEl('option', {
            value: folder,
            text: folder === '' ? VAULT_ROOT_LABEL : folder,
            attr: { dir: 'auto' },
          });
        }
        dropdown.setValue(this.parentFolder).onChange((value) => {
          this.parentFolder = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.createButton = button;
        button
          .setButtonText('Create')
          .setCta()
          .onClick(() => {
            void this.submit();
          });
      });

    this.nameInput?.focus();
  }

  override onClose(): void {
    this.createButton = null;
    this.nameInput = null;
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.createButton?.setDisabled(true);
    let created = false;
    try {
      created = await this.create(this.name, this.parentFolder);
    } catch (error) {
      // The handler reports its own problems to the writer; this is only a safety net.
      console.error('Spellbook: creating the project failed', error);
    } finally {
      this.busy = false;
      this.createButton?.setDisabled(false);
    }
    if (created) this.close();
  }
}
