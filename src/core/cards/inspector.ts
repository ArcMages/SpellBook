// The inspector: the panel that shows and edits the properties of the open scene.
//
// Five things can be edited: the synopsis, the status, the label, the word
// target and whether the scene is compiled. The two dates are shown only.
// An edit never becomes a file write here; it becomes the smallest patch
// that makes the properties say what the writer asked for.

import { formatCount, noteTitle, tidyDisplayName } from './coreImports';
import type { Frontmatter } from './coreImports';
import type { CardLists } from './card';
import type { CardColor } from './colors';
import type { FrontmatterPatch } from './patch';
import { MAX_TARGET, formatDisplayDate, parseTargetText, readSceneFields } from './sceneFields';
import { findTag, sameTagName } from './tags';
import type { TagList } from './tags';

/** The fields of the inspector that can be edited. */
export type InspectorField = 'synopsis' | 'status' | 'label' | 'target' | 'compile';

/** One choice in the inspector's status or label picker. */
export interface TagOption {
  readonly name: string;
  readonly color: CardColor | null;
  /** False for the scene's own status or label when the project's list does not have it. */
  readonly listed: boolean;
  /** True for the one the scene has now. None is selected when the scene has none. */
  readonly selected: boolean;
}

/** What the inspector shows for the open scene. */
export interface InspectorModel {
  /** The scene's path, as it was handed in. */
  readonly path: string;
  /** The file name without its extension. */
  readonly title: string;
  /** The synopsis exactly as stored; "" when there is none. */
  readonly synopsis: string;
  /** The scene's status as the picker names it; null when it has none. */
  readonly status: string | null;
  /** The statuses to choose from: the project's list, then the scene's own when the list lacks it. */
  readonly statusOptions: readonly TagOption[];
  /** The scene's label as the picker names it; null when it has none. */
  readonly label: string | null;
  /** The labels to choose from: the project's list, then the scene's own when the list lacks it. */
  readonly labelOptions: readonly TagOption[];
  /** The word target; null when none is set. */
  readonly target: number | null;
  /** Whether the scene goes into the compiled manuscript. */
  readonly compile: boolean;
  /** The date the scene was created, as YYYY-MM-DD; null when not known. Shown, not edited. */
  readonly created: string | null;
  /** The created date as shown, for example "13 Oct 2026"; "" when not known. */
  readonly createdText: string;
  /** The date the scene was last edited, as YYYY-MM-DD; null when not known. Shown, not edited. */
  readonly edited: string | null;
  /** The edited date as shown, for example "13 Oct 2026"; "" when not known. */
  readonly editedText: string;
  /** Properties of the scene that could not be understood, each in a plain sentence. */
  readonly problems: readonly string[];
}

function options(list: TagList, current: string | null): { name: string | null; options: TagOption[] } {
  const chosen = current === null ? null : findTag(list, current);
  const out = list.tags.map(
    (tag): TagOption => ({ name: tag.name, color: tag.color, listed: true, selected: tag === chosen }),
  );
  if (current !== null && chosen === null) out.push({ name: current, color: null, listed: false, selected: true });
  return { name: chosen ? chosen.name : current, options: out };
}

/**
 * Build what the inspector shows for a scene.
 *
 * @param scene the open scene: its path and its properties (null when it has none)
 * @param lists the project's statuses and labels (see readTagLists)
 */
export function buildInspector(
  scene: { readonly path: string; readonly frontmatter?: Readonly<Frontmatter> | null },
  lists: CardLists,
): InspectorModel {
  const fields = readSceneFields(scene.frontmatter);
  const status = options(lists.statuses, fields.status);
  const label = options(lists.labels, fields.label);
  return {
    path: scene.path,
    title: noteTitle(scene.path),
    synopsis: fields.synopsis,
    status: status.name,
    statusOptions: status.options,
    label: label.name,
    labelOptions: label.options,
    target: fields.target,
    compile: fields.compile,
    created: fields.created,
    createdText: formatDisplayDate(fields.created),
    edited: fields.edited,
    editedText: formatDisplayDate(fields.edited),
    problems: fields.problems,
  };
}

/**
 * Edits made in the inspector. Name only the fields the writer changed; a
 * field that is left out is not looked at.
 */
export interface InspectorEdits {
  /** The synopsis as typed. It is stored exactly so. */
  readonly synopsis?: string;
  /** The status name; null or "" for none. */
  readonly status?: string | null;
  /** The label name; null or "" for none. */
  readonly label?: string | null;
  /** The word target: a whole number, or the text typed into the box; null, "" or 0 for no target. */
  readonly target?: number | string | null;
  /** Whether the scene goes into the compiled manuscript. */
  readonly compile?: boolean;
}

/** Why an edit was not accepted. */
export interface InspectorError {
  readonly field: InspectorField;
  /** The reason in a plain sentence, fit to show beside the field. */
  readonly message: string;
}

/** What the edits come to. */
export type InspectorResult =
  | {
      readonly ok: true;
      /** The change to make to the scene's properties; empty when nothing really changed. */
      readonly patch: FrontmatterPatch;
      /** The fields that really changed. */
      readonly changed: readonly InspectorField[];
    }
  | {
      readonly ok: false;
      /** Every edit that was not accepted. Nothing should be written. */
      readonly errors: readonly InspectorError[];
    };

/**
 * Read a target typed into the inspector: digits, with or without commas
 * ("1500", "1,500"). An empty box or a zero means no target.
 */
export function parseTargetInput(
  input: number | string | null | undefined,
): { readonly ok: true; readonly target: number | null } | { readonly ok: false; readonly message: string } {
  const problem = (message: string): { ok: false; message: string } => ({ ok: false, message });
  const limit = `A target can be at most ${formatCount(MAX_TARGET)} words.`;
  if (input === null || input === undefined) return { ok: true, target: null };
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || !Number.isInteger(input) || input < 0) {
      return problem('A target is a whole number of words.');
    }
    if (input > MAX_TARGET) return problem(limit);
    return { ok: true, target: input === 0 ? null : input };
  }
  if (typeof input !== 'string') return problem('A target is a whole number of words.');
  const parsed = parseTargetText(input);
  if (parsed !== 'invalid') return { ok: true, target: parsed };
  const digits = input.trim().split(',').join('');
  return problem(/^\d+$/.test(digits) ? limit : 'A target is a whole number of words.');
}

function editedName(
  field: 'status' | 'label',
  value: unknown,
  list: TagList | undefined,
): { ok: true; name: string | null } | { ok: false; error: InspectorError } {
  if (value === null) return { ok: true, name: null };
  if (typeof value !== 'string') {
    return { ok: false, error: { field, message: `The ${field} must be a name, or nothing.` } };
  }
  const tidy = tidyDisplayName(value);
  if (tidy === '') return { ok: true, name: null };
  // A name that is in the project's list is stored the way the list spells it.
  const listed = list ? findTag(list, tidy) : null;
  return { ok: true, name: listed ? listed.name : tidy };
}

/**
 * Check edits made in the inspector and work out the smallest change to the
 * scene's properties.
 *
 * Only keys that really change are in the patch: a field set to what the
 * scene already says is left out, and so is a status or label that differs
 * from the stored one only in capitals. Clearing the target removes its key;
 * clearing the synopsis, status or label stores an empty text. The created
 * and edited dates, and every key this engine does not know, are never in
 * the patch. When any edit is not acceptable, nothing is: the result lists
 * the errors and carries no patch.
 *
 * Work it out against the properties as they are on disk at the moment of
 * writing, so that a change made on another device is not undone.
 *
 * @param frontmatter the scene's properties now (null when it has none)
 * @param edits       the fields the writer changed
 * @param lists       the project's statuses and labels; when given, a name that
 *                    is in a list is stored the way the list spells it
 */
export function inspectorPatch(
  frontmatter: Readonly<Frontmatter> | null | undefined,
  edits: InspectorEdits,
  lists?: CardLists,
): InspectorResult {
  const fields = readSceneFields(frontmatter);
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  const changed: InspectorField[] = [];
  const errors: InspectorError[] = [];

  if (edits.synopsis !== undefined) {
    if (typeof edits.synopsis !== 'string') {
      errors.push({ field: 'synopsis', message: 'The synopsis must be text.' });
    } else if (edits.synopsis !== fields.synopsis) {
      set['synopsis'] = edits.synopsis;
      changed.push('synopsis');
    }
  }

  for (const field of ['status', 'label'] as const) {
    const value = edits[field];
    if (value === undefined) continue;
    const edited = editedName(field, value, field === 'status' ? lists?.statuses : lists?.labels);
    if (!edited.ok) {
      errors.push(edited.error);
      continue;
    }
    const current = fields[field];
    const same =
      edited.name === null || current === null ? edited.name === current : sameTagName(edited.name, current);
    if (same) continue;
    set[field] = edited.name ?? '';
    changed.push(field);
  }

  if (edits.target !== undefined) {
    const parsed = parseTargetInput(edits.target);
    if (!parsed.ok) {
      errors.push({ field: 'target', message: parsed.message });
    } else if (parsed.target !== fields.target) {
      if (parsed.target === null) remove.push('target');
      else set['target'] = parsed.target;
      changed.push('target');
    }
  }

  if (edits.compile !== undefined) {
    if (typeof edits.compile !== 'boolean') {
      errors.push({ field: 'compile', message: 'Compile must be yes or no.' });
    } else if (edits.compile !== fields.compile) {
      set['compile'] = edits.compile;
      changed.push('compile');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, patch: { set, remove }, changed };
}
