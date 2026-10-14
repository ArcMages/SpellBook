// Snapshots: saved versions of a scene. "Take snapshot" saves the scene as
// it is now, as a plain note in the project's Snapshots folder; "Snapshots
// of this scene" lists a scene's earlier versions, shows one, compares two
// and restores one. Revising without fear.
//
// This file plugs it into the plugin. It makes the keeper the screens ask
// (keeper.ts, on top of the project store and the vault doorway), registers
// the kind of pane with Obsidian, and adds the two commands and the
// settings. Everything is
// registered through the plugin, so Obsidian takes it away again when the
// plugin is switched off; the keeper is let go of by hand.

import { Notice, Platform } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { TextPromptModal } from '../../ui/textPromptModal';
import type { Feature, FeatureContext } from '../registry';
import { AutomaticSnapshots } from './automatic';
import { NO_PROJECT_TEXT, NO_SCENE_TEXT, SnapshotKeeper } from './keeper';
import type { SceneAt } from './keeper';
import { SnapshotPrefs, snapshotSettings } from './prefs';
import { SNAPSHOTS_VIEW_TYPE, SnapshotsView, TAKEN_TEXT, TAKE_LABEL, TAKE_PLACEHOLDER, TAKE_TEXT, TAKE_TITLE, createSnapshotsView } from './snapshotsView';
import { PROBLEM_NOTICE_MS } from '../../ui/notices';

export { AutomaticSnapshots } from './automatic';
export { SnapshotKeeper } from './keeper';
export type { KeeperChange, Outcome, SceneAt, TakeOptions } from './keeper';
export { SnapshotPrefs, snapshotSettings } from './prefs';
export { RestoreModal } from './restoreModal';
export { SNAPSHOTS_VIEW_NAME, SNAPSHOTS_VIEW_TYPE, SnapshotsView } from './snapshotsView';

/** The commands this feature adds. Obsidian puts the plugin's name in front of their names. */
export const SNAPSHOT_COMMANDS = {
  take: { id: 'take-snapshot', name: 'Take snapshot' },
  open: { id: 'open-snapshots', name: 'Snapshots of this scene' },
} as const;

/** The name the snapshots are offered under to the other screens (see FeatureServices). */
export const SNAPSHOTS_SERVICE = 'snapshots.actions';

/** What the snapshots offer the other screens. Paths are relative to the project folder, as the binder has them. */
export interface SnapshotsService {
  /** Ask for a name and take a snapshot of a scene. Does nothing for a path that is no scene with a note. */
  take(scenePath: string): void;
  /** Show the snapshots of a scene in the Snapshots pane. */
  show(scenePath: string): void;
  /**
   * Take a snapshot of a scene as it is on disk now (what is typed in an open
   * editor is saved first), under the name given, without asking. Resolves
   * with null once it is saved, or with why it was not.
   */
  takeNamed(scenePath: string, name: string): Promise<string | null>;
}

export const COULD_NOT_OPEN_TEXT = 'The snapshots could not be opened.';

const NOTICE_MS = 5000;

/**
 * Brings the snapshots of a scene onto the screen, as a tab in the main area
 * (a comparison needs the room). A pane that is already open anywhere is
 * turned to the scene and brought to the front instead of opening a second.
 */
export class SnapshotsPane {
  private readonly app: App;
  private released = false;
  private arriving: Promise<WorkspaceLeaf | null> | null = null;

  constructor(app: App) {
    this.app = app;
  }

  /** The plugin is being switched off: nothing is opened from here on. */
  release(): void {
    this.released = true;
    this.arriving = null;
  }

  /** Show the snapshots of a scene (a path inside the project). */
  async reveal(scenePath: string): Promise<WorkspaceLeaf | null> {
    if (this.released) return null;
    if (!this.arriving) {
      const arriving = this.bring().finally(() => {
        if (this.arriving === arriving) this.arriving = null;
      });
      this.arriving = arriving;
    }
    const leaf = await this.arriving;
    if (leaf && !this.released && leaf.view instanceof SnapshotsView) leaf.view.showScene(scenePath);
    return leaf;
  }

  private async bring(): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;
    try {
      let leaf = workspace.getLeavesOfType(SNAPSHOTS_VIEW_TYPE)[0] ?? null;
      if (!leaf) {
        leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: SNAPSHOTS_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
      // On a phone the drawers lie over the main area: slide them away so that the pane can be seen.
      if (!this.released && Platform.isPhone && leaf.getRoot() === workspace.rootSplit) {
        workspace.leftSplit.collapse();
        workspace.rightSplit.collapse();
      }
      return leaf;
    } catch (error) {
      console.error('Spellbook: the snapshots could not be opened', error);
      new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
      return null;
    }
  }
}

export const snapshotsFeature: Feature = {
  id: 'snapshots',
  register(context: FeatureContext): void {
    const { app, plugin } = context;
    // Nothing is read from the device's storage, and nothing in the vault is
    // followed, until a pane asks or the automatic snapshots are switched on.
    const prefs = new SnapshotPrefs(context.storage);
    const keeper = new SnapshotKeeper(context);
    const automatic = new AutomaticSnapshots(context, keeper, prefs);
    const pane = new SnapshotsPane(app);
    let asking: TextPromptModal | null = null;
    let released = false;
    context.onUnload(() => {
      released = true;
      asking?.close();
      asking = null;
      pane.release();
      automatic.release();
      keeper.dispose();
      prefs.release();
    });

    /** The scene a command is about, or a notice that says why there is none. */
    const sceneOrNotice = (): SceneAt | null => {
      if (released) return null;
      const scene = keeper.openScene();
      if (!scene) new Notice(context.store.project ? NO_SCENE_TEXT : NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
      return scene;
    };
    const take = (scene: SceneAt): void => {
      asking?.close();
      asking = new TextPromptModal(app, {
        title: TAKE_TITLE,
        label: TAKE_LABEL,
        placeholder: TAKE_PLACEHOLDER,
        confirm: TAKE_TEXT,
        submit: async (value) => {
          const taken = await keeper.take(scene.path, { name: value });
          if (!taken.ok) return taken.message;
          new Notice(TAKEN_TEXT, NOTICE_MS);
          return null;
        },
      });
      asking.open();
    };

    // For the other screens (a scene's menu in the binder, say): looked up by name, when it is needed.
    const service: SnapshotsService = {
      take: (scenePath) => {
        const scene = released ? null : keeper.scene(scenePath);
        if (scene) take(scene);
      },
      show: (scenePath) => {
        const scene = released ? null : keeper.scene(scenePath);
        if (scene) void pane.reveal(scene.path);
      },
      takeNamed: async (scenePath, name) => {
        if (released) return NO_PROJECT_TEXT;
        const taken = await keeper.take(scenePath, { name });
        return taken.ok ? null : taken.message;
      },
    };
    context.services.provide(SNAPSHOTS_SERVICE, service);

    plugin.registerView(SNAPSHOTS_VIEW_TYPE, (leaf) => createSnapshotsView(leaf, keeper, context.clock));
    plugin.addCommand({
      ...SNAPSHOT_COMMANDS.take,
      callback: () => {
        const scene = sceneOrNotice();
        if (scene) take(scene);
      },
    });
    plugin.addCommand({
      ...SNAPSHOT_COMMANDS.open,
      callback: () => {
        const scene = sceneOrNotice();
        if (scene) void pane.reveal(scene.path);
      },
    });
    context.addSettingsSection(snapshotSettings(prefs));
    automatic.start();
  },
};
