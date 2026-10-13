// Rules about the plugin's own source code, checked by reading the files.
// They keep the promises made in the design: the core stays testable without
// Obsidian, and nothing in the plugin can reach outside the vault API.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const thisFile = fileURLToPath(import.meta.url);
const srcDir = path.resolve(path.dirname(thisFile), '..', 'src');
const stylesFile = path.resolve(path.dirname(thisFile), '..', 'styles.css');

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Source text with comments removed, so a rule can be explained in a comment without breaking it. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

const relative = (file: string): string => path.relative(srcDir, file).split(path.sep).join('/');
const allFiles = listFiles(srcDir);
const coreFiles = allFiles.filter((file) => relative(file).startsWith('core/'));
const adapterFiles = allFiles.filter((file) => relative(file).startsWith('obsidian/'));
const outsideAdapter = allFiles.filter((file) => !relative(file).startsWith('obsidian/'));

describe('source layout', () => {
  it('has the agreed files', () => {
    const names = allFiles.map(relative);
    for (const expected of [
      'main.ts',
      'settings.ts',
      'core/types.ts',
      'core/binderTree.ts',
      'core/projectIndex.ts',
      'core/orderKeys.ts',
      'core/names.ts',
      'core/wordCount.ts',
      'core/vaultPort.ts',
      'core/projectStore.ts',
      'core/projectSeed.ts',
      'core/sampleProject.ts',
      'core/newProject.ts',
      'obsidian/obsidianVault.ts',
      'obsidian/openNote.ts',
      'ui/createProjectModal.ts',
    ]) {
      expect(names, expected).toContain(expected);
    }
    expect(coreFiles.length).toBeGreaterThanOrEqual(8);
  });
});

describe('src/core is pure', () => {
  const forbidden: Array<[string, RegExp]> = [
    ['an import from "obsidian"', /from\s+['"]obsidian['"]|require\(\s*['"]obsidian['"]\s*\)/],
    ['an import from outside src/core', /from\s+['"]\.\.\//],
    ['Date.now()', /\bDate\s*\.\s*now\b/],
    ['new Date()', /\bnew\s+Date\b/],
    ['the DOM (document)', /\bdocument\s*\./],
    ['the DOM (window)', /\bwindow\s*\./],
    ['a global timer', /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/],
    ['browser storage', /\b(localStorage|sessionStorage|indexedDB)\b/],
    ['Math.random (the random source is handed in)', /\bMath\s*\.\s*random\b/],
  ];

  for (const file of coreFiles) {
    it(`${relative(file)} uses nothing from Obsidian, the DOM or the clock`, () => {
      const code = codeOf(file);
      for (const [what, pattern] of forbidden) {
        expect(pattern.test(code), `${relative(file)} must not use ${what}`).toBe(false);
      }
    });
  }

  it('the rule itself works: it would catch each forbidden thing', () => {
    const samples = [
      "import { TFile } from 'obsidian';",
      "import { x } from '../obsidian/obsidianVault';",
      'const t = Date.now();',
      'const d = new Date();',
      "document.createElement('div');",
      'window.setTimeout(f, 1);',
      'setTimeout(f, 1);',
      "localStorage.getItem('x');",
      'const r = Math.random();',
    ];
    samples.forEach((sample, index) => {
      const [what, pattern] = forbidden[index] as [string, RegExp];
      expect(pattern.test(sample), what).toBe(true);
    });
    // Comments really are stripped: the first line of this file is one.
    const firstLine = ['Rules about', "the plugin's own source code"].join(' ');
    expect(readFileSync(thisFile, 'utf8')).toContain(firstLine);
    expect(codeOf(thisFile)).not.toContain(firstLine);
  });
});

describe('the whole plugin', () => {
  it('reaches notes only through src/obsidian', () => {
    for (const file of outsideAdapter) {
      const code = codeOf(file);
      expect(/\bapp\s*\.\s*(vault|fileManager|metadataCache)\b/.test(code), relative(file)).toBe(false);
      expect(/\.\s*(processFrontMatter|trashFile|renameFile|getMarkdownFiles|getFileCache)\s*\(/.test(code), relative(file)).toBe(false);
    }
  });

  it('never deletes a note outright or rewrites its text', () => {
    // In src/obsidian, "vault" is Obsidian's Vault. Its destructive methods are
    // off limits: the FileManager ones (trashFile, renameFile, processFrontMatter) are used instead.
    expect(adapterFiles.length).toBeGreaterThan(0);
    for (const file of adapterFiles) {
      const code = codeOf(file);
      expect(/\bvault\s*\.\s*(delete|trash|modify|modifyBinary|process|append|rename)\s*\(/.test(code), relative(file)).toBe(false);
    }
    for (const file of allFiles) {
      expect(/\badapter\s*\./.test(codeOf(file)), `${relative(file)} must not use the low-level adapter`).toBe(false);
    }
    // the pattern would catch a slip
    expect(/\bvault\s*\.\s*(delete|trash|modify|modifyBinary|process|append|rename)\s*\(/.test('await this.app.vault.delete(file);')).toBe(true);
  });

  it('uses no Node, Electron, network or eval', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['a Node or Electron module', /from\s+['"](node:[^'"]+|fs|path|os|child_process|electron|http|https|net|crypto)['"]/],
      ['require()', /\brequire\s*\(/],
      ['eval', /\beval\s*\(|\bnew\s+Function\s*\(/],
      ['a network request', /\b(fetch|XMLHttpRequest|WebSocket|requestUrl|sendBeacon)\b/],
      ['process', /\bprocess\s*\.\s*(env|platform|cwd)\b/],
    ];
    for (const file of allFiles) {
      const code = codeOf(file);
      for (const [what, pattern] of forbidden) {
        expect(pattern.test(code), `${relative(file)} must not use ${what}`).toBe(false);
      }
    }
  });

  it('uses no regular-expression lookbehind', () => {
    // A lookbehind stops the whole plugin from loading on iPhones and iPads older than iOS 16.4.
    const lookbehind = /\(\?<[=!]/;
    for (const file of allFiles) {
      expect(lookbehind.test(readFileSync(file, 'utf8')), relative(file)).toBe(false);
    }
    expect(lookbehind.test(['/(?', '<=a)b/'].join(''))).toBe(true);
    expect(lookbehind.test(['/(?', '<!a)b/'].join(''))).toBe(true);
    expect(lookbehind.test('/(?<name>a)(?=b)(?!c)/')).toBe(false); // named groups and lookaheads are fine
  });

  it('only the views and windows touch the screen, never the core or the vault doorway', () => {
    for (const file of [...coreFiles, ...adapterFiles]) {
      const code = codeOf(file);
      expect(/\b(createEl|createDiv|createSpan|contentEl|containerEl)\b/.test(code), relative(file)).toBe(false);
      expect(/from\s+['"]\.\.\/(ui|views)\//.test(code), relative(file)).toBe(false);
    }
  });

  it('contains no invisible or direction-changing characters', () => {
    // Such characters can make code read differently from what it does.
    for (const file of allFiles) {
      const text = readFileSync(file, 'utf8');
      const odd = [...text]
        .map((character) => character.codePointAt(0) as number)
        .filter(
          (code) =>
            (code < 0x20 && code !== 0x0a && code !== 0x09) ||
            (code >= 0x7f && code <= 0x9f) ||
            (code >= 0x200b && code <= 0x200f) ||
            (code >= 0x202a && code <= 0x202e) ||
            (code >= 0x2060 && code <= 0x2069) ||
            code === 0xfeff,
        )
        .map((code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
      expect(odd, relative(file)).toEqual([]);
    }
  });
});

describe('styles.css', () => {
  const css = readFileSync(stylesFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
    body: match[2] ?? '',
  }));

  it('only styles things inside elements the plugin itself marked', () => {
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        expect(selector.startsWith('.spellbook-'), selector).toBe(true);
      }
    }
  });

  it('takes its colours from the theme, never from fixed values', () => {
    for (const rule of rules) {
      expect(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test(rule.body), rule.selectors.join(', ')).toBe(false);
    }
  });

  it('the checks themselves work', () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test('color: #fff;')).toBe(true);
    expect(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test('color: var(--text-normal);')).toBe(false);
  });
});
