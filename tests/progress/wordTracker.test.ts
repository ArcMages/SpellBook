import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/core/dates';
import {
  NO_WORDS,
  WordTracker,
  addToTotals,
  classifyNote,
  countsOn,
  parseStatsFile,
  statsFilePath,
  sumDeviceLogs,
  summariseWords,
  updateStatsText,
} from '../../src/core/progress';
import type { DayCounts, EditEvent, LogEntry, StatsIdentity } from '../../src/core/progress';
import { countWords } from '../../src/core/wordCount';
import { fixedRandom } from '../storeHarness';

const TODAY = '2026-10-13';
const TOMORROW = '2026-10-14';
const SCENE = 'Novel/Manuscript/Opening.md';
const HEBREW_SCENE = 'הרומן שלי/Manuscript/פרק ראשון.md';
const NOTES = 'Notes/Ideas.md';

interface World {
  date: string;
  time: number;
  folders: string[];
  active: string | null;
  countPasted: boolean;
}

/** A tracker with the clock, the projects and the setting under the test's control. */
function setup(start: Partial<World> = {}) {
  const world: World = { date: TODAY, time: 1_000_000, folders: ['Novel'], active: 'Novel', countPasted: false, ...start };
  const tracker = new WordTracker({
    clock: () => ({ date: world.date, time: world.time }),
    projects: () => ({ folders: world.folders, active: world.active }),
    countPasted: () => world.countPasted,
  });
  /** The unsaved numbers of one day of one project; zeros when there are none. */
  const day = (date: string = world.date, project = 'Novel'): DayCounts =>
    tracker.unwritten().find((entry) => entry.project === project && entry.date === date)?.counts ?? NO_WORDS;
  return { tracker, world, day };
}

const counts = (a: number, b = 0, c = 0, d = 0): DayCounts => ({
  manuscriptAdded: a,
  manuscriptDeleted: b,
  otherAdded: c,
  otherDeleted: d,
});

/** Take the last `count` words off a text. */
function withoutLastWords(text: string, count: number): string {
  const words = text.trim().split(/\s+/);
  return words.slice(0, Math.max(0, words.length - count)).join(' ');
}

/**
 * A note open in an editor, for tests: it holds the text, keeps an undo
 * history of one step per edit, and reports to the tracker the way the real
 * editor will. Words are counted with the plugin's own counter.
 */
class Page {
  text: string;
  private past: string[] = [];
  private future: string[] = [];

  constructor(
    private readonly tracker: WordTracker,
    readonly path: string,
    text = '',
    open = true,
  ) {
    this.text = text;
    if (open) tracker.measure(path, this.words);
  }

  get words(): number {
    return countWords(this.text);
  }

  private become(next: string): { wordsBefore: number; wordsAfter: number } {
    const wordsBefore = this.words;
    this.past.push(this.text);
    this.future = [];
    this.text = next;
    return { wordsBefore, wordsAfter: this.words };
  }

  /** Type at the end of the note. Nothing is measured until pause(). */
  type(more: string): void {
    this.become(this.text + more);
    this.tracker.edit({ path: this.path, kind: 'typed' });
  }

  /** Delete the last words with the keyboard. */
  erase(count: number): void {
    this.become(withoutLastWords(this.text, count));
    this.tracker.edit({ path: this.path, kind: 'typed' });
  }

  /** Typing has paused: the note is measured. */
  pause(): void {
    this.tracker.measure(this.path, this.words);
  }

  paste(more: string, extra: Partial<EditEvent> = {}): void {
    this.tracker.edit({ path: this.path, kind: 'paste', ...this.become(this.text + more), ...extra });
  }

  drop(more: string): void {
    this.tracker.edit({ path: this.path, kind: 'drop', ...this.become(this.text + more) });
  }

  cut(count: number, extra: Partial<EditEvent> = {}): void {
    this.tracker.edit({ path: this.path, kind: 'cut', ...this.become(withoutLastWords(this.text, count)), ...extra });
  }

  undo(extra: Partial<EditEvent> = {}): void {
    const earlier = this.past.pop();
    if (earlier === undefined) throw new Error('nothing to undo');
    const wordsBefore = this.words;
    this.future.push(this.text);
    this.text = earlier;
    this.tracker.edit({ path: this.path, kind: 'undo', wordsBefore, wordsAfter: this.words, ...extra });
  }

  redo(extra: Partial<EditEvent> = {}): void {
    const later = this.future.pop();
    if (later === undefined) throw new Error('nothing to redo');
    const wordsBefore = this.words;
    this.past.push(this.text);
    this.text = later;
    this.tracker.edit({ path: this.path, kind: 'redo', wordsBefore, wordsAfter: this.words, ...extra });
  }
}

const THREE_THOUSAND = Array.from({ length: 3000 }, (_, index) => `word${index}`).join(' ');

// ---------------------------------------------------------------------------

describe('the baseline', () => {
  it('counts nothing the first time a note is seen, however long it is', () => {
    const { tracker } = setup();
    const page = new Page(tracker, SCENE, THREE_THOUSAND);
    expect(page.words).toBe(3000);
    expect(tracker.unwritten()).toEqual([]);
    expect(tracker.session().net).toBe(0);
  });

  it('counts nothing for a note first seen with typing already in it', () => {
    const { tracker, day } = setup();
    // The note was never opened through the tracker: its first measurement comes after the typing.
    const page = new Page(tracker, SCENE, THREE_THOUSAND, false);
    page.type(' five more words right here');
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
    // From now on it has a baseline, and typing counts.
    page.type(' and three more');
    page.pause();
    expect(day()).toEqual(counts(3));
  });

  it('counts everything typed into a note that began empty', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, '');
    page.type('Once upon a time there was a letter.');
    page.pause();
    expect(day()).toEqual(counts(8));
  });
});

describe('typing', () => {
  it('adds typed words to "added"', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' She did not open it.');
    page.pause();
    expect(day()).toEqual(counts(5));
    page.type(' Not yet.');
    page.pause();
    expect(day()).toEqual(counts(7));
  });

  it('adds deleted words to "deleted"', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived on a grey and windy morning.');
    page.erase(4);
    page.pause();
    expect(day()).toEqual(counts(0, 4));
  });

  it('keeps added and deleted apart, so that the net is what typing really changed', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'one two three four five six');
    page.type(' seven eight nine ten');
    page.pause();
    page.erase(7);
    page.pause();
    page.type(' again');
    page.pause();
    expect(day()).toEqual(counts(5, 7));
    expect(summariseWords(day()).manuscript.net).toBe(page.words - 6);
  });

  it('counts one measurement as its net: words typed and deleted between two pauses cancel out', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'one two three');
    page.type(' four five six seven eight'); // five more
    page.erase(2); // two fewer, before any pause
    page.pause();
    expect(day()).toEqual(counts(3));
  });

  it('counts nothing for typing that changes no words', () => {
    const { tracker } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived');
    page.type('.');
    page.pause();
    page.type('!!');
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
  });

  it('counts Hebrew like English, with the same counter the screens use', () => {
    const { tracker, day } = setup({ folders: ['הרומן שלי'], active: 'הרומן שלי' });
    const page = new Page(tracker, HEBREW_SCENE, 'המכתב הגיע בבוקר.');
    page.type(' היא לא פתחה אותו, עדיין לא.');
    page.pause();
    expect(day(TODAY, 'הרומן שלי')).toEqual(counts(6));
    page.erase(2);
    page.pause();
    expect(day(TODAY, 'הרומן שלי')).toEqual(counts(6, 2));
    // Hebrew and English in one line.
    page.type(' She said שלום and left.');
    page.pause();
    expect(day(TODAY, 'הרומן שלי')).toEqual(counts(11, 2));
  });

  it('leaves properties and comments out, as the word counter does', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, '---\nsynopsis: היא פותחת את המכתב\nstatus: First draft\n---\nThe letter arrived.');
    page.type(' %% remember to check the date %%');
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
    page.type(' At last.');
    page.pause();
    expect(day()).toEqual(counts(2));
  });
});

describe('only typing on this device counts', () => {
  it('does not count words that arrive through sync', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    // Another device wrote two hundred words; this one only measures the note again.
    page.text += ` ${THREE_THOUSAND}`;
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
    // Typing after that counts from the new baseline.
    page.type(' Two more.');
    page.pause();
    expect(day()).toEqual(counts(2));
  });

  it('does not count words that vanish through sync either', () => {
    const { tracker } = setup();
    const page = new Page(tracker, SCENE, THREE_THOUSAND);
    page.text = 'Cut down on the other device.';
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
  });

  it('counts the typing and not the sync when both land between two pauses', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Four words typed here.');
    const wordsBefore = page.words;
    page.text += ` ${THREE_THOUSAND}`; // the sync, arriving through the editor
    tracker.edit({ path: SCENE, kind: 'external', wordsBefore, wordsAfter: page.words });
    page.type(' And two.');
    page.pause();
    expect(day()).toEqual(counts(6));
  });

  it('counts nothing rather than guess when an outside change comes without counts', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Four words typed here.');
    page.text += ` ${THREE_THOUSAND}`;
    tracker.edit({ path: SCENE, kind: 'external' }); // the note changed on disk; nobody counted it
    page.pause(); // sets a fresh baseline
    expect(tracker.unwritten()).toEqual([]);
    page.type(' And two.');
    page.pause();
    expect(day()).toEqual(counts(2));
  });

  it('does not count the undo of a sync that came in through the editor', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Three typed words.');
    page.pause();
    const wordsBefore = page.words;
    tracker.edit({ path: SCENE, kind: 'external', wordsBefore, wordsAfter: wordsBefore + 200 });
    // The writer presses undo: the editor takes the synced words out again, then the typing.
    tracker.edit({ path: SCENE, kind: 'undo', wordsBefore: wordsBefore + 200, wordsAfter: wordsBefore });
    expect(day()).toEqual(counts(3));
    tracker.edit({ path: SCENE, kind: 'undo', wordsBefore, wordsAfter: wordsBefore - 3 });
    expect(tracker.unwritten()).toEqual([]);
  });

  it('keeps undo working on typing when an outside change could not be undone', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Three typed words.');
    // Reported the careful way: measure first, then the change with only its new count.
    page.pause();
    page.text += ` ${THREE_THOUSAND}`;
    tracker.edit({ path: SCENE, kind: 'external', wordsAfter: page.words });
    expect(day()).toEqual(counts(3));
    tracker.edit({ path: SCENE, kind: 'undo', wordsBefore: page.words, wordsAfter: page.words - 3 });
    expect(tracker.unwritten()).toEqual([]);
  });

  it('takes a fresh baseline when a note is opened again after it changed elsewhere', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' One.');
    page.pause();
    // Closed; changed by sync while closed; opened again (measured on open), then typed in.
    page.text += ` ${THREE_THOUSAND}`;
    page.pause();
    page.type(' Two three.');
    page.pause();
    expect(day()).toEqual(counts(3));
  });
});

describe('pasting, dropping and cutting', () => {
  it('moves the baseline without counting', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.paste(' A whole paragraph brought in from another scene, twelve words long in all.');
    page.drop(' Three dropped words.');
    page.cut(5);
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
    expect(tracker.session().net).toBe(0);
    // Typing still counts afterwards.
    page.type(' Now typing.');
    page.pause();
    expect(day()).toEqual(counts(2));
  });

  it('still counts what was typed just before a paste, though it was not measured yet', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Typed four words here.');
    page.paste(' And these six were pasted in.');
    page.type(' Typed two.');
    page.pause();
    expect(day()).toEqual(counts(6));
  });

  it('counts pasted and cut text when the setting "count pasted text" is on', () => {
    const { tracker, day } = setup({ countPasted: true });
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.paste(' Six words pasted from a scan.');
    expect(day()).toEqual(counts(6));
    page.cut(2);
    expect(day()).toEqual(counts(6, 2));
    page.drop(' דף שלם שנגרר פנימה');
    expect(day()).toEqual(counts(10, 2));
  });

  it('follows the setting as it is at the moment of each paste', () => {
    const { tracker, world, day } = setup();
    const page = new Page(tracker, SCENE, 'Start.');
    page.paste(' not counted');
    world.countPasted = true;
    page.paste(' counted now');
    world.countPasted = false;
    page.paste(' not again');
    expect(day()).toEqual(counts(2));
  });

  it('counts nothing rather than guess when a paste comes without its counts', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Typed four words here.');
    page.text += ' Pasted text of unknown size.';
    tracker.edit({ path: SCENE, kind: 'paste' });
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
    page.type(' Two more.');
    page.pause();
    expect(day()).toEqual(counts(2));
  });
});

describe('undo and redo', () => {
  it('an undo of typing takes back what the typing counted; it is never "deleting"', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' She read it twice.');
    page.pause();
    expect(day()).toEqual(counts(4));
    page.undo();
    expect(tracker.unwritten()).toEqual([]);
    expect(day()).toEqual(counts(0, 0));
    expect(tracker.session()).toEqual({ added: 0, deleted: 0, net: 0, manuscriptNet: 0, otherNet: 0 });
  });

  it('a redo puts it back; it is never "writing" twice', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' She read it twice.');
    page.pause();
    page.undo();
    page.redo();
    expect(day()).toEqual(counts(4));
    page.undo();
    page.redo();
    page.undo();
    page.redo();
    expect(day()).toEqual(counts(4));
  });

  it('an undo of a deletion takes back the "deleted"; it is never "writing"', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived on a grey and windy morning.');
    page.erase(5);
    page.pause();
    expect(day()).toEqual(counts(0, 5));
    page.undo();
    expect(tracker.unwritten()).toEqual([]);
    page.redo();
    expect(day()).toEqual(counts(0, 5));
  });

  it('select all, delete, undo: nothing was written and nothing was deleted', () => {
    const { tracker } = setup();
    const page = new Page(tracker, SCENE, THREE_THOUSAND);
    page.erase(3000);
    page.pause();
    expect(tracker.unwritten()[0]?.counts).toEqual(counts(0, 3000));
    page.undo();
    expect(tracker.unwritten()).toEqual([]);
    expect(tracker.session().net).toBe(0);
  });

  it('works without a pause between the typing and the undo', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Four words typed fast.');
    page.undo(); // before any measurement
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
    page.redo();
    page.pause();
    expect(day()).toEqual(counts(4));
  });

  it('an undo or redo of a paste counts nothing, in either direction', () => {
    const { tracker } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.paste(' A pasted paragraph of six words.');
    page.undo();
    expect(tracker.unwritten()).toEqual([]);
    page.redo();
    expect(tracker.unwritten()).toEqual([]);
    page.cut(4);
    page.undo();
    page.redo();
    page.undo();
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
    expect(tracker.session().net).toBe(0);
  });

  it('tells typing from pasting on the way back, step by step', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'Start.');
    page.type(' typed one two three'); // 4 typed
    page.pause();
    page.paste(' pasted alpha beta gamma delta'); // 5 pasted
    page.type(' typed again'); // 2 typed
    page.pause();
    page.erase(3); // 3 deleted with the keyboard
    page.pause();
    expect(day()).toEqual(counts(6, 3));

    page.undo(); // the deletion
    expect(day()).toEqual(counts(6, 0));
    page.undo(); // "typed again"
    expect(day()).toEqual(counts(4, 0));
    page.undo(); // the paste: counts nothing
    expect(day()).toEqual(counts(4, 0));
    page.undo(); // the first typing
    expect(tracker.unwritten()).toEqual([]);

    page.redo();
    expect(day()).toEqual(counts(4, 0));
    page.redo(); // the paste again: counts nothing
    expect(day()).toEqual(counts(4, 0));
    page.redo();
    expect(day()).toEqual(counts(6, 0));
    page.redo();
    expect(day()).toEqual(counts(6, 3));
    expect(tracker.session().net).toBe(3);
  });

  it('shows the other half of a measurement when only half of it is undone', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'one two three four five');
    page.type(' a b c d e f g h'); // 8 typed
    page.erase(3); // 3 deleted, before any pause
    page.pause();
    expect(day()).toEqual(counts(5)); // counted as its net
    page.undo(); // the deletion comes back
    expect(day()).toEqual(counts(8, 0)); // the truth: eight typed, nothing deleted
    page.undo(); // the typing goes
    expect(tracker.unwritten()).toEqual([]);
    page.redo();
    page.redo();
    expect(day()).toEqual(counts(5));
  });

  it('takes typing back from a row that was already saved', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' She read it twice.');
    page.pause();
    tracker.markWritten(tracker.unwritten()); // the four words are in the log file now
    expect(tracker.unwritten()).toEqual([]);
    page.undo();
    // A negative number waits to be saved: it takes the four words back out of the file.
    expect(day()).toEqual(counts(-4));
    const disk = updateStatsText(null, { device: 'desk', deviceName: 'Desk', month: '2026-10' }, [{ date: TODAY, counts: counts(4) }]);
    const after = updateStatsText(disk.status === 'write' ? disk.text : null, { device: 'desk', deviceName: 'Desk', month: '2026-10' }, tracker.unwritten());
    expect(after.status === 'write' && after.file.days).toEqual([]);
  });

  it('takes an undo after midnight back from the day the words were counted on', () => {
    const { tracker, world, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Four words before midnight.');
    page.pause();
    world.date = TOMORROW;
    world.time += 3600000;
    page.type(' Two after.');
    page.pause();
    expect(day(TODAY)).toEqual(counts(4));
    expect(day(TOMORROW)).toEqual(counts(2));
    page.undo();
    expect(day(TOMORROW)).toEqual(NO_WORDS);
    page.undo();
    expect(day(TODAY)).toEqual(NO_WORDS);
    page.redo();
    page.redo();
    expect(day(TODAY)).toEqual(counts(4));
    expect(day(TOMORROW)).toEqual(counts(2));
  });

  it('with "count pasted text" on, the undo of a paste takes the count back', () => {
    const { tracker, day } = setup({ countPasted: true });
    const page = new Page(tracker, SCENE, 'Start.');
    page.paste(' Six words pasted from a scan.');
    expect(day()).toEqual(counts(6));
    page.undo({ of: 'move' }); // even when the editor calls it a move
    expect(tracker.unwritten()).toEqual([]);
    page.redo({ of: 'move' });
    expect(day()).toEqual(counts(6));
  });

  it('does not count an undo in a note nothing was typed in: it reaches back before the tracker began', () => {
    const { tracker } = setup();
    const page = new Page(tracker, SCENE, THREE_THOUSAND);
    // The editor still remembers edits from before the plugin was loaded.
    const wordsBefore = page.words;
    tracker.edit({ path: SCENE, kind: 'undo', wordsBefore, wordsAfter: wordsBefore - 40 });
    tracker.edit({ path: SCENE, kind: 'undo', wordsBefore: wordsBefore - 40, wordsAfter: wordsBefore - 10, of: 'typing' });
    tracker.edit({ path: SCENE, kind: 'redo', wordsBefore: wordsBefore - 10, wordsAfter: wordsBefore - 40 });
    tracker.edit({ path: SCENE, kind: 'redo', wordsBefore: wordsBefore - 40, wordsAfter: wordsBefore });
    expect(tracker.unwritten()).toEqual([]);
  });

  it('does not count a redo whose undo it never saw', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'Start.');
    page.type(' one two');
    page.pause();
    tracker.edit({ path: SCENE, kind: 'redo', wordsBefore: page.words, wordsAfter: page.words + 9 });
    expect(day()).toEqual(counts(2));
  });

  it('counts nothing rather than guess when an undo comes without its counts', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'Start.');
    page.type(' one two three');
    page.pause();
    tracker.edit({ path: SCENE, kind: 'undo' });
    page.text = 'Start.';
    page.pause();
    // The three words stay counted (nothing can be proved), and no deletion appears.
    expect(day()).toEqual(counts(3));
    // After that the history is unknown, so further undos count nothing either.
    tracker.edit({ path: SCENE, kind: 'undo', wordsBefore: 1, wordsAfter: 0 });
    expect(day()).toEqual(counts(3));
  });

  it('is not fooled by typing that changes exactly as many words as an earlier paste', () => {
    // One word pasted; then one word deleted and one typed by hand. The undo of
    // the typed word removes one word: just what the undo of the paste would do.
    const build = (): { page: Page; tracker: WordTracker; day: () => DayCounts } => {
      const { tracker, day } = setup();
      const page = new Page(tracker, SCENE, 'one two three');
      page.paste(' pasted', { chars: { inserted: 7, removed: 0 } });
      page.erase(1);
      page.pause();
      page.type(' typed');
      page.pause();
      return { page, tracker, day };
    };

    // Told nothing: typing is still standing above the paste, so it cannot be the paste's turn.
    const silent = build();
    expect(silent.day()).toEqual(counts(1, 1));
    silent.page.undo();
    expect(silent.day()).toEqual(counts(0, 1));
    silent.page.undo(); // the deletion
    silent.page.undo(); // and only now the paste
    expect(silent.tracker.unwritten()).toEqual([]);

    // Told what the undo is.
    const told = build();
    told.page.undo({ of: 'typing' });
    expect(told.day()).toEqual(counts(0, 1));

    // Told its size: six characters went, not the seven that were pasted.
    const sized = build();
    sized.page.undo({ chars: { inserted: 0, removed: 6 } });
    expect(sized.day()).toEqual(counts(0, 1));
  });

  it('clears up after one step of the editor that was measured in two halves', () => {
    // The writer pastes three words, then selects two words and types five over
    // them: one step for the editor's undo, but measured once in the middle.
    const build = (): { tracker: WordTracker; day: () => DayCounts } => {
      const { tracker, day } = setup();
      tracker.measure(SCENE, 3);
      tracker.edit({ path: SCENE, kind: 'paste', wordsBefore: 3, wordsAfter: 6, chars: { inserted: 18, removed: 0 } });
      tracker.edit({ path: SCENE, kind: 'typed', wordsBefore: 6, wordsAfter: 4 }); // the selection goes
      tracker.edit({ path: SCENE, kind: 'typed', wordsBefore: 4, wordsAfter: 9 }); // five words typed
      return { tracker, day };
    };

    const told = build();
    expect(told.day()).toEqual(counts(5, 2));
    told.tracker.edit({ path: SCENE, kind: 'undo', wordsBefore: 9, wordsAfter: 6, of: 'typing' });
    expect(summariseWords(told.day()).manuscript.net).toBe(0);
    told.tracker.edit({ path: SCENE, kind: 'undo', wordsBefore: 6, wordsAfter: 3, of: 'move' });
    expect(told.tracker.unwritten()).toEqual([]);

    const sized = build();
    sized.tracker.edit({ path: SCENE, kind: 'undo', wordsBefore: 9, wordsAfter: 6, chars: { inserted: 9, removed: 24 } });
    sized.tracker.edit({ path: SCENE, kind: 'undo', wordsBefore: 6, wordsAfter: 3, chars: { inserted: 0, removed: 18 } });
    expect(sized.tracker.unwritten()).toEqual([]);
  });

  it('forgets the redo history when the writer types something new, as the editor does', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'Start.');
    page.type(' one two three');
    page.pause();
    page.undo();
    page.type(' four');
    page.pause();
    expect(day()).toEqual(counts(1));
    // A stray redo report now has no undo to pair with.
    tracker.edit({ path: SCENE, kind: 'redo', wordsBefore: page.words, wordsAfter: page.words + 3 });
    expect(day()).toEqual(counts(1));
  });
});

describe('the date a change is credited to', () => {
  it('is the local date at the moment of typing, so a session across midnight splits in two', () => {
    const { tracker, world, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Four words before midnight.');
    page.pause();
    world.date = TOMORROW;
    world.time += 60000;
    page.type(' And three after.');
    page.pause();
    expect(tracker.unwritten()).toEqual([
      { project: 'Novel', date: TODAY, counts: counts(4) },
      { project: 'Novel', date: TOMORROW, counts: counts(3) },
    ]);
  });

  it('is the date of the typing, not of the measurement: words typed at 23:59 belong to that day', () => {
    const { tracker, world, day } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Typed just before midnight.');
    // The phone slept; the measurement happens the next morning.
    world.date = TOMORROW;
    world.time += 8 * 3600000;
    page.pause();
    expect(day(TODAY)).toEqual(counts(4));
    expect(day(TOMORROW)).toEqual(NO_WORDS);
  });

  it('asks for yesterday\'s typing to be measured and saved at once after midnight', () => {
    const { tracker, world } = setup();
    const page = new Page(tracker, SCENE, 'The letter arrived.');
    page.type(' Typed just before midnight.');
    world.date = TOMORROW;
    world.time += 500; // not even two seconds later
    expect(tracker.plan()).toMatchObject({ measure: [SCENE], write: true });
    page.pause();
    expect(tracker.plan()).toMatchObject({ measure: [], write: true });
  });
});

describe('classifyNote', () => {
  const projects = { folders: ['Novel', 'כתיבה/הרומן שלי'], active: 'Novel' };

  it('counts a note under a Manuscript folder as manuscript of that project, whichever project is open', () => {
    expect(classifyNote('Novel/Manuscript/Opening.md', projects)).toEqual({ project: 'Novel', bucket: 'manuscript' });
    expect(classifyNote('Novel/Manuscript/Part one/Deep/Scene.md', projects)).toEqual({ project: 'Novel', bucket: 'manuscript' });
    expect(classifyNote('כתיבה/הרומן שלי/Manuscript/פרק ראשון.md', projects)).toEqual({ project: 'כתיבה/הרומן שלי', bucket: 'manuscript' });
    expect(classifyNote('כתיבה/הרומן שלי/Manuscript/פרק ראשון.md', { ...projects, active: null })).toEqual({
      project: 'כתיבה/הרומן שלי',
      bucket: 'manuscript',
    });
  });

  it('counts every other note as "other" of the open project', () => {
    for (const path of ['Notes/Ideas.md', 'Novel/Research/Paris.md', 'Novel/To-do.md', 'Novel/Novel.md', 'Novel/Timeline/Arrival.md', 'כתיבה/הרומן שלי/Research/מחקר.md', 'יומן.md']) {
      expect(classifyNote(path, projects), path).toEqual({ project: 'Novel', bucket: 'other' });
    }
  });

  it('drops a note outside every manuscript when no project is open', () => {
    expect(classifyNote('Notes/Ideas.md', { ...projects, active: null })).toBeNull();
    expect(classifyNote('Novel/Research/Paris.md', { ...projects, active: null })).toBeNull();
  });

  it('never counts the daily logs themselves, or files that are not notes', () => {
    expect(classifyNote('Novel/Stats/2026-10 k3x9q2ab.md', projects)).toBeNull();
    expect(classifyNote('כתיבה/הרומן שלי/Stats/2026-10 k3x9q2ab.md', projects)).toBeNull();
    expect(classifyNote('Novel/Manuscript/cover.png', projects)).toBeNull();
    expect(classifyNote('Novel/Manuscript/Opening', projects)).toBeNull();
  });

  it('is not fooled by a folder whose name only begins like "Manuscript", or by a file called Manuscript', () => {
    expect(classifyNote('Novel/Manuscripts/Old.md', projects)).toEqual({ project: 'Novel', bucket: 'other' });
    expect(classifyNote('Novel/Manuscript.md', projects)).toEqual({ project: 'Novel', bucket: 'other' });
    expect(classifyNote('Novella/Manuscript/Scene.md', projects)).toEqual({ project: 'Novel', bucket: 'other' });
  });

  it('knows a project at the top of the vault, and the nearest of two nested projects', () => {
    expect(classifyNote('Manuscript/Opening.md', { folders: [''], active: null })).toEqual({ project: '', bucket: 'manuscript' });
    expect(classifyNote('Research/Paris.md', { folders: [''], active: '' })).toEqual({ project: '', bucket: 'other' });
    const nested = { folders: ['Saga', 'Saga/Manuscript/Book two'], active: 'Saga' };
    expect(classifyNote('Saga/Manuscript/Book two/Manuscript/Scene.md', nested)).toEqual({ project: 'Saga/Manuscript/Book two', bucket: 'manuscript' });
    expect(classifyNote('Saga/Manuscript/Book one.md', nested)).toEqual({ project: 'Saga', bucket: 'manuscript' });
  });

  it('knows a path however its letters are stored', () => {
    // A name with an accent, and a Hebrew name with points, as typed and as a disk may store them.
    const folder = 'Café/שָׁלום';
    const asStored = { folders: [folder.normalize('NFD')], active: null };
    expect(folder.normalize('NFC')).not.toBe(folder.normalize('NFD'));
    expect(classifyNote(`${folder.normalize('NFC')}/Manuscript/Scene.md`, asStored)).toEqual({ project: folder.normalize('NFD'), bucket: 'manuscript' });
  });
});

describe('where the words go', () => {
  it('credits manuscript words to the project that owns the scene, and other words to the open project', () => {
    const { tracker } = setup({ folders: ['Novel', 'הרומן שלי'], active: 'Novel' });
    const hebrew = new Page(tracker, HEBREW_SCENE, 'פתיחה.');
    const notes = new Page(tracker, NOTES, 'Ideas.');
    hebrew.type(' שלוש מילים חדשות');
    notes.type(' Two more.');
    notes.erase(1);
    hebrew.pause();
    notes.pause();
    expect(tracker.unwritten()).toEqual([
      { project: 'Novel', date: TODAY, counts: counts(0, 0, 1, 0) },
      { project: 'הרומן שלי', date: TODAY, counts: counts(3) },
    ]);
  });

  it('drops words typed outside every manuscript while no project is open, for good', () => {
    const { tracker, world, day } = setup({ active: null });
    const notes = new Page(tracker, NOTES, 'Ideas.');
    notes.type(' Five words nobody is counting.');
    notes.pause();
    expect(tracker.unwritten()).toEqual([]);
    expect(tracker.session().net).toBe(0);
    // Opening a project later does not bring them back.
    world.active = 'Novel';
    notes.type(' Two more.');
    notes.pause();
    expect(day()).toEqual(counts(0, 0, 2, 0));
    // And undoing the dropped words takes nothing away from the counted ones.
    notes.undo();
    notes.undo();
    expect(tracker.unwritten()).toEqual([]);
  });

  it('decides by where the note is when it is measured', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, 'Novel/Research/Draft.md', 'Draft.');
    page.type(' one two');
    page.pause();
    tracker.renamed('Novel/Research/Draft.md', 'Novel/Manuscript/Draft.md');
    const moved = new Page(tracker, 'Novel/Manuscript/Draft.md', page.text, false);
    moved.type(' three four five');
    moved.pause();
    expect(day()).toEqual(counts(3, 0, 2, 0));
  });
});

describe('the session counter', () => {
  it('is the net of words typed since the tracker was made', () => {
    const { tracker } = setup();
    const scene = new Page(tracker, SCENE, 'The letter arrived.');
    const notes = new Page(tracker, NOTES, 'Ideas.');
    scene.type(' one two three four five');
    scene.pause();
    scene.erase(2);
    scene.pause();
    notes.type(' six seven');
    notes.pause();
    expect(tracker.session()).toEqual({ added: 7, deleted: 2, net: 5, manuscriptNet: 3, otherNet: 2 });
  });

  it('is not moved by pasting, by sync, or by saving the log', () => {
    const { tracker } = setup();
    const scene = new Page(tracker, SCENE, 'The letter arrived.');
    scene.type(' one two three');
    scene.pause();
    scene.paste(' four five six seven');
    scene.text += ' eight nine';
    scene.pause();
    tracker.markWritten(tracker.unwritten());
    expect(tracker.session().net).toBe(3);
  });

  it('goes down with an undo and up again with a redo', () => {
    const { tracker } = setup();
    const scene = new Page(tracker, SCENE, 'The letter arrived.');
    scene.type(' one two three');
    scene.pause();
    scene.undo();
    expect(tracker.session().net).toBe(0);
    scene.redo();
    expect(tracker.session().net).toBe(3);
  });

  it('can be asked for one project', () => {
    const { tracker } = setup({ folders: ['Novel', 'הרומן שלי'], active: 'Novel' });
    const english = new Page(tracker, SCENE, '');
    const hebrew = new Page(tracker, HEBREW_SCENE, '');
    english.type('one two');
    hebrew.type('אחת שתיים שלוש');
    english.pause();
    hebrew.pause();
    expect(tracker.session('Novel').net).toBe(2);
    expect(tracker.session('הרומן שלי').net).toBe(3);
    expect(tracker.session().net).toBe(5);
    expect(tracker.session('Nowhere').net).toBe(0);
  });

  it('can go below zero on an evening of cutting', () => {
    const { tracker } = setup();
    const scene = new Page(tracker, SCENE, THREE_THOUSAND);
    scene.erase(120);
    scene.pause();
    expect(tracker.session()).toMatchObject({ added: 0, deleted: 120, net: -120 });
  });
});

describe('handing the words over to the log', () => {
  const DESK: StatsIdentity = { device: 'desk', deviceName: 'המחשב של דנה', month: '2026-10' };

  it('lists what is not saved yet, by project and day', () => {
    const { tracker, world } = setup({ folders: ['Novel', 'Another'], active: 'Novel' });
    const a = new Page(tracker, 'Novel/Manuscript/A.md', '');
    const b = new Page(tracker, 'Another/Manuscript/B.md', '');
    a.type('one');
    a.pause();
    world.date = TOMORROW;
    b.type('one two');
    a.type(' two three');
    a.pause();
    b.pause();
    expect(tracker.unwritten()).toEqual([
      { project: 'Another', date: TOMORROW, counts: counts(2) },
      { project: 'Novel', date: TODAY, counts: counts(1) },
      { project: 'Novel', date: TOMORROW, counts: counts(2) },
    ]);
  });

  it('keeps words that were counted while a save was under way', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, '');
    page.type('one two three');
    page.pause();
    const saving = tracker.unwritten(); // the save starts with these...
    page.type(' four five');
    page.pause(); // ...and two more words are counted before it ends
    tracker.markWritten(saving);
    expect(day()).toEqual(counts(2));
    tracker.markWritten(tracker.unwritten());
    expect(tracker.unwritten()).toEqual([]);
  });

  it('loses nothing when a save fails: the same words are offered again', () => {
    const { tracker, world } = setup();
    const page = new Page(tracker, SCENE, '');
    page.type('one two three');
    page.pause();
    world.time += 8000;
    expect(tracker.plan().write).toBe(true);
    const offered = tracker.unwritten();
    tracker.writeFailed();
    expect(tracker.unwritten()).toEqual(offered);
    // No hammering: the next try waits.
    expect(tracker.plan()).toEqual({ measure: [], write: false, wait: 8000 });
    world.time += 8000;
    expect(tracker.plan().write).toBe(true);
    tracker.markWritten(tracker.unwritten());
    expect(tracker.plan()).toEqual({ measure: [], write: false, wait: null });
  });

  it('tells the editor side when to measure and when to save', () => {
    const { tracker, world } = setup();
    const page = new Page(tracker, SCENE, '');
    expect(tracker.plan()).toEqual({ measure: [], write: false, wait: null });

    page.type('one two three');
    expect(tracker.plan()).toEqual({ measure: [], write: false, wait: 2000 });
    world.time += 1500;
    page.type(' four'); // still typing: the two seconds start again
    expect(tracker.plan()).toEqual({ measure: [], write: false, wait: 2000 });
    world.time += 2000;
    expect(tracker.plan()).toMatchObject({ measure: [SCENE], write: false });

    page.pause();
    expect(tracker.plan()).toEqual({ measure: [], write: false, wait: 8000 });
    world.time += 7999;
    expect(tracker.plan()).toEqual({ measure: [], write: false, wait: 1 });
    world.time += 1;
    expect(tracker.plan()).toEqual({ measure: [], write: true, wait: null });

    tracker.markWritten(tracker.unwritten());
    expect(tracker.plan()).toEqual({ measure: [], write: false, wait: null });
  });

  it('never leaves a busy writer unsaved for longer than two minutes', () => {
    const { tracker, world } = setup();
    const page = new Page(tracker, SCENE, '');
    let saved = false;
    // A key every second, for three minutes: never a pause of two seconds.
    for (let second = 0; second < 180 && !saved; second++) {
      page.type(' word');
      const plan = tracker.plan();
      for (const path of plan.measure) if (path === SCENE) page.pause();
      if (plan.write) {
        expect(world.time - 1_000_000).toBe(120000);
        expect(tracker.unwritten()[0]?.counts.manuscriptAdded).toBe(121);
        saved = true;
      }
      world.time += 1000;
    }
    expect(saved).toBe(true);
  });

  it('measures and saves everything at once when the plugin unloads', () => {
    const { tracker, day } = setup();
    const scene = new Page(tracker, SCENE, '');
    const notes = new Page(tracker, NOTES, '');
    scene.type('one two three');
    notes.type('four');
    const plan = tracker.plan(true);
    expect(plan).toEqual({ measure: [SCENE, NOTES], write: true, wait: null });
    scene.pause();
    notes.pause();
    expect(day()).toEqual(counts(3, 0, 1, 0));
  });

  it('goes all the way into the log files and back out as totals', () => {
    const { tracker, world } = setup({ folders: ['הרומן שלי'], active: 'הרומן שלי' });
    const vault = new Map<string, string>();
    const save = (): void => {
      const entries = tracker.unwritten();
      const byFile = new Map<string, LogEntry[]>();
      for (const entry of entries) {
        const path = statsFilePath(entry.project, entry.date, DESK.device) as string;
        byFile.set(path, [...(byFile.get(path) ?? []), entry]);
      }
      for (const [path, list] of byFile) {
        const month = (list[0] as LogEntry).date.slice(0, 7);
        const update = updateStatsText(vault.get(path) ?? null, { ...DESK, month }, list);
        if (update.status === 'write') vault.set(path, update.text);
        expect(update.status).not.toBe('refused');
      }
      tracker.markWritten(entries);
    };

    const scene = new Page(tracker, HEBREW_SCENE, '');
    const notes = new Page(tracker, 'הרומן שלי/Research/מחקר.md', '');
    scene.type('המכתב הגיע בבוקר אפור וסוער.');
    scene.pause();
    save();
    notes.type('שתי מילים');
    notes.pause();
    scene.erase(2);
    scene.pause();
    save();
    world.date = '2026-10-31';
    scene.type(' עוד שלוש מילים');
    scene.pause();
    world.date = '2026-11-01';
    scene.type(' ועוד אחת');
    scene.pause();
    save();

    expect([...vault.keys()].sort()).toEqual(['הרומן שלי/Stats/2026-10 desk.md', 'הרומן שלי/Stats/2026-11 desk.md']);
    const october = vault.get('הרומן שלי/Stats/2026-10 desk.md') as string;
    expect(october).toContain('deviceName: "המחשב של דנה"');
    // Five words typed in the scene, two of them deleted again, and two words in a research note.
    expect(october).toContain(`| ${TODAY} | 5 | 2 | 2 | 0 |`);
    expect(october).toContain('| 2026-10-31 | 3 | 0 | 0 | 0 |');

    const totals = sumDeviceLogs([...vault].map(([path, text]) => parseStatsFile(text, path)));
    expect(countsOn(totals, TODAY)).toEqual(counts(5, 2, 2, 0));
    expect(countsOn(totals, '2026-11-01')).toEqual(counts(2));
    expect(summariseWords(countsOn(totals, TODAY)).all.net).toBe(5);

    // What is counted but not saved yet shows up on screen all the same.
    scene.type(' מילה');
    scene.pause();
    const shown = addToTotals(totals, tracker.unwritten().filter((entry) => entry.project === 'הרומן שלי'));
    expect(countsOn(shown, '2026-11-01')).toEqual(counts(3));
  });
});

describe('housekeeping', () => {
  it('follows a note that is renamed', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'one two three');
    page.type(' four five');
    tracker.renamed(SCENE, 'Novel/Manuscript/פתיחה.md');
    tracker.measure('Novel/Manuscript/פתיחה.md', page.words);
    expect(day()).toEqual(counts(2));
    // The old path is unknown again: its next measurement is a first sight.
    tracker.edit({ path: SCENE, kind: 'typed' });
    tracker.measure(SCENE, 500);
    expect(day()).toEqual(counts(2));
  });

  it('keeps the words of a note that is deleted: deleting a note does not unwrite them', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, '');
    page.type('one two three');
    page.pause();
    tracker.removed(SCENE);
    expect(day()).toEqual(counts(3));
    expect(tracker.session().net).toBe(3);
    // A new note at the same path starts from scratch.
    tracker.measure(SCENE, 40);
    expect(day()).toEqual(counts(3));
  });

  it('follows a project folder that is renamed', () => {
    const { tracker, world } = setup();
    const page = new Page(tracker, SCENE, '');
    page.type('one two three');
    page.pause();
    tracker.projectMoved('Novel', 'הרומן');
    world.folders = ['הרומן'];
    world.active = 'הרומן';
    tracker.renamed(SCENE, 'הרומן/Manuscript/Opening.md');
    expect(tracker.unwritten()).toEqual([{ project: 'הרומן', date: TODAY, counts: counts(3) }]);
    expect(tracker.session('הרומן').net).toBe(3);
    expect(tracker.session('Novel').net).toBe(0);
    // An undo still finds the words under the new name.
    tracker.edit({ path: 'הרומן/Manuscript/Opening.md', kind: 'undo', wordsBefore: 3, wordsAfter: 0 });
    expect(tracker.unwritten()).toEqual([]);
  });

  it('ignores word counts that are not numbers, and reads a negative one as zero', () => {
    const { tracker, day } = setup();
    const page = new Page(tracker, SCENE, 'one two three');
    page.type(' four');
    tracker.measure(SCENE, Number.NaN);
    tracker.measure(SCENE, Number.POSITIVE_INFINITY);
    expect(tracker.unwritten()).toEqual([]);
    page.pause();
    expect(day()).toEqual(counts(1));
    tracker.edit({ path: SCENE, kind: 'typed' });
    tracker.measure(SCENE, -50);
    expect(day()).toEqual(counts(1, 4));
  });

  it('copes with a clock that gives a date that is not a real date', () => {
    const { tracker, world } = setup({ date: 'now' });
    const page = new Page(tracker, SCENE, '');
    page.type('one two');
    page.pause();
    expect(tracker.unwritten()).toEqual([]);
    world.date = TODAY;
    page.type(' three');
    page.pause();
    expect(tracker.unwritten()).toEqual([{ project: 'Novel', date: TODAY, counts: counts(1) }]);
  });
});

// ---------------------------------------------------------------------------
// A long random session, checked against a model of what really happened.

interface Step {
  kind: 'typed' | 'moved';
  /** Words this step put in (or, negative, took out). */
  net: number;
  /** Its size in characters: different for every step. */
  size: number;
}

/** What the editor tells the tracker about an undo or redo: what it is, how large it is, or nothing. */
type Telling = 'says' | 'sizes' | 'silent';

function simulate(seed: number, telling: Telling, options: { lazy: boolean; countPasted: boolean; steps: number }): void {
  const random = fixedRandom(seed);
  const pick = (below: number): number => Math.floor(random() * below);
  const { tracker, world } = setup({ countPasted: options.countPasted });

  let words = 200 + pick(300);
  const past: Step[] = [];
  let future: Step[] = [];
  let nextSize = 1;
  tracker.measure(SCENE, words);

  const counted = (step: Step): boolean => step.kind === 'typed' || options.countPasted;
  const charsOf = (step: Step, reversed: boolean): EditEvent['chars'] => {
    const putsIn = step.net > 0 !== reversed;
    return putsIn ? { inserted: step.size, removed: 0 } : { inserted: 0, removed: step.size };
  };
  const extra = (step: Step, reversed: boolean): Partial<EditEvent> => {
    if (telling === 'says') return { of: step.kind === 'typed' ? 'typing' : 'move' };
    return telling === 'sizes' ? { chars: charsOf(step, reversed) } : {};
  };
  let undos = 0;
  let redos = 0;

  for (let i = 0; i < options.steps; i++) {
    const roll = pick(100);
    let settled = true;
    if (roll < 28 || roll >= 99) {
      // Type some words, or (less often) delete some.
      const deleting = roll < 10 || roll >= 99;
      const amount = deleting ? Math.min(words, 1 + pick(6)) : 1 + pick(6);
      if (amount === 0) continue;
      const step: Step = { kind: 'typed', net: deleting ? -amount : amount, size: nextSize++ };
      words += step.net;
      past.push(step);
      future = [];
      tracker.edit({ path: SCENE, kind: 'typed' });
      if (options.lazy) settled = false;
      else tracker.measure(SCENE, words);
    } else if (roll < 42) {
      // Paste, or cut.
      const cutting = roll < 33;
      const amount = cutting ? Math.min(words, 1 + pick(30)) : 1 + pick(30);
      if (amount === 0) continue;
      const step: Step = { kind: 'moved', net: cutting ? -amount : amount, size: nextSize++ };
      const wordsBefore = words;
      words += step.net;
      past.push(step);
      future = [];
      const sized = telling === 'sizes' ? { chars: charsOf(step, false) } : {};
      tracker.edit({ path: SCENE, kind: cutting ? 'cut' : 'paste', wordsBefore, wordsAfter: words, ...sized });
    } else if (roll < 68) {
      const step = past.pop();
      if (!step) continue;
      const wordsBefore = words;
      words -= step.net;
      future.push(step);
      undos++;
      tracker.edit({ path: SCENE, kind: 'undo', wordsBefore, wordsAfter: words, ...extra(step, true) });
    } else if (roll < 84) {
      const step = future.pop();
      if (!step) continue;
      const wordsBefore = words;
      words += step.net;
      past.push(step);
      redos++;
      tracker.edit({ path: SCENE, kind: 'redo', wordsBefore, wordsAfter: words, ...extra(step, false) });
    } else if (roll < 92) {
      tracker.measure(SCENE, words);
    } else if (roll < 96) {
      // Words arrive from another device while nobody is typing here.
      tracker.measure(SCENE, words);
      words = Math.max(0, words + pick(60) - 20);
      tracker.measure(SCENE, words);
    } else {
      // The night passes.
      tracker.measure(SCENE, words);
      world.date = addDays(world.date, 1);
      world.time += 3600000;
    }
    world.time += pick(4000);
    if (!settled) continue;

    // What really stands: the steps that count and have not been undone.
    let added = 0;
    let deleted = 0;
    for (const step of past) {
      if (!counted(step)) continue;
      if (step.net > 0) added += step.net;
      else deleted -= step.net;
    }
    let trackedAdded = 0;
    let trackedDeleted = 0;
    for (const entry of tracker.unwritten()) {
      trackedAdded += entry.counts.manuscriptAdded;
      trackedDeleted += entry.counts.manuscriptDeleted;
    }
    const where = `seed ${seed}, step ${i}`;
    // The net of the day always equals the true net change made by typing.
    expect(trackedAdded - trackedDeleted, where).toBe(added - deleted);
    expect(tracker.session().net, where).toBe(added - deleted);
    if (!options.lazy) {
      // Measured after every keystroke, added and deleted are each exact:
      // no undo or redo has ever shown up as writing or as deleting.
      expect(trackedAdded, where).toBe(added);
      expect(trackedDeleted, where).toBe(deleted);
    }
  }
  // The session really was full of undoing and redoing.
  expect(undos, `seed ${seed}`).toBeGreaterThan(options.steps / 10);
  expect(redos, `seed ${seed}`).toBeGreaterThan(3);
}

describe('a long random session of typing, deleting, pasting, cutting, undo, redo and sync', () => {
  it('keeps added and deleted exact when the editor says what each undo is', () => {
    for (let seed = 1; seed <= 25; seed++) simulate(seed, 'says', { lazy: false, countPasted: false, steps: 400 });
  });

  it('keeps added and deleted exact when it is only told the size of each edit', () => {
    for (let seed = 101; seed <= 125; seed++) simulate(seed, 'sizes', { lazy: false, countPasted: false, steps: 400 });
  });

  it('keeps added and deleted exact when it is told nothing at all about an undo', () => {
    for (let seed = 601; seed <= 625; seed++) simulate(seed, 'silent', { lazy: false, countPasted: false, steps: 400 });
  });

  it('keeps the net exact when notes are only measured now and then', () => {
    for (let seed = 201; seed <= 225; seed++) simulate(seed, 'says', { lazy: true, countPasted: false, steps: 400 });
    for (let seed = 301; seed <= 315; seed++) simulate(seed, 'sizes', { lazy: true, countPasted: false, steps: 400 });
    for (let seed = 701; seed <= 715; seed++) simulate(seed, 'silent', { lazy: true, countPasted: false, steps: 400 });
  });

  it('keeps added and deleted exact with "count pasted text" on', () => {
    for (let seed = 401; seed <= 415; seed++) simulate(seed, 'says', { lazy: false, countPasted: true, steps: 400 });
    for (let seed = 501; seed <= 510; seed++) simulate(seed, 'sizes', { lazy: false, countPasted: true, steps: 400 });
    for (let seed = 801; seed <= 810; seed++) simulate(seed, 'silent', { lazy: false, countPasted: true, steps: 400 });
  });
});
