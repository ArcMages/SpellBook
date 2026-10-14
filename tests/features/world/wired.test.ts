// World-building as it is plugged into the plugin: the real feature on a
// project store that sits on the tests' memory vault. What the browser shows
// is read from the stand-in screen; what it changes is read from the vault.
// These tests cannot show how it looks: that needs Obsidian itself.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCENE_ENTITIES_SERVICE } from '../../../src/core/world';
import type { SceneEntitiesService } from '../../../src/core/world';
import { WORLD_COMMANDS, WORLD_RIBBON_TITLE } from '../../../src/features/world/index';
import { EntityPickerModal, PICKER_ALL_LISTED_TEXT } from '../../../src/features/world/pickerModal';
import { EntityTypesModal } from '../../../src/features/world/typesModal';
import {
  FIND_MENTIONS_TEXT,
  LINK_SCENE_TEXT,
  NOTHING_FOUND_TEXT,
  NO_ENTITIES_TEXT,
  NO_MENTIONS_TEXT,
  WORLD_VIEW_TYPE,
} from '../../../src/features/world/worldView';
import { NO_PROJECT_TEXT, READ_ONLY_TEXT } from '../../../src/features/world/parts';
import { MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Modal as StubModal, Notice as StubNotice, Platform, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import { seedProject } from '../../storeHarness';
import {
  CLOSING,
  FIRE,
  LAMP,
  LETTER,
  MARA,
  MARA_HE,
  MARA_HE_PATH,
  MARA_HE_SUMMARY,
  NIGHT,
  NIGHT_TITLE,
  NOVEL_INDEX,
  OPENING,
  SALTWICK,
  answer,
  calm,
  cardNamed,
  confirmIn,
  groupsOf,
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
import type { OpenWindow, WireOptions, Wired } from './stage';

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

const service = (s: Wired): SceneEntitiesService => {
  const found = s.features.services.get<SceneEntitiesService>(SCENE_ENTITIES_SERVICE);
  if (!found) throw new Error('no service');
  return found;
};

/** The writer's own text on show: every element with this text lets it choose its direction. */
function directionOf(root: FakeElement, text: string): Array<string | null> {
  return root
    .all()
    .filter((element) => element.text === text)
    .map((element) => element.getAttr('dir'));
}

describe('plugging in', () => {
  it('registers the pane, ten commands and a ribbon button, and offers the inspector its service', async () => {
    const s = await stage();
    expect(s.plugin.viewTypes).toEqual([WORLD_VIEW_TYPE]);
    expect(WORLD_VIEW_TYPE).toBe('spellbook-world');
    expect(s.plugin.commands.map((command) => [command.id, command.name])).toEqual([
      ['open-world', 'Open world'],
      ['open-entity-sheet', 'Open entity sheet'],
      ['new-character', 'New character'],
      ['new-place', 'New place'],
      ['new-faction', 'New faction'],
      ['new-item', 'New item'],
      ['new-lore', 'New lore'],
      ['new-creature', 'New creature'],
      ['new-culture', 'New culture'],
      ['new-entity', 'New entity'],
    ]);
    expect(Object.values(WORLD_COMMANDS)).toHaveLength(10);
    expect(s.plugin.ribbonIcons.map((icon) => icon.title)).toEqual([WORLD_RIBBON_TITLE]);
    expect(s.features.services.get(SCENE_ENTITIES_SERVICE)).toBeDefined();
    // Plugging in opens nothing, writes nothing and reads no note.
    expect(s.workspace.leaves).toEqual([]);
    expect(s.vault.writes).toEqual([]);
    expect(s.vault.reads.readText).toBe(0);
    expect(s.storage.saves).toEqual([]);
  });

  it('opens one browser, however often it is asked for, as a tab in the main area', async () => {
    const s = await stage();
    s.command('open-world').callback?.();
    s.command('open-world').callback?.();
    await calm(s);
    s.plugin.ribbonIcons[0]?.callback({});
    await calm(s);
    expect(s.workspace.getLeavesOfType(WORLD_VIEW_TYPE)).toHaveLength(1);
    expect(s.workspace.leavesAskedFor).toEqual(['tab']);
  });

  it('lets go of everything when the plugin is switched off', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    expect(pane.withClass('spellbook-world-card').length).toBeGreaterThan(0);
    s.switchOff();
    expect(s.features.services.get(SCENE_ENTITIES_SERVICE)).toBeUndefined();
    expect(pane.children).toEqual([]);
    expect(pane.hasClass('spellbook-world-pane')).toBe(false);
    s.command('open-world').callback?.();
    s.command('new-character').callback?.();
    await calm(s);
    expect(StubModal.opened).toEqual([]);
    expect(s.vault.writes).toEqual([]);
  });
});

describe('the browser', () => {
  it('shows the entities as cards in groups by type, each with its summary and the number of scenes it is in', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    expect(groupsOf(pane)).toEqual([
      ['Characters', '2', ['Mara', MARA_HE]],
      ['Places', '1', ['Saltwick']],
      ['Items', '1', ['Lamp']],
    ]);
    const mara = cardNamed(pane, 'Mara');
    expect(one(mara, 'spellbook-world-card-summary').text).toBe('Keeps the light, and a secret.');
    expect(one(mara, 'spellbook-world-card-scenes').text).toBe('1 scene');
    expect(mara.hasClass('spellbook-world-color-blue')).toBe(true); // the colour of its type
    expect(cardNamed(pane, 'Saltwick').hasClass('spellbook-world-color-green')).toBe(true);
    expect(one(cardNamed(pane, 'Saltwick'), 'spellbook-world-card-scenes').text).toBe('2 scenes');
    expect(one(cardNamed(pane, 'Lamp'), 'spellbook-world-card-scenes').text).toBe('No scenes');
    expect(cardNamed(pane, 'Lamp').withClass('spellbook-world-card-summary')).toEqual([]);
    // Reading the list reads no note's text.
    expect(s.vault.reads.readText).toBe(0);
    expect(s.vault.writes).toEqual([]);
  });

  it('lets Hebrew names and summaries choose their own direction, and keeps counts left to right', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    expect(directionOf(pane, MARA_HE)).toEqual(['auto']);
    expect(directionOf(pane, MARA_HE_SUMMARY)).toEqual(['auto']);
    // The name on Mara's card, and the lamp's owner among the facts on its card.
    expect(directionOf(pane, 'Mara')).toEqual(['auto', 'auto']);
    expect(one(cardNamed(pane, MARA_HE), 'spellbook-world-card-scenes').getAttr('dir')).toBe('ltr');
    expect(one(pane, 'spellbook-world-search').getAttr('dir')).toBe('auto');
  });

  it('searches names, other names and summaries as the writer types, in English and Hebrew', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    const search = one(pane, 'spellbook-world-search');
    typeInto(search, 'keeper');
    expect(groupsOf(pane)).toEqual([['Characters', '1', ['Mara']]]);
    typeInto(search, 'fog');
    expect(groupsOf(pane)).toEqual([['Places', '1', ['Saltwick']]]);
    typeInto(search, 'המגדלור');
    expect(groupsOf(pane)).toEqual([['Characters', '1', [MARA_HE]]]);
    typeInto(search, 'dragon');
    expect(groupsOf(pane)).toEqual([]);
    expect(one(pane, 'spellbook-world-message').text).toBe(NOTHING_FOUND_TEXT);
    // Escape empties the box.
    search.fire('keydown', { key: 'Escape' });
    expect(search.value).toBe('');
    expect(groupsOf(pane)).toHaveLength(3);
  });

  it('shows one type when the list above says so', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    const filter = one(pane, 'spellbook-world-filter');
    expect(filter.children.map((option) => option.text)).toEqual(['All types', 'Characters', 'Places', 'Factions', 'Items', 'Lore', 'Creatures', 'Cultures', 'Other']);
    filter.value = 'place';
    filter.fire('change');
    expect(groupsOf(pane)).toEqual([['Places', '1', ['Saltwick']]]);
    filter.value = 'faction';
    filter.fire('change');
    expect(groupsOf(pane)).toEqual([['Factions', '0', []]]);
  });

  it('shows the sheet on a tap of the card or Enter on it, and opens the note on a tap of the name', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    const shown = (): string | null => pane.withClass('spellbook-world-detail-name')[0]?.text ?? null;
    // The card: the sheet, and no note.
    cardNamed(pane, 'Mara').fire('click');
    await calm(s);
    expect(shown()).toBe('Mara');
    cardNamed(pane, MARA_HE).fire('keydown', { key: 'Enter' });
    await calm(s);
    expect(shown()).toBe(MARA_HE);
    expect(s.opened).toEqual([]);
    // No button "Sheet" any more: the card is the button.
    expect(pane.withClass('spellbook-world-card-sheet')).toEqual([]);

    // The name: the note, and the sheet stays as it was.
    const name = one(cardNamed(pane, 'Saltwick'), 'spellbook-world-card-name');
    expect(name.tag).toBe('button');
    expect(name.getAttr('dir')).toBe('auto');
    expect(name.getAttr('aria-label')).toBe('Open note: Saltwick');
    name.fire('click');
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(SALTWICK), where: false }]);
    expect(shown()).toBe(MARA_HE);
    // Enter on the name is the name's own: the card does not show the sheet as well.
    one(cardNamed(pane, 'Saltwick'), 'spellbook-world-card-name').fire('keydown', { key: 'Enter' });
    expect(shown()).toBe(MARA_HE);

    // With the usual key held, either opens the note in a new tab.
    cardNamed(pane, 'Lamp').fire('click', { metaKey: true });
    one(cardNamed(pane, 'Mara'), 'spellbook-world-card-name').fire('click', { metaKey: true });
    await calm(s);
    expect(s.opened.slice(1)).toEqual([
      { path: inNovel(LAMP), where: 'tab' },
      { path: inNovel(MARA), where: 'tab' },
    ]);
    expect(shown()).toBe(MARA_HE);
    expect(s.vault.writes).toEqual([]);
  });

  it('says so when no project is open, and when the world is still empty', async () => {
    const none = await stage(novelVault(), { open: null });
    const closed = await openWorld(none);
    expect(one(closed.pane, 'spellbook-world-message').text).toBe(NO_PROJECT_TEXT);
    expect(one(closed.pane, 'spellbook-world-new').disabled).toBe(true);

    const vault = new MemoryVault();
    seedProject(vault, { scenes: { A: 1024 } });
    const empty = await stage(vault);
    const { pane } = await openWorld(empty);
    expect(pane.withClass('spellbook-world-message')[0]?.text).toBe(NO_ENTITIES_TEXT);
    expect(one(pane, 'spellbook-world-new').disabled).toBe(false);
  });

  it('follows the vault: a note that arrives, a summary that changes, a scene that lists someone', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    s.vault.external.create(inNovel('World/Factions/The Guild.md'), { frontmatter: { type: 'faction', summary: 'Keeps the tolls.' } });
    await calm(s);
    expect(groupsOf(pane).map((group) => group[0])).toEqual(['Characters', 'Places', 'Factions', 'Items']);
    s.vault.external.editFrontmatter(inNovel(LAMP), (frontmatter) => {
      frontmatter['summary'] = 'Brass, and older than the tower.';
    });
    s.vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => {
      frontmatter['entities'] = ['[[Lamp]]'];
    });
    await calm(s);
    const lamp = cardNamed(pane, 'Lamp');
    expect(one(lamp, 'spellbook-world-card-summary').text).toBe('Brass, and older than the tower.');
    expect(one(lamp, 'spellbook-world-card-scenes').text).toBe('1 scene');
    // A note with no known type is listed under "Other".
    s.vault.external.create(inNovel('World/Loose.md'), { frontmatter: { type: 'vessel' } });
    await calm(s);
    expect(last(groupsOf(pane))).toEqual(['Other', '1', ['Loose']]);
  });

  it('shows one column in a narrow pane, by the width of the pane and not the kind of device', async () => {
    const s = await stage();
    const open = await openWorld(s, 900);
    const root = one(open.pane, 'spellbook-world');
    expect(root.hasClass('spellbook-world-narrow')).toBe(false);
    setWidth(open, 380);
    expect(root.hasClass('spellbook-world-narrow')).toBe(true);
    // Right at the edge it stays as it is, in both directions.
    setWidth(open, 570);
    expect(root.hasClass('spellbook-world-narrow')).toBe(true);
    setWidth(open, 700);
    expect(root.hasClass('spellbook-world-narrow')).toBe(false);
    expect(root.hasClass('spellbook-is-mobile')).toBe(false);
  });

  it('marks phones and tablets by what Obsidian says the device is, for the size of what is tapped', async () => {
    Platform.isMobile = true;
    Platform.isPhone = true;
    const s = await stage();
    const { pane } = await openWorld(s, 380);
    const root = one(pane, 'spellbook-world');
    expect(root.hasClass('spellbook-is-mobile')).toBe(true);
    expect(root.hasClass('spellbook-is-phone')).toBe(true);
    expect(s.workspace.leftSplit.collapses + s.workspace.rightSplit.collapses).toBe(2);
  });
});

describe('making an entity', () => {
  it('"New character" asks for a name, makes the note from the template in World/Characters and opens it', async () => {
    const s = await stage();
    s.command('new-character').callback?.();
    expect(lastWindow().titleEl.text).toBe('New character');
    await answer(s, 'Joss Hale');
    expect(s.vault.writes).toEqual([{ op: 'createFile', path: 'Novel/World/Characters/Joss Hale.md' }]);
    expect(s.vault.frontmatterOf('Novel/World/Characters/Joss Hale.md')).toEqual({
      type: 'character',
      role: '',
      age: '',
      occupation: '',
      appearance: '',
      personality: '',
      voice: '',
      goal: '',
      arc: '',
      summary: '',
      aliases: [],
    });
    expect(s.vault.bodyOf('Novel/World/Characters/Joss Hale.md')).toBe('## Appearance\n\n## Background\n\n## Notes\n\n');
    expect(s.opened).toEqual([{ path: 'Novel/World/Characters/Joss Hale.md', where: false }]);
    expect(StubModal.opened.filter((modal) => modal.isOpen)).toEqual([]);
  });

  it('has a command for each built-in type, each with its own folder and properties', async () => {
    const s = await stage();
    for (const [command, name, path, keys] of [
      ['new-place', 'The Pier', 'Novel/World/Places/The Pier.md', ['type', 'kind', 'region', 'atmosphere', 'landmarks', 'summary', 'aliases']],
      ['new-faction', 'The Guild', 'Novel/World/Factions/The Guild.md', ['type', 'kind', 'leader', 'summary', 'aliases']],
      ['new-item', 'The Key', 'Novel/World/Items/The Key.md', ['type', 'kind', 'owner', 'summary', 'aliases']],
      ['new-lore', 'The Bell Under the Bar', 'Novel/World/Lore/The Bell Under the Bar.md', ['type', 'kind', 'period', 'told-by', 'summary', 'aliases']],
      ['new-creature', 'The Tide Hound', 'Novel/World/Creatures/The Tide Hound.md', ['type', 'kind', 'habitat', 'summary', 'aliases']],
      ['new-culture', 'The Bar Folk', 'Novel/World/Cultures/The Bar Folk.md', ['type', 'kind', 'region', 'summary', 'aliases']],
    ] as const) {
      s.command(command).callback?.();
      await answer(s, name);
      expect(Object.keys(s.vault.frontmatterOf(path) ?? {}), command).toEqual(keys);
    }
    expect(s.vault.hasFolder('Novel/World/Factions')).toBe(true);
    expect(s.vault.bodyOf('Novel/World/Lore/The Bell Under the Bar.md')).toBe('## The tale\n\n## Who tells it\n\n## What is true\n\n');
    s.command('new-lore').callback?.();
    expect(lastWindow().titleEl.text).toBe('New lore');
  });

  it('"New entity" asks which type first', async () => {
    const s = await stage();
    s.command('new-entity').callback?.();
    const choice = lastWindow();
    expect(choice.contentEl.withClass('spellbook-world-choice-name').map((name) => name.text)).toEqual(['Character', 'Place', 'Faction', 'Item', 'Lore', 'Creature', 'Culture']);
    choice.contentEl.withClass('spellbook-world-choice-type')[1]?.fire('click');
    expect(lastWindow().titleEl.text).toBe('New place');
    await answer(s, 'נמל');
    expect(s.vault.frontmatterOf('Novel/World/Places/נמל.md')).toMatchObject({ type: 'place' });
  });

  it('turns down a name that is taken or empty, says why, and replaces nothing', async () => {
    const s = await stage();
    s.command('new-character').callback?.();
    await answer(s, 'mara');
    const prompt = lastWindow();
    expect(one(prompt.contentEl, 'spellbook-prompt-message').text).toMatch(/already a note called "mara"/);
    await answer(s, '   ');
    expect(one(prompt.contentEl, 'spellbook-prompt-message').text).toBe('Give it a name.');
    await answer(s, '???');
    expect(one(prompt.contentEl, 'spellbook-prompt-message').text).toMatch(/no characters that can be used/);
    expect(s.vault.writes).toEqual([]);
    expect(s.vault.bodyOf(inNovel(MARA))).toBe('## Description\n\nHer story so far.\n');
    // Characters that a file name cannot hold are taken out of the name.
    await answer(s, 'Joss: the "pilot"');
    expect(s.vault.has('Novel/World/Characters/Joss the pilot.md')).toBe(true);
  });

  it('says so, and makes nothing, when no project is open or the project is read-only', async () => {
    const none = await stage(novelVault(), { open: null });
    none.command('new-item').callback?.();
    none.command('new-entity').callback?.();
    expect(StubNotice.shown.map((notice) => notice.message)).toEqual([NO_PROJECT_TEXT, NO_PROJECT_TEXT]);

    const vault = novelVault();
    vault.external.editFrontmatter(NOVEL_INDEX, (frontmatter) => {
      frontmatter['binder'] = { not: 'a list' };
    }, { silent: true });
    const readOnly = await stage(vault);
    readOnly.command('new-item').callback?.();
    expect(last(StubNotice.shown).message).toBe(READ_ONLY_TEXT);
    expect(StubModal.opened).toEqual([]);
    const { pane } = await openWorld(readOnly);
    expect(one(pane, 'spellbook-world-new').disabled).toBe(true);
    one(cardNamed(pane, 'Mara'), 'spellbook-world-card-more').fire('click');
    expect(lastMenu().outline).toEqual(['Open note', 'Open note in new tab', 'Open sheet']);
    expect(vault.writes).toEqual([]);
  });

  it('offers every type under "New" in the browser', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(pane, 'spellbook-world-new').fire('click');
    expect(lastMenu().outline).toEqual(['Character', 'Place', 'Faction', 'Item', 'Lore', 'Creature', 'Culture']);
    lastMenu().item('Faction').click();
    expect(lastWindow().titleEl.text).toBe('New faction');
    await answer(s, 'The Guild');
    expect(groupsOf(pane).map((group) => group[0])).toEqual(['Characters', 'Places', 'Factions', 'Items']);
  });
});

describe('the card\'s menu', () => {
  it('renames the note, and points the links to it at the new name', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(cardNamed(pane, 'Mara'), 'spellbook-world-card-more').fire('click');
    expect(lastMenu().outline).toEqual(['Open note', 'Open note in new tab', 'Open sheet', '---', 'Rename', 'Delete']);
    lastMenu().item('Rename').click();
    expect(one(lastWindow().contentEl, 'spellbook-prompt-input').value).toBe('Mara');
    await answer(s, 'Saltwick');
    // Another note of that name in another folder is no clash.
    expect(s.vault.writes).toEqual([
      { op: 'moveFile', path: inNovel(MARA), to: 'Novel/World/Characters/Saltwick.md' },
      { op: 'updateFrontmatter', path: inNovel(OPENING) },
    ]);
    // A bare "Saltwick" would lead to the place, so the link names the whole path.
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['entities']).toEqual(['[[Novel/World/Characters/Saltwick]]', '[[Saltwick]]']);
    expect(s.vault.bodyOf('Novel/World/Characters/Saltwick.md')).toBe('## Description\n\nHer story so far.\n');
    expect(groupsOf(pane)[0]).toEqual(['Characters', '2', ['Saltwick', MARA_HE]]);
  });

  it('turns down a name another note of the folder has', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(cardNamed(pane, 'Mara'), 'spellbook-world-card-more').fire('click');
    lastMenu().item('Rename').click();
    await answer(s, MARA_HE);
    expect(one(lastWindow().contentEl, 'spellbook-prompt-message').text).toMatch(/already a note called/);
    expect(s.vault.writes).toEqual([]);
  });

  it('deletes to the trash, after asking, and leaves the scenes that list it as they are', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(cardNamed(pane, 'Saltwick'), 'spellbook-world-card-more').fire('click');
    expect(lastMenu().item('Delete').warning).toBe(true);
    lastMenu().item('Delete').click();
    const confirm = lastWindow();
    expect(confirm.titleEl.text).toBe('Delete "Saltwick"?');
    expect(one(confirm.contentEl, 'spellbook-confirm-message').text).toMatch(/moved to the trash\. 2 scenes list it/);
    expect(s.vault.writes).toEqual([]); // nothing before the writer says so
    confirmIn(confirm);
    await calm(s);
    expect(s.vault.writes).toEqual([{ op: 'trash', path: inNovel(SALTWICK) }]);
    expect(s.vault.trashed).toEqual([inNovel(SALTWICK)]);
    expect(groupsOf(pane).map((group) => group[0])).toEqual(['Characters', 'Items']);
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['entities']).toEqual(['[[Mara]]', '[[Saltwick]]']);
  });

  it('opens the note in a new tab', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(cardNamed(pane, 'Lamp'), 'spellbook-world-card-more').fire('click');
    lastMenu().item('Open note in new tab').click();
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(LAMP), where: 'tab' }]);
  });
});

describe('the sheet', () => {
  async function detailsOf(s: Wired, name: string, width = 900): Promise<{ pane: FakeElement; detail: FakeElement; root: FakeElement }> {
    const { pane } = await openWorld(s, width);
    one(cardNamed(pane, name), 'spellbook-world-card-scenes').fire('click');
    return { pane, detail: one(pane, 'spellbook-world-detail'), root: one(pane, 'spellbook-world') };
  }
  const rowTitles = (detail: FakeElement): string[] => detail.withClass('spellbook-world-row-open').map((row) => row.text);

  it('show an entity\'s summary, its properties, its scenes in binder order and the events that list it', async () => {
    const s = await stage();
    const { detail, root, pane } = await detailsOf(s, 'Saltwick');
    expect(root.hasClass('spellbook-world-has-detail')).toBe(true);
    expect(cardNamed(pane, 'Saltwick').hasClass('is-selected')).toBe(true);
    expect(one(detail, 'spellbook-world-detail-name').text).toBe('Saltwick');
    expect(one(detail, 'spellbook-world-detail-type').text).toBe('Place');
    expect(one(detail, 'spellbook-world-detail-summary').value).toBe('Fog, salt and gulls.');
    // Every field of the type, also the ones that are still empty, each in a box of its own.
    expect(detail.withClass('spellbook-world-field-name').map((field) => field.text)).toEqual(['kind', 'region', 'atmosphere', 'landmarks']);
    expect(detail.withClass('spellbook-world-field-box').map((field) => field.value)).toEqual(['Harbour town', 'North coast', '', '']);
    expect(detail.withClass('spellbook-world-section-head').map((head) => head.fullText)).toEqual(['Related 0 Add', 'Scenes 2', 'Events 1']);
    expect(rowTitles(detail)).toEqual(['Opening', 'Closing', 'The fire']);
    // Under an event, its date in the story.
    expect(detail.withClass('spellbook-world-row-note').map((note) => note.text)).toEqual(['1890-03-01']);
    expect(s.vault.reads.readText).toBe(0);
  });

  it('open a scene or an event on a tap', async () => {
    const s = await stage();
    const { detail } = await detailsOf(s, 'Saltwick');
    const rows = detail.withClass('spellbook-world-row-open');
    rows[1]?.fire('click');
    await calm(s);
    rows[2]?.fire('click');
    one(detail, 'spellbook-world-open').fire('click');
    await calm(s);
    expect(s.opened.map((entry) => entry.path)).toEqual([inNovel(CLOSING), inNovel(FIRE), inNovel(SALTWICK)]);
  });

  it('take the entity out of a scene, changing only that scene\'s list', async () => {
    const s = await stage();
    const { pane } = await detailsOf(s, 'Saltwick');
    one(pane, 'spellbook-world-detail').withClass('spellbook-world-row-unlink')[0]?.fire('click');
    await calm(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(OPENING) }]);
    expect(s.vault.frontmatterOf(inNovel(OPENING))).toEqual({ status: 'To do', order: 1024, entities: ['[[Mara]]'] });
    expect(rowTitles(one(pane, 'spellbook-world-detail'))).toEqual(['Closing', 'The fire']);
    expect(one(cardNamed(pane, 'Saltwick'), 'spellbook-world-card-scenes').text).toBe('1 scene');
  });

  it('take the place of the list in a narrow pane, with a way back', async () => {
    const s = await stage();
    const { pane, root } = await detailsOf(s, MARA_HE, 380);
    expect(root.hasClass('spellbook-world-narrow')).toBe(true);
    expect(root.hasClass('spellbook-world-has-detail')).toBe(true);
    const detail = one(pane, 'spellbook-world-detail');
    expect(one(detail, 'spellbook-world-detail-name').getAttr('dir')).toBe('auto');
    expect(one(detail, 'spellbook-world-detail-summary').value).toBe(MARA_HE_SUMMARY);
    expect(one(detail, 'spellbook-world-detail-summary').getAttr('dir')).toBe('auto');
    const back = one(detail, 'spellbook-world-detail-back');
    expect(back.getAttr('aria-label')).toBe('Back to the list');
    back.fire('click');
    expect(root.hasClass('spellbook-world-has-detail')).toBe(false);
    expect(one(pane, 'spellbook-world-detail').children).toEqual([]);
  });

  it('close when the entity is deleted elsewhere, and follow it when it is renamed here', async () => {
    const s = await stage();
    const { pane, root } = await detailsOf(s, 'Lamp');
    one(cardNamed(pane, 'Lamp'), 'spellbook-world-card-more').fire('click');
    lastMenu().item('Rename').click();
    await answer(s, 'Brass lamp');
    expect(one(one(pane, 'spellbook-world-detail'), 'spellbook-world-detail-name').text).toBe('Brass lamp');
    s.vault.external.delete(inNovel('World/Items/Brass lamp.md'));
    await calm(s);
    expect(root.hasClass('spellbook-world-has-detail')).toBe(false);
  });
});

describe('find mentions', () => {
  it('lists the scenes whose text names the entity or one of its other names, and not the ones that list it', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(cardNamed(pane, 'Mara'), 'spellbook-world-card-scenes').fire('click');
    expect(one(pane, 'spellbook-world-find').text).toBe(FIND_MENTIONS_TEXT);
    one(pane, 'spellbook-world-find').fire('click');
    await calm(s);
    const mentions = one(pane, 'spellbook-world-mentions');
    // "The Letter" names "the keeper"; "Closing" only has "Tamara"; "Opening" lists Mara already.
    expect(mentions.withClass('spellbook-world-row-open').map((row) => row.text)).toEqual(['The Letter']);
    expect(one(mentions, 'spellbook-world-snippet-name').text).toBe('the keeper');
    expect(one(mentions, 'spellbook-world-snippet').getAttr('dir')).toBe('auto');
    // The three scenes that do not list her were read; nothing was written.
    expect(s.vault.reads.readText).toBe(3);
    expect(s.vault.writes).toEqual([]);
  });

  it('links a scene with one tap: only that scene\'s "entities" property changes', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(cardNamed(pane, 'Mara'), 'spellbook-world-card-scenes').fire('click');
    one(pane, 'spellbook-world-find').fire('click');
    await calm(s);
    const link = one(pane, 'spellbook-world-mention-link');
    expect(link.text).toBe(LINK_SCENE_TEXT);
    link.fire('click');
    await calm(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(LETTER) }]);
    expect(s.vault.frontmatterOf(inNovel(LETTER))).toEqual({ status: 'To do', order: 2048, entities: ['[[Mara]]'] });
    expect(s.vault.bodyOf(inNovel(LETTER))).toBe('Dear Anna, the keeper has not been seen since the storm.\n');
    // It is listed among her scenes now, in binder order, and no longer offered.
    const detail = one(pane, 'spellbook-world-detail');
    expect(detail.withClass('spellbook-world-rows')[0]?.withClass('spellbook-world-row-open').map((row) => row.text)).toEqual(['Opening', 'The Letter']);
    expect(detail.withClass('spellbook-world-mention')).toEqual([]);
    expect(detail.withClass('spellbook-world-hint').map((hint) => hint.text)).toContain(NO_MENTIONS_TEXT);
  });

  it('finds a Hebrew name behind a joined letter', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(cardNamed(pane, MARA_HE), 'spellbook-world-card-scenes').fire('click');
    one(pane, 'spellbook-world-find').fire('click');
    await calm(s);
    const mentions = one(pane, 'spellbook-world-mentions');
    expect(mentions.withClass('spellbook-world-row-open').map((row) => [row.text, row.getAttr('dir')])).toEqual([[NIGHT_TITLE, 'auto']]);
    one(pane, 'spellbook-world-mention-link').fire('click');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(NIGHT))?.['entities']).toEqual([`[[${MARA_HE}]]`]);
  });
});

describe('who is in a scene (what the inspector is offered)', () => {
  it('gives a scene\'s entities as chips, in the order written, with the colour of each type', async () => {
    const s = await stage();
    expect(service(s).of(OPENING)).toEqual([
      { key: '[[Mara]]', name: 'Mara', typeName: 'Character', color: 'blue', icon: 'user', found: true },
      { key: '[[Saltwick]]', name: 'Saltwick', typeName: 'Place', color: 'green', icon: 'map-pin', found: true },
    ]);
    expect(service(s).of(CLOSING).map((chip) => [chip.name, chip.found])).toEqual([['Saltwick', true], ['Nobody', false]]);
    expect(service(s).of(LETTER)).toEqual([]);
    expect(service(s).canChange()).toBe(true);
  });

  it('adds an entity from a list to search, as a wikilink in the scene\'s "entities" property', async () => {
    const s = await stage();
    let told = 0;
    service(s).onChange(() => told++);
    service(s).add(LETTER);
    const picker = lastWindow();
    expect(picker).toBeInstanceOf(EntityPickerModal);
    expect(picker.titleEl.text).toBe('In this scene: The Letter');
    const names = (): string[] => picker.contentEl.withClass('spellbook-world-picker-entity').map((row) => one(row, 'spellbook-world-picker-name').text);
    expect(names()).toEqual(['Lamp', 'Mara', 'Saltwick', MARA_HE]);
    typeInto(one(picker.contentEl, 'spellbook-world-picker-input'), 'salt');
    expect(names()).toEqual(['Saltwick']);
    picker.contentEl.withClass('spellbook-world-picker-entity')[0]?.fire('click');
    await calm(s);
    expect(picker.isOpen).toBe(false);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(LETTER) }]);
    expect(s.vault.frontmatterOf(inNovel(LETTER))).toEqual({ status: 'To do', order: 2048, entities: ['[[Saltwick]]'] });
    expect(service(s).of(LETTER).map((chip) => chip.name)).toEqual(['Saltwick']);
    expect(told).toBeGreaterThan(0);
  });

  it('leaves out what the scene lists already, and takes the first row on Enter', async () => {
    const s = await stage();
    service(s).add(OPENING);
    const picker = lastWindow();
    expect(picker.contentEl.withClass('spellbook-world-picker-name').map((name) => name.text)).toEqual(['Lamp', MARA_HE]);
    const input = one(picker.contentEl, 'spellbook-world-picker-input');
    typeInto(input, MARA_HE);
    input.fire('keydown', { key: 'Enter' });
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['entities']).toEqual(['[[Mara]]', '[[Saltwick]]', `[[${MARA_HE}]]`]);
    // Asked twice, it is listed once.
    service(s).add(OPENING);
    typeInto(one(lastWindow().contentEl, 'spellbook-world-picker-input'), 'mara');
    expect(lastWindow().contentEl.withClass('spellbook-world-picker-entity')).toEqual([]);
  });

  it('makes a new entity from what was typed and lists it at once, without leaving the scene', async () => {
    const s = await stage();
    service(s).add(LETTER);
    const picker = lastWindow();
    typeInto(one(picker.contentEl, 'spellbook-world-picker-input'), 'Anna');
    const create = picker.contentEl.withClass('spellbook-world-picker-create');
    expect(create.map((row) => row.fullText)).toEqual([
      'New character: Anna',
      'New place: Anna',
      'New faction: Anna',
      'New item: Anna',
      'New lore: Anna',
      'New creature: Anna',
      'New culture: Anna',
    ]);
    create[0]?.fire('click');
    await calm(s);
    expect(s.vault.writes).toEqual([
      { op: 'createFile', path: 'Novel/World/Characters/Anna.md' },
      { op: 'updateFrontmatter', path: inNovel(LETTER) },
    ]);
    expect(s.vault.frontmatterOf('Novel/World/Characters/Anna.md')).toMatchObject({ type: 'character', summary: '' });
    expect(s.vault.frontmatterOf(inNovel(LETTER))?.['entities']).toEqual(['[[Anna]]']);
    expect(s.opened).toEqual([]);
    // A name that an entity already has is not offered as a new one.
    service(s).add(NIGHT);
    typeInto(one(lastWindow().contentEl, 'spellbook-world-picker-input'), 'mara');
    expect(lastWindow().contentEl.withClass('spellbook-world-picker-create')).toEqual([]);
  });

  it('writes the whole path when the name alone would lead to another note', async () => {
    const vault = novelVault();
    vault.seed('Novel/Manuscript/Lamp.md', { frontmatter: { status: 'To do' }, body: 'A scene that happens to be called Lamp.\n' });
    const s = await stage(vault);
    service(s).add(LETTER);
    typeInto(one(lastWindow().contentEl, 'spellbook-world-picker-input'), 'lamp');
    lastWindow().contentEl.withClass('spellbook-world-picker-entity')[0]?.fire('click');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(LETTER))?.['entities']).toEqual(['[[Novel/World/Items/Lamp|Lamp]]']);
    expect(service(s).of(LETTER)).toMatchObject([{ name: 'Lamp', typeName: 'Item', found: true }]);
  });

  it('removes one entry, the others stay as written, and an empty list goes with its key', async () => {
    const s = await stage();
    expect(await service(s).remove(CLOSING, '[[Nobody]]')).toBeNull();
    expect(s.vault.frontmatterOf(inNovel(CLOSING))).toEqual({ status: 'To do', order: 4096, entities: ['[[Saltwick]]'] });
    expect(await service(s).remove(CLOSING, '[[Saltwick]]')).toBeNull();
    expect(s.vault.frontmatterOf(inNovel(CLOSING))).toEqual({ status: 'To do', order: 4096 });
    expect(await service(s).remove(CLOSING, '[[Saltwick]]')).toBeNull(); // already gone: nothing to say
    expect(s.vault.writesTo(inNovel(CLOSING))).toHaveLength(2);
    expect(s.vault.bodyOf(inNovel(CLOSING))).toBe('Tamara closed the book. Nobody spoke of Saltwick again.\n');
  });

  it('leaves an "entities" property that is not a list of links alone, and says so', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => {
      frontmatter['entities'] = { who: 'Mara' };
    }, { silent: true });
    const s = await stage(vault);
    service(s).add(LETTER);
    lastWindow().contentEl.withClass('spellbook-world-picker-entity')[0]?.fire('click');
    await calm(s);
    expect(one(lastWindow().contentEl, 'spellbook-world-picker-message').text).toMatch(/not a list of links/);
    expect(s.vault.writes).toEqual([]);
    expect(s.vault.frontmatterOf(inNovel(LETTER))?.['entities']).toEqual({ who: 'Mara' });
  });

  it('keeps a link working when the entity is renamed (Spellbook points the link at the new name itself)', async () => {
    const s = await stage();
    const { pane } = await openWorld(s);
    one(cardNamed(pane, 'Mara'), 'spellbook-world-card-more').fire('click');
    lastMenu().item('Rename').click();
    await answer(s, 'Mara Voss');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['entities']).toEqual(['[[Mara Voss]]', '[[Saltwick]]']);
    expect(service(s).of(OPENING).map((chip) => [chip.name, chip.found])).toEqual([['Mara Voss', true], ['Saltwick', true]]);
    expect(one(cardNamed(pane, 'Mara Voss'), 'spellbook-world-card-scenes').text).toBe('1 scene');
  });

  it('says that everything is listed when it is', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
      frontmatter['entities'] = ['[[Mara]]', '[[Saltwick]]', '[[Lamp]]', `[[${MARA_HE}]]`];
    });
    const s = await stage(vault);
    service(s).add(OPENING);
    expect(one(lastWindow().contentEl, 'spellbook-world-picker-note').text).toBe(PICKER_ALL_LISTED_TEXT);
  });
});

describe('two projects in one vault that each have a "Mara"', () => {
  const ATLAS_INDEX = 'Atlas/Atlas.md';
  const ATLAS_SCENE = 'Manuscript/Landfall.md';

  /** The novel, and beside it a second project with a Mara of its own, in two scenes there. */
  function twoProjects(): MemoryVault {
    const vault = novelVault();
    vault.seed(ATLAS_INDEX, {
      frontmatter: { spellbook: 'project', version: 1, title: 'Atlas', binder: [ATLAS_SCENE, 'Manuscript/Return.md'] },
      body: '',
    });
    vault.seed(`Atlas/${ATLAS_SCENE}`, { frontmatter: { status: 'To do', order: 1024, entities: ['[[Mara]]'] }, body: 'Mara came ashore.\n' });
    vault.seed('Atlas/Manuscript/Return.md', { frontmatter: { status: 'To do', order: 2048, entities: ['[[Mara]]'] }, body: 'Mara went home.\n' });
    vault.seed('Atlas/Timeline/The crossing.md', { frontmatter: { spellbook: 'event', date: '1700-01-01', entities: ['[[Mara]]'] }, body: '' });
    vault.seed('Atlas/World/Characters/Mara.md', { frontmatter: { type: 'character', summary: 'A map maker.', aliases: [] }, body: '' });
    return vault;
  }

  it('is a vault in which a bare "Mara" alone would lead a scene of the novel to the other project', () => {
    // What the vault says on its own, as Obsidian would: the shortest path wins.
    expect(twoProjects().resolveLink('Mara', inNovel(OPENING))).toBe('Atlas/World/Characters/Mara.md');
  });

  it('counts for the novel\'s Mara the novel\'s own scene, and no scene of the other project', async () => {
    const s = await stage(twoProjects());
    const { pane } = await openWorld(s);
    const mara = cardNamed(pane, 'Mara');
    expect(one(mara, 'spellbook-world-card-summary').text).toBe('Keeps the light, and a secret.');
    expect(one(mara, 'spellbook-world-card-scenes').text).toBe('1 scene');
    one(mara, 'spellbook-world-card-scenes').fire('click');
    const detail = one(pane, 'spellbook-world-detail');
    expect(detail.withClass('spellbook-world-row-open').map((row) => row.text)).toEqual(['Opening']);
    // The inspector's chip leads to this project's Mara: it is found, and it opens her note.
    expect(service(s).of(OPENING).map((chip) => [chip.name, chip.found])).toEqual([['Mara', true], ['Saltwick', true]]);
    service(s).open(OPENING, service(s).of(OPENING)[0]?.key ?? '');
    await calm(s);
    expect(last(s.opened).path).toBe(inNovel(MARA));
  });

  it('counts for the other project\'s Mara its own two scenes and its own event', async () => {
    const s = await stage(twoProjects(), { open: ATLAS_INDEX });
    const { pane } = await openWorld(s);
    const mara = cardNamed(pane, 'Mara');
    expect(one(mara, 'spellbook-world-card-summary').text).toBe('A map maker.');
    expect(one(mara, 'spellbook-world-card-scenes').text).toBe('2 scenes');
    one(mara, 'spellbook-world-card-scenes').fire('click');
    const detail = one(pane, 'spellbook-world-detail');
    expect(detail.withClass('spellbook-world-row-open').map((row) => row.text)).toEqual(['Landfall', 'Return', 'The crossing']);
    service(s).open(ATLAS_SCENE, service(s).of(ATLAS_SCENE)[0]?.key ?? '');
    await calm(s);
    expect(last(s.opened).path).toBe('Atlas/World/Characters/Mara.md');
  });

  it('does not list Mara twice in a scene that names her already, and takes her out again', async () => {
    const s = await stage(twoProjects());
    expect(await service(s).remove(OPENING, service(s).of(OPENING)[0]?.key ?? '')).toBeNull();
    await calm(s);
    expect(service(s).of(OPENING).map((chip) => chip.name)).toEqual(['Saltwick']);
    // The other project's scenes were not touched.
    expect(s.vault.frontmatterOf(`Atlas/${ATLAS_SCENE}`)?.['entities']).toEqual(['[[Mara]]']);
  });

  it('leaves a link with a path to the vault: one that names the other project\'s Mara is not this project\'s', async () => {
    const vault = twoProjects();
    vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => {
      frontmatter['entities'] = ['[[Atlas/World/Characters/Mara]]', '[[Novel/World/Characters/Mara]]'];
    });
    const s = await stage(vault);
    expect(service(s).of(LETTER).map((chip) => [chip.name, chip.found])).toEqual([['Mara', false], ['Mara', true]]);
  });
});

describe('entity types', () => {
  async function typesWindow(s: Wired): Promise<{ pane: FakeElement; modal: OpenWindow }> {
    const { pane } = await openWorld(s);
    one(pane, 'spellbook-world-types').fire('click');
    const modal = lastWindow();
    expect(modal).toBeInstanceOf(EntityTypesModal);
    return { pane, modal };
  }
  const typeNames = (modal: { contentEl: FakeElement }): string[] => modal.contentEl.withClass('spellbook-world-type-name').map((name) => name.text);
  const rowOf = (modal: { contentEl: FakeElement }, name: string): FakeElement => {
    const row = modal.contentEl.withClass('spellbook-world-type').find((candidate) => one(candidate, 'spellbook-world-type-name').text === name);
    if (!row) throw new Error(`no type "${name}"`);
    return row;
  };

  it('lists the seven built-in types with their folders and properties, and stores nothing until something changes', async () => {
    const s = await stage();
    const { modal } = await typesWindow(s);
    expect(typeNames(modal)).toEqual(['Character', 'Place', 'Faction', 'Item', 'Lore', 'Creature', 'Culture']);
    expect(one(rowOf(modal, 'Character'), 'spellbook-world-type-folder').text).toBe('World/Characters');
    expect(one(rowOf(modal, 'Character'), 'spellbook-world-type-fields').text).toBe('role, age, occupation, appearance, personality, voice, goal, arc, summary');
    expect(s.vault.writes).toEqual([]);
    expect(s.store.projectData('entityTypes')).toBeUndefined();
  });

  it('adds a type of the writer\'s own, stored with the project, with a command-free way to make one of it', async () => {
    const s = await stage();
    const { pane, modal } = await typesWindow(s);
    one(modal.contentEl, 'spellbook-world-types-add').fire('click');
    await answer(s, 'יצור');
    expect(typeNames(modal)).toEqual(['Character', 'Place', 'Faction', 'Item', 'Lore', 'Creature', 'Culture', 'יצור']);
    expect(one(rowOf(modal, 'יצור'), 'spellbook-world-type-name').getAttr('dir')).toBe('auto');
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: NOVEL_INDEX }]);
    const stored = s.vault.frontmatterOf(NOVEL_INDEX)?.['entityTypes'] as Array<Record<string, unknown>>;
    expect(stored.map((type) => type['id'])).toEqual(['character', 'place', 'faction', 'item', 'lore', 'creature', 'culture', 'יצור']);
    expect(stored[7]).toEqual({ id: 'יצור', name: 'יצור', folder: 'יצור', fields: ['summary'], color: null, icon: 'circle-dot' });
    // The rest of the index is as it was.
    expect(s.vault.frontmatterOf(NOVEL_INDEX)?.['binder']).toHaveLength(3);

    modal.close();
    one(pane, 'spellbook-world-new').fire('click');
    expect(lastMenu().outline).toEqual(['Character', 'Place', 'Faction', 'Item', 'Lore', 'Creature', 'Culture', 'יצור']);
    lastMenu().item('יצור').click();
    await answer(s, 'Kraken');
    expect(s.vault.frontmatterOf('Novel/World/יצור/Kraken.md')).toEqual({ type: 'יצור', summary: '', aliases: [] });
    expect(last(groupsOf(pane))).toEqual(['יצור', '1', ['Kraken']]);
  });

  it('changes a type\'s properties, folder, name, colour and icon without touching a single note', async () => {
    const s = await stage();
    const { modal } = await typesWindow(s);
    const more = (name: string, item: string): void => {
      one(rowOf(modal, name), 'spellbook-world-type-more').fire('click');
      lastMenu().item(item).click();
    };
    one(rowOf(modal, 'Character'), 'spellbook-world-type-more').fire('click');
    expect(lastMenu().outline).toEqual(['Rename', 'Change folder', 'Change properties', 'Change date words']); // a built-in type cannot be removed
    more('Character', 'Change properties');
    expect(one(lastWindow().contentEl, 'spellbook-prompt-input').value).toBe('role, age, occupation, appearance, personality, voice, goal, arc, summary');
    await answer(s, 'role, pronouns, summary, type');
    more('Character', 'Change folder');
    await answer(s, 'People');
    more('Character', 'Rename');
    await answer(s, 'Person');
    one(rowOf(modal, 'Person'), 'spellbook-world-type-color').fire('click');
    expect(lastMenu().outline).toEqual(['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink', 'No colour']);
    expect(lastMenu().item('Blue').checked).toBe(true);
    lastMenu().item('Pink').click();
    await calm(s);
    one(rowOf(modal, 'Person'), 'spellbook-world-type-icon').fire('click');
    lastMenu().item('Crown').click();
    await calm(s);

    const stored = (s.vault.frontmatterOf(NOVEL_INDEX)?.['entityTypes'] as Array<Record<string, unknown>>)[0];
    expect(stored).toEqual({ id: 'character', name: 'Person', folder: 'People', fields: ['role', 'pronouns', 'summary'], fieldsVersion: 2, color: 'pink', icon: 'crown' });
    // Only the index was written: the notes keep their type, their place and their properties.
    expect(new Set(s.vault.writes.map((write) => write.path))).toEqual(new Set([NOVEL_INDEX]));
    expect(s.vault.has(inNovel(MARA))).toBe(true);
    expect(service(s).of(OPENING)[0]).toMatchObject({ name: 'Mara', typeName: 'Person', color: 'pink', icon: 'crown' });
    // New ones go to the new folder, with the new properties.
    modal.close();
    s.command('new-character').callback?.();
    await answer(s, 'Joss');
    expect(s.vault.frontmatterOf('Novel/World/People/Joss.md')).toEqual({ type: 'character', role: '', pronouns: '', summary: '', aliases: [] });
  });

  it('says why a change will not do, and stores nothing then', async () => {
    const s = await stage();
    const { modal } = await typesWindow(s);
    one(modal.contentEl, 'spellbook-world-types-add').fire('click');
    await answer(s, 'place');
    expect(one(lastWindow().contentEl, 'spellbook-prompt-message').text).toMatch(/already a type called "place"/);
    lastWindow().close();
    one(rowOf(modal, 'Item'), 'spellbook-world-type-more').fire('click');
    lastMenu().item('Change folder').click();
    await answer(s, 'places');
    expect(one(lastWindow().contentEl, 'spellbook-prompt-message').text).toMatch(/Another type already keeps its notes/);
    expect(s.vault.writes).toEqual([]);
  });

  it('moves a type up and down, and removes one of the writer\'s own after asking: its notes stay, under "Other"', async () => {
    const s = await stage();
    const { pane, modal } = await typesWindow(s);
    one(rowOf(modal, 'Item'), 'spellbook-world-type-up').fire('click');
    await calm(s);
    expect(typeNames(modal)).toEqual(['Character', 'Place', 'Item', 'Faction', 'Lore', 'Creature', 'Culture']);
    expect(one(rowOf(modal, 'Character'), 'spellbook-world-type-up').getAttr('aria-disabled')).toBe('true');
    expect(groupsOf(pane).map((group) => group[0])).toEqual(['Characters', 'Places', 'Items']);

    one(modal.contentEl, 'spellbook-world-types-add').fire('click');
    await answer(s, 'Vessel');
    s.vault.external.create(inNovel('World/Vessel/Kraken.md'), { frontmatter: { type: 'vessel' } });
    await calm(s);
    one(rowOf(modal, 'Vessel'), 'spellbook-world-type-more').fire('click');
    expect(lastMenu().outline).toEqual(['Rename', 'Change folder', 'Change properties', 'Change date words', '---', 'Remove']);
    lastMenu().item('Remove').click();
    const confirm = lastWindow();
    expect(one(confirm.contentEl, 'spellbook-confirm-message').text).toMatch(/1 note has this type\. They stay where they are/);
    confirmIn(confirm);
    await calm(s);
    expect(typeNames(modal)).toEqual(['Character', 'Place', 'Item', 'Faction', 'Lore', 'Creature', 'Culture']);
    expect(s.vault.has(inNovel('World/Vessel/Kraken.md'))).toBe(true);
    expect(s.vault.trashed).toEqual([]);
    expect(last(groupsOf(pane))).toEqual(['Other', '1', ['Kraken']]);
  });

  it('follows the list when it changes on another device', async () => {
    const s = await stage();
    const { modal } = await typesWindow(s);
    s.vault.external.editFrontmatter(NOVEL_INDEX, (frontmatter) => {
      frontmatter['entityTypes'] = [{ id: 'ship', name: 'Ship', folder: 'Ships', fields: ['summary'], color: 'cyan', icon: 'ship' }];
    });
    await calm(s);
    expect(typeNames(modal)).toEqual(['Ship', 'Character', 'Place', 'Faction', 'Item', 'Lore', 'Creature', 'Culture']);
  });
});
