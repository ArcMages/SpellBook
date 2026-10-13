// Rules about the planner's own source, checked by reading the files.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as planner from '../../src/core/planner';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(here, '..', '..', 'src', 'core');
const plannerDir = path.join(coreDir, 'planner');
const files = readdirSync(plannerDir).filter((name) => name.endsWith('.ts'));
const read = (name: string): string => readFileSync(path.join(plannerDir, name), 'utf8');

/** Source text with comments removed. */
function codeOf(name: string): string {
  return read(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Every module a file imports or re-exports from. */
function importsOf(name: string): string[] {
  return [...codeOf(name).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

describe('the planner folder', () => {
  it('has its files', () => {
    expect([...files].sort()).toEqual(['calendar.ts', 'fromCore.ts', 'index.ts', 'marks.ts', 'summary.ts', 'todo.ts', 'todoEdit.ts']);
  });

  it('imports nothing from outside src/core', () => {
    // The general source rule refuses any import starting with "../", which
    // was the same thing while src/core had no folders inside it. Here the
    // rule is checked for what it means: where each import really leads.
    let checked = 0;
    for (const name of files) {
      for (const target of importsOf(name)) {
        expect(target.startsWith('.'), `${name} imports "${target}": only files of the plugin's core`).toBe(true);
        const resolved = path.resolve(plannerDir, target);
        const inside = path.relative(coreDir, resolved);
        expect(inside.startsWith('..') || path.isAbsolute(inside), `${name} imports "${target}", which is outside src/core`).toBe(false);
        expect(existsSync(`${resolved}.ts`), `${name} imports "${target}", which does not exist`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
    // the check would catch a slip
    const escape = path.relative(coreDir, path.resolve(plannerDir, './../../obsidian/obsidianVault'));
    expect(escape.startsWith('..')).toBe(true);
  });

  it('reaches the rest of the core through one file only', () => {
    // Judged by where an import leads, not by how its path is spelled, so that
    // fromCore.ts can be written "../dates" the day the general source rule
    // (tests/sourceRules.test.ts) checks the same way. See the note in fromCore.ts.
    const leadsTo = (target: string): string => path.relative(coreDir, path.resolve(plannerDir, target)).split(path.sep).join('/');
    for (const name of files) {
      const outside = importsOf(name).filter((target) => path.dirname(path.resolve(plannerDir, target)) !== plannerDir);
      if (name === 'fromCore.ts') expect(outside.map(leadsTo)).toEqual(['dates']);
      else expect(outside, name).toEqual([]);
    }
    expect(leadsTo('./../dates')).toBe('dates');
    expect(leadsTo('../dates')).toBe('dates');
  });

  it('uses no clock, no Obsidian, no screen and no lookbehind', () => {
    for (const name of files) {
      const code = codeOf(name);
      expect(/\bnew\s+Date\b|\bDate\s*\.\s*now\b/.test(code), name).toBe(false);
      expect(/['"]obsidian['"]/.test(code), name).toBe(false);
      expect(/\b(document|window|navigator|localStorage)\s*\./.test(code), name).toBe(false);
      expect(/\(\?<[=!]/.test(read(name)), name).toBe(false);
    }
  });
});

describe('the public API (index.ts)', () => {
  const index = read('index.ts');
  // The names between the braces of every "export { ... } from" and "export type { ... } from".
  const blocks = [...index.matchAll(/^export (type )?\{([\s\S]*?)\} from '\.\/(\w+)';/gm)];
  const exported = blocks.flatMap((block) =>
    [...(block[2] ?? '').matchAll(/(\/\*\*[\s\S]*?\*\/)?\s*\b([A-Za-z_][A-Za-z0-9_]*),/g)].map((entry) => ({
      name: entry[2] ?? '',
      documented: (entry[1] ?? '').length > 10,
      isType: block[1] !== undefined,
    })),
  );

  it('is exactly this list', () => {
    const values = exported.filter((entry) => !entry.isType).map((entry) => entry.name).sort();
    const types = exported.filter((entry) => entry.isType).map((entry) => entry.name).sort();
    expect(values).toEqual(
      [
        'DUE_MARK', 'parseTodo', 'todoText', 'findTask', 'tasksDueOn', 'overdueTasks', 'undatedTasks', 'openTaskCount',
        'addTask', 'setTaskDone', 'toggleTask', 'setTaskText', 'setTaskDue', 'removeTask', 'moveTask',
        'WEEKDAY_NAMES', 'WEEKDAY_SHORT_NAMES', 'MONTH_NAMES', 'monthGrid', 'nextMonth', 'previousMonth', 'monthOf',
        'monthRange', 'daysInMonth', 'weekdayOf', 'monthTitle', 'dayTitle',
        'MARKS_KEY', 'MARK_COLORS', 'isMarkColor', 'parseMarks', 'setMark', 'removeMark',
        'summariseDays', 'summariseMonth', 'tintScale', 'tintLevel',
      ].sort(),
    );
    expect(types).toEqual(
      [
        'TaskRef', 'TodoTask', 'OtherLine', 'TodoLine', 'TodoFile', 'TodoEdit', 'NewTask',
        'YearMonth', 'CalendarDay', 'MonthGrid',
        'MarkColor', 'DayMark', 'ParsedMarks', 'MarkChange', 'MarksEdit',
        'DayWords', 'DayWordsSource', 'TintLevel', 'DaySummary',
      ].sort(),
    );
    // and that is what the module really hands out
    expect(Object.keys(planner).sort()).toEqual(values);
  });

  it('has nothing in it but those exports', () => {
    const code = index.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const withoutBlocks = code.replace(/^export (type )?\{[\s\S]*?\} from '\.\/\w+';/gm, '');
    expect(withoutBlocks.trim()).toBe('');
  });

  it('describes every export in a comment', () => {
    expect(exported.length).toBeGreaterThan(50);
    for (const entry of exported) {
      expect(entry.documented, `${entry.name} needs a /** comment */ in index.ts`).toBe(true);
    }
  });

  it('describes every export where it is written, too', () => {
    for (const block of blocks) {
      const source = read(`${block[3]}.ts`);
      const names = [...(block[2] ?? '').matchAll(/\*\/\s*\b([A-Za-z_][A-Za-z0-9_]*),/g)].map((entry) => entry[1] ?? '');
      for (const name of names) {
        const declared = new RegExp(`\\*/\\s*export (?:async )?(?:function|const|interface|type) ${name}\\b`);
        expect(declared.test(source), `${name} needs a /** comment */ above it in ${block[3]}.ts`).toBe(true);
      }
    }
  });
});
