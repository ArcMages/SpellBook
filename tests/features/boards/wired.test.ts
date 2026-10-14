// The idea boards as they are plugged into the plugin: the real feature,
// registered through the registry, on a project store that sits on the
// tests' memory vault, with the shared stand-in plugin, app and workspace.

import type { Plugin as ObsidianPlugin, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTITY_BOARD_SERVICE, readBoard } from '../../../src/core/boards';
import type { EntityBoardService } from '../../../src/core/boards';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { BOARDS_VIEW_TYPE, boardsFeature } from '../../../src/features/boards/index';
import { CardsToNotesModal, MAKE_TEXT } from '../../../src/features/boards/windows';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { worldFeature } from '../../../src/features/world/index';
import { FakeObsidian } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Modal as StubModal, Notice as StubNotice, Plugin as StubPlugin, TFile as StubFile, resetFakeDocument } from '../../obsidianStub';
import type { ButtonComponent, FakeElement } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, makeStore, settle, tick } from '../../storeHarness';

const INDEX = 'Novel/Novel.md';
const NIGHT = 'Manuscript/לילה בנמל.md';
const BOARD = 'Novel/Boards/Ideas.canvas';
/** A board with three text cards, a file card, and edges between them. */
const BOARD_TEXT = JSON.stringify({
  nodes: [
    { id: 'c1', type: 'text', text: '# The storm\nMara loses the boat.', x: 0, y: 0, width: 250, height: 60, color: '2' },
    { id: 'c2', type: 'text', text: 'Old Tamar\nKeeps the lighthouse.', x: 300, y: 0, width: 250, height: 80 },
    { id: 'c3', type: 'text', text: 'Maybe later', x: 0, y: 200, width: 250, height: 60 },
    { id: 'f1', type: 'file', file: 'Novel/Manuscript/Opening.md', x: 600, y: 0, width: 400, height: 400 },
  ],
  edges: [
    { id: 'e1', fromNode: 'c1', toNode: 'c2', label: 'meets' },
    { id: 'e2', fromNode: 'f1', toNode: 'c3' },
  ],
});

function novelVault(): MemoryVault {
  return new MemoryVault()
    .seed(INDEX, {
      frontmatter: { spellbook: 'project', version: 1, title: 'My Novel', binder: ['Manuscript/Opening.md', { folder: 'Part one', id: 'f-one', children: [NIGHT] }, 'Manuscript/Closing.md'] },
      body: INDEX_BODY,
    })
    .seed('Novel/Manuscript/Opening.md', { frontmatter: { status: 'First draft', entities: ['[[Mara]]'] }, body: 'It was a dark night.' })
    .seed(`Novel/${NIGHT}`, { frontmatter: { status: 'To do', entities: ['[[Mara]]'] }, body: 'הלילה היה חשוך.' })
    .seed('Novel/Manuscript/Closing.md', { body: 'The end.' })
    .seed('Novel/World/Characters/Mara.md', { frontmatter: { type: 'character', related: ['[[Joss|brother]]', '[[Saltwick|lives in]]'] }, body: '' })
    .seed('Novel/World/Characters/Joss.md', { frontmatter: { type: 'character', related: ['[[Mara|sister]]'] }, body: '' })
    .seed('Novel/World/Places/Saltwick.md', { frontmatter: { type: 'place' }, body: '' })
    .seed('Novel/Timeline/The storm.md', { frontmatter: { date: '1890-03-01', entities: ['[[Mara]]'] }, body: '' })
    .seed(BOARD, { body: BOARD_TEXT });
}

interface Stage {
  vault: MemoryVault;
  fake: FakeObsidian;
  plugin: StubPlugin;
  features: RegisteredFeatures;
  opened: string[];
  command(id: string): () => void;
  front(path: string | null): void;
  calm(): Promise<void>;
  switchOff(): void;
}

const stages: Stage[] = [];

async function stage(withWorld = false): Promise<Stage> {
  const vault = novelVault();
  const { store, timers } = makeStore(vault);
  const opened = await store.openProject(INDEX);
  if (opened.status !== 'done') throw new Error('could not open the project');
  vault.clearWrites();
  const fake = new FakeObsidian();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const shown: string[] = [];
  const features = registerFeatures(withWorld ? [worldFeature, boardsFeature] : [boardsFeature], {
    plugin: plugin as unknown as ObsidianPlugin,
    app: fake.app,
    store,
    vault,
    storage: new MemoryDeviceStorage(),
    deviceId: () => 'testdevice',
    clock: { today: () => '2026-10-14', now: () => 0, setTimer: timers.set, nextFrame: (callback) => timers.set(() => callback(16), 16) },
    wordCounts,
    openNote: async (path) => {
      shown.push(path);
      return vault.has(path);
    },
  });
  const calm = async (): Promise<void> => {
    for (let turn = 0; turn < 10; turn++) {
      await settle(store);
      await tick();
      timers.advance(0);
    }
  };
  const made: Stage = {
    vault,
    fake,
    plugin,
    features,
    opened: shown,
    command: (id) => {
      const found = plugin.commands.find((candidate) => candidate.id === id);
      if (!found?.callback) throw new Error(`no command "${id}"`);
      return found.callback;
    },
    front: (path) => {
      if (path === null) {
        fake.workspace.setActiveFile(null);
        return;
      }
      const file = new StubFile();
      file.path = path;
      fake.workspace.setActiveFile(file as unknown as TFile);
    },
    calm,
    switchOff: () => {
      features.release();
      plugin.unload();
      wordCounts.dispose();
      store.dispose();
    },
  };
  stages.push(made);
  return made;
}

function lastWindow(): StubModal {
  const modal = StubModal.opened[StubModal.opened.length - 1];
  if (!modal?.isOpen) throw new Error('no window is open');
  return modal;
}

function windowButton(modal: StubModal, text: string): ButtonComponent {
  for (const row of modal.contentEl.settings) {
    for (const component of row.components) {
      const button = component as ButtonComponent;
      if (button.buttonEl?.text === text) return button;
    }
  }
  throw new Error(`the window has no button "${text}"`);
}

interface Canvas {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}
const canvasOf = (vault: MemoryVault, path: string): Canvas => JSON.parse(vault.textOf(path)) as Canvas;
const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

beforeEach(() => {
  StubNotice.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
});

afterEach(() => {
  for (const made of stages.splice(0)) made.switchOff();
});

describe('the idea boards in the plugin', () => {
  it('add their commands, a ribbon button, a pane, and the service the World sheet asks for', async () => {
    const wired = await stage();
    expect(wired.plugin.commands.map((command) => [command.id, command.name])).toEqual([
      ['open-boards', 'Open idea boards'],
      ['new-idea-board', 'New idea board'],
      ['board-cards-to-notes', 'Turn board cards into notes'],
      ['board-relationship-map', 'Board: relationship map'],
      ['board-chapter-cards', 'Board: chapter as cards'],
      ['board-entity-web', 'Board: around this entity'],
    ]);
    expect(wired.plugin.ribbonIcons.map((icon) => icon.title)).toEqual(['Open Spellbook idea boards']);
    expect(wired.plugin.viewTypes).toEqual([BOARDS_VIEW_TYPE]);
    expect(wired.features.services.get(ENTITY_BOARD_SERVICE)).toBeDefined();
    // Nothing was written by starting.
    expect(wired.vault.writes).toEqual([]);
  });

  it('"New idea board" asks for a name, makes an empty board in the Boards folder, opens it, and never replaces one', async () => {
    const wired = await stage();
    wired.command('new-idea-board')();
    let modal = lastWindow();
    (modal.contentEl.withClass('spellbook-prompt-input')[0] as FakeElement).value = 'רעיונות';
    windowButton(modal, 'Create').click();
    await wired.calm();
    expect(wired.vault.has('Novel/Boards/רעיונות.canvas')).toBe(true);
    expect(readBoard(wired.vault.textOf('Novel/Boards/רעיונות.canvas'))).toEqual({ cards: [], edges: [] });
    expect(wired.opened).toEqual(['Novel/Boards/רעיונות.canvas']);

    wired.command('new-idea-board')();
    modal = lastWindow();
    (modal.contentEl.withClass('spellbook-prompt-input')[0] as FakeElement).value = 'ideas';
    windowButton(modal, 'Create').click();
    await wired.calm();
    expect(modal.isOpen).toBe(true); // the name is taken ("Ideas"): the window says so and stays
    expect(modal.contentEl.fullText).toMatch(/already a board called "ideas"/);
    expect(wired.vault.textOf(BOARD)).toBe(BOARD_TEXT);
  });
});

describe('turning board cards into notes', () => {
  async function openWindow(wired: Stage): Promise<CardsToNotesModal> {
    wired.front(BOARD);
    wired.command('board-cards-to-notes')();
    await wired.calm();
    const modal = lastWindow();
    expect(modal).toBeInstanceOf(CardsToNotesModal);
    return modal as unknown as CardsToNotesModal;
  }

  it('lists the text cards of the board that is open', async () => {
    const wired = await stage();
    const modal = await openWindow(wired);
    expect(modal.decisions().map((decision) => decision.card.id)).toEqual(['c1', 'c2', 'c3']);
    expect((modal as unknown as StubModal).contentEl.withClass('spellbook-boards-card-title').map((title) => title.text)).toEqual(['The storm', 'Old Tamar', 'Maybe later']);
  });

  it('makes a scene and a World entry, and puts file cards in their places, keeping ids, sizes, colours and edges', async () => {
    const wired = await stage();
    const modal = await openWindow(wired);
    modal.choose('c1', 'scene');
    modal.choose('c2', 'entity:character');
    modal.chooseFolder('f-one');
    windowButton(modal as unknown as StubModal, MAKE_TEXT).click();
    await wired.calm();
    expect((modal as unknown as StubModal).isOpen).toBe(false);
    expect(notices()).toEqual(['2 notes made.']);

    // The scene: its first line the title, the rest the synopsis, at the end of the folder chosen.
    expect(wired.vault.frontmatterOf('Novel/Manuscript/The storm.md')).toMatchObject({ synopsis: 'Mara loses the boat.' });
    expect(wired.vault.bodyOf('Novel/Manuscript/The storm.md')).toBe('');
    const binder = wired.vault.frontmatterOf(INDEX)?.['binder'] as unknown[];
    expect(binder[1]).toMatchObject({ id: 'f-one', children: [NIGHT, 'Manuscript/The storm.md'] });
    // The entity: a character, the rest of the card its summary.
    expect(wired.vault.frontmatterOf('Novel/World/Characters/Old Tamar.md')).toMatchObject({ type: 'character', summary: 'Keeps the lighthouse.' });

    // The board: the two cards now show the notes, in the same places; the rest is as it was.
    const board = canvasOf(wired.vault, BOARD);
    const before = JSON.parse(BOARD_TEXT) as Canvas;
    expect(board.nodes[0]).toEqual({ id: 'c1', type: 'file', x: 0, y: 0, width: 250, height: 60, color: '2', file: 'Novel/Manuscript/The storm.md' });
    expect(board.nodes[1]).toEqual({ id: 'c2', type: 'file', x: 300, y: 0, width: 250, height: 80, file: 'Novel/World/Characters/Old Tamar.md' });
    expect(board.nodes.slice(2)).toEqual(before.nodes.slice(2));
    expect(board.edges).toEqual(before.edges);
    // No other note's text was touched.
    expect(wired.vault.bodyOf('Novel/Manuscript/Opening.md')).toBe('It was a dark night.');
  });

  it('asks for a choice before it does anything', async () => {
    const wired = await stage();
    const modal = await openWindow(wired);
    windowButton(modal as unknown as StubModal, MAKE_TEXT).click();
    await wired.calm();
    expect((modal as unknown as StubModal).isOpen).toBe(true);
    expect(wired.vault.writes).toEqual([]);
  });

  it('gives a new note a free name, and makes a card that left the board meanwhile into a note all the same', async () => {
    const wired = await stage();
    const modal = await openWindow(wired);
    modal.choose('c3', 'scene');
    modal.choose('c2', 'entity:character');
    // The writer moves on: in the meantime Tamar exists already, and card c3 is gone from the board.
    wired.vault.seed('Novel/World/Characters/Old Tamar.md', { frontmatter: { type: 'character' }, body: 'Hers.' });
    const board = JSON.parse(BOARD_TEXT) as Canvas;
    board.nodes = board.nodes.filter((node) => node.id !== 'c3');
    wired.vault.seed(BOARD, { body: JSON.stringify(board) });
    windowButton(modal as unknown as StubModal, MAKE_TEXT).click();
    await wired.calm();
    expect(wired.vault.bodyOf('Novel/World/Characters/Old Tamar.md')).toBe('Hers.');
    expect(wired.vault.has('Novel/World/Characters/Old Tamar 2.md')).toBe(true);
    expect(wired.vault.has('Novel/Manuscript/Maybe later.md')).toBe(true);
    expect(notices()[0]).toMatch(/2 notes made; 1 card changed on the board\. 1 card had already left the board/);
    expect(canvasOf(wired.vault, BOARD).nodes.find((node) => node.id === 'c2')?.['file']).toBe('Novel/World/Characters/Old Tamar 2.md');
  });

  it('asks which board when the one in front is no board', async () => {
    const wired = await stage();
    wired.front('Novel/Manuscript/Opening.md');
    wired.command('board-cards-to-notes')();
    const picker = lastWindow() as unknown as { pick(text: string): void };
    picker.pick('Ideas');
    await wired.calm();
    expect(lastWindow()).toBeInstanceOf(CardsToNotesModal);
  });
});

describe('boards drawn for the writer', () => {
  it('a relationship map: the characters, coloured by type, and each relation once, under a free name', async () => {
    const wired = await stage();
    wired.command('board-relationship-map')();
    windowButton(lastWindow(), 'Draw board').click();
    await wired.calm();
    const path = 'Novel/Boards/Relationship map.canvas';
    const board = canvasOf(wired.vault, path);
    expect(board.nodes.map((node) => node['file']).sort()).toEqual(['Novel/World/Characters/Joss.md', 'Novel/World/Characters/Mara.md']);
    expect(board.nodes.map((node) => node['color'])).toEqual(['5', '5']); // characters are blue
    expect(board.edges.map((edge) => edge['label'])).toEqual(['sister / brother']);
    expect(wired.opened).toEqual([path]);

    // Drawn again: a new board beside it, never over it.
    const first = wired.vault.textOf(path);
    wired.command('board-relationship-map')();
    windowButton(lastWindow(), 'Draw board').click();
    await wired.calm();
    expect(wired.vault.has('Novel/Boards/Relationship map 2.canvas')).toBe(true);
    expect(wired.vault.textOf(path)).toBe(first);
  });

  it('a chapter as cards: the scenes of the folder chosen, grouped by status', async () => {
    const wired = await stage();
    wired.command('board-chapter-cards')();
    windowButton(lastWindow(), 'Draw board').click(); // the first folder, "Part one", by status
    await wired.calm();
    const board = canvasOf(wired.vault, 'Novel/Boards/Part one as cards.canvas');
    expect(board.nodes.filter((node) => node['type'] === 'group').map((node) => node['label'])).toEqual(['To do']);
    expect(board.nodes.filter((node) => node['type'] === 'file').map((node) => node['file'])).toEqual([`Novel/${NIGHT}`]);
  });

  it('around an entity: from the World sheet\'s service, with its relations, scenes and events', async () => {
    const wired = await stage(true);
    const service = wired.features.services.get<EntityBoardService>(ENTITY_BOARD_SERVICE);
    service?.draw('World/Characters/Mara.md');
    await wired.calm();
    const board = canvasOf(wired.vault, 'Novel/Boards/Around Mara.canvas');
    const files = board.nodes.map((node) => node['file']).filter((file) => file !== undefined);
    expect(files).toEqual([
      'Novel/World/Characters/Mara.md',
      'Novel/World/Characters/Joss.md',
      'Novel/World/Places/Saltwick.md',
      'Novel/Manuscript/Opening.md',
      `Novel/${NIGHT}`,
      'Novel/Timeline/The storm.md',
    ]);
    expect(board.edges.map((edge) => edge['label'] ?? '')).toEqual(['brother / sister', 'lives in', '', '']);
  });

  it('"Board: around this entity" draws around the entity whose note is in front', async () => {
    const wired = await stage();
    wired.front('Novel/World/Places/Saltwick.md');
    wired.command('board-entity-web')();
    await wired.calm();
    expect(wired.vault.has('Novel/Boards/Around Saltwick.canvas')).toBe(true);
  });
});

describe('the Boards pane', () => {
  it('lists the boards with their card counts', async () => {
    const wired = await stage();
    wired.command('open-boards')();
    await wired.calm();
    const leaf = wired.fake.workspace.getLeavesOfType(BOARDS_VIEW_TYPE)[0];
    const pane = (leaf?.view as unknown as { contentEl: FakeElement }).contentEl;
    await wired.calm();
    const rows = pane.withClass('spellbook-boards-row').map((row) => row.fullText);
    expect(rows).toEqual([expect.stringMatching(/Ideas 4 cards/)]);
  });

  it('says so of a board that cannot be read, and reads it again when it changes', async () => {
    const wired = await stage();
    wired.vault.seed(BOARD, { body: 'not a board' });
    wired.command('open-boards')();
    await wired.calm();
    const pane = (wired.fake.workspace.getLeavesOfType(BOARDS_VIEW_TYPE)[0]?.view as unknown as { contentEl: FakeElement }).contentEl;
    expect(pane.withClass('spellbook-boards-count').map((count) => count.text)).toEqual(['cannot be read']);
    wired.vault.seed('Novel/Boards/Second.canvas', { body: '{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":1,"height":1}],"edges":[]}' });
    wired.vault.refresh();
    await wired.calm();
    expect(pane.withClass('spellbook-boards-count').map((count) => count.text)).toEqual(['cannot be read', '1 card']);
  });
});
