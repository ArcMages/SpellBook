// The snapshots as they are plugged into the plugin: the real feature on a
// project store that sits on the tests' memory vault. What is on disk is
// read from the vault; what the pane shows is read from the stand-in screen.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ONE_COLUMN_BELOW, SCENE_ID_KEY, TWO_COLUMNS_FROM, readSnapshotText } from '../../../src/core/snapshots';
import { SNAPSHOTS_SERVICE } from '../../../src/features/snapshots/index';
import type { SnapshotsService } from '../../../src/features/snapshots/index';
import { NO_PROJECT_TEXT, NO_SCENE_TEXT, SAME_TEXT } from '../../../src/features/snapshots/keeper';
import { AUTOMATIC_KEY, AUTOMATIC_NAME_TEXT, KEEP_KEY, KEEP_NAME_TEXT } from '../../../src/features/snapshots/prefs';
import { PROPERTIES_NAME } from '../../../src/features/snapshots/restoreModal';
import {
  CURRENT_TEXT,
  EMPTY_TEXT,
  LEGEND_TEXT,
  NO_DIFFERENCE_TEXT,
  NO_SCENE_PANE_TEXT,
  RECOUNT_DELAY_MS,
  RESTORED_TEXT,
  SAME_AS_NOW_TEXT,
  SNAPSHOTS_VIEW_TYPE,
  TAKEN_TEXT,
} from '../../../src/features/snapshots/snapshotsView';
import { MemoryVault } from '../../memoryVault';
import { FakeElement, Menu as StubMenu, Modal as StubModal, Notice as StubNotice, Platform, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import type { Setting as StubSetting } from '../../obsidianStub';
import { MemoryDeviceStorage } from '../../storeHarness';
import {
  CLOSING,
  CLOSING_BODY,
  NIGHT,
  NIGHT_BODY,
  NIGHT_TITLE,
  NOVEL_INDEX,
  OPENING,
  OPENING_BODY,
  OPENING_PROPERTIES,
  calm,
  cellsOf,
  inNovel,
  lastWindow,
  novelVault,
  one,
  openSnapshots,
  paneOf,
  press,
  rowsOf,
  snapshotPaths,
  takeSnapshot,
  windowButton,
  wire,
} from './stage';
import type { WireOptions, Wired } from './stage';

const stages: Wired[] = [];

async function stage(vault?: MemoryVault, options?: WireOptions): Promise<Wired> {
  const wired = await wire(vault, options);
  stages.push(wired);
  return wired;
}

beforeEach(() => {
  StubMenu.shown.length = 0;
  StubNotice.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
});

afterEach(() => {
  for (const wired of stages.splice(0)) wired.switchOff();
  resetPlatform();
});

const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);
/** The id the scene was given. */
const idOf = (wired: Wired, scene: string): string => String(wired.vault.frontmatterOf(inNovel(scene))?.[SCENE_ID_KEY] ?? '');
/** Everything in the vault that is not a snapshot, with its text. */
const others = (vault: MemoryVault): Record<string, string> =>
  Object.fromEntries(vault.paths().filter((path) => !path.startsWith('Novel/Snapshots/')).map((path) => [path, vault.textOf(path)]));

describe('plugging in', () => {
  it('adds the two commands, the pane and the settings, and follows nothing until asked', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    expect(wired.plugin.commands.map((command) => [command.id, command.name])).toEqual([
      ['take-snapshot', 'Take snapshot'],
      ['open-snapshots', 'Snapshots of this scene'],
    ]);
    expect(wired.plugin.viewTypes).toEqual([SNAPSHOTS_VIEW_TYPE]);
    expect(wired.features.settingsSections.map((section) => [section.id, section.title])).toEqual([['snapshots', 'Snapshots']]);
    // Automatic snapshots are off: the workspace is not listened to, nothing was read, written or stored.
    expect(wired.workspace.listenerCount()).toBe(0);
    expect(wired.vault.reads).toEqual({ readFrontmatter: 0, readText: 0 });
    expect(wired.vault.writes).toEqual([]);
    expect(wired.storage.save).toBeDefined();
    expect(wired.workspace.leaves).toEqual([]);
  });

  it('says why when there is no project or no scene to take a snapshot of', async () => {
    const none = await stage(novelVault(), { open: null, front: inNovel(OPENING) });
    none.command('take-snapshot').callback?.();
    none.command('open-snapshots').callback?.();
    expect(notices()).toEqual([NO_PROJECT_TEXT, NO_PROJECT_TEXT]);

    StubNotice.shown.length = 0;
    const wired = await stage(novelVault(), { front: 'Novel/Research/Harbours.md' });
    wired.command('take-snapshot').callback?.();
    wired.front('Notes/Plain.md');
    wired.command('open-snapshots').callback?.();
    wired.front(null);
    wired.command('take-snapshot').callback?.();
    expect(notices()).toEqual([NO_SCENE_TEXT, NO_SCENE_TEXT, NO_SCENE_TEXT]);
    expect(StubModal.opened).toEqual([]);
    expect(wired.workspace.leaves).toEqual([]);
    expect(wired.vault.writes).toEqual([]);
  });
});

describe('what the snapshots offer the other screens', () => {
  it('takes and shows the snapshots of a scene named by its place in the binder, whatever note is in front', async () => {
    const wired = await stage(novelVault(), { front: 'Notes/Plain.md' });
    const service = wired.features.services.get<SnapshotsService>(SNAPSHOTS_SERVICE);
    service?.take('Manuscript/Not a scene.md');
    service?.show('Research/Harbours.md');
    expect(StubModal.opened).toEqual([]);
    expect(wired.workspace.leaves).toEqual([]);

    service?.take(NIGHT);
    windowButton(lastWindow(), 'Take snapshot').click();
    await calm(wired);
    service?.show(NIGHT);
    await calm(wired);
    const { pane } = paneOf(wired);
    expect(one(pane, 'spellbook-snapshots-scene').text).toBe(NIGHT_TITLE);
    expect(rowsOf(pane)).toHaveLength(1);
  });
});

describe('taking a snapshot', () => {
  it('saves the scene as it is, as a plain note in the project\'s Snapshots folder, under the name given', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    const before = others(wired.vault);
    await takeSnapshot(wired, '  Before the rewrite ');
    expect(notices()).toEqual([TAKEN_TEXT]);

    const id = idOf(wired, OPENING);
    expect(id).toMatch(/^[a-z0-9]{8,}$/);
    const [path] = snapshotPaths(wired.vault);
    expect(snapshotPaths(wired.vault)).toHaveLength(1);
    expect(path).toMatch(new RegExp(`^Novel/Snapshots/Opening - ${id}/\\d{4}-\\d{2}-\\d{2} \\d{2}\\.\\d{2}\\.\\d{2} Before the rewrite\\.md$`));
    const properties = wired.vault.frontmatterOf(path as string);
    expect(properties).toMatchObject({
      'spellbook-snapshot': 1,
      'scene-id': id,
      scene: OPENING,
      name: 'Before the rewrite',
      'taken-at': wired.clock.now - 60_000,
      automatic: false,
      words: 22,
      device: 'testdevice',
    });
    expect(String(properties?.['taken'])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    // The scene whole: its properties (inert, in a code block) and its text exactly.
    const held = readSnapshotText(wired.vault.textOf(path as string));
    expect(held.body).toBe(OPENING_BODY);
    expect(held.yaml).toContain('synopsis: "Anna arrives in the old town."');
    expect(held.yaml).toContain(`${SCENE_ID_KEY}: "${id}"`);
    expect(wired.vault.bodyOf(path as string).startsWith('```yaml\n')).toBe(true);

    // The scene got an id and nothing else changed: not its text, not any other note.
    expect(wired.vault.bodyOf(inNovel(OPENING))).toBe(OPENING_BODY);
    expect(wired.vault.frontmatterOf(inNovel(OPENING))).toEqual({ ...OPENING_PROPERTIES, [SCENE_ID_KEY]: id });
    const after = others(wired.vault);
    delete after[inNovel(OPENING)];
    delete before[inNovel(OPENING)];
    expect(after).toEqual(before);
    expect(wired.vault.writes.map((write) => write.op)).toEqual(['updateFrontmatter', 'createFolder', 'createFolder', 'createFile']);
  });

  it('needs no name, works for a Hebrew scene, and gives two in one second two names', async () => {
    const wired = await stage(novelVault(), { front: inNovel(NIGHT) });
    await takeSnapshot(wired);
    wired.clock.now -= 60_000; // the same second again
    await takeSnapshot(wired, 'גרסה שנייה');
    wired.clock.now -= 60_000;
    await takeSnapshot(wired);
    const id = idOf(wired, NIGHT);
    const names = snapshotPaths(wired.vault).map((path) => path.replace(`Novel/Snapshots/${NIGHT_TITLE} - ${id}/`, ''));
    expect(names).toHaveLength(3);
    const stamp = /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}/.exec(names[0] as string)?.[0] as string;
    expect(names.sort()).toEqual([`${stamp} גרסה שנייה.md`, `${stamp}.md`, `${stamp}a.md`].sort());
    for (const path of snapshotPaths(wired.vault)) expect(readSnapshotText(wired.vault.textOf(path)).body).toBe(NIGHT_BODY);
    expect(snapshotPaths(wired.vault).map((path) => wired.vault.frontmatterOf(path)).filter((properties) => properties?.['name'] === 'גרסה שנייה')).toMatchObject([{ words: 18 }]);
  });

  it('has an editor that still holds unsaved words save them first', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    let saves = 0;
    const editor = {
      type: 'markdown',
      view: {
        file: { path: inNovel(OPENING) },
        save: async (): Promise<void> => {
          saves++;
          wired.vault.external.write(inNovel(OPENING), { body: `${OPENING_BODY}\nTyped a moment ago.\n` });
        },
        close: async (): Promise<void> => undefined,
      },
    };
    (wired.workspace.leaves as unknown[]).push(editor);
    await takeSnapshot(wired, 'With the last words');
    (wired.workspace.leaves as unknown[]).splice(0);
    expect(saves).toBe(1);
    expect(readSnapshotText(wired.vault.textOf(snapshotPaths(wired.vault)[0] as string)).body).toBe(`${OPENING_BODY}\nTyped a moment ago.\n`);
  });

  it('leaves the rest of the project as it was: a snapshot is no scene, no unfiled note, no research and no project', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    const project = wired.store.project;
    await takeSnapshot(wired, 'One');
    await takeSnapshot(wired, 'Two');
    const now = wired.store.project;
    expect(now?.tree).toEqual(project?.tree);
    expect([now?.unfiled, now?.research, now?.missing, now?.conflicts]).toEqual([[], ['Research/Harbours.md'], [], []]);
    expect(wired.store.listProjects().map((each) => each.indexPath)).toEqual([NOVEL_INDEX]);
    expect(wired.store.timelineNotes()).toEqual([]);
    expect(wired.store.statsFiles()).toEqual([]);
    // The notes of the manuscript are what they were.
    expect(wired.store.projectNotes('Manuscript').map((note) => note.path)).toEqual([CLOSING, OPENING, NIGHT].sort());
  });

  it('says so, and writes nothing, when the snapshot cannot be saved', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    wired.vault.failNext('createFile');
    wired.command('take-snapshot').callback?.();
    const modal = lastWindow();
    windowButton(modal, 'Take snapshot').click();
    await calm(wired);
    expect(modal.isOpen).toBe(true); // the window stays, with the reason under the field
    expect(one(modal.contentEl, 'spellbook-prompt-message').text).toMatch(/could not be saved/);
    expect(snapshotPaths(wired.vault)).toEqual([]);
    expect(wired.vault.bodyOf(inNovel(OPENING))).toBe(OPENING_BODY);
  });
});

describe('the list of a scene\'s snapshots', () => {
  async function withThree(): Promise<Wired> {
    const wired = await stage(novelVault(), { front: inNovel(NIGHT) });
    await takeSnapshot(wired, 'טיוטה ראשונה');
    wired.vault.external.write(inNovel(NIGHT), { body: NIGHT_BODY.replace(' היקרה', '').replace('חשוך,', 'חשוך מאוד,') });
    await takeSnapshot(wired);
    wired.vault.external.write(inNovel(NIGHT), { body: `${NIGHT_BODY}\nפסקה חדשה לגמרי.\n` });
    await takeSnapshot(wired, 'Third');
    wired.front(inNovel(OPENING));
    await takeSnapshot(wired, 'Of another scene');
    wired.front(inNovel(NIGHT));
    return wired;
  }

  it('shows them newest first, with name, date, words and how the scene differs from each now', async () => {
    const wired = await withThree();
    const { pane } = await openSnapshots(wired);
    expect(one(pane, 'spellbook-snapshots-scene').text).toBe(NIGHT_TITLE);
    expect(one(pane, 'spellbook-snapshots-scene').attrs['dir']).toBe('auto');
    const rows = rowsOf(pane);
    expect(rows.map((row) => [row.name, row.words, row.change])).toEqual([
      ['Third', '21 words', SAME_AS_NOW_TEXT],
      ['Snapshot', '18 words', 'The scene now: +4 −1 words'],
      ['טיוטה ראשונה', '18 words', 'The scene now: +3 −0 words'],
    ]);
    for (const row of rows) {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(one(row.el, 'spellbook-snapshots-name').attrs['dir']).toBe('auto');
      // Every action is a button of its own: nothing hides behind a hover or a drag.
      expect(row.el.withClass('spellbook-snapshots-button').map((button) => [button.tag, button.text])).toEqual([
        ['button', 'View'],
        ['button', 'Compare'],
        ['button', 'Restore'],
        ['button', 'Delete'],
      ]);
    }
    // One pane: asking again turns it to the scene in front.
    wired.front(inNovel(OPENING));
    const again = await openSnapshots(wired);
    expect(wired.workspace.getLeavesOfType(SNAPSHOTS_VIEW_TYPE)).toHaveLength(1);
    expect(rowsOf(again.pane).map((row) => row.name)).toEqual(['Of another scene']);
  });

  it('says so for a scene without snapshots, and for a pane that has no scene', async () => {
    const wired = await stage(novelVault(), { front: inNovel(CLOSING) });
    const { pane, leaf } = await openSnapshots(wired);
    expect(one(pane, 'spellbook-snapshots-message').text).toBe(EMPTY_TEXT);
    expect(wired.vault.writes).toEqual([]); // looking writes nothing, not even an id
    // A pane Obsidian opens by itself while no scene is in front.
    wired.front(null);
    await leaf.setViewState({ type: SNAPSHOTS_VIEW_TYPE });
    await calm(wired);
    expect(one(paneOf(wired).pane, 'spellbook-snapshots-message').text).toBe(NO_SCENE_PANE_TEXT);
    expect(one(paneOf(wired).pane, 'spellbook-snapshots-take').disabled).toBe(true);
  });

  it('follows the scene when it is renamed, here or on another device', async () => {
    const wired = await withThree();
    const { pane } = await openSnapshots(wired);
    const renamed = await wired.store.renameScene(NIGHT, 'Night at the harbour');
    expect(renamed.status).toBe('done');
    await calm(wired);
    expect(one(pane, 'spellbook-snapshots-scene').text).toBe('Night at the harbour');
    expect(rowsOf(pane).map((row) => row.name)).toEqual(['Third', 'Snapshot', 'טיוטה ראשונה']);
    // A new snapshot joins the others, in the folder they started in.
    wired.front(inNovel('Manuscript/Night at the harbour.md'));
    await takeSnapshot(wired, 'After the rename');
    expect(rowsOf(pane).map((row) => row.name)).toEqual(['After the rename', 'Third', 'Snapshot', 'טיוטה ראשונה']);
    const folders = new Set(snapshotPaths(wired.vault).map((path) => path.split('/')[2]));
    expect([...folders].filter((folder) => folder?.startsWith(NIGHT_TITLE))).toHaveLength(1);
    expect(folders.size).toBe(2);

    // Renamed outside the plugin, and seen by a pane that is opened afresh.
    wired.vault.external.rename(inNovel('Manuscript/Night at the harbour.md'), inNovel('Manuscript/Harbour.md'));
    await calm(wired);
    wired.front(inNovel('Manuscript/Harbour.md'));
    const again = await openSnapshots(wired);
    expect(one(again.pane, 'spellbook-snapshots-scene').text).toBe('Harbour');
    expect(rowsOf(again.pane)).toHaveLength(4);
  });

  it('counts the differences again a moment after the scene is saved, not at every save', async () => {
    const wired = await withThree();
    const { pane } = await openSnapshots(wired);
    const reads = wired.vault.reads.readText;
    wired.vault.external.write(inNovel(NIGHT), { body: `${NIGHT_BODY}\nפסקה חדשה לגמרי.\nועוד שתי מילים.\n` });
    wired.vault.external.write(inNovel(NIGHT), { body: `${NIGHT_BODY}\nפסקה חדשה לגמרי.\nועוד שלוש מילים כאן.\n` });
    await calm(wired);
    expect(rowsOf(pane)[0]?.change).toBe(SAME_AS_NOW_TEXT);
    expect(wired.vault.reads.readText).toBe(reads);
    wired.timers.advance(RECOUNT_DELAY_MS);
    await calm(wired);
    expect(rowsOf(pane)[0]?.change).toBe('The scene now: +4 −0 words');
    // The snapshots themselves were read once only: they never change.
    expect(wired.vault.reads.readText).toBe(reads + 1);
  });

  it('lists a snapshot that arrives from another device, once, also when a sync copy sits next to it', async () => {
    const wired = await withThree();
    const { pane } = await openSnapshots(wired);
    const [first] = snapshotPaths(wired.vault).filter((path) => path.includes(NIGHT_TITLE));
    const properties = wired.vault.frontmatterOf(first as string);
    wired.vault.external.create((first as string).replace('.md', ' 2.md'), { frontmatter: properties, body: wired.vault.bodyOf(first as string) });
    wired.vault.external.create(`Novel/Snapshots/${NIGHT_TITLE} - elsewhere/2026-10-01 08.00.00 From the phone.md`, {
      frontmatter: { ...properties, name: 'From the phone', 'taken-at': 5, taken: '2026-10-01T08:00:00', device: 'phone' },
      body: '```yaml\n```\nטקסט מהטלפון.\n',
    });
    await calm(wired);
    expect(rowsOf(pane).map((row) => row.name)).toEqual(['Third', 'Snapshot', 'טיוטה ראשונה', 'From the phone']);
  });
});

describe('reading and comparing', () => {
  async function withOne(): Promise<Wired> {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    await takeSnapshot(wired, 'Draft one');
    wired.vault.external.write(inNovel(OPENING), {
      body: ['# Chapter One', '', 'It was a dark night. The harbour was empty, and Anna ran alone.', '', 'A whole new paragraph.', ''].join('\n'),
    });
    return wired;
  }

  it('shows a snapshot\'s text, each paragraph with a direction of its own', async () => {
    const wired = await stage(novelVault(), { front: inNovel(NIGHT) });
    await takeSnapshot(wired, 'טיוטה');
    const { pane } = await openSnapshots(wired);
    await press(wired, pane, 'spellbook-snapshots-view');
    const paragraphs = one(pane, 'spellbook-snapshots-text').withClass('spellbook-snapshots-para');
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual(['# פרק ראשון', 'שלום לך אחותי היקרה. מה שלומך? אני כותבת לך מן הנמל!', 'הלילה היה חשוך, והים שקט.']);
    for (const paragraph of paragraphs) expect(paragraph.attrs['dir']).toBe('auto');
    // The properties block of the scene is not part of what is read.
    expect(one(pane, 'spellbook-snapshots-text').fullText).not.toContain('order');
    await press(wired, pane, 'spellbook-snapshots-back');
    expect(rowsOf(pane)).toHaveLength(1);
  });

  it('compares a snapshot with the scene now: side by side in a wide pane, signs and marks as well as colour', async () => {
    const wired = await withOne();
    const { pane, view } = await openSnapshots(wired);
    pane.clientWidth = 900;
    view.onResize();
    await press(wired, pane, 'spellbook-snapshots-compare');
    expect(one(pane, 'spellbook-snapshots-diff').hasClass('is-two-columns')).toBe(true);
    expect(pane.withClass('spellbook-snapshots-side-head').map((head) => head.text)).toEqual([expect.stringMatching(/^Draft one, \d{4}-/), CURRENT_TEXT]);
    expect(one(pane, 'spellbook-snapshots-summary').text).toBe('+5 words added, −8 words removed');
    expect(one(pane, 'spellbook-snapshots-legend').text).toBe(LEGEND_TEXT);
    expect(cellsOf(pane)).toEqual([
      ['# Chapter One', '# Chapter One'],
      ['~ It was a dark night. The harbour was empty, and Anna[- walked] alone.', '~ It was a dark night. The harbour was empty, and Anna{+ ran} alone.'],
      ['− [-"Who is there?" she asked. Nobody answered!]', ''],
      ['', '+ {+A whole new paragraph.}'],
    ]);
    // What a sign means is also said in words, and every paragraph takes its own direction.
    expect(pane.withClass('spellbook-snapshots-sign').map((sign) => sign.attrs['aria-label'] ?? '')).toEqual([
      '',
      '',
      'Changed paragraph',
      'Changed paragraph',
      'Removed paragraph',
      'Added paragraph',
    ]);
    for (const paragraph of one(pane, 'spellbook-snapshots-diff').withClass('spellbook-snapshots-para')) expect(paragraph.attrs['dir']).toBe('auto');
  });

  it('compares in one column in a narrow pane and on a phone, going by the measured width', async () => {
    const wired = await withOne();
    const { pane, view } = await openSnapshots(wired);
    pane.clientWidth = 900;
    view.onResize();
    await press(wired, pane, 'spellbook-snapshots-compare');
    pane.clientWidth = ONE_COLUMN_BELOW - 1;
    view.onResize();
    expect(one(pane, 'spellbook-snapshots').hasClass('spellbook-is-narrow')).toBe(true);
    expect(one(pane, 'spellbook-snapshots-diff').hasClass('is-two-columns')).toBe(false);
    expect(cellsOf(pane)).toEqual([
      ['# Chapter One'],
      ['~ It was a dark night. The harbour was empty, and Anna[- walked]{+ ran} alone.'],
      ['− [-"Who is there?" she asked. Nobody answered!]'],
      ['+ {+A whole new paragraph.}'],
    ]);
    // A little wider is not yet wide again.
    pane.clientWidth = TWO_COLUMNS_FROM - 1;
    view.onResize();
    expect(one(pane, 'spellbook-snapshots-diff').hasClass('is-two-columns')).toBe(false);
    pane.clientWidth = TWO_COLUMNS_FROM;
    view.onResize();
    expect(one(pane, 'spellbook-snapshots-diff').hasClass('is-two-columns')).toBe(true);

    // A phone starts narrow, before anything is measured, and with room for a finger.
    Platform.isPhone = true;
    Platform.isMobile = true;
    const phone = await stage(novelVault(), { front: inNovel(OPENING) });
    await takeSnapshot(phone, 'On the phone');
    const opened = await openSnapshots(phone);
    const root = one(opened.pane, 'spellbook-snapshots');
    expect(['spellbook-is-narrow', 'spellbook-is-phone', 'spellbook-is-mobile'].map((cls) => root.hasClass(cls))).toEqual([true, true, true]);
    await press(phone, opened.pane, 'spellbook-snapshots-compare');
    expect(one(opened.pane, 'spellbook-snapshots-diff').hasClass('is-two-columns')).toBe(false);
    expect(one(opened.pane, 'spellbook-snapshots-summary').text).toBe(NO_DIFFERENCE_TEXT);
  });

  it('compares two snapshots with each other, the older one first, and a Hebrew scene word by word', async () => {
    const wired = await stage(novelVault(), { front: inNovel(NIGHT) });
    await takeSnapshot(wired, 'ראשונה');
    wired.vault.external.write(inNovel(NIGHT), { body: NIGHT_BODY.replace(' היקרה', '').replace('חשוך,', 'חשוך מאוד,') });
    await takeSnapshot(wired, 'שנייה');
    wired.vault.external.write(inNovel(NIGHT), { body: 'משהו אחר לגמרי.\n' });
    const { pane, view } = await openSnapshots(wired);
    pane.clientWidth = 400;
    view.onResize();
    // Compare the newer snapshot, then choose the older one to compare it with.
    await press(wired, rowsOf(pane)[0]?.el as FakeElement, 'spellbook-snapshots-compare');
    one(pane, 'spellbook-snapshots-against').fire('click');
    const menu = StubMenu.shown[StubMenu.shown.length - 1];
    expect(menu?.items.filter((item) => item.title !== '').map((item) => item.checked)).toEqual([true, false]);
    menu?.items[menu.items.length - 1]?.click();
    await calm(wired);
    expect(pane.withClass('spellbook-snapshots-side-head').map((head) => head.text.split(',')[0])).toEqual(['ראשונה', 'שנייה']);
    expect(cellsOf(pane)).toEqual([
      ['# פרק ראשון'],
      ['~ שלום לך אחותי[- היקרה]. מה שלומך? אני כותבת לך מן הנמל!'],
      ['~ הלילה היה חשוך{+ מאוד}, והים שקט.'],
    ]);
    expect(one(pane, 'spellbook-snapshots-summary').text).toBe('+1 words added, −1 words removed');
    expect(wired.vault.writes.filter((write) => write.op !== 'createFile' && write.op !== 'createFolder' && write.op !== 'updateFrontmatter')).toEqual([]);
  });

  it('folds long runs of unchanged paragraphs away, behind a button', async () => {
    const vault = novelVault();
    const lines = Array.from({ length: 40 }, (_, at) => `Paragraph number ${at + 1} of the scene.`);
    vault.external.write(inNovel(CLOSING), { body: lines.join('\n\n') }, { silent: true });
    const wired = await stage(vault, { front: inNovel(CLOSING) });
    await takeSnapshot(wired, 'Long');
    wired.vault.external.write(inNovel(CLOSING), { body: lines.map((line, at) => (at === 20 ? `${line} And more.` : line)).join('\n\n') });
    const { pane } = await openSnapshots(wired);
    await press(wired, pane, 'spellbook-snapshots-compare');
    expect(pane.withClass('spellbook-snapshots-unfold').map((button) => button.text)).toEqual(['Show 19 unchanged paragraphs', 'Show 18 unchanged paragraphs']);
    expect(cellsOf(pane)).toHaveLength(3);
    await press(wired, pane, 'spellbook-snapshots-unfold');
    expect(cellsOf(pane)).toHaveLength(22);
    expect(pane.withClass('spellbook-snapshots-unfold')).toHaveLength(1);
  });
});

describe('restoring', () => {
  const NEWER = 'A newer text that the writer may want back.\n';

  async function withOne(): Promise<Wired> {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    await takeSnapshot(wired, 'Draft one');
    wired.vault.external.write(inNovel(OPENING), {
      frontmatter: { ...wired.vault.frontmatterOf(inNovel(OPENING)), status: 'Final', label: 'Red', synopsis: 'Anna leaves.', order: 4096 },
      body: NEWER,
    });
    await calm(wired);
    wired.vault.clearWrites();
    StubNotice.shown.length = 0;
    return wired;
  }

  async function restore(wired: Wired, options: { properties?: boolean; cancel?: boolean } = {}): Promise<FakeElement> {
    const { pane } = await openSnapshots(wired);
    const rows = rowsOf(pane);
    await press(wired, rows[rows.length - 1]?.el as FakeElement, 'spellbook-snapshots-restore-button');
    const modal = lastWindow();
    const toggleRow = modal.contentEl.settings.find((row) => row.nameEl.text === PROPERTIES_NAME) as StubSetting;
    expect(toggleRow.toggles[0]?.getValue()).toBe(false); // off unless the writer ticks it
    if (options.properties) toggleRow.toggles[0]?.flip();
    windowButton(modal, options.cancel ? 'Cancel' : 'Restore').click();
    await calm(wired);
    return pane;
  }

  it('asks first, and does nothing on Cancel', async () => {
    const wired = await withOne();
    const before = others(wired.vault);
    await restore(wired, { cancel: true });
    expect(wired.vault.writes).toEqual([]);
    expect(others(wired.vault)).toEqual(before);
    expect(snapshotPaths(wired.vault)).toHaveLength(1);
    // Cancel is where the keyboard starts.
    const { pane } = paneOf(wired);
    await press(wired, pane, 'spellbook-snapshots-restore-button');
    expect(windowButton(lastWindow(), 'Cancel').buttonEl.focused).toBe(true);
    expect(lastWindow().titleEl.text).toBe('Restore "Opening"?');
  });

  it('saves the text as it is now first, then puts the snapshot\'s text back and keeps the scene\'s properties', async () => {
    const wired = await withOne();
    const id = idOf(wired, OPENING);
    const untouched = others(wired.vault);
    delete untouched[inNovel(OPENING)];
    const pane = await restore(wired);

    expect(wired.vault.bodyOf(inNovel(OPENING))).toBe(OPENING_BODY);
    expect(wired.vault.frontmatterOf(inNovel(OPENING))).toEqual({ ...OPENING_PROPERTIES, [SCENE_ID_KEY]: id, status: 'Final', label: 'Red', synopsis: 'Anna leaves.', order: 4096 });
    // The snapshot was written before the scene was, and holds what was there.
    expect(wired.vault.writes.map((write) => write.op)).toEqual(['createFile', 'replaceText']);
    const before = wired.vault.writes[0]?.path as string;
    expect(wired.vault.frontmatterOf(before)).toMatchObject({ 'scene-id': id, automatic: false, words: 9 });
    expect(String(wired.vault.frontmatterOf(before)?.['name'])).toMatch(/^Before restore: Draft one, \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const held = readSnapshotText(wired.vault.textOf(before));
    expect(held.body).toBe(NEWER);
    expect(held.yaml).toContain('status: "Final"');
    // Nothing else in the vault changed.
    const after = others(wired.vault);
    delete after[inNovel(OPENING)];
    expect(after).toEqual(untouched);

    expect(notices()).toEqual([RESTORED_TEXT]);
    expect(one(pane, 'spellbook-snapshots-status').text).toBe(RESTORED_TEXT);
    const rows = rowsOf(pane);
    expect(rows.map((row) => row.name.split(',')[0])).toEqual(['Before restore: Draft one', 'Draft one']);
    expect(rows[1]?.change).toBe(SAME_AS_NOW_TEXT);
    expect(rows[0]?.change).toBe('The scene now: +22 −9 words');
  });

  it('can be undone: restoring the "Before restore" snapshot brings the newer text back', async () => {
    const wired = await withOne();
    const pane = await restore(wired);
    await press(wired, rowsOf(pane)[0]?.el as FakeElement, 'spellbook-snapshots-restore-button');
    windowButton(lastWindow(), 'Restore').click();
    await calm(wired);
    expect(wired.vault.bodyOf(inNovel(OPENING))).toBe(NEWER);
    expect(snapshotPaths(wired.vault)).toHaveLength(3);
  });

  it('puts the properties of the time back too when the writer ticks it, but the scene stays itself', async () => {
    const wired = await withOne();
    const id = idOf(wired, OPENING);
    await restore(wired, { properties: true });
    expect(wired.vault.bodyOf(inNovel(OPENING))).toBe(OPENING_BODY);
    // Status, label and synopsis as they were; the id and the place in the binder as they are.
    expect(wired.vault.frontmatterOf(inNovel(OPENING))).toEqual({ ...OPENING_PROPERTIES, [SCENE_ID_KEY]: id, order: 4096 });
    expect(wired.vault.writes.map((write) => write.op)).toEqual(['createFile', 'replaceText', 'updateFrontmatter']);
    expect(rowsOf(paneOf(wired).pane)).toHaveLength(2);
  });

  it('never loses words typed in the meantime: the scene is only replaced if it still is the text that was saved', async () => {
    const wired = await withOne();
    // The moment the "before" snapshot is on disk, another device changes the scene.
    let changed = 0;
    const stop = wired.vault.on((event) => {
      if (event.type !== 'create' || !event.path.includes('Before restore') || changed > 0) return;
      changed++;
      wired.vault.external.write(inNovel(OPENING), { body: `${NEWER}And one more line from the phone.\n` });
    });
    await restore(wired);
    stop();
    expect(changed).toBe(1);
    // The restore went through on the second try, and both newer texts are kept as snapshots.
    expect(wired.vault.bodyOf(inNovel(OPENING))).toBe(OPENING_BODY);
    const kept = snapshotPaths(wired.vault)
      .filter((path) => path.includes('Before restore'))
      .map((path) => readSnapshotText(wired.vault.textOf(path)).body);
    expect(kept.sort()).toEqual([NEWER, `${NEWER}And one more line from the phone.\n`]);
    expect(wired.vault.writes.filter((write) => write.op === 'replaceText')).toHaveLength(1);
  });

  it('gives up, and replaces nothing, when the scene keeps changing or the text cannot be saved first', async () => {
    const wired = await withOne();
    let changes = 0;
    const stop = wired.vault.on((event) => {
      if (event.type !== 'create' || !event.path.includes('Before restore')) return;
      changes++;
      wired.vault.external.write(inNovel(OPENING), { body: `${NEWER}Line ${changes}.\n` });
    });
    await restore(wired);
    stop();
    expect(changes).toBe(3);
    expect(wired.vault.writes.filter((write) => write.op === 'replaceText')).toEqual([]);
    expect(wired.vault.bodyOf(inNovel(OPENING))).toBe(`${NEWER}Line 3.\n`);
    expect(notices()[0]).toMatch(/kept changing/);

    // The "before" snapshot cannot be written: the scene is left alone.
    StubNotice.shown.length = 0;
    wired.vault.clearWrites();
    wired.vault.failNext('createFile');
    const { pane } = paneOf(wired);
    const rows = rowsOf(pane);
    await press(wired, rows[rows.length - 1]?.el as FakeElement, 'spellbook-snapshots-restore-button');
    windowButton(lastWindow(), 'Restore').click();
    await calm(wired);
    expect(notices()[0]).toMatch(/could not be saved first, so nothing was restored/);
    expect(wired.vault.writes).toEqual([]);
    expect(wired.vault.bodyOf(inNovel(OPENING))).toBe(`${NEWER}Line 3.\n`);
  });

  it('changes nothing when the scene already reads as the snapshot does', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    await takeSnapshot(wired, 'Draft one');
    wired.vault.clearWrites();
    StubNotice.shown.length = 0;
    await restore(wired);
    expect(notices()).toEqual([SAME_TEXT]);
    expect(wired.vault.writes).toEqual([]);
    expect(snapshotPaths(wired.vault)).toHaveLength(1);
  });
});

describe('deleting', () => {
  it('asks first, then moves the snapshot to the trash, with any sync copy of it; the scene is not touched', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    await takeSnapshot(wired, 'One');
    await takeSnapshot(wired, 'Two');
    const [one_, two] = snapshotPaths(wired.vault) as [string, string];
    wired.vault.external.create(two.replace('.md', ' 2.md'), { frontmatter: wired.vault.frontmatterOf(two), body: wired.vault.bodyOf(two) });
    const scene = wired.vault.textOf(inNovel(OPENING));
    const { pane } = await openSnapshots(wired);
    expect(rowsOf(pane).map((row) => row.name)).toEqual(['Two', 'One']);

    await press(wired, pane, 'spellbook-snapshots-delete');
    expect(lastWindow().titleEl.text).toBe('Delete the snapshot "Two"?');
    windowButton(lastWindow(), 'Cancel').click();
    await calm(wired);
    expect(wired.vault.trashed).toEqual([]);

    await press(wired, pane, 'spellbook-snapshots-delete');
    windowButton(lastWindow(), 'Delete').click();
    await calm(wired);
    expect(wired.vault.trashed.sort()).toEqual([two, two.replace('.md', ' 2.md')].sort());
    expect(snapshotPaths(wired.vault)).toEqual([one_]);
    expect(rowsOf(pane).map((row) => row.name)).toEqual(['One']);
    expect(wired.vault.textOf(inNovel(OPENING))).toBe(scene);
  });
});

describe('automatic snapshots', () => {
  const on = (): MemoryDeviceStorage => {
    const storage = new MemoryDeviceStorage();
    storage.save(AUTOMATIC_KEY, 'on');
    storage.save(KEEP_KEY, '2');
    return storage;
  };
  const edit = async (wired: Wired, scene: string, body: string): Promise<void> => {
    wired.vault.external.write(inNovel(scene), { body });
    await calm(wired);
    wired.clock.now += 60_000;
  };
  const automatic = (wired: Wired): string[] => snapshotPaths(wired.vault).filter((path) => wired.vault.frontmatterOf(path)?.['automatic'] === true);

  it('are off unless switched on: an edit then takes no snapshot', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    await edit(wired, OPENING, 'Edited.\n');
    expect(snapshotPaths(wired.vault)).toEqual([]);
    expect(wired.vault.writes).toEqual([]);
    // The settings show the switch, off, and the number to keep.
    const section = wired.features.settingsSections[0];
    const container = new FakeElement();
    section?.render(container as unknown as HTMLElement);
    expect(container.settings.map((row) => row.nameEl.text)).toEqual([AUTOMATIC_NAME_TEXT, KEEP_NAME_TEXT]);
    expect(container.settings[0]?.toggles[0]?.getValue()).toBe(false);
  });

  it('save the scene as it was before the first edit of the day, once a day', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING), storage: on() });
    await calm(wired);
    expect(wired.vault.writes).toEqual([]); // looking at a scene writes nothing
    await edit(wired, OPENING, 'First edit of the day.\n');
    const [first] = automatic(wired);
    expect(automatic(wired)).toHaveLength(1);
    expect(readSnapshotText(wired.vault.textOf(first as string)).body).toBe(OPENING_BODY);
    expect(wired.vault.frontmatterOf(first as string)).toMatchObject({ automatic: true, name: '', words: 22, scene: OPENING });
    // The scene being typed in was not written to: its id comes once the writer moves on.
    expect(wired.vault.writes.map((write) => write.op)).toEqual(['createFolder', 'createFolder', 'createFile']);
    expect(wired.vault.frontmatterOf(inNovel(OPENING))).toEqual(OPENING_PROPERTIES);

    await edit(wired, OPENING, 'Second edit of the day.\n');
    await edit(wired, OPENING, 'Third edit of the day.\n');
    expect(automatic(wired)).toHaveLength(1);

    // The pane lists it already, by the scene's path.
    const { pane } = await openSnapshots(wired);
    expect(rowsOf(pane).map((row) => row.name)).toEqual(['Automatic']);

    wired.front(inNovel(CLOSING));
    await calm(wired);
    const id = idOf(wired, OPENING);
    expect(id).not.toBe('');
    expect(wired.vault.frontmatterOf(first as string)?.['scene-id']).toBe(id);

    // The next day, the first edit saves the text of the evening before.
    wired.clock.today = '2026-10-14';
    wired.clock.now += 24 * 3600_000;
    wired.front(inNovel(OPENING));
    await calm(wired);
    await edit(wired, OPENING, 'A new day.\n');
    expect(automatic(wired)).toHaveLength(2);
    expect(automatic(wired).map((path) => readSnapshotText(wired.vault.textOf(path)).body).sort()).toEqual([OPENING_BODY, 'Third edit of the day.\n'].sort());
  });

  it('take no snapshot for a change of the properties alone, for a note that is no scene, or for a restore', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING), storage: on() });
    await calm(wired);
    wired.vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
      frontmatter['status'] = 'Final';
    });
    await calm(wired);
    wired.front('Novel/Research/Harbours.md');
    await calm(wired);
    await edit(wired, 'Research/Harbours.md', 'More notes.\n');
    expect(snapshotPaths(wired.vault)).toEqual([]);

    // A restore saves the text before it by itself; it is not an edit on top of that.
    wired.front(inNovel(CLOSING));
    await calm(wired);
    await takeSnapshot(wired, 'Mine');
    wired.vault.external.write(inNovel(CLOSING), { body: 'Rewritten.\n' }, { silent: true });
    wired.front(inNovel(OPENING));
    wired.front(inNovel(CLOSING));
    await calm(wired);
    const { pane } = await openSnapshots(wired);
    await press(wired, pane, 'spellbook-snapshots-restore-button');
    windowButton(lastWindow(), 'Restore').click();
    await calm(wired);
    expect(wired.vault.bodyOf(inNovel(CLOSING))).toBe(CLOSING_BODY);
    expect(automatic(wired)).toEqual([]);
    expect(snapshotPaths(wired.vault)).toHaveLength(2);
  });

  it('keep the newest few for a scene and move older automatic ones to the trash; named ones are never removed', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING), storage: on() });
    await calm(wired);
    await takeSnapshot(wired, 'Mine, to keep');
    for (let day = 1; day <= 4; day++) {
      wired.clock.today = `2026-11-0${day}`;
      wired.clock.now += 24 * 3600_000;
      await edit(wired, OPENING, `Day ${day}.\n`);
    }
    expect(automatic(wired)).toHaveLength(2);
    expect(automatic(wired).map((path) => readSnapshotText(wired.vault.textOf(path)).body).sort()).toEqual(['Day 2.\n', 'Day 3.\n']);
    expect(wired.vault.trashed).toHaveLength(2);
    for (const path of wired.vault.trashed) expect(path.startsWith('Novel/Snapshots/')).toBe(true);
    expect(snapshotPaths(wired.vault).filter((path) => path.includes('Mine, to keep'))).toHaveLength(1);
  });

  it('start and stop with the switch, and stop when the plugin is switched off', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    const container = new FakeElement();
    wired.features.settingsSections[0]?.render(container as unknown as HTMLElement);
    container.settings[0]?.toggles[0]?.flip();
    expect(wired.storage.load(AUTOMATIC_KEY)).toBe('on');
    expect(wired.workspace.listenerCount('file-open')).toBe(1);
    await calm(wired);
    await edit(wired, OPENING, 'Edited.\n');
    expect(automatic(wired)).toHaveLength(1);

    container.settings[0]?.toggles[0]?.flip();
    expect(wired.storage.load(AUTOMATIC_KEY)).toBeNull();
    expect(wired.workspace.listenerCount()).toBe(0);
    wired.clock.today = '2026-10-14';
    await edit(wired, OPENING, 'Edited again.\n');
    expect(automatic(wired)).toHaveLength(1);

    container.settings[0]?.toggles[0]?.flip();
    await calm(wired);
    wired.switchOff();
    expect(wired.workspace.listenerCount()).toBe(0);
    wired.vault.external.write(inNovel(OPENING), { body: 'After the plugin was switched off.\n' });
    await calm(wired);
    expect(automatic(wired)).toHaveLength(1);
  });
});

describe('switching the plugin off', () => {
  it('empties the pane and leaves nothing listening or written', async () => {
    const wired = await stage(novelVault(), { front: inNovel(OPENING) });
    await takeSnapshot(wired, 'One');
    const { pane, leaf } = await openSnapshots(wired);
    expect(rowsOf(pane)).toHaveLength(1);
    wired.vault.clearWrites();
    leaf.detach();
    wired.switchOff();
    expect(pane.children).toEqual([]);
    expect(pane.hasClass('spellbook-snapshots-pane')).toBe(false);
    expect(wired.workspace.listenerCount()).toBe(0);
    wired.vault.external.write(inNovel(OPENING), { body: 'Later.\n' });
    wired.timers.advance(10_000);
    await calm(wired);
    expect(wired.vault.writes).toEqual([]);
  });
});
