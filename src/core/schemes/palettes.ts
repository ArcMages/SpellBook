// The colour schemes: a short list of palettes to write in, three light and
// three dark. They are Spellbook's own; none is taken from another theme.
//
// A scheme is a handful of colours, each with a fixed job. Everything else
// that is painted (see variables.ts) is worked out from these, so that a new
// scheme is eight colours and nothing more.
//
// The grounds run from the page toward the ink: the page is the lightest of a
// light scheme and the darkest of a dark one, then the panel, then what is
// raised, then the border. tests/features/schemes checks that the text of
// every scheme can be read on its grounds.

/** One colour scheme. Every colour is written "#rrggbb", lower case. */
export interface ColourScheme {
  /** A short name for the scheme that stays the same: lower-case letters only. It is what the device remembers. */
  readonly id: string;
  /** What the writer sees. */
  readonly name: string;
  /** One line that says what it is like. */
  readonly description: string;
  /** Whether it is a dark scheme (light text on a dark page). */
  readonly dark: boolean;
  /** The page that is written on. */
  readonly page: string;
  /** The side panels and the bars around the page. */
  readonly panel: string;
  /** What lies on a panel: a card, a button, a field. */
  readonly raised: string;
  /** The lines between things. */
  readonly border: string;
  /** The text itself. */
  readonly ink: string;
  /** Quieter text: a synopsis, a word count. */
  readonly muted: string;
  /** The quietest text: a hint, a placeholder. */
  readonly faint: string;
  /** Links, what is selected, the button that matters. */
  readonly accent: string;
}

export const SCHEMES: readonly ColourScheme[] = [
  {
    id: 'paper',
    name: 'Paper',
    description: 'Light. Warm cream paper with soft black ink.',
    dark: false,
    page: '#f7f2e8',
    panel: '#eee7d9',
    raised: '#e4dbc9',
    border: '#cdc1ab',
    ink: '#2a2622',
    muted: '#50483f',
    faint: '#6b6256',
    accent: '#2d5a86',
  },
  {
    id: 'sepia',
    name: 'Sepia',
    description: 'Light. An old book: tan pages and brown ink.',
    dark: false,
    page: '#eddcbf',
    panel: '#e3d0ae',
    raised: '#d8c39d',
    border: '#bda77f',
    ink: '#2e2015',
    muted: '#4c3b2a',
    faint: '#665440',
    accent: '#8a3212',
  },
  {
    id: 'mist',
    name: 'Mist',
    description: 'Light. Cool, calm grey with slate ink.',
    dark: false,
    page: '#eef1f3',
    panel: '#e3e7ea',
    raised: '#d7dce0',
    border: '#bcc4ca',
    ink: '#21272d',
    muted: '#414c56',
    faint: '#5b6771',
    accent: '#1f6072',
  },
  {
    id: 'dusk',
    name: 'Dusk',
    description: 'Dark. A soft blue-grey evening, easy on the eyes.',
    dark: true,
    page: '#262a33',
    panel: '#2e333d',
    raised: '#383e4a',
    border: '#4c5362',
    ink: '#e4e7ee',
    muted: '#b8becb',
    faint: '#9aa1af',
    accent: '#93b8ec',
  },
  {
    id: 'ink',
    name: 'Ink',
    description: 'Dark. Near-black with bright text: the strongest contrast.',
    dark: true,
    page: '#0b0b0d',
    panel: '#141418',
    raised: '#1f1f25',
    border: '#3c3c46',
    ink: '#f5f5f0',
    muted: '#c6c6bf',
    faint: '#9a9a93',
    accent: '#ffd166',
  },
  {
    id: 'ember',
    name: 'Ember',
    description: 'Dark. Amber on deep brown, with very little blue, for late nights.',
    dark: true,
    page: '#1c1410',
    panel: '#251a14',
    raised: '#30231a',
    border: '#4d3929',
    ink: '#ebd2a9',
    muted: '#bfa27a',
    faint: '#a08866',
    accent: '#f2a24c',
  },
];

/** What the choice "no scheme" is called. */
export const NO_SCHEME_NAME = 'None';
/** One line that says what "no scheme" means. */
export const NO_SCHEME_DESCRIPTION = "Obsidian's own theme, untouched.";

/** The scheme with an id, or null when there is none by that name (or the value is no name at all). */
export function schemeById(id: unknown): ColourScheme | null {
  if (typeof id !== 'string') return null;
  return SCHEMES.find((scheme) => scheme.id === id) ?? null;
}

/**
 * The scheme that comes after one, going round: after "no scheme" the first,
 * after the last "no scheme" again.
 */
export function nextScheme(current: ColourScheme | null): ColourScheme | null {
  if (current === null) return SCHEMES[0] ?? null;
  const at = SCHEMES.findIndex((scheme) => scheme.id === current.id);
  return SCHEMES[at + 1] ?? null;
}

/** The eight colour names a status, a label or a lane can have, as Obsidian names them. */
export const NAMED_COLOURS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;
export type NamedColour = (typeof NAMED_COLOURS)[number];

/** Where each named colour starts on a light page, before it is made readable on the scheme's own grounds. */
export const NAMED_ON_LIGHT: Readonly<Record<NamedColour, string>> = {
  red: '#c9343c',
  orange: '#c96a1e',
  yellow: '#a8820f',
  green: '#34894a',
  cyan: '#1f8894',
  blue: '#3272c4',
  purple: '#7d52c4',
  pink: '#c04a8c',
};

/** The same for a dark page. */
export const NAMED_ON_DARK: Readonly<Record<NamedColour, string>> = {
  red: '#f0686e',
  orange: '#f09854',
  yellow: '#e3be4e',
  green: '#70c682',
  cyan: '#5ac4ce',
  blue: '#74aaf0',
  purple: '#b08ef0',
  pink: '#ea88ba',
};
