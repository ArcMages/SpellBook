import { describe, expect, it } from 'vitest';
import {
  MAX_TARGET_WORDS,
  NO_TARGETS,
  TARGETS_KEY,
  deadlineProgress,
  parseTargets,
  readWordTarget,
  targetProgress,
  updateTargets,
  validateTargets,
  writingProgress,
} from '../../src/core/progress';
import type { Targets } from '../../src/core/progress';

const TODAY = '2026-10-13';

describe('readWordTarget', () => {
  it('reads a whole number of words however it was typed', () => {
    expect(readWordTarget(80000)).toBe(80000);
    expect(readWordTarget('80000')).toBe(80000);
    expect(readWordTarget(' 80000 ')).toBe(80000);
    expect(readWordTarget('80,000')).toBe(80000);
    expect(readWordTarget('80 000')).toBe(80000);
    expect(readWordTarget('80_000')).toBe(80000);
    expect(readWordTarget('1,250,000')).toBe(1250000);
    expect(readWordTarget(1)).toBe(1);
    expect(readWordTarget(499.6)).toBe(500);
  });

  it('gives null for anything that is not a whole number above zero', () => {
    for (const value of [0, -5, 0.2, Number.NaN, Number.POSITIVE_INFINITY, '', '  ', 'many', 'אלף', '80k', '-80', '8e4', '1.5', '80,', ',80', true, null, undefined, [], {}, [80000]]) {
      expect(readWordTarget(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('parseTargets', () => {
  it('reads all three parts', () => {
    expect(parseTargets({ project: 80000, daily: 500, deadline: '2026-12-31' })).toEqual({
      targets: { project: 80000, daily: 500, deadline: '2026-12-31' },
      problems: [],
    });
  });

  it('reads each part on its own, the others being not set', () => {
    expect(parseTargets({ project: 80000 }).targets).toEqual({ project: 80000, daily: null, deadline: null });
    expect(parseTargets({ daily: 500 }).targets).toEqual({ project: null, daily: 500, deadline: null });
    expect(parseTargets({ deadline: '2026-12-31' }).targets).toEqual({ project: null, daily: null, deadline: '2026-12-31' });
    expect(parseTargets({}).targets).toEqual(NO_TARGETS);
  });

  it('reads nothing, without complaint, when there are no targets', () => {
    expect(parseTargets(undefined)).toEqual({ targets: NO_TARGETS, problems: [] });
    expect(parseTargets(null)).toEqual({ targets: NO_TARGETS, problems: [] });
    expect(parseTargets({ project: null, daily: '', deadline: '   ' })).toEqual({ targets: NO_TARGETS, problems: [] });
  });

  it('reads values typed by hand', () => {
    const parsed = parseTargets({ project: '80,000', daily: ' 500 ', deadline: '2026-12-31T00:00:00.000Z' });
    expect(parsed).toEqual({ targets: { project: 80000, daily: 500, deadline: '2026-12-31' }, problems: [] });
    // Some YAML readers hand a bare date over as a date value.
    expect(parseTargets({ deadline: new Date(Date.UTC(2026, 11, 31)) }).targets.deadline).toBe('2026-12-31');
  });

  it('reads what it can and reports the rest', () => {
    const parsed = parseTargets({ project: 'a great many', daily: 500, deadline: '31/12/2026' });
    expect(parsed.targets).toEqual({ project: null, daily: 500, deadline: null });
    expect(parsed.problems).toHaveLength(2);
    expect(parsed.problems[0]).toMatch(/project target/);
    expect(parsed.problems[1]).toMatch(/deadline/);

    expect(parseTargets({ project: -1, daily: 0, deadline: '2026-02-30' }).targets).toEqual(NO_TARGETS);
    expect(parseTargets({ project: -1, daily: 0, deadline: '2026-02-30' }).problems).toHaveLength(3);
  });

  it('never throws, whatever is stored under the key', () => {
    for (const raw of ['80000', 80000, true, [], [{ project: 5 }], () => 5, Symbol('x')]) {
      const parsed = parseTargets(raw);
      expect(parsed.targets).toEqual(NO_TARGETS);
      expect(parsed.problems).toHaveLength(1);
    }
    expect(parseTargets(new Date(0)).targets).toEqual(NO_TARGETS);
    expect(parseTargets(Object.create(null)).targets).toEqual(NO_TARGETS);
  });

  it('ignores parts it does not know', () => {
    expect(parseTargets({ project: 80000, session: 250, note: 'טיוטה ראשונה' })).toEqual({
      targets: { project: 80000, daily: null, deadline: null },
      problems: [],
    });
  });

  it('lives under the key "targets"', () => {
    expect(TARGETS_KEY).toBe('targets');
    const frontmatter = { spellbook: 'project', title: 'הרומן שלי', [TARGETS_KEY]: { daily: 300 } };
    expect(parseTargets(frontmatter[TARGETS_KEY]).targets.daily).toBe(300);
  });
});

describe('validateTargets', () => {
  it('accepts a filled-in form', () => {
    expect(validateTargets({ project: '80,000', daily: '500', deadline: '2026-12-31' })).toEqual({
      ok: true,
      targets: { project: 80000, daily: 500, deadline: '2026-12-31' },
    });
    expect(validateTargets({ project: 80000, daily: 500, deadline: '2026-12-31' })).toMatchObject({ ok: true });
  });

  it('reads an empty field as "no target"', () => {
    expect(validateTargets({ project: '', daily: '   ', deadline: '' })).toEqual({ ok: true, targets: NO_TARGETS });
    expect(validateTargets({})).toEqual({ ok: true, targets: NO_TARGETS });
    expect(validateTargets({ project: null, daily: undefined, deadline: null })).toEqual({ ok: true, targets: NO_TARGETS });
  });

  it('gives a message for each field that is wrong, and only for those', () => {
    const result = validateTargets({ project: 'lots', daily: '500', deadline: 'new year' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['deadline', 'project']);
    expect(result.errors.project).toMatch(/whole number/);
    expect(result.errors.deadline).toMatch(/YYYY-MM-DD/);
  });

  it('refuses zero, negative numbers, fractions written as text, and dates that do not exist', () => {
    for (const bad of ['0', '-500', '1.5', 'חמש מאות', 0, -1]) {
      const result = validateTargets({ daily: bad });
      expect(result.ok, String(bad)).toBe(false);
    }
    for (const bad of ['2026-02-30', '31/12/2026', '2026-12', 'מחר']) {
      const result = validateTargets({ deadline: bad });
      expect(result.ok, bad).toBe(false);
    }
  });

  it('refuses a number too large to be meant', () => {
    expect(validateTargets({ project: MAX_TARGET_WORDS })).toMatchObject({ ok: true });
    const result = validateTargets({ project: MAX_TARGET_WORDS + 1 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.project).toMatch(/more words/);
  });

  it('accepts a deadline that has passed: that is for the writer to decide', () => {
    expect(validateTargets({ deadline: '2020-01-01' })).toMatchObject({ ok: true });
  });
});

describe('updateTargets', () => {
  it('sets a target where there were none', () => {
    expect(updateTargets(undefined, { project: 80000 })).toEqual({ project: 80000 });
    expect(updateTargets(null, { daily: 500, deadline: '2026-12-31' })).toEqual({ daily: 500, deadline: '2026-12-31' });
  });

  it('changes only the part it was asked to change', () => {
    const stored = { project: 80000, daily: 500, deadline: '2026-12-31' };
    expect(updateTargets(stored, { daily: 750 })).toEqual({ project: 80000, daily: 750, deadline: '2026-12-31' });
    expect(updateTargets(stored, { deadline: '2027-06-30' })).toEqual({ project: 80000, daily: 500, deadline: '2027-06-30' });
    expect(stored).toEqual({ project: 80000, daily: 500, deadline: '2026-12-31' }); // what it was given is not changed
  });

  it('removes a target with null, and the whole key when nothing is left', () => {
    expect(updateTargets({ project: 80000, daily: 500 }, { daily: null })).toEqual({ project: 80000 });
    expect(updateTargets({ project: 80000 }, { project: null })).toBeUndefined();
    expect(updateTargets(undefined, {})).toBeUndefined();
    expect(updateTargets({}, { daily: null })).toBeUndefined();
  });

  it('keeps parts it does not know, and parts it could not read, exactly as stored', () => {
    const stored = { project: 'eighty thousand', session: 250, note: 'טיוטה ראשונה', deadline: 'new year', nested: { a: [1, 2] } };
    const next = updateTargets(stored, { daily: 500 });
    expect(next).toEqual({ ...stored, daily: 500 });
    expect(next?.['nested']).toBe(stored.nested);
    // Asked to change the part it could not read: now it is replaced.
    expect(updateTargets(stored, { project: 90000 })?.['project']).toBe(90000);
    // Removing the last target it knows leaves the unknown parts in place.
    expect(updateTargets({ daily: 500, session: 250 }, { daily: null })).toEqual({ session: 250 });
  });

  it('keeps the order of the parts that were there', () => {
    expect(Object.keys(updateTargets({ deadline: '2026-12-31', project: 1 }, { daily: 5, project: 2 }) ?? {})).toEqual(['deadline', 'project', 'daily']);
  });

  it('ignores a new value that is not valid, leaving what was stored', () => {
    const stored = { project: 80000, daily: 500, deadline: '2026-12-31' };
    expect(updateTargets(stored, { project: 0 })).toEqual(stored);
    expect(updateTargets(stored, { project: -3 })).toEqual(stored);
    expect(updateTargets(stored, { daily: 2.5 })).toEqual(stored);
    expect(updateTargets(stored, { daily: Number.NaN })).toEqual(stored);
    expect(updateTargets(stored, { project: MAX_TARGET_WORDS + 1 })).toEqual(stored);
    expect(updateTargets(stored, { deadline: '2026-02-30' })).toEqual(stored);
    expect(updateTargets(stored, { deadline: 'soon' })).toEqual(stored);
  });

  it('starts afresh when what is stored is not a group of properties at all', () => {
    expect(updateTargets('80000', { project: 80000 })).toEqual({ project: 80000 });
    expect(updateTargets([1, 2, 3], { daily: 5 })).toEqual({ daily: 5 });
  });

  it('gives a value that reads back as what was asked for', () => {
    const stored = updateTargets({ project: '80,000' }, { daily: 500, deadline: '2026-12-31' });
    expect(parseTargets(stored)).toEqual({ targets: { project: 80000, daily: 500, deadline: '2026-12-31' }, problems: [] });
  });
});

describe('targetProgress', () => {
  it('works out the percentage, the words remaining and whether the target is met', () => {
    expect(targetProgress(20000, 80000)).toEqual({ words: 20000, target: 80000, percent: 25, remaining: 60000, met: false });
    expect(targetProgress(80000, 80000)).toEqual({ words: 80000, target: 80000, percent: 100, remaining: 0, met: true });
    expect(targetProgress(0, 500)).toEqual({ words: 0, target: 500, percent: 0, remaining: 500, met: false });
  });

  it('rounds the percentage down: 99.9% is not there yet', () => {
    expect(targetProgress(79999, 80000)).toMatchObject({ percent: 99, remaining: 1, met: false });
    expect(targetProgress(1, 80000)).toMatchObject({ percent: 0, met: false });
    expect(targetProgress(333, 1000)?.percent).toBe(33);
  });

  it('goes past 100% once the target is passed', () => {
    expect(targetProgress(750, 500)).toEqual({ words: 750, target: 500, percent: 150, remaining: 0, met: true });
  });

  it('copes with a day of cutting: a negative count is 0% and leaves more to write', () => {
    expect(targetProgress(-120, 500)).toEqual({ words: -120, target: 500, percent: 0, remaining: 620, met: false });
  });

  it('gives null when there is no target', () => {
    expect(targetProgress(100, null)).toBeNull();
    expect(targetProgress(100, 0)).toBeNull();
    expect(targetProgress(100, -5)).toBeNull();
    expect(targetProgress(100, Number.NaN)).toBeNull();
  });
});

describe('deadlineProgress', () => {
  const targets = (project: number | null, deadline: string | null): Targets => ({ project, daily: null, deadline });

  it('counts the days left with today and the deadline day both included', () => {
    expect(deadlineProgress(targets(null, '2026-10-13'), 0, 0, TODAY)).toMatchObject({ daysLeft: 1, passed: false });
    expect(deadlineProgress(targets(null, '2026-10-14'), 0, 0, TODAY)).toMatchObject({ daysLeft: 2, passed: false });
    expect(deadlineProgress(targets(null, '2026-12-31'), 0, 0, TODAY)).toMatchObject({ daysLeft: 80, passed: false });
    expect(deadlineProgress(targets(null, '2027-10-13'), 0, 0, TODAY)).toMatchObject({ daysLeft: 366 });
  });

  it('works out the words to write each day, counted from today', () => {
    // 60,000 to go, 80 days left: 750 a day.
    expect(deadlineProgress(targets(80000, '2026-12-31'), 20000, 0, TODAY)).toEqual({
      deadline: '2026-12-31',
      daysLeft: 80,
      passed: false,
      wordsPerDay: 750,
    });
    // It rounds up, so that the last day is not left with a remainder.
    expect(deadlineProgress(targets(80000, '2026-10-15'), 79000, 0, TODAY)?.wordsPerDay).toBe(334);
    // Everything that is left, when the deadline is today.
    expect(deadlineProgress(targets(80000, TODAY), 79000, 0, TODAY)?.wordsPerDay).toBe(1000);
  });

  it('stays the same all day: it is worked out from this morning\'s count', () => {
    const morning = deadlineProgress(targets(80000, '2026-12-31'), 20000, 0, TODAY);
    const afterWriting = deadlineProgress(targets(80000, '2026-12-31'), 20600, 600, TODAY);
    const afterCutting = deadlineProgress(targets(80000, '2026-12-31'), 19800, -200, TODAY);
    expect(morning?.wordsPerDay).toBe(750);
    expect(afterWriting?.wordsPerDay).toBe(750);
    expect(afterCutting?.wordsPerDay).toBe(750);
  });

  it('asks for nothing more once the target is reached', () => {
    expect(deadlineProgress(targets(80000, '2026-12-31'), 80000, 0, TODAY)?.wordsPerDay).toBe(0);
    expect(deadlineProgress(targets(80000, '2026-12-31'), 81000, 1500, TODAY)?.wordsPerDay).toBe(0);
  });

  it('asks for what is missing when the writer cut below a target reached this morning', () => {
    // 80,000 this morning, 400 cut today, 80 days left.
    expect(deadlineProgress(targets(80000, '2026-12-31'), 79600, -400, TODAY)?.wordsPerDay).toBe(5);
  });

  it('says when the deadline has passed, and then gives no words per day', () => {
    expect(deadlineProgress(targets(80000, '2026-10-12'), 20000, 0, TODAY)).toEqual({
      deadline: '2026-10-12',
      daysLeft: 0,
      passed: true,
      wordsPerDay: null,
    });
  });

  it('gives days but no words per day without a project target', () => {
    expect(deadlineProgress(targets(null, '2026-10-20'), 20000, 0, TODAY)).toEqual({
      deadline: '2026-10-20',
      daysLeft: 8,
      passed: false,
      wordsPerDay: null,
    });
  });

  it('gives null without a deadline, or when today is not a real date', () => {
    expect(deadlineProgress(targets(80000, null), 20000, 0, TODAY)).toBeNull();
    expect(deadlineProgress(targets(80000, '2026-12-31'), 20000, 0, 'today')).toBeNull();
    expect(deadlineProgress(targets(80000, 'someday'), 20000, 0, TODAY)).toBeNull();
  });

  it('counts across a leap day and the end of a year', () => {
    expect(deadlineProgress(targets(null, '2024-03-01'), 0, 0, '2024-02-28')?.daysLeft).toBe(3);
    expect(deadlineProgress(targets(null, '2026-03-01'), 0, 0, '2026-02-28')?.daysLeft).toBe(2);
    expect(deadlineProgress(targets(null, '2027-01-01'), 0, 0, '2026-12-31')?.daysLeft).toBe(2);
  });
});

describe('writingProgress', () => {
  it('gives all three figures at once', () => {
    const progress = writingProgress({
      targets: { project: 80000, daily: 500, deadline: '2026-12-31' },
      projectWords: 20600,
      todayWords: 600,
      today: TODAY,
    });
    expect(progress).toEqual({
      project: { words: 20600, target: 80000, percent: 25, remaining: 59400, met: false },
      today: { words: 600, target: 500, percent: 120, remaining: 0, met: true },
      deadline: { deadline: '2026-12-31', daysLeft: 80, passed: false, wordsPerDay: 750 },
    });
  });

  it('says whether today\'s daily target is met', () => {
    const at = (todayWords: number) =>
      writingProgress({ targets: { project: null, daily: 500, deadline: null }, projectWords: 0, todayWords, today: TODAY }).today?.met;
    expect(at(499)).toBe(false);
    expect(at(500)).toBe(true);
    expect(at(-20)).toBe(false);
  });

  it('leaves out every part whose target is not set', () => {
    expect(writingProgress({ targets: NO_TARGETS, projectWords: 20000, todayWords: 100, today: TODAY })).toEqual({
      project: null,
      today: null,
      deadline: null,
    });
  });
});
