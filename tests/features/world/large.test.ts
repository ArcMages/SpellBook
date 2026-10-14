// A big world: 120 entities and 200 scenes that each list four of them. These
// tests do not measure time (that depends on the machine); they count the work
// that made the World browser slow on a novel-sized project: every link in every
// scene and event listed all the notes of the project again to find its entity.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryVault } from '../../memoryVault';
import { resetFakeDocument, resetPlatform } from '../../obsidianStub';
import { NOVEL_INDEX, calm, inNovel, openWorld, wire } from './stage';

const ENTITIES = 120;
const SCENES = 200;
const name = (i: number): string => `Person ${String(i).padStart(3, '0')}`;
const scene = (i: number): string => `Manuscript/Scene ${String(i).padStart(3, '0')}.md`;

/** How many scenes list the entity `i`. */
function scenesListing(i: number): number {
  let count = 0;
  for (let s = 0; s < SCENES; s++) if ([0, 1, 2, 3].some((k) => (s * 7 + k * 13) % ENTITIES === i)) count++;
  return count;
}

function bigWorld(): MemoryVault {
  const vault = new MemoryVault();
  const binder: string[] = [];
  for (let i = 0; i < SCENES; i++) binder.push(scene(i));
  vault.seed(NOVEL_INDEX, { frontmatter: { spellbook: 'project', version: 1, title: 'Big', binder }, body: '' });
  for (let i = 0; i < SCENES; i++) {
    const cast = [0, 1, 2, 3].map((k) => `[[${name((i * 7 + k * 13) % ENTITIES)}]]`);
    vault.seed(inNovel(scene(i)), { frontmatter: { status: 'To do', order: (i + 1) * 1024, entities: cast }, body: 'Words.\n' });
  }
  for (let i = 0; i < ENTITIES; i++) {
    const related = i > 0 ? [`[[${name(i - 1)}|knows]]`] : [];
    vault.seed(inNovel(`World/Characters/${name(i)}.md`), { frontmatter: { type: 'character', summary: `Number ${i}.`, aliases: [], related }, body: '' });
  }
  return vault;
}

beforeEach(() => {
  resetFakeDocument();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

describe('a novel-sized world', () => {
  it('lists the project\'s notes a handful of times to show the browser, not once for every link', async () => {
    const stage = await wire(bigWorld());
    const listed = vi.spyOn(stage.store, 'projectNotes');
    const open = await openWorld(stage);
    // 800 links in the scenes and 119 relations: each listing everything again would be ~900 listings.
    expect(listed.mock.calls.length).toBeLessThan(20);
    // And the links were all followed: each card says how many scenes list its entity.
    const cards = open.pane.withClass('spellbook-world-card');
    expect(cards.length).toBe(ENTITIES);
    const first = cards.find((card) => card.withClass('spellbook-world-card-name')[0]?.text === name(0));
    expect(first?.withClass('spellbook-world-card-scenes')[0]?.text).toBe(`${scenesListing(0)} scenes`);
    stage.switchOff();
  });

  it('works the browser out again, cheaply, after a scene\'s properties change', async () => {
    const stage = await wire(bigWorld());
    await openWorld(stage);
    const listed = vi.spyOn(stage.store, 'projectNotes');
    stage.vault.external.editFrontmatter(inNovel(scene(5)), (frontmatter) => {
      frontmatter['status'] = 'Revised';
    });
    await calm(stage);
    expect(listed.mock.calls.length).toBeLessThan(20);
    stage.switchOff();
  });

  it('follows a link to an entity that arrives after the browser was shown', async () => {
    const vault = bigWorld();
    vault.seed(inNovel(scene(0)), { frontmatter: { status: 'To do', order: 1024, entities: ['[[Newcomer]]'] }, body: 'Words.\n' });
    const stage = await wire(vault);
    const open = await openWorld(stage);
    const host = (open.view as unknown as { host: { sceneRows(path: string): Array<{ path: string }> } }).host;
    expect(host.sceneRows('World/Characters/Newcomer.md')).toEqual([]);
    stage.vault.external.create(inNovel('World/Characters/Newcomer.md'), { frontmatter: { type: 'character', summary: 'New.', aliases: [] } });
    await calm(stage);
    expect(host.sceneRows('World/Characters/Newcomer.md').map((row) => row.path)).toEqual([scene(0)]);
    stage.switchOff();
  });
});
