import { describe, expect, it } from 'vitest';
import { MARKS_KEY, MARK_COLORS, isMarkColor, parseMarks, removeMark, setMark } from '../../src/core/planner';
import type { MarkColor, MarksEdit } from '../../src/core/planner';

// Hebrew: "deadline", "the editor's birthday".
const DEADLINE = 'מועד אחרון';
const BIRTHDAY = 'יום הולדת של העורכת';
const RLM = '\u{200F}';

/** The new value of a change that must have gone through. */
function stored(edit: MarksEdit): Record<string, unknown> {
  if (edit.status !== 'done') throw new Error(`expected the change to be made, but: ${edit.status} (${edit.reason}) ${edit.message}`);
  return edit.marks;
}

function outcome(edit: MarksEdit): string {
  return edit.status === 'done' ? 'done' : `${edit.status}:${edit.reason}`;
}

/** Freeze a value all the way down, so that any attempt to change it in place throws. */
function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

describe('the colours', () => {
  it('are the eight agreed names', () => {
    expect(MARK_COLORS).toEqual(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']);
    expect(MARKS_KEY).toBe('marks');
  });

  it('are recognised exactly', () => {
    for (const color of MARK_COLORS) expect(isMarkColor(color)).toBe(true);
    for (const other of ['teal', 'Red', ' red', '', 'grey', '#ff0000', 'var(--color-red)', null, undefined, 3, ['red'], { color: 'red' }]) {
      expect(isMarkColor(other), JSON.stringify(other)).toBe(false);
    }
  });
});

describe('parseMarks', () => {
  it('reads marks by day', () => {
    const parsed = parseMarks({
      '2026-10-20': { color: 'red', label: 'Deadline' },
      '2026-11-01': { color: 'blue', label: DEADLINE },
    });
    expect([...parsed.marks]).toEqual([
      ['2026-10-20', { color: 'red', label: 'Deadline' }],
      ['2026-11-01', { color: 'blue', label: DEADLINE }],
    ]);
    expect(parsed.notes).toEqual([]);
    expect(parsed.writable).toBe(true);
  });

  it('reads every colour', () => {
    const raw = Object.fromEntries(MARK_COLORS.map((color, i) => [`2026-10-${10 + i}`, { color, label: color }]));
    const parsed = parseMarks(raw);
    expect([...parsed.marks.values()].map((mark) => mark.color)).toEqual([...MARK_COLORS]);
  });

  it('keeps a Hebrew label exactly, direction marks and all', () => {
    const label = `${RLM}${BIRTHDAY} (30)${RLM}`;
    expect(parseMarks({ '2026-10-20': { color: 'pink', label } }).marks.get('2026-10-20')?.label).toBe(label);
    expect(parseMarks({ '2026-10-20': { label: `  ${DEADLINE}  ` } }).marks.get('2026-10-20')?.label).toBe(`  ${DEADLINE}  `);
  });

  it('reads nothing stored as no marks', () => {
    for (const raw of [undefined, null, {}, []]) {
      const parsed = parseMarks(raw);
      expect(parsed.marks.size).toBe(0);
      expect(parsed.notes).toEqual([]);
      expect(parsed.writable).toBe(true);
    }
  });

  it('reads a mark with only a colour, or only a label', () => {
    const parsed = parseMarks({ '2026-10-20': { color: 'green' }, '2026-10-21': { label: 'Party' }, '2026-10-22': {} });
    expect(parsed.marks.get('2026-10-20')).toEqual({ color: 'green', label: '' });
    expect(parsed.marks.get('2026-10-21')).toEqual({ color: null, label: 'Party' });
    expect(parsed.marks.get('2026-10-22')).toEqual({ color: null, label: '' });
    expect(parsed.notes).toEqual([]);
  });

  it('reads a colour it does not know as no colour, and says so', () => {
    const parsed = parseMarks({
      '2026-10-20': { color: 'teal', label: 'From a newer version' },
      '2026-10-21': { color: 7, label: 'A number' },
      '2026-10-22': { color: '', label: 'Empty' },
      '2026-10-23': { color: null, label: 'Null' },
    });
    expect([...parsed.marks.values()].map((mark) => mark.color)).toEqual([null, null, null, null]);
    expect([...parsed.marks.values()].map((mark) => mark.label)).toEqual(['From a newer version', 'A number', 'Empty', 'Null']);
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0]).toContain('2026-10-20');
    expect(parsed.notes[0]).toContain('teal');
    expect(parsed.notes[1]).toContain('2026-10-21');
  });

  it('forgives capitals and spaces in a hand-typed colour, and a label typed as a number', () => {
    const parsed = parseMarks({ '2026-10-20': { color: ' Red ', label: 1984 }, '2026-10-21': { color: 'PURPLE', label: true } });
    expect(parsed.marks.get('2026-10-20')).toEqual({ color: 'red', label: '1984' });
    expect(parsed.marks.get('2026-10-21')).toEqual({ color: 'purple', label: '' });
    expect(parsed.notes).toEqual([]);
  });

  it('leaves out what it cannot read, says what, and still reads the rest', () => {
    const parsed = parseMarks({
      '2026-10-20': { color: 'red', label: 'Deadline' },
      '2026-02-30': { color: 'red', label: 'No such day' },
      someday: { color: 'blue', label: 'Not a date' },
      '2026-1-5': { color: 'blue', label: 'Short date' },
      '2026-10-21': 'Deadline',
      '2026-10-22': ['red', 'Deadline'],
      '2026-10-23': null,
      '2026-10-24': 12,
      '2026-10-25': { color: 'cyan', label: DEADLINE },
    });
    expect([...parsed.marks.keys()]).toEqual(['2026-10-20', '2026-10-25']);
    expect(parsed.marks.get('2026-10-25')).toEqual({ color: 'cyan', label: DEADLINE });
    expect(parsed.notes).toHaveLength(7);
    for (const key of ['2026-02-30', 'someday', '2026-1-5', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']) {
      expect(parsed.notes.some((note) => note.includes(key)), key).toBe(true);
    }
    expect(parsed.writable).toBe(true);
  });

  it('reads a value that is not a group of days as unreadable, and never throws', () => {
    for (const raw of ['oops', 42, true, ['2026-10-20'], [{ color: 'red' }], Symbol('x'), () => 1, Number.NaN]) {
      const parsed = parseMarks(raw);
      expect(parsed.marks.size).toBe(0);
      expect(parsed.writable).toBe(false);
      expect(parsed.notes).toHaveLength(1);
      expect(parsed.notes[0]).toContain('marks');
    }
  });

  it('ignores properties of a mark it has never heard of', () => {
    const parsed = parseMarks({ '2026-10-20': { color: 'red', label: 'Deadline', icon: 'star', nested: { a: 1 } } });
    expect(parsed.marks.get('2026-10-20')).toEqual({ color: 'red', label: 'Deadline' });
    expect(parsed.notes).toEqual([]);
  });
});

describe('setMark', () => {
  it('puts the first mark into an index that has none', () => {
    for (const raw of [undefined, null, {}, []]) {
      expect(stored(setMark(raw, '2026-10-20', { color: 'red', label: 'Deadline' }))).toEqual({
        '2026-10-20': { color: 'red', label: 'Deadline' },
      });
    }
  });

  it('adds a mark and hands every other entry back as it was', () => {
    const other = { color: 'blue', label: DEADLINE };
    const raw = frozen({ '2026-11-01': other, '2026-09-01': { color: 'green' } });
    const next = stored(setMark(raw, '2026-10-20', { color: 'red', label: 'Deadline' }));
    expect(next).toEqual({
      '2026-11-01': { color: 'blue', label: DEADLINE },
      '2026-09-01': { color: 'green' },
      '2026-10-20': { color: 'red', label: 'Deadline' },
    });
    expect(next['2026-11-01']).toBe(other);
    // existing days keep their order; the new day goes last
    expect(Object.keys(next)).toEqual(['2026-11-01', '2026-09-01', '2026-10-20']);
    // the value handed in was not changed
    expect(raw).toEqual({ '2026-11-01': { color: 'blue', label: DEADLINE }, '2026-09-01': { color: 'green' } });
    expect(next).not.toBe(raw);
  });

  it('writes a Hebrew label exactly and reads it back', () => {
    const next = stored(setMark({}, '2026-10-20', { color: 'purple', label: BIRTHDAY }));
    expect(next).toEqual({ '2026-10-20': { color: 'purple', label: BIRTHDAY } });
    expect(parseMarks(next).marks.get('2026-10-20')).toEqual({ color: 'purple', label: BIRTHDAY });
    const marked = stored(setMark({}, '2026-10-21', { label: `${RLM}${DEADLINE}   2${RLM}` }));
    expect(parseMarks(marked).marks.get('2026-10-21')?.label).toBe(`${RLM}${DEADLINE}   2${RLM}`);
  });

  it('writes every colour so that it reads back the same', () => {
    let raw: unknown = undefined;
    MARK_COLORS.forEach((color, i) => {
      raw = stored(setMark(raw, `2026-10-${10 + i}`, { color }));
    });
    expect([...parseMarks(raw).marks.values()].map((mark) => mark.color)).toEqual([...MARK_COLORS]);
    expect(parseMarks(raw).notes).toEqual([]);
  });

  it('changes only the part it is asked to change', () => {
    const raw = frozen({ '2026-10-20': { color: 'red', label: 'Deadline' }, '2026-10-21': { color: 'blue', label: 'Other' } });
    expect(stored(setMark(raw, '2026-10-20', { label: DEADLINE }))).toEqual({
      '2026-10-20': { color: 'red', label: DEADLINE },
      '2026-10-21': { color: 'blue', label: 'Other' },
    });
    expect(stored(setMark(raw, '2026-10-20', { color: 'green' }))['2026-10-20']).toEqual({ color: 'green', label: 'Deadline' });
    expect(stored(setMark(raw, '2026-10-20', { color: null }))['2026-10-20']).toEqual({ label: 'Deadline' });
    expect(stored(setMark(raw, '2026-10-20', { label: '' }))['2026-10-20']).toEqual({ color: 'red' });
    expect(Object.keys(stored(setMark(raw, '2026-10-20', { color: 'pink', label: 'x' })))).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('keeps a colour it does not know when only the label changes, and replaces it when a colour is chosen', () => {
    const raw = frozen({ '2026-10-20': { color: 'teal', label: 'From a newer version' } });
    expect(stored(setMark(raw, '2026-10-20', { label: 'Renamed' }))).toEqual({ '2026-10-20': { color: 'teal', label: 'Renamed' } });
    expect(stored(setMark(raw, '2026-10-20', { color: 'cyan' }))).toEqual({ '2026-10-20': { color: 'cyan', label: 'From a newer version' } });
    // taking the label away leaves the unknown colour stored
    expect(stored(setMark(raw, '2026-10-20', { label: '' }))).toEqual({ '2026-10-20': { color: 'teal' } });
  });

  it('keeps properties of the mark it has never heard of', () => {
    const raw = frozen({ '2026-10-20': { color: 'red', label: 'Deadline', icon: 'star', nested: { a: [1, 2] } } });
    const next = stored(setMark(raw, '2026-10-20', { color: 'blue', label: 'Moved' }));
    expect(next).toEqual({ '2026-10-20': { color: 'blue', label: 'Moved', icon: 'star', nested: { a: [1, 2] } } });
    // even with colour and label both gone, what is left is not thrown away
    expect(stored(setMark(raw, '2026-10-20', { color: null, label: '' }))).toEqual({ '2026-10-20': { icon: 'star', nested: { a: [1, 2] } } });
  });

  it('keeps every entry it could not read', () => {
    const raw = frozen({
      someday: { color: 'blue', label: 'Not a date' },
      '2026-02-30': 'No such day',
      '2026-10-21': 'Deadline',
      '2026-10-22': ['red'],
      '2026-10-23': null,
    });
    const next = stored(setMark(raw, '2026-10-20', { color: 'red' }));
    expect(next).toEqual({ ...raw, '2026-10-20': { color: 'red' } });
    expect(Object.keys(next)).toEqual(['someday', '2026-02-30', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-20']);
    expect(stored(removeMark(next, '2026-10-20'))).toEqual(raw);
  });

  it('removes the entry when neither colour nor label nor anything else is left', () => {
    const raw = frozen({ '2026-10-20': { color: 'red', label: 'Deadline' }, '2026-10-21': { label: 'Stays' } });
    expect(stored(setMark(raw, '2026-10-20', { color: null, label: '' }))).toEqual({ '2026-10-21': { label: 'Stays' } });
    expect(stored(setMark(raw, '2026-10-21', { label: '   ' }))).toEqual({ '2026-10-20': { color: 'red', label: 'Deadline' } });
  });

  it('keeps a label on one line and trims its ends, but never its inside', () => {
    expect(stored(setMark({}, '2026-10-20', { label: `  ${DEADLINE}   (x2) \n` }))).toEqual({ '2026-10-20': { label: `${DEADLINE}   (x2)` } });
    expect(stored(setMark({}, '2026-10-20', { label: 'one\r\ntwo\n\nthree' }))).toEqual({ '2026-10-20': { label: 'one two three' } });
  });

  it('replaces an entry it could not read when a real mark is set on that day', () => {
    const raw = frozen({ '2026-10-20': 'Deadline', '2026-10-21': 'kept' });
    expect(stored(setMark(raw, '2026-10-20', { color: 'red', label: 'Deadline' }))).toEqual({
      '2026-10-20': { color: 'red', label: 'Deadline' },
      '2026-10-21': 'kept',
    });
    // but a change that sets nothing leaves it alone
    expect(outcome(setMark(raw, '2026-10-20', {}))).toBe('noop:unchanged');
    expect(outcome(setMark(raw, '2026-10-20', { label: '' }))).toBe('noop:unchanged');
    expect(outcome(setMark(raw, '2026-10-20', { color: null }))).toBe('noop:unchanged');
  });

  it('reports a mark that is already like that', () => {
    const raw = frozen({ '2026-10-20': { color: 'red', label: 'Deadline' } });
    expect(outcome(setMark(raw, '2026-10-20', { color: 'red', label: 'Deadline' }))).toBe('noop:unchanged');
    expect(outcome(setMark(raw, '2026-10-20', { color: 'red' }))).toBe('noop:unchanged');
    expect(outcome(setMark(raw, '2026-10-20', { label: ' Deadline ' }))).toBe('noop:unchanged');
    expect(outcome(setMark(raw, '2026-10-20', {}))).toBe('noop:unchanged');
    expect(outcome(setMark(raw, '2026-10-22', {}))).toBe('noop:unchanged');
    expect(outcome(setMark(raw, '2026-10-22', { color: null, label: '' }))).toBe('noop:unchanged');
    expect(outcome(setMark(undefined, '2026-10-22', { label: '' }))).toBe('noop:unchanged');
  });

  it('refuses a day that is not a date and a colour that is not one of the eight', () => {
    for (const date of ['2026-02-30', '20-10-2026', 'someday', '', '2026-10-20T00:00', '__proto__', 'constructor']) {
      expect(outcome(setMark({}, date, { color: 'red' })), date).toBe('refused:invalid-date');
    }
    for (const color of ['teal', 'Red', '', '#f00', 3]) {
      expect(outcome(setMark({}, '2026-10-20', { color: color as MarkColor })), String(color)).toBe('refused:invalid-color');
    }
  });

  it('refuses to replace a "marks" value that is not a group of days', () => {
    for (const raw of ['oops', 42, true, ['2026-10-20'], [{ color: 'red' }]]) {
      const edit = setMark(raw, '2026-10-20', { color: 'red' });
      expect(outcome(edit), JSON.stringify(raw)).toBe('refused:unreadable');
      expect(edit.status === 'refused' && edit.message.length > 0).toBe(true);
      expect(outcome(removeMark(raw, '2026-10-20'))).toBe('refused:unreadable');
    }
  });
});

describe('removeMark', () => {
  it('takes one day out and hands the rest back as it was', () => {
    const kept = { color: 'blue', label: DEADLINE };
    const raw = frozen({ '2026-10-20': { color: 'red', label: 'Deadline' }, '2026-11-01': kept, odd: 'kept too' });
    const next = stored(removeMark(raw, '2026-10-20'));
    expect(next).toEqual({ '2026-11-01': { color: 'blue', label: DEADLINE }, odd: 'kept too' });
    expect(next['2026-11-01']).toBe(kept);
    expect(Object.keys(raw)).toHaveLength(3);
  });

  it('leaves an empty group when the last mark goes', () => {
    expect(stored(removeMark({ '2026-10-20': { color: 'red' } }, '2026-10-20'))).toEqual({});
  });

  it('removes whatever is stored for that day, readable or not', () => {
    expect(stored(removeMark({ '2026-10-20': 'Deadline', '2026-10-21': {} }, '2026-10-20'))).toEqual({ '2026-10-21': {} });
  });

  it('reports a day that has no mark, and refuses a day that is not a date', () => {
    expect(outcome(removeMark({ '2026-10-20': { color: 'red' } }, '2026-10-21'))).toBe('noop:not-found');
    expect(outcome(removeMark(undefined, '2026-10-21'))).toBe('noop:not-found');
    expect(outcome(removeMark([], '2026-10-21'))).toBe('noop:not-found');
    expect(outcome(removeMark({ someday: 1 }, 'someday'))).toBe('refused:invalid-date');
    expect(outcome(removeMark({}, 'toString'))).toBe('refused:invalid-date');
  });
});

describe('a round of changes, as the screen would make them', () => {
  it('ends with exactly the marks that were set, and the hand-written oddities untouched', () => {
    let raw: unknown = { '2026-12-25': 'written by hand, wrongly', '2026-10-01': { color: 'teal', label: 'newer version', extra: 1 } };
    raw = stored(setMark(raw, '2026-10-20', { color: 'red', label: 'Deadline' }));
    raw = stored(setMark(raw, '2026-10-21', { label: DEADLINE }));
    raw = stored(setMark(raw, '2026-10-20', { color: 'orange' }));
    raw = stored(setMark(raw, '2026-10-01', { label: BIRTHDAY }));
    raw = stored(removeMark(raw, '2026-10-21'));
    expect(raw).toEqual({
      '2026-12-25': 'written by hand, wrongly',
      '2026-10-01': { color: 'teal', label: BIRTHDAY, extra: 1 },
      '2026-10-20': { color: 'orange', label: 'Deadline' },
    });
    const parsed = parseMarks(raw);
    expect([...parsed.marks]).toEqual([
      ['2026-10-01', { color: null, label: BIRTHDAY }],
      ['2026-10-20', { color: 'orange', label: 'Deadline' }],
    ]);
    expect(parsed.notes).toHaveLength(2);
  });
});
