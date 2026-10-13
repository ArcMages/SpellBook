import { describe, expect, it } from 'vitest';
import { emptySceneDates, sceneDatePatch, sceneDatesStep, sceneEditedDate, sceneStartDate } from '../../src/core/progress';
import type { SceneDateWrite, SceneDatesEvent, SceneDatesState } from '../../src/core/progress';

const TODAY = '2026-10-13';
const TOMORROW = '2026-10-14';
const OPENING = 'Novel/Manuscript/Opening.md';
const LETTER = 'Novel/Manuscript/The Letter.md';
const HEBREW = 'הרומן שלי/Manuscript/פרק ראשון.md';
const NOTES = 'Novel/Research/Notes.md';

/** Feed a list of events through, collecting the writes each one asks for. */
function run(events: SceneDatesEvent[], start: SceneDatesState = emptySceneDates()): { state: SceneDatesState; writes: SceneDateWrite[][] } {
  let state = start;
  const writes: SceneDateWrite[][] = [];
  for (const event of events) {
    const step = sceneDatesStep(state, event);
    state = step.state;
    writes.push([...step.writes]);
  }
  return { state, writes };
}

const typed = (path: string, date = TODAY): SceneDatesEvent => ({ type: 'typed', path, date });

describe('sceneDatesStep: when "edited" is written', () => {
  it('never writes while the writer is typing', () => {
    const { writes, state } = run([typed(OPENING), typed(OPENING), typed(OPENING), typed(OPENING)]);
    expect(writes).toEqual([[], [], [], []]);
    expect([...state.waiting]).toEqual([[OPENING, TODAY]]);
  });

  it('writes when another note opens', () => {
    const { writes } = run([typed(OPENING), { type: 'opened', path: LETTER }]);
    expect(writes).toEqual([[], [{ path: OPENING, edited: TODAY }]]);
  });

  it('writes when the tab closes', () => {
    const { writes } = run([typed(OPENING), { type: 'closed', path: OPENING }]);
    expect(writes[1]).toEqual([{ path: OPENING, edited: TODAY }]);
  });

  it('writes when the app goes to the background', () => {
    const { writes } = run([typed(OPENING), { type: 'background' }]);
    expect(writes[1]).toEqual([{ path: OPENING, edited: TODAY }]);
  });

  it('writes when the plugin unloads', () => {
    const { writes } = run([typed(OPENING), { type: 'unload' }]);
    expect(writes[1]).toEqual([{ path: OPENING, edited: TODAY }]);
  });

  it('writes when no note is in front any more', () => {
    const { writes } = run([typed(OPENING), { type: 'opened', path: null }]);
    expect(writes[1]).toEqual([{ path: OPENING, edited: TODAY }]);
  });

  it('does not write when the scene itself comes to the front again', () => {
    const { writes, state } = run([typed(OPENING), { type: 'opened', path: OPENING }]);
    expect(writes).toEqual([[], []]);
    expect(state.waiting.get(OPENING)).toBe(TODAY);
  });

  it('does not write a scene that was only read', () => {
    const { writes } = run([{ type: 'opened', path: OPENING }, { type: 'opened', path: LETTER }, { type: 'closed', path: OPENING }, { type: 'background' }, { type: 'unload' }]);
    expect(writes.flat()).toEqual([]);
  });

  it('does not write when some other tab closes', () => {
    const { writes, state } = run([typed(OPENING), { type: 'closed', path: NOTES }]);
    expect(writes.flat()).toEqual([]);
    expect(state.waiting.has(OPENING)).toBe(true);
  });

  it('writes a scene at most once a day, however often the writer comes and goes', () => {
    const { writes } = run([
      typed(OPENING),
      { type: 'opened', path: LETTER },
      { type: 'opened', path: OPENING },
      typed(OPENING),
      typed(OPENING),
      { type: 'opened', path: LETTER },
      { type: 'opened', path: OPENING },
      typed(OPENING),
      { type: 'closed', path: OPENING },
      { type: 'background' },
      { type: 'unload' },
    ]);
    expect(writes.flat()).toEqual([{ path: OPENING, edited: TODAY }]);
  });

  it('writes again on the next day', () => {
    const { writes } = run([
      typed(OPENING, TODAY),
      { type: 'background' },
      typed(OPENING, TOMORROW),
      typed(OPENING, TOMORROW),
      { type: 'background' },
      typed(OPENING, TOMORROW),
      { type: 'background' },
    ]);
    expect(writes.flat()).toEqual([
      { path: OPENING, edited: TODAY },
      { path: OPENING, edited: TOMORROW },
    ]);
  });

  it('writes one date for a session that runs past midnight: the last day typed', () => {
    const { writes } = run([typed(OPENING, TODAY), typed(OPENING, TOMORROW), { type: 'opened', path: LETTER }]);
    expect(writes.flat()).toEqual([{ path: OPENING, edited: TOMORROW }]);
  });

  it('writes yesterday\'s date for a scene typed before midnight and left after it', () => {
    // The phone went to sleep with the scene open; nothing was typed on the new day.
    const { writes } = run([typed(OPENING, TODAY), { type: 'background' }]);
    expect(writes.flat()).toEqual([{ path: OPENING, edited: TODAY }]);
  });

  it('keeps track of several scenes at once, with names in any language', () => {
    const { writes, state } = run([
      typed(OPENING),
      { type: 'opened', path: HEBREW },
      typed(HEBREW),
      { type: 'opened', path: LETTER },
      typed(LETTER),
      { type: 'background' },
    ]);
    expect(writes[1]).toEqual([{ path: OPENING, edited: TODAY }]);
    expect(writes[3]).toEqual([{ path: HEBREW, edited: TODAY }]);
    expect(writes[5]).toEqual([{ path: LETTER, edited: TODAY }]);
    expect([...state.waiting]).toEqual([]);
    expect([...state.written.keys()]).toEqual([OPENING, HEBREW, LETTER]);
  });

  it('writes every waiting scene when the app goes to the background', () => {
    // Two scenes side by side, both typed in.
    const { writes } = run([typed(OPENING), typed(HEBREW), { type: 'background' }]);
    expect(writes[2]).toEqual([
      { path: OPENING, edited: TODAY },
      { path: HEBREW, edited: TODAY },
    ]);
  });

  it('knows a scene by its path however the letters are stored', () => {
    // The same Hebrew name with its points in the order they were typed, and in the order a disk stores them;
    // and the same accented name as one letter or as letter plus accent.
    const pairs = [
      ['Novel/Manuscript/שָׁלום.md', 'Novel/Manuscript/שָׁלום.md'.normalize('NFC')],
      ['Novel/Manuscript/Café.md'.normalize('NFC'), 'Novel/Manuscript/Café.md'.normalize('NFD')],
    ] as const;
    for (const [one, other] of pairs) {
      expect(other).not.toBe(one);
      expect(run([typed(one), { type: 'opened', path: other }]).writes.flat()).toEqual([]);
      expect(run([typed(one), { type: 'closed', path: other }]).writes.flat()).toEqual([{ path: one, edited: TODAY }]);
    }
  });

  it('follows a scene that is renamed, and forgets one that is deleted', () => {
    const renamed = run([typed(OPENING), { type: 'renamed', from: OPENING, to: HEBREW }, { type: 'background' }]);
    expect(renamed.writes.flat()).toEqual([{ path: HEBREW, edited: TODAY }]);

    // A scene already written today is still "written today" under its new name.
    const after = run([typed(OPENING), { type: 'background' }, { type: 'renamed', from: OPENING, to: LETTER }, typed(LETTER), { type: 'background' }]);
    expect(after.writes.flat()).toEqual([{ path: OPENING, edited: TODAY }]);

    const deleted = run([typed(OPENING), { type: 'deleted', path: OPENING }, { type: 'background' }, { type: 'unload' }]);
    expect(deleted.writes.flat()).toEqual([]);
  });

  it('asks again for a write that failed, the next time the writer leaves the scene', () => {
    const { writes } = run([
      typed(OPENING),
      { type: 'background' },
      { type: 'failed', path: OPENING, edited: TODAY },
      { type: 'opened', path: OPENING },
      { type: 'opened', path: LETTER },
    ]);
    expect(writes.map((list) => list.length)).toEqual([0, 1, 0, 0, 1]);
    expect(writes[4]).toEqual([{ path: OPENING, edited: TODAY }]);
  });

  it('ignores typing with a date that is not a real date, and events it does not know', () => {
    const { writes, state } = run([typed(OPENING, 'today'), typed(OPENING, '2026-02-30'), { type: 'background' }]);
    expect(writes.flat()).toEqual([]);
    expect(state.waiting.size).toBe(0);
    const odd = { type: 'something new' } as unknown as SceneDatesEvent;
    expect(sceneDatesStep(emptySceneDates(), odd).writes).toEqual([]);
  });

  it('never changes the state it was given', () => {
    const start = emptySceneDates();
    const afterTyping = sceneDatesStep(start, typed(OPENING)).state;
    expect(start.waiting.size).toBe(0);
    const afterLeaving = sceneDatesStep(afterTyping, { type: 'background' }).state;
    expect([...afterTyping.waiting]).toEqual([[OPENING, TODAY]]);
    expect(afterTyping.written.size).toBe(0);
    expect([...afterLeaving.written]).toEqual([[OPENING, TODAY]]);
  });

  it('gives back the very same state when an event changes nothing', () => {
    const state = sceneDatesStep(emptySceneDates(), typed(OPENING)).state;
    expect(sceneDatesStep(state, typed(OPENING)).state).toBe(state);
    expect(sceneDatesStep(state, { type: 'opened', path: OPENING }).state).toBe(state);
    expect(sceneDatesStep(state, { type: 'closed', path: LETTER }).state).toBe(state);
    expect(sceneDatesStep(state, { type: 'deleted', path: LETTER }).state).toBe(state);
    expect(sceneDatesStep(state, { type: 'renamed', from: LETTER, to: NOTES }).state).toBe(state);
  });

  it('does not remember days gone by for ever', () => {
    const { state } = run([typed(OPENING, TODAY), typed(LETTER, TODAY), { type: 'background' }, typed(HEBREW, TOMORROW)]);
    expect([...state.written]).toEqual([]);
    expect([...state.waiting]).toEqual([[HEBREW, TOMORROW]]);
  });

  it('takes one scene in two Unicode forms for one scene, in every event', () => {
    const one = 'Novel/Manuscript/Café.md'.normalize('NFC');
    const other = one.normalize('NFD');
    const bar = 'Novel/Manuscript/Bar.md';
    expect(other).not.toBe(one);

    // Typed in under both forms: one scene, one write.
    expect(run([typed(one), typed(other), { type: 'background' }]).writes.flat()).toEqual([{ path: one, edited: TODAY }]);
    // Written today under one form, typed in again under the other: once a day is enough.
    expect(run([typed(one), { type: 'background' }, typed(other), { type: 'background' }]).writes.flat()).toEqual([
      { path: one, edited: TODAY },
    ]);
    // A rename or a delete given in the other form is followed.
    expect(run([typed(one), { type: 'renamed', from: other, to: bar }, { type: 'background' }]).writes.flat()).toEqual([
      { path: bar, edited: TODAY },
    ]);
    expect(run([typed(one), { type: 'deleted', path: other }, { type: 'background' }]).writes.flat()).toEqual([]);
    // A failed write reported in the other form is asked for once more, not for ever.
    const failed = run([
      typed(one),
      { type: 'background' },
      { type: 'failed', path: other, edited: TODAY },
      { type: 'background' },
      { type: 'background' },
    ]);
    expect(failed.writes.map((list) => list.length)).toEqual([0, 1, 0, 1, 0]);
    expect(failed.writes[3]).toEqual([{ path: one, edited: TODAY }]);
  });
});

describe('sceneDatePatch: what to set in the properties', () => {
  it('sets "edited" to the day the scene was typed in', () => {
    expect(sceneDatePatch({ created: '2026-10-01', edited: '2026-10-05' }, { edited: TODAY })).toEqual({ edited: TODAY });
    expect(sceneDatePatch({ created: '2026-10-01' }, { edited: TODAY })).toEqual({ edited: TODAY });
  });

  it('sets nothing when "edited" already says that day', () => {
    expect(sceneDatePatch({ created: '2026-10-01', edited: TODAY }, { edited: TODAY })).toEqual({});
    expect(sceneDatePatch({ created: '2026-10-01', edited: `${TODAY}T09:30` }, { edited: TODAY })).toEqual({});
  });

  it('never moves "edited" back: another device may have written a later day', () => {
    expect(sceneDatePatch({ created: '2026-10-01', edited: TOMORROW }, { edited: TODAY })).toEqual({});
  });

  it('replaces an "edited" that is not a date', () => {
    expect(sceneDatePatch({ created: '2026-10-01', edited: 'yesterday' }, { edited: TODAY })).toEqual({ edited: TODAY });
    expect(sceneDatePatch({ created: '2026-10-01', edited: '' }, { edited: TODAY })).toEqual({ edited: TODAY });
    expect(sceneDatePatch({ created: '2026-10-01', edited: null }, { edited: TODAY })).toEqual({ edited: TODAY });
  });

  it('writes "created" once, from the file\'s creation date, when the scene has none', () => {
    expect(sceneDatePatch({ synopsis: 'פתיחה' }, { fileCreated: '2026-09-20' })).toEqual({ created: '2026-09-20' });
    expect(sceneDatePatch({ created: '' }, { fileCreated: '2026-09-20' })).toEqual({ created: '2026-09-20' });
    expect(sceneDatePatch({ created: null }, { fileCreated: '2026-09-20' })).toEqual({ created: '2026-09-20' });
    expect(sceneDatePatch(null, { fileCreated: '2026-09-20' })).toEqual({ created: '2026-09-20' });
    // Once it is there, it is never written again.
    expect(sceneDatePatch({ created: '2026-09-20' }, { fileCreated: '2026-10-13' })).toEqual({});
  });

  it('lets an existing "created" win, whatever it says', () => {
    expect(sceneDatePatch({ created: '2025-01-01' }, { fileCreated: '2026-09-20' })).toEqual({});
    expect(sceneDatePatch({ created: 'אביב 2024' }, { fileCreated: '2026-09-20' })).toEqual({});
    expect(sceneDatePatch({ created: 'last spring' }, { fileCreated: '2026-09-20' })).toEqual({});
    expect(sceneDatePatch({ created: 20240101 }, { fileCreated: '2026-09-20' })).toEqual({});
  });

  it('sets both in one go when both are due', () => {
    expect(sceneDatePatch({ synopsis: '' }, { edited: TODAY, fileCreated: '2026-09-20' })).toEqual({ created: '2026-09-20', edited: TODAY });
  });

  it('sets nothing it was not given, and nothing that is not a real date', () => {
    expect(sceneDatePatch({}, {})).toEqual({});
    expect(sceneDatePatch({}, { edited: null, fileCreated: null })).toEqual({});
    expect(sceneDatePatch({}, { edited: 'today', fileCreated: '2026-02-30' })).toEqual({});
  });

  it('does not touch the properties it was given, and names no other property', () => {
    const frontmatter = { synopsis: 'היא פותחת את המכתב.', status: 'First draft', label: 'red', target: 1500, compile: true, order: 3 };
    const before = JSON.stringify(frontmatter);
    const patch = sceneDatePatch(frontmatter, { edited: TODAY, fileCreated: '2026-09-20' });
    expect(JSON.stringify(frontmatter)).toBe(before);
    expect(Object.keys(patch).sort()).toEqual(['created', 'edited']);
  });
});

describe('sceneStartDate and sceneEditedDate: what to show', () => {
  it('shows the "created" property when the scene has one', () => {
    expect(sceneStartDate({ created: '2026-10-01' }, '2026-09-20')).toBe('2026-10-01');
    expect(sceneStartDate({ created: '2026-10-01T08:00' })).toBe('2026-10-01');
  });

  it("falls back on the file's creation date when the scene has none", () => {
    expect(sceneStartDate({}, '2026-09-20')).toBe('2026-09-20');
    expect(sceneStartDate(null, '2026-09-20')).toBe('2026-09-20');
    expect(sceneStartDate({ created: '' }, '2026-09-20')).toBe('2026-09-20');
  });

  it('shows nothing rather than a guess', () => {
    expect(sceneStartDate({ created: 'אביב 2024' }, '2026-09-20')).toBeNull(); // the writer's own words win, but are not a date
    expect(sceneStartDate({}, null)).toBeNull();
    expect(sceneStartDate({}, 'recently')).toBeNull();
    expect(sceneStartDate(null)).toBeNull();
  });

  it('reads the "edited" property', () => {
    expect(sceneEditedDate({ edited: '2026-10-13' })).toBe('2026-10-13');
    expect(sceneEditedDate({ edited: 'yesterday' })).toBeNull();
    expect(sceneEditedDate({})).toBeNull();
    expect(sceneEditedDate(null)).toBeNull();
  });
});
