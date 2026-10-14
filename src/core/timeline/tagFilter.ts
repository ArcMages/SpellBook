// The timeline's filter by tags and by kind: show only what carries some of
// the chosen tags (or all of them), and only some kinds of things: events,
// scenes, or the entities of some types of the world.
//
// Pure: no page, no vault. The filter is a choice of one device (kept with
// the timeline's other view choices), so whatever comes back from storage is
// checked here before it is used.
//
// Tags are matched as Obsidian matches them: without the "#", whatever their
// capitals, and a tag also matches the tags nested under it ("royalty" matches
// "royalty/king"). Any language: a Hebrew tag is matched like any other.

import { clashKey } from './../paths';

/** How the chosen tags are matched: one of them is enough, or every one is needed. */
export type TagMatch = 'any' | 'all';

/** The kind of the timeline's events (notes of the Timeline folder). */
export const EVENTS_KIND = 'events';
/** The kind of the manuscript's scenes. */
export const SCENES_KIND = 'scenes';
/** The kind of the entities of one type of the world is this, followed by the type's id. */
export const TYPE_KIND_PREFIX = 'type:';

/** The kind of the entities of a type of the world. */
export function typeKind(typeId: string): string {
  return `${TYPE_KIND_PREFIX}${typeId}`;
}

/** The filter by tags and by kind one device shows the timeline with. */
export interface TagFilter {
  /** The tags chosen, without "#", as the writer spells them. Empty: tags narrow nothing. */
  readonly tags: readonly string[];
  readonly match: TagMatch;
  /** The kinds shown (EVENTS_KIND, SCENES_KIND, typeKind(id)). Empty: every kind. */
  readonly kinds: readonly string[];
}

/** The filter that narrows nothing. */
export const NO_TAG_FILTER: TagFilter = Object.freeze({ tags: Object.freeze([]), match: 'any', kinds: Object.freeze([]) });

/** No more than this many tags or kinds are kept in a filter. */
export const MAX_FILTER_ITEMS = 100;

/** A tag as it is compared: no "#", no spaces at the ends, one way of writing each letter, small letters. */
export function tagKey(tag: string): string {
  const trimmed = tag.trim();
  return clashKey(trimmed.startsWith('#') ? trimmed.slice(1) : trimmed);
}

/** True when the filter narrows anything. */
export function isTagFilterActive(filter: TagFilter | null | undefined): boolean {
  return filter != null && (filter.tags.length > 0 || filter.kinds.length > 0);
}

function tidyList(value: unknown, key: (text: string) => string): string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim().replace(/^#/, '');
    const k = key(text);
    if (text === '' || k === '' || seen.has(k)) continue;
    seen.add(k);
    kept.push(text);
    if (kept.length >= MAX_FILTER_ITEMS) break;
  }
  return kept;
}

/** A filter from whatever was stored: anything that does not make sense is left out. */
export function readTagFilter(value: unknown): TagFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return NO_TAG_FILTER;
  const record = value as Record<string, unknown>;
  const tags = tidyList(record['tags'], tagKey);
  const kinds = tidyList(record['kinds'], (text) => text);
  const match: TagMatch = record['match'] === 'all' ? 'all' : 'any';
  if (tags.length === 0 && kinds.length === 0 && match === 'any') return NO_TAG_FILTER;
  return { tags, match, kinds };
}

/** True when two filters say the same (tags whatever their capitals, in any order). */
export function sameTagFilter(a: TagFilter, b: TagFilter): boolean {
  const set = (items: readonly string[], key: (text: string) => string): string =>
    [...new Set(items.map(key))].sort().join('\n');
  // The way of matching makes no difference while no tag is chosen.
  const match = (filter: TagFilter): string => (filter.tags.length === 0 ? 'any' : filter.match);
  return set(a.tags, tagKey) === set(b.tags, tagKey) && set(a.kinds, (k) => k) === set(b.kinds, (k) => k) && match(a) === match(b);
}

/** True when a tag of a note answers to a tag chosen: the same tag, or one nested under it. */
function answers(chosen: string, own: readonly string[]): boolean {
  return own.some((tag) => tag === chosen || tag.startsWith(`${chosen}/`));
}

/**
 * True when something with these tags, of this kind, passes the filter.
 *
 * @param tags the thing's own tags, with or without "#"
 * @param kind EVENTS_KIND, SCENES_KIND or typeKind(id)
 */
export function passesTagFilter(filter: TagFilter, tags: readonly string[], kind: string): boolean {
  if (filter.kinds.length > 0 && !filter.kinds.includes(kind)) return false;
  if (filter.tags.length === 0) return true;
  const own = tags.map(tagKey);
  const chosen = filter.tags.map(tagKey);
  return filter.match === 'all' ? chosen.every((tag) => answers(tag, own)) : chosen.some((tag) => answers(tag, own));
}

/** One tag used in the project, and on how many things. */
export interface TagCount {
  /** As it is first written in the project, without "#". */
  readonly tag: string;
  readonly count: number;
}

/**
 * Every tag the things carry, each with the number of things that carry it,
 * the most used first (then by name). A tag nested under another counts
 * once for itself; capitals do not make two tags.
 *
 * @param lists the tags of each thing, one list per thing
 */
export function countTags(lists: Iterable<readonly string[]>): TagCount[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const raw of list) {
      const tag = raw.trim().replace(/^#/, '');
      const key = tagKey(tag);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      const found = counts.get(key);
      if (found) found.count++;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** The tags that have the search text in them, whatever its capitals; all of them for an empty search. */
export function searchTags(all: readonly TagCount[], query: string): TagCount[] {
  const wanted = tagKey(query);
  return wanted === '' ? [...all] : all.filter((entry) => tagKey(entry.tag).includes(wanted));
}

/**
 * What the filter shows, in words, for the line above the timeline:
 * "#royalty or #war - Characters, Events".
 *
 * @param kindName the name of a kind ("Events", "Characters"); null for one that is not known (it is left out)
 */
export function describeTagFilter(filter: TagFilter, kindName: (kind: string) => string | null): string {
  const parts: string[] = [];
  if (filter.tags.length > 0) parts.push(filter.tags.map((tag) => `#${tag}`).join(filter.match === 'all' ? ' and ' : ' or '));
  const kinds = filter.kinds.map(kindName).filter((name): name is string => name !== null);
  if (kinds.length > 0) parts.push(`only ${kinds.join(', ')}`);
  return parts.join(' - ');
}
