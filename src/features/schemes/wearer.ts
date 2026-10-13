// Putting a colour scheme on the page, and taking it off again.
//
// A scheme is worn by the page's body: a few classes that say "a scheme is
// on" (for the stylesheet, and for the writer's own snippets), and the
// scheme's CSS variables, set on the body itself. Set there they outweigh
// what the theme in use says, whichever theme it is and in whatever order
// the stylesheets were loaded; the plugin's stylesheet could not promise
// that. Nothing else on the page is touched, and no class or variable that
// is not in the lists below is ever removed.
//
// Until a scheme has been worn once, the page is not touched at all: with
// "None" the plugin leaves no mark on it.

import { SCHEMES, SCHEME_VARIABLE_NAMES, schemeVariables } from '../../core/schemes';
import type { ColourScheme } from '../../core/schemes';

/** On the body while any scheme is worn. */
export const SCHEME_CLASS = 'spellbook-scheme';
/** On the body while a light scheme is worn. */
export const LIGHT_SCHEME_CLASS = 'spellbook-scheme-light';
/** On the body while a dark scheme is worn. */
export const DARK_SCHEME_CLASS = 'spellbook-scheme-dark';

/** The class that names the scheme that is worn, for example "spellbook-scheme-sepia". */
export function schemeClass(scheme: ColourScheme): string {
  return `${SCHEME_CLASS}-${scheme.id}`;
}

/** Every class a scheme can put on the body. */
export const SCHEME_CLASSES: readonly string[] = [SCHEME_CLASS, LIGHT_SCHEME_CLASS, DARK_SCHEME_CLASS, ...SCHEMES.map(schemeClass)];

/** What wears a scheme: the page's body, or a stand-in for it. */
export interface SchemeSurface {
  hasClass(name: string): boolean;
  addClass(name: string): void;
  removeClass(name: string): void;
  /** What a CSS variable is set to on the surface itself; "" when it is not set there. */
  getVariable(name: string): string;
  setVariable(name: string, value: string): void;
  removeVariable(name: string): void;
}

/** The body of a page as something that can wear a scheme. */
export function bodySurface(body: HTMLElement): SchemeSurface {
  return {
    hasClass: (name) => body.hasClass(name),
    addClass: (name) => body.addClass(name),
    removeClass: (name) => body.removeClass(name),
    getVariable: (name) => body.style.getPropertyValue(name).trim(),
    setVariable: (name, value) => body.style.setProperty(name, value),
    removeVariable: (name) => {
      body.style.removeProperty(name);
    },
  };
}

export class SchemeWearer {
  private readonly surface: SchemeSurface;
  private worn: ColourScheme | null = null;
  /** True from the first time a scheme is put on: only then is there anything to keep right or to take off. */
  private touched = false;

  constructor(surface: SchemeSurface) {
    this.surface = surface;
  }

  /** The scheme that is worn, or null. */
  get scheme(): ColourScheme | null {
    return this.worn;
  }

  /** Put a scheme on, in place of the one that was worn; null takes everything off. */
  wear(scheme: ColourScheme | null): void {
    this.worn = scheme;
    this.settle();
  }

  /**
   * Make the page say what it should: the classes and variables of the
   * scheme that is worn, and none of another. Only what is wrong is written,
   * so it costs nothing to ask again (after the theme changed, after the app
   * came back to the front, after a window closed).
   */
  settle(): void {
    const { surface, worn } = this;
    if (worn === null && !this.touched) return;
    this.touched = true;

    const wanted = worn === null ? [] : [SCHEME_CLASS, worn.dark ? DARK_SCHEME_CLASS : LIGHT_SCHEME_CLASS, schemeClass(worn)];
    for (const name of SCHEME_CLASSES) {
      const want = wanted.includes(name);
      if (surface.hasClass(name) === want) continue;
      if (want) surface.addClass(name);
      else surface.removeClass(name);
    }

    if (worn === null) {
      for (const name of SCHEME_VARIABLE_NAMES) {
        if (surface.getVariable(name) !== '') surface.removeVariable(name);
      }
      return;
    }
    for (const [name, value] of schemeVariables(worn)) {
      if (surface.getVariable(name) !== value) surface.setVariable(name, value);
    }
  }
}
