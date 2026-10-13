// Showing only some of the scenes: those whose title or synopsis holds a
// piece of text, and those with one of a few chosen statuses or labels.

import { tidyDisplayName } from '../names';
import { clashKey } from '../paths';

/** Which scenes the outliner shows. */
export interface OutlineFilter {
  /** Shown are the scenes whose title or synopsis holds this text (capitals do not count); "" for all. */
  readonly text: string;
  /** Shown are the scenes with one of these statuses; empty for all. NO_TAG stands for "no status". */
  readonly statuses: readonly string[];
  /** Shown are the scenes with one of these labels; empty for all. NO_TAG stands for "no label". */
  readonly labels: readonly string[];
}

/** In a filter's list of statuses or labels: the scenes that have none. */
export const NO_TAG = '';

export const NO_FILTER: OutlineFilter = Object.freeze({
  text: '',
  statuses: Object.freeze([] as string[]),
  labels: Object.freeze([] as string[]),
});

/** No filter keeps more than this many names, or a text longer than this. */
const MAX_NAMES = 100;
const MAX_TEXT = 200;

/** The key two spellings of the same status or label share: capitals and extra spaces do not count. */
export function tagFilterKey(name: string | null | undefined): string {
  return typeof name === 'string' ? clashKey(tidyDisplayName(name)) : NO_TAG;
}

function foldText(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase();
}

/** True when a filter hides anything at all. */
export function isFilterOn(filter: OutlineFilter): boolean {
  return filter.text.trim() !== '' || filter.statuses.length > 0 || filter.labels.length > 0;
}

/** A filter made ready for looking at many scenes. */
export interface PreparedFilter {
  readonly on: boolean;
  readonly text: string;
  readonly statuses: ReadonlySet<string> | null;
  readonly labels: ReadonlySet<string> | null;
}

export function prepareFilter(filter: OutlineFilter): PreparedFilter {
  const keys = (names: readonly string[]): ReadonlySet<string> | null =>
    names.length === 0 ? null : new Set(names.map((name) => tagFilterKey(name)));
  return {
    on: isFilterOn(filter),
    text: foldText(filter.text.trim()),
    statuses: keys(filter.statuses),
    labels: keys(filter.labels),
  };
}

/** What a filter looks at in a scene. */
export interface Filterable {
  readonly title: string;
  readonly synopsis: string;
  readonly status: { readonly name: string } | null;
  readonly label: { readonly name: string } | null;
}

/** Whether a scene passes a filter. Every part of the filter that is set must be met. */
export function matchesFilter(scene: Filterable, filter: PreparedFilter): boolean {
  if (!filter.on) return true;
  if (filter.statuses && !filter.statuses.has(tagFilterKey(scene.status?.name))) return false;
  if (filter.labels && !filter.labels.has(tagFilterKey(scene.label?.name))) return false;
  if (filter.text === '') return true;
  return foldText(scene.title).includes(filter.text) || foldText(scene.synopsis).includes(filter.text);
}

/** True when a filter's list of statuses or labels holds a name (or, for null, "none"). */
export function hasFilterTag(names: readonly string[], name: string | null): boolean {
  const key = tagFilterKey(name);
  return names.some((other) => tagFilterKey(other) === key);
}

/** A filter's list of statuses or labels with one name put in, or taken out when it was in. */
export function toggleFilterTag(names: readonly string[], name: string | null): string[] {
  const key = tagFilterKey(name);
  const without = names.filter((other) => tagFilterKey(other) !== key);
  if (without.length !== names.length) return without;
  return [...names, name === null ? NO_TAG : tidyDisplayName(name)];
}

function readNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const key = tagFilterKey(entry);
    if (seen.has(key) || out.length >= MAX_NAMES) continue;
    seen.add(key);
    out.push(tidyDisplayName(entry));
  }
  return out;
}

/** Read a saved filter. Never throws; whatever cannot be understood counts as "show everything". */
export function readFilter(saved: unknown): OutlineFilter {
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return NO_FILTER;
  const source = saved as Record<string, unknown>;
  const text = typeof source['text'] === 'string' ? source['text'].slice(0, MAX_TEXT) : '';
  const filter: OutlineFilter = { text, statuses: readNames(source['statuses']), labels: readNames(source['labels']) };
  return isFilterOn(filter) ? filter : NO_FILTER;
}
