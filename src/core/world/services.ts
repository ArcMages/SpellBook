// What the world-building screen offers the other screens of the plugin, and
// under which name.
//
// The inspector shows who and what is in the open scene. It does not know
// the world-building screen: it looks this service up by name at the moment
// it needs it (see FeatureServices in src/features/registry.ts) and shows
// what it is handed. The name and the shape are written down here, once, for
// the screen that offers them and the screen that uses them.

import type { CardColor } from '../cards/colors';

/** The name the service is offered under. */
export const SCENE_ENTITIES_SERVICE = 'world.sceneEntities';

/** One entity a scene lists, as a chip to show. */
export interface SceneEntityChip {
  /** The entry as it is written in the scene's "entities" property: what the chip is removed by. */
  readonly key: string;
  /** The entity's name, or what the link says when it leads to no entity. The writer's own text. */
  readonly name: string;
  /** What its type is called ("Character"); "" when it has none. */
  readonly typeName: string;
  /** Its type's colour; null for none. */
  readonly color: CardColor | null;
  /** Its type's icon, by its name in Obsidian's icon set; null for none. */
  readonly icon: string | null;
  /** False for a link that leads to no entity of the project: it can be removed, not opened. */
  readonly found: boolean;
}

/** Who and what is in a scene, and the ways to change that. */
export interface SceneEntitiesService {
  /**
   * The entities a scene lists, in the order they are written. Cheap enough
   * to call whenever the inspector draws.
   *
   * @param scenePath the scene's path relative to the project folder
   */
  of(scenePath: string): readonly SceneEntityChip[];
  /** False when nothing can be added or removed (no project is open, or it is read-only). */
  canChange(): boolean;
  /** Open the window that adds an entity to a scene: a list to search, which can also make a new one. */
  add(scenePath: string): void;
  /** Take an entry out of a scene's list. Resolves with null when done, or with why it was not. */
  remove(scenePath: string, key: string): Promise<string | null>;
  /** Show the entity's note. Does nothing for a link that leads to no entity. */
  open(scenePath: string, key: string): void;
  /** Be told when what `of` gives may have changed. Returns the function that stops it. */
  onChange(listener: () => void): () => void;
}

// ------------------------------------------------------------------- time
//
// Two more services join the World browser and the timeline, which do not
// know each other either: the timeline shows an entity's sheet through the
// first, and the World browser opens the world's history through the second.

/** The name the World browser offers its sheets under. */
export const ENTITY_SHEET_SERVICE = 'world.entitySheet';

/** Shows an entity's sheet in the World browser. */
export interface EntitySheetService {
  /**
   * Bring the World browser to the front with the sheet of one entity.
   *
   * @param entityPath the entity's note, relative to the project folder
   */
  show(entityPath: string): void;
}

/** The name the timeline offers the world's history under. */
export const WORLD_HISTORY_SERVICE = 'timeline.worldHistory';

/** Opens the timeline as the history of the world. */
export interface WorldHistoryService {
  /** Bring the timeline to the front with the world lanes on and the scenes' lane off, fitted to the world's dates. */
  show(): void;
}
