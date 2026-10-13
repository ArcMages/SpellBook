// The bottom bar as the writer lays it out: which figures it shows and in
// what order, the shortcut buttons, the ready-made bars, and the part of the
// settings where all of that is chosen. Run through a stand-in context (see
// stand.ts).

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BAR_LAYOUT, MEASURE_AFTER_MS, addBarButton, addBarItem, parseBarLayout, serializeBarLayout } from '../../../src/core/progress/index';
import type { BarLayout } from '../../../src/core/progress/index';
import { BAR_LAYOUT_KEY } from '../../../src/features/progress/barPrefs';
import { CommandPicker } from '../../../src/features/progress/commandPicker';
import { findCommand, listCommands, runCommand } from '../../../src/features/progress/commands';
import { StatusBar } from '../../../src/features/progress/statusBar';
import { TargetsModal } from '../../../src/features/progress/targetsModal';
import { FakeElement, Menu, Modal, Notice, Platform, resetFakeDocument, resetPlatform, unknownIcons } from '../../obsidianStub';
import type { ButtonComponent, Setting, TextComponent } from '../../obsidianStub';
import { DAY, makeStand } from './stand';
import type { Stand } from './stand';

vi.mock('obsidian', async (importOriginal) => {
  const { withProgressExtras } = await import('./obsidianExtras');
  return withProgressExtras(await importOriginal<typeof import('../../obsidianStub')>());
});

const OPENING = 'Novel/Manuscript/Opening.md';
const TODO = 'Novel/To-do.md';
const ZEN = 'spellbook-novel-writer:toggle-zen-mode';
const PAUSE = MEASURE_AFTER_MS + 100;
const FRAME = 20;

const DRAFT = 'טיוטה'; // "draft", in Hebrew

const stands: Stand[] = [];

/** A stand whose device already remembers a layout of the bar (when one is given). */
async function standUp(options?: Parameters<typeof makeStand>[0], layout?: BarLayout): Promise<Stand> {
  const stand = await makeStand({
    ...options,
    ...(layout ? { stored: { [BAR_LAYOUT_KEY]: serializeBarLayout(layout) } } : {}),
  });
  stands.push(stand);
  return stand;
}

/** The settings, as the writer sees them: the place they are drawn in, and what to call when they close. */
interface Settings {
  readonly place: FakeElement;
  /** The rows of the bar's part, as they are now. */
  rows(): Setting[];
  row(name: string): Setting;
  press(row: string, button: string): void;
  close(): void;
}

function openSettings(stand: Stand): Settings {
  const place = new FakeElement();
  const closing = stand.features.settingsSections[0]?.render(place as never);
  const rows = (): Setting[] => {
    const body = place.withClass('spellbook-bar-settings-body')[0];
    if (!body) throw new Error('the bar has no settings');
    const list = body.withClass('spellbook-bar-settings-list')[0];
    return [...body.settings, ...(list?.settings ?? [])];
  };
  const row = (name: string): Setting => {
    const found = rows().filter((candidate) => candidate.nameEl.text === name);
    if (found.length !== 1) throw new Error(`expected one row "${name}", found ${found.length} among ${rows().map((r) => r.nameEl.text).join(' | ')}`);
    return found[0] as Setting;
  };
  return {
    place,
    rows,
    row,
    press: (rowName, text) => {
      const button = (row(rowName).components as ButtonComponent[]).find((candidate) => candidate.buttonEl?.text === text);
      if (!button) throw new Error(`the row "${rowName}" has no button "${text}"`);
      button.click();
    },
    close: () => {
      if (typeof closing === 'function') closing();
    },
  };
}

/** The names of the rows that stand for what is in the bar, in order. */
const entries = (settings: Settings): string[] =>
  settings
    .rows()
    .filter((row) => row.settingEl.hasClass('spellbook-bar-settings-entry'))
    .map((row) => row.nameEl.text);

async function drawn(stand: Stand): Promise<void> {
  await stand.pass(FRAME);
  await stand.pass(FRAME);
}

function theBar(stand: Stand): FakeElement {
  const bar = stand.bar();
  if (!bar) throw new Error('no status bar item');
  return bar;
}

const buttonsOf = (bar: FakeElement): FakeElement[] => bar.withClass('spellbook-status-button');

function lastMenu(): Menu {
  const menu = Menu.shown[Menu.shown.length - 1];
  if (!menu) throw new Error('no menu was shown');
  return menu;
}

beforeEach(() => {
  Notice.shown.length = 0;
  Modal.opened.length = 0;
  Menu.shown.length = 0;
  unknownIcons.clear();
  resetFakeDocument();
});

afterEach(async () => {
  for (const stand of stands.splice(0)) await stand.unload();
  resetPlatform();
  unknownIcons.clear();
  vi.restoreAllMocks();
});

describe('the bar as a device starts with it', () => {
  it('looks as it always did, and stores nothing', async () => {
    const stand = await standUp({ extra: { targets: { daily: 2 } } });
    stand.workspace.show(OPENING);
    await drawn(stand);
    const bar = theBar(stand);
    expect(bar.fullText).toBe('Words 9 Session 0 Project 19 Today 0 / 2');
    expect(bar.children.map((piece) => [...piece.classes].sort())).toEqual([
      ['spellbook-status-scene', 'spellbook-status-segment'],
      ['spellbook-status-segment', 'spellbook-status-session'],
      ['spellbook-status-project', 'spellbook-status-segment'],
      ['spellbook-status-segment', 'spellbook-status-today'],
    ]);
    expect(bar.attrs['role']).toBe('button');
    expect(stand.storage.saves.filter(([key]) => key === BAR_LAYOUT_KEY)).toEqual([]);
  });
});

describe('the bar\'s part of the settings', () => {
  it('lists what is in the bar, in order, with the ready-made bars and a way back to the start', async () => {
    const stand = await standUp();
    const settings = openSettings(stand);
    expect(settings.rows().map((row) => row.nameEl.text)).toEqual([
      'Bottom bar',
      'Ready-made bars',
      'Reset to default',
      'Add to the bar',
      '1. Scene words',
      '2. Date started',
      '3. Date last edited',
      '4. Session words',
      '5. Project words',
      '6. Words today',
    ]);
    expect(settings.row('Bottom bar').settingEl.hasClass('setting-item-heading')).toBe(true);
    expect((settings.row('Ready-made bars').components as ButtonComponent[]).map((button) => button.buttonEl.text)).toEqual([
      'Minimal',
      'Drafting',
      'Everything',
    ]);
    // Nothing to reset yet, and looking at the settings stores nothing.
    expect((settings.row('Reset to default').components[0] as ButtonComponent).disabled).toBe(true);
    expect(stand.storage.saves).toEqual([]);
    // Every row can be moved and removed with buttons: no dragging is needed.
    expect((settings.row('2. Date started').components as ButtonComponent[]).map((button) => button.buttonEl.text)).toEqual([
      'Move up',
      'Move down',
      'Remove',
    ]);
    expect((settings.row('1. Scene words').components[0] as ButtonComponent).disabled).toBe(true);
    expect((settings.row('6. Words today').components[1] as ButtonComponent).disabled).toBe(true);
    settings.close();
    expect(settings.place.withClass('spellbook-bar-settings-body')).toEqual([]);
  });

  it('moves, removes and adds figures; the bar follows at once and the device remembers', async () => {
    const stand = await standUp({ extra: { targets: { daily: 2 } } });
    stand.workspace.show(OPENING);
    await drawn(stand);
    const bar = theBar(stand);
    const settings = openSettings(stand);

    settings.press('6. Words today', 'Move up');
    settings.press('5. Words today', 'Move up');
    expect(entries(settings)).toEqual([
      '1. Scene words',
      '2. Date started',
      '3. Date last edited',
      '4. Words today',
      '5. Session words',
      '6. Project words',
    ]);
    await drawn(stand);
    expect(bar.fullText).toBe('Words 9 Today 0 / 2 Session 0 Project 19');

    settings.press('6. Project words', 'Remove');
    settings.press('5. Session words', 'Remove');
    await drawn(stand);
    expect(bar.fullText).toBe('Words 9 Today 0 / 2');

    // Only what is not in the bar yet is offered.
    settings.press('Add to the bar', 'Add figure');
    expect(lastMenu().items.map((item) => item.title)).toEqual([
      'Scene target',
      'Session words',
      'Project words',
      'Reading time',
      'Status',
      'To-dos due',
      'Scene title',
    ]);
    lastMenu().item('Reading time').click();
    expect(entries(settings)[4]).toBe('5. Reading time');
    await drawn(stand);
    expect(bar.fullText).toBe('Words 9 Today 0 / 2 Reading <1 min');

    // What is kept is kept on this device, as text the engine reads back.
    const kept = parseBarLayout(stand.storage.load(BAR_LAYOUT_KEY));
    expect(kept.entries).toEqual([
      { kind: 'item', id: 'scene' },
      { kind: 'item', id: 'started' },
      { kind: 'item', id: 'edited' },
      { kind: 'item', id: 'today' },
      { kind: 'item', id: 'reading' },
    ]);

    settings.press('Reset to default', 'Reset');
    await drawn(stand);
    expect(bar.fullText).toBe('Words 9 Session 0 Project 19 Today 0 / 2');
    // The default is not stored at all.
    expect(stand.storage.values.has(BAR_LAYOUT_KEY)).toBe(false);
  });

  it('applies a ready-made bar, keeping the writer\'s buttons', async () => {
    const stand = await standUp();
    stand.commands.add(ZEN, 'Spellbook: Toggle zen mode');
    stand.workspace.show(OPENING);
    await drawn(stand);
    const settings = openSettings(stand);

    settings.press('Add to the bar', 'Add button');
    const picker = Modal.opened[Modal.opened.length - 1];
    if (!(picker instanceof CommandPicker)) throw new Error('no command picker');
    // (The stand-in's own way of choosing a row of the list.)
    (picker as unknown as { pick(text: string): void }).pick('Spellbook: Toggle zen mode');
    expect(entries(settings)[6]).toBe('7. Button: Spellbook: Toggle zen mode');

    settings.press('Ready-made bars', 'Minimal');
    expect(entries(settings)).toEqual(['1. Scene words', '2. Words today', '3. Button: Spellbook: Toggle zen mode']);
    await drawn(stand);
    expect(theBar(stand).fullText).toBe('Words 9 Today 0 Spellbook: Toggle zen mode');

    settings.press('Ready-made bars', 'Everything');
    expect(entries(settings)).toHaveLength(12);
    settings.press('Add to the bar', 'Add figure'); // nothing is left to add
    expect(Menu.shown).toEqual([]);

    // Back at the start, the buttons are gone as well.
    settings.press('Reset to default', 'Reset');
    expect(parseBarLayout(stand.storage.load(BAR_LAYOUT_KEY))).toEqual(DEFAULT_BAR_LAYOUT);
    expect(entries(settings)).toHaveLength(6);
  });

  it('gives a button a label and an icon, without drawing the rows again while the writer types', async () => {
    const stand = await standUp(undefined, addBarButton({ entries: [] }, ZEN));
    stand.commands.add(ZEN, 'Spellbook: Toggle zen mode');
    stand.workspace.show(OPENING);
    await drawn(stand);
    const settings = openSettings(stand);
    const name = '1. Button: Spellbook: Toggle zen mode';
    const body = settings.place.withClass('spellbook-bar-settings-body')[0];

    const label = settings.row(name).components[0] as TextComponent;
    expect(label.inputEl.attrs['dir']).toBe('auto');
    label.type('זן');
    expect(settings.place.withClass('spellbook-bar-settings-body')[0]).toBe(body); // the field kept the keyboard
    await drawn(stand);
    const button = buttonsOf(theBar(stand))[0];
    expect(button?.fullText).toBe('זן');
    expect(button?.withClass('spellbook-status-button-label')[0]?.attrs['dir']).toBe('auto');

    settings.press(name, 'Icon: none');
    expect(lastMenu().items[0]?.title).toBe('No icon');
    lastMenu().item('eye').click();
    expect((settings.row(name).components[1] as ButtonComponent).buttonEl.text).toBe('Icon: eye');
    await drawn(stand);
    expect(buttonsOf(theBar(stand))[0]?.withClass('spellbook-status-button-icon')[0]?.icon).toBe('eye');
    expect(parseBarLayout(stand.storage.load(BAR_LAYOUT_KEY)).entries).toEqual([
      { kind: 'button', command: ZEN, label: 'זן', icon: 'eye' },
    ]);
  });

  it('says so when a button\'s command is not there, and still lets it be moved and removed', async () => {
    const stand = await standUp(undefined, addBarButton(DEFAULT_BAR_LAYOUT, ZEN));
    const settings = openSettings(stand);
    const row = settings.row(`7. Button: ${ZEN}`);
    expect(row.descEl.text).toContain('not available');
    settings.press(`7. Button: ${ZEN}`, 'Remove');
    expect(entries(settings)).toHaveLength(6);
  });
});

describe('shortcut buttons in the bar', () => {
  it('run their command when pressed, and never open the targets window', async () => {
    const layout = addBarButton(addBarButton(DEFAULT_BAR_LAYOUT, ZEN, 'Zen'), 'editor:toggle-bold', '', 'type');
    const stand = await standUp(undefined, layout);
    stand.commands.add(ZEN, 'Spellbook: Toggle zen mode');
    stand.commands.add('editor:toggle-bold', 'Toggle bold');
    stand.workspace.show(OPENING);
    await drawn(stand);
    const bar = theBar(stand);
    expect(bar.attrs['role']).toBe('group');
    const [zen, bold] = buttonsOf(bar);
    if (!zen || !bold) throw new Error('the buttons are not there');
    expect(zen.fullText).toBe('Zen');
    expect(zen.attrs['aria-label']).toBe('Zen: Spellbook: Toggle zen mode');
    expect(zen.attrs['role']).toBe('button');
    // An icon alone: no text, but a name for whoever cannot see it.
    expect(bold.fullText).toBe('');
    expect(bold.withClass('spellbook-status-button-icon')[0]?.icon).toBe('type');
    expect(bold.attrs['aria-label']).toBe('Toggle bold');

    let stopped = 0;
    let prevented = 0;
    zen.dispatch('mousedown', { preventDefault: () => prevented++ });
    zen.dispatch('click', { stopPropagation: () => stopped++ });
    expect(prevented).toBe(1); // the note keeps the keyboard
    expect(stopped).toBe(1); // the bar itself does not hear the click
    bold.dispatch('keydown', { key: 'Enter', preventDefault: () => undefined, stopPropagation: () => undefined });
    bold.dispatch('keydown', { key: 'a' });
    expect(stand.commands.ran).toEqual([ZEN, 'editor:toggle-bold']);
    expect(Modal.opened.filter((modal) => modal instanceof TargetsModal)).toEqual([]);

    // A click on a figure still opens the targets window.
    bar.dispatch('click');
    expect(Modal.opened.filter((modal) => modal instanceof TargetsModal)).toHaveLength(1);
  });

  it('show as unavailable and do nothing when the command does not exist, and come to life when it does', async () => {
    const stand = await standUp(undefined, addBarButton({ entries: [{ kind: 'item', id: 'scene' }] }, ZEN, '', 'eye'));
    stand.workspace.show(OPENING);
    await drawn(stand);
    const bar = theBar(stand);
    const button = buttonsOf(bar)[0];
    if (!button) throw new Error('the button is not there');
    expect(button.hasClass('spellbook-is-unavailable')).toBe(true);
    expect(button.attrs['aria-disabled']).toBe('true');
    expect(button.attrs['aria-label']).toBe(`${ZEN} (this command is not available)`);
    expect(() => button.dispatch('click', {})).not.toThrow();
    expect(stand.commands.ran).toEqual([]);
    expect(Notice.shown).toEqual([]);

    // The other plugin is switched on: the next time the bar is drawn, the button works.
    stand.commands.add(ZEN, 'Toggle zen mode');
    stand.editor(OPENING).type('More words here. ');
    await stand.pass(PAUSE);
    const now = buttonsOf(bar)[0];
    expect(now?.hasClass('spellbook-is-unavailable')).toBe(false);
    expect(now?.attrs['aria-disabled']).toBeUndefined();
    now?.dispatch('click', {});
    expect(stand.commands.ran).toEqual([ZEN]);
  });

  it('fall back on words when Obsidian does not know the icon', async () => {
    unknownIcons.add('no-such-icon');
    const stand = await standUp(undefined, addBarButton({ entries: [] }, ZEN, '', 'no-such-icon'));
    stand.commands.add(ZEN, 'Toggle zen mode');
    await drawn(stand);
    const button = buttonsOf(theBar(stand))[0];
    expect(button?.fullText).toBe('Toggle zen mode');
    expect(button?.withClass('spellbook-status-button-icon')).toEqual([]);
  });

  it('are let go of when the plugin unloads', async () => {
    const stand = await standUp(undefined, addBarButton(DEFAULT_BAR_LAYOUT, ZEN));
    stand.commands.add(ZEN, 'Toggle zen mode');
    await drawn(stand);
    const button = buttonsOf(theBar(stand))[0];
    expect(button?.listenerCount()).toBe(3);
    await stand.unload();
    expect(button?.listenerCount()).toBe(0);
    button?.dispatch('click', {});
    expect(stand.commands.ran).toEqual([]);
  });
});

describe('commands, looked up carefully', () => {
  it('are an empty list, and cannot be run, in an app that keeps them somewhere else', () => {
    for (const app of [{}, { commands: null }, { commands: 7 }, { commands: { commands: 'x' } }, null]) {
      expect(listCommands(app as never)).toEqual([]);
      expect(findCommand(app as never, 'a:b')).toBeNull();
      expect(runCommand(app as never, 'a:b')).toBe(false);
    }
  });

  it('are listed by name; one that fails when run is caught', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = {
      commands: {
        commands: { 'b:two': { id: 'b:two', name: 'Zebra' }, 'a:one': { id: 'a:one', name: 'Apple' }, 'c:three': {}, toString: 'odd' },
        executeCommandById: (id: string): boolean => {
          if (id === 'b:two') throw new Error('broken');
          return true;
        },
      },
    };
    expect(listCommands(app as never)).toEqual([
      { id: 'a:one', name: 'Apple' },
      { id: 'c:three', name: 'c:three' },
      { id: 'b:two', name: 'Zebra' },
    ]);
    expect(runCommand(app as never, 'a:one')).toBe(true);
    expect(runCommand(app as never, 'b:two')).toBe(false);
    expect(runCommand(app as never, 'constructor')).toBe(false);
  });
});

describe('the figures the writer can add', () => {
  it('show the status in the writer\'s own language and direction, with its colour', async () => {
    const layout: BarLayout = { entries: [{ kind: 'item', id: 'title' }, { kind: 'item', id: 'status' }, { kind: 'item', id: 'scene' }] };
    const stand = await standUp({ extra: { statuses: [{ name: DRAFT, color: 'blue' }] } }, layout);
    stand.workspace.show(OPENING);
    await drawn(stand);
    const bar = theBar(stand);
    // The scenes of the stand start as "To do", which this project does not list: shown as written, without a colour.
    expect(bar.fullText).toBe('Scene Opening Status To do Words 9');
    stand.vault.external.editFrontmatter(OPENING, (frontmatter) => {
      frontmatter['status'] = `  ${DRAFT} `;
    });
    await drawn(stand);
    expect(bar.fullText).toBe(`Scene Opening Status ${DRAFT} Words 9`);
    const status = bar.withClass('spellbook-status-status')[0];
    expect(status?.hasClass('spellbook-status-color-blue')).toBe(true);
    expect(status?.withClass('spellbook-status-value')[0]?.attrs['dir']).toBe('auto');
    expect(bar.withClass('spellbook-status-title')[0]?.withClass('spellbook-status-value')[0]?.attrs['dir']).toBe('auto');
    expect(bar.withClass('spellbook-status-scene')[0]?.withClass('spellbook-status-value')[0]?.attrs['dir']).toBe('ltr');
  });

  it('show the scene target with a small progress bar, and the reading time', async () => {
    const layout: BarLayout = { entries: [{ kind: 'item', id: 'scene' }, { kind: 'item', id: 'target' }, { kind: 'item', id: 'reading' }] };
    const stand = await standUp(undefined, layout);
    stand.workspace.show(OPENING);
    await drawn(stand);
    const bar = theBar(stand);
    expect(bar.fullText).toBe('Words 9 Reading <1 min'); // no target yet: no such piece
    stand.vault.external.editFrontmatter(OPENING, (frontmatter) => {
      frontmatter['target'] = 12;
    });
    await drawn(stand);
    expect(bar.fullText).toBe('Words 9 Target 75% of 12 Reading <1 min');
    const fill = bar.withClass('spellbook-status-meter-fill')[0];
    expect(fill?.style['width']).toBe('75%');

    stand.editor(OPENING).type('One two three. ');
    await stand.pass(PAUSE);
    expect(bar.fullText).toBe('Words 12 Target 100% of 12 Reading <1 min');
    expect(bar.withClass('spellbook-status-meter-fill')[0]).toBe(fill);
    expect(fill?.style['width']).toBe('100%');
    expect(bar.withClass('spellbook-status-target')[0]?.hasClass('spellbook-is-met')).toBe(true);
  });

  it('count the to-dos that are due from To-do.md, reading the file only when it changed', async () => {
    const todo = [`- [ ] Late \u{1F4C5} 2026-10-01`, `- [ ] Today \u{1F4C5} ${DAY}`, `- [x] Done today \u{1F4C5} ${DAY}`, '- [ ] Some day', `- [ ] Later \u{1F4C5} 2026-11-01`].join('\n');
    const stand = await standUp(
      { prepare: (vault) => void vault.seed(TODO, { body: todo }) },
      { entries: [{ kind: 'item', id: 'todos' }] },
    );
    stand.workspace.show(OPENING);
    await drawn(stand);
    const bar = theBar(stand);
    expect(bar.fullText).toBe('To-dos due 2 (1 late)');
    expect(bar.withClass('spellbook-status-todos')[0]?.hasClass('spellbook-is-late')).toBe(true);

    // Typing draws the bar again, and reads no file for it.
    const reads = stand.vault.reads.readText;
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    await stand.pass(PAUSE);
    editor.type('Four five. ');
    await stand.pass(PAUSE);
    expect(stand.vault.reads.readText).toBe(reads);

    stand.vault.external.write(TODO, { body: `- [ ] Today \u{1F4C5} ${DAY}\n` });
    await drawn(stand);
    expect(bar.fullText).toBe('To-dos due 1');
    expect(bar.withClass('spellbook-status-todos')[0]?.hasClass('spellbook-is-late')).toBe(false);

    // The next day, today's to-do is late.
    stand.clock.date = '2026-10-14';
    await stand.pass(7 * 60 * 60 * 1000);
    expect(bar.fullText).toBe('To-dos due 1 (1 late)');
  });

  it('do not read To-do.md, nor the word logs, for a bar that shows neither', async () => {
    const stand = await standUp(
      { prepare: (vault) => void vault.seed(TODO, { body: '- [ ] One\n' }) },
      { entries: [{ kind: 'item', id: 'scene' }, { kind: 'item', id: 'session' }] },
    );
    stand.workspace.show(OPENING);
    await drawn(stand);
    expect(theBar(stand).fullText).toBe('Words 9 Session 0');
    // The two scenes were counted, each read once; nothing else was read.
    expect(stand.vault.reads.readText).toBe(2);
  });
});

describe('drawing the bar', () => {
  it('touches only the piece whose figure changed, and keeps every element it drew', async () => {
    const stand = await standUp({ extra: { targets: { daily: 2 } } }, addBarButton(DEFAULT_BAR_LAYOUT, ZEN, 'Zen'));
    stand.commands.add(ZEN, 'Toggle zen mode');
    stand.workspace.show(OPENING);
    const editor = stand.editor(OPENING);
    editor.type('One two three. ');
    await stand.pass(PAUSE);
    await drawn(stand);
    const bar = theBar(stand);
    expect(bar.fullText).toBe('Words 12 Edited 13 Oct 2026 Session 3 Project 19 Today 3 / 2 Zen');
    const before = [...bar.children];
    const values = bar.withClass('spellbook-status-value');
    const written: string[] = [];
    for (const value of values) {
      const setText = value.setText.bind(value);
      value.setText = (text: string): void => {
        written.push(text);
        setText(text);
      };
    }

    // While the writer types, nothing is drawn at all.
    editor.type('Four ');
    editor.type('five. ');
    await stand.pass(200);
    expect(written).toEqual([]);

    await stand.pass(PAUSE);
    expect(bar.fullText).toBe('Words 14 Edited 13 Oct 2026 Session 5 Project 19 Today 5 / 2 Zen');
    // The same elements, button included; only the three figures that changed were written.
    expect(bar.children).toEqual(before);
    bar.children.forEach((child, at) => expect(child).toBe(before[at]));
    expect(written).toEqual(['14', '5', '5 / 2']);

    // Drawn again with nothing changed, nothing is written.
    stand.vault.external.write('Novel/Research/Castle.md', { body: 'Notes on the castle.\n' });
    await drawn(stand);
    expect(written).toEqual(['14', '5', '5 / 2']);
  });

  it('on its own: draws once, then changes one piece at a time', () => {
    const element = new FakeElement();
    const bar = new StatusBar(element as never, () => undefined);
    bar.show([
      { id: 'scene', label: 'Words', value: '9' },
      { id: 'today', label: 'Today', value: '0 / 2', met: false },
    ]);
    expect(bar.touched).toBe(2);
    const [scene, today] = element.children;
    bar.show([
      { id: 'scene', label: 'Words', value: '9' },
      { id: 'today', label: 'Today', value: '3 / 2', met: true },
    ]);
    expect(bar.touched).toBe(3);
    expect(element.children[0]).toBe(scene);
    expect(element.children[1]).toBe(today);
    expect(today?.hasClass('spellbook-is-met')).toBe(true);
    expect(element.fullText).toBe('Words 9 Today 3 / 2');
    bar.show([
      { id: 'scene', label: 'Words', value: '9' },
      { id: 'today', label: 'Today', value: '3 / 2', met: true },
    ]);
    expect(bar.touched).toBe(3);
    // Another set of pieces: drawn afresh.
    bar.show([{ id: 'scene', label: 'Words', value: '9' }]);
    expect(element.children).toHaveLength(1);
    expect(element.children[0]).not.toBe(scene);
    bar.show([]);
    expect(element.hasClass('spellbook-is-empty')).toBe(true);
  });
});

describe('a bar too long for the window', () => {
  const FIGURES = [
    { id: 'scene', label: 'Words', value: '9' },
    { id: 'today', label: 'Today', value: '0 / 2', met: false },
  ] as const;

  /** A bar whose contents are `content` wide in a place `room` wide, slid `slid` along. */
  function long(content: number, room: number, slid = 0): { element: FakeElement; bar: StatusBar; page: { scrollLeft: number } } {
    const element = new FakeElement();
    const page = element as unknown as { scrollLeft: number; scrollWidth: number; clientWidth: number };
    Object.assign(page, { scrollWidth: content, clientWidth: room, scrollLeft: slid });
    const bar = new StatusBar(element as never, () => undefined);
    bar.show([...FIGURES]);
    return { element, bar, page };
  }
  const edges = (element: FakeElement): string[] => ['spellbook-more-at-start', 'spellbook-more-at-end'].filter((cls) => element.hasClass(cls));
  /** A turn of the wheel; gives whether the bar took it for itself. */
  function turn(element: FakeElement, wheel: { deltaX?: number; deltaY?: number; deltaMode?: number }): boolean {
    let taken = false;
    element.dispatch('wheel', { deltaX: 0, deltaY: 0, deltaMode: 0, ...wheel, preventDefault: () => (taken = true) });
    return taken;
  }

  it('fades the edge that has more beyond it, and no edge of a bar that fits', () => {
    expect(edges(long(300, 300).element)).toEqual([]);
    expect(edges(long(500, 300).element)).toEqual(['spellbook-more-at-end']);
    expect(edges(long(500, 300, 80).element)).toEqual(['spellbook-more-at-start', 'spellbook-more-at-end']);
    expect(edges(long(500, 300, 200).element)).toEqual(['spellbook-more-at-start']);
    // Where Obsidian runs right to left the browser counts below zero: the same edges all the same.
    expect(edges(long(500, 300, -200).element)).toEqual(['spellbook-more-at-start']);
    // A place that cannot be measured has no edge to fade.
    const bare = new FakeElement();
    new StatusBar(bare as never, () => undefined).show([...FIGURES]);
    expect(edges(bare)).toEqual([]);
  });

  it('slides sideways when the mouse wheel is turned, and keeps the turn for itself', () => {
    const { element, page } = long(500, 300);
    expect(turn(element, { deltaY: 120 })).toBe(true);
    expect(page.scrollLeft).toBe(120);
    expect(edges(element)).toEqual(['spellbook-more-at-start', 'spellbook-more-at-end']);
    expect(turn(element, { deltaY: -120 })).toBe(true);
    expect(page.scrollLeft).toBe(0);
    expect(edges(element)).toEqual(['spellbook-more-at-end']);
    // A mouse that counts in lines.
    turn(element, { deltaY: 3, deltaMode: 1 });
    expect(page.scrollLeft).toBe(48);
  });

  it('leaves the wheel alone when the bar fits, and a sideways slide of a trackpad to the browser', () => {
    const fits = long(300, 300);
    expect(turn(fits.element, { deltaY: 120 })).toBe(false);
    expect(fits.page.scrollLeft).toBe(0);
    const { element, page } = long(500, 300);
    expect(turn(element, { deltaX: 40, deltaY: 3 })).toBe(false);
    expect(page.scrollLeft).toBe(0);
    // The browser slid it: the edges follow.
    page.scrollLeft = 200;
    element.dispatch('scroll', {});
    expect(edges(element)).toEqual(['spellbook-more-at-start']);
  });

  it('slides the other way where Obsidian itself runs right to left', () => {
    const { element, page } = long(500, 300);
    element.ownerDocument.body.addClass('mod-rtl');
    turn(element, { deltaY: 120 });
    expect(page.scrollLeft).toBe(-120);
    expect(edges(element)).toEqual(['spellbook-more-at-start', 'spellbook-more-at-end']);
    expect(element.hasClass('spellbook-runs-backwards')).toBe(true);
  });

  it('looks at its edges again when a figure changes, and lets go of everything when it is taken away', () => {
    const { element, bar, page } = long(300, 300);
    expect(edges(element)).toEqual([]);
    Object.assign(page, { scrollWidth: 420 });
    bar.show([FIGURES[0], { ...FIGURES[1], value: '1,000,000 / 2' }]);
    expect(edges(element)).toEqual(['spellbook-more-at-end']);
    expect(element.listenerCount()).toBe(4); // click, keydown, wheel, scroll
    bar.remove();
    expect(element.listenerCount()).toBe(0);
  });

  it('is styled without a scrollbar, with a fade that follows the direction of the bar', () => {
    const css = readFileSync(new URL('../../../src/styles/progress.css', import.meta.url), 'utf8');
    expect(css).toMatch(/scrollbar-width: none/);
    expect(css).toMatch(/\.spellbook-status\.spellbook-more-at-start \{\s*--spellbook-status-fade-start: transparent;/);
    expect(css).toMatch(/\.spellbook-status\.spellbook-more-at-end \{\s*--spellbook-status-fade-end: transparent;/);
    expect(css).toMatch(/mask-image: var\(--spellbook-status-fade-mask\)/);
    expect(css).toMatch(/\.spellbook-status\.spellbook-runs-backwards\.spellbook-more-at-start,[^{]*\{\s*--spellbook-status-fade-angle: 270deg;/);
  });
});

describe('on a phone, where the inspector shows the line', () => {
  it('offers the figures the writer chose, in the writer\'s order, and tells the inspector when the layout changes', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    const stand = await standUp({ extra: { statuses: [{ name: DRAFT, color: 'blue' }] } }, addBarButton({ entries: [{ kind: 'item', id: 'status' }, { kind: 'item', id: 'scene' }] }, ZEN));
    stand.vault.external.editFrontmatter(OPENING, (frontmatter) => {
      frontmatter['status'] = DRAFT;
    });
    stand.workspace.show(OPENING);
    await drawn(stand);
    expect(stand.bar()).toBeNull();
    let told = 0;
    stand.sceneLine().onChange(() => told++);
    // The figures on their own; the buttons come after them in the inspector's line.
    expect(stand.sceneLine().current()).toEqual([
      { id: 'status', label: 'Status', value: DRAFT, ownText: true, color: 'blue' },
      { id: 'scene', label: 'Words', value: '9' },
    ]);

    const settings = openSettings(stand);
    settings.press('2. Scene words', 'Move up');
    await drawn(stand);
    expect(told).toBeGreaterThan(0);
    expect(stand.line()).toEqual(['Words 9', `Status ${DRAFT}`]);
  });
});

describe('the shortcut buttons, for the inspector\'s line', () => {
  it('offers the buttons the writer chose, runs their commands, and says which have no command', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    const layout = addBarButton(addBarButton({ entries: [{ kind: 'item', id: 'scene' }] }, ZEN, 'Zen', 'eye'), 'other:gone');
    const stand = await standUp(undefined, layout);
    stand.commands.add(ZEN, 'Spellbook: Toggle zen mode');
    stand.workspace.show(OPENING);
    await drawn(stand);
    const line = stand.sceneLine();
    expect(line.buttons?.()).toEqual([
      { key: 'button:1', command: ZEN, label: 'Zen', icon: 'eye', name: 'Spellbook: Toggle zen mode', available: true },
      { key: 'button:2', command: 'other:gone', label: '', icon: null, name: 'other:gone', available: false },
    ]);
    line.run?.(ZEN);
    // A command that is not there does nothing.
    line.run?.('other:gone');
    expect(stand.commands.ran).toEqual([ZEN]);
  });

  it('tells the inspector when a button is taken out of the bar, though no figure changed', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    const stand = await standUp(undefined, addBarButton({ entries: [{ kind: 'item', id: 'scene' }] }, ZEN));
    stand.workspace.show(OPENING);
    await drawn(stand);
    let told = 0;
    stand.sceneLine().onChange(() => told++);
    await drawn(stand);
    const before = told;
    openSettings(stand).press(`2. Button: ${ZEN}`, 'Remove');
    await drawn(stand);
    expect(told).toBeGreaterThan(before);
    expect(stand.sceneLine().buttons?.()).toEqual([]);
    expect(stand.line()).toEqual(['Words 9']);
  });

  it('offers no buttons with no project open', async () => {
    const stand = await standUp(undefined, addBarButton(DEFAULT_BAR_LAYOUT, ZEN));
    await stand.store.closeProject();
    await drawn(stand);
    expect(stand.sceneLine().buttons?.()).toEqual([]);
  });
});

describe('the layout, read with care', () => {
  it('survives a storage that holds nonsense: the device then simply has the bar it starts with', async () => {
    const stand = await makeStand({ stored: { [BAR_LAYOUT_KEY]: '{{not a layout' } });
    stands.push(stand);
    stand.workspace.show(OPENING);
    await drawn(stand);
    expect(theBar(stand).fullText).toBe('Words 9 Session 0 Project 19 Today 0');
    expect(addBarItem(parseBarLayout('{{not a layout'), 'status').entries).toHaveLength(7);
  });
});
