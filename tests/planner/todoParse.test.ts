import { describe, expect, it } from 'vitest';
import {
  DUE_MARK,
  findTask,
  openTaskCount,
  overdueTasks,
  parseTodo,
  tasksDueOn,
  todoText,
  undatedTasks,
} from '../../src/core/planner';
import type { TodoTask } from '../../src/core/planner';
import { NEARBY_LINES } from '../../src/core/planner/todo';
import { DUE_DATE_MARK, sampleProject } from '../../src/core/sampleProject';
import { fixedRandom } from '../storeHarness';

// Hebrew used throughout: "send chapter one to the editor", "buy ink", "check chapter 3 again".
const SEND_CHAPTER = 'לשלוח את פרק אחד לעורכת';
const BUY_INK = 'לקנות דיו';
const MIXED = 'לבדוק את Chapter 3 שוב';
// "peace" with vowel points, and a word with a geresh.
const POINTED = 'שָׁלוֹם צ׳יפס';

const RLM = '\u{200F}';
const LRM = '\u{200E}';
const EMOJI_STYLE = '\u{FE0F}';
const BOM = '\u{FEFF}';

/** The only task of a one-line file. */
function only(line: string): TodoTask {
  const todo = parseTodo(line);
  expect(todo.tasks, line).toHaveLength(1);
  return todo.tasks[0] as TodoTask;
}

describe('parseTodo: what is a to-do', () => {
  it('reads the checkbox lines of an ordinary file and keeps every other line', () => {
    const text = [
      '# To-do',
      '',
      `- [ ] Send chapter one ${DUE_MARK} 2026-10-20`,
      '- [x] Choose a name for the ferry',
      '',
      'Some notes for later.',
      '- [ ] Buy ink',
      '',
    ].join('\n');
    const todo = parseTodo(text);

    expect(todo.lines.map((line) => line.kind)).toEqual(['other', 'other', 'task', 'task', 'other', 'other', 'task']);
    expect(todo.lines.map((line) => line.raw)).toEqual(text.split('\n').slice(0, 7));
    expect(todo.lines.map((line) => line.line)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(todo.tasks.map((task) => [task.line, task.title, task.done, task.due])).toEqual([
      [2, 'Send chapter one', false, '2026-10-20'],
      [3, 'Choose a name for the ferry', true, null],
      [6, 'Buy ink', false, null],
    ]);
    expect(todo.tasks[0]?.text).toBe(`Send chapter one ${DUE_MARK} 2026-10-20`);
    expect(todo.tasks[0]?.raw).toBe(`- [ ] Send chapter one ${DUE_MARK} 2026-10-20`);
  });

  it('accepts the three bullets, and indents of spaces or tabs', () => {
    const todo = parseTodo(['- [ ] dash', '* [ ] star', '+ [ ] plus', '    - [ ] four spaces', '\t* [x] a tab', ' \t + [ ] both'].join('\n'));
    expect(todo.tasks.map((task) => [task.bullet, task.indent, task.title, task.done])).toEqual([
      ['-', '', 'dash', false],
      ['*', '', 'star', false],
      ['+', '', 'plus', false],
      ['-', '    ', 'four spaces', false],
      ['*', '\t', 'a tab', true],
      ['+', ' \t ', 'both', false],
    ]);
  });

  it('is done for x and X only; any other character in the box is not done and is kept', () => {
    expect(only('- [x] a').done).toBe(true);
    expect(only('- [X] a').done).toBe(true);
    for (const box of [' ', '/', '-', '?', '>', '!', 'ו', '✓']) {
      const task = only(`- [${box}] in progress`);
      expect(task.done, box).toBe(false);
      expect(task.box, box).toBe(box);
      expect(task.title).toBe('in progress');
    }
    // one character that takes two code units still counts as one
    expect(only('- [\u{1F600}] grin').box).toBe('\u{1F600}');
  });

  it('keeps the spacing of a line: several spaces after the bullet or the box are not part of the text', () => {
    const task = only('-   [ ]    spaced out  ');
    expect(task.text).toBe('spaced out  ');
    expect(task.title).toBe('spaced out');
    expect(task.raw).toBe('-   [ ]    spaced out  ');
  });

  it('reads a box with nothing after it as a to-do without text', () => {
    for (const line of ['- [ ]', '- [ ] ', '- [x]', '  * [ ]\t']) {
      const task = only(line);
      expect(task.title, JSON.stringify(line)).toBe('');
      expect(task.text.trim()).toBe('');
      expect(task.due).toBeNull();
    }
  });

  it('does not take other lines for to-dos', () => {
    const lines = [
      '- []',
      '- [ ]no space after the box',
      '-[ ] no space after the bullet',
      '[ ] no bullet',
      '1. [ ] a numbered item',
      '> - [ ] quoted',
      '- [xx] two characters',
      '- [link](https://example.com)',
      '- plain list item',
      '— [ ] a long dash',
      '# - [ ] a heading',
      'Text - [ ] in the middle',
      '',
      '   ',
    ];
    const todo = parseTodo(lines.join('\n'));
    expect(todo.tasks).toEqual([]);
    expect(todo.lines.map((line) => line.raw)).toEqual(lines);
  });

  it('leaves the properties block and code blocks alone, as Obsidian does', () => {
    const text = [
      '---',
      'tags:',
      '  - [ ] not a to-do',
      '---',
      '- [ ] real one',
      '```',
      '- [ ] in a code block',
      '```',
      '- [ ] real two',
      '~~~~ text',
      '- [ ] in a tilde block',
      '```',
      '~~~',
      '- [ ] still inside: the closing run is shorter',
      '~~~~',
      '- [ ] real three',
      '```inline``` is not a block',
      '- [ ] real four',
      '  ```js',
      '- [ ] in a block that never closes',
    ].join('\n');
    const todo = parseTodo(text);
    expect(todo.tasks.map((task) => task.title)).toEqual(['real one', 'real two', 'real three', 'real four']);
    expect(todoText(todo)).toBe(text);
  });

  it('treats a properties block that is never closed as ordinary text', () => {
    const todo = parseTodo('---\n- [ ] first\n- [ ] second\n');
    expect(todo.tasks.map((task) => task.title)).toEqual(['first', 'second']);
    // a rule further down the note does not start a properties block either
    expect(parseTodo('- [ ] a\n---\n- [ ] b\n---\n- [ ] c').tasks).toHaveLength(3);
  });
});

describe('parseTodo: the due date', () => {
  it('finds a date after the calendar emoji, however it is spaced', () => {
    expect(only(`- [ ] Send ${DUE_MARK} 2026-10-20`).due).toBe('2026-10-20');
    expect(only(`- [ ] Send ${DUE_MARK}2026-10-20`).due).toBe('2026-10-20');
    expect(only(`- [ ] Send ${DUE_MARK}   2026-10-20`).due).toBe('2026-10-20');
    expect(only(`- [ ] Send ${DUE_MARK}\t2026-10-20`).due).toBe('2026-10-20');
    expect(only(`- [ ] Send${DUE_MARK} 2026-10-20`).title).toBe('Send');
    expect(only(`- [ ] ${DUE_MARK} 2026-10-20`).title).toBe('');
    expect(only(`- [ ] ${DUE_MARK} 2026-10-20`).due).toBe('2026-10-20');
  });

  it('accepts the emoji-style selector and the other two calendar emoji the Tasks plugin reads', () => {
    expect(only(`- [ ] Send ${DUE_MARK}${EMOJI_STYLE} 2026-10-20`).due).toBe('2026-10-20');
    expect(only('- [ ] Send \u{1F4C6} 2026-10-21').due).toBe('2026-10-21');
    expect(only(`- [ ] Send \u{1F5D3}${EMOJI_STYLE} 2026-10-22`).due).toBe('2026-10-22');
    expect(only(`- [ ] Send \u{1F5D3}${EMOJI_STYLE} 2026-10-22`).title).toBe('Send');
  });

  it('finds the date anywhere in the text and takes only the date out of the title', () => {
    const task = only(`- [ ] Send chapter ${DUE_MARK} 2026-10-20 to Dana`);
    expect(task.due).toBe('2026-10-20');
    expect(task.title).toBe('Send chapter to Dana');
    expect(only(`- [ ] ${DUE_MARK} 2026-10-20 Send chapter`).title).toBe('Send chapter');
  });

  it('passes the other Tasks marks through as part of the text', () => {
    const rest = '⏳ 2026-10-18 \u{1F6EB} 2026-10-15 ✅ 2026-10-19 \u{1F501} every week ⏫ #agent ^abc123';
    const task = only(`- [x] Send chapter one ${DUE_MARK} 2026-10-20 ${rest}`);
    expect(task.due).toBe('2026-10-20');
    expect(task.title).toBe(`Send chapter one ${rest}`);
    expect(task.text).toBe(`Send chapter one ${DUE_MARK} 2026-10-20 ${rest}`);
    // a scheduled, start or done date alone is not a due date
    const noDue = only(`- [ ] Send ⏳ 2026-10-18 \u{1F6EB} 2026-10-15 ✅ 2026-10-19`);
    expect(noDue.due).toBeNull();
    expect(noDue.title).toBe('Send ⏳ 2026-10-18 \u{1F6EB} 2026-10-15 ✅ 2026-10-19');
  });

  it('does not take a date that does not exist, or half a date, for a due date', () => {
    for (const text of [
      `Send ${DUE_MARK} 2026-02-30`,
      `Send ${DUE_MARK} 2026-13-01`,
      `Send ${DUE_MARK} 2026-10-201`,
      `Send ${DUE_MARK} 26-10-20`,
      `Send ${DUE_MARK} 2026/10/20`,
      `Send ${DUE_MARK} tomorrow`,
      `Send ${DUE_MARK}`,
      'Send 2026-10-20',
      `Send 2026-10-20 ${DUE_MARK}`,
    ]) {
      const task = only(`- [ ] ${text}`);
      expect(task.due, text).toBeNull();
      expect(task.title, text).toBe(text);
    }
  });

  it('uses the last date when a line has more than one', () => {
    const task = only(`- [ ] Send ${DUE_MARK} 2026-10-20 ${DUE_MARK} 2026-11-05`);
    expect(task.due).toBe('2026-11-05');
    expect(task.title).toBe('Send');
    // a date that does not exist is skipped, not counted as the last
    expect(only(`- [ ] Send ${DUE_MARK} 2026-10-20 ${DUE_MARK} 2026-02-30`).due).toBe('2026-10-20');
  });
});

describe('parseTodo: Hebrew', () => {
  it('keeps Hebrew text exactly and still finds the date after it', () => {
    const line = `- [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-20`;
    const task = only(line);
    expect(task.title).toBe(SEND_CHAPTER);
    expect(task.text).toBe(`${SEND_CHAPTER} ${DUE_MARK} 2026-10-20`);
    expect(task.due).toBe('2026-10-20');
    expect(task.raw).toBe(line);
    expect(todoText(parseTodo(line))).toBe(line);
  });

  it('keeps vowel points, a geresh, mixed Hebrew and English, and direction marks as they are', () => {
    for (const text of [POINTED, MIXED, `${RLM}${BUY_INK}${RLM}`, `${BUY_INK} (${LRM}v2${LRM})`, `"${SEND_CHAPTER}" - ${MIXED}`]) {
      const plain = only(`- [ ] ${text}`);
      expect(plain.title, text).toBe(text);
      expect(plain.due).toBeNull();
      const dated = only(`- [x] ${text} ${DUE_MARK} 2026-12-01`);
      expect(dated.title, text).toBe(text);
      expect(dated.due).toBe('2026-12-01');
      expect(dated.done).toBe(true);
    }
  });

  it('finds a date that has direction marks between the emoji and the digits', () => {
    const task = only(`- [ ] ${BUY_INK} ${DUE_MARK}${RLM} ${LRM}2026-10-20`);
    expect(task.due).toBe('2026-10-20');
    expect(task.title).toBe(BUY_INK);
  });

  it('reads a Hebrew file in the order it is written', () => {
    const text = `# משימות\n\n- [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-20\n- [x] ${BUY_INK}\n* [ ] ${MIXED} ${DUE_MARK} 2026-10-22\n`;
    const todo = parseTodo(text);
    expect(todo.tasks.map((task) => [task.title, task.done, task.due])).toEqual([
      [SEND_CHAPTER, false, '2026-10-20'],
      [BUY_INK, true, null],
      [MIXED, false, '2026-10-22'],
    ]);
    expect(todoText(todo)).toBe(text);
  });
});

describe('parseTodo: every line is kept', () => {
  const body = ['# To-do', '', `- [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-20`, '  a note under it  ', '\t', '- [x] Done thing', 'Trailing text'];

  it('gives back exactly the text it read, whatever the line breaks', () => {
    const texts = [
      '',
      '\n',
      '\n\n\n',
      '\r\n',
      'no line break at all',
      '- [ ] one',
      '- [ ] one\n',
      body.join('\n'),
      `${body.join('\n')}\n`,
      `${body.join('\n')}\n\n\n`,
      body.join('\r\n'),
      `${body.join('\r\n')}\r\n`,
      body.join('\r'),
      '- [ ] a\r\n- [ ] b\n- [ ] c\r- [ ] d',
      `${BOM}${body.join('\n')}\n`,
      BOM,
      `${BOM}- [ ] first line after a byte-order mark\n`,
    ];
    for (const text of texts) {
      expect(todoText(parseTodo(text)), JSON.stringify(text)).toBe(text);
    }
  });

  it('counts lines the same way for every kind of line break', () => {
    for (const lineBreak of ['\n', '\r\n', '\r']) {
      const todo = parseTodo(body.join(lineBreak) + lineBreak);
      expect(todo.lines).toHaveLength(body.length);
      expect(todo.lines.map((line) => line.raw)).toEqual(body);
      expect(todo.endings).toEqual(body.map(() => lineBreak));
      expect(todo.tasks.map((task) => task.line)).toEqual([2, 5]);
    }
    expect(parseTodo('a\nb').endings).toEqual(['\n', '']);
    expect(parseTodo('').lines).toEqual([]);
  });

  it('breaks lines only where Obsidian does', () => {
    // The Unicode line and paragraph separators are ordinary characters inside a line.
    const todo = parseTodo('- [ ] one\u{2028}still one\u{2029}and still \u{1F4C5} 2026-10-20\n- [ ] two');
    expect(todo.lines).toHaveLength(2);
    expect(todo.tasks[0]?.title).toBe('one\u{2028}still one\u{2029}and still');
    expect(todo.tasks[0]?.due).toBe('2026-10-20');
  });

  it('reads a to-do on the first line of a file that starts with a byte-order mark', () => {
    const todo = parseTodo(`${BOM}- [ ] first\n- [ ] second\n`);
    expect(todo.bom).toBe(BOM);
    expect(BOM.charCodeAt(0)).toBe(0xfeff);
    expect(todo.tasks.map((task) => task.raw)).toEqual(['- [ ] first', '- [ ] second']);
  });

  it('never throws and never loses a character, for a thousand scrambled files', () => {
    const random = fixedRandom(11);
    const pieces = [
      '- [ ] ', '- [x] ', '* [/] ', '  + [ ] ', '\t- [X] ', '- [', '] ', '[ ]', '-', ' ', '\t', '\n', '\r\n', '\r', '\n\n',
      '#', '---', '```', '~~~', '^id-1', DUE_MARK, EMOJI_STYLE, '2026-10-20', '2026-02-30', ' 2026-1', RLM, LRM, BOM,
      SEND_CHAPTER, BUY_INK, POINTED, 'Send chapter', '⏫', '✅ 2026-10-19', '\u{1F501} every week',
      // half of an emoji, a null character, and the line and paragraph separators (which are not line breaks here)
      '\u{D83D}', '\u{0}', '\u{2028}', '\u{2029}',
    ];
    for (let round = 0; round < 1000; round++) {
      let text = '';
      const count = Math.floor(random() * 40);
      for (let i = 0; i < count; i++) text += pieces[Math.floor(random() * pieces.length)] as string;
      const todo = parseTodo(text);
      expect(todoText(todo), JSON.stringify(text)).toBe(text);
      expect(todo.lines.length).toBe(todo.endings.length);
      for (const task of todo.tasks) {
        expect(todo.lines[task.line]).toBe(task);
        expect(task.raw.endsWith(task.text)).toBe(true);
        expect(/[\r\n]/.test(task.raw)).toBe(false);
      }
    }
  });
});

describe('the sample project', () => {
  it('writes its due dates with the same mark this reader looks for', () => {
    expect(DUE_MARK).toBe(DUE_DATE_MARK);
    expect([...DUE_MARK].map((character) => character.codePointAt(0))).toEqual([0x1f4c5]);
  });

  it("has a To-do.md this reader understands", () => {
    const text = sampleProject('2026-10-13').todo ?? '';
    const todo = parseTodo(text);
    expect(todo.tasks.map((task) => [task.done, task.due])).toEqual([
      [false, '2026-10-16'],
      [false, '2026-10-23'],
      [true, null],
    ]);
    expect(todo.tasks[0]?.title).toBe('Rewrite "Fog on the Crossing" from Tobias\'s side');
    expect(todoText(todo)).toBe(text);
  });
});

describe('queries', () => {
  const todo = parseTodo(
    [
      '# To-do',
      `- [ ] late and open ${DUE_MARK} 2026-10-10`,
      `- [x] late but done ${DUE_MARK} 2026-10-10`,
      `- [ ] due today ${DUE_MARK} 2026-10-13`,
      `- [x] done today ${DUE_MARK} 2026-10-13`,
      `- [/] started, due tomorrow ${DUE_MARK} 2026-10-14`,
      '- [ ] no date',
      '- [x] no date, done',
      `- [ ] ${BUY_INK} ${DUE_MARK} 2026-10-13`,
      `- [ ] a date that is not one ${DUE_MARK} 2026-02-30`,
      `- [ ] long ago ${DUE_MARK} 1999-12-31`,
      `- [ ] ${MIXED}`,
    ].join('\n'),
  );
  const titles = (tasks: readonly TodoTask[]): string[] => tasks.map((task) => task.title);

  it('lists what is due on a day, done or not, in file order', () => {
    expect(titles(tasksDueOn(todo, '2026-10-13'))).toEqual(['due today', 'done today', BUY_INK]);
    expect(titles(tasksDueOn(todo, '2026-10-10'))).toEqual(['late and open', 'late but done']);
    expect(tasksDueOn(todo, '2026-10-12')).toEqual([]);
    expect(tasksDueOn(todo, '2026-02-30')).toEqual([]);
    expect(tasksDueOn(todo, '')).toEqual([]);
  });

  it('lists what is late: open, and due before the day asked about', () => {
    expect(titles(overdueTasks(todo, '2026-10-13'))).toEqual(['late and open', 'long ago']);
    expect(titles(overdueTasks(todo, '2026-10-14'))).toEqual(['late and open', 'due today', BUY_INK, 'long ago']);
    expect(titles(overdueTasks(todo, '2026-10-15'))).toContain('started, due tomorrow');
    expect(overdueTasks(todo, '1999-12-31')).toEqual([]);
    expect(overdueTasks(todo, 'today')).toEqual([]);
    expect(overdueTasks(todo, '2026-13-01')).toEqual([]);
  });

  it('lists what has no date, a date that does not exist included', () => {
    expect(titles(undatedTasks(todo))).toEqual(['no date', 'no date, done', `a date that is not one ${DUE_MARK} 2026-02-30`, MIXED]);
  });

  it('counts the open to-dos', () => {
    expect(openTaskCount(todo)).toBe(8);
    expect(openTaskCount(parseTodo(''))).toBe(0);
    expect(openTaskCount(parseTodo('# nothing here\n\ntext'))).toBe(0);
    expect(openTaskCount(parseTodo('- [x] a\n- [X] b'))).toBe(0);
  });
});

describe('findTask', () => {
  const lines = ['# To-do', '- [ ] alpha', '- [ ] beta', '', '- [ ] gamma'];
  const text = lines.join('\n');
  const beta = parseTodo(text).tasks[1] as TodoTask;

  it('finds a to-do on the line it was on', () => {
    expect(findTask(parseTodo(text), beta)?.line).toBe(2);
    expect(findTask(parseTodo(text), { line: 2, raw: '- [ ] beta' })?.title).toBe('beta');
  });

  it('finds it again after lines were added or removed above it', () => {
    const pushedDown = parseTodo(['intro', 'more', ...lines].join('\n'));
    expect(findTask(pushedDown, beta)?.line).toBe(4);
    const pulledUp = parseTodo(lines.slice(1).join('\n'));
    expect(findTask(pulledUp, beta)?.line).toBe(1);
  });

  it('does not find a to-do whose text changed, however slightly', () => {
    for (const changed of ['- [x] beta', '- [ ] beta ', '- [ ] Beta', '* [ ] beta', ' - [ ] beta', `- [ ] beta ${DUE_MARK} 2026-10-20`]) {
      const todo = parseTodo(lines.map((line) => (line === '- [ ] beta' ? changed : line)).join('\n'));
      expect(findTask(todo, beta), changed).toBeNull();
    }
    expect(findTask(parseTodo(''), beta)).toBeNull();
  });

  it('does not take a line for the to-do when it is no longer a to-do there', () => {
    const fenced = parseTodo(['```', '- [ ] alpha', '- [ ] beta', '```'].join('\n'));
    expect(findTask(fenced, beta)).toBeNull();
  });

  it('looks only nearby', () => {
    const padding = (count: number): string[] => Array.from({ length: count }, (_, i) => `filler ${i}`);
    const justInReach = parseTodo([...padding(NEARBY_LINES), ...lines].join('\n'));
    expect(findTask(justInReach, beta)?.line).toBe(2 + NEARBY_LINES);
    const outOfReach = parseTodo([...padding(NEARBY_LINES + 1), ...lines].join('\n'));
    expect(findTask(outOfReach, beta)).toBeNull();
    // and the same upwards
    const far = { line: beta.line + NEARBY_LINES + 1, raw: beta.raw };
    expect(findTask(parseTodo(text), far)).toBeNull();
    expect(findTask(parseTodo(text), { line: beta.line + NEARBY_LINES, raw: beta.raw })?.line).toBe(2);
  });

  it('between two lines with the same text, takes the one on the remembered line, else the nearest', () => {
    const twins = parseTodo(['- [ ] same', 'x', '- [ ] same', 'x', 'x', 'x', '- [ ] same'].join('\n'));
    expect(findTask(twins, { line: 0, raw: '- [ ] same' })?.line).toBe(0);
    expect(findTask(twins, { line: 2, raw: '- [ ] same' })?.line).toBe(2);
    expect(findTask(twins, { line: 6, raw: '- [ ] same' })?.line).toBe(6);
    expect(findTask(twins, { line: 3, raw: '- [ ] same' })?.line).toBe(2);
    expect(findTask(twins, { line: 5, raw: '- [ ] same' })?.line).toBe(6);
    // equally near above and below: the one above
    expect(findTask(twins, { line: 1, raw: '- [ ] same' })?.line).toBe(0);
    expect(findTask(twins, { line: 4, raw: '- [ ] same' })?.line).toBe(2);
  });

  it('copes with a position that makes no sense', () => {
    const todo = parseTodo(text);
    for (const line of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 1e9]) {
      expect(() => findTask(todo, { line, raw: '- [ ] beta' })).not.toThrow();
    }
    expect(findTask(todo, { line: -1, raw: '- [ ] alpha' })?.line).toBe(1);
    expect(findTask(todo, { line: Number.NaN, raw: '- [ ] beta' })).toBeNull();
    expect(findTask(todo, { line: 2, raw: '# To-do' })).toBeNull();
  });
});
