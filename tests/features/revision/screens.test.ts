// The Revision pane and the Find and replace window, as the writer uses them.

import { afterEach, describe, expect, it } from 'vitest';
import type { Plugin as ObsidianPlugin } from 'obsidian';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { registerFeatures } from '../../../src/features/registry';
import { REVISION_VIEW_TYPE, revisionFeature } from '../../../src/features/revision/index';
import type { RevisionView } from '../../../src/features/revision/index';
import { snapshotsFeature } from '../../../src/features/snapshots/index';
import { FakeObsidian } from '../../fakeObsidianApp';
import { Modal as StubModal, Plugin as StubPlugin } from '../../obsidianStub';
import type { ButtonComponent, FakeElement, StubCommand } from '../../obsidianStub';
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
  return { vault, store, timers, fake, command };
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
