// The small window for a revision note: the passage it is about, quoted,
// and a box for the note. Used to add a note and to change one.
//
// Enter makes a new line (a note may be a few sentences); the button saves,
// and so do Ctrl+Enter and Cmd+Enter. Escape cancels.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { isInputMethodKey } from '../../ui/keys';

/** How much of a passage the window quotes, in characters. */
export const QUOTE_LENGTH = 300;

export interface NoteAsk {
  readonly title: string;
  /** The passage the note is about: the writer's own words. */
  readonly passage: string;
  /** What the box starts with. */
  readonly value?: string;
  readonly confirm: string;
  /** Called with the note; resolves with null when it was saved (the window closes), or with why not. */
  readonly submit: (note: string) => Promise<string | null>;
}

export const NOTE_LABEL = 'The note';
export const NOTE_PLACEHOLDER = 'What should change here?';

/** A passage cut short for quoting. */
export function quoted(passage: string, length = QUOTE_LENGTH): string {
  const chars = [...passage];
  return chars.length <= length ? passage : `${chars.slice(0, length).join('').trimEnd()}…`;
}

export class NoteModal extends Modal {
  private readonly ask: NoteAsk;
  private box: HTMLTextAreaElement | null = null;
  private message: HTMLElement | null = null;
  private button: ButtonComponent | null = null;
  private busy = false;
  private closed = false;

  constructor(app: App, ask: NoteAsk) {
    super(app);
    this.ask = ask;
  }

  override onOpen(): void {
    const { contentEl, ask } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(ask.title);
    this.modalEl.addClass('spellbook-revision-note-modal');
    contentEl.createEl('blockquote', { cls: 'spellbook-revision-quote', text: quoted(ask.passage), attr: { dir: 'auto' } });
    const box = contentEl.createEl('textarea', {
      cls: 'spellbook-revision-note-box',
      attr: { dir: 'auto', rows: '4', 'aria-label': NOTE_LABEL, placeholder: NOTE_PLACEHOLDER },
    });
    box.value = ask.value ?? '';
    box.addEventListener('keydown', (event) => {
      if (isInputMethodKey(event)) return;
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.submit();
      } else if (event.key === 'Escape' && !this.closed) {
        event.preventDefault();
        this.close();
      }
    });
    box.addEventListener('input', () => {
      this.message?.setText('');
    });
    this.box = box;
    this.message = contentEl.createDiv({ cls: 'spellbook-prompt-message', attr: { role: 'alert', dir: 'auto' } });
    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.button = button;
        button
          .setButtonText(ask.confirm)
          .setCta()
          .onClick(() => {
            void this.submit();
          });
      });
    box.focus();
  }

  override onClose(): void {
    this.closed = true;
    this.box = null;
    this.message = null;
    this.button = null;
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    const box = this.box;
    if (this.busy || !box) return;
    this.busy = true;
    this.button?.setDisabled(true);
    let problem: string | null;
    try {
      problem = await this.ask.submit(box.value);
    } catch (error) {
      console.error('Spellbook: the revision note could not be saved', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.button?.setDisabled(false);
    }
    if (this.closed) return;
    if (problem === null) {
      this.close();
      return;
    }
    this.message?.setText(problem);
  }
}
