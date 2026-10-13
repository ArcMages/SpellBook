// Two short pieces of fiction with every word's type written next to it by
// hand, for measuring how often the colouring of English words is right.
//
//   /N noun   /V verb (also "was", "had", "could")   /J adjective   /R adverb
//
// A word with no mark is one that is never coloured (the, she, of, and...).
// Two letters mean that either reading is fair ("was unlocked").
//
// TUNED is the piece the rules were adjusted on while they were written.
// UNSEEN was written before the tagger was first run and the rules were never
// changed to suit it: its score is the honest one.

export const TUNED =
  'The tide/N came/V in slowly/R that evening/N. Anna/N stood/V at the end/N of the pier/N and watched/V the grey/J water/N ' +
  'climb/V the wooden/J posts/N. She had/V always/R loved/V this hour/N, when the fishing/J boats/N returned/V and the gulls/N ' +
  'followed/V them home/R. Tonight/NR the harbour/N was/V strangely/R quiet/J. A single/J lantern/N burned/V in the window/N of ' +
  'the old/J customs/N house/N, and its light/N trembled/V on the waves/N. She pulled/V her coat/N tighter/JR and tried/V not/R ' +
  'to think/V about the letter/N in her pocket/N. It was/V very/R short/J. Her brother/N would/V not/R be/V coming/V back/R. ' +
  'The words/N were/V simple/J, almost/R kind/J, but they had/V broken/V something inside her. Behind her the town/N lit/V its ' +
  'lamps/N one by one, and a dog/N barked/V twice/R. She did/V not/R turn/V around.';

export const UNSEEN =
  'Mara/N reached/V the lighthouse/N before dawn/N. The door/N was/V unlocked/JV, which surprised/V her. She climbed/V the ' +
  'narrow/J stairs/N slowly/R, one hand/N on the cold/J rail/N, and listened/V to the wind/N. Somewhere/R above her a shutter/N ' +
  'banged/V against the wall/N. Her father/N had/V kept/V this light/N for thirty years/N, and he had/V never/R once/R let/V it ' +
  'go/V dark/J. Now/R the great/J lamp/N stood/V silent/J and grey/J with dust/N. She wiped/V the glass/N with her sleeve/N and ' +
  'looked/V out at the black/J water/N. A small/J boat/N was/V drifting/V toward the rocks/N. Nobody would/V see/V it in time/N ' +
  'unless she could/V make/V the old/J machine/N work/V again/R. Her fingers/N were/V stiff/J and clumsy/J, but they ' +
  'remembered/V what to do/V. She struck/V a match/N and prayed/V quietly/R that the oil/N had/V not/R dried/V up.';

/**
 * A harder piece: quick dialogue, fragments, names and rarer words. Written
 * after the rules were finished, and never used to change them.
 */
export const HARD =
  '"Don\'t/V just/R stand/V there," Tobias/N hissed/V. "Grab/V the lantern/N, quick/JR!" The cellar/N stank/V of brine/N and ' +
  'rotting/J kelp/N. Old/J Wren/N shuffled/V forward/R, muttering/V, her crooked/J fingers/N worrying/V at the frayed/J hem/N of ' +
  'her shawl/N. "You think/V the smugglers/N left/V it here/R? Fools/N, the pair/N of you." Nobody answered/V. Overhead/R, ' +
  'floorboards/N groaned/V. A thin/J, uncertain/J glow/N leaked/V through the gaps/N. "Well?" she snapped/V. "Dig/V!" Tobias/N ' +
  'dug/V. The spade/N bit/V into damp/J sand/N, struck/V something hollow/J, and stopped/V dead/R. He glanced/V up, grinning/V ' +
  'like a boy/N half his age/N. "That\'s no rock/N," he whispered/V. "That\'s a lid/N."';

const LETTER = { noun: 'N', verb: 'V', adjective: 'J', adverb: 'R' } as const;

export interface Scored {
  /** How many words the piece has, and for how many the tagger agreed with the hand. */
  words: number;
  right: number;
  /** The words it got wrong: the word, what the hand says, what the tagger said. */
  wrong: string[];
}

/** Take the marks out of a piece: the plain text, and what the hand says of each word, in order. */
export function readPassage(marked: string): { text: string; expected: string[] } {
  const expected: string[] = [];
  const text = marked.replace(/([A-Za-z'-]+)(?:\/([NVJR]{1,2}))?/g, (found, word: string, mark: string | undefined) => {
    expected.push(mark ?? '');
    return word;
  });
  return { text, expected };
}

/** Compare what a tagger says with what the hand says. */
export function score(marked: string, tag: (text: string) => Array<{ word: string; type: keyof typeof LETTER | null }>): Scored {
  const { text, expected } = readPassage(marked);
  const tagged = tag(text);
  const wrong: string[] = [];
  let right = 0;
  tagged.forEach((entry, at) => {
    const said = entry.type === null ? '' : LETTER[entry.type];
    const hand = expected[at] ?? '';
    if (hand === said || (hand.length === 2 && said !== '' && hand.includes(said))) right++;
    else wrong.push(`${entry.word}: ${hand || '-'} not ${said || '-'}`);
  });
  return { words: tagged.length, right, wrong };
}
