// What the writer chose for the prose checks on this device: whether they are
// on at all, which ones, the two thresholds and their own filler words.
//
// It is kept as one piece of JSON text in the device's own storage, never in
// a note and never in the synced plugin data: a phone and a desktop may well
// want different checks. Whatever comes back from the storage is checked
// before it is used; it may be an older version's, or edited by hand.

import { LONG_SENTENCE, PROSE_CHECKS, REPEAT_DISTANCE, clampWhole } from './types';
import type { ProseCheck, ProseOptions } from './types';

/** Where the choices are kept in the device's own storage. */
export const PROSE_PREFS_KEY = 'spellbook-prose';

/** No more filler words of the writer's own than this, and none longer than this. */
export const MOST_OWN_FILLERS = 200;
export const LONGEST_OWN_FILLER = 60;

export interface ProsePrefs {
  /** The master switch. */
  readonly on: boolean;
  /** The checks that are chosen. They show only while the master switch is on. */
  readonly checks: readonly ProseCheck[];
  readonly distance: number;
  readonly longSentence: number;
  /** The writer's own filler words and phrases, English and Hebrew. */
  readonly fillersEnglish: readonly string[];
  readonly fillersHebrew: readonly string[];
}

/** Everything off, as it is before the writer chooses anything. */
export const NO_PROSE_PREFS: ProsePrefs = Object.freeze({
  on: false,
  checks: [],
  distance: REPEAT_DISTANCE.initial,
  longSentence: LONG_SENTENCE.initial,
  fillersEnglish: [],
  fillersHebrew: [],
});

/** The checks that are switched on when the master switch is first used with none chosen: the underlines, not the colours. */
export const FIRST_CHECKS: readonly ProseCheck[] = ['filler', 'passive', 'repeated', 'overused-adverbs', 'rhythm'];

/** The words of a list as the writer typed it: split at commas and line ends, trimmed, without doubles. */
export function fillerWords(text: unknown): string[] {
  const parts = typeof text === 'string' ? text.split(/[,\n;\u060C\u3001]/) : Array.isArray(text) ? text : [];
  const words: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    const word = part.trim().replace(/\s+/g, ' ').slice(0, LONGEST_OWN_FILLER);
    if (word !== '' && !words.includes(word) && words.length < MOST_OWN_FILLERS) words.push(word);
  }
  return words;
}

/** Read the choices from what the storage holds. Anything that cannot be used is left at its starting value. */
export function parseProsePrefs(stored: unknown): ProsePrefs {
  let value: unknown = stored;
  if (typeof stored === 'string') {
    try {
      value = JSON.parse(stored) as unknown;
    } catch {
      return NO_PROSE_PREFS;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return NO_PROSE_PREFS;
  const record = value as Record<string, unknown>;
  const chosen = Array.isArray(record.checks) ? record.checks : [];
  return {
    on: record.on === true,
    checks: PROSE_CHECKS.filter((check) => chosen.includes(check)),
    distance: clampWhole(record.distance, REPEAT_DISTANCE, REPEAT_DISTANCE.initial),
    longSentence: clampWhole(record.longSentence, LONG_SENTENCE, LONG_SENTENCE.initial),
    fillersEnglish: fillerWords(record.fillersEnglish),
    fillersHebrew: fillerWords(record.fillersHebrew),
  };
}

/** The choices as text for the storage; null when nothing differs from the start, so that nothing is kept. */
export function serializeProsePrefs(prefs: ProsePrefs): string | null {
  const text = JSON.stringify({
    on: prefs.on,
    checks: PROSE_CHECKS.filter((check) => prefs.checks.includes(check)),
    distance: prefs.distance,
    longSentence: prefs.longSentence,
    fillersEnglish: prefs.fillersEnglish,
    fillersHebrew: prefs.fillersHebrew,
  });
  return text === JSON.stringify(NO_PROSE_PREFS) ? null : text;
}

/** What the analysis is asked to do under these choices: nothing while the master switch is off. */
export function optionsOf(prefs: ProsePrefs): ProseOptions {
  return {
    checks: new Set(prefs.on ? prefs.checks : []),
    distance: prefs.distance,
    longSentence: prefs.longSentence,
    ownFillers: [...prefs.fillersEnglish, ...prefs.fillersHebrew],
  };
}

/** The choices with one check switched on or off. Switching a check on switches the checks on as a whole. */
export function withCheck(prefs: ProsePrefs, check: ProseCheck, on: boolean): ProsePrefs {
  const checks = PROSE_CHECKS.filter((other) => (other === check ? on : prefs.checks.includes(other)));
  return { ...prefs, checks, on: on ? true : prefs.on };
}

/** Whether a check is drawn: it is chosen, and the master switch is on. */
export function isShown(prefs: ProsePrefs, check: ProseCheck): boolean {
  return prefs.on && prefs.checks.includes(check);
}

/**
 * The choices with the master switch turned. Turned on for the first time,
 * with no check chosen, it chooses the underlining checks: a switch that
 * shows nothing would look broken.
 */
export function withMaster(prefs: ProsePrefs, on: boolean): ProsePrefs {
  if (on && prefs.checks.length === 0) return { ...prefs, on, checks: FIRST_CHECKS };
  return { ...prefs, on };
}
