// The "Create project" window, driven through the stand-in for Obsidian's
// form pieces (tests/obsidianStub.ts). This checks what the window does with
// the writer's answers; how it looks can only be checked in Obsidian.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateProjectModal, VAULT_ROOT_LABEL } from '../src/ui/createProjectModal';
import type { ButtonComponent, DropdownComponent, Modal as StubModal, TextComponent } from './obsidianStub';

interface Opened {
  modal: StubModal;
  name: TextComponent;
  location: DropdownComponent;
  cancel: ButtonComponent;
  create: ButtonComponent;
  calls: Array<[string, string]>;
  /** Let the pending "create" finish with this answer. */
  finish: (created: boolean) => Promise<void>;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function open(folders: readonly string[] = ['', 'Writing', 'כתיבה']): Opened {
  const calls: Array<[string, string]> = [];
  let settle: ((created: boolean) => void) | null = null;
  const real = new CreateProjectModal({} as never, folders, (name, parentFolder) => {
    calls.push([name, parentFolder]);
    return new Promise<boolean>((resolve) => {
      settle = resolve;
    });
  });
  real.open();
  const modal = real as unknown as StubModal;
  const rows = modal.contentEl.settings;
  return {
    modal,
    name: rows[0]?.components[0] as TextComponent,
    location: rows[1]?.components[0] as DropdownComponent,
    cancel: rows[2]?.components[0] as ButtonComponent,
    create: rows[2]?.components[1] as ButtonComponent,
    calls,
    finish: async (created) => {
      settle?.(created);
      await tick();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Create project window', () => {
  it('asks for a name and a location, with Cancel and Create buttons', () => {
    const { modal, name, cancel, create } = open();
    expect(modal.titleEl.text).toBe('Create project');
    expect(modal.modalEl.classes.has('spellbook-create-project')).toBe(true);
    expect(modal.contentEl.settings.map((row) => row.nameEl.text)).toEqual(['Name', 'Location', '']);
    expect(cancel.buttonEl.text).toBe('Cancel');
    expect(create.buttonEl.text).toBe('Create');
    expect(create.buttonEl.classes.has('mod-cta')).toBe(true);
    expect(name.inputEl.focused).toBe(true);
  });

  it('lets a name in any language choose its own direction', () => {
    const { name, location } = open();
    expect(name.inputEl.attrs['dir']).toBe('auto');
    for (const option of location.selectEl.children) expect(option.attrs['dir'], option.text).toBe('auto');
  });

  it('offers the existing folders, with the top of the vault chosen', () => {
    const { location } = open();
    expect(location.selectEl.children.map((option) => [option.tag, option.value, option.text])).toEqual([
      ['option', '', VAULT_ROOT_LABEL],
      ['option', 'Writing', 'Writing'],
      ['option', 'כתיבה', 'כתיבה'],
    ]);
    expect(location.getValue()).toBe('');
  });

  it('always offers the top of the vault, even when the list given leaves it out', () => {
    expect(open(['Writing']).location.selectEl.children.map((option) => option.value)).toEqual(['', 'Writing']);
    expect(open([]).location.selectEl.children.map((option) => option.value)).toEqual(['']);
  });

  it('hands the answers over on Create, and closes once the project exists', async () => {
    const { modal, name, location, create, calls, finish } = open();
    name.type('My Novel');
    location.choose('Writing');
    create.click();
    expect(calls).toEqual([['My Novel', 'Writing']]);
    expect(modal.isOpen).toBe(true); // still open while the project is being created

    await finish(true);
    expect(modal.isOpen).toBe(false);
    expect(modal.contentEl.settings).toEqual([]);
  });

  it('uses the top of the vault when no location is picked', async () => {
    const { name, create, calls, finish } = open();
    name.type('הרומן שלי');
    create.click();
    expect(calls).toEqual([['הרומן שלי', '']]);
    await finish(true);
  });

  it('stays open when the project was not created, so the name can be changed', async () => {
    const { modal, name, create, calls, finish } = open();
    name.type('Taken');
    create.click();
    await finish(false);
    expect(modal.isOpen).toBe(true);
    expect(create.disabled).toBe(false);

    name.type('Free');
    create.click();
    expect(calls).toEqual([['Taken', ''], ['Free', '']]);
    await finish(true);
    expect(modal.isOpen).toBe(false);
  });

  it('cannot be submitted twice while the project is being created', async () => {
    const { name, create, calls, finish } = open();
    name.type('Novel');
    create.click();
    expect(create.disabled).toBe(true);
    create.click();
    name.inputEl.dispatch('keydown', { key: 'Enter', isComposing: false, preventDefault: () => undefined });
    expect(calls).toHaveLength(1);
    await finish(true);
  });

  it('creates on Enter in the name field', async () => {
    const { modal, name, calls, finish } = open();
    name.type('Novel');
    let prevented = false;
    name.inputEl.dispatch('keydown', { key: 'Enter', isComposing: false, preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(calls).toEqual([['Novel', '']]);
    await finish(true);
    expect(modal.isOpen).toBe(false);
  });

  it('ignores other keys, and Enter while a character is still being composed', () => {
    const { name, calls } = open();
    name.type('Novel');
    name.inputEl.dispatch('keydown', { key: 'a', isComposing: false, preventDefault: () => undefined });
    name.inputEl.dispatch('keydown', { key: 'Enter', isComposing: true, preventDefault: () => undefined });
    expect(calls).toEqual([]);
  });

  it('ignores the Enter that accepts a suggested word on iPhone and iPad', async () => {
    // There the composition has already ended when the key arrives: isComposing
    // is false, and only the key code 229 says an input method handled the key.
    const { modal, name, calls, finish } = open();
    name.type('しょうせつ');
    let prevented = false;
    name.inputEl.dispatch('keydown', { key: 'Enter', isComposing: false, keyCode: 229, preventDefault: () => { prevented = true; } });
    expect(calls).toEqual([]);
    expect(prevented).toBe(false); // the key is left to the keyboard
    expect(modal.isOpen).toBe(true);

    // The next, ordinary Enter creates the project.
    name.type('小説');
    name.inputEl.dispatch('keydown', { key: 'Enter', isComposing: false, keyCode: 13, preventDefault: () => undefined });
    expect(calls).toEqual([['小説', '']]);
    await finish(true);
    expect(modal.isOpen).toBe(false);
  });

  it('closes on Cancel without creating anything', () => {
    const { modal, name, cancel, calls } = open();
    name.type('Novel');
    cancel.click();
    expect(modal.isOpen).toBe(false);
    expect(calls).toEqual([]);
  });

  it('stays open and usable if creating fails unexpectedly', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    const real = new CreateProjectModal({} as never, [''], async () => {
      attempts++;
      throw new Error('boom');
    });
    real.open();
    const modal = real as unknown as StubModal;
    const create = modal.contentEl.settings[2]?.components[1] as ButtonComponent;

    create.click();
    await tick();
    expect(modal.isOpen).toBe(true);
    expect(create.disabled).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
    create.click();
    await tick();
    expect(attempts).toBe(2);
  });
});
