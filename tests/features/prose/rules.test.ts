// Rules about the prose checks' own source and stylesheet, checked by reading
// the files. They keep the promises of the design: the engine is the
// plugin's own and needs nothing but itself, the feature only decorates, and
// no check is told from another by colour alone.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STYLE_FILES } from '../../../scripts/styles.mjs';
import { MARK_KINDS } from '../../../src/core/prose';
import { EDITOR_CLASS, TIP_CLASS, markClass, proseFeature } from '../../../src/features/prose/index';
import { FEATURES } from '../../../src/features/registry';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const featureDir = path.join(root, 'src', 'features', 'prose');
const coreDir = path.join(root, 'src', 'core', 'prose');
const cssFile = path.join(root, 'src', 'styles', 'prose.css');

/** Source text with comments removed, so a rule can be explained in a comment without breaking it. */
function strip(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

const filesIn = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.ts')).sort();
const code = (dir: string, name: string): string => strip(readFileSync(path.join(dir, name), 'utf8'));
const importsOf = (source: string): string[] => [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

describe('the source of the prose checks', () => {
  it('is made of the expected files', () => {
    expect(filesIn(featureDir)).toEqual(['choices.ts', 'editor.ts', 'index.ts', 'marks.ts', 'settings.ts', 'tip.ts']);
    expect(filesIn(coreDir)).toEqual([
      'analyse.ts',
      'checks.ts',
      'index.ts',
      'lexicon.ts',
      'mask.ts',
      'prefs.ts',
      'tagger.ts',
      'tokens.ts',
      'types.ts',
      'wordLists.ts',
    ]);
  });

  it('exports the feature as "proseFeature", listed once', () => {
    expect(proseFeature.id).toBe('prose');
    expect(FEATURES.filter((feature) => feature.id === 'prose')).toEqual([proseFeature]);
    expect(STYLE_FILES).toContain('prose.css');
  });

  it('keeps the engine to itself: it imports nothing but its own files', () => {
    for (const name of filesIn(coreDir)) {
      for (const target of importsOf(code(coreDir, name))) expect(target.startsWith('./'), `${name} imports ${target}`).toBe(true);
    }
  });

  it('brings in the editor library only where the marks are drawn, and the engine only through its index', () => {
    for (const name of filesIn(featureDir)) {
      const imports = importsOf(code(featureDir, name));
      const editorLibrary = imports.some((target) => target.startsWith('@codemirror/'));
      expect(editorLibrary, name).toBe(['editor.ts', 'index.ts', 'marks.ts'].includes(name));
      for (const target of imports.filter((entry) => entry.includes('core/prose'))) expect(target, name).toBe('../../core/prose/index');
      // Nothing but the two packages Obsidian itself provides.
      for (const target of imports.filter((entry) => !entry.startsWith('.'))) {
        expect(['obsidian', '@codemirror/state', '@codemirror/view'], `${name} imports ${target}`).toContain(target);
      }
    }
  });

  it('only decorates: nothing in it changes the text of a note, the caret or the scroll position', () => {
    for (const name of filesIn(featureDir)) {
      const source = code(featureDir, name);
      expect(/\bchanges\s*:/.test(source), `${name} makes a change to the text`).toBe(false);
      expect(/\bselection\s*:/.test(source), `${name} moves the caret`).toBe(false);
      expect(/scrollIntoView|scrollTo\b|scrollTop\s*=/.test(source), `${name} scrolls`).toBe(false);
      expect(/\.(replaceRange|replaceSelection|setValue|setLine|setCursor)\s*\(/.test(source.replace(/(toggle|text)\s*\.setValue\(|\.setValue\(prefs\./g, '')), name).toBe(false);
      expect(/Decoration\.(replace|widget|line)\b/.test(source), `${name} draws more than marks`).toBe(false);
    }
    // The one thing it asks of an editor: to look again.
    const dispatches = [...code(featureDir, 'editor.ts').matchAll(/\.dispatch\(([^)]*)\)/g)].map((match) => match[1]);
    expect(dispatches).toEqual(['{ effects: refresh.of(null']);
  });

  it('decides in one place whether this is a touch screen', () => {
    const users = filesIn(featureDir).filter((name) => /\bPlatform\b/.test(code(featureDir, name)));
    expect(users).toEqual(['index.ts']);
    expect(code(featureDir, 'index.ts').match(/Platform\.\w+/g)).toEqual(['Platform.isMobile']);
  });

  it('uses no timer and no clock of its own', () => {
    for (const dir of [featureDir, coreDir]) {
      for (const name of filesIn(dir)) {
        expect(/\b(setTimeout|setInterval|requestAnimationFrame|Date\.now|performance\.now)\b/.test(code(dir, name)), name).toBe(false);
      }
    }
  });

  it('has word lists of its own, in the form words are compared in', async () => {
    const lists = await import('../../../src/core/prose/wordLists');
    for (const [name, list] of Object.entries(lists)) {
      if (typeof list === 'string') continue;
      for (const entry of list as Iterable<string>) {
        expect(entry, name).toBe(entry.trim().toLowerCase());
        expect(entry, name).not.toBe('');
        // Hebrew without points, English without curly apostrophes.
        expect(/[֑-ׇ’]/.test(entry), `${name}: ${entry}`).toBe(false);
      }
    }
    expect([...lists.HEBREW_PREFIXES].sort()).toEqual([...'ובהלמשכ'].sort());
  });
});

describe('the stylesheet of the prose checks', () => {
  const css = readFileSync(cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
    body: match[2] ?? '',
  }));
  /** Everything the stylesheet says about elements of one class inside the editor. */
  const said = (cls: string): string =>
    rules
      .filter((rule) => rule.selectors.includes(`.${EDITOR_CLASS} .${cls}`))
      .map((rule) => rule.body)
      .join('\n');
  const value = (body: string, property: string): string | undefined =>
    [...body.matchAll(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`, 'g'))].pop()?.[1]?.trim();

  it('styles marks only inside an editor that shows the checks, and the bubble', () => {
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        expect(selector === `.${EDITOR_CLASS}` || selector.startsWith(`.${EDITOR_CLASS} .spellbook-prose-`) || selector.startsWith(`.${TIP_CLASS}`), selector).toBe(true);
      }
    }
  });

  it('has a colour variable for every kind of mark, each on top of one of Obsidian\'s own', () => {
    const variables = rules.find((rule) => rule.selectors.includes(`.${EDITOR_CLASS}`))?.body ?? '';
    for (const kind of MARK_KINDS) {
      expect(variables, kind).toMatch(new RegExp(`--spellbook-prose-${kind}:\\s*var\\(--color-[a-z]+\\);`));
      // And the mark uses its own variable, nothing else, for its colour.
      const colours = [...said(markClass(kind)).matchAll(/var\((--[a-z-]+)\)/g)].map((match) => match[1]).filter((name) => name !== '--spellbook-prose-line');
      expect([...new Set(colours)], kind).toEqual([`--spellbook-prose-${kind}`]);
    }
  });

  it('gives every check a line of its own, so that none is told from another by colour alone', () => {
    const checks = ['filler', 'passive', 'repeated', 'overused', 'long', 'run'] as const;
    const signs = checks.map((kind) => {
      const body = said(markClass(kind));
      return `${value(body, 'text-decoration-line')} ${value(body, 'text-decoration-style')}`;
    });
    expect(signs).toEqual(['underline wavy', 'underline dashed', 'underline double', 'underline dotted', 'overline solid', 'overline dashed']);
    expect(new Set(signs).size).toBe(checks.length);
    // The lines under a word sit at different depths, so two on one word can both be seen.
    const depths = checks.slice(0, 4).map((kind) => value(said(markClass(kind)), 'text-underline-offset'));
    expect(new Set(depths).size).toBe(4);
    // The four word types are colour, and say their name when pointed at or tapped (see wired.test.ts).
    for (const kind of ['noun', 'verb', 'adjective', 'adverb'] as const) {
      expect(said(markClass(kind)).trim(), kind).toBe(`color: var(--spellbook-prose-${kind});`);
    }
  });

  it('never moves or animates the text that is being typed', () => {
    for (const rule of rules.filter((entry) => entry.selectors.some((selector) => selector === `.${EDITOR_CLASS}` || selector.startsWith(`.${EDITOR_CLASS} `)))) {
      const where = rule.selectors.join(', ');
      expect(/\b(transition|animation)\b/.test(rule.body), where).toBe(false);
      // Nothing that changes the size of a letter or the height of a line.
      expect(/\b(font-size|font-weight|font-style|font-family|letter-spacing|word-spacing|padding|margin|border|line-height|display)\b/.test(rule.body), where).toBe(false);
    }
    expect(css).not.toMatch(/:hover/);
  });

  it('keeps the bubble from ever taking a tap, and on the page whatever the direction of the app', () => {
    const tip = rules.find((rule) => rule.selectors.includes(`.${TIP_CLASS}`))?.body ?? '';
    expect(tip).toMatch(/position:\s*fixed/);
    expect(tip).toMatch(/pointer-events:\s*none/);
    expect(tip).toMatch(/max-width:\s*min\(/);
    expect(tip).toMatch(/text-align:\s*start/);
  });
});
