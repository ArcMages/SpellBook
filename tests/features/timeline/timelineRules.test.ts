// Rules about the timeline's own source and stylesheet, checked by reading
// the files. They are the rules of tests/sourceRules.test.ts for styles.css,
// applied to src/styles/timeline.css, the promise that the screen reaches the
// project only through its host, and the promise that the host (the wiring)
// changes the project only through the store.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LANE_COLORS } from '../../../src/core/timeline';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', '..', 'src');
const folder = path.join(src, 'features', 'timeline');
const files = readdirSync(folder).filter((name) => name.endsWith('.ts'));
const read = (name: string): string => readFileSync(path.join(folder, name), 'utf8');
/** Source text with its comments taken out. */
const codeOf = (name: string): string =>
  read(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');

/**
 * The files that plug the screen into the plugin: the feature itself, the
 * host it gives the screen, and what the device remembers for it. Every
 * other file is the screen, which knows nothing of the plugin but its host.
 */
const WIRING = ['hiddenLanes.ts', 'index.ts', 'timelineWiring.ts'];
const screenFiles = files.filter((name) => !WIRING.includes(name));
const importsOf = (name: string): string[] => [...read(name).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

describe('the timeline screen source', () => {
  it('has its files: the screen, and the three that plug it into the plugin', () => {
    expect([...files].sort()).toEqual([
      'eventModal.ts',
      'hiddenLanes.ts',
      'index.ts',
      'lanesModal.ts',
      'timelineActions.ts',
      'timelineGestures.ts',
      'timelineHost.ts',
      'timelineMenus.ts',
      'timelineScene.ts',
      'timelineView.ts',
      'timelineWiring.ts',
    ]);
    expect(screenFiles).toHaveLength(8);
  });

  it('reaches the project only through its host: no store, no vault, no session', () => {
    let imports = 0;
    for (const name of screenFiles) {
      for (const target of importsOf(name)) {
        imports++;
        expect(/projectStore|projectSession|vaultPort|devicePrefs|wordCount|registry|\/obsidian\/|\/views\/|main$/.test(target), `${name} imports ${target}`).toBe(false);
        // Nor does the screen know who its host is.
        expect(/\.\/(index|timelineWiring|hiddenLanes)$/.test(target), `${name} imports ${target}`).toBe(false);
      }
      expect(/\b(processFrontMatter|trashFile|getMarkdownFiles|getFileCache|metadataCache|fileManager)\b/.test(codeOf(name)), name).toBe(false);
    }
    expect(imports).toBeGreaterThan(20);
  });

  it('is plugged in by a host that changes the project only through the store', () => {
    // The host is handed the vault doorway to listen with. It never writes
    // through it, never reads a note's text, and never reaches for Obsidian's
    // own vault: every change is an intent of the project store.
    const doorway = /\.\s*(updateFrontmatter|updateText|createFile|createFolder|rename|trash|readText|readFrontmatter)\s*\(/;
    const obsidianOwn = /\b(processFrontMatter|trashFile|renameFile|getMarkdownFiles|getFileCache|metadataCache|fileManager)\b/;
    for (const name of WIRING) {
      expect(doorway.test(codeOf(name)), name).toBe(false);
      expect(obsidianOwn.test(codeOf(name)), name).toBe(false);
      expect(/\bvault\s*\.\s*(?!on\b)\w+\s*\(/.test(codeOf(name)), `${name} uses the vault for more than listening`).toBe(false);
      for (const target of importsOf(name)) {
        expect(/projectSession|\/obsidian\/|\/views\/|main$/.test(target), `${name} imports ${target}`).toBe(false);
      }
    }
    const wiring = codeOf('timelineWiring.ts');
    for (const intent of ['updateNoteProperties', 'updateProjectData', 'addTimelineNote']) {
      expect(wiring, intent).toMatch(new RegExp(`store\\s*\\.\\s*${intent}\\(`));
    }
    expect(wiring).toMatch(/vault\s*\.\s*on\(/);
    // What one device hides is kept on that device, in a file that knows nothing else.
    expect(importsOf('hiddenLanes.ts')).toEqual(['../../core/devicePrefs']);
    expect(codeOf('timelineWiring.ts')).not.toMatch(/storage\s*\.\s*(load|save)\(/);
    // The rules would catch a slip.
    expect(doorway.test('await context.vault.updateFrontmatter(path, change);')).toBe(true);
    expect(/\bvault\s*\.\s*(?!on\b)\w+\s*\(/.test('context.vault.listFiles(folder)')).toBe(true);
    expect(/\bvault\s*\.\s*(?!on\b)\w+\s*\(/.test('context.vault.on((event) => {})')).toBe(false);
  });

  it('keeps the layout and the scene free of Obsidian and of the page', () => {
    for (const name of ['timelineScene.ts', 'timelineHost.ts', 'timelineGestures.ts']) {
      const code = codeOf(name);
      expect(/from\s+['"]obsidian['"]/.test(code.replace(/import type [^;]+;/g, '')), name).toBe(false);
      expect(/\b(createEl|createDiv|createSpan)\b/.test(code), name).toBe(false);
    }
  });

  it('never puts text on the page as HTML, and runs on the host\'s timers alone', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['HTML from text', /\b(innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment)\b/],
      ['a timer of its own', /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/],
      ['the global page or window', /(^|[^.\w])(document|window)\s*\./m],
      ['regular-expression lookbehind', /\(\?<[=!]/],
      ['scrollIntoView', /\.\s*scrollIntoView\s*\(/],
    ];
    for (const name of files) {
      for (const [what, pattern] of forbidden) expect(pattern.test(codeOf(name)), `${name} must not use ${what}`).toBe(false);
    }
    expect(forbidden[2]?.[1].test('const x = document.body;')).toBe(true);
    expect(forbidden[2]?.[1].test('const x = el.ownerDocument.defaultView;')).toBe(false);
  });

  it('is written in plain ASCII', () => {
    for (const name of files) {
      const odd = [...read(name)].filter((character) => {
        const code = character.codePointAt(0) as number;
        return code > 0x7e || (code < 0x20 && code !== 0x0a);
      });
      expect(odd, name).toEqual([]);
    }
  });

  it('gives every class it puts on the page the plugin\'s prefix, or one of Obsidian\'s own', () => {
    const obsidianOwn = new Set(['is-active', 'is-collapsed', 'clickable-icon', 'mod-cta']);
    let seen = 0;
    for (const name of files) {
      for (const match of codeOf(name).matchAll(/(?:cls:\s*|Class\()\s*(\[[^\]]*\]|'[^']*')/g)) {
        for (const quoted of (match[1] ?? '').matchAll(/'([^']+)'/g)) {
          for (const cls of (quoted[1] ?? '').split(' ')) {
            seen++;
            expect(cls.startsWith('spellbook-') || obsidianOwn.has(cls), `${name}: ${cls}`).toBe(true);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(40);
  });
});

describe('src/styles/timeline.css', () => {
  const raw = readFileSync(path.join(src, 'styles', 'timeline.css'), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
    body: match[2] ?? '',
  }));
  const bodyOf = (selector: string): string => rules.find((rule) => rule.selectors.includes(selector))?.body ?? '';

  it('only styles things inside elements the plugin itself marked', () => {
    expect(rules.length).toBeGreaterThan(60);
    for (const rule of rules) {
      for (const selector of rule.selectors) expect(selector.startsWith('.spellbook-'), selector).toBe(true);
    }
  });

  it('takes its colours from the theme, never from fixed values', () => {
    for (const rule of rules) {
      expect(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test(rule.body), rule.selectors.join(', ')).toBe(false);
    }
  });

  it('maps each of the eight colour names to Obsidian\'s own colour', () => {
    for (const color of LANE_COLORS) {
      expect(bodyOf(`.spellbook-color-${color}`).trim()).toBe(`--spellbook-lane-color: var(--color-${color});`);
    }
  });

  it('names sides "start" and "end", never by their physical names, and sets no direction', () => {
    for (const rule of rules) {
      const where = `${rule.selectors.join(', ')} { ${rule.body.trim()} }`;
      expect(/\b(left|right)\b/.test(rule.body), where).toBe(false);
      expect(/(^|[;\s])direction\s*:|unicode-bidi\s*:/.test(rule.body), where).toBe(false);
      // Sizes and offsets that would not mirror.
      expect(/(^|[;\s])(margin|padding|border|inset)-(top|bottom)\b/.test(rule.body), where).toBe(false);
    }
  });

  it('gives its own variables the plugin\'s prefix', () => {
    const declared = rules.flatMap((rule) => [...rule.body.matchAll(/(?:^|[;\s])(--[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ''));
    expect(declared.length).toBeGreaterThan(8);
    for (const name of declared) expect(name.startsWith('--spellbook-'), name).toBe(true);
    // ...and leaves the binder's own variables and its checked rules alone.
    expect(css).not.toMatch(/--spellbook-touch-target|--spellbook-phone-bar-room/);
    expect(css).not.toMatch(/min-height:\s*var\(/);
  });

  it('makes everything that is tapped big enough for a finger on a touch screen', () => {
    expect(css).toMatch(/--spellbook-timeline-target:\s*44px/);
    const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? '';
    for (const cls of [
      'spellbook-timeline-button',
      'spellbook-timeline-lane-tab',
      'spellbook-timeline-undated-toggle',
      'spellbook-timeline-set-date',
      'spellbook-timeline-card-more',
      'spellbook-timeline-lane-toggle',
      'spellbook-timeline-lane-more',
    ]) {
      expect(coarse, cls).toContain(`.${cls}`);
    }
    expect(coarse).toMatch(/min-block-size:\s*var\(--spellbook-timeline-target\)/);
    expect(coarse).toMatch(/min-inline-size:\s*var\(--spellbook-timeline-target\)/);
    // The same for phones and tablets, by Obsidian's own platform check.
    expect(bodyOf('.spellbook-timeline.spellbook-is-mobile .spellbook-timeline-button')).toMatch(/min-block-size/);
  });

  it('never hides or reveals anything on hover, and makes nothing invisible', () => {
    for (const rule of rules) {
      const where = rule.selectors.join(', ');
      if (rule.selectors.some((selector) => selector.includes(':hover'))) {
        expect(/\b(display|visibility|opacity|pointer-events)\s*:/.test(rule.body), where).toBe(false);
      }
      expect(/\b(opacity:\s*0(?![.\d])|visibility:\s*hidden\b)/.test(rule.body), where).toBe(false);
    }
    expect(rules.some((rule) => rule.selectors.some((selector) => selector.includes(':hover')))).toBe(true);
  });

  it('lets the view handle every touch on the timeline, and keeps a resting finger from selecting text', () => {
    const viewport = bodyOf('.spellbook-timeline-viewport');
    expect(viewport).toMatch(/touch-action:\s*none/);
    expect(viewport).toMatch(/overflow:\s*hidden/);
    for (const body of [viewport, bodyOf('.spellbook-timeline-card')]) {
      expect(body).toMatch(/-webkit-touch-callout:\s*none/);
      expect(body).toMatch(/-webkit-user-select:\s*none/);
      expect(body).toMatch(/[^-]user-select:\s*none/);
    }
    expect(bodyOf('.spellbook-timeline-carried')).toMatch(/pointer-events:\s*none/);
  });

  it('cuts the writer\'s text short at its own end, and lines it up at its own start', () => {
    for (const selector of ['.spellbook-timeline-card-title', '.spellbook-timeline-undated-title', '.spellbook-timeline-lane-title']) {
      expect(bodyOf(selector), selector).toMatch(/text-align:\s*start/);
      expect(bodyOf(selector), selector).toMatch(/text-overflow:\s*ellipsis/);
    }
  });

  it('contains no invisible or direction-changing characters', () => {
    const odd = [...raw].filter((character) => {
      const code = character.codePointAt(0) as number;
      return code > 0x7e || (code < 0x20 && code !== 0x0a);
    });
    expect(odd).toEqual([]);
  });
});
