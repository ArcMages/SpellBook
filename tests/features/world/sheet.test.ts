// The entity sheet, the pictures, the relations and the table, as they are
// plugged into the plugin: the real feature on a project store that sits on
// the tests' memory vault. What the screen shows is read from the stand-in
// screen; what it changes is read from the vault. What is checked hardest:
// an edit on the sheet writes that one property and nothing else, a note's
// text is never touched, and a relation is written into one note only.
// These tests cannot show how it looks: that needs Obsidian itself.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_KEY, UNREADABLE_FIELD_TEXT } from '../../../src/features/world/host';
import { ImagePickerModal, NO_IMAGES_TEXT } from '../../../src/features/world/imagePicker';
import { NOT_AN_ENTITY_TEXT } from '../../../src/features/world/index';
import { NO_PICTURE_CLASS, NO_PROJECT_TEXT } from '../../../src/features/world/parts';
import { RelationPickerModal } from '../../../src/features/world/relationModal';
import { MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Modal as StubModal, Notice as StubNotice, Platform, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import {
  LAMP,
  MARA,
  MARA_HE,
  MARA_HE_PATH,
  NOVEL_INDEX,
  OPENING,
  SALTWICK,
  answer,
  calm,
  cardNamed,
  inNovel,
  last,
  lastMenu,
  lastWindow,
  novelVault,
  one,
  openWorld,
  setWidth,
  typeInto,
  wire,
} from './stage';
import type { WireOptions, Wired } from './stage';

const stages: Wired[] = [];

async function stage(vault: MemoryVault = novelVault(), options: WireOptions = {}): Promise<Wired> {
  const made = await wire(vault, options);
  stages.push(made);
  return made;
}

beforeEach(() => {
  StubMenu.shown.length = 0;
  StubNotice.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
  resetPlatform();
});

afterEach(() => {
  for (const made of stages.splice(0)) made.switchOff();
  resetPlatform();
});

const PORTRAIT = 'Pictures/mara.png';
const HARBOUR = 'Pictures/Places/harbour.jpg';

/** The novel, with two pictures in the vault outside the project, and Saltwick already showing one of them. */
function pictureVault(): MemoryVault {
  const vault = novelVault();
  vault.seed(PORTRAIT, {});
  vault.seed(HARBOUR, {});
  vault.external.editFrontmatter(inNovel(SALTWICK), (frontmatter) => {
    frontmatter['image'] = '[[harbour.jpg]]';
  });
  return vault;
}

/** Open the browser and the sheet of the entity of this name, through the "Sheet" button on its card. */
async function sheetOf(s: Wired, name: string, width = 900): Promise<{ pane: FakeElement; sheet: () => FakeElement; root: FakeElement }> {
  const { pane } = await openWorld(s, width);
  one(cardNamed(pane, name), 'spellbook-world-card-sheet').fire('click');
  return { pane, sheet: () => one(pane, 'spellbook-world-detail'), root: one(pane, 'spellbook-world') };
}

/** The box of a property on the sheet. */
function box(sheet: FakeElement, name: string): FakeElement {
  const found = sheet.withClass('spellbook-world-box').filter((candidate) => candidate.getAttr('data-field') === name);
  if (found.length !== 1) throw new Error(`expected one box for "${name}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** Type into a box of the sheet and leave it, as a writer would. */
async function fill(s: Wired, field: FakeElement, text: string): Promise<void> {
  field.fire('focus');
  typeInto(field, text);
  field.fire('blur');
  field.fire('change');
  await calm(s);
}

/** The frames that show a picture (or an icon in its place) inside an element: [address of the picture or null, shows the icon]. */
function pictures(root: FakeElement): Array<[string | null, boolean]> {
  return root.withClass('spellbook-world-picture').map((frame) => [frame.withClass('spellbook-world-picture-img')[0]?.getAttr('src') ?? null, frame.hasClass(NO_PICTURE_CLASS)]);
}

/** The relations on a sheet, as a reader sees them: [name, label]. */
function relationsOn(sheet: FakeElement, cls = 'spellbook-world-relation'): Array<[string, string]> {
  return sheet
    .withClass(cls)
    .map((row) => [one(row, 'spellbook-world-relation-name').text, row.withClass('spellbook-world-relation-label')[0]?.text ?? '']);
}

describe('the sheet of one entity', () => {
  it('shows the picture\'s place, the name, the type, the other names, the summary, then every field of the type', async () => {
    const s = await stage();
    const { sheet, root, pane } = await sheetOf(s, 'Mara');
    expect(root.hasClass('spellbook-world-has-detail')).toBe(true);
    expect(cardNamed(pane, 'Mara').hasClass('is-selected')).toBe(true);
    expect(one(sheet(), 'spellbook-world-detail-name').text).toBe('Mara');
    expect(one(sheet(), 'spellbook-world-detail-type').text).toBe('Character');
    expect(one(sheet(), 'spellbook-world-detail-aliases').text).toBe('the keeper');
    expect(one(sheet(), 'spellbook-world-detail-summary').value).toBe('Keeps the light, and a secret.');
    expect(sheet().withClass('spellbook-world-field-name').map((name) => name.text)).toEqual([
      'role',
      'age',
      'occupation',
      'appearance',
      'personality',
      'voice',
      'goal',
      'arc',
    ]);
    expect(sheet().withClass('spellbook-world-field-box').map((field) => field.value)).toEqual(['Lighthouse keeper', '34', '', '', '', '', '', '']);
    // The parts of the sheet, in order: the picture and the words beside it, the summary, the fields, the rest.
    expect(sheet().children.map((child) => [...child.classes].find((cls) => /^spellbook-world-(detail-head|sheet-hero|detail-summary|fields|sheet-rest)$/.test(cls)))).toEqual([
      'spellbook-world-detail-head',
      'spellbook-world-sheet-hero',
      'spellbook-world-detail-summary',
      'spellbook-world-fields',
      'spellbook-world-sheet-rest',
    ]);
    expect(sheet().withClass('spellbook-world-section-head').map((head) => head.fullText)).toEqual(['Related 0 Add', 'Scenes 1']);
    // Showing a sheet reads no note's text and writes nothing.
    expect(s.vault.reads.readText).toBe(0);
    expect(s.vault.writes).toEqual([]);
  });

  it('lists the scenes in binder order, each with its synopsis, and the events with their date in the story', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
      frontmatter['synopsis'] = 'Mara lights the lamp\nover a quiet harbour.';
    });
    vault.external.editFrontmatter(inNovel('Timeline/The fire.md'), (frontmatter) => {
      frontmatter['end'] = '1890-03-04';
    });
    const s = await stage(vault);
    const { sheet } = await sheetOf(s, 'Saltwick');
    const rows = sheet().withClass('spellbook-world-appearance').map((row) => [one(row, 'spellbook-world-row-open').text, row.withClass('spellbook-world-row-note')[0]?.text ?? '']);
    expect(rows).toEqual([
      ['Opening', 'Mara lights the lamp over a quiet harbour.'],
      ['Closing', ''],
      ['The fire', '1890-03-01 to 1890-03-04'],
    ]);
    expect(one(sheet().withClass('spellbook-world-appearance')[0] as FakeElement, 'spellbook-world-row-note').getAttr('dir')).toBe('auto');
  });

  it('opens the note for the long text with "Open note"', async () => {
    const s = await stage();
    const { sheet } = await sheetOf(s, 'Mara');
    expect(one(sheet(), 'spellbook-world-open').text).toBe('Open note');
    one(sheet(), 'spellbook-world-open').fire('click');
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(MARA), where: false }]);
  });

  it('lays a Hebrew entity out from its own text: every piece of the writer\'s text chooses its direction', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(MARA_HE_PATH), (frontmatter) => {
      frontmatter['role'] = 'שומרת';
      frontmatter['aliases'] = ['השומרת'];
      frontmatter['related'] = ['[[Saltwick|גרה ב]]'];
    });
    const s = await stage(vault);
    const { sheet } = await sheetOf(s, MARA_HE);
    for (const cls of ['spellbook-world-detail-name', 'spellbook-world-detail-aliases', 'spellbook-world-detail-summary', 'spellbook-world-relation-label']) {
      expect(one(sheet(), cls).getAttr('dir'), cls).toBe('auto');
    }
    for (const field of sheet().withClass('spellbook-world-box')) expect(field.getAttr('dir')).toBe('auto');
    for (const name of sheet().withClass('spellbook-world-field-name')) expect(name.getAttr('dir')).toBe('auto');
    expect(box(sheet(), 'role').value).toBe('שומרת');
    expect(relationsOn(sheet())).toEqual([['Saltwick', 'גרה ב']]);
  });

  it('is a page of its own in a narrow pane, with a button that leads back; beside the list in a wide one', async () => {
    Platform.isMobile = true;
    Platform.isPhone = true;
    const s = await stage();
    const { pane, sheet, root } = await sheetOf(s, 'Mara', 380);
    expect(root.hasClass('spellbook-world-narrow')).toBe(true);
    expect(root.hasClass('spellbook-world-has-detail')).toBe(true);
    expect(root.hasClass('spellbook-is-phone')).toBe(true);
    const back = one(sheet(), 'spellbook-world-detail-back');
    expect(back.getAttr('aria-label')).toBe('Back to the list');
    // Turning the tablet makes the pane wide: the same button now closes the sheet, and what was typed stays.
    const role = box(sheet(), 'role');
    typeInto(role, 'Keeper of the light');
    setWidth({ pane, view: s.workspace.leaves[0]?.view as never, leaf: s.workspace.leaves[0] as never }, 900);
    expect(one(sheet(), 'spellbook-world-detail-back').getAttr('aria-label')).toBe('Close the sheet');
    expect(box(sheet(), 'role')).toBe(role);
    expect(role.value).toBe('Keeper of the light');
    one(sheet(), 'spellbook-world-detail-back').fire('click');
    expect(root.hasClass('spellbook-world-has-detail')).toBe(false);
    expect(sheet().children).toEqual([]);
  });

  it('is opened for the note in the editor by "Open entity sheet", and says so for a note that is no entity', async () => {
    const s = await stage();
    s.activate(inNovel(SALTWICK));
    s.command('open-entity-sheet').callback?.();
    await calm(s);
    const pane = (s.workspace.leaves[0]?.view as unknown as { contentEl: FakeElement }).contentEl;
    expect(one(one(pane, 'spellbook-world-detail'), 'spellbook-world-detail-name').text).toBe('Saltwick');
    expect(s.workspace.leaves).toHaveLength(1);
    // The browser is open already: the sheet changes in place.
    s.activate(inNovel(LAMP));
    s.command('open-entity-sheet').callback?.();
    await calm(s);
    expect(one(one(pane, 'spellbook-world-detail'), 'spellbook-world-detail-name').text).toBe('Lamp');
    expect(s.workspace.leaves).toHaveLength(1);

    for (const path of [inNovel(OPENING), 'Notes/Plain.md', null]) {
      s.activate(path);
      s.command('open-entity-sheet').callback?.();
      await calm(s);
      expect(last(StubNotice.shown).message, String(path)).toBe(NOT_AN_ENTITY_TEXT);
    }
    expect(one(one(pane, 'spellbook-world-detail'), 'spellbook-world-detail-name').text).toBe('Lamp');
    expect(s.vault.writes).toEqual([]);

    const none = await stage(novelVault(), { open: null });
    none.activate(inNovel(SALTWICK));
    none.command('open-entity-sheet').callback?.();
    expect(last(StubNotice.shown).message).toBe(NO_PROJECT_TEXT);
    expect(none.workspace.leaves).toEqual([]);
  });

  it('shows what there is and nothing to type in when the project is read-only', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(NOVEL_INDEX, (frontmatter) => {
      frontmatter['binder'] = { not: 'a list' };
    }, { silent: true });
    const s = await stage(vault);
    const { sheet } = await sheetOf(s, 'Mara');
    expect(sheet().withClass('spellbook-world-box')).toEqual([]);
    expect(one(sheet(), 'spellbook-world-detail-summary').text).toBe('Keeps the light, and a secret.');
    expect(sheet().withClass('spellbook-world-field-name').map((name) => name.text)).toEqual(['role', 'age']);
    expect(sheet().withClass('spellbook-world-field-value').map((value) => value.text)).toEqual(['Lighthouse keeper', '34']);
    for (const cls of ['spellbook-world-choose-picture', 'spellbook-world-remove-picture', 'spellbook-world-relate', 'spellbook-world-row-unlink']) {
      expect(sheet().withClass(cls), cls).toEqual([]);
    }
    expect(one(sheet(), 'spellbook-world-open').text).toBe('Open note');
  });
});

describe('changing a field on the sheet', () => {
  const MARA_BEFORE = {
    type: 'character',
    role: 'Lighthouse keeper',
    age: 34,
    appearance: '',
    goal: '',
    summary: 'Keeps the light, and a secret.',
    aliases: ['the keeper'],
  };
  const MARA_BODY = '## Description\n\nHer story so far.\n';

  it('saves that one property when the box is left, as a change of the note\'s properties and never of its text', async () => {
    const s = await stage();
    const { sheet } = await sheetOf(s, 'Mara');
    await fill(s, box(sheet(), 'role'), '  Keeper of   the old light ');
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(MARA) }]);
    expect(s.vault.frontmatterOf(inNovel(MARA))).toEqual({ ...MARA_BEFORE, role: 'Keeper of the old light' });
    // The order of the properties is as it was, and so is the note's text.
    expect(Object.keys(s.vault.frontmatterOf(inNovel(MARA)) ?? {})).toEqual(Object.keys(MARA_BEFORE));
    expect(s.vault.bodyOf(inNovel(MARA))).toBe(MARA_BODY);
    expect(s.vault.reads.readText).toBe(0);
  });

  it('fills in a field the note does not have yet, and no other', async () => {
    const s = await stage();
    const { sheet } = await sheetOf(s, 'Mara');
    await fill(s, box(sheet(), 'voice'), 'Low, and never in a hurry.');
    expect(s.vault.frontmatterOf(inNovel(MARA))).toEqual({ ...MARA_BEFORE, voice: 'Low, and never in a hurry.' });
    expect(box(sheet(), 'voice').value).toBe('Low, and never in a hurry.');
  });

  it('saves the summary the same way, and the card follows', async () => {
    const s = await stage();
    const { pane, sheet } = await sheetOf(s, 'Lamp');
    expect(cardNamed(pane, 'Lamp').withClass('spellbook-world-card-summary')).toEqual([]);
    await fill(s, one(sheet(), 'spellbook-world-detail-summary'), 'Brass, and older than the tower.');
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(LAMP) }]);
    expect(s.vault.frontmatterOf(inNovel(LAMP))).toEqual({ type: 'item', kind: 'Lamp', owner: 'Mara', summary: 'Brass, and older than the tower.' });
    expect(one(cardNamed(pane, 'Lamp'), 'spellbook-world-card-summary').text).toBe('Brass, and older than the tower.');
  });

  it('keeps a number a number, empties a field without taking its key away, and writes nothing for the same text', async () => {
    const s = await stage();
    const { sheet } = await sheetOf(s, 'Mara');
    await fill(s, box(sheet(), 'age'), '35');
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['age']).toBe(35);
    await fill(s, box(sheet(), 'age'), 'about forty');
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['age']).toBe('about forty');
    await fill(s, box(sheet(), 'role'), '');
    expect(s.vault.frontmatterOf(inNovel(MARA))).toEqual({ ...MARA_BEFORE, age: 'about forty', role: '' });
    s.vault.clearWrites();
    await fill(s, box(sheet(), 'role'), '   ');
    await fill(s, box(sheet(), 'age'), 'about  forty');
    expect(s.vault.writes).toEqual([]);
  });

  it('saves on Enter, and puts back what the note says on Escape', async () => {
    const s = await stage();
    const { sheet } = await sheetOf(s, 'Saltwick');
    const kind = box(sheet(), 'kind');
    kind.fire('focus');
    typeInto(kind, 'Fishing town');
    const enter = kind.fire('keydown', { key: 'Enter' });
    expect(enter.defaultPrevented).toBe(true); // one line of text: no new line is started
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(SALTWICK))?.['kind']).toBe('Fishing town');
    // An Enter that belongs to an input method is part of typing.
    typeInto(kind, 'Fishing town, once');
    kind.fire('keydown', { key: 'Enter', isComposing: true });
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(SALTWICK))?.['kind']).toBe('Fishing town');
    kind.fire('keydown', { key: 'Escape' });
    expect(kind.value).toBe('Fishing town');
    kind.fire('blur');
    await calm(s);
    expect(s.vault.writes).toHaveLength(1);
  });

  it('keeps the box that is being typed in, and what is typed in it, while the rest of the sheet follows the vault', async () => {
    const s = await stage();
    const { sheet } = await sheetOf(s, 'Saltwick');
    const kind = box(sheet(), 'kind');
    const region = box(sheet(), 'region');
    kind.fire('focus');
    typeInto(kind, 'Fishing to');
    // Another device changes the note in the meantime: its region, and the field being typed in.
    s.vault.external.editFrontmatter(inNovel(SALTWICK), (frontmatter) => {
      frontmatter['region'] = 'East coast';
      frontmatter['kind'] = 'Port';
    });
    await calm(s);
    expect(box(sheet(), 'kind')).toBe(kind); // the very same box: the keyboard stays up
    expect(kind.value).toBe('Fishing to');
    expect(box(sheet(), 'region')).toBe(region);
    expect(region.value).toBe('East coast');
    // What the writer typed is saved when they are done.
    typeInto(kind, 'Fishing town');
    kind.fire('blur');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(SALTWICK))).toMatchObject({ kind: 'Fishing town', region: 'East coast' });
  });

  it('shows a property the writer added, and leaves a list to the note itself', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['eyes'] = 'grey';
      frontmatter['languages'] = ['English', 'Hebrew'];
    });
    const s = await stage(vault);
    const { sheet } = await sheetOf(s, 'Mara');
    expect(sheet().withClass('spellbook-world-field-name').map((name) => name.text).slice(-2)).toEqual(['eyes', 'languages']);
    await fill(s, box(sheet(), 'eyes'), 'grey-green');
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['eyes']).toBe('grey-green');
    // A list is shown, not typed in.
    expect(sheet().withClass('spellbook-world-box').map((field) => field.getAttr('data-field'))).not.toContain('languages');
    expect(sheet().withClass('spellbook-world-field-value').map((value) => value.text)).toContain('English, Hebrew');
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['languages']).toEqual(['English', 'Hebrew']);
  });

  it('says so, and changes nothing, when the property became a list on another device in the meantime', async () => {
    const s = await stage();
    const { sheet } = await sheetOf(s, 'Saltwick');
    const kind = box(sheet(), 'kind');
    kind.fire('focus');
    typeInto(kind, 'Fishing town');
    s.vault.external.editFrontmatter(inNovel(SALTWICK), (frontmatter) => {
      frontmatter['kind'] = ['Harbour', 'Town'];
    });
    kind.fire('blur');
    await calm(s);
    expect(last(StubNotice.shown).message).toBe(UNREADABLE_FIELD_TEXT);
    expect(s.vault.frontmatterOf(inNovel(SALTWICK))?.['kind']).toEqual(['Harbour', 'Town']);
    expect(s.vault.writes).toEqual([]);
  });
});

describe('a picture', () => {
  it('shows on the card and on the sheet; an entity without one shows the icon of its type in both', async () => {
    const s = await stage(pictureVault());
    const { pane, sheet } = await sheetOf(s, 'Saltwick');
    const address = s.vault.resourceUrl(HARBOUR);
    expect(pictures(cardNamed(pane, 'Saltwick'))).toEqual([[address, false]]);
    expect(pictures(one(sheet(), 'spellbook-world-sheet-hero'))).toEqual([[address, false]]);
    expect(one(sheet(), 'spellbook-world-sheet-picture').withClass('spellbook-world-picture-img')[0]?.getAttr('alt')).toBe('');
    // Mara has none: the icon of a character, in the colour of the type.
    const card = one(cardNamed(pane, 'Mara'), 'spellbook-world-card-picture');
    expect(pictures(cardNamed(pane, 'Mara'))).toEqual([[null, true]]);
    expect(one(card, 'spellbook-world-badge').icon).toBe('user');
    expect(card.hasClass('spellbook-world-color-blue')).toBe(true);
    one(cardNamed(pane, 'Mara'), 'spellbook-world-card-sheet').fire('click');
    expect(pictures(one(sheet(), 'spellbook-world-sheet-hero'))).toEqual([[null, true]]);
    expect(one(one(sheet(), 'spellbook-world-sheet-picture'), 'spellbook-world-badge').icon).toBe('user');
    expect(sheet().withClass('spellbook-world-remove-picture')).toEqual([]);
  });

  it('that is missing, or is not a picture, shows the icon instead; and so does one that turns out not to load', async () => {
    const vault = pictureVault();
    vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['image'] = '[[gone.png]]';
    });
    vault.external.editFrontmatter(inNovel(LAMP), (frontmatter) => {
      frontmatter['image'] = '[[Plain]]';
    });
    const s = await stage(vault);
    const { pane, sheet } = await sheetOf(s, 'Mara');
    expect(pictures(cardNamed(pane, 'Mara'))).toEqual([[null, true]]);
    expect(pictures(cardNamed(pane, 'Lamp'))).toEqual([[null, true]]);
    expect(pictures(one(sheet(), 'spellbook-world-sheet-hero'))).toEqual([[null, true]]);
    // What the note names can still be taken away.
    expect(one(sheet(), 'spellbook-world-remove-picture').text).toBe('Remove picture');

    // A file that is there but broken: the image element says it could not be shown.
    const frame = one(cardNamed(pane, 'Saltwick'), 'spellbook-world-card-picture');
    expect(pictures(frame)).toEqual([[s.vault.resourceUrl(HARBOUR), false]]);
    one(frame, 'spellbook-world-picture-img').fire('error');
    expect(pictures(frame)).toEqual([[null, true]]);
    expect(one(frame, 'spellbook-world-badge').icon).toBe('map-pin');
  });

  it('is chosen from the pictures of the vault in a list to search, and written as a bare link in "image"', async () => {
    const s = await stage(pictureVault());
    const { pane, sheet } = await sheetOf(s, 'Mara');
    expect(one(sheet(), 'spellbook-world-choose-picture').text).toBe('Choose picture');
    one(sheet(), 'spellbook-world-choose-picture').fire('click');
    const picker = lastWindow();
    expect(picker).toBeInstanceOf(ImagePickerModal);
    expect(picker.titleEl.text).toBe('Picture of Mara');
    const names = (): string[] => picker.contentEl.withClass('spellbook-world-picker-image').map((row) => one(row, 'spellbook-world-picker-name').text);
    expect(names()).toEqual(['harbour.jpg', 'mara.png']);
    expect(picker.contentEl.withClass('spellbook-world-picker-summary').map((folder) => folder.text)).toEqual(['Pictures/Places', 'Pictures']);
    typeInto(one(picker.contentEl, 'spellbook-world-picker-input'), 'MARA');
    expect(names()).toEqual(['mara.png']);
    expect(s.vault.writes).toEqual([]); // nothing before a picture is tapped
    picker.contentEl.withClass('spellbook-world-picker-image')[0]?.fire('click');
    await calm(s);

    expect(picker.isOpen).toBe(false);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(MARA) }]);
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['image']).toBe('[[mara.png]]');
    expect(Object.keys(s.vault.frontmatterOf(inNovel(MARA)) ?? {})).toEqual(['type', 'role', 'age', 'appearance', 'goal', 'summary', 'aliases', 'image']);
    expect(s.vault.bodyOf(inNovel(MARA))).toBe('## Description\n\nHer story so far.\n');
    // The picture itself was not touched, and nothing was copied into the project.
    expect(s.vault.paths().filter((path) => path.endsWith('.png'))).toEqual([PORTRAIT]);
    const address = s.vault.resourceUrl(PORTRAIT);
    expect(pictures(one(sheet(), 'spellbook-world-sheet-hero'))).toEqual([[address, false]]);
    expect(pictures(cardNamed(pane, 'Mara'))).toEqual([[address, false]]);
  });

  it('is taken away with "Remove picture": the property goes, the file stays', async () => {
    const s = await stage(pictureVault());
    const { sheet } = await sheetOf(s, 'Saltwick');
    one(sheet(), 'spellbook-world-remove-picture').fire('click');
    await calm(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(SALTWICK) }]);
    expect(s.vault.frontmatterOf(inNovel(SALTWICK))).toEqual({ type: 'place', kind: 'Harbour town', region: 'North coast', summary: 'Fog, salt and gulls.' });
    expect(s.vault.has(HARBOUR)).toBe(true);
    expect(s.vault.trashed).toEqual([]);
    expect(pictures(one(sheet(), 'spellbook-world-sheet-hero'))).toEqual([[null, true]]);
    expect(sheet().withClass('spellbook-world-remove-picture')).toEqual([]);
  });

  it('says so when the vault has no pictures, and takes the first row on Enter', async () => {
    const empty = await stage();
    const first = await sheetOf(empty, 'Mara');
    one(first.sheet(), 'spellbook-world-choose-picture').fire('click');
    expect(one(lastWindow().contentEl, 'spellbook-world-picker-note').text).toBe(NO_IMAGES_TEXT);
    lastWindow().close();

    const s = await stage(pictureVault());
    const { sheet } = await sheetOf(s, 'Lamp');
    one(sheet(), 'spellbook-world-choose-picture').fire('click');
    const input = one(lastWindow().contentEl, 'spellbook-world-picker-input');
    typeInto(input, 'harbour');
    input.fire('keydown', { key: 'Enter' });
    await calm(s);
    // Saltwick names the same picture by its name alone, and so can the lamp.
    expect(s.vault.frontmatterOf(inNovel(LAMP))?.['image']).toBe('[[harbour.jpg]]');
  });
});

describe('relations', () => {
  it('are added from a list to search, with a label, as one link in "related" of this note only', async () => {
    const s = await stage();
    const { sheet } = await sheetOf(s, 'Mara');
    one(sheet(), 'spellbook-world-relate').fire('click');
    const picker = lastWindow();
    expect(picker).toBeInstanceOf(RelationPickerModal);
    expect(picker.titleEl.text).toBe('Related to Mara');
    const names = (): string[] => picker.contentEl.withClass('spellbook-world-picker-entity').map((row) => one(row, 'spellbook-world-picker-name').text);
    // Everything in the world but Mara herself.
    expect(names()).toEqual(['Lamp', 'Saltwick', MARA_HE]);
    typeInto(one(picker.contentEl, 'spellbook-world-relation-search'), 'salt');
    expect(names()).toEqual(['Saltwick']);
    typeInto(one(picker.contentEl, 'spellbook-world-relation-label-box'), ' keeps the light of ');
    picker.contentEl.withClass('spellbook-world-picker-entity')[0]?.fire('click');
    await calm(s);

    expect(picker.isOpen).toBe(false);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(MARA) }]);
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['related']).toEqual(['[[Saltwick|keeps the light of]]']);
    expect(Object.keys(s.vault.frontmatterOf(inNovel(MARA)) ?? {})).toEqual(['type', 'role', 'age', 'appearance', 'goal', 'summary', 'aliases', 'related']);
    // Nothing is written into the other note.
    expect(s.vault.frontmatterOf(inNovel(SALTWICK))).toEqual({ type: 'place', kind: 'Harbour town', region: 'North coast', summary: 'Fog, salt and gulls.' });
    expect(relationsOn(sheet())).toEqual([['Saltwick', 'keeps the light of']]);
    expect(sheet().withClass('spellbook-world-section-head')[0]?.fullText).toBe('Related 1 Add');
  });

  it('are listed in groups by the other entity\'s type, and without a label when none was given', async () => {
    const s = await stage();
    const { sheet } = await sheetOf(s, 'Mara');
    for (const [search, label] of [['Lamp', 'carries'], ['Saltwick', ''], [MARA_HE, 'namesake']] as const) {
      one(sheet(), 'spellbook-world-relate').fire('click');
      typeInto(one(lastWindow().contentEl, 'spellbook-world-relation-label-box'), label);
      const input = one(lastWindow().contentEl, 'spellbook-world-relation-search');
      typeInto(input, search);
      input.fire('keydown', { key: 'Enter' }); // Enter takes the first row
      await calm(s);
    }
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['related']).toEqual(['[[Lamp|carries]]', '[[Saltwick]]', `[[${MARA_HE}|namesake]]`]);
    expect(sheet().withClass('spellbook-world-relation-type').map((head) => head.fullText)).toEqual(['Characters', 'Places', 'Items']);
    expect(relationsOn(sheet())).toEqual([
      [MARA_HE, 'namesake'],
      ['Saltwick', ''],
      ['Lamp', 'carries'],
    ]);
    // What is related already is not offered again.
    one(sheet(), 'spellbook-world-relate').fire('click');
    expect(lastWindow().contentEl.withClass('spellbook-world-picker-entity')).toEqual([]);
    expect(one(lastWindow().contentEl, 'spellbook-world-picker-note').text).toMatch(/related to everything/);
  });

  it('show on the other side too, as "Mentioned by", with nothing written there', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['related'] = ['[[Saltwick|keeps the light of]]'];
    });
    vault.external.editFrontmatter(inNovel(LAMP), (frontmatter) => {
      frontmatter['related'] = ['[[Saltwick]] | hangs in'];
    });
    const s = await stage(vault);
    const { sheet } = await sheetOf(s, 'Saltwick');
    expect(sheet().withClass('spellbook-world-relation-side').map((head) => head.text)).toEqual(['Mentioned by']);
    expect(relationsOn(sheet(), 'spellbook-world-relation-back')).toEqual([
      ['Mara', 'keeps the light of'],
      ['Lamp', 'hangs in'],
    ]);
    expect(sheet().withClass('spellbook-world-section-head')[0]?.fullText).toBe('Related 2 Add');
    // The other side reads; it has nothing to change or remove.
    expect(sheet().withClass('spellbook-world-relation-edit')).toEqual([]);
    expect(sheet().withClass('spellbook-world-relation-remove')).toEqual([]);
    expect(s.vault.frontmatterOf(inNovel(SALTWICK))).not.toHaveProperty('related');
    expect(s.vault.writes).toEqual([]);
    // A tap on a name shows that entity's sheet.
    sheet().withClass('spellbook-world-relation-open')[0]?.fire('click');
    expect(one(sheet(), 'spellbook-world-detail-name').text).toBe('Mara');
    expect(relationsOn(sheet())).toEqual([['Saltwick', 'keeps the light of']]);
  });

  it('get another label, or none, and the link stays as it is written', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['related'] = ['[[Saltwick]] | lives in', '[[Lamp|carries]]'];
    });
    const s = await stage(vault);
    const { sheet } = await sheetOf(s, 'Mara');
    expect(relationsOn(sheet())).toEqual([
      ['Saltwick', 'lives in'],
      ['Lamp', 'carries'],
    ]);
    sheet().withClass('spellbook-world-relation-edit')[0]?.fire('click');
    expect(lastWindow().titleEl.text).toBe('Mara and Saltwick');
    expect(one(lastWindow().contentEl, 'spellbook-prompt-input').value).toBe('lives in');
    await answer(s, 'keeps the light of');
    // What was typed by hand is written as one link from now on; the other entry is as it was.
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['related']).toEqual(['[[Saltwick|keeps the light of]]', '[[Lamp|carries]]']);
    sheet().withClass('spellbook-world-relation-edit')[1]?.fire('click');
    await answer(s, '');
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['related']).toEqual(['[[Saltwick|keeps the light of]]', '[[Lamp]]']);
    expect(new Set(s.vault.writes.map((write) => write.path))).toEqual(new Set([inNovel(MARA)]));
  });

  it('are removed one at a time, and the list goes with its last entry', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['related'] = ['[[Saltwick|lives in]]', '[[Nobody|friend]]'];
    });
    const s = await stage(vault);
    const { sheet } = await sheetOf(s, 'Mara');
    // A link that leads to no entity is shown as such, and can be removed like any other.
    expect(relationsOn(sheet())).toEqual([
      ['Saltwick', 'lives in'],
      ['Nobody', 'friend (not in this project)'],
    ]);
    expect(sheet().withClass('spellbook-world-relation-lost')).toHaveLength(1);
    sheet().withClass('spellbook-world-relation-remove')[0]?.fire('click');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['related']).toEqual(['[[Nobody|friend]]']);
    sheet().withClass('spellbook-world-relation-remove')[0]?.fire('click');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(MARA))).not.toHaveProperty('related');
    expect(s.vault.trashed).toEqual([]);
    expect(s.vault.has(inNovel(SALTWICK))).toBe(true);
  });

  it('keep working when the other entity is renamed (the vault rewrites the link, as Obsidian does)', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['related'] = ['[[Lamp|carries]]'];
    });
    const s = await stage(vault);
    const { pane, sheet } = await sheetOf(s, 'Mara');
    one(cardNamed(pane, 'Lamp'), 'spellbook-world-card-more').fire('click');
    lastMenu().item('Rename').click();
    await answer(s, 'Brass lamp');
    // Obsidian rewrites a link in a property when the note it leads to is renamed, and keeps the name it shows.
    s.vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['related'] = ['[[Brass lamp|carries]]'];
    });
    await calm(s);
    expect(relationsOn(sheet())).toEqual([['Brass lamp', 'carries']]);
  });
});

describe('cards and list', () => {
  it('shows one or two key facts on a card, by type: a character\'s role, a place\'s kind and region', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    const facts = (name: string): string[] => cardNamed(pane, name).withClass('spellbook-world-card-fact').map((fact) => fact.text);
    expect(facts('Mara')).toEqual(['Lighthouse keeper']);
    expect(facts('Saltwick')).toEqual(['Harbour town', 'North coast']);
    expect(facts('Lamp')).toEqual(['Lamp', 'Mara']);
    expect(facts(MARA_HE)).toEqual([]);
    expect(cardNamed(pane, 'Saltwick').withClass('spellbook-world-card-fact')[0]?.getAttr('dir')).toBe('auto');
  });

  it('switches to a table of name, type, kind and scenes, and back', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    const root = one(pane, 'spellbook-world');
    const pressed = (): Array<[string, string | null]> => pane.withClass('spellbook-world-layout-button').map((button) => [button.text, button.getAttr('aria-pressed')]);
    expect(pressed()).toEqual([['Cards', 'true'], ['List', 'false']]);
    one(pane, 'spellbook-world-layout-list').fire('click');
    expect(pressed()).toEqual([['Cards', 'false'], ['List', 'true']]);
    expect(root.hasClass('spellbook-world-as-list')).toBe(true);
    expect(pane.withClass('spellbook-world-card')).toEqual([]);
    expect(pane.withClass('spellbook-world-table-sort').map((heading) => heading.text)).toEqual(['Name', 'Type', 'Kind', 'From', 'Until', 'Scenes']);
    expect(tableOf(pane)).toEqual([
      // No entity of this small novel has a date: the two columns for them are empty.
      ['Lamp', 'Item', 'Lamp', '', '', '0'],
      ['Mara', 'Character', 'Lighthouse keeper', '', '', '1'],
      ['Saltwick', 'Place', 'Harbour town', '', '', '2'],
      [MARA_HE, 'Character', '', '', '', '0'],
    ]);
    one(pane, 'spellbook-world-layout-cards').fire('click');
    expect(pane.withClass('spellbook-world-table')).toEqual([]);
    expect(pane.withClass('spellbook-world-card')).toHaveLength(4);
    expect(s.vault.writes).toEqual([]);
  });

  it('sorts by the column whose heading is tapped, and the other way round on a second tap', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(pane, 'spellbook-world-layout-list').fire('click');
    const names = (): string[] => tableOf(pane).map((row) => row[0] as string);
    const sortBy = (title: string): void => {
      pane.withClass('spellbook-world-table-sort').find((heading) => heading.text === title)?.fire('click');
    };
    const sorted = (): Array<string | null> => pane.withClass('spellbook-world-table-head')[0]?.children.map((cell) => cell.getAttr('aria-sort')) ?? [];
    expect(sorted()).toEqual(['ascending', 'none', 'none', 'none', 'none', 'none']);
    sortBy('Name');
    expect(names()).toEqual([MARA_HE, 'Saltwick', 'Mara', 'Lamp']);
    expect(sorted()).toEqual(['descending', 'none', 'none', 'none', 'none', 'none']);
    sortBy('Scenes');
    expect(names()).toEqual(['Lamp', MARA_HE, 'Mara', 'Saltwick']);
    sortBy('Scenes');
    expect(names()).toEqual(['Saltwick', 'Mara', 'Lamp', MARA_HE]);
    expect(sorted()).toEqual(['none', 'none', 'none', 'none', 'none', 'descending']);
    // By type: in the order of the list of types.
    sortBy('Type');
    expect(names()).toEqual(['Mara', MARA_HE, 'Saltwick', 'Lamp']);
    // By kind: a row with none comes last, whichever way.
    sortBy('Kind');
    expect(names()).toEqual(['Saltwick', 'Lamp', 'Mara', MARA_HE]);
    sortBy('Kind');
    expect(names()).toEqual(['Mara', 'Lamp', 'Saltwick', MARA_HE]);
  });

  it('searches and filters the table like the cards, and shows the sheet on a tap of a row', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(pane, 'spellbook-world-layout-list').fire('click');
    typeInto(one(pane, 'spellbook-world-search'), 'keeper');
    expect(tableOf(pane).map((row) => row[0])).toEqual(['Mara']);
    typeInto(one(pane, 'spellbook-world-search'), '');
    const filter = one(pane, 'spellbook-world-filter');
    filter.value = 'character';
    filter.fire('change');
    expect(tableOf(pane).map((row) => row[0])).toEqual(['Mara', MARA_HE]);
    filter.value = 'lore';
    filter.fire('change');
    expect(pane.withClass('spellbook-world-table')).toEqual([]);
    expect(one(pane, 'spellbook-world-message').text).toBe('None yet.');
    filter.value = '';
    filter.fire('change');

    const row = pane.withClass('spellbook-world-table-entity').find((candidate) => candidate.getAttr('data-path') === MARA_HE_PATH) as FakeElement;
    expect(one(row.withClass('spellbook-world-table-name')[0] as FakeElement, 'spellbook-world-table-text').getAttr('dir')).toBe('auto');
    row.fire('click');
    expect(one(one(pane, 'spellbook-world-detail'), 'spellbook-world-detail-name').text).toBe(MARA_HE);
    expect(s.opened).toEqual([]);
    // With the usual key held: the note, in a new tab.
    pane.withClass('spellbook-world-table-entity')[0]?.fire('click', { metaKey: true });
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(LAMP), where: 'tab' }]);
  });

  it('remembers cards or list on this device, and nowhere else', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    expect(s.storage.saves).toEqual([]);
    one(pane, 'spellbook-world-layout-list').fire('click');
    one(pane, 'spellbook-world-layout-list').fire('click'); // already so: nothing to save
    expect(s.storage.saves).toEqual([[LAYOUT_KEY, 'list']]);
    expect(LAYOUT_KEY).toBe('spellbook-world-layout');
    expect(s.vault.writes).toEqual([]);

    // The next time Obsidian starts on this device, the browser opens as a list.
    const again = await wire(novelVault());
    stages.push(again);
    again.storage.save(LAYOUT_KEY, 'list');
    const reopened = await openWorld(again);
    expect(reopened.pane.withClass('spellbook-world-table')).toHaveLength(1);
    // Whatever else is found there is not trusted: cards.
    const odd = await wire(novelVault());
    stages.push(odd);
    odd.storage.save(LAYOUT_KEY, 'gallery');
    expect((await openWorld(odd)).pane.withClass('spellbook-world-card')).toHaveLength(4);
    // A storage that fails is ignored: the choice then lasts until Obsidian closes.
    const broken = await wire(novelVault());
    stages.push(broken);
    broken.storage.broken = true;
    const shown = await openWorld(broken);
    one(shown.pane, 'spellbook-world-layout-list').fire('click');
    expect(shown.pane.withClass('spellbook-world-table')).toHaveLength(1);
  });
});

/** The rows of the table as a reader sees them: [name, type, kind, scenes]. */
function tableOf(pane: FakeElement): string[][] {
  return pane.withClass('spellbook-world-table-entity').map((row) => row.withClass('spellbook-world-table-text').map((cell) => cell.text));
}
