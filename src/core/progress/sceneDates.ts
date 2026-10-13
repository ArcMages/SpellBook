// The two dates a scene carries in its properties: "created" and "edited".
//
//  - created is written once. A date that is already there always wins;
//    otherwise the note's file creation date is used, once.
//  - edited becomes the day the scene was last typed in on this device. It is
//    written at most once per scene per day, and only when the writer leaves
//    the scene (another note opens, its tab closes, the app goes to the
//    background, the plugin unloads). Never while typing: saving a note's
//    properties under a writer's fingers disturbs the editor.
//
// Nothing here touches a file. One part decides, from the events of the
// editor, which scenes are due a write. The other says, for one scene's
// properties, exactly which of the two dates to set.

import { isDateText } from './../dates';
import { pathKey } from './../paths';
import type { Frontmatter } from './../types';
import { readDateProperty } from './calendar';

/** What is remembered between events. Treated as immutable; start with emptySceneDates(). */
export interface SceneDatesState {
  /** Scenes typed in and not yet written: vault path, and the day they were last typed in. */
  readonly waiting: ReadonlyMap<string, string>;
  /** Scenes whose "edited" date was written: vault path, and the day that was written. */
  readonly written: ReadonlyMap<string, string>;
}

/** Something that happened in the editor or the app. */
export type SceneDatesEvent =
  /** The writer edited a scene on this device (typing, pasting, cutting, undoing). `date` is the local date. */
  | { readonly type: 'typed'; readonly path: string; readonly date: string }
  /** Another note became the one in front; null when no note is in front any more. */
  | { readonly type: 'opened'; readonly path: string | null }
  /** A note's tab was closed. */
  | { readonly type: 'closed'; readonly path: string }
  /** The app went to the background (or its window was hidden). */
  | { readonly type: 'background' }
  /** The plugin is unloading. */
  | { readonly type: 'unload' }
  /** A scene was renamed or moved. */
  | { readonly type: 'renamed'; readonly from: string; readonly to: string }
  /** A scene was deleted. */
  | { readonly type: 'deleted'; readonly path: string }
  /** A write that was asked for did not happen; it is asked for again when the writer next leaves the scene. */
  | { readonly type: 'failed'; readonly path: string; readonly edited: string };

/** A write that is due: set this scene's "edited" property to this date. */
export interface SceneDateWrite {
  /** The scene's vault path. */
  readonly path: string;
  /** The day it was typed in, as YYYY-MM-DD. */
  readonly edited: string;
}

/** The new state after an event, and the writes that are due because of it. */
export interface SceneDatesStep {
  readonly state: SceneDatesState;
  readonly writes: readonly SceneDateWrite[];
}

/** Which of a scene's two dates to set. A date that is left out must not be touched. */
export interface SceneDatePatch {
  readonly created?: string;
  readonly edited?: string;
}

/** The state to start with: nothing waiting, nothing written. */
export function emptySceneDates(): SceneDatesState {
  return { waiting: new Map(), written: new Map() };
}

/**
 * The path a scene is remembered under. The same name may arrive in two
 * Unicode forms (letter plus accent, or one accented letter): that is one
 * scene, known by the form it was first seen in. A scene not seen before
 * keeps the path as given.
 */
function knownPath(state: SceneDatesState, path: string): string {
  if (state.waiting.has(path) || state.written.has(path)) return path;
  const key = pathKey(path);
  for (const map of [state.waiting, state.written]) {
    for (const known of map.keys()) {
      if (pathKey(known) === key) return known;
    }
  }
  return path;
}

/** Write out the waiting scenes that `leaves` picks, and remember that they were written. */
function flush(state: SceneDatesState, leaves: (path: string) => boolean): SceneDatesStep {
  const writes: SceneDateWrite[] = [];
  for (const [path, edited] of state.waiting) {
    if (leaves(path)) writes.push({ path, edited });
  }
  if (writes.length === 0) return { state, writes };
  const waiting = new Map(state.waiting);
  const written = new Map(state.written);
  for (const write of writes) {
    waiting.delete(write.path);
    written.set(write.path, write.edited);
  }
  return { state: { waiting, written }, writes };
}

/**
 * Take one event and say which "edited" writes are due because of it.
 *
 * Typing never causes a write; it only makes the scene wait. The write comes
 * when the writer leaves the scene, and no scene is written twice for the
 * same day.
 */
export function sceneDatesStep(state: SceneDatesState, event: SceneDatesEvent): SceneDatesStep {
  switch (event.type) {
    case 'typed': {
      if (!isDateText(event.date)) return { state, writes: [] };
      const path = knownPath(state, event.path);
      // Already written for this day: once a day is enough.
      if (state.written.get(path) === event.date) return { state, writes: [] };
      const known = state.waiting.get(path);
      if (known !== undefined && known >= event.date) return { state, writes: [] };
      const waiting = new Map(state.waiting);
      waiting.set(path, event.date);
      // Days gone by need not be remembered.
      const written = new Map([...state.written].filter(([, date]) => date >= event.date));
      return { state: { waiting, written }, writes: [] };
    }
    case 'opened': {
      const front = event.path === null ? null : pathKey(event.path);
      return flush(state, (path) => front === null || pathKey(path) !== front);
    }
    case 'closed': {
      const closed = pathKey(event.path);
      return flush(state, (path) => pathKey(path) === closed);
    }
    case 'background':
    case 'unload':
      return flush(state, () => true);
    case 'renamed': {
      const from = knownPath(state, event.from);
      if (from === event.to || (!state.waiting.has(from) && !state.written.has(from))) {
        return { state, writes: [] };
      }
      const move = (map: ReadonlyMap<string, string>): Map<string, string> => {
        const next = new Map(map);
        const date = next.get(from);
        next.delete(from);
        if (date !== undefined) next.set(event.to, date);
        return next;
      };
      return { state: { waiting: move(state.waiting), written: move(state.written) }, writes: [] };
    }
    case 'deleted': {
      const path = knownPath(state, event.path);
      if (!state.waiting.has(path) && !state.written.has(path)) return { state, writes: [] };
      const waiting = new Map(state.waiting);
      const written = new Map(state.written);
      waiting.delete(path);
      written.delete(path);
      return { state: { waiting, written }, writes: [] };
    }
    case 'failed': {
      if (!isDateText(event.edited)) return { state, writes: [] };
      const path = knownPath(state, event.path);
      const waiting = new Map(state.waiting);
      const written = new Map(state.written);
      if (written.get(path) === event.edited) written.delete(path);
      const known = waiting.get(path);
      if (known === undefined || known < event.edited) waiting.set(path, event.edited);
      return { state: { waiting, written }, writes: [] };
    }
    default:
      return { state, writes: [] };
  }
}

const isMissing = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * Which dates to set in a scene's properties. Read the properties from the
 * file first, hand them in, and set only what comes back; when nothing comes
 * back (an empty object), do not save the file at all.
 *
 *  - created: set to the file's creation date only when the scene has no
 *    "created" yet. Whatever is already there wins, even text that is not a date.
 *  - edited: set to the given day, unless the scene already says that day or
 *    a later one (another device may have written it).
 *
 * @param frontmatter      the scene's properties as they are on disk now
 * @param dates.edited      the day the scene was typed in; leave out when it was not
 * @param dates.fileCreated the local date the note's file was created; leave out when not known
 */
export function sceneDatePatch(
  frontmatter: Readonly<Frontmatter> | null,
  dates: { readonly edited?: string | null; readonly fileCreated?: string | null },
): SceneDatePatch {
  const properties: Readonly<Frontmatter> = frontmatter ?? {};
  const patch: { created?: string; edited?: string } = {};

  const fileCreated = dates.fileCreated;
  if (isMissing(properties['created']) && typeof fileCreated === 'string' && isDateText(fileCreated)) {
    patch.created = fileCreated;
  }

  const edited = dates.edited;
  if (typeof edited === 'string' && isDateText(edited)) {
    const current = readDateProperty(properties['edited']);
    if (current === null || current < edited) patch.edited = edited;
  }
  return patch;
}

/**
 * The day a scene was started, for showing on screen: its "created"
 * property, or the file's creation date when the scene has none yet. Null
 * when neither is a real date.
 */
export function sceneStartDate(frontmatter: Readonly<Frontmatter> | null, fileCreated?: string | null): string | null {
  const stored = frontmatter?.['created'];
  if (!isMissing(stored)) return readDateProperty(stored);
  return typeof fileCreated === 'string' && isDateText(fileCreated) ? fileCreated : null;
}

/** The day a scene was last edited, from its "edited" property. Null when it has none or it is not a real date. */
export function sceneEditedDate(frontmatter: Readonly<Frontmatter> | null): string | null {
  return readDateProperty(frontmatter?.['edited']);
}
