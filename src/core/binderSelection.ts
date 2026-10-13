// Which row of the binder is selected.
//
// The selected row is the one the writer last worked with: tapped, opened a
// menu on, or changed through a command. "New scene" puts its scene below it,
// and after every action the row that was acted on becomes the selected one
// and is brought into view.
//
// This is kept outside the panel, so that a command can select a row while
// the panel is closed or still drawing: the panel shows the selection when it
// next can. It is not saved anywhere; it lasts until Obsidian closes.

import { sameRef } from './binderTree';
import type { NodeRef } from './types';

export interface SelectOptions {
  /** Also ask the panel to unfold what the row sits in and scroll it into view. */
  readonly reveal?: boolean;
}

export class BinderSelection {
  private project: string | null = null;
  private ref: NodeRef | null = null;
  private reveals = 0;
  private readonly listeners = new Set<() => void>();

  /**
   * The selected row of a project: a note by its path relative to the project
   * folder (kind "scene", also for notes outside the binder), or a binder
   * folder by its id. Null when nothing in that project is selected.
   *
   * @param indexPath the index path of the project being shown
   */
  currentIn(indexPath: string): NodeRef | null {
    return this.project === indexPath ? this.ref : null;
  }

  /** Goes up by one each time someone asks for the selected row to be brought into view. */
  get revealCount(): number {
    return this.reveals;
  }

  /**
   * Select a row of a project, or nothing (null). A selection always belongs
   * to one project, so it cannot be mistaken for a row of another one that
   * happens to have a note at the same path.
   */
  select(indexPath: string, ref: NodeRef | null, options: SelectOptions = {}): void {
    const before = this.currentIn(indexPath);
    const same = this.project === indexPath && (ref === null ? before === null : before !== null && sameRef(before, ref));
    const reveal = options.reveal === true && ref !== null;
    if (same && !reveal) return;
    this.project = indexPath;
    this.ref = ref;
    if (reveal) this.reveals++;
    this.announce();
  }

  /** Forget the selection if it is this row (after the row was deleted, say). */
  drop(indexPath: string, ref: NodeRef): void {
    const current = this.currentIn(indexPath);
    if (current !== null && sameRef(current, ref)) this.select(indexPath, null);
  }

  /**
   * A project is at another path now (its index note or its folder was
   * renamed or moved): a selection in it stays with it. Rows are known by
   * paths inside the project folder and by folder ids, which such a move
   * does not change. Nobody is told: the same row is still the selected one.
   */
  moveProject(from: string, to: string): void {
    if (this.project === from) this.project = to;
  }

  /** Be told when the selection changes or is to be brought into view. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.listeners.clear();
    this.project = null;
    this.ref = null;
  }

  private announce(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Spellbook: a listener failed', error);
      }
    }
  }
}
