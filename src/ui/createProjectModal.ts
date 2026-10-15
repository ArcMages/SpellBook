// The "Create project" window: asks for the project's name, where to put it
// and, when it is given a list of starting structures, which one to start
// with (and for "Chapter by chapter", how many chapters). Under the choice it
// shows a line that says what the structure is, and the folders and scenes
// it will make.
//
// It only collects the answers. Creating the project, and saying why it
// could not be created, is the job of the function it is given.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { BLANK_STRUCTURE_ID, DEFAULT_CHAPTERS, MAX_CHAPTERS, MIN_CHAPTERS, describeSize, isStructureFolder, readChapterCount } from '../core/templates';
import type { StartChoice, StructurePart } from '../core/templates';
import { isInputMethodKey } from './keys';
import { WRITES_IN_LABELS } from '../core/noteKind';
import type { NoteKind } from '../core/noteKind';

/** The name of the choice between scenes and chapters. */
export const WRITES_IN_NAME = 'I usually write in';
export const WRITES_IN_DESC =
  'One note per scene, or one note per chapter. A book can mix both, and this can be changed later from the binder\'s menu.';

/** How the top of the vault is shown in the list of folders. */
export const VAULT_ROOT_LABEL = '/ (top of the vault)';

/** The starting structure the writer chose. */
export interface ProjectStart {
  /** The id of the chosen StartChoice; the blank structure's when no list was given. */
  readonly choice: string;
  /** How many chapters, for the structure that asks. */
  readonly chapters: number;
  /** What the writer usually writes in: what "New ..." makes and the kind of the first notes. */
  readonly writesIn: NoteKind;
}

/**
 * Called when the writer presses Create. Resolves with true when the project
 * was created (the window then closes) or false when it was not (the window
 * stays open so the name can be changed).
 */
export type CreateProjectHandler = (name: string, parentFolder: string, start: ProjectStart) => Promise<boolean>;

/** What the window says when the number of chapters will not do. */
export const BAD_CHAPTERS_TEXT = `Give a whole number of chapters from ${MIN_CHAPTERS} to ${MAX_CHAPTERS}.`;

export class CreateProjectModal extends Modal {
  private readonly folders: readonly string[];
  private readonly create: CreateProjectHandler;
  private readonly choices: readonly StartChoice[];
  private name = '';
  private parentFolder = '';
  private choice: StartChoice | null;
  private chaptersText = String(DEFAULT_CHAPTERS);
  private writesIn: NoteKind = 'scene';
  private busy = false;
  private createButton: ButtonComponent | null = null;
  private nameInput: HTMLInputElement | null = null;
  private structureEl: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private chaptersMessage: HTMLElement | null = null;

  /**
   * @param folders the folders the project may be created in, as vault paths;
   *                "" stands for the top of the vault and is chosen at first
   * @param create  creates the project
   * @param choices the starting structures to choose from, the first chosen at
   *                first; none (the default) asks for no structure
   */
  constructor(app: App, folders: readonly string[], create: CreateProjectHandler, choices: readonly StartChoice[] = []) {
    super(app);
    this.folders = folders.includes('') ? folders : ['', ...folders];
    this.create = create;
    this.choices = choices;
    this.choice = choices[0] ?? null;
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

    // In a place of its own, next to the structure's rows below it.
    new Setting(contentEl.createDiv({ cls: 'spellbook-create-writes-in' }))
      .setName(WRITES_IN_NAME)
      .setDesc(WRITES_IN_DESC)
      .addDropdown((dropdown) => {
        for (const kind of ['scene', 'chapter'] as const) {
          dropdown.selectEl.createEl('option', { value: kind, text: WRITES_IN_LABELS[kind] });
        }
        dropdown.setValue(this.writesIn).onChange((value) => {
          this.writesIn = value === 'chapter' ? 'chapter' : 'scene';
        });
      });

    if (this.choices.length > 0) {
      // A place of its own, so that the rows inside it can be drawn again when the choice changes.
      this.structureEl = contentEl.createDiv({ cls: 'spellbook-create-structure' });
      this.renderStructure();
    }

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
    this.structureEl = null;
    this.previewEl = null;
    this.chaptersMessage = null;
    this.contentEl.empty();
  }

  /** The rows that choose the structure, with what it will make. */
  private renderStructure(): void {
    const place = this.structureEl;
    const choice = this.choice;
    if (!place || !choice) return;
    place.empty();

    const row = new Setting(place).setName('Structure').addDropdown((dropdown) => {
      for (const option of this.choices) {
        // A template of the writer's own has a name in any language.
        dropdown.selectEl.createEl('option', { value: option.id, text: option.name, attr: { dir: 'auto' } });
      }
      dropdown.setValue(choice.id).onChange((value) => {
        this.choice = this.choices.find((other) => other.id === value) ?? this.choice;
        this.renderStructure();
      });
    });
    row.setDesc(choice.description);
    row.descEl.setAttr('dir', 'auto');

    this.chaptersMessage = null;
    if (choice.asksForChapters) {
      const chapters = new Setting(place).setName('Chapters').setDesc('How many chapters the book will have.');
      chapters.addText((text) => {
        text.setValue(this.chaptersText).onChange((value) => {
          this.chaptersText = value;
          this.sayChapters(null);
          this.renderPreview();
        });
        text.inputEl.setAttr('inputmode', 'numeric');
        text.inputEl.setAttr('aria-label', 'Number of chapters');
      });
      this.chaptersMessage = place.createDiv({ cls: 'spellbook-create-message', attr: { role: 'alert' } });
    }

    this.previewEl = place.createDiv({ cls: 'spellbook-create-preview' });
    this.renderPreview();
  }

  /** The list of folders and scenes the chosen structure will make. */
  private renderPreview(): void {
    const place = this.previewEl;
    const choice = this.choice;
    if (!place || !choice) return;
    place.empty();
    const parts = choice.parts(this.chapters() ?? DEFAULT_CHAPTERS);
    place.createDiv({ cls: 'spellbook-create-preview-size', text: `It will make ${describeSize(parts)}:` });
    const list = (into: HTMLElement, items: readonly StructurePart[]): void => {
      const ul = into.createEl('ul', { cls: 'spellbook-create-preview-list' });
      for (const part of items) {
        if (isStructureFolder(part)) {
          const li = ul.createEl('li', { cls: 'spellbook-create-preview-folder' });
          li.createSpan({ cls: 'spellbook-create-preview-name', text: part.folder, attr: { dir: 'auto' } });
          if (part.children.length > 0) list(li, part.children);
        } else {
          const li = ul.createEl('li', { cls: 'spellbook-create-preview-scene' });
          li.createSpan({ cls: 'spellbook-create-preview-name', text: part.title, attr: { dir: 'auto' } });
        }
      }
    };
    list(place, parts);
  }

  /** The number of chapters typed, or null when it will not do. */
  private chapters(): number | null {
    return readChapterCount(this.chaptersText);
  }

  private sayChapters(message: string | null): void {
    this.chaptersMessage?.setText(message ?? '');
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const choice = this.choice;
    let chapters = DEFAULT_CHAPTERS;
    if (choice?.asksForChapters === true) {
      const typed = this.chapters();
      if (typed === null) {
        this.sayChapters(BAD_CHAPTERS_TEXT);
        return;
      }
      chapters = typed;
    }
    this.busy = true;
    this.createButton?.setDisabled(true);
    let created = false;
    try {
      created = await this.create(this.name, this.parentFolder, { choice: choice?.id ?? BLANK_STRUCTURE_ID, chapters, writesIn: this.writesIn });
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
