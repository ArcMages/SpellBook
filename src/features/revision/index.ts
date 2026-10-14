// Revision tools: what helps when the draft is written and the rewriting
// starts.
//
//   Add revision note    select words in a scene and pin a note to them; the
//                        passage is underlined lightly in the editor and the
//                        note shows when it is pointed at or tapped
//   Revision pane        every note of the manuscript, by scene, to tick off
//   Find and replace     across all scenes or one binder folder, with a tick
//                        for every place, a snapshot of every scene first
//   Rename everywhere    a World entity's note, its other names, and its old
//                        name in the text of the manuscript
//
// The parts, each in a file of its own in this folder:
//   book.ts          where the notes are kept: one file per project
//   keeper.ts        everything the tools do, on top of the project store
//   editor.ts        the underlined passages and their bubble
//   noteModal.ts     the window for a note
//   revisionView.ts  the Revision pane
//   findModal.ts     the Find and replace window
//   renameModal.ts   the Rename everywhere window
//   results.ts       the list of places found, with their ticks
//
// How a note is kept, how words are found and how a scene's text is changed
// in exact places is the engine's, in src/core/revision.

import { Notice, Platform } from 'obsidian';
import type { App, Editor, Menu, WorkspaceLeaf } from 'obsidian';
import { relativeTo } from '../../core/paths';
import { RENAME_EVERYWHERE_SERVICE, splitBody } from '../../core/revision/index';
import type { RenameEverywhereService } from '../../core/revision/index';
import type { Feature, FeatureContext } from '../registry';
import { RevisionNotesBook } from './book';
import { revisionEditor } from './editor';
import { FindReplaceModal } from './findModal';
import { NO_PROJECT_TEXT, NO_SCENE_TEXT, NO_SELECTION_TEXT, RevisionKeeper } from './keeper';
import { NoteModal } from './noteModal';
import { RenameEverywhereModal } from './renameModal';
import { REVISION_VIEW_TYPE, createRevisionView, revisionIcon } from './revisionView';

export { RevisionKeeper, SNAPSHOTS_SERVICE_NAME } from './keeper';
export type { LinksReport, RenameReport, ReplaceReport, SceneAt, SceneMatches, ScenePlan } from './keeper';
export { RevisionNotesBook, UNREADABLE_NOTES_TEXT } from './book';
export { PASSAGE_CLASS, PASSAGE_NOTE, RevisionMarksView, notesAt, revisionEditor } from './editor';
export { FindReplaceModal, replaceSnapshotName } from './findModal';
export { RenameEverywhereModal } from './renameModal';
export { TickedResults, changesText } from './results';
export { REVISION_VIEW_NAME, REVISION_VIEW_TYPE, RevisionView, countText, filtered } from './revisionView';

/** The commands this feature adds. Obsidian puts the plugin's name in front of their names. */
export const REVISION_COMMANDS = {
  addNote: { id: 'add-revision-note', name: 'Add revision note' },
  open: { id: 'open-revision', name: 'Open revision notes' },
  find: { id: 'find-and-replace', name: 'Find and replace in the manuscript' },
  rename: { id: 'rename-everywhere', name: 'Rename everywhere' },
} as const;

export const REVISION_RIBBON_TITLE = 'Open Spellbook revision notes';
export const ADD_NOTE_TITLE = 'Add revision note';
export const NOT_AN_ENTITY_TEXT = 'Open the note of a World entity first, or use "Rename everywhere" in its menu in the World browser.';
export const COULD_NOT_OPEN_TEXT = 'The revision notes could not be opened.';

const PROBLEM_NOTICE_MS = 10000;

/** An editor and the note it shows, as Obsidian hands them to a command or a menu. */
interface EditorAt {
  readonly editor: Editor;
  readonly path: string | null;
}

/**
 * Brings the Revision pane onto the screen, in the right sidebar, beside the
 * scene it is about. A pane that is already open is brought to the front.
 */
export class RevisionPane {
  private released = false;
  private arriving: Promise<WorkspaceLeaf | null> | null = null;

  constructor(private readonly app: App) {}

  release(): void {
    this.released = true;
    this.arriving = null;
  }

  reveal(): Promise<WorkspaceLeaf | null> {
    if (this.released) return Promise.resolve(null);
    if (!this.arriving) {
      const arriving = this.bring().finally(() => {
        if (this.arriving === arriving) this.arriving = null;
      });
      this.arriving = arriving;
    }
    return this.arriving;
  }

  private async bring(): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;
    try {
      let leaf = workspace.getLeavesOfType(REVISION_VIEW_TYPE)[0] ?? null;
      if (!leaf) {
        leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf('tab');
        await leaf.setViewState({ type: REVISION_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
      return leaf;
    } catch (error) {
      console.error('Spellbook: the revision notes could not be opened', error);
      new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
      return null;
    }
  }
}

export const revisionFeature: Feature = {
  id: 'revision',
  register(context: FeatureContext): void {
    const { app, plugin } = context;
    // The notes of every project, kept in one file per project; renamed scenes take their notes along.
    const book = new RevisionNotesBook(context, { keep: true });
    book.start();
    const keeper = new RevisionKeeper(context, book);
    const pane = new RevisionPane(app);
    context.onUnload(() => {
      pane.release();
      keeper.dispose();
      book.dispose();
    });

    const openFind = (start = ''): void => {
      if (keeper.isDisposed) return;
      if (!context.store.project) {
        new Notice(NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
        return;
      }
      new FindReplaceModal(app, keeper, start).open();
    };
    const openRename = (entityPath: string): void => {
      if (keeper.isDisposed) return;
      if (keeper.entity(entityPath) === null) {
        new Notice(NOT_AN_ENTITY_TEXT, PROBLEM_NOTICE_MS);
        return;
      }
      new RenameEverywhereModal(app, keeper, entityPath).open();
    };

    /** Ask for a note on the words selected in an editor. */
    const addNote = (at: EditorAt): void => {
      if (keeper.isDisposed) return;
      if (!context.store.project) {
        new Notice(NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
        return;
      }
      const scene = at.path === null ? null : keeper.sceneAtVault(at.path);
      if (!scene) {
        new Notice(NO_SCENE_TEXT, PROBLEM_NOTICE_MS);
        return;
      }
      const selection = at.editor.getSelection();
      // Words in the properties at the top are no passage of the scene.
      const start = at.editor.posToOffset(at.editor.getCursor('from'));
      const inBody = start >= splitBody(at.editor.getValue()).head.length;
      if (selection.trim() === '' || !inBody) {
        new Notice(NO_SELECTION_TEXT, PROBLEM_NOTICE_MS);
        return;
      }
      new NoteModal(app, {
        title: ADD_NOTE_TITLE,
        passage: selection.trim(),
        confirm: 'Add note',
        submit: (words) => keeper.addNote(scene.path, selection, words),
      }).open();
    };

    /** The editor in front, and the note it shows. */
    const activeEditor = (): EditorAt | null => {
      const active = (app.workspace as { activeEditor?: { editor?: Editor; file?: { path: string } | null } | null }).activeEditor;
      if (!active?.editor) return null;
      return { editor: active.editor, path: active.file?.path ?? null };
    };

    // The underlined passages: in the notes of Spellbook projects, and nowhere else.
    const editorHost = {
      covers: (path: string | null) => keeper.inAnyProject(path),
      notesOf: (path: string) => book.notesAtVaultPath(path),
      onNotesChange: (listener: () => void) => book.onChange(listener),
      touch: Platform.isMobile,
      setTimer: (callback: () => void, ms: number) => context.clock.setTimer(callback, ms),
    };
    const pluginWithEditor: { registerEditorExtension?: unknown } = plugin;
    if (typeof pluginWithEditor.registerEditorExtension === 'function') plugin.registerEditorExtension([revisionEditor(editorHost)]);

    // For the World browser: "Rename everywhere" in an entity's menu.
    const renameService: RenameEverywhereService = { open: (entityPath) => openRename(entityPath) };
    context.services.provide(RENAME_EVERYWHERE_SERVICE, renameService);

    plugin.registerView(REVISION_VIEW_TYPE, (leaf) => createRevisionView(leaf, keeper, context.clock, { openFind: () => openFind() }));
    plugin.addRibbonIcon(revisionIcon(), REVISION_RIBBON_TITLE, () => {
      void pane.reveal();
    });
    plugin.addCommand({
      ...REVISION_COMMANDS.addNote,
      callback: () => {
        const at = activeEditor();
        if (!at) new Notice(NO_SCENE_TEXT, PROBLEM_NOTICE_MS);
        else addNote(at);
      },
    });
    plugin.addCommand({
      ...REVISION_COMMANDS.open,
      callback: () => {
        void pane.reveal();
      },
    });
    plugin.addCommand({
      ...REVISION_COMMANDS.find,
      callback: () => {
        const selected = activeEditor()?.editor.getSelection() ?? '';
        // Words selected on one line are what is looked for.
        openFind(selected.includes('\n') ? '' : selected.trim());
      },
    });
    plugin.addCommand({
      ...REVISION_COMMANDS.rename,
      callback: () => {
        const project = context.store.project;
        const open = app.workspace.getActiveFile();
        const rel = project && open ? relativeTo(project.folder, open.path) : null;
        const entity = rel === null ? null : keeper.entity(rel);
        if (!entity) new Notice(project ? NOT_AN_ENTITY_TEXT : NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
        else openRename(entity.path);
      },
    });

    // The editor's own menu: "Add revision note" on selected words of a scene.
    plugin.registerEvent(
      app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: { file?: { path: string } | null }) => {
        if (keeper.isDisposed || editor.getSelection().trim() === '') return;
        const path = info.file?.path ?? null;
        if (path === null || keeper.sceneAtVault(path) === null) return;
        menu.addItem((item) => {
          item
            .setTitle(ADD_NOTE_TITLE)
            .setIcon(revisionIcon())
            .onClick(() => {
              addNote({ editor, path });
            });
        });
      }),
    );
  },
};
