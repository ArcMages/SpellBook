// Rules about the writing modes' own source and stylesheet, checked by
// reading the files. They keep the promises of the design: the modes change
// no note and nothing in the project, the page is only ever marked with the
// plugin's own names, and the stylesheet hides Obsidian's interface from one
// place, without animation.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STYLE_FILES } from '../../../scripts/styles.mjs';
import { MODES, MODES_SERVICE, MODE_IDS } from '../../../src/core/modes/index';
import * as chrome from '../../../src/features/modes/chrome';
import { COVER_BOTTOM_CLASS, COVER_CLASS, COVER_TOP_CLASS } from '../../../src/features/modes/editorFrame';
import { modesFeature } from '../../../src/features/modes/index';
import { MODES_ON_KEY, MODES_SETTINGS_KEY } from '../../../src/features/modes/prefs';
import { FEATURES } from '../../../src/features/registry';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const featureDir = path.join(root, 'src', 'features', 'modes');
const coreDir = path.join(root, 'src', 'core', 'modes');
const cssFile = path.join(root, 'src', 'styles', 'modes.css');

const files = readdirSync(featureDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();

/** Source text with comments removed, so a rule can be explained in a comment without breaking it. */
function strip(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

const codeOf = (name: string): string => strip(readFileSync(path.join(featureDir, name), 'utf8'));

function importsOf(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

describe('the source of the writing modes', () => {
  it('is made of the expected files', () => {
    expect(files).toEqual(['chrome.ts', 'controller.ts', 'editorFrame.ts', 'extensions.ts', 'hemingwayGuard.ts', 'index.ts', 'prefs.ts', 'settings.ts']);
    expect(readdirSync(coreDir).sort()).toEqual(['frame.ts', 'hemingway.ts', 'index.ts', 'modes.ts', 'services.ts', 'settings.ts']);
  });

  it('exports the feature as "modesFeature", listed once, with the agreed commands and service name', () => {
    expect(modesFeature.id).toBe('modes');
    expect(FEATURES.filter((feature) => feature.id === 'modes')).toEqual([modesFeature]);
    expect(MODE_IDS.map((id) => MODES[id].command.id)).toEqual([
      'toggle-zen-mode',
      'toggle-letter-box-mode',
      'toggle-typewriter-mode',
      'toggle-hemingway-mode',
    ]);
    expect(MODES_SERVICE).toBe('modes.state');
    expect(STYLE_FILES).toContain('modes.css');
  });

  it('reaches nothing outside its own folder but the core, the shared icons, the registry, Obsidian and the editor', () => {
    const allowed = [/^obsidian$/, /^@codemirror\/(state|view)$/, /^\.\/\w+$/, /^\.\.\/\.\.\/core\/(modes\/index|devicePrefs)$/, /^\.\.\/\.\.\/ui\/icons$/, /^\.\.\/registry$/];
    for (const name of files) {
      for (const target of importsOf(codeOf(name))) {
        expect(allowed.some((pattern) => pattern.test(target)), `${name} imports ${target}`).toBe(true);
      }
    }
    // The editor's own packages are only used where an editor is extended.
    expect(files.filter((name) => importsOf(codeOf(name)).some((target) => /^@codemirror\/view$/.test(target)))).toEqual(['extensions.ts', 'hemingwayGuard.ts']);
  });

  it('never touches a note, a project or the vault: the modes only look at the screen', () => {
    for (const name of files) {
      const code = codeOf(name);
      expect(/\b(store|vault|wordCounts)\b\s*[.?]/.test(code), name).toBe(false);
      expect(/\b(ProjectStore|VaultPort|TFile|openNote)\b/.test(code), name).toBe(false);
    }
  });

  it('never changes the text or the selection of an editor, and scrolls it in one place only', () => {
    for (const name of files) {
      const code = codeOf(name);
      expect(/\.\s*dispatch\s*\(|\bchanges\s*:|replaceRange|replaceSelection|setSelection|setCursor/.test(code), name).toBe(false);
      expect(/\.scrollTop\s*=[^=]/.test(code), name).toBe(name === 'editorFrame.ts');
      expect(/requestMeasure|scrollIntoView/.test(code), name).toBe(false);
    }
    expect((codeOf('editorFrame.ts').match(/\.scrollTop\s*=[^=]/g) ?? []).length).toBe(1);
  });

  it('uses the clock it is handed, never a timer of its own', () => {
    for (const name of files) {
      expect(/\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/.test(codeOf(name)), name).toBe(false);
    }
  });

  it('marks the page and the device with the plugin\'s own names only', () => {
    const classes = [
      ...chrome.BODY_CLASSES,
      chrome.CORNER_CLASS,
      chrome.CORNER_BUTTON_CLASS,
      chrome.EXIT_CLASS,
      chrome.LOCK_CLASS,
      chrome.FLASH_CLASS,
      chrome.REFUSED_CLASS,
      COVER_CLASS,
      COVER_TOP_CLASS,
      COVER_BOTTOM_CLASS,
    ];
    for (const cls of classes) expect(cls).toMatch(/^spellbook-(zen|modes)(-|$)/);
    expect(new Set(classes).size).toBe(classes.length);
    for (const key of [MODES_ON_KEY, MODES_SETTINGS_KEY]) expect(key).toMatch(/^spellbook-modes-/);
    // Classes are only ever put on, or taken off, by these names: nothing is cleared wholesale.
    for (const name of files) {
      expect(/\bclassName\s*=|classList\s*\.\s*value|removeAttribute\(\s*['"]class|\.cssText\b/.test(codeOf(name)), name).toBe(false);
    }
    // Every class the stylesheet styles is one the code can put somewhere.
    const css = strip(readFileSync(cssFile, 'utf8'));
    const styled = new Set([...css.matchAll(/\.(spellbook-[a-z-]+)/g)].map((match) => match[1] ?? ''));
    for (const cls of styled) expect([...classes, 'spellbook-is-mobile'], cls).toContain(cls);
  });
});

describe('the stylesheet of the writing modes', () => {
  const css = readFileSync(cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
    body: match[2] ?? '',
  }));

  it('hides Obsidian\'s interface only under the class Zen puts on the page, and takes it out of the layout rather than making it see-through', () => {
    const hiding = rules.filter((rule) => /display:\s*none/.test(rule.body));
    expect(hiding.length).toBe(3);
    for (const rule of hiding) {
      expect(rule.body.trim()).toBe('display: none;');
      for (const selector of rule.selectors) expect(selector).toMatch(/^\.spellbook-zen(-no-properties|-no-title)? \./);
    }
    const hidden = hiding.flatMap((rule) => rule.selectors).join('\n');
    for (const part of ['.workspace-ribbon', '.status-bar', '.mobile-navbar', '.view-header', '.workspace-tab-header-container', '.metadata-container', '.inline-title']) {
      expect(hidden, part).toContain(part);
    }
    // The bar above a phone's keyboard, the editor and the text itself are never hidden.
    expect(hidden).not.toMatch(/mobile-toolbar|cm-|markdown-(source|reading|preview)-view(?! )|\.view-content/);
  });

  it('animates nothing: on an iPhone or iPad that would disturb the keyboard', () => {
    expect(css).not.toMatch(/\b(transition|animation|@keyframes|will-change)\b/);
    expect(css).not.toMatch(/:hover/);
  });

  it('lets a tap go through whatever it lays over the text', () => {
    for (const cls of [COVER_CLASS, chrome.REFUSED_CLASS]) {
      const rule = rules.find((candidate) => candidate.selectors.includes(`.${cls}`));
      expect(rule?.body, cls).toMatch(/pointer-events:\s*none/);
      expect(rule?.body, cls).toMatch(/position:\s*absolute/); // inside its editor, not over the whole window
    }
  });

  it('keeps the corner buttons clear of a phone\'s notch and big enough for a finger', () => {
    const corner = rules.find((rule) => rule.selectors.includes(`.${chrome.CORNER_CLASS}`));
    expect(corner?.body).toMatch(/position:\s*fixed/);
    expect(corner?.body).toMatch(/inset-block-start:[^;]*var\(--safe-area-inset-top, 0px\)/);
    expect(corner?.body).toMatch(/inset-inline-end:/);
    const finger = rules.find((rule) => /min-height:\s*var\(--spellbook-touch-target\)/.test(rule.body));
    expect(finger?.selectors).toEqual([`.${chrome.CORNER_CLASS}.spellbook-is-mobile .${chrome.CORNER_BUTTON_CLASS}`]);
    expect(finger?.body).toMatch(/min-width:\s*var\(--spellbook-touch-target\)/);
  });
});
