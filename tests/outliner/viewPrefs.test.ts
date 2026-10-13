import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  MAX_VIEW_PROJECTS,
  NO_FILTER,
  NO_TAG,
  isDefaultView,
  moveView,
  readViewChoice,
  readViewPrefs,
  viewOf,
  withView,
  writeViewPrefs,
} from '../../src/core/outliner';
import type { ViewChoice } from '../../src/core/outliner';
import { HEBREW } from './helpers';

const NOVEL = 'Novel/Novel.md';
const SECOND = 'Second/Second.md';

const sortedAndFiltered: ViewChoice = {
  sort: { column: 'words', direction: 'desc' },
  filter: { text: HEBREW.letter, statuses: ['To do', NO_TAG], labels: [HEBREW.daniel] },
  collapsed: ['f-one', 'f-inner'],
};

describe('how the outliner was left for each project', () => {
  it('is the usual view until something is remembered', () => {
    const prefs = readViewPrefs(null);
    expect(prefs.size).toBe(0);
    expect(viewOf(prefs, NOVEL)).toBe(DEFAULT_VIEW);
    expect(DEFAULT_VIEW).toEqual({ sort: null, filter: NO_FILTER, collapsed: [] });
    expect(isDefaultView(DEFAULT_VIEW)).toBe(true);
    expect(isDefaultView(sortedAndFiltered)).toBe(false);
    expect(writeViewPrefs(prefs)).toBeNull();
  });

  it('comes back as it was saved, project by project', () => {
    let prefs = withView(readViewPrefs(null), NOVEL, sortedAndFiltered);
    prefs = withView(prefs, SECOND, { ...DEFAULT_VIEW, collapsed: ['f-two'] });
    const text = writeViewPrefs(prefs);
    expect(typeof text).toBe('string');
    const back = readViewPrefs(text);
    expect(viewOf(back, NOVEL)).toEqual(sortedAndFiltered);
    expect(viewOf(back, SECOND)).toEqual({ sort: null, filter: NO_FILTER, collapsed: ['f-two'] });
    expect(viewOf(back, 'Other/Other.md')).toBe(DEFAULT_VIEW);
    // The storage may hand the saved text back already read.
    expect(viewOf(readViewPrefs(JSON.parse(text ?? '')), NOVEL)).toEqual(sortedAndFiltered);
  });

  it('does not remember a project that is left in the usual view', () => {
    let prefs = withView(readViewPrefs(null), NOVEL, sortedAndFiltered);
    prefs = withView(prefs, NOVEL, { sort: null, filter: { text: '  ', statuses: [], labels: [] }, collapsed: [] });
    expect(prefs.size).toBe(0);
    expect(writeViewPrefs(prefs)).toBeNull();
  });

  it('changes nothing it was given', () => {
    const first = withView(readViewPrefs(null), NOVEL, sortedAndFiltered);
    const second = withView(first, SECOND, sortedAndFiltered);
    expect([...first.keys()]).toEqual([NOVEL]);
    expect([...second.keys()]).toEqual([NOVEL, SECOND]);
  });

  it('forgets the projects that were changed longest ago when there are too many', () => {
    let prefs = readViewPrefs(null);
    for (let n = 0; n < MAX_VIEW_PROJECTS + 5; n++) prefs = withView(prefs, `P${n}/P${n}.md`, sortedAndFiltered);
    expect(prefs.size).toBe(MAX_VIEW_PROJECTS);
    expect(prefs.has('P0/P0.md')).toBe(false);
    expect(prefs.has('P4/P4.md')).toBe(false);
    expect(prefs.has('P5/P5.md')).toBe(true);
    // A project that is changed again counts as the newest.
    prefs = withView(prefs, 'P5/P5.md', { ...sortedAndFiltered, sort: null });
    prefs = withView(prefs, 'New/New.md', sortedAndFiltered);
    expect(prefs.has('P5/P5.md')).toBe(true);
    expect(prefs.has('P6/P6.md')).toBe(false);
    // What was saved with too many comes back with the newest only.
    const many = Array.from({ length: 30 }, (_, n) => [`Q${n}.md`, sortedAndFiltered]);
    const read = readViewPrefs(JSON.stringify({ v: 1, projects: many }));
    expect(read.size).toBe(MAX_VIEW_PROJECTS);
    expect(read.has('Q9.md')).toBe(false);
    expect(read.has('Q10.md')).toBe(true);
  });

  it('follows a project to another path', () => {
    const prefs = withView(withView(readViewPrefs(null), NOVEL, sortedAndFiltered), SECOND, { ...DEFAULT_VIEW, collapsed: ['x'] });
    const moved = moveView(prefs, NOVEL, 'Roman/Roman.md');
    expect(moved.has(NOVEL)).toBe(false);
    expect(viewOf(moved, 'Roman/Roman.md')).toEqual(sortedAndFiltered);
    // Whatever was remembered under the new path was for a project that is no longer there.
    expect(viewOf(moveView(prefs, NOVEL, SECOND), SECOND)).toEqual(sortedAndFiltered);
    // Nothing remembered, or the same path: nothing changes.
    expect([...moveView(prefs, 'Gone/Gone.md', 'X/X.md').keys()]).toEqual([NOVEL, SECOND]);
    expect([...moveView(prefs, NOVEL, NOVEL).keys()]).toEqual([NOVEL, SECOND]);
  });

  it('gives the usual view for anything it cannot read', () => {
    for (const stored of [undefined, '', 'not json', '{"projects":', 7, [], {}, { projects: {} }, { projects: 'all' }, '{"v":1}']) {
      expect(readViewPrefs(stored).size, JSON.stringify(stored)).toBe(0);
    }
    const prefs = readViewPrefs({
      v: 1,
      projects: [
        [NOVEL, { sort: { column: 'nonsense' }, filter: 'everything', collapsed: ['f-one', 7, '', 'f-one', null] }],
        ['', sortedAndFiltered],
        [5, sortedAndFiltered],
        'Second/Second.md',
        [SECOND],
        ['Third/Third.md', { sort: { column: 'name', direction: 'up' } }],
      ],
    });
    // What is understood is kept; the rest counts as the usual view.
    expect(viewOf(prefs, NOVEL)).toEqual({ sort: null, filter: NO_FILTER, collapsed: ['f-one'] });
    expect(prefs.has(SECOND)).toBe(false);
    expect(viewOf(prefs, 'Third/Third.md')).toEqual({ sort: { column: 'name', direction: 'asc' }, filter: NO_FILTER, collapsed: [] });
    expect(prefs.size).toBe(2);
    for (const saved of [null, 'x', 4, [], {}]) expect(readViewChoice(saved)).toBe(DEFAULT_VIEW);
  });

  it('keeps a project that is saved twice once, as it was saved last', () => {
    const prefs = readViewPrefs({ projects: [[NOVEL, { collapsed: ['a'] }], [SECOND, { collapsed: ['b'] }], [NOVEL, { collapsed: ['c'] }]] });
    expect([...prefs.keys()]).toEqual([SECOND, NOVEL]);
    expect(viewOf(prefs, NOVEL).collapsed).toEqual(['c']);
  });
});
