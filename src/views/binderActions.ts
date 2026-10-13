// What the binder's buttons, menus and commands do.
//
// Every change goes through the project store as an intent (add, rename,
// move, remove); nothing here touches a note itself. Each action is started
// for one project, named by its index path, and the store refuses it if
// another project has been opened by the time its turn comes: a menu or a
// confirmation window can stay open for a while, and must never end up
// changing a different project from the one it was made for.
//
// After an action the row it was about becomes the selected row and is
// brought into view (see src/core/binderSelection.ts).

import { Notice } from 'obsidian';
import type { App, PaneType } from 'obsidian';
import {
  findNode,
  folderChoices,
  nodeTitle,
  placementForNewFolder,
  placementForNewScene,
  sceneCount,
} from '../core/binderModel';
import { folderRef, sceneRef } from '../core/binderTree';
import type { StepDirection } from '../core/binderTree';
import { checkFolderName, checkSceneName, tidyDisplayName } from '../core/names';
import { noteTitle } from '../core/paths';
import type { IntentResult, NodeRef, Placement, ProjectSnapshot } from '../core/types';
import { ConfirmModal } from '../ui/confirmModal';
import { FolderPickerModal } from '../ui/folderPickerModal';
import { TextPromptModal } from '../ui/textPromptModal';
import type { BinderServices } from './binderView';

/** Shown on a binder entry whose note is not in the vault. */
export const MISSING_LABEL = 'File not found (it may still be syncing)';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

const NOT_STARTED = 'Spellbook is still starting. Try again in a moment.';
const OTHER_PROJECT = 'That project is no longer the open one. Nothing was changed.';
const READ_ONLY = 'This project is read-only because its index could not be understood. Nothing was changed.';

/** What the actions need from the plugin. */
export interface ActionsHost {
  readonly app: App;
  /** Null until Obsidian has finished starting up, and again after the plugin is switched off. */
  readonly services: BinderServices | null;
  /** Show the note at a vault path. Resolves with false when it could not be shown. */
  openNote(path: string, where: PaneType | boolean): Promise<boolean>;
}

/** The open project and the services, checked at the start of an action. */
interface Scope {
  readonly services: BinderServices;
  readonly project: ProjectSnapshot;
}

export class BinderActions {
  private readonly host: ActionsHost;
  private readonly openedListeners = new Set<() => void>();
  /** True while conflicting copies are being merged. */
  private merging = false;

  constructor(host: ActionsHost) {
    this.host = host;
  }

  /** Be told when one of the actions has opened a note. Returns a function that stops it. */
  onNoteOpened(listener: () => void): () => void {
    this.openedListeners.add(listener);
    return () => {
      this.openedListeners.delete(listener);
    };
  }

  // ----------------------------------------------------------------- opening

  /**
   * Show a note of the project.
   *
   * @param path  the note's path relative to the project folder
   * @param where false for the tab the writer was last working in, 'tab' for a new one
   * @returns whether the note is on show now
   */
  async openNote(inProject: string, path: string, where: PaneType | boolean): Promise<boolean> {
    const scope = this.scope(inProject);
    if (!scope) return false;
    const title = noteTitle(path);
    const vaultPath = scope.services.store.vaultPathOf(path);
    if (vaultPath === null) {
      new Notice(`"${title}": ${MISSING_LABEL}.`);
      return false;
    }
    let shown = false;
    try {
      shown = await this.host.openNote(vaultPath, where);
    } catch {
      shown = false;
    }
    if (!shown) {
      new Notice(`"${title}" could not be opened.`);
      return false;
    }
    for (const listener of [...this.openedListeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Spellbook: a listener failed', error);
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- creating

  /** Ask for a name, create a scene at `placement`, select it and open it for writing. */
  newScene(inProject: string, placement: Placement): void {
    if (!this.writable(inProject)) return;
    new TextPromptModal(this.host.app, {
      title: 'New scene',
      label: 'Name of the scene',
      placeholder: 'Name of the scene',
      confirm: 'Create',
      submit: async (typed) => {
        const name = checkSceneName(typed);
        if (!name.ok) return name.message;
        const store = this.host.services?.store;
        if (!store) return NOT_STARTED;
        const result = await store.addScene(name.name, placement, inProject);
        if (!this.report(result)) return null;
        const path = result.value.path;
        this.sayNameIfChanged('scene', typed, noteTitle(path));
        this.select(inProject, sceneRef(path));
        void this.openNote(inProject, path, false);
        return null;
      },
    }).open();
  }

  /** Ask for a name, add a binder folder at `placement` and select it. */
  newFolder(inProject: string, placement: Placement): void {
    if (!this.writable(inProject)) return;
    new TextPromptModal(this.host.app, {
      title: 'New folder',
      label: 'Name of the folder',
      placeholder: 'Name of the folder',
      confirm: 'Create',
      submit: async (typed) => {
        const name = checkFolderName(typed);
        if (!name.ok) return name.message;
        const store = this.host.services?.store;
        if (!store) return NOT_STARTED;
        const result = await store.addFolder(name.name, placement, inProject);
        if (!this.report(result)) return null;
        this.select(inProject, folderRef(result.value.id));
        return null;
      },
    }).open();
  }

  /**
   * "New scene" where no place was pointed at (the toolbar, a command): below
   * `chosen`, or inside it when it is a folder. When `chosen` is null or not
   * in the binder, the scene goes to the end of the binder.
   */
  newSceneNear(inProject: string, chosen: NodeRef | null): void {
    const scope = this.writable(inProject);
    if (scope) this.newScene(inProject, placementForNewScene(scope.project.tree, chosen));
  }

  /**
   * "New folder" where no place was pointed at: straight below `chosen`, at
   * the same level, or at the end of the binder.
   */
  newFolderNear(inProject: string, chosen: NodeRef | null): void {
    const scope = this.writable(inProject);
    if (scope) this.newFolder(inProject, placementForNewFolder(scope.project.tree, chosen));
  }

  // ---------------------------------------------------------------- renaming

  /** Ask for a new name for a scene. Its note is renamed; links to it keep working. */
  renameScene(inProject: string, path: string): void {
    if (!this.writable(inProject)) return;
    const current = noteTitle(path);
    new TextPromptModal(this.host.app, {
      title: 'Rename scene',
      label: 'Name of the scene',
      value: current,
      confirm: 'Rename',
      submit: async (typed) => {
        const name = checkSceneName(typed);
        if (!name.ok) return name.message;
        if (name.name === current) return null; // nothing was changed: the same as Cancel
        const store = this.host.services?.store;
        if (!store) return NOT_STARTED;
        const result = await store.renameScene(path, name.name, inProject);
        if (result.status === 'noop' && result.reason === 'unchanged') return null;
        if (!this.report(result)) return null;
        this.sayNameIfChanged('scene', typed, noteTitle(result.value.path));
        this.select(inProject, sceneRef(result.value.path));
        return null;
      },
    }).open();
  }

  /** Ask for a new name for a binder folder. */
  renameFolder(inProject: string, id: string): void {
    const scope = this.writable(inProject);
    if (!scope) return;
    const node = findNode(scope.project.tree, folderRef(id));
    const current = node?.kind === 'folder' ? node.name : '';
    new TextPromptModal(this.host.app, {
      title: 'Rename folder',
      label: 'Name of the folder',
      value: current,
      confirm: 'Rename',
      submit: async (typed) => {
        const name = checkFolderName(typed);
        if (!name.ok) return name.message;
        if (name.name === current) return null;
        const store = this.host.services?.store;
        if (!store) return NOT_STARTED;
        const result = await store.renameFolder(id, name.name, inProject);
        if (result.status === 'noop' && result.reason === 'unchanged') return null;
        if (!this.report(result)) return null;
        this.select(inProject, folderRef(id));
        return null;
      },
    }).open();
  }

  // ------------------------------------------------------------------ moving

  /** Move a scene or a folder one step up or down. */
  async step(inProject: string, ref: NodeRef, direction: StepDirection): Promise<void> {
    const scope = this.writable(inProject);
    if (!scope) return;
    const result = await scope.services.store.stepNode(ref, direction, inProject);
    const stayed = result.status === 'noop' && result.reason === 'unchanged';
    if (this.report(result) || stayed) this.select(inProject, ref);
  }

  /** Let the writer pick a folder (or the top level) and move a scene or a folder to its end. */
  moveToFolder(inProject: string, ref: NodeRef): void {
    const scope = this.writable(inProject);
    if (!scope) return;
    const node = findNode(scope.project.tree, ref);
    const choices = folderChoices(scope.project.tree, ref);
    if (!node || choices.length === 0) {
      new Notice('That item is no longer in the binder.');
      return;
    }
    new FolderPickerModal(this.host.app, `Move "${nodeTitle(node)}" to...`, choices, (choice) => {
      void this.moveInto(inProject, ref, choice.parentId);
    }).open();
  }

  private async moveInto(inProject: string, ref: NodeRef, parentId: string | null): Promise<void> {
    const scope = this.writable(inProject);
    if (!scope) return;
    const result = await scope.services.store.moveNode(ref, { at: 'end', parentId }, inProject);
    const stayed = result.status === 'noop' && result.reason === 'unchanged';
    if (this.report(result) || stayed) this.select(inProject, ref);
  }

  /**
   * A scene or a folder was dragged to a place in the binder: move it there
   * (with everything in it). One change of the index; no file is moved.
   */
  async moveTo(inProject: string, ref: NodeRef, placement: Placement): Promise<void> {
    const scope = this.writable(inProject);
    if (!scope) return;
    const result = await scope.services.store.moveNode(ref, placement, inProject);
    // Dropped where it already was: nothing to say.
    if (result.status === 'noop' && result.reason === 'unchanged') {
      this.select(inProject, ref);
      return;
    }
    if (this.report(result)) this.select(inProject, ref);
  }

  // ---------------------------------------------------------------- removing

  /** Ask first, then take a scene out of the binder and move its note to the trash. */
  deleteScene(inProject: string, path: string): void {
    if (!this.writable(inProject)) return;
    const title = noteTitle(path);
    new ConfirmModal(this.host.app, {
      title: `Delete "${title}"?`,
      message:
        'The scene is taken out of the binder and its note is moved to the trash ' +
        '(where deleted notes go is set in Obsidian, under Settings, Files and links, Deleted files).',
      confirm: 'Delete',
      onConfirm: () => {
        void this.deleteConfirmed(inProject, path, title);
      },
    }).open();
  }

  private async deleteConfirmed(inProject: string, path: string, title: string): Promise<void> {
    const scope = this.writable(inProject);
    if (!scope) return;
    const result = await scope.services.store.deleteScene(path, inProject);
    if (!this.report(result)) return;
    scope.services.selection.drop(inProject, sceneRef(path));
    // Only say that a note went to the trash when one did: the note may have
    // been deleted or moved out of the project while the question was open.
    new Notice(
      result.value.trashed
        ? `Moved "${title}" to the trash.`
        : `Removed "${title}" from the binder. Its note was no longer in the project, so nothing was moved to the trash.`,
    );
  }

  /** Remove a binder folder. Its scenes stay: they move up to where the folder was. */
  async removeFolder(inProject: string, id: string): Promise<void> {
    const scope = this.writable(inProject);
    if (!scope) return;
    const node = findNode(scope.project.tree, folderRef(id));
    const result = await scope.services.store.removeFolder(id, inProject);
    if (!this.report(result)) return;
    scope.services.selection.drop(inProject, folderRef(id));
    if (!node) return;
    const scenes = sceneCount(node);
    const kept = scenes === 0 ? '' : scenes === 1 ? ' Its scene was kept.' : ` Its ${scenes} scenes were kept.`;
    new Notice(`Removed the folder "${nodeTitle(node)}".${kept}`);
  }

  /** Take an entry whose note does not exist out of the binder. No file is touched. */
  async removeMissing(inProject: string, path: string): Promise<void> {
    const scope = this.writable(inProject);
    if (!scope) return;
    const result = await scope.services.store.removeMissingEntry(path, inProject);
    if (this.report(result)) scope.services.selection.drop(inProject, sceneRef(path));
  }

  /** Put an unfiled manuscript note into the binder, at the end of the top level. */
  addUnfiled(inProject: string, path: string): Promise<void> {
    return this.fileUnfiledAt(inProject, path, { at: 'end', parentId: null });
  }

  /** Put an unfiled manuscript note into the binder at a place (where it was dragged to). */
  async fileUnfiledAt(inProject: string, path: string, placement: Placement): Promise<void> {
    const scope = this.writable(inProject);
    if (!scope) return;
    const result = await scope.services.store.addUnfiledToBinder(path, placement, inProject);
    const there = result.status === 'noop' && result.reason === 'already-in-binder';
    if (this.report(result) || there) this.select(inProject, sceneRef(path));
  }

  // ------------------------------------------------------- conflicting copies

  /**
   * Merge conflicting copies of the project's index into it, one after the
   * other: what only a copy lists is added at the end of the binder, and the
   * copy goes to the trash. Says what came of each.
   *
   * @param copies the vault paths of the copies, as the project's snapshot gives them
   */
  async mergeCopies(inProject: string, copies: readonly string[]): Promise<void> {
    // A second tap while the first is still at work would only find the copy gone.
    if (this.merging) return;
    const scope = this.writable(inProject);
    if (!scope) return;
    this.merging = true;
    try {
      for (const copy of copies) {
        const result = await scope.services.store.mergeConflictCopy(copy, inProject);
        if (!this.report(result)) {
          if (result.status === 'noop') continue;
          return;
        }
        const name = noteTitle(copy);
        const added = result.value.added.length;
        const what =
          added === 0
            ? 'it listed nothing that the binder did not have'
            : `${added === 1 ? '1 scene was' : `${added} scenes were`} added at the end of the manuscript`;
        // Only the binder is merged. Notes written into the copy itself are not lost, but they are in the trash now.
        const text = result.value.textDiffers
          ? " Its own text was not the same as the index note's: if you wrote notes there, you will find them in the trash."
          : '';
        // Nor is the title: the two versions may not have agreed about it.
        const title =
          result.value.otherTitle === null
            ? ''
            : ` The copy was titled "${result.value.otherTitle}"; the project keeps its own title.`;
        new Notice(
          `Merged the copy "${name}": ${what}. The copy was moved to the trash.${text}${title}`,
          PROBLEM_NOTICE_MS,
        );
      }
    } finally {
      this.merging = false;
    }
  }

  // ----------------------------------------------------------------- helpers

  /** Make a row the selected one and ask the panel to bring it into view. */
  select(inProject: string, ref: NodeRef): void {
    this.host.services?.selection.select(inProject, ref, { reveal: true });
  }

  /** The services and the open project, when `inProject` is still the open project. Says why not otherwise. */
  private scope(inProject: string): Scope | null {
    const services = this.host.services;
    if (!services) {
      new Notice(NOT_STARTED);
      return null;
    }
    const project = services.store.project;
    if (!project || project.indexPath !== inProject) {
      new Notice(OTHER_PROJECT, PROBLEM_NOTICE_MS);
      return null;
    }
    return { services, project };
  }

  /** As scope(), for an action that changes the project: a read-only project is turned down too. */
  private writable(inProject: string): Scope | null {
    const scope = this.scope(inProject);
    if (scope?.project.readOnly) {
      new Notice(READ_ONLY, PROBLEM_NOTICE_MS);
      return null;
    }
    return scope;
  }

  /**
   * Tell the writer how an intent went, when there is something to tell.
   *
   * @returns true when the intent was carried out
   */
  private report<T>(result: IntentResult<T>): result is Extract<IntentResult<T>, { status: 'done' }> {
    if (result.status === 'done') {
      if (result.warning !== undefined) new Notice(result.warning, PROBLEM_NOTICE_MS);
      return true;
    }
    if (result.message !== '') {
      new Notice(result.message, result.status === 'noop' ? undefined : PROBLEM_NOTICE_MS);
    }
    return false;
  }

  /** A name that had to be changed (characters taken out, a number added) is said out loud. */
  private sayNameIfChanged(what: string, typed: string, given: string): void {
    // Compared in one Unicode form, so that a name that only looks the same is not announced.
    if (tidyDisplayName(typed).normalize('NFC') === given.normalize('NFC')) return;
    new Notice(`The ${what} was named "${given}".`);
  }
}
