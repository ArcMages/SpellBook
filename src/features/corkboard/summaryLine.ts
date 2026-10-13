// The line at the top of the inspector on phones and tablets: the open
// scene's word count and dates, and the session and project totals.
//
// On a desktop Obsidian shows that line in its bottom bar. A phone has no
// bottom bar, so there the inspector shows it instead. The line itself belongs
// to another screen of the plugin (the writing progress), which offers it to
// the others under a name; this file only puts it on the screen. When nobody
// offers it, nothing is shown.

import { Platform } from 'obsidian';
import type { FeatureClock, FeatureServices } from '../registry';

/** The name the line is offered under. */
export const SCENE_LINE_SERVICE = 'progress.sceneLine';

/** One piece of the line: what it is, in English, and its value, ready to show. */
export interface SceneLineSegment {
  readonly label: string;
  readonly value: string;
}

/** What is offered under SCENE_LINE_SERVICE. */
export interface SceneLine {
  /** The pieces of the line as they are now, in the order to show them. */
  current(): readonly SceneLineSegment[];
  /** Be told when the line changes. Returns the function that stops it. */
  onChange(listener: () => void): () => void;
}

function isSceneLine(value: unknown): value is SceneLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Partial<SceneLine>;
  return typeof line.current === 'function' && typeof line.onChange === 'function';
}

function draw(slot: HTMLElement, line: SceneLine): void {
  let segments: readonly SceneLineSegment[] = [];
  try {
    const now: unknown = line.current();
    if (Array.isArray(now)) segments = now as SceneLineSegment[];
  } catch (error) {
    console.error('Spellbook: the word count line could not be read', error);
  }
  slot.empty();
  for (const segment of segments) {
    if (typeof segment?.label !== 'string' || typeof segment.value !== 'string') continue;
    // A word of the app's own and a number or a date: read left to right in every language.
    const item = slot.createSpan({ cls: 'spellbook-summary-item', attr: { dir: 'ltr' } });
    item.createSpan({ cls: 'spellbook-summary-label', text: segment.label });
    item.createSpan({ cls: 'spellbook-summary-value', text: segment.value });
  }
}

/**
 * Fill the empty place at the top of the inspector with the line, and keep it
 * up to date. Does nothing on a desktop, and nothing when no line is offered.
 *
 * @param slot the empty element at the top of the inspector
 * @returns the function to call when the inspector closes
 */
export function mountSceneLine(
  slot: HTMLElement,
  services: Pick<FeatureServices, 'get'>,
  clock: Pick<FeatureClock, 'setTimer'>,
): () => void {
  if (!Platform.isMobile) return () => undefined;

  let stopped = false;
  let stopListening: (() => void) | null = null;
  let stopWaiting: (() => void) | null = null;

  /** @returns whether the line was there to show */
  const start = (): boolean => {
    const line: unknown = services.get(SCENE_LINE_SERVICE);
    if (!isSceneLine(line)) return false;
    draw(slot, line);
    stopListening = line.onChange(() => {
      if (!stopped) draw(slot, line);
    });
    return true;
  };

  // An inspector that Obsidian puts back at start-up may open while the
  // screens are still plugging themselves in: look once more in a moment.
  if (!start()) {
    stopWaiting = clock.setTimer(() => {
      stopWaiting = null;
      if (!stopped) start();
    }, 0);
  }

  return () => {
    stopped = true;
    stopWaiting?.();
    stopWaiting = null;
    stopListening?.();
    stopListening = null;
    slot.empty();
  };
}
