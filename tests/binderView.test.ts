// The binder panel, driven through the stand-ins: a vault in memory, timers
// under the test's control, and elements that only remember what was done to
// them (tests/obsidianStub.ts). These tests check what the panel shows and
// does; how it looks can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NARROW_BELOW, WIDE_FROM } from '../src/core/binderModel';
import { ACTIVE_PROJECT_KEY } from '../src/core/devicePrefs';
import { createSampleProject } from '../src/core/newProject';
import { WORD_COUNT_DEBOUNCE_MS } from '../src/core/wordCountCache';
import { BINDER_VIEW_TYPE, MISSING_LABEL } from '../src/views/binderView';
import { countOf, heading, one, partOf, picture, rowOf, scroller, tap, toolbarLabels } from './binderScreen';
import { HEBREW, LETTER, OPENING, clearScreen, fileAt, notices, novel, rest, stage } from './binderStage';
import { MemoryVault } from './memoryVault';
import { Menu as StubMenu, Platform as StubPlatform, resetPlatform } from './obsidianStub';
import type { FakeElement } from './obsidianStub';
import { TODAY, foldedIn, quiet, seedProject, tick } from './storeHarness';

// The stage these tests play on (a vault in memory, a stand-in for the
// plugin, the panel itself) is in tests/binderStage.ts.

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- the tests

describe('the view itself', () => {
  it('is the Binder, with an icon', async () => {
    const { view } = await stage();
    expect(view.getViewType()).toBe('spellbook-binder');
    expect(BINDER_VIEW_TYPE).toBe('spellbook-binder');
    expect(view.getDisplayText()).toBe('Binder');
    expect(view.getIcon()).not.toBe('');
    expect(view.navigation).toBe(false); // a panel, not a place to navigate from
  });
});

describe('with no project', () => {
  it('says that Spellbook is starting until it has started, then fills in', async () => {
    const s = await stage(novel(), { started: false });
    expect(picture(s.pane)).toEqual(['(Spellbook is still starting...)']);
    expect(heading(s.pane).fullText).toBe('Binder');

    s.host.start(s.services);
    await rest(s);
    expect(heading(s.pane).fullText).toBe('My Novel');
    expect(picture(s.pane)[0]).toBe('v Manuscript 11');
  });

  it('explains what a project is and offers to create one', async () => {
    const s = await stage(new MemoryVault().seed('Notes/Plain.md'));
    expect(heading(s.pane).fullText).toBe('Binder');
    const empty = one(s.pane, 'spellbook-binder-empty');
    expect(empty.fullText).toMatch(/no Spellbook project in this vault yet/);
    expect(empty.fullText).toMatch(/"Spellbook: Create sample project"/);

    const button = one(s.pane, 'spellbook-binder-create');
    expect(button.tag).toBe('button');
    expect(button.text).toBe('Create project');
    expect(s.host.asked).toBe(0);
    tap(button);
    expect(s.host.asked).toBe(1);
  });

  it('shows the project as soon as one is created', async () => {
    const s = await stage();
    expect(s.pane.withClass('spellbook-binder-empty')).toHaveLength(1);
    await s.store.createProject('Night Train');
    await rest(s);
    expect(s.pane.withClass('spellbook-binder-empty')).toHaveLength(0);
    expect(heading(s.pane).fullText).toBe('Night Train');
    expect(picture(s.pane)).toEqual(['v Manuscript 0', '  (No scenes yet.)', 'v Research', '  (No research notes yet.)']);
  });

  it('lets the writer pick a project when none is open yet', async () => {
    const s = await stage(novel(), { session: false });
    expect(picture(s.pane)).toEqual(['(Opening the project...)']);
    const button = one(s.pane, 'spellbook-project-switch');
    expect(button.fullText).toBe('Choose a project');

    tap(button);
    const menu = StubMenu.shown[0];
    expect(menu?.items.map((item) => [item.title, item.checked])).toEqual([['My Novel', false]]);
    menu?.items[0]?.click();
    await rest(s);
    expect(heading(s.pane).fullText).toBe('My Novel');
  });

  it('says why when the project cannot be opened', async () => {
    const vault = novel();
    // The vault still lists the note as a project, but on disk it no longer is one.
    vault.holdMetadata();
    vault.external.write('Novel/Novel.md', { frontmatter: { title: 'Just a note' } }, { silent: true });
    const s = await stage(vault);
    expect(picture(s.pane)).toEqual([
      '(The project could not be opened.)',
      '("Novel/Novel.md" is not a Spellbook project.)',
    ]);
  });
});

describe('the tree', () => {
  it('shows Manuscript, then Unfiled, then Research, with word counts and sums', async () => {
    const s = await stage(novel());
    expect(picture(s.pane)).toEqual([
      'v Manuscript 11',
      '  Opening 3',
      '  v Part one 8',
      '    The Letter 4',
      '    v חלק פנימי 4',
      '      מכתב לאחותי 4',
      `  ! Ghost -- ${MISSING_LABEL}`,
      'v Unfiled',
      '  Loose 2',
      'v Research',
      '  v Maps',
      '    City',
      '  Trains',
    ]);
    expect(MISSING_LABEL).toBe('File not found (it may still be syncing)');
    expect(s.vault.writes).toEqual([]); // looking changes nothing
  });

  it('leaves Unfiled out when every manuscript note is in the binder', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { scenes: { A: 1024, B: 2048 } }); // nine words each
    const s = await stage(vault);
    expect(picture(s.pane).filter((line) => !line.startsWith(' '))).toEqual(['v Manuscript 18', 'v Research']);
  });

  it('writes large counts with commas', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: ['Manuscript/Long.md', 'Manuscript/Short.md'] });
    vault.seed('Novel/Manuscript/Long.md', { body: 'word '.repeat(12345) });
    vault.seed('Novel/Manuscript/Short.md', { body: 'Just one more' });
    const s = await stage(vault);
    expect(countOf(s.pane, 'Long')).toBe('12,345');
    expect(countOf(s.pane, 'Manuscript')).toBe('12,348');
    expect(partOf(rowOf(s.pane, 'Long'), 'spellbook-count')?.attrs['aria-label']).toBe('12,345 words');
  });

  it('uses the classes of Obsidian\'s own trees next to its own, so that themes apply', async () => {
    const s = await stage(novel());
    const scene = rowOf(s.pane, 'Opening');
    expect([...scene.classes]).toEqual(expect.arrayContaining(['tree-item-self', 'nav-file-title', 'is-clickable', 'spellbook-row-self']));
    expect([...(scene.parent as FakeElement).classes]).toEqual(expect.arrayContaining(['tree-item', 'nav-file', 'spellbook-row']));
    expect([...(partOf(scene, 'spellbook-title') as FakeElement).classes]).toEqual(
      expect.arrayContaining(['tree-item-inner', 'nav-file-title-content']),
    );
    expect([...(partOf(scene, 'spellbook-count') as FakeElement).classes]).toContain('tree-item-flair');
    expect(scene.withClass('tree-item-flair-outer')).toHaveLength(1);

    const folder = rowOf(s.pane, 'Part one');
    expect([...folder.classes]).toEqual(expect.arrayContaining(['tree-item-self', 'nav-folder-title', 'mod-collapsible', 'is-clickable']));
    expect([...(folder.parent as FakeElement).classes]).toEqual(expect.arrayContaining(['tree-item', 'nav-folder']));
    const arrow = partOf(folder, 'collapse-icon') as FakeElement;
    expect([...arrow.classes]).toEqual(expect.arrayContaining(['tree-item-icon', 'collapse-icon']));
    expect(arrow.icon).toBe('chevron-down');
    const inside = (folder.parent as FakeElement).children[1] as FakeElement;
    expect([...inside.classes]).toEqual(expect.arrayContaining(['tree-item-children', 'spellbook-children']));

    // Every class the plugin made up carries its prefix.
    const known =
      /^(spellbook-|tree-item|nav-f|clickable-icon$|is-|mod-|collapse-icon$|svg-icon$|view-content$)/;
    const classes = new Set(s.pane.all().flatMap((element) => [...element.classes]));
    for (const cls of classes) expect(cls).toMatch(known);
  });

  it('lets every title choose its own direction, and keeps numbers left to right', async () => {
    const s = await stage(novel());
    for (const title of ['Opening', 'Part one', 'חלק פנימי', 'מכתב לאחותי', 'Ghost', 'Loose', 'Maps', 'City']) {
      const row = rowOf(s.pane, title);
      const body = partOf(row, 'spellbook-row-body') as FakeElement;
      expect(body.attrs['dir'], title).toBe('auto');
      // The title's text is the first thing in the element that picks the
      // direction, and nothing before it has a say.
      expect(body.children[0]?.hasClass('spellbook-title'), title).toBe(true);
      expect(body.children[0]?.attrs['dir'], title).toBeUndefined();
      // The word count sits after the title, in the same element, so it ends
      // up at the opposite end from the title whichever way the title reads.
      const count = body.children[1];
      if (count) {
        expect(count.hasClass('spellbook-count-outer'), title).toBe(true);
        expect(count.attrs['dir'], title).toBe('ltr');
      }
    }
    // The fold arrow is outside that element: it follows the app, not the title.
    const folder = rowOf(s.pane, 'חלק פנימי');
    expect(folder.children[0]?.hasClass('collapse-icon')).toBe(true);
    expect(folder.children[0]?.attrs['dir']).toBeUndefined();
    // Section names are the app's own words: no direction of their own.
    expect(partOf(rowOf(s.pane, 'Manuscript'), 'spellbook-row-body')?.attrs['dir']).toBeUndefined();
    // The project's name is the writer's text too.
    expect(one(s.pane, 'spellbook-project-name').attrs['dir']).toBe('auto');
  });

  it('greys a missing entry, with a warning sign and the reason', async () => {
    const s = await stage(novel());
    const ghost = rowOf(s.pane, 'Ghost');
    expect((ghost.parent as FakeElement).hasClass('spellbook-is-missing')).toBe(true);
    expect(ghost.hasClass('is-clickable')).toBe(false);
    expect(ghost.attrs['aria-disabled']).toBe('true');
    const sign = partOf(ghost, 'spellbook-missing-icon') as FakeElement;
    expect(sign.icon).toBe('triangle-alert');
    expect(sign.attrs['aria-label']).toBe(MISSING_LABEL);
    expect(partOf(ghost, 'spellbook-row-note')?.text).toBe(MISSING_LABEL);
    expect(partOf(ghost, 'spellbook-count')).toBeUndefined();

    // Tapping it opens nothing, but says why.
    tap(ghost);
    await tick();
    expect(s.host.opened).toEqual([]);
    expect(notices()).toEqual([`"Ghost": ${MISSING_LABEL}.`]);
  });

  it('shows a missing entry as an ordinary scene once its note arrives', async () => {
    const s = await stage(novel());
    s.vault.external.create('Novel/Manuscript/Ghost.md', { body: 'Here I am.' });
    await rest(s);
    expect(picture(s.pane)).toContain('  Ghost 3');
    expect(countOf(s.pane, 'Manuscript')).toBe('14');
  });

  it('lists research alphabetically, sub-folders first, without word counts', async () => {
    const vault = novel();
    vault.seed('Novel/Research/Alphabet.md');
    vault.seed('Novel/Research/Maps/Old/Harbour.md');
    vault.seed('Novel/Research/Maps/Atlas.md');
    const s = await stage(vault);
    const lines = picture(s.pane);
    expect(lines.slice(lines.indexOf('v Research'))).toEqual([
      'v Research',
      '  v Maps',
      '    v Old',
      '      Harbour',
      '    Atlas',
      '    City',
      '  Alphabet',
      '  Trains',
    ]);
    expect(partOf(rowOf(s.pane, 'Trains'), 'spellbook-count')).toBeUndefined();
    expect(s.vault.reads.readText).toBe(4); // the three scenes and the loose note; research is not read
  });

  it('follows the vault: new notes appear, deleted ones go', async () => {
    const s = await stage(novel());
    s.vault.external.create('Novel/Research/Bridges.md');
    s.vault.external.delete('Novel/Manuscript/Loose.md');
    await rest(s);
    const lines = picture(s.pane);
    expect(lines).toContain('  Bridges');
    expect(lines).not.toContain('v Unfiled');
    expect(lines).not.toContain('  Loose 2');
  });
});

describe('the sample novel', () => {
  it('is shown whole: its parts, its Hebrew scene, the note left out of the binder, and the research', async () => {
    const s = await stage();
    const made = await createSampleProject(s.store, TODAY);
    expect(made.status).toBe('done');
    await rest(s);

    expect(heading(s.pane).fullText).toBe('Sample Novel');
    const lines = picture(s.pane);
    const sections = lines.filter((line) => !line.startsWith(' '));
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatch(/^v Manuscript \d{1,3}(,\d{3})+$/);
    expect(sections.slice(1)).toEqual(['v Unfiled', 'v Research']);
    expect(lines.filter((line) => /^ {2}v /.test(line))).toHaveLength(5); // the five parts
    expect(lines.slice(lines.indexOf('v Unfiled') + 1, lines.indexOf('v Research'))).toHaveLength(1);
    expect(lines[lines.indexOf('v Unfiled') + 1]).toMatch(/^ {2}The Night Market \d+$/);
    expect(lines.slice(lines.indexOf('v Research') + 1)).toHaveLength(2);

    // Every scene has been counted, and the sums add up.
    const number = (text: string): number => Number(text.replace(/,/g, ''));
    const manuscript = s.pane.withClass('spellbook-section')[0] as FakeElement;
    const scenes = manuscript.withClass('spellbook-note');
    expect(scenes).toHaveLength(52);
    const counts = scenes.map((scene) => partOf(scene, 'spellbook-count')?.text ?? '');
    expect(counts.every((count) => /^\d{1,3}(,\d{3})*$/.test(count))).toBe(true);
    expect(number(countOf(s.pane, 'Manuscript'))).toBe(counts.reduce((sum, count) => sum + number(count), 0));

    // The Hebrew scene: its row takes the direction of its title.
    const letter = rowOf(s.pane, 'מכתב לאחותי');
    expect(partOf(letter, 'spellbook-row-body')?.attrs['dir']).toBe('auto');
    expect(number(countOf(s.pane, 'מכתב לאחותי'))).toBeGreaterThan(0);

    // Looking at it all wrote nothing more than creating it did.
    const writesAfterCreating = s.vault.writes.length;
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await rest(s);
    expect(s.vault.writes).toHaveLength(writesAfterCreating);
  });
});

describe('a project whose index cannot be understood', () => {
  it('shows the error with the file name, and the notes it can still find', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    vault.seed('Novel/Research/Trains.md');
    const s = await stage(vault);

    const banner = one(s.pane, 'spellbook-binder-banner');
    expect(banner.fullText).toMatch(/read-only/);
    expect(banner.fullText).toContain(s.store.project?.error);
    expect(one(s.pane, 'spellbook-binder-banner-path').text).toBe('Novel/Novel.md');
    expect(one(s.pane, 'spellbook-binder-banner-path').attrs['dir']).toBe('auto');
    expect(one(s.pane, 'spellbook-binder-banner-icon').icon).toBe('triangle-alert');

    // No Manuscript section: the binder is unknown. The notes are still reachable.
    expect(picture(s.pane).slice(1)).toEqual(['v Unfiled', '  A 9', 'v Research', '  Trains']);
    expect(s.vault.writes).toEqual([]);
  });

  it('goes back to normal when the index is repaired', async () => {
    const vault = new MemoryVault();
    const indexPath = seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const s = await stage(vault);
    s.vault.external.editFrontmatter(indexPath, (frontmatter) => {
      frontmatter['binder'] = ['Manuscript/A.md'];
    });
    await rest(s);
    expect(s.pane.withClass('spellbook-binder-banner')).toHaveLength(0);
    expect(picture(s.pane)).toEqual(['v Manuscript 9', '  A 9', 'v Research', '  (No research notes yet.)']);
  });

  it('mentions what was tidied up while reading the index', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: ['Manuscript/A.md', 'Manuscript/A.md'], scenes: { A: 1024 } });
    const s = await stage(vault);
    const notes = s.pane.withClass('spellbook-binder-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toMatch(/listed more than once/);
    expect(notes[0]?.attrs['dir']).toBe('auto');
  });
});

describe('word counts', () => {
  it('are blank until a note has been counted, and a sum is blank until all of it is', async () => {
    const vault = new MemoryVault();
    const scenes: Record<string, number> = {};
    for (let n = 1; n <= 500; n++) scenes[`Scene ${n}`] = n * 1024;
    seedProject(vault, { scenes });
    const { pane, store, services, timers } = await stage(vault, { counted: false });

    // All five hundred rows are there; the counting has only just begun.
    expect(pane.withClass('spellbook-note')).toHaveLength(500);
    expect(countOf(pane, 'Scene 1')).toBe('10');
    expect(countOf(pane, 'Scene 500')).toBe('');
    expect(countOf(pane, 'Manuscript')).toBe('');
    expect(timers.pending).toBe(1); // it is pausing, so the app can draw and answer

    await rest({ store, services, timers });
    expect(countOf(pane, 'Scene 500')).toBe('10');
    expect(countOf(pane, 'Manuscript')).toBe('5,000');
    expect(vault.reads.readText).toBe(500);
  });

  it('refresh for just the one row when its note is saved, a moment later', async () => {
    const s = await stage(novel());
    const rowsBefore = s.pane.withClass('spellbook-row-self');
    const readsBefore = s.vault.reads.readText;

    s.vault.external.write(LETTER, { body: 'Dear sister, I write to you again tonight.' });
    await rest(s);
    expect(countOf(s.pane, 'The Letter')).toBe('4'); // not yet: the note may still be changing
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await rest(s);

    expect(countOf(s.pane, 'The Letter')).toBe('8');
    expect(countOf(s.pane, 'Part one')).toBe('12');
    expect(countOf(s.pane, 'Manuscript')).toBe('15');
    expect(countOf(s.pane, 'חלק פנימי')).toBe('4');
    expect(s.vault.reads.readText).toBe(readsBefore + 1); // only that note was read again
    // The list was not drawn again: these are the very same rows.
    const rowsAfter = s.pane.withClass('spellbook-row-self');
    expect(rowsAfter).toHaveLength(rowsBefore.length);
    expect(rowsAfter.every((row, index) => row === rowsBefore[index])).toBe(true);
  });

  it('are kept when the list is drawn again, without reading the notes again', async () => {
    const s = await stage(novel());
    const readsBefore = s.vault.reads.readText;
    s.vault.external.create('Novel/Research/Bridges.md');
    await quiet(s.store);
    // Straight after the redraw, before any counting could have happened:
    expect(countOf(s.pane, 'Opening')).toBe('3');
    expect(countOf(s.pane, 'Manuscript')).toBe('11');
    await rest(s);
    expect(s.vault.reads.readText).toBe(readsBefore);
  });

  it('follow a renamed scene', async () => {
    const s = await stage(novel());
    const readsBefore = s.vault.reads.readText;
    const result = await s.store.renameScene('Manuscript/Opening.md', 'Prologue');
    expect(result.status).toBe('done');
    await rest(s);
    expect(picture(s.pane)).toContain('  Prologue 3');
    expect(s.vault.reads.readText).toBe(readsBefore);
  });
});

describe('opening a scene', () => {
  it('opens the note in the tab the writer was working in', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'The Letter'));
    await tick();
    expect(s.host.opened).toEqual([{ path: LETTER, where: false }]);
    expect(notices()).toEqual([]);
  });

  it('opens a new tab with Cmd or Ctrl, and with the middle button', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Opening'), { metaKey: true });
    tap(rowOf(s.pane, 'Opening'), { ctrlKey: true });
    let prevented = 0;
    rowOf(s.pane, 'Opening').dispatch('auxclick', { button: 1, preventDefault: () => prevented++ });
    rowOf(s.pane, 'Opening').dispatch('auxclick', { button: 2, preventDefault: () => prevented++ }); // the right button: not ours
    await tick();
    expect(s.host.opened).toEqual([
      { path: OPENING, where: 'tab' },
      { path: OPENING, where: 'tab' },
      { path: OPENING, where: 'tab' },
    ]);
    expect(prevented).toBe(1);
  });

  it('opens unfiled notes and research notes too', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Loose'));
    tap(rowOf(s.pane, 'City'));
    tap(rowOf(s.pane, 'מכתב לאחותי'));
    await tick();
    expect(s.host.opened.map((call) => call.path)).toEqual([
      'Novel/Manuscript/Loose.md',
      'Novel/Research/Maps/City.md',
      HEBREW,
    ]);
  });

  it('says so when the note cannot be opened', async () => {
    const s = await stage(novel());
    s.host.canOpen = false;
    tap(rowOf(s.pane, 'Opening'));
    await tick();
    expect(notices()).toEqual(['"Opening" could not be opened.']);
  });

  it('says so when the note vanished since the list was drawn', async () => {
    const s = await stage(novel());
    const row = rowOf(s.pane, 'Opening');
    s.vault.external.delete(OPENING);
    await quiet(s.store);
    tap(row); // the old row, as if tapped in the instant before the redraw
    await tick();
    expect(s.host.opened).toEqual([]);
    expect(notices()).toEqual([`"Opening": ${MISSING_LABEL}.`]);
  });

  it('does not fold or unfold anything', async () => {
    const s = await stage(novel());
    const before = picture(s.pane);
    tap(rowOf(s.pane, 'The Letter'));
    await rest(s);
    expect(picture(s.pane).map((line) => line.replace(' *', ''))).toEqual(before);
  });
});

describe('on a phone', () => {
  beforeEach(() => {
    StubPlatform.isMobile = true;
    StubPlatform.isPhone = true;
    StubPlatform.isDesktop = false;
  });

  it('slides the drawer away after a scene was tapped, so the scene can be seen', async () => {
    const s = await stage(novel());
    s.fake.workspace.leftSplit.expand();
    tap(rowOf(s.pane, 'Opening'));
    await tick();
    expect(s.host.opened).toHaveLength(1);
    expect(s.fake.workspace.leftSplit.collapsed).toBe(true);
    expect(s.fake.workspace.leftSplit.collapses).toBe(1);
    expect(s.fake.workspace.rightSplit.collapses).toBe(0);
  });

  it('slides away the right drawer when that is where the binder is', async () => {
    const s = await stage(novel(), { split: 'right' });
    tap(rowOf(s.pane, 'Opening'));
    await tick();
    expect(s.fake.workspace.rightSplit.collapses).toBe(1);
    expect(s.fake.workspace.leftSplit.collapses).toBe(0);
  });

  it('leaves the drawers alone when the binder is in the main area', async () => {
    const s = await stage(novel(), { split: 'root' });
    tap(rowOf(s.pane, 'Opening'));
    await tick();
    expect(s.fake.workspace.leftSplit.collapses + s.fake.workspace.rightSplit.collapses).toBe(0);
  });

  it('keeps the drawer open when nothing was opened', async () => {
    const s = await stage(novel());
    s.host.canOpen = false;
    tap(rowOf(s.pane, 'Opening'));
    tap(rowOf(s.pane, 'Ghost'));
    tap(rowOf(s.pane, 'Part one')); // folding is not opening
    await tick();
    expect(s.fake.workspace.leftSplit.collapses).toBe(0);
  });

  it('marks the panel for touch, so rows are tall enough to tap', async () => {
    const s = await stage(novel());
    expect(one(s.pane, 'spellbook-binder').hasClass('spellbook-is-mobile')).toBe(true);
  });
});

describe('on a desktop or a tablet', () => {
  it('never touches the sidebars', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Opening'));
    await tick();
    expect(s.fake.workspace.leftSplit.collapses).toBe(0);
    expect(one(s.pane, 'spellbook-binder').hasClass('spellbook-is-mobile')).toBe(false);

    StubPlatform.isMobile = true; // a tablet: touch rows, but its sidebar is not in the way
    const tablet = await stage(novel());
    tap(rowOf(tablet.pane, 'Opening'));
    await tick();
    expect(tablet.fake.workspace.leftSplit.collapses).toBe(0);
    expect(one(tablet.pane, 'spellbook-binder').hasClass('spellbook-is-mobile')).toBe(true);
  });
});

describe('the active note', () => {
  it('is highlighted, and the highlight moves with the writer', async () => {
    const s = await stage(novel());
    expect(picture(s.pane).some((line) => line.endsWith('*'))).toBe(false);

    s.fake.workspace.setActiveFile(fileAt(OPENING));
    expect(picture(s.pane)).toContain('  Opening 3 *');
    s.fake.workspace.setActiveFile(fileAt(HEBREW));
    expect(picture(s.pane).filter((line) => line.endsWith('*'))).toEqual(['      מכתב לאחותי 4 *']);
    s.fake.workspace.setActiveFile(fileAt('Somewhere/Else.md'));
    expect(picture(s.pane).some((line) => line.endsWith('*'))).toBe(false);
    s.fake.workspace.setActiveFile(null);
    expect(picture(s.pane).some((line) => line.endsWith('*'))).toBe(false);
  });

  it('is highlighted from the start when a note is already open', async () => {
    const s = await stage(novel(), { active: LETTER });
    expect(picture(s.pane)).toContain('    The Letter 4 *');
  });

  it('highlights research and unfiled notes as well', async () => {
    const s = await stage(novel());
    s.fake.workspace.setActiveFile(fileAt('Novel/Research/Maps/City.md'));
    expect(picture(s.pane)).toContain('    City *');
    s.fake.workspace.setActiveFile(fileAt('Novel/Manuscript/Loose.md'));
    expect(picture(s.pane)).toContain('  Loose 2 *');
  });

  it('marks the folders around it, so that a folded folder can show it holds the active note', async () => {
    const s = await stage(novel());
    s.fake.workspace.setActiveFile(fileAt(HEBREW));
    expect(rowOf(s.pane, 'חלק פנימי').hasClass('spellbook-has-active')).toBe(true);
    expect(rowOf(s.pane, 'Part one').hasClass('spellbook-has-active')).toBe(true);
    expect(rowOf(s.pane, 'Manuscript').hasClass('spellbook-has-active')).toBe(false);

    s.fake.workspace.setActiveFile(fileAt(OPENING));
    expect(rowOf(s.pane, 'חלק פנימי').hasClass('spellbook-has-active')).toBe(false);
    expect(rowOf(s.pane, 'Part one').hasClass('spellbook-has-active')).toBe(false);
  });

  it('is scrolled into view when it changes: down, up, or not at all', async () => {
    const s = await stage(novel());
    const list = scroller(s.pane);
    list.rect = { top: 100, bottom: 400, left: 0, right: 300, width: 300, height: 300 };
    list.scrollTop = 50;

    // Below the visible part: scroll down just far enough.
    rowOf(s.pane, 'The Letter').rect = { top: 450, bottom: 480, left: 0, right: 300, width: 300, height: 30 };
    s.fake.workspace.setActiveFile(fileAt(LETTER));
    expect(list.scrollTop).toBe(130);

    // Above it: scroll up just far enough.
    rowOf(s.pane, 'Opening').rect = { top: 60, bottom: 90, left: 0, right: 300, width: 300, height: 30 };
    s.fake.workspace.setActiveFile(fileAt(OPENING));
    expect(list.scrollTop).toBe(90);

    // Already in view: stay.
    rowOf(s.pane, 'Loose').rect = { top: 200, bottom: 230, left: 0, right: 300, width: 300, height: 30 };
    s.fake.workspace.setActiveFile(fileAt('Novel/Manuscript/Loose.md'));
    expect(list.scrollTop).toBe(90);

    // Hidden inside something folded shut (no height): stay.
    s.fake.workspace.setActiveFile(fileAt(HEBREW));
    expect(list.scrollTop).toBe(90);
  });

  it('stays highlighted when the list is drawn again, and the list does not jump', async () => {
    const s = await stage(novel());
    s.fake.workspace.setActiveFile(fileAt(LETTER));
    const list = scroller(s.pane);
    list.rect = { top: 0, bottom: 300, left: 0, right: 300, width: 300, height: 300 };
    list.scrollTop = 75;

    s.vault.external.create('Novel/Research/Bridges.md');
    await rest(s);
    expect(picture(s.pane)).toContain('    The Letter 4 *');
    expect(picture(s.pane)).toContain('  Bridges');
    expect(list.scrollTop).toBe(75);
  });
});

describe('folding', () => {
  it('folds a folder shut on a tap and opens it on the next', async () => {
    const s = await stage(novel());
    const folder = rowOf(s.pane, 'Part one');
    expect(folder.attrs['aria-expanded']).toBe('true');

    tap(folder);
    expect(picture(s.pane).slice(0, 4)).toEqual(['v Manuscript 11', '  Opening 3', '  > Part one 8', `  ! Ghost -- ${MISSING_LABEL}`]);
    expect(folder.attrs['aria-expanded']).toBe('false');
    expect(partOf(folder, 'collapse-icon')?.hasClass('is-collapsed')).toBe(true);
    expect(s.host.opened).toEqual([]);

    tap(folder);
    expect(picture(s.pane)[3]).toBe('    The Letter 4');
    expect(partOf(folder, 'collapse-icon')?.hasClass('is-collapsed')).toBe(false);
  });

  it('remembers what is folded when the list is drawn again', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'חלק פנימי'));
    tap(rowOf(s.pane, 'Maps'));
    tap(rowOf(s.pane, 'Unfiled'));
    s.vault.external.create('Novel/Research/Bridges.md');
    await rest(s);
    expect(picture(s.pane)).toEqual([
      'v Manuscript 11',
      '  Opening 3',
      '  v Part one 8',
      '    The Letter 4',
      '    > חלק פנימי 4',
      `  ! Ghost -- ${MISSING_LABEL}`,
      '> Unfiled',
      'v Research',
      '  > Maps',
      '  Bridges',
      '  Trains',
    ]);
  });

  it('remembers it on this device, per project, by the folder\'s id', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Part one'));
    tap(rowOf(s.pane, 'Research'));
    expect(foldedIn(s.storage)).toEqual({ 'Novel/Novel.md': ['folder:f-one', 'section:research'] });
    expect(s.vault.writes).toEqual([]); // nothing of this goes into the vault

    // Obsidian is closed and opened again: the same storage, everything else new.
    await s.shell.close();
    const again = await stage(s.vault, { storage: s.storage });
    expect(picture(again.pane)).toEqual([
      'v Manuscript 11',
      '  Opening 3',
      '  > Part one 8',
      `  ! Ghost -- ${MISSING_LABEL}`,
      'v Unfiled',
      '  Loose 2',
      '> Research',
    ]);

    // A folder keeps its state when it is renamed: it is known by its id.
    await again.store.renameFolder('f-one', 'Part 1');
    await rest(again);
    expect(picture(again.pane)[2]).toBe('  > Part 1 8');
  });

  it('counts the words of a folded folder all the same', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Part one'));
    s.vault.external.write(LETTER, { body: 'One.' });
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await rest(s);
    expect(picture(s.pane)[2]).toBe('  > Part one 5');
  });
});

describe('the header', () => {
  it('shows the name of the only project, with no switcher', async () => {
    const s = await stage(novel());
    expect(heading(s.pane).fullText).toBe('My Novel');
    expect(s.pane.withClass('spellbook-project-switch')).toHaveLength(0);
    // Next to the name: the toolbar (tests/binderEditing.test.ts looks at what it does).
    expect(toolbarLabels(s.pane)).toEqual(['New scene', 'New folder', 'More options']);
  });

  it('follows a change of the project\'s title', async () => {
    const s = await stage(novel());
    s.vault.external.editFrontmatter('Novel/Novel.md', (frontmatter) => {
      frontmatter['title'] = 'הרומן שלי';
    });
    await rest(s);
    expect(heading(s.pane).fullText).toBe('הרומן שלי');
  });

  function withSecondProject(): MemoryVault {
    const vault = novel();
    seedProject(vault, { folder: 'Other', title: 'Other Book', scenes: { Elsewhere: 1024 } });
    return vault;
  }

  it('becomes a switcher when the vault has more than one project', async () => {
    const s = await stage(withSecondProject());
    const button = one(s.pane, 'spellbook-project-switch');
    expect(button.tag).toBe('button');
    expect(button.attrs['aria-label']).toBe('My Novel (switch project)');
    expect(one(s.pane, 'spellbook-project-name').text).toBe('My Novel');
    expect(one(s.pane, 'spellbook-project-name').attrs['dir']).toBe('auto');
    expect(one(s.pane, 'spellbook-project-switch-icon').icon).toBe('chevrons-up-down');

    button.rect = { top: 10, bottom: 40, left: 12, right: 212, width: 200, height: 30 };
    tap(button);
    expect(StubMenu.shown).toHaveLength(1);
    const menu = StubMenu.shown[0];
    expect(menu?.position).toEqual({ x: 12, y: 40, width: 200 }); // under the button
    expect(menu?.items.map((item) => [item.title, item.checked])).toEqual([
      ['My Novel', true],
      ['Other Book', false],
    ]);
  });

  it('switches to the project that is picked, and remembers it on this device', async () => {
    const s = await stage(withSecondProject());
    scroller(s.pane).scrollTop = 120;
    tap(one(s.pane, 'spellbook-project-switch'));
    StubMenu.shown[0]?.items[1]?.click();
    await rest(s);

    expect(one(s.pane, 'spellbook-project-name').text).toBe('Other Book');
    expect(picture(s.pane)).toEqual(['v Manuscript 9', '  Elsewhere 9', 'v Research', '  (No research notes yet.)']);
    expect(s.storage.load(ACTIVE_PROJECT_KEY)).toBe('Other/Other.md');
    expect(scroller(s.pane).scrollTop).toBe(0); // another project: start at its top
    expect(s.vault.writes).toEqual([]);

    // Next time Obsidian starts, that project is the one that opens.
    await s.shell.close();
    const again = await stage(s.vault, { storage: s.storage });
    expect(one(again.pane, 'spellbook-project-name').text).toBe('Other Book');
  });

  it('does nothing when the open project is picked again', async () => {
    const s = await stage(withSecondProject());
    tap(one(s.pane, 'spellbook-project-switch'));
    StubMenu.shown[0]?.items[0]?.click();
    await rest(s);
    expect(one(s.pane, 'spellbook-project-name').text).toBe('My Novel');
    expect(s.storage.saves).toEqual([]);
  });

  it('tells projects with the same title apart by their folders', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'Drafts/Novel', title: 'Novel' });
    seedProject(vault, { folder: 'Novel', title: 'Novel' });
    seedProject(vault, { folder: 'Poems', title: 'Poems' });
    const s = await stage(vault);
    tap(one(s.pane, 'spellbook-project-switch'));
    expect(StubMenu.shown[0]?.items.map((item) => item.title)).toEqual(['Novel (Drafts/Novel)', 'Novel (Novel)', 'Poems']);
  });

  it('goes back to a plain name when the other project is deleted', async () => {
    const s = await stage(withSecondProject());
    s.vault.external.delete('Other');
    await rest(s);
    expect(s.pane.withClass('spellbook-project-switch')).toHaveLength(0);
    expect(heading(s.pane).fullText).toBe('My Novel');
  });
});

describe('drawing again', () => {
  /** As in a browser: emptying a list makes it too short to stay scrolled. */
  function scrollLikeABrowser(pane: FakeElement): { draws: () => number } {
    const list = scroller(pane);
    const body = one(pane, 'spellbook-binder-body');
    const empty = body.empty.bind(body);
    let draws = 0;
    body.empty = (): void => {
      empty();
      draws++;
      list.scrollTop = 0;
    };
    return { draws: () => draws };
  }

  it('keeps the place in the list', async () => {
    const s = await stage(novel());
    const { draws } = scrollLikeABrowser(s.pane);
    scroller(s.pane).scrollTop = 240;

    s.vault.external.create('Novel/Manuscript/Another loose one.md', { body: 'Hello there' });
    await rest(s);
    expect(draws()).toBe(1);
    expect(picture(s.pane)).toContain('  Another loose one 2');
    expect(scroller(s.pane).scrollTop).toBe(240);
  });

  it('draws once for changes that come together', async () => {
    const s = await stage(novel());
    const { draws } = scrollLikeABrowser(s.pane);
    const told: string[] = [];
    s.store.onChange((change) => told.push(change.type));

    // The title changes on disk; the store then reports both "the list of
    // projects changed" and "the open project changed", one after the other.
    s.vault.external.editFrontmatter('Novel/Novel.md', (frontmatter) => { frontmatter['title'] = 'Renamed'; }, { silent: true });
    s.vault.refresh();
    await rest(s);
    expect(told).toEqual(['projects', 'project']);
    expect(draws()).toBe(1);
    expect(heading(s.pane).fullText).toBe('Renamed');
  });

  it('does not draw when nothing it shows has changed', async () => {
    const s = await stage(novel());
    const { draws } = scrollLikeABrowser(s.pane);
    s.vault.external.write(OPENING, { body: 'One two three four.' }); // only a count changes
    s.vault.external.create('Elsewhere/Unrelated.md');
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await rest(s);
    expect(draws()).toBe(0);
    expect(countOf(s.pane, 'Opening')).toBe('4');
  });
});

describe('a narrow pane', () => {
  it('is decided by the measured width of the pane, with a margin against flicker', async () => {
    const s = await stage(novel());
    const root = one(s.pane, 'spellbook-binder');
    const measure = (width: number): boolean => {
      s.pane.clientWidth = width;
      s.view.onResize();
      return root.hasClass('spellbook-is-narrow');
    };
    expect(measure(320)).toBe(false);
    expect(measure(NARROW_BELOW - 1)).toBe(true);
    expect(measure(NARROW_BELOW + 5)).toBe(true); // not wide enough to switch back yet
    expect(measure(WIDE_FROM)).toBe(false);
    expect(measure(NARROW_BELOW + 5)).toBe(false); // and not narrow enough to switch again
    expect(measure(NARROW_BELOW - 1)).toBe(true);
    expect(measure(0)).toBe(true); // hidden: keep what it was
  });

  it('has nothing to do with the kind of device', async () => {
    StubPlatform.isMobile = true;
    StubPlatform.isPhone = true;
    const s = await stage(novel());
    s.pane.clientWidth = 360; // a phone's drawer is wide enough
    s.view.onResize();
    expect(one(s.pane, 'spellbook-binder').hasClass('spellbook-is-narrow')).toBe(false);
  });

  it('is measured when the binder opens', async () => {
    const vault = novel();
    const s = await stage(vault);
    await s.shell.close();
    s.pane.clientWidth = 150;
    await s.shell.open();
    expect(one(s.pane, 'spellbook-binder').hasClass('spellbook-is-narrow')).toBe(true);
  });
});

describe('closing', () => {
  it('takes away everything the binder added and stops listening', async () => {
    const s = await stage(novel());
    expect(s.pane.hasClass('spellbook-binder-pane')).toBe(true);
    expect(s.fake.workspace.listenerCount('file-open')).toBe(1);
    expect(s.services.wordCounts.get(OPENING)).toBe(3);

    await s.shell.close();
    expect(s.pane.children).toEqual([]);
    expect(s.pane.hasClass('spellbook-binder-pane')).toBe(false);
    expect([...s.pane.classes]).toEqual(['view-content']); // Obsidian's own class is left alone
    expect(s.fake.workspace.listenerCount('file-open')).toBe(0);
    expect(s.services.wordCounts.get(OPENING)).toBeUndefined(); // nobody is looking at counts now

    // Whatever happens next, the closed binder stays out of it.
    const readsAfterClose = s.vault.reads.readText;
    s.vault.external.create('Novel/Manuscript/Later.md', { body: 'More words' });
    s.vault.external.write(LETTER, { body: 'Changed.' });
    s.fake.workspace.setActiveFile(fileAt(OPENING));
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await rest(s);
    expect(s.pane.children).toEqual([]);
    expect(s.vault.reads.readText).toBe(readsAfterClose);
  });

  it('never fills in a binder that was closed before Spellbook had started', async () => {
    const s = await stage(novel(), { started: false });
    await s.shell.close();
    s.host.start(s.services);
    await rest(s);
    expect(s.pane.children).toEqual([]);
    expect(s.fake.workspace.listenerCount('file-open')).toBe(0);
  });

  it('can be opened again afterwards', async () => {
    const s = await stage(novel());
    await s.shell.close();
    await s.shell.open();
    await rest(s);
    expect(picture(s.pane)[0]).toBe('v Manuscript 11');
    expect(s.fake.workspace.listenerCount('file-open')).toBe(1);
  });
});
