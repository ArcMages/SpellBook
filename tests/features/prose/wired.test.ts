// The prose checks as they are plugged into the plugin: the commands and the
// settings, what is kept on the device, when the feature has a place in the
// editor, and how the marks follow the writer's typing on a desktop and on a
// touch screen.

import { Text } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROSE_CHECKS, PROSE_PREFS_KEY, ProseAnalyser, parseProsePrefs } from '../../../src/core/prose';
import {
  CHECK_NAMES,
  EDITOR_CLASS,
  MARK_CLASS,
  MARK_MESSAGE,
  PROSE_COMMANDS,
  PROSE_MASTER_COMMAND,
  ProseChecks,
  ProseTip,
  TIP_CLASS,
  TOUCH_PAUSE_MS,
  decorate,
  isTyping,
  lineFlags,
  markClass,
  marksInView,
  messagesAt,
} from '../../../src/features/prose/index';
import type { ProseEditorHost } from '../../../src/features/prose/index';
import { ManualTimers } from '../../memoryVault';
import { FakeElement, Notice, Platform, fakeWindow, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import type { Setting, TextComponent } from '../../obsidianStub';
import { MemoryDeviceStorage } from '../../storeHarness';
import { options } from './lines';
import { FakeEditor, OUTSIDE, PICTURE, SCENE, drawn, fakeDocument, stage } from './stage';

afterEach(() => {
  vi.restoreAllMocks();
  resetFakeDocument();
  resetPlatform();
  Notice.shown.length = 0;
});

const saved = (storage: MemoryDeviceStorage): ReturnType<typeof parseProsePrefs> => parseProsePrefs(storage.load(PROSE_PREFS_KEY));
const lastNotice = (): string => Notice.shown[Notice.shown.length - 1]?.message ?? '';

describe('plugged in', () => {
  it('adds a command for all the checks and one for each, and a settings section', async () => {
    const { plugin, registered } = await stage();
    const ids = plugin.commands.map((command) => command.id);
    expect(ids).toEqual([
      'toggle-prose-checks',
      'toggle-prose-nouns',
      'toggle-prose-verbs',
      'toggle-prose-adjectives',
      'toggle-prose-adverbs',
      'toggle-prose-filler',
      'toggle-prose-passive',
      'toggle-prose-repeated',
      'toggle-prose-overused-adverbs',
      'toggle-prose-rhythm',
    ]);
    expect(ids[0]).toBe(PROSE_MASTER_COMMAND.id);
    expect(PROSE_CHECKS.map((check) => PROSE_COMMANDS[check].id)).toEqual(ids.slice(1));
    expect(ids.every((id) => id.startsWith('toggle-prose-'))).toBe(true);
    expect(new Set(plugin.commands.map((command) => command.name)).size).toBe(ids.length);
    expect(registered.settingsSections.map((section) => [section.id, section.title])).toEqual([['prose', 'Prose checks']]);
    expect(plugin.viewTypes).toEqual([]);
    expect(plugin.ribbonIcons).toEqual([]);
  });

  it('is off until the writer switches it on: no place in the editor, nothing kept, nothing asked of the editors', async () => {
    const { plugin, storage, fake, extensions } = await stage();
    expect(plugin.editorExtensions).toEqual([]);
    expect(extensions()).toEqual([]);
    expect(storage.saves).toEqual([]);
    expect(fake.workspace.optionsUpdated).toBe(0);
  });

  it('stays out where the plugin has no place in the editor', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { proseFeature } = await import('../../../src/features/prose/index');
    const commands: unknown[] = [];
    proseFeature.register({ plugin: { addCommand: (command: unknown) => commands.push(command) } } as never);
    expect(commands).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('the commands', () => {
  it('the master command switches the underlining checks on the first time, and says so', async () => {
    const { run, storage, plugin, fake, extensions } = await stage();
    run('toggle-prose-checks');
    expect(saved(storage)).toMatchObject({ on: true, checks: ['filler', 'passive', 'repeated', 'overused-adverbs', 'rhythm'] });
    expect(lastNotice()).toMatch(/^Prose checks: on \(filler words, passive voice, repeated words, overused adverbs, sentence rhythm\)/);
    // Now the feature has its place in the editor, and the editors were told.
    expect(plugin.editorExtensions).toHaveLength(1);
    expect(extensions()).toHaveLength(1);
    expect(fake.workspace.optionsUpdated).toBe(1);

    run('toggle-prose-checks');
    expect(saved(storage)).toMatchObject({ on: false, checks: ['filler', 'passive', 'repeated', 'overused-adverbs', 'rhythm'] });
    expect(lastNotice()).toBe('Prose checks: off');
    expect(extensions()).toEqual([]); // nothing left in the editors
    expect(plugin.editorExtensions).toHaveLength(1); // the same list, registered once
    expect(fake.workspace.optionsUpdated).toBe(2);

    run('toggle-prose-checks');
    expect(lastNotice()).toBe('Prose checks: on'); // the writer's own choice of checks is kept
    expect(extensions()).toHaveLength(1);
  });

  it('the command of a check switches that check, and the checks as a whole with it', async () => {
    const { run, storage, extensions } = await stage();
    run('toggle-prose-adverbs');
    expect(saved(storage)).toMatchObject({ on: true, checks: ['adverbs'] });
    expect(lastNotice()).toBe('Colour adverbs: on');
    const first = extensions()[0];

    run('toggle-prose-rhythm');
    expect(saved(storage).checks).toEqual(['adverbs', 'rhythm']);
    expect(lastNotice()).toBe('Sentence rhythm: on');
    // A new extension for new choices: the editors draw everything afresh.
    expect(extensions()).toHaveLength(1);
    expect(extensions()[0]).not.toBe(first);

    run('toggle-prose-adverbs');
    expect(saved(storage).checks).toEqual(['rhythm']);
    expect(lastNotice()).toBe('Colour adverbs: off');
    run('toggle-prose-rhythm');
    expect(saved(storage)).toMatchObject({ on: true, checks: [] });
    expect(extensions()).toEqual([]); // no check left: out of the editor again
  });

  it('every check has a command that switches it on and off again', async () => {
    const { run, storage } = await stage();
    for (const check of PROSE_CHECKS) {
      run(PROSE_COMMANDS[check].id);
      expect(saved(storage).checks, check).toContain(check);
      expect(lastNotice()).toBe(`${CHECK_NAMES[check]}: on`);
      run(PROSE_COMMANDS[check].id);
      expect(saved(storage).checks, check).not.toContain(check);
    }
  });

  it('what is on is remembered on the device, and is there again after a restart', async () => {
    const first = await stage();
    first.run('toggle-prose-filler');
    first.registered.release();
    first.plugin.unload();

    const again = await stage(first.storage);
    expect(again.extensions()).toHaveLength(1);
    expect(again.storage.saves).toHaveLength(1); // nothing was saved by starting
    // Another device starts with everything off.
    expect((await stage()).extensions()).toEqual([]);
  });

  it('goes on working when the device cannot keep anything', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = new MemoryDeviceStorage();
    storage.broken = true;
    const { run, extensions } = await stage(storage);
    run('toggle-prose-filler');
    expect(extensions()).toHaveLength(1); // for as long as Obsidian is open
    expect(logged).toHaveBeenCalled();
  });

  it('lets go of everything on unload', async () => {
    const { run, registered, plugin, fake, extensions } = await stage();
    run('toggle-prose-filler');
    const before = fake.workspace.optionsUpdated;
    registered.release();
    expect(extensions()).toEqual([]);
    expect(fake.workspace.optionsUpdated).toBe(before + 1); // the editors were told to drop the marks
    plugin.unload();
    expect(plugin.domEventCount).toBe(0);
    expect(fake.workspace.listenerCount()).toBe(0);
    // A command that is still around does nothing to the editors any more.
    run('toggle-prose-passive');
    expect(extensions()).toEqual([]);
  });
});

describe('the settings', () => {
  const names = (element: FakeElement): string[] => element.settings.map((row) => row.nameEl.text);
  const row = (element: FakeElement, name: string): Setting => {
    const found = element.settings.find((entry) => entry.nameEl.text === name);
    if (!found) throw new Error(`no row "${name}"`);
    return found;
  };
  const field = (element: FakeElement, name: string): TextComponent => row(element, name).components[0] as TextComponent;

  it('have the same switches as the commands, the two thresholds and the lists of filler words', async () => {
    const { settings } = await stage();
    const element = settings();
    expect(names(element)).toEqual([
      'Prose checks',
      ...PROSE_CHECKS.map((check) => CHECK_NAMES[check]),
      'Repeated words: how close',
      'Sentence rhythm: a long sentence',
      'Your own filler words (English)',
      'Your own filler words (Hebrew)',
    ]);
    // Everything is off, the thresholds are at their starting values.
    expect(element.settings.slice(0, 10).map((entry) => entry.toggles[0]?.getValue())).toEqual(Array(10).fill(false));
    expect(field(element, 'Repeated words: how close').getValue()).toBe('40');
    expect(field(element, 'Sentence rhythm: a long sentence').getValue()).toBe('35');
    // Every row says what it is, and which language it is for.
    for (const entry of element.settings) expect(entry.descEl.text, entry.nameEl.text).not.toBe('');
    for (const check of ['nouns', 'verbs', 'adjectives', 'adverbs', 'passive', 'overused-adverbs'] as const) {
      expect(row(element, CHECK_NAMES[check]).descEl.text, check).toMatch(/English only/);
    }
    for (const check of ['filler', 'repeated', 'rhythm'] as const) {
      expect(row(element, CHECK_NAMES[check]).descEl.text, check).toMatch(/English and Hebrew/);
    }
    // The writer's own words pick their own direction.
    for (const name of ['Your own filler words (English)', 'Your own filler words (Hebrew)']) {
      expect(field(element, name).inputEl.attrs['dir']).toBe('auto');
    }
  });

  it('switch the checks, and show what the commands did', async () => {
    const { settings, storage, run, extensions } = await stage();
    const element = settings();
    row(element, 'Filler words').toggles[0]?.flip();
    expect(saved(storage)).toMatchObject({ on: true, checks: ['filler'] });
    expect(extensions()).toHaveLength(1);
    // The rows were drawn again: the master switch shows that the checks are on.
    expect(row(element, 'Prose checks').toggles[0]?.getValue()).toBe(true);
    expect(row(element, 'Filler words').toggles[0]?.getValue()).toBe(true);
    expect(element.settings).toHaveLength(14);

    row(element, 'Prose checks').toggles[0]?.flip();
    expect(saved(storage)).toMatchObject({ on: false, checks: ['filler'] });
    expect(extensions()).toEqual([]);

    run('toggle-prose-rhythm');
    const reopened = settings();
    expect(row(reopened, 'Sentence rhythm').toggles[0]?.getValue()).toBe(true);
    expect(row(reopened, 'Prose checks').toggles[0]?.getValue()).toBe(true);
  });

  it('take the thresholds as whole numbers within their bounds, and ignore what is no number', async () => {
    const { settings, storage } = await stage();
    const element = settings();
    field(element, 'Repeated words: how close').type('25');
    field(element, 'Sentence rhythm: a long sentence').type('50');
    expect(saved(storage)).toMatchObject({ distance: 25, longSentence: 50 });
    field(element, 'Repeated words: how close').type('');
    field(element, 'Sentence rhythm: a long sentence').type('long');
    expect(saved(storage)).toMatchObject({ distance: 25, longSentence: 50 });
    field(element, 'Repeated words: how close').type('100000');
    field(element, 'Sentence rhythm: a long sentence').type('1');
    expect(saved(storage)).toMatchObject({ distance: 200, longSentence: 12 });
    // The field is not drawn again while it is typed in.
    expect(field(element, 'Repeated words: how close').getValue()).toBe('100000');
  });

  it("keep the writer's own filler words, English and Hebrew, on the device", async () => {
    const { settings, storage } = await stage();
    const element = settings();
    field(element, 'Your own filler words (English)').type('nevertheless, at any rate');
    field(element, 'Your own filler words (Hebrew)').type('בקיצור, מה שנקרא');
    expect(saved(storage)).toMatchObject({ fillersEnglish: ['nevertheless', 'at any rate'], fillersHebrew: ['בקיצור', 'מה שנקרא'] });
    const reopened = settings();
    expect(field(reopened, 'Your own filler words (English)').getValue()).toBe('nevertheless, at any rate');
    expect(field(reopened, 'Your own filler words (Hebrew)').getValue()).toBe('בקיצור, מה שנקרא');
    // Only on this device: one key, with the plugin's prefix.
    expect([...new Set(storage.saves.map(([key]) => key))]).toEqual(['spellbook-prose']);
  });
});

describe('which notes are checked', () => {
  it('Markdown notes inside a Spellbook project, and no others', async () => {
    const { context } = await stage();
    const checks = new ProseChecks(context);
    expect(checks.covers(SCENE)).toBe(true);
    expect(checks.covers('Novel/Research/Tides.md')).toBe(true);
    expect(checks.covers(OUTSIDE)).toBe(false);
    expect(checks.covers(PICTURE)).toBe(false);
    expect(checks.covers('Novels/Other.md')).toBe(false); // a folder whose name merely starts the same
    expect(checks.covers(null)).toBe(false);
  });
});

// ------------------------------------------------------------- in the editor

const NOTE = [
  '---',
  'synopsis: A very short one.',
  '---',
  'The tide was very high.',
  '',
  'The door was opened by the wind.',
  '',
  'She watched the tide.',
].join('\n');

function host(touch: boolean, more: Partial<ProseEditorHost> = {}): ProseEditorHost & { timers: ManualTimers } {
  const timers = new ManualTimers();
  return {
    analyser: new ProseAnalyser(options(['filler', 'passive', 'repeated'])),
    covers: (path) => path === SCENE,
    touch,
    setTimer: timers.set,
    timers,
    ...more,
  };
}

describe('from a note to marks', () => {
  it('marks what is on the screen, at the right places, and nothing in the properties', () => {
    const doc = Text.of(NOTE.split('\n'));
    const analyser = new ProseAnalyser(options(['filler', 'passive', 'repeated']));
    const marks = drawn(decorate(marksInView(doc, [{ from: 0, to: doc.length }], analyser), doc.length), doc);
    expect(marks.map((mark) => `${mark.kind}: ${mark.words}`)).toEqual([
      'repeated: tide',
      'filler: very',
      'passive: was opened',
      'repeated: tide',
    ]);
    expect(marks[1]?.message).toBe('Filler: "very"');
    expect(marks[0]?.message).toBe('Repeated: "tide" 2 times in 15 words');
    expect([...lineFlags(doc)].slice(0, 4)).toEqual([1, 1, 1, 0]);
    expect(lineFlags(doc)).toBe(lineFlags(doc)); // worked out once for a text
  });

  it('reads only around what is on the screen', () => {
    const paragraphs = Array.from({ length: 400 }, (_, at) => `Paragraph ${at} was very long and it was written by hand.`);
    const doc = Text.of(paragraphs.join('\n\n').split('\n'));
    const analyser = new ProseAnalyser(options(['filler', 'passive']));
    const middle = doc.line(401);
    const marks = marksInView(doc, [{ from: middle.from, to: doc.line(421).to }], analyser);
    expect(marks.length).toBeGreaterThan(0);
    expect(analyser.remembered).toBeLessThan(40); // of 400 paragraphs
    const lines = marks.map((mark) => doc.lineAt(mark.from).number);
    expect(Math.min(...lines)).toBeGreaterThan(380);
    expect(Math.max(...lines)).toBeLessThan(440);
    // Nothing on the screen, an empty note, no check: no marks.
    expect(marksInView(doc, [], analyser)).toEqual([]);
    expect(marksInView(Text.of(['']), [{ from: 0, to: 0 }], analyser)).toEqual([]);
    expect(marksInView(doc, [{ from: 0, to: 50 }], new ProseAnalyser(options([])))).toEqual([]);
  });

  it('gives every mark the shared class, the class of its kind and its sentence', () => {
    const doc = Text.of(['It was very late.']);
    const analyser = new ProseAnalyser(options(['filler']));
    const set = decorate(marksInView(doc, [{ from: 0, to: doc.length }], analyser), doc.length);
    const spec = set.iter().value?.spec as { class: string; attributes: Record<string, string> };
    expect(spec.class).toBe(`${MARK_CLASS} ${markClass('filler')}`);
    expect(spec.class).toBe('spellbook-prose-mark spellbook-prose-filler');
    expect(spec.attributes[MARK_MESSAGE]).toBe('Filler: "very"');
    expect(EDITOR_CLASS).toBe('spellbook-prose');
    // A mark that does not fit the note is left out, not drawn in the wrong place.
    expect(decorate([{ from: 5, to: 50, kind: 'filler', message: 'x' }], 10).size).toBe(0);
  });
});

describe('in the editor, on a desktop', () => {
  it('draws the marks of a project note at once, and none in a note outside a project', () => {
    const editor = new FakeEditor(SCENE, NOTE, host(false));
    expect(editor.picture).toEqual(['repeated: tide', 'filler: very', 'passive: was opened', 'repeated: tide']);
    expect(new FakeEditor(OUTSIDE, NOTE, host(false)).picture).toEqual([]);
  });

  it('follows every key, and never changes the text', () => {
    const editor = new FakeEditor(SCENE, NOTE, host(false));
    const end = editor.text.length;
    editor.type(end, ' It was really late.');
    expect(editor.picture).toEqual(['repeated: tide', 'filler: very', 'passive: was opened', 'repeated: tide', 'filler: really']);
    // The "very" of the prose, not the one in the properties.
    editor.backspace(editor.text.indexOf('very high') + 4);
    expect(editor.picture).not.toContain('filler: very');
    expect(editor.text).toBe(`${NOTE} It was really late.`.replace('very high', 'ver high'));
  });

  it('works the marks out again after a scroll, and not when only the caret moves', () => {
    const analyser = new ProseAnalyser(options(['filler']));
    const passage = vi.spyOn(analyser, 'passage');
    const editor = new FakeEditor(SCENE, NOTE, host(false, { analyser }));
    expect(passage).toHaveBeenCalledTimes(1);
    editor.caret(10);
    expect(passage).toHaveBeenCalledTimes(1);
    editor.scroll(0, 60);
    expect(passage).toHaveBeenCalledTimes(2);
  });

  it('draws nothing, and goes on, when a check fails', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const analyser = new ProseAnalyser(options(['filler']));
    const editor = new FakeEditor(SCENE, NOTE, host(false, { analyser }));
    vi.spyOn(analyser, 'passage').mockImplementationOnce(() => {
      throw new Error('bug in a check');
    });
    editor.type(editor.text.length, '!');
    expect(editor.picture).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    editor.type(editor.text.length, '!');
    expect(editor.picture).toEqual(['filler: very']);
  });
});

describe('in the editor, on a phone or a tablet', () => {
  const twoLines = 'It was very late.\nThe door was opened.';

  it('works nothing out on the frame of a key: the marks only move along with the text', () => {
    const touch = host(true);
    const passage = vi.spyOn(touch.analyser, 'passage');
    const editor = new FakeEditor(SCENE, twoLines, touch);
    expect(passage).toHaveBeenCalledTimes(1);
    expect(editor.picture).toEqual(['filler: very', 'passive: was opened']);

    // Typing at the start of the second line: "really " is not marked yet, the old marks have moved.
    const at = editor.text.indexOf('The door');
    editor.type(at, 'r');
    editor.type(at + 1, 'eally ');
    expect(passage).toHaveBeenCalledTimes(1);
    expect(editor.picture).toEqual(['filler: very', 'passive: was opened']);
    expect(touch.timers.pending).toBe(1); // one timer, started again by the second key
    editor.backspace(at + 7);
    expect(passage).toHaveBeenCalledTimes(1);
  });

  it('a moment after the typing pauses, brings the other lines up to date and leaves the typed line as it is', () => {
    const touch = host(true);
    const editor = new FakeEditor(SCENE, twoLines, touch);
    const marksBefore = drawn(editor.marks.decorations, editor.state.doc);
    // The caret is in the first line; the writer types there.
    editor.type(3, 'really ');
    touch.timers.advance(TOUCH_PAUSE_MS - 1);
    expect(editor.updates).toBe(1);
    touch.timers.advance(1);
    expect(editor.updates).toBe(2); // the editor was asked once, by the timer
    // The typed line still shows what it showed; "really" waits until the caret leaves.
    expect(editor.picture).toEqual(['filler: very', 'passive: was opened']);
    expect(drawn(editor.marks.decorations, editor.state.doc).map((mark) => mark.from)).toEqual(marksBefore.map((mark) => mark.from + 7));
    expect(touch.timers.pending).toBe(0);
  });

  it('keeps the very marks of the typed line, so that the editor has nothing to redraw there', () => {
    const touch = host(true);
    const editor = new FakeEditor(SCENE, twoLines, touch);
    const held = (): unknown[] => {
      const values: unknown[] = [];
      for (const cursor = editor.marks.decorations.iter(); cursor.value !== null; cursor.next()) {
        if (cursor.to <= editor.state.doc.line(1).to) values.push(cursor.value);
      }
      return values;
    };
    const before = held();
    editor.type(3, 'x');
    touch.timers.advance(TOUCH_PAUSE_MS);
    expect(held()).toEqual(before);
    expect(held()[0]).toBe(before[0]);
  });

  it('draws the typed line afresh when the caret leaves it, or the keyboard goes away', () => {
    const touch = host(true);
    const editor = new FakeEditor(SCENE, twoLines, touch);
    editor.type(3, 'really ');
    editor.caret(5); // still in the line
    expect(editor.picture).toEqual(['filler: very', 'passive: was opened']);
    editor.caret(editor.text.length); // into the other line
    expect(editor.picture).toEqual(['filler: really', 'filler: very', 'passive: was opened']);

    editor.type(editor.text.length, ' Just so.');
    expect(editor.picture).not.toContain('filler: Just');
    editor.blur();
    expect(editor.picture).toContain('filler: Just');
  });

  it('updates the other lines while one is held, also after a scroll', () => {
    const touch = host(true);
    const editor = new FakeEditor(SCENE, `${twoLines}\nPlain.`, touch);
    // The writer types "very " into the third line; the first two are untouched.
    const at = editor.text.indexOf('Plain');
    editor.type(at, 'very ');
    editor.scroll(0, editor.text.length);
    expect(editor.picture).toEqual(['filler: very', 'passive: was opened']); // the third line is held
    editor.caret(0);
    expect(editor.picture).toEqual(['filler: very', 'passive: was opened', 'filler: very']);
  });

  it('takes a paste, an undo or a sync as a new text, and draws everything at once', () => {
    const touch = host(true);
    const passage = vi.spyOn(touch.analyser, 'passage');
    const editor = new FakeEditor(SCENE, twoLines, touch);
    editor.type(3, 'x');
    editor.paste(0, 'Really. ');
    expect(passage).toHaveBeenCalledTimes(2);
    expect(editor.picture).toEqual(['filler: Really', 'filler: very', 'passive: was opened']);
    editor.dispatch({ changes: { from: 0, to: editor.text.length, insert: 'Just this.' } }); // the note came in anew from a sync
    expect(editor.picture).toEqual(['filler: Just']);
  });

  it('stops its timer when the editor closes', () => {
    const touch = host(true);
    const editor = new FakeEditor(SCENE, twoLines, touch);
    editor.type(3, 'x');
    expect(touch.timers.pending).toBe(1);
    editor.marks.destroy();
    expect(touch.timers.pending).toBe(0);
    touch.timers.advance(TOUCH_PAUSE_MS * 2);
    expect(editor.updates).toBe(1);
  });

  it('knows typing from everything else', () => {
    const touch = host(true);
    const editor = new FakeEditor(SCENE, twoLines, touch);
    const kind = (userEvent: string | undefined, change = true): boolean => {
      const spec = { ...(change ? { changes: { from: 0, insert: 'a' } } : {}), ...(userEvent ? { userEvent } : {}) };
      return isTyping({ transactions: [editor.state.update(spec)] });
    };
    expect(kind('input.type')).toBe(true);
    expect(kind('input.type.compose')).toBe(true);
    expect(kind('delete.backward')).toBe(true);
    expect(kind('delete.forward')).toBe(true);
    for (const other of ['input.paste', 'input.drop', 'delete.cut', 'undo', 'redo', 'move.drop', undefined]) expect(kind(other), String(other)).toBe(false);
    expect(kind('select', false)).toBe(false); // no change of the text at all
  });

  it('is told that it is a touch screen by Obsidian, in one place', async () => {
    Platform.isMobile = true;
    const { run, extensions } = await stage();
    run('toggle-prose-filler');
    expect(extensions()).toHaveLength(1);
  });
});

describe('the bubble that says what a mark is', () => {
  function nested(): { root: FakeElement; sentence: FakeElement; word: FakeElement; plain: FakeElement } {
    const root = new FakeElement('div');
    const line = root.createDiv({ cls: 'cm-line' });
    const sentence = line.createSpan({ attr: { [MARK_MESSAGE]: 'Long sentence: 41 words' } });
    const word = sentence.createSpan({ attr: { [MARK_MESSAGE]: 'Filler: "very"' } });
    const plain = line.createSpan({ text: 'plain' });
    return { root, sentence, word, plain };
  }

  it('reads every mark at a place, the innermost first, and nothing outside the editor', () => {
    const { root, sentence, word, plain } = nested();
    root.setAttr(MARK_MESSAGE, 'not a mark of the text');
    expect(messagesAt(word, root)).toEqual(['Filler: "very"', 'Long sentence: 41 words']);
    expect(messagesAt(sentence, root)).toEqual(['Long sentence: 41 words']);
    expect(messagesAt(plain, root)).toEqual([]);
    expect(messagesAt(null, root)).toEqual([]);
    expect(messagesAt({}, root)).toEqual([]);
  });

  it('shows one line for each mark near the pointer or the finger, and goes away again', () => {
    Object.assign(fakeWindow, { innerWidth: 400, innerHeight: 300 });
    const tip = new ProseTip();
    tip.show(fakeDocument as never, ['Filler: "very"', 'Repeated: "גלים" 3 times in 40 words'], 120, 80);
    const bubble = fakeDocument.body.withClass(TIP_CLASS)[0] as FakeElement;
    expect(tip.shown).toBe(true);
    expect(bubble.attrs['role']).toBe('tooltip');
    expect(bubble.children.map((line) => line.text)).toEqual(['Filler: "very"', 'Repeated: "גלים" 3 times in 40 words']);
    // The sentence may quote Hebrew: each line picks its own direction.
    expect(bubble.children.every((line) => line.attrs['dir'] === 'auto')).toBe(true);
    expect(bubble.style['left']).toBe('120px');
    expect(bubble.style['top']).toBe('102px'); // under the finger, not beneath it
    // Near the edges it stays on the page.
    tip.show(fakeDocument as never, ['Passive voice: "was opened"'], 399, 299);
    const moved = fakeDocument.body.withClass(TIP_CLASS);
    expect(moved).toHaveLength(1); // the first one is gone
    expect(Number.parseInt(moved[0]?.style['left'] ?? '', 10)).toBeLessThanOrEqual(392);
    expect(Number.parseInt(moved[0]?.style['top'] ?? '', 10)).toBeLessThan(299);
    tip.hide();
    expect(tip.shown).toBe(false);
    expect(fakeDocument.body.withClass(TIP_CLASS)).toEqual([]);
    tip.hide(); // again: nothing happens
    delete (fakeWindow as { innerWidth?: number }).innerWidth;
    delete (fakeWindow as { innerHeight?: number }).innerHeight;
  });

  it('shows nothing where there is no mark, and is not built again for the same marks', () => {
    const tip = new ProseTip();
    tip.show(fakeDocument as never, [], 10, 10);
    expect(tip.shown).toBe(false);
    tip.show(fakeDocument as never, ['Filler: "very"'], 10, 10);
    const first = fakeDocument.body.withClass(TIP_CLASS)[0];
    tip.show(fakeDocument as never, ['Filler: "very"'], 14, 12); // the pointer moved inside the mark
    expect(fakeDocument.body.withClass(TIP_CLASS)[0]).toBe(first);
    tip.show(fakeDocument as never, [], 200, 200); // and off it
    expect(tip.shown).toBe(false);
  });

  it('comes up on a tap as on a resting pointer, and goes when the writer types', () => {
    const { root, word, plain } = nested();
    const editor = new FakeEditor(SCENE, NOTE, host(true));
    Object.assign(editor, { contentDOM: root });
    editor.marks.explain({ target: word, clientX: 50, clientY: 60 } as never);
    expect(fakeDocument.body.withClass(TIP_CLASS)[0]?.children.map((line) => line.text)).toEqual(['Filler: "very"', 'Long sentence: 41 words']);
    editor.type(editor.text.length, 'a');
    expect(fakeDocument.body.withClass(TIP_CLASS)).toEqual([]);
    editor.marks.explain({ target: word, clientX: 50, clientY: 60 } as never);
    editor.marks.explain({ target: plain, clientX: 90, clientY: 60 } as never); // a tap beside the mark
    expect(fakeDocument.body.withClass(TIP_CLASS)).toEqual([]);
    editor.marks.explain({ target: word, clientX: 50, clientY: 60 } as never);
    editor.marks.destroy();
    expect(fakeDocument.body.withClass(TIP_CLASS)).toEqual([]);
  });
});
