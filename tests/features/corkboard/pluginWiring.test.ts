// The corkboard and the inspector inside the whole plugin: the plugin's own
// entry point, loaded the way Obsidian loads it, on the imitation of the
// Obsidian app (tests/fakeObsidianApp.ts). The feature's own behaviour is
// tested in wiring.test.ts; these tests check that the plugin really plugs it
// in, that the binder's folder menu reaches it, and that a change goes all the
// way to the note through Obsidian's own doorway for properties.

import { getFrontMatterInfo, parseYaml } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CORKBOARD_VIEW_TYPE, CorkboardView } from '../../../src/features/corkboard/corkboardView';
import { INSPECTOR_VIEW_TYPE, InspectorView } from '../../../src/features/corkboard/inspectorView';
import SpellbookPlugin from '../../../src/main';
import { moreOf, picture, tap as tapRow } from '../../binderScreen';
import { FakeObsidian, note } from '../../fakeObsidianApp';
import type { FakeLeaf } from '../../fakeObsidianApp';
import { Menu as StubMenu, resetPlatform } from '../../obsidianStub';
import type { FakeElement, Plugin as StubPlugin, StubCommand } from '../../obsidianStub';
import { cardOf, clearScreen, colorOf, menuOf, notices, one, seen, submenu, titles } from './stage';
import { makeRoom } from './wiringStage';

const MANIFEST = { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' };
const OPENING = 'Novel/Manuscript/Opening.md';

function novelVault(): FakeObsidian {
  const fake = new FakeObsidian();
  fake.addNote(
    'Novel/Novel.md',
    note(
      {
        spellbook: 'project',
        version: 1,
        title: 'My Novel',
        binder: ['Manuscript/Opening.md', { folder: 'Part one', id: 'f-one', children: ['Manuscript/The Letter.md'] }],
        statuses: [
          { name: 'To do', color: 'red' },
          { name: 'Done', color: 'green' },
        ],
      },
      'Index text.',
    ),
  );
  fake.addNote(OPENING, note({ status: 'To do', synopsis: 'Anna arrives.', order: 1024 }, 'It was a dark night.\n'));
  fake.addNote('Novel/Manuscript/The Letter.md', note({ order: 2048 }, 'Dear sister, I write to you.\n'));
  return fake;
}

interface Loaded {
  fake: FakeObsidian;
  plugin: SpellbookPlugin;
  stub: StubPlugin;
  command(id: string): StubCommand;
}

const loadedPlugins: SpellbookPlugin[] = [];

/** The plugin, loaded the way Obsidian loads it; Obsidian is still starting up. */
function load(fake: FakeObsidian = novelVault()): Loaded {
  makeRoom(fake.workspace);
  const plugin = new SpellbookPlugin(fake.app, MANIFEST as never);
  loadedPlugins.push(plugin);
  plugin.onload();
  const stub = plugin as unknown as StubPlugin;
  const command = (id: string): StubCommand => {
    const found = stub.commands.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no command "${id}"`);
    return found;
  };
  return { fake, plugin, stub, command };
}

/** Wait for something the plugin does in the background. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const paneOf = (leaf: FakeLeaf | undefined): FakeElement => (leaf?.view as unknown as { contentEl: FakeElement }).contentEl;

/** Run "Open corkboard" and wait for the board to show the project. */
async function withCorkboard(loaded: Loaded): Promise<{ leaf: FakeLeaf; pane: FakeElement }> {
  loaded.command('open-corkboard').callback?.();
  const leaves = (): FakeLeaf[] => loaded.fake.workspace.getLeavesOfType(CORKBOARD_VIEW_TYPE);
  await until(() => leaves()[0]?.view != null, 'the corkboard to open');
  const leaf = leaves()[0] as FakeLeaf;
  const pane = paneOf(leaf);
  await until(() => titles(pane).length > 0, 'the cards to appear');
  return { leaf, pane };
}

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  // Switched off, the plugin cancels its timers; nothing runs on into the next test.
  for (const plugin of loadedPlugins.splice(0)) plugin.unload();
  resetPlatform();
});

describe('the corkboard and the inspector in the whole plugin', () => {
  it('are plugged in once Obsidian has finished starting, next to what the plugin had already', () => {
    const { fake, plugin, stub } = load();
    expect(stub.viewTypes).toEqual(['spellbook-binder']);
    const commandsBefore = stub.commands.length;

    fake.finishStartup();
    expect(plugin.features?.ids).toContain('corkboard');
    expect(stub.viewTypes).toEqual(expect.arrayContaining(['spellbook-binder', CORKBOARD_VIEW_TYPE, INSPECTOR_VIEW_TYPE]));
    expect(stub.commands.slice(commandsBefore).map((command) => [command.id, command.name])).toEqual(
      expect.arrayContaining([
        ['open-corkboard', 'Open corkboard'],
        ['open-inspector', 'Open inspector'],
        ['manage-statuses-and-labels', 'Manage statuses and labels'],
      ]),
    );
    // No two commands of the plugin share an id.
    expect(new Set(stub.commands.map((command) => command.id)).size).toBe(stub.commands.length);
    expect(stub.ribbonIcons.map((icon) => icon.title)).toEqual(
      expect.arrayContaining(['Open Spellbook binder', 'Open Spellbook corkboard']),
    );
    // Plugging in opens nothing and remembers nothing on the device.
    expect(fake.workspace.leaves).toEqual([]);
    expect(fake.localStorage.size).toBe(0);
    // Nothing of the corkboard's listens to the workspace yet: three
    // listeners are the writing progress's (file-open, layout-change, quit),
    // one the revision tools' (the editor's menu).
    expect(fake.workspace.listenerCount()).toBe(4);
    expect(['file-open', 'layout-change', 'quit'].map((name) => fake.workspace.listenerCount(name))).toEqual([1, 1, 1]);
  });

  it('show the project from the command: cards in the main area, the open scene in the right sidebar', async () => {
    const loaded = load();
    loaded.fake.finishStartup();
    const { leaf, pane } = await withCorkboard(loaded);
    expect(leaf.view).toBeInstanceOf(CorkboardView);
    expect(leaf.getRoot()).toBe(loaded.fake.workspace.rootSplit);
    expect(titles(pane)).toEqual(['Opening', 'Part one']);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-synopsis')).toBe('Anna arrives.');
    await until(() => seen(cardOf(pane, 'Opening'), 'spellbook-card-words') === '5 words', 'the words to be counted');

    // Tapping a card opens its note through the plugin, in the tab the writer was in.
    tapRow(cardOf(pane, 'Opening'));
    await until(() => loaded.fake.workspace.openCalls.length > 0, 'the scene to open');
    expect(loaded.fake.workspace.openCalls).toEqual([{ path: OPENING, where: false, state: { active: true } }]);

    loaded.command('open-inspector').callback?.();
    const inspectors = (): FakeLeaf[] => loaded.fake.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE);
    await until(() => inspectors()[0]?.view != null, 'the inspector to open');
    expect(inspectors()[0]?.view).toBeInstanceOf(InspectorView);
    expect(inspectors()[0]?.getRoot()).toBe(loaded.fake.workspace.rightSplit);
    const form = paneOf(inspectors()[0]);
    await until(() => one(form, 'spellbook-inspector-title').text === 'Opening', 'the inspector to show the scene');
    expect(one(form, 'spellbook-inspector-synopsis').value).toBe('Anna arrives.');
    // Looking writes nothing.
    expect(loaded.fake.saves).toEqual([]);
    expect(loaded.fake.calls).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('write a change to the note through Obsidian\'s own doorway for properties, and leave its text alone', async () => {
    const loaded = load();
    loaded.fake.finishStartup();
    const { pane } = await withCorkboard(loaded);
    submenu(menuOf(pane, 'Opening'), 'Set status').item('Done').click();
    await until(() => loaded.fake.saves.length > 0, 'the status to be saved');
    expect(loaded.fake.calls).toEqual([`processFrontMatter ${OPENING}`]);
    const text = loaded.fake.textOf(OPENING);
    const info = getFrontMatterInfo(text);
    expect(text.slice(info.contentStart)).toBe('It was a dark night.\n');
    // Only the status changed; the other properties are as they were.
    expect(parseYaml(info.frontmatter)).toEqual({ status: 'Done', synopsis: 'Anna arrives.', order: 1024 });
    await until(() => seen(cardOf(pane, 'Opening'), 'spellbook-card-status') === 'Done', 'the card to follow');
    expect(colorOf(one(cardOf(pane, 'Opening'), 'spellbook-card-status'))).toBe('green');
    expect(notices()).toEqual([]);
  });

  it('are reached from the binder: a folder\'s menu shows the folder on the corkboard', async () => {
    const loaded = load();
    loaded.fake.finishStartup();
    await loaded.plugin.openBinder();
    const binder = paneOf(loaded.fake.workspace.getLeavesOfType('spellbook-binder')[0]);
    await until(() => picture(binder).some((line) => line.includes('Part one')), 'the binder to show the project');

    const more = moreOf(binder, 'Part one');
    if (!more) throw new Error('the folder has no "more" button');
    tapRow(more);
    const menu = StubMenu.shown[StubMenu.shown.length - 1] as StubMenu;
    expect(menu.outline[0]).toBe('Show on corkboard');
    expect(menu.outline.slice(1, 3)).toEqual(['New scene inside', 'New folder inside']);
    expect(menu.item('Show on corkboard').icon).toBe('layout-grid');

    menu.item('Show on corkboard').click();
    const boards = (): FakeLeaf[] => loaded.fake.workspace.getLeavesOfType(CORKBOARD_VIEW_TYPE);
    await until(() => boards()[0]?.view != null && titles(paneOf(boards()[0])).includes('The Letter'), 'the folder to be shown');
    expect(boards()).toHaveLength(1);
    expect(boards()[0]?.getRoot()).toBe(loaded.fake.workspace.rootSplit);
    expect(titles(paneOf(boards()[0]))).toEqual(['The Letter']);
    expect(notices()).toEqual([]);
  });

  it('leave nothing listening when the plugin is switched off', async () => {
    const loaded = load();
    loaded.fake.finishStartup();
    const { leaf, pane } = await withCorkboard(loaded);
    loaded.command('open-inspector').callback?.();
    await until(() => loaded.fake.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE)[0]?.view != null, 'the inspector to open');
    // One listener for the two panes, next to the three of the writing progress and the revision tools' one.
    expect(loaded.fake.workspace.listenerCount()).toBe(5);

    loaded.plugin.unload();
    await until(() => pane.children.length === 0, 'the corkboard to be emptied');
    expect(leaf.detached).toBe(false); // its tab is kept for when the plugin comes back
    expect(leaf.view).toBeNull();
    expect(loaded.fake.workspace.listenerCount()).toBe(0);
    expect(loaded.fake.vault.listenerCount()).toBe(0);
    expect(loaded.fake.metadataCache.listenerCount()).toBe(0);
    expect(loaded.plugin.features).toBeNull();
    expect(loaded.stub.ribbonIcons.every((icon) => !icon.shown)).toBe(true);
  });
});
