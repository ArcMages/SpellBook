// The writing modes as they are plugged into the plugin: the commands, what
// each mode puts on the page, what the device remembers, and that switching
// a mode off, or the plugin, leaves no trace.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BODY_CLASSES,
  CORNER_CLASS,
  EXIT_CLASS,
  EXIT_ZEN_TEXT,
  FLASH_CLASS,
  FLASH_MS,
  LOCK_CLASS,
  REFUSED_CLASS,
  REFUSED_NOTICE_MS,
  ZEN_CLASS,
  ZEN_NO_PROPERTIES_CLASS,
  ZEN_NO_TITLE_CLASS,
} from '../../../src/features/modes/chrome';
import { MODES_ON_KEY, MODES_SETTINGS_KEY } from '../../../src/features/modes/prefs';
import { MODES_INTRO_TEXT, anchorName } from '../../../src/features/modes/settings';
import { FakeElement, Notice, fakeDocument, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import type { DropdownComponent } from '../../obsidianStub';
import { stage } from './stage';
import type { Stage } from './stage';

const PHONE = { isDesktop: false, isMobile: true, isPhone: true };
const TABLET = { isDesktop: false, isMobile: true, isTablet: true };

/** What is open on the page and takes the Escape key for itself, if anything. */
let escapeTaker: FakeElement | null = null;

beforeEach(() => {
  Notice.shown.length = 0;
  escapeTaker = null;
  // The stand-in page cannot search itself; the one question the modes ask it is answered here.
  (fakeDocument as unknown as { querySelector: (selector: string) => FakeElement | null }).querySelector = (selector) => {
    expect(selector).toMatch(/\.modal-container/);
    return escapeTaker;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (fakeDocument as unknown as { querySelector?: unknown }).querySelector;
  resetFakeDocument();
  resetPlatform();
});

const notices = (): string[] => Notice.shown.map((notice) => notice.message);
const pressEscape = (extra: Record<string, unknown> = {}): void => {
  fakeDocument.dispatch('keydown', { key: 'Escape', defaultPrevented: false, isComposing: false, ...extra });
};
/** The list of extensions Obsidian was handed (one array, whose contents change). */
const handed = (s: Stage): unknown[] => (s.plugin.editorExtensions[0] as unknown[] | undefined) ?? [];
const corner = (s: Stage): FakeElement | undefined => s.body.withClass(CORNER_CLASS)[0];

describe('the commands', () => {
  it('are four, one for each mode, and each switches its mode on and off again', () => {
    const s = stage();
    expect(s.plugin.commands.map((command) => [command.id, command.name])).toEqual([
      ['toggle-zen-mode', 'Toggle Zen mode'],
      ['toggle-letter-box-mode', 'Toggle letter box mode'],
      ['toggle-typewriter-mode', 'Toggle typewriter mode'],
      ['toggle-hemingway-mode', 'Toggle Hemingway mode'],
    ]);
    expect(s.service.modes().map((mode) => mode.on)).toEqual([false, false, false, false]);
    for (const [index, command] of s.plugin.commands.entries()) {
      s.run(command.id);
      expect(s.service.modes()[index]?.on, command.id).toBe(true);
      s.run(command.id);
      expect(s.service.modes()[index]?.on, command.id).toBe(false);
    }
    expect(notices()).toEqual([
      'Zen mode on. Press Escape to leave.',
      'Zen mode off.',
      'Letter box mode on.',
      'Letter box mode off.',
      'Typewriter mode on.',
      'Typewriter mode off.',
      'Hemingway mode on.',
      'Hemingway mode off.',
    ]);
  });

  it('need no project: registering leaves nothing on the page, in the editors or on the device', () => {
    const s = stage();
    expect([...s.body.classes]).toEqual([]);
    expect(s.body.children).toEqual([]);
    expect(s.plugin.editorExtensions).toEqual([]);
    expect(s.fake.workspace.optionsUpdated).toBe(0);
    expect(s.fake.workspace.listenerCount()).toBe(0);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(s.storage.saves).toEqual([]);
  });

  it('tell a screen that listens, such as a bar with buttons, and offer it the same switches', () => {
    const s = stage();
    let heard = 0;
    const stop = s.service.onChange(() => heard++);
    s.run('toggle-typewriter-mode');
    expect(heard).toBe(1);
    expect(s.service.isOn('typewriter')).toBe(true);
    expect(s.service.modes()[2]).toEqual({ id: 'typewriter', name: 'Typewriter mode', commandId: 'toggle-typewriter-mode', on: true });
    s.service.set('typewriter', true); // already on: nothing happens
    expect(heard).toBe(1);
    s.service.toggle('typewriter');
    expect(heard).toBe(2);
    stop();
    s.service.toggle('zen');
    expect(heard).toBe(2);
  });
});

describe('what the device remembers', () => {
  it('is which modes are on, kept on the device and brought back the next time', () => {
    const first = stage();
    first.run('toggle-typewriter-mode');
    first.run('toggle-hemingway-mode');
    expect(first.storage.saves).toEqual([
      [MODES_ON_KEY, 'typewriter'],
      [MODES_ON_KEY, 'typewriter,hemingway'],
    ]);
    first.run('toggle-typewriter-mode');
    first.run('toggle-hemingway-mode');
    expect(first.storage.saves[3]).toEqual([MODES_ON_KEY, null]); // nothing on: nothing kept
    first.unload();
    resetFakeDocument();
    Notice.shown.length = 0;

    const again = stage({ stored: { [MODES_ON_KEY]: 'zen,letter-box' } });
    expect(again.service.modes().map((mode) => mode.on)).toEqual([true, true, false, false]);
    expect(again.body.hasClass(ZEN_CLASS)).toBe(true);
    expect(handed(again)).toHaveLength(1);
    expect(notices()).toEqual([]); // coming back is not announced
    expect(again.storage.saves).toEqual([]);
  });

  it('survives a storage that does not work', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const s = stage();
    s.storage.broken = true;
    s.run('toggle-zen-mode');
    expect(s.service.isOn('zen')).toBe(true); // until Obsidian closes
    expect(logged).toHaveBeenCalled();
  });
});

describe('Zen', () => {
  it('marks the page, folds the sidebars away, and opens the ones that were open again afterwards', () => {
    const s = stage({ open: { left: true } });
    s.body.addClass('theme-dark', 'someone-elses-zen');
    s.run('toggle-zen-mode');
    expect(s.body.hasClass(ZEN_CLASS)).toBe(true);
    expect(s.body.hasClass(ZEN_NO_PROPERTIES_CLASS)).toBe(true);
    expect(s.body.hasClass(ZEN_NO_TITLE_CLASS)).toBe(false);
    expect(s.fake.workspace.leftSplit.collapsed).toBe(true);
    expect(s.fake.workspace.rightSplit.collapses).toBe(0); // it was shut already
    expect(s.plugin.editorExtensions).toEqual([]); // Zen puts nothing into an editor
    expect(corner(s)).toBeUndefined(); // a desktop has an Escape key

    s.run('toggle-zen-mode');
    expect(BODY_CLASSES.filter((cls) => s.body.hasClass(cls))).toEqual([]);
    expect([...s.body.classes].sort()).toEqual(['someone-elses-zen', 'theme-dark']); // classes that are not the plugin's stay
    expect(s.fake.workspace.leftSplit.collapsed).toBe(false);
    expect(s.fake.workspace.rightSplit.collapsed).toBe(true); // it was shut before, and stays shut
    expect(fakeDocument.listenerCount()).toBe(0);
  });

  it('is left with Escape, unless something else is using the key', () => {
    const s = stage();
    s.run('toggle-zen-mode');
    pressEscape({ key: 'a' });
    pressEscape({ defaultPrevented: true }); // the editor's Vim mode took it
    pressEscape({ isComposing: true });
    escapeTaker = new FakeElement('div'); // a window, a menu or a list of suggestions is open
    pressEscape();
    expect(s.service.isOn('zen')).toBe(true);
    escapeTaker = null;
    pressEscape();
    expect(s.service.isOn('zen')).toBe(false);
    expect(fakeDocument.listenerCount('keydown')).toBe(0);
  });

  it('can be told to leave Escape alone', () => {
    const s = stage({ stored: { [MODES_SETTINGS_KEY]: JSON.stringify({ zenEscape: false }) } });
    s.run('toggle-zen-mode');
    expect(notices()).toEqual(['Zen mode on.']);
    pressEscape();
    expect(s.service.isOn('zen')).toBe(true);
  });

  for (const [name, platform] of [['a phone', PHONE], ['a tablet', TABLET]] as const) {
    it(`shows a button to leave on ${name}, which has no Escape key, and leaves its drawers alone`, () => {
      const s = stage({ platform, open: { left: true } });
      s.run('toggle-zen-mode');
      expect(notices()).toEqual(['Zen mode on. The button in the corner leaves it.']);
      const place = corner(s);
      expect(place?.parent).toBe(s.body);
      expect(place?.hasClass('spellbook-is-mobile')).toBe(true);
      const [exit] = s.body.withClass(EXIT_CLASS);
      expect(exit?.tag).toBe('button');
      expect(exit?.attrs['aria-label']).toBe(EXIT_ZEN_TEXT);
      expect(exit?.icon).not.toBeNull();
      expect(s.fake.workspace.leftSplit.collapses).toBe(0);

      exit?.fire('click');
      expect(s.service.isOn('zen')).toBe(false);
      expect(s.body.children).toEqual([]);
      expect(s.body.hasClass(ZEN_CLASS)).toBe(false);
    });
  }

  it('waits for Obsidian to put its panes back before it folds the sidebars, when it comes back on at start-up', () => {
    const s = stage({ stored: { [MODES_ON_KEY]: 'zen' }, ready: false, open: { left: true, right: true } });
    expect(s.body.hasClass(ZEN_CLASS)).toBe(true);
    expect(s.fake.workspace.leftSplit.collapsed).toBe(false);
    s.fake.workspace.becomeReady();
    expect(s.fake.workspace.leftSplit.collapsed).toBe(true);
    expect(s.fake.workspace.rightSplit.collapsed).toBe(true);
    s.run('toggle-zen-mode');
    expect(s.fake.workspace.leftSplit.collapsed).toBe(false);
    expect(s.fake.workspace.rightSplit.collapsed).toBe(false);
  });

  it('folds nothing if it was switched off again before Obsidian was ready', () => {
    const s = stage({ stored: { [MODES_ON_KEY]: 'zen' }, ready: false, open: { left: true } });
    s.run('toggle-zen-mode');
    s.fake.workspace.becomeReady();
    expect(s.fake.workspace.leftSplit.collapses).toBe(0);
  });
});

describe('Letter box and Typewriter', () => {
  it('hand the editors one list of extensions, made anew at every switch, and empty when both are off', () => {
    const s = stage();
    s.run('toggle-letter-box-mode');
    expect(s.plugin.editorExtensions).toHaveLength(1); // registered once, when first needed
    const list = s.plugin.editorExtensions[0];
    const [first] = handed(s);
    expect(handed(s)).toHaveLength(1);
    expect(s.fake.workspace.optionsUpdated).toBe(1);

    s.run('toggle-typewriter-mode');
    expect(s.plugin.editorExtensions).toEqual([list]); // the same array
    expect(handed(s)).toHaveLength(1); // one frame serves both
    expect(handed(s)[0]).not.toBe(first); // but a new one, so that the editors take it
    expect(s.fake.workspace.optionsUpdated).toBe(2);

    s.run('toggle-letter-box-mode');
    s.run('toggle-typewriter-mode');
    expect(handed(s)).toEqual([]);
    expect(s.fake.workspace.optionsUpdated).toBe(4);
    expect([...s.body.classes]).toEqual([]); // neither puts anything on the page itself
  });
});

describe('Hemingway', () => {
  it('shows a lock in the header of every note, which switches the mode off', () => {
    const s = stage();
    const note = s.openNote();
    const board = s.openNote('spellbook-corkboard');
    s.run('toggle-hemingway-mode');
    expect(handed(s)).toHaveLength(1);
    expect(note.header.children).toHaveLength(1);
    expect(board.header.children).toEqual([]); // only notes
    const [lock] = note.header.children;
    expect(lock?.hasClass(LOCK_CLASS)).toBe(true);
    expect(lock?.attrs['aria-label']).toMatch(/Hemingway mode is on/);

    const later = s.openNote(); // a note opened while the mode is on gets its lock too
    expect(later.header.children).toHaveLength(1);
    expect(note.header.children).toHaveLength(1); // and nobody gets a second one

    lock?.dispatch('click');
    expect(s.service.isOn('hemingway')).toBe(false);
    expect(note.header.children).toEqual([]);
    expect(later.header.children).toEqual([]);
    expect(s.fake.workspace.listenerCount()).toBe(0);
    expect(handed(s)).toEqual([]);
  });

  it('puts the lock in the corner of the screen while Zen hides the headers', () => {
    const s = stage();
    s.run('toggle-hemingway-mode');
    expect(corner(s)).toBeUndefined();
    s.run('toggle-zen-mode');
    const [lock] = corner(s)?.withClass(LOCK_CLASS) ?? [];
    expect(lock?.tag).toBe('button');
    expect(s.body.withClass(EXIT_CLASS)).toEqual([]); // a desktop leaves Zen with Escape
    lock?.fire('click');
    expect(s.service.isOn('hemingway')).toBe(false);
    expect(s.service.isOn('zen')).toBe(true);
    expect(corner(s)).toBeUndefined();
  });

  it('says once why nothing happens, and lights the lock and the edge of the editor for a moment', () => {
    const s = stage();
    const note = s.openNote();
    s.run('toggle-hemingway-mode');
    Notice.shown.length = 0;
    const editor = new FakeElement('div');
    const [lock] = note.header.children;
    // The same key is refused in two places: once where the editor is known, once where it is not.
    const blocked = blockedFrom(s);
    blocked('delete', null);
    blocked('delete', editor);
    expect(editor.children).toEqual([]); // nothing is touched from inside the editor's own work
    s.frame();
    expect(notices()).toEqual(['Deleting is switched off while Hemingway mode is on: the draft only moves forward. Press the lock to switch it off.']);
    expect(Notice.shown[0]?.duration).toBe(REFUSED_NOTICE_MS);
    expect(lock?.hasClass(FLASH_CLASS)).toBe(true);
    expect(editor.withClass(REFUSED_CLASS)).toHaveLength(1);
    s.timers.advance(FLASH_MS);
    expect(lock?.hasClass(FLASH_CLASS)).toBe(false);
    expect(editor.children).toEqual([]);

    blocked('undo', editor);
    s.frame();
    expect(notices()).toHaveLength(1); // told once
    expect(editor.withClass(REFUSED_CLASS)).toHaveLength(1);
    s.unload(); // in the middle of a flash
    expect(editor.children).toEqual([]);
    expect(s.timers.pending).toBe(0);
  });
});

/**
 * What the editors call when Hemingway refuses something. The editors of
 * the tests have no screen, so the report is made by hand: it is the
 * controller's own, reached through the chrome it made.
 */
function blockedFrom(s: Stage): (what: 'delete' | 'undo', editorEl: FakeElement | null) => void {
  const controller = s.service as unknown as { chrome: { blocked(what: string, editorEl: unknown): void } };
  return (what, editorEl) => {
    controller.chrome.blocked(what, editorEl);
  };
}

describe('the settings', () => {
  function drawn(s: Stage) {
    const [section] = s.registered.settingsSections;
    const place = new FakeElement('div');
    section?.render(place as never);
    const row = (name: string) => {
      const found = place.settings.find((setting) => setting.nameEl.text === name);
      if (!found) throw new Error(`no row "${name}"`);
      return found;
    };
    return { section, place, row };
  }

  it('are one section, with a row for everything that can be tuned', () => {
    const s = stage();
    const { section, place, row } = drawn(s);
    expect([section?.id, section?.title]).toEqual(['modes', 'Writing modes']);
    expect(place.children[0]?.text).toBe(MODES_INTRO_TEXT);
    expect(place.settings.map((setting) => setting.nameEl.text)).toEqual([
      'Letter box: height of the band',
      'Letter box: text outside the band',
      'Typewriter: where the line rests',
      'Zen: hide properties',
      'Zen: hide the title',
      'Zen: leave with Escape',
    ]);
    const band = row('Letter box: height of the band').components[0] as DropdownComponent;
    expect(band.getValue()).toBe('40');
    expect(band.selectEl.children.map((option) => option.text)).toEqual(['20%', '30%', '40%', '50%', '60%', '70%']);
    const rest = row('Typewriter: where the line rests').components[0] as DropdownComponent;
    expect(rest.getValue()).toBe('50');
    expect(rest.selectEl.children.map((option) => option.text)).toContain('In the middle');
    expect([anchorName(20), anchorName(50), anchorName(80)]).toEqual(['20% from the top', 'In the middle', '20% from the bottom']);
    expect(row('Zen: hide properties').toggles[0]?.getValue()).toBe(true);
    expect(row('Zen: hide the title').toggles[0]?.getValue()).toBe(false);
  });

  it('start with the line above the middle on a phone', () => {
    const { row } = drawn(stage({ platform: PHONE }));
    expect((row('Typewriter: where the line rests').components[0] as DropdownComponent).getValue()).toBe('40');
  });

  it('are kept on the device, and the modes that are on follow them at once', () => {
    const s = stage();
    s.run('toggle-zen-mode');
    s.run('toggle-letter-box-mode');
    const before = handed(s)[0];
    const updates = s.fake.workspace.optionsUpdated;
    s.storage.saves.length = 0;
    const { row } = drawn(s);

    row('Zen: hide the title').toggles[0]?.flip();
    expect(s.body.hasClass(ZEN_NO_TITLE_CLASS)).toBe(true);
    row('Zen: hide properties').toggles[0]?.flip();
    expect(s.body.hasClass(ZEN_NO_PROPERTIES_CLASS)).toBe(false);

    (row('Letter box: height of the band').components[0] as DropdownComponent).choose('60');
    (row('Letter box: text outside the band').components[0] as DropdownComponent).choose('hidden');
    (row('Typewriter: where the line rests').components[0] as DropdownComponent).choose('30');
    expect(handed(s)[0]).not.toBe(before); // the editors were handed the new band
    expect(s.fake.workspace.optionsUpdated).toBeGreaterThan(updates);
    expect(s.storage.saves.every(([key]) => key === MODES_SETTINGS_KEY)).toBe(true);
    expect(JSON.parse(s.storage.saves[s.storage.saves.length - 1]?.[1] as string)).toEqual({
      bandPercent: 60,
      bandShade: 'hidden',
      anchorPercent: 30,
      zenHideProperties: false,
      zenHideTitle: true,
      zenEscape: true,
    });

    // Choosing what is chosen already saves nothing.
    const saved = s.storage.saves.length;
    (row('Letter box: height of the band').components[0] as DropdownComponent).choose('60');
    (row('Letter box: text outside the band').components[0] as DropdownComponent).choose('no such shade');
    expect(s.storage.saves).toHaveLength(saved);
    // And the next time, the rows show what was chosen.
    expect((drawn(s).row('Letter box: height of the band').components[0] as DropdownComponent).getValue()).toBe('60');
  });
});

describe('switching the plugin off', () => {
  it('leaves no trace: no class, no element, no listener, nothing in the editors, and the sidebars as they were', () => {
    const s = stage({ platform: TABLET, open: { right: true } });
    resetPlatform();
    const desktop = stage({ open: { right: true } });
    for (const each of [s, desktop]) {
      each.body.addClass('theme-dark');
      const note = each.openNote();
      for (const command of each.plugin.commands) each.run(command.id);
      expect(each.service.modes().every((mode) => mode.on)).toBe(true);
      expect(note.header.children).toHaveLength(1);
      expect(handed(each)).toHaveLength(2);
      const updates = each.fake.workspace.optionsUpdated;

      each.unload();
      expect([...each.body.classes]).toEqual(['theme-dark']);
      expect(each.body.children).toEqual([]);
      expect(note.header.children).toEqual([]);
      expect(fakeDocument.listenerCount()).toBe(0);
      expect(each.fake.workspace.listenerCount()).toBe(0);
      expect(each.plugin.editorExtensions).toEqual([]);
      expect(each.fake.workspace.optionsUpdated).toBe(updates + 1); // the editors were told to drop everything
      expect(each.plugin.domEventCount).toBe(0);
      expect(each.timers.pending).toBe(0);
      expect(each.registered.services.get('modes.state')).toBeUndefined();
      // What was on is still remembered, for the next time.
      expect(each.storage.load(MODES_ON_KEY)).toBe('zen,letter-box,typewriter,hemingway');
      each.body.classes.clear();
    }
    expect(desktop.fake.workspace.rightSplit.collapsed).toBe(false); // opened again
    expect(s.fake.workspace.rightSplit.collapses).toBe(0); // a tablet's drawers were never touched

    // Nothing can be switched any more.
    desktop.service.toggle('zen');
    expect(desktop.body.hasClass(ZEN_CLASS)).toBe(false);
    expect(desktop.service.isOn('zen')).toBe(true); // as it was left
  });

  it('with nothing on, does not even bother the editors', () => {
    const s = stage();
    s.unload();
    expect(s.fake.workspace.optionsUpdated).toBe(0);
    expect(s.storage.saves).toEqual([]);
  });
});
