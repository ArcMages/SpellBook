// The types an entity can have: reading the list from the project index, and
// the changes the writer can make to it. What is checked hardest: the seven
// built-in types are always there, an id never changes, and nothing that
// cannot be understood is guessed at.

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TYPES,
  ENTITY_ICONS,
  ENTITY_TYPES_KEY,
  FIELDS_VERSION,
  FIELDS_VERSION_KEY,
  addType,
  changeType,
  findType,
  moveType,
  readEntityTypes,
  readFields,
  removeType,
  writeEntityTypes,
} from '../../../src/core/world';
import type { EntityType, TypeEdit } from '../../../src/core/world';

/** "Ship", in Hebrew. */
const VESSEL = 'ספינה';

/** The seven built-in types, by id, in order. */
const BUILT_IN = 'character place faction item lore creature culture';

function typesOf(edit: TypeEdit): EntityType[] {
  if (!edit.ok) throw new Error(`expected a new list, got: ${edit.message}`);
  return edit.types;
}

function messageOf(edit: TypeEdit): string {
  if (edit.ok) throw new Error('expected a refusal');
  return edit.message;
}

describe('the built-in types', () => {
  it('are character, place, faction, item, lore, creature and culture, each with its own folder and properties', () => {
    expect(ENTITY_TYPES_KEY).toBe('entityTypes');
    expect(BUILT_IN_TYPES.map((type) => [type.id, type.folder, type.fields])).toEqual([
      ['character', 'Characters', ['role', 'age', 'occupation', 'appearance', 'personality', 'voice', 'goal', 'arc', 'summary']],
      ['place', 'Places', ['kind', 'region', 'atmosphere', 'landmarks', 'summary']],
      ['faction', 'Factions', ['kind', 'leader', 'summary']],
      ['item', 'Items', ['kind', 'owner', 'summary']],
      ['lore', 'Lore', ['kind', 'period', 'told-by', 'summary']],
      ['creature', 'Creatures', ['kind', 'habitat', 'summary']],
      ['culture', 'Cultures', ['kind', 'region', 'summary']],
    ]);
    expect(BUILT_IN_TYPES.map((type) => type.id).join(' ')).toBe(BUILT_IN);
    for (const type of BUILT_IN_TYPES) {
      expect(type.builtIn).toBe(true);
      expect(type.color).not.toBeNull();
      expect(ENTITY_ICONS).toContain(type.icon);
      // Every type ends with the summary, which the browser shows and searches.
      expect(type.fields[type.fields.length - 1]).toBe('summary');
    }
  });

  it('each have a colour and an icon of their own', () => {
    expect(new Set(BUILT_IN_TYPES.map((type) => type.color)).size).toBe(BUILT_IN_TYPES.length);
    expect(new Set(BUILT_IN_TYPES.map((type) => type.icon)).size).toBe(BUILT_IN_TYPES.length);
    expect(BUILT_IN_TYPES.filter((type) => ['lore', 'creature', 'culture'].includes(type.id)).map((type) => [type.name, type.color, type.icon])).toEqual([
      ['Lore', 'purple', 'scroll'],
      ['Creature', 'yellow', 'paw-print'],
      ['Culture', 'cyan', 'users'],
    ]);
  });

  it('are what a project has when its index says nothing, or nothing that can be understood', () => {
    for (const raw of [undefined, null, 'characters', 7, {}, []]) {
      expect(readEntityTypes(raw), JSON.stringify(raw)).toEqual(BUILT_IN_TYPES);
    }
  });
});

describe('readEntityTypes', () => {
  it('reads the writer\'s own types after the built-in ones it does not mention, in the order written', () => {
    const types = readEntityTypes([
      { id: 'vessel', name: 'Vessel', folder: 'Bestiary', fields: ['habitat', 'summary'], color: 'purple', icon: 'paw-print' },
      { id: 'place', name: 'Location', color: 'cyan' },
    ]);
    expect(types.map((type) => type.id)).toEqual(['vessel', 'place', 'character', 'faction', 'item', 'lore', 'creature', 'culture']);
    expect(types[0]).toEqual({
      id: 'vessel',
      name: 'Vessel',
      folder: 'Bestiary',
      fields: ['habitat', 'summary'],
      color: 'purple',
      icon: 'paw-print',
      builtIn: false,
    });
    // A built-in type keeps what the entry does not say.
    expect(types[1]).toMatchObject({ id: 'place', name: 'Location', folder: 'Places', fields: ['kind', 'region', 'atmosphere', 'landmarks', 'summary'], color: 'cyan', icon: 'map-pin', builtIn: true });
  });

  it('leaves out what it cannot understand, and never lets two types share an id or a folder', () => {
    const types = readEntityTypes([
      'vessel',
      { name: 'No id' },
      { id: '  ' },
      { id: 'Vessel', name: 'Vessel' },
      { id: 'vessel', name: 'Again' },
      { id: 'beast', name: 'Beast', folder: 'vessel' },
      { id: 'spirit', name: 'Spirit', folder: 'a/b:c', color: 'mauve', fields: 'not a list' },
    ]);
    expect(types.filter((type) => !type.builtIn).map((type) => [type.id, type.name, type.folder])).toEqual([
      ['vessel', 'Vessel', 'Vessel'],
      ['beast', 'Beast', 'vessel 2'],
      ['spirit', 'Spirit', 'a b c'],
    ]);
    const spirit = findType(types, 'SPIRIT');
    expect(spirit?.color).toBeNull();
    expect(spirit?.fields).toEqual(['not a list']);
    expect(spirit?.icon).toBe(ENTITY_ICONS[0]);
  });

  it('gives back what writeEntityTypes stored', () => {
    const types = typesOf(addType(BUILT_IN_TYPES, { name: VESSEL, fields: 'habitat, summary', color: 'pink', icon: 'leaf' }));
    const stored = JSON.parse(JSON.stringify(writeEntityTypes(types))) as unknown;
    expect(readEntityTypes(stored)).toEqual(types);
    expect(findType(types, VESSEL)).toMatchObject({ id: VESSEL, name: VESSEL, folder: VESSEL, builtIn: false });
  });
});

describe('a list stored by the first version (four built-in types, fewer fields)', () => {
  /** What the first version stored once the writer had added a type of their own and recoloured the places. */
  const stored = [
    { id: 'character', name: 'Character', folder: 'Characters', fields: ['role', 'age', 'appearance', 'goal', 'summary'], color: 'blue', icon: 'user' },
    { id: 'place', name: 'Location', folder: 'Locations', fields: ['kind', 'region', 'summary'], color: 'pink', icon: 'home' },
    { id: 'faction', name: 'Faction', folder: 'Factions', fields: ['kind', 'leader', 'motto', 'summary'], color: null, icon: 'flag' },
    { id: 'item', name: 'Item', folder: 'Items', fields: ['kind', 'owner', 'summary'], color: 'orange', icon: 'gem' },
    { id: 'vessel', name: 'Vessel', folder: 'Fleet', fields: ['tonnage', 'summary'], color: 'cyan', icon: 'ship' },
  ];
  const type = (types: readonly EntityType[], id: string): EntityType => findType(types, id) as EntityType;

  it('gains lore, creature and culture after everything it has, and loses nothing', () => {
    const types = readEntityTypes(stored);
    expect(types.map((entry) => entry.id)).toEqual(['character', 'place', 'faction', 'item', 'vessel', 'lore', 'creature', 'culture']);
    // The writer's own type, exactly as it was.
    expect(type(types, 'vessel')).toEqual({ id: 'vessel', name: 'Vessel', folder: 'Fleet', fields: ['tonnage', 'summary'], color: 'cyan', icon: 'ship', builtIn: false });
    // What the writer changed on a built-in type: its name, folder, colour, icon, and the faction's fields.
    expect(type(types, 'place')).toMatchObject({ name: 'Location', folder: 'Locations', color: 'pink', icon: 'home', builtIn: true });
    expect(type(types, 'faction')).toMatchObject({ fields: ['kind', 'leader', 'motto', 'summary'], color: null });
    for (const id of ['lore', 'creature', 'culture']) expect(type(types, id)).toEqual(findType(BUILT_IN_TYPES, id));
  });

  it('gives a character and a place the fields of today when theirs were never changed', () => {
    const types = readEntityTypes(stored);
    expect(type(types, 'character').fields).toEqual(findType(BUILT_IN_TYPES, 'character')?.fields);
    expect(type(types, 'place').fields).toEqual(['kind', 'region', 'atmosphere', 'landmarks', 'summary']);
  });

  it('keeps fields the writer had changed, however little', () => {
    const changed = stored.map((entry) => (entry.id === 'character' ? { ...entry, fields: ['role', 'age', 'appearance', 'goal', 'eyes', 'summary'] } : entry));
    expect(type(readEntityTypes(changed), 'character').fields).toEqual(['role', 'age', 'appearance', 'goal', 'eyes', 'summary']);
    const reordered = stored.map((entry) => (entry.id === 'place' ? { ...entry, fields: ['region', 'kind', 'summary'] } : entry));
    expect(type(readEntityTypes(reordered), 'place').fields).toEqual(['region', 'kind', 'summary']);
    const emptied = stored.map((entry) => (entry.id === 'place' ? { ...entry, fields: [] } : entry));
    expect(type(readEntityTypes(emptied), 'place').fields).toEqual([]);
  });

  it('keeps fields that this version stored, also when the writer set them back to the old ones', () => {
    const old = ['role', 'age', 'appearance', 'goal', 'summary'];
    const back = typesOf(changeType(readEntityTypes(stored), 'character', { fields: old }));
    const written = JSON.parse(JSON.stringify(writeEntityTypes(back))) as Array<Record<string, unknown>>;
    expect(written.find((entry) => entry['id'] === 'character')).toMatchObject({ fields: old, [FIELDS_VERSION_KEY]: FIELDS_VERSION });
    // Only the two types whose fields grew say which version theirs are of.
    expect(written.filter((entry) => FIELDS_VERSION_KEY in entry).map((entry) => entry['id'])).toEqual(['character', 'place']);
    expect(type(readEntityTypes(written), 'character').fields).toEqual(old);
    expect(readEntityTypes(written)).toEqual(back);
  });

  it('is read the same however often it is stored and read again', () => {
    const once = readEntityTypes(stored);
    const twice = readEntityTypes(JSON.parse(JSON.stringify(writeEntityTypes(once))) as unknown);
    expect(twice).toEqual(once);
  });
});

describe('readFields', () => {
  it('reads a list, or one line with commas, and drops empty names, repeats and the properties with a meaning of their own', () => {
    expect(readFields(' role ,age,, Role, type, aliases, entities, image, related, summary ')).toEqual(['role', 'age', 'summary']);
    expect(readFields(['kind', 3, '', 'kind', 'גיל'])).toEqual(['kind', 'גיל']);
    expect(readFields(undefined)).toEqual([]);
  });
});

describe('changing the list', () => {
  it('adds a type at the end, with a summary to start with, and refuses a name or folder that is taken', () => {
    const types = typesOf(addType(BUILT_IN_TYPES, { name: '  Vessel  ' }));
    expect(types).toHaveLength(8);
    expect(types[7]).toEqual({ id: 'vessel', name: 'Vessel', folder: 'Vessel', fields: ['summary'], color: null, icon: ENTITY_ICONS[0], builtIn: false });
    expect(messageOf(addType(types, { name: 'vessel' }))).toMatch(/already a type/);
    expect(messageOf(addType(types, { name: 'Character' }))).toMatch(/already a type/);
    expect(messageOf(addType(types, { name: 'Beast', folder: 'characters' }))).toMatch(/Another type/);
    expect(messageOf(addType(types, { name: '   ' }))).toMatch(/Give the type a name/);
    expect(messageOf(addType(types, { name: '???' }))).toMatch(/folder name/);
    expect(BUILT_IN_TYPES).toHaveLength(7); // the list handed in is never changed
  });

  it('changes a name, a folder, the properties, the colour and the icon, and never the id', () => {
    let types = typesOf(addType(BUILT_IN_TYPES, { name: 'Vessel' }));
    types = typesOf(changeType(types, 'vessel', { name: 'Beast', folder: 'Bestiary', fields: 'habitat, diet', color: 'green', icon: 'paw-print' }));
    expect(findType(types, 'vessel')).toEqual({ id: 'vessel', name: 'Beast', folder: 'Bestiary', fields: ['habitat', 'diet'], color: 'green', icon: 'paw-print', builtIn: false });
    types = typesOf(changeType(types, 'character', { name: 'Person', color: null }));
    expect(findType(types, 'character')).toMatchObject({ id: 'character', name: 'Person', folder: 'Characters', color: null, builtIn: true });

    expect(messageOf(changeType(types, 'vessel', { name: 'person' }))).toMatch(/already a type/);
    expect(messageOf(changeType(types, 'vessel', { folder: 'Places' }))).toMatch(/Another type/);
    expect(messageOf(changeType(types, 'vessel', { folder: ' / ' }))).toMatch(/Give the folder a name/);
    expect(messageOf(changeType(types, 'gone', { name: 'X' }))).toMatch(/no longer in the list/);
    // Its own name and folder are not "taken".
    expect(changeType(types, 'vessel', { name: 'Beast', folder: 'bestiary' }).ok).toBe(true);
  });

  it('removes a type of the writer\'s own, and never one of the seven', () => {
    const types = typesOf(addType(BUILT_IN_TYPES, { name: 'Vessel' }));
    expect(typesOf(removeType(types, 'vessel'))).toEqual(BUILT_IN_TYPES);
    for (const builtIn of BUILT_IN_TYPES) expect(messageOf(removeType(types, builtIn.id))).toMatch(/cannot be removed/);
    expect(messageOf(removeType(types, 'gone'))).toMatch(/no longer in the list/);
  });

  it('moves a type one place up or down, and leaves it at the end it is already at', () => {
    const ids = (types: readonly EntityType[]): string => types.map((type) => type.id).join(' ');
    expect(ids(typesOf(moveType(BUILT_IN_TYPES, 'item', 'up')))).toBe('character place item faction lore creature culture');
    expect(ids(typesOf(moveType(BUILT_IN_TYPES, 'character', 'down')))).toBe('place character faction item lore creature culture');
    expect(ids(typesOf(moveType(BUILT_IN_TYPES, 'character', 'up')))).toBe(BUILT_IN);
    expect(ids(typesOf(moveType(BUILT_IN_TYPES, 'culture', 'down')))).toBe(BUILT_IN);
    expect(moveType(BUILT_IN_TYPES, 'gone', 'up').ok).toBe(false);
  });
});
