// The notice the binder shows for a conflicting copy of the project's index
// ("Novel 2.md" next to "Novel.md"), with its two buttons: Merge and Dismiss.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFLICTS_MESSAGE, CONFLICT_MESSAGE, MISSING_LABEL } from '../src/views/binderView';
import { heading, one, picture, scroller, tap } from './binderScreen';
import { INDEX, clearScreen, notices, novel, rest, stage } from './binderStage';
import { MemoryVault } from './memoryVault';
import { resetPlatform } from './obsidianStub';
import type { FakeElement } from './obsidianStub';
import { INDEX_BODY, binderOnDisk, seedProject } from './storeHarness';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

const COPY = 'Novel/Novel 2.md';

/**
 * Put a conflicting copy of the index next to it: it also lists "Loose" and
 * a scene that is not in the vault. Its text is the index note's own.
 */
function withCopy(
  vault: MemoryVault = novel(),
  path = COPY,
  binder: unknown = ['Manuscript/Opening.md', 'Manuscript/Loose.md', 'Manuscript/From the phone.md'],
  body: string = INDEX_BODY,
): MemoryVault {
  vault.seed(path, { frontmatter: { spellbook: 'project', version: 1, title: 'My Novel', binder }, body });
  return vault;
}

const alerts = (pane: FakeElement): FakeElement => one(pane, 'spellbook-binder-alerts');
const banners = (pane: FakeElement): FakeElement[] => pane.withClass('spellbook-conflict-banner');
const buttons = (pane: FakeElement): FakeElement[] => alerts(pane).all().filter((element) => element.tag === 'button');
const buttonNames = (pane: FakeElement): string[] => buttons(pane).map((button) => button.text);

function button(pane: FakeElement, name: string): FakeElement {
  const found = buttons(pane).filter((candidate) => candidate.text === name);
  if (found.length !== 1) throw new Error(`expected one "${name}" button, found ${found.length}`);
  return found[0] as FakeElement;
}

describe('the notice', () => {
  it('says that a conflicting copy was found, names it, and offers Merge and Dismiss', async () => {
    const s = await stage(withCopy());
    const banner = one(s.pane, 'spellbook-conflict-banner');
    expect(one(banner, 'spellbook-binder-banner-title').text).toBe("A conflicting copy of this project's structure was found.");
    expect(CONFLICT_MESSAGE).toBe("A conflicting copy of this project's structure was found.");
    expect(banner.attrs['role']).toBe('alert');
    const file = one(banner, 'spellbook-binder-banner-file');
    expect(file.text).toBe('Novel 2.md');
    expect(file.attrs['dir']).toBe('auto'); // the name is the writer's own text
    expect(buttonNames(s.pane)).toEqual(['Merge', 'Dismiss']);
    for (const each of buttons(s.pane)) expect(each.attrs['type']).toBe('button');
    // What Merge will do is said before it is pressed.
    expect(one(banner, 'spellbook-binder-banner-hint').text).toMatch(/adds the scenes that only the copy lists/);
    expect(one(banner, 'spellbook-binder-banner-hint').text).toMatch(/moves the copy to the trash/);
    expect(s.vault.writes).toEqual([]); // showing it changes nothing
  });

  it('sits at the top of the binder, above the list, where scrolling cannot take it out of view', async () => {
    const s = await stage(withCopy());
    const root = one(s.pane, 'spellbook-binder');
    expect(root.children.map((child) => [...child.classes][0])).toEqual([
      'spellbook-binder-header',
      'spellbook-binder-alerts',
      'spellbook-binder-scroll',
    ]);
    expect(scroller(s.pane).withClass('spellbook-conflict-banner')).toEqual([]);
    // The list itself is as it always is: the copy is not a project, and not a row.
    expect(picture(s.pane)[0]).toBe('v Manuscript 11');
    expect(heading(s.pane).fullText).toBe('My Novel');
    expect(s.pane.withClass('spellbook-project-switch')).toEqual([]);
  });

  it('is not there when there is no copy', async () => {
    const s = await stage(novel());
    expect(alerts(s.pane).children).toEqual([]);
  });

  it('appears when a copy arrives while the binder is open', async () => {
    const s = await stage(novel());
    s.vault.external.create(COPY, { frontmatter: { spellbook: 'project', version: 1, title: 'My Novel', binder: [] } });
    await rest(s);
    expect(banners(s.pane)).toHaveLength(1);
    s.vault.external.delete(COPY);
    await rest(s);
    expect(banners(s.pane)).toEqual([]);
  });

  it('speaks of copies when there are several, and names each', async () => {
    const s = await stage(withCopy(withCopy(), 'Novel/Novel 3.md', ['Manuscript/Another.md']));
    const banner = one(s.pane, 'spellbook-conflict-banner');
    expect(one(banner, 'spellbook-binder-banner-title').text).toBe(CONFLICTS_MESSAGE);
    expect(banner.withClass('spellbook-binder-banner-file').map((file) => file.text)).toEqual(['Novel 2.md', 'Novel 3.md']);
  });

  it('is left as it is when the list is drawn again for something else', async () => {
    const s = await stage(withCopy());
    const before = one(s.pane, 'spellbook-conflict-banner');
    s.vault.external.create('Novel/Research/Bridges.md');
    await rest(s);
    expect(picture(s.pane)).toContain('  Bridges');
    expect(one(s.pane, 'spellbook-conflict-banner')).toBe(before); // not taken down and put up again
  });
});

describe('Merge', () => {
  it('adds what only the copy lists to the end of the manuscript, trashes the copy and takes the notice down', async () => {
    const s = await stage(withCopy());
    tap(button(s.pane, 'Merge'));
    await rest(s);

    const lines = picture(s.pane);
    const end = lines.indexOf('v Research');
    expect(lines.slice(1, end)).toEqual([
      '  Opening 3',
      '  v Part one 8',
      '    The Letter 4',
      '    v חלק פנימי 4',
      '      מכתב לאחותי 4',
      `  ! Ghost -- ${MISSING_LABEL}`,
      '  Loose 2',
      `  ! From the phone -- ${MISSING_LABEL}`,
    ]);
    expect(lines[0]).toBe('v Manuscript 13');
    expect(lines).not.toContain('v Unfiled');
    expect(s.vault.writes).toEqual([
      { op: 'updateFrontmatter', path: INDEX },
      { op: 'trash', path: COPY },
    ]);
    expect(s.vault.trashed).toEqual([COPY]);
    expect(banners(s.pane)).toEqual([]);
    expect(notices()).toEqual([
      'Merged the copy "Novel 2": 2 scenes were added at the end of the manuscript. The copy was moved to the trash.',
    ]);
  });

  it('says so when the copy listed nothing new', async () => {
    const s = await stage(withCopy(novel(), COPY, ['Manuscript/The Letter.md', 'Manuscript/Opening.md']));
    tap(button(s.pane, 'Merge'));
    await rest(s);
    expect(s.vault.writes).toEqual([{ op: 'trash', path: COPY }]);
    expect(picture(s.pane)[0]).toBe('v Manuscript 11');
    expect(notices()).toEqual([
      'Merged the copy "Novel 2": it listed nothing that the binder did not have. The copy was moved to the trash.',
    ]);
  });

  it('says where the copy\'s own text has gone when it was not the same as the index note\'s', async () => {
    const s = await stage(withCopy(novel(), COPY, ['Manuscript/Loose.md'], 'Notes I wrote on the phone.'));
    tap(button(s.pane, 'Merge'));
    await rest(s);
    expect(notices()).toEqual([
      'Merged the copy "Novel 2": 1 scene was added at the end of the manuscript. The copy was moved to the trash. ' +
        "Its own text was not the same as the index note's: if you wrote notes there, you will find them in the trash.",
    ]);
    expect(s.vault.bodyOf(INDEX)).toBe(INDEX_BODY); // the index note's own text is never touched
  });

  it('shows the notice for a copy with another title, and says the project keeps its own', async () => {
    // One device changed the title while another added a scene: the copy is still a copy.
    const vault = novel();
    vault.seed(COPY, {
      frontmatter: { spellbook: 'project', version: 1, title: 'My Novel, draft 2', binder: ['Manuscript/Loose.md'] },
      body: INDEX_BODY,
    });
    const s = await stage(vault);
    expect(banners(s.pane)).toHaveLength(1);
    expect(heading(s.pane).withClass('spellbook-project-switch')).toHaveLength(0); // not a second project to switch to
    tap(button(s.pane, 'Merge'));
    await rest(s);
    expect(notices()).toEqual([
      'Merged the copy "Novel 2": 1 scene was added at the end of the manuscript. The copy was moved to the trash. ' +
        'The copy was titled "My Novel, draft 2"; the project keeps its own title.',
    ]);
    expect(s.vault.frontmatterOf(INDEX)?.['title']).toBe('My Novel');
  });

  it('merges every copy when there are several', async () => {
    const s = await stage(withCopy(withCopy(), 'Novel/Novel 3.md', ['Manuscript/Another.md', 'Manuscript/Loose.md']));
    tap(button(s.pane, 'Merge'));
    await rest(s);
    expect((binderOnDisk(s.vault, INDEX) as unknown[]).slice(-3)).toEqual([
      'Manuscript/Loose.md',
      'Manuscript/From the phone.md',
      'Manuscript/Another.md',
    ]);
    expect(s.vault.trashed).toEqual([COPY, 'Novel/Novel 3.md']);
    expect(banners(s.pane)).toEqual([]);
    expect(notices()).toHaveLength(2);
  });

  it('does its work once, however often the button is tapped', async () => {
    const s = await stage(withCopy());
    const merged = vi.spyOn(s.store, 'mergeConflictCopy');
    const merge = button(s.pane, 'Merge');
    tap(merge);
    tap(merge);
    tap(merge);
    await rest(s);
    expect(merged).toHaveBeenCalledTimes(1);
    expect(notices()).toHaveLength(1);
    expect(s.vault.trashed).toEqual([COPY]);
  });

  it('leaves a copy it cannot understand where it is, says why, and keeps the notice up', async () => {
    const s = await stage(withCopy(novel(), COPY, { not: 'a list' }));
    tap(button(s.pane, 'Merge'));
    await rest(s);
    expect(s.vault.writes).toEqual([]);
    expect(s.vault.has(COPY)).toBe(true);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/The copy "Novel 2" could not be understood/);
    expect(notices()[0]).toMatch(/left where it is/);
    expect(banners(s.pane)).toHaveLength(1);
  });

  it('is not offered while the project itself is read-only', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const s = await stage(withCopy(vault));
    // (The list below has a notice of its own, about the index that cannot be understood.)
    expect(one(alerts(s.pane), 'spellbook-binder-banner-title').text).toBe(CONFLICT_MESSAGE);
    expect(buttonNames(s.pane)).toEqual(['Dismiss']);
    expect(s.pane.withClass('spellbook-binder-banner-hint')).toEqual([]);
    expect(s.vault.writes).toEqual([]);
  });
});

describe('Dismiss', () => {
  it('takes the notice down and changes nothing', async () => {
    const s = await stage(withCopy());
    tap(button(s.pane, 'Dismiss'));
    expect(banners(s.pane)).toEqual([]);
    expect(alerts(s.pane).children).toEqual([]);
    await rest(s);
    expect(s.vault.writes).toEqual([]);
    expect(s.vault.has(COPY)).toBe(true);
    expect(s.storage.saves).toEqual([]); // not written down anywhere either
    expect(notices()).toEqual([]);
  });

  it('keeps it down until Obsidian is started again: through new drawings and through closing the panel', async () => {
    const s = await stage(withCopy());
    tap(button(s.pane, 'Dismiss'));
    s.vault.external.create('Novel/Research/Bridges.md');
    await rest(s);
    expect(banners(s.pane)).toEqual([]);

    await s.shell.close();
    await s.shell.open();
    await rest(s);
    expect(picture(s.pane)[0]).toBe('v Manuscript 11');
    expect(banners(s.pane)).toEqual([]);

    // Obsidian is closed and opened again: everything is new, the copy is still there.
    const again = await stage(s.vault);
    expect(banners(again.pane)).toHaveLength(1);
  });

  it('does not hide a copy that turns up later', async () => {
    const s = await stage(withCopy());
    tap(button(s.pane, 'Dismiss'));
    s.vault.external.create('Novel/Novel 3.md', {
      frontmatter: { spellbook: 'project', version: 1, title: 'My Novel', binder: [] },
    });
    await rest(s);
    const banner = one(s.pane, 'spellbook-conflict-banner');
    expect(banner.withClass('spellbook-binder-banner-file').map((file) => file.text)).toEqual(['Novel 3.md']);
    // Merge now deals with the copy that is shown, not the one that was waved away.
    tap(button(s.pane, 'Merge'));
    await rest(s);
    expect(s.vault.trashed).toEqual(['Novel/Novel 3.md']);
    expect(s.vault.has(COPY)).toBe(true);
  });
});
