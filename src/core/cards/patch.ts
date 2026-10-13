// A change to a note's properties, written down as plain data.
//
// The engine never writes a file. It says which keys to set and which to
// remove; whoever owns the file applies that inside its own read-change-save
// step. Keys a patch does not name are never touched.

import type { Frontmatter } from './coreImports';

/** A change to a note's properties. Keys that are not named stay exactly as they are. */
export interface FrontmatterPatch {
  /** Keys to give a new value. */
  readonly set: Readonly<Record<string, unknown>>;
  /** Keys to take out altogether. */
  readonly remove: readonly string[];
}

/** One scene together with the change its properties need. */
export interface ScenePatch {
  /** The scene's path, as it was handed in. */
  readonly path: string;
  readonly patch: FrontmatterPatch;
}

/** A scene and the properties it currently has; what the helpers that look across scenes take. */
export interface SceneProperties {
  readonly path: string;
  /** Null or undefined when the note has no properties (or they are not known). */
  readonly frontmatter?: Readonly<Frontmatter> | null;
}

/** A patch that changes nothing. Frozen, because the same object is handed out every time. */
export const EMPTY_PATCH: FrontmatterPatch = Object.freeze({
  set: Object.freeze({}),
  remove: Object.freeze([] as string[]),
});

/** True when a patch changes nothing. */
export function isEmptyPatch(patch: FrontmatterPatch): boolean {
  return Object.keys(patch.set).length === 0 && patch.remove.length === 0;
}

function has(frontmatter: Readonly<Frontmatter>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(frontmatter, key);
}

/**
 * Apply a patch to a note's properties, in place. Returns true when something
 * really changed, false when the properties already were that way, which is
 * what a "save only if changed" step needs to know.
 *
 * A key that is set keeps its place among the other keys; a new key goes at
 * the end. Every other key is left alone.
 */
export function applyFrontmatterPatch(frontmatter: Frontmatter, patch: FrontmatterPatch): boolean {
  let changed = false;
  for (const key of Object.keys(patch.set)) {
    const value = patch.set[key];
    if (has(frontmatter, key) && Object.is(frontmatter[key], value)) continue;
    frontmatter[key] = value;
    changed = true;
  }
  for (const key of patch.remove) {
    if (!has(frontmatter, key)) continue;
    delete frontmatter[key];
    changed = true;
  }
  return changed;
}
