// Narrative order: the events in the order the book tells them, rather than
// the order they happen in.
//
// An event's place is that of the earliest scene of the manuscript that it
// links. A scene that has a date stands at its own place. Events that link no
// scene come after all the others, in order of date.

import { pathKey } from './../paths';
import { createSceneResolver } from './events';
import type { TimelineEvent } from './events';
import { compareStoryDates } from './storyDate';

/** How to space the events of the narrative view. */
export interface NarrativeOptions {
  /** The distance between one event and the next, in pixels. Default 160. */
  readonly spacing?: number;
  /** The position of the first event, in pixels. Default 0. */
  readonly offset?: number;
  /**
   * Finds the scene a link points at, as one of the paths of the manuscript
   * order, or null. Default: `createSceneResolver` over those paths. Pass
   * Obsidian's own link resolution here to follow links exactly as it does.
   */
  readonly resolveLink?: (link: string) => string | null;
}

/** One event in the narrative view. */
export interface NarrativeItem {
  readonly event: TimelineEvent;
  /** The scene that gives the event its place, as written in the manuscript order; null when it links none. */
  readonly scene: string | null;
  /** That scene's place in the manuscript, counted from 0; null when the event links none. */
  readonly sceneIndex: number | null;
  /** Where the event stands, in pixels: evenly spaced, in order. */
  readonly position: number;
}

/** The distance between two events of the narrative view, unless another is asked for. */
export const DEFAULT_NARRATIVE_SPACING = 160;

/**
 * Put the events in the order the manuscript tells them and give each an
 * evenly spaced position.
 *
 *  - An event stands at the earliest scene it links; a dated scene stands at
 *    its own place. Events at the same scene go by date, the undated last.
 *  - Events that link no scene of the manuscript follow, by date, the
 *    undated last.
 *
 * @param events     the events to order, dated and undated alike
 * @param sceneOrder the manuscript: scene paths in reading order, written the same way as the events' paths
 */
export function narrativeOrder(
  events: readonly TimelineEvent[],
  sceneOrder: readonly string[],
  options: NarrativeOptions = {},
): NarrativeItem[] {
  const spacing = options.spacing !== undefined && Number.isFinite(options.spacing) ? options.spacing : DEFAULT_NARRATIVE_SPACING;
  const offset = options.offset !== undefined && Number.isFinite(options.offset) ? options.offset : 0;
  const resolve = options.resolveLink ?? createSceneResolver(sceneOrder);

  const placeOf = new Map<string, number>();
  sceneOrder.forEach((path, index) => {
    const key = pathKey(path);
    if (!placeOf.has(key)) placeOf.set(key, index);
  });
  const placeOfPath = (path: string | null): number | null => (path === null ? null : (placeOf.get(pathKey(path)) ?? null));

  const entries = events.map((event, index) => {
    let sceneIndex: number | null = event.source === 'scene' ? placeOfPath(event.path) : null;
    for (const link of event.scenes) {
      const place = placeOfPath(resolve(link));
      if (place !== null && (sceneIndex === null || place < sceneIndex)) sceneIndex = place;
    }
    return { event, sceneIndex, index };
  });

  entries.sort((a, b) => {
    if (a.sceneIndex !== b.sceneIndex) {
      if (a.sceneIndex === null) return 1;
      if (b.sceneIndex === null) return -1;
      return a.sceneIndex - b.sceneIndex;
    }
    const first = a.event.start;
    const second = b.event.start;
    if (first !== null && second !== null) return compareStoryDates(first, second) || a.index - b.index;
    if (first === null && second === null) return a.index - b.index;
    return first === null ? 1 : -1;
  });

  return entries.map((entry, order): NarrativeItem => ({
    event: entry.event,
    scene: entry.sceneIndex === null ? null : (sceneOrder[entry.sceneIndex] ?? null),
    sceneIndex: entry.sceneIndex,
    position: offset + order * spacing,
  }));
}
