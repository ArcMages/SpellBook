// The line at the top of the inspector on phones and tablets: the open
// scene's word count and dates, and the session and project totals.
//
// On a desktop Obsidian shows that line in its bottom bar. A phone has no
// bottom bar, so there the inspector shows it instead. The line itself belongs
// to another screen of the plugin (the writing progress), which offers it to
// the others under a name; this file only puts it on the screen. When nobody
// offers it, nothing is shown.

import { Platform } from 'obsidian';
// The line's name and its shape are declared once, in the core, for the
// screen that offers it and for this one that shows it.
import { SCENE_LINE_SERVICE } from '../../core/progress/index';
import type { SceneLineService, StatusSegment } from '../../core/progress/index';
import type { FeatureClock, FeatureServices } from '../registry';

/**
 * Whether what was found under the line's name can be used as the line. It
 * is looked up by name, so it is checked before it is trusted.
 */
function isSceneLine(value: unknown): value is SceneLineService {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Partial<SceneLineService>;
  return typeof line.current === 'function' && typeof line.onChange === 'function';
}

function draw(slot: HTMLElement, line: SceneLineService): void {
  let segments: readonly StatusSegment[] = [];
  try {
    const now: unknown = line.current();
    if (Array.isArray(now)) segments = now as StatusSegment[];
  } catch (error) {
    console.error('Spellbook: the word count line could not be read', error);
  }
  slot.empty();
  for (const segment of segments) {
    if (typeof segment?.label !== 'string' || typeof segment.value !== 'string') continue;
    // A word of the app's own and a number or a date: read left to right in every language.
    const item = slot.createSpan({ cls: 'spellbook-summary-item', attr: { dir: 'ltr' } });
    item.createSpan({ cls: 'spellbook-summary-label', text: segment.label });
    // The writer's own text (a status, a scene's title) picks its own direction.
    item.createSpan({ cls: 'spellbook-summary-value', text: segment.value, attr: segment.ownText === true ? { dir: 'auto' } : {} });
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
