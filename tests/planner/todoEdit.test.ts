import { describe, expect, it } from 'vitest';
import {
  DUE_MARK,
  addTask,
  findTask,
  moveTask,
  parseTodo,
  removeTask,
  setTaskDone,
  setTaskDue,
  setTaskText,
  todoText,
  toggleTask,
} from '../../src/core/planner';
import type { TaskRef, TodoEdit, TodoTask } from '../../src/core/planner';
import { fixedRandom } from '../storeHarness';

// Hebrew: "send chapter one to the editor", "buy ink", "call the printer".
const SEND_CHAPTER = 'לשלוח את פרק אחד לעורכת';
const BUY_INK = 'לקנות דיו';
const CALL_PRINTER = 'להתקשר לבית הדפוס';
const RLM = '\u{200F}';
const BOM = '\u{FEFF}';
const EMOJI_STYLE = '\u{FE0F}';

type Done = Extract<TodoEdit, { status: 'done' }>;

/** The result of a change that must have gone through. */
function done(edit: TodoEdit): Done {
  if (edit.status !== 'done') throw new Error(`expected the change to be made, but: ${edit.status} (${edit.reason}) ${edit.message}`);
  return edit;
}

/** Why a change was not made: "noop:not-found", "refused:invalid-date" and so on. */
function outcome(edit: TodoEdit): string {
  return edit.status === 'done' ? 'done' : `${edit.status}:${edit.reason}`;
}

/** The to-do whose title is `title`. */
function task(text: string, title: string): TodoTask {
  const found = parseTodo(text).tasks.filter((candidate) => candidate.title === title);
  if (found.length !== 1) throw new Error(`expected one to-do titled "${title}", found ${found.length}`);
  return found[0] as TodoTask;
}

/** The last to-do of a file. */
function lastTask(text: string): TodoTask | undefined {
  const tasks = parseTodo(text).tasks;
  return tasks[tasks.length - 1];
}

/** A text cut into its lines, each with its own line break. Joined, they are the text again. */
function linesOf(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

/** Check that two texts differ in exactly one line, at `line`, and return [before, after] of that line. */
function onlyLineChanged(before: string, after: string, line: number): [string, string] {
  const a = linesOf(before);
  const b = linesOf(after);
  expect(b.length).toBe(a.length);
  a.forEach((original, position) => {
    if (position !== line) expect(b[position], `line ${position} must not change`).toBe(original);
  });
  expect(b[line]).not.toBe(a[line]);
  return [a[line] as string, b[line] as string];
}

const FILE = [
  '# To-do',
  '',
  `- [ ] Send chapter one ${DUE_MARK} 2026-10-20`,
  '- [x] Choose a name for the ferry',
  `* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22`,
  '',
  '## Later',
  '',
  '- [ ] Buy ink',
  `- [/] ${BUY_INK}`,
  '',
  'A closing note.',
  '',
].join('\n');

describe('addTask', () => {
  it('adds after the last to-do, leaving every other line as it was', () => {
    const edit = done(addTask(FILE, { title: 'Call the printer' }));
    expect(edit.text).toBe(FILE.replace(`- [/] ${BUY_INK}\n`, `- [/] ${BUY_INK}\n- [ ] Call the printer\n`));
    expect(edit.task).toEqual({ line: 10, raw: '- [ ] Call the printer' });
    expect(parseTodo(edit.text).tasks.map((item) => item.title).pop()).toBe('Call the printer');
  });

  it('adds at the end of a file that has no to-dos', () => {
    expect(done(addTask('', { title: 'First' })).text).toBe('- [ ] First\n');
    expect(done(addTask('# To-do\n', { title: 'First' })).text).toBe('# To-do\n- [ ] First\n');
    expect(done(addTask('# To-do\n\n', { title: 'First' })).text).toBe('# To-do\n\n- [ ] First\n');
    expect(done(addTask('# To-do\n\nSome text.\n', { title: 'First' })).task).toEqual({ line: 3, raw: '- [ ] First' });
  });

  it('keeps the way the file ends: with or without a last line break', () => {
    expect(done(addTask('# To-do', { title: 'First' })).text).toBe('# To-do\n- [ ] First');
    expect(done(addTask('- [ ] a', { title: 'b' })).text).toBe('- [ ] a\n- [ ] b');
    expect(done(addTask('- [ ] a\n', { title: 'b' })).text).toBe('- [ ] a\n- [ ] b\n');
    expect(done(addTask('- [ ] a\n\n\n', { title: 'b' })).text).toBe('- [ ] a\n- [ ] b\n\n\n');
  });

  it('uses the line breaks the file already has', () => {
    expect(done(addTask('# To-do\r\n- [ ] a\r\n', { title: 'b' })).text).toBe('# To-do\r\n- [ ] a\r\n- [ ] b\r\n');
    expect(done(addTask('# To-do\r\n- [ ] a', { title: 'b' })).text).toBe('# To-do\r\n- [ ] a\r\n- [ ] b');
    expect(done(addTask('# To-do\r\n- [ ] a\r\ntext\r\n', { title: 'b' })).text).toBe('# To-do\r\n- [ ] a\r\n- [ ] b\r\ntext\r\n');
    expect(done(addTask(`${BOM}# To-do\r- [ ] a\r`, { title: 'b' })).text).toBe(`${BOM}# To-do\r- [ ] a\r- [ ] b\r`);
  });

  it('writes the due date in the Tasks format, and can add a to-do already done', () => {
    expect(done(addTask('', { title: 'Send', due: '2026-10-20' })).text).toBe(`- [ ] Send ${DUE_MARK} 2026-10-20\n`);
    expect(done(addTask('', { title: 'Send', due: null })).text).toBe('- [ ] Send\n');
    expect(done(addTask('', { title: 'Sent', done: true })).text).toBe('- [x] Sent\n');
    const added = lastTask(done(addTask(FILE, { title: 'Send', due: '2024-02-29' })).text);
    expect([added?.title, added?.due, added?.done]).toEqual(['Send', '2024-02-29', false]);
  });

  it('adds Hebrew text exactly as given', () => {
    const edit = done(addTask(FILE, { title: CALL_PRINTER, due: '2026-11-01' }));
    expect(edit.task?.raw).toBe(`- [ ] ${CALL_PRINTER} ${DUE_MARK} 2026-11-01`);
    const added = task(edit.text, CALL_PRINTER);
    expect(added.due).toBe('2026-11-01');
    expect(added.line).toBe(10);
    // direction marks the writer typed are part of the text
    const marked = `${RLM}${BUY_INK} 2${RLM}`;
    expect(task(done(addTask('', { title: marked })).text, marked).title).toBe(marked);
  });

  it('keeps a to-do on one line and trims its ends, but never its inside', () => {
    expect(done(addTask('', { title: '  Send   chapter  one \n' })).text).toBe('- [ ] Send   chapter  one\n');
    expect(done(addTask('', { title: 'first line\nsecond line\r\n\r\nthird' })).text).toBe('- [ ] first line second line third\n');
  });

  it('refuses a to-do without text, and a date that is not one', () => {
    for (const title of ['', '   ', '\n', ' \t\r\n ']) {
      expect(outcome(addTask(FILE, { title })), JSON.stringify(title)).toBe('refused:empty-text');
    }
    for (const due of ['2026-02-30', '20/10/2026', 'tomorrow', '', '2026-10-20 ']) {
      expect(outcome(addTask(FILE, { title: 'Send', due })), due).toBe('refused:invalid-date');
    }
  });

  it('takes a date typed into the title as the due date; a date given separately wins', () => {
    const typed = done(addTask('', { title: `Send ${DUE_MARK} 2026-10-20` }));
    expect(typed.text).toBe(`- [ ] Send ${DUE_MARK} 2026-10-20\n`);
    const both = done(addTask('', { title: `Send ${DUE_MARK} 2026-10-20`, due: '2026-12-24' }));
    expect(both.text).toBe(`- [ ] Send ${DUE_MARK} 2026-12-24\n`);
  });

  it('goes after the notes written under the last to-do, not between it and them', () => {
    const text = ['- [ ] Send chapter', '  Dana: dana@example.com', '', '    a second paragraph of the note', '', 'Not part of it.', ''].join('\n');
    const edit = done(addTask(text, { title: 'Next' }));
    expect(edit.text).toBe(
      ['- [ ] Send chapter', '  Dana: dana@example.com', '', '    a second paragraph of the note', '- [ ] Next', '', 'Not part of it.', ''].join('\n'),
    );
    expect(edit.task?.line).toBe(4);
  });

  it('joins the list it is added to: same bullet, and the indent of the list, not of a sub-task', () => {
    expect(done(addTask('* [ ] a\n* [ ] b\n', { title: 'c' })).text).toBe('* [ ] a\n* [ ] b\n* [ ] c\n');
    expect(done(addTask('- [ ] a\n    - [ ] part of a\n', { title: 'c' })).text).toBe('- [ ] a\n    - [ ] part of a\n- [ ] c\n');
    expect(done(addTask('- Book launch\n\t+ [ ] a\n\t+ [ ] b\n', { title: 'c' })).text).toBe('- Book launch\n\t+ [ ] a\n\t+ [ ] b\n\t+ [ ] c\n');
    // an earlier list, cut off by other lines, has no say
    expect(done(addTask('* [ ] old\n\ntext\n\n  - [ ] new list\n', { title: 'c' })).text).toBe('* [ ] old\n\ntext\n\n  - [ ] new list\n  - [ ] c\n');
  });

  it('hands back a name for the new to-do that works for the next change', () => {
    const added = done(addTask(FILE, { title: 'Call the printer' }));
    const ticked = done(toggleTask(added.text, added.task as TaskRef));
    expect(task(ticked.text, 'Call the printer').done).toBe(true);
  });

  it('never adds inside a code block, where the line would be code and no to-do', () => {
    const cases: Array<[string, string, string]> = [
      // [what, the file, the file after "First" was added]
      ['no to-dos, and a block that is never closed: above it', '```\nnotes\n', '- [ ] First\n```\nnotes\n'],
      ['the same under a heading', '# To-do\n\n~~~\nnotes', '# To-do\n\n- [ ] First\n~~~\nnotes'],
      ['the same under the properties', '---\ntags: x\n---\n```js\ncode', '---\ntags: x\n---\n- [ ] First\n```js\ncode'],
      ['no to-dos, and a block that is closed: at the end', '```\nnotes\n```\n', '```\nnotes\n```\n- [ ] First\n'],
      ['a block among the last to-do\'s notes: after the whole block', '- [ ] a\n  ```\ncode\n  ```\n', '- [ ] a\n  ```\ncode\n  ```\n- [ ] First\n'],
      ['with more of the note after the block', '- [ ] a\n  ~~~\n\n- [ ] sample\n  ~~~\n  and more\ntext\n', '- [ ] a\n  ~~~\n\n- [ ] sample\n  ~~~\n  and more\n- [ ] First\ntext\n'],
      ['a block under the last to-do that is no note of it: above the block', '- [ ] a\n```\ncode\n```\n', '- [ ] a\n- [ ] First\n```\ncode\n```\n'],
      ['a note of the last to-do that is a block never closed: above it', '- [ ] a\n  a note\n  ```\n  code\n', '- [ ] a\n  a note\n- [ ] First\n  ```\n  code\n'],
      ['a block never closed, further down: the usual place', '- [ ] a\n\n```\nopen', '- [ ] a\n- [ ] First\n\n```\nopen'],
      ['windows line breaks', '- [ ] a\r\n  ```\r\ncode\r\n  ```\r\n', '- [ ] a\r\n  ```\r\ncode\r\n  ```\r\n- [ ] First\r\n'],
    ];
    for (const [what, text, expected] of cases) {
      const before = parseTodo(text).tasks.length;
      const edit = done(addTask(text, { title: 'First' }));
      expect(edit.text, what).toBe(expected);
      // the new line really is a to-do, and the name handed back finds it
      const after = parseTodo(edit.text);
      expect(after.tasks.length, what).toBe(before + 1);
      expect(findTask(after, edit.task as TaskRef)?.title, what).toBe('First');
      expect(lastTask(edit.text)?.title, what).toBe('First');
      expect(task(done(toggleTask(edit.text, edit.task as TaskRef)).text, 'First').done, what).toBe(true);
    }
    const hebrew = done(addTask('```\nnotes\n', { title: SEND_CHAPTER, due: '2026-10-20' }));
    expect(hebrew.text).toBe(`- [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-20\n\`\`\`\nnotes\n`);
    expect(task(hebrew.text, SEND_CHAPTER).due).toBe('2026-10-20');
  });
});

describe('setTaskDone and toggleTask', () => {
  it('changes the one character in the box and nothing else', () => {
    const edit = done(toggleTask(FILE, task(FILE, 'Send chapter one')));
    const [before, after] = onlyLineChanged(FILE, edit.text, 2);
    expect(before).toBe(`- [ ] Send chapter one ${DUE_MARK} 2026-10-20\n`);
    expect(after).toBe(`- [x] Send chapter one ${DUE_MARK} 2026-10-20\n`);
    expect(edit.task).toEqual({ line: 2, raw: `- [x] Send chapter one ${DUE_MARK} 2026-10-20` });
  });

  it('unticks with a space, whatever the tick looked like', () => {
    expect(done(toggleTask(FILE, task(FILE, 'Choose a name for the ferry'))).text).toContain('- [ ] Choose a name for the ferry\n');
    expect(done(toggleTask('  * [X]   shouted  ', { line: 0, raw: '  * [X]   shouted  ' })).text).toBe('  * [ ]   shouted  ');
  });

  it('ticks a to-do whose box held some other character', () => {
    const edit = done(toggleTask(FILE, task(FILE, BUY_INK)));
    expect(onlyLineChanged(FILE, edit.text, 9)).toEqual([`- [/] ${BUY_INK}\n`, `- [x] ${BUY_INK}\n`]);
  });

  it('ticks a Hebrew to-do without touching its text or date', () => {
    const edit = done(setTaskDone(FILE, task(FILE, SEND_CHAPTER), true));
    expect(onlyLineChanged(FILE, edit.text, 4)).toEqual([
      `* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22\n`,
      `* [x] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22\n`,
    ]);
  });

  it('changes nothing when the to-do is already as asked, and keeps an odd box as it is', () => {
    expect(outcome(setTaskDone(FILE, task(FILE, 'Choose a name for the ferry'), true))).toBe('noop:unchanged');
    expect(outcome(setTaskDone(FILE, task(FILE, 'Buy ink'), false))).toBe('noop:unchanged');
    expect(outcome(setTaskDone(FILE, task(FILE, BUY_INK), false))).toBe('noop:unchanged');
    expect(outcome(setTaskDone('- [X] a', { line: 0, raw: '- [X] a' }, true))).toBe('noop:unchanged');
  });

  it('adds no done date and removes none: those belong to the text', () => {
    const line = '- [x] Sent ✅ 2026-10-19';
    expect(done(toggleTask(line, { line: 0, raw: line })).text).toBe('- [ ] Sent ✅ 2026-10-19');
    expect(done(toggleTask('- [ ] Send', { line: 0, raw: '- [ ] Send' })).text).toBe('- [x] Send');
  });

  it('works on a box with nothing after it', () => {
    expect(done(toggleTask('- [ ]', { line: 0, raw: '- [ ]' })).text).toBe('- [x]');
    expect(done(toggleTask('- [x] \n', { line: 0, raw: '- [x] ' })).text).toBe('- [ ] \n');
  });
});

describe('setTaskText', () => {
  it('replaces the title and keeps the box, the bullet, the indent and the due date', () => {
    const edit = done(setTaskText(FILE, task(FILE, SEND_CHAPTER), CALL_PRINTER));
    expect(onlyLineChanged(FILE, edit.text, 4)).toEqual([
      `* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22\n`,
      `* [ ] ${CALL_PRINTER} ${DUE_MARK} 2026-10-22\n`,
    ]);
    const changed = task(edit.text, CALL_PRINTER);
    expect([changed.due, changed.done, changed.bullet]).toEqual(['2026-10-22', false, '*']);

    const indented = '\t+ [/]  old words';
    expect(done(setTaskText(indented, { line: 0, raw: indented }, 'new words')).text).toBe('\t+ [/]  new words');
    expect(done(setTaskText('- [x] old', { line: 0, raw: '- [x] old' }, 'new')).text).toBe('- [x] new');
  });

  it('keeps the due date exactly as it was written', () => {
    const line = `- [ ] Send \u{1F4C6}${EMOJI_STYLE}  2026-10-20`;
    expect(done(setTaskText(line, { line: 0, raw: line }, 'Post')).text).toBe(`- [ ] Post \u{1F4C6}${EMOJI_STYLE}  2026-10-20`);
    const middle = `- [ ] Send ${DUE_MARK} 2026-10-20 to Dana ⏫`;
    expect(done(setTaskText(middle, { line: 0, raw: middle }, 'Post to Dana ⏫')).text).toBe(`- [ ] Post to Dana ⏫ ${DUE_MARK} 2026-10-20`);
  });

  it('keeps a block id last on the line, where Obsidian needs it', () => {
    const line = `- [ ] Send ${DUE_MARK} 2026-10-20 ^send-1`;
    expect(parseTodo(line).tasks[0]?.title).toBe('Send ^send-1');
    expect(done(setTaskText(line, { line: 0, raw: line }, 'Post ^send-1')).text).toBe(`- [ ] Post ${DUE_MARK} 2026-10-20 ^send-1`);
  });

  it('lets a date typed into the new title replace the old one', () => {
    const line = `- [ ] Send ${DUE_MARK} 2026-10-20`;
    const edit = done(setTaskText(line, { line: 0, raw: line }, `Post ${DUE_MARK} 2026-12-01`));
    expect(edit.text).toBe(`- [ ] Post ${DUE_MARK} 2026-12-01`);
  });

  it('passes the new text through untouched inside, on one line', () => {
    const line = '- [ ] old';
    const ref = { line: 0, raw: line };
    expect(done(setTaskText(line, ref, `  ${BUY_INK}   (x2)  `)).text).toBe(`- [ ] ${BUY_INK}   (x2)`);
    expect(done(setTaskText(line, ref, 'one\ntwo')).text).toBe('- [ ] one two');
    expect(done(setTaskText(line, ref, '[x] looks like a box')).text).toBe('- [ ] [x] looks like a box');
    expect(parseTodo('- [ ] [x] looks like a box').tasks[0]?.done).toBe(false);
  });

  it('gives a to-do that had no text a space before its new text', () => {
    expect(done(setTaskText('- [ ]', { line: 0, raw: '- [ ]' }, 'now with words')).text).toBe('- [ ] now with words');
  });

  it('refuses an empty title and reports a title that is no different', () => {
    const ref = task(FILE, 'Buy ink');
    expect(outcome(setTaskText(FILE, ref, '  '))).toBe('refused:empty-text');
    expect(outcome(setTaskText(FILE, ref, 'Buy ink'))).toBe('noop:unchanged');
    expect(outcome(setTaskText(FILE, ref, ' Buy ink\n'))).toBe('noop:unchanged');
    expect(outcome(setTaskText(FILE, task(FILE, 'Send chapter one'), 'Send chapter one'))).toBe('noop:unchanged');
  });
});

describe('setTaskDue', () => {
  it('adds a date to a to-do that has none, at the end of its line', () => {
    const edit = done(setTaskDue(FILE, task(FILE, 'Buy ink'), '2026-11-02'));
    expect(onlyLineChanged(FILE, edit.text, 8)).toEqual(['- [ ] Buy ink\n', `- [ ] Buy ink ${DUE_MARK} 2026-11-02\n`]);
    expect(task(edit.text, 'Buy ink').due).toBe('2026-11-02');
  });

  it('adds a date after Hebrew text', () => {
    const edit = done(setTaskDue(FILE, task(FILE, BUY_INK), '2026-11-03'));
    expect(onlyLineChanged(FILE, edit.text, 9)).toEqual([`- [/] ${BUY_INK}\n`, `- [/] ${BUY_INK} ${DUE_MARK} 2026-11-03\n`]);
    const read = task(edit.text, BUY_INK);
    expect([read.due, read.box]).toEqual(['2026-11-03', '/']);
  });

  it('puts a new date before a block id and before spaces that trail the line', () => {
    const cases: Array<[string, string]> = [
      ['- [ ] Send ^abc-1', `- [ ] Send ${DUE_MARK} 2026-10-20 ^abc-1`],
      ['- [ ] Send   ^abc-1  ', `- [ ] Send ${DUE_MARK} 2026-10-20   ^abc-1  `],
      ['- [ ] Send  ', `- [ ] Send ${DUE_MARK} 2026-10-20  `],
      ['- [ ] Send #tag ⏫', `- [ ] Send #tag ⏫ ${DUE_MARK} 2026-10-20`],
      ['- [ ] Send^not-an-id', `- [ ] Send^not-an-id ${DUE_MARK} 2026-10-20`],
      ['- [ ] ^only-id', `- [ ] ${DUE_MARK} 2026-10-20 ^only-id`],
      ['- [ ] ', `- [ ] ${DUE_MARK} 2026-10-20`],
      ['- [ ]', `- [ ] ${DUE_MARK} 2026-10-20`],
    ];
    for (const [line, expected] of cases) {
      const edit = done(setTaskDue(line, { line: 0, raw: line }, '2026-10-20'));
      expect(edit.text, line).toBe(expected);
      expect(parseTodo(edit.text).tasks[0]?.due).toBe('2026-10-20');
    }
  });

  it('changes a date where it stands: only the digits are rewritten', () => {
    const edit = done(setTaskDue(FILE, task(FILE, 'Send chapter one'), '2026-11-15'));
    expect(onlyLineChanged(FILE, edit.text, 2)).toEqual([
      `- [ ] Send chapter one ${DUE_MARK} 2026-10-20\n`,
      `- [ ] Send chapter one ${DUE_MARK} 2026-11-15\n`,
    ]);
    const odd = `- [x] Send \u{1F4C6}${EMOJI_STYLE}  2026-10-20 to Dana \u{23EB} ^id1  `;
    expect(done(setTaskDue(odd, { line: 0, raw: odd }, '2027-01-01')).text).toBe(`- [x] Send \u{1F4C6}${EMOJI_STYLE}  2027-01-01 to Dana \u{23EB} ^id1  `);
    const hebrew = `- [ ] ${SEND_CHAPTER} ${DUE_MARK}${RLM} 2026-10-20`;
    expect(done(setTaskDue(hebrew, { line: 0, raw: hebrew }, '2026-10-21')).text).toBe(`- [ ] ${SEND_CHAPTER} ${DUE_MARK}${RLM} 2026-10-21`);
  });

  it('changes the date that counts when a line has two', () => {
    const line = `- [ ] Send ${DUE_MARK} 2026-10-20 ${DUE_MARK} 2026-11-05`;
    const edit = done(setTaskDue(line, { line: 0, raw: line }, '2026-12-01'));
    expect(edit.text).toBe(`- [ ] Send ${DUE_MARK} 2026-10-20 ${DUE_MARK} 2026-12-01`);
    expect(parseTodo(edit.text).tasks[0]?.due).toBe('2026-12-01');
  });

  it('clears a date and leaves the rest of the line', () => {
    const cases: Array<[string, string]> = [
      [`- [ ] Send ${DUE_MARK} 2026-10-20`, '- [ ] Send'],
      [`- [x] Send ${DUE_MARK} 2026-10-20 to Dana ⏫`, '- [x] Send to Dana ⏫'],
      [`- [ ] ${DUE_MARK} 2026-10-20 Send`, '- [ ] Send'],
      [`- [ ] ${DUE_MARK} 2026-10-20`, '- [ ] '],
      [`- [ ] Send ${DUE_MARK} 2026-10-20 ^abc`, '- [ ] Send ^abc'],
      [`- [ ] Send ${DUE_MARK} 2026-10-20 ${DUE_MARK} 2026-11-05`, '- [ ] Send'],
      [`\t* [/] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-20`, `\t* [/] ${SEND_CHAPTER}`],
      [`- [ ] ${BUY_INK}${RLM} ${DUE_MARK} 2026-10-20 ⏳ 2026-10-18`, `- [ ] ${BUY_INK}${RLM} ⏳ 2026-10-18`],
    ];
    for (const [line, expected] of cases) {
      const edit = done(setTaskDue(line, { line: 0, raw: line }, null));
      expect(edit.text, line).toBe(expected);
      expect(parseTodo(edit.text).tasks[0]?.due).toBeNull();
    }
    const edit = done(setTaskDue(FILE, task(FILE, SEND_CHAPTER), null));
    expect(onlyLineChanged(FILE, edit.text, 4)).toEqual([`* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22\n`, `* [ ] ${SEND_CHAPTER}\n`]);
  });

  it('leaves a date that does not exist in the text and adds the real one after it', () => {
    const line = `- [ ] Send ${DUE_MARK} 2026-02-30`;
    expect(done(setTaskDue(line, { line: 0, raw: line }, '2026-03-01')).text).toBe(`- [ ] Send ${DUE_MARK} 2026-02-30 ${DUE_MARK} 2026-03-01`);
    expect(outcome(setTaskDue(line, { line: 0, raw: line }, null))).toBe('noop:unchanged');
  });

  it('refuses a date that is not one, and reports a date that is no different', () => {
    const ref = task(FILE, 'Send chapter one');
    for (const due of ['2026-02-30', '2026-10-2', '20.10.2026', 'next week', '']) {
      expect(outcome(setTaskDue(FILE, ref, due)), due).toBe('refused:invalid-date');
    }
    expect(outcome(setTaskDue(FILE, ref, '2026-10-20'))).toBe('noop:unchanged');
    expect(outcome(setTaskDue(FILE, task(FILE, 'Buy ink'), null))).toBe('noop:unchanged');
  });
});

describe('removeTask', () => {
  it('removes the line and its own line break, and nothing else', () => {
    const edit = done(removeTask(FILE, task(FILE, 'Choose a name for the ferry')));
    expect(edit.text).toBe(FILE.replace('- [x] Choose a name for the ferry\n', ''));
    expect(edit.task).toBeNull();
    const hebrew = done(removeTask(FILE, task(FILE, SEND_CHAPTER)));
    expect(hebrew.text).toBe(FILE.replace(`* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22\n`, ''));
  });

  it('copes with the last line, with and without a line break after it', () => {
    expect(done(removeTask('- [ ] a\n- [ ] b\n', { line: 1, raw: '- [ ] b' })).text).toBe('- [ ] a\n');
    expect(done(removeTask('- [ ] a\n- [ ] b', { line: 1, raw: '- [ ] b' })).text).toBe('- [ ] a\n');
    expect(done(removeTask('- [ ] a', { line: 0, raw: '- [ ] a' })).text).toBe('');
    expect(done(removeTask('- [ ] a\n', { line: 0, raw: '- [ ] a' })).text).toBe('');
    expect(done(removeTask(`${BOM}- [ ] a\r\n- [ ] b\r\n`, { line: 0, raw: '- [ ] a' })).text).toBe(`${BOM}- [ ] b\r\n`);
  });

  it('keeps each remaining line with its own kind of line break', () => {
    const text = 'head\r\n- [ ] a\n- [ ] b\rtail\r\n';
    expect(done(removeTask(text, { line: 1, raw: '- [ ] a' })).text).toBe('head\r\n- [ ] b\rtail\r\n');
    expect(done(removeTask(text, { line: 2, raw: '- [ ] b' })).text).toBe('head\r\n- [ ] a\ntail\r\n');
  });

  it('leaves the notes under a removed to-do in the file', () => {
    const text = '- [ ] a\n  a note\n- [ ] b\n';
    expect(done(removeTask(text, { line: 0, raw: '- [ ] a' })).text).toBe('  a note\n- [ ] b\n');
  });
});

describe('moveTask', () => {
  const LIST = ['- [ ] one', '- [ ] two', `- [x] ${BUY_INK}`, '- [ ] four'].join('\n') + '\n';
  const order = (text: string): string[] => parseTodo(text).tasks.map((item) => item.title);

  it('moves a to-do before or after another', () => {
    expect(order(done(moveTask(LIST, task(LIST, 'four'), task(LIST, 'one'), 'before')).text)).toEqual(['four', 'one', 'two', BUY_INK]);
    expect(order(done(moveTask(LIST, task(LIST, 'four'), task(LIST, 'one'), 'after')).text)).toEqual(['one', 'four', 'two', BUY_INK]);
    expect(order(done(moveTask(LIST, task(LIST, 'one'), task(LIST, 'four'), 'after')).text)).toEqual(['two', BUY_INK, 'four', 'one']);
    expect(order(done(moveTask(LIST, task(LIST, 'one'), task(LIST, 'four'), 'before')).text)).toEqual(['two', BUY_INK, 'one', 'four']);
    expect(order(done(moveTask(LIST, task(LIST, BUY_INK), task(LIST, 'one'), 'before')).text)).toEqual([BUY_INK, 'one', 'two', 'four']);
  });

  it('moves the line as it is, Hebrew, box and date included, and says where it went', () => {
    const edit = done(moveTask(FILE, task(FILE, SEND_CHAPTER), task(FILE, 'Buy ink'), 'after'));
    expect(edit.task).toEqual({ line: 8, raw: `* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22` });
    expect(findTask(parseTodo(edit.text), edit.task as TaskRef)?.title).toBe(SEND_CHAPTER);
    expect(order(edit.text)).toEqual(['Send chapter one', 'Choose a name for the ferry', 'Buy ink', SEND_CHAPTER, BUY_INK]);
  });

  it('moves exactly one line: headings, notes and blank lines keep their text and their order', () => {
    const edit = done(moveTask(FILE, task(FILE, BUY_INK), task(FILE, 'Send chapter one'), 'before'));
    const before = linesOf(FILE);
    const after = linesOf(edit.text);
    const moved = `- [/] ${BUY_INK}\n`;
    expect(after.filter((line) => line !== moved)).toEqual(before.filter((line) => line !== moved));
    expect(after.indexOf(moved)).toBe(2);
    expect(edit.text).toBe(
      [
        '# To-do',
        '',
        `- [/] ${BUY_INK}`,
        `- [ ] Send chapter one ${DUE_MARK} 2026-10-20`,
        '- [x] Choose a name for the ferry',
        `* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22`,
        '',
        '## Later',
        '',
        '- [ ] Buy ink',
        '',
        'A closing note.',
        '',
      ].join('\n'),
    );
  });

  it('puts a to-do after another one and its notes, never between them', () => {
    const text = ['- [ ] Send chapter', '  Dana: dana@example.com', '- [ ] Buy ink', '- [ ] Call printer', ''].join('\n');
    const after = done(moveTask(text, task(text, 'Call printer'), task(text, 'Send chapter'), 'after'));
    expect(after.text).toBe(['- [ ] Send chapter', '  Dana: dana@example.com', '- [ ] Call printer', '- [ ] Buy ink', ''].join('\n'));
    const before = done(moveTask(text, task(text, 'Call printer'), task(text, 'Send chapter'), 'before'));
    expect(before.text).toBe(['- [ ] Call printer', '- [ ] Send chapter', '  Dana: dana@example.com', '- [ ] Buy ink', ''].join('\n'));
  });

  it('counts a sub-task as a to-do in its own right', () => {
    const text = ['- [ ] parent', '    - [ ] child', '- [ ] other', ''].join('\n');
    const edit = done(moveTask(text, task(text, 'other'), task(text, 'parent'), 'after'));
    expect(order(edit.text)).toEqual(['parent', 'other', 'child']);
  });

  it('leaves the line breaks where they are, also when the last line has none', () => {
    const text = '- [ ] a\r\n- [ ] b\n- [ ] c';
    expect(done(moveTask(text, { line: 2, raw: '- [ ] c' }, { line: 0, raw: '- [ ] a' }, 'before')).text).toBe('- [ ] c\r\n- [ ] a\n- [ ] b');
    expect(done(moveTask(text, { line: 0, raw: '- [ ] a' }, { line: 2, raw: '- [ ] c' }, 'after')).text).toBe('- [ ] b\r\n- [ ] c\n- [ ] a');
    // The blank line that stood above the last to-do is now the last line of the file.
    const gap = '- [ ] a\n\n- [ ] c';
    expect(done(moveTask(gap, { line: 2, raw: '- [ ] c' }, { line: 0, raw: '- [ ] a' }, 'before')).text).toBe('- [ ] c\n- [ ] a\n');
  });

  it('changes nothing when the to-do is already there, or is moved next to itself', () => {
    expect(outcome(moveTask(LIST, task(LIST, 'one'), task(LIST, 'two'), 'before'))).toBe('noop:unchanged');
    expect(outcome(moveTask(LIST, task(LIST, 'two'), task(LIST, 'one'), 'after'))).toBe('noop:unchanged');
    expect(outcome(moveTask(LIST, task(LIST, 'two'), task(LIST, 'two'), 'after'))).toBe('noop:unchanged');
    expect(outcome(moveTask(LIST, task(LIST, 'two'), task(LIST, 'two'), 'before'))).toBe('noop:unchanged');
  });

  it('counts two to-dos as next to each other when only blank lines and the upper one\'s notes lie between', () => {
    const text = ['- [ ] alpha', '  a note of alpha', '', '    more of that note', '', `- [ ] ${BUY_INK}`, '', '- [ ] gamma', ''].join('\n');
    const [alpha, beta, gamma] = [task(text, 'alpha'), task(text, BUY_INK), task(text, 'gamma')];
    // moving alpha "before" the next to-do must not pull it out from above its own notes
    expect(outcome(moveTask(text, alpha, beta, 'before'))).toBe('noop:unchanged');
    expect(outcome(moveTask(text, beta, alpha, 'after'))).toBe('noop:unchanged');
    expect(outcome(moveTask(text, beta, gamma, 'before'))).toBe('noop:unchanged');
    expect(outcome(moveTask(text, gamma, beta, 'after'))).toBe('noop:unchanged');
    // a code block among the notes is a note like any other
    const fenced = ['- [ ] alpha', '  ```', 'code at the margin', '  ```', '- [ ] beta', ''].join('\n');
    expect(outcome(moveTask(fenced, task(fenced, 'alpha'), task(fenced, 'beta'), 'before'))).toBe('noop:unchanged');
    expect(outcome(moveTask(fenced, task(fenced, 'beta'), task(fenced, 'alpha'), 'after'))).toBe('noop:unchanged');
    // the other way round is a real move
    expect(order(done(moveTask(text, beta, alpha, 'before')).text)).toEqual([BUY_INK, 'alpha', 'gamma']);
    expect(order(done(moveTask(text, alpha, beta, 'after')).text)).toEqual([BUY_INK, 'alpha', 'gamma']);
  });

  it('moves a to-do next to its neighbour across a heading or other text that lies between them', () => {
    const text = ['## Today', '- [ ] A', `- [ ] ${BUY_INK}`, '', '## Later', '- [ ] C', ''].join('\n');
    const [b, c] = [task(text, BUY_INK), task(text, 'C')];

    // to the top of the next section
    const down = done(moveTask(text, b, c, 'before'));
    expect(down.text).toBe(['## Today', '- [ ] A', '', '## Later', `- [ ] ${BUY_INK}`, '- [ ] C', ''].join('\n'));
    expect(down.task).toEqual({ line: 4, raw: `- [ ] ${BUY_INK}` });

    // to the end of the previous section
    const up = done(moveTask(text, c, b, 'after'));
    expect(up.text).toBe(['## Today', '- [ ] A', `- [ ] ${BUY_INK}`, '- [ ] C', '', '## Later', ''].join('\n'));
    expect(up.task).toEqual({ line: 3, raw: '- [ ] C' });

    // and once it is there, asking again changes nothing
    expect(outcome(moveTask(down.text, down.task as TaskRef, task(down.text, 'C'), 'before'))).toBe('noop:unchanged');
    expect(outcome(moveTask(up.text, up.task as TaskRef, task(up.text, BUY_INK), 'after'))).toBe('noop:unchanged');

    // a line of plain text between them counts like a heading
    const plain = ['- [ ] A', 'Not a note: it starts at the margin.', '- [ ] C', ''].join('\n');
    expect(done(moveTask(plain, task(plain, 'A'), task(plain, 'C'), 'before')).text).toBe(
      ['Not a note: it starts at the margin.', '- [ ] A', '- [ ] C', ''].join('\n'),
    );
    expect(done(moveTask(plain, task(plain, 'C'), task(plain, 'A'), 'after')).text).toBe(
      ['- [ ] A', '- [ ] C', 'Not a note: it starts at the margin.', ''].join('\n'),
    );

    // the sample file: out from under "## Later", and in under it
    const out = done(moveTask(FILE, task(FILE, 'Buy ink'), task(FILE, SEND_CHAPTER), 'after'));
    expect(out.task).toEqual({ line: 5, raw: '- [ ] Buy ink' });
    expect(linesOf(out.text).slice(4, 8)).toEqual([`* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22\n`, '- [ ] Buy ink\n', '\n', '## Later\n']);
    const under = done(moveTask(FILE, task(FILE, SEND_CHAPTER), task(FILE, 'Buy ink'), 'before'));
    expect(under.task).toEqual({ line: 7, raw: `* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22` });
    expect(linesOf(under.text).slice(4, 9)).toEqual(['\n', '## Later\n', '\n', `* [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-22\n`, '- [ ] Buy ink\n']);
  });

  it('never puts a moved to-do inside a code block', () => {
    // "after" a to-do whose notes hold a code block: after the whole block
    const closed = ['- [ ] a', '  ```', 'code', '  ```', '- [ ] b', '- [ ] c', ''].join('\n');
    const afterBlock = done(moveTask(closed, task(closed, 'c'), task(closed, 'a'), 'after'));
    expect(afterBlock.text).toBe(['- [ ] a', '  ```', 'code', '  ```', '- [ ] c', '- [ ] b', ''].join('\n'));
    expect(order(afterBlock.text)).toEqual(['a', 'c', 'b']);
    expect(findTask(parseTodo(afterBlock.text), afterBlock.task as TaskRef)?.title).toBe('c');

    // "after" the last to-do, whose note is a code block that is never closed: above that block
    const open = ['- [ ] a', '- [ ] b', '  ```', '  code to the end'].join('\n');
    const aboveBlock = done(moveTask(open, task(open, 'a'), task(open, 'b'), 'after'));
    expect(aboveBlock.text).toBe(['- [ ] b', '- [ ] a', '  ```', '  code to the end'].join('\n'));
    expect(order(aboveBlock.text)).toEqual(['b', 'a']);
    expect(findTask(parseTodo(aboveBlock.text), aboveBlock.task as TaskRef)?.title).toBe('a');
  });

  it('reports a to-do or a target that is no longer there', () => {
    const gone = { line: 1, raw: '- [ ] vanished' };
    expect(outcome(moveTask(LIST, gone, task(LIST, 'one'), 'before'))).toBe('noop:not-found');
    expect(outcome(moveTask(LIST, task(LIST, 'one'), gone, 'before'))).toBe('noop:target-missing');
  });

  it('keeps every line for five hundred random moves', () => {
    const random = fixedRandom(5);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    for (let round = 0; round < 500; round++) {
      const lines: string[] = [];
      const count = 2 + Math.floor(random() * 12);
      for (let i = 0; i < count; i++) {
        const kind = random();
        if (kind < 0.6) lines.push(`${pick(['', '', '  ', '\t'])}${pick(['-', '*', '+'])} [${pick([' ', 'x', '/'])}] task ${i}`);
        else if (kind < 0.75) lines.push('');
        else if (kind < 0.9) lines.push(`    note ${i}`);
        else lines.push(`## heading ${i}`);
      }
      const text = lines.join(pick(['\n', '\r\n'])) + pick(['', '\n']);
      const tasks = parseTodo(text).tasks;
      if (tasks.length < 2) continue;
      const moving = pick(tasks);
      const target = pick(tasks);
      const where = pick(['before', 'after'] as const);
      const edit = moveTask(text, moving, target, where);
      if (edit.status !== 'done') {
        expect(outcome(edit)).toBe('noop:unchanged');
        if (moving === target) continue;
        // Nothing moved only because the to-do was there already: the upper of the two,
        // then nothing but blank lines and notes indented further than it, then the lower.
        const [upper, lower] = where === 'before' ? [moving, target] : [target, moving];
        expect(upper.line).toBeLessThan(lower.line);
        const ownIndent = upper.indent === '\t' ? 4 : upper.indent.length;
        for (const between of lines.slice(upper.line + 1, lower.line)) {
          expect(between === '' || (between.startsWith('    note') && ownIndent < 4), `"${between}" lies between`).toBe(true);
        }
        continue;
      }
      expect(edit.text).not.toBe(text);
      const result = parseTodo(edit.text);
      // The same lines, minus and plus the moved one, in the same order. Lines are
      // counted as an editor shows them: a text that ends with a line break has an
      // empty last line, which is where a blank line ends up when the last to-do
      // of a file without a final line break is moved away from under it.
      const shown = (whole: string): string[] => whole.split(/\r\n|\n|\r/);
      const without = (all: readonly string[], skip: number): string[] => all.filter((_, i) => i !== skip);
      const landed = (edit.task as TaskRef).line;
      expect(shown(edit.text)[landed]).toBe(moving.raw);
      expect(without(shown(edit.text), landed)).toEqual(without(shown(text), moving.line));
      // every line break is where it was
      expect(edit.text.match(/\r\n|\n|\r/g)).toEqual(text.match(/\r\n|\n|\r/g));
      expect(edit.text.length).toBe(text.length);
      // and the moved to-do is now next to its target, on the side asked for
      const titles = result.tasks.map((item) => item.raw);
      const others = tasks.filter((item) => item !== moving).map((item) => item.raw);
      const targetPlace = tasks.filter((item) => item !== moving).indexOf(target);
      const expected = [...others];
      expected.splice(where === 'before' ? targetPlace : targetPlace + 1, 0, moving.raw);
      expect(titles).toEqual(expected);
    }
  });
});

describe('sync safety: the file changed underneath', () => {
  // What the screen was showing when the writer tapped.
  const SHOWN = ['# To-do', '- [ ] alpha', `- [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-20`, '- [ ] gamma', ''].join('\n');
  const beta = task(SHOWN, SEND_CHAPTER);
  const gamma = task(SHOWN, 'gamma');

  // What the file holds now: another device added two lines at the top.
  const SHIFTED = ['# To-do', '- [ ] added on the phone', '', '- [ ] alpha', `- [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-20`, '- [ ] gamma', ''].join('\n');
  // Or: another device ticked the to-do in the meantime.
  const TICKED = SHOWN.replace(`- [ ] ${SEND_CHAPTER}`, `- [x] ${SEND_CHAPTER}`);
  // Or: another device removed it.
  const REMOVED = SHOWN.replace(`- [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-20\n`, '');

  const changes: Array<[string, (text: string, ref: TaskRef) => TodoEdit]> = [
    ['toggleTask', (text, ref) => toggleTask(text, ref)],
    ['setTaskDone', (text, ref) => setTaskDone(text, ref, true)],
    ['setTaskText', (text, ref) => setTaskText(text, ref, BUY_INK)],
    ['setTaskDue', (text, ref) => setTaskDue(text, ref, '2027-01-01')],
    ['setTaskDue (clear)', (text, ref) => setTaskDue(text, ref, null)],
    ['removeTask', (text, ref) => removeTask(text, ref)],
  ];

  for (const [name, change] of changes) {
    it(`${name}: finds the to-do on its new line and changes that line only`, () => {
      const edit = done(change(SHIFTED, beta));
      const before = linesOf(SHIFTED);
      const after = linesOf(edit.text);
      if (edit.task === null) {
        expect(after).toEqual(before.filter((_, position) => position !== 4));
      } else {
        expect(edit.task.line).toBe(4);
        onlyLineChanged(SHIFTED, edit.text, 4);
      }
      // the line that now sits where the to-do used to be was not touched
      expect(after[2]).toBe('\n');
      expect(edit.text).toContain('- [ ] alpha\n');
    });

    it(`${name}: changes nothing when the to-do was changed or removed elsewhere`, () => {
      for (const current of [TICKED, REMOVED, '', '# To-do\n']) {
        const edit = change(current, beta);
        expect(outcome(edit), JSON.stringify(current)).toBe('noop:not-found');
        expect(edit.status === 'noop' && edit.message.length > 0).toBe(true);
      }
    });
  }

  it('does not mistake another line at the old position for the to-do', () => {
    // After the removal, "gamma" sits on the line the screen thinks the Hebrew to-do is on.
    expect(parseTodo(REMOVED).lines[beta.line]?.raw).toBe('- [ ] gamma');
    expect(outcome(toggleTask(REMOVED, beta))).toBe('noop:not-found');
    expect(outcome(removeTask(REMOVED, beta))).toBe('noop:not-found');
    // while a change meant for gamma still reaches it, one line up
    const edit = done(toggleTask(REMOVED, gamma));
    expect(edit.task).toEqual({ line: 2, raw: '- [x] gamma' });
  });

  it('moveTask: follows both to-dos to their new lines', () => {
    const edit = done(moveTask(SHIFTED, gamma, beta, 'before'));
    expect(parseTodo(edit.text).tasks.map((item) => item.title)).toEqual(['added on the phone', 'alpha', 'gamma', SEND_CHAPTER]);
    expect(outcome(moveTask(REMOVED, gamma, beta, 'before'))).toBe('noop:target-missing');
    expect(outcome(moveTask(REMOVED, beta, gamma, 'before'))).toBe('noop:not-found');
    expect(outcome(moveTask(TICKED, beta, gamma, 'after'))).toBe('noop:not-found');
  });

  it('addTask needs no line to aim at: it adds to whatever the file holds now', () => {
    expect(done(addTask(SHIFTED, { title: 'new' })).text).toBe(SHIFTED.replace('- [ ] gamma\n', '- [ ] gamma\n- [ ] new\n'));
    expect(done(addTask(REMOVED, { title: 'new' })).text).toBe(REMOVED.replace('- [ ] gamma\n', '- [ ] gamma\n- [ ] new\n'));
  });

  it('does not reach for a line with the same text far away', () => {
    const filler = Array.from({ length: 30 }, (_, i) => `note ${i}`);
    const far = ['# To-do', ...filler, '- [ ] alpha', ''].join('\n');
    expect(outcome(toggleTask(far, { line: 1, raw: '- [ ] alpha' }))).toBe('noop:not-found');
    const near = ['# To-do', ...filler.slice(0, 5), '- [ ] alpha', ''].join('\n');
    expect(done(toggleTask(near, { line: 1, raw: '- [ ] alpha' })).task?.line).toBe(6);
  });
});

describe('every change, on a thousand random files', () => {
  it('rewrites one line at most, keeps every other character, and does what was asked', () => {
    const random = fixedRandom(23);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const words = ['Send chapter', SEND_CHAPTER, BUY_INK, 'Buy ink', 'Call  Dana', `${RLM}${CALL_PRINTER}`, '⏫ urgent', 'x'];
    const dates = ['2026-10-20', '2026-11-05', '2024-02-29'];
    for (let round = 0; round < 1000; round++) {
      const lines: string[] = [];
      const count = 1 + Math.floor(random() * 10);
      for (let i = 0; i < count; i++) {
        const kind = random();
        if (kind < 0.7) {
          const due = random() < 0.5 ? ` ${DUE_MARK} ${pick(dates)}` : '';
          const tail = random() < 0.2 ? pick([' ^id-1', '  ', ' ✅ 2026-10-01']) : '';
          lines.push(`${pick(['', '  ', '\t'])}${pick(['-', '*', '+'])} [${pick([' ', 'x', 'X', '/'])}] ${pick(words)} ${i}${due}${tail}`);
        } else {
          lines.push(pick(['', '# Heading', '  an indented note', 'plain text', '---']));
        }
      }
      const lineBreak = pick(['\n', '\r\n']);
      const text = lines.join(lineBreak) + pick(['', lineBreak]);
      const todo = parseTodo(text);
      if (todo.tasks.length === 0) continue;
      const target = pick(todo.tasks);
      const before = linesOf(text);

      const ticked = setTaskDone(text, target, !target.done);
      const tickedTask = parseTodo(done(ticked).text).lines[target.line] as TodoTask;
      onlyLineChanged(text, done(ticked).text, target.line);
      expect([tickedTask.done, tickedTask.title, tickedTask.due, tickedTask.indent, tickedTask.bullet]).toEqual([
        !target.done, target.title, target.due, target.indent, target.bullet,
      ]);

      const title = `${pick(words)} renamed`;
      const renamed = parseTodo(done(setTaskText(text, target, title)).text).lines[target.line] as TodoTask;
      expect([renamed.title, renamed.due, renamed.box, renamed.indent, renamed.bullet]).toEqual([
        title, target.due, target.box, target.indent, target.bullet,
      ]);
      onlyLineChanged(text, done(setTaskText(text, target, title)).text, target.line);

      const due = target.due === '2030-01-31' ? '2030-02-01' : '2030-01-31';
      const dated = parseTodo(done(setTaskDue(text, target, due)).text).lines[target.line] as TodoTask;
      expect([dated.title, dated.due, dated.box]).toEqual([target.title, due, target.box]);
      onlyLineChanged(text, done(setTaskDue(text, target, due)).text, target.line);

      if (target.due !== null) {
        const cleared = parseTodo(done(setTaskDue(text, target, null)).text).lines[target.line] as TodoTask;
        expect([cleared.title, cleared.due, cleared.box]).toEqual([target.title, null, target.box]);
      } else {
        expect(outcome(setTaskDue(text, target, null))).toBe('noop:unchanged');
      }

      const removed = done(removeTask(text, target)).text;
      expect(linesOf(removed)).toEqual(before.filter((_, position) => position !== target.line));

      const added = done(addTask(text, { title: BUY_INK, due: '2026-12-31' }));
      const addedLines = parseTodo(added.text).lines.map((line) => line.raw);
      const addedAt = (added.task as TaskRef).line;
      expect(addedLines.filter((_, position) => position !== addedAt)).toEqual(todo.lines.map((line) => line.raw));
      expect(lastTask(added.text)?.title).toBe(BUY_INK);
      expect(todoText(parseTodo(added.text))).toBe(added.text);
    }
  });
});

describe('adding and moving, on five hundred random files with code blocks in them', () => {
  it('leaves one more to-do after adding and the same to-dos after moving: none is ever put inside a block', () => {
    const random = fixedRandom(41);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    let fenced = 0;
    for (let round = 0; round < 500; round++) {
      const lines: string[] = [];
      const count = 1 + Math.floor(random() * 12);
      for (let i = 0; i < count; i++) {
        const kind = random();
        if (kind < 0.45) lines.push(`${pick(['', '', '  '])}- [${pick([' ', 'x'])}] task ${i}`);
        else if (kind < 0.7) lines.push(pick(['```', '  ```', '    ```', '~~~', '  ~~~~', '```js']));
        else if (kind < 0.8) lines.push('');
        else if (kind < 0.9) lines.push(`    note ${i}`);
        else lines.push(pick(['code at the margin', '## heading']));
      }
      const text = lines.join('\n') + pick(['', '\n']);
      const todo = parseTodo(text);
      const raws = todo.tasks.map((item) => item.raw);
      if (lines.some((line) => line.includes('```') || line.includes('~~~'))) fenced++;

      const added = done(addTask(text, { title: BUY_INK }));
      const addedAt = (added.task as TaskRef).line;
      const after = parseTodo(added.text);
      expect(after.lines[addedAt]?.kind, text).toBe('task');
      expect(after.tasks.map((item) => item.raw), text).toEqual([...raws, (added.task as TaskRef).raw]);
      expect(after.lines.filter((_, position) => position !== addedAt).map((line) => line.raw)).toEqual(todo.lines.map((line) => line.raw));

      if (todo.tasks.length < 2) continue;
      const moving = pick(todo.tasks);
      const target = pick(todo.tasks);
      const where = pick(['before', 'after'] as const);
      const edit = moveTask(text, moving, target, where);
      if (edit.status !== 'done') {
        expect(outcome(edit)).toBe('noop:unchanged');
        continue;
      }
      const result = parseTodo(edit.text);
      expect(result.lines[(edit.task as TaskRef).line], text).toMatchObject({ kind: 'task', raw: moving.raw });
      const others = todo.tasks.filter((item) => item !== moving);
      const expected = others.map((item) => item.raw);
      expected.splice(where === 'before' ? others.indexOf(target) : others.indexOf(target) + 1, 0, moving.raw);
      expect(result.tasks.map((item) => item.raw), text).toEqual(expected);
    }
    expect(fenced).toBeGreaterThan(300);
  });
});
