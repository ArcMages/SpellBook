import { describe, expect, it } from 'vitest';
import { buildStatusLine, formatDisplayDate, formatNumber } from '../../src/core/progress';
import type { StatusLineInput } from '../../src/core/progress';

describe('formatNumber', () => {
  it('puts a comma between every three digits', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(7)).toBe('7');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatNumber(123456)).toBe('123,456');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(1000000000)).toBe('1,000,000,000');
  });

  it('keeps the sign of a negative number', () => {
    expect(formatNumber(-5)).toBe('-5');
    expect(formatNumber(-1200)).toBe('-1,200');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-0.4)).toBe('0');
  });

  it('rounds fractions and reads anything that is not a number as 0', () => {
    expect(formatNumber(1234.5)).toBe('1,235');
    expect(formatNumber(999.6)).toBe('1,000');
    expect(formatNumber(Number.NaN)).toBe('0');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('reads the same whatever language the device is set to', () => {
    // It never asks the device how numbers are written there.
    expect(formatNumber(1234567.2)).toBe('1,234,567');
  });
});

describe('formatDisplayDate', () => {
  it('reads like "13 Oct 2026"', () => {
    expect(formatDisplayDate('2026-10-13')).toBe('13 Oct 2026');
    expect(formatDisplayDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDisplayDate('2024-02-29')).toBe('29 Feb 2024');
    expect(formatDisplayDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('names every month', () => {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    names.forEach((name, index) => {
      expect(formatDisplayDate(`2026-${String(index + 1).padStart(2, '0')}-05`)).toBe(`5 ${name} 2026`);
    });
  });

  it('gives null for anything that is not a real date', () => {
    for (const text of ['', 'tomorrow', '2026-02-30', '2026-13-01', '13 Oct 2026', '2026-10-13T08:00']) {
      expect(formatDisplayDate(text), text).toBeNull();
    }
  });
});

describe('buildStatusLine', () => {
  const everything: StatusLineInput = {
    sceneWords: 1234,
    sceneTarget: 2000,
    started: '2026-10-02',
    edited: '2026-10-13',
    sessionWords: 350,
    projectWords: 45200,
    projectTarget: 80000,
    todayWords: 350,
    dailyTarget: 500,
  };

  it('builds every piece, in the agreed order', () => {
    expect(buildStatusLine(everything)).toEqual([
      { id: 'scene', label: 'Words', value: '1,234 / 2,000', met: false },
      { id: 'started', label: 'Started', value: '2 Oct 2026' },
      { id: 'edited', label: 'Edited', value: '13 Oct 2026' },
      { id: 'session', label: 'Session', value: '350' },
      { id: 'project', label: 'Project', value: '45,200 / 80,000', met: false },
      { id: 'today', label: 'Today', value: '350 / 500', met: false },
    ]);
  });

  it('shows a count on its own when it has no target', () => {
    const line = buildStatusLine({ ...everything, sceneTarget: null, projectTarget: undefined, dailyTarget: 0 });
    expect(line.map((segment) => [segment.id, segment.value])).toEqual([
      ['scene', '1,234'],
      ['started', '2 Oct 2026'],
      ['edited', '13 Oct 2026'],
      ['session', '350'],
      ['project', '45,200'],
      ['today', '350'],
    ]);
    for (const segment of line) expect('met' in segment, segment.id).toBe(false);
  });

  it('says when a target is reached', () => {
    const line = buildStatusLine({ ...everything, sceneWords: 2000, projectWords: 80001, todayWords: 499 });
    expect(line.find((segment) => segment.id === 'scene')?.met).toBe(true);
    expect(line.find((segment) => segment.id === 'project')?.met).toBe(true);
    expect(line.find((segment) => segment.id === 'today')?.met).toBe(false);
  });

  it('leaves out every piece that has nothing to show', () => {
    expect(buildStatusLine({})).toEqual([]);
    expect(buildStatusLine({ sceneWords: null, started: null, edited: null, sessionWords: null, projectWords: null, todayWords: null })).toEqual([]);
    // No scene is open: only the figures of the session and the project remain.
    expect(buildStatusLine({ sessionWords: 12, projectWords: 45200 }).map((segment) => segment.id)).toEqual(['session', 'project']);
    // A target without a count shows nothing.
    expect(buildStatusLine({ sceneTarget: 2000, projectTarget: 80000, dailyTarget: 500 })).toEqual([]);
    // A scene that was never edited has no "Edited".
    expect(buildStatusLine({ sceneWords: 0, started: '2026-10-13' }).map((segment) => segment.id)).toEqual(['scene', 'started']);
  });

  it('shows a zero: an empty scene and a session that has not begun are still figures', () => {
    expect(buildStatusLine({ sceneWords: 0, sessionWords: 0, projectWords: 0, todayWords: 0 }).map((segment) => segment.value)).toEqual(['0', '0', '0', '0']);
  });

  it('shows a day of cutting as a negative number', () => {
    const line = buildStatusLine({ sessionWords: -1250, todayWords: -40, dailyTarget: 500 });
    expect(line).toEqual([
      { id: 'session', label: 'Session', value: '-1,250' },
      { id: 'today', label: 'Today', value: '-40 / 500', met: false },
    ]);
  });

  it('leaves out a date that is not a real date, and reads one that carries a time', () => {
    expect(buildStatusLine({ started: 'last spring', edited: '2026-02-30' })).toEqual([]);
    expect(buildStatusLine({ started: '2026-10-02T09:15', edited: '' })).toEqual([{ id: 'started', label: 'Started', value: '2 Oct 2026' }]);
  });

  it('ignores figures that are not numbers', () => {
    expect(buildStatusLine({ sceneWords: Number.NaN, projectWords: Number.POSITIVE_INFINITY })).toEqual([]);
    expect(buildStatusLine({ sceneWords: 10, sceneTarget: Number.NaN })).toEqual([{ id: 'scene', label: 'Words', value: '10' }]);
  });

  it('uses English labels and no words from the scene itself', () => {
    const labels = buildStatusLine(everything).map((segment) => segment.label);
    expect(labels).toEqual(['Words', 'Started', 'Edited', 'Session', 'Project', 'Today']);
  });
});
