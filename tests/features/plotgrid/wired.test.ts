// The plot grid as it is plugged into the plugin: the real feature on a
// project store that sits on the tests' memory vault. What the grid shows is
// read from the stand-in screen; what it changes is read from the vault.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLanes } from '../../../src/core/timeline';
import { readPrefs, sceneInLane } from '../../../src/core/plotgrid';
import { PREFS_KEY } from '../../../src/features/plotgrid/host';
import { EntityPickerModal } from '../../../src/features/plotgrid/pickerModal';
import { GAP_CLASS, NO_COLUMNS_TEXT, NO_PROJECT_TEXT, PLOT_GRID_VIEW_TYPE } from '../../../src/features/plotgrid/plotGridView';
import {
  Menu as StubMenu,
  Modal as StubModal,
  Notice as StubNotice,
  Platform,
  resetFakeDocument,
  resetPlatform,
} from '../../obsidianStub';
import { FakeElement } from '../../obsidianStub';
import { MemoryDeviceStorage } from '../../storeHarness';
import {
  CLOSING,
  DANIEL,
  HARBOUR_PATH,
  LETTER,
  MAIN,
  MIDDLE,
  NIGHT,
  NIGHT_SYNOPSIS,
  NIGHT_TITLE,
  NOVEL_INDEX,
  OPENING,
  REVENGE,
  SECOND_INDEX,
  YOSEF,
  YOSEF_PATH,
  calm,
  countsOf,
  headersOf,
  inNovel,
  lastMenu,
  novelVault,
  markOf,
  one,
  openGrid,
  pictureOf,
  rowNames,
  sceneRow,
  wire,
} from './stage';
import type { WireOptions, Wired } from './stage';
import type { MemoryVault } from '../../memoryVault';

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
  resetPlatform();
});

afterEach(() => {
  for (const wired of stages.splice(0)) wired.switchOff();
  resetPlatform();
});

const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);
const props = (s: Wired, path: string): Record<string, unknown> => s.vault.frontmatterOf(inNovel(path)) ?? {};
const writesTo = (s: Wired, path: string): string[] => s.vault.writesTo(inNovel(path)).map((write) => write.op);

/** Tap a cell and let the change be saved and the grid drawn again. */
async function tap(s: Wired, pane: FakeElement, title: string, column: string): Promise<void> {
  markOf(pane, title, column).fire('click');
  await calm(s);
}

/** Choose what the columns are, from the menu above the grid. */
async function chooseKind(s: Wired, pane: FakeElement, name: string): Promise<void> {
  one(pane, 'spellbook-plotgrid-kind').fire('click');
  lastMenu().item(name).click();
  await calm(s);
}

const ALL_SCENES = ['Opening', '[Part one]', 'The Letter', NIGHT_TITLE, 'Middle', 'Ghost', 'Closing'];

describe('plugging the plot grid in', () => {
  it('registers the pane, the command, the ribbon button and a settings section, and does nothing until it is opened', async () => {
    const s = await stage();
    expect(s.features.ids).toEqual(['plotgrid']);
    expect(s.plugin.viewTypes).toEqual([PLOT_GRID_VIEW_TYPE]);
    expect(s.plugin.commands.map((command) => [command.id, command.name])).toEqual([['open-plot-grid', 'Open plot grid']]);
    expect(s.plugin.ribbonIcons.map((icon) => [icon.icon, icon.title])).toEqual([['layout-grid', 'Open Spellbook plot grid']]);
    expect(s.features.settingsSections.map((section) => [section.id, section.title])).toEqual([['plotgrid', 'Plot grid']]);
    await calm(s);
    expect(s.vault.writes).toEqual([]);
    expect(s.storage.saves).toEqual([]);
    expect(s.workspace.leaves).toHaveLength(0);
  });

  it('opens as a tab in the main area, and brings the same pane back when asked again', async () => {
    const s = await stage();
    const first = await openGrid(s);
    expect(first.leaf.split).toBe(s.workspace.rootSplit);
    expect(first.view.getDisplayText()).toBe('Plot grid');
    s.plugin.ribbonIcons[0]?.callback({});
    const again = await openGrid(s);
    expect(again.leaf).toBe(first.leaf);
    expect(s.workspace.getLeavesOfType(PLOT_GRID_VIEW_TYPE)).toHaveLength(1);
    expect(s.vault.writes).toEqual([]); // looking changes nothing
  });

  it('says so when no project is open', async () => {
    const s = await stage(undefined, { open: null });
    const { pane } = await openGrid(s);
    expect(one(pane, 'spellbook-plotgrid-message').text).toBe(NO_PROJECT_TEXT);
    expect(one(pane, 'spellbook-plotgrid-scroll').hasClass('spellbook-plotgrid-off')).toBe(true);
  });

  it('follows the vault only while a grid is open', async () => {
    const s = await stage();
    const listening = (): number => (s.vault as unknown as { listeners: Set<unknown> }).listeners.size;
    const before = listening();
    const { leaf } = await openGrid(s);
    expect(listening()).toBe(before + 1);
    leaf.detach();
    await calm(s);
    expect(listening()).toBe(before);
  });
});

describe('timeline lanes', () => {
  it('has a row per scene in binder order and a column per lane, with counts and filled cells', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    expect(one(pane, 'spellbook-plotgrid-kind').text).toBe('Columns: Timeline lanes');
    expect(one(pane, 'spellbook-plotgrid-heading').text).toBe('My Novel');
    expect(one(pane, 'spellbook-plotgrid-summary').text).toBe('6 scenes');
    expect(rowNames(pane)).toEqual(ALL_SCENES);
    expect(headersOf(pane)).toEqual([MAIN, REVENGE]);
    expect(countsOf(pane)).toEqual(['2', '1']);
    expect(pictureOf(pane)).toEqual({ Opening: 'x.', 'The Letter': '.x', [NIGHT_TITLE]: '..', Middle: '..', Ghost: '..', Closing: 'x.' });
    // A filled cell has a symbol, not only a colour, and says whether it is pressed.
    const filled = markOf(pane, 'Opening', MAIN);
    expect(one(filled, 'spellbook-plotgrid-dot').icon).toBe('check');
    expect(one(filled, 'spellbook-plotgrid-dot').hasClass('spellbook-plotgrid-color-purple')).toBe(true);
    expect(filled.attrs['aria-pressed']).toBe('true');
    expect(markOf(pane, 'Middle', MAIN).attrs['aria-pressed']).toBe('false');
    expect(markOf(pane, 'Middle', MAIN).children).toEqual([]);
    // The folder row counts the scenes inside it, per column.
    const folder = pane.withClass('spellbook-plotgrid-folder')[0] as FakeElement;
    expect(folder.withClass('spellbook-plotgrid-folder-cell').map((cell) => cell.fullText)).toEqual(['', '1']);
    // The ghost (no note) cannot be tapped.
    expect(markOf(pane, 'Ghost', MAIN).attrs['aria-disabled']).toBe('true');
  });

  it('shows the writer\'s own text in its own direction', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    for (const cls of ['spellbook-plotgrid-heading', 'spellbook-plotgrid-head-name', 'spellbook-plotgrid-title', 'spellbook-plotgrid-folder-name']) {
      for (const element of pane.withClass(cls)) expect(element.attrs['dir'], cls).toBe('auto');
    }
  });

  it('puts a scene in a lane with a tap, writing only its "timelines", in the form the timeline reads', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    const before = props(s, MIDDLE);
    await tap(s, pane, 'Middle', REVENGE);
    expect(props(s, MIDDLE)).toEqual({ ...before, timelines: [REVENGE] });
    expect(writesTo(s, MIDDLE)).toEqual(['updateFrontmatter']);
    expect(sceneInLane(props(s, MIDDLE), REVENGE, readLanes(s.vault.frontmatterOf(NOVEL_INDEX)?.['timelines']).lanes)).toBe(true);
    expect(pictureOf(pane)['Middle']).toBe('.x');
    expect(countsOf(pane)).toEqual(['2', '2']);
    // No other note was touched.
    expect(s.vault.writes.map((write) => write.path)).toEqual([inNovel(MIDDLE)]);
  });

  it('takes a scene out of a lane with a tap, keeping the entries it does not understand', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    await tap(s, pane, 'The Letter', REVENGE);
    expect(props(s, LETTER)['timelines']).toEqual(['Unknown lane']);
    expect(props(s, LETTER)['label']).toBe(DANIEL);
    // A lane written as one name on its own is taken out all the same.
    await tap(s, pane, 'Closing', MAIN);
    expect(props(s, CLOSING)['timelines']).toEqual([]);
    expect(props(s, CLOSING)['date']).toBe('1923-04-12');
    expect(pictureOf(pane)).toEqual({ Opening: 'x.', 'The Letter': '..', [NIGHT_TITLE]: '..', Middle: '..', Ghost: '..', Closing: '..' });
  });

  it('shows what it saved at once, even while the vault\'s index lags behind', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    s.vault.holdMetadata();
    await tap(s, pane, NIGHT_TITLE, MAIN);
    expect(pictureOf(pane)[NIGHT_TITLE]).toBe('x.');
    s.vault.releaseMetadata();
    await calm(s);
    expect(pictureOf(pane)[NIGHT_TITLE]).toBe('x.');
  });

  it('follows a change made elsewhere', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    await s.vault.updateFrontmatter(inNovel(MIDDLE), (frontmatter) => {
      frontmatter['timelines'] = [MAIN, REVENGE];
      return true;
    });
    await calm(s);
    expect(pictureOf(pane)['Middle']).toBe('xx');
  });

  it('says what to do when the project has no lanes of its own', async () => {
    const s = await stage(undefined, { open: SECOND_INDEX });
    const { pane } = await openGrid(s);
    expect(one(pane, 'spellbook-plotgrid-message').text).toBe(NO_COLUMNS_TEXT.lanes);
  });
});

describe('labels', () => {
  it('has a column per label, and a tap moves the scene\'s label there, writing only "label"', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    await chooseKind(s, pane, 'Labels');
    expect(headersOf(pane)).toEqual(['Anna', DANIEL]);
    expect(pictureOf(pane)).toEqual({ Opening: 'x.', 'The Letter': '.x', [NIGHT_TITLE]: '..', Middle: '..', Ghost: '..', Closing: '..' });
    const before = props(s, OPENING);
    await tap(s, pane, 'Opening', DANIEL);
    expect(props(s, OPENING)).toEqual({ ...before, label: DANIEL });
    expect(pictureOf(pane)['Opening']).toBe('.x');
    // A tap on the filled cell takes the label away.
    await tap(s, pane, 'Opening', DANIEL);
    expect(props(s, OPENING)).toEqual({ ...before, label: '' });
    expect(pictureOf(pane)['Opening']).toBe('..');
    expect(s.vault.writes.map((write) => write.path)).toEqual([inNovel(OPENING), inNovel(OPENING)]);
  });

  it('remembers the kind of columns on this device', async () => {
    const storage = new MemoryDeviceStorage();
    const s = await stage(undefined, { storage });
    const { pane } = await openGrid(s);
    await chooseKind(s, pane, 'Labels');
    expect(readPrefs(storage.load(PREFS_KEY)).kind).toBe('labels');
    s.switchOff();
    stages.splice(stages.indexOf(s), 1);
    const again = await stage(undefined, { storage });
    const reopened = await openGrid(again);
    expect(headersOf(reopened.pane)).toEqual(['Anna', DANIEL]);
  });
});

describe('World entities', () => {
  it('has a column per character, and a tap lists the character in the scene\'s "entities", as the World writes it', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    await chooseKind(s, pane, 'Characters');
    expect(headersOf(pane)).toEqual(['Mara', YOSEF]);
    expect(countsOf(pane)).toEqual(['1', '1']);
    expect(pictureOf(pane)).toEqual({ Opening: 'x.', 'The Letter': '..', [NIGHT_TITLE]: '.x', Middle: '..', Ghost: '..', Closing: '..' });
    const before = props(s, MIDDLE);
    await tap(s, pane, 'Middle', 'Mara');
    expect(props(s, MIDDLE)).toEqual({ ...before, entities: ['[[Mara]]'] });
    await tap(s, pane, 'Opening', 'Mara');
    expect(props(s, OPENING)['entities']).toBeUndefined();
    expect(pictureOf(pane)).toEqual({ Opening: '..', 'The Letter': '..', [NIGHT_TITLE]: '.x', Middle: 'x.', Ghost: '..', Closing: '..' });
  });

  it('has a column per place', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    await chooseKind(s, pane, 'Places');
    expect(headersOf(pane)).toEqual(['Harbour']);
    await tap(s, pane, NIGHT_TITLE, 'Harbour');
    expect(props(s, NIGHT)['entities']).toEqual([`[[${YOSEF}]]`, '[[Harbour]]']);
  });

  it('follows the entities picked in a window, remembered for the project on this device', async () => {
    const storage = new MemoryDeviceStorage();
    const s = await stage(undefined, { storage });
    const { pane } = await openGrid(s);
    await chooseKind(s, pane, 'Chosen entities');
    // Nothing was chosen yet: the window opens by itself.
    const picker = StubModal.opened[StubModal.opened.length - 1] as unknown as EntityPickerModal & { contentEl: FakeElement };
    expect(picker).toBeInstanceOf(EntityPickerModal);
    const rows = (): FakeElement[] => picker.contentEl.withClass('spellbook-plotgrid-pick');
    expect(rows().map((row) => row.fullText)).toEqual(['Mara', YOSEF, 'Harbour']);
    expect(picker.contentEl.withClass('spellbook-plotgrid-picker-group').map((group) => group.text)).toEqual(['Character', 'Place']);
    rows()[2]?.fire('click');
    rows()[1]?.fire('click');
    expect(rows().map((row) => row.attrs['aria-checked'])).toEqual(['false', 'true', 'true']);
    picker.close();
    await calm(s);
    expect(headersOf(pane)).toEqual(['Harbour', YOSEF]);
    expect(readPrefs(storage.load(PREFS_KEY)).chosen).toEqual({ [NOVEL_INDEX]: [HARBOUR_PATH, YOSEF_PATH] });
    // Unticked: the column goes.
    one(pane, 'spellbook-plotgrid-choose').fire('click');
    const again = StubModal.opened[StubModal.opened.length - 1] as unknown as EntityPickerModal & { contentEl: FakeElement };
    again.contentEl.withClass('spellbook-plotgrid-pick')[2]?.fire('click');
    await calm(s);
    expect(headersOf(pane)).toEqual([YOSEF]);
  });
});

describe('reading the grid', () => {
  it('opens a scene from its name', async () => {
    const s = await stage();
    const { pane } = await openGrid(s);
    one(sceneRow(pane, NIGHT_TITLE), 'spellbook-plotgrid-title').fire('click');
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(NIGHT), where: false }]);
    one(sceneRow(pane, 'Opening'), 'spellbook-plotgrid-title').fire('click', { metaKey: true });
    await calm(s);
    expect(s.opened[1]).toEqual({ path: inNovel(OPENING), where: 'tab' });
  });

  it('shows the synopsis as a tooltip, or on a second line when asked, and remembers that', async () => {
    const storage = new MemoryDeviceStorage();
    const s = await stage(undefined, { storage });
    const { pane } = await openGrid(s);
    expect(one(sceneRow(pane, NIGHT_TITLE), 'spellbook-plotgrid-title').attrs['title']).toBe(NIGHT_SYNOPSIS);
    expect(pane.withClass('spellbook-plotgrid-synopsis')).toEqual([]);
    one(pane, 'spellbook-plotgrid-synopsis-toggle').fire('click');
    await calm(s);
    const line = one(sceneRow(pane, NIGHT_TITLE), 'spellbook-plotgrid-synopsis');
    expect([line.text, line.attrs['dir']]).toEqual([NIGHT_SYNOPSIS, 'auto']);
    expect(pane.withClass('spellbook-plotgrid-synopsis')).toHaveLength(2);
    expect(one(pane, 'spellbook-plotgrid-synopsis-toggle').attrs['aria-pressed']).toBe('true');
    expect(readPrefs(storage.load(PREFS_KEY)).synopsisLine).toBe(true);
  });

  it('folds a folder, and remembers it for the project', async () => {
    const storage = new MemoryDeviceStorage();
    const s = await stage(undefined, { storage });
    const { pane } = await openGrid(s);
    one(pane, 'spellbook-plotgrid-fold').fire('click');
    await calm(s);
    expect(rowNames(pane)).toEqual(['Opening', '[Part one]', 'Middle', 'Ghost', 'Closing']);
    expect(one(pane, 'spellbook-plotgrid-fold').attrs['aria-expanded']).toBe('false');
    expect(countsOf(pane)).toEqual(['2', '1']); // the folded scenes still count
    expect(readPrefs(storage.load(PREFS_KEY)).folded).toEqual({ [NOVEL_INDEX]: ['f-one'] });
    one(pane, 'spellbook-plotgrid-folder-name').fire('click');
    await calm(s);
    expect(rowNames(pane)).toEqual(ALL_SCENES);
  });

  it('shades a long stretch of scenes a column is missing from, as long as the setting says', async () => {
    const storage = new MemoryDeviceStorage();
    const s = await stage(undefined, { storage });
    const { pane } = await openGrid(s);
    // Main plot: Opening, then four scenes without it (one has no note), then Closing. Five is the usual length.
    expect(pane.withClass(GAP_CLASS)).toEqual([]);
    const section = s.features.settingsSections[0];
    const container = new FakeElement();
    section?.render(container as unknown as HTMLElement);
    const text = (container.settings[0]?.components[0] as unknown as { type(value: string): void }) ?? null;
    text?.type('4');
    await calm(s);
    const shaded = pane.withClass(GAP_CLASS).map((cell) => cell.parent?.withClass('spellbook-plotgrid-title')[0]?.text ?? cell.parent?.parent?.withClass('spellbook-plotgrid-title')[0]?.text);
    expect(shaded).toEqual(['The Letter', NIGHT_TITLE, 'Middle', 'Ghost']);
    expect(pane.withClass('spellbook-plotgrid-coverage-gap')).toHaveLength(1);
    expect(readPrefs(storage.load(PREFS_KEY)).gapLength).toBe(4);
    text?.type('1'); // out of bounds: not taken
    expect(readPrefs(storage.load(PREFS_KEY)).gapLength).toBe(4);
  });

  it('says so in a read-only project', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(NOVEL_INDEX, (frontmatter) => {
      frontmatter['binder'] = { not: 'a list' };
    }, { silent: true });
    const s = await stage(vault);
    const { pane } = await openGrid(s);
    expect(s.store.project?.readOnly).toBe(true);
    expect(one(pane, 'spellbook-plotgrid-summary').text).toMatch(/read-only/);
    expect(s.vault.writes).toEqual([]);
  });

  it('goes narrow by the pane\'s measured width, not by the device', async () => {
    const s = await stage();
    const { view, pane } = await openGrid(s);
    const root = one(pane, 'spellbook-plotgrid');
    expect(root.hasClass('spellbook-is-narrow')).toBe(false);
    pane.clientWidth = 360;
    view.onResize();
    expect(root.hasClass('spellbook-is-narrow')).toBe(true);
    pane.clientWidth = 1200;
    view.onResize();
    expect(root.hasClass('spellbook-is-narrow')).toBe(false);
    expect(notices()).toEqual([]);
  });

  it('starts narrow on a phone', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    const s = await stage();
    const { pane } = await openGrid(s);
    const root = one(pane, 'spellbook-plotgrid');
    expect(root.hasClass('spellbook-is-narrow')).toBe(true);
    expect(root.hasClass('spellbook-is-mobile')).toBe(true);
  });
});
