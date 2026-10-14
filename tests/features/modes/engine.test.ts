// The writing modes engine (src/core/modes): which modes are on and its
// saved form, the settings, the band of the letter box, the resting line of
// the typewriter, and what Hemingway refuses.

import { describe, expect, it } from 'vitest';
import {
  ANCHOR_PERCENTS,
  BAND_PERCENTS,
  MODES,
  MODE_IDS,
  NO_MODES,
  anyMode,
  blockedChange,
  blockedInput,
  blockedKeys,
  blockedText,
  allowedHere,
  defaultModeSettings,
  hemingwayAllows,
  formatModeSettings,
  formatModes,
  frameOf,
  parseModeSettings,
  parseModes,
  sameFrame,
  typewriterTarget,
  withMode,
} from '../../../src/core/modes/index';
import type { FrameInput } from '../../../src/core/modes/index';

describe('which modes are on', () => {
  it('names four modes, each with the agreed command', () => {
    expect([...MODE_IDS]).toEqual(['zen', 'letter-box', 'typewriter', 'hemingway']);
    expect(MODE_IDS.map((id) => MODES[id].command.id)).toEqual([
      'toggle-zen-mode',
      'toggle-letter-box-mode',
      'toggle-typewriter-mode',
      'toggle-hemingway-mode',
    ]);
    expect(MODE_IDS.map((id) => MODES[id].command.name)).toEqual([
      'Toggle Zen mode',
      'Toggle letter box mode',
      'Toggle typewriter mode',
      'Toggle Hemingway mode',
    ]);
  });

  it('switches one mode without touching the others, and never changes a set that was handed out', () => {
    const zen = withMode(NO_MODES, 'zen', true);
    expect(zen).toEqual({ zen: true, 'letter-box': false, typewriter: false, hemingway: false });
    expect(NO_MODES.zen).toBe(false);
    expect(withMode(zen, 'zen', true)).toBe(zen); // nothing to change
    expect(anyMode(NO_MODES)).toBe(false);
    expect(anyMode(withMode(zen, 'hemingway', true))).toBe(true);
  });

  it('is saved as the ids of the modes that are on, and as nothing when none is', () => {
    expect(formatModes(NO_MODES)).toBeNull();
    const two = withMode(withMode(NO_MODES, 'hemingway', true), 'letter-box', true);
    expect(formatModes(two)).toBe('letter-box,hemingway');
    expect(parseModes(formatModes(two))).toEqual(two);
  });

  it('reads back anything at all without failing', () => {
    for (const stored of [null, undefined, 42, {}, [], '', ',,', 'nonsense', 'constructor,__proto__']) {
      expect(parseModes(stored), JSON.stringify(stored)).toEqual(NO_MODES);
    }
    expect(parseModes(' zen , bogus,typewriter')).toEqual({ zen: true, 'letter-box': false, typewriter: true, hemingway: false });
  });
});

describe('what Hemingway lets through', () => {
  it('lets undo through on phones and tablets by default, and where the writer chose', () => {
    const defaults = defaultModeSettings(false);
    expect([...hemingwayAllows(defaults, true)]).toEqual(['undo']);
    expect([...hemingwayAllows(defaults, false)]).toEqual([]);
    expect([...hemingwayAllows({ hemingwayUndo: 'never' }, true)]).toEqual([]);
    expect([...hemingwayAllows({ hemingwayUndo: 'always' }, false)]).toEqual(['undo']);
    expect(allowedHere('mobile', true)).toBe(true);
    expect(allowedHere('mobile', false)).toBe(false);
  });

  it('settings saved before the choice existed come back with the default', () => {
    expect(parseModeSettings({ bandPercent: 60 }, false).hemingwayUndo).toBe('mobile');
  });
});

describe('the settings of the modes', () => {
  it('start with the line in the middle on a desktop, and above the middle on a phone', () => {
    expect(defaultModeSettings(false)).toEqual({
      bandPercent: 40,
      bandShade: 'faint',
      anchorPercent: 50,
      zenHideProperties: true,
      zenHideTitle: false,
      zenEscape: true,
      hemingwayUndo: 'mobile',
    });
    expect(defaultModeSettings(true).anchorPercent).toBe(40);
  });

  it('come back as they were saved', () => {
    const settings = { ...defaultModeSettings(false), bandPercent: 60, bandShade: 'hidden' as const, anchorPercent: 30, zenEscape: false, hemingwayUndo: 'never' as const };
    expect(parseModeSettings(formatModeSettings(settings), false)).toEqual(settings);
    expect(parseModeSettings(JSON.parse(formatModeSettings(settings)), true)).toEqual(settings);
  });

  it('keep what can be right and replace what cannot', () => {
    const defaults = defaultModeSettings(false);
    for (const stored of [null, 7, 'not json', '[1,2]', '"text"']) {
      expect(parseModeSettings(stored, false), String(stored)).toEqual(defaults);
    }
    const mixed = parseModeSettings({ bandPercent: 'tall', bandShade: 'purple', anchorPercent: 33, zenHideTitle: true, zenEscape: 'no', hemingwayUndo: 'sometimes' }, false);
    expect(mixed).toEqual({ ...defaults, anchorPercent: 30, zenHideTitle: true });
    // A number outside the choices becomes the nearest choice.
    expect(parseModeSettings({ bandPercent: 500, anchorPercent: -4 }, false)).toMatchObject({
      bandPercent: BAND_PERCENTS[BAND_PERCENTS.length - 1],
      anchorPercent: ANCHOR_PERCENTS[0],
    });
  });
});

describe('the frame of a pane', () => {
  const pane: FrameInput = { height: 600, visible: 600, lineHeight: 24, letterBox: false, typewriter: false, bandPercent: 40, anchorPercent: 50 };

  it('is nothing at all while neither mode is on', () => {
    expect(frameOf(pane)).toEqual({ coverTop: 0, coverBottom: 0, padTop: 0, padBottom: 0, anchor: 300 });
  });

  it('puts the band of the letter box in the middle, with room for the first and last line to reach it', () => {
    const frame = frameOf({ ...pane, letterBox: true });
    expect(frame).toEqual({ coverTop: 180, coverBottom: 180, padTop: 180, padBottom: 180, anchor: 300 });
    expect(600 - frame.coverTop - frame.coverBottom).toBe(240); // 40% stays lit
  });

  it('gives the typewriter room for any line, also the only one of a short note, to rest at its place', () => {
    const frame = frameOf({ ...pane, typewriter: true, anchorPercent: 30 });
    expect(frame.anchor).toBe(180);
    expect(frame.padTop).toBe(168); // the first line's middle comes to 180
    expect(frame.padBottom).toBe(408); // and so does the last line's
    expect(frame.coverTop + frame.coverBottom).toBe(0);
  });

  it('puts the band around the resting line when both are on, as far as the pane allows', () => {
    const frame = frameOf({ ...pane, letterBox: true, typewriter: true, anchorPercent: 30 });
    expect(frame.coverTop).toBe(60);
    expect(frame.coverBottom).toBe(300);
    // Near the top, the band cannot go above the pane.
    expect(frameOf({ ...pane, letterBox: true, typewriter: true, anchorPercent: 10 }).coverTop).toBe(0);
    expect(frameOf({ ...pane, letterBox: true, typewriter: true, anchorPercent: 100 }).coverBottom).toBe(0);
  });

  it('counts only what a keyboard leaves to be seen', () => {
    // A phone: the keyboard lies over the lower 300 of a pane of 600.
    const frame = frameOf({ ...pane, visible: 300, letterBox: true, typewriter: true });
    expect(frame.anchor).toBe(150);
    expect(frame.coverTop).toBe(90);
    expect(frame.coverBottom).toBe(390); // 90 of what is seen, and all that is under the keyboard
    expect(frame.padBottom).toBe(438);
  });

  it('never makes the band shorter than three lines, or taller than the pane', () => {
    const small = frameOf({ ...pane, height: 100, visible: 100, letterBox: true, bandPercent: 20 });
    expect(100 - small.coverTop - small.coverBottom).toBe(72);
    const tiny = frameOf({ ...pane, height: 50, visible: 50, letterBox: true, bandPercent: 20 });
    expect(tiny.coverTop + tiny.coverBottom).toBe(0);
  });

  it('copes with a pane that has no size, and with numbers that are none', () => {
    expect(frameOf({ ...pane, height: 0, visible: 0, letterBox: true, typewriter: true })).toEqual({
      coverTop: 0,
      coverBottom: 0,
      padTop: 0,
      padBottom: 0,
      anchor: 0,
    });
    const odd = frameOf({ ...pane, letterBox: true, typewriter: true, bandPercent: Number.NaN, anchorPercent: Number.NaN, lineHeight: 0 });
    for (const value of Object.values(odd)) expect(Number.isFinite(value) && value >= 0).toBe(true);
  });

  it('tells two frames apart', () => {
    const frame = frameOf({ ...pane, letterBox: true });
    expect(sameFrame(frame, { ...frame })).toBe(true);
    expect(sameFrame(frame, { ...frame, padBottom: frame.padBottom + 1 })).toBe(false);
    expect(sameFrame(frame, null)).toBe(false);
    expect(sameFrame(null, null)).toBe(true);
  });
});

describe('where the typewriter scrolls to', () => {
  const place = { lineTop: 500, lineBottom: 524, paneTop: 100, scrollTop: 1000, maxScroll: 5000, anchor: 300 };

  it('brings the middle of the line to its resting place', () => {
    // The line's middle is 412 below the top of the pane; it should be at 300.
    expect(typewriterTarget(place)).toBe(1112);
    expect(typewriterTarget({ ...place, lineTop: 300, lineBottom: 324 })).toBe(912);
  });

  it('leaves a line alone that is where it should be', () => {
    expect(typewriterTarget({ ...place, lineTop: 388, lineBottom: 412 })).toBeNull();
    expect(typewriterTarget({ ...place, lineTop: 388.4, lineBottom: 412.4 })).toBeNull();
  });

  it('never asks for more than the pane can scroll', () => {
    expect(typewriterTarget({ ...place, maxScroll: 1050 })).toBe(1050);
    expect(typewriterTarget({ ...place, scrollTop: 40, lineTop: 110, lineBottom: 134 })).toBe(0);
    expect(typewriterTarget({ ...place, scrollTop: 0, lineTop: 110, lineBottom: 134 })).toBeNull(); // already as far as it goes
    expect(typewriterTarget({ ...place, lineTop: Number.NaN })).toBeNull();
  });
});

describe('what Hemingway refuses', () => {
  it('refuses the keys that take text away, with any modifier held', () => {
    const keys = blockedKeys();
    const all = keys.map((entry) => entry.key ?? `mac:${entry.mac}`);
    for (const key of ['Backspace', 'Delete', 'Mod-Backspace', 'Alt-Backspace', 'Ctrl-Delete', 'Mod-z', 'Mod-Shift-z', 'Mod-y', 'Mod-x', 'mac:Ctrl-h', 'mac:Ctrl-k']) {
      expect(all, key).toContain(key);
    }
    expect(new Set(all).size).toBe(all.length);
    expect(keys.find((entry) => entry.key === 'Mod-z')?.what).toBe('undo');
    expect(keys.find((entry) => entry.key === 'Shift-Delete')?.what).toBe('cut');
    // Nothing that only moves the caret, selects, copies or pastes.
    expect(all.filter((key) => /Arrow|Home|End|Mod-a|Mod-c|Mod-v|Enter/.test(key))).toEqual([]);
  });

  it('refuses what a phone keyboard announces as deleting, and lets typing through', () => {
    for (const type of ['deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteSoftLineBackward', 'deleteHardLineForward', 'deleteContent', 'deleteEntireSoftLine']) {
      expect(blockedInput(type, true), type).toBe('delete');
    }
    expect(blockedInput('historyUndo', true)).toBe('undo');
    expect(blockedInput('historyRedo', true)).toBe('undo');
    expect(blockedInput('deleteByCut', false)).toBe('cut');
    expect(blockedInput('deleteByDrag', false)).toBe('move');
    for (const type of ['insertText', 'insertLineBreak', 'insertParagraph', 'insertFromPaste', 'insertFromDrop', 'insertReplacementText', 'formatBold']) {
      expect(blockedInput(type, true), type).toBeNull();
    }
  });

  it('refuses typing or pasting over a selection, which would wipe it', () => {
    expect(blockedInput('insertText', false)).toBe('replace');
    expect(blockedInput('insertFromPaste', false)).toBe('replace');
  });

  it('leaves a text that is being composed alone, whatever the keyboard does with it', () => {
    for (const type of ['insertCompositionText', 'deleteCompositionText', 'insertFromComposition']) {
      expect(blockedInput(type, false), type).toBeNull();
    }
    expect(blockedChange({ userEvent: 'input.type.compose', removes: true, selectionEmpty: false })).toBeNull();
  });

  it('refuses a change by what caused it', () => {
    const change = (userEvent: string | undefined, removes = true, selectionEmpty = true) => blockedChange({ userEvent, removes, selectionEmpty });
    expect(change('delete.backward')).toBe('delete');
    expect(change('delete.forward')).toBe('delete');
    expect(change('delete.selection', true, false)).toBe('delete');
    expect(change('delete.cut', true, false)).toBe('cut');
    expect(change('undo')).toBe('undo');
    expect(change('redo', false)).toBe('undo');
    expect(change('move.drop', true, false)).toBe('move');
    expect(change('input.type', true, false)).toBe('replace');
    expect(change('input.paste', true, false)).toBe('replace');
    // Adding text is always allowed, and so is a correction made with nothing selected.
    expect(change('input.type', false)).toBeNull();
    expect(change('input.paste', false)).toBeNull();
    expect(change('input.type', true, true)).toBeNull();
    expect(change('input', false, false)).toBeNull();
    expect(change('select.pointer', false)).toBeNull();
    expect(change('undoing', true)).toBeNull(); // a name that merely starts the same
  });

  it('never refuses a change no writer made, such as a note loaded again after a sync', () => {
    expect(blockedChange({ userEvent: undefined, removes: true, selectionEmpty: false })).toBeNull();
    expect(blockedChange({ userEvent: undefined, removes: true, selectionEmpty: true })).toBeNull();
  });

  it('says in plain words what was refused', () => {
    for (const what of ['delete', 'undo', 'cut', 'replace', 'move'] as const) {
      expect(blockedText(what)).toMatch(/switched off while Hemingway mode is on/);
    }
    expect(blockedText('delete')).toMatch(/^Deleting/);
  });
});
