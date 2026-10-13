// From a colour scheme to what is painted: the CSS variables a scheme sets,
// each with its value.
//
// Obsidian, its themes and Spellbook's own screens take every colour from
// CSS variables ("--background-primary", "--text-normal" ...). A scheme sets
// those variables; it styles no element itself. Three groups are set:
//
//   - Spellbook's own, "--spellbook-scheme-...": the colours of the scheme by
//     their jobs, for anything that wants to follow the scheme by name;
//   - the variables Obsidian names for a job (page, panel, text, border,
//     accent, the eight named colours of labels and statuses);
//   - the steps Obsidian and the Minimal theme build those from (the grey
//     ramp "--color-base-..", the accent, "--bg1" and its kin), so that a
//     theme which reads the steps directly follows as well.
//
// Every scheme sets the same variables, in the same order: taking a scheme
// off is taking exactly this list away.

import { bestInk, hslOf, mix, readableOn, rgbList, rgba } from './colour';
import { NAMED_COLOURS, NAMED_ON_DARK, NAMED_ON_LIGHT, SCHEMES } from './palettes';
import type { ColourScheme, NamedColour } from './palettes';

/** One variable and what it is set to. */
export type SchemeVariable = readonly [name: string, value: string];

const WHITE = '#ffffff';
const BLACK = '#000000';

/** How solid the wash behind selected text is. */
export const SELECTION_STRENGTH = 0.25;
/** How solid the wash behind highlighted text is. */
export const HIGHLIGHT_STRENGTH = 0.3;

/**
 * The eight named colours as a scheme shows them: each starts from the
 * colour for a light or a dark page and is moved toward the scheme's ink
 * until it can be read as text on the page and on a panel.
 */
export function namedColours(scheme: ColourScheme): Readonly<Record<NamedColour, string>> {
  const start = scheme.dark ? NAMED_ON_DARK : NAMED_ON_LIGHT;
  const made = {} as Record<NamedColour, string>;
  for (const name of NAMED_COLOURS) {
    made[name] = readableOn(start[name], [scheme.page, scheme.panel], scheme.ink);
  }
  return made;
}

/** The colours a scheme does not list itself but that are worked out from the ones it does. */
export interface DerivedColours {
  /** A border that is pointed at. */
  readonly borderStrong: string;
  /** The border of the field that is being typed in. */
  readonly borderFocus: string;
  /** The ground of a field to type in. */
  readonly field: string;
  /** The accent while it is pointed at. */
  readonly accentHover: string;
  /** Text on a button of the accent colour. */
  readonly onAccent: string;
  /** What highlighted text is washed with (before it is made see-through). */
  readonly highlight: string;
}

export function derivedColours(scheme: ColourScheme): DerivedColours {
  const accentHover = mix(scheme.accent, scheme.ink, 0.2);
  return {
    borderStrong: mix(scheme.border, scheme.ink, 0.3),
    borderFocus: mix(scheme.border, scheme.ink, 0.5),
    field: scheme.dark ? scheme.raised : mix(scheme.page, WHITE, 0.5),
    accentHover,
    // The same ink has to do on the button and on the button that is pointed at.
    onAccent: bestInk(scheme.accent, [WHITE, scheme.page, scheme.ink, BLACK]),
    highlight: (scheme.dark ? NAMED_ON_DARK : NAMED_ON_LIGHT).yellow,
  };
}

/** Every variable a scheme sets, with its value, in a fixed order. */
export function schemeVariables(scheme: ColourScheme): readonly SchemeVariable[] {
  const { page, panel, raised, border, ink, muted, faint, accent } = scheme;
  const derived = derivedColours(scheme);
  const named = namedColours(scheme);
  const hsl = hslOf(accent);
  const hover = rgba(ink, 0.075);
  const chosen = rgba(accent, 0.15);

  const variables: SchemeVariable[] = [
    // Spellbook's own names for the colours of the scheme.
    ['--spellbook-scheme-page', page],
    ['--spellbook-scheme-panel', panel],
    ['--spellbook-scheme-raised', raised],
    ['--spellbook-scheme-border', border],
    ['--spellbook-scheme-ink', ink],
    ['--spellbook-scheme-muted', muted],
    ['--spellbook-scheme-faint', faint],
    ['--spellbook-scheme-accent', accent],

    // The steps Obsidian builds its colours from: page to ink.
    ['--color-base-00', page],
    ['--color-base-05', mix(page, panel, 0.4)],
    ['--color-base-10', mix(page, panel, 0.7)],
    ['--color-base-20', panel],
    ['--color-base-25', raised],
    ['--color-base-30', border],
    ['--color-base-35', mix(border, faint, 0.35)],
    ['--color-base-40', mix(border, faint, 0.7)],
    ['--color-base-50', faint],
    ['--color-base-60', mix(faint, muted, 0.5)],
    ['--color-base-70', muted],
    ['--color-base-100', ink],
    // What Obsidian tints with, "the darkest" and "the lightest" of a mode: here the ink and the page.
    ['--mono-rgb-0', rgbList(page)],
    ['--mono-rgb-100', rgbList(ink)],

    // The accent.
    ['--accent-h', String(hsl.h)],
    ['--accent-s', `${hsl.s}%`],
    ['--accent-l', `${hsl.l}%`],
    ['--color-accent', accent],
    ['--color-accent-hsl', `${hsl.h}, ${hsl.s}%, ${hsl.l}%`],
    ['--color-accent-1', accent],
    ['--color-accent-2', derived.accentHover],

    // Grounds.
    ['--background-primary', page],
    ['--background-primary-alt', panel],
    ['--background-secondary', panel],
    ['--background-secondary-alt', raised],
    ['--background-modifier-hover', hover],
    ['--background-modifier-active-hover', chosen],
    ['--background-modifier-border', border],
    ['--background-modifier-border-hover', derived.borderStrong],
    ['--background-modifier-border-focus', derived.borderFocus],
    ['--background-modifier-form-field', derived.field],
    ['--background-modifier-error', named.red],
    ['--background-modifier-success', named.green],
    ['--background-modifier-cover', rgba(mix(page, BLACK, scheme.dark ? 0.7 : 0.3), 0.5)],

    // Text.
    ['--text-normal', ink],
    ['--text-muted', muted],
    ['--text-faint', faint],
    ['--text-accent', accent],
    ['--text-accent-hover', derived.accentHover],
    ['--text-on-accent', derived.onAccent],
    ['--text-error', named.red],
    ['--text-warning', named.orange],
    ['--text-success', named.green],
    ['--text-selection', rgba(accent, SELECTION_STRENGTH)],
    ['--text-highlight-bg', rgba(derived.highlight, HIGHLIGHT_STRENGTH)],

    // Buttons and fields.
    ['--interactive-normal', derived.field],
    ['--interactive-hover', scheme.dark ? mix(raised, border, 0.5) : panel],
    ['--interactive-accent', accent],
    ['--interactive-accent-hsl', `${hsl.h}, ${hsl.s}%, ${hsl.l}%`],
    ['--interactive-accent-hover', derived.accentHover],

    // The frame around the page.
    ['--titlebar-background', panel],
    ['--titlebar-background-focused', raised],
    ['--titlebar-text-color', muted],
    ['--titlebar-text-color-focused', ink],
    ['--ribbon-background', panel],
    ['--ribbon-background-collapsed', page],
    ['--tab-container-background', panel],
    ['--status-bar-background', panel],
    ['--status-bar-text-color', muted],
    ['--divider-color', border],
    ['--modal-background', page],
    ['--scrollbar-bg', rgba(ink, 0.05)],
    ['--scrollbar-thumb-bg', rgba(ink, 0.2)],
    ['--scrollbar-active-thumb-bg', rgba(ink, 0.35)],

    // Lists of things: the file list, and the binder, which follows it.
    ['--nav-item-color', muted],
    ['--nav-item-color-hover', ink],
    ['--nav-item-color-active', ink],
    ['--nav-item-color-selected', ink],
    ['--nav-item-background-hover', hover],
    ['--nav-item-background-active', hover],
    ['--nav-item-background-selected', chosen],
    ['--nav-indentation-guide-color', border],
    ['--nav-collapse-icon-color', faint],
    ['--icon-color', muted],
    ['--icon-color-hover', ink],
    ['--icon-color-active', accent],
    ['--icon-color-focused', ink],

    // The steps the Minimal theme builds its colours from.
    ['--bg1', page],
    ['--bg2', panel],
    ['--bg3', raised],
    ['--ui1', border],
    ['--ui2', derived.borderStrong],
    ['--ui3', derived.borderFocus],
    ['--tx1', ink],
    ['--tx2', muted],
    ['--tx3', faint],
    ['--ax1', accent],
    ['--ax2', derived.accentHover],
    ['--ax3', accent],
    ['--hl1', rgba(accent, SELECTION_STRENGTH)],
    ['--hl2', rgba(derived.highlight, HIGHLIGHT_STRENGTH)],
  ];

  // The eight colours of labels, statuses, lanes and day marks: as a colour, and as three numbers for a tint.
  for (const name of NAMED_COLOURS) {
    variables.push([`--color-${name}`, named[name]], [`--color-${name}-rgb`, rgbList(named[name])]);
  }
  return variables;
}

/** The name of every variable a scheme sets. It is the same list for every scheme. */
export const SCHEME_VARIABLE_NAMES: readonly string[] = SCHEMES[0] ? schemeVariables(SCHEMES[0]).map(([name]) => name) : [];
