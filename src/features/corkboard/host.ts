// What the corkboard, the inspector and the statuses-and-labels window need
// from the plugin.
//
// These screens draw and ask; they never read or write a note themselves and
// they do not know the project store. Everything they show comes from a host
// object, and everything they change is asked of it. The plugin implements
// the host on top of the project store; the tests use a fake one.
//
// All scene paths are relative to the project folder, with forward slashes
// ("Manuscript/Opening.md"), exactly as in the project snapshot's tree.

import type { PaneType } from 'obsidian';
import type {
  CardLists,
  CardMove,
  CardSize,
  FrontmatterPatch,
  SceneData,
  ScenePatch,
  SceneProperties,
  TagKind,
} from '../../core/cards';
import type { TreeNode } from '../../core/types';
import type { DragClock } from '../../ui/dragDrop';

/** Call it to stop being told about changes. */
export type Unsubscribe = () => void;

/**
 * What the host answers when it was asked to change something: null when it
 * was done, otherwise one plain sentence, fit to show to the writer, saying
 * why it was not.
 */
export type HostAnswer = Promise<string | null>;

/** The open project, as far as these screens need it. */
export interface CardsProject {
  /** Tells one project from another: the vault path of its index note. */
  readonly id: string;
  /** True when the project's index could not be understood. Nothing can be changed then. */
  readonly readOnly: boolean;
  /** The binder tree: `snapshot.tree` of the project store. */
  readonly tree: readonly TreeNode[];
  /**
   * The project's statuses and labels: `readTagLists(...)` of the index
   * note's properties. Hand out the same object until a list really changes;
   * a new object makes every card be worked out again.
   */
  readonly lists: CardLists;
}

/** What a listener is told. It then reads the host again. */
export type CardsChange =
  /**
   * Anything about the project as a whole: it was opened or closed, another
   * one was opened, its binder tree changed, its statuses or labels changed,
   * it became read-only, or `ready` turned true.
   */
  | { readonly type: 'project' }
  /** The properties, the text or the word count of these scenes changed. */
  | { readonly type: 'scenes'; readonly paths: readonly string[] }
  /** Another note is being worked on in the editor: `activeScenePath` changed. */
  | { readonly type: 'active' }
  /** The card size remembered on this device changed (from another corkboard). */
  | { readonly type: 'cardSize' };

/** A changed list of statuses or labels, to be stored by the host. */
export interface TagListChange {
  /** Which list: 'status' or 'label'. */
  readonly kind: TagKind;
  /** The key of the project index to store under: "statuses" or "labels". */
  readonly key: string;
  /** The whole new value for that key. Store it exactly so. */
  readonly value: readonly unknown[];
  /**
   * The scenes whose properties must change too, each with its patch. Only a
   * rename has any. They were worked out from `sceneProperties()`.
   */
  readonly scenePatches: readonly ScenePatch[];
  /**
   * Set for a rename: the old name and the new one. With it the host can work
   * each scene's patch out again from the scene as it is on disk at the moment
   * of writing (the engine's `renameTagInScene`), instead of using
   * `scenePatches`.
   */
  readonly rename: { readonly from: string; readonly to: string } | null;
}

/** What all three screens need. */
export interface CardsHost {
  /**
   * False until Obsidian has finished starting up and the plugin's services
   * exist; the screens then say that Spellbook is still starting. Tell the
   * listeners with a 'project' change when it turns true.
   */
  readonly ready: boolean;
  /** The open project; null when none is open. */
  readonly project: CardsProject | null;
  /**
   * The note being worked on in the editor, when it is a scene of the open
   * project: its path relative to the project folder. Null otherwise. With no
   * note in front (a graph, say) it stays the scene that was worked on last.
   */
  readonly activeScenePath: string | null;
  /** The timers the screens run on (the same object the binder is given). Handed in so that tests can keep the time. */
  readonly clock: DragClock;
  /**
   * What is known about one scene: its properties, its word count, and its
   * whole text. The text is only needed for a scene without a synopsis of its
   * own (the engine's `hasSynopsis`), and may be left out until it has been
   * read; report it with a 'scenes' change when it has. Hand out a new
   * `frontmatter` object when a scene's properties change, never the old one
   * changed in place. Must be cheap: it is called for every scene on show.
   */
  sceneData(path: string): SceneData | null | undefined;
  /**
   * Every scene of the project with its properties as they are now. Used by
   * the statuses-and-labels window to rename a status across scenes, and to
   * say how many scenes use one.
   */
  sceneProperties(): readonly SceneProperties[];
  /** Be told when something changed. Returns the function that stops it. */
  onChange(listener: (change: CardsChange) => void): Unsubscribe;
  /**
   * Change one scene's properties: set and remove exactly the keys the patch
   * names, inside the usual read-change-save step, and touch no other key.
   * Report the scene with a 'scenes' change afterwards.
   */
  applyScenePatch(path: string, patch: FrontmatterPatch): HostAnswer;
  /**
   * Store a changed list of statuses or labels in the project index, and
   * apply the patches a rename needs to the scenes. Report it with a
   * 'project' change (and a 'scenes' change for the patched scenes).
   */
  saveTagList(change: TagListChange): HostAnswer;
}

/** What the corkboard needs. */
export interface CorkboardHost extends CardsHost {
  /** The card size remembered on this device. */
  readonly cardSize: CardSize;
  /** Remember another card size on this device, and tell the listeners with a 'cardSize' change. */
  setCardSize(size: CardSize): void;
  /**
   * Show a scene's note. `where` is what Obsidian's `Keymap.isModEvent` gives:
   * false for the usual place, 'tab' (or true) for a new tab, 'split' or
   * 'window'.
   */
  openScene(path: string, where: PaneType | boolean): unknown;
  /** Move a binder node: `store.moveNode(move.ref, move.placement)`. Report it with a 'project' change. */
  moveCard(move: CardMove): HostAnswer;
  /**
   * The board says which scenes it shows as cards now, in order, so that
   * their text and word counts can be read first (or only). Called again
   * whenever that changes, and with an empty list when the board closes.
   *
   * @param watcher tells one open board from another
   */
  watchScenes(watcher: object, paths: readonly string[]): void;
}

/** The "In this scene" part of the inspector (sceneEntities.ts), as the inspector holds it. */
export interface SceneEntitiesPart {
  /** Draw the part again: the inspector shows another scene, or none. */
  refresh(): void;
  /** The inspector closes. */
  stop(): void;
}

/** What the inspector needs. */
export interface InspectorHost extends CardsHost {
  /**
   * Optional. Called once when the inspector opens, with the empty element at
   * its top, for another feature to put a summary line in. What it returns,
   * if anything, is called when the inspector closes.
   */
  mountSummary?(slot: HTMLElement): (() => void) | void;
  /**
   * Optional. Called once when the inspector opens, with an empty element
   * under the scene's dates, for the entities in the scene (see
   * sceneEntities.ts). `scenePath` gives the scene the inspector shows at
   * that moment, or null.
   */
  mountEntities?(slot: HTMLElement, scenePath: () => string | null): SceneEntitiesPart | null;
}
