// Reading a scene's properties, however they were written.

import { describe, expect, it } from 'vitest';
import { MAX_TARGET, formatDisplayDate, hasSynopsis, readSceneFields } from '../../src/core/cards';
import { parseTargetText } from '../../src/core/cards/sceneFields';
import { newSceneFrontmatter } from '../../src/core/scene';
import { HEBREW, deepFreeze } from './helpers';

describe('readSceneFields', () => {
  it('reads a scene as the plugin writes it', () => {
    const fields = readSceneFields(
      newSceneFrontmatter(1, '2026-10-01', { synopsis: 'Anna finds the letter.', status: 'First draft', label: 'Anna' }),
    );
    expect(fields).toEqual({
      synopsis: 'Anna finds the letter.',
      status: 'First draft',
      label: 'Anna',
      target: null,
      compile: true,
      created: '2026-10-01',
      edited: null,
      problems: [],
    });
  });

  it('reads Hebrew text unchanged', () => {
    const fields = readSceneFields({ synopsis: HEBREW.synopsis, status: HEBREW.firstDraft, label: HEBREW.anna });
    expect(fields.synopsis).toBe(HEBREW.synopsis);
    expect(fields.status).toBe(HEBREW.firstDraft);
    expect(fields.label).toBe(HEBREW.anna);
    expect(fields.problems).toEqual([]);
  });

  it('gives the usual values when there are no properties at all', () => {
    const usual = {
      synopsis: '',
      status: null,
      label: null,
      target: null,
      compile: true,
      created: null,
      edited: null,
      problems: [],
    };
    expect(readSceneFields(null)).toEqual(usual);
    expect(readSceneFields(undefined)).toEqual(usual);
    expect(readSceneFields({})).toEqual(usual);
  });

  it('treats empty properties as not set, without complaint', () => {
    const fields = readSceneFields({ synopsis: null, status: '', label: '   ', target: null, compile: null, created: '', edited: null });
    expect(fields.status).toBeNull();
    expect(fields.label).toBeNull();
    expect(fields.target).toBeNull();
    expect(fields.compile).toBe(true);
    expect(fields.created).toBeNull();
    expect(fields.problems).toEqual([]);
  });

  it('keeps the synopsis exactly as stored, spaces and line breaks included', () => {
    const synopsis = `  ${HEBREW.synopsis}\n\n  second  line  `;
    expect(readSceneFields({ synopsis }).synopsis).toBe(synopsis);
  });

  it('tidies the spacing of a status or label name, and nothing else about it', () => {
    expect(readSceneFields({ status: '  First   draft ' }).status).toBe('First draft');
    expect(readSceneFields({ label: ` ${HEBREW.firstDraft}  ` }).label).toBe(HEBREW.firstDraft);
    expect(readSceneFields({ status: 'first DRAFT' }).status).toBe('first DRAFT');
  });

  it('reads a name or synopsis that the properties stored as a number', () => {
    const fields = readSceneFields({ synopsis: 1984, status: 2, label: 1984 });
    expect(fields.synopsis).toBe('1984');
    expect(fields.status).toBe('2');
    expect(fields.label).toBe('1984');
    expect(fields.problems).toEqual([]);
  });

  describe('target', () => {
    it('reads a whole number of words', () => {
      expect(readSceneFields({ target: 1500 }).target).toBe(1500);
      expect(readSceneFields({ target: 1 }).target).toBe(1);
    });

    it('reads a target typed as text, with or without commas', () => {
      expect(readSceneFields({ target: '1500' }).target).toBe(1500);
      expect(readSceneFields({ target: ' 1,500 ' }).target).toBe(1500);
      expect(readSceneFields({ target: '12,345,678' }).target).toBeNull(); // above the largest target
      expect(readSceneFields({ target: '2,500,000' }).target).toBe(2500000);
    });

    it('rounds a target with a fraction to the nearest whole word', () => {
      expect(readSceneFields({ target: 1500.4 }).target).toBe(1500);
      expect(readSceneFields({ target: 1499.5 }).target).toBe(1500);
    });

    it('takes zero as no target', () => {
      const fields = readSceneFields({ target: 0 });
      expect(fields.target).toBeNull();
      expect(fields.problems).toEqual([]);
      expect(readSceneFields({ target: '0' }).target).toBeNull();
    });

    it('reads anything else as no target and says so', () => {
      for (const odd of [-5, Number.NaN, Number.POSITIVE_INFINITY, MAX_TARGET + 1, 'soon', '1500 words', '1.5', '-3', '1,50', true, [1500], { words: 1500 }]) {
        const fields = readSceneFields({ target: odd });
        expect(fields.target, String(odd)).toBeNull();
        expect(fields.problems, String(odd)).toHaveLength(1);
        expect(fields.problems[0]).toContain('"target"');
      }
    });
  });

  describe('compile', () => {
    it('is yes unless the scene says no', () => {
      expect(readSceneFields({}).compile).toBe(true);
      expect(readSceneFields({ compile: true }).compile).toBe(true);
      expect(readSceneFields({ compile: false }).compile).toBe(false);
    });

    it('understands yes and no written as words or as 1 and 0', () => {
      for (const yes of ['true', 'Yes', ' YES ', 'y', 'on', 1]) expect(readSceneFields({ compile: yes }).compile, String(yes)).toBe(true);
      for (const no of ['false', 'No', ' no ', 'n', 'off', 0]) expect(readSceneFields({ compile: no }).compile, String(no)).toBe(false);
    });

    it('keeps a scene in the manuscript when the value makes no sense, and says so', () => {
      for (const odd of ['maybe', 2, ['no'], {}]) {
        const fields = readSceneFields({ compile: odd });
        expect(fields.compile, String(odd)).toBe(true);
        expect(fields.problems, String(odd)).toHaveLength(1);
        expect(fields.problems[0]).toContain('"compile"');
      }
    });
  });

  describe('created and edited', () => {
    it('reads a date written as YYYY-MM-DD', () => {
      const fields = readSceneFields({ created: '2026-10-01', edited: '2026-10-13' });
      expect(fields.created).toBe('2026-10-01');
      expect(fields.edited).toBe('2026-10-13');
    });

    it('takes the date from a date with a time of day', () => {
      expect(readSceneFields({ edited: '2026-10-13T08:30:00' }).edited).toBe('2026-10-13');
      expect(readSceneFields({ edited: '2026-10-13 08:30' }).edited).toBe('2026-10-13');
      expect(readSceneFields({ created: ' 2024-02-29 ' }).created).toBe('2024-02-29');
    });

    it('reads anything that is not a real date as not known, and says so', () => {
      for (const odd of ['yesterday', '2026-02-30', '13/10/2026', '2026-10-13x', '2026-1-3', 20261013, true, ['2026-10-13']]) {
        const fields = readSceneFields({ created: odd });
        expect(fields.created, String(odd)).toBeNull();
        expect(fields.problems, String(odd)).toHaveLength(1);
        expect(fields.problems[0]).toContain('"created"');
      }
    });
  });

  it('never throws, whatever the properties hold', () => {
    const junk: unknown[] = [null, undefined, 0, -1, Number.NaN, '', 'text', HEBREW.prose, true, false, [], [1, 'a'], {}, { a: 1 }, () => 1];
    for (const value of junk) {
      const frontmatter = { synopsis: value, status: value, label: value, target: value, compile: value, created: value, edited: value };
      expect(() => readSceneFields(frontmatter)).not.toThrow();
    }
    for (const notProperties of ['text', 7, true, ['a'], () => 1]) {
      expect(() => readSceneFields(notProperties as never)).not.toThrow();
      expect(readSceneFields(notProperties as never).synopsis).toBe('');
    }
  });

  it('describes each property it could not understand in a plain sentence', () => {
    const fields = readSceneFields({ synopsis: ['a', 'b'], status: { name: 'x' }, label: true, target: 'soon', compile: 'maybe', created: 'then', edited: 5 });
    expect(fields.problems).toEqual([
      'The "synopsis" property should be text, but it is a list. It is left as it is.',
      'The "status" property should be text, but it is a group of properties. It is left as it is.',
      'The "label" property should be text, but it is true. It is left as it is.',
      'The "target" property should be a whole number of words, but it is "soon". It is left as it is.',
      'The "compile" property should be yes or no, but it is "maybe". It is left as it is.',
      'The "created" property should be a date written as YYYY-MM-DD, but it is "then". It is left as it is.',
      'The "edited" property should be a date written as YYYY-MM-DD, but it is 5. It is left as it is.',
    ]);
    expect(fields.synopsis).toBe('');
    expect(fields.status).toBeNull();
    expect(fields.label).toBeNull();
  });

  it('does not change the properties it reads', () => {
    const frontmatter = deepFreeze({ synopsis: HEBREW.synopsis, status: ' To do ', target: '1,500', extra: [1, 2] });
    expect(() => readSceneFields(frontmatter)).not.toThrow();
  });
});

describe('parseTargetText', () => {
  it('reads digits, grouped or not', () => {
    expect(parseTargetText('1500')).toBe(1500);
    expect(parseTargetText('1,500')).toBe(1500);
    expect(parseTargetText('  250  ')).toBe(250);
    expect(parseTargetText(String(MAX_TARGET))).toBe(MAX_TARGET);
  });

  it('reads nothing typed, or zero, as no target', () => {
    expect(parseTargetText('')).toBeNull();
    expect(parseTargetText('   ')).toBeNull();
    expect(parseTargetText('0')).toBeNull();
    expect(parseTargetText('000')).toBeNull();
  });

  it('rejects everything else', () => {
    for (const bad of ['abc', '15oo', '1.5', '1,5', ',500', '1,2345', '-3', '+3', '1 500', '1e3', '0x10', HEBREW.anna, String(MAX_TARGET + 1), '99999999999999999999']) {
      expect(parseTargetText(bad), bad).toBe('invalid');
    }
  });
});

describe('hasSynopsis', () => {
  it('is true only when the synopsis property holds something to read', () => {
    expect(hasSynopsis({ synopsis: 'Anna finds the letter.' })).toBe(true);
    expect(hasSynopsis({ synopsis: HEBREW.synopsis })).toBe(true);
    expect(hasSynopsis({ synopsis: '' })).toBe(false);
    expect(hasSynopsis({ synopsis: '  \n ' })).toBe(false);
    expect(hasSynopsis({ synopsis: ['a'] })).toBe(false);
    expect(hasSynopsis({})).toBe(false);
    expect(hasSynopsis(null)).toBe(false);
    expect(hasSynopsis(undefined)).toBe(false);
  });
});

describe('formatDisplayDate', () => {
  it('writes a date the English way, with a short month name', () => {
    expect(formatDisplayDate('2026-10-13')).toBe('13 Oct 2026');
    expect(formatDisplayDate('2026-01-03')).toBe('3 Jan 2026');
    expect(formatDisplayDate('2024-02-29')).toBe('29 Feb 2024');
    expect(formatDisplayDate('1999-12-31')).toBe('31 Dec 1999');
  });

  it('names every month', () => {
    const months = Array.from({ length: 12 }, (_, index) => formatDisplayDate(`2026-${String(index + 1).padStart(2, '0')}-15`));
    expect(months.map((text) => text.split(' ')[1])).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  });

  it('gives nothing for text that is not a real date', () => {
    for (const bad of ['', 'today', '2026-02-30', '2026-13-01', '2026-10-13T08:00', null, undefined]) {
      expect(formatDisplayDate(bad), String(bad)).toBe('');
    }
  });

  it('gives the same answer in every time zone, because it never asks for one', () => {
    // The first and last day of a year are where a time-zone slip would show.
    expect(formatDisplayDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDisplayDate('2026-12-31')).toBe('31 Dec 2026');
  });
});
