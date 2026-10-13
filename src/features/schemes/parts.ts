// Small pieces the picker and the settings share: the words they use, and
// the swatch that shows a scheme before it is chosen.

import { NO_SCHEME_DESCRIPTION, NO_SCHEME_NAME, SCHEMES } from '../../core/schemes';
import type { ColourScheme } from '../../core/schemes';

/** One line of a list of schemes to choose from. */
export interface SchemeChoice {
  /** The scheme, or null for "None". */
  readonly scheme: ColourScheme | null;
  readonly name: string;
  readonly description: string;
}

/** Everything that can be chosen, in the order it is shown: "None" first. */
export const SCHEME_CHOICES: readonly SchemeChoice[] = [
  { scheme: null, name: NO_SCHEME_NAME, description: NO_SCHEME_DESCRIPTION },
  ...SCHEMES.map((scheme) => ({ scheme, name: scheme.name, description: scheme.description })),
];

/** What the swatch writes in the scheme's ink, to show how letters look on its page. */
export const SWATCH_LETTERS = 'Aa';

/** How long the notice that names the new scheme stays, in milliseconds. */
export const SCHEME_NOTICE_MS = 2500;

/** What the notice says after the scheme was changed from the keyboard. */
export function schemeNoticeText(scheme: ColourScheme | null): string {
  return `Colour scheme: ${scheme?.name ?? NO_SCHEME_NAME}`;
}

/**
 * Draw a small picture of a scheme: its page, with letters in its ink, a
 * strip of its panel and a dot of its accent. For "None" the picture takes
 * the colours of the theme that is in use (see schemes.css).
 *
 * The colours of a scheme are set on the picture itself: it must show the
 * scheme it stands for, not the one that is worn.
 */
export function drawSwatch(parent: HTMLElement, scheme: ColourScheme | null): HTMLElement {
  const swatch = parent.createSpan({ cls: 'spellbook-scheme-swatch', attr: { 'aria-hidden': 'true' } });
  const strip = swatch.createSpan({ cls: 'spellbook-scheme-swatch-strip' });
  const letters = swatch.createSpan({ cls: 'spellbook-scheme-swatch-letters', text: SWATCH_LETTERS });
  const dot = swatch.createSpan({ cls: 'spellbook-scheme-swatch-dot' });
  if (scheme === null) {
    swatch.addClass('spellbook-scheme-swatch-none');
    return swatch;
  }
  swatch.style.backgroundColor = scheme.page;
  swatch.style.borderColor = scheme.border;
  strip.style.backgroundColor = scheme.panel;
  letters.style.color = scheme.ink;
  dot.style.backgroundColor = scheme.accent;
  return swatch;
}
