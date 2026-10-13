// Rules about the planner screen's own source (src/features/planner), checked
// by reading the files. They keep the promise the screen was built on: it is
// a view and nothing more. It reads through its host, changes through its
// host, and takes all its logic from the engine.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..', '..', '..', 'src');
const plannerDir = path.join(srcDir, 'features', 'planner');
const files = readdirSync(plannerDir).filter((name) => name.endsWith('.ts'));
const read = (name: string): string => readFileSync(path.join(plannerDir, name), 'utf8');

/** Source text with comments removed, so a rule can be explained in a comment without breaking it. */
function codeOf(name: string): string {
  return read(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

/** Every module a file imports from, with whether it only imports types from it. */
function importsOf(name: string): Array<{ target: string; typeOnly: boolean }> {
  return [...codeOf(name).matchAll(/\bimport\s+(type\s+)?[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => ({
    target: match[2] ?? '',
    typeOnly: match[1] !== undefined,
  }));
}

/** Where an import leads, from the top of src: "core/planner", "ui/dragDrop". */
function leadsTo(target: string): string {
  return path.relative(srcDir, path.resolve(plannerDir, target)).split(path.sep).join('/');
}

describe('the planner screen folder', () => {
  it('has its files, and leaves index.ts to whoever wires the screen in', () => {
    expect([...files].sort()).toEqual([
      'calendarPart.ts',
      'dateModal.ts',
      'plannerHost.ts',
      'plannerModel.ts',
      'plannerParts.ts',
      'plannerView.ts',
      'todoPart.ts',
    ]);
  });

  it('imports only Obsidian, the engine, a few plain helpers of the core, and shared pieces of screen', () => {
    // Never the project store, the vault doorway, the plugin itself or another screen.
    const allowed = [
      /^features\/planner\/\w+$/,
      /^core\/planner$/,
      /^core\/dates$/,
      /^core\/binderModel$/,
      /^core\/dropTarget$/,
      /^ui\/\w+$/,
    ];
    let checked = 0;
    for (const name of files) {
      for (const { target } of importsOf(name)) {
        checked++;
        if (target === 'obsidian') continue;
        expect(target.startsWith('.'), `${name} imports "${target}"`).toBe(true);
        const where = leadsTo(target);
        expect(allowed.some((pattern) => pattern.test(where)), `${name} imports "${target}" (${where})`).toBe(true);
        const resolved = path.resolve(plannerDir, target);
        expect(existsSync(`${resolved}.ts`) || existsSync(path.join(resolved, 'index.ts')), `${name} imports "${target}", which does not exist`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(25);
    // the check would catch a slip
    expect(allowed.some((pattern) => pattern.test(leadsTo('../../core/projectStore')))).toBe(false);
    expect(allowed.some((pattern) => pattern.test(leadsTo('../../obsidian/obsidianVault')))).toBe(false);
    expect(allowed.some((pattern) => pattern.test(leadsTo('../../main')))).toBe(false);
    expect(allowed.some((pattern) => pattern.test(leadsTo('../../views/binderView')))).toBe(false);
  });

  it('describes its host with types alone: the host file runs no code', () => {
    const imports = importsOf('plannerHost.ts');
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((entry) => entry.typeOnly)).toBe(true);
    expect(/\b(function|class|const|let)\b/.test(codeOf('plannerHost.ts'))).toBe(false);
  });

  it('keeps the model free of the screen and of Obsidian', () => {
    const code = codeOf('plannerModel.ts');
    expect(importsOf('plannerModel.ts').some((entry) => entry.target === 'obsidian')).toBe(false);
    expect(/\b(createEl|createDiv|createSpan|HTMLElement|document|window)\b/.test(code)).toBe(false);
  });

  it("never puts the writer's text on the page as HTML", () => {
    const html = /\b(innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|sanitizeHTMLToDom|MarkdownRenderer|document\s*\.\s*write)\b/;
    for (const name of files) expect(html.test(codeOf(name)), name).toBe(false);
    expect(html.test('el.innerHTML = title;')).toBe(true);
  });

  it('reads no clock and no note itself, and reaches for nothing on the page that is not its own', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['the clock', /\bnew\s+Date\b|\bDate\s*\.\s*now\b/],
      ['a note or the vault', /\b(vault|fileManager|metadataCache)\b/i],
      ['the project store', /\bProjectStore\b|\bprojectStore\b/],
      // In a pop-out window the page is another one: elements are reached through their own document.
      ['the global page', /(^|[^.\w])(document|window)\s*\./],
      ['a global timer', /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/],
      ['browser storage', /\b(localStorage|sessionStorage|indexedDB)\b/],
      ['a lookbehind', /\(\?<[=!]/],
    ];
    for (const name of files) {
      const code = codeOf(name);
      for (const [what, pattern] of forbidden) expect(pattern.test(code), `${name} must not use ${what}`).toBe(false);
    }
    expect(forbidden[3]?.[1].test('const el = document.body;')).toBe(true);
    expect(forbidden[3]?.[1].test('const doc = el.ownerDocument.body;')).toBe(false);
  });

  it('takes its logic from the engine instead of working it out again', () => {
    // No date arithmetic, no reading of checkbox lines, no parsing of dates.
    const reinvented = /\bgetDay\b|\bgetMonth\b|\bgetFullYear\b|\bDate\s*\.\s*UTC\b|\[[ xX]\]|\\d\{4\}/;
    for (const name of files) expect(reinvented.test(codeOf(name)), name).toBe(false);
    const used = files.map(codeOf).join('\n');
    for (const fn of ['parseTodo', 'parseMarks', 'monthGrid', 'summariseDays', 'addTask', 'setTaskDone', 'setTaskText', 'setTaskDue', 'removeTask', 'moveTask', 'setMark', 'removeMark', 'overdueTasks', 'monthTitle', 'dayTitle']) {
      expect(used, fn).toMatch(new RegExp(`\\b${fn}\\(`));
    }
  });
});
