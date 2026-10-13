// What a device remembers of the continuous manuscript, for each project:
// which part of the binder was on show, and how far the writer had read.
//
// It is saved as text (JSON) in the device's own storage and never synced.
// Whatever comes back is checked before it is used, because it can be
// anything: an older version's data, or something edited by hand.

import type { ScriveningsScope } from './scenes';

/** The place the writer had come to: so far into such a scene. */
export interface RememberedPlace {
  /** The scene's path, relative to the project folder. */
  readonly path: string;
  /** How far into the scene, from 0 (its top) to 1 (its end). */
  readonly fraction: number;
}

/** What is remembered of one project. */
export interface RememberedView {
  readonly scope: ScriveningsScope;
  /** Null for the top of the manuscript. */
  readonly place: RememberedPlace | null;
}

/** What is remembered, by the vault path of each project's index note. The project last looked at comes last. */
export type ScriveningsMemory = ReadonlyMap<string, RememberedView>;

/** No more than this many projects are remembered; the ones looked at longest ago are forgotten first. */
export const MAX_REMEMBERED_PROJECTS = 40;

export const DEFAULT_VIEW: RememberedView = { scope: { kind: 'manuscript' }, place: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readScope(value: unknown): ScriveningsScope {
  if (isRecord(value) && value['kind'] === 'folder' && typeof value['id'] === 'string' && value['id'] !== '') {
    return { kind: 'folder', id: value['id'] };
  }
  return { kind: 'manuscript' };
}

function readPlace(value: unknown): RememberedPlace | null {
  if (!isRecord(value)) return null;
  const path = value['path'];
  const fraction = value['fraction'];
  if (typeof path !== 'string' || path === '') return null;
  const far = typeof fraction === 'number' && Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return { path, fraction: far };
}

/** Read what the storage gave back: JSON text, or what that text stands for. Anything else is nothing. */
export function readMemory(stored: unknown): Map<string, RememberedView> {
  const memory = new Map<string, RememberedView>();
  let value = stored;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return memory;
    }
  }
  if (!isRecord(value)) return memory;
  for (const [indexPath, view] of Object.entries(value)) {
    if (indexPath === '' || !isRecord(view)) continue;
    memory.set(indexPath, { scope: readScope(view['scope']), place: readPlace(view['place']) });
  }
  while (memory.size > MAX_REMEMBERED_PROJECTS) {
    const oldest = memory.keys().next();
    if (oldest.done === true) break;
    memory.delete(oldest.value);
  }
  return memory;
}

/** The text to save. Null when there is nothing worth remembering. */
export function writeMemory(memory: ScriveningsMemory): string | null {
  const out: Record<string, { scope: ScriveningsScope; place: RememberedPlace | null }> = {};
  let any = false;
  for (const [indexPath, view] of memory) {
    if (view.scope.kind === 'manuscript' && view.place === null) continue;
    // Three decimals are a fraction of a line: more would only make the text longer.
    const place = view.place === null ? null : { path: view.place.path, fraction: Math.round(view.place.fraction * 1000) / 1000 };
    out[indexPath] = { scope: view.scope, place };
    any = true;
  }
  return any ? JSON.stringify(out) : null;
}

/**
 * The memory with one project's view put in, as the one looked at last.
 * The others are left as they were, and the oldest go when there are too many.
 */
export function remember(memory: ScriveningsMemory, indexPath: string, view: RememberedView): Map<string, RememberedView> {
  const next = new Map(memory);
  next.delete(indexPath);
  next.set(indexPath, view);
  while (next.size > MAX_REMEMBERED_PROJECTS) {
    const oldest = next.keys().next();
    if (oldest.done === true) break;
    next.delete(oldest.value);
  }
  return next;
}

/** The memory after a project's index note moved: what was remembered of it goes with it. */
export function moveRemembered(memory: ScriveningsMemory, from: string, to: string): Map<string, RememberedView> {
  const next = new Map(memory);
  const view = next.get(from);
  if (view === undefined || from === to) return next;
  next.delete(from);
  next.set(to, view);
  return next;
}
