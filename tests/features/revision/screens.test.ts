// The Revision pane and the Find and replace window, as the writer uses them.

import { afterEach, describe, expect, it } from 'vitest';
import type { Plugin as ObsidianPlugin } from 'obsidian';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { registerFeatures } from '../../../src/features/registry';
import { RENAME_EVERYWHERE_SERVICE } from '../../../src/core/revision/index';
import type { RenameEverywhereService } from '../../../src/core/revision/index';
import { REVISION_VIEW_TYPE, revisionFeature } from '../../../src/features/revision/index';
import type { RevisionView } from '../../../src/features/revision/index';
import { snapshotsFeature } from '../../../src/features/snapshots/index';
import { FakeObsidian } from '../../fakeObsidianApp';
import { Modal as StubModal, Plugin as StubPlugin } from '../../obsidianStub';
import type { ButtonComponent, FakeElement, StubCommand, ToggleComponent } from '../../obsidianStub';
import { MemoryDeviceStorage, makeStore } from '../../storeHarness';
import { NIGHT, NOON, NOVEL_INDEX, OPENING, calm, inNovel, novelVault } from '../snapshots/stage';

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

async function stage() {
  const vault = novelVault();
  vault.seed(inNovel(OPENING), {
    frontmatter: {
      order: 1024,
      'revision-notes': [
        { passage: 'dark night', note: 'Colder.', created: '2026-10-13', done: false },
        { passage: 'not in the text', note: 'Rewritten since.', created: '2026-10-13', done: false },
        { passage: 'Anna walked alone', note: 'Why?', created: '2026-10-12', done: true },
      ],
    },
    body: 'It was a dark night. The harbour was empty, and Anna walked alone.\n',
  });
  vault.seed(inNovel('World/Characters/Anna.md'), { frontmatter: { type: 'character', aliases: [] }, body: 'Anna keeps the light.\n' });
  vault.seed('Notes/Diary.md', { body: 'Met [[Anna]].' });
  const { store, timers } = makeStore(vault);
  await store.openProject(NOVEL_INDEX);
  const fake = new FakeObsidian();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const features = registerFeatures([snapshotsFeature, revisionFeature], {
    plugin: plugin as unknown as ObsidianPlugin,
    app: fake.app,
    store,
    vault,
    storage: new MemoryDeviceStorage(),
    deviceId: () => 'testdevice',
    clock: { today: () => '2026-10-14', now: () => NOON, setTimer: timers.set, nextFrame: (callback) => timers.set(() => callback(16), 16) },
    wordCounts,
    openNote: async () => true,
  });
  stops.push(() => {
    features.release();
    plugin.unload();
    wordCounts.dispose();
    store.dispose();
  });
  const command = (id: string): StubCommand => {
    const found = plugin.commands.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
  };
  return { vault, store, timers, fake, command, features };
}

const texts = (root: FakeElement, cls: string): string[] => root.withClass(cls).map((element) => element.fullText);

function button(modal: StubModal, text: string): ButtonComponent {
  for (const row of modal.contentEl.all().flatMap((element) => element.settings)) {
    for (const component of row.components) {
      const found = component as ButtonComponent;
      if (found.buttonEl?.text.startsWith(text)) return found;
    }
  }
  throw new Error(`no button "${text}"`);
}

function toggle(modal: StubModal, name: string): ToggleComponent {
  for (const row of modal.contentEl.all().flatMap((element) => element.settings)) {
    if (row.nameEl.text !== name) continue;
    const found = row.toggles[0];
    if (found) return found;
  }
  throw new Error(`no toggle "${name}"`);
}

const lastWindow = (): StubModal => {
  const modal = StubModal.opened[StubModal.opened.length - 1];
  if (!modal?.isOpen) throw new Error('no window is open');
  return modal;
};

describe('the Revision pane', () => {
  it('lists the open notes by scene, says which passages changed, and filters by done', async () => {
    const s = await stage();
    s.command('open-revision').callback?.();
    await calm(s);
    const leaf = s.fake.workspace.getLeavesOfType(REVISION_VIEW_TYPE)[0];
    const view = leaf?.view as unknown as RevisionView & { contentEl: FakeElement };
    expect(view).toBeTruthy();
    s.timers.advance(1000);
    await calm(s);
    const pane = view.contentEl;
    expect(texts(pane, 'spellbook-revision-status')).toEqual(['2 open notes in 1 scene']);
    expect(texts(pane, 'spellbook-revision-scene-title')).toEqual(['Opening']);
    expect(texts(pane, 'spellbook-revision-passage')).toEqual(['dark night', 'not in the text']);
    expect(texts(pane, 'spellbook-revision-changed')).toEqual(['Passage changed']);
    const done = pane.withClass('spellbook-revision-segment').find((element) => element.text === 'Done');
    done?.fire('click');
    expect(texts(pane, 'spellbook-revision-passage')).toEqual(['Anna walked alone']);
    // Every passage and note is the writer's text, in either direction.
    for (const element of pane.withClass('spellbook-revision-passage')) expect(element.getAttr('dir')).toBe('auto');
  });

  it('keeps Edit and a quiet Delete together at the end of each note', async () => {
    const s = await stage();
    s.command('open-revision').callback?.();
    await calm(s);
    const view = s.fake.workspace.getLeavesOfType(REVISION_VIEW_TYPE)[0]?.view as unknown as { contentEl: FakeElement };
    s.timers.advance(1000);
    await calm(s);
    const pane = view.contentEl;
    const groups = pane.withClass('spellbook-revision-actions');
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.children.map((child) => child.text)).toEqual(['Edit', 'Delete']);
      const remove = group.children[1] as FakeElement;
      expect(remove.hasClass('spellbook-revision-delete')).toBe(true);
      expect(remove.hasClass('mod-warning')).toBe(false);
      expect(remove.getAttr('aria-label')).toBe('Delete');
    }
  });
});

describe('the Find and replace window', () => {
  it('finds, lists every place with a tick, and replaces only the ticked ones once confirmed', async () => {
    const s = await stage();
    s.command('find-and-replace').callback?.();
    const modal = lastWindow();
    const find = modal.contentEl.withClass('spellbook-revision-find-input')[0] as FakeElement;
    const replace = modal.contentEl.withClass('spellbook-revision-find-input')[1] as FakeElement;
    find.value = 'was';
    replace.value = 'is';
    button(modal, 'Search').click();
    await calm(s);
    expect(texts(modal.contentEl, 'spellbook-revision-find-status')).toEqual(['Found 2 times in 1 scene.']);
    expect(texts(modal.contentEl, 'spellbook-revision-result-match')).toEqual(['was', 'was']);
    expect(button(modal, 'Replace').buttonEl.text).toBe('Replace 2 changes in 1 scene');
    // Untick the first place.
    const boxes = modal.contentEl.withClass('spellbook-revision-result').map((row) => row.children[0] as FakeElement & { checked: boolean });
    (boxes[0] as { checked: boolean }).checked = false;
    boxes[0]?.fire('change');
    expect(button(modal, 'Replace').buttonEl.text).toBe('Replace 1 change in 1 scene');
    button(modal, 'Replace').click();
    const confirm = lastWindow();
    expect(confirm.titleEl.text).toBe('Replace 1 change in 1 scene?');
    button(confirm, 'Replace').click();
    await calm(s);
    expect(s.vault.bodyOf(inNovel(OPENING))).toBe('It was a dark night. The harbour is empty, and Anna walked alone.\n');
    expect(s.vault.paths().filter((path) => path.startsWith('Novel/Snapshots/'))).toHaveLength(1);
    expect(s.vault.bodyOf(inNovel(NIGHT))).not.toContain('is empty');
  });
});

describe('the Find and replace window, with the writer\'s capitals and Hebrew', () => {
  it('gives each replacement the capitals of the words it replaces, unless Match case is on', async () => {
    const s = await stage();
    s.command('find-and-replace').callback?.();
    const modal = lastWindow();
    const [find, replace] = modal.contentEl.withClass('spellbook-revision-find-input') as FakeElement[];
    (find as FakeElement).value = 'anna walked';
    (replace as FakeElement).value = 'dina ran';
    button(modal, 'Search').click();
    await calm(s);
    button(modal, 'Replace').click();
    const confirm = lastWindow();
    expect(confirm.contentEl.fullText).toContain('Each replacement takes the capitals of the words it replaces.');
    button(confirm, 'Replace').click();
    await calm(s);
    expect(s.vault.bodyOf(inNovel(OPENING))).toBe('It was a dark night. The harbour was empty, and Dina ran alone.\n');
  });

  it('replaces exactly as typed with Match case on', async () => {
    const s = await stage();
    s.command('find-and-replace').callback?.();
    const modal = lastWindow();
    toggle(modal, 'Match case').flip();
    const [find, replace] = modal.contentEl.withClass('spellbook-revision-find-input') as FakeElement[];
    (find as FakeElement).value = 'Anna';
    (replace as FakeElement).value = 'dina';
    button(modal, 'Search').click();
    await calm(s);
    button(modal, 'Replace').click();
    button(lastWindow(), 'Replace').click();
    await calm(s);
    expect(s.vault.bodyOf(inNovel(OPENING))).toContain('and dina walked alone.');
  });

  it('shows a Hebrew word with a letter joined to its front, unticked and marked, when looking for whole words', async () => {
    const s = await stage();
    s.command('find-and-replace').callback?.();
    const modal = lastWindow();
    toggle(modal, 'Whole words').flip();
    const [find] = modal.contentEl.withClass('spellbook-revision-find-input') as FakeElement[];
    (find as FakeElement).value = 'נמל';
    button(modal, 'Search').click();
    await calm(s);
    const rows = modal.contentEl.withClass('spellbook-revision-result');
    expect(rows).toHaveLength(1);
    expect(texts(modal.contentEl, 'spellbook-revision-result-note')).toEqual(['joined letter']);
    expect((rows[0]?.children[0] as unknown as { checked: boolean }).checked).toBe(false);
    expect(button(modal, 'Replace').buttonEl.text).toBe('Replace');
    // Each row takes the direction of its own words, so that the tick stands at their start.
    expect(rows[0]?.getAttr('dir')).toBe('rtl');
    for (const head of modal.contentEl.withClass('spellbook-revision-result-head')) expect(head.getAttr('dir')).toBe('auto');
  });
});

describe('the Rename everywhere window', () => {
  it('says truly what happens to links, shows that it is busy, and finishes without waiting on any question', async () => {
    const s = await stage();
    s.features.services.get<RenameEverywhereService>(RENAME_EVERYWHERE_SERVICE)?.open('World/Characters/Anna.md');
    const modal = lastWindow();
    await calm(s);
    const box = modal.contentEl.withClass('spellbook-revision-find-input')[0] as FakeElement;
    box.value = 'Dina';
    box.fire('input');
    const lines = texts(modal.contentEl, 'spellbook-revision-rename-line');
    expect(lines[0]).toBe('The note "Anna" becomes "Dina". Every link to it in the project is changed to the new name.');
    expect(lines[1]).toBe('1 note outside the project links to it. Spellbook changes nothing outside the project, so that link keeps the old name.');
    expect(lines.join(' ')).not.toContain('Links to it follow');
    button(modal, 'Rename').click();
    button(lastWindow(), 'Rename').click();
    // At once, before anything is written: the window says it is at work.
    expect(button(modal, 'Renaming').buttonEl.text).toBe('Renaming…');
    expect(texts(modal.contentEl, 'spellbook-revision-rename-busy')[0]).toMatch(/^Renaming: /);
    expect(modal.contentEl.getAttr('aria-busy')).toBe('true');
    await calm(s);
    expect(modal.isOpen).toBe(false);
    expect(s.vault.has(inNovel('World/Characters/Dina.md'))).toBe(true);
    expect(s.vault.bodyOf(inNovel(OPENING))).toContain('Dina walked alone');
  });
});
