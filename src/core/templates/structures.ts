// The starting structures "Create project" offers: an empty project, three
// acts, an outline in fifteen steps, the hero's journey in twelve stages, and
// a project with one folder per chapter. Each is a list of binder folders
// and placeholder scenes; every placeholder says in plain words what belongs
// there, and starts as "To do".
//
// The descriptions are Spellbook's own words: they name no commercial method
// and quote no book.

import { countSeedScenes } from '../projectSeed';
import type { BinderSeed, ProjectSeed, SceneSeed } from '../projectSeed';
import { FIRST_SCENE_TITLE } from '../projectSeed';
import { DEFAULT_STATUS } from '../scene';

/** A placeholder scene of a structure. */
export interface StructureScene {
  readonly title: string;
  /** What belongs in the scene, in plain words. */
  readonly synopsis: string;
  /** Default: "To do". */
  readonly status?: string;
  readonly label?: string;
  /** The scene's text. Default: empty. Only a project template saved with its text has any. */
  readonly text?: string;
}

/** A binder folder of a structure, with what goes inside it. */
export interface StructureFolder {
  readonly folder: string;
  readonly children: readonly StructurePart[];
}

export type StructurePart = StructureScene | StructureFolder;

export function isStructureFolder(part: StructurePart): part is StructureFolder {
  return 'folder' in part;
}

/** One of the starting structures a new project can have. */
export interface Structure {
  /** A short name that no other structure has, for example "three-acts". */
  readonly id: string;
  /** What it is called in the list, for example "Three acts". */
  readonly name: string;
  /** One line that says what it is. */
  readonly description: string;
  /** True for the structure that asks how many chapters the book will have. */
  readonly asksForChapters: boolean;
  /** Its folders and scenes. `chapters` is only used by the structure that asks for it. */
  parts(chapters: number): readonly StructurePart[];
}

/** The fewest and the most chapters "Chapter by chapter" makes, and what it offers at first. */
export const MIN_CHAPTERS = 1;
export const MAX_CHAPTERS = 100;
export const DEFAULT_CHAPTERS = 12;

/** The id of the structure every new project had before there was a choice: one empty scene. */
export const BLANK_STRUCTURE_ID = 'blank';

/**
 * Read a number of chapters as the writer typed it. Null when it is not a
 * whole number from MIN_CHAPTERS to MAX_CHAPTERS.
 */
export function readChapterCount(typed: string | number): number | null {
  const text = String(typed).trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const count = Number(text);
  return count >= MIN_CHAPTERS && count <= MAX_CHAPTERS ? count : null;
}

function scene(title: string, synopsis: string): StructureScene {
  return { title, synopsis };
}

function folder(name: string, children: readonly StructurePart[]): StructureFolder {
  return { folder: name, children };
}

const BLANK: Structure = {
  id: BLANK_STRUCTURE_ID,
  name: 'Blank',
  description: 'One empty scene, and nothing else. Build the shape as you go.',
  asksForChapters: false,
  parts: () => [{ title: FIRST_SCENE_TITLE, synopsis: '' }],
};

const THREE_ACTS: Structure = {
  id: 'three-acts',
  name: 'Three acts',
  description: 'A beginning that sets things going, a long middle where they get harder, and an end that settles them.',
  asksForChapters: false,
  parts: () => [
    folder('Act one: the setup', [
      scene('Everyday life', 'Show the main character in their usual world, and what they want or lack before anything changes.'),
      scene('The disturbance', 'Something happens that upsets the balance and cannot be ignored.'),
      scene('The decision', 'The main character chooses to act, and steps out of the familiar into the story proper.'),
    ]),
    folder('Act two: the struggle', [
      scene('New ground', 'The character finds their feet in the changed situation; first attempts, first allies and first enemies.'),
      scene('The midpoint', 'A discovery or a reversal that changes what the struggle is really about.'),
      scene('Things fall apart', 'Pressure grows from outside and from within; plans fail and the cost rises.'),
      scene('The lowest point', 'All seems lost. The character must face what they have been avoiding.'),
    ]),
    folder('Act three: the resolution', [
      scene('Gathering strength', 'With something learned, the character finds a new way forward.'),
      scene('The final confrontation', 'The main conflict comes to a head and is decided.'),
      scene('After', 'Show the world and the character as they are now, and what has changed.'),
    ]),
  ],
};

const FIFTEEN_STEPS: Structure = {
  id: 'fifteen-steps',
  name: 'A fifteen-beat outline',
  description: 'The story in fifteen short steps, from a first glimpse of the hero to a last one that shows how far they came.',
  asksForChapters: false,
  parts: () => [
    folder('Beginning', [
      scene('First glimpse', 'A picture of the main character and their world before the story begins, to compare with the end.'),
      scene('The question', 'Someone says, or something shows, what the story will be about underneath.'),
      scene('The world as it is', 'The people, places and problems of everyday life, and what is missing in it.'),
      scene('The spark', 'The event that starts the story moving.'),
      scene('Second thoughts', 'The main character hesitates, argues or weighs what to do.'),
    ]),
    folder('Middle', [
      scene('Stepping through', 'A choice is made, and the character enters a new situation.'),
      scene('A second thread', 'A relationship or a side story begins that carries the deeper question of the story.'),
      scene('Exploring', 'The new situation at its fullest: what the reader came for.'),
      scene('The turning point', 'Halfway: a false win or a false defeat raises the stakes.'),
      scene('Closing in', 'Opposition grows, doubts spread, and the group starts to come apart.'),
      scene('The loss', 'Something or someone important is lost. It seems over.'),
      scene('In the dark', 'The character sits with the loss and finally understands what must change.'),
    ]),
    folder('End', [
      scene('A way out', 'An idea, often from the second thread, shows the way forward.'),
      scene('The last push', 'The character acts on what they have learned and faces the final test.'),
      scene('Last glimpse', 'A closing picture that answers the first one and shows the change.'),
    ]),
  ],
};

const HEROS_JOURNEY: Structure = {
  id: 'heros-journey',
  name: "The hero's journey",
  description: 'Twelve stages of a journey out into the unknown and home again, changed.',
  asksForChapters: false,
  parts: () => [
    folder('Leaving', [
      scene('At home', 'The hero in their familiar world, with a need or a flaw they may not see.'),
      scene('The summons', 'A message, a threat or a chance asks the hero to leave.'),
      scene('Holding back', 'Fear or duty makes the hero refuse, or delay.'),
      scene('A guide', 'Someone or something gives advice, a gift or courage.'),
      scene('Over the threshold', 'The hero leaves the familiar behind and enters the unknown.'),
    ]),
    folder('The unknown', [
      scene('Trials, friends and foes', 'The hero learns the rules of the new world and who can be trusted.'),
      scene('Drawing near', 'Preparations for the greatest danger, at the heart of the unknown.'),
      scene('The ordeal', 'The hero faces the deepest fear, and something must die, in fact or in spirit.'),
      scene('The prize', 'Having survived, the hero takes what they came for: an object, a truth, a bond.'),
    ]),
    folder('Coming home', [
      scene('The way back', 'The road home brings new dangers, or the consequences of the ordeal.'),
      scene('The last test', 'One final trial proves that the hero has truly changed.'),
      scene('Home, changed', 'The hero returns with something that can heal or change the familiar world.'),
    ]),
  ],
};

const CHAPTERS: Structure = {
  id: 'chapters',
  name: 'Chapter by chapter',
  description: 'One folder for each chapter, each with a first scene to fill in.',
  asksForChapters: true,
  parts: (chapters) => {
    const count = readChapterCount(chapters) ?? DEFAULT_CHAPTERS;
    const parts: StructurePart[] = [];
    for (let n = 1; n <= count; n++) {
      parts.push(folder(`Chapter ${n}`, [scene(`Chapter ${n}, scene 1`, `What happens in chapter ${n}.`)]));
    }
    return parts;
  },
};

/** The starting structures, in the order they are offered. The first is what a project gets when nothing is chosen. */
export const STRUCTURES: readonly Structure[] = [BLANK, THREE_ACTS, FIFTEEN_STEPS, HEROS_JOURNEY, CHAPTERS];

/** The structure with this id, or null. */
export function findStructure(id: string): Structure | null {
  return STRUCTURES.find((structure) => structure.id === id) ?? null;
}

/** What a structure's parts become in a new project: binder folders and scenes, in order. */
export function seedOfParts(parts: readonly StructurePart[]): ProjectSeed {
  const toSeed = (part: StructurePart): BinderSeed => {
    if (isStructureFolder(part)) return { folder: part.folder, children: part.children.map(toSeed) };
    const seed: { -readonly [K in keyof SceneSeed]: SceneSeed[K] } = {
      title: part.title,
      synopsis: part.synopsis,
      status: part.status ?? DEFAULT_STATUS,
    };
    if (part.label !== undefined && part.label !== '') seed.label = part.label;
    if (part.text !== undefined && part.text !== '') seed.body = part.text;
    return seed;
  };
  return { binder: parts.map(toSeed) };
}

/** One line of the list that shows what a structure will make. */
export interface OutlineLine {
  readonly kind: 'folder' | 'scene';
  readonly title: string;
  /** How deep it sits: 0 for the top level. */
  readonly depth: number;
}

/** The folders and scenes a structure will make, in order, one line each. */
export function outlineOf(parts: readonly StructurePart[]): OutlineLine[] {
  const lines: OutlineLine[] = [];
  const walk = (list: readonly StructurePart[], depth: number): void => {
    for (const part of list) {
      if (isStructureFolder(part)) {
        lines.push({ kind: 'folder', title: part.folder, depth });
        walk(part.children, depth + 1);
      } else {
        lines.push({ kind: 'scene', title: part.title, depth });
      }
    }
  };
  walk(parts, 0);
  return lines;
}

/** "3 folders and 10 scenes": how much a structure will make. */
export function describeSize(parts: readonly StructurePart[]): string {
  const lines = outlineOf(parts);
  const folders = lines.filter((line) => line.kind === 'folder').length;
  const scenes = countSeedScenes(seedOfParts(parts).binder);
  const say = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
  return folders === 0 ? say(scenes, 'scene', 'scenes') : `${say(folders, 'folder', 'folders')} and ${say(scenes, 'scene', 'scenes')}`;
}
