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
import { MANUSCRIPT_FOLDER, RESEARCH_FOLDER } from './projectLayout';
import { DEFAULT_SCENE_NAME, newSceneFrontmatter } from './scene';
import type { Binder, BinderNode, Frontmatter } from './types';
import type { VaultPort } from './vaultPort';

/** A scene to create. Its file name is made from the title. */
export interface SceneSeed {
  readonly title: string;
  /** The scene's text. Default: empty. */
  readonly body?: string;
  readonly synopsis?: string;
  readonly status?: string;
  readonly label?: string;
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

export interface ProjectSeed {
  /** The scenes and binder folders, in manuscript order. */
  readonly binder: readonly BinderSeed[];
  /** Notes to put in the Manuscript folder without listing them in the binder. */
  readonly unfiled?: readonly NoteSeed[];
  /** Notes to put in the Research folder. */
  readonly research?: readonly NoteSeed[];
  /** The text of To-do.md. Default: empty. */
  readonly todo?: string;
}

/** The title of the scene every ordinary new project starts with. */
export const FIRST_SCENE_TITLE = 'Scene 1';

/** Name for a binder folder whose seed has no usable name. */
export const DEFAULT_FOLDER_NAME = 'Untitled folder';

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
 * Create a seed's notes inside the project folder `folder`, whose Manuscript
 * and Research folders must already exist.
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
        const path = await createNote(
          MANUSCRIPT_FOLDER,
          item.title,
          DEFAULT_SCENE_NAME,
          item.body ?? '',
          newSceneFrontmatter(order, context.today, item),
        );
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
  return { binder, scenes };
}
