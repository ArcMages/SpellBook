import { describe, expect, it } from 'vitest';
import {
  BAR_BUTTON_ICONS,
  BAR_ITEMS,
  BAR_PRESETS,
  DEFAULT_BAR_LAYOUT,
  MAX_BAR_ENTRIES,
  MAX_LABEL_LENGTH,
  READING_WORDS_PER_MINUTE,
  addBarButton,
  addBarItem,
  barItemIds,
  barItemName,
  buildStatusLine,
  editBarButton,
  formatReadingTime,
  isBarItemId,
  missingBarItems,
  moveBarEntry,
  parseBarLayout,
  removeBarEntry,
  sameBarLayout,
  serializeBarLayout,
} from '../../src/core/progress';
import type { BarLayout, StatusLineInput } from '../../src/core/progress';
import { WORDS_PER_MINUTE } from '../../src/core/outliner/readTime';

const ZEN = 'spellbook-novel-writer:toggle-zen-mode';

describe('the layout of the bottom bar', () => {
  it('starts as the bar was before it could be changed', () => {
    expect(barItemIds(DEFAULT_BAR_LAYOUT)).toEqual(['scene', 'started', 'edited', 'session', 'project', 'today']);
    expect(DEFAULT_BAR_LAYOUT.entries.every((entry) => entry.kind === 'item')).toBe(true);
  });

  it('offers every figure that was asked for, each with a name and a line about it', () => {
    expect(BAR_ITEMS.map((item) => item.id).sort()).toEqual(
      ['edited', 'project', 'reading', 'scene', 'session', 'started', 'status', 'target', 'title', 'today', 'todos'],
    );
    for (const item of BAR_ITEMS) {
      expect(item.name.length, item.id).toBeGreaterThan(0);
      expect(item.description.length, item.id).toBeGreaterThan(0);
      expect(isBarItemId(item.id)).toBe(true);
      expect(barItemName(item.id)).toBe(item.name);
    }
    expect(isBarItemId('battery')).toBe(false);
    expect(isBarItemId(7)).toBe(false);
  });

  it('has three ready-made bars, each of known figures, each once; "Everything" holds them all', () => {
    expect(BAR_PRESETS.map((preset) => preset.name)).toEqual(['Minimal', 'Drafting', 'Everything']);
    for (const preset of BAR_PRESETS) {
      const ids = barItemIds(preset.layout);
      expect(new Set(ids).size, preset.name).toBe(ids.length);
      expect(ids.every(isBarItemId), preset.name).toBe(true);
      // A ready-made bar reads back exactly as it is.
      expect(parseBarLayout(serializeBarLayout(preset.layout))).toEqual(preset.layout);
    }
    expect(missingBarItems(BAR_PRESETS[2]?.layout as BarLayout)).toEqual([]);
    expect(new Set(BAR_BUTTON_ICONS).size).toBe(BAR_BUTTON_ICONS.length);
  });

  it('comes back from storage as it went in', () => {
    let layout = addBarItem(DEFAULT_BAR_LAYOUT, 'status');
    layout = addBarButton(layout, ZEN, 'Zen', 'eye');
    const text = serializeBarLayout(layout);
    expect(typeof text).toBe('string');
    expect(parseBarLayout(text)).toEqual(layout);
    expect(sameBarLayout(parseBarLayout(text), layout)).toBe(true);
    expect(sameBarLayout(layout, DEFAULT_BAR_LAYOUT)).toBe(false);
  });

  it('gives the default for nothing and for anything that is not a layout, and never throws', () => {
    for (const stored of [null, undefined, '', 'not json', '{', 7, true, [], {}, { entries: 'scene' }, '[1,2]', 'null']) {
      expect(parseBarLayout(stored), JSON.stringify(stored)).toEqual(DEFAULT_BAR_LAYOUT);
    }
  });

  it('keeps a bar the writer emptied on purpose empty', () => {
    expect(parseBarLayout(serializeBarLayout({ entries: [] }))).toEqual({ entries: [] });
  });

  it('leaves out what makes no sense in a stored layout and keeps the rest', () => {
    const stored = {
      entries: [
        { kind: 'item', id: 'scene' },
        { kind: 'item', id: 'battery' },
        { kind: 'item', id: 'scene' }, // a second time
        'today',
        null,
        { kind: 'button', command: '' },
        { kind: 'button', command: 7 },
        { kind: 'button', command: `  ${ZEN} `, label: '  Zen \n mode ', icon: 9 },
        { kind: 'button', command: 'a:b', label: 'x'.repeat(200), icon: ' eye ' },
        { kind: 'divider' },
        { kind: 'item', id: 'today' },
      ],
    };
    expect(parseBarLayout(stored)).toEqual({
      entries: [
        { kind: 'item', id: 'scene' },
        { kind: 'button', command: ZEN, label: 'Zen mode', icon: null },
        { kind: 'button', command: 'a:b', label: 'x'.repeat(MAX_LABEL_LENGTH), icon: 'eye' },
        { kind: 'item', id: 'today' },
      ],
    });
    const many = { entries: Array.from({ length: 200 }, (_, at) => ({ kind: 'button', command: `plugin:${at}` })) };
    expect(parseBarLayout(many).entries).toHaveLength(MAX_BAR_ENTRIES);
  });

  it('adds a figure at the end, once', () => {
    const layout = addBarItem(DEFAULT_BAR_LAYOUT, 'reading');
    expect(barItemIds(layout)).toEqual(['scene', 'started', 'edited', 'session', 'project', 'today', 'reading']);
    expect(addBarItem(layout, 'reading')).toBe(layout);
    expect(addBarItem(layout, 'nonsense' as never)).toBe(layout);
    expect(missingBarItems(layout).map((item) => item.id)).toEqual(['target', 'status', 'todos', 'title']);
  });

  it('adds as many buttons as wanted, also two for the same command, but none without a command', () => {
    let layout = addBarButton({ entries: [] }, ZEN);
    layout = addBarButton(layout, ZEN, 'Again');
    expect(layout.entries).toEqual([
      { kind: 'button', command: ZEN, label: '', icon: null },
      { kind: 'button', command: ZEN, label: 'Again', icon: null },
    ]);
    expect(addBarButton(layout, '   ')).toBe(layout);
  });

  it('moves an entry one step, and nothing at the edges', () => {
    const layout: BarLayout = parseBarLayout({ entries: [{ kind: 'item', id: 'scene' }, { kind: 'button', command: ZEN }, { kind: 'item', id: 'today' }] });
    const kinds = (of: BarLayout): string[] => of.entries.map((entry) => (entry.kind === 'item' ? entry.id : 'button'));
    expect(kinds(moveBarEntry(layout, 0, 1))).toEqual(['button', 'scene', 'today']);
    expect(kinds(moveBarEntry(layout, 2, -1))).toEqual(['scene', 'today', 'button']);
    expect(moveBarEntry(layout, 0, -1)).toBe(layout);
    expect(moveBarEntry(layout, 2, 1)).toBe(layout);
    expect(moveBarEntry(layout, 9, 1)).toBe(layout);
    expect(moveBarEntry(layout, 0.5, 1)).toBe(layout);
    expect(kinds(layout)).toEqual(['scene', 'button', 'today']); // the layout handed in is never changed
  });

  it('removes one entry, and nothing for a place that is not there', () => {
    expect(barItemIds(removeBarEntry(DEFAULT_BAR_LAYOUT, 1))).toEqual(['scene', 'edited', 'session', 'project', 'today']);
    expect(removeBarEntry(DEFAULT_BAR_LAYOUT, -1)).toBe(DEFAULT_BAR_LAYOUT);
    expect(removeBarEntry(DEFAULT_BAR_LAYOUT, 6)).toBe(DEFAULT_BAR_LAYOUT);
  });

  it('changes a button\'s label and icon, in Hebrew as well, and never a figure', () => {
    const layout = addBarButton(DEFAULT_BAR_LAYOUT, ZEN);
    const at = layout.entries.length - 1;
    const named = editBarButton(layout, at, { label: '  מצב זן  ' });
    expect(named.entries[at]).toEqual({ kind: 'button', command: ZEN, label: 'מצב זן', icon: null });
    const withIcon = editBarButton(named, at, { icon: 'eye' });
    expect(withIcon.entries[at]).toEqual({ kind: 'button', command: ZEN, label: 'מצב זן', icon: 'eye' });
    expect(editBarButton(withIcon, at, { icon: null }).entries[at]).toEqual(named.entries[at]);
    expect(editBarButton(layout, 0, { label: 'no' })).toBe(layout);
    expect(editBarButton(layout, 99, { label: 'no' })).toBe(layout);
  });
});

describe('the line of figures, as the writer laid it out', () => {
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
    sceneTitle: 'פתיחה',
    status: { name: 'טיוטה', color: 'blue' },
    todos: { dueToday: 2, late: 1 },
  };

  it('with no layout given, is the line as it always was', () => {
    expect(buildStatusLine(everything)).toEqual(buildStatusLine(everything, barItemIds(DEFAULT_BAR_LAYOUT)));
    expect(buildStatusLine(everything).map((segment) => segment.id)).toEqual(['scene', 'started', 'edited', 'session', 'project', 'today']);
  });

  it('holds only the chosen figures, in the chosen order, each once', () => {
    const line = buildStatusLine(everything, ['today', 'scene', 'today']);
    expect(line.map((segment) => `${segment.label} ${segment.value}`)).toEqual(['Today 350 / 500', 'Words 1,234 / 2,000']);
    expect(buildStatusLine(everything, [])).toEqual([]);
  });

  it('shows the scene target with its progress, and then the words on their own', () => {
    const line = buildStatusLine(everything, ['scene', 'target']);
    expect(line).toEqual([
      { id: 'scene', label: 'Words', value: '1,234' },
      { id: 'target', label: 'Target', value: '61% of 2,000', met: false, fraction: 0.617 },
    ]);
    const reached = buildStatusLine({ sceneWords: 2500, sceneTarget: 2000 }, ['target'])[0];
    expect(reached).toEqual({ id: 'target', label: 'Target', value: '125% of 2,000', met: true, fraction: 1 });
    // 1,999 of 2,000 is not 100% yet.
    expect(buildStatusLine({ sceneWords: 1999, sceneTarget: 2000 }, ['target'])[0]?.value).toBe('99% of 2,000');
    // A scene without a target has no such piece.
    expect(buildStatusLine({ sceneWords: 10 }, ['target'])).toEqual([]);
    expect(buildStatusLine({ sceneWords: 10, sceneTarget: 0 }, ['target'])).toEqual([]);
  });

  it('reads the reading time at 250 words a minute, as the outliner and the report do', () => {
    expect(READING_WORDS_PER_MINUTE).toBe(250);
    expect(READING_WORDS_PER_MINUTE).toBe(WORDS_PER_MINUTE);
    expect(formatReadingTime(0)).toBe('0 min');
    expect(formatReadingTime(-5)).toBe('0 min');
    expect(formatReadingTime(Number.NaN)).toBe('0 min');
    expect(formatReadingTime(100)).toBe('<1 min');
    expect(formatReadingTime(250)).toBe('1 min');
    expect(formatReadingTime(2500)).toBe('10 min');
    expect(formatReadingTime(250 * 65)).toBe('1h 05m');
    expect(buildStatusLine(everything, ['reading'])).toEqual([{ id: 'reading', label: 'Reading', value: '5 min' }]);
    expect(buildStatusLine({}, ['reading'])).toEqual([]);
  });

  it('marks a status and a title as the writer\'s own text, in whatever language', () => {
    expect(buildStatusLine(everything, ['title', 'status'])).toEqual([
      { id: 'title', label: 'Scene', value: 'פתיחה', ownText: true },
      { id: 'status', label: 'Status', value: 'טיוטה', ownText: true, color: 'blue' },
    ]);
    expect(buildStatusLine({ status: { name: 'Draft', color: null } }, ['status'])).toEqual([
      { id: 'status', label: 'Status', value: 'Draft', ownText: true },
    ]);
    expect(buildStatusLine({ status: { name: '  ' }, sceneTitle: '' }, ['status', 'title'])).toEqual([]);
    expect(buildStatusLine({ status: null }, ['status'])).toEqual([]);
  });

  it('counts the to-dos that are due, and says how many are late', () => {
    expect(buildStatusLine(everything, ['todos'])).toEqual([{ id: 'todos', label: 'To-dos due', value: '3 (1 late)', late: true }]);
    expect(buildStatusLine({ todos: { dueToday: 2, late: 0 } }, ['todos'])).toEqual([{ id: 'todos', label: 'To-dos due', value: '2' }]);
    expect(buildStatusLine({ todos: { dueToday: 0, late: 0 } }, ['todos'])).toEqual([{ id: 'todos', label: 'To-dos due', value: '0' }]);
    expect(buildStatusLine({ todos: null }, ['todos'])).toEqual([]);
  });
});
