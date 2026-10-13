// Counting the syllables of an English word, for the reading grade.
//
// English spelling does not say how a word sounds, so this is an estimate: it
// counts the groups of vowels in a word and allows for the commonest silent
// endings ("make", "walked", "times"). It is right for most words and off by
// one for some ("created", "poem"); over a chapter the slips even out.

const VOWEL_GROUP = /[aeiouy]+/g;

/**
 * About how many syllables an English word has; at least 1. A word without a
 * single letter from a to z (a number, a word in another script) has none.
 */
export function countSyllables(word: string): number {
  // Accents are taken off ("cafe" for "café"), and everything that is not a letter from a to z.
  let letters = word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z]/g, '');
  if (letters === '') return 0;
  if (letters.length <= 3) return 1;

  let extra = 0;
  if (/[^aeiouy]les?$/.test(letters)) {
    // "table", "little", "apples": the ending is a syllable of its own.
    letters = letters.replace(/les?$/, '');
    extra = 1;
  } else if (/[^aeiouysxzcgh]es$/.test(letters)) {
    // "times", "makes": the e is silent. ("boxes" and "horses" keep theirs.)
    letters = letters.slice(0, -2);
  } else if (/[^aeiouytd]ed$/.test(letters)) {
    // "walked", "asked": the e is silent. ("wanted" keeps its own.)
    letters = letters.slice(0, -2);
  } else if (/[^aeiouy]e$/.test(letters)) {
    // "make", "alone": a silent e at the end.
    letters = letters.slice(0, -1);
  }
  // A y at the start is a consonant: "yellow".
  if (letters.startsWith('y')) letters = letters.slice(1);
  const groups = letters.match(VOWEL_GROUP)?.length ?? 0;
  return Math.max(1, groups + extra);
}
