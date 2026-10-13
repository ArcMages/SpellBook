// A scene's other properties: its tags, and whatever else the writer keeps in
// the properties block of a scene. The outliner shows them, and changes none.

import type { Frontmatter } from '../types';

/**
 * The properties of a scene that the outliner already has a column for (or
 * that are the plugin's own bookkeeping, as "order" is). Every other key
 * found in the scenes can be added as a column of its own.
 */
export const KNOWN_SCENE_KEYS: readonly string[] = [
  'synopsis',
  'status',
  'label',
  'target',
  'compile',
  'order',
  'created',
  'edited',
  'tags',
  'tag',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value of one property; undefined when the note does not have it. */
export function readProperty(frontmatter: Readonly<Frontmatter> | null | undefined, key: string): unknown {
  if (!isRecord(frontmatter)) return undefined;
  // (Asked this way so that a key such as "constructor" finds nothing that was not written by the writer.)
  return Object.prototype.hasOwnProperty.call(frontmatter, key) ? frontmatter[key] : undefined;
}

/**
 * The other property keys found in a set of scenes: every key that is not
 * one of KNOWN_SCENE_KEYS, each once, in alphabetical order. Capitals do not
 * count when telling a known key from another ("Status" is known too).
 */
export function otherPropertyKeys(
  scenes: Iterable<Readonly<Frontmatter> | null | undefined>,
  collator: Pick<Intl.Collator, 'compare'> = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }),
): string[] {
  const known = new Set(KNOWN_SCENE_KEYS);
  const found = new Set<string>();
  for (const frontmatter of scenes) {
    if (!isRecord(frontmatter)) continue;
    for (const key of Object.keys(frontmatter)) {
      if (key.trim() === '' || known.has(key.toLowerCase())) continue;
      found.add(key);
    }
  }
  return [...found].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** A property's value as a cell shows it: plain text. A list is shown with commas; nothing is "". */
export function propertyText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => propertyText(item))
      .filter((text) => text !== '')
      .join(', ');
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function tagNames(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,\s]+/);
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => tagNames(item));
  return [];
}

/**
 * The tags a note names in its properties ("tags", or the older "tag"), each
 * once, without the "#" in front, in the order they are written. Tags that
 * are only written in the text of the note are not looked for.
 */
export function readNoteTags(frontmatter: Readonly<Frontmatter> | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of ['tags', 'tag']) {
    for (const raw of tagNames(readProperty(frontmatter, key))) {
      const name = raw.trim().replace(/^#+/, '');
      if (name === '') continue;
      const lower = name.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(name);
    }
  }
  return out;
}
