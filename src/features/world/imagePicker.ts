// The window that gives an entity its picture: a box to search in, and under
// it the pictures of the vault (the files whose names end like a picture's),
// each with a small view of itself, its name and the folder it is in. A tap
// on one writes a link to it in the entity's "image" property. The picture
// itself is never touched, and nothing is copied or moved.
//
// Enter takes the first row. Nothing here depends on hovering: every row is
// a button that can be tapped, and reached and pressed from the keyboard.

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { baseName, parentPath } from '../../core/paths';
import { searchImages } from '../../core/world';
import { isInputMethodKey } from '../../ui/keys';
import { safely } from '../../ui/safely';
import type { WorldHost } from './host';
import { NO_PROJECT_TEXT, PROBLEM_NOTICE_MS, READ_ONLY_TEXT } from './parts';

export const IMAGE_PICKER_PLACEHOLDER = 'Search the pictures of the vault';
export const NO_IMAGES_TEXT = 'There are no pictures in the vault yet. Add an image file to the vault (drop it into a note, say), then choose it here.';
export const NO_IMAGES_FOUND_TEXT = 'No picture by that name.';
export const VAULT_ROOT_TEXT = 'Top of the vault';

/** At most this many pictures are listed at once; typing narrows the list down. */
export const IMAGE_PICKER_LIMIT = 40;

/** "Picture of Mara": the entity's name is the writer's own text. */
export function imagePickerTitle(name: string | null): string {
  return name === null ? 'Choose picture' : `Picture of ${name}`;
}

export class ImagePickerModal extends Modal {
  private readonly host: WorldHost;
  private readonly entityPath: string;
  private input: HTMLInputElement | null = null;
  private list: HTMLElement | null = null;
  private message: HTMLElement | null = null;
  private busy = false;
  private closed = true;
  /** The pictures of the vault, read once when the window opens. */
  private images: readonly string[] = [];
  /** What the first row does, for Enter. */
  private first: (() => void) | null = null;

  constructor(app: App, host: WorldHost, entityPath: string) {
    super(app);
    this.host = host;
    this.entityPath = entityPath;
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(imagePickerTitle(this.host.entity(this.entityPath)?.name ?? null));
    this.titleEl.setAttr('dir', 'auto');
    this.modalEl.addClass('spellbook-world-picker');
    this.modalEl.addClass('spellbook-world-image-picker');
    this.images = this.host.imageFiles();

    const input = contentEl.createEl('input', {
      cls: 'spellbook-world-picker-input',
      attr: {
        type: 'text',
        // A file's name may be in any language; let it pick its own direction.
        dir: 'auto',
        placeholder: IMAGE_PICKER_PLACEHOLDER,
        'aria-label': IMAGE_PICKER_PLACEHOLDER,
        enterkeyhint: 'done',
      },
    });
    input.addEventListener('input', () => {
      this.message?.setText('');
      this.drawRows();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      this.first?.();
    });
    this.input = input;
    this.message = contentEl.createDiv({ cls: 'spellbook-world-picker-message', attr: { role: 'alert', dir: 'auto' } });
    this.list = contentEl.createDiv({ cls: 'spellbook-world-picker-list', attr: { role: 'list' } });
    this.drawRows();
    input.focus();
  }

  override onClose(): void {
    this.closed = true;
    this.input = null;
    this.list = null;
    this.message = null;
    this.first = null;
    this.images = [];
    this.contentEl.empty();
  }

  private drawRows(): void {
    const list = this.list;
    const input = this.input;
    if (!list || !input || this.closed) return;
    list.empty();
    this.first = null;
    const found = searchImages(this.images, input.value);
    if (found.length === 0) {
      list.createDiv({ cls: 'spellbook-world-picker-note', text: this.images.length === 0 ? NO_IMAGES_TEXT : NO_IMAGES_FOUND_TEXT });
      return;
    }
    for (const path of found.slice(0, IMAGE_PICKER_LIMIT)) this.drawImage(list, path);
    if (found.length > IMAGE_PICKER_LIMIT) {
      list.createDiv({ cls: 'spellbook-world-picker-note', text: `${found.length - IMAGE_PICKER_LIMIT} more: type to narrow the list down.` });
    }
  }

  private drawImage(list: HTMLElement, path: string): void {
    const row = list.createEl('button', { cls: 'spellbook-world-picker-row spellbook-world-picker-image', attr: { type: 'button', role: 'listitem' } });
    const run = (): void => {
      safely('Choose picture', () => this.take(path));
    };
    row.addEventListener('click', run);
    this.first ??= run;
    const frame = row.createSpan({ cls: 'spellbook-world-picture spellbook-world-picker-thumb', attr: { 'aria-hidden': 'true' } });
    const url = this.host.pictureUrl(path);
    if (url !== null) frame.createEl('img', { cls: 'spellbook-world-picture-img', attr: { src: url, alt: '', loading: 'lazy', draggable: 'false' } });
    const words = row.createSpan({ cls: 'spellbook-world-picker-words' });
    words.createSpan({ cls: 'spellbook-world-picker-name', text: baseName(path), attr: { dir: 'auto' } });
    words.createSpan({ cls: 'spellbook-world-picker-summary', text: parentPath(path) || VAULT_ROOT_TEXT, attr: { dir: 'auto' } });
  }

  /** Give the entity this picture, once at a time. The window closes when it is done, and says why when it is not. */
  private async take(path: string): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    let problem: string | null;
    try {
      problem = await this.host.setPicture(this.entityPath, path);
    } catch (error) {
      console.error('Spellbook: the picture could not be set', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
    if (this.closed) {
      if (problem !== null) new Notice(problem, PROBLEM_NOTICE_MS);
      return;
    }
    if (problem === null) {
      this.close();
      return;
    }
    this.message?.setText(problem);
    this.input?.focus();
  }
}

/** Open the window that gives an entity its picture. */
export function openImagePicker(app: App, host: WorldHost, entityPath: string): void {
  const project = host.project;
  if (!project || project.readOnly) {
    new Notice(project ? READ_ONLY_TEXT : NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
    return;
  }
  new ImagePickerModal(app, host, entityPath).open();
}
