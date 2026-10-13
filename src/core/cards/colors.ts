// The colours a status or a label can have.
//
// They are the eight colour names Obsidian itself offers, so on screen each
// one is drawn with the theme's own variable and follows light and dark mode.

/** The colour names, in the order a colour picker shows them. */
export const CARD_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;

/** One of the eight colour names. */
export type CardColor = (typeof CARD_COLORS)[number];

const KNOWN: ReadonlySet<string> = new Set<string>(CARD_COLORS);

/** True when a value is exactly one of the eight colour names. */
export function isCardColor(value: unknown): value is CardColor {
  return typeof value === 'string' && KNOWN.has(value);
}

/**
 * Read a stored colour. Capitals and spaces around the name do not matter
 * ("Red" is red); anything that is not one of the eight names is no colour.
 */
export function readColor(value: unknown): CardColor | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  return isCardColor(name) ? name : null;
}

/**
 * The name of Obsidian's CSS variable for a colour, for example "--color-red".
 * Use it as `var(--color-red)`; `rgb` gives the variable that holds the three
 * numbers instead ("--color-red-rgb"), for a see-through tint:
 * `rgba(var(--color-red-rgb), 0.2)`.
 */
export function colorVariable(color: CardColor, form: 'color' | 'rgb' = 'color'): string {
  return form === 'rgb' ? `--color-${color}-rgb` : `--color-${color}`;
}
