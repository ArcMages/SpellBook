// The two dates of a scene, "created" and "edited", kept up to date.
//
// The engine (src/core/progress/sceneDates.ts) decides everything: this file
// feeds it what happens in the editor and the app, and carries out the writes
// it asks for, through the project store. A write only ever sets those two
// properties, and it only happens when the writer leaves a scene: another
// note opens, its tab closes, the app goes to the background or the plugin
// unloads. Never while typing.

import { placeOfNote } from '../../core/binderModel';
import { pathKey, relativeTo } from '../../core/paths';
import { emptySceneDates, sceneDatePatch, sceneDatesStep } from '../../core/progress/index';
import type { SceneDateWrite, SceneDatesEvent, SceneDatesState } from '../../core/progress/index';
import type { ProjectStore } from '../../core/projectStore';

export class SceneDateKeeper {
  private readonly store: ProjectStore;
  private state: SceneDatesState = emptySceneDates();
  /** The writes that were asked of the store and have not ended yet. */
  private readonly writing = new Set<Promise<void>>();

  constructor(store: ProjectStore) {
    this.store = store;
  }

  /**
   * The writer changed a note in the editor, on `date`. Called for every
   * keystroke, so it does next to nothing: only the first change of a scene
   * on a day is looked at more closely.
   *
   * @returns true when the note is now waiting to have its "edited" date written
   */
  typed(path: string, date: string): boolean {
    if (this.state.waiting.get(path) === date || this.state.written.get(path) === date) return false;
    if (!this.isScene(path)) return false;
    const before = this.state;
    this.state = sceneDatesStep(before, { type: 'typed', path, date }).state;
    return this.state !== before;
  }

  /** Something happened that may mean the writer left a scene. The writes that fall due are asked of the store before this returns. */
  handle(event: Exclude<SceneDatesEvent, { type: 'typed' }>): void {
    const step = sceneDatesStep(this.state, event);
    this.state = step.state;
    for (const write of step.writes) this.start(write);
  }

  /** The scenes typed in and still open are these: every other waiting scene's tab was closed. */
  closedExcept(openPaths: ReadonlySet<string>): void {
    if (this.state.waiting.size === 0) return;
    const open = new Set([...openPaths].map(pathKey));
    for (const path of [...this.state.waiting.keys()]) {
      if (!open.has(pathKey(path))) this.handle({ type: 'closed', path });
    }
  }

  /** Whether any scene is waiting for its date to be written. */
  get hasWaiting(): boolean {
    return this.state.waiting.size > 0;
  }

  /** The day a note was typed in that has not been written into it yet, or null. */
  waitingFor(path: string): string | null {
    const exact = this.state.waiting.get(path);
    if (exact !== undefined) return exact;
    const key = pathKey(path);
    for (const [known, date] of this.state.waiting) {
      if (pathKey(known) === key) return date;
    }
    return null;
  }

  /** Resolves when every write that was started has ended. */
  async idle(): Promise<void> {
    while (this.writing.size > 0) await Promise.all([...this.writing]);
  }

  /** Whether a note is a scene of the open project: one the binder lists, or one in its Manuscript folder. */
  private isScene(path: string): boolean {
    const project = this.store.project;
    if (project === null || project.readOnly) return false;
    const inProject = relativeTo(project.folder, path);
    if (inProject === null) return false;
    const place = placeOfNote(project, inProject);
    return place === 'binder' || place === 'unfiled';
  }

  private start(write: SceneDateWrite): void {
    const run = this.write(write).finally(() => {
      this.writing.delete(run);
    });
    this.writing.add(run);
  }

  /** Set a scene's dates. The store is asked before the first wait, so a write started while unloading is not lost. */
  private async write(write: SceneDateWrite): Promise<void> {
    let done = false;
    try {
      const project = this.store.project;
      const inProject = project === null || project.readOnly ? null : relativeTo(project.folder, write.path);
      if (project !== null && inProject !== null) {
        const fileCreated = this.store.noteCreatedDay(inProject);
        const result = await this.store.updateNoteProperties(
          inProject,
          (frontmatter) => {
            const patch = sceneDatePatch(frontmatter, { edited: write.edited, fileCreated });
            if (patch.created === undefined && patch.edited === undefined) return false;
            if (patch.created !== undefined) frontmatter['created'] = patch.created;
            if (patch.edited !== undefined) frontmatter['edited'] = patch.edited;
            return true;
          },
          project.indexPath,
        );
        // A note that is gone needs no date; anything else that did not work is tried again.
        done = result.status === 'done' || result.status === 'noop' || (result.status === 'refused' && result.reason === 'missing-file');
      }
    } catch (error) {
      console.error('Spellbook: a scene\'s dates could not be saved', error);
    }
    // Asked for again when the writer next leaves the scene.
    if (!done) this.state = sceneDatesStep(this.state, { type: 'failed', path: write.path, edited: write.edited }).state;
  }
}
