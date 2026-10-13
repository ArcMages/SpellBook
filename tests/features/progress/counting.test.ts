// Writing progress, from the editor to the files: what is typed is counted
// and saved in this device's daily log, and scenes get their dates when the
// writer leaves them. Run through a stand-in context (see stand.ts); the
// editor's changes are real CodeMirror transactions.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEASURE_AFTER_MS, WRITE_AFTER_QUIET_MS, parseStatsFile, updateStatsText } from '../../../src/core/progress/index';
import type { DayCounts } from '../../../src/core/progress/index';
import { progressFeature } from '../../../src/features/progress/index';
import { COUNT_PASTED_KEY } from '../../../src/features/progress/settings';
import { MOST_WATCHED } from '../../../src/features/progress/wordLedger';
import { registerFeatures } from '../../../src/features/registry';
import { Notice, fakeDocument, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import { DEVICE_ID_KEY } from '../../../src/core/deviceId';
import { sceneBody, seedProject } from '../../storeHarness';
import { DAY, makeStand, setHidden } from './stand';
import type { Stand } from './stand';

vi.mock('obsidian', async (importOriginal) => {
  const { withProgressExtras } = await import('./obsidianExtras');
  return withProgressExtras(await importOriginal<typeof import('../../obsidianStub')>());
});

const OPENING = 'Novel/Manuscript/Opening.md';
const LETTER = 'Novel/Manuscript/The Letter.md';
const CASTLE = 'Novel/Research/Castle.md';
const DIARY = 'Elsewhere/Diary.md';

/** Long enough for typing to count as paused, and the words to be counted. */
const PAUSE = MEASURE_AFTER_MS + 100;
/** Long enough after that for the log to be saved. */
const QUIET = WRITE_AFTER_QUIET_MS;

const day = (date: string, counts: Partial<DayCounts>): DayCounts & { date: string } => ({
  date,
  manuscriptAdded: 0,
  manuscriptDeleted: 0,
  otherAdded: 0,
  otherDeleted: 0,
  ...counts,
});

const stands: Stand[] = [];

async function standUp(options?: Parameters<typeof makeStand>[0]): Promise<Stand> {
  const stand = await makeStand(options);
  stands.push(stand);
  return stand;
}

beforeEach(() => {
  Notice.shown.length = 0;
  resetFakeDocument();
});

afterEach(async () => {
  for (const stand of stands.splice(0)) await stand.unload();
  resetPlatform();
  vi.restoreAllMocks();
});

describe('counting what is typed', () => {
  it('counts typing when it pauses, and saves it in this device\'s log once it has been quiet', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    const editor = stand.editor(OPENING);

    editor.type('Five new words right here. ');
    await stand.pass(1000); // still typing: a pause of one second is no pause
    editor.type('And three more. ');
    await stand.pass(1000);
    expect(stand.line()).toContain('Session 0'); // nothing is counted while the writer types
    expect(stand.logDays('2026-10')).toBeNull();

    await stand.pass(PAUSE);
    expect(stand.line()).toContain('Session 8');
    expect(stand.line()).toContain('Words 17'); // nine were there, eight were typed
    expect(stand.logDays('2026-10')).toBeNull(); // counted, not saved yet

    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 8 })]);
    // The file is this device's own, in the project's Stats folder, and says so.
    const path = stand.logPath('2026-10');
    expect(path).toMatch(/^Novel\/Stats\/2026-10 [a-z0-9]+\.md$/);
    const file = parseStatsFile(stand.vault.textOf(path));
    expect(file.problems).toEqual([]);
    expect([file.device, file.month]).toEqual([stand.deviceId, '2026-10']);
    expect(stand.vault.textOf(path)).toContain('spellbook: stats');
  });

  it('counts deleting as deleted words, not as fewer written', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two three four. ');
    await stand.pass(PAUSE);
    editor.backspace('three four. '.length);
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 4, manuscriptDeleted: 2 })]);
    expect(stand.line()).toContain('Session 2');
  });

  it('keeps the manuscript apart from the other notes, and credits notes outside the project to the open project', async () => {
    const stand = await standUp();
    stand.editor(OPENING).type('In the manuscript. ');
    stand.editor(CASTLE).type('Thick walls. ');
    stand.editor(DIARY).type('A note to myself today. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3, otherAdded: 7 })]);
  });

  it('does not count words in the properties or in a comment', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING, '---\nsynopsis: none\n---\nOne two.\n');
    editor.type('Three. %%a note to myself, not part of the scene%% ');
    await stand.pass(PAUSE);
    expect(stand.line()).toContain('Session 1');
  });

  it('leaves no trace before the first words are saved: no file, nothing on the device, no id for it', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    const editor = stand.editor(OPENING);
    editor.type('Typed and not yet saved. ');
    await stand.pass(PAUSE);
    expect(stand.storage.saves).toEqual([]);
    expect(stand.idsAsked()).toBe(0);
    expect(stand.vault.writes).toEqual([]);

    await stand.pass(QUIET);
    // The id is made when the first log file needs its name.
    expect(stand.idsAsked()).toBeGreaterThan(0);
    expect(stand.storage.saves.map(([key]) => key)).toEqual([DEVICE_ID_KEY]);
    // The project had no Stats folder yet: the store makes it for the first log file.
    expect(stand.vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/Stats' },
      { op: 'updateText', path: stand.logPath('2026-10') },
    ]);
  });

  it('counts no words inside the editor\'s own update, whatever the kind of change', async () => {
    const stand = await standUp();
    // The manuscript's scenes are counted for the project total first; that is not the editor's doing.
    await stand.rest();
    const reads = stand.vault.reads.readText;
    const editor = stand.editor(OPENING);
    // Every count goes through the word segmenter.
    const counting = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    editor.type('One two three. ');
    editor.paste('Four five six. ');
    editor.undo();
    editor.reload(`${editor.text}Seven. `);
    editor.type('Eight. ');
    expect(counting).not.toHaveBeenCalled();
    expect(stand.vault.reads.readText).toBe(reads);

    await stand.pass(PAUSE);
    expect(counting).toHaveBeenCalled();
    expect(stand.line()).toContain('Session 4');
  });
});

describe('what does not count', () => {
  it('does not count pasted or dropped text, nor a cut as deleting', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.paste('Ten words that were written somewhere else and brought here. ');
    editor.drop('Dragged in. ');
    await stand.pass(PAUSE);
    editor.cut('Dragged in. '.length);
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.line()).toContain('Session 0');
    expect(stand.logDays('2026-10')).toBeNull();

    // What is typed after a paste counts as usual.
    editor.type('Two more. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 2 })]);
  });

  it('counts typing and a paste made in the same breath each for what it is', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two. ');
    editor.paste('Pasted three words. ');
    editor.type('Three. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3 })]);
  });

  it('counts pasted text when the writer switched that on, on this device', async () => {
    const stand = await standUp();
    stand.storage.values.set(COUNT_PASTED_KEY, JSON.stringify('on'));
    const editor = stand.editor(OPENING);
    editor.paste('Four pasted words here. ');
    await stand.pass(PAUSE);
    editor.cut('here. '.length);
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 4, manuscriptDeleted: 1 })]);
  });

  it('does not count a change that came from a sync while the note was open', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two. ');
    await stand.pass(PAUSE);

    // Another device added a paragraph; Obsidian puts the new text into the editor.
    editor.reload(`${editor.text}\nA whole paragraph that was written on the phone this morning.\n`);
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 2 })]);

    editor.type('Three. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3 })]);
  });

  it('does not count a change a program made that the editor\'s undo cannot reach', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two. ');
    editor.reload(`${editor.text}Ten words put in by a program, not by me.\n`, { keptOutOfUndo: true });
    editor.type('Three. ');
    await stand.pass(PAUSE);
    editor.reload('Almost everything is gone.\n', { keptOutOfUndo: true });
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3 })]);
  });

  it('keeps what was typed when a sync arrives in the middle of it', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    editor.reload(`${editor.text}\nTwenty words from elsewhere would be too many to type by hand so quickly, would they not, dear reader of tests.\n`);
    editor.type('Four. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 4 })]);
  });

  it('does not count what a sync changed while the note was closed', async () => {
    const stand = await standUp();
    const first = stand.editor(OPENING);
    first.type('One two. ');
    await stand.pass(PAUSE);

    // The note is closed, changes on another device, and is opened again: a new editor, a longer text.
    const grown = `${sceneBody('Opening')}\nA long passage arrived from the other device while this one slept.\n`;
    stand.vault.external.write(OPENING, { body: grown });
    const second = stand.editor(OPENING);
    second.type('Three. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3 })]);
  });

  it('is not confused by the same note open in two panes', async () => {
    const stand = await standUp();
    const left = stand.editor(OPENING);
    const right = stand.editor(OPENING);
    left.type('One two three. ');
    // Obsidian copies what was typed on the left into the pane on the right.
    right.reload(left.text);
    await stand.pass(PAUSE);
    right.type('Four five. ');
    left.reload(right.text);
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 5 })]);
  });
});

describe('notes and projects that move', () => {
  it('follows a scene that is renamed while it is being typed in', async () => {
    const stand = await standUp();
    const renamed = 'Novel/Manuscript/Prologue.md';
    stand.workspace.show(OPENING);
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    stand.vault.external.rename(OPENING, renamed);
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3 })]);

    stand.workspace.show(LETTER);
    await stand.rest();
    expect(stand.vault.frontmatterOf(renamed)).toMatchObject({ edited: DAY });
  });

  it('forgets a note that is deleted, without losing what was counted in it', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two. ');
    await stand.pass(PAUSE);
    editor.type('Three. '); // not counted yet when the note goes
    stand.vault.external.delete(OPENING);
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 2 })]);
    await stand.pass(60_000);
    expect(stand.clock.pending).toBe(0); // nothing is left waiting for the note
  });

  it('saves into the project\'s folder under its new name when the folder is renamed', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    await stand.pass(PAUSE); // counted for "Novel", not saved yet
    stand.vault.external.rename('Novel', 'Roman');
    await stand.rest();
    expect(stand.store.project?.folder).toBe('Roman');
    await stand.pass(QUIET);
    const path = `Roman/Stats/2026-10 ${stand.deviceId}.md`;
    expect(stand.vault.has(path)).toBe(true);
    expect(parseStatsFile(stand.vault.textOf(path)).days).toEqual([day(DAY, { manuscriptAdded: 3 })]);
    expect(stand.vault.hasFolder('Novel')).toBe(false);
  });

  it('keeps the words of a project that is not open until it is, and puts them in its own log', async () => {
    const stand = await standUp({
      prepare: (vault) => {
        seedProject(vault, { folder: 'Second', title: 'Second Book', scenes: { Start: 1024 } });
      },
    });
    stand.editor('Second/Manuscript/Start.md').type('One two three. ');
    stand.editor(OPENING).type('Four five. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    // The open project's words are saved; the other project's log cannot be written from here.
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 2 })]);
    expect(stand.vault.hasFolder('Second/Stats')).toBe(false);
    await stand.pass(60_000);
    expect(stand.clock.pending).toBe(0); // waiting for the project, not trying over and over

    expect((await stand.store.openProject('Second/Second.md')).status).toBe('done');
    await stand.pass(QUIET);
    const path = `Second/Stats/2026-10 ${stand.deviceId}.md`;
    expect(parseStatsFile(stand.vault.textOf(path)).days).toEqual([day(DAY, { manuscriptAdded: 3 })]);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 2 })]);
  });

  it('holds on to the texts of a few notes only, and still counts right in a note it let go of', async () => {
    const stand = await standUp();
    const first = stand.editor(OPENING);
    first.type('One. ');
    await stand.pass(PAUSE);
    for (let n = 0; n < MOST_WATCHED + 5; n++) {
      stand.editor(`Elsewhere/Note ${n}.md`, 'Some text.\n').type('Word. ');
    }
    await stand.pass(PAUSE);
    first.type('Two three. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3, otherAdded: MOST_WATCHED + 5 })]);
  });
});

describe('undo and redo', () => {
  it('takes back what an undo undoes, and puts it back on redo', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    await stand.pass(PAUSE);
    expect(stand.line()).toContain('Session 3');

    editor.undo();
    await stand.pass(PAUSE);
    expect(stand.line()).toContain('Session 0');
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toBeNull(); // nothing is left to save

    editor.redo();
    await stand.pass(PAUSE);
    expect(stand.line()).toContain('Session 3');
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3 })]);
  });

  it('takes words back out of the log when they were saved before the undo', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3 })]);

    editor.undo();
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([]); // the day is back to nothing
  });

  it('counts nothing when a paste is undone', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two. ');
    await stand.pass(PAUSE);
    editor.paste('Three pasted words. ');
    await stand.pass(PAUSE);
    editor.undo();
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 2 })]);
  });
});

describe('the days of the log', () => {
  it('splits the words of two days, and saves yesterday\'s at once when midnight passes', async () => {
    const stand = await standUp();
    stand.clock.date = '2026-10-31';
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    await stand.pass(PAUSE); // counted for the 31st, not saved yet

    stand.clock.date = '2026-11-01'; // midnight
    editor.type('Four five. ');
    await stand.pass(100); // no waiting for quiet: the day is over
    expect(stand.logDays('2026-10')).toEqual([day('2026-10-31', { manuscriptAdded: 3 })]);
    expect(stand.logDays('2026-11')).toBeNull();

    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day('2026-10-31', { manuscriptAdded: 3 })]);
    // A new month is a new file.
    expect(stand.logDays('2026-11')).toEqual([day('2026-11-01', { manuscriptAdded: 2 })]);
  });

  it('gives words typed just before midnight to the day they were typed on', async () => {
    const stand = await standUp();
    stand.clock.date = '2026-10-13';
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    await stand.pass(500);
    stand.clock.date = '2026-10-14'; // midnight passes before the typing was counted
    await stand.pass(PAUSE);
    expect(stand.logDays('2026-10')).toEqual([day('2026-10-13', { manuscriptAdded: 3 })]);

    editor.type('Four. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([
      day('2026-10-13', { manuscriptAdded: 3 }),
      day('2026-10-14', { manuscriptAdded: 1 }),
    ]);
  });

  it('adds to a day that is already in the file, and keeps the other days', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    editor.type('Three four five. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 5 })]);
    expect(stand.vault.writesTo(stand.logPath('2026-10'))).toHaveLength(2);
  });
});

describe('a save that fails', () => {
  it('is tried again, and puts every word in the file exactly once', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two three four. ');
    await stand.pass(PAUSE);

    stand.vault.failNext('updateText');
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toBeNull();
    expect(Notice.shown.map((notice) => notice.message)).toEqual([
      expect.stringContaining('could not be added to the word log yet'),
    ]);
    expect(stand.line()).toContain('Session 4'); // still counted

    // The writer goes on writing in the meantime.
    editor.type('Five six. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 6 })]);

    await stand.pass(60_000);
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 6 })]);
    expect(stand.vault.writesTo(stand.logPath('2026-10'))).toHaveLength(1);
    expect(Notice.shown).toHaveLength(1); // told once, not every few seconds
  });

  it('leaves a file alone that belongs to another device, says so, and keeps the words', async () => {
    const stand = await standUp();
    const path = stand.logPath('2026-10');
    const foreign = updateStatsText(null, { device: 'otherdevice', deviceName: 'Phone', month: '2026-10' }, [
      { date: '2026-10-02', counts: { manuscriptAdded: 50 } },
    ]);
    if (foreign.status !== 'write') throw new Error('could not make the other device\'s file');
    stand.vault.seedFolder('Novel/Stats');
    await stand.vault.updateText(path, () => foreign.text);
    stand.vault.clearWrites();

    const editor = stand.editor(OPENING);
    editor.type('One two. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.vault.textOf(path)).toBe(foreign.text);
    expect(stand.vault.writes).toEqual([]);
    expect(Notice.shown.map((notice) => notice.message)).toEqual([expect.stringContaining('belongs to another device')]);
    expect(stand.line()).toContain('Session 2');

    // Tried again later, less and less often, and never written over.
    await stand.pass(10 * 60_000);
    expect(stand.vault.textOf(path)).toBe(foreign.text);
    expect(Notice.shown).toHaveLength(1);
  });

  it('keeps words typed in a project that cannot be written to, and writes nothing', async () => {
    const stand = await standUp();
    stand.vault.external.corrupt(stand.indexPath); // the index cannot be read: the project is read-only
    await stand.rest();
    expect(stand.store.project?.readOnly).toBe(true);
    stand.editor(OPENING).type('One two. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    await stand.pass(60_000);
    expect(stand.vault.writes).toEqual([]);
    expect(stand.clock.pending).toBe(0); // and it does not keep trying
  });
});

describe('the dates of a scene', () => {
  it('writes "edited" when the writer leaves the scene, never while typing, and only those properties', async () => {
    const stand = await standUp();
    stand.vault.setCreatedDay(OPENING, '2026-09-01');
    stand.workspace.show(OPENING);
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    await stand.pass(60_000);
    expect(stand.vault.writesTo(OPENING)).toEqual([]); // however long the writer stays

    stand.workspace.show(LETTER);
    await stand.rest();
    expect(stand.vault.writesTo(OPENING)).toEqual([{ op: 'updateFrontmatter', path: OPENING }]);
    expect(stand.vault.frontmatterOf(OPENING)).toEqual({ status: 'To do', order: 1024, created: '2026-09-01', edited: DAY });
    expect(stand.vault.bodyOf(OPENING)).toBe(sceneBody('Opening')); // the text is the writer's
    expect(stand.vault.writesTo(LETTER)).toEqual([]); // only looked at, not typed in
  });

  it('writes a scene\'s date once a day, and never replaces a "created" that is there', async () => {
    const stand = await standUp();
    stand.vault.external.editFrontmatter(OPENING, (frontmatter) => {
      frontmatter['created'] = '2025-01-05';
    });
    stand.vault.setCreatedDay(OPENING, '2026-09-01');
    stand.vault.clearWrites();
    stand.workspace.show(OPENING);
    const editor = stand.editor(OPENING);

    editor.type('One. ');
    stand.workspace.show(LETTER);
    await stand.rest();
    stand.workspace.show(OPENING);
    editor.type('Two. ');
    stand.workspace.show(LETTER);
    await stand.rest();
    expect(stand.vault.writesTo(OPENING)).toHaveLength(1);
    expect(stand.vault.frontmatterOf(OPENING)).toMatchObject({ created: '2025-01-05', edited: DAY });

    // The next day it is written again.
    stand.clock.date = '2026-10-14';
    stand.workspace.show(OPENING);
    editor.type('Three. ');
    stand.workspace.show(null);
    await stand.rest();
    expect(stand.vault.writesTo(OPENING)).toHaveLength(2);
    expect(stand.vault.frontmatterOf(OPENING)).toMatchObject({ created: '2025-01-05', edited: '2026-10-14' });
  });

  it('writes it when the scene\'s tab is closed, and when the app goes to the background', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    stand.workspace.show(LETTER); // both open, The Letter in front
    stand.editor(LETTER).type('One. ');
    stand.workspace.trigger('layout-change'); // a sidebar opens: nothing was closed
    await stand.rest();
    expect(stand.vault.writesTo(LETTER)).toEqual([]);

    stand.workspace.closeTab(LETTER);
    await stand.rest();
    expect(stand.vault.frontmatterOf(LETTER)).toMatchObject({ edited: DAY });

    stand.editor(OPENING).type('Two. ');
    setHidden(true);
    await stand.rest();
    expect(stand.vault.frontmatterOf(OPENING)).toMatchObject({ edited: DAY });
    // Going to the background also saves the words at once: the app may not come back.
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 2 })]);
  });

  it('gives dates to scenes only: not to research, not to notes outside the project, not for a sync', async () => {
    const stand = await standUp();
    stand.workspace.show(CASTLE);
    stand.editor(CASTLE).type('One. ');
    stand.editor(DIARY).type('Two. ');
    const scene = stand.editor(OPENING);
    scene.reload(`${scene.text}\nFrom another device.\n`);
    stand.workspace.show(LETTER);
    await stand.rest();
    stand.workspace.show(null);
    await stand.rest();
    expect(stand.vault.writes.filter((write) => write.op === 'updateFrontmatter')).toEqual([]);
  });

  it('asks again the next time the writer leaves, when the date could not be written', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    stand.editor(OPENING).type('One. ');
    stand.vault.failNext('updateFrontmatter', OPENING);
    stand.workspace.show(LETTER);
    await stand.rest();
    expect(stand.vault.frontmatterOf(OPENING)).not.toHaveProperty('edited');

    stand.workspace.show(null);
    await stand.rest();
    expect(stand.vault.frontmatterOf(OPENING)).toMatchObject({ edited: DAY });
  });
});

describe('unloading', () => {
  it('saves what was typed and not yet counted, and the scene\'s date, before it lets go', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    const editor = stand.editor(OPENING);
    editor.type('One two three. '); // typed this very moment: not counted, not saved
    await stand.unload();
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3 })]);
    expect(stand.vault.frontmatterOf(OPENING)).toMatchObject({ edited: DAY });
  });

  it('lets a save that is under way end, then saves the rest, each word once', async () => {
    const stand = await standUp();
    const editor = stand.editor(OPENING);
    editor.type('One two. ');
    stand.clock.advance(PAUSE);
    stand.clock.advance(QUIET); // the save has started and has not ended
    editor.type('Three. ');
    await stand.unload();
    expect(stand.logDays('2026-10')).toEqual([day(DAY, { manuscriptAdded: 3 })]);
  });

  it('releases everything: the editor, the listeners, the timers, the bar, the services and the settings', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    const editor = stand.editor(OPENING);
    editor.type('One. ');
    await stand.pass(PAUSE);

    const registered = stand.plugin.editorExtensions[0] as unknown[];
    expect(registered).toHaveLength(1);
    expect(stand.workspace.listenerCount()).toBeGreaterThanOrEqual(3);
    expect(fakeDocument.listenerCount('visibilitychange')).toBe(1);
    expect(stand.bar()).not.toBeNull();
    const bar = stand.bar();
    expect(stand.features.settingsSections).toHaveLength(1);
    const line = stand.sceneLine();
    let told = 0;
    line.onChange(() => told++);
    stand.stats().onChange(() => told++);

    await stand.unload();
    expect(registered).toHaveLength(0); // the editor was told to let go of the plugin
    expect(stand.workspace.optionsUpdated).toBe(1);
    expect(stand.workspace.listenerCount()).toBe(0);
    expect(fakeDocument.listenerCount('visibilitychange')).toBe(0);
    expect(stand.clock.pending).toBe(0);
    expect(bar?.parent).toBeNull();
    expect(bar?.listenerCount()).toBe(0);
    expect(stand.features.settingsSections).toEqual([]);
    expect(stand.features.services.get('progress.sceneLine')).toBeUndefined();
    expect(stand.features.services.get('progress.stats')).toBeUndefined();

    // An editor that has not let go yet may still report: nothing happens any more.
    const writes = stand.vault.writes.length;
    editor.type('Two three four. ');
    stand.workspace.trigger('file-open', null);
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    expect(stand.vault.writes).toHaveLength(writes);
    expect(stand.clock.pending).toBe(0);
    expect(told).toBe(0);
    expect(line.current()).toEqual([]);
  });

  it('only ever writes this device\'s log files and the dates of scenes', async () => {
    const stand = await standUp();
    const bodies = new Map([OPENING, LETTER, CASTLE, DIARY].map((path) => [path, stand.vault.bodyOf(path)]));
    stand.workspace.show(OPENING);
    stand.editor(OPENING).type('One two. ');
    stand.editor(CASTLE).type('Three. ');
    stand.editor(DIARY).type('Four. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    stand.workspace.show(CASTLE);
    await stand.unload();
    expect(stand.vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/Stats' },
      { op: 'updateText', path: stand.logPath('2026-10') },
      { op: 'updateFrontmatter', path: OPENING },
    ]);
    // No note's text was touched: the editors here are stand-ins, the vault's notes are as they were.
    for (const [path, body] of bodies) expect(stand.vault.bodyOf(path), path).toBe(body);
  });
});

describe('where the editor cannot be watched', () => {
  it('stays off as a whole, and registers all the same', async () => {
    const stand = await standUp();
    const registered = registerFeatures([progressFeature], {
      plugin: { name: 'a plugin without a place in the editor' } as never,
      app: {} as never,
      store: stand.store,
      vault: stand.vault,
      storage: stand.storage,
      deviceId: () => stand.deviceId,
      clock: stand.clock,
      wordCounts: stand.wordCounts,
      openNote: async () => true,
    });
    expect(registered.ids).toEqual(['progress']);
    expect(registered.settingsSections).toEqual([]);
    expect(registered.services.get('progress.sceneLine')).toBeUndefined();
    registered.release();
  });
});
