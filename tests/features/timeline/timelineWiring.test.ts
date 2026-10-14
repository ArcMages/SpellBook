// The timeline's host (src/features/timeline/timelineWiring.ts) on the real
// project store over the tests' memory vault: what it hands the screen, when
// it says that something changed, and that everything it is asked to change
// reaches the vault through the store and nowhere else.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayNumber } from '../../../src/core/dates';
import { addLane, moveLane, renameLane, renameLaneInEventPatch } from '../../../src/core/timeline';
import { HIDDEN_LANES_KEY, WORLD_LANES_KEY } from '../../../src/features/timeline/hiddenLanes';
import { VIEW_CHOICES_KEY } from '../../../src/features/timeline/viewChoices';
import type { NoteChange, TimelineData } from '../../../src/features/timeline/timelineHost';
import { NOTE_NOT_OPENED, NO_PROJECT_OPEN } from '../../../src/features/timeline/timelineWiring';
import type { TimelineWiring } from '../../../src/features/timeline/timelineWiring';
import { INDEX_BODY, TODAY } from '../../storeHarness';
import { clearScreen, notices } from './screen';
import { EVENT_NOTES, LANES, NOVEL, OTHER, eventBody, hostOf, novelVault, rest, wire, wireOpen } from './wired';
import type { Wired } from './wired';

const HEBREW_LANE = 'רקע';
const HEBREW_EVENT = 'ילדות';

/** An event note's path as the host hands it out, and as the vault knows it. */
const event = (name: string): string => `Timeline/${name}.md`;
const onDisk = (name: string): string => `Novel/Timeline/${name}.md`;

function dataOf(host: TimelineWiring): TimelineData {
  const data = host.getData();
  if (!data) throw new Error('the host has nothing to show');
  return data;
}

/** The properties the host hands out for a note. */
function shown(host: TimelineWiring, path: string): Record<string, unknown> {
  const data = dataOf(host);
  const found = [...data.events, ...data.scenes].find((note) => note.path === path);
  if (!found) throw new Error(`the host shows no note at ${path}`);
  return found.frontmatter as Record<string, unknown>;
}

/** Listen as a screen does; `told` counts how often the host said that something changed. */
function follow(host: TimelineWiring): { told: number } {
  const heard = { told: 0 };
  host.onChange(() => {
    heard.told++;
  });
  return heard;
}

/** A change that sets the same properties whatever the note holds by then. */
const set = (path: string, patch: Record<string, unknown>): NoteChange => ({ path, patch, remake: () => patch });

/** The change of every event that names a lane, as the screen makes it for a rename. */
function renameChanges(host: TimelineWiring, from: string, to: string): NoteChange[] {
  const data = dataOf(host);
  const preview = renameLane(data.timelines, from, to, [...data.events, ...data.scenes]);
  if (!preview.ok) throw new Error(preview.message);
  return preview.eventPatches.map((entry) => ({
    path: entry.path,
    patch: entry.patch,
    remake: (frontmatter: unknown) => renameLaneInEventPatch(frontmatter, from, to),
  }));
}

async function opened(): Promise<{ w: Wired; host: TimelineWiring; heard: { told: number } }> {
  const w = await wireOpen();
  const host = hostOf(w);
  host.getData();
  return { w, host, heard: follow(host) };
}

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what the timeline is shown', () => {
  it('is nothing while no project is open, and the open project from the moment there is one', async () => {
    const w = wire();
    const host = hostOf(w);
    const heard = follow(host);
    expect(host.getData()).toBeNull();
    expect(w.storage.saves).toEqual([]);

    await w.store.openProject(NOVEL);
    await rest(w);
    expect(heard.told).toBe(1);
    expect(dataOf(host)).toEqual({
      projectId: NOVEL,
      projectName: 'My Novel',
      folder: 'Novel',
      timelines: LANES,
      // No calendar of its own, and no notes in a World folder.
      world: [],
      worldNotes: [],
      // The world lanes are off until this device turns them on.
      worldLanes: { on: false, hidden: [] },
      // The notes of the Timeline folder, as the store lists them.
      events: ['Loose end', 'Siege', 'Stray', 'The war begins', HEBREW_EVENT].map((name) => ({
        path: event(name),
        frontmatter: EVENT_NOTES[name],
      })),
      // The scenes of the binder, dated or not, in the binder's order.
      scenes: [
        { path: 'Manuscript/Opening.md', frontmatter: { status: 'To do', order: 1024, date: '1923-04-01' } },
        { path: 'Manuscript/Middle.md', frontmatter: { status: 'To do', order: 2048 } },
        { path: 'Manuscript/Ending.md', frontmatter: { status: 'To do', order: 3072, date: '1923-07-20' } },
      ],
      sceneOrder: ['Manuscript/Opening.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md'],
      hiddenLanes: [],
      // No filter by tags and no saved views until this device has some.
      tagFilter: { tags: [], match: 'any', kinds: [] },
      savedViews: [],
      today: dayNumber(TODAY),
    });
    expect(w.vault.writes).toEqual([]);
    expect(w.storage.saves).toEqual([]); // looking leaves no trace on the device either
  });

  it('is the same object until something in it changes', async () => {
    const { w, host, heard } = await opened();
    const before = dataOf(host);
    expect(host.getData()).toBe(before);

    // Things that show nowhere on the timeline.
    w.vault.external.write(onDisk('Siege'), { body: 'The writer went on writing.' });
    w.vault.external.editFrontmatter('Novel/Research/Trains.md', (frontmatter) => {
      frontmatter['date'] = '1900-01-01';
    });
    w.vault.external.create('Elsewhere/Note.md', { frontmatter: { date: '1923-04-12', timelines: ['Main plot'] } });
    w.vault.external.write(NOVEL, { body: 'Other words about the novel.' });
    await rest(w);
    expect(heard.told).toBe(0);
    expect(host.getData()).toBe(before);

    // Something that does.
    w.vault.external.editFrontmatter(onDisk('Siege'), (frontmatter) => {
      frontmatter['date'] = '1923-06-02';
    });
    expect(heard.told).toBe(0); // not in the middle of whatever is going on: at the next frame
    await rest(w);
    expect(heard.told).toBe(1);
    expect(host.getData()).not.toBe(before);
    expect(shown(host, event('Siege'))['date']).toBe('1923-06-02');
    expect(before.events[1]?.frontmatter).toEqual(EVENT_NOTES['Siege']); // what was handed out before is not changed under the screen
  });

  it('says so once when many notes arrive from another device at a time', async () => {
    const { w, host, heard } = await opened();
    const arrive = w.vault.sync([
      { path: onDisk('Arrival one'), frontmatter: { spellbook: 'event', date: '1923-04-20', timelines: ['Main plot'] } },
      { path: onDisk('Arrival two'), frontmatter: { spellbook: 'event', date: '1923-04-21', timelines: [HEBREW_LANE] } },
      { path: onDisk('Siege'), frontmatter: { spellbook: 'event', date: '1923-06-05', timelines: ['Main plot'] } },
    ]);
    while (arrive()) {
      // Each one is on disk before the next is handed over.
    }
    await rest(w);
    expect(heard.told).toBe(1);
    expect(dataOf(host).events.map((note) => note.path)).toEqual(
      ['Arrival one', 'Arrival two', 'Loose end', 'Siege', 'Stray', 'The war begins', HEBREW_EVENT].map(event),
    );
    expect(shown(host, event('Siege'))).toEqual({ spellbook: 'event', date: '1923-06-05', timelines: ['Main plot'] });
  });

  it('follows another device: the lanes, the order of the manuscript, a scene, an event renamed and one deleted', async () => {
    const { w, host, heard } = await opened();

    w.vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['timelines'] = [{ name: 'Only lane', color: 'blue' }];
    });
    await rest(w);
    expect(heard.told).toBe(1);
    expect(dataOf(host).timelines).toEqual([{ name: 'Only lane', color: 'blue' }]);

    w.vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['binder'] = ['Manuscript/Ending.md', { folder: 'Part one', id: 'f-1', children: ['Manuscript/Opening.md'] }];
    });
    await rest(w);
    expect(heard.told).toBe(2);
    expect(dataOf(host).sceneOrder).toEqual(['Manuscript/Ending.md', 'Manuscript/Opening.md']);
    // A note that is no longer in the binder is not a scene of the manuscript.
    expect(dataOf(host).scenes.map((note) => note.path)).toEqual(['Manuscript/Ending.md', 'Manuscript/Opening.md']);

    w.vault.external.editFrontmatter('Novel/Manuscript/Opening.md', (frontmatter) => {
      frontmatter['date'] = '1923-03-30';
    });
    await rest(w);
    expect(heard.told).toBe(3);
    expect(shown(host, 'Manuscript/Opening.md')['date']).toBe('1923-03-30');

    w.vault.external.rename(onDisk('Siege'), onDisk('The siege'));
    await rest(w);
    expect(heard.told).toBe(4);
    w.vault.external.delete(onDisk('Stray'));
    await rest(w);
    expect(heard.told).toBe(5);
    expect(dataOf(host).events.map((note) => note.path)).toEqual(['Loose end', 'The siege', 'The war begins', HEBREW_EVENT].map(event));
  });

  it('keeps a scene whose note has not arrived yet in the order, and shows it when it comes', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['binder'] = ['Manuscript/Opening.md', 'Manuscript/On its way.md', 'Manuscript/Ending.md'];
    });
    const w = await wireOpen(NOVEL, vault);
    const host = hostOf(w);
    const heard = follow(host);
    expect(dataOf(host).sceneOrder).toEqual(['Manuscript/Opening.md', 'Manuscript/On its way.md', 'Manuscript/Ending.md']);
    expect(dataOf(host).scenes.map((note) => note.path)).toEqual(['Manuscript/Opening.md', 'Manuscript/Ending.md']);

    vault.external.create('Novel/Manuscript/On its way.md', { frontmatter: { date: '1923-05-05' }, body: 'Here at last.' });
    await rest(w);
    expect(heard.told).toBeGreaterThanOrEqual(1);
    expect(shown(host, 'Manuscript/On its way.md')).toEqual({ date: '1923-05-05' });
  });

  it('shows a note of the Timeline folder once, as an event, also when the binder lists it', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['binder'] = ['Manuscript/Opening.md', 'Timeline/Siege.md'];
    });
    const w = await wireOpen(NOVEL, vault);
    const data = dataOf(hostOf(w));
    expect(data.sceneOrder).toEqual(['Manuscript/Opening.md']);
    expect(data.scenes.map((note) => note.path)).toEqual(['Manuscript/Opening.md']);
    expect(data.events.filter((note) => note.path === event('Siege'))).toHaveLength(1);
  });

  it('does nothing while no screen is listening, and is up to date the moment it is asked', async () => {
    const w = await wireOpen();
    const host = hostOf(w);
    const before = dataOf(host);
    await rest(w);
    const waiting = w.timers.pending;
    w.vault.external.editFrontmatter(onDisk('Siege'), (frontmatter) => {
      frontmatter['date'] = '1923-06-09';
    });
    w.vault.external.create(onDisk('New'), { frontmatter: { spellbook: 'event', date: '1923-07-01' } });
    expect(w.timers.pending).toBe(waiting); // no drawing was put off: nobody would look
    expect(host.getData()).not.toBe(before);
    expect(shown(host, event('Siege'))['date']).toBe('1923-06-09');
    expect(shown(host, event('New'))['date']).toBe('1923-07-01');
  });
});

describe('changing a note from the timeline', () => {
  it('goes through the store, worked out again from the note as it is on disk at that moment', async () => {
    const { w, host, heard } = await opened();
    // Another device has changed the note, and this one has not heard of it yet.
    w.vault.external.editFrontmatter(
      onDisk('The war begins'),
      (frontmatter) => {
        frontmatter['timelines'] = ['Main plot', 'Side'];
      },
      { silent: true },
    );
    const seen: unknown[] = [];
    await host.applyNoteChanges([
      {
        path: event('The war begins'),
        patch: { date: '1923-04-22' },
        remake: (frontmatter) => {
          seen.push(JSON.parse(JSON.stringify(frontmatter)));
          return { date: '1923-04-22' };
        },
      },
    ]);

    expect(seen).toEqual([{ spellbook: 'event', date: '1923-04-12', timelines: ['Main plot', 'Side'], tags: ['war'] }]);
    expect(w.vault.writes).toEqual([{ op: 'updateFrontmatter', path: onDisk('The war begins') }]);
    expect(w.vault.frontmatterOf(onDisk('The war begins'))).toEqual({
      spellbook: 'event',
      date: '1923-04-22',
      timelines: ['Main plot', 'Side'], // what the other device did is kept
      tags: ['war'],
    });
    expect(w.vault.bodyOf(onDisk('The war begins'))).toBe(eventBody('The war begins'));
    // By the time it is done the screens were told, and are shown the note as it now is.
    expect(heard.told).toBe(1);
    expect(shown(host, event('The war begins'))).toEqual(w.vault.frontmatterOf(onDisk('The war begins')));
    await rest(w);
    expect(heard.told).toBe(1); // the vault's own report of the write says nothing new
  });

  it('changes a scene the same way, and several notes one after the other', async () => {
    const { w, host, heard } = await opened();
    await host.applyNoteChanges([set('Manuscript/Opening.md', { date: '1923-04-05' }), set(event('Siege'), { timelines: [HEBREW_LANE] })]);
    expect(w.vault.writes).toEqual([
      { op: 'updateFrontmatter', path: 'Novel/Manuscript/Opening.md' },
      { op: 'updateFrontmatter', path: onDisk('Siege') },
    ]);
    expect(w.vault.frontmatterOf('Novel/Manuscript/Opening.md')).toEqual({ status: 'To do', order: 1024, date: '1923-04-05' });
    expect(w.vault.bodyOf('Novel/Manuscript/Opening.md')).toBe('Once.');
    expect(shown(host, 'Manuscript/Opening.md')['date']).toBe('1923-04-05');
    expect(shown(host, event('Siege'))['timelines']).toEqual([HEBREW_LANE]);
    expect(heard.told).toBe(1); // shown whole, not note by note
  });

  it('takes a property away when the change says so: no "timelines: []" is left behind', async () => {
    const { w, host } = await opened();
    await host.applyNoteChanges([set(event('Siege'), { timelines: undefined })]);
    expect(w.vault.frontmatterOf(onDisk('Siege'))).toEqual({ spellbook: 'event', date: '1923-06-01', end: '1923-08-01' });
    expect('timelines' in shown(host, event('Siege'))).toBe(false);
  });

  it('writes nothing for a change that has nothing left to change', async () => {
    const { w, host, heard } = await opened();
    await host.applyNoteChanges([{ path: event('Siege'), patch: { date: '1923-06-01' }, remake: () => ({}) }]);
    await host.applyNoteChanges([]);
    expect(w.vault.writes).toEqual([]);
    expect(heard.told).toBe(0);
  });

  it('shows the change at once, before the vault has indexed the note again', async () => {
    const { w, host, heard } = await opened();
    w.vault.holdMetadata();
    await host.applyNoteChanges([set(event('Siege'), { date: '1923-06-10' })]);
    // The vault's index still says what it said before...
    expect(w.store.timelineNotes().find((note) => note.path === event('Siege'))?.frontmatter?.['date']).toBe('1923-06-01');
    // ...but the timeline shows what was written.
    expect(shown(host, event('Siege'))).toEqual({ spellbook: 'event', date: '1923-06-10', end: '1923-08-01', timelines: ['Main plot'] });
    expect(heard.told).toBe(1);

    w.vault.releaseMetadata();
    await rest(w);
    expect(heard.told).toBe(1); // the index caught up and says the same
    // From here on the index is what counts again.
    w.vault.external.editFrontmatter(onDisk('Siege'), (frontmatter) => {
      frontmatter['date'] = '1923-06-20';
    });
    await rest(w);
    expect(shown(host, event('Siege'))['date']).toBe('1923-06-20');
    expect(heard.told).toBe(2);
  });

  it('fails, saying why, when a note cannot be written, and goes on to the others', async () => {
    const { w, host } = await opened();
    w.vault.failNext('updateFrontmatter', onDisk('Siege'), 'The disk is full');
    await expect(
      host.applyNoteChanges([set(event('Siege'), { date: '1923-06-10' }), set(event('Stray'), { date: '1923-06' })]),
    ).rejects.toThrow(/Siege.*could not be saved.*The disk is full/);
    expect(w.vault.frontmatterOf(onDisk('Siege'))).toEqual(EVENT_NOTES['Siege']);
    expect(shown(host, event('Siege'))).toEqual(EVENT_NOTES['Siege']); // nothing is shown that was not written
    expect(shown(host, event('Stray'))['date']).toBe('1923-06');

    await expect(host.applyNoteChanges([set(event('Gone'), { date: '1923' })])).rejects.toThrow(/has no note in this project/);
    await expect(host.applyNoteChanges([set('../Other/Timeline/Coronation.md', { date: '1923' })])).rejects.toThrow(/not a note inside this project/);
    expect(w.vault.frontmatterOf('Other/Timeline/Coronation.md')).toEqual({ spellbook: 'event', date: '1066-12-25', timelines: ['Court'] });
  });

  it('fails for a project that is read-only, and when no project is open', async () => {
    const { w, host } = await opened();
    w.vault.external.corrupt(NOVEL);
    await rest(w);
    w.vault.clearWrites();
    await expect(host.applyNoteChanges([set(event('Siege'), { date: '1923-06-10' })])).rejects.toThrow(/read-only/);
    expect(w.vault.writes).toEqual([]);

    const closed = wire();
    await expect(hostOf(closed).applyNoteChanges([set(event('Siege'), { date: '1923' })])).rejects.toThrow(NO_PROJECT_OPEN);
    expect(closed.vault.writes).toEqual([]);
  });
});

describe('making an event from the timeline', () => {
  it('makes a note in the Timeline folder through the store, named from its title', async () => {
    const { w, host, heard } = await opened();
    const frontmatter = { spellbook: 'event', date: '1923-09', timelines: ['Main plot'], end: '1923-10' };
    expect(await host.createEvent({ title: 'Armistice: the end?', frontmatter })).toEqual({ ok: true, path: event('Armistice the end') });
    expect(w.vault.writes).toEqual([{ op: 'createFile', path: onDisk('Armistice the end') }]);
    expect(w.vault.frontmatterOf(onDisk('Armistice the end'))).toEqual(frontmatter);
    expect(w.vault.bodyOf(onDisk('Armistice the end'))).toBe('');
    expect(heard.told).toBe(1);
    expect(shown(host, event('Armistice the end'))).toEqual(frontmatter);

    // A title in any language is kept as it was typed.
    const hebrew = 'שביתת נשק';
    expect(await host.createEvent({ title: hebrew, frontmatter: { spellbook: 'event', date: null, timelines: [] } })).toEqual({
      ok: true,
      path: event(hebrew),
    });
    expect(w.vault.has(onDisk(hebrew))).toBe(true);
    await rest(w);
    expect(heard.told).toBe(2);
  });

  it('says why an event cannot be made, and then makes nothing', async () => {
    const { w, host, heard } = await opened();
    const frontmatter = { spellbook: 'event', date: '1923', timelines: [] };
    expect(await host.createEvent({ title: '   ', frontmatter })).toEqual({ ok: false, message: 'Give the event a title.' });
    expect(await host.createEvent({ title: '???', frontmatter })).toEqual({
      ok: false,
      message: 'That title has no characters that can be used in a file name.',
    });
    // A name that is taken, whatever its capitals: nothing is replaced.
    expect(await host.createEvent({ title: 'siege', frontmatter })).toEqual({
      ok: false,
      message: 'There is already an event called "siege". Give this one another title.',
    });
    w.vault.failNext('createFile', onDisk('Unlucky'), 'The disk is full');
    expect(await host.createEvent({ title: 'Unlucky', frontmatter })).toMatchObject({ ok: false, message: expect.stringMatching(/The disk is full/) });

    expect(w.vault.writes).toEqual([]);
    expect(w.vault.frontmatterOf(onDisk('Siege'))).toEqual(EVENT_NOTES['Siege']);
    expect(w.vault.bodyOf(onDisk('Siege'))).toBe(eventBody('Siege'));
    expect(heard.told).toBe(0);

    w.vault.external.corrupt(NOVEL);
    await rest(w);
    expect(await host.createEvent({ title: 'Later', frontmatter })).toMatchObject({ ok: false, message: expect.stringMatching(/read-only/) });
    expect(await hostOf(wire()).createEvent({ title: 'Later', frontmatter })).toEqual({ ok: false, message: NO_PROJECT_OPEN });
  });

  it('shows the new event with its date before the vault has indexed the note', async () => {
    const { w, host, heard } = await opened();
    w.vault.holdMetadata();
    const frontmatter = { spellbook: 'event', date: '1923-09-01', timelines: ['Main plot'] };
    await host.createEvent({ title: 'Armistice', frontmatter });
    expect(w.store.timelineNotes().find((note) => note.path === event('Armistice'))?.frontmatter).toBeNull();
    expect(shown(host, event('Armistice'))).toEqual(frontmatter);
    expect(heard.told).toBe(1);
    w.vault.releaseMetadata();
    await rest(w);
    expect(heard.told).toBe(1);
    expect(shown(host, event('Armistice'))).toEqual(frontmatter);
  });
});

describe('changing the lanes from the timeline', () => {
  it('stores them in the project index through the store, made from the value on disk at that moment', async () => {
    const { w, host, heard } = await opened();
    // Another device added a lane, and this one has not heard of it yet.
    w.vault.external.editFrontmatter(
      NOVEL,
      (frontmatter) => {
        frontmatter['timelines'] = [...LANES, { name: 'Side' }];
      },
      { silent: true },
    );
    const seen: unknown[] = [];
    const result = await host.saveLanes((timelines) => {
      seen.push(timelines);
      return addLane(timelines, 'Subplot');
    }, []);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(seen).toEqual([[...LANES, { name: 'Side' }]]);
    expect(w.vault.writes).toEqual([{ op: 'updateFrontmatter', path: NOVEL }]);
    expect(w.vault.frontmatterOf(NOVEL)).toMatchObject({
      spellbook: 'project',
      title: 'My Novel',
      binder: ['Manuscript/Opening.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md'],
      timelines: [...LANES, { name: 'Side' }, { name: 'Subplot' }],
    });
    expect(w.vault.bodyOf(NOVEL)).toBe(INDEX_BODY);
    expect(heard.told).toBe(1);
    expect(dataOf(host).timelines).toEqual([...LANES, { name: 'Side' }, { name: 'Subplot' }]);
    await rest(w);
    expect(heard.told).toBe(1);
  });

  it('hands a refusal back without writing, and fails when the index cannot be saved or the project is read-only', async () => {
    const { w, host, heard } = await opened();
    const refused = await host.saveLanes((timelines) => addLane(timelines, 'main PLOT'), [set(event('Siege'), { timelines: ['x'] })]);
    expect(refused).toMatchObject({ ok: false, reason: 'name-taken' });
    const same = await host.saveLanes((timelines) => moveLane(timelines, 'Main plot', 1), [set(event('Siege'), { timelines: ['x'] })]);
    expect(same).toMatchObject({ ok: true, changed: false });
    expect(w.vault.writes).toEqual([]); // not even the notes: there was no change to follow
    expect(heard.told).toBe(0);

    w.vault.failNext('updateFrontmatter', NOVEL, 'The disk is full');
    await expect(host.saveLanes((timelines) => addLane(timelines, 'Subplot'), [])).rejects.toThrow(/could not be saved.*The disk is full/);
    expect(w.vault.frontmatterOf(NOVEL)?.['timelines']).toEqual(LANES);

    w.vault.external.corrupt(NOVEL);
    await rest(w);
    w.vault.clearWrites();
    await expect(host.saveLanes((timelines) => addLane(timelines, 'Subplot'), [])).rejects.toThrow(/read-only/);
    expect(w.vault.writes).toEqual([]);
    await expect(hostOf(wire()).saveLanes((timelines) => addLane(timelines, 'Subplot'), [])).rejects.toThrow(NO_PROJECT_OPEN);
  });

  it('renames a lane in the index and then in every event that names it, shown as one change', async () => {
    const { w, host, heard } = await opened();
    const changes = renameChanges(host, 'Main plot', 'Plot A');
    expect(changes.map((change) => change.path)).toEqual(['Loose end', 'Siege', 'The war begins'].map(event));
    const result = await host.saveLanes((timelines) => renameLane(timelines, 'Main plot', 'Plot A'), changes);
    expect(result.ok).toBe(true);

    // The index first, then the notes.
    expect(w.vault.writes).toEqual([
      { op: 'updateFrontmatter', path: NOVEL },
      { op: 'updateFrontmatter', path: onDisk('Loose end') },
      { op: 'updateFrontmatter', path: onDisk('Siege') },
      { op: 'updateFrontmatter', path: onDisk('The war begins') },
    ]);
    expect(w.vault.frontmatterOf(NOVEL)?.['timelines']).toEqual([{ name: 'Plot A', color: 'purple' }, LANES[1]]);
    for (const name of ['Loose end', 'Siege', 'The war begins']) {
      expect(w.vault.frontmatterOf(onDisk(name)), name).toEqual({ ...EVENT_NOTES[name], timelines: ['Plot A'] });
      expect(w.vault.bodyOf(onDisk(name)), name).toBe(eventBody(name));
    }
    expect(w.vault.frontmatterOf(onDisk('Stray'))).toEqual(EVENT_NOTES['Stray']);
    expect(heard.told).toBe(1);
    expect(shown(host, event('Siege'))['timelines']).toEqual(['Plot A']);
    await rest(w);
    expect(heard.told).toBe(1);
  });

  it('says what was done and what was not when a note cannot follow a renamed lane', async () => {
    const { w, host } = await opened();
    w.vault.failNext('updateFrontmatter', onDisk('Siege'), 'The disk is full');
    await expect(
      host.saveLanes((timelines) => renameLane(timelines, 'Main plot', 'Plot A'), renameChanges(host, 'Main plot', 'Plot A')),
    ).rejects.toThrow(/^The lanes were saved, but 1 note could not be changed to match\. .*Siege.*The disk is full/);
    expect(w.vault.frontmatterOf(NOVEL)?.['timelines']).toEqual([{ name: 'Plot A', color: 'purple' }, LANES[1]]);
    expect(w.vault.frontmatterOf(onDisk('Siege'))?.['timelines']).toEqual(['Main plot']);
    expect(w.vault.frontmatterOf(onDisk('The war begins'))?.['timelines']).toEqual(['Plot A']); // the others still followed
    expect(shown(host, event('Siege'))['timelines']).toEqual(['Main plot']);
  });
});

describe('hiding lanes', () => {
  it('is remembered on the device, for the project, and never in the vault', async () => {
    const { w, host, heard } = await opened();
    host.setHiddenLanes([HEBREW_LANE]);
    expect(heard.told).toBe(1);
    expect(dataOf(host).hiddenLanes).toEqual([HEBREW_LANE]);
    expect(w.vault.writes).toEqual([]);
    expect(w.storage.saves.map(([key]) => key)).toEqual([HIDDEN_LANES_KEY]);
    expect(JSON.parse(w.storage.load(HIDDEN_LANES_KEY) as string)).toEqual({ [NOVEL]: [HEBREW_LANE] });

    host.setHiddenLanes([HEBREW_LANE]); // told what it already knows
    expect(heard.told).toBe(1);
    expect(w.storage.saves).toHaveLength(1);

    // After a restart the device still knows.
    expect(dataOf(hostOf(w)).hiddenLanes).toEqual([HEBREW_LANE]);
  });

  it('is kept apart for each project', async () => {
    const { w, host } = await opened();
    host.setHiddenLanes(['Main plot']);
    await w.store.openProject(OTHER);
    await rest(w);
    expect(dataOf(host).hiddenLanes).toEqual([]);
    host.setHiddenLanes(['Court']);
    await w.store.openProject(NOVEL);
    await rest(w);
    expect(dataOf(host).hiddenLanes).toEqual(['Main plot']);
  });

  it('follows the project when its folder is renamed, and a lane when it is renamed', async () => {
    const { w, host } = await opened();
    host.setHiddenLanes(['main plot', 'Other']);
    w.vault.external.rename('Novel', 'Book');
    await rest(w);
    expect(dataOf(host).projectId).toBe('Book/Novel.md');
    expect(dataOf(host).hiddenLanes).toEqual(['main plot', 'Other']);

    await host.saveLanes((timelines) => moveLane(timelines, 'Main plot', 2), []);
    expect(dataOf(host).hiddenLanes).toEqual(['main plot', 'Other']); // moving a lane renames nothing
    await host.saveLanes((timelines) => renameLane(timelines, 'Main plot', 'Plot A'), []);
    expect(dataOf(host).hiddenLanes).toEqual(['Plot A', 'Other']);
    expect(JSON.parse(w.storage.load(HIDDEN_LANES_KEY) as string)).toEqual({ 'Book/Novel.md': ['Plot A', 'Other'] });
  });

  it('does nothing while no project is open', () => {
    const w = wire();
    hostOf(w).setHiddenLanes(['Main plot']);
    expect(w.storage.saves).toEqual([]);
  });
});

describe('the filter by tags and the saved views of a device', () => {
  it('switches to a view at once: the lanes, the world and the filter, told once, kept on the device', async () => {
    const { w, host, heard } = await opened();
    host.setViewState({ hiddenLanes: ['Manuscript'], world: { on: true, hidden: [] }, filter: { tags: ['מלוכה'], match: 'all', kinds: [] } });
    expect(heard.told).toBe(1);
    const data = dataOf(host);
    expect(data.hiddenLanes).toEqual(['Manuscript']);
    expect(data.worldLanes).toEqual({ on: true, hidden: [] });
    expect(data.tagFilter).toEqual({ tags: ['מלוכה'], match: 'all', kinds: [] });
    expect(w.vault.writes).toEqual([]);
    expect(new Set(w.storage.saves.map(([key]) => key))).toEqual(new Set([HIDDEN_LANES_KEY, WORLD_LANES_KEY, VIEW_CHOICES_KEY]));

    host.setSavedViews([{ name: 'Royals', hiddenLanes: [], world: { on: false, hidden: [] }, filter: data.tagFilter ?? { tags: [], match: 'any', kinds: [] } }]);
    expect(heard.told).toBe(2);
    host.setTagFilter({ tags: [], match: 'any', kinds: [] });
    expect(heard.told).toBe(3);
    // After a restart, and when the project's folder is renamed, the device still knows.
    w.vault.external.rename('Novel', 'Book');
    await rest(w);
    const again = dataOf(hostOf(w));
    expect(again.savedViews?.map((view) => view.name)).toEqual(['Royals']);
    expect(again.tagFilter).toEqual({ tags: [], match: 'any', kinds: [] });
  });
});

describe('showing a note from the timeline', () => {
  it('asks the plugin for the note by its place in the vault, in the pane that was asked for', async () => {
    const { w, host } = await opened();
    host.openNote(event('Siege'), 'tab');
    host.openNote('Manuscript/Opening.md', false);
    await rest(w);
    expect(w.opened).toEqual([
      { path: onDisk('Siege'), where: 'tab' },
      { path: 'Novel/Manuscript/Opening.md', where: false },
    ]);
    expect(notices()).toEqual([]);
  });

  it('tells the writer when the note could not be shown', async () => {
    const { w, host } = await opened();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    w.showing.result = false;
    host.openNote(event('Siege'), false);
    await rest(w);
    w.showing.result = new Error('no room');
    host.openNote(event('Siege'), false);
    await rest(w);
    expect(notices()).toEqual([NOTE_NOT_OPENED, NOTE_NOT_OPENED]);
  });
});

describe('another project', () => {
  it('switches everything that is shown, and a closed project leaves nothing', async () => {
    const { w, host, heard } = await opened();
    await w.store.openProject(OTHER);
    await rest(w);
    expect(heard.told).toBe(1);
    expect(dataOf(host)).toMatchObject({
      projectId: OTHER,
      projectName: 'Other Book',
      timelines: [{ name: 'Court', color: 'red' }],
      events: [{ path: 'Timeline/Coronation.md', frontmatter: { spellbook: 'event', date: '1066-12-25', timelines: ['Court'] } }],
      scenes: [{ path: 'Manuscript/First.md' }],
      sceneOrder: ['Manuscript/First.md'],
    });

    // What happens in the project that is no longer open is none of the timeline's business.
    w.vault.external.editFrontmatter(onDisk('Siege'), (frontmatter) => {
      frontmatter['date'] = '1923-06-30';
    });
    await rest(w);
    expect(heard.told).toBe(1);
    // And what is changed now is changed in the project that is open.
    await host.applyNoteChanges([set('Timeline/Coronation.md', { date: '1066-12-26' })]);
    expect(w.vault.frontmatterOf('Other/Timeline/Coronation.md')?.['date']).toBe('1066-12-26');
    expect(heard.told).toBe(2);

    await w.store.closeProject();
    await rest(w);
    expect(heard.told).toBe(3);
    expect(host.getData()).toBeNull();
  });

  it('never writes into another project than the one a change was asked in', async () => {
    const { w, host } = await opened();
    // The writer switches project while changes asked for in the old one are still on their way.
    const switched = w.store.openProject(OTHER);
    const change = host.applyNoteChanges([set('Manuscript/First.md', { date: '1923' })]); // a path the other project has too
    const lanes = host.saveLanes((timelines) => addLane(timelines, 'Subplot'), []);
    const made = host.createEvent({ title: 'Stowaway', frontmatter: { spellbook: 'event' } });
    await expect(change).rejects.toThrow(/Another project was opened/);
    await expect(lanes).rejects.toThrow(/Another project was opened/);
    expect(await made).toMatchObject({ ok: false, message: expect.stringMatching(/Another project was opened/) });
    await switched;
    await rest(w);
    expect(w.vault.writes).toEqual([]);
    expect(w.vault.frontmatterOf('Other/Manuscript/First.md')).toEqual({ status: 'To do', order: 1024 });
    expect(w.vault.frontmatterOf(OTHER)?.['timelines']).toEqual([{ name: 'Court', color: 'red' }]);
  });
});

describe('unloading the plugin', () => {
  it('lets go of everything: no listener, no timer, nothing shown and nothing written', async () => {
    const { w, host, heard } = await opened();
    w.vault.external.editFrontmatter(onDisk('Siege'), (frontmatter) => {
      frontmatter['date'] = '1923-06-02';
    });
    expect(w.timers.pending).toBeGreaterThan(0); // a look at the next frame is waiting
    expect(host.listening).toBe(1);

    w.unload();
    expect(host.isReleased).toBe(true);
    expect(host.listening).toBe(0);
    expect(w.timers.pending).toBe(0);
    expect(host.getData()).toBeNull();

    w.vault.external.editFrontmatter(onDisk('Siege'), (frontmatter) => {
      frontmatter['date'] = '1923-06-03';
    });
    w.vault.refresh();
    await rest(w);
    expect(w.timers.pending).toBe(0);
    expect(heard.told).toBe(0);

    // Whatever a screen that is still closing may ask for comes to nothing.
    const stop = host.onChange(() => undefined);
    expect(host.listening).toBe(0);
    stop();
    w.vault.clearWrites();
    host.setHiddenLanes(['Main plot']);
    host.openNote(event('Siege'), false);
    await expect(host.applyNoteChanges([set(event('Siege'), { date: '1923' })])).rejects.toThrow(NO_PROJECT_OPEN);
    await expect(host.saveLanes((timelines) => addLane(timelines, 'Subplot'), [])).rejects.toThrow(NO_PROJECT_OPEN);
    expect(await host.createEvent({ title: 'Late', frontmatter: { spellbook: 'event' } })).toEqual({ ok: false, message: NO_PROJECT_OPEN });
    expect(w.vault.writes).toEqual([]);
    expect(w.storage.saves).toEqual([]);
    expect(w.opened).toEqual([]);
    host.release(); // again: nothing more happens
  });
});
