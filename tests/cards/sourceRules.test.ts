// Rules about the source of the cards engine itself, checked by reading the
// files: it stays inside src/core, it is described where the screen builders
// will look, and everything it promises to export is really there.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as cards from '../../src/core/cards';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(here, '..', '..', 'src', 'core');
const engineDir = path.join(coreDir, 'cards');

const files = readdirSync(engineDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();

function read(name: string): string {
  return readFileSync(path.join(engineDir, name), 'utf8');
}

/** Every module a file imports or re-exports from. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

describe('the cards engine keeps to src/core', () => {
  it('is made of the expected files', () => {
    expect(files).toEqual([
      'board.ts',
      'card.ts',
      'colors.ts',
      'coreImports.ts',
      'grid.ts',
      'index.ts',
      'inspector.ts',
      'moves.ts',
      'patch.ts',
      'preview.ts',
      'sceneFields.ts',
      'tags.ts',
    ]);
  });

  it('imports only files that are inside src/core', () => {
    for (const name of files) {
      for (const target of importsOf(read(name))) {
        expect(target.startsWith('.'), `${name} imports the package "${target}"`).toBe(true);
        const resolved = path.resolve(engineDir, target);
        const inside = resolved.startsWith(coreDir + path.sep);
        expect(inside, `${name} imports ${target}, which is outside src/core`).toBe(true);
      }
    }
  });

  it('reaches the rest of src/core through one file only', () => {
    for (const name of files) {
      const outward = importsOf(read(name)).filter((target) => !path.resolve(engineDir, target).startsWith(engineDir + path.sep));
      if (name === 'coreImports.ts') expect(outward.length).toBeGreaterThan(0);
      else expect(outward, name).toEqual([]);
    }
  });

  it('borrows from the existing core instead of copying it', () => {
    const borrowed = importsOf(read('coreImports.ts')).map((target) => path.basename(target)).sort();
    for (const expected of ['dates', 'paths', 'projectLayout', 'scene', 'types', 'wordCount']) {
      expect(borrowed, expected).toContain(expected);
    }
  });

  it('uses no clock, no timer, no random numbers and no regular-expression lookbehind', () => {
    for (const name of files) {
      const source = read(name);
      expect(/\(\?<[=!]/.test(source), `${name}: lookbehind`).toBe(false);
      expect(/\bnew\s+Date\b|\bDate\s*\.\s*now\b/.test(source), `${name}: the clock`).toBe(false);
      expect(/\b(setTimeout|setInterval)\s*\(|\bMath\s*\.\s*random\b/.test(source), `${name}: timers or random`).toBe(false);
    }
  });

  it('holds no invisible or direction-changing characters, even in its Hebrew-handling code', () => {
    for (const name of files) {
      const odd = [...read(name)].filter((character) => {
        const code = character.codePointAt(0) as number;
        return (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x2069) || code === 0xfeff;
      });
      expect(odd, name).toEqual([]);
    }
  });
});

describe('index.ts, the list the screen builders work from', () => {
  const source = read('index.ts');
  const lines = source.split('\n');
  const exportLines = lines.map((line, number) => ({ line, number })).filter(({ line }) => line.startsWith('export '));

  it('exports one name per line, each with a doc comment straight above it', () => {
    expect(exportLines.length).toBeGreaterThan(40);
    for (const { line, number } of exportLines) {
      expect(line, line).toMatch(/^export (type )?\{ \w+ \} from '\.\/\w+';$/);
      const above = lines[number - 1] ?? '';
      expect(above.startsWith('/** ') && above.endsWith(' */'), `no doc comment above: ${line}`).toBe(true);
      expect(above.length, `the comment above "${line}" says nothing`).toBeGreaterThan(20);
    }
  });

  it('exports each name once', () => {
    const exported = exportLines.map(({ line }) => /\{ (\w+) \}/.exec(line)?.[1] ?? '');
    expect(new Set(exported).size).toBe(exported.length);
  });

  it('really provides every value it lists', () => {
    const values = exportLines.filter(({ line }) => !line.startsWith('export type ')).map(({ line }) => /\{ (\w+) \}/.exec(line)?.[1] ?? '');
    expect(Object.keys(cards).sort()).toEqual([...values].sort());
    for (const name of values) expect((cards as Record<string, unknown>)[name], name).toBeDefined();
  });

  it('offers the functions each part of the specification needs', () => {
    const needed = [
      // statuses and labels
      'readTagLists', 'parseTagList', 'addTag', 'renameTag', 'recolourTag', 'moveTag', 'removeTag', 'unlistedTags',
      // the card
      'buildSceneCard', 'derivePreview',
      // the board and moving cards
      'buildBoard', 'moveEarlier', 'moveLater', 'dropAt',
      // the grid
      'gridLayout',
      // the inspector
      'buildInspector', 'inspectorPatch',
    ];
    for (const name of needed) expect(typeof (cards as Record<string, unknown>)[name], name).toBe('function');
  });

  it('gives every function in the engine a doc comment where it is written', () => {
    for (const name of files) {
      if (name === 'index.ts' || name === 'coreImports.ts') continue;
      const fileLines = read(name).split('\n');
      fileLines.forEach((line, number) => {
        if (!/^export (function|const|interface|type) /.test(line)) return;
        // Walk up over the lines of a comment that ends just above the export.
        const above = (fileLines[number - 1] ?? '').trim();
        expect(above.endsWith('*/'), `${name}: no doc comment above "${line}"`).toBe(true);
      });
    }
  });
});
