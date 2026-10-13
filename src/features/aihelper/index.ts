// The AI helper: a reference, written for an AI assistant, of what a
// Spellbook project is and how to read and change one without breaking it.
// A writer hands it to whatever assistant they use.
//
// This file plugs it into the plugin: it adds the command that writes the
// reference into the open project, as "AI helper/Spellbook for AI
// assistants.md", and then offers to open it. The note is written through
// the project store (helperNote.ts), and a copy the writer changed is only
// replaced when they say so. The command is registered through the plugin,
// so Obsidian takes it away again when the plugin is switched off; a window
// that is still open then is closed by hand.

import { Modal, Notice, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { ConfirmModal } from '../../ui/confirmModal';
import type { Feature, FeatureContext } from '../registry';
import { HELPER_NOTE_PATH, NO_PROJECT_TEXT, ensureHelperNote, replaceHelperNote } from './helperNote';

export { HELPER_NOTE_PATH, NO_PROJECT_TEXT, ensureHelperNote, isShippedText, replaceHelperNote } from './helperNote';
export type { HelperOutcome, ReplaceOutcome } from './helperNote';
export { HELPER_TEXT } from './referenceText';

/** The command this feature adds. Obsidian puts the plugin's name in front of its name. */
export const AIHELPER_COMMANDS = {
  createNote: { id: 'create-ai-helper-note', name: 'Create AI helper note' },
} as const;

/** How long a notice about a problem stays up, in milliseconds. */
export const PROBLEM_NOTICE_MS = 8000;

export const CREATED_TITLE = 'AI helper note created';
export const READY_TITLE = 'AI helper note';
export const REPLACED_TITLE = 'AI helper note replaced';
export const CREATED_TEXT = `The note is in this project, at "${HELPER_NOTE_PATH}". Give it to an AI assistant before you ask it to read or change the project.`;
export const READY_TEXT = `This project already has the note, at "${HELPER_NOTE_PATH}", and it is up to date. Nothing was changed.`;
export const REPLACED_TEXT = `The note at "${HELPER_NOTE_PATH}" now holds this version's text.`;
export const OPEN_TEXT = 'Open note';
export const CLOSE_TEXT = 'Close';
export const REPLACE_TITLE = 'Replace the AI helper note?';
export const REPLACE_TEXT =
  `This project already has a note at "${HELPER_NOTE_PATH}", and it does not say what this version of Spellbook writes: ` +
  'it was changed by hand, or it was made by another version. Replacing it puts this version\'s text in its place, and what the note says now is lost. Cancel keeps the note as it is.';
export const REPLACE_CONFIRM = 'Replace';
export const CHANGED_AGAIN_TEXT = 'The AI helper note changed again in the meantime, so it was left as it is. Run the command again.';
export const COULD_NOT_OPEN_TEXT = 'The AI helper note could not be opened. It is in the project folder, under "AI helper".';

/** A small window that says where the note is and offers to open it. */
export class HelperNoteModal extends Modal {
  private readonly heading: string;
  private readonly message: string;
  private readonly onOpenNote: () => void;

  constructor(app: App, heading: string, message: string, onOpenNote: () => void) {
    super(app);
    this.heading = heading;
    this.message = message;
    this.onOpenNote = onOpenNote;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(this.heading);
    this.modalEl.addClass('spellbook-confirm');
    contentEl.createEl('p', { cls: 'spellbook-confirm-message', text: this.message });
    let open: ButtonComponent | null = null;
    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(CLOSE_TEXT).onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        open = button;
        button
          .setButtonText(OPEN_TEXT)
          .setCta()
          .onClick(() => {
            this.close();
            this.onOpenNote();
          });
      });
    (open as ButtonComponent | null)?.buttonEl.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export const aihelperFeature: Feature = {
  id: 'aihelper',
  register(context: FeatureContext): void {
    const { app, plugin, store } = context;
    let shown: Modal | null = null;
    let released = false;
    context.onUnload(() => {
      released = true;
      shown?.close();
      shown = null;
    });

    const show = (modal: Modal): void => {
      if (released) return;
      // One window at a time.
      shown?.close();
      shown = modal;
      modal.open();
    };
    const problem = (message: string): void => {
      new Notice(message, PROBLEM_NOTICE_MS);
    };
    const offer = (heading: string, message: string, path: string): void => {
      show(
        new HelperNoteModal(app, heading, message, () => {
          void context.openNote(path).then(
            (opened) => {
              if (!opened && !released) problem(COULD_NOT_OPEN_TEXT);
            },
            () => {
              if (!released) problem(COULD_NOT_OPEN_TEXT);
            },
          );
        }),
      );
    };

    const replace = async (inProject: string, found: string): Promise<void> => {
      const outcome = await replaceHelperNote(store, inProject, found);
      if (released) return;
      if (outcome.status === 'replaced') offer(REPLACED_TITLE, REPLACED_TEXT, outcome.path);
      else problem(outcome.status === 'changed-again' ? CHANGED_AGAIN_TEXT : outcome.message);
    };

    const run = async (): Promise<void> => {
      const project = store.project;
      if (!project) {
        problem(NO_PROJECT_TEXT);
        return;
      }
      const inProject = project.indexPath;
      const outcome = await ensureHelperNote(store, inProject);
      if (released) return;
      if (outcome.status === 'problem') {
        problem(outcome.message);
        return;
      }
      if (outcome.status === 'ready') {
        offer(outcome.created ? CREATED_TITLE : READY_TITLE, outcome.created ? CREATED_TEXT : READY_TEXT, outcome.path);
        return;
      }
      show(
        new ConfirmModal(app, {
          title: REPLACE_TITLE,
          message: REPLACE_TEXT,
          confirm: REPLACE_CONFIRM,
          onConfirm: () => {
            void replace(inProject, outcome.found).catch((error: unknown) => {
              console.error('Spellbook: the AI helper note could not be replaced', error);
            });
          },
        }),
      );
    };

    plugin.addCommand({
      ...AIHELPER_COMMANDS.createNote,
      callback: () => {
        if (released) return;
        void run().catch((error: unknown) => {
          console.error('Spellbook: the AI helper note could not be made', error);
          if (!released) problem('The AI helper note could not be made.');
        });
      },
    });
  },
};
