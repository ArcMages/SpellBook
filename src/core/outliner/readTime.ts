// How long a scene takes to read.

import { READING_WORDS_PER_MINUTE } from '../wordCount';

/** The reading speed the outliner goes by: the one of the whole plugin. */
export const WORDS_PER_MINUTE = READING_WORDS_PER_MINUTE;

/**
 * The minutes it takes to read a number of words, rounded up to a whole
 * minute (so a short scene is never "0 min"). Null when the words are not
 * known; 0 for no words at all.
 */
export function readMinutes(words: number | null | undefined): number | null {
  if (typeof words !== 'number' || !Number.isFinite(words)) return null;
  return Math.ceil(Math.max(0, words) / WORDS_PER_MINUTE);
}

/** A number of minutes as a cell shows it: "9 min", "1 h 52 min", "2 h". */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** The reading time of a number of words, as a cell shows it; nothing when the words are not known. */
export function formatReadTime(words: number | null | undefined): string {
  const minutes = readMinutes(words);
  return minutes === null ? '' : formatMinutes(minutes);
}
