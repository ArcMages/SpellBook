// The to-do half of the planner, driven through a stand-in host
// (tests/features/planner/plannerStage.ts). These tests check what the list
// shows and does; how it looks can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DUE_MARK } from '../../../src/core/planner';
import { TODO_CHANGED_NOTICE } from '../../../src/features/planner/plannerView';
import { ROWS_AT_ONCE, ROWS_A_PIECE } from '../../../src/features/planner/todoPart';
import { TOUCH_HOLD_MS } from '../../../src/ui/dragDrop';
import { ConfirmModal } from '../../../src/ui/confirmModal';
import { TextPromptModal } from '../../../src/ui/textPromptModal';
import { DatePromptModal } from '../../../src/features/planner/dateModal';
import { FakeElement, Menu as StubMenu, Modal as StubModal, fakeDocument, resetPlatform } from '../../obsidianStub';
import type { ButtonComponent } from '../../obsidianStub';
import {
  FRAME_MS,
  LIST_TOP,
  ROW_HEIGHT,
  addForm,
  boxOf,
  cellOf,
  cellPicture,
  clearScreen,
  click,
  dragTo,
  flip,
  inRow,
  key,
  layOutTodos,
  listPicture,
  menuOf,
  notices,
  one,
  openWindow,
  openWindows,
  part,
  point,
  promptParts,
  settle,
  stagePlanner,
  ticked,
  todoRow,
  todoRows,
  unused,
} from './plannerStage';
import type { PlannerStage } from './plannerStage';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

const due = (date: string): string => `${DUE_MARK} ${date}`;

const TODO = [
  '# Before the launch',
  `- [ ] Send chapter one ${due('2026-10-20')}`,
  '- [x] Choose a name for the ferry',
  `- [ ] לשלוח את הפרק ${due('2026-10-12')}`,
  '',
  '## Later',
  '- [ ] Call the printer',
  `- [x] Pay the editor ${due('2026-10-01')}`,
  '',
].join('\n');

const lines = (s: PlannerStage): string[] => s.host.file.split('\n');

/** How many menus were shown so far. */
const menusShown = (): number => StubMenu.shown.length;

/** Unfold "Done". */
async function showDone(s: PlannerStage): Promise<void> {
  click(one(s.pane, 'spellbook-todos-done-toggle'));
  await settle(s);
}

describe('the list', () => {
  it('shows the open to-dos first, in the order of the file, with "Done" folded shut', async () => {
    const { pane } = await stagePlanner({ todo: TODO });
    expect(listPicture(pane, 'open')).toEqual([
      '[ ] Send chapter one {20 Oct}',
      '[ ] לשלוח את הפרק {!Yesterday}',
      '[ ] Call the printer',
    ]);
    expect(listPicture(pane, 'done')).toEqual([]);
    const toggle = one(pane, 'spellbook-todos-done-toggle');
    expect(toggle.tag).toBe('button');
    expect(toggle.fullText).toBe('Done 2');
    expect(toggle.attrs['aria-expanded']).toBe('false');
    expect(one(pane, 'spellbook-todos-count').text).toBe('3 open');
  });

  it('unfolds "Done" to show the ticked-off ones, and folds it again', async () => {
    const s = await stagePlanner({ todo: TODO });
    await showDone(s);
    expect(listPicture(s.pane, 'done')).toEqual(['[x] Choose a name for the ferry', '[x] Pay the editor {1 Oct}']);
    expect(one(s.pane, 'spellbook-todos-done-toggle').attrs['aria-expanded']).toBe('true');
    expect(todoRows(s.pane, 'done').every((row) => row.hasClass('spellbook-is-done'))).toBe(true);
    await showDone(s);
    expect(listPicture(s.pane, 'done')).toEqual([]);
    // The open ones were not touched by either.
    expect(listPicture(s.pane, 'open')).toHaveLength(3);
  });

  it('marks a to-do that is late, and never one that is done', async () => {
    const s = await stagePlanner({ todo: TODO });
    await showDone(s);
    const late = part(todoRow(s.pane, 'לשלוח את הפרק'), 'spellbook-todo-due');
    expect(late.hasClass('spellbook-is-overdue')).toBe(true);
    expect(late.attrs['aria-label']).toBe('Overdue: Yesterday');
    const fine = part(todoRow(s.pane, 'Send chapter one'), 'spellbook-todo-due');
    expect(fine.hasClass('spellbook-is-overdue')).toBe(false);
    expect(fine.attrs['aria-label']).toBe('Due 20 Oct');
    expect(part(todoRow(s.pane, 'Pay the editor'), 'spellbook-todo-due').hasClass('spellbook-is-overdue')).toBe(false);
    // A to-do without a date has no chip.
    expect(todoRow(s.pane, 'Call the printer').withClass('spellbook-todo-due')).toHaveLength(0);
  });

  it('brings the chips up to date when the day changes', async () => {
    const s = await stagePlanner({ todo: TODO });
    const before = todoRow(s.pane, 'Send chapter one');
    s.host.today = '2026-10-21';
    s.host.emit('data');
    await settle(s);
    expect(listPicture(s.pane, 'open')[0]).toBe('[ ] Send chapter one {!Yesterday}');
    // The same row, with another chip: nothing was built for it.
    expect(todoRow(s.pane, 'Send chapter one')).toBe(before);
  });

  it("lets the text, and only the text, take the direction of the writer's own words", async () => {
    const { pane } = await stagePlanner({ todo: TODO });
    for (const row of todoRows(pane, 'open')) {
      const own = row.all().filter((element) => element.attrs['dir'] === 'auto');
      expect(own).toEqual([part(row, 'spellbook-todo-text')]);
      // The row keeps the direction of the app, so the box, the chip and the button stay in their columns.
      expect(row.attrs['dir']).toBeUndefined();
    }
    // The chip is a date in English, the same way round in every row.
    expect(part(todoRow(pane, 'לשלוח את הפרק'), 'spellbook-todo-due').attrs['dir']).toBe('ltr');
  });

  it('builds every row in the same order: the tick box, the text, the chip, the "more" button', async () => {
    const { pane } = await stagePlanner({ todo: TODO });
    const classes = todoRow(pane, 'Send chapter one').children.map((child) => [...child.classes].find((cls) => cls.startsWith('spellbook-')));
    expect(classes).toEqual(['spellbook-todo-tick', 'spellbook-todo-text', 'spellbook-todo-due', 'spellbook-todo-more']);
    const box = boxOf(todoRow(pane, 'Send chapter one'));
    expect(box.tag).toBe('input');
    expect(box.attrs['type']).toBe('checkbox');
    expect(box.attrs['aria-label']).toBe('Send chapter one');
    // The box sits in a label, so that the room around it ticks it too.
    expect(box.parent?.tag).toBe('label');
    const more = part(todoRow(pane, 'Send chapter one'), 'spellbook-todo-more');
    expect(more.attrs['aria-label']).toBe('More options');
    expect(more.attrs['role']).toBe('button');
    expect(more.attrs['tabindex']).toBe(0);
  });

  it('says so when there is nothing to do', async () => {
    const empty = await stagePlanner({ todo: '# Nothing yet\n' });
    expect(one(empty.pane, 'spellbook-todos-empty').text).toBe('No to-dos yet.');
    expect(unused(one(empty.pane, 'spellbook-todos-done-toggle'))).toBe(true);
    expect(one(empty.pane, 'spellbook-todos-count').text).toBe('');

    const allDone = await stagePlanner({ todo: '- [x] Finished\n' });
    expect(one(allDone.pane, 'spellbook-todos-empty').text).toBe('Nothing left to do.');
    expect(unused(one(allDone.pane, 'spellbook-todos-done-toggle'))).toBe(false);
    expect(unused(one(allDone.pane, 'spellbook-todos-empty'))).toBe(false);

    const some = await stagePlanner({ todo: TODO });
    expect(unused(one(some.pane, 'spellbook-todos-empty'))).toBe(true);
  });

  it('shows a line without text as that, and never as HTML', async () => {
    const { pane } = await stagePlanner({ todo: '- [ ]\n- [ ] <b>bold</b> & <img src=x onerror=alert(1)>\n' });
    expect(listPicture(pane, 'open')).toEqual(['[ ] (no text)', '[ ] <b>bold</b> & <img src=x onerror=alert(1)>']);
    // The text is one piece of text in one element; nothing was made of the tags in it.
    const row = todoRow(pane, '<b>bold</b> & <img src=x onerror=alert(1)>');
    expect(part(row, 'spellbook-todo-text').children).toHaveLength(0);
    expect(pane.all().some((element) => element.tag === 'b' || element.tag === 'img')).toBe(false);
  });

  it('offers to show the file when the host can', async () => {
    const s = await stagePlanner({ todo: TODO });
    const button = one(s.pane, 'spellbook-todos-open');
    expect(button.attrs['aria-label']).toBe('Open To-do.md');
    click(button);
    expect(s.host.opened).toBe(1);

    const without = await stagePlanner({
      setup: (host) => {
        Object.defineProperty(host, 'openTodoNote', { value: undefined });
      },
    });
    expect(without.pane.withClass('spellbook-todos-open')).toHaveLength(0);
  });
});

describe('adding a to-do', () => {
  it('adds what was typed after the last to-do of the file, and empties the field', async () => {
    const s = await stagePlanner({ todo: TODO });
    const form = addForm(s.pane);
    expect(form.text.attrs['dir']).toBe('auto');
    form.text.value = 'Thank the readers';
    key(form.text, 'Enter');
    await settle(s);
    expect(lines(s)).toEqual([...TODO.split('\n').slice(0, 8), '- [ ] Thank the readers', '']);
    expect(form.text.value).toBe('');
    expect(listPicture(s.pane, 'open')[3]).toBe('[ ] Thank the readers');
    expect(one(s.pane, 'spellbook-todos-count').text).toBe('4 open');
  });

  it('gives it the date from the date field, which is a field of the device itself', async () => {
    const s = await stagePlanner({ todo: TODO });
    const form = addForm(s.pane);
    expect(form.date.tag).toBe('input');
    expect(form.date.attrs['type']).toBe('date');
    form.text.value = 'Sign the contract';
    form.date.value = '2026-11-05';
    click(form.button);
    await settle(s);
    expect(s.host.file).toContain(`- [ ] Sign the contract ${due('2026-11-05')}\n`);
    expect(form.date.value).toBe('');
    expect(listPicture(s.pane, 'open')[3]).toBe('[ ] Sign the contract {5 Nov}');
  });

  it('shows the new to-do on the calendar as well', async () => {
    const s = await stagePlanner({ todo: TODO });
    const form = addForm(s.pane);
    form.text.value = 'Proofread';
    form.date.value = '2026-10-27';
    click(form.button);
    await settle(s);
    expect(cellPicture(cellOf(s.pane, '2026-10-27')).dots).toBe(1);
  });

  it('adds nothing without text, and says so; what was typed into the date stays', async () => {
    const s = await stagePlanner({ todo: TODO });
    const form = addForm(s.pane);
    form.text.value = '   ';
    form.date.value = '2026-11-05';
    click(form.button);
    await settle(s);
    expect(s.host.file).toBe(TODO);
    expect(notices()).toEqual(['A to-do needs some text.']);
    expect(form.date.value).toBe('2026-11-05');
  });

  it('starts the file when there is none yet', async () => {
    const s = await stagePlanner({ todo: '' });
    const form = addForm(s.pane);
    form.text.value = 'The very first';
    key(form.text, 'Enter');
    await settle(s);
    expect(s.host.file).toBe('- [ ] The very first\n');
    expect(listPicture(s.pane, 'open')).toEqual(['[ ] The very first']);
  });

  it('keeps what was typed when the file could not be written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await stagePlanner({ todo: TODO });
    const form = addForm(s.pane);
    form.text.value = 'Thank the readers';
    s.host.failNext = 'the file is locked';
    key(form.text, 'Enter');
    await settle(s);
    expect(notices()).toEqual(['"Add" did not work: the file is locked']);
    expect(form.text.value).toBe('Thank the readers');
    expect(s.host.file).toBe(TODO);
  });
});

describe('ticking', () => {
  it('ticks the to-do in the file, changing its line and no other', async () => {
    const s = await stagePlanner({ todo: TODO });
    flip(boxOf(todoRow(s.pane, 'Call the printer')));
    await settle(s);
    const expected = TODO.split('\n');
    expected[6] = '- [x] Call the printer';
    expect(lines(s)).toEqual(expected);
    expect(listPicture(s.pane, 'open')).toHaveLength(2);
    expect(one(s.pane, 'spellbook-todos-done-toggle').fullText).toBe('Done 3');
  });

  it('unticks a done one, which goes back among the open ones in the order of the file', async () => {
    const s = await stagePlanner({ todo: TODO });
    await showDone(s);
    flip(boxOf(todoRow(s.pane, 'Choose a name for the ferry')));
    await settle(s);
    expect(lines(s)[2]).toBe('- [ ] Choose a name for the ferry');
    expect(listPicture(s.pane, 'open').map((row) => row.slice(4, 12))).toEqual(['Send cha', 'Choose a', 'לשלוח את', 'Call the']);
    expect(listPicture(s.pane, 'done')).toEqual(['[x] Pay the editor {1 Oct}']);
  });

  it('uses the rows it has again: ticking one to-do builds nothing for the others', async () => {
    const s = await stagePlanner({ todo: TODO });
    const first = todoRow(s.pane, 'Send chapter one');
    const hebrew = todoRow(s.pane, 'לשלוח את הפרק');
    const moved = vi.spyOn(FakeElement.prototype, 'appendChild');
    flip(boxOf(todoRow(s.pane, 'Call the printer')));
    await settle(s);
    expect(todoRow(s.pane, 'Send chapter one')).toBe(first);
    expect(todoRow(s.pane, 'לשלוח את הפרק')).toBe(hebrew);
    // Nothing was put into the list, and nothing in it was moved.
    expect(moved).not.toHaveBeenCalled();
  });

  it('reads the file again just before, so a tick lands on the right line after the file changed', async () => {
    const s = await stagePlanner({ todo: TODO });
    // Another device added lines at the top; the planner has not heard of it yet.
    s.host.file = `- [ ] Something new\n\n${TODO}`;
    flip(boxOf(todoRow(s.pane, 'Call the printer')));
    await settle(s);
    expect(lines(s)[8]).toBe('- [x] Call the printer');
    expect(lines(s)[0]).toBe('- [ ] Something new');
    expect(notices()).toEqual([]);
    // What the host read on the way is now on show.
    expect(listPicture(s.pane, 'open')[0]).toBe('[ ] Something new');
  });

  it('says so and shows the file as it is when the to-do is no longer there', async () => {
    const s = await stagePlanner({ todo: TODO });
    const changed = TODO.replace('Call the printer', 'Call the binder');
    s.host.file = changed;
    flip(boxOf(todoRow(s.pane, 'Call the printer')));
    await settle(s);
    // Nothing was written.
    expect(s.host.file).toBe(changed);
    expect(notices()).toEqual([TODO_CHANGED_NOTICE]);
    expect(s.host.refreshes).toBe(1);
    expect(listPicture(s.pane, 'open')[2]).toBe('[ ] Call the binder');
    expect(ticked(boxOf(todoRow(s.pane, 'Call the binder')))).toBe(false);
  });

  it('puts the box back when the file could not be written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await stagePlanner({ todo: TODO });
    const box = boxOf(todoRow(s.pane, 'Call the printer'));
    s.host.failNext = 'the file is locked';
    flip(box);
    expect(ticked(box)).toBe(true);
    await settle(s);
    expect(notices()).toEqual(['"Tick" did not work: the file is locked']);
    expect(ticked(box)).toBe(false);
    expect(s.host.file).toBe(TODO);
    expect(todoRow(s.pane, 'Call the printer').attrs['aria-busy']).toBeUndefined();
  });

  it('takes no second change of a to-do while the first is on its way', async () => {
    const s = await stagePlanner({ todo: TODO });
    const box = boxOf(todoRow(s.pane, 'Call the printer'));
    flip(box);
    expect(todoRow(s.pane, 'Call the printer').attrs['aria-busy']).toBe('true');
    flip(box);
    await settle(s);
    expect(s.host.todoEdits).toBe(1);
    expect(lines(s)[6]).toBe('- [x] Call the printer');
  });
});

describe('the "more" menu', () => {
  it('lists what can be done with a to-do', async () => {
    const { pane } = await stagePlanner({ todo: TODO });
    expect(menuOf(pane, 'Send chapter one').outline).toEqual([
      'Edit text',
      'Set date',
      'Clear date',
      '---',
      'Move up (off)',
      'Move down',
      '---',
      'Remove',
    ]);
    expect(menuOf(pane, 'Call the printer').outline).toEqual([
      'Edit text',
      'Set date',
      'Clear date (off)',
      '---',
      'Move up',
      'Move down (off)',
      '---',
      'Remove',
    ]);
    expect(menuOf(pane, 'Call the printer').item('Remove').warning).toBe(true);
    expect(menuOf(pane, 'Call the printer').items.every((item) => item.icon !== null)).toBe(true);
  });

  it('opens under its button, from the keyboard too, and with a right-click', async () => {
    const { pane } = await stagePlanner({ todo: TODO });
    const row = todoRow(pane, 'Call the printer');
    const more = part(row, 'spellbook-todo-more');
    more.rect = { top: 200, bottom: 230, left: 260, right: 290, width: 30, height: 30 };
    expect(menuOf(pane, 'Call the printer').position).toEqual({ x: 260, y: 230, width: 30 });

    const before = menusShown();
    expect(key(more, 'Enter').defaultPrevented).toBe(true);
    key(more, ' ');
    expect(menusShown()).toBe(before + 2);

    const event = part(row, 'spellbook-todo-text').fire('contextmenu', { button: 2 });
    expect(event.defaultPrevented).toBe(true);
    expect(menusShown()).toBe(before + 3);
  });

  it('changes the text through a small window, keeping the date', async () => {
    const s = await stagePlanner({ todo: TODO });
    menuOf(s.pane, 'Send chapter one').item('Edit text').click();
    const modal = openWindow();
    expect(modal).toBeInstanceOf(TextPromptModal as unknown as typeof StubModal);
    expect(modal.titleEl.text).toBe('Edit to-do');
    const prompt = promptParts(modal);
    expect(prompt.input.value).toBe('Send chapter one');
    expect(prompt.input.attrs['dir']).toBe('auto');
    prompt.input.value = 'Send chapters one and two';
    key(prompt.input, 'Enter');
    await settle(s);
    expect(lines(s)[1]).toBe(`- [ ] Send chapters one and two ${due('2026-10-20')}`);
    expect(openWindows()).toBe(0);
    expect(listPicture(s.pane, 'open')[0]).toBe('[ ] Send chapters one and two {20 Oct}');
  });

  it('keeps the window open with the reason when the new text will not do', async () => {
    const s = await stagePlanner({ todo: TODO });
    menuOf(s.pane, 'Send chapter one').item('Edit text').click();
    const prompt = promptParts(openWindow());
    prompt.input.value = '  ';
    prompt.confirm.click();
    await settle(s);
    expect(prompt.message()).toBe('A to-do needs some text.');
    expect(openWindows()).toBe(1);
    expect(notices()).toEqual([]);
    expect(s.host.file).toBe(TODO);
    prompt.cancel.click();
    expect(openWindows()).toBe(0);
  });

  it('sets the date through a window with the date field of the device', async () => {
    const s = await stagePlanner({ todo: TODO });
    menuOf(s.pane, 'Call the printer').item('Set date').click();
    const modal = openWindow();
    expect(modal).toBeInstanceOf(DatePromptModal as unknown as typeof StubModal);
    expect(modal.titleEl.text).toBe('Set date');
    const prompt = promptParts(modal);
    expect(prompt.input.attrs['type']).toBe('date');
    expect(prompt.input.value).toBe('');

    // Nothing chosen yet: the window says so and stays.
    prompt.confirm.click();
    await settle(s);
    expect(prompt.message()).toBe('Choose a date first.');
    expect(s.host.todoEdits).toBe(0);

    prompt.input.value = '2026-10-30';
    prompt.input.fire('input');
    expect(prompt.message()).toBe('');
    prompt.confirm.click();
    await settle(s);
    expect(lines(s)[6]).toBe(`- [ ] Call the printer ${due('2026-10-30')}`);
    expect(openWindows()).toBe(0);
    expect(listPicture(s.pane, 'open')[2]).toBe('[ ] Call the printer {30 Oct}');
  });

  it('starts the date window with the date the to-do has, and changes it', async () => {
    const s = await stagePlanner({ todo: TODO });
    menuOf(s.pane, 'Send chapter one').item('Set date').click();
    const prompt = promptParts(openWindow());
    expect(prompt.input.value).toBe('2026-10-20');
    prompt.input.value = '2026-10-22';
    key(prompt.input, 'Enter');
    await settle(s);
    expect(lines(s)[1]).toBe(`- [ ] Send chapter one ${due('2026-10-22')}`);
  });

  it('clears the date', async () => {
    const s = await stagePlanner({ todo: TODO });
    menuOf(s.pane, 'Send chapter one').item('Clear date').click();
    await settle(s);
    expect(lines(s)[1]).toBe('- [ ] Send chapter one');
    expect(listPicture(s.pane, 'open')[0]).toBe('[ ] Send chapter one');
    expect(cellPicture(cellOf(s.pane, '2026-10-20')).dots).toBe(0);
  });

  it('moves a to-do up and down among the open ones, without dragging', async () => {
    const s = await stagePlanner({ todo: TODO });
    menuOf(s.pane, 'Call the printer').item('Move up').click();
    await settle(s);
    expect(listPicture(s.pane, 'open').map((row) => row.slice(4, 12))).toEqual(['Send cha', 'Call the', 'לשלוח את']);
    // One line moved in the file; the heading, the done ones and the blank lines stayed.
    expect(lines(s)).toEqual([
      '# Before the launch',
      `- [ ] Send chapter one ${due('2026-10-20')}`,
      '- [x] Choose a name for the ferry',
      '- [ ] Call the printer',
      `- [ ] לשלוח את הפרק ${due('2026-10-12')}`,
      '',
      '## Later',
      `- [x] Pay the editor ${due('2026-10-01')}`,
      '',
    ]);

    menuOf(s.pane, 'Send chapter one').item('Move down').click();
    await settle(s);
    expect(listPicture(s.pane, 'open').map((row) => row.slice(4, 12))).toEqual(['Call the', 'Send cha', 'לשלוח את']);
  });

  it('asks before it removes a to-do, and removes only its line', async () => {
    const s = await stagePlanner({ todo: TODO });
    menuOf(s.pane, 'Call the printer').item('Remove').click();
    const modal = openWindow();
    expect(modal).toBeInstanceOf(ConfirmModal as unknown as typeof StubModal);
    expect(modal.titleEl.text).toBe('Remove this to-do?');
    expect(part(modal.contentEl, 'spellbook-confirm-message').text).toMatch(/^"Call the printer" will be taken out of To-do\.md\./);
    const [cancel] = modal.contentEl.settings[0]?.components as ButtonComponent[];
    cancel?.click();
    await settle(s);
    expect(s.host.file).toBe(TODO);
    expect(openWindows()).toBe(0);

    menuOf(s.pane, 'Call the printer').item('Remove').click();
    const [, confirm] = openWindow().contentEl.settings[0]?.components as ButtonComponent[];
    expect(confirm?.buttonEl.text).toBe('Remove');
    confirm?.click();
    await settle(s);
    expect(lines(s)).toEqual(TODO.split('\n').filter((line) => line !== '- [ ] Call the printer'));
    expect(listPicture(s.pane, 'open')).toHaveLength(2);
  });

  it('says so when the to-do changed in the file while its menu was open', async () => {
    const s = await stagePlanner({ todo: TODO });
    const menu = menuOf(s.pane, 'Send chapter one');
    s.host.file = TODO.replace('Send chapter one', 'Send chapter 1');
    menu.item('Clear date').click();
    await settle(s);
    expect(notices()).toEqual([TODO_CHANGED_NOTICE]);
    expect(s.host.file).toContain(`- [ ] Send chapter 1 ${due('2026-10-20')}`);
    expect(listPicture(s.pane, 'open')[0]).toBe('[ ] Send chapter 1 {20 Oct}');
  });
});

describe('dragging to reorder', () => {
  it('moves a to-do to where it is dropped, with the mouse', async () => {
    const s = await stagePlanner({ todo: TODO });
    layOutTodos(s.pane);
    const rows = todoRows(s.pane, 'open');
    // The last one is dropped on the upper half of the first.
    dragTo(rows[2] as FakeElement, inRow(rows[0] as FakeElement, 0.2));
    await settle(s);
    expect(listPicture(s.pane, 'open').map((row) => row.slice(4, 12))).toEqual(['Call the', 'Send cha', 'לשלוח את']);
    expect(lines(s)[1]).toBe('- [ ] Call the printer');
    expect(lines(s)[2]).toBe(`- [ ] Send chapter one ${due('2026-10-20')}`);
    // Nothing of the drag is left on the page.
    expect(fakeDocument.body.children).toHaveLength(0);
    expect(fakeDocument.listenerCount()).toBe(0);
  });

  it('shows where the to-do would go while it is carried, and nothing where a drop would change nothing', async () => {
    const s = await stagePlanner({ todo: TODO });
    layOutTodos(s.pane);
    const rows = todoRows(s.pane, 'open');
    const grip = part(rows[0] as FakeElement, 'spellbook-todo-text');
    point(grip, 'pointerdown', 60, inRow(rows[0] as FakeElement, 0.5));
    point(grip, 'pointermove', 60, inRow(rows[0] as FakeElement, 0.5) + 6);
    const line = (): FakeElement => fakeDocument.body.withClass('spellbook-drop-line')[0] as FakeElement;
    const ghost = fakeDocument.body.withClass('spellbook-drag-ghost')[0] as FakeElement;
    expect(part(ghost, 'spellbook-drag-ghost-title').text).toBe('Send chapter one');
    expect(part(ghost, 'spellbook-drag-ghost-title').attrs['dir']).toBe('auto');
    expect(rows[0]?.hasClass('spellbook-is-dragged')).toBe(true);
    // On itself, and just below itself: nothing would change.
    expect(line().style['display']).toBe('none');
    point(grip, 'pointermove', 60, inRow(rows[1] as FakeElement, 0.2));
    expect(line().style['display']).toBe('none');
    // The lower half of the next row: after it.
    point(grip, 'pointermove', 60, inRow(rows[1] as FakeElement, 0.8));
    expect(line().style['display']).toBe('');
    expect(line().style['transform']).toBe(`translate(0px, ${LIST_TOP + 2 * ROW_HEIGHT}px)`);
    // Beside the list is nowhere.
    point(grip, 'pointermove', 900, inRow(rows[1] as FakeElement, 0.8));
    expect(line().style['display']).toBe('none');
    point(grip, 'pointerup', 900, inRow(rows[1] as FakeElement, 0.8));
    await settle(s);
    expect(s.host.todoEdits).toBe(0);
    expect(rows[0]?.hasClass('spellbook-is-dragged')).toBe(false);
  });

  it('picks a to-do up after a long press with a finger, and does not tick or open anything by it', async () => {
    const s = await stagePlanner({ todo: TODO });
    layOutTodos(s.pane);
    const rows = todoRows(s.pane, 'open');
    const grip = part(rows[0] as FakeElement, 'spellbook-todo-text');
    const from = inRow(rows[0] as FakeElement, 0.5);
    point(grip, 'pointerdown', 60, from, 'touch');
    expect(fakeDocument.body.withClass('spellbook-drag-ghost')).toHaveLength(0);
    s.timers.advance(TOUCH_HOLD_MS);
    expect(fakeDocument.body.withClass('spellbook-drag-ghost')).toHaveLength(1);
    const to = inRow(rows[2] as FakeElement, 0.9);
    point(grip, 'pointermove', 60, to, 'touch');
    point(grip, 'pointerup', 60, to, 'touch');
    // The click that the same press brings is kept from the list.
    const menus = menusShown();
    click(part(rows[0] as FakeElement, 'spellbook-todo-more'));
    expect(menusShown()).toBe(menus);
    await settle(s);
    expect(listPicture(s.pane, 'open').map((row) => row.slice(4, 12))).toEqual(['לשלוח את', 'Call the', 'Send cha']);
  });

  it('does not pick a to-do up by its tick box or its "more" button', async () => {
    const s = await stagePlanner({ todo: TODO });
    layOutTodos(s.pane);
    const rows = todoRows(s.pane, 'open');
    for (const handle of [boxOf(rows[0] as FakeElement), part(rows[0] as FakeElement, 'spellbook-todo-more')]) {
      point(handle, 'pointerdown', 10, inRow(rows[0] as FakeElement, 0.5));
      point(handle, 'pointermove', 10, inRow(rows[2] as FakeElement, 0.9));
      expect(fakeDocument.body.withClass('spellbook-drag-ghost')).toHaveLength(0);
      point(handle, 'pointerup', 10, inRow(rows[2] as FakeElement, 0.9));
    }
    await settle(s);
    expect(s.host.todoEdits).toBe(0);
  });

  it('keeps a done to-do among the done ones', async () => {
    const s = await stagePlanner({ todo: TODO });
    await showDone(s);
    layOutTodos(s.pane);
    const done = todoRows(s.pane, 'done');
    // Carried all the way up over the open ones: that is "before the first done one".
    dragTo(done[1] as FakeElement, LIST_TOP + 5);
    await settle(s);
    expect(listPicture(s.pane, 'done')).toEqual(['[x] Pay the editor {1 Oct}', '[x] Choose a name for the ferry']);
    expect(listPicture(s.pane, 'open')).toHaveLength(3);
    expect(lines(s)[2]).toBe(`- [x] Pay the editor ${due('2026-10-01')}`);
  });

  it('gives up a drag when the list is drawn anew under it', async () => {
    const s = await stagePlanner({ todo: TODO });
    layOutTodos(s.pane);
    const rows = todoRows(s.pane, 'open');
    const grip = part(rows[0] as FakeElement, 'spellbook-todo-text');
    point(grip, 'pointerdown', 60, inRow(rows[0] as FakeElement, 0.5));
    point(grip, 'pointermove', 60, inRow(rows[0] as FakeElement, 0.5) + 6);
    expect(fakeDocument.body.withClass('spellbook-drag-ghost')).toHaveLength(1);
    s.host.file = `${TODO}- [ ] From another device\n`;
    s.host.sync();
    await settle(s);
    expect(fakeDocument.body.withClass('spellbook-drag-ghost')).toHaveLength(0);
    point(grip, 'pointerup', 60, inRow(rows[2] as FakeElement, 0.9));
    await settle(s);
    expect(s.host.todoEdits).toBe(0);
  });

  it('ends a drag that is on when the view closes', async () => {
    const s = await stagePlanner({ todo: TODO });
    layOutTodos(s.pane);
    const row = todoRows(s.pane, 'open')[0] as FakeElement;
    const grip = part(row, 'spellbook-todo-text');
    point(grip, 'pointerdown', 60, inRow(row, 0.5));
    point(grip, 'pointermove', 60, inRow(row, 0.5) + 6);
    await s.shell.close();
    expect(fakeDocument.body.children).toHaveLength(0);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(s.timers.pending).toBe(0);
  });
});

describe('a project that cannot be changed', () => {
  it('shows the to-dos and offers no way to change them', async () => {
    const s = await stagePlanner({
      todo: TODO,
      setup: (host) => {
        host.readOnly = true;
      },
    });
    expect(listPicture(s.pane, 'open')).toHaveLength(3);
    expect(unused(one(s.pane, 'spellbook-todo-add'))).toBe(true);
    expect(todoRows(s.pane, 'open').every((row) => boxOf(row).disabled)).toBe(true);
    expect(s.pane.withClass('spellbook-todo-more')).toHaveLength(0);
    layOutTodos(s.pane);
    const rows = todoRows(s.pane, 'open');
    dragTo(rows[2] as FakeElement, inRow(rows[0] as FakeElement, 0.2));
    rows[0]?.fire('contextmenu', { button: 2 });
    await settle(s);
    expect(s.host.todoEdits).toBe(0);
    expect(menusShown()).toBe(0);
  });

  it('offers everything again when the project can be changed again', async () => {
    const s = await stagePlanner({
      todo: TODO,
      setup: (host) => {
        host.readOnly = true;
      },
    });
    s.host.readOnly = false;
    s.host.emit('data');
    await settle(s);
    expect(unused(one(s.pane, 'spellbook-todo-add'))).toBe(false);
    expect(todoRows(s.pane, 'open').every((row) => !boxOf(row).disabled)).toBe(true);
    expect(s.pane.withClass('spellbook-todo-more')).toHaveLength(3);
  });
});

describe('a long list', () => {
  const many = (count: number, box = ' '): string =>
    Array.from({ length: count }, (_, at) => `- [${box}] To-do number ${at + 1}${at % 5 === 0 ? ` ${due('2026-11-01')}` : ''}`).join('\n');

  it('is built in pieces, a screenful first, so that the screen never waits for it', async () => {
    const s = await stagePlanner({ todo: many(2000) });
    expect(todoRows(s.pane, 'open')).toHaveLength(ROWS_AT_ONCE);
    expect(one(s.pane, 'spellbook-todos-count').text).toBe('2000 open');
    s.timers.advance(FRAME_MS);
    expect(todoRows(s.pane, 'open')).toHaveLength(ROWS_AT_ONCE + ROWS_A_PIECE);
    s.timers.advance(FRAME_MS * 30);
    expect(todoRows(s.pane, 'open')).toHaveLength(2000);
    expect(s.timers.pending).toBe(0);
    // In the order of the file, each once.
    expect(part(todoRows(s.pane, 'open')[1999] as FakeElement, 'spellbook-todo-text').text).toBe('To-do number 2000');
    expect(part(todoRows(s.pane, 'open')[61] as FakeElement, 'spellbook-todo-text').text).toBe('To-do number 62');
  });

  it('builds nothing again for one change in two thousand', async () => {
    const s = await stagePlanner({ todo: many(2000) });
    s.timers.advance(FRAME_MS * 30);
    const before = todoRows(s.pane, 'open').slice();
    const made = vi.spyOn(FakeElement.prototype, 'createEl');
    const moved = vi.spyOn(FakeElement.prototype, 'appendChild');
    flip(boxOf(before[700] as FakeElement));
    await settle(s);
    const after = todoRows(s.pane, 'open');
    expect(after).toHaveLength(1999);
    expect(after[0]).toBe(before[0]);
    expect(after[699]).toBe(before[699]);
    expect(after[700]).toBe(before[701]);
    expect(after[1998]).toBe(before[1999]);
    // No row was built or moved in the list.
    expect(moved).not.toHaveBeenCalled();
    expect(made.mock.contexts.every((element) => (element as FakeElement).closest('spellbook-todos') === null)).toBe(true);
  });

  it('adds one row for one to-do added to two thousand', async () => {
    const s = await stagePlanner({ todo: many(2000) });
    s.timers.advance(FRAME_MS * 30);
    const first = todoRows(s.pane, 'open')[0];
    const moved = vi.spyOn(FakeElement.prototype, 'appendChild');
    const form = addForm(s.pane);
    form.text.value = 'One more';
    key(form.text, 'Enter');
    await settle(s);
    expect(todoRows(s.pane, 'open')).toHaveLength(2001);
    expect(todoRows(s.pane, 'open')[0]).toBe(first);
    expect(moved).toHaveBeenCalledTimes(1);
  });

  it('moves the rows and builds none when one of two thousand is moved', async () => {
    const s = await stagePlanner({ todo: many(2000) });
    s.timers.advance(FRAME_MS * 30);
    const before = todoRows(s.pane, 'open').slice();
    menuOf(s.pane, 'To-do number 3').item('Move up').click();
    await settle(s);
    const after = todoRows(s.pane, 'open');
    expect(after).toHaveLength(2000);
    expect(after[1]).toBe(before[2]);
    expect(after[2]).toBe(before[1]);
    expect(after[1999]).toBe(before[1999]);
    expect(s.timers.pending).toBe(0);
  });

  it('does not build what is folded shut, and builds "Done" in pieces when it is unfolded', async () => {
    const s = await stagePlanner({ todo: `${many(500, 'x')}\n- [ ] The one that is left` });
    expect(todoRows(s.pane, 'done')).toHaveLength(0);
    expect(one(s.pane, 'spellbook-todos').withClass('spellbook-todo-row')).toHaveLength(1);
    expect(one(s.pane, 'spellbook-todos-done-toggle').fullText).toBe('Done 500');
    await showDone(s);
    expect(todoRows(s.pane, 'done')).toHaveLength(ROWS_AT_ONCE);
    s.timers.advance(FRAME_MS * 10);
    expect(todoRows(s.pane, 'done')).toHaveLength(500);
  });

  it('stops building when the view closes', async () => {
    const s = await stagePlanner({ todo: many(2000) });
    expect(s.timers.pending).toBe(1);
    await s.shell.close();
    expect(s.timers.pending).toBe(0);
  });

  it('starts over cleanly when the file changes while the list is still being built', async () => {
    const s = await stagePlanner({ todo: many(2000) });
    s.timers.advance(FRAME_MS);
    s.host.file = `- [ ] Brand new first\n${many(2000)}`;
    s.host.sync();
    await settle(s);
    s.timers.advance(FRAME_MS * 30);
    const rows = todoRows(s.pane, 'open');
    expect(rows).toHaveLength(2001);
    expect(part(rows[0] as FakeElement, 'spellbook-todo-text').text).toBe('Brand new first');
    expect(part(rows[2000] as FakeElement, 'spellbook-todo-text').text).toBe('To-do number 2000');
    expect(new Set(rows).size).toBe(2001);
  });

  it('draws a month of a calendar with two thousand to-dos on it', async () => {
    const dated = Array.from({ length: 2000 }, (_, at) => `- [ ] Event ${at} ${due(`2026-10-${String((at % 28) + 1).padStart(2, '0')}`)}`).join('\n');
    const s = await stagePlanner({ todo: dated });
    expect(cellPicture(cellOf(s.pane, '2026-10-01'))).toMatchObject({ dots: 3, more: '+69' });
    expect(cellOf(s.pane, '2026-10-30').withClass('spellbook-day-dot')).toHaveLength(0);
  });
});
