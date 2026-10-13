// Where the scenes of a continuous manuscript stand, worked out from their
// heights alone: which of them are near what the writer sees (and are drawn),
// which are far away (and are kept as empty room of the right height), and
// how to stay on the same line of the same scene when a height changes.
//
// All figures are CSS pixels. Nothing here knows of a screen: the pane hands
// in what it measured.

/** The height taken for a scene whose words have not been counted yet. */
export const DEFAULT_SCENE_HEIGHT = 420;
/** The least a scene takes: the divider with its title, and a line under it. */
export const MIN_SCENE_HEIGHT = 96;
/** The widest a line of text gets, however wide the pane is. The stylesheet holds the text to about this. */
export const MAX_TEXT_WIDTH = 720;

/** Roughly what one word and the space after it take in a line of text. */
const WORD_WIDTH = 44;
/** Roughly what one line of text takes. */
const LINE_HEIGHT = 27;
/** Roughly how many words a paragraph has, and the room between two paragraphs. */
const PARAGRAPH_WORDS = 70;
const PARAGRAPH_GAP = 18;
/** The room at the two sides of the text. */
const SIDE_ROOM = 48;

/**
 * A guess at how tall a scene is once it is drawn, from its number of words
 * and the width of the pane. It only has to be near enough for the scroll bar
 * to make sense: once a scene has been drawn, its measured height is used.
 *
 * @param words the scene's word count; null when it is not known yet
 * @param paneWidth the measured width of the pane; 0 when it is not known yet
 */
export function estimateHeight(words: number | null, paneWidth: number): number {
  if (words === null || !Number.isFinite(words)) return DEFAULT_SCENE_HEIGHT;
  const width = Math.min(MAX_TEXT_WIDTH, Math.max(160, (paneWidth > 0 ? paneWidth : MAX_TEXT_WIDTH + SIDE_ROOM) - SIDE_ROOM));
  const wordsPerLine = Math.max(3, Math.floor(width / WORD_WIDTH));
  const count = Math.max(0, Math.round(words));
  const lines = Math.ceil(count / wordsPerLine);
  const paragraphs = Math.ceil(count / PARAGRAPH_WORDS);
  return Math.max(MIN_SCENE_HEIGHT, MIN_SCENE_HEIGHT + lines * LINE_HEIGHT + paragraphs * PARAGRAPH_GAP);
}

/**
 * Where each scene starts, from the top of the manuscript: one figure per
 * scene, and one more for where the last scene ends.
 */
export function offsetsOf(heights: readonly number[]): number[] {
  const offsets = [0];
  let at = 0;
  for (const height of heights) {
    at += Math.max(0, height);
    offsets.push(at);
  }
  return offsets;
}

/** How tall the whole manuscript is. */
export function totalHeight(offsets: readonly number[]): number {
  return offsets[offsets.length - 1] ?? 0;
}

/**
 * The scene a point of the manuscript lies in: the last one that starts at or
 * above it. A point above the top is in the first scene, one below the end in
 * the last. -1 when there are no scenes.
 */
export function sceneAt(offsets: readonly number[], y: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return -1;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((offsets[middle] ?? 0) <= y) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** A place in the manuscript that stays the same when heights change: so far into such a scene. */
export interface Place {
  /** Which scene, counted from 0. */
  readonly index: number;
  /** How far into the scene, from 0 (its top) to 1 (its end). */
  readonly fraction: number;
}

/** The place that is at the top of what the writer sees. Null when there are no scenes. */
export function placeAt(offsets: readonly number[], scrollTop: number): Place | null {
  const index = sceneAt(offsets, scrollTop);
  if (index < 0) return null;
  const top = offsets[index] ?? 0;
  const height = (offsets[index + 1] ?? top) - top;
  const fraction = height > 0 ? Math.min(1, Math.max(0, (scrollTop - top) / height)) : 0;
  return { index, fraction };
}

/** How far the manuscript must be scrolled for a place to be at the top of what the writer sees. */
export function scrollTopOf(offsets: readonly number[], place: Place): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  const index = Math.min(count - 1, Math.max(0, Math.round(place.index)));
  const top = offsets[index] ?? 0;
  const height = (offsets[index + 1] ?? top) - top;
  const fraction = Number.isFinite(place.fraction) ? Math.min(1, Math.max(0, place.fraction)) : 0;
  return top + height * fraction;
}

/** How much is drawn around what the writer sees, and how much is kept once drawn. */
export interface WindowRoom {
  /** Scenes within this many screens above and below what is seen are drawn. */
  readonly draw: number;
  /** A scene that was drawn is kept until it is this many screens away. Never less than `draw`. */
  readonly keep: number;
}

/** A screen and a half either way is drawn ahead; a scene is let go of once it is four screens away. */
export const WINDOW_ROOM: WindowRoom = { draw: 1.5, keep: 4 };

/** What is to be done so that the scenes near the writer are drawn and the far ones are not. */
export interface WindowPlan {
  /** The scenes to draw that are not drawn yet, the nearest to the middle of the screen first. */
  readonly draw: number[];
  /** The scenes that are drawn and too far away to keep. */
  readonly drop: number[];
}

/**
 * Which scenes to draw and which to let go of.
 *
 * @param viewport the height of what the writer sees
 * @param drawn    for each scene, whether it is drawn now
 */
export function planWindow(
  offsets: readonly number[],
  scrollTop: number,
  viewport: number,
  drawn: readonly boolean[],
  room: WindowRoom = WINDOW_ROOM,
): WindowPlan {
  const count = offsets.length - 1;
  const plan: WindowPlan = { draw: [], drop: [] };
  if (count <= 0) return plan;
  const screen = Math.max(1, viewport);
  const top = Math.max(0, scrollTop);
  const bottom = top + screen;
  const keepRoom = Math.max(room.draw, room.keep) * screen;
  const drawTop = top - room.draw * screen;
  const drawBottom = bottom + room.draw * screen;
  const first = sceneAt(offsets, drawTop);
  // The last scene that starts above the lower edge.
  const last = sceneAt(offsets, Math.max(drawTop, drawBottom - 0.5));
  const middle = top + screen / 2;
  const distance = (index: number): number => {
    const start = offsets[index] ?? 0;
    const end = offsets[index + 1] ?? start;
    return middle < start ? start - middle : middle > end ? middle - end : 0;
  };
  for (let index = first; index <= last; index++) {
    if (drawn[index] !== true) plan.draw.push(index);
  }
  plan.draw.sort((a, b) => distance(a) - distance(b) || a - b);
  for (let index = 0; index < count; index++) {
    if (drawn[index] !== true || (index >= first && index <= last)) continue;
    const start = offsets[index] ?? 0;
    const end = offsets[index + 1] ?? start;
    if (end < top - keepRoom || start > bottom + keepRoom) plan.drop.push(index);
  }
  return plan;
}
