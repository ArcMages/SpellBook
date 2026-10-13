// "In this scene" in the inspector, from end to end: the real corkboard
// feature (which owns the inspector) and the real world-building feature
// (which owns the entities), registered side by side. Neither knows the
// other: the inspector's part looks the service up by name.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCENE_ENTITIES_SERVICE } from '../../../src/core/world';
import type { SceneEntitiesService, SceneEntityChip } from '../../../src/core/world';
import { ENTITIES_SLOT_CLASS, INSPECTOR_VIEW_TYPE } from '../../../src/features/corkboard/inspectorView';
import { SCENE_ENTITIES_ADD, SCENE_ENTITIES_HEADING, SCENE_ENTITIES_NONE, mountSceneEntities } from '../../../src/features/corkboard/sceneEntities';
import { ManualTimers } from '../../memoryVault';
import { FakeElement, Menu as StubMenu, Modal as StubModal, Notice as StubNotice, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import {
  CLOSING,
  LETTER,
  MARA,
  MARA_HE,
  NIGHT,
  OPENING,
  calm,
  inNovel,
  lastWindow,
  novelVault,
  one,
  typeInto,
  wire,
} from './stage';
import type { Wired } from './stage';

const stages: Wired[] = [];

beforeEach(() => {
  StubMenu.shown.length = 0;
  StubNotice.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
  resetPlatform();
});

afterEach(() => {
  for (const made of stages.splice(0)) made.switchOff();
});

/** The inspector, open, with a scene in the editor. */
async function inspecting(scene: string | null, vault = novelVault()): Promise<{ s: Wired; pane: FakeElement }> {
  const s = await wire(vault, { inspector: true });
  stages.push(s);
  if (scene !== null) s.activate(inNovel(scene));
  s.command('open-inspector').callback?.();
  await calm(s);
  const view = s.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE)[0]?.view as unknown as { contentEl: FakeElement } | undefined;
  if (!view) throw new Error('the inspector did not open');
  return { s, pane: view.contentEl };
}

const chipNames = (pane: FakeElement): string[] => pane.withClass('spellbook-entity-chip-name').map((name) => name.text);

describe('"In this scene" in the inspector', () => {
  it('lists the open scene\'s entities as chips in the colour of their type, under the scene\'s dates', async () => {
    const { pane } = await inspecting(OPENING);
    const slot = one(pane, ENTITIES_SLOT_CLASS);
    const form = one(pane, 'spellbook-inspector-form');
    expect(form.children.indexOf(slot)).toBeGreaterThan(form.children.indexOf(one(pane, 'spellbook-inspector-dates')));
    expect(one(slot, 'spellbook-inspector-entities-head').text).toBe(SCENE_ENTITIES_HEADING);
    expect(chipNames(slot)).toEqual(['Mara', 'Saltwick']);
    const chips = slot.withClass('spellbook-entity-chip');
    expect(chips[0]?.hasClass('spellbook-world-color-blue')).toBe(true);
    expect(chips[1]?.hasClass('spellbook-world-color-green')).toBe(true);
    expect(one(chips[0] as FakeElement, 'spellbook-entity-chip-name').getAttr('dir')).toBe('auto');
    expect(one(chips[0] as FakeElement, 'spellbook-entity-chip-open').getAttr('aria-label')).toBe('Mara (Character)');
    expect(one(slot, 'spellbook-inspector-entities-add').text).toBe(SCENE_ENTITIES_ADD);
  });

  it('follows the editor from scene to scene, and shows nothing when no scene is open', async () => {
    const { s, pane } = await inspecting(OPENING);
    s.activate(inNovel(LETTER));
    await calm(s);
    expect(chipNames(pane)).toEqual([]);
    expect(one(pane, 'spellbook-inspector-entities-none').text).toBe(SCENE_ENTITIES_NONE);
    s.activate(inNovel(CLOSING));
    await calm(s);
    expect(chipNames(pane)).toEqual(['Saltwick', 'Nobody']);
    // A link that leads to no entity is shown as lost: it can be removed, not opened.
    const lost = pane.withClass('spellbook-entity-chip')[1] as FakeElement;
    expect(lost.hasClass('spellbook-entity-chip-lost')).toBe(true);
    expect(one(lost, 'spellbook-entity-chip-open').disabled).toBe(true);
    expect(lost.withClass('spellbook-entity-chip-remove')).toHaveLength(1);

    const none = await inspecting(null);
    expect(one(none.pane, ENTITIES_SLOT_CLASS).children).toEqual([]);
  });

  it('adds an entity through the list to search, and shows it at once', async () => {
    const { s, pane } = await inspecting(NIGHT);
    one(pane, 'spellbook-inspector-entities-add').fire('click');
    const picker = lastWindow();
    typeInto(one(picker.contentEl, 'spellbook-world-picker-input'), MARA_HE);
    picker.contentEl.withClass('spellbook-world-picker-entity')[0]?.fire('click');
    await calm(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(NIGHT) }]);
    expect(s.vault.frontmatterOf(inNovel(NIGHT))).toEqual({ status: 'To do', order: 3072, entities: [`[[${MARA_HE}]]`] });
    expect(chipNames(pane)).toEqual([MARA_HE]);
  });

  it('takes an entity out again with the small button on its chip, and opens its note on a tap of its name', async () => {
    const { s, pane } = await inspecting(OPENING);
    one(pane.withClass('spellbook-entity-chip')[0] as FakeElement, 'spellbook-entity-chip-open').fire('click');
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(MARA), where: false }]);
    // An entity's note is not a scene: the inspector has no scene to show until the writer is back in one.
    expect(one(pane, ENTITIES_SLOT_CLASS).children).toEqual([]);
    s.activate(inNovel(OPENING));
    await calm(s);
    expect(chipNames(pane)).toEqual(['Mara', 'Saltwick']);

    const remove = one(pane.withClass('spellbook-entity-chip')[0] as FakeElement, 'spellbook-entity-chip-remove');
    expect(remove.getAttr('aria-label')).toBe('Take Mara out of this scene');
    remove.fire('click');
    await calm(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(OPENING) }]);
    expect(s.vault.frontmatterOf(inNovel(OPENING))).toEqual({ status: 'To do', order: 1024, entities: ['[[Saltwick]]'] });
    expect(chipNames(pane)).toEqual(['Saltwick']);
    expect(StubNotice.shown).toEqual([]);
  });

  it('is emptied when the inspector closes, and stops listening', async () => {
    const { s, pane } = await inspecting(OPENING);
    const slot = one(pane, ENTITIES_SLOT_CLASS);
    const leaf = s.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE)[0];
    await (leaf?.view as unknown as { close(): Promise<void> }).close();
    expect(slot.children).toEqual([]);
    s.vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
      frontmatter['entities'] = ['[[Lamp]]'];
    });
    await calm(s);
    expect(slot.children).toEqual([]);
  });
});

describe('the part on its own', () => {
  const clock = (timers: ManualTimers): { setTimer: ManualTimers['set'] } => ({ setTimer: timers.set });
  const slotOf = (): FakeElement => new FakeElement();
  const mount = (slot: FakeElement, services: { get<T>(name: string): T | undefined }, timers: ManualTimers, path: () => string | null) =>
    mountSceneEntities(slot as unknown as HTMLElement, services, clock(timers), path);

  it('shows nothing when no service is offered, and nothing is left behind', () => {
    const timers = new ManualTimers();
    const slot = slotOf();
    const part = mount(slot, { get: () => undefined }, timers, () => 'Manuscript/A.md');
    timers.advance(0);
    part.refresh();
    expect(slot.children).toEqual([]);
    part.stop();
    expect(timers.pending).toBe(0);
  });

  it('looks once more in a moment for a service that is offered a little later', () => {
    const timers = new ManualTimers();
    const slot = slotOf();
    let offered: SceneEntitiesService | undefined;
    const chip: SceneEntityChip = { key: '[[A]]', name: 'A', typeName: '', color: null, icon: null, found: true };
    mount(slot, { get: <T>(name: string): T | undefined => (name === SCENE_ENTITIES_SERVICE ? (offered as T | undefined) : undefined) }, timers, () => 'Manuscript/A.md');
    expect(slot.children).toEqual([]);
    offered = { of: () => [chip], canChange: () => false, add: () => undefined, remove: async () => null, open: () => undefined, onChange: () => () => undefined };
    timers.advance(0);
    expect(slot.withClass('spellbook-entity-chip-name').map((name) => name.text)).toEqual(['A']);
    expect(slot.withClass('spellbook-entity-chip')[0]?.hasClass('spellbook-world-no-color')).toBe(true);
    // Nothing can be changed (a read-only project): the chips are shown, with nothing to change them with.
    expect(slot.withClass('spellbook-entity-chip-remove')).toEqual([]);
    expect(slot.withClass('spellbook-inspector-entities-add')).toEqual([]);
  });

  it('does not trust what it finds under the name before it has looked at it', () => {
    const timers = new ManualTimers();
    for (const found of [null, 'a line', 7, {}, { of: () => [] }, { of: 'x', canChange: 1, add: 1, remove: 1, open: 1, onChange: 1 }]) {
      const slot = slotOf();
      mount(slot, { get: <T>(): T | undefined => found as T }, timers, () => 'Manuscript/A.md');
      timers.advance(0);
      expect(slot.children, JSON.stringify(found)).toEqual([]);
    }
    // A service that fails, or answers with something that is no list of chips, shows no chips and breaks nothing.
    const slot = slotOf();
    const odd = {
      of: (): never => {
        throw new Error('not now');
      },
      canChange: () => true,
      add: () => undefined,
      remove: async () => 'It could not be taken out.',
      open: () => undefined,
      onChange: () => () => undefined,
    };
    const logged: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      mount(slot, { get: <T>(): T | undefined => odd as T }, timers, () => 'Manuscript/A.md');
    } finally {
      console.error = error;
    }
    expect(logged).toHaveLength(1);
    expect(slot.withClass('spellbook-entity-chip')).toEqual([]);
    expect(one(slot, 'spellbook-inspector-entities-none').text).toBe(SCENE_ENTITIES_NONE);
  });

  it('tells the writer when an entity could not be taken out', async () => {
    const timers = new ManualTimers();
    const slot = slotOf();
    const chip: SceneEntityChip = { key: '[[A]]', name: 'A', typeName: 'Character', color: 'red', icon: 'user', found: true };
    const service: SceneEntitiesService = {
      of: () => [chip],
      canChange: () => true,
      add: () => undefined,
      remove: async () => 'It could not be taken out.',
      open: () => undefined,
      onChange: () => () => undefined,
    };
    mount(slot, { get: <T>(): T | undefined => service as T }, timers, () => 'Manuscript/A.md');
    one(slot, 'spellbook-entity-chip-remove').fire('click');
    await Promise.resolve();
    await Promise.resolve();
    expect(StubNotice.shown.map((notice) => notice.message)).toEqual(['It could not be taken out.']);
  });
});
