// The pure side of templates: the starting structures, the placeholders,
// what a scene or an entry takes from a template, and project templates.

import { describe, expect, it } from 'vitest';
import { starterProject } from '../../src/core/projectSeed';
import {
  BLANK_STRUCTURE_ID,
  DEFAULT_CHAPTERS,
  LIBRARY_CHOICE_PREFIX,
  LIBRARY_FOLDER,
  MAX_CHAPTERS,
  STRUCTURES,
  allWorldTemplates,
  describeSize,
  entityStart,
  fillPlaceholders,
  fillValue,
  findStructure,
  isLibraryPath,
  isProjectTemplate,
  isSceneTemplatePath,
  isStructureFolder,
  isTemplatePath,
  libraryChoices,
  libraryPathOf,
  outlineOf,
  partsOfBinder,
  previewOf,
  projectChoices,
  projectTemplateNote,
  readChapterCount,
  readProjectTemplate,
  sceneStart,
  sceneTemplateOf,
  sceneTemplates,
  seedOfParts,
  worldTemplateFolderOf,
  worldTemplateOf,
  worldTemplates,
} from '../../src/core/templates';
import type { StructurePart, StructureScene } from '../../src/core/templates';
import type { TreeNode } from '../../src/core/types';

const VALUES = { title: 'הנמל', date: '2026-10-14', project: 'My Novel' };

/** Every scene of a list of parts, in order. */
function scenesOf(parts: readonly StructurePart[]): StructureScene[] {
  return parts.flatMap((part) => (isStructureFolder(part) ? scenesOf(part.children) : [part]));
}

describe('the starting structures', () => {
  it('are offered in order: blank first, then three acts, fifteen steps, the twelve stages and chapters', () => {
    expect(STRUCTURES.map((structure) => [structure.id, structure.name])).toEqual([
      ['blank', 'Blank'],
      ['three-acts', 'Three acts'],
      ['fifteen-steps', 'A fifteen-beat outline'],
      ['heros-journey', "The hero's journey"],
      ['chapters', 'Chapter by chapter'],
    ]);
    expect(STRUCTURES[0]?.id).toBe(BLANK_STRUCTURE_ID);
    for (const structure of STRUCTURES) {
      expect(structure.description.length, structure.id).toBeGreaterThan(20);
      expect(structure.description.includes('\n'), structure.id).toBe(false);
      expect(findStructure(structure.id)).toBe(structure);
    }
    expect(findStructure('nothing')).toBeNull();
    expect(STRUCTURES.filter((structure) => structure.asksForChapters).map((structure) => structure.id)).toEqual(['chapters']);
  });

  it('blank makes exactly what a new project always had: one empty scene', () => {
    const blank = findStructure('blank');
    const parts = blank?.parts(DEFAULT_CHAPTERS) ?? [];
    expect(outlineOf(parts)).toEqual([{ kind: 'scene', title: 'Scene 1', depth: 0 }]);
    expect(seedOfParts(parts).binder.map((seed) => ('title' in seed ? seed.title : ''))).toEqual(starterProject().binder.map((seed) => ('title' in seed ? seed.title : '')));
  });

  it('give every placeholder a synopsis in plain words and a status of "To do"', () => {
    for (const structure of STRUCTURES.filter((each) => each.id !== 'blank')) {
      const scenes = scenesOf(structure.parts(3));
      expect(scenes.length, structure.id).toBeGreaterThan(0);
      for (const scene of scenes) {
        expect(scene.synopsis.trim().length, `${structure.id}: ${scene.title}`).toBeGreaterThan(10);
      }
      const seed = seedOfParts(structure.parts(3));
      const statuses = new Set<string>();
      const walk = (list: typeof seed.binder): void => {
        for (const item of list) {
          if ('folder' in item) walk(item.children);
          else statuses.add(item.status ?? '');
        }
      };
      walk(seed.binder);
      expect([...statuses], structure.id).toEqual(['To do']);
    }
  });

  it('have the parts they promise', () => {
    const count = (id: string, chapters = 3): [number, number] => {
      const lines = outlineOf(findStructure(id)?.parts(chapters) ?? []);
      return [lines.filter((line) => line.kind === 'folder').length, lines.filter((line) => line.kind === 'scene').length];
    };
    expect(count('three-acts')).toEqual([3, 10]);
    expect(count('fifteen-steps')).toEqual([3, 15]);
    expect(count('heros-journey')).toEqual([3, 12]);
    expect(count('chapters', 4)).toEqual([4, 4]);
    expect(outlineOf(findStructure('chapters')?.parts(2) ?? [])).toEqual([
      { kind: 'folder', title: 'Chapter 1', depth: 0 },
      { kind: 'scene', title: 'Chapter 1, scene 1', depth: 1 },
      { kind: 'folder', title: 'Chapter 2', depth: 0 },
      { kind: 'scene', title: 'Chapter 2, scene 1', depth: 1 },
    ]);
  });

  it('name no commercial method', () => {
    const words = STRUCTURES.flatMap((structure) => [
      structure.name,
      structure.description,
      ...outlineOf(structure.parts(2)).map((line) => line.title),
      ...scenesOf(structure.parts(2)).map((scene) => scene.synopsis),
    ]).join(' ');
    expect(words).not.toMatch(/save the cat|snyder|vogler|campbell|catalyst|b story|fun and games|dark night of the soul|bad guys close in|elixir|inmost cave|refusal of the call/i);
  });

  it('read a number of chapters only when it is a whole number in range', () => {
    expect(readChapterCount('12')).toBe(12);
    expect(readChapterCount(' 3 ')).toBe(3);
    expect(readChapterCount(1)).toBe(1);
    expect(readChapterCount(String(MAX_CHAPTERS))).toBe(MAX_CHAPTERS);
    for (const bad of ['0', '-2', '2.5', 'twelve', '', String(MAX_CHAPTERS + 1), '١٢']) expect(readChapterCount(bad), bad).toBeNull();
    // An unreadable count gives the usual number of chapters, never none.
    expect(outlineOf(findStructure('chapters')?.parts(0) ?? []).filter((line) => line.kind === 'folder')).toHaveLength(DEFAULT_CHAPTERS);
  });

  it('say how much they make', () => {
    expect(describeSize(findStructure('three-acts')?.parts(1) ?? [])).toBe('3 folders and 10 scenes');
    expect(describeSize(findStructure('chapters')?.parts(1) ?? [])).toBe('1 folder and 1 scene');
    expect(describeSize(findStructure('blank')?.parts(1) ?? [])).toBe('1 scene');
  });

  it('become a seed with the label and text of a scene that has them', () => {
    const seed = seedOfParts([{ folder: 'פרק', children: [{ title: 'A', synopsis: 'S', label: 'Red', text: 'Once.' }, { title: 'B', synopsis: '' }] }]);
    expect(seed).toEqual({
      binder: [{ folder: 'פרק', children: [{ title: 'A', synopsis: 'S', status: 'To do', label: 'Red', body: 'Once.' }, { title: 'B', synopsis: '', status: 'To do' }] }],
    });
  });
});

describe('placeholders', () => {
  it('fill in the title, the date and the project, whatever their capitals and spaces', () => {
    expect(fillPlaceholders('# {{title}}\n{{ Date }} in {{PROJECT}}', VALUES)).toBe('# הנמל\n2026-10-14 in My Novel');
    expect(fillPlaceholders('{{title}}{{title}}', VALUES)).toBe('הנמלהנמל');
  });

  it('leave every other word in braces alone', () => {
    expect(fillPlaceholders('{{time}} {{tp.date}} {title} {{ title', VALUES)).toBe('{{time}} {{tp.date}} {title} {{ title');
  });

  it('fill in the texts inside properties, and leave other values as they are', () => {
    const value = { a: '{{title}}', b: ['{{date}}', 3], c: true, d: null };
    expect(fillValue(value, VALUES)).toEqual({ a: 'הנמל', b: ['2026-10-14', 3], c: true, d: null });
    expect(value.a).toBe('{{title}}'); // a copy
  });
});

describe('what a scene or an entry takes from a template', () => {
  const template = {
    frontmatter: { synopsis: 'About {{title}}', status: 'First draft', label: 'Blue', order: 9, created: '2020-01-01', edited: '2020-01-02', spellbook: 'project', mood: '{{project}}' },
    body: '## {{title}}\n\nWritten on {{date}}.\n',
  };

  it('a scene takes the properties and the text, but never the plugin\'s own or a project mark', () => {
    expect(sceneStart(template, VALUES)).toEqual({
      frontmatter: { synopsis: 'About הנמל', status: 'First draft', label: 'Blue', mood: 'My Novel' },
      body: '## הנמל\n\nWritten on 2026-10-14.\n',
    });
  });

  it('an entry keeps its type and its fields, with the template on top', () => {
    const base = { type: 'character', role: '', summary: '', aliases: [] };
    const made = entityStart(base, { frontmatter: { type: 'place', role: 'Keeper of {{title}}', eyes: 'grey', 'spellbook-template': 'project' }, body: '{{title}}' }, VALUES);
    expect(made).toEqual({ frontmatter: { type: 'character', role: 'Keeper of הנמל', summary: '', aliases: [], eyes: 'grey' }, body: 'הנמל' });
    expect(base.role).toBe(''); // the base is not changed
  });

  it('a scene saved as a template leaves out what belongs to it alone', () => {
    const scene = { synopsis: 'S', status: 'Final', label: '', compile: true, order: 2048, created: '2026-01-01', edited: '2026-02-01', date: '1890-03-01', entities: ['[[Mara]]'], pov: 'Mara' };
    expect(sceneTemplateOf(scene, 'Text.')).toEqual({ frontmatter: { synopsis: 'S', status: 'Final', label: '', compile: true, pov: 'Mara' }, body: 'Text.' });
    expect(sceneTemplateOf(null, '')).toEqual({ frontmatter: {}, body: '' });
  });

  it('an entry saved as a template keeps its type and fields, without its names, picture, relations and dates', () => {
    const entry = { type: 'character', role: 'Keeper', aliases: ['the keeper'], image: '[[m.png]]', related: ['[[Anna]]'], date: '1850', end: '1890', moments: [], summary: '' };
    expect(worldTemplateOf(entry, '## Notes\n')).toEqual({ frontmatter: { type: 'character', role: 'Keeper', summary: '' }, body: '## Notes\n' });
  });
});

describe('where templates are', () => {
  it('knows the folders', () => {
    expect(isTemplatePath('Templates')).toBe(true);
    expect(isTemplatePath('Templates/Scenes/A.md')).toBe(true);
    expect(isTemplatePath('Templatesx/A.md')).toBe(false);
    expect(isSceneTemplatePath('Templates/Scenes/A.md')).toBe(true);
    expect(isSceneTemplatePath('Templates/Scenes/Deep/A.md')).toBe(false);
    expect(worldTemplateFolderOf('Templates/World/Characters/Hero.md')).toBe('Characters');
    expect(worldTemplateFolderOf('Templates/World/Hero.md')).toBeNull();
    expect(worldTemplateFolderOf('Templates/World/Characters/Deep/Hero.md')).toBeNull();
    expect(isLibraryPath(LIBRARY_FOLDER)).toBe(true);
    expect(isLibraryPath(`${LIBRARY_FOLDER}/A.md`)).toBe(true);
    expect(isLibraryPath('Novel/Spellbook templates/A.md')).toBe(false);
  });

  it('lists the scene templates and the templates of a type, by name', () => {
    const notes = [
      { path: 'Templates/Scenes/Zebra.md' },
      { path: 'Templates/Scenes/סצנה.md' },
      { path: 'Templates/Scenes/Action.md' },
      { path: 'Templates/Scenes/picture.png' },
      { path: 'Templates/World/Characters/Hero.md' },
      { path: 'Templates/World/character/Villain.md' },
      { path: 'Templates/World/Places/Town.md' },
      { path: 'Manuscript/Opening.md' },
    ];
    expect(sceneTemplates(notes).map((entry) => entry.name)).toEqual(['Action', 'Zebra', 'סצנה']);
    const character = { id: 'character', name: 'Character', folder: 'Characters' };
    expect(worldTemplates(notes, character).map((entry) => entry.path)).toEqual(['Templates/World/Characters/Hero.md', 'Templates/World/character/Villain.md']);
    expect(worldTemplates(notes, { id: 'item', name: 'Item', folder: 'Items' })).toEqual([]);
    expect(allWorldTemplates(notes).map((entry) => [entry.folder, entry.name])).toEqual([
      ['character', 'Villain'],
      ['Characters', 'Hero'],
      ['Places', 'Town'],
    ]);
  });
});

describe('project templates', () => {
  const tree: TreeNode[] = [
    { kind: 'scene', path: 'Manuscript/Prologue.md', title: 'Prologue', missing: false },
    {
      kind: 'folder',
      id: 'f-1',
      name: 'חלק ראשון',
      children: [{ kind: 'scene', path: 'Manuscript/Night.md', title: 'Night', missing: false }],
    },
    { kind: 'folder', id: 'f-2', name: 'Empty', children: [] },
  ];
  const facts = (path: string): { synopsis: string; label: string; text: string | null } =>
    path === 'Manuscript/Night.md' ? { synopsis: 'Dark\nand long', label: 'Red', text: 'It was night.' } : { synopsis: '', label: '', text: null };

  it('are made from the binder, with the text only when it is given', () => {
    const parts = partsOfBinder(tree, facts);
    expect(parts).toEqual([
      { title: 'Prologue', synopsis: '' },
      { folder: 'חלק ראשון', children: [{ title: 'Night', synopsis: 'Dark\nand long', label: 'Red', text: 'It was night.' }] },
      { folder: 'Empty', children: [] },
    ]);
    const note = projectTemplateNote('  Saved   from "My Novel" ', parts);
    expect(note.frontmatter).toEqual({
      'spellbook-template': 'project',
      description: 'Saved from "My Novel"',
      structure: [
        { title: 'Prologue', synopsis: '' },
        { folder: 'חלק ראשון', children: [{ title: 'Night', synopsis: 'Dark\nand long', label: 'Red', text: 'It was night.' }] },
        { folder: 'Empty', children: [] },
      ],
    });
    expect(note.body).toContain('- Prologue\n- **חלק ראשון**\n  - Night: Dark and long\n- **Empty**\n');
    expect(isProjectTemplate(note.frontmatter)).toBe(true);
  });

  it('are read back as they were saved', () => {
    const note = projectTemplateNote('Mine', partsOfBinder(tree, facts));
    expect(readProjectTemplate(note.frontmatter)).toEqual({ description: 'Mine', parts: partsOfBinder(tree, facts) });
  });

  it('leave out what cannot be understood, and are nothing without a mark or without parts', () => {
    expect(readProjectTemplate(null)).toBeNull();
    expect(readProjectTemplate({ structure: [{ title: 'A' }] })).toBeNull();
    expect(readProjectTemplate({ 'spellbook-template': 'project', structure: [] })).toBeNull();
    expect(readProjectTemplate({ 'spellbook-template': 'project', structure: 'nonsense' })).toBeNull();
    expect(
      readProjectTemplate({
        'spellbook-template': 'project',
        structure: [{ title: '' }, 'text', null, { folder: '  ' }, { title: 7, synopsis: 3 }, { folder: 'F', children: 'no' }],
      }),
    ).toEqual({ description: '', parts: [{ title: '7', synopsis: '3' }, { folder: 'F', children: [] }] });
  });

  it('are offered after the built-in structures, by name, only when they are directly in the folder and marked', () => {
    const template = projectTemplateNote('Mine', [{ title: 'One', synopsis: 'First' }]).frontmatter;
    const notes = [
      { path: `${LIBRARY_FOLDER}/Zed.md`, frontmatter: template },
      { path: `${LIBRARY_FOLDER}/אלף.md`, frontmatter: { ...template, description: '' } },
      { path: `${LIBRARY_FOLDER}/Plain.md`, frontmatter: { tags: ['x'] } },
      { path: `${LIBRARY_FOLDER}/Deep/Inner.md`, frontmatter: template },
      { path: `${LIBRARY_FOLDER}/Unread.md`, frontmatter: null },
    ];
    const library = libraryChoices(notes);
    expect(library.map((choice) => [choice.id, choice.name, choice.description])).toEqual([
      [`${LIBRARY_CHOICE_PREFIX}${LIBRARY_FOLDER}/Zed.md`, 'Zed', 'Mine'],
      [`${LIBRARY_CHOICE_PREFIX}${LIBRARY_FOLDER}/אלף.md`, 'אלף', 'A project template of your own.'],
    ]);
    expect(projectChoices(notes).map((choice) => choice.name)).toEqual(['Blank', 'Three acts', 'A fifteen-beat outline', "The hero's journey", 'Chapter by chapter', 'Zed', 'אלף']);
    expect(libraryPathOf(library[0]?.id ?? '')).toBe(`${LIBRARY_FOLDER}/Zed.md`);
    expect(libraryPathOf('three-acts')).toBeNull();
    expect(previewOf(library[0] as (typeof library)[number], 1)).toEqual({ lines: [{ kind: 'scene', title: 'One', depth: 0 }], size: '1 scene' });
  });
});
