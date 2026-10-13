// What a new project starts with: its first scenes, binder folders and notes.
//
// A "seed" is a plain description (titles and text, no paths). The project
// store creates the empty project and then calls plantSeed(), which creates
// the notes and returns the binder that lists them. Everything here only ever
// creates new notes inside a project folder that was itself just created; it
// never changes or replaces an existing file.

import { DEFAULT_NAME, newFolderId, sanitiseFileName, tidyDisplayName, uniqueName } from './names';
import { ORDER_STEP } from './orderKeys';
import { clashKey, joinPath, relativeTo } from './paths';
import { MANUSCRIPT_FOLDER, RESEARCH_FOLDER, TIMELINE_FOLDER, WORLD_FOLDER } from './projectLayout';
import { DEFAULT_SCENE_NAME, newSceneFrontmatter } from './scene';
import type { Binder, BinderNode, Frontmatter } from './types';
import type { VaultPort } from './vaultPort';
import { ENTITIES_KEY } from './world/types';

/** A scene to create. Its file name is made from the title. */
export interface SceneSeed {
  readonly title: string;
  /** The scene's text. Default: empty. */
  readonly body?: string;
  readonly synopsis?: string;
  readonly status?: string;
  readonly label?: string;
  /** How many words the scene should come to: a whole number above nothing. Default: no target. */
  readonly target?: number;
  /**
   * When the scene happens in the story, as YYYY-MM-DD (or YYYY-MM, or YYYY).
   * A scene with a date shows on the timeline. Default: none.
   */
  readonly date?: string;
  /**
   * The entities of the world that are in the scene, each as a link to its
   * note ("[[Mara]]"), exactly as they are to be written. Default: none.
   */
  readonly entities?: readonly string[];
}

/** An event of the story to create: a note in the Timeline folder. Its file name is made from the title. */
export interface EventSeed {
  readonly title: string;
  /**
   * The note's properties, exactly as they are to be written: what the
   * timeline reads ("spellbook: event", date, end, timelines, scenes, tags,
   * entities).
   */
  readonly frontmatter: Readonly<Frontmatter>;
  /** The note's text. Default: empty. */
  readonly body?: string;
}

/** A binder folder to create, with what goes inside it. */
export interface FolderSeed {
  readonly folder: string;
  readonly children: readonly BinderSeed[];
}

export type BinderSeed = SceneSeed | FolderSeed;

/** A plain note (no properties) to create. */
export interface NoteSeed {
  readonly title: string;
  readonly body: string;
}

/** A world-building note to create: a character, a place and so on. Its file name is made from the title. */
export interface WorldSeed {
  /** The folder of its type inside World, for example "Characters". */
  readonly folder: string;
  readonly title: string;
  /** The note's properties, exactly as they are to be written: "type", the type's fields, "aliases". */
  readonly frontmatter: Readonly<Frontmatter>;
  /** The note's text. Default: empty. */
  readonly body?: string;
}

export interface ProjectSeed {
  /** The scenes and binder folders, in manuscript order. */
  readonly binder: readonly BinderSeed[];
  /** Notes to put in the Manuscript folder without listing them in the binder. */
  readonly unfiled?: readonly NoteSeed[];
  /** Notes to put in the Research folder. */
  readonly research?: readonly NoteSeed[];
  /** The text of To-do.md. Default: empty. */
  readonly todo?: string;
  /** Events of the story: notes to put in the Timeline folder. */
  readonly events?: readonly EventSeed[];
  /** The world of the story: notes to put in the World folder, each in the folder of its type. */
  readonly world?: readonly WorldSeed[];
  /**
   * What the screens keep in the project index, next to the binder: the
   * statuses and labels with their colours, the timelines, the day marks, the
   * targets. Each entry becomes a top-level property of the new index note.
   * The properties the index keeps for itself (its mark, its version, the
   * title, the binder) cannot be set this way and are left out.
   */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** The title of the scene every ordinary new project starts with. */
export const FIRST_SCENE_TITLE = 'Scene 1';

/** Name for a binder folder whose seed has no usable name. */
export const DEFAULT_FOLDER_NAME = 'Untitled folder';

/** File name for an event whose seed has no usable title. */
export const DEFAULT_EVENT_NAME = 'Untitled event';

/** File name for a world-building note whose seed has no usable title. */
export const DEFAULT_ENTITY_NAME = 'Untitled entity';

/** What "Create project" puts in a new project: one empty scene. */
export function starterProject(): ProjectSeed {
  return { binder: [{ title: FIRST_SCENE_TITLE }] };
}

export function isFolderSeed(seed: BinderSeed): seed is FolderSeed {
  return 'folder' in seed;
}

/** How many scenes a seed's binder holds, folders included. */
export function countSeedScenes(seeds: readonly BinderSeed[]): number {
  let count = 0;
  for (const seed of seeds) count += isFolderSeed(seed) ? countSeedScenes(seed.children) : 1;
  return count;
}

export interface PlantContext {
  /** Today's date on this device, as YYYY-MM-DD; becomes each scene's "created". */
  readonly today: string;
  /** A random number from 0 up to (not including) 1; used for folder ids. */
  readonly random: () => number;
  /** Told what is about to be created, so that a failure can say where it stopped. */
  readonly onStep?: (what: string) => void;
}

export interface PlantedSeed {
  /** The binder that lists what was created. */
  readonly binder: Binder;
  /** The scenes that were created, in manuscript order, as paths relative to the project folder. */
  readonly scenes: readonly string[];
}

/**
 * Create a seed's notes inside the project folder `folder`, whose Manuscript,
 * Research and Timeline folders must already exist; the World folder is made
 * here, for a seed that has a world. (What a seed has for the index itself,
 * its `data`, is the project store's to write.)
 *
 * Scenes are created in manuscript order with order keys 1024 apart, so the
 * binder and the keys agree from the start. Rejects as soon as a note cannot
 * be created; what was created before that stays.
 */
export async function plantSeed(
  vault: VaultPort,
  folder: string,
  seed: ProjectSeed,
  context: PlantContext,
): Promise<PlantedSeed> {
  const scenes: string[] = [];
  const folderIds = new Set<string>();
  /** Names already given out in each sub-folder, so two seeds never ask for the same file. */
  const namesGiven = new Map<string, Set<string>>();

  const createNote = async (
    sub: string,
    title: string,
    fallback: string,
    body: string,
    frontmatter?: Frontmatter,
  ): Promise<string> => {
    const given = namesGiven.get(sub) ?? new Set<string>();
    namesGiven.set(sub, given);
    const name = uniqueName(
      sanitiseFileName(title, fallback),
      (candidate) =>
        given.has(clashKey(candidate)) || vault.exists(joinPath(folder, sub, `${candidate}.md`)),
    );
    given.add(clashKey(name));
    const wanted = `${sub}/${name}.md`;
    context.onStep?.(`the note "${wanted}"`);
    const created = await vault.createFile(joinPath(folder, wanted), body, frontmatter);
    return relativeTo(folder, created) ?? wanted;
  };

  const plant = async (seeds: readonly BinderSeed[]): Promise<BinderNode[]> => {
    const nodes: BinderNode[] = [];
    for (const item of seeds) {
      if (isFolderSeed(item)) {
        const id = newFolderId(context.random, folderIds);
        folderIds.add(id);
        const name = tidyDisplayName(item.folder);
        nodes.push({
          kind: 'folder',
          id,
          name: name === '' ? DEFAULT_FOLDER_NAME : name,
          children: await plant(item.children),
        });
      } else {
        const order = ORDER_STEP * (scenes.length + 1);
        const frontmatter = newSceneFrontmatter(order, context.today, item);
        // A scene's place in the story's time is not one of the standard properties: only a scene that has one gets it.
        if (item.date !== undefined && item.date !== '') frontmatter['date'] = item.date;
        // Nor is who and what is in it: a list of links, for a scene that has any.
        if (item.entities !== undefined && item.entities.length > 0) frontmatter[ENTITIES_KEY] = [...item.entities];
        const path = await createNote(MANUSCRIPT_FOLDER, item.title, DEFAULT_SCENE_NAME, item.body ?? '', frontmatter);
        scenes.push(path);
        nodes.push({ kind: 'scene', path });
      }
    }
    return nodes;
  };

  const binder = await plant(seed.binder);
  for (const note of seed.unfiled ?? []) {
    await createNote(MANUSCRIPT_FOLDER, note.title, DEFAULT_SCENE_NAME, note.body);
  }
  for (const note of seed.research ?? []) {
    await createNote(RESEARCH_FOLDER, note.title, DEFAULT_NAME, note.body);
  }
  for (const event of seed.events ?? []) {
    // A copy: the note gets properties of its own, not the seed's.
    await createNote(TIMELINE_FOLDER, event.title, DEFAULT_EVENT_NAME, event.body ?? '', { ...event.frontmatter });
  }
  for (const entity of seed.world ?? []) {
    // The World folder and the folders of the types are not part of a new project: they are made when first needed.
    const type = sanitiseFileName(entity.folder, '');
    const sub = type === '' ? WORLD_FOLDER : `${WORLD_FOLDER}/${type}`;
    for (const step of [WORLD_FOLDER, sub]) {
      const path = joinPath(folder, step);
      if (vault.exists(path)) continue;
      context.onStep?.(`the "${step}" folder`);
      await vault.createFolder(path);
    }
    await createNote(sub, entity.title, DEFAULT_ENTITY_NAME, entity.body ?? '', { ...entity.frontmatter });
  }
  return { binder, scenes };
}
