// The one place that answers "are word counts shown on this device?"
//
// The "Show word counts" setting lets a writer who would rather not see the
// numbers keep them off the everyday screens: the binder, the corkboard, the
// outliner, the inspector, the bottom bar and the Novel view. The counting
// itself goes on as before (the daily log, streaks and targets are kept),
// and the screens a writer opens on purpose to see numbers (the Writing
// report, the Writing targets window, the calendar's word tints, the export
// result) keep showing them.
//
// Like the layout, the choice belongs to the device (see devicePrefs.ts).
// Screens either ask showsWordCounts() while drawing, or put
// HIDES_WORD_COUNTS_CLASS on their root with followWordCounts() and let the
// stylesheet hide the figures. Both change at once when the setting does.

import type { DeviceStorage } from '../core/devicePrefs';

/** Where the choice is kept in the device's own storage. */
export const SHOW_WORDS_KEY = 'spellbook-show-word-counts';

/** On a screen's root element while word counts are hidden: the stylesheet hides the figures. */
export const HIDES_WORD_COUNTS_CLASS = 'spellbook-hides-word-counts';

let shown = true;
let storage: DeviceStorage | null = null;
const listeners = new Set<() => void>();

/** A stored value as the choice: only "off" hides the counts; anything else shows them. */
export function parseShowWords(value: unknown): boolean {
  return value !== 'off';
}

/** Read the writer's choice from this device's storage. Called when the plugin loads. */
export function startWordFigures(deviceStorage: DeviceStorage): void {
  storage = deviceStorage;
  try {
    shown = parseShowWords(deviceStorage.load(SHOW_WORDS_KEY));
  } catch (error) {
    console.error('Spellbook: the word count setting could not be read', error);
    shown = true;
  }
}

/** Forget the choice and the listeners. Called when the plugin unloads, and by tests. */
export function stopWordFigures(): void {
  storage = null;
  shown = true;
  listeners.clear();
}

/** Whether the everyday screens show word counts on this device. */
export function showsWordCounts(): boolean {
  return shown;
}

/** Change the choice, keep it on this device, and tell the open screens. */
export function setShowWordCounts(next: boolean): void {
  const wanted = next !== false;
  if (wanted === shown) return;
  shown = wanted;
  try {
    // Nothing is stored while it is as it comes.
    storage?.save(SHOW_WORDS_KEY, wanted ? null : 'off');
  } catch (error) {
    console.error('Spellbook: the word count setting could not be saved', error);
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error('Spellbook: a screen could not follow the word count setting', error);
    }
  }
}

/** Be told when the choice changes. Returns the function that stops it. */
export function onWordCountsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Put the class on a screen's root element, as the choice is now. */
export function applyWordCountsClass(el: HTMLElement): void {
  el.toggleClass(HIDES_WORD_COUNTS_CLASS, !shown);
}

/**
 * Put the class on a screen's root element now, and keep it in step with the
 * setting for as long as `owner` (a view) lives.
 *
 * @param onChange also called when the setting changes, after the class
 */
export function followWordCounts(owner: { register(callback: () => unknown): void }, el: HTMLElement, onChange?: () => void): void {
  applyWordCountsClass(el);
  owner.register(
    onWordCountsChange(() => {
      applyWordCountsClass(el);
      onChange?.();
    }),
  );
}
