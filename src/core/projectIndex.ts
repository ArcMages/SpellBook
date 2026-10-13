// Reading and writing the project index: the frontmatter of <Project>/<Project>.md.
//
//   spellbook: project
//   version: 1
//   title: My Novel
//   binder:
//     - Manuscript/Opening.md
//     - folder: Part one
//       id: f-k3x9q2
//       children:
//         - Manuscript/The Letter.md
//
// The rule this file keeps: data that cannot be understood is reported, never
// guessed at, so the store can refuse to write it.

import { dropDuplicateScenes } from './binderTree';
import { normaliseRelativePath } from './paths';
import type { Binder, BinderNode, FolderNode, Frontmatter } from './types';

export const INDEX_MARKER_KEY = 'spellbook';
export const INDEX_MARKER_VALUE = 'project';
/** The newest index layout this version of the plugin understands. */
export const INDEX_VERSION = 1;

const FOLDER_KEYS = new Set(['folder', 'id', 'children']);

export type ParsedIndex =
  | {
      readonly ok: true;
      /** The title property, or null when the note has none. */
      readonly title: string | null;
      readonly binder: Binder;
      /** What was tidied up while reading, in plain language. */
      readonly notes: readonly string[];
    }
  | {
      readonly ok: false;
      readonly title: string | null;
      /** Why the index cannot be used, in plain language. */
      readonly error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when a note's frontmatter marks it as a Spellbook project index. */
export function isProjectIndex(frontmatter: unknown): frontmatter is Frontmatter {
  return isRecord(frontmatter) && frontmatter[INDEX_MARKER_KEY] === INDEX_MARKER_VALUE;
}

/** The title property of an index, or null when it is missing or not text. */
export function readTitle(frontmatter: Readonly<Frontmatter>): string | null {
  const title = frontmatter['title'];
  return typeof title === 'string' && title.trim() !== '' ? title : null;
}

class IndexProblem extends Error {}

/** Small, stable hash for folders that were written by hand without an id. */
function hashName(name: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return 'an empty entry';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a group of properties';
  return `the ${typeof value} ${JSON.stringify(value)}`;
}

/** Collect every folder id that is written out, so made-up ids never collide with one. */
function collectWrittenIds(raw: unknown, into: Set<string>): void {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item['id'] === 'string') into.add(item['id']);
    collectWrittenIds(item['children'], into);
  }
}

interface ParseContext {
  readonly writtenIds: Set<string>;
  readonly usedIds: Set<string>;
  readonly notes: string[];
}

function uniqueId(base: string, context: ParseContext, avoidWritten: boolean): string {
  const taken = (id: string): boolean =>
    context.usedIds.has(id) || (avoidWritten && context.writtenIds.has(id));
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate) && !context.writtenIds.has(candidate)) return candidate;
  }
}

function parseNodes(raw: unknown, where: string, context: ParseContext): BinderNode[] {
  if (!Array.isArray(raw)) {
    throw new IndexProblem(`${where} should be a list, but it is ${describe(raw)}.`);
  }
  return raw.map((item: unknown, position): BinderNode => {
    const here = `Entry ${position + 1} of ${where}`;
    if (typeof item === 'string') {
      const path = normaliseRelativePath(item);
      if (path === null) {
        throw new IndexProblem(
          `${here} ("${item}") is not a path inside the project folder.`,
        );
      }
      return { kind: 'scene', path };
    }
    if (!isRecord(item)) {
      throw new IndexProblem(
        `${here} should be a scene path or a folder, but it is ${describe(item)}.`,
      );
    }
    const name = item['folder'];
    if (typeof name !== 'string') {
      throw new IndexProblem(
        `${here} looks like a folder, but its "folder" name is ${describe(name)}. ` +
          'A folder name must be text (put it in quotes if it is a number or contains a colon).',
      );
    }
    const rawId = item['id'];
    let id: string;
    if (rawId === undefined || rawId === null) {
      id = uniqueId(`f-${hashName(name)}`, context, true);
    } else if (typeof rawId === 'string' && rawId.trim() !== '') {
      id = uniqueId(rawId, context, false);
      if (id !== rawId) {
        context.notes.push(`Two folders shared the id "${rawId}"; the second one ("${name}") was given a new id.`);
      }
    } else {
      throw new IndexProblem(`The folder "${name}" has an id that is not text: ${describe(rawId)}.`);
    }
    context.usedIds.add(id);

    const rawChildren = item['children'];
    const children =
      rawChildren === undefined || rawChildren === null
        ? []
        : parseNodes(rawChildren, `the folder "${name}"`, context);

    const extra: Record<string, unknown> = {};
    let hasExtra = false;
    for (const [key, value] of Object.entries(item)) {
      if (FOLDER_KEYS.has(key)) continue;
      extra[key] = value;
      hasExtra = true;
    }
    const folder: FolderNode = hasExtra
      ? { kind: 'folder', id, name, children, extra }
      : { kind: 'folder', id, name, children };
    return folder;
  });
}

/**
 * Read the frontmatter of a project index.
 *
 * When the binder (or the version) cannot be understood the result is
 * `ok: false` with a reason, and the caller must treat the project as
 * read-only. Repeated scene paths are not an error: the first one is kept.
 */
export function parseProjectIndex(frontmatter: Readonly<Frontmatter>): ParsedIndex {
  const title = readTitle(frontmatter);

  const version = frontmatter['version'];
  if (version !== undefined && version !== null) {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return {
        ok: false,
        title,
        error: `The "version" property should be the number ${INDEX_VERSION}, but it is ${describe(version)}.`,
      };
    }
    if (version > INDEX_VERSION) {
      return {
        ok: false,
        title,
        error:
          `This project was saved by a newer version of Spellbook (layout ${version}; ` +
          `this version understands layout ${INDEX_VERSION}). Update the plugin on this device to edit it.`,
      };
    }
  }

  const rawBinder = frontmatter['binder'];
  if (rawBinder === undefined || rawBinder === null) {
    return { ok: true, title, binder: [], notes: [] };
  }

  const context: ParseContext = { writtenIds: new Set(), usedIds: new Set(), notes: [] };
  collectWrittenIds(rawBinder, context.writtenIds);
  let parsed: BinderNode[];
  try {
    parsed = parseNodes(rawBinder, 'the binder', context);
  } catch (problem) {
    if (problem instanceof IndexProblem) return { ok: false, title, error: problem.message };
    throw problem;
  }

  const { binder, dropped } = dropDuplicateScenes(parsed);
  for (const path of dropped) {
    context.notes.push(`"${path}" was listed more than once in the binder; only the first place is used.`);
  }
  return { ok: true, title, binder, notes: context.notes };
}

/** The binder as plain data, ready to be stored as YAML. */
export function serialiseBinder(binder: Binder): unknown[] {
  return binder.map((node): unknown => {
    if (node.kind === 'scene') return node.path;
    return {
      folder: node.name,
      id: node.id,
      children: serialiseBinder(node.children),
      ...(node.extra ?? {}),
    };
  });
}

/**
 * Store a binder in an index's frontmatter, in place. Only the "binder"
 * property is touched; every other property, known or not, stays as it is.
 */
export function writeBinder(frontmatter: Frontmatter, binder: Binder): void {
  frontmatter['binder'] = serialiseBinder(binder);
}

/** Frontmatter for the index of a brand-new project. */
export function newIndexFrontmatter(title: string): Frontmatter {
  return {
    [INDEX_MARKER_KEY]: INDEX_MARKER_VALUE,
    version: INDEX_VERSION,
    title,
    binder: [],
  };
}
