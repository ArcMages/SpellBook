// The sums behind Letter box and Typewriter: how much of an editing pane is
// covered above and below the band, how much empty room the text needs above
// its first line and under its last one, and how far the pane must be
// scrolled for the line being written to rest where it should.
//
// Everything is in pixels, measured from the top of the pane. Numbers go in,
// numbers come out: the measuring itself is done by the screen.

/** The band is never shorter than this many lines of text (or than the pane, when that is shorter still). */
export const MIN_BAND_LINES = 3;

/** A line that is this near to its resting place is left where it is. */
export const SETTLED_WITHIN = 1;

export interface FrameInput {
  /** The height of the whole pane the text scrolls in. */
  readonly height: number;
  /** How much of it can be seen: less than `height` while an on-screen keyboard lies over its lower part. */
  readonly visible: number;
  /** The height of one line of text. */
  readonly lineHeight: number;
  readonly letterBox: boolean;
  readonly typewriter: boolean;
  /** The band's height, in hundredths of what can be seen. */
  readonly bandPercent: number;
  /** Where the line rests, in hundredths of what can be seen, from the top. */
  readonly anchorPercent: number;
}

export interface Frame {
  /** How much of the top of the pane the letter box covers. 0 without Letter box. */
  readonly coverTop: number;
  /** How much of the bottom of the pane it covers, the part under a keyboard included. 0 without Letter box. */
  readonly coverBottom: number;
  /** The empty room above the first line of the text. 0: leave it as it is. */
  readonly padTop: number;
  /** The empty room under the last line of the text. 0: leave it as it is. */
  readonly padBottom: number;
  /** Where the middle of the line being written rests. Only of use with Typewriter. */
  readonly anchor: number;
}

const clamp = (value: number, least: number, most: number): number => Math.min(Math.max(value, least), Math.max(least, most));

const percent = (value: number): number => clamp(Number.isFinite(value) ? value : 50, 0, 100) / 100;

/**
 * Work out the frame of a pane.
 *
 * The band sits in the middle of what can be seen; with Typewriter on as
 * well it sits around the resting line instead, as far as the pane allows.
 * The empty room is what lets the first and the last line of a note (and
 * the only line of a short one) come to the band or to the resting place.
 */
export function frameOf(input: FrameInput): Frame {
  const height = Math.max(0, input.height);
  const visible = clamp(input.visible, 0, height);
  const line = Math.max(1, input.lineHeight);
  const below = height - visible;
  const anchor = Math.round(visible * (input.typewriter ? percent(input.anchorPercent) : 0.5));

  let coverTop = 0;
  let coverBottom = 0;
  if (input.letterBox && visible > 0) {
    const band = clamp(Math.round(visible * percent(input.bandPercent)), Math.min(MIN_BAND_LINES * line, visible), visible);
    coverTop = Math.round(clamp(anchor - band / 2, 0, visible - band));
    coverBottom = Math.round(visible - band - coverTop + below);
  }

  let padTop = coverTop;
  let padBottom = coverBottom;
  if (input.typewriter && visible > 0) {
    padTop = Math.max(0, Math.round(anchor - line / 2));
    padBottom = Math.max(0, Math.round(height - anchor - line / 2));
  }
  return { coverTop, coverBottom, padTop, padBottom, anchor };
}

export function sameFrame(a: Frame | null, b: Frame | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.coverTop === b.coverTop &&
    a.coverBottom === b.coverBottom &&
    a.padTop === b.padTop &&
    a.padBottom === b.padBottom &&
    a.anchor === b.anchor
  );
}

export interface LinePlace {
  /** The top and the bottom of the line being written, as the screen gives them (from the top of the window). */
  readonly lineTop: number;
  readonly lineBottom: number;
  /** The top of the pane, measured the same way. */
  readonly paneTop: number;
  /** How far the pane is scrolled now. */
  readonly scrollTop: number;
  /** How far it can be scrolled at most. */
  readonly maxScroll: number;
  /** Where the middle of the line should rest, from the top of the pane. */
  readonly anchor: number;
}

/**
 * How far the pane must be scrolled for the line to rest at the anchor, or
 * null when it is there already (or as near as it can get).
 */
export function typewriterTarget(place: LinePlace): number | null {
  const middle = (place.lineTop + place.lineBottom) / 2 - place.paneTop;
  const wanted = clamp(Math.round(place.scrollTop + middle - place.anchor), 0, Math.max(0, place.maxScroll));
  if (!Number.isFinite(wanted)) return null;
  return Math.abs(wanted - place.scrollTop) < SETTLED_WITHIN ? null : wanted;
}
