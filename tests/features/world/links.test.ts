// Scene links: the "entities" property of a scene or a timeline event, as a
// list of wikilinks to entity notes. Where a link leads is asked of the
// vault; here the tests' memory vault answers, the way Obsidian does.

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TYPES,
  ENTITIES_KEY,
  addEntityLink,
  buildWorldLinks,
  linkTo,
  nameLink,
  parseLink,
  pathLink,
  readEntities,
  readEntityLinks,
  removeEntityLink,
} from '../../../src/core/world';
import type { LinkResolver, LinkingNote } from '../../../src/core/world';
import { MemoryVault, resolveLinkAmong } from '../../memoryVault';

/** "Mara", in Hebrew. */
const MARA_HE = 'מארה';

const PATHS = [
  'Novel/World/Characters/Mara.md',
  `Novel/World/Characters/${MARA_HE}.md`,
  'Novel/World/Places/Saltwick.md',
  'Novel/World/Items/Lamp.md',
  'Novel/Manuscript/Opening.md',
  'Novel/Manuscript/Lamp.md',
  'Novel/Research/Tides.md',
];
const resolve: LinkResolver = (target, from) => resolveLinkAmong(PATHS, target, from);

describe('a link as it is written', () => {
  it('reads the name, the path, the shown name and drops a heading', () => {
    expect(parseLink('[[Mara]]')).toEqual({ target: 'Mara', label: 'Mara' });
    expect(parseLink(' [[ Mara ]] ')).toEqual({ target: 'Mara', label: 'Mara' });
    expect(parseLink('[[World/Characters/Mara|The keeper]]')).toEqual({ target: 'World/Characters/Mara', label: 'The keeper' });
    expect(parseLink('[[World/Characters/Mara.md]]')).toEqual({ target: 'World/Characters/Mara.md', label: 'Mara' });
    expect(parseLink('[[Mara#Background]]')).toEqual({ target: 'Mara', label: 'Mara' });
    expect(parseLink(`[[${MARA_HE}]]`)).toEqual({ target: MARA_HE, label: MARA_HE });
  });

  it('takes a bare name, as typed by hand, for a link to the note of that name', () => {
    expect(parseLink('Mara')).toEqual({ target: 'Mara', label: 'Mara' });
  });

  it('is nothing when it is not a link', () => {
    for (const value of ['', '   ', '[[]]', '[[#Heading]]', '[[|shown]]', '[Mara]', '[[Mara', 'Mara]]', 7, null, ['[[Mara]]'], { link: 'Mara' }]) {
      expect(parseLink(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('is read from a list, or from one text', () => {
    expect(ENTITIES_KEY).toBe('entities');
    expect(readEntityLinks({ entities: ['[[Mara]]', '', 7, '[[Saltwick]]'] })).toEqual(['[[Mara]]', '[[Saltwick]]']);
    expect(readEntityLinks({ entities: '[[Mara]]' })).toEqual(['[[Mara]]']);
    expect(readEntityLinks({ entities: { not: 'a list' } })).toEqual([]);
    expect(readEntityLinks({})).toEqual([]);
    expect(readEntityLinks(null)).toEqual([]);
  });
});

describe('the link that is written', () => {
  it('is the name alone when that leads to the entity, and the whole path when another note of that name is in the way', () => {
    expect(nameLink('Mara')).toBe('[[Mara]]');
    expect(pathLink('Novel/World/Items/Lamp.md', 'Lamp')).toBe('[[Novel/World/Items/Lamp|Lamp]]');
    expect(linkTo('Mara', 'Novel/World/Characters/Mara.md', 'Novel/Manuscript/Opening.md', resolve)).toBe('[[Mara]]');
    // From a scene, "Lamp" leads to the scene of that name beside it, not to the item.
    expect(resolve('Lamp', 'Novel/Manuscript/Opening.md')).toBe('Novel/Manuscript/Lamp.md');
    expect(linkTo('Lamp', 'Novel/World/Items/Lamp.md', 'Novel/Manuscript/Opening.md', resolve)).toBe('[[Novel/World/Items/Lamp|Lamp]]');
    expect(resolve('Novel/World/Items/Lamp', 'Novel/Manuscript/Opening.md')).toBe('Novel/World/Items/Lamp.md');
  });
});

describe('changing a note\'s list', () => {
  const leadsToMara = (entry: string): boolean => /mara/i.test(entry);

  it('adds a link at the end, and makes the list when there is none', () => {
    const empty: Record<string, unknown> = { status: 'To do' };
    expect(addEntityLink(empty, '[[Mara]]', () => false)).toBe('changed');
    expect(empty).toEqual({ status: 'To do', entities: ['[[Mara]]'] });
    expect(addEntityLink(empty, '[[Saltwick]]', () => false)).toBe('changed');
    expect(empty['entities']).toEqual(['[[Mara]]', '[[Saltwick]]']);
  });

  it('adds nothing when the list already has a link that leads to the same note', () => {
    const frontmatter = { entities: ['[[World/Characters/Mara|The keeper]]'] };
    expect(addEntityLink(frontmatter, '[[Mara]]', leadsToMara)).toBe('unchanged');
    expect(addEntityLink(frontmatter, '[[World/Characters/Mara|The keeper]]', () => false)).toBe('unchanged');
    expect(frontmatter.entities).toEqual(['[[World/Characters/Mara|The keeper]]']);
  });

  it('turns one text into a list, and keeps entries it does not understand', () => {
    const one: Record<string, unknown> = { entities: '[[Mara]]' };
    expect(addEntityLink(one, '[[Saltwick]]', () => false)).toBe('changed');
    expect(one['entities']).toEqual(['[[Mara]]', '[[Saltwick]]']);
    const odd: Record<string, unknown> = { entities: ['[[Mara]]', 7] };
    expect(addEntityLink(odd, '[[Saltwick]]', () => false)).toBe('changed');
    expect(odd['entities']).toEqual(['[[Mara]]', 7, '[[Saltwick]]']);
  });

  it('leaves a property that is not a list of links exactly as it is', () => {
    for (const value of [{ who: 'Mara' }, 7, true]) {
      const frontmatter: Record<string, unknown> = { entities: value };
      expect(addEntityLink(frontmatter, '[[Mara]]', () => false)).toBe('unreadable');
      expect(removeEntityLink(frontmatter, () => true)).toBe('unreadable');
      expect(frontmatter['entities']).toBe(value);
    }
  });

  it('takes out every entry that leads to the note, keeps the others in order, and takes an empty list away', () => {
    const frontmatter: Record<string, unknown> = { entities: ['[[Saltwick]]', '[[Mara]]', '[[Lamp]]', '[[World/Characters/Mara|M]]'], status: 'Done' };
    expect(removeEntityLink(frontmatter, leadsToMara)).toBe('changed');
    expect(frontmatter['entities']).toEqual(['[[Saltwick]]', '[[Lamp]]']);
    expect(removeEntityLink(frontmatter, leadsToMara)).toBe('unchanged');
    expect(removeEntityLink(frontmatter, () => true)).toBe('changed');
    expect(frontmatter).toEqual({ status: 'Done' });
    expect(removeEntityLink({}, () => true)).toBe('unchanged');
  });
});

describe('who is where', () => {
  const entities = readEntities(
    [
      { path: 'World/Characters/Mara.md', frontmatter: { type: 'character' } },
      { path: `World/Characters/${MARA_HE}.md`, frontmatter: { type: 'character' } },
      { path: 'World/Places/Saltwick.md', frontmatter: { type: 'place' } },
      { path: 'World/Items/Lamp.md', frontmatter: { type: 'item' } },
    ],
    BUILT_IN_TYPES,
  );
  const scene = (name: string, links: unknown, there = true): LinkingNote => ({
    path: `Manuscript/${name}.md`,
    vaultPath: there ? `Novel/Manuscript/${name}.md` : null,
    title: name,
    frontmatter: links === undefined ? null : { entities: links },
  });
  const links = buildWorldLinks({
    entities,
    entityVaultPath: (path) => `Novel/${path}`,
    scenes: [
      scene('Closing', ['[[Saltwick]]', '[[Mara]]']),
      scene('Opening', ['[[Mara]]', '[[Novel/World/Items/Lamp|Lamp]]', '[[Mara#Background]]', '[[Tides]]', '[[Nobody]]', `[[${MARA_HE}]]`]),
      scene('Quiet', undefined),
      scene('Ghost', ['[[Mara]]'], false),
    ],
    events: [{ path: 'Timeline/The fire.md', vaultPath: 'Novel/Timeline/The fire.md', title: 'The fire', frontmatter: { entities: '[[Saltwick]]' } }],
    resolve,
  });

  it('gives each entity its scenes in binder order, each scene once', () => {
    expect(links.scenesOf('World/Characters/Mara.md')).toEqual([
      { path: 'Manuscript/Closing.md', title: 'Closing' },
      { path: 'Manuscript/Opening.md', title: 'Opening' },
    ]);
    expect(links.scenesOf('World/Places/Saltwick.md').map((entry) => entry.title)).toEqual(['Closing']);
    expect(links.scenesOf('World/Items/Lamp.md').map((entry) => entry.title)).toEqual(['Opening']);
    expect(links.scenesOf(`World/Characters/${MARA_HE}.md`).map((entry) => entry.title)).toEqual(['Opening']);
    expect(links.scenesOf('World/Characters/Nobody.md')).toEqual([]);
  });

  it('gives each entity the timeline events that list it', () => {
    expect(links.eventsOf('World/Places/Saltwick.md')).toEqual([{ path: 'Timeline/The fire.md', title: 'The fire' }]);
    expect(links.eventsOf('World/Characters/Mara.md')).toEqual([]);
  });

  it('gives each scene its entries as written, and says which lead to no entity', () => {
    expect(links.linksOf('Manuscript/Opening.md').map((link) => [link.raw, link.label, link.entity?.path ?? null])).toEqual([
      ['[[Mara]]', 'Mara', 'World/Characters/Mara.md'],
      ['[[Novel/World/Items/Lamp|Lamp]]', 'Lamp', 'World/Items/Lamp.md'],
      ['[[Mara#Background]]', 'Mara', 'World/Characters/Mara.md'],
      ['[[Tides]]', 'Tides', null], // a research note is not an entity
      ['[[Nobody]]', 'Nobody', null], // a link that leads nowhere
      [`[[${MARA_HE}]]`, MARA_HE, `World/Characters/${MARA_HE}.md`],
    ]);
    expect(links.linksOf('Manuscript/Quiet.md')).toEqual([]);
    // A scene whose note is missing: its links cannot be followed.
    expect(links.linksOf('Manuscript/Ghost.md').map((link) => link.entity)).toEqual([null]);
  });
});

describe('the vault doorway resolves links', () => {
  it('in the memory vault, the way Obsidian does: by path, or by name wherever the note is', () => {
    const vault = new MemoryVault();
    for (const path of PATHS) vault.seed(path, { body: '' });
    expect(vault.resolveLink('Mara', 'Novel/Manuscript/Opening.md')).toBe('Novel/World/Characters/Mara.md');
    expect(vault.resolveLink('mara', 'Novel/Manuscript/Opening.md')).toBe('Novel/World/Characters/Mara.md');
    expect(vault.resolveLink('Novel/World/Characters/Mara.md', 'Novel/Manuscript/Opening.md')).toBe('Novel/World/Characters/Mara.md');
    expect(vault.resolveLink('Characters/Mara', 'Novel/Manuscript/Opening.md')).toBe('Novel/World/Characters/Mara.md');
    expect(vault.resolveLink('Nobody', 'Novel/Manuscript/Opening.md')).toBeNull();
    expect(vault.resolveLink('', 'Novel/Manuscript/Opening.md')).toBeNull();
  });
});
