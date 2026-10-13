// Colour maths for the colour schemes: reading a colour, mixing two, and
// working out whether text can be read on a ground.
//
// Plain calculations only: values go in, values come out. A colour is always
// written "#rrggbb" here; anything else is refused where it is read.
//
// "Contrast" is the figure of the Web Content Accessibility Guidelines
// (WCAG 2): from 1 (the same colour) to 21 (black on white). Body text wants
// 4.5 or more ("AA"), large text and the outlines of things 3 or more.

/** A colour as three numbers from 0 to 255. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** The least contrast body text may have with its ground (WCAG AA). */
export const READABLE = 4.5;
/** The least contrast large text, an icon or an outline may have with its ground (WCAG AA). */
export const VISIBLE = 3;

const HEX = /^#[0-9a-f]{6}$/;

/** True when a value is a colour as written here: "#" and six hex digits, lower case. */
export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** Read "#rrggbb". Anything else is a mistake in a palette and is said so at once. */
export function rgbOf(hex: string): Rgb {
  if (!isHex(hex)) throw new Error(`not a colour: "${hex}"`);
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function channel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** Write a colour as "#rrggbb". Numbers outside 0 to 255 are brought inside. */
export function hexOf(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b].map((value) => channel(value).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A colour between two others.
 *
 * @param share how much of `to` is taken: 0 gives `from`, 1 gives `to`
 */
export function mix(from: string, to: string, share: number): string {
  const a = rgbOf(from);
  const b = rgbOf(to);
  const t = Math.min(1, Math.max(0, share));
  return hexOf({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

/**
 * What is seen when a see-through colour lies over a ground.
 *
 * @param strength how solid the colour on top is, from 0 (not there) to 1
 */
export function over(top: string, strength: number, ground: string): string {
  return mix(ground, top, strength);
}

/** How light a colour is to the eye, from 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const { r, g, b } = rgbOf(hex);
  const linear = (value: number): number => {
    const part = value / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast between two colours, from 1 to 21. The order does not matter. */
export function contrast(one: string, other: string): number {
  const a = luminance(one);
  const b = luminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The least contrast a colour has with any of several grounds. */
export function leastContrast(colour: string, grounds: readonly string[]): number {
  return Math.min(...grounds.map((ground) => contrast(colour, ground)));
}

/**
 * A colour made readable: it is moved toward `ink`, a tenth at a time, until
 * it has the contrast asked for with every ground. When not even the ink
 * itself gets there, the ink is what is given.
 */
export function readableOn(colour: string, grounds: readonly string[], ink: string, least: number = READABLE): string {
  for (let step = 0; step <= 10; step++) {
    const candidate = mix(colour, ink, step / 10);
    if (leastContrast(candidate, grounds) >= least) return candidate;
  }
  return ink;
}

/** Of several inks, the one that reads best on a ground. */
export function bestInk(ground: string, inks: readonly string[]): string {
  let best = inks[0] ?? '#000000';
  for (const ink of inks) {
    if (contrast(ink, ground) > contrast(best, ground)) best = ink;
  }
  return best;
}

/** The three numbers of a colour as CSS wants them inside rgb() and rgba(): "12, 34, 56". */
export function rgbList(hex: string): string {
  const { r, g, b } = rgbOf(hex);
  return `${r}, ${g}, ${b}`;
}

/** A see-through colour, as CSS writes it. */
export function rgba(hex: string, strength: number): string {
  return `rgba(${rgbList(hex)}, ${strength})`;
}

/** A colour as hue (0 to 360), saturation and lightness (both 0 to 100), in whole numbers. */
export function hslOf(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = rgbOf(hex);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const most = Math.max(red, green, blue);
  const least = Math.min(red, green, blue);
  const spread = most - least;
  const light = (most + least) / 2;
  let hue = 0;
  if (spread !== 0) {
    if (most === red) hue = ((green - blue) / spread) % 6;
    else if (most === green) hue = (blue - red) / spread + 2;
    else hue = (red - green) / spread + 4;
  }
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * light - 1));
  return {
    h: (Math.round(hue * 60) + 360) % 360,
    s: Math.round(saturation * 100),
    l: Math.round(light * 100),
  };
}
