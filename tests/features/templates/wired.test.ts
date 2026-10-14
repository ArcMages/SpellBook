// Templates as they are plugged into the plugin: the commands that save a
// scene, an entry of the World or the whole project as a template, "New
// character" offering the World templates, and the settings section that
// lists templates with Open and Delete. What is written is read from the
// memory vault; how the windows look can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_FOLDER, readProjectTemplate } from '../../../src/core/templates';
import { SaveProjectTemplateModal, TEMPLATES_COMMANDS, TEMPLATES_SECTION_ID } from '../../../src/features/templates/index';
import { PLAIN_ENTITY_CHOICE } from '../../../src/features/world/newEntity';
import { ConfirmModal } from '../../../src/ui/confirmModal';
import { TextPromptModal } from '../../../src/ui/textPromptModal';
import { MemoryVault } from '../../memoryVault';
import { DropdownComponent, FakeElement, Modal as StubModal, Notice as StubNotice, ButtonComponent, TextComponent, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import { TODAY, settle, tick } from '../../storeHarness';
import { LETTER_BODY, MARA, NIGHT_TITLE, OPENING, OPENING_BODY, inNovel, novelVault } from '../world/stage';
import { wire } from './stage';
import type { Wired } from './stage';

const stages: Wired[] = [];

async function stage(vault: MemoryVault = novelVault(), open?: string | null): Promise<Wired> {
  const made = await wire(vault, open);
  stages.push(made);
  return made;
}

beforeEach(() => {
  StubNotice.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
  resetPlatform();
});

afterEach(() => {
  for (const made of stages.splice(0)) made.switchOff();
  resetPlatform();
});

type OpenWindow = StubModal & { contentEl: FakeElement; titleEl: FakeElement };

function lastWindow(): OpenWindow {
  const open = StubModal.opened.filter((modal) => modal.isOpen);
  const modal = open[open.length - 1];
  if (!modal) throw new Error('no window is open');
  return modal as OpenWindow;
}

async function calm(s: Wired): Promise<void> {
  for (let turn = 0; turn < 6; turn++) {
    await settle(s.store);
    await tick();
    s.timers.advance(0);
  }
}

function promptInput(): FakeElement {
  const input = lastWindow().contentEl.withClass('spellbook-prompt-input')[0];
  if (!input) throw new Error('no field');
  return input;
}

/** Type into the window that asks for a name and press Enter. */
async function answer(s: Wired, text: string): Promise<void> {
  const input = promptInput();
  input.value = text;
  input.fire('input');
  input.fire('keydown', { key: 'Enter' });
  await calm(s);
}

const offered = (s: Wired, id: string): boolean => s.command(id).checkCallback?.(true) === true;
const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

describe('the commands', () => {
  it('are there, each asked first whether it can do anything', async () => {
    const s = await stage();
    for (const command of Object.values(TEMPLATES_COMMANDS)) {
      expect(s.command(command.id).name).toBe(command.name);
      expect(typeof s.command(command.id).checkCallback).toBe('function');
    }
    expect(Object.values(TEMPLATES_COMMANDS).map((command) => command.id)).toEqual(['save-scene-as-template', 'save-as-world-template', 'save-project-as-template']);
  });

  it('offer to save a scene only on a scene, an entry only on an entry, and a project only when one is open', async () => {
    const s = await stage();
    s.activate(null);
    expect([offered(s, 'save-scene-as-template'), offered(s, 'save-as-world-template'), offered(s, 'save-project-as-template')]).toEqual([false, false, true]);
    s.activate(inNovel(OPENING));
    expect([offered(s, 'save-scene-as-template'), offered(s, 'save-as-world-template')]).toEqual([true, false]);
    s.activate(inNovel(MARA));
    expect([offered(s, 'save-scene-as-template'), offered(s, 'save-as-world-template')]).toEqual([false, true]);
    s.activate('Notes/Plain.md');
    expect([offered(s, 'save-scene-as-template'), offered(s, 'save-as-world-template')]).toEqual([false, false]);

    const none = await stage(novelVault(), null);
    none.activate(inNovel(OPENING));
    expect([offered(none, 'save-scene-as-template'), offered(none, 'save-as-world-template'), offered(none, 'save-project-as-template')]).toEqual([false, false, false]);
  });
});

describe('Save scene as template', () => {
  it('asks for a name, starting from the scene\'s, and saves its properties and text in Templates/Scenes', async () => {
    const s = await stage();
    s.activate(inNovel(OPENING));
    s.command('save-scene-as-template').checkCallback?.(false);
    expect(lastWindow()).toBeInstanceOf(TextPromptModal);
    expect(lastWindow().titleEl.text).toBe('Save scene as template');
    expect(promptInput().value).toBe('Opening');
    await answer(s, 'סצנת נמל');

    const path = inNovel('Templates/Scenes/סצנת נמל.md');
    // What belongs to that scene alone (its order key, who is in it) is left out.
    expect(s.vault.frontmatterOf(path)).toEqual({ status: 'To do' });
    expect(s.vault.bodyOf(path)).toBe(OPENING_BODY);
    expect(s.vault.writes.map((write) => write.op).filter((op) => op !== 'createFolder')).toEqual(['createFile']);
    expect(notices()).toEqual(['Saved the template "סצנת נמל" in "Templates/Scenes".']);
    // The scene itself is untouched.
    expect(s.vault.writesTo(inNovel(OPENING))).toEqual([]);
  });

  it('says so, and stays open, when the name is taken', async () => {
    const vault = novelVault();
    vault.seed(inNovel('Templates/Scenes/Opening.md'), { body: 'mine' });
    const s = await stage(vault);
    s.activate(inNovel(OPENING));
    s.command('save-scene-as-template').checkCallback?.(false);
    await answer(s, 'Opening');
    expect(lastWindow().isOpen).toBe(true);
    expect(lastWindow().contentEl.withClass('spellbook-prompt-message')[0]?.text).toMatch(/already a template/);
    expect(s.vault.bodyOf(inNovel('Templates/Scenes/Opening.md'))).toBe('mine');
  });
});

describe('Save as World template, and New character from it', () => {
  it('saves the entry\'s type, fields and text in Templates/World/Characters, and New character offers it', async () => {
    const s = await stage();
    s.activate(inNovel(MARA));
    s.command('save-as-world-template').checkCallback?.(false);
    expect(promptInput().value).toBe('Mara');
    await answer(s, 'Keeper');

    const path = inNovel('Templates/World/Characters/Keeper.md');
    expect(s.vault.frontmatterOf(path)).toEqual({ type: 'character', role: 'Lighthouse keeper', age: 34, appearance: '', goal: '', summary: 'Keeps the light, and a secret.' });
    expect(s.vault.bodyOf(path)).toBe('## Description\n\nHer story so far.\n');
    // A template is not an entity of the World.
    expect(s.store.worldNotes().map((note) => note.path)).not.toContain('Templates/World/Characters/Keeper.md');

    // Make the template say something with placeholders, as a writer might.
    s.vault.seed(path, { frontmatter: { type: 'character', role: 'Keeper of {{project}}', summary: '' }, body: '# {{title}}\n\nFirst seen {{date}}.\n' });
    await calm(s);

    s.command('new-character').callback?.();
    const row = lastWindow().contentEl.withClass('spellbook-prompt-choice-row')[0];
    const list = row?.settings[0]?.components[0];
    expect(list).toBeInstanceOf(DropdownComponent);
    const dropdown = list as DropdownComponent;
    expect(dropdown.selectEl.children.map((option) => [option.value, option.text])).toEqual([
      ['', PLAIN_ENTITY_CHOICE],
      ['Templates/World/Characters/Keeper.md', 'Keeper'],
    ]);
    dropdown.choose('Templates/World/Characters/Keeper.md');
    await answer(s, 'Joss Hale');

    const made = inNovel('World/Characters/Joss Hale.md');
    expect(s.vault.frontmatterOf(made)).toEqual({
      type: 'character',
      role: 'Keeper of My Novel',
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
    expect(s.vault.bodyOf(made)).toBe(`# Joss Hale\n\nFirst seen ${TODAY}.\n`);
    expect(s.opened.map((entry) => entry.path)).toContain(made);
  });

  it('New place offers nothing when there are only templates for characters', async () => {
    const vault = novelVault();
    vault.seed(inNovel('Templates/World/Characters/Keeper.md'), { frontmatter: { type: 'character' }, body: '' });
    const s = await stage(vault);
    s.command('new-place').callback?.();
    expect(lastWindow().contentEl.withClass('spellbook-prompt-choice-row')).toEqual([]);
    await answer(s, 'The Pier');
    expect(s.vault.bodyOf(inNovel('World/Places/The Pier.md'))).toMatch(/## Description/);
  });
});

describe('Save project as template', () => {
  function form(): { name: TextComponent; description: TextComponent; includeText: () => void; save: ButtonComponent } {
    const window = lastWindow();
    expect(window).toBeInstanceOf(SaveProjectTemplateModal);
    const rows = window.contentEl.settings;
    const toggle = rows[2]?.toggles[0];
    return {
      name: rows[0]?.components[0] as TextComponent,
      description: rows[1]?.components[0] as TextComponent,
      includeText: () => toggle?.flip(),
      save: rows[3]?.components[1] as ButtonComponent,
    };
  }

  it('saves the folders and the scenes\' titles and synopses, not their text, in the vault\'s template folder', async () => {
    const vault = novelVault();
    vault.seed(inNovel(OPENING), { frontmatter: { status: 'Final', order: 1024, synopsis: 'The lamp is lit.', label: 'Red' }, body: OPENING_BODY });
    const s = await stage(vault);
    s.command('save-project-as-template').checkCallback?.(false);
    const window = form();
    expect(window.name.getValue()).toBe('My Novel');
    expect(window.description.getValue()).toBe('Saved from "My Novel"');
    expect(window.name.inputEl.attrs['dir']).toBe('auto');
    window.name.type('Harbour shape');
    window.save.click();
    await calm(s);

    const path = `${LIBRARY_FOLDER}/Harbour shape.md`;
    const read = readProjectTemplate(s.vault.frontmatterOf(path));
    expect(read).toEqual({
      description: 'Saved from "My Novel"',
      parts: [
        { title: 'Opening', synopsis: 'The lamp is lit.', label: 'Red' },
        { folder: 'Part one', children: [{ title: 'The Letter', synopsis: '' }, { title: NIGHT_TITLE, synopsis: '' }] },
        { title: 'Closing', synopsis: '' },
      ],
    });
    expect(JSON.stringify(s.vault.frontmatterOf(path))).not.toContain('lamp. The harbour');
    expect(s.vault.bodyOf(path)).toContain('- Opening: The lamp is lit.');
    expect(lastWindow).toThrow(); // the window closed
    expect(notices()).toEqual(['Saved the project template "Harbour shape". "Create project" offers it from now on.']);
    // Nothing of the project was changed.
    expect(s.vault.writes.filter((write) => write.path.startsWith('Novel/'))).toEqual([]);
  });

  it('keeps the text of the scenes when asked', async () => {
    const s = await stage();
    s.command('save-project-as-template').checkCallback?.(false);
    const window = form();
    window.name.type('With text');
    window.includeText();
    window.save.click();
    await calm(s);
    const read = readProjectTemplate(s.vault.frontmatterOf(`${LIBRARY_FOLDER}/With text.md`));
    const part = read?.parts[1];
    expect(part && 'folder' in part ? part.children[0] : null).toEqual({ title: 'The Letter', synopsis: '', text: LETTER_BODY.trim() });
  });

  it('says so in the window when the name is taken, and replaces nothing', async () => {
    const vault = novelVault();
    vault.seed(`${LIBRARY_FOLDER}/My Novel.md`, { body: 'mine' });
    const s = await stage(vault);
    s.command('save-project-as-template').checkCallback?.(false);
    form().save.click();
    await calm(s);
    expect(lastWindow().contentEl.withClass('spellbook-template-message')[0]?.text).toMatch(/already a template/);
    expect(s.vault.bodyOf(`${LIBRARY_FOLDER}/My Novel.md`)).toBe('mine');
  });
});

describe('the settings section', () => {
  function render(s: Wired): { place: FakeElement; close: () => void } {
    const section = s.features.settingsSections.find((entry) => entry.id === TEMPLATES_SECTION_ID);
    if (!section) throw new Error('no section');
    const place = new FakeElement('div');
    const close = section.render(place as unknown as HTMLElement);
    return { place, close: typeof close === 'function' ? close : () => undefined };
  }
  const rowsOf = (place: FakeElement): Array<[string, string]> => place.settings.map((row) => [row.nameEl.text, row.descEl.text]);

  it('says how to make templates when there are none', async () => {
    const s = await stage();
    const { place, close } = render(s);
    const rows = rowsOf(place);
    expect(rows[0]?.[0]).toBe('In this project');
    expect(rows[1]?.[1]).toMatch(/no templates yet/);
    expect(rows[2]?.[0]).toBe('For new projects');
    expect(rows[3]?.[1]).toMatch(/Save project as template/);
    close();
  });

  it('lists the templates found, opens them and moves them to the trash after asking', async () => {
    const vault = novelVault();
    vault.seed(inNovel('Templates/Scenes/Action.md'), { body: '' });
    vault.seed(inNovel('Templates/World/Places/Town.md'), { body: '' });
    vault.seed(`${LIBRARY_FOLDER}/Shape.md`, { frontmatter: { 'spellbook-template': 'project', structure: [{ title: 'A' }] }, body: '' });
    vault.seed(`${LIBRARY_FOLDER}/Shopping.md`, { body: 'not a template' });
    const s = await stage(vault);
    const { place, close } = render(s);
    expect(rowsOf(place).filter(([name]) => ['Action', 'Town', 'Shape'].includes(name))).toEqual([
      ['Action', 'For new scenes'],
      ['Town', 'For new entries of the World in "Places"'],
      ['Shape', 'Offered by "Create project"'],
    ]);
    expect(rowsOf(place).some(([name]) => name === 'Shopping')).toBe(false);
    const row = (name: string): ButtonComponent[] => place.settings.find((entry) => entry.nameEl.text === name)?.components as ButtonComponent[];

    row('Action')[0]?.click();
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel('Templates/Scenes/Action.md'), where: 'tab' }]);

    row('Shape')[1]?.click();
    expect(lastWindow()).toBeInstanceOf(ConfirmModal);
    (lastWindow().contentEl.settings[0]?.components[1] as ButtonComponent).click();
    await calm(s);
    expect(s.vault.trashed).toEqual([`${LIBRARY_FOLDER}/Shape.md`]);
    expect(rowsOf(place).some(([name]) => name === 'Shape')).toBe(false);

    row('Town')[1]?.click();
    (lastWindow().contentEl.settings[0]?.components[1] as ButtonComponent).click();
    await calm(s);
    expect(s.vault.trashed).toEqual([`${LIBRARY_FOLDER}/Shape.md`, inNovel('Templates/World/Places/Town.md')]);
    close();
  });
});
