// The window for a project's statuses and labels, driven through a fake host
// and the stand-in screen (tests/obsidianStub.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CARD_COLORS,
  DEFAULT_STATUSES,
  addTag,
  moveTag,
  readTagLists,
  recolourTag,
  removeTag,
  renameTag,
} from '../../../src/core/cards';
import { TAG_LISTS_TITLE, TagListsModal, openTagLists } from '../../../src/features/corkboard/tagListsModal';
import { ConfirmModal } from '../../../src/ui/confirmModal';
import { TextPromptModal } from '../../../src/ui/textPromptModal';
import { Modal as StubModal, Platform as StubPlatform, fakeDocument, resetPlatform } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import {
  CLOSING,
  DANIEL,
  FakeHost,
  FakeWorkbench,
  HEBREW_SCENE,
  LETTER,
  OPENING,
  answerPrompt,
  clearScreen,
  colorOf,
  lastMenu,
  menuFrom,
  notices,
  novelHost,
  novelIndex,
  novelTree,
  one,
  openWindow,
  openWindows,
  promptMessage,
  rest,
  submenu,
  tap,
  ticked,
  windowButtons,
} from './stage';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
});

function open(host: FakeHost): { modal: TagListsModal; content: FakeElement } {
  const modal = openTagLists(new FakeWorkbench().app, host);
  return { modal, content: modal.contentEl as unknown as FakeElement };
}

const section = (content: FakeElement, kind: 'status' | 'label'): FakeElement => one(content, `spellbook-tags-${kind}`);

/** The rows of one list, top to bottom (without the names that are only used by scenes). */
function rows(content: FakeElement, kind: 'status' | 'label'): FakeElement[] {
  return one(section(content, kind), 'spellbook-tags-list').children;
}

const nameOf = (row: FakeElement): string => one(row, 'spellbook-tag-name').text;
const names = (content: FakeElement, kind: 'status' | 'label'): string[] => rows(content, kind).map(nameOf);

function row(content: FakeElement, kind: 'status' | 'label', name: string): FakeElement {
  const found = rows(content, kind).filter((candidate) => nameOf(candidate) === name);
  if (found.length !== 1) throw new Error(`expected one ${kind} called "${name}", found ${found.length}`);
  return found[0] as FakeElement;
}

const isOff = (button: FakeElement): boolean => button.attrs['aria-disabled'] === 'true';
const lists = (host: FakeHost): ReturnType<typeof readTagLists> => readTagLists(host.index);

describe('the window', () => {
  it('lists the statuses, then the labels, each with its colour and its name', () => {
    const { modal, content } = open(novelHost());
    expect(modal).toBeInstanceOf(TagListsModal);
    expect((modal as unknown as StubModal).titleEl.text).toBe(TAG_LISTS_TITLE);
    expect(content.withClass('spellbook-tags-heading').map((heading) => heading.text)).toEqual(['Statuses', 'Labels']);
    expect(names(content, 'status')).toEqual(['To do', 'First draft', 'Done']);
    expect(names(content, 'label')).toEqual(['Anna', DANIEL]);
    expect(rows(content, 'status').map((each) => colorOf(each.withClass('spellbook-swatch')[0]))).toEqual([
      'red',
      'orange',
      'green',
    ]);

    // A name is the writer's own text, and the only thing in its row that chooses a direction.
    const hebrew = row(content, 'label', DANIEL);
    expect(hebrew.all().filter((element) => element.attrs['dir'] !== undefined)).toEqual([one(hebrew, 'spellbook-tag-name')]);
    expect(one(hebrew, 'spellbook-tag-name').attrs['dir']).toBe('auto');
    // Every control is a button with a name of its own.
    expect(one(hebrew, 'spellbook-tag-color').attrs['aria-label']).toBe('Colour: Cyan');
    expect(hebrew.withClass('spellbook-tag-button').map((button) => button.attrs['aria-label'])).toEqual([
      'Move up',
      'Move down',
      'More options',
    ]);
  });

  it('says so when a project has no labels, or uses the built-in statuses', () => {
    const host = new FakeHost();
    host.open([]);
    const { content } = open(host);
    expect(names(content, 'status')).toEqual(DEFAULT_STATUSES.map((status) => status.name));
    expect(names(content, 'status')).toHaveLength(4);
    expect(section(content, 'status').withClass('spellbook-tags-note').map((note) => note.text)).toEqual([
      'These are the built-in statuses. A change here saves the list in this project.',
    ]);
    expect(section(content, 'label').withClass('spellbook-tags-note').map((note) => note.text)).toEqual(['No labels yet.']);
  });

  it('says that no project is open when there is none', () => {
    const { content } = open(new FakeHost());
    expect(content.fullText).toBe('No project is open.');
  });

  it('draws itself again when the project changes, and stops listening when it closes', () => {
    const host = novelHost();
    const { modal, content } = open(host);
    expect(host.listenerCount).toBe(1);
    host.open(novelTree(), { ...novelIndex(), labels: [{ name: 'Only one' }] });
    expect(names(content, 'label')).toEqual(['Only one']);

    modal.close();
    expect(host.listenerCount).toBe(0);
    expect(content.children).toEqual([]);
    host.emit({ type: 'project' });
    expect(content.children).toEqual([]);
  });

  it('marks phones and tablets for larger buttons', () => {
    Object.assign(StubPlatform, { isDesktop: false, isMobile: true });
    const { modal } = open(novelHost());
    expect((modal as unknown as StubModal).modalEl.hasClass('spellbook-is-mobile')).toBe(true);
    expect((modal as unknown as StubModal).modalEl.hasClass('spellbook-tags')).toBe(true);
  });
});

describe('adding', () => {
  it('asks for a name and hands the host the list the engine works out', async () => {
    const host = novelHost();
    const { content } = open(host);
    const expected = addTag(lists(host).labels, 'Night scenes');
    if (!expected.ok) throw new Error('the engine refused');

    const button = one(section(content, 'label'), 'spellbook-tags-add');
    expect(button.text).toBe('Add label');
    tap(button);
    const prompt = openWindow();
    expect(prompt).toBeInstanceOf(TextPromptModal as unknown as typeof StubModal);
    expect(prompt.titleEl.text).toBe('New label');
    answerPrompt('  Night   scenes ');
    await rest(host);

    expect(host.saved).toEqual([
      { kind: 'label', key: 'labels', value: expected.value, scenePatches: [], rename: null },
    ]);
    expect(prompt.isOpen).toBe(false);
    expect(names(content, 'label')).toEqual(['Anna', DANIEL, 'Night scenes']);
  });

  it('keeps the window that asks open, with the reason, when the name will not do', async () => {
    const host = novelHost();
    const { content } = open(host);
    tap(one(section(content, 'status'), 'spellbook-tags-add'));
    const prompt = answerPrompt('to DO');
    await rest(host);
    expect(promptMessage(prompt)).toBe('There is already a status called "To do".');
    expect(prompt.isOpen).toBe(true);
    answerPrompt('   ');
    await rest(host);
    expect(promptMessage(prompt)).toBe('Give the status a name.');
    expect(host.saved).toEqual([]);

    // The host's own refusal is shown in the same place.
    host.refusal = 'The index note could not be written.';
    answerPrompt('Polished');
    await rest(host);
    expect(promptMessage(prompt)).toBe('The index note could not be written.');
    expect(names(content, 'status')).toEqual(['To do', 'First draft', 'Done']);
  });

  it('offers to add the names that scenes use and the list does not have', async () => {
    const host = novelHost();
    host.scenes.set(LETTER, { frontmatter: { status: 'sent OFF' } });
    const { content } = open(host);
    const loose = one(section(content, 'status'), 'spellbook-tags-unlisted');
    const entries = loose.withClass('spellbook-tag-row');
    expect(entries.map((entry) => [nameOf(entry), one(entry, 'spellbook-tag-uses').text])).toEqual([['sent OFF', '2 scenes']]);
    // Nothing of the kind among the labels.
    expect(section(content, 'label').withClass('spellbook-tags-unlisted')).toEqual([]);

    tap(one(loose, 'spellbook-tags-adopt'));
    await rest(host);
    expect(host.saved).toHaveLength(1);
    expect(names(content, 'status')).toEqual(['To do', 'First draft', 'Done', 'sent OFF']);
    expect(section(content, 'status').withClass('spellbook-tags-unlisted')).toEqual([]);
  });
});

describe('renaming', () => {
  it('renames in the list and in every scene that uses the old name', async () => {
    const host = novelHost();
    host.scenes.set(CLOSING, { frontmatter: { status: 'to do' } });
    const { content } = open(host);
    const expected = renameTag(lists(host).statuses, 'To do', 'Planned', host.sceneProperties());
    if (!expected.ok) throw new Error('the engine refused');
    expect(expected.scenePatches.map((entry) => entry.path)).toEqual([OPENING, CLOSING]);

    const menu = menuFrom(one(row(content, 'status', 'To do'), 'spellbook-tag-more'));
    expect(menu.outline).toEqual(['Rename', 'Change colour', '---', 'Remove']);
    menu.item('Rename').click();
    const prompt = openWindow();
    expect(prompt.titleEl.text).toBe('Rename status');
    expect(one(prompt.contentEl, 'spellbook-prompt-input').value).toBe('To do');
    answerPrompt('Planned');
    await rest(host);

    expect(host.saved).toEqual([
      {
        kind: 'status',
        key: 'statuses',
        value: expected.value,
        scenePatches: expected.scenePatches,
        rename: { from: 'To do', to: 'Planned' },
      },
    ]);
    expect(names(content, 'status')).toEqual(['Planned', 'First draft', 'Done']);
    // It kept its colour and its place, and the scenes follow.
    expect(colorOf(row(content, 'status', 'Planned').withClass('spellbook-swatch')[0])).toBe('red');
    expect(host.frontmatterOf(OPENING)?.['status']).toBe('Planned');
    expect(host.frontmatterOf(CLOSING)?.['status']).toBe('Planned');
    expect(host.frontmatterOf(HEBREW_SCENE)?.['status']).toBe('Done');
  });

  it('refuses a name another one has, in the window that asks', async () => {
    const host = novelHost();
    const { content } = open(host);
    menuFrom(one(row(content, 'label', 'Anna'), 'spellbook-tag-more')).item('Rename').click();
    const prompt = answerPrompt(DANIEL);
    await rest(host);
    expect(promptMessage(prompt)).toBe(`There is already a label called "${DANIEL}".`);
    expect(host.saved).toEqual([]);
  });
});

describe('colours', () => {
  it('offers the eight colours and none, with the one it has ticked', async () => {
    const host = novelHost();
    const { content } = open(host);
    const menu = menuFrom(one(row(content, 'status', 'Done'), 'spellbook-tag-color'));
    expect(menu.outline).toEqual(['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink', '---', 'No colour']);
    expect(menu.items).toHaveLength(CARD_COLORS.length + 1);
    expect(ticked(menu)).toEqual(['Green']);
    // Each colour is shown as a patch of itself; its name is the app's own word.
    const blue = menu.item('Blue').titleEl as FakeElement;
    expect(colorOf(blue.withClass('spellbook-swatch')[0])).toBe('blue');
    expect(blue.all().some((element) => element.attrs['dir'] !== undefined)).toBe(false);

    const expected = recolourTag(lists(host).statuses, 'Done', 'blue');
    if (!expected.ok) throw new Error('the engine refused');
    menu.item('Blue').click();
    await rest(host);
    expect(host.saved).toEqual([
      { kind: 'status', key: 'statuses', value: expected.value, scenePatches: [], rename: null },
    ]);
    expect(colorOf(row(content, 'status', 'Done').withClass('spellbook-swatch')[0])).toBe('blue');
    expect(one(row(content, 'status', 'Done'), 'spellbook-tag-color').attrs['aria-label']).toBe('Colour: Blue');
  });

  it('takes a colour away, does nothing for the colour it already has, and is also in the row menu', async () => {
    const host = novelHost();
    const { content } = open(host);
    menuFrom(one(row(content, 'label', 'Anna'), 'spellbook-tag-color')).item('Purple').click();
    await rest(host);
    expect(host.saved).toEqual([]);
    expect(notices()).toEqual([]);

    const colours = submenu(menuFrom(one(row(content, 'label', 'Anna'), 'spellbook-tag-more')), 'Change colour');
    colours.item('No colour').click();
    await rest(host);
    expect(host.saved).toHaveLength(1);
    expect(colorOf(row(content, 'label', 'Anna').withClass('spellbook-swatch')[0])).toBeNull();
    expect(one(row(content, 'label', 'Anna'), 'spellbook-tag-color').attrs['aria-label']).toBe('Colour: none');
    expect(ticked(menuFrom(one(row(content, 'label', 'Anna'), 'spellbook-tag-color')))).toEqual(['No colour']);
  });
});

describe('putting in order', () => {
  it('moves one up and down, and keeps the keyboard on the button that was pressed', async () => {
    const host = novelHost();
    const { content } = open(host);
    const first = rows(content, 'status')[0] as FakeElement;
    const last = rows(content, 'status')[2] as FakeElement;
    // The first cannot go up and the last cannot go down; the buttons stay in their places.
    expect([isOff(one(first, 'spellbook-tag-up')), isOff(one(first, 'spellbook-tag-down'))]).toEqual([true, false]);
    expect([isOff(one(last, 'spellbook-tag-up')), isOff(one(last, 'spellbook-tag-down'))]).toEqual([false, true]);
    tap(one(first, 'spellbook-tag-up'));
    await rest(host);
    expect(host.saved).toEqual([]);

    const expected = moveTag(lists(host).statuses, 'Done', 1);
    if (!expected.ok) throw new Error('the engine refused');
    tap(one(last, 'spellbook-tag-up'));
    await rest(host);
    expect(host.saved.map((change) => change.value)).toEqual([expected.value]);
    expect(names(content, 'status')).toEqual(['To do', 'Done', 'First draft']);
    expect(fakeDocument.activeElement).toBe(one(row(content, 'status', 'Done'), 'spellbook-tag-up'));

    tap(one(row(content, 'status', 'Done'), 'spellbook-tag-up'));
    await rest(host);
    expect(names(content, 'status')).toEqual(['Done', 'To do', 'First draft']);
    // It reached the top, where "up" is off: the keyboard is on its "down".
    expect(fakeDocument.activeElement).toBe(one(row(content, 'status', 'Done'), 'spellbook-tag-down'));

    tap(one(row(content, 'status', 'Done'), 'spellbook-tag-down'));
    await rest(host);
    expect(names(content, 'status')).toEqual(['To do', 'Done', 'First draft']);
    expect(host.saved).toHaveLength(3);
  });

  it('can be worked from the keyboard', async () => {
    const host = novelHost();
    const { content } = open(host);
    const down = one(row(content, 'label', 'Anna'), 'spellbook-tag-down');
    expect(down.attrs['tabindex']).toBe(0);
    expect(down.attrs['role']).toBe('button');
    down.dispatch('keydown', { key: 'Enter', preventDefault: () => {}, stopPropagation: () => {} });
    await rest(host);
    expect(names(content, 'label')).toEqual([DANIEL, 'Anna']);
  });
});

describe('removing', () => {
  it('asks first, saying how many scenes use it, and removes it from the list only', async () => {
    const host = novelHost();
    const { content } = open(host);
    const expected = removeTag(lists(host).statuses, 'To do');
    if (!expected.ok) throw new Error('the engine refused');

    menuFrom(one(row(content, 'status', 'To do'), 'spellbook-tag-more')).item('Remove').click();
    const question = openWindow();
    expect(question).toBeInstanceOf(ConfirmModal as unknown as typeof StubModal);
    expect(question.titleEl.text).toBe('Remove "To do"?');
    expect(one(question.contentEl, 'spellbook-confirm-message').text).toBe(
      '1 scene uses this status. It keeps the name, shown without a colour.',
    );
    // Cancel changes nothing.
    windowButtons(question).cancel.click();
    await rest(host);
    expect(host.saved).toEqual([]);

    menuFrom(one(row(content, 'status', 'To do'), 'spellbook-tag-more')).item('Remove').click();
    windowButtons(openWindow()).confirm.click();
    await rest(host);
    expect(host.saved).toEqual([
      { kind: 'status', key: 'statuses', value: expected.value, scenePatches: [], rename: null },
    ]);
    expect(names(content, 'status')).toEqual(['First draft', 'Done']);
    // The scene keeps the name, and the window offers to put it back.
    expect(host.frontmatterOf(OPENING)?.['status']).toBe('To do');
    expect(one(section(content, 'status'), 'spellbook-tags-unlisted').withClass('spellbook-tag-name').map((name) => name.text)).toEqual([
      'To do',
      'Sent off',
    ]);
    expect(openWindows()).toBe(1);
  });

  it('says so when no scene uses it, and when several do', async () => {
    const host = novelHost();
    host.scenes.set(LETTER, { frontmatter: { label: 'Anna' } });
    const { content } = open(host);
    menuFrom(one(row(content, 'label', 'Anna'), 'spellbook-tag-more')).item('Remove').click();
    expect(one(openWindow().contentEl, 'spellbook-confirm-message').text).toBe(
      '2 scenes use this label. They keep the name, shown without a colour.',
    );
    openWindow().close();
    host.open(novelTree(), { ...novelIndex(), labels: [{ name: 'Unused' }] });
    menuFrom(one(row(content, 'label', 'Unused'), 'spellbook-tag-more')).item('Remove').click();
    expect(one(openWindow().contentEl, 'spellbook-confirm-message').text).toBe('No scene uses this label.');
  });
});

describe('what cannot be changed', () => {
  it('switches every control off in a read-only project', () => {
    const host = novelHost();
    host.open(novelTree(), novelIndex(), { readOnly: true });
    const { content } = open(host);
    expect(content.withClass('spellbook-tags-message').map((message) => message.text)).toEqual([
      'This project is read-only, so its statuses and labels cannot be changed.',
    ]);
    expect(content.withClass('spellbook-tag-button').every(isOff)).toBe(true);
    expect(content.withClass('spellbook-tag-color').every((button) => button.disabled)).toBe(true);
    expect(content.withClass('spellbook-tags-add').every((button) => button.disabled)).toBe(true);
    // A switched-off button does nothing when it is tapped all the same.
    tap(one(row(content, 'label', 'Anna'), 'spellbook-tag-down'));
    tap(one(row(content, 'label', 'Anna'), 'spellbook-tag-more'));
    expect(host.saved).toEqual([]);
    expect(() => lastMenu()).toThrow();
  });

  it('leaves a list alone that it cannot read, and says what is wrong with it', () => {
    const host = novelHost();
    host.open(novelTree(), { ...novelIndex(), labels: 'not a list' });
    const { content } = open(host);
    const labels = section(content, 'label');
    expect(labels.withClass('spellbook-tags-problem').length).toBeGreaterThan(0);
    expect(one(labels, 'spellbook-tags-add').disabled).toBe(true);
    // The other list is as usable as ever.
    expect(one(section(content, 'status'), 'spellbook-tags-add').disabled).toBe(false);
  });

  it('tells the writer when the host could not store a change', async () => {
    const host = novelHost();
    host.refusal = 'The index note could not be written.';
    const { content } = open(host);
    tap(one(row(content, 'label', 'Anna'), 'spellbook-tag-down'));
    await rest(host);
    expect(notices()).toEqual(['The index note could not be written.']);
    expect(names(content, 'label')).toEqual(['Anna', DANIEL]);
  });
});
