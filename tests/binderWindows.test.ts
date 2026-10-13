// The small windows the binder opens: the one that asks for a name, the one
// that asks "are you sure?", and the list of folders to move something to.
// They are driven through the stand-in for Obsidian's windows
// (tests/obsidianStub.ts); how they look, and how a phone's keyboard behaves
// with them, can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmModal } from '../src/ui/confirmModal';
import { FolderPickerModal } from '../src/ui/folderPickerModal';
import { ACTION_ICONS, ROW_MORE_ICON, TOOLBAR_MORE_ICON, iconName } from '../src/ui/icons';
import { safely } from '../src/ui/safely';
import { TextPromptModal } from '../src/ui/textPromptModal';
import type { TextPrompt } from '../src/ui/textPromptModal';
import { press } from './binderScreen';
import { Notice as StubNotice, unknownIcons } from './obsidianStub';
import type { ButtonComponent, FakeElement, FuzzySuggestModal as StubPicker, Modal as StubModal } from './obsidianStub';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

beforeEach(() => {
  StubNotice.shown.length = 0;
});

afterEach(() => {
  unknownIcons.clear();
  vi.restoreAllMocks();
});

// ------------------------------------------------------- asking for a name

interface OpenedPrompt {
  modal: StubModal;
  input: FakeElement;
  message: FakeElement;
  cancel: ButtonComponent;
  confirm: ButtonComponent;
  /** What was handed to `submit`, in order. */
  submitted: string[];
  /** Let the pending `submit` finish with this answer (null = all went well). */
  finish: (problem: string | null) => Promise<void>;
}

function openPrompt(options: Partial<TextPrompt> = {}): OpenedPrompt {
  const submitted: string[] = [];
  let settle: ((problem: string | null) => void) | null = null;
  const real = new TextPromptModal({} as never, {
    title: 'New scene',
    label: 'Name of the scene',
    confirm: 'Create',
    submit: (value) => {
      submitted.push(value);
      return new Promise<string | null>((resolve) => {
        settle = resolve;
      });
    },
    ...options,
  });
  real.open();
  const modal = real as unknown as StubModal;
  const buttons = modal.contentEl.settings[0]?.components as ButtonComponent[];
  return {
    modal,
    input: modal.contentEl.withClass('spellbook-prompt-input')[0] as FakeElement,
    message: modal.contentEl.withClass('spellbook-prompt-message')[0] as FakeElement,
    cancel: buttons[0] as ButtonComponent,
    confirm: buttons[1] as ButtonComponent,
    submitted,
    finish: async (problem) => {
      settle?.(problem);
      await tick();
    },
  };
}

describe('the window that asks for a name', () => {
  it('has a title, one text field, and Cancel and confirm buttons', () => {
    const { modal, input, cancel, confirm } = openPrompt();
    expect(modal.titleEl.text).toBe('New scene');
    expect(modal.modalEl.classes.has('spellbook-prompt')).toBe(true);
    expect(input.tag).toBe('input');
    expect(input.attrs['type']).toBe('text');
    expect(input.attrs['aria-label']).toBe('Name of the scene');
    expect(cancel.buttonEl.text).toBe('Cancel');
    expect(confirm.buttonEl.text).toBe('Create');
    expect(confirm.buttonEl.classes.has('mod-cta')).toBe(true);
  });

  it('puts the keyboard in the field straight away', () => {
    const { input } = openPrompt();
    expect(input.focused).toBe(true);
  });

  it('lets a name in any language choose its own direction, also in the message under the field', () => {
    const { input, message } = openPrompt();
    expect(input.attrs['dir']).toBe('auto');
    expect(message.attrs['dir']).toBe('auto');
  });

  it('tells a phone\'s keyboard to offer "done"', () => {
    expect(openPrompt().input.attrs['enterkeyhint']).toBe('done');
  });

  it('starts empty for something new, with a hint of what to type', () => {
    const { input } = openPrompt({ placeholder: 'Name of the scene' });
    expect(input.value).toBe('');
    expect(input.attrs['placeholder']).toBe('Name of the scene');
  });

  it('starts with the old name, selected, when renaming', () => {
    const { input } = openPrompt({ title: 'Rename scene', value: 'מכתב לאחותי', confirm: 'Rename' });
    expect(input.value).toBe('מכתב לאחותי');
    expect(input.selected).toBe(true); // typing replaces it
  });

  it('confirms on Enter and closes when all went well', async () => {
    const { modal, input, submitted, finish } = openPrompt();
    input.value = 'The Letter';
    let prevented = 0;
    press(input, 'Enter', { preventDefault: () => prevented++ });
    expect(submitted).toEqual(['The Letter']);
    expect(prevented).toBe(1);
    expect(modal.isOpen).toBe(true); // still working
    await finish(null);
    expect(modal.isOpen).toBe(false);
  });

  it('confirms with the button too', async () => {
    const { modal, input, confirm, submitted, finish } = openPrompt();
    input.value = 'The Letter';
    confirm.click();
    expect(submitted).toEqual(['The Letter']);
    await finish(null);
    expect(modal.isOpen).toBe(false);
  });

  it('hands over exactly what was typed: tidying it is not the window\'s job', async () => {
    const { input, submitted, finish } = openPrompt();
    input.value = '  Chapter 1: "Fire"?  ';
    press(input, 'Enter');
    await finish(null);
    expect(submitted).toEqual(['  Chapter 1: "Fire"?  ']);
  });

  it('does not take the Enter that only accepts a word from an input method', () => {
    const { input, submitted } = openPrompt();
    input.value = 'にほんご';
    press(input, 'Enter', { isComposing: true }); // desktop
    press(input, 'Enter', { keyCode: 229 }); // iPhone and iPad
    expect(submitted).toEqual([]);
    press(input, 'Enter', { isComposing: false, keyCode: 13 });
    expect(submitted).toEqual(['にほんご']);
  });

  it('ignores other keys', () => {
    const { input, submitted } = openPrompt();
    for (const key of ['a', 'Tab', ' ', 'ArrowDown']) press(input, key);
    expect(submitted).toEqual([]);
  });

  it('shows a refusal under the field and stays open, with the keyboard back in the field', async () => {
    const { modal, input, message, finish } = openPrompt();
    input.focused = false;
    press(input, 'Enter');
    await finish('Give the scene a name.');
    expect(modal.isOpen).toBe(true);
    expect(message.text).toBe('Give the scene a name.');
    expect(message.attrs['role']).toBe('alert');
    expect(input.classes.has('spellbook-is-invalid')).toBe(true);
    expect(input.attrs['aria-invalid']).toBe('true');
    expect(input.focused).toBe(true);
    expect(notices()).toEqual([]); // said in the window, not in a notice
  });

  it('takes the refusal away as soon as the writer types again', async () => {
    const { input, message, finish } = openPrompt();
    press(input, 'Enter');
    await finish('Give the scene a name.');
    input.value = 'T';
    input.dispatch('input', {});
    expect(message.text).toBe('');
    expect(input.classes.has('spellbook-is-invalid')).toBe(false);
    expect(input.attrs['aria-invalid']).toBeUndefined();
  });

  it('can be confirmed again after a refusal', async () => {
    const { modal, input, submitted, finish } = openPrompt();
    press(input, 'Enter');
    await finish('Give the scene a name.');
    input.value = 'The Letter';
    press(input, 'Enter');
    await finish(null);
    expect(submitted).toEqual(['', 'The Letter']);
    expect(modal.isOpen).toBe(false);
  });

  it('takes one confirmation at a time: a second Enter while it is working does nothing', async () => {
    const { input, confirm, submitted, finish } = openPrompt();
    input.value = 'The Letter';
    press(input, 'Enter');
    press(input, 'Enter');
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(submitted).toEqual(['The Letter']);
    await finish('Try another name.');
    expect(confirm.disabled).toBe(false);
  });

  it('cancels with the Cancel button, without handing anything over', () => {
    const { modal, input, cancel, submitted } = openPrompt();
    input.value = 'The Letter';
    cancel.click();
    expect(modal.isOpen).toBe(false);
    expect(submitted).toEqual([]);
  });

  it('cancels on Escape, without handing anything over', () => {
    const { modal, input, submitted } = openPrompt();
    input.value = 'The Letter';
    let prevented = 0;
    press(modal.contentEl, 'Escape', { preventDefault: () => prevented++ });
    expect(modal.isOpen).toBe(false);
    expect(submitted).toEqual([]);
    expect(prevented).toBe(1);
  });

  it('leaves alone the Escape that only puts away an input method\'s suggestions, and every other key', () => {
    const { modal } = openPrompt();
    press(modal.contentEl, 'Escape', { isComposing: true });
    press(modal.contentEl, 'Escape', { keyCode: 229 });
    press(modal.contentEl, 'Enter');
    press(modal.contentEl, 'q');
    expect(modal.isOpen).toBe(true);
  });

  it('is closed once only, also when Obsidian has already closed it for the same Escape', () => {
    const { modal } = openPrompt();
    let closes = 0;
    const onClose = modal.onClose.bind(modal);
    modal.onClose = (): void => {
      closes++;
      onClose();
    };
    modal.close(); // Obsidian's own handling of Escape
    let prevented = 0;
    press(modal.contentEl, 'Escape', { preventDefault: () => prevented++ }); // the same key press reaches the window
    expect(closes).toBe(1);
    expect(prevented).toBe(0); // it was no longer the window's to handle
  });

  it('accepts an answer that comes at once, without a promise', async () => {
    const real = new TextPromptModal({} as never, { title: 'T', label: 'L', confirm: 'OK', submit: () => null });
    real.open();
    const modal = real as unknown as StubModal;
    press(modal.contentEl.withClass('spellbook-prompt-input')[0] as FakeElement, 'Enter');
    await tick();
    expect(modal.isOpen).toBe(false);
  });

  it('shows what went wrong, and stays open, when the work behind it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = new TextPromptModal({} as never, {
      title: 'T',
      label: 'L',
      confirm: 'OK',
      submit: () => Promise.reject(new Error('The disk is not available')),
    });
    real.open();
    const modal = real as unknown as StubModal;
    press(modal.contentEl.withClass('spellbook-prompt-input')[0] as FakeElement, 'Enter');
    await tick();
    expect(modal.isOpen).toBe(true);
    expect(modal.contentEl.withClass('spellbook-prompt-message')[0]?.text).toBe('The disk is not available');
  });

  it('leaves nothing behind when it is closed while still working', async () => {
    const { modal, input, finish } = openPrompt();
    press(input, 'Enter');
    modal.close(); // Escape
    expect(modal.contentEl.children).toEqual([]);
    await finish('Too late.'); // must not fail on a window that is gone
    expect(modal.isOpen).toBe(false);
  });
});

// ------------------------------------------------------ asking "are you sure?"

function openQuestion(): { modal: StubModal; cancel: ButtonComponent; confirm: ButtonComponent; confirmed: () => number } {
  let count = 0;
  const real = new ConfirmModal({} as never, {
    title: 'Delete "מכתב לאחותי"?',
    message: 'The scene is taken out of the binder and its note is moved to the trash.',
    confirm: 'Delete',
    onConfirm: () => {
      count++;
    },
  });
  real.open();
  const modal = real as unknown as StubModal;
  const buttons = modal.contentEl.settings[0]?.components as ButtonComponent[];
  return { modal, cancel: buttons[0] as ButtonComponent, confirm: buttons[1] as ButtonComponent, confirmed: () => count };
}

describe('the window that asks before something is deleted', () => {
  it('names what will be deleted and says what will happen', () => {
    const { modal, cancel, confirm } = openQuestion();
    expect(modal.titleEl.text).toBe('Delete "מכתב לאחותי"?');
    expect(modal.titleEl.attrs['dir']).toBe('auto'); // the name is the writer's own text
    const message = modal.contentEl.withClass('spellbook-confirm-message')[0] as FakeElement;
    expect(message.text).toMatch(/moved to the trash/);
    expect(message.attrs['dir']).toBe('auto');
    expect(modal.modalEl.classes.has('spellbook-confirm')).toBe(true);
    expect(cancel.buttonEl.text).toBe('Cancel');
    expect(confirm.buttonEl.text).toBe('Delete');
    expect(confirm.buttonEl.classes.has('mod-warning')).toBe(true);
  });

  it('starts with the keyboard on Cancel, so that a stray Enter deletes nothing', () => {
    const { cancel, confirm } = openQuestion();
    expect(cancel.buttonEl.focused).toBe(true);
    expect(confirm.buttonEl.focused).toBe(false);
  });

  it('does nothing on Cancel, on Escape, or when it is closed', () => {
    const first = openQuestion();
    first.cancel.click();
    expect(first.modal.isOpen).toBe(false);
    expect(first.confirmed()).toBe(0);

    const second = openQuestion();
    press(second.modal.contentEl, 'Enter'); // not a key the window itself acts on
    expect(second.modal.isOpen).toBe(true);
    let prevented = 0;
    press(second.modal.contentEl, 'Escape', { preventDefault: () => prevented++ });
    expect(second.modal.isOpen).toBe(false);
    expect(second.confirmed()).toBe(0);
    expect(prevented).toBe(1);

    const third = openQuestion();
    third.modal.close(); // closed by Obsidian itself
    press(third.modal.contentEl, 'Escape', { preventDefault: () => prevented++ });
    expect(third.confirmed()).toBe(0);
    expect(prevented).toBe(1); // a window that is closed already is left alone
  });

  it('goes ahead once, and closes, when confirmed', () => {
    const { modal, confirm, confirmed } = openQuestion();
    confirm.click();
    confirm.click(); // a double tap
    expect(confirmed()).toBe(1);
    expect(modal.isOpen).toBe(false);
  });
});

// ------------------------------------------------------- picking a folder

type Choice = { parentId: string | null; label: string };

function openPicker(choices: Choice[]): { modal: StubPicker<Choice>; chosen: Choice[] } {
  const chosen: Choice[] = [];
  const real = new FolderPickerModal({} as never, 'Move "The Letter" to...', choices, (choice) => chosen.push(choice));
  real.open();
  return { modal: real as unknown as StubPicker<Choice>, chosen };
}

describe('the list of folders to move something to', () => {
  const choices: Choice[] = [
    { parentId: null, label: 'Top level' },
    { parentId: 'f-one', label: 'Part one' },
    { parentId: 'f-inner', label: 'Part one / Chapter' },
    { parentId: 'f-two', label: 'חלק שני' },
  ];

  it('says what is being moved, and lists the places in the order given', () => {
    const { modal } = openPicker(choices);
    expect(modal.inputEl.attrs['placeholder']).toBe('Move "The Letter" to...');
    expect(modal.modalEl.classes.has('spellbook-folder-picker')).toBe(true);
    expect(modal.shownFor('').map((row) => row.text)).toEqual(['Top level', 'Part one', 'Part one / Chapter', 'חלק שני']);
  });

  it('lets a folder\'s name, and what is typed, choose its own direction', () => {
    const { modal } = openPicker(choices);
    for (const row of modal.shownFor('')) expect(row.attrs['dir'], row.text).toBe('auto');
    expect(modal.inputEl.attrs['dir']).toBe('auto');
  });

  it('narrows the list by what is typed, in any language', () => {
    const { modal } = openPicker(choices);
    expect(modal.shownFor('part').map((row) => row.text)).toEqual(['Part one', 'Part one / Chapter']);
    expect(modal.shownFor('שני').map((row) => row.text)).toEqual(['חלק שני']);
    expect(modal.shownFor('nothing like this')).toEqual([]);
    expect(modal.emptyStateText).toBe('No folder with that name.');
  });

  it('hands over the place that was picked, and closes', () => {
    const { modal, chosen } = openPicker(choices);
    modal.pick('חלק שני');
    expect(chosen).toEqual([{ parentId: 'f-two', label: 'חלק שני' }]);
    expect(modal.isOpen).toBe(false);
  });

  it('hands over the top level as "no folder"', () => {
    const { modal, chosen } = openPicker(choices);
    modal.pick('Top level');
    expect(chosen).toEqual([{ parentId: null, label: 'Top level' }]);
  });

  it('is not changed by a caller that goes on to change its own list', () => {
    const own = [...choices];
    const { modal } = openPicker(own);
    modal.getItems().pop();
    expect(modal.getItems()).toHaveLength(4);
  });
});

// ------------------------------------------------------------------- safely

describe('running what a button does', () => {
  it('runs it at once, in the same turn', () => {
    let ran = false;
    safely('New scene', () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(notices()).toEqual([]);
  });

  it('tells the writer when it fails at once, and does not pass the failure on', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      safely('New scene', () => {
        throw new Error('something broke');
      }),
    ).not.toThrow();
    expect(notices()).toEqual(['"New scene" did not work: something broke']);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('tells the writer when it fails later', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    safely('Move up', () => Promise.reject(new Error('the index could not be saved')));
    await tick();
    expect(notices()).toEqual(['"Move up" did not work: the index could not be saved']);
  });

  it('says nothing when the work finishes well later', async () => {
    safely('Move up', () => Promise.resolve('fine'));
    await tick();
    expect(notices()).toEqual([]);
  });
});

// -------------------------------------------------------------------- icons

describe('the icons of the buttons and menus', () => {
  it('are asked for by every name they have had', () => {
    for (const names of [ROW_MORE_ICON, TOOLBAR_MORE_ICON, ...Object.values(ACTION_ICONS)]) {
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(name).toMatch(/^[a-z0-9-]+$/);
    }
    // The three dots were renamed in Obsidian's icon set: both names are tried.
    expect(ROW_MORE_ICON).toEqual(['ellipsis', 'more-horizontal']);
    expect(TOOLBAR_MORE_ICON).toEqual(['ellipsis-vertical', 'more-vertical']);
  });

  it('gives a menu item the first name this Obsidian knows', () => {
    expect(iconName('newer-name-a', 'older-name-a')).toBe('newer-name-a');
    unknownIcons.add('newer-name-b');
    expect(iconName('newer-name-b', 'older-name-b')).toBe('older-name-b');
  });

  it('gives the last name when Obsidian knows none (the item then simply has no icon)', () => {
    unknownIcons.add('newer-name-c');
    unknownIcons.add('older-name-c');
    expect(iconName('newer-name-c', 'older-name-c')).toBe('older-name-c');
    expect(iconName()).toBeNull();
  });
});
