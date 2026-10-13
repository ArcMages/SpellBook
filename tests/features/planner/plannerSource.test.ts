// Rules about the planner's own source (src/features/planner), checked by
// reading the files. The folder has two kinds of file:
//
//   the screen   a view and nothing more: it reads through its host, changes
//                through its host, and takes all its logic from the engine;
//   the wiring   what plugs the screen into the plugin: the host on top of
//                the project store (plannerWiring.ts), how it reads what
//                other screens hand it (plannerNumbers.ts), and the feature
//                itself (index.ts).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..', '..', '..', 'src');
const plannerDir = path.join(srcDir, 'features', 'planner');
const files = readdirSync(plannerDir).filter((name) => name.endsWith('.ts'));
const wiringFiles = ['index.ts', 'plannerNumbers.ts', 'plannerWiring.ts'];
const screenFiles = files.filter((name) => !wiringFiles.includes(name));
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

/** Check that every import of these files is "obsidian" or leads to an allowed place that exists. Returns how many were checked. */
function checkImports(names: readonly string[], allowed: readonly RegExp[]): number {
  let checked = 0;
  for (const name of names) {
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
  return checked;
}

describe('the planner folder', () => {
  it('has its files: the screen, and what plugs it into the plugin', () => {
    expect([...screenFiles].sort()).toEqual([
      'calendarPart.ts',
      'dateModal.ts',
      'plannerHost.ts',
      'plannerModel.ts',
      'plannerParts.ts',
      'plannerView.ts',
      'todoPart.ts',
    ]);
    expect([...files].sort()).toEqual([...screenFiles, ...wiringFiles].sort());
  });

  it("never puts the writer's text on the page as HTML", () => {
    const html = /\b(innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|sanitizeHTMLToDom|MarkdownRenderer|document\s*\.\s*write)\b/;
    for (const name of files) expect(html.test(codeOf(name)), name).toBe(false);
    expect(html.test('el.innerHTML = title;')).toBe(true);
  });

  it('reads no clock itself, keeps nothing in the browser, and reaches for nothing on the page that is not its own', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['the clock', /\bnew\s+Date\b|\bDate\s*\.\s*now\b/],
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
    expect(forbidden[1]?.[1].test('const el = document.body;')).toBe(true);
    expect(forbidden[1]?.[1].test('const doc = el.ownerDocument.body;')).toBe(false);
    expect(forbidden[2]?.[1].test('window.setTimeout(draw, 0);')).toBe(true);
    expect(forbidden[2]?.[1].test('this.host.clock.setTimer(draw, 0);')).toBe(false);
  });

  it('takes its logic from the engine instead of working it out again', () => {
    // No date arithmetic, no reading of checkbox lines, no parsing of dates.
    const reinvented = /\bgetDay\b|\bgetMonth\b|\bgetFullYear\b|\bDate\s*\.\s*UTC\b|\[[ xX]\]|\\d\{4\}/;
    for (const name of files) expect(reinvented.test(codeOf(name)), name).toBe(false);
    const used = screenFiles.map(codeOf).join('\n');
    for (const fn of ['parseTodo', 'parseMarks', 'monthGrid', 'summariseDays', 'addTask', 'setTaskDone', 'setTaskText', 'setTaskDue', 'removeTask', 'moveTask', 'setMark', 'removeMark', 'overdueTasks', 'monthTitle', 'dayTitle']) {
      expect(used, fn).toMatch(new RegExp(`\\b${fn}\\(`));
    }
  });
});

describe('the planner screen', () => {
  it('imports only Obsidian, the engine, a few plain helpers of the core, and shared pieces of screen', () => {
    // Never the project store, the vault doorway, the plugin itself, another screen, or its own wiring.
    const allowed = [
      /^features\/planner\/(calendarPart|dateModal|plannerHost|plannerModel|plannerParts|plannerView|todoPart)$/,
      /^core\/planner$/,
      /^core\/dates$/,
      /^core\/binderModel$/,
      /^core\/dropTarget$/,
      /^ui\/\w+$/,
    ];
    expect(checkImports(screenFiles, allowed)).toBeGreaterThan(25);
    // the check would catch a slip
    for (const slip of ['../../core/projectStore', '../../obsidian/obsidianVault', '../../main', '../../views/binderView', '../registry', './plannerWiring', './index']) {
      expect(allowed.some((pattern) => pattern.test(leadsTo(slip))), slip).toBe(false);
    }
  });

  it('describes its host with types alone: the host file runs no code', () => {
    const imports = importsOf('plannerHost.ts');
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((entry) => entry.typeOnly)).toBe(true);
    expect(/\b(function|class|const|let)\b/.test(codeOf('plannerHost.ts'))).toBe(false);
  });

  it('keeps the model free of the screen and of Obsidian', () => {
    for (const name of ['plannerModel.ts', 'plannerNumbers.ts']) {
      expect(importsOf(name).some((entry) => entry.target === 'obsidian'), name).toBe(false);
      expect(/\b(createEl|createDiv|createSpan|HTMLElement|document|window)\b/.test(codeOf(name)), name).toBe(false);
    }
  });

  it('reads no note itself and knows nothing of the project store', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['a note or the vault', /\b(vault|fileManager|metadataCache)\b/i],
      ['the project store', /\bProjectStore\b|\bprojectStore\b|\bupdateDataFile\b|\bupdateProjectData\b|\breadDataFile\b/],
      ['what the other screens offer', /\bservices\b/],
    ];
    for (const name of screenFiles) {
      const code = codeOf(name);
      for (const [what, pattern] of forbidden) expect(pattern.test(code), `${name} must not use ${what}`).toBe(false);
    }
    expect(forbidden[0]?.[1].test('const path = store.vaultPathOf(rel);')).toBe(false);
    expect(forbidden[0]?.[1].test('this.vault.on(listener);')).toBe(true);
  });
});

describe('what plugs the planner in', () => {
  it('imports only Obsidian, the core, shared pieces of screen, the registry and its own folder', () => {
    // Never the vault doorway's own file, the plugin itself, the binder or another screen.
    const allowed = [/^features\/planner\/\w+$/, /^features\/registry$/, /^core\/\w+$/, /^ui\/\w+$/];
    expect(checkImports(wiringFiles, allowed)).toBeGreaterThan(15);
    for (const slip of ['../../obsidian/obsidianVault', '../../main', '../../views/binderView', '../corkboard/host', '../progress/index']) {
      expect(allowed.some((pattern) => pattern.test(leadsTo(slip))), slip).toBe(false);
    }
  });

  it('changes the project only through the store: To-do.md as one of its own files, the marks as a key of the index', () => {
    const code = codeOf('plannerWiring.ts');
    expect(code).toMatch(/store\s*\.\s*updateDataFile\(\s*TODO_FILE\b/);
    expect(code).toMatch(/store\s*\.\s*updateProjectData\(\s*MARKS_KEY\b/);
    expect(code).toMatch(/store\s*\.\s*readDataFile\(\s*TODO_FILE\b/);
    // Nothing else of the store is asked to change anything.
    const asked = [...wiringFiles.map(codeOf).join('\n').matchAll(/\bstore\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1] ?? '');
    expect([...new Set(asked)].sort()).toEqual(['idle', 'onChange', 'projectData', 'readDataFile', 'updateDataFile', 'updateProjectData', 'vaultPathOf']);
  });

  it('uses the vault doorway for listening and nothing else', () => {
    const writes = /\.\s*(updateFrontmatter|updateText|createFile|createFolder|rename|trash|readText|readFrontmatter)\s*\(/;
    let listened = 0;
    for (const name of wiringFiles) {
      const code = codeOf(name);
      expect(writes.test(code), name).toBe(false);
      expect(/\bapp\s*\.\s*(vault|fileManager|metadataCache)\b/.test(code), name).toBe(false);
      for (const match of code.matchAll(/\bvault\s*\.\s*(\w+)/g)) {
        expect(match[1], `${name} uses vault.${match[1] ?? ''}`).toBe('on');
        listened++;
      }
    }
    expect(listened).toBe(1);
    // The doorway is handed over as something that can only be listened to.
    expect(codeOf('plannerWiring.ts')).toMatch(/readonly vault: Pick<VaultPort, 'on'>/);
    expect(writes.test('await this.deps.vault.updateText(path, change);')).toBe(true);
  });

  it('asks for the word counts by name each time, and keeps them nowhere at start-up', () => {
    const wiring = codeOf('plannerWiring.ts');
    // One place asks the services, and it is a method that is called whenever the counts are needed.
    expect((wiring.match(/\bservices\s*\.\s*get\b/g) ?? []).length).toBe(1);
    expect(wiring).toMatch(/private lookUp\(\)[^{]*\{[^}]*services\s*\.\s*get<unknown>\(PROGRESS_STATS_SERVICE\)/);
    expect(codeOf('plannerNumbers.ts')).toMatch(/PROGRESS_STATS_SERVICE = 'progress\.stats'/);
    // The feature itself never asks: it only hands the services on.
    expect(/\bservices\s*\.\s*(get|provide)\b/.test(codeOf('index.ts'))).toBe(false);
  });

  it("takes the week's first day from Obsidian's own language setting", () => {
    const index = codeOf('index.ts');
    expect(index).toMatch(/import \{[^}]*\bmoment\b[^}]*\} from 'obsidian'/);
    expect(index).toMatch(/firstDayOfWeek: \(\) => firstDayOfWeekOf\(moment\)/);
  });
});
