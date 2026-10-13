// What single cells are worked out from: the target's percentage and band,
// the reading time, the tags, and the other properties of a scene.

import { describe, expect, it } from 'vitest';
import {
  KNOWN_SCENE_KEYS,
  WORDS_PER_MINUTE,
  formatMinutes,
  formatPercent,
  formatReadTime,
  otherPropertyKeys,
  propertyText,
  readMinutes,
  readNoteTags,
  readProperty,
  targetBand,
  targetCell,
} from '../../src/core/outliner';
import { HEBREW } from './helpers';

describe('progress toward a target', () => {
  it('puts a percentage in one of four bands', () => {
    expect([0, 1, 49].map(targetBand)).toEqual(['low', 'low', 'low']);
    expect([50, 65, 79].map(targetBand)).toEqual(['mid', 'mid', 'mid']);
    expect([80, 99].map(targetBand)).toEqual(['near', 'near']);
    expect([100, 101, 250].map(targetBand)).toEqual(['done', 'done', 'done']);
    expect(targetBand(Number.NaN)).toBe('low');
  });

  it('works out the percentage, rounded down, and how far the bar is filled', () => {
    expect(targetCell(630, 1000)).toEqual({ target: 1000, words: 630, percent: 63, fill: 63, band: 'mid' });
    // 100 shows only once the target is reached.
    expect(targetCell(999, 1000)).toMatchObject({ percent: 99, band: 'near' });
    expect(targetCell(1000, 1000)).toMatchObject({ percent: 100, fill: 100, band: 'done' });
    // Past the target the number goes on; the bar stays full.
    expect(targetCell(2500, 1000)).toMatchObject({ percent: 250, fill: 100, band: 'done' });
    expect(targetCell(0, 1000)).toMatchObject({ percent: 0, fill: 0, band: 'low' });
    expect(formatPercent(targetCell(630, 1000))).toBe('63%');
  });

  it('shows nothing without a target', () => {
    for (const target of [null, undefined, 0, -5, Number.NaN]) expect(targetCell(500, target)).toBeNull();
    expect(formatPercent(null)).toBe('');
  });

  it('keeps the target but no percentage while the words are not known', () => {
    for (const words of [null, undefined]) {
      const cell = targetCell(words, 1000);
      expect(cell).toEqual({ target: 1000, words: null, percent: null, fill: 0, band: null });
      expect(formatPercent(cell)).toBe('');
    }
  });
});

describe('reading time', () => {
  it('goes by 250 words a minute, rounded up to a whole minute', () => {
    expect(WORDS_PER_MINUTE).toBe(250);
    expect(readMinutes(0)).toBe(0);
    expect(readMinutes(1)).toBe(1);
    expect(readMinutes(250)).toBe(1);
    expect(readMinutes(251)).toBe(2);
    expect(readMinutes(2250)).toBe(9);
    expect(readMinutes(28000)).toBe(112);
  });

  it('is written as "9 min" or "1 h 52 min"', () => {
    expect(formatReadTime(2250)).toBe('9 min');
    expect(formatReadTime(28000)).toBe('1 h 52 min');
    expect(formatReadTime(0)).toBe('0 min');
    expect(formatMinutes(59)).toBe('59 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(61)).toBe('1 h 1 min');
    expect(formatMinutes(600)).toBe('10 h');
  });

  it('shows nothing while the words are not known', () => {
    expect(readMinutes(null)).toBeNull();
    expect(readMinutes(undefined)).toBeNull();
    expect(readMinutes(Number.NaN)).toBeNull();
    expect(formatReadTime(null)).toBe('');
    expect(formatReadTime(undefined)).toBe('');
  });
});

describe("a note's tags", () => {
  it('reads a list, without the "#", each tag once', () => {
    expect(readNoteTags({ tags: ['draft', '#act-one', 'Draft', ' night '] })).toEqual(['draft', 'act-one', 'night']);
  });

  it('reads tags written as one line of text, with commas or spaces', () => {
    expect(readNoteTags({ tags: 'draft, act-one  #night' })).toEqual(['draft', 'act-one', 'night']);
  });

  it('reads the older "tag" key too, and Hebrew tags', () => {
    expect(readNoteTags({ tag: HEBREW.opening, tags: ['draft'] })).toEqual(['draft', HEBREW.opening]);
  });

  it('gives no tags for anything else', () => {
    for (const frontmatter of [null, undefined, {}, { tags: null }, { tags: { a: 1 } }, { tags: [] }, { tags: '' }]) {
      expect(readNoteTags(frontmatter)).toEqual([]);
    }
    expect(readNoteTags({ tags: [1984, null, { nested: true }, ['inner']] })).toEqual(['1984', 'inner']);
  });
});

describe("a scene's other properties", () => {
  it('lists the keys the outliner has no column for, each once, in alphabetical order', () => {
    // (Compared the English way here, so that the test does not depend on the language of the machine it runs on.)
    const english = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const keys = otherPropertyKeys(
      [
        { synopsis: 'x', status: 'To do', pov: 'Anna', order: 1, Location: 'Harbour' },
        null,
        { pov: 'Daniel', tags: ['a'], created: '2026-10-01', [HEBREW.house]: 'כן', 'scene 10': 1, 'scene 9': 1 },
        undefined,
      ],
      english,
    );
    expect(keys).toEqual(['Location', 'pov', 'scene 9', 'scene 10', HEBREW.house]);
  });

  it('knows its own keys whatever their capitals, and never lists them', () => {
    expect(otherPropertyKeys([{ Status: 'x', SYNOPSIS: 'y', Target: 5, Tags: [], ' ': 'blank key' }])).toEqual([]);
    for (const key of ['synopsis', 'status', 'label', 'target', 'compile', 'order', 'created', 'edited', 'tags', 'tag']) {
      expect(KNOWN_SCENE_KEYS).toContain(key);
    }
  });

  it('reads a property, and only one the writer wrote', () => {
    expect(readProperty({ pov: 'Anna' }, 'pov')).toBe('Anna');
    expect(readProperty({ pov: 'Anna' }, 'mood')).toBeUndefined();
    // Not what every object has of itself.
    expect(readProperty({ pov: 'Anna' }, 'constructor')).toBeUndefined();
    expect(readProperty({ pov: 'Anna' }, 'toString')).toBeUndefined();
    expect(readProperty(null, 'pov')).toBeUndefined();
  });

  it('shows a value as plain text', () => {
    expect(propertyText('Anna')).toBe('Anna');
    expect(propertyText(1984)).toBe('1984');
    expect(propertyText(false)).toBe('false');
    expect(propertyText(['Anna', 3, null, '', ['nested']])).toBe('Anna, 3, nested');
    expect(propertyText({ place: 'Harbour' })).toBe('{"place":"Harbour"}');
    expect(propertyText(null)).toBe('');
    expect(propertyText(undefined)).toBe('');
    expect(propertyText(HEBREW.synopsis)).toBe(HEBREW.synopsis);
  });
});
