// The AI helper as the writer meets it: the command, the note it writes and
// the windows around it. The real feature runs on a vault in memory
// (stage.ts).
//
// What these tests are for, above all: the note is written in one fixed
// place of the open project and nowhere else; a copy the writer changed is
// never written over without their say-so; and no other note is touched.

import { beforeEach, describe, expect, it } from 'vitest';
import { AI_HELPER_FILE, AI_HELPER_FOLDER } from '../../../src/core/projectLayout';
import { classifyNote } from '../../../src/core/progress/index';
import {
  AIHELPER_COMMANDS,
  CHANGED_AGAIN_TEXT,
  CLOSE_TEXT,
  COULD_NOT_OPEN_TEXT,
  CREATED_TEXT,
  CREATED_TITLE,
  HELPER_NOTE_PATH,
  HELPER_TEXT,
  NO_PROJECT_TEXT,
  OPEN_TEXT,
  READY_TEXT,
  READY_TITLE,
  REPLACED_TITLE,
  REPLACE_CONFIRM,
  REPLACE_TEXT,
  REPLACE_TITLE,
  isShippedText,
} from '../../../src/features/aihelper/index';
import { Modal as StubModal, Notice as StubNotice } from '../../obsidianStub';
import { HELPER, NOVEL_INDEX, OPENING_TEXT, SECOND_INDEX, button, calm, lastWindow, messageOf, novelVault, runCommand, wire } from './stage';
import type { Wired } from './stage';

beforeEach(() => {
  StubModal.opened.length = 0;
  StubNotice.shown.length = 0;
});

const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

/** The text of every note in the vault but the helper note, by path: to show that nothing else changed. */
function othersOf(stage: Wired): Record<string, string> {
  return Object.fromEntries(
    stage.vault
      .paths()
      .filter((path) => path !== HELPER)
      .map((path) => [path, stage.vault.textOf(path)]),
  );
}

describe('the command', () => {
  it('is called "Create AI helper note"', async () => {
    const stage = await wire();
    expect(stage.plugin.commands.map((command) => [command.id, command.name])).toEqual([['create-ai-helper-note', 'Create AI helper note']]);
    expect(AIHELPER_COMMANDS.createNote.id).toBe('create-ai-helper-note');
    expect(HELPER_NOTE_PATH).toBe(`${AI_HELPER_FOLDER}/${AI_HELPER_FILE}`);
    expect(HELPER_NOTE_PATH).toBe('AI helper/Spellbook for AI assistants.md');
    expect(stage.vault.writes).toEqual([]); // registering writes nothing
  });

  it('says so when no project is open, and writes nothing', async () => {
    const stage = await wire(novelVault(), null);
    await runCommand(stage);
    expect(notices()).toEqual([NO_PROJECT_TEXT]);
    expect(StubModal.opened).toEqual([]);
    expect(stage.vault.writes).toEqual([]);
  });
});

describe('making the note', () => {
  it('makes the folder and the note in the open project, with the shipped text, and changes nothing else', async () => {
    const stage = await wire();
    const before = othersOf(stage);
    await runCommand(stage);

    expect(stage.vault.hasFolder('Novel/AI helper')).toBe(true);
    expect(stage.vault.textOf(HELPER)).toBe(HELPER_TEXT);
    expect(stage.vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/AI helper' },
      { op: 'updateText', path: HELPER },
    ]);
    expect(othersOf(stage)).toEqual(before);
    expect(stage.vault.textOf('Novel/Manuscript/Opening.md')).toContain(OPENING_TEXT);
    // Not in the other project, and not at the top of the vault.
    expect(stage.vault.paths().filter((path) => path.endsWith(AI_HELPER_FILE))).toEqual([HELPER]);
    expect(notices()).toEqual([]);
  });

  it('then says where the note is and offers to open it', async () => {
    const stage = await wire();
    await runCommand(stage);
    const window = lastWindow();
    expect(window.isOpen).toBe(true);
    expect(window.titleEl.text).toBe(CREATED_TITLE);
    expect(messageOf(window)).toBe(CREATED_TEXT);
    expect(stage.opened).toEqual([]); // not opened until asked

    button(window, OPEN_TEXT).click();
    await calm(stage);
    expect(window.isOpen).toBe(false);
    expect(stage.opened).toEqual([{ path: HELPER, where: undefined }]);
    expect(notices()).toEqual([]);
  });

  it('opens nothing when the window is closed', async () => {
    const stage = await wire();
    await runCommand(stage);
    const window = lastWindow();
    button(window, CLOSE_TEXT).click();
    await calm(stage);
    expect(window.isOpen).toBe(false);
    expect(stage.opened).toEqual([]);
  });

  it('says so when the note cannot be shown', async () => {
    const stage = await wire();
    stage.canOpen.value = false;
    await runCommand(stage);
    button(lastWindow(), OPEN_TEXT).click();
    await calm(stage);
    expect(notices()).toEqual([COULD_NOT_OPEN_TEXT]);
  });

  it('leaves the project as the screens see it: the note is no scene, no unfiled note and no research note', async () => {
    const stage = await wire();
    const before = stage.store.project;
    await runCommand(stage);
    const after = stage.store.project;
    expect(after?.tree).toEqual(before?.tree);
    expect(after?.unfiled).toEqual([]);
    expect(after?.research).toEqual(['Research/Trains.md']);
    expect(after?.missing).toEqual([]);
    expect(stage.store.worldNotes()).toEqual([]);
    expect(stage.store.timelineNotes()).toEqual([]);
    expect(stage.store.statsFiles()).toEqual([]);
    // It is not found as a second project either.
    expect(stage.store.listProjects().map((project) => project.indexPath).sort()).toEqual([NOVEL_INDEX, SECOND_INDEX]);
    // Words typed in it would be logged as "other" words, like words in a research note: never as manuscript.
    expect(classifyNote(HELPER, { active: 'Novel', folders: ['Novel', 'Second'] })).toEqual({ project: 'Novel', bucket: 'other' });
  });

  it('reports a failed write and leaves no half-made note', async () => {
    const stage = await wire();
    stage.vault.failNext('updateText', HELPER);
    await runCommand(stage);
    expect(stage.vault.has(HELPER)).toBe(false);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toContain('could not be saved');
    expect(StubModal.opened).toEqual([]);
  });
});

describe('a note that is already there', () => {
  it('is left alone when it says what this version ships, and can be opened', async () => {
    const stage = await wire();
    await runCommand(stage);
    stage.vault.clearWrites();
    StubModal.opened.length = 0;

    await runCommand(stage);
    expect(stage.vault.writes).toEqual([]);
    const window = lastWindow();
    expect(window.titleEl.text).toBe(READY_TITLE);
    expect(messageOf(window)).toBe(READY_TEXT);
    button(window, OPEN_TEXT).click();
    await calm(stage);
    expect(stage.opened).toEqual([{ path: HELPER, where: undefined }]);
  });

  it('counts as the same text whatever its line breaks and the space at its end', () => {
    expect(isShippedText(HELPER_TEXT)).toBe(true);
    expect(isShippedText(`${HELPER_TEXT.replace(/\n/g, '\r\n')}\r\n\r\n`)).toBe(true);
    expect(isShippedText(HELPER_TEXT.replace('Spellbook', 'Spellbok'))).toBe(false);
    expect(isShippedText('')).toBe(false);
  });

  it('is never written over without asking when it says something else', async () => {
    const vault = novelVault();
    vault.seed(HELPER, { body: 'My own notes for the assistant.\n' });
    const stage = await wire(vault);
    await runCommand(stage);

    expect(stage.vault.writes).toEqual([]);
    expect(stage.vault.textOf(HELPER)).toBe('My own notes for the assistant.\n');
    const window = lastWindow();
    expect(window.titleEl.text).toBe(REPLACE_TITLE);
    expect(messageOf(window)).toBe(REPLACE_TEXT);

    // Cancel keeps it.
    button(window, 'Cancel').click();
    await calm(stage);
    expect(stage.vault.writes).toEqual([]);
    expect(stage.vault.textOf(HELPER)).toBe('My own notes for the assistant.\n');
    expect(stage.opened).toEqual([]);
  });

  it('is replaced when the writer says so, and the new note is offered', async () => {
    const vault = novelVault();
    vault.seed(HELPER, { body: 'An older reference.\n' });
    const stage = await wire(vault);
    const before = othersOf(stage);
    await runCommand(stage);
    button(lastWindow(), REPLACE_CONFIRM).click();
    await calm(stage);

    expect(stage.vault.textOf(HELPER)).toBe(HELPER_TEXT);
    expect(stage.vault.writes).toEqual([{ op: 'updateText', path: HELPER }]);
    expect(othersOf(stage)).toEqual(before);
    expect(lastWindow().titleEl.text).toBe(REPLACED_TITLE);
    expect(notices()).toEqual([]);
  });

  it('is left alone when it changed again between the question and the answer', async () => {
    const vault = novelVault();
    vault.seed(HELPER, { body: 'An older reference.\n' });
    const stage = await wire(vault);
    await runCommand(stage);
    const question = lastWindow();
    // Another device changes the note while the question is on the screen.
    vault.external.write(HELPER, { body: 'Changed on the phone.\n' });
    await calm(stage);
    stage.vault.clearWrites();

    button(question, REPLACE_CONFIRM).click();
    await calm(stage);
    expect(stage.vault.textOf(HELPER)).toBe('Changed on the phone.\n');
    expect(stage.vault.writes).toEqual([]);
    expect(notices()).toEqual([CHANGED_AGAIN_TEXT]);
  });
});

describe('what cannot be written', () => {
  it('refuses a read-only project', async () => {
    const vault = novelVault();
    vault.seed('Broken/Broken.md', { frontmatter: { spellbook: 'project', version: 1, binder: 'not a list' }, body: '' });
    const stage = await wire(vault, 'Broken/Broken.md');
    expect(stage.store.project?.readOnly).toBe(true);
    await runCommand(stage);
    expect(stage.vault.writes).toEqual([]);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toContain('read-only');
  });

  it('refuses when the binder lists that very note as a scene: its text is the writer\'s', async () => {
    const vault = novelVault();
    vault.seed(NOVEL_INDEX, {
      frontmatter: { spellbook: 'project', version: 1, title: 'My Novel', binder: ['Manuscript/Opening.md', 'ai helper/spellbook for ai assistants.md'] },
      body: 'x',
    });
    vault.seed(HELPER, { body: 'A scene of the novel, oddly named.\n' });
    const stage = await wire(vault);
    await runCommand(stage);
    expect(stage.vault.writes).toEqual([]);
    expect(stage.vault.textOf(HELPER)).toBe('A scene of the novel, oddly named.\n');
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toContain('the binder lists it as a scene');
  });

  it('does nothing once the plugin is switched off', async () => {
    const stage = await wire();
    const command = stage.command('create-ai-helper-note');
    stage.switchOff();
    command.callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stage.vault.has(HELPER)).toBe(false);
    expect(StubModal.opened).toEqual([]);
  });
});
