// The world-building engine apart from the types and the links: an entity
// note and its template, the browser's search and groups, and "Find
// mentions". Hebrew is checked alongside English throughout.

import { describe, expect, it } from 'vitest';
import { classifyNote } from '../../../src/core/progress/wordTracker';
import {
  ALL_TYPES,
  BUILT_IN_TYPES,
  NARROW_PANE_PX,
  NARROW_SLACK_PX,
  OTHER_TYPE,
  WORLD_FOLDER,
  addType,
  entityFields,
  fieldText,
  findMention,
  findType,
  groupEntities,
  isEntityPath,
  isNarrowPane,
  matchesSearch,
  mentionNames,
  newEntityBody,
  newEntityFrontmatter,
  readAliases,
  readEntities,
  sceneCountText,
  sceneMention,
} from '../../../src/core/world';
import type { EntityType } from '../../../src/core/world';

/** "Mara", "Saltwick" and "the lighthouse", in Hebrew. */
const MARA = 'מארה';
const SALTWICK = 'סולטוויק';

const type = (id: string): EntityType => findType(BUILT_IN_TYPES, id) as EntityType;

const NOTES = [
  { path: 'World/Characters/Mara.md', frontmatter: { type: 'character', role: 'Keeper', age: 34, summary: 'Keeps the light,\nand a secret.', aliases: ['the keeper', 'M'] } },
  { path: `World/Characters/${MARA}.md`, frontmatter: { type: 'Character', summary: 'שומרת המגדלור' } },
  { path: 'World/Places/Saltwick.md', frontmatter: null },
  { path: 'World/Factions/The Guild.md', frontmatter: { type: 'item' } },
  { path: 'World/Loose.md', frontmatter: { summary: 'Nobody knows what this is.' } },
  { path: 'World/Vessels/Kraken.md', frontmatter: { type: 'vessel' } },
  { path: 'World/Places/map.png', frontmatter: null },
  { path: 'Manuscript/Opening.md', frontmatter: { type: 'character' } },
];

describe('an entity note', () => {
  it('starts with its type, the type\'s properties, empty, and an empty list of other names', () => {
    expect(newEntityFrontmatter(type('character'))).toEqual({
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
    expect(Object.keys(newEntityFrontmatter(type('place')))).toEqual(['type', 'kind', 'region', 'atmosphere', 'landmarks', 'summary', 'aliases']);
    expect(Object.keys(newEntityFrontmatter(type('lore')))).toEqual(['type', 'kind', 'period', 'told-by', 'summary', 'aliases']);
    expect(Object.keys(newEntityFrontmatter(type('creature')))).toEqual(['type', 'kind', 'habitat', 'summary', 'aliases']);
    expect(Object.keys(newEntityFrontmatter(type('culture')))).toEqual(['type', 'kind', 'region', 'summary', 'aliases']);
    // A picture and relations are optional: a new note has neither.
    for (const builtIn of BUILT_IN_TYPES) {
      expect(newEntityFrontmatter(builtIn)).not.toHaveProperty('image');
      expect(newEntityFrontmatter(builtIn)).not.toHaveProperty('related');
    }
    expect(Object.keys(newEntityFrontmatter(type('faction')))).toEqual(['type', 'kind', 'leader', 'summary', 'aliases']);
    expect(Object.keys(newEntityFrontmatter(type('item')))).toEqual(['type', 'kind', 'owner', 'summary', 'aliases']);
  });

  it('starts with a few empty headings, and no other text', () => {
    expect(newEntityBody(type('character'))).toBe('## Appearance\n\n## Background\n\n## Notes\n\n');
    expect(newEntityBody(type('faction'))).toContain('## Members');
    // Headings that fit the type: a legend is told, a creature has habits, a people has customs.
    expect(newEntityBody(type('lore'))).toBe('## The tale\n\n## Who tells it\n\n## What is true\n\n');
    expect(newEntityBody(type('creature'))).toBe('## Description\n\n## Habits\n\n## What people say\n\n');
    expect(newEntityBody(type('culture'))).toBe('## Description\n\n## Customs\n\n## Language\n\n');
    const own = addType(BUILT_IN_TYPES, { name: 'Vessel' });
    expect(own.ok && newEntityBody(own.types[7] as EntityType)).toBe('## Description\n\n## Notes\n\n');
  });

  it('is any markdown note in the World folder, and nothing else', () => {
    expect(WORLD_FOLDER).toBe('World');
    expect(isEntityPath('World/Characters/Mara.md')).toBe(true);
    expect(isEntityPath('World/Loose.md')).toBe(true);
    expect(isEntityPath('World/Places/map.png')).toBe(false);
    expect(isEntityPath('Manuscript/World.md')).toBe(false);
    expect(isEntityPath('Worldly/Mara.md')).toBe(false);
  });
});

describe('readEntities', () => {
  const entities = readEntities(NOTES, BUILT_IN_TYPES);

  it('lists the notes of the World folder by name, each with its type, summary and other names', () => {
    expect(entities.map((entity) => [entity.name, entity.typeId])).toEqual([
      ['Kraken', null],
      ['Loose', null],
      ['Mara', 'character'],
      ['Saltwick', 'place'],
      ['The Guild', 'item'],
      [MARA, 'character'],
    ]);
    const mara = entities.find((entity) => entity.name === 'Mara');
    expect(mara?.summary).toBe('Keeps the light, and a secret.');
    expect(mara?.aliases).toEqual(['the keeper', 'M']);
  });

  it('goes by the "type" property first (its id or its name, in any capitals), and by the folder for a note without one', () => {
    // "The Guild" lies in Factions but says it is an item: what the note says wins.
    expect(entities.find((entity) => entity.name === 'The Guild')?.typeId).toBe('item');
    // "Saltwick" says nothing: it is in the folder of places.
    expect(entities.find((entity) => entity.name === 'Saltwick')?.typeId).toBe('place');
    // A type that is not in the list, and a note directly in World: no type.
    expect(entities.find((entity) => entity.name === 'Kraken')?.typeId).toBeNull();
    const renamed = readEntities(NOTES, [{ ...type('place'), folder: 'Locations' }]);
    expect(renamed.find((entity) => entity.name === 'Saltwick')?.typeId).toBeNull();
  });

  it('reads other names and values as they may be written by hand', () => {
    expect(readAliases({ aliases: 'the keeper' })).toEqual(['the keeper']);
    expect(readAliases({ aliases: ['a', 'a', '', 7, null, { b: 1 }] })).toEqual(['a', '7']);
    expect(readAliases(null)).toEqual([]);
    expect(fieldText(['north', 'cold'])).toBe('north, cold');
    expect(fieldText(34)).toBe('34');
    expect(fieldText({ nested: true })).toBe('');
  });

  it('shows the properties that hold something: the type\'s own first, then the writer\'s additions', () => {
    const mara = entities.find((entity) => entity.name === 'Mara');
    const extra = { ...mara!, frontmatter: { ...mara!.frontmatter, eyes: 'grey', goal: '' } };
    expect(entityFields(extra, type('character'))).toEqual([
      { name: 'role', value: 'Keeper' },
      { name: 'age', value: '34' },
      { name: 'eyes', value: 'grey' },
    ]);
    expect(entityFields(extra, null).map((field) => field.name)).toEqual(['role', 'age', 'eyes']);
  });
});

describe('the browser', () => {
  const entities = readEntities(NOTES, BUILT_IN_TYPES);

  it('searches names, other names and summaries, whatever the capitals, every word typed', () => {
    const found = (query: string): string[] => entities.filter((entity) => matchesSearch(entity, query)).map((entity) => entity.name);
    expect(found('')).toHaveLength(6);
    expect(found('MARA')).toEqual(['Mara']);
    expect(found('keeper')).toEqual(['Mara']);
    expect(found('secret light')).toEqual(['Mara']);
    expect(found('secret harbour')).toEqual([]);
    expect(found('המגדלור')).toEqual([MARA]);
    expect(found(MARA.slice(0, 2))).toEqual([MARA]);
  });

  it('groups by type in the order of the list, with "Other" last, and leaves empty groups out', () => {
    const groups = groupEntities(entities, BUILT_IN_TYPES);
    expect(groups.map((group) => [group.name, group.entities.map((entity) => entity.name)])).toEqual([
      ['Characters', ['Mara', MARA]],
      ['Places', ['Saltwick']],
      ['Items', ['The Guild']],
      ['Other', ['Kraken', 'Loose']],
    ]);
  });

  it('shows one type when asked, and says so when it has none yet', () => {
    expect(groupEntities(entities, BUILT_IN_TYPES, '', 'place').map((group) => group.id)).toEqual(['place']);
    const factions = groupEntities(entities, BUILT_IN_TYPES, '', 'faction');
    expect(factions.map((group) => [group.id, group.entities.length])).toEqual([['faction', 0]]);
    expect(groupEntities(entities, BUILT_IN_TYPES, 'guild', 'faction')).toEqual([]);
    expect(groupEntities(entities, BUILT_IN_TYPES, '', OTHER_TYPE).map((group) => group.id)).toEqual([OTHER_TYPE]);
    expect(groupEntities(entities, BUILT_IN_TYPES, 'mara', ALL_TYPES).map((group) => group.id)).toEqual(['character']);
  });

  it('counts scenes in words', () => {
    expect([0, 1, 2, 12].map(sceneCountText)).toEqual(['No scenes', '1 scene', '2 scenes', '12 scenes']);
  });

  it('calls a pane narrow by its own width, and does not flicker at the edge', () => {
    expect(isNarrowPane(NARROW_PANE_PX - 1, false)).toBe(true);
    expect(isNarrowPane(NARROW_PANE_PX, false)).toBe(false);
    // A narrow pane must grow a little past the edge before it is wide again.
    expect(isNarrowPane(NARROW_PANE_PX + NARROW_SLACK_PX - 1, true)).toBe(true);
    expect(isNarrowPane(NARROW_PANE_PX + NARROW_SLACK_PX, true)).toBe(false);
    // A pane that has not been laid out yet (no width) stays as it was.
    expect(isNarrowPane(0, true)).toBe(true);
    expect(isNarrowPane(0, false)).toBe(false);
  });
});

describe('find mentions', () => {
  it('looks for the name and the other names, longest first, and not for a single letter', () => {
    expect(mentionNames({ name: 'Mara', aliases: ['the keeper', 'M', 'mara'] })).toEqual(['the keeper', 'Mara']);
  });

  it('finds a name that stands as a word of its own, whatever its capitals', () => {
    expect(findMention('Then Mara lit the lamp.', ['Mara'])).toEqual({ index: 5, found: 'Mara' });
    expect(findMention("It was MARA's lamp.", ['Mara'])?.found).toBe('MARA');
    expect(findMention('"Mara," he said.', ['Mara'])?.index).toBe(1);
    expect(findMention('Tamara and Maran left.', ['Mara'])).toBeNull();
    expect(findMention('Mara2 is a code name', ['Mara'])).toBeNull();
    expect(findMention('', ['Mara'])).toBeNull();
    expect(findMention('Mara', [])).toBeNull();
  });

  it('takes the first place any of the names stands', () => {
    expect(findMention('The keeper waited for Mara.', ['the keeper', 'Mara'])).toEqual({ index: 0, found: 'The keeper' });
  });

  it('finds a Hebrew name behind the short words Hebrew joins to it, and not inside another word', () => {
    expect(findMention(`אז ${MARA} הדליקה את המנורה`, [MARA])?.found).toBe(MARA);
    // "and Mara", "to Mara", "and when Mara".
    expect(findMention(`ו${MARA} הלכה`, [MARA])?.index).toBe(1);
    expect(findMention(`נתתי ל${MARA} מכתב`, [MARA])?.found).toBe(MARA);
    expect(findMention(`וכש${MARA} באה`, [MARA])).toBeNull(); // three joined letters is another word
    expect(findMention(`וש${MARA} באה`, [MARA])?.index).toBe(2);
    expect(findMention(`ת${MARA}`, [MARA])).toBeNull();
    expect(findMention(`${MARA}ים`, [MARA])).toBeNull();
    // An English name gets no such allowance.
    expect(findMention('bMara', ['Mara'])).toBeNull();
  });

  it('looks at a scene\'s text, never at its properties, and shows the words around the name', () => {
    const note = '---\nsynopsis: Mara is only named up here\n---\nThe harbour was quiet.\nLate that night the keeper climbed the stairs of the lighthouse one more time, slowly.\n';
    expect(sceneMention(note, ['Mara'])).toBeNull();
    const snippet = sceneMention(note, ['the keeper']);
    expect(snippet?.found).toBe('the keeper');
    expect(snippet?.before).toBe('Late that night ');
    expect(snippet?.after.startsWith(' climbed the stairs')).toBe(true);
    expect(snippet?.after.endsWith('...')).toBe(true);
    expect(`${snippet?.before}${snippet?.found}${snippet?.after}`).not.toContain('\n');
    expect(sceneMention(`ב${SALTWICK} ירד גשם.`, [SALTWICK])).toEqual({ before: 'ב', found: SALTWICK, after: ' ירד גשם.' });
  });
});

describe('World notes and the manuscript', () => {
  it('are never counted as manuscript words: they count with the other notes of the open project', () => {
    const projects = { folders: ['Novel'], active: 'Novel' };
    expect(classifyNote('Novel/World/Characters/Mara.md', projects)).toEqual({ project: 'Novel', bucket: 'other' });
    expect(classifyNote('Novel/Manuscript/Opening.md', projects)).toEqual({ project: 'Novel', bucket: 'manuscript' });
  });
});
