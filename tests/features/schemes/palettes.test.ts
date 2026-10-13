// The colour schemes as palettes: that there is a short list of them, light
// and dark, that the text of each can be read on its grounds (WCAG AA), and
// that the colour maths they are checked with is right.

import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_STRENGTH,
  NAMED_COLOURS,
  NO_SCHEME_NAME,
  READABLE,
  SCHEMES,
  SCHEME_VARIABLE_NAMES,
  SELECTION_STRENGTH,
  VISIBLE,
  bestInk,
  contrast,
  derivedColours,
  hexOf,
  hslOf,
  isHex,
  leastContrast,
  luminance,
  mix,
  namedColours,
  nextScheme,
  over,
  readableOn,
  rgbList,
  rgbOf,
  rgba,
  schemeById,
  schemeVariables,
} from '../../../src/core/schemes';
import type { ColourScheme } from '../../../src/core/schemes';

const SLOTS = ['page', 'panel', 'raised', 'border', 'ink', 'muted', 'faint', 'accent'] as const;

const each = (check: (scheme: ColourScheme) => void): void => {
  for (const scheme of SCHEMES) check(scheme);
};

describe('the colour maths', () => {
  it('reads and writes a colour', () => {
    expect(rgbOf('#102030')).toEqual({ r: 16, g: 32, b: 48 });
    expect(hexOf({ r: 16, g: 32, b: 48 })).toBe('#102030');
    expect(hexOf({ r: -4, g: 300, b: 127.6 })).toBe('#00ff80');
    expect(rgbList('#102030')).toBe('16, 32, 48');
    expect(rgba('#102030', 0.25)).toBe('rgba(16, 32, 48, 0.25)');
  });

  it('refuses whatever is not "#rrggbb" in lower case', () => {
    for (const wrong of ['', 'red', '#fff', '#FFFFFF', '#12345g', 'rgb(0,0,0)', '#1234567']) {
      expect(isHex(wrong), wrong).toBe(false);
      expect(() => rgbOf(wrong), wrong).toThrow(/not a colour/);
    }
    expect(isHex(12)).toBe(false);
    expect(isHex('#0a0b0c')).toBe(true);
  });

  it('gives the contrast of the guidelines: 21 for black on white, 1 for a colour on itself', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 10);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 10);
    expect(contrast('#7a7a7a', '#7a7a7a')).toBe(1);
    // Two figures known from the guidelines' own examples.
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2); // just short of AA
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2); // just over
    expect(leastContrast('#000000', ['#ffffff', '#777777'])).toBeCloseTo(contrast('#000000', '#777777'), 10);
  });

  it('mixes two colours, and lays a see-through one over a ground', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#000000', '#ffffff', 7)).toBe('#ffffff'); // no further than the other colour
    expect(mix('#000000', '#ffffff', -1)).toBe('#000000');
    expect(over('#ff0000', 0.5, '#000000')).toBe('#800000');
    expect(over('#ff0000', 0, '#123456')).toBe('#123456');
  });

  it('moves a colour toward the ink until it can be read, and no further', () => {
    // Already readable: left as it is.
    expect(readableOn('#000000', ['#ffffff'], '#000000')).toBe('#000000');
    // A pale yellow on white: darkened, and then it reads.
    const made = readableOn('#ffe066', ['#ffffff'], '#000000');
    expect(made).not.toBe('#ffe066');
    expect(contrast(made, '#ffffff')).toBeGreaterThanOrEqual(READABLE);
    // One step less would not have done.
    const steps = Array.from({ length: 11 }, (_, step) => mix('#ffe066', '#000000', step / 10));
    expect(contrast(steps[steps.indexOf(made) - 1] ?? '#ffffff', '#ffffff')).toBeLessThan(READABLE);
    // Every ground counts.
    const both = readableOn('#808080', ['#ffffff', '#c0c0c0'], '#000000');
    expect(leastContrast(both, ['#ffffff', '#c0c0c0'])).toBeGreaterThanOrEqual(READABLE);
    // What cannot be reached gives the ink.
    expect(readableOn('#808080', ['#777777'], '#888888', 21)).toBe('#888888');
  });

  it('picks the ink that reads best', () => {
    expect(bestInk('#ffffff', ['#ffffff', '#000000'])).toBe('#000000');
    expect(bestInk('#101010', ['#ffffff', '#000000'])).toBe('#ffffff');
    expect(bestInk('#101010', [])).toBe('#000000');
  });

  it('gives hue, saturation and lightness', () => {
    expect(hslOf('#ff0000')).toEqual({ h: 0, s: 100, l: 50 });
    expect(hslOf('#00ff00')).toEqual({ h: 120, s: 100, l: 50 });
    expect(hslOf('#0000ff')).toEqual({ h: 240, s: 100, l: 50 });
    expect(hslOf('#ff00ff')).toEqual({ h: 300, s: 100, l: 50 });
    expect(hslOf('#808080')).toEqual({ h: 0, s: 0, l: 50 });
    expect(hslOf('#ffffff')).toEqual({ h: 0, s: 0, l: 100 });
  });
});

describe('the list of schemes', () => {
  it('is short, with three light and three dark, each under a name of its own', () => {
    expect(SCHEMES.map((scheme) => [scheme.id, scheme.name, scheme.dark])).toEqual([
      ['paper', 'Paper', false],
      ['sepia', 'Sepia', false],
      ['mist', 'Mist', false],
      ['dusk', 'Dusk', true],
      ['ink', 'Ink', true],
      ['ember', 'Ember', true],
    ]);
    each((scheme) => {
      expect(scheme.id, scheme.id).toMatch(/^[a-z]+$/);
      // The line under the name starts by saying which kind it is.
      expect(scheme.description, scheme.id).toMatch(scheme.dark ? /^Dark\. \S/ : /^Light\. \S/);
      expect(scheme.name, scheme.id).not.toBe(NO_SCHEME_NAME);
    });
  });

  it('writes every colour as "#rrggbb", and no two schemes have the same page', () => {
    each((scheme) => {
      for (const slot of SLOTS) expect(isHex(scheme[slot]), `${scheme.id} ${slot}`).toBe(true);
    });
    expect(new Set(SCHEMES.map((scheme) => scheme.page)).size).toBe(SCHEMES.length);
  });

  it('is found by id, and anything else finds nothing', () => {
    each((scheme) => expect(schemeById(scheme.id)).toBe(scheme));
    for (const wrong of ['', 'Paper', 'none', 'toString', 'constructor', null, undefined, 3, {}, ['paper']]) {
      expect(schemeById(wrong), String(wrong)).toBeNull();
    }
  });

  it('goes round: from none through every scheme and back to none', () => {
    const seen: Array<string | null> = [];
    let at: ColourScheme | null = null;
    for (let turn = 0; turn <= SCHEMES.length; turn++) {
      at = nextScheme(at);
      seen.push(at?.id ?? null);
    }
    expect(seen).toEqual(['paper', 'sepia', 'mist', 'dusk', 'ink', 'ember', null]);
    // A scheme that is not in the list (an older version's) starts the round again.
    expect(nextScheme({ ...(SCHEMES[0] as ColourScheme), id: 'gone' })?.id).toBe('paper');
  });
});

describe('every scheme can be read', () => {
  it('is light or dark as it says, with grounds that run from the page toward the ink', () => {
    each((scheme) => {
      const light = [scheme.page, scheme.panel, scheme.raised, scheme.border, scheme.ink].map(luminance);
      for (let at = 1; at < light.length; at++) {
        const before = light[at - 1] as number;
        const here = light[at] as number;
        expect(scheme.dark ? here > before : here < before, `${scheme.id} step ${at}`).toBe(true);
      }
      expect(luminance(scheme.page) < 0.2, scheme.id).toBe(scheme.dark);
    });
  });

  it('has body text well over the AA figure on the page, on a panel and on what is raised', () => {
    each((scheme) => {
      const grounds = [scheme.page, scheme.panel, scheme.raised];
      expect(leastContrast(scheme.ink, grounds), scheme.id).toBeGreaterThanOrEqual(7); // AAA
    });
  });

  it('has quieter text that still reads: muted at AA on page, panel and raised, faint at AA on page and panel', () => {
    each((scheme) => {
      expect(leastContrast(scheme.muted, [scheme.page, scheme.panel, scheme.raised]), `${scheme.id} muted`).toBeGreaterThanOrEqual(READABLE);
      expect(leastContrast(scheme.faint, [scheme.page, scheme.panel]), `${scheme.id} faint`).toBeGreaterThanOrEqual(READABLE);
      // Quieter means quieter: ink, then muted, then faint.
      expect(contrast(scheme.ink, scheme.page)).toBeGreaterThan(contrast(scheme.muted, scheme.page));
      expect(contrast(scheme.muted, scheme.page)).toBeGreaterThan(contrast(scheme.faint, scheme.page));
    });
  });

  it('has links that read, and a button of the accent colour whose words read', () => {
    each((scheme) => {
      const derived = derivedColours(scheme);
      expect(leastContrast(scheme.accent, [scheme.page, scheme.panel]), `${scheme.id} accent`).toBeGreaterThanOrEqual(READABLE);
      expect(leastContrast(derived.accentHover, [scheme.page, scheme.panel]), `${scheme.id} accent hover`).toBeGreaterThanOrEqual(READABLE);
      expect(contrast(derived.onAccent, scheme.accent), `${scheme.id} on accent`).toBeGreaterThanOrEqual(READABLE);
      expect(contrast(derived.onAccent, derived.accentHover), `${scheme.id} on accent hover`).toBeGreaterThanOrEqual(READABLE);
    });
  });

  it('keeps text readable where it is selected, highlighted or pointed at', () => {
    each((scheme) => {
      const derived = derivedColours(scheme);
      for (const ground of [scheme.page, scheme.panel]) {
        const selected = over(scheme.accent, SELECTION_STRENGTH, ground);
        const highlighted = over(derived.highlight, HIGHLIGHT_STRENGTH, ground);
        const hovered = over(scheme.ink, 0.075, ground);
        expect(contrast(scheme.ink, selected), `${scheme.id} selected`).toBeGreaterThanOrEqual(READABLE);
        expect(contrast(scheme.ink, highlighted), `${scheme.id} highlighted`).toBeGreaterThanOrEqual(READABLE);
        expect(contrast(scheme.ink, hovered), `${scheme.id} hovered`).toBeGreaterThanOrEqual(READABLE);
        expect(contrast(scheme.muted, hovered), `${scheme.id} muted, hovered`).toBeGreaterThanOrEqual(READABLE);
        // And the selection can be told from the page around it.
        expect(contrast(selected, ground), `${scheme.id} selection shows`).toBeGreaterThan(1.15);
      }
    });
  });

  it('has a field to type in whose text reads, and borders that show', () => {
    each((scheme) => {
      const derived = derivedColours(scheme);
      expect(contrast(scheme.ink, derived.field), `${scheme.id} field`).toBeGreaterThanOrEqual(7);
      expect(contrast(scheme.faint, derived.field), `${scheme.id} placeholder`).toBeGreaterThanOrEqual(VISIBLE);
      expect(contrast(scheme.border, scheme.page), `${scheme.id} border`).toBeGreaterThan(1.3);
      expect(contrast(derived.borderFocus, scheme.page), `${scheme.id} focus`).toBeGreaterThanOrEqual(VISIBLE);
      expect(contrast(derived.borderStrong, scheme.page)).toBeGreaterThan(contrast(scheme.border, scheme.page));
    });
  });

  it('makes the eight colours of labels and statuses readable as text on the page and on a panel', () => {
    each((scheme) => {
      const named = namedColours(scheme);
      expect(Object.keys(named)).toEqual([...NAMED_COLOURS]);
      for (const name of NAMED_COLOURS) {
        expect(leastContrast(named[name], [scheme.page, scheme.panel]), `${scheme.id} ${name}`).toBeGreaterThanOrEqual(READABLE);
        // It is still a colour, not the ink it was moved toward.
        expect(named[name], `${scheme.id} ${name}`).not.toBe(scheme.ink);
      }
      // And they can still be told apart.
      expect(new Set(Object.values(named)).size, scheme.id).toBe(NAMED_COLOURS.length);
    });
  });

  it('keeps blue low in the night scheme: in every colour it paints, blue is the weakest', () => {
    const ember = schemeById('ember') as ColourScheme;
    for (const slot of SLOTS) {
      const { r, g, b } = rgbOf(ember[slot]);
      expect(b < g && g < r, `ember ${slot}`).toBe(true);
      expect(b, `ember ${slot}`).toBeLessThanOrEqual(r * 0.75);
    }
  });

  it('makes the high-contrast scheme the strongest of all', () => {
    const strongest = schemeById('ink') as ColourScheme;
    expect(contrast(strongest.ink, strongest.page)).toBeGreaterThanOrEqual(17);
    each((scheme) => {
      expect(contrast(strongest.ink, strongest.page)).toBeGreaterThanOrEqual(contrast(scheme.ink, scheme.page));
    });
  });
});

describe('what a scheme paints', () => {
  const COLOUR = /^#[0-9a-f]{6}$/;
  const WASH = /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0(\.\d+)?\)$/;
  const NUMBERS = /^\d{1,3}, \d{1,3}, \d{1,3}$/;
  const HSL = /^\d{1,3}, \d{1,3}%, \d{1,3}%$/;
  const PART = /^\d{1,3}%?$/;

  it('is the same list of variables for every scheme, each named once', () => {
    expect(SCHEME_VARIABLE_NAMES.length).toBeGreaterThan(80);
    expect(new Set(SCHEME_VARIABLE_NAMES).size).toBe(SCHEME_VARIABLE_NAMES.length);
    each((scheme) => {
      expect(schemeVariables(scheme).map(([name]) => name), scheme.id).toEqual([...SCHEME_VARIABLE_NAMES]);
    });
  });

  it('sets nothing but colours: every value is a colour, a wash, or the numbers of one', () => {
    each((scheme) => {
      for (const [name, value] of schemeVariables(scheme)) {
        expect(name, name).toMatch(/^--[a-z0-9-]+$/);
        const ok = [COLOUR, WASH, NUMBERS, HSL, PART].some((shape) => shape.test(value));
        expect(ok, `${scheme.id} ${name}: ${value}`).toBe(true);
      }
    });
  });

  it('sets no font, no size and no spacing: the letters stay as Obsidian draws them, in Hebrew as in English', () => {
    for (const name of SCHEME_VARIABLE_NAMES) {
      expect(/font|size|line-height|spacing|radius|width|weight|direction/.test(name), name).toBe(false);
    }
  });

  it('puts each colour of the scheme where Obsidian and Spellbook look for it', () => {
    each((scheme) => {
      const set = new Map(schemeVariables(scheme));
      const derived = derivedColours(scheme);
      const named = namedColours(scheme);
      for (const slot of SLOTS) expect(set.get(`--spellbook-scheme-${slot}`), slot).toBe(scheme[slot]);
      expect(set.get('--background-primary')).toBe(scheme.page);
      expect(set.get('--background-secondary')).toBe(scheme.panel);
      expect(set.get('--background-secondary-alt')).toBe(scheme.raised);
      expect(set.get('--background-modifier-border')).toBe(scheme.border);
      expect(set.get('--text-normal')).toBe(scheme.ink);
      expect(set.get('--text-muted')).toBe(scheme.muted);
      expect(set.get('--text-faint')).toBe(scheme.faint);
      expect(set.get('--text-accent')).toBe(scheme.accent);
      expect(set.get('--interactive-accent')).toBe(scheme.accent);
      expect(set.get('--text-on-accent')).toBe(derived.onAccent);
      expect(set.get('--color-base-00')).toBe(scheme.page);
      expect(set.get('--color-base-100')).toBe(scheme.ink);
      expect(set.get('--mono-rgb-100')).toBe(rgbList(scheme.ink));
      expect(set.get('--bg1')).toBe(scheme.page);
      expect(set.get('--tx1')).toBe(scheme.ink);
      expect(set.get('--text-error')).toBe(named.red);
      for (const name of NAMED_COLOURS) {
        expect(set.get(`--color-${name}`)).toBe(named[name]);
        expect(set.get(`--color-${name}-rgb`)).toBe(rgbList(named[name]));
      }
      const hsl = hslOf(scheme.accent);
      expect(set.get('--accent-h')).toBe(String(hsl.h));
      expect(set.get('--color-accent-hsl')).toBe(`${hsl.h}, ${hsl.s}%, ${hsl.l}%`);
    });
  });

  it('makes the steps of the grey ramp run one way, from the page to the ink', () => {
    each((scheme) => {
      const set = new Map(schemeVariables(scheme));
      const steps = ['00', '05', '10', '20', '25', '30', '35', '40', '50', '60', '70', '100'].map((step) =>
        luminance(set.get(`--color-base-${step}`) ?? ''),
      );
      for (let at = 1; at < steps.length; at++) {
        const before = steps[at - 1] as number;
        const here = steps[at] as number;
        expect(scheme.dark ? here > before : here < before, `${scheme.id} step ${at}`).toBe(true);
      }
    });
  });
});
