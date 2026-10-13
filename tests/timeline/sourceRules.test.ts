// Rules about the timeline engine's own source, checked by reading the files.
//
// The engine sits one folder below the rest of src/core, so it reaches the
// shared files as "./../name". The plugin-wide rule in tests/sourceRules.test.ts
// looks for imports that start with "../", which would not see these. The first
// test here closes that gap: it follows every import to where it really leads.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from '../../src/core/timeline';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(here, '..', '..', 'src', 'core');
const engineDir = path.join(coreDir, 'timeline');
const files = readdirSync(engineDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => path.join(engineDir, name));
const nameOf = (file: string): string => path.basename(file);

describe('the timeline engine source', () => {
  it('has its files', () => {
    expect(files.map(nameOf).sort()).toEqual([
      'calendar.ts',
      'common.ts',
      'drag.ts',
      'entities.ts',
      'eventLanes.ts',
      'events.ts',
      'index.ts',
      'lanes.ts',
      'layout.ts',
      'narrative.ts',
      'scale.ts',
      'storyDate.ts',
    ]);
  });

  it('imports nothing from outside src/core, and no package at all', () => {
    let imports = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const target = match[1] ?? '';
        imports++;
        expect(target.startsWith('.'), `${nameOf(file)} imports the package "${target}"`).toBe(true);
        const resolved = path.resolve(path.dirname(file), target);
        const inside = path.relative(coreDir, resolved);
        expect(inside.startsWith('..') || path.isAbsolute(inside), `${nameOf(file)} imports "${target}", outside src/core`).toBe(false);
      }
    }
    expect(imports).toBeGreaterThan(20); // the pattern really finds the imports
    // ...and would catch a way out of src/core, however it is spelled.
    for (const escape of ['./../../obsidian/obsidianVault', '../../main', './../../../package.json']) {
      const inside = path.relative(coreDir, path.resolve(engineDir, escape));
      expect(inside.startsWith('..')).toBe(true);
    }
  });

  it('uses no clock, no DOM, no timers and no random numbers', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['the clock', /\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bperformance\s*\./],
      ['the DOM', /\b(document|window|navigator)\s*\./],
      ['a timer', /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/],
      ['random numbers', /\bMath\s*\.\s*random\b/],
      ['regular-expression lookbehind', /\(\?<[=!]/],
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const [what, pattern] of forbidden) {
        expect(pattern.test(source), `${nameOf(file)} must not use ${what}`).toBe(false);
      }
    }
  });

  it('is written in plain ASCII, so no hidden or direction-changing character can slip in', () => {
    for (const file of files) {
      const odd = [...readFileSync(file, 'utf8')].filter((character) => {
        const code = character.codePointAt(0) as number;
        return code > 0x7e || (code < 0x20 && code !== 0x0a);
      });
      expect(odd, nameOf(file)).toEqual([]);
    }
  });
});

describe('the public API (index.ts)', () => {
  const index = readFileSync(path.join(engineDir, 'index.ts'), 'utf8').split('\n');
  const exportLines = index.map((line, number) => ({ line, number })).filter(({ line }) => line.startsWith('export'));

  it('exports one name per line, each with a doc comment right above it', () => {
    expect(exportLines.length).toBeGreaterThan(50);
    for (const { line, number } of exportLines) {
      expect(line, line).toMatch(/^export (type )?\{ \w+ \} from '\.\/\w+';$/);
      const above = index[number - 1] ?? '';
      expect(above.startsWith('/** ') && above.endsWith(' */'), `no doc comment above: ${line}`).toBe(true);
      expect(above.length, `the doc comment above "${line}" says nothing`).toBeGreaterThan(20);
    }
  });

  it('exports every name once', () => {
    const names = exportLines.map(({ line }) => /\{ (\w+) \}/.exec(line)?.[1] ?? '');
    expect(new Set(names).size).toBe(names.length);
  });

  it('really provides every value it names', () => {
    const values = exportLines
      .filter(({ line }) => !line.startsWith('export type'))
      .map(({ line }) => /\{ (\w+) \}/.exec(line)?.[1] ?? '');
    const provided = api as Record<string, unknown>;
    for (const name of values) expect(provided[name], name).toBeDefined();
    expect(Object.keys(provided).sort()).toEqual([...values].sort());
  });

  it('documents every exported declaration where it is written, too', () => {
    for (const file of files.filter((candidate) => nameOf(candidate) !== 'index.ts')) {
      const lines = readFileSync(file, 'utf8').split('\n');
      const inIndex = new Set(
        exportLines
          .filter(({ line }) => line.endsWith(`'./${nameOf(file).replace('.ts', '')}';`))
          .map(({ line }) => /\{ (\w+) \}/.exec(line)?.[1] ?? ''),
      );
      lines.forEach((line, number) => {
        const declared = /^export (?:const|function|type|interface|class) (\w+)/.exec(line)?.[1];
        if (declared === undefined || !inIndex.has(declared)) return;
        const above = (lines[number - 1] ?? '').trim();
        expect(above.endsWith('*/'), `${nameOf(file)}: "${declared}" has no doc comment`).toBe(true);
      });
    }
  });
});
