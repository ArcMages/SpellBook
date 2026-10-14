// Small pieces shared by the timeline files: the shape of a change to a note's
// properties, the eight colour names, and how two lane names are compared.
//
// The files of src/core are reached as "./../name" from this folder.

import { clashKey } from './../paths';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A change to a note's properties: the properties to set, with their new
 * values. A property named with the value undefined is taken away, key and
 * all (a list Spellbook emptied is not left behind as "[]"). Every property
 * that is not named stays exactly as it is, and an empty patch means there
 * is nothing to write.
 */
export type FrontmatterPatch = Readonly<Record<string, unknown>>;

/** True when a patch changes nothing, so the note need not be written at all. */
export function isEmptyPatch(patch: FrontmatterPatch): boolean {
  return Object.keys(patch).length === 0;
}

/**
 * Apply a patch to a note's properties, in place. Meant for the moment of
 * writing: work the patch out from the properties as they are right then.
 */
export function applyFrontmatterPatch(frontmatter: Record<string, unknown>, patch: FrontmatterPatch): void {
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) delete frontmatter[key];
    else frontmatter[key] = value;
  }
}

/** The colours a lane can have. On screen each maps to one of Obsidian's own colour variables. */
export const LANE_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;

/** One of the eight colour names. */
export type LaneColor = (typeof LANE_COLORS)[number];

/** A stored colour as one of the eight names, or null for anything else. */
export function readLaneColor(value: unknown): LaneColor | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  return (LANE_COLORS as readonly string[]).includes(name) ? (name as LaneColor) : null;
}

/** One lane of the timeline as the project index lists it. */
export interface Lane {
  /** The name the writer gave it, in any language. */
  readonly name: string;
  /** One of the eight colour names, or null for no colour. */
  readonly color: LaneColor | null;
}

/** The built-in lane that every dated scene sits in. */
export const MANUSCRIPT_LANE = 'Manuscript';

/** The lane that shows events naming a timeline the project does not list. */
export const OTHER_LANE = 'Other';

/**
 * What two lane names are compared by: capitals do not matter, nor does space
 * around the name, nor which of the equivalent Unicode forms it was typed in.
 */
export function laneKey(name: string): string {
  return clashKey(name.trim());
}

export const MANUSCRIPT_KEY = laneKey(MANUSCRIPT_LANE);
export const OTHER_KEY = laneKey(OTHER_LANE);

/** A stored name: text, or a number written without quotes. Null for anything else, and for an empty name. */
export function readName(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name === '' ? null : name;
}
