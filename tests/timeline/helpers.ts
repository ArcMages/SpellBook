// Shared bits for the timeline tests.

import { readEvent, readSceneEvent, storyDate, storyDateToDayNumber } from '../../src/core/timeline';
import type { StoryDate, TimelineEvent } from '../../src/core/timeline';

/** A story date that must exist; a slip in a test fails loudly instead of passing null along. */
export function date(year: number, month?: number, day?: number): StoryDate {
  const made = storyDate(year, month, day);
  if (made === null) throw new Error(`The test asked for a date that does not exist: ${year}-${month}-${day}`);
  return made;
}

/** The day number of a date. */
export function dayOf(year: number, month = 1, day = 1): number {
  return storyDateToDayNumber(date(year, month, day));
}

/** The same day number worked out by JavaScript's own calendar, in UTC so no time zone is involved. */
export function utcDay(year: number, month: number, day: number): number {
  const moment = new Date(0);
  moment.setUTCFullYear(year, month - 1, day);
  return Math.round(moment.getTime() / 86_400_000);
}

/** An event note with the given properties. */
export function event(title: string, properties: Record<string, unknown> = {}): TimelineEvent {
  return readEvent(`Timeline/${title}.md`, properties);
}

/** A dated scene as an event. */
export function sceneEvent(title: string, properties: Record<string, unknown>): TimelineEvent {
  const read = readSceneEvent(`Manuscript/${title}.md`, properties);
  if (read === null) throw new Error(`The test scene "${title}" has no date, so it is not an event.`);
  return read;
}

/** Freeze a value all the way down, so a test fails if anything tries to change it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

// Text the owner might really write. Hebrew runs right to left; some of it
// carries vowel points, and one title mixes both directions.
export const HEBREW = {
  battle: 'הקרב על הגשר',
  opening: 'פתיחה',
  mainPlot: 'עלילה ראשית',
  backstory: 'סיפור רקע',
  pointed: 'שָׁלוֹם עוֹלָם',
  mixed: 'פרק 3: The Letter (מכתב)',
  tag: 'מלחמה',
} as const;

// One pointed Hebrew word, stored in two ways that look the same on screen:
// with the marks on the first letter in the order they were typed (the dot of
// the shin, then the vowel), and in the order Unicode's tidy form puts them
// (the vowel first). iCloud does not promise to keep the form it was given.
// Built from the letters' numbers, so that no editor can quietly turn one form into the other.
export const POINTED_AS_TYPED = String.fromCodePoint(0x5e9, 0x5c1, 0x5b8, 0x5dc, 0x5d5, 0x5b9, 0x5dd);
export const POINTED_AS_STORED = POINTED_AS_TYPED.normalize('NFC');

/** A measuring function for tests: every character is 7 pixels wide, plus 16 of padding. */
export function measureByLength(text: string): number {
  return [...text].length * 7 + 16;
}
