// The eight colours a status or a label can have.

import { describe, expect, it } from 'vitest';
import { CARD_COLORS, colorVariable, isCardColor } from '../../src/core/cards';
import { readColor } from '../../src/core/cards/colors';

describe('the colour names', () => {
  it('are the eight Obsidian offers, in this order', () => {
    expect([...CARD_COLORS]).toEqual(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']);
  });

  it('are recognised exactly, and nothing else is', () => {
    for (const color of CARD_COLORS) expect(isCardColor(color)).toBe(true);
    for (const other of ['teal', 'Red', ' red', '', '#ff0000', 'var(--color-red)', null, undefined, 3, ['red'], {}]) {
      expect(isCardColor(other), String(other)).toBe(false);
    }
  });
});

describe('readColor', () => {
  it('reads a stored colour whatever its capitals and the spaces around it', () => {
    expect(readColor('red')).toBe('red');
    expect(readColor('Red')).toBe('red');
    expect(readColor('  PURPLE ')).toBe('purple');
  });

  it('reads anything else as no colour, without throwing', () => {
    for (const other of ['teal', 'grey', '', 'אדום', '#f00', null, undefined, 7, true, ['red'], { color: 'red' }]) {
      expect(readColor(other), String(other)).toBeNull();
    }
  });
});

describe('colorVariable', () => {
  it("names Obsidian's own variable for each colour", () => {
    expect(colorVariable('red')).toBe('--color-red');
    expect(colorVariable('cyan')).toBe('--color-cyan');
    expect(CARD_COLORS.map((color) => colorVariable(color))).toEqual([
      '--color-red',
      '--color-orange',
      '--color-yellow',
      '--color-green',
      '--color-cyan',
      '--color-blue',
      '--color-purple',
      '--color-pink',
    ]);
  });

  it('names the variable that holds the three numbers, for a tint', () => {
    expect(colorVariable('pink', 'rgb')).toBe('--color-pink-rgb');
    expect(colorVariable('pink', 'color')).toBe('--color-pink');
  });
});
