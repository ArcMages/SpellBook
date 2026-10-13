// Scrivenings as it is plugged into the plugin: the real feature on a project
// store that sits on the tests' memory vault. What the pane shows is read
// from the stand-in screen.
//
// The shared stand-in for Obsidian has no renderer of formatted text, so this
// file adds one for itself (below): it puts every paragraph of a scene on the
// page as it is written, and remembers what it was asked to draw. The pane's
// own way of doing without a renderer (plain paragraphs) is tested as well.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScriveningsView } from '../../../src/features/scrivenings/scriveningsView';
import { estimateHeight, readMemory } from '../../../src/core/scrivenings';
import { MEMORY_KEY, SCRIVENINGS_RIBBON_TITLE, WORD_COUNT_ASKER } from '../../../src/features/scrivenings/index';
import {
  EDIT_TEXT,
  EMPTY_SCENE_TEXT,
  NO_FOLDER_TEXT,
  NO_PROJECT_TEXT,
  NO_SCENES_TEXT,
  SAVE_PLACE_MS,
  SCOPE_MANUSCRIPT_TEXT,
  SCRIVENINGS_VIEW_TYPE,
  UNREAD_TEXT,
} from '../../../src/features/scrivenings/scriveningsView';
import { MISSING_LABEL } from '../../../src/ui/missingNote';
import { MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Notice as StubNotice, Platform, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage } from '../../storeHarness';
import {
  CLOSING,
  GHOST,
  INNER_NAME,
  LETTER,
  NIGHT,
  NIGHT_BODY,
  NIGHT_TITLE,
  NOVEL_INDEX,
  OPENING,
  calm,
  choose,
  countOf,
  drawnTitles,
  inNovel,
  isRoom,
  longVault,
  messageOf,
  novelVault,
  one,
  openPane,
  paneOf,
  paragraphsOf,
  resize,
  roomOf,
  sceneCalled,
  sceneName,
  scenesOf,
  scopeMenu,
  scrollTo,
  summaryOf,
  textElOf,
  titlesOf,
  wire,
} from './stage';
import type { WireOptions, Wired } from './stage';

/** What the stand-in renderer was asked, and what the test tells it to do. */
const renderer = vi.hoisted(() => ({
  /** Every scene it drew: the note the text is of, and the text. */
  drawn: [] as Array<{ sourcePath: string; text: string }>,
  /** How many drawings were taken away again. */
  undrawn: 0,
  /** Set to make every drawing fail. */
  broken: false,
  /** What the editor was asked after a note was opened. */
  cursors: [] as unknown[],
  arrivals: [] as unknown[],
}));

vi.mock('obsidian', async (importOriginal) => {
  const stub = await importOriginal<Record<string, unknown>>();
  interface Page {
    createEl(tag: string, info: { text: string }): { textContent?: string };
  }
  class Component {
    load(): void {}
    unload(): void {
      renderer.undrawn++;
    }
  }
  class MarkdownRenderer {
    static async render(_app: unknown, text: string, el: Page, sourcePath: string): Promise<void> {
      renderer.drawn.push({ sourcePath, text });
      if (renderer.broken) throw new Error('the renderer is not available');
      for (const block of text.split(/\n\s*\n/)) {
        if (block.trim() === '') continue;
        // As on a real page: the marks are gone from what is shown.
        const shown = block.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '');
        el.createEl('p', { text: shown }).textContent = shown;
      }
    }
  }
  class MarkdownView {
    file: { path: string } | null = null;
    readonly editor = {
      setCursor: (position: unknown): void => {
        renderer.cursors.push(position);
      },
    };
    setEphemeralState(state: unknown): void {
      renderer.arrivals.push(state);
    }
  }
  return { ...stub, Component, MarkdownRenderer, MarkdownView };
});

const stages: Wired[] = [];

async function stage(vault?: MemoryVault, options?: WireOptions): Promise<Wired> {
  const wired = await wire(vault, options);
  stages.push(wired);
  return wired;
}

/** The notes the renderer drew, by their titles, in the order it drew them. */
function drawnNotes(): string[] {
  return renderer.drawn.map((entry) => entry.sourcePath.replace(/^.*\//, '').replace(/\.md$/, ''));
}

beforeEach(() => {
  StubMenu.shown.length = 0;
  StubNotice.shown.length = 0;
  resetFakeDocument();
  renderer.drawn.length = 0;
  renderer.undrawn = 0;
  renderer.broken = false;
  renderer.cursors.length = 0;
  renderer.arrivals.length = 0;
});

afterEach(() => {
  for (const wired of stages.splice(0)) wired.switchOff();
  resetPlatform();
  vi.unstubAllGlobals();
});

describe('plugging in', () => {
  it('adds a command and a ribbon button, and does nothing until the pane is opened', async () => {
    const s = await stage();
    expect(s.plugin.viewTypes).toEqual([SCRIVENINGS_VIEW_TYPE]);
    expect(s.plugin.commands.map((command) => [command.id, command.name])).toEqual([['open-scrivenings', 'Open novel view']]);
    expect(s.plugin.ribbonIcons.map((icon) => [icon.icon, icon.title])).toEqual([['scroll-text', SCRIVENINGS_RIBBON_TITLE]]);
    expect(s.features.settingsSections).toEqual([]);
    await calm(s);
    // No note was read, nothing was saved on the device, and no word count was asked for.
    expect(s.vault.reads.readText).toBe(0);
    expect(s.storage.saves).toEqual([]);
    expect(s.wordCounts.askers()).toEqual([]);
    expect(s.workspace.listenerCount()).toBe(0);
    expect(s.workspace.leaves).toEqual([]);
  });

  it('opens one pane, from the command and from the ribbon, and brings it to the front the second time', async () => {
    const s = await stage();
    const { leaf, view } = await openPane(s);
    s.plugin.ribbonIcons[0]?.callback({});
    s.command('open-scrivenings').callback?.();
    await calm(s);
    expect(s.workspace.getLeavesOfType(SCRIVENINGS_VIEW_TYPE)).toEqual([leaf]);
    expect(s.workspace.revealed.length).toBeGreaterThanOrEqual(2);
    expect(view.getDisplayText()).toBe('Novel view');
    expect(view.getIcon()).toBe('scroll-text');
    // A note that is opened from here goes to another tab.
    expect(view.navigation).toBe(false);
  });

  it('lets go of everything when the pane closes, and when the plugin is switched off', async () => {
    const s = await stage();
    const { leaf, pane, scroller } = await openPane(s);
    expect(s.wordCounts.askers()).toEqual([WORD_COUNT_ASKER]);
    expect(scroller.listenerCount('scroll')).toBe(1);
    const drawings = renderer.drawn.length;
    expect(drawings).toBe(4);
    leaf.detach();
    await calm(s);
    expect(s.wordCounts.askers()).toEqual([]);
    expect(scroller.listenerCount('scroll')).toBe(0);
    expect(pane.children).toEqual([]);
    expect(pane.hasClass('spellbook-scrivenings-pane')).toBe(false);
    // Whatever each drawing had set up was taken away.
    expect(renderer.undrawn).toBe(drawings);
    // A note that changes now is nobody's concern.
    s.vault.external.write(inNovel(OPENING), { body: 'Changed while the pane was closed.\n' });
    await calm(s);
    expect(renderer.drawn).toHaveLength(drawings);

    // Open again; then the plugin is switched off under the open pane.
    const again = await openPane(s);
    expect(paragraphsOf(sceneCalled(again.pane, 'Opening'))).toEqual(['Changed while the pane was closed.']);
    const drawnBefore = renderer.drawn.length;
    s.switchOff();
    await calm(s);
    expect(again.pane.children).toEqual([]);
    expect(renderer.undrawn).toBe(drawnBefore);
    expect(again.scroller.listenerCount('scroll')).toBe(0);
    const revealed = s.workspace.revealed.length;
    s.command('open-scrivenings').callback?.(); // does nothing any more
    await calm(s);
    expect(s.workspace.revealed).toHaveLength(revealed);
  });
});

describe('the manuscript as one text', () => {
  it('shows every scene in binder order, each under its title and its word count', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    expect(titlesOf(pane)).toEqual(['Opening', 'The Letter', NIGHT_TITLE, 'Ghost', 'Closing']);
    expect(scenesOf(pane).map(countOf)).toEqual(['22 words', '10 words', '18 words', '', '4 words']);
    expect(summaryOf(pane)).toBe('5 scenes, 54 words');
    expect(one(pane, 'spellbook-scrivenings-scope').text).toBe(SCOPE_MANUSCRIPT_TEXT);
    expect(messageOf(pane)).toBe('');

    expect(paragraphsOf(sceneCalled(pane, 'Opening'))).toEqual([
      'Chapter One',
      'It was a dark night. The harbour was empty, and Anna walked alone.',
      '"Who is there?" she asked. Nobody answered!',
    ]);
    expect(paragraphsOf(sceneCalled(pane, 'The Letter'))).toEqual(['Dear Anna, I am writing to you from the harbour.']);
    expect(paragraphsOf(sceneCalled(pane, 'Closing'))).toEqual(['The end came quietly.']);
    // Each scene was read once and drawn by Obsidian's renderer, as the note it comes from.
    expect(renderer.drawn.map((entry) => entry.sourcePath).sort()).toEqual([CLOSING, LETTER, NIGHT, OPENING].map(inNovel).sort());
  });

  it('leaves the properties of a scene out', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    const text = one(pane, 'spellbook-scrivenings-list').fullText;
    for (const hidden of ['synopsis', 'Anna arrives in the old town', 'status', 'Draft', '1024', '---']) expect(text, hidden).not.toContain(hidden);
    expect(renderer.drawn.every((entry) => !entry.text.startsWith('---'))).toBe(true);
  });

  it('lets a Hebrew scene read right to left, next to English ones: every title, text and paragraph takes its own direction', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    const night = sceneCalled(pane, NIGHT_TITLE);
    expect(paragraphsOf(night)).toEqual(['פרק ראשון', 'שלום לך אחותי היקרה. מה שלומך? אני כותבת לך מן הנמל!', 'הלילה היה חשוך, והים שקט.']);
    for (const scene of scenesOf(pane)) {
      expect(one(scene, 'spellbook-scrivenings-title').getAttr('dir')).toBe('auto');
      const text = textElOf(scene);
      expect(text.getAttr('dir')).toBe('auto');
      if (titlesOf(pane).indexOf('Ghost') === scenesOf(pane).indexOf(scene)) continue;
      expect(text.children.map((child) => child.getAttr('dir'))).toEqual(text.children.map(() => 'auto'));
      // Obsidian's own class for formatted text, so that the theme's reading styles apply.
      expect(text.hasClass('markdown-rendered')).toBe(true);
    }
    // The row around a title has no direction of its own: the count stays at the end.
    expect(one(night, 'spellbook-scrivenings-divider').getAttr('dir')).toBeNull();
  });

  it('says so in place of a scene whose note is missing or empty, and goes on with the rest', async () => {
    const vault = novelVault();
    vault.external.write(inNovel(LETTER), { body: '\n\n%% to be written %%\n' }, { silent: true });
    const s = await stage(vault);
    const { pane } = await openPane(s);
    const ghost = sceneCalled(pane, 'Ghost');
    expect(one(ghost, 'spellbook-scrivenings-note').text).toBe(MISSING_LABEL);
    expect(one(ghost, 'spellbook-scrivenings-edit').hasClass('spellbook-scrivenings-is-off')).toBe(true);
    expect(one(sceneCalled(pane, 'The Letter'), 'spellbook-scrivenings-note').text).toBe(EMPTY_SCENE_TEXT);
    expect(paragraphsOf(sceneCalled(pane, 'Closing'))).toEqual(['The end came quietly.']);
  });

  it('says so in place of a scene that cannot be read, and reads it when its note changes', async () => {
    const vault = novelVault();
    const s = await stage(vault);
    // The note is gone from the disk, and the binder has not heard of it yet.
    vault.external.delete(inNovel(LETTER), { silent: true });
    const { pane } = await openPane(s);
    const letter = sceneCalled(pane, 'The Letter');
    expect(one(letter, 'spellbook-scrivenings-note').text).toBe(UNREAD_TEXT);
    expect(paragraphsOf(sceneCalled(pane, 'Opening'))).toHaveLength(3);
    expect(paragraphsOf(sceneCalled(pane, 'Closing'))).toEqual(['The end came quietly.']);

    vault.external.create(inNovel(LETTER), { body: 'Dear Anna, here I am again.\n' }, { silent: true });
    vault.external.write(inNovel(LETTER), { body: 'Dear Anna, here I am again.\n' });
    await calm(s);
    expect(sceneCalled(pane, 'The Letter')).toBe(letter);
    expect(paragraphsOf(letter)).toEqual(['Dear Anna, here I am again.']);
  });

  it('shows plain paragraphs when Obsidian cannot draw formatted text', async () => {
    renderer.broken = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const s = await stage();
      const { pane } = await openPane(s);
      const opening = sceneCalled(pane, 'Opening');
      expect(paragraphsOf(opening)).toEqual([
        '# Chapter One',
        'It was a dark night. The harbour was empty, and Anna walked alone.',
        '"Who is there?" she asked. **Nobody** answered!',
      ]);
      const plain = textElOf(sceneCalled(pane, NIGHT_TITLE)).children;
      expect(plain.map((paragraph) => [paragraph.tag, paragraph.hasClass('spellbook-scrivenings-plain'), paragraph.getAttr('dir')])).toEqual(
        NIGHT_BODY.split(/\n\n/).map(() => ['p', true, 'auto']),
      );
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('says so when there is no project, and shows one as soon as it is opened', async () => {
    const s = await stage(novelVault(), { open: null });
    const { pane } = await openPane(s);
    expect(messageOf(pane)).toBe(NO_PROJECT_TEXT);
    expect(scenesOf(pane)).toEqual([]);
    expect(summaryOf(pane)).toBe('');
    await s.store.openProject(NOVEL_INDEX);
    await calm(s);
    expect(messageOf(pane)).toBe('');
    expect(titlesOf(pane)).toHaveLength(5);
    expect(paragraphsOf(sceneCalled(pane, 'Closing'))).toEqual(['The end came quietly.']);
  });

  it('says so for a manuscript with no scenes', async () => {
    const vault = new MemoryVault();
    vault.seed(NOVEL_INDEX, { frontmatter: { spellbook: 'project', version: 1, title: 'Empty', binder: [] }, body: INDEX_BODY });
    const s = await stage(vault);
    const { pane } = await openPane(s);
    expect(messageOf(pane)).toBe(NO_SCENES_TEXT);
  });
});

describe('a long manuscript', () => {
  it('draws only the scenes near what the writer sees, and leaves room of about the right height for the rest', async () => {
    const s = await stage(longVault(100));
    const { pane } = await openPane(s, { width: 900, height: 800 });
    expect(titlesOf(pane)).toHaveLength(100);
    expect(summaryOf(pane)).toBe('100 scenes, 30,000 words');
    const drawn = drawnTitles(pane);
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    expect(drawn.length).toBeLessThanOrEqual(6);
    expect(drawn).toEqual(Array.from({ length: drawn.length }, (_, at) => sceneName(at + 1)));
    expect(renderer.drawn).toHaveLength(drawn.length);
    // The rest are room, each as tall as a scene of 300 words is taken to be in a pane this wide.
    const rooms = scenesOf(pane).filter(isRoom);
    expect(rooms).toHaveLength(100 - drawn.length);
    expect(new Set(rooms.map(roomOf))).toEqual(new Set([estimateHeight(300, 900)]));
    expect(rooms.every((scene) => paragraphsOf(scene).length === 0)).toBe(true);
    // Every divider is there all the same: the titles and the counts cost little.
    expect(countOf(sceneCalled(pane, sceneName(77)))).toBe('300 words');
  });

  it('draws the scenes the writer scrolls to, and lets go of the ones left far behind', async () => {
    const s = await stage(longVault(100));
    const open = await openPane(s, { width: 900, height: 800 });
    const { pane } = open;
    const each = estimateHeight(300, 900);
    await scrollTo(s, open, each * 50);
    const there = drawnTitles(pane);
    expect(there).toContain(sceneName(51));
    expect(there).not.toContain(sceneName(1));
    expect(there.length).toBeLessThanOrEqual(12);
    expect(paragraphsOf(sceneCalled(pane, sceneName(51)))[0]).toMatch(/^Scene51 word word/);
    // What was drawn at the top was let go of: its text is off the page, and what it had set up was taken away.
    expect(isRoom(sceneCalled(pane, sceneName(1)))).toBe(true);
    expect(paragraphsOf(sceneCalled(pane, sceneName(1)))).toEqual([]);
    expect(renderer.undrawn).toBeGreaterThanOrEqual(2);

    // To the end and back again: never more than a few scenes on the page.
    for (const top of [each * 99, each * 20, 0]) {
      await scrollTo(s, open, top);
      expect(drawnTitles(pane).length).toBeLessThanOrEqual(12);
    }
    expect(drawnTitles(pane)).toContain(sceneName(1));
    expect(renderer.drawn.length).toBeLessThan(40);
  });

  it('draws one scene at a time, the one in front of the writer first', async () => {
    const s = await stage(longVault(60));
    const open = await openPane(s, { width: 900, height: 800 });
    renderer.drawn.length = 0;
    const each = estimateHeight(300, 900);
    await scrollTo(s, open, each * 30 + 10);
    expect(drawnNotes()[0]).toBe(sceneName(31));
    expect(new Set(drawnNotes()).size).toBe(drawnNotes().length); // none was drawn twice
  });

  it('keeps the line the writer is reading in place when a scene above it turns out taller than was guessed', async () => {
    const callbacks: Array<(entries: Array<{ target: unknown }>) => void> = [];
    class Watcher {
      constructor(callback: (entries: Array<{ target: unknown }>) => void) {
        callbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', Watcher);
    const s = await stage(longVault(60));
    const open = await openPane(s, { width: 900, height: 800 });
    const each = estimateHeight(300, 900);
    // The writer is a quarter into scene 31.
    await scrollTo(s, open, each * 30 + each / 4);
    const above = sceneCalled(open.pane, sceneName(30));
    expect(isRoom(above)).toBe(false);
    // The browser reports that scene 30, once drawn, is 500 taller than the guess.
    above.rect = { ...above.rect, height: each + 500 };
    for (const callback of callbacks) callback([{ target: above }]);
    await calm(s);
    expect(open.scroller.scrollTop).toBeCloseTo(each * 30 + each / 4 + 500, 3);
    // And when it is let go of later, its room is the height it was measured at.
    await scrollTo(s, open, 0);
    expect(roomOf(above)).toBe(each + 500);
  });
});

describe('choosing what is shown', () => {
  it('offers the whole manuscript and every folder of the binder', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    expect(scopeMenu(pane).outline).toEqual([SCOPE_MANUSCRIPT_TEXT, '---', 'Part one', INNER_NAME]);
  });

  it('shows one folder, with the folders inside it, and the whole manuscript again', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    await choose(s, pane, 'Part one');
    expect(titlesOf(pane)).toEqual(['The Letter', NIGHT_TITLE]);
    expect(summaryOf(pane)).toBe('2 scenes, 28 words');
    expect(one(pane, 'spellbook-scrivenings-scope').text).toBe('Part one');
    await choose(s, pane, INNER_NAME);
    expect(titlesOf(pane)).toEqual([NIGHT_TITLE]);
    // A folder's name is the writer's own text.
    expect(one(pane, 'spellbook-scrivenings-scope').getAttr('dir')).toBe('auto');
    await choose(s, pane, SCOPE_MANUSCRIPT_TEXT);
    expect(titlesOf(pane)).toHaveLength(5);
    expect(one(pane, 'spellbook-scrivenings-scope').getAttr('dir')).toBeNull();
  });

  it('says so when the folder on show is taken out of the binder', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    await choose(s, pane, INNER_NAME);
    await s.store.removeFolder('f-inner');
    await calm(s);
    expect(messageOf(pane)).toBe(NO_FOLDER_TEXT);
    await choose(s, pane, 'Part one');
    expect(titlesOf(pane)).toEqual(['The Letter', NIGHT_TITLE]);
  });
});

describe('following the project', () => {
  it('draws a scene again when its note is saved, and no other', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    const before = scenesOf(pane);
    renderer.drawn.length = 0;
    s.vault.external.write(inNovel(LETTER), { body: 'Dear Anna, everything has changed.\n\nYours, M.\n' });
    await calm(s);
    expect(drawnNotes()).toEqual(['The Letter']);
    expect(scenesOf(pane)).toEqual(before); // the very same elements
    expect(paragraphsOf(sceneCalled(pane, 'The Letter'))).toEqual(['Dear Anna, everything has changed.', 'Yours, M.']);
    expect(countOf(sceneCalled(pane, 'The Letter'))).toBe('7 words');
    expect(summaryOf(pane)).toBe('5 scenes, 51 words');
    // What the old drawing had set up was taken away.
    expect(renderer.undrawn).toBe(1);
  });

  it('draws nothing again when only the properties of a scene change', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    const text = textElOf(sceneCalled(pane, 'Opening'));
    renderer.drawn.length = 0;
    s.vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
      frontmatter['status'] = 'Revised';
      frontmatter['label'] = 'Anna';
    });
    await calm(s);
    expect(renderer.drawn).toEqual([]);
    expect(textElOf(sceneCalled(pane, 'Opening'))).toBe(text);
  });

  it('puts a new scene in its place and leaves the others as they are', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    const before = scenesOf(pane);
    renderer.drawn.length = 0;
    await s.store.addScene('Interlude', { at: 'after', sibling: { kind: 'scene', path: OPENING } });
    await calm(s);
    expect(titlesOf(pane)).toEqual(['Opening', 'Interlude', 'The Letter', NIGHT_TITLE, 'Ghost', 'Closing']);
    const after = scenesOf(pane);
    expect(after.filter((scene) => !before.includes(scene)).map((scene) => one(scene, 'spellbook-scrivenings-title').text)).toEqual(['Interlude']);
    expect(before.every((scene) => after.includes(scene))).toBe(true);
    // It has no text yet, and says so; nothing else was read or drawn again.
    expect(one(sceneCalled(pane, 'Interlude'), 'spellbook-scrivenings-note').text).toBe(EMPTY_SCENE_TEXT);
    expect(drawnNotes()).toEqual([]);
    expect(summaryOf(pane)).toMatch(/^6 scenes, /);
  });

  it('moves a scene with the binder, without drawing anything again', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    const closing = sceneCalled(pane, 'Closing');
    const text = textElOf(closing);
    renderer.drawn.length = 0;
    await s.store.moveNode({ kind: 'scene', path: CLOSING }, { at: 'start', parentId: null });
    await calm(s);
    expect(titlesOf(pane)).toEqual(['Closing', 'Opening', 'The Letter', NIGHT_TITLE, 'Ghost']);
    expect(scenesOf(pane)[0]).toBe(closing);
    expect(textElOf(closing)).toBe(text);
    expect(renderer.drawn).toEqual([]);
  });

  it('gives a renamed scene its new title and keeps what was drawn for it', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    const letter = sceneCalled(pane, 'The Letter');
    const text = textElOf(letter);
    renderer.drawn.length = 0;
    await s.store.renameScene(LETTER, 'The Second Letter');
    await calm(s);
    expect(titlesOf(pane)).toEqual(['Opening', 'The Second Letter', NIGHT_TITLE, 'Ghost', 'Closing']);
    expect(sceneCalled(pane, 'The Second Letter')).toBe(letter);
    expect(textElOf(letter)).toBe(text);
    expect(renderer.drawn).toEqual([]);
    expect(one(letter, 'spellbook-scrivenings-edit').getAttr('aria-label')).toBe(`${EDIT_TEXT} "The Second Letter"`);
    // It is still followed, under its new name.
    s.vault.external.write(inNovel('Manuscript/The Second Letter.md'), { body: 'Rewritten.\n' });
    await calm(s);
    expect(paragraphsOf(letter)).toEqual(['Rewritten.']);
  });

  it('takes a deleted scene away, and shows a missing one once its note arrives', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    const opening = sceneCalled(pane, 'Opening');
    await s.store.deleteScene(LETTER);
    await calm(s);
    expect(titlesOf(pane)).toEqual(['Opening', NIGHT_TITLE, 'Ghost', 'Closing']);
    expect(scenesOf(pane)[0]).toBe(opening);
    // The note of "Ghost" arrives from another device.
    const ghost = sceneCalled(pane, 'Ghost');
    s.vault.external.create(inNovel(GHOST), { body: 'Boo, said the ghost.\n' });
    await calm(s);
    expect(sceneCalled(pane, 'Ghost')).toBe(ghost);
    expect(paragraphsOf(ghost)).toEqual(['Boo, said the ghost.']);
    expect(one(ghost, 'spellbook-scrivenings-edit').hasClass('spellbook-scrivenings-is-off')).toBe(false);
    expect(countOf(ghost)).toBe('4 words');
  });

  it('stays in the scene the writer is reading when scenes above it are added and removed', async () => {
    const s = await stage(longVault(60));
    const open = await openPane(s, { width: 900, height: 800 });
    const each = estimateHeight(300, 900);
    await scrollTo(s, open, each * 30 + each / 2); // half way into scene 31
    await s.store.deleteScene(`Manuscript/${sceneName(3)}.md`);
    await calm(s);
    expect(open.scroller.scrollTop).toBeCloseTo(each * 29 + each / 2, 3);
    await s.store.moveNode({ kind: 'scene', path: `Manuscript/${sceneName(50)}.md` }, { at: 'start', parentId: null });
    await calm(s);
    expect(open.scroller.scrollTop).toBeCloseTo(each * 30 + each / 2, 3);
    expect(drawnTitles(open.pane)).toContain(sceneName(31));
  });
});

describe('editing a scene', () => {
  /** Stand in for the note that Obsidian shows in front after it was asked to open one. */
  async function withEditor(s: Wired): Promise<void> {
    const { MarkdownView } = (await import('obsidian')) as unknown as { MarkdownView: new () => { file: { path: string } | null } };
    const editor = new MarkdownView();
    (s.workspace as unknown as { getActiveViewOfType: (type: unknown) => unknown }).getActiveViewOfType = (type) => {
      const last = s.opened[s.opened.length - 1];
      editor.file = last ? { path: last.path } : null;
      return type === MarkdownView ? editor : null;
    };
  }

  it('opens the scene\'s own note from its title, and from Edit at the top of its text', async () => {
    const s = await stage();
    await withEditor(s);
    const { pane } = await openPane(s);
    const opening = sceneCalled(pane, 'Opening');
    one(opening, 'spellbook-scrivenings-title').fire('click');
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(OPENING), where: false }]);
    expect(renderer.cursors).toEqual([]); // wherever Obsidian puts the cursor

    one(opening, 'spellbook-scrivenings-edit').fire('click', { metaKey: true });
    await calm(s);
    expect(s.opened[1]).toEqual({ path: inNovel(OPENING), where: 'tab' });
    // Under the five lines of its properties block.
    expect(renderer.cursors).toEqual([{ line: 5, ch: 0 }]);
    expect(renderer.arrivals).toEqual([{ line: 5 }]);
  });

  it('opens the note at the paragraph that was tapped', async () => {
    const s = await stage();
    await withEditor(s);
    const { pane } = await openPane(s);
    const paragraphs = textElOf(sceneCalled(pane, 'Opening')).children;
    (paragraphs[2] as FakeElement).fire('click');
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(OPENING), where: false }]);
    // Five lines of properties, then the heading, a gap, a paragraph, a gap: line 9.
    expect(renderer.cursors).toEqual([{ line: 9, ch: 0 }]);

    // A Hebrew paragraph, in a scene with three lines of properties.
    const hebrew = textElOf(sceneCalled(pane, NIGHT_TITLE)).children;
    (hebrew[2] as FakeElement).fire('click');
    await calm(s);
    expect(s.opened[1]).toEqual({ path: inNovel(NIGHT), where: false });
    expect(renderer.cursors[1]).toEqual({ line: 7, ch: 0 });
  });

  it('shows the text as it is after the note was changed in the editor', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    const closing = sceneCalled(pane, 'Closing');
    (textElOf(closing).children[0] as FakeElement).fire('click');
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(CLOSING), where: false }]);
    // The writer types in Obsidian's editor, which saves the note its own way.
    s.vault.external.write(inNovel(CLOSING), { body: 'The end came quietly.\n\nOr so they thought.\n' });
    await calm(s);
    expect(paragraphsOf(closing)).toEqual(['The end came quietly.', 'Or so they thought.']);
  });

  it('does not take a tap on the divider, or on a scene with no note, for a tap on the text', async () => {
    const s = await stage();
    const { pane } = await openPane(s);
    one(sceneCalled(pane, 'Opening'), 'spellbook-scrivenings-divider').fire('click');
    one(sceneCalled(pane, 'Opening'), 'spellbook-scrivenings-count').fire('click');
    textElOf(sceneCalled(pane, 'Ghost')).fire('click');
    await calm(s);
    expect(s.opened).toEqual([]);
    // The title of a scene with no note says why nothing opens.
    one(sceneCalled(pane, 'Ghost'), 'spellbook-scrivenings-title').fire('click');
    await calm(s);
    expect(s.opened).toEqual([]);
    expect(StubNotice.shown.map((notice) => notice.message)).toEqual([`"Ghost": ${MISSING_LABEL}.`]);
  });

  it('never writes to the vault', async () => {
    const s = await stage();
    const open = await openPane(s);
    await choose(s, open.pane, 'Part one');
    (textElOf(sceneCalled(open.pane, 'The Letter')).children[0] as FakeElement).fire('click');
    await scrollTo(s, open, 40);
    open.leaf.detach();
    await calm(s);
    expect(s.vault.writes).toEqual([]);
  });
});

describe('what the device remembers', () => {
  it('saves nothing for a pane that was only looked at', async () => {
    const s = await stage();
    const { leaf } = await openPane(s);
    leaf.detach();
    await calm(s);
    expect(s.storage.saves).toEqual([]);
  });

  it('remembers the folder on show and how far the writer had read, and comes back to both', async () => {
    const storage = new MemoryDeviceStorage();
    const first = await stage(longVault(60), { storage });
    const open = await openPane(first, { width: 900, height: 800 });
    const each = estimateHeight(300, 900);
    open.scroller.scrollTop = each * 20 + each / 2;
    open.scroller.dispatch('scroll');
    // Not at every scroll: once the writer has stopped for a moment.
    expect(storage.saves).toEqual([]);
    first.timers.advance(SAVE_PLACE_MS);
    expect(storage.saves.map(([key]) => key)).toEqual([MEMORY_KEY]);
    expect(readMemory(storage.load(MEMORY_KEY)).get(NOVEL_INDEX)).toEqual({
      scope: { kind: 'manuscript' },
      place: { path: `Manuscript/${sceneName(21)}.md`, fraction: 0.5 },
    });
    first.switchOff();

    // Obsidian is opened again, on the same device.
    renderer.drawn.length = 0;
    const second = await stage(longVault(60), { storage });
    const again = await openPane(second, { width: 900, height: 800 });
    expect(again.scroller.scrollTop).toBeCloseTo(each * 20 + each / 2, 3);
    expect(drawnTitles(again.pane)).toContain(sceneName(21));
    expect(drawnNotes()).not.toContain(sceneName(1)); // the top was never drawn
  });

  it('remembers the scope for each project', async () => {
    const storage = new MemoryDeviceStorage();
    const first = await stage(novelVault(), { storage });
    const { pane } = await openPane(first);
    await choose(first, pane, 'Part one');
    expect(readMemory(storage.load(MEMORY_KEY)).get(NOVEL_INDEX)).toEqual({ scope: { kind: 'folder', id: 'f-one' }, place: null });
    first.switchOff();

    const second = await stage(novelVault(), { storage });
    const again = await openPane(second);
    expect(titlesOf(again.pane)).toEqual(['The Letter', NIGHT_TITLE]);
    expect(one(again.pane, 'spellbook-scrivenings-scope').text).toBe('Part one');
  });

  it('goes on without a storage that fails', async () => {
    const storage = new MemoryDeviceStorage();
    storage.broken = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const s = await stage(novelVault(), { storage });
      const { pane } = await openPane(s);
      await choose(s, pane, 'Part one');
      expect(titlesOf(pane)).toEqual(['The Letter', NIGHT_TITLE]);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});

describe('on a phone and in a narrow pane', () => {
  it('marks the pane for touch on a phone, and for a narrow layout by its measured width', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    const s = await stage(longVault(50));
    const open = await openPane(s, { width: 390, height: 700 });
    const root = one(open.pane, 'spellbook-scrivenings');
    expect(['spellbook-is-mobile', 'spellbook-is-phone', 'spellbook-is-narrow'].map((cls) => root.hasClass(cls))).toEqual([true, true, true]);
    // On a phone the drawers were slid away so that the manuscript can be seen.
    expect([s.workspace.leftSplit.collapsed, s.workspace.rightSplit.collapsed]).toEqual([true, true]);
    // Fifty scenes, a few of them on the page; a narrow pane makes each scene taller.
    expect(titlesOf(open.pane)).toHaveLength(50);
    expect(drawnTitles(open.pane).length).toBeLessThanOrEqual(6);
    expect(roomOf(sceneCalled(open.pane, sceneName(40)))).toBe(estimateHeight(300, 390));
    expect(estimateHeight(300, 390)).toBeGreaterThan(estimateHeight(300, 900));
  });

  it('guesses the far scenes anew when the pane gets wider, and stays in the scene the writer was reading', async () => {
    const s = await stage(longVault(50));
    const open = await openPane(s, { width: 390, height: 700 });
    const narrow = estimateHeight(300, 390);
    await scrollTo(s, open, narrow * 25);
    resize(open, { width: 900, height: 700 });
    await calm(s);
    const wide = estimateHeight(300, 900);
    expect(one(open.pane, 'spellbook-scrivenings').hasClass('spellbook-is-narrow')).toBe(false);
    expect(roomOf(sceneCalled(open.pane, sceneName(45)))).toBe(wide);
    expect(open.scroller.scrollTop).toBeCloseTo(wide * 25, 3);
    expect(drawnTitles(open.pane)).toContain(sceneName(26));
  });

  it('keeps its place while the pane is hidden behind another tab', async () => {
    const s = await stage(longVault(50));
    const open = await openPane(s, { width: 900, height: 800 });
    const each = estimateHeight(300, 900);
    await scrollTo(s, open, each * 10);
    // Hidden: the browser reports no width, and the scroll position of a hidden pane is lost.
    open.pane.clientWidth = 0;
    open.view.onResize();
    open.scroller.scrollTop = 0;
    open.scroller.dispatch('scroll');
    await calm(s);
    resize(open, { width: 900, height: 800 });
    await calm(s);
    expect(open.scroller.scrollTop).toBeCloseTo(each * 10, 3);
  });
});

describe('the pane itself', () => {
  it('is the kind of pane the feature registered', async () => {
    const s = await stage();
    const open = await openPane(s);
    const view: ScriveningsView = paneOf(s).view;
    expect(view).toBe(open.view);
    expect(view.getViewType()).toBe(SCRIVENINGS_VIEW_TYPE);
  });
});
