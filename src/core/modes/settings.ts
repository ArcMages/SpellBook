// What the writer can tune about the writing modes, and its saved form.
//
// The choices belong to the device (a phone wants the line to rest higher
// than a desktop does), so they are kept there, as JSON text. Whatever comes
// back is checked piece by piece: a value that cannot be right gives way to
// the default, and the others are kept.

/** How much of the text outside the letter box's band can still be seen. */
export type BandShade = 'hidden' | 'faint' | 'dimmed';

export interface ModeSettings {
  /** Letter box: how tall the band of lines is, in hundredths of the pane's height. */
  readonly bandPercent: number;
  /** Letter box: how the text outside the band looks. */
  readonly bandShade: BandShade;
  /** Typewriter: where the line being written rests, in hundredths of the pane's height from its top. */
  readonly anchorPercent: number;
  /** Zen: hide a note's properties. */
  readonly zenHideProperties: boolean;
  /** Zen: hide the note's title above its text. */
  readonly zenHideTitle: boolean;
  /** Zen: the Escape key leaves Zen. */
  readonly zenEscape: boolean;
}

/** The heights of the band the writer can choose from. */
export const BAND_PERCENTS = [20, 30, 40, 50, 60, 70] as const;

/** The resting places of the line the writer can choose from. */
export const ANCHOR_PERCENTS = [20, 30, 40, 50, 60, 70, 80] as const;

export const BAND_SHADES = ['hidden', 'faint', 'dimmed'] as const;

/** How solid the cover over the text outside the band is: 1 hides the text altogether. */
export const SHADE_OPACITY: Readonly<Record<BandShade, number>> = { hidden: 1, faint: 0.9, dimmed: 0.75 };

/**
 * The settings as they are before the writer changes anything. On a phone
 * the line rests above the middle, because the keyboard takes up the lower
 * part of the screen and the eye sits higher.
 */
export function defaultModeSettings(phone: boolean): ModeSettings {
  return {
    bandPercent: 40,
    bandShade: 'faint',
    anchorPercent: phone ? 40 : 50,
    zenHideProperties: true,
    zenHideTitle: false,
    zenEscape: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The choice nearest to a number, or the default when it is no number at all. */
function nearest(value: unknown, choices: readonly number[], otherwise: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return otherwise;
  let best = otherwise;
  let distance = Number.POSITIVE_INFINITY;
  for (const choice of choices) {
    const away = Math.abs(choice - value);
    if (away < distance) {
      best = choice;
      distance = away;
    }
  }
  return best;
}

const flag = (value: unknown, otherwise: boolean): boolean => (typeof value === 'boolean' ? value : otherwise);

/** The settings, read from what the device kept (JSON text, or what it stands for). */
export function parseModeSettings(stored: unknown, phone: boolean): ModeSettings {
  const defaults = defaultModeSettings(phone);
  let value = stored;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return defaults;
    }
  }
  if (!isRecord(value)) return defaults;
  const shade = value['bandShade'];
  return {
    bandPercent: nearest(value['bandPercent'], BAND_PERCENTS, defaults.bandPercent),
    bandShade: (BAND_SHADES as readonly unknown[]).includes(shade) ? (shade as BandShade) : defaults.bandShade,
    anchorPercent: nearest(value['anchorPercent'], ANCHOR_PERCENTS, defaults.anchorPercent),
    zenHideProperties: flag(value['zenHideProperties'], defaults.zenHideProperties),
    zenHideTitle: flag(value['zenHideTitle'], defaults.zenHideTitle),
    zenEscape: flag(value['zenEscape'], defaults.zenEscape),
  };
}

/** What the device keeps of the settings. */
export function formatModeSettings(settings: ModeSettings): string {
  return JSON.stringify({
    bandPercent: settings.bandPercent,
    bandShade: settings.bandShade,
    anchorPercent: settings.anchorPercent,
    zenHideProperties: settings.zenHideProperties,
    zenHideTitle: settings.zenHideTitle,
    zenEscape: settings.zenEscape,
  });
}

export function sameModeSettings(a: ModeSettings, b: ModeSettings): boolean {
  return formatModeSettings(a) === formatModeSettings(b);
}
