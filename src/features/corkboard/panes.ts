// Bringing the corkboard and the inspector onto the screen.
//
// The corkboard opens as a tab in the main area, the inspector in the right
// sidebar. A pane of the kind that is already open anywhere is brought to the
// front instead of opening a second one, however fast it is asked for.

import { Notice, Platform } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import type { BoardScope } from '../../core/cards';
import { CORKBOARD_VIEW_TYPE, CorkboardView } from './corkboardView';
import { INSPECTOR_VIEW_TYPE } from './inspectorView';
import { PROBLEM_NOTICE_MS } from './parts';

export const NO_ROOM_FOR_INSPECTOR =
  'The inspector could not be opened: Obsidian has no room for it in the right sidebar.';

export class CardPanes {
  private readonly app: App;
  private released = false;
  /** The panes being brought to the front, by view type, so that two requests cannot open two. */
  private readonly arriving = new Map<string, Promise<WorkspaceLeaf | null>>();

  constructor(app: App) {
    this.app = app;
  }

  /** The plugin is being switched off: nothing is opened from here on. */
  release(): void {
    this.released = true;
    this.arriving.clear();
  }

  /**
   * Show the corkboard, as a tab in the main area.
   *
   * @param scope the part of the binder to show; left out, the board stays on what it was showing
   */
  async openCorkboard(scope?: BoardScope): Promise<void> {
    const { workspace } = this.app;
    const leaf = await this.bring(CORKBOARD_VIEW_TYPE, 'corkboard', () => workspace.getLeaf('tab'), '');
    if (!leaf || this.released) return;
    // On a phone the drawers lie over the main area: slide them away so that the board can be seen.
    if (Platform.isPhone && leaf.getRoot() === workspace.rootSplit) {
      workspace.leftSplit.collapse();
      workspace.rightSplit.collapse();
    }
    if (scope && leaf.view instanceof CorkboardView) leaf.view.showScope(scope);
  }

  /** Show the inspector, in the right sidebar. */
  async openInspector(): Promise<void> {
    const { workspace } = this.app;
    await this.bring(INSPECTOR_VIEW_TYPE, 'inspector', () => workspace.getRightLeaf(false), NO_ROOM_FOR_INSPECTOR);
  }

  /**
   * Bring a pane of one kind to the front, opening one when there is none.
   *
   * @param what   the pane's name, for a notice
   * @param place  gives a new, empty pane in the right part of the window; null when Obsidian has none to give
   * @param noRoom what to say when it has none
   */
  private bring(
    type: string,
    what: string,
    place: () => WorkspaceLeaf | null,
    noRoom: string,
  ): Promise<WorkspaceLeaf | null> {
    if (this.released) return Promise.resolve(null);
    let arriving = this.arriving.get(type);
    if (!arriving) {
      arriving = this.reveal(type, what, place, noRoom).finally(() => {
        this.arriving.delete(type);
      });
      this.arriving.set(type, arriving);
    }
    return arriving;
  }

  private async reveal(
    type: string,
    what: string,
    place: () => WorkspaceLeaf | null,
    noRoom: string,
  ): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;
    try {
      let leaf = workspace.getLeavesOfType(type)[0] ?? null;
      if (!leaf) {
        leaf = place();
        if (!leaf) {
          new Notice(noRoom, PROBLEM_NOTICE_MS);
          return null;
        }
        await leaf.setViewState({ type, active: true });
      }
      await workspace.revealLeaf(leaf);
      return leaf;
    } catch (error) {
      console.error(`Spellbook: the ${what} could not be opened`, error);
      new Notice(`The ${what} could not be opened.`, PROBLEM_NOTICE_MS);
      return null;
    }
  }
}
