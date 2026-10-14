// "Create project" with a choice of starting structure: the window (through
// the stand-in for Obsidian's form pieces), and the whole plugin creating a
// project from a built-in structure and from a project template of the vault.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_FOLDER, STRUCTURES, projectChoices, projectTemplateNote } from '../../src/core/templates';
import type { StartChoice } from '../../src/core/templates';
import SpellbookPlugin from '../../src/main';
import { BAD_CHAPTERS_TEXT, CreateProjectModal } from '../../src/ui/createProjectModal';
import type { ProjectStart } from '../../src/ui/createProjectModal';
import { FakeObsidian, note } from '../fakeObsidianApp';
import { Modal as StubModal, Notice as StubNotice, resetFakeDocument } from '../obsidianStub';
import type { ButtonComponent, DropdownComponent, FakeElement, Plugin as StubPlugin, StubCommand, TextComponent } from '../obsidianStub';
import { draw } from '../storeHarness';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  StubNotice.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
});

interface Opened {
  modal: StubModal;
  name: TextComponent;
  create: ButtonComponent;
  structure: () => FakeElement;
  dropdown: () => DropdownComponent;
  chapters: () => TextComponent | null;
  preview: () => string[];
  calls: Array<[string, string, ProjectStart]>;
}

function openModal(choices: readonly StartChoice[] = STRUCTURES): Opened {
  const calls: Opened['calls'] = [];
  const real = new CreateProjectModal({} as never, ['', 'Writing'], async (name, parentFolder, start) => {
    calls.push([name, parentFolder, start]);
    return true;
  }, choices);
  real.open();
  const modal = real as unknown as StubModal;
  const rows = modal.contentEl.settings;
  const structure = (): FakeElement => modal.contentEl.withClass('spellbook-create-structure')[0] as FakeElement;
  return {
    modal,
    name: rows[0]?.components[0] as TextComponent,
    create: rows[2]?.components[1] as ButtonComponent,
    structure,
    dropdown: () => structure().settings[0]?.components[0] as DropdownComponent,
    chapters: () => (structure().settings[1]?.components[0] as TextComponent | undefined) ?? null,
    preview: () =>
      structure()
        .withClass('spellbook-create-preview-name')
        .map((name) => name.text),
    calls,
  };
}

describe('the Create project window with starting structures', () => {
  it('keeps its own rows (name, location, buttons), and offers the structures in a place of their own, Blank first', () => {
    const window = openModal();
    expect(window.modal.contentEl.settings.map((row) => row.nameEl.text)).toEqual(['Name', 'Location', '']);
    expect(window.structure().settings[0]?.nameEl.text).toBe('Structure');
    expect(window.dropdown().selectEl.children.map((option) => [option.value, option.text, option.attrs['dir']])).toEqual(
      STRUCTURES.map((structure) => [structure.id, structure.name, 'auto']),
    );
    expect(window.dropdown().getValue()).toBe('blank');
    expect(window.structure().settings[0]?.descEl.text).toMatch(/One empty scene/);
    expect(window.preview()).toEqual(['Scene 1']);
    expect(window.chapters()).toBeNull();
  });

  it('describes the chosen structure and lists what it will make', () => {
    const window = openModal();
    window.dropdown().choose('heros-journey');
    expect(window.structure().settings[0]?.descEl.text).toMatch(/Twelve stages/);
    expect(window.preview()).toHaveLength(15);
    expect(window.preview().slice(0, 3)).toEqual(['Leaving', 'At home', 'The summons']);
    expect(window.structure().withClass('spellbook-create-preview-size')[0]?.text).toBe('It will make 3 folders and 12 scenes:');
    for (const name of window.structure().withClass('spellbook-create-preview-name')) expect(name.attrs['dir']).toBe('auto');
  });

  it('asks how many chapters for "Chapter by chapter", and hands the answer over', async () => {
    const window = openModal();
    window.dropdown().choose('chapters');
    const chapters = window.chapters();
    expect(chapters?.getValue()).toBe('12');
    expect(chapters?.inputEl.attrs['inputmode']).toBe('numeric');
    chapters?.type('3');
    expect(window.preview()).toEqual(['Chapter 1', 'Chapter 1, scene 1', 'Chapter 2', 'Chapter 2, scene 1', 'Chapter 3', 'Chapter 3, scene 1']);
    window.name.type('ספר');
    window.create.click();
    await tick();
    expect(window.calls).toEqual([['ספר', '', { choice: 'chapters', chapters: 3 }]]);
  });

  it('will not create with a number of chapters that will not do, and says why', async () => {
    const window = openModal();
    window.dropdown().choose('chapters');
    window.chapters()?.type('0');
    window.name.type('Book');
    window.create.click();
    await tick();
    expect(window.calls).toEqual([]);
    expect(window.structure().withClass('spellbook-create-message')[0]?.text).toBe(BAD_CHAPTERS_TEXT);
    expect(window.modal.isOpen).toBe(true);
  });

  it('hands over the blank structure when nothing else is chosen', async () => {
    const window = openModal();
    window.name.type('Book');
    window.create.click();
    await tick();
    expect(window.calls).toEqual([['Book', '', { choice: 'blank', chapters: 12 }]]);
  });

  it('shows no structure at all when given none, and hands over the blank one', async () => {
    const window = openModal([]);
    expect(window.modal.contentEl.withClass('spellbook-create-structure')).toEqual([]);
    window.name.type('Book');
    window.create.click();
    await tick();
    expect(window.calls[0]?.[2]).toEqual({ choice: 'blank', chapters: 12 });
  });
});

// ------------------------------------------------------------ the whole plugin

const MANIFEST = { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' };
const plugins: SpellbookPlugin[] = [];

afterEach(() => {
  for (const plugin of plugins.splice(0)) plugin.unload();
});

function loadReady(fake: FakeObsidian): { plugin: SpellbookPlugin; command: (id: string) => StubCommand } {
  const plugin = new SpellbookPlugin(fake.app, MANIFEST as never);
  plugins.push(plugin);
  plugin.onload();
  fake.finishStartup();
  const stub = plugin as unknown as StubPlugin;
  return {
    plugin,
    command: (id) => {
      const found = stub.commands.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`no command "${id}"`);
      return found;
    },
  };
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (check()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

const notices = (): string[] => StubNotice.shown.map((shown) => shown.message);

describe('creating a project with a structure, in the plugin', () => {
  it('makes the folders and scenes of the chosen structure and opens the first scene', async () => {
    const fake = new FakeObsidian();
    const { plugin } = loadReady(fake);
    expect(await plugin.createProject('Book', '', { choice: 'fifteen-steps', chapters: 12 })).toBe(true);
    expect(draw(plugin.store?.project?.tree ?? [])).toMatch(/^Beginning\[First glimpse The question/);
    expect(plugin.store?.project?.tree.length).toBe(3);
    expect(notices()).toEqual(['Created the project "Book" with 15 scenes.']);
    expect(fake.workspace.opened).toEqual(['Book/Manuscript/First glimpse.md']);
    expect(fake.textOf('Book/Manuscript/First glimpse.md')).toContain('"status": "To do"');
  });

  it('with the blank structure, or none, is what it always was', async () => {
    const fake = new FakeObsidian();
    const { plugin } = loadReady(fake);
    expect(await plugin.createProject('One', '', { choice: 'blank', chapters: 12 })).toBe(true);
    expect(await plugin.createProject('Two')).toBe(true);
    expect(notices()).toEqual(['Created the project "One".', 'Created the project "Two".']);
    expect(draw(plugin.store?.project?.tree ?? [])).toBe('Scene 1');
  });

  it('offers the project templates of the vault in the window, and makes a project from one', async () => {
    const fake = new FakeObsidian();
    const template = projectTemplateNote('Two parts and an end', [
      { folder: 'חלק א', children: [{ title: 'Start', synopsis: 'Where it begins.', text: 'Once there was a harbour.' }] },
      { title: 'End', synopsis: 'Where it ends.' },
    ]);
    fake.addNote(`${LIBRARY_FOLDER}/My shape.md`, note(template.frontmatter, template.body));
    const { plugin, command } = loadReady(fake);
    await until(() => (plugin.store?.libraryNotes().length ?? 0) > 0, 'the template to be indexed');

    command('create-project').callback?.();
    const modal = StubModal.opened[StubModal.opened.length - 1] as StubModal;
    const place = modal.contentEl.withClass('spellbook-create-structure')[0] as FakeElement;
    const dropdown = place.settings[0]?.components[0] as DropdownComponent;
    const id = `library:${LIBRARY_FOLDER}/My shape.md`;
    expect(dropdown.selectEl.children.map((option) => option.text)).toEqual([...STRUCTURES.map((structure) => structure.name), 'My shape']);
    dropdown.choose(id);
    expect(place.settings[0]?.descEl.text).toBe('Two parts and an end');
    (modal.contentEl.settings[0]?.components[0] as TextComponent).type('From shape');
    (modal.contentEl.settings[2]?.components[1] as ButtonComponent).click();
    await until(() => !modal.isOpen, 'the window to close');

    expect(draw(plugin.store?.project?.tree ?? [])).toBe('חלק א[Start] End');
    expect(fake.textOf('From shape/Manuscript/Start.md')).toContain('Once there was a harbour.');
    expect(fake.textOf('From shape/Manuscript/Start.md')).toContain('Where it begins.');
    // The vault's folder of templates is no place for a project.
    expect(plugin.store?.listParentFolders()).not.toContain(LIBRARY_FOLDER);
    expect(projectChoices(plugin.store?.libraryNotes() ?? []).map((choice) => choice.name)).toContain('My shape');
  });

  it('says so, and creates nothing, when the chosen template has gone', async () => {
    const fake = new FakeObsidian();
    const { plugin } = loadReady(fake);
    expect(await plugin.createProject('Book', '', { choice: `library:${LIBRARY_FOLDER}/Gone.md`, chapters: 12 })).toBe(false);
    expect(notices()[0]).toMatch(/no longer there/);
    expect(fake.vault.getFolderByPath('Book')).toBeNull();
  });
});
