import { describe, expect, it } from 'vitest';
import {
  LANE_COLORS,
  MANUSCRIPT_LANE,
  OTHER_LANE,
  addLane,
  displayLanes,
  laneKey,
  moveLane,
  readLaneColor,
  readLanes,
  recolourLane,
  removeLane,
  renameLane,
  visibleLanes,
} from '../../src/core/timeline';
import type { LaneChange } from '../../src/core/timeline';
import { HEBREW, POINTED_AS_STORED, POINTED_AS_TYPED, deepFreeze, event, sceneEvent } from './helpers';

/** The stored value and lanes of a change that must have gone through. */
function ok(change: LaneChange): Extract<LaneChange, { ok: true }> {
  if (!change.ok) throw new Error(`The change was refused: ${change.reason} (${change.message})`);
  return change;
}

/** The reason of a change that must have been refused. */
function refusal(change: LaneChange): string {
  if (change.ok) throw new Error('The change went through, but the test expected a refusal.');
  expect(change.message).toMatch(/\S/);
  return change.reason;
}

const names = (change: LaneChange): string[] => ok(change).lanes.map((lane) => lane.name);

const stored = (): unknown[] => [
  { name: 'Main plot', color: 'purple' },
  { name: 'Backstory' },
  { name: HEBREW.mainPlot, color: 'blue' },
];

describe('colours', () => {
  it('are the eight names, and nothing else', () => {
    expect([...LANE_COLORS]).toEqual(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']);
    for (const color of LANE_COLORS) expect(readLaneColor(color)).toBe(color);
    expect(readLaneColor(' Purple ')).toBe('purple');
    for (const other of ['teal', 'magenta', '#ff0000', 'var(--color-red)', '', 7, null, undefined, ['red'], { red: true }]) {
      expect(readLaneColor(other), String(other)).toBeNull();
    }
  });
});

describe('readLanes', () => {
  it('reads the lanes in the order they are listed', () => {
    expect(readLanes(stored())).toEqual({
      lanes: [
        { name: 'Main plot', color: 'purple' },
        { name: 'Backstory', color: null },
        { name: HEBREW.mainPlot, color: 'blue' },
      ],
      problems: [],
      readable: true,
    });
  });

  it('reads a project without the key as having no lanes', () => {
    expect(readLanes(undefined)).toEqual({ lanes: [], problems: [], readable: true });
    expect(readLanes(null)).toEqual({ lanes: [], problems: [], readable: true });
    expect(readLanes([])).toEqual({ lanes: [], problems: [], readable: true });
  });

  it('accepts bare names, one lane on its own, and a name written as a number', () => {
    expect(readLanes(['Main plot', HEBREW.backstory]).lanes).toEqual([
      { name: 'Main plot', color: null },
      { name: HEBREW.backstory, color: null },
    ]);
    expect(readLanes('Main plot').lanes).toEqual([{ name: 'Main plot', color: null }]);
    expect(readLanes({ name: 'Main plot', color: 'red' }).lanes).toEqual([{ name: 'Main plot', color: 'red' }]);
    expect(readLanes([{ name: 1923, color: 'red' }]).lanes).toEqual([{ name: '1923', color: 'red' }]);
  });

  it('reads an unknown colour as no colour', () => {
    const read = readLanes([
      { name: 'A', color: 'teal' },
      { name: 'B', color: '#ff0000' },
      { name: 'C', color: 3 },
      { name: 'D', color: 'PINK' },
    ]);
    expect(read.lanes.map((lane) => lane.color)).toEqual([null, null, null, 'pink']);
    expect(read.problems).toEqual([]);
  });

  it('trims a name at its ends and leaves the inside alone', () => {
    expect(readLanes([{ name: '  Main   plot ' }]).lanes[0]?.name).toBe('Main   plot');
    expect(readLanes([{ name: HEBREW.mixed }]).lanes[0]?.name).toBe(HEBREW.mixed);
    expect(readLanes([{ name: POINTED_AS_TYPED }]).lanes[0]?.name).toBe(POINTED_AS_TYPED);
    expect(readLanes([{ name: POINTED_AS_STORED }]).lanes[0]?.name).toBe(POINTED_AS_STORED);
  });

  it('skips what is not a lane, and reports it', () => {
    const read = readLanes([{ name: 'Main plot' }, 7, null, { color: 'red' }, { name: '' }, ['nested'], { name: 'Backstory' }]);
    expect(read.lanes.map((lane) => lane.name)).toEqual(['Main plot', 'Backstory']);
    expect(read.problems).toHaveLength(5);
    expect(read.problems[0]).toContain('Entry 2');
    expect(read.readable).toBe(true);
  });

  it('uses the first of two lanes with the same name, whatever their capitals, and reports the other', () => {
    const read = readLanes([
      { name: 'Main plot', color: 'purple' },
      { name: 'MAIN PLOT', color: 'red' },
      { name: POINTED_AS_TYPED },
      { name: POINTED_AS_STORED },
    ]);
    expect(POINTED_AS_TYPED).not.toBe(POINTED_AS_STORED); // one word, two ways of storing it
    expect(read.lanes).toEqual([
      { name: 'Main plot', color: 'purple' },
      { name: POINTED_AS_TYPED, color: null },
    ]);
    expect(read.problems).toHaveLength(2);
    expect(read.problems[0]).toContain('MAIN PLOT');
  });

  it('says so when the value is not a list of lanes at all, and never throws', () => {
    for (const value of [7, true, 0, () => 1, Symbol('x')]) {
      const read = readLanes(value);
      expect(read.lanes).toEqual([]);
      expect(read.readable).toBe(false);
      expect(read.problems).toHaveLength(1);
    }
  });
});

describe('addLane', () => {
  it('adds a lane at the end, with its colour', () => {
    const change = ok(addLane(deepFreeze(stored()), 'Romance', 'pink'));
    expect(change.changed).toBe(true);
    expect(change.value).toEqual([...stored(), { name: 'Romance', color: 'pink' }]);
    expect(change.lanes.map((lane) => lane.name)).toEqual(['Main plot', 'Backstory', HEBREW.mainPlot, 'Romance']);
    expect(ok(addLane(undefined, 'First')).value).toEqual([{ name: 'First' }]);
    expect(ok(addLane(undefined, HEBREW.backstory, 'cyan')).value).toEqual([{ name: HEBREW.backstory, color: 'cyan' }]);
  });

  it('tidies the name', () => {
    expect(ok(addLane([], '  Sub \n plot  ')).value).toEqual([{ name: 'Sub plot' }]);
  });

  it('refuses a name that is taken, whatever its capitals', () => {
    expect(refusal(addLane(stored(), 'Main plot'))).toBe('name-taken');
    expect(refusal(addLane(stored(), '  MAIN plot '))).toBe('name-taken');
    expect(refusal(addLane(stored(), HEBREW.mainPlot))).toBe('name-taken');
    expect(refusal(addLane([{ name: POINTED_AS_STORED }], POINTED_AS_TYPED))).toBe('name-taken');
  });

  it('refuses an empty name and the names of the built-in lanes', () => {
    expect(refusal(addLane(stored(), ''))).toBe('empty-name');
    expect(refusal(addLane(stored(), '   '))).toBe('empty-name');
    expect(refusal(addLane(stored(), 'Manuscript'))).toBe('name-taken');
    expect(refusal(addLane(stored(), 'other'))).toBe('name-taken');
  });

  it('refuses to write over a value it cannot read', () => {
    expect(refusal(addLane(7, 'Main plot'))).toBe('unreadable');
    expect(refusal(addLane(true, 'Main plot'))).toBe('unreadable');
  });

  it('keeps everything it did not understand: odd entries, unknown colours, extra properties', () => {
    const odd = [
      { name: 'Main plot', color: 'teal', note: 'my own property' },
      42,
      { name: 'main plot', color: 'red' },
      'Bare name',
      { nameless: true },
    ];
    const value = ok(addLane(deepFreeze(odd), 'Romance')).value;
    expect(value).toEqual([...odd, { name: 'Romance' }]);
    odd.forEach((entry, index) => expect(value[index]).toBe(entry));
  });

  it('keeps Other after the rest once the index lists it last, as a colour makes it do', () => {
    const coloured = ok(recolourLane([{ name: 'Main plot' }, { name: 'Backstory' }], 'Other', 'orange')).value;
    expect(coloured).toEqual([{ name: 'Main plot' }, { name: 'Backstory' }, { name: 'Other', color: 'orange' }]);
    const added = ok(addLane(deepFreeze(coloured), 'Romance', 'pink'));
    expect(added.value).toEqual([
      { name: 'Main plot' },
      { name: 'Backstory' },
      { name: 'Romance', color: 'pink' },
      { name: 'Other', color: 'orange' },
    ]);
    expect(added.lanes.map((lane) => lane.name)).toEqual(['Main plot', 'Backstory', 'Romance', 'Other']);
    expect(readLanes(added.value).lanes).toEqual(added.lanes);
    expect(displayLanes(added.lanes).map((lane) => lane.name)).toEqual(['Manuscript', 'Main plot', 'Backstory', 'Romance', 'Other']);
    // And again for the next lane, in Hebrew.
    const more = ok(addLane(added.value, HEBREW.backstory));
    expect(displayLanes(more.lanes).map((lane) => lane.name)).toEqual([
      'Manuscript',
      'Main plot',
      'Backstory',
      'Romance',
      HEBREW.backstory,
      'Other',
    ]);
  });

  it('goes just before a last-listed Other, and leaves what follows it in the list where it was', () => {
    const value = [{ name: 'A' }, 'other', 42, { name: 'a', color: 'red' }];
    const added = ok(addLane(deepFreeze(value), 'B')).value;
    expect(added).toEqual([{ name: 'A' }, { name: 'B' }, 'other', 42, { name: 'a', color: 'red' }]);
    expect(ok(addLane([{ name: 'Other', color: 'red' }], 'A')).value).toEqual([{ name: 'A' }, { name: 'Other', color: 'red' }]);
  });

  it('adds at the end when the writer gave Other a place that is not the last', () => {
    const up = ok(moveLane(stored(), 'Other', 1)).value;
    expect(up[0]).toEqual({ name: 'Other' });
    expect(ok(addLane(up, 'Romance')).value).toEqual([...up, { name: 'Romance' }]);
    // A listed Manuscript at the end is no reason to add anywhere else either.
    const last = [{ name: 'Main plot' }, { name: 'Manuscript', color: 'green' }];
    expect(ok(addLane(last, 'Romance')).value).toEqual([...last, { name: 'Romance' }]);
  });
});

describe('renameLane', () => {
  it('renames the lane in place and keeps its other properties', () => {
    const value = [{ name: 'Main plot', color: 'teal', note: 'mine' }, { name: 'Backstory' }];
    const change = ok(renameLane(deepFreeze(value), 'main plot', HEBREW.mainPlot));
    expect(change.changed).toBe(true);
    expect(change.value).toEqual([{ name: HEBREW.mainPlot, color: 'teal', note: 'mine' }, { name: 'Backstory' }]);
    expect(Object.keys(change.value[0] as object)).toEqual(['name', 'color', 'note']);
    expect(change.value[1]).toBe(value[1]);
  });

  it('keeps a bare name bare', () => {
    expect(ok(renameLane(['Main plot', 'Backstory'], 'Main plot', 'Plot A')).value).toEqual(['Plot A', 'Backstory']);
  });

  it('returns the change for every event that names the lane, and for no other', () => {
    const notes = deepFreeze([
      { path: 'Timeline/Fire.md', frontmatter: { date: 1923, timelines: ['Backstory', 'Main plot'] } },
      { path: 'Timeline/Flood.md', frontmatter: { date: 1924, timelines: ['Backstory'] } },
      { path: 'Timeline/Quake.md', frontmatter: { date: 1925, timelines: 'MAIN PLOT' } },
      { path: 'Manuscript/Opening.md', frontmatter: { date: 1926, timelines: ['Main plot', HEBREW.mainPlot] } },
      { path: 'Timeline/Empty.md', frontmatter: undefined },
    ]);
    const rename = renameLane(stored(), 'Main plot', 'Plot A', notes);
    if (!rename.ok) throw new Error(rename.message);
    expect(rename.eventPatches).toEqual([
      { path: 'Timeline/Fire.md', patch: { timelines: ['Backstory', 'Plot A'] } },
      { path: 'Timeline/Quake.md', patch: { timelines: ['Plot A'] } },
      { path: 'Manuscript/Opening.md', patch: { timelines: ['Plot A', HEBREW.mainPlot] } },
    ]);
    expect(rename.lanes.map((lane) => lane.name)).toEqual(['Plot A', 'Backstory', HEBREW.mainPlot]);
  });

  it('renames a Hebrew lane and the events that name it', () => {
    const notes = [{ path: `Timeline/${HEBREW.battle}.md`, frontmatter: { timelines: [HEBREW.mainPlot] } }];
    const rename = renameLane(stored(), HEBREW.mainPlot, HEBREW.backstory, notes);
    if (!rename.ok) throw new Error(rename.message);
    expect(rename.lanes[2]).toEqual({ name: HEBREW.backstory, color: 'blue' });
    expect(rename.eventPatches).toEqual([
      { path: `Timeline/${HEBREW.battle}.md`, patch: { timelines: [HEBREW.backstory] } },
    ]);
  });

  it('allows a change of capitals only', () => {
    const rename = renameLane(stored(), 'Main plot', 'MAIN PLOT', [
      { path: 'Timeline/A.md', frontmatter: { timelines: ['Main plot'] } },
    ]);
    if (!rename.ok) throw new Error(rename.message);
    expect(rename.changed).toBe(true);
    expect(rename.lanes[0]?.name).toBe('MAIN PLOT');
    expect(rename.eventPatches).toEqual([{ path: 'Timeline/A.md', patch: { timelines: ['MAIN PLOT'] } }]);
  });

  it('changes nothing when the name is the same', () => {
    const rename = renameLane(stored(), 'Main plot', 'Main plot', [
      { path: 'Timeline/A.md', frontmatter: { timelines: ['Main plot'] } },
    ]);
    if (!rename.ok) throw new Error(rename.message);
    expect(rename.changed).toBe(false);
    expect(rename.value).toEqual(stored());
    expect(rename.eventPatches).toEqual([]);
  });

  it('renames a repeated lane everywhere, so the old name does not come back', () => {
    const value = [{ name: 'Main plot' }, { name: 'Backstory' }, { name: 'main plot', color: 'red' }];
    expect(ok(renameLane(value, 'Main plot', 'Plot A')).value).toEqual([
      { name: 'Plot A' },
      { name: 'Backstory' },
      { name: 'Plot A', color: 'red' },
    ]);
  });

  it('refuses a name that is taken, empty or built in, and a lane that is not there', () => {
    expect(refusal(renameLane(stored(), 'Main plot', 'backstory'))).toBe('name-taken');
    expect(refusal(renameLane(stored(), 'Main plot', HEBREW.mainPlot))).toBe('name-taken');
    expect(refusal(renameLane(stored(), 'Main plot', '  '))).toBe('empty-name');
    expect(refusal(renameLane(stored(), 'Main plot', 'Manuscript'))).toBe('name-taken');
    expect(refusal(renameLane(stored(), 'Main plot', 'Other'))).toBe('name-taken');
    expect(refusal(renameLane(stored(), 'Ghost', 'Plot A'))).toBe('not-found');
    expect(refusal(renameLane(stored(), 'Manuscript', 'Book'))).toBe('built-in');
    expect(refusal(renameLane(stored(), 'Other', 'Misc'))).toBe('built-in');
    expect(refusal(renameLane(undefined, 'Main plot', 'Plot A'))).toBe('not-found');
    expect(refusal(renameLane(7, 'Main plot', 'Plot A'))).toBe('unreadable');
  });
});

describe('recolourLane', () => {
  it('sets the colour, and takes it away again', () => {
    const red = ok(recolourLane(deepFreeze(stored()), 'backstory', 'red'));
    expect(red.changed).toBe(true);
    expect(red.value[1]).toEqual({ name: 'Backstory', color: 'red' });
    expect(red.lanes[1]).toEqual({ name: 'Backstory', color: 'red' });

    const none = ok(recolourLane(stored(), 'Main plot', null));
    expect(none.value[0]).toEqual({ name: 'Main plot' });
    expect(none.lanes[0]).toEqual({ name: 'Main plot', color: null });
  });

  it('changes nothing when the colour is the same', () => {
    const same = ok(recolourLane(stored(), 'Main plot', 'purple'));
    expect(same.changed).toBe(false);
    expect(same.value).toEqual(stored());
  });

  it('keeps a hand-written colour until a real one replaces it', () => {
    const value = [{ name: 'Main plot', color: 'teal', note: 'mine' }];
    const none = ok(recolourLane(value, 'Main plot', null));
    expect(none.changed).toBe(false);
    expect(none.value).toEqual(value);
    expect(ok(recolourLane(value, 'Main plot', 'green')).value).toEqual([{ name: 'Main plot', color: 'green', note: 'mine' }]);
  });

  it('turns a bare name into a lane with a colour', () => {
    expect(ok(recolourLane(['Main plot', 'Backstory'], 'Backstory', 'cyan')).value).toEqual([
      'Main plot',
      { name: 'Backstory', color: 'cyan' },
    ]);
  });

  it('lists a built-in lane when it is given a colour', () => {
    const manuscript = ok(recolourLane(stored(), 'Manuscript', 'green'));
    expect(manuscript.value).toEqual([{ name: 'Manuscript', color: 'green' }, ...stored()]);
    const other = ok(recolourLane(stored(), 'Other', 'orange'));
    expect(other.value).toEqual([...stored(), { name: 'Other', color: 'orange' }]);
    const nothing = ok(recolourLane(stored(), 'Manuscript', null));
    expect(nothing.changed).toBe(false);
    expect(nothing.value).toEqual(stored());
  });

  it('refuses a lane that is not there and a value it cannot read', () => {
    expect(refusal(recolourLane(stored(), 'Ghost', 'red'))).toBe('not-found');
    expect(refusal(recolourLane(7, 'Main plot', 'red'))).toBe('unreadable');
  });
});

describe('moveLane', () => {
  // The order shown is Manuscript, Main plot, Backstory, the Hebrew lane: places 0 to 3.
  it('moves a lane to another place among the lanes of the writer', () => {
    expect(names(moveLane(deepFreeze(stored()), HEBREW.mainPlot, 1))).toEqual([HEBREW.mainPlot, 'Main plot', 'Backstory']);
    expect(names(moveLane(stored(), 'Main plot', 3))).toEqual(['Backstory', HEBREW.mainPlot, 'Main plot']);
    expect(names(moveLane(stored(), 'Main plot', 2))).toEqual(['Backstory', 'Main plot', HEBREW.mainPlot]);
  });

  it('keeps the entries themselves as they were', () => {
    const value = stored();
    const moved = ok(moveLane(value, 'Backstory', 1)).value;
    expect(moved).toEqual([value[1], value[0], value[2]]);
    expect(moved[0]).toBe(value[1]);
  });

  it('changes nothing when the lane is already there', () => {
    const same = ok(moveLane(stored(), 'Main plot', 1));
    expect(same.changed).toBe(false);
    expect(same.value).toEqual(stored());
  });

  it('takes a place past the end, or one that is no number, to mean last', () => {
    expect(names(moveLane(stored(), 'Main plot', 99))).toEqual(['Backstory', HEBREW.mainPlot, 'Main plot']);
    expect(names(moveLane(stored(), 'Main plot', Number.NaN))).toEqual(['Backstory', HEBREW.mainPlot, 'Main plot']);
    expect(names(moveLane(stored(), HEBREW.mainPlot, -5))).toEqual([HEBREW.mainPlot, 'Manuscript', 'Main plot', 'Backstory']);
  });

  it('lists Manuscript once a lane goes above it, or it moves itself', () => {
    const above = ok(moveLane(stored(), 'Backstory', 0));
    expect(above.value).toEqual([{ name: 'Backstory' }, { name: 'Manuscript' }, stored()[0], stored()[2]]);
    const down = ok(moveLane(stored(), 'Manuscript', 2));
    expect(down.lanes.map((lane) => lane.name)).toEqual(['Main plot', 'Backstory', 'Manuscript', HEBREW.mainPlot]);
    // Moved back to the top, it stays listed where the writer put it.
    expect(names(moveLane(down.value, 'manuscript', 0))).toEqual(['Manuscript', 'Main plot', 'Backstory', HEBREW.mainPlot]);
  });

  it('lets Other be given a place of its own', () => {
    const up = ok(moveLane(stored(), 'Other', 1));
    expect(up.lanes.map((lane) => lane.name)).toEqual(['Other', 'Main plot', 'Backstory', HEBREW.mainPlot]);
    const stay = ok(moveLane(stored(), 'Other', 99));
    expect(stay.changed).toBe(false);
    expect(stay.value).toEqual(stored());
  });

  it('keeps entries it does not understand', () => {
    const value = [{ name: 'A' }, 42, { name: 'B' }, { name: 'a', color: 'red' }, { name: 'C' }];
    const moved = ok(moveLane(deepFreeze(value), 'C', 1)).value;
    expect(moved).toHaveLength(5);
    for (const entry of value) expect(moved).toContain(entry);
    expect(readLanes(moved).lanes.map((lane) => lane.name)).toEqual(['C', 'A', 'B']);
  });

  it('takes the repeated entries of a name along, so the lane that is read stays the same one', () => {
    const value = [{ name: 'Main plot', color: 'purple' }, { name: 'Backstory' }, { name: 'main plot', color: 'red' }, { name: 'Romance' }];
    const moved = ok(moveLane(deepFreeze(value), 'Main plot', 99));
    expect(moved.changed).toBe(true);
    expect(moved.lanes).toEqual([
      { name: 'Backstory', color: null },
      { name: 'Romance', color: null },
      { name: 'Main plot', color: 'purple' },
    ]);
    // The stored value reads as exactly those lanes: the lane kept its spelling, its colour and its new place.
    expect(readLanes(moved.value).lanes).toEqual(moved.lanes);
    expect(moved.value).toEqual([value[1], value[3], value[0], value[2]]);
    for (const entry of value) expect(moved.value).toContain(entry);
  });

  it('puts a lane where it was asked to, whatever is repeated or not understood in the list', () => {
    const value = deepFreeze([
      { name: 'A', color: 'purple' },
      42,
      { name: 'B' },
      { name: 'a', color: 'red' },
      { name: HEBREW.mainPlot, color: 'blue' },
      { name: 'b', color: 'green' },
      { nameless: true },
      { name: 'A' },
      'C',
    ]);
    const before = readLanes(value).lanes;
    const shown = displayLanes(before, [event('Lost', { date: 1923 })]); // Manuscript, A, B, the Hebrew lane, C, Other
    expect(shown.map((lane) => lane.name)).toEqual(['Manuscript', 'A', 'B', HEBREW.mainPlot, 'C', 'Other']);
    for (const lane of shown) {
      // Other is not in the index here, so only Other itself can be given the place after the listed lanes.
      const places = lane.kind === 'other' ? shown.length : shown.length - 1;
      for (let place = 0; place < places; place++) {
        const told = `${lane.name} to place ${place}`;
        const change = ok(moveLane(value, lane.name, place));
        // What is returned is what the stored value reads as.
        expect(readLanes(change.value).lanes, told).toEqual(change.lanes);
        // The lane is at the place asked for, and every lane is still itself.
        const after = displayLanes(change.lanes, [event('Lost', { date: 1923 })]);
        expect(after[place]?.key, told).toBe(lane.key);
        for (const kept of before) expect(change.lanes, told).toContainEqual(kept);
        // Nothing in the list was lost or rewritten.
        for (const entry of value) expect(change.value, told).toContain(entry);
      }
    }
  });

  it('refuses a lane that is not there and a value it cannot read', () => {
    expect(refusal(moveLane(stored(), 'Ghost', 0))).toBe('not-found');
    expect(refusal(moveLane(false, 'Main plot', 0))).toBe('unreadable');
  });
});

describe('every change to the lanes', () => {
  it('returns the lanes exactly as the stored value then reads, repeated names and all', () => {
    const value = deepFreeze([
      { name: 'Main plot', color: 'purple' },
      7,
      { name: 'Backstory' },
      { name: 'MAIN PLOT', color: 'red' },
      { name: 'backstory', color: 'teal' },
      HEBREW.mainPlot,
    ]);
    const changes: LaneChange[] = [
      addLane(value, 'Romance', 'pink'),
      renameLane(value, 'Main plot', 'Plot A'),
      renameLane(value, 'backstory', HEBREW.backstory),
      recolourLane(value, 'Main plot', 'green'),
      recolourLane(value, 'Backstory', 'yellow'),
      recolourLane(value, 'Other', 'orange'),
      recolourLane(value, 'Manuscript', 'cyan'),
      moveLane(value, 'Main plot', 3),
      moveLane(value, 'Backstory', 0),
      moveLane(value, 'Manuscript', 2),
      moveLane(value, 'Other', 1),
      removeLane(value, 'Main plot'),
      removeLane(value, HEBREW.mainPlot),
    ];
    for (const [index, change] of changes.entries()) {
      const made = ok(change);
      expect(made.changed, `change ${index}`).toBe(true);
      expect(readLanes(made.value).lanes, `change ${index}`).toEqual(made.lanes);
    }
  });
});

describe('removeLane', () => {
  it('removes the lane and keeps the rest as they were', () => {
    const value = stored();
    const change = ok(removeLane(deepFreeze(value), 'BACKSTORY'));
    expect(change.changed).toBe(true);
    expect(change.value).toEqual([value[0], value[2]]);
    expect(change.value[0]).toBe(value[0]);
  });

  it('removes every entry of that name, and no entry it does not understand', () => {
    const value = [{ name: 'A' }, 42, { name: 'a', color: 'red' }, { name: 'B' }];
    expect(ok(removeLane(value, 'A')).value).toEqual([42, { name: 'B' }]);
  });

  it('refuses a lane that is not there, the built-in lanes and a value it cannot read', () => {
    expect(refusal(removeLane(stored(), 'Ghost'))).toBe('not-found');
    expect(refusal(removeLane(stored(), 'Manuscript'))).toBe('built-in');
    expect(refusal(removeLane(stored(), 'Other'))).toBe('built-in');
    expect(refusal(removeLane(12, 'Main plot'))).toBe('unreadable');
  });
});

describe('displayLanes', () => {
  const lanes = readLanes(stored()).lanes;

  it('shows Manuscript first and the listed lanes after it', () => {
    expect(displayLanes(lanes)).toEqual([
      { name: 'Manuscript', color: null, key: 'manuscript', kind: 'manuscript' },
      { name: 'Main plot', color: 'purple', key: 'main plot', kind: 'lane' },
      { name: 'Backstory', color: null, key: 'backstory', kind: 'lane' },
      { name: HEBREW.mainPlot, color: 'blue', key: laneKey(HEBREW.mainPlot), kind: 'lane' },
    ]);
    expect(MANUSCRIPT_LANE).toBe('Manuscript');
    expect(OTHER_LANE).toBe('Other');
  });

  it('adds Other at the end only when an event belongs there', () => {
    const listed = [event('A', { date: 1923, timelines: ['Main plot'] }), sceneEvent('Opening', { date: 1923 })];
    expect(displayLanes(lanes, listed).map((lane) => lane.name)).not.toContain('Other');

    const unlisted = [...listed, event('B', { date: 1924, timelines: ['Ghost'] })];
    const shown = displayLanes(lanes, unlisted);
    expect(shown[shown.length - 1]).toEqual({ name: 'Other', color: null, key: 'other', kind: 'other' });

    const noLane = [event('C', { date: 1925 })];
    expect(displayLanes(lanes, noLane).map((lane) => lane.kind)).toEqual(['manuscript', 'lane', 'lane', 'lane', 'other']);
  });

  it('puts a built-in lane where the index lists it, with its colour', () => {
    const custom = readLanes([{ name: 'Main plot' }, { name: 'other', color: 'orange' }, { name: 'MANUSCRIPT', color: 'green' }]).lanes;
    expect(displayLanes(custom, [event('B', { date: 1924, timelines: ['Ghost'] })])).toEqual([
      { name: 'Main plot', color: null, key: 'main plot', kind: 'lane' },
      { name: 'Other', color: 'orange', key: 'other', kind: 'other' },
      { name: 'Manuscript', color: 'green', key: 'manuscript', kind: 'manuscript' },
    ]);
  });

  it('shows a lane once even if it is handed in twice', () => {
    const twice = [...lanes, { name: 'MAIN PLOT', color: null }];
    expect(displayLanes(twice).filter((lane) => lane.key === 'main plot')).toHaveLength(1);
  });
});

describe('visibleLanes', () => {
  const shown = displayLanes(readLanes(stored()).lanes);

  it('leaves out the lanes this device has hidden, whatever their capitals', () => {
    expect(visibleLanes(shown, ['BACKSTORY']).map((lane) => lane.name)).toEqual(['Manuscript', 'Main plot', HEBREW.mainPlot]);
    expect(visibleLanes(shown, new Set([HEBREW.mainPlot, 'manuscript'])).map((lane) => lane.name)).toEqual([
      'Main plot',
      'Backstory',
    ]);
  });

  it('shows everything when nothing is hidden, and ignores names of lanes that are gone', () => {
    expect(visibleLanes(shown, [])).toEqual(shown);
    expect(visibleLanes(shown, ['A lane that was removed'])).toEqual(shown);
  });

  it('does not change the list it is given', () => {
    const frozen = deepFreeze([...shown]);
    expect(() => visibleLanes(frozen, ['Backstory'])).not.toThrow();
  });
});
