// Statuses and labels: the two short lists a writer sorts scenes by.
//
// Both live in the project index, in display order:
//
//   statuses:
//     - name: To do
//       color: red
//   labels:
//     - name: Anna
//       color: purple
//
// A scene points at one of each by name ("status: To do", "label: Anna").
// Names are compared without regard to capitals, so "to do" typed by hand is
// still the status "To do".
//
// The lists may have been edited by hand or by another device. Reading keeps
// every stored entry, understood or not, and every change is made on those
// stored entries, so nothing that was not understood is ever lost.

import { SCENE_STATUSES, clashKey, tidyDisplayName } from './coreImports';
import type { Frontmatter } from './coreImports';
import { isCardColor, readColor } from './colors';
import type { CardColor } from './colors';
import { EMPTY_PATCH } from './patch';
import type { FrontmatterPatch, ScenePatch, SceneProperties } from './patch';
import { readName } from './sceneFields';

/** Which of the two lists: the statuses or the labels. */
export type TagKind = 'status' | 'label';

/** The key of each list in the project index. */
export const TAG_INDEX_KEYS: Readonly<Record<TagKind, string>> = { status: 'statuses', label: 'labels' };

/** The property of a scene note that names its status or its label. */
export const TAG_SCENE_KEYS: Readonly<Record<TagKind, string>> = { status: 'status', label: 'label' };

/** One status or one label. */
export interface Tag {
  /** The name, with tidy spacing. Free text in any language. */
  readonly name: string;
  /** Its colour; null for none (also when the stored colour is not one of the eight names). */
  readonly color: CardColor | null;
}

/** One stored entry of a list, kept so that it can be written back exactly. */
export interface TagEntry {
  /** What the entry says; null when it was not understood or repeats an earlier name. */
  readonly tag: Tag | null;
  /** The entry exactly as it was stored. */
  readonly raw: unknown;
}

/** The statuses or the labels of a project, as read from the index. */
export interface TagList {
  readonly kind: TagKind;
  /** The statuses or labels in display order. This is what a screen shows. */
  readonly tags: readonly Tag[];
  /** True when the index holds no list and the built-in one is shown (four statuses; no labels). */
  readonly fromDefaults: boolean;
  /**
   * True when the index holds something under this key that is not a list.
   * It is left alone: every change is refused until it is put right by hand.
   */
  readonly unreadable: boolean;
  /** What could not be understood, each in a plain sentence. */
  readonly problems: readonly string[];
  /** Every stored entry in stored order, for writing back. Screens use `tags`. */
  readonly entries: readonly TagEntry[];
}

const DEFAULT_STATUS_COLORS: readonly CardColor[] = ['red', 'orange', 'blue', 'green'];

/** The statuses of a project that has not chosen its own: the four built-in stages, each with a colour. */
export const DEFAULT_STATUSES: readonly Tag[] = Object.freeze(
  SCENE_STATUSES.map((name, position): Tag => Object.freeze({ name, color: DEFAULT_STATUS_COLORS[position] ?? null })),
);

const WORD: Readonly<Record<TagKind, string>> = { status: 'status', label: 'label' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return 'empty';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a group of properties';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/** The form in which two names are compared: tidy spacing, no regard to capitals. */
function tagKey(name: string): string {
  return clashKey(tidyDisplayName(name));
}

/** True when two names are the same status or label: capitals and extra spaces do not count. */
export function sameTagName(a: string, b: string): boolean {
  return tagKey(a) === tagKey(b);
}

/** What one stored entry says, read on its own. Null when it names nothing. */
function readSlot(raw: unknown): Tag | null {
  if (isRecord(raw)) {
    const name = readName(raw['name']).value;
    return name === null ? null : { name, color: readColor(raw['color']) };
  }
  // A bare name ("- Anna") is a status or label without a colour.
  const name = readName(raw).value;
  return name === null ? null : { name, color: null };
}

function slotKey(raw: unknown): string | null {
  const tag = readSlot(raw);
  return tag === null ? null : tagKey(tag.name);
}

function slotFor(tag: Tag): Record<string, unknown> {
  return tag.color === null ? { name: tag.name } : { name: tag.name, color: tag.color };
}

function defaultTags(kind: TagKind): readonly Tag[] {
  return kind === 'status' ? DEFAULT_STATUSES : [];
}

function defaultList(kind: TagKind, unreadable: boolean, problems: readonly string[]): TagList {
  const tags = defaultTags(kind);
  return {
    kind,
    tags,
    fromDefaults: true,
    unreadable,
    problems,
    entries: tags.map((tag): TagEntry => ({ tag, raw: slotFor(tag) })),
  };
}

/**
 * Read the statuses or the labels from the value stored in the project index.
 *
 * Never throws. No value at all gives the built-in list (the four statuses of
 * a new project; no labels). An entry may be `{ name, color }` or just a name.
 * An entry without a name, or one that repeats an earlier name, is not shown
 * but is kept for writing back, and is mentioned in `problems`.
 *
 * @param value what the index holds under "statuses" or "labels"
 */
export function parseTagList(kind: TagKind, value: unknown): TagList {
  const key = TAG_INDEX_KEYS[kind];
  if (value === undefined || value === null) return defaultList(kind, false, []);
  if (!Array.isArray(value)) {
    const shown = kind === 'status' ? 'The usual statuses are shown' : 'No labels are shown';
    return defaultList(kind, true, [
      `The "${key}" property of the project index should be a list, but it is ${describe(value)}. ` +
        `${shown}, and the list cannot be changed here until that is put right.`,
    ]);
  }

  const problems: string[] = [];
  const seen = new Set<string>();
  const entries = value.map((raw: unknown, position): TagEntry => {
    const tag = readSlot(raw);
    if (tag === null) {
      const what = isRecord(raw) ? 'has no name' : `is not a ${WORD[kind]} (it is ${describe(raw)})`;
      problems.push(`Entry ${position + 1} of "${key}" in the project index ${what}. It is left as it is.`);
      return { tag: null, raw };
    }
    const nameKey = tagKey(tag.name);
    if (seen.has(nameKey)) {
      problems.push(`"${tag.name}" is listed more than once in "${key}" in the project index. Only the first one is used.`);
      return { tag: null, raw };
    }
    seen.add(nameKey);
    return { tag, raw };
  });
  const tags = entries.flatMap((entry) => (entry.tag === null ? [] : [entry.tag]));
  return { kind, tags, fromDefaults: false, unreadable: false, problems, entries };
}

/**
 * Read both lists at once from the project index's properties (or from just
 * its extra keys).
 */
export function readTagLists(
  index: Readonly<Frontmatter> | null | undefined,
): { readonly statuses: TagList; readonly labels: TagList } {
  const source: Readonly<Frontmatter> = isRecord(index) ? index : {};
  return {
    statuses: parseTagList('status', source[TAG_INDEX_KEYS.status]),
    labels: parseTagList('label', source[TAG_INDEX_KEYS.label]),
  };
}

const lookups = new WeakMap<TagList, Map<string, Tag>>();

/**
 * The status or label a name refers to, or null when the list has none by
 * that name. Capitals and extra spaces do not count.
 */
export function findTag(list: TagList, name: string | null | undefined): Tag | null {
  if (typeof name !== 'string') return null;
  let byKey = lookups.get(list);
  if (!byKey) {
    byKey = new Map();
    for (const tag of list.tags) byKey.set(tagKey(tag.name), tag);
    lookups.set(list, byKey);
  }
  return byKey.get(tagKey(name)) ?? null;
}

/** The status a new scene should start with: the first one in the list. Null when the list is empty. */
export function defaultStatusName(statuses: TagList): string | null {
  return statuses.tags[0]?.name ?? null;
}

// ------------------------------------------------------------------- changes

/** Why a change to a list was refused. */
export type TagRefusal =
  /** The stored list could not be read, so it is not touched. */
  | 'unreadable'
  /** No name was given. */
  | 'empty-name'
  /** Another status or label already has that name. */
  | 'duplicate'
  /** There is no status or label by that name. */
  | 'not-found'
  /** It already is that way. */
  | 'unchanged'
  /** The colour is not one of the eight names. */
  | 'invalid-color'
  /** The place to move it to is not a number. */
  | 'invalid-position';

/** What a change to a list comes to. Nothing is written here: the caller stores `value`. */
export type TagEditResult =
  | {
      readonly ok: true;
      /** The list as it will read once `value` is stored. */
      readonly list: TagList;
      /** The key of the project index to store under: "statuses" or "labels". */
      readonly key: string;
      /** The whole new value for that key. */
      readonly value: unknown[];
      /** The scenes whose properties must change too (only a rename has any). */
      readonly scenePatches: readonly ScenePatch[];
    }
  | {
      readonly ok: false;
      readonly reason: TagRefusal;
      /** The reason in a plain sentence, fit to show to the writer. */
      readonly message: string;
    };

function refuse(reason: TagRefusal, message: string): TagEditResult {
  return { ok: false, reason, message };
}

function done(list: TagList, value: unknown[], scenePatches: readonly ScenePatch[] = []): TagEditResult {
  return {
    ok: true,
    list: parseTagList(list.kind, value),
    key: TAG_INDEX_KEYS[list.kind],
    value,
    scenePatches,
  };
}

function unreadable(list: TagList): TagEditResult {
  return refuse(
    'unreadable',
    list.problems[0] ?? `The "${TAG_INDEX_KEYS[list.kind]}" property of the project index cannot be read.`,
  );
}

function notFound(list: TagList, name: string): TagEditResult {
  return refuse('not-found', `There is no ${WORD[list.kind]} called "${tidyDisplayName(name)}".`);
}

/** The stored entries of a list, as they would be written with no change. */
function slotsOf(list: TagList): unknown[] {
  return list.entries.map((entry) => entry.raw);
}

/** Where the status or label by this name sits among the stored entries; -1 when there is none. */
function activeSlot(list: TagList, name: string): number {
  const key = tagKey(name);
  return list.entries.findIndex((entry) => entry.tag !== null && tagKey(entry.tag.name) === key);
}

/**
 * Add a status or a label at the end of the list.
 *
 * Refused when the name is empty, when another one already has it (capitals
 * do not count), or when the colour is not one of the eight names.
 */
export function addTag(list: TagList, name: string, color: CardColor | null = null): TagEditResult {
  if (list.unreadable) return unreadable(list);
  const tidy = typeof name === 'string' ? tidyDisplayName(name) : '';
  if (tidy === '') return refuse('empty-name', `Give the ${WORD[list.kind]} a name.`);
  if (color !== null && !isCardColor(color)) {
    return refuse('invalid-color', `That is not one of the colours a ${WORD[list.kind]} can have.`);
  }
  const existing = findTag(list, tidy);
  if (existing) return refuse('duplicate', `There is already a ${WORD[list.kind]} called "${existing.name}".`);
  return done(list, [...slotsOf(list), slotFor({ name: tidy, color })]);
}

/**
 * The change one scene needs when a status or label is renamed: a patch that
 * sets the new name when the scene uses the old one, and an empty patch when
 * it does not. Call it on the scene's properties as they are on disk at the
 * moment of writing, so that a scene changed on another device is not
 * overwritten.
 */
export function renameTagInScene(
  kind: TagKind,
  frontmatter: Readonly<Frontmatter> | null | undefined,
  oldName: string,
  newName: string,
): FrontmatterPatch {
  if (!isRecord(frontmatter)) return EMPTY_PATCH;
  const next = tidyDisplayName(newName);
  if (next === '') return EMPTY_PATCH;
  const key = TAG_SCENE_KEYS[kind];
  const stored = frontmatter[key];
  const current = readName(stored).value;
  if (current === null || !sameTagName(current, oldName) || stored === next) return EMPTY_PATCH;
  return { set: { [key]: next }, remove: [] };
}

/**
 * Give a status or a label a new name.
 *
 * `scenePatches` in the result lists every scene that used the old name, with
 * the patch that makes it use the new one; scenes that do not use it are not
 * listed. Changing only the capitals of a name is a rename like any other.
 *
 * @param scenes every scene of the project with its properties
 */
export function renameTag(
  list: TagList,
  name: string,
  newName: string,
  scenes: readonly SceneProperties[] = [],
): TagEditResult {
  if (list.unreadable) return unreadable(list);
  const at = activeSlot(list, name);
  const current = list.entries[at]?.tag;
  if (!current) return notFound(list, name);
  const tidy = typeof newName === 'string' ? tidyDisplayName(newName) : '';
  if (tidy === '') return refuse('empty-name', `Give the ${WORD[list.kind]} a name.`);
  if (tidy === current.name) return refuse('unchanged', `The ${WORD[list.kind]} already has that name.`);
  const oldKey = tagKey(current.name);
  const taken = findTag(list, tidy);
  if (taken && tagKey(taken.name) !== oldKey) {
    return refuse('duplicate', `There is already a ${WORD[list.kind]} called "${taken.name}".`);
  }

  // Every stored entry with the old name takes the new one, repeats included,
  // so that no repeat comes back to life under the old name.
  const value = slotsOf(list).map((raw: unknown): unknown => {
    if (slotKey(raw) !== oldKey) return raw;
    return isRecord(raw) ? { ...raw, name: tidy } : tidy;
  });

  const scenePatches: ScenePatch[] = [];
  for (const scene of scenes) {
    const patch = renameTagInScene(list.kind, scene.frontmatter, current.name, tidy);
    if (Object.keys(patch.set).length > 0) scenePatches.push({ path: scene.path, patch });
  }
  return done(list, value, scenePatches);
}

/**
 * Give a status or a label another colour, or none (null). Refused when the
 * colour is not one of the eight names, or is the one it already has.
 */
export function recolourTag(list: TagList, name: string, color: CardColor | null): TagEditResult {
  if (list.unreadable) return unreadable(list);
  const at = activeSlot(list, name);
  const current = list.entries[at]?.tag;
  if (!current) return notFound(list, name);
  if (color !== null && !isCardColor(color)) {
    return refuse('invalid-color', `That is not one of the colours a ${WORD[list.kind]} can have.`);
  }
  if (color === current.color) return refuse('unchanged', `The ${WORD[list.kind]} already has that colour.`);

  const value = slotsOf(list);
  const raw = value[at];
  if (!isRecord(raw)) {
    // A bare name: it needs the longer form to carry a colour.
    value[at] = color === null ? raw : { name: raw, color };
  } else if (color === null) {
    const rest: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) if (key !== 'color') rest[key] = raw[key];
    value[at] = rest;
  } else {
    value[at] = { ...raw, color };
  }
  return done(list, value);
}

/**
 * Move a status or a label to another place in the list. Refused when the
 * place is not a number at all (NaN), or is where it already is.
 *
 * @param toIndex where it should end up among `list.tags`, counting from 0;
 *                anything past the end means last, anything before the start
 *                means first
 */
export function moveTag(list: TagList, name: string, toIndex: number): TagEditResult {
  if (list.unreadable) return unreadable(list);
  const tag = findTag(list, name);
  const from = tag === null ? -1 : list.tags.indexOf(tag);
  if (from < 0) return notFound(list, name);
  // Not a place in the list: guessing one would reorder the list unasked.
  if (typeof toIndex !== 'number' || Number.isNaN(toIndex)) {
    return refuse('invalid-position', `That is not a place the ${WORD[list.kind]} can be moved to.`);
  }
  const last = list.tags.length - 1;
  const to = Math.max(0, Math.min(last, Math.trunc(toIndex)));
  if (to === from) return refuse('unchanged', `The ${WORD[list.kind]} is already there.`);

  // Entries that are not shown travel with the shown one in front of them,
  // so a repeat never ends up ahead of the entry it repeats.
  const leading: unknown[] = [];
  const groups: unknown[][] = [];
  for (const entry of list.entries) {
    const group = groups[groups.length - 1];
    if (entry.tag !== null) groups.push([entry.raw]);
    else if (group) group.push(entry.raw);
    else leading.push(entry.raw);
  }
  const [moved] = groups.splice(from, 1);
  if (moved) groups.splice(to, 0, moved);
  return done(list, [...leading, ...groups.flat()]);
}

/**
 * Take a status or a label off the list. Scenes that use it keep its name and
 * are simply shown without a colour (see unlistedTags).
 */
export function removeTag(list: TagList, name: string): TagEditResult {
  if (list.unreadable) return unreadable(list);
  const tag = findTag(list, name);
  if (!tag) return notFound(list, name);
  const key = tagKey(tag.name);
  // Repeats of the name go too; otherwise one of them would take its place.
  return done(
    list,
    slotsOf(list).filter((raw) => slotKey(raw) !== key),
  );
}

// -------------------------------------------------------------- across scenes

/** A status or label that scenes use but the list does not have. */
export interface UnlistedTag {
  /** The name as the first scene that uses it spells it. */
  readonly name: string;
  /** The scenes that use it, in the order they were handed in. */
  readonly paths: readonly string[];
}

/**
 * The statuses or labels that scenes use but the list does not have, in
 * order of first use, so the screen can offer to add them. Such scenes are
 * shown without a colour.
 */
export function unlistedTags(list: TagList, scenes: readonly SceneProperties[]): UnlistedTag[] {
  const found = new Map<string, { name: string; paths: string[] }>();
  const key = TAG_SCENE_KEYS[list.kind];
  for (const scene of scenes) {
    if (!isRecord(scene.frontmatter)) continue;
    const name = readName(scene.frontmatter[key]).value;
    if (name === null || findTag(list, name)) continue;
    const nameKey = tagKey(name);
    const entry = found.get(nameKey);
    if (entry) entry.paths.push(scene.path);
    else found.set(nameKey, { name, paths: [scene.path] });
  }
  return [...found.values()];
}

/** The scenes that use a status or a label by this name, in the order they were handed in. */
export function scenesUsingTag(kind: TagKind, name: string, scenes: readonly SceneProperties[]): string[] {
  const key = TAG_SCENE_KEYS[kind];
  const paths: string[] = [];
  for (const scene of scenes) {
    if (!isRecord(scene.frontmatter)) continue;
    const used = readName(scene.frontmatter[key]).value;
    if (used !== null && sameTagName(used, name)) paths.push(scene.path);
  }
  return paths;
}
