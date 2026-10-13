import { describe, expect, it } from 'vitest';
import { NO_TASKS, addTasks, countTasks, formatTasks } from '../../src/core/outliner';

describe('counting the to-do lines of a scene', () => {
  it('counts list items that start with a tick box, and how many are ticked', () => {
    const text = ['Some prose.', '', '- [ ] look up the trains', '- [x] name the dog', '* [X] cut the prologue', '+ [ ] ask Dana'].join('\n');
    expect(countTasks(text)).toEqual({ done: 2, total: 4 });
  });

  it('takes numbered items, items set in, and items inside a quote', () => {
    const text = ['1. [ ] one', '2) [x] two', '    - [ ] set in', '> - [x] quoted', '> > - [ ] quoted twice'].join('\n');
    expect(countTasks(text)).toEqual({ done: 2, total: 5 });
  });

  it('counts a box with another mark in it, but not as done', () => {
    expect(countTasks('- [-] dropped\n- [/] half way\n- [x] done')).toEqual({ done: 1, total: 3 });
  });

  it('leaves out what only looks like a to-do line', () => {
    const text = [
      '[ ] no list item in front',
      '- [] no room in the box',
      '- [ ]no space after the box',
      '-[ ] no space after the dash',
      'She wrote "- [ ] later" in her diary.',
      '- a plain item',
    ].join('\n');
    expect(countTasks(text)).toBe(NO_TASKS);
  });

  it('counts a box with nothing after it', () => {
    expect(countTasks('- [ ]')).toEqual({ done: 0, total: 1 });
  });

  it('ignores the properties block at the top of the note', () => {
    const text = ['---', 'synopsis: "- [ ] not a to-do"', 'list:', '  - [x] nor this', '---', '- [ ] a real one'].join('\n');
    expect(countTasks(text)).toEqual({ done: 0, total: 1 });
  });

  it('ignores blocks of code, fenced with backticks or tildes', () => {
    const text = [
      '- [x] before',
      '```markdown',
      '- [ ] inside backticks',
      '```',
      '~~~',
      '- [ ] inside tildes',
      '~~~',
      '- [ ] after',
    ].join('\n');
    expect(countTasks(text)).toEqual({ done: 1, total: 2 });
  });

  it('only closes a block of code with a fence of the same kind that is long enough', () => {
    const text = [
      '````',
      '```',
      '- [ ] still code: the fence above is too short',
      '~~~',
      '- [ ] still code: another kind of fence',
      '```` not a closing fence: something follows it',
      '- [ ] still code',
      '`````',
      '- [x] prose again',
    ].join('\n');
    expect(countTasks(text)).toEqual({ done: 1, total: 1 });
  });

  it('takes everything after a fence that is never closed for code', () => {
    expect(countTasks('- [ ] one\n```\n- [ ] two\n- [ ] three')).toEqual({ done: 0, total: 1 });
  });

  it('sees a block of code inside a quote or a list', () => {
    expect(countTasks('> ```\n> - [ ] quoted code\n> ```\n- item\n  ```\n  - [ ] code in a list\n  ```\n- [ ] real')).toEqual({
      done: 0,
      total: 1,
    });
  });

  it('reads Windows line endings and Hebrew text alike', () => {
    expect(countTasks('- [x] לבדוק את הרכבות\r\n- [ ] לשאול את דנה\r\n')).toEqual({ done: 1, total: 2 });
  });

  it('gives the same "none" for an empty note and for prose', () => {
    expect(countTasks('')).toBe(NO_TASKS);
    expect(countTasks('It was a dark night.\n')).toBe(NO_TASKS);
  });

  it('adds counts up and writes them as "1/3"', () => {
    expect(addTasks({ done: 1, total: 3 }, { done: 2, total: 2 })).toEqual({ done: 3, total: 5 });
    expect(addTasks(NO_TASKS, { done: 1, total: 2 })).toEqual({ done: 1, total: 2 });
    expect(addTasks({ done: 1, total: 2 }, NO_TASKS)).toEqual({ done: 1, total: 2 });
    expect(formatTasks({ done: 1, total: 3 })).toBe('1/3');
    // Nothing when there are none, when they cannot be known, and while the text has not been read.
    expect(formatTasks(NO_TASKS)).toBe('');
    expect(formatTasks(null)).toBe('');
    expect(formatTasks(undefined)).toBe('');
  });
});
