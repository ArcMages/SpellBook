// The small window that comes up once an export is saved: it says that the
// manuscript was exported, the name of the new file and the folder of the
// vault it is in, and what was left out. Its buttons: "Show in file list"
// (Obsidian's own file list comes to the front and points at the file),
// "Open" and "OK".
//
// It stays until the writer closes it, so that where the file went is never
// missed, as a notice that fades could be. It is made of Obsidian's own
// rows, which are large enough for a finger and stack at phone width; on a
// phone the file list is the drawer at the side, which the button slides out.

import { Modal, Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { safely } from '../../ui/safely';
import type { ExportOutcome, Exporter } from './exporter';

export type DoneOutcome = Extract<ExportOutcome, { status: 'done' }>;

export const EXPORTED_TITLE = 'Manuscript exported';
export const SHOW_IN_FILE_LIST_TEXT = 'Show in file list';
export const OPEN_BUTTON_TEXT = 'Open';
export const OK_BUTTON_TEXT = 'OK';
export const FILE_LABEL = 'File';
export const FOLDER_LABEL = 'Folder';

/** The vault's own top folder has no name of its own: this is what stands for it. */
export const VAULT_ROOT_TEXT = '/ (the top of the vault)';

export const COULD_NOT_OPEN_TEXT = 'The file could not be opened from here. You will find it in the Exports folder of the project.';

export const COULD_NOT_SHOW_TEXT = 'The file list could not be shown from here. You will find the file in the Exports folder of the project.';

/** Under a Word file, an e-book or a web page: why Obsidian's file list may not show it. */
export const HIDDEN_FILE_NOTE =
  'Obsidian\'s file list only shows Word, e-book and web-page files when "Detect all file extensions" is switched on, in Obsidian\'s settings under "Files and links".';

/** On a phone or a tablet: the file can be reached from outside Obsidian too. */
export const MOBILE_WHERE_NOTE = 'You can also reach the file from the Files app, in the folder of your vault.';

/** How long a notice about something that went wrong stays up, in milliseconds. */
export const PROBLEM_NOTICE_MS = 10000;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The name of a file, from its vault path. */
export function fileNameOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? path : path.slice(at + 1);
}

/** The folder of the vault a file is in, from its vault path; "" for the top of the vault. */
export function folderOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

export class ExportDoneModal extends Modal {
  private readonly exporter: Exporter;
  private readonly outcome: DoneOutcome;
  /** Whether this is a phone or a tablet, as the export window decides (in one place for the feature). */
  private readonly mobile: boolean;
  private shut = false;

  constructor(app: App, exporter: Exporter, outcome: DoneOutcome, mobile: boolean) {
    super(app);
    this.exporter = exporter;
    this.outcome = outcome;
    this.mobile = mobile;
  }

  override onOpen(): void {
    this.shut = false;
    this.modalEl.addClass('spellbook-export');
    this.modalEl.addClass('spellbook-export-done');
    this.titleEl.setText(EXPORTED_TITLE);
    this.draw();
  }

  override onClose(): void {
    this.shut = true;
    this.contentEl.empty();
  }

  private draw(): void {
    const { contentEl, outcome } = this;
    contentEl.empty();
    const result = contentEl.createDiv({ cls: 'spellbook-export-result' });
    result.createEl('p', {
      cls: 'spellbook-export-saved',
      text: `Saved ${plural(outcome.scenes, 'scene', 'scenes')}, ${plural(outcome.words, 'word', 'words')}, as a new file.`,
    });
    const where = result.createDiv({ cls: 'spellbook-export-where' });
    const line = (label: string, cls: string, value: string): void => {
      const item = where.createDiv({ cls: 'spellbook-export-where-line' });
      item.createSpan({ cls: 'spellbook-export-where-label', text: label });
      // The names of the file and its folder are the writer's own text, in any language.
      item.createSpan({ cls: `spellbook-export-path ${cls}`, text: value, attr: { dir: 'auto' } });
    };
    line(FILE_LABEL, 'spellbook-export-file', fileNameOf(outcome.path));
    const folder = folderOf(outcome.path);
    line(FOLDER_LABEL, 'spellbook-export-folder', folder === '' ? VAULT_ROOT_TEXT : folder);
    // A Markdown export is a note, which the file list always shows.
    if (outcome.format !== 'markdown') result.createEl('p', { cls: 'spellbook-export-note', text: HIDDEN_FILE_NOTE });
    if (this.mobile) result.createEl('p', { cls: 'spellbook-export-note', text: MOBILE_WHERE_NOTE });
    this.listLeftOut(result, 'Left out, because the "compile" switch is off:', outcome.switchedOff);
    this.listLeftOut(result, 'Left out, because the note is missing or could not be read:', outcome.unread);
    for (const warning of outcome.warnings) result.createEl('p', { cls: 'spellbook-export-note', text: warning, attr: { dir: 'auto' } });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(SHOW_IN_FILE_LIST_TEXT).onClick(() => {
          safely(SHOW_IN_FILE_LIST_TEXT, () => this.showFile());
        });
        button.buttonEl.setAttr('aria-label', 'Show the file in Obsidian\'s file list');
      })
      .addButton((button) => {
        button.setButtonText(OPEN_BUTTON_TEXT).onClick(() => {
          safely(OPEN_BUTTON_TEXT, () => this.openFile());
        });
      })
      .addButton((button) => {
        button
          .setButtonText(OK_BUTTON_TEXT)
          .setCta()
          .onClick(() => {
            this.close();
          });
      });
  }

  private listLeftOut(parent: HTMLElement, heading: string, titles: readonly string[]): void {
    if (titles.length === 0) return;
    parent.createEl('p', { cls: 'spellbook-export-note', text: heading });
    const list = parent.createEl('ul', { cls: 'spellbook-export-left-out' });
    // Scene titles are the writer's own text.
    for (const title of titles) list.createEl('li', { text: title, attr: { dir: 'auto' } });
  }

  async openFile(): Promise<void> {
    const opened = await this.exporter.open(this.outcome);
    if (!opened) new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
    else if (this.outcome.format === 'markdown' && !this.shut) this.close();
  }

  private async showFile(): Promise<void> {
    const shown = await this.exporter.showInFolder(this.outcome);
    if (!shown) new Notice(COULD_NOT_SHOW_TEXT, PROBLEM_NOTICE_MS);
    // The file list is on show (on a phone, the drawer at the side): the window is out of its way.
    else if (!this.shut) this.close();
  }
}
