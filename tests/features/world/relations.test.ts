// Relations between entities, and an entity's picture: how each is written
// in a note's properties, how what a writer typed by hand is read, and what
// the screens are told. What is checked hardest: an entry is one ordinary
// link and nothing else (so that Obsidian's own graph, backlinks and
// renaming know it), a relation is seen from both sides while it is written
// on one, and a picture that is missing or broken is no picture.

import { describe, expect, it } from 'vitest';
import { IMAGE_EXTENSIONS, isImagePath } from '../../../src/core/paths';
import {
  BUILT_IN_TYPES,
  IMAGE_KEY,
  RELATED_KEY,
  RELATION_LABEL_MAX,
  addRelation,
  buildRelations,
  groupRelations,
  imageLink,
  parseRelation,
  readEntities,
  readImageTarget,
  readRelationEntries,
  relabelRelation,
  relationTo,
  removeRelation,
  resolveImage,
  searchImages,
  setImage,
  tidyLabel,
  writeRelation,
} from '../../../src/core/world';
import type { LinkResolver } from '../../../src/core/world';
import type { Frontmatter } from '../../../src/core/types';
import { ObsidianVault } from '../../../src/obsidian/obsidianVault';
import { FakeObsidian, note } from '../../fakeObsidianApp';
import { MemoryVault } from '../../memoryVault';

/** "sister" and "Tamar", in Hebrew. */
const SISTER = 'אחות';
const TAMAR = 'תמר';

describe('an entry of "related", as it is written', () => {
  it('is one ordinary link: the label is the name the link shows, and an entry without one is a bare link', () => {
    expect(RELATED_KEY).toBe('related');
    expect(writeRelation('Noa', 'sister')).toBe('[[Noa|sister]]');
    expect(writeRelation('The Old Lighthouse', 'kept it for thirty years')).toBe('[[The Old Lighthouse|kept it for thirty years]]');
    expect(writeRelation('Noa', '')).toBe('[[Noa]]');
    expect(writeRelation(TAMAR, `  ${SISTER} `)).toBe(`[[${TAMAR}|${SISTER}]]`);
    // By its whole path when the name alone would lead elsewhere; without a label the link shows the note's name.
    expect(writeRelation('World/Characters/Noa', 'sister')).toBe('[[World/Characters/Noa|sister]]');
    expect(writeRelation('World/Characters/Noa', '')).toBe('[[World/Characters/Noa|Noa]]');
    // Nothing but the link: no text before it or after it, whatever the label.
    for (const label of ['sister', 'a | b', 'see [[Mara]]', 'two\nlines', '']) {
      expect(writeRelation('Noa', label)).toMatch(/^\[\[[^[\]]+\]\]$/);
    }
  });

  it('keeps a label on one line, without the characters a link is written with, and not too long', () => {
    expect(tidyLabel('  older   sister\n')).toBe('older sister');
    expect(tidyLabel('a | b [c]')).toBe('a b c');
    expect(tidyLabel('x'.repeat(200))).toHaveLength(RELATION_LABEL_MAX);
  });

  it('is read back as it was written', () => {
    expect(parseRelation('[[Noa|sister]]')).toEqual({ target: 'Noa', label: 'sister' });
    expect(parseRelation('[[Noa]]')).toEqual({ target: 'Noa', label: '' });
    expect(parseRelation(`[[${TAMAR}|${SISTER}]]`)).toEqual({ target: TAMAR, label: SISTER });
    expect(parseRelation('[[World/Characters/Noa|sister]]')).toEqual({ target: 'World/Characters/Noa', label: 'sister' });
    // A link by its path that only shows the note's own name has no label.
    expect(parseRelation('[[World/Characters/Noa|Noa]]')).toEqual({ target: 'World/Characters/Noa', label: '' });
    for (const [target, label] of [['Noa', 'sister'], ['Noa', ''], ['World/Characters/Noa', ''], [TAMAR, SISTER]] as const) {
      expect(parseRelation(writeRelation(target, label))).toEqual({ target, label });
    }
  });

  it('reads what a writer may type by hand: the label after the link, or a bare name', () => {
    for (const typed of ['[[Noa]] | sister', '[[Noa]] sister', '[[Noa]] - sister', '[[Noa]]: sister', '  [[Noa]]   |   sister  ']) {
      expect(parseRelation(typed), typed).toEqual({ target: 'Noa', label: 'sister' });
    }
    // A label after the link wins over the name the link shows.
    expect(parseRelation('[[World/Characters/Noa|Noa]] | sister')).toEqual({ target: 'World/Characters/Noa', label: 'sister' });
    expect(parseRelation('Noa')).toEqual({ target: 'Noa', label: '' });
    expect(parseRelation('Noa | sister')).toEqual({ target: 'Noa', label: 'sister' });
    expect(parseRelation('[[Noa#Background|sister]]')).toEqual({ target: 'Noa', label: 'sister' });
    for (const not of [null, 7, '', '   ', '[[]]', ['[[Noa]]'], { link: 'Noa' }]) expect(parseRelation(not), JSON.stringify(not)).toBeNull();
  });

  it('is read from a list, or from one text', () => {
    expect(readRelationEntries({ related: ['[[Noa|sister]]', '', 7, '[[Saltwick]]'] })).toEqual(['[[Noa|sister]]', '[[Saltwick]]']);
    expect(readRelationEntries({ related: '[[Noa]]' })).toEqual(['[[Noa]]']);
    expect(readRelationEntries({ related: { not: 'a list' } })).toEqual([]);
    expect(readRelationEntries(null)).toEqual([]);
  });

  it('is written by name when that leads to the entity, and by its whole path when another note of that name is in the way', () => {
    const resolve: LinkResolver = (target) => (target === 'Noa' ? 'Novel/World/Characters/Noa.md' : target === 'Lamp' ? 'Novel/Manuscript/Lamp.md' : null);
    expect(relationTo('Noa', 'Novel/World/Characters/Noa.md', 'Novel/World/Characters/Mara.md', resolve, 'friend')).toBe('[[Noa|friend]]');
    expect(relationTo('Lamp', 'Novel/World/Items/Lamp.md', 'Novel/World/Characters/Mara.md', resolve, 'carries')).toBe('[[Novel/World/Items/Lamp|carries]]');
    expect(relationTo('Lamp', 'Novel/World/Items/Lamp.md', 'Novel/World/Characters/Mara.md', resolve, '')).toBe('[[Novel/World/Items/Lamp|Lamp]]');
  });
});

describe('changing a note\'s relations', () => {
  const never = (): boolean => false;

  it('adds an entry at the end, makes the list when there is none, and touches no other property', () => {
    const frontmatter: Frontmatter = { type: 'character', role: 'Keeper', summary: 'Keeps the light.' };
    expect(addRelation(frontmatter, '[[Noa|sister]]', never)).toBe('changed');
    expect(addRelation(frontmatter, '[[Saltwick]]', never)).toBe('changed');
    expect(frontmatter).toEqual({ type: 'character', role: 'Keeper', summary: 'Keeps the light.', related: ['[[Noa|sister]]', '[[Saltwick]]'] });
  });

  it('relates one entity to another once, however the entry that is there is written', () => {
    const frontmatter: Frontmatter = { related: ['[[World/Characters/Noa|Noa]] | sister'] };
    expect(addRelation(frontmatter, '[[Noa|friend]]', (entry) => entry.includes('Noa'))).toBe('unchanged');
    expect(addRelation(frontmatter, '[[World/Characters/Noa|Noa]] | sister', never)).toBe('unchanged');
    expect(frontmatter['related']).toEqual(['[[World/Characters/Noa|Noa]] | sister']);
  });

  it('gives an entry another label and keeps its link, also for one typed by hand', () => {
    const frontmatter: Frontmatter = { related: ['[[Noa]] | sister', '[[Saltwick|lives in]]', 'not a link ]]'] };
    expect(relabelRelation(frontmatter, '[[Noa]] | sister', 'older sister')).toBe('changed');
    expect(relabelRelation(frontmatter, '[[Saltwick|lives in]]', '')).toBe('changed');
    expect(frontmatter['related']).toEqual(['[[Noa|older sister]]', '[[Saltwick]]', 'not a link ]]']);
    expect(relabelRelation(frontmatter, '[[Saltwick]]', '')).toBe('unchanged');
    expect(relabelRelation(frontmatter, '[[Gone|x]]', 'y')).toBe('unchanged');
  });

  it('takes one entry out, keeps the others in order, and takes an empty list away with its key', () => {
    const frontmatter: Frontmatter = { summary: 'x', related: ['[[Noa|sister]]', '[[Saltwick]]'] };
    expect(removeRelation(frontmatter, '[[Gone]]')).toBe('unchanged');
    expect(removeRelation(frontmatter, '[[Noa|sister]]')).toBe('changed');
    expect(frontmatter).toEqual({ summary: 'x', related: ['[[Saltwick]]'] });
    expect(removeRelation(frontmatter, '[[Saltwick]]')).toBe('changed');
    expect(frontmatter).toEqual({ summary: 'x' });
  });

  it('leaves a property that is not a list of links exactly as it is', () => {
    for (const change of [
      (frontmatter: Frontmatter) => addRelation(frontmatter, '[[Noa]]', never),
      (frontmatter: Frontmatter) => relabelRelation(frontmatter, '[[Noa]]', 'x'),
      (frontmatter: Frontmatter) => removeRelation(frontmatter, '[[Noa]]'),
    ]) {
      const frontmatter: Frontmatter = { related: { family: ['Noa'] } };
      expect(change(frontmatter)).toBe('unreadable');
      expect(frontmatter).toEqual({ related: { family: ['Noa'] } });
    }
  });
});

describe('who has to do with whom', () => {
  const notes = [
    { path: 'World/Characters/Noa.md', frontmatter: { type: 'character', related: ['[[Tamar|sister]]', '[[The Archive|keeps]]', '[[Nobody|friend]]', '[[Noa]]'] } },
    { path: 'World/Characters/Tamar.md', frontmatter: { type: 'character' } },
    { path: 'World/Characters/Mara.md', frontmatter: { type: 'character', related: ['[[The Archive]] | works in', '[[The Archive|again]]', '[[Noa]]'] } },
    { path: 'World/Places/The Archive.md', frontmatter: { type: 'place', related: '[[Noa|kept by]]' } },
    { path: 'World/Loose.md', frontmatter: { related: ['[[Tamar]]'] } },
  ];
  const entities = readEntities(notes, BUILT_IN_TYPES);
  const paths = notes.map((item) => `Novel/${item.path}`);
  const resolve: LinkResolver = (target) => paths.find((path) => path.endsWith(`/${target}.md`)) ?? null;
  const relations = buildRelations({ entities, entityVaultPath: (path) => `Novel/${path}`, resolve });

  it('gives each entity its own entries in the order written, and says which lead to no entity', () => {
    expect(relations.of('World/Characters/Noa.md').map((relation) => [relation.name, relation.label, relation.entity?.path ?? null])).toEqual([
      ['Tamar', 'sister', 'World/Characters/Tamar.md'],
      ['The Archive', 'keeps', 'World/Places/The Archive.md'],
      ['Nobody', 'friend', null],
      ['Noa', '', 'World/Characters/Noa.md'],
    ]);
    expect(relations.of('World/Characters/Noa.md')[0]?.raw).toBe('[[Tamar|sister]]');
    expect(relations.of('World/Characters/Tamar.md')).toEqual([]);
    expect(relations.of('World/Gone.md')).toEqual([]);
  });

  it('shows the other side the relation too, without anything written there: "mentioned by"', () => {
    // Tamar lists nobody: she is mentioned by Noa (as her sister) and by the loose note.
    expect(relations.mentionedBy('World/Characters/Tamar.md').map((relation) => [relation.entity.name, relation.label])).toEqual([
      ['Loose', ''],
      ['Noa', 'sister'],
    ]);
    expect(notes[1]?.frontmatter).toEqual({ type: 'character' });
  });

  it('counts an entity that lists another twice once, and never an entity for itself', () => {
    expect(relations.mentionedBy('World/Places/The Archive.md').map((relation) => [relation.entity.name, relation.label])).toEqual([['Mara', 'works in']]);
    // Noa lists the archive herself, so the archive is under her own relations and not also "mentioned by".
    expect(relations.mentionedBy('World/Characters/Noa.md').map((relation) => relation.entity.name)).toEqual(['Mara']);
  });

  it('groups them by the other entity\'s type, in the order of the types, with what has none last', () => {
    const groups = groupRelations(relations.of('World/Characters/Noa.md'), BUILT_IN_TYPES);
    expect(groups.map((group) => [group.name, group.relations.map((relation) => relation.name)])).toEqual([
      ['Characters', ['Tamar', 'Noa']],
      ['Places', ['The Archive']],
      ['Other', ['Nobody']],
    ]);
    const back = groupRelations(relations.mentionedBy('World/Characters/Tamar.md'), BUILT_IN_TYPES);
    expect(back.map((group) => [group.name, group.relations.map((relation) => relation.entity.name)])).toEqual([
      ['Characters', ['Noa']],
      ['Other', ['Loose']],
    ]);
    expect(groupRelations([], BUILT_IN_TYPES)).toEqual([]);
  });
});

describe('an entity\'s picture', () => {
  const files = ['Novel/World/Characters/Mara.md', 'Pictures/mara.png', 'Pictures/Places/harbour.JPG', 'Other/mara.png', 'Notes/Plain.md'];
  const vault = (): MemoryVault => {
    const made = new MemoryVault();
    for (const path of files) made.seed(path, {});
    return made;
  };
  const MARA = 'Novel/World/Characters/Mara.md';

  it('is a file whose name ends like a picture\'s, whatever its capitals', () => {
    expect(IMAGE_EXTENSIONS).toEqual(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']);
    for (const path of ['a.png', 'Pictures/b.JPG', 'c.jpeg', 'd.webp', 'e.svg', 'Deep/Down/f.Gif']) expect(isImagePath(path), path).toBe(true);
    for (const path of ['a.md', 'png', '.png', 'Pictures/notes.png.md', 'movie.mp4', 'Pictures.png/note']) expect(isImagePath(path), path).toBe(false);
  });

  it('is named in "image" as a bare link to the file; a path, an embed and an unquoted link are read as well', () => {
    expect(IMAGE_KEY).toBe('image');
    expect(readImageTarget({ image: '[[mara.png]]' })).toBe('mara.png');
    expect(readImageTarget({ image: '[[Pictures/mara.png]]' })).toBe('Pictures/mara.png');
    expect(readImageTarget({ image: '![[mara.png|200]]' })).toBe('mara.png');
    expect(readImageTarget({ image: ' Pictures/mara.png ' })).toBe('Pictures/mara.png');
    // image: [[mara.png]] without quotes is, to YAML, a list in a list.
    expect(readImageTarget({ image: [['mara.png']] })).toBe('mara.png');
    for (const not of [undefined, null, '', '  ', '[[]]', 7, ['a.png', 'b.png'], 'a | b', { file: 'mara.png' }]) {
      expect(readImageTarget({ image: not }), JSON.stringify(not)).toBeNull();
    }
    expect(readImageTarget(null)).toBeNull();
  });

  it('leads to the file the vault takes the link to, by name or by path', () => {
    const made = vault();
    const resolve: LinkResolver = (target, from) => made.resolveLink(target, from);
    expect(resolveImage({ image: '[[Pictures/mara.png]]' }, MARA, resolve)).toBe('Pictures/mara.png');
    expect(resolveImage({ image: '[[harbour.JPG]]' }, MARA, resolve)).toBe('Pictures/Places/harbour.JPG');
    expect(resolveImage({ image: 'Other/mara.png' }, MARA, resolve)).toBe('Other/mara.png');
  });

  it('is no picture when the note names none, the file is not there, or it is not a picture: the type\'s icon is shown instead', () => {
    const made = vault();
    const resolve: LinkResolver = (target, from) => made.resolveLink(target, from);
    expect(resolveImage({ summary: 'No picture.' }, MARA, resolve)).toBeNull();
    expect(resolveImage({ image: '[[gone.png]]' }, MARA, resolve)).toBeNull();
    expect(resolveImage({ image: '[[Plain]]' }, MARA, resolve)).toBeNull(); // a note, not a picture
    expect(resolveImage({ image: '[[Notes/Plain.md]]' }, MARA, resolve)).toBeNull();
    expect(resolveImage(null, MARA, resolve)).toBeNull();
  });

  it('is written as a bare link: the file\'s name when that leads to it, its whole path when another file of that name is in the way', () => {
    const made = vault();
    const resolve: LinkResolver = (target, from) => made.resolveLink(target, from);
    expect(imageLink('Pictures/Places/harbour.JPG', MARA, resolve)).toBe('[[harbour.JPG]]');
    // Two files are called mara.png: the name alone leads to one of them only.
    expect(made.resolveLink('mara.png', MARA)).toBe('Other/mara.png');
    expect(imageLink('Other/mara.png', MARA, resolve)).toBe('[[mara.png]]');
    expect(imageLink('Pictures/mara.png', MARA, resolve)).toBe('[[Pictures/mara.png]]');
    for (const path of ['Pictures/mara.png', 'Other/mara.png', 'Pictures/Places/harbour.JPG']) {
      expect(resolveImage({ image: imageLink(path, MARA, resolve) }, MARA, resolve), path).toBe(path);
    }
  });

  it('is set and taken away as one property, and nothing else of the note', () => {
    const frontmatter: Frontmatter = { type: 'character', role: 'Keeper', aliases: [] };
    expect(setImage(frontmatter, '[[mara.png]]')).toBe(true);
    expect(frontmatter).toEqual({ type: 'character', role: 'Keeper', aliases: [], image: '[[mara.png]]' });
    expect(setImage(frontmatter, '[[mara.png]]')).toBe(false);
    expect(setImage(frontmatter, null)).toBe(true);
    expect(frontmatter).toEqual({ type: 'character', role: 'Keeper', aliases: [] });
    expect(setImage(frontmatter, null)).toBe(false);
  });

  it('is chosen from the pictures of the vault, searched by every word typed', () => {
    const images = vault().listImageFiles();
    expect(images).toEqual(['Other/mara.png', 'Pictures/Places/harbour.JPG', 'Pictures/mara.png']);
    expect(searchImages(images, '')).toEqual(images);
    expect(searchImages(images, 'MARA pictures')).toEqual(['Pictures/mara.png']);
    expect(searchImages(images, 'harbour')).toEqual(['Pictures/Places/harbour.JPG']);
    expect(searchImages(images, 'dragon')).toEqual([]);
  });
});

describe('the vault doorway and pictures', () => {
  it('lists the pictures of the vault and gives each an address to show it at, in the memory vault', () => {
    const vault = new MemoryVault().seed('A/one.png', {}).seed('B/two.md', {}).seed('C/three.webp', {});
    expect(vault.listImageFiles()).toEqual(['A/one.png', 'C/three.webp']);
    expect(vault.resourceUrl('A/one.png')).toMatch(/A\/one\.png$/);
    expect(vault.resourceUrl('A/gone.png')).toBeNull();
    expect(vault.writes).toEqual([]);
  });

  it('does the same through Obsidian, reading and changing nothing', () => {
    const fake = new FakeObsidian();
    fake.addNote('Novel/World/Characters/Mara.md', note({ type: 'character', image: '[[mara.png]]' }, ''));
    fake.addNote('Pictures/mara.png', 'not really a picture');
    fake.addNote('Pictures/Old/harbour.jpeg', 'nor is this');
    fake.addNote('Notes/Plain.md', 'x');
    const vault = new ObsidianVault(fake.app);
    vault.start();
    fake.finishStartup();
    expect(vault.listImageFiles()).toEqual(['Pictures/Old/harbour.jpeg', 'Pictures/mara.png']);
    expect(vault.resourceUrl('Pictures/mara.png')).toMatch(/Pictures\/mara\.png$/);
    expect(vault.resourceUrl('Pictures/gone.png')).toBeNull();
    expect(vault.resourceUrl('Pictures')).toBeNull(); // a folder is not a picture
    // Obsidian's own index of links takes a link with a file's ending to that file.
    expect(vault.resolveLink('mara.png', 'Novel/World/Characters/Mara.md')).toBe('Pictures/mara.png');
    expect(fake.calls).toEqual([]);
    vault.stop();
  });
});
