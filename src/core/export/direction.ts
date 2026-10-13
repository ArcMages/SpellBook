// Which way a piece of text runs: left to right, or right to left (Hebrew,
// Arabic). The writer writes in Hebrew and in English, sometimes in the same
// project, so every paragraph of an export is given the direction of its own
// text, as dir="auto" does on the screen.

export type Direction = 'ltr' | 'rtl';

const LETTER = /\p{L}/u;

/** True for a letter of a script that is written right to left. */
function isRtlLetter(code: number): boolean {
  return (
    (code >= 0x0590 && code <= 0x08ff) || // Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, Mandaic
    (code >= 0xfb1d && code <= 0xfdff) || // Hebrew and Arabic presentation forms
    (code >= 0xfe70 && code <= 0xfefc) || // more Arabic presentation forms
    (code >= 0x10800 && code <= 0x10fff) || // old right-to-left scripts
    (code >= 0x1e800 && code <= 0x1efff) // Adlam, Mende Kikakui, Arabic mathematical letters
  );
}

/** The direction of one character, or null for one that has none of its own (a space, a digit, punctuation). */
function directionOfCharacter(character: string): Direction | null {
  if (!LETTER.test(character)) return null;
  return isRtlLetter(character.codePointAt(0) as number) ? 'rtl' : 'ltr';
}

/**
 * The direction a text takes by itself: that of its first letter. Null when
 * it has no letters at all ("1984.", "* * *").
 */
export function directionOf(text: string): Direction | null {
  for (const character of text) {
    const direction = directionOfCharacter(character);
    if (direction !== null) return direction;
  }
  return null;
}

/** A stretch of text in one script direction. */
export interface ScriptStretch {
  readonly text: string;
  readonly rtl: boolean;
}

/**
 * Cut a text into stretches of right-to-left and left-to-right script, for
 * a format (Word) that wants to be told which is which. Spaces, digits and
 * punctuation stay with the letters before them; at the very start they go
 * with the letters that follow, or with `base` when there are no letters.
 */
export function splitByScript(text: string, base: Direction): ScriptStretch[] {
  const stretches: Array<{ text: string; rtl: boolean }> = [];
  let pending = '';
  for (const character of text) {
    const direction = directionOfCharacter(character);
    const last = stretches[stretches.length - 1];
    if (direction === null) {
      if (last) last.text += character;
      else pending += character;
      continue;
    }
    const rtl = direction === 'rtl';
    if (last && last.rtl === rtl) {
      last.text += character;
    } else {
      stretches.push({ text: pending + character, rtl });
      pending = '';
    }
  }
  if (pending !== '') stretches.push({ text: pending, rtl: base === 'rtl' });
  return stretches;
}

/** Whether a text has Arabic letters rather than Hebrew ones; for naming the language of a right-to-left document. */
export function looksArabic(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    if (code >= 0x0590 && code <= 0x05ff) return false;
    if (code >= 0x0600 && code <= 0x06ff) return true;
  }
  return false;
}
