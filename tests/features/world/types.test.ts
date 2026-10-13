// The types an entity can have: reading the list from the project index, and
// the changes the writer can make to it. What is checked hardest: the four
// built-in types are always there, an id never changes, and nothing that
// cannot be understood is guessed at.

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TYPES,
  ENTITY_ICONS,
  ENTITY_TYPES_KEY,
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

/** "Creature", in Hebrew. */
const CREATURE = 'יצור';

function typesOf(edit: TypeEdit): EntityType[] {
  if (!edit.ok) throw new Error(`expected a new list, got: ${edit.message}`);
  return edit.types;
}

function messageOf(edit: TypeEdit): string {
  if (edit.ok) throw new Error('expected a refusal');
  return edit.message;
}

describe('the built-in types', () => {
  it('are character, place, faction and item, each with its own folder and properties', () => {
    expect(ENTITY_TYPES_KEY).toBe('entityTypes');
    expect(BUILT_IN_TYPES.map((type) => [type.id, type.folder, type.fields])).toEqual([
      ['character', 'Characters', ['role', 'age', 'appearance', 'goal', 'summary']],
      ['place', 'Places', ['kind', 'region', 'summary']],
      ['faction', 'Factions', ['kind', 'leader', 'summary']],
      ['item', 'Items', ['kind', 'owner', 'summary']],
    ]);
    for (const type of BUILT_IN_TYPES) {
      expect(type.builtIn).toBe(true);
      expect(type.color).not.toBeNull();
      expect(ENTITY_ICONS).toContain(type.icon);
    }
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
      { id: 'creature', name: 'Creature', folder: 'Bestiary', fields: ['habitat', 'summary'], color: 'purple', icon: 'paw-print' },
      { id: 'place', name: 'Location', color: 'cyan' },
    ]);
    expect(types.map((type) => type.id)).toEqual(['creature', 'place', 'character', 'faction', 'item']);
    expect(types[0]).toEqual({
      id: 'creature',
      name: 'Creature',
      folder: 'Bestiary',
      fields: ['habitat', 'summary'],
      color: 'purple',
      icon: 'paw-print',
      builtIn: false,
    });
    // A built-in type keeps what the entry does not say.
    expect(types[1]).toMatchObject({ id: 'place', name: 'Location', folder: 'Places', fields: ['kind', 'region', 'summary'], color: 'cyan', icon: 'map-pin', builtIn: true });
  });

  it('leaves out what it cannot understand, and never lets two types share an id or a folder', () => {
    const types = readEntityTypes([
      'creature',
      { name: 'No id' },
      { id: '  ' },
      { id: 'Creature', name: 'Creature' },
      { id: 'creature', name: 'Again' },
      { id: 'beast', name: 'Beast', folder: 'creature' },
      { id: 'spirit', name: 'Spirit', folder: 'a/b:c', color: 'mauve', fields: 'not a list' },
    ]);
    expect(types.filter((type) => !type.builtIn).map((type) => [type.id, type.name, type.folder])).toEqual([
      ['creature', 'Creature', 'Creature'],
      ['beast', 'Beast', 'creature 2'],
      ['spirit', 'Spirit', 'a b c'],
    ]);
    const spirit = findType(types, 'SPIRIT');
    expect(spirit?.color).toBeNull();
    expect(spirit?.fields).toEqual(['not a list']);
    expect(spirit?.icon).toBe(ENTITY_ICONS[0]);
  });

  it('gives back what writeEntityTypes stored', () => {
    const types = typesOf(addType(BUILT_IN_TYPES, { name: CREATURE, fields: 'habitat, summary', color: 'pink', icon: 'leaf' }));
    const stored = JSON.parse(JSON.stringify(writeEntityTypes(types))) as unknown;
    expect(readEntityTypes(stored)).toEqual(types);
    expect(findType(types, CREATURE)).toMatchObject({ id: CREATURE, name: CREATURE, folder: CREATURE, builtIn: false });
  });
});

describe('readFields', () => {
  it('reads a list, or one line with commas, and drops empty names, repeats and the properties with a meaning of their own', () => {
    expect(readFields(' role ,age,, Role, type, aliases, entities, summary ')).toEqual(['role', 'age', 'summary']);
    expect(readFields(['kind', 3, '', 'kind', 'גיל'])).toEqual(['kind', 'גיל']);
    expect(readFields(undefined)).toEqual([]);
  });
});

describe('changing the list', () => {
  it('adds a type at the end, with a summary to start with, and refuses a name or folder that is taken', () => {
    const types = typesOf(addType(BUILT_IN_TYPES, { name: '  Creature  ' }));
    expect(types).toHaveLength(5);
    expect(types[4]).toEqual({ id: 'creature', name: 'Creature', folder: 'Creature', fields: ['summary'], color: null, icon: ENTITY_ICONS[0], builtIn: false });
    expect(messageOf(addType(types, { name: 'creature' }))).toMatch(/already a type/);
    expect(messageOf(addType(types, { name: 'Character' }))).toMatch(/already a type/);
    expect(messageOf(addType(types, { name: 'Beast', folder: 'characters' }))).toMatch(/Another type/);
    expect(messageOf(addType(types, { name: '   ' }))).toMatch(/Give the type a name/);
    expect(messageOf(addType(types, { name: '???' }))).toMatch(/folder name/);
    expect(BUILT_IN_TYPES).toHaveLength(4); // the list handed in is never changed
  });

  it('changes a name, a folder, the properties, the colour and the icon, and never the id', () => {
    let types = typesOf(addType(BUILT_IN_TYPES, { name: 'Creature' }));
    types = typesOf(changeType(types, 'creature', { name: 'Beast', folder: 'Bestiary', fields: 'habitat, diet', color: 'green', icon: 'paw-print' }));
    expect(findType(types, 'creature')).toEqual({ id: 'creature', name: 'Beast', folder: 'Bestiary', fields: ['habitat', 'diet'], color: 'green', icon: 'paw-print', builtIn: false });
    types = typesOf(changeType(types, 'character', { name: 'Person', color: null }));
    expect(findType(types, 'character')).toMatchObject({ id: 'character', name: 'Person', folder: 'Characters', color: null, builtIn: true });

    expect(messageOf(changeType(types, 'creature', { name: 'person' }))).toMatch(/already a type/);
    expect(messageOf(changeType(types, 'creature', { folder: 'Places' }))).toMatch(/Another type/);
    expect(messageOf(changeType(types, 'creature', { folder: ' / ' }))).toMatch(/Give the folder a name/);
    expect(messageOf(changeType(types, 'gone', { name: 'X' }))).toMatch(/no longer in the list/);
    // Its own name and folder are not "taken".
    expect(changeType(types, 'creature', { name: 'Beast', folder: 'bestiary' }).ok).toBe(true);
  });

  it('removes a type of the writer\'s own, and never one of the four', () => {
    const types = typesOf(addType(BUILT_IN_TYPES, { name: 'Creature' }));
    expect(typesOf(removeType(types, 'creature'))).toEqual(BUILT_IN_TYPES);
    for (const builtIn of BUILT_IN_TYPES) expect(messageOf(removeType(types, builtIn.id))).toMatch(/cannot be removed/);
    expect(messageOf(removeType(types, 'gone'))).toMatch(/no longer in the list/);
  });

  it('moves a type one place up or down, and leaves it at the end it is already at', () => {
    const ids = (types: readonly EntityType[]): string => types.map((type) => type.id).join(' ');
    expect(ids(typesOf(moveType(BUILT_IN_TYPES, 'item', 'up')))).toBe('character place item faction');
    expect(ids(typesOf(moveType(BUILT_IN_TYPES, 'character', 'down')))).toBe('place character faction item');
    expect(ids(typesOf(moveType(BUILT_IN_TYPES, 'character', 'up')))).toBe('character place faction item');
    expect(ids(typesOf(moveType(BUILT_IN_TYPES, 'item', 'down')))).toBe('character place faction item');
    expect(moveType(BUILT_IN_TYPES, 'gone', 'up').ok).toBe(false);
  });
});
