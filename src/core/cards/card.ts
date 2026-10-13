// What one index card on the corkboard shows.

import { noteTitle } from './coreImports';
import type { Frontmatter } from './coreImports';
import type { CardColor } from './colors';
import { PREVIEW_LENGTH, derivePreview } from './preview';
import { readSceneFields } from './sceneFields';
import { findTag } from './tags';
import type { TagList } from './tags';

/** A scene's status or label as a card shows it. */
export interface CardTag {
  /** The name: as the list spells it when the list has it, otherwise as the scene does. */
  readonly name: string;
  /** Its colour; null for none. */
  readonly color: CardColor | null;
  /** False when the scene names a status or label that is not in the project's list. */
  readonly listed: boolean;
}

/** How far a scene is toward its word target. */
export interface TargetProgress {
  readonly words: number;
  readonly target: number;
  /** From 0 to 1, for the width of a progress bar; stays at 1 once the target is passed. */
  readonly fraction: number;
  /** Whole per cent, rounded down, so 100 shows only once the target is reached; goes above 100 beyond it. */
  readonly percent: number;
  /** Words still to write; 0 once the target is reached. */
  readonly remaining: number;
  readonly reached: boolean;
}

/** What is known about a scene when its card is made. */
export interface SceneCardInput {
  /** The scene's path relative to the project folder, for example "Manuscript/Opening.md". */
  readonly path: string;
  /** The note's properties; null or left out when it has none or they are not known yet. */
  readonly frontmatter?: Readonly<Frontmatter> | null;
  /**
   * The whole text of the note. Only needed when the scene has no synopsis
   * of its own (see hasSynopsis); without it such a card has an empty synopsis.
   */
  readonly text?: string | null;
  /** The scene's word count: null when it cannot be read, left out while it is still being counted. */
  readonly words?: number | null;
  /** True when the binder lists the scene but its note is not in the vault. */
  readonly missing?: boolean;
}

/** The project's two lists, which give statuses and labels their colours. */
export interface CardLists {
  readonly statuses: TagList;
  readonly labels: TagList;
}

/** One scene as an index card. */
export interface SceneCard {
  readonly kind: 'scene';
  /** The scene's path relative to the project folder; also its identity. */
  readonly path: string;
  /** The file name without its extension. */
  readonly title: string;
  /** The scene's synopsis, or a preview of its text when it has none. "" when there is neither. */
  readonly synopsis: string;
  /** True when `synopsis` was taken from the scene's text instead of its synopsis property. */
  readonly synopsisDerived: boolean;
  /** Null when the scene has no status. */
  readonly status: CardTag | null;
  /** Null when the scene has no label. */
  readonly label: CardTag | null;
  /** The word count; null when it is not known (still being counted, unreadable, or the note is missing). */
  readonly words: number | null;
  /** The word target; null when none is set. */
  readonly target: number | null;
  /** Progress toward the target; null when there is no target or the words are not known. */
  readonly progress: TargetProgress | null;
  /** True when the note is not in the vault. The card stays on the board, marked. */
  readonly missing: boolean;
  /** Whether the scene goes into the compiled manuscript. */
  readonly compile: boolean;
}

/**
 * Progress toward a word target. Null when there is no target (null, zero or
 * less) or the word count is not known.
 */
export function targetProgress(
  words: number | null | undefined,
  target: number | null | undefined,
): TargetProgress | null {
  if (typeof words !== 'number' || !Number.isFinite(words)) return null;
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) return null;
  const written = Math.max(0, Math.round(words));
  return {
    words: written,
    target,
    fraction: Math.min(1, written / target),
    percent: Math.floor((written * 100) / target),
    remaining: Math.max(0, target - written),
    reached: written >= target,
  };
}

function cardTag(list: TagList, name: string | null): CardTag | null {
  if (name === null) return null;
  const tag = findTag(list, name);
  return tag ? { name: tag.name, color: tag.color, listed: true } : { name, color: null, listed: false };
}

/**
 * Build the index card for one scene.
 *
 * @param lists         the project's statuses and labels (see readTagLists)
 * @param previewLength about how long a synopsis taken from the text may be
 */
export function buildSceneCard(
  scene: SceneCardInput,
  lists: CardLists,
  previewLength: number = PREVIEW_LENGTH,
): SceneCard {
  const fields = readSceneFields(scene.frontmatter);
  const missing = scene.missing === true;

  let synopsis = fields.synopsis;
  let synopsisDerived = false;
  if (synopsis.trim() === '') {
    synopsis = typeof scene.text === 'string' ? derivePreview(scene.text, previewLength) : '';
    synopsisDerived = synopsis !== '';
  }

  const counted = scene.words;
  const words =
    !missing && typeof counted === 'number' && Number.isFinite(counted) ? Math.max(0, Math.round(counted)) : null;

  return {
    kind: 'scene',
    path: scene.path,
    title: noteTitle(scene.path),
    synopsis,
    synopsisDerived,
    status: cardTag(lists.statuses, fields.status),
    label: cardTag(lists.labels, fields.label),
    words,
    target: fields.target,
    progress: targetProgress(words, fields.target),
    missing,
    compile: fields.compile,
  };
}
