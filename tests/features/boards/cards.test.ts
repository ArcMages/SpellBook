// What a text card becomes: its title and the rest.

import { describe, expect, it } from 'vitest';
import { TITLE_MAX, cardNoteName, choiceKey, choiceOf, oneLine, splitCardText } from '../../../src/core/boards';

describe('a card\'s text', () => {
  it('gives the first line as the title and the rest as the synopsis', () => {
    expect(splitCardText('The storm\nMara loses the boat.\n\nJoss watches.')).toEqual({ title: 'The storm', rest: 'Mara loses the boat.\n\nJoss watches.' });
    expect(splitCardText('Only a title')).toEqual({ title: 'Only a title', rest: '' });
    expect(splitCardText('\n\n  Late start  \n\nrest\n')).toEqual({ title: 'Late start', rest: 'rest' });
    expect(splitCardText('   \n')).toEqual({ title: '', rest: '' });
  });

  it('works for Hebrew as for English', () => {
    expect(splitCardText('# סערה בנמל\nמארה מאבדת את הסירה.')).toEqual({ title: 'סערה בנמל', rest: 'מארה מאבדת את הסירה.' });
  });

  it('leaves the marks of Markdown out of the title', () => {
    expect(splitCardText('## A heading').title).toBe('A heading');
    expect(splitCardText('- a list item').title).toBe('a list item');
    expect(splitCardText('- [ ] a task').title).toBe('a task');
    expect(splitCardText('3. third').title).toBe('third');
    expect(splitCardText('**Bold idea**').title).toBe('Bold idea');
    expect(splitCardText('> said she').title).toBe('said she');
    expect(splitCardText('Windows\r\nline').rest).toBe('line');
  });

  it('cuts a long first line at a space', () => {
    const long = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ');
    const { title } = splitCardText(long);
    expect([...title].length).toBeLessThanOrEqual(TITLE_MAX);
    expect(long.startsWith(title)).toBe(true);
    expect(title.endsWith(' ')).toBe(false);
  });

  it('makes a file name of the title, or uses the fallback when nothing is left', () => {
    expect(cardNoteName('A: plan / B', 'Card')).toBe('A plan B');
    expect(cardNoteName('///', 'Card')).toBe('Card');
    expect(oneLine('one\n two\tthree ')).toBe('one two three');
  });
});

describe('the choices for a card', () => {
  it('go to keys and back', () => {
    for (const choice of [{ kind: 'keep' }, { kind: 'scene' }, { kind: 'entity', typeId: 'character' }] as const) {
      expect(choiceOf(choiceKey(choice))).toEqual(choice);
    }
    expect(choiceOf('nonsense')).toEqual({ kind: 'keep' });
    expect(choiceOf('entity:')).toEqual({ kind: 'keep' });
  });
});
