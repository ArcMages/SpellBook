// Rules about the writing-progress engine's own source: what it may import,
// and that everything it offers to the screens is documented.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from '../../src/core/progress';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(here, '..', '..', 'src', 'core');
const progressDir = path.join(coreDir, 'progress');
const fileNames = readdirSync(progressDir).filter((name) => name.endsWith('.ts'));
const read = (name: string): string => readFileSync(path.join(progressDir, name), 'utf8');

/** Source text without comments. */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

describe('src/core/progress keeps to itself', () => {
  it('has the files the engine is made of', () => {
    expect([...fileNames].sort()).toEqual([
      'calendar.ts',
      'format.ts',
      'index.ts',
      'sceneDates.ts',
      'statsFile.ts',
      'statsTotals.ts',
      'statusLine.ts',
      'targets.ts',
      'wordTracker.ts',
      'writeSchedule.ts',
    ]);
  });

  it('imports nothing from outside src/core: no package, no screen, no Obsidian', () => {
    let imports = 0;
    for (const name of fileNames) {
      const code = codeOf(read(name));
      expect(/\bimport\s*\(/.test(code), `${name} must not load code while running`).toBe(false);
      for (const match of code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1] as string;
        imports++;
        expect(specifier.startsWith('./'), `${name} imports "${specifier}"`).toBe(true);
        const target = path.resolve(progressDir, specifier);
        expect(target.startsWith(coreDir + path.sep), `${name} imports "${specifier}", which is outside src/core`).toBe(true);
      }
    }
    expect(imports).toBeGreaterThan(10);
    // The check would catch a slip.
    expect(path.resolve(progressDir, './../../ui/icons').startsWith(coreDir + path.sep)).toBe(false);
    expect(path.resolve(progressDir, './../dates').startsWith(coreDir + path.sep)).toBe(true);
  });

  it('uses the core\'s own helpers instead of copies', () => {
    const all = fileNames.map((name) => codeOf(read(name))).join('\n');
    for (const helper of ['./../dates', './../paths', './../projectLayout', './../types']) {
      expect(all, helper).toContain(`'${helper}'`);
    }
  });

  it('reads no clock, starts no timer and asks the device nothing about language', () => {
    for (const name of fileNames) {
      const code = codeOf(read(name));
      expect(/\bDate\s*\.\s*(now|parse|UTC)\b|\bnew\s+Date\b|\bperformance\b/.test(code), name).toBe(false);
      expect(/\b(setTimeout|setInterval|queueMicrotask)\b/.test(code), name).toBe(false);
      expect(/\btoLocale\w*\(|\bIntl\s*\./.test(code), name).toBe(false);
      expect(/\(\?<[=!]/.test(read(name)), `${name} uses a regular-expression lookbehind`).toBe(false);
    }
  });
});

describe('the public API in index.ts', () => {
  const index = read('index.ts');
  const blocks = [...index.matchAll(/export\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*'(\.\/[A-Za-z]+)';/g)].map((match) => ({
    isType: match[1] !== undefined,
    body: match[2] as string,
    from: `${(match[3] as string).slice(2)}.ts`,
  }));

  const namesOf = (body: string): string[] =>
    codeOf(body)
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');

  it('exports only by name, from the files next to it', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(12);
    // Nothing else is in the file: no code of its own, no "export *", no default export.
    const rest = codeOf(index).replace(/export\s+(type\s+)?\{[\s\S]*?\}\s*from\s*'\.\/[A-Za-z]+';/g, '');
    expect(rest.trim()).toBe('');
    for (const block of blocks) expect(fileNames, block.from).toContain(block.from);
  });

  it('has a doc comment on every export', () => {
    for (const block of blocks) {
      const documented = [...block.body.matchAll(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/g)];
      expect(documented.map((match) => match[2])).toEqual(namesOf(block.body));
      for (const match of documented) {
        expect((match[1] as string).length, `the comment on ${match[2]}`).toBeGreaterThan(15);
      }
    }
  });

  it('documents every export where it is declared as well, so that the comment shows in the editor', () => {
    for (const block of blocks) {
      const source = read(block.from);
      for (const name of namesOf(block.body)) {
        const declared = new RegExp(`\\*/\\s*export\\s+(?:function|const|class|interface|type)\\s+${name}\\b`);
        expect(declared.test(source), `${name} in ${block.from}`).toBe(true);
      }
    }
  });

  it('really exports what it lists, and nothing else', () => {
    const values = blocks.filter((block) => !block.isType).flatMap((block) => namesOf(block.body));
    expect(Object.keys(api).sort()).toEqual([...values].sort());
    const all = blocks.flatMap((block) => namesOf(block.body));
    expect(new Set(all).size).toBe(all.length);
  });

  it('offers the pieces each screen needs', () => {
    for (const name of [
      'parseStatsFile',
      'serialiseStatsFile',
      'applyDayChange',
      'updateStatsText',
      'statsFileName',
      'parseStatsFileName',
      'sumDeviceLogs',
      'totalsForRange',
      'totalsForWeek',
      'totalsForMonth',
      'writingStreak',
      'writingAverage',
      'WordTracker',
      'classifyNote',
      'planWrites',
      'parseTargets',
      'validateTargets',
      'updateTargets',
      'writingProgress',
      'sceneDatesStep',
      'sceneDatePatch',
      'buildStatusLine',
    ]) {
      expect(Object.keys(api), name).toContain(name);
    }
  });
});
