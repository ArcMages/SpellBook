// Progress toward a word target, as the Target column shows it: a percentage,
// a bar filled that far, and one of four colour bands.

import { targetProgress } from '../cards';

/**
 * How far along a target is:
 *   low   under 50 per cent
 *   mid   50 to 79
 *   near  80 to 99
 *   done  100 and over
 */
export type TargetBand = 'low' | 'mid' | 'near' | 'done';

export const TARGET_BANDS: readonly TargetBand[] = ['low', 'mid', 'near', 'done'];

/** The band a percentage falls in. */
export function targetBand(percent: number): TargetBand {
  if (!(percent >= 50)) return 'low';
  if (percent < 80) return 'mid';
  if (percent < 100) return 'near';
  return 'done';
}

/** What a Target cell shows. */
export interface TargetCell {
  /** The target, in words. */
  readonly target: number;
  /** The words written toward it; null while they are not known. */
  readonly words: number | null;
  /** Whole per cent, rounded down, so 100 shows only once the target is reached; null while the words are not known. */
  readonly percent: number | null;
  /** How far the bar is filled, from 0 to 100. */
  readonly fill: number;
  readonly band: TargetBand | null;
}

/**
 * Work out a Target cell. Null when there is no target (none set, or zero or
 * less): such a cell shows nothing.
 *
 * @param words  the words written; null or left out while they are not known
 * @param target the target in words
 */
export function targetCell(words: number | null | undefined, target: number | null | undefined): TargetCell | null {
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) return null;
  const progress = targetProgress(words, target);
  if (!progress) return { target, words: null, percent: null, fill: 0, band: null };
  return {
    target,
    words: progress.words,
    percent: progress.percent,
    fill: Math.round(progress.fraction * 100),
    band: targetBand(progress.percent),
  };
}

/** The percentage as the cell says it: "63%"; nothing while it is not known. */
export function formatPercent(cell: TargetCell | null): string {
  return cell === null || cell.percent === null ? '' : `${cell.percent}%`;
}
