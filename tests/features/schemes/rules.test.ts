// Rules about the colour schemes' own source and stylesheet, checked by
// reading the files. They keep the promises of the design: the colours live
// in one place, the page is touched in one place and never watched, no font
// is ever set, and the stylesheet follows the same rules as styles.css (and
// can be joined to it).

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STYLES_DIR, STYLE_FILES, joinStyles } from '../../../scripts/styles.mjs';
import { CARD_COLORS, colorVariable } from '../../../src/core/cards';
import { NAMED_COLOURS, SCHEMES, SCHEME_VARIABLE_NAMES } from '../../../src/core/schemes';
import { FEATURES } from '../../../src/features/registry';
import { SCHEME_KEY, schemesFeature } from '../../../src/features/schemes/index';
import { SCHEME_CLASSES } from '../../../src/features/schemes/wearer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const featureDir = path.join(root, 'src', 'features', 'schemes');
const coreDir = path.join(root, 'src', 'core', 'schemes');
const stylesDir = path.join(root, 'src', 'styles');
const cssFile = path.join(stylesDir, 'schemes.css');

const files = readdirSync(featureDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();
const coreFiles = readdirSync(coreDir).sort();

/** Source text with comments removed, so a rule can be explained in a comment without breaking it. */
function strip(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

const codeOf = (name: string): string => strip(readFileSync(path.join(featureDir, name), 'utf8'));
const coreCodeOf = (name: string): string => strip(readFileSync(path.join(coreDir, name), 'utf8'));

function importsOf(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/;

describe('the source of the colour schemes', () => {
  it('is made of the expected files', () => {
    expect(files).toEqual(['index.ts', 'keeper.ts', 'parts.ts', 'picker.ts', 'settings.ts', 'wearer.ts']);
    expect(coreFiles).toEqual(['colour.ts', 'index.ts', 'palettes.ts', 'variables.ts']);
  });

  it('exports the feature as "schemesFeature", under a name no other feature has', () => {
    expect(schemesFeature.id).toBe('schemes');
    expect(typeof schemesFeature.register).toBe('function');
    expect(FEATURES).toContain(schemesFeature);
    expect(FEATURES.filter((feature) => feature.id === schemesFeature.id)).toEqual([schemesFeature]);
  });

  it('reaches nothing outside its own folder but the core, Obsidian and the registry', () => {
    const allowed = [/^obsidian$/, /^\.\/\w+$/, /^\.\.\/\.\.\/core\/(schemes|devicePrefs)$/, /^\.\.\/registry$/];
    for (const name of files) {
      for (const target of importsOf(codeOf(name))) {
        expect(allowed.some((pattern) => pattern.test(target)), `${name} imports ${target}`).toBe(true);
      }
    }
    // The palettes and the maths know nothing of Obsidian, of the screen or of each other's folders.
    for (const name of coreFiles) {
      for (const target of importsOf(coreCodeOf(name))) expect(target, `${name} imports ${target}`).toMatch(/^\.\/\w+$/);
    }
  });

  it('writes the colours of the schemes in one place: the palettes, and nowhere in the screens', () => {
    for (const name of files) expect(COLOUR.test(codeOf(name)), name).toBe(false);
    expect(COLOUR.test(coreCodeOf('palettes.ts'))).toBe(true);
    // The maths has one colour of its own, for when it is handed no ink at all.
    expect(coreCodeOf('colour.ts').match(/'#[0-9a-f]{6}'/g)).toEqual(["'#000000'"]);
    // What is worked out from a palette uses pure white and pure black, and no other colour of its own.
    expect([...new Set(coreCodeOf('variables.ts').match(/'#[0-9a-f]{6}'/g))].sort()).toEqual(["'#000000'", "'#ffffff'"]);
  });

  it('touches the page in one file, through class names and CSS variables only', () => {
    // The body's classes and variables are written in wearer.ts and nowhere else.
    for (const name of files) {
      const code = codeOf(name);
      const writesVariables = /\b(setProperty|removeProperty|getPropertyValue)\b/.test(code);
      expect(writesVariables, name).toBe(name === 'wearer.ts');
      // Never the whole list of classes or the whole style at once: that would take away what is not the plugin's.
      expect(/\b(className|classList|cssText|removeAttribute|setAttribute)\b/.test(code), name).toBe(false);
      expect(/setAttr\(\s*['"](class|style)['"]/.test(code), name).toBe(false);
      expect(/\.body\b/.test(code), name).toBe(name === 'index.ts');
    }
    expect((codeOf('index.ts').match(/\.body\b/g) ?? []).length).toBe(1);
    // Every class it can put on the body is the plugin's own, and so is every variable it adds of its own.
    for (const name of SCHEME_CLASSES) expect(name.startsWith('spellbook-scheme'), name).toBe(true);
    const own = SCHEME_VARIABLE_NAMES.filter((name) => name.startsWith('--spellbook-'));
    expect(own).toEqual(['page', 'panel', 'raised', 'border', 'ink', 'muted', 'faint', 'accent'].map((slot) => `--spellbook-scheme-${slot}`));
  });

  it('never watches the page, and runs every timer on the clock it is handed', () => {
    // Watching the body while writing to it is how a plugin freezes the app.
    const watching = /\b(MutationObserver|ResizeObserver|IntersectionObserver)\b/;
    const ownTimer = /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/;
    for (const name of files) {
      expect(watching.test(codeOf(name)), name).toBe(false);
      expect(ownTimer.test(codeOf(name)), name).toBe(false);
    }
    expect(watching.test('new MutationObserver(f)')).toBe(true);
    expect(ownTimer.test('window.setTimeout(f, 1);')).toBe(true);
  });

  it('sets no font anywhere: the letters, Hebrew or English, stay as Obsidian and the theme draw them', () => {
    const font = /font-family|fontFamily|--font-(text|interface|monospace|default)|@font-face/;
    for (const name of files) expect(font.test(codeOf(name)), name).toBe(false);
    for (const name of coreFiles) expect(font.test(coreCodeOf(name)), name).toBe(false);
    expect(font.test(readFileSync(cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))).toBe(false);
    expect(font.test('font-family: serif;')).toBe(true);
  });

  it('keeps the choice on the device, under one key, and nowhere near the vault or the synced data', () => {
    expect(SCHEME_KEY).toBe('spellbook-colour-scheme');
    for (const name of files) {
      const code = codeOf(name);
      expect(/\.\s*(saveData|loadData)\s*\(/.test(code), name).toBe(false);
      expect(/\b(loadLocalStorage|saveLocalStorage|localStorage)\b/.test(code), name).toBe(false);
      expect(/\b(store|vault)\s*\.\s*\w+\s*\(/.test(code), name).toBe(false);
      expect(/\bstorage\s*\.\s*(load|save)\s*\(/.test(code), name).toBe(name === 'keeper.ts');
    }
    const keeper = codeOf('keeper.ts');
    expect([...keeper.matchAll(/storage\.(?:load|save)\((\w+)/g)].map((match) => match[1])).toEqual(['SCHEME_KEY', 'SCHEME_KEY']);
  });

  it('uses no regular-expression lookbehind, no Node or Electron, and no network', () => {
    const sources = [...files.map((name) => path.join(featureDir, name)), ...coreFiles.map((name) => path.join(coreDir, name))];
    expect(sources.length).toBe(10);
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(/\(\?<[=!]/.test(text), file).toBe(false);
      const code = strip(text);
      expect(/from\s+['"](node:[^'"]+|fs|path|os|child_process|electron|http|https|net|crypto)['"]/.test(code), file).toBe(false);
      expect(/\brequire\s*\(/.test(code), file).toBe(false);
      expect(/\b(fetch|XMLHttpRequest|WebSocket|requestUrl|sendBeacon)\b/.test(code), file).toBe(false);
      expect(/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/.test(code), file).toBe(false);
    }
  });

  it('gives every class it makes the plugin\'s prefix', () => {
    for (const name of files) {
      const code = codeOf(name);
      const classLists = [...code.matchAll(/\bcls:\s*'([^']*)'/g)].map((match) => match[1] ?? '');
      const added = [...code.matchAll(/\baddClass\(\s*'([^']*)'/g)].map((match) => match[1] ?? '');
      for (const cls of [...classLists, ...added].flatMap((list) => list.split(/\s+/))) {
        expect(cls.startsWith('spellbook-scheme'), `${name}: class "${cls}"`).toBe(true);
      }
    }
  });

  it('paints the eight colours the other screens name their labels, statuses and lanes by', () => {
    // The corkboard, the outliner, the planner and the timeline take a
    // colour by Obsidian's variable for it; a scheme sets every one of them.
    expect([...NAMED_COLOURS]).toEqual([...CARD_COLORS]);
    for (const colour of CARD_COLORS) {
      expect(SCHEME_VARIABLE_NAMES, colour).toContain(colorVariable(colour));
      expect(SCHEME_VARIABLE_NAMES, colour).toContain(`${colorVariable(colour)}-rgb`);
    }
  });

  it('sets every colour variable that Spellbook\'s own screens read', () => {
    // Read from the stylesheets of the other screens: whatever colour of
    // Obsidian's they use, a scheme sets it itself or sets what Obsidian makes it from.
    const used = new Set<string>();
    for (const name of STYLE_FILES) {
      const css = readFileSync(path.join(stylesDir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of css.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(match[1] ?? '');
    }
    const colours = [...used].filter((name) => /^--(background|text|interactive|color|nav-item-(color|background)|nav-(indentation-guide|collapse-icon)-color|tag-(color|background))/.test(name));
    expect(colours.length).toBeGreaterThan(30);
    // These few are made by Obsidian from what a scheme does set (the accent), so they follow by themselves.
    const follows = new Set(['--tag-color', '--tag-background']);
    const missing = colours.filter((name) => !SCHEME_VARIABLE_NAMES.includes(name) && !follows.has(name));
    expect(missing).toEqual([]);
  });
});

describe('schemes.css', () => {
  const css = readFileSync(cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
    body: match[2] ?? '',
  }));

  it('is one of the parts of the stylesheet, and can be joined to the others', () => {
    expect(STYLE_FILES).toContain('schemes.css');
    expect(STYLES_DIR).toBe('src/styles');
    const joined = joinStyles([{ name: 'schemes.css', text: readFileSync(cssFile, 'utf8') }]);
    expect(joined).toContain('/* ===== src/styles/schemes.css ===== */');
    expect(rules.length).toBeGreaterThan(8);
  });

  it('holds no colour of any scheme: every colour in it comes from a variable', () => {
    for (const rule of rules) expect(COLOUR.test(rule.body), rule.selectors.join(', ')).toBe(false);
    for (const scheme of SCHEMES) {
      for (const colour of [scheme.page, scheme.panel, scheme.ink, scheme.accent]) expect(css.includes(colour), scheme.id).toBe(false);
    }
  });

  it('only styles what the plugin itself marked, and sets no variable of Obsidian\'s', () => {
    for (const rule of rules) {
      for (const selector of rule.selectors) expect(selector.startsWith('.spellbook-scheme'), selector).toBe(true);
      const declared = [...rule.body.matchAll(/(?:^|[;\s])(--[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1] ?? '');
      for (const name of declared) expect(name.startsWith('--spellbook-'), name).toBe(true);
    }
  });

  it('tells the browser whether the page is light or dark while a scheme is on, and only then', () => {
    const told = rules.filter((rule) => /color-scheme\s*:/.test(rule.body));
    expect(told.map((rule) => [rule.selectors, rule.body.trim()])).toEqual([
      [['.spellbook-scheme-light'], 'color-scheme: light;'],
      [['.spellbook-scheme-dark'], 'color-scheme: dark;'],
    ]);
  });

  it('forces nothing, moves nothing, and names no side by its physical name', () => {
    expect(/!important/.test(css)).toBe(false);
    expect(/:has\(/.test(css)).toBe(false);
    expect(/\b(transition|animation)\s*:/.test(css)).toBe(false);
    for (const rule of rules) {
      expect(/\b(left|right)\b/.test(rule.body), rule.selectors.join(', ')).toBe(false);
      expect(/(^|[;\s])direction\s*:|unicode-bidi\s*:/.test(rule.body), rule.selectors.join(', ')).toBe(false);
      // Nothing is shown or hidden by pointing at it.
      expect(rule.selectors.some((selector) => selector.includes(':hover')), rule.selectors.join(', ')).toBe(false);
    }
  });

  it('has a rule for every class the code puts on a picture, a row of the picker or a row of the settings', () => {
    const made = new Set<string>();
    for (const name of files) {
      for (const match of codeOf(name).matchAll(/'(spellbook-scheme-(?:swatch|option|row)[\w-]*)'/g)) made.add(match[1] ?? '');
    }
    expect(made.size).toBeGreaterThanOrEqual(10);
    // The two that only mark something for a rule that names another class next to them, or for a test.
    const unstyled = new Set(['spellbook-scheme-option-current']);
    for (const cls of made) {
      if (unstyled.has(cls)) continue;
      expect(rules.some((rule) => rule.selectors.some((selector) => selector.includes(`.${cls}`))), cls).toBe(true);
    }
  });
});
