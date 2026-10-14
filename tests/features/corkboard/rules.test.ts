// Rules about the corkboard feature's own source and stylesheet, checked by
// reading the files. They keep the promises of the design: the screens know
// only their host, the writer's text is never treated as a page, and the
// stylesheet follows the same rules as styles.css (and can be joined to it).

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARD_COLORS, colorVariable } from '../../../src/core/cards';
import { CORKBOARD_VIEW_TYPE, CorkboardView } from '../../../src/features/corkboard/corkboardView';
import { INSPECTOR_VIEW_TYPE, InspectorView } from '../../../src/features/corkboard/inspectorView';
import { colorClass } from '../../../src/features/corkboard/parts';
import { SynopsisModal } from '../../../src/features/corkboard/synopsisModal';
import { TagListsModal } from '../../../src/features/corkboard/tagListsModal';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const featureDir = path.join(root, 'src', 'features', 'corkboard');
const cssFile = path.join(root, 'src', 'styles', 'corkboard.css');

const files = readdirSync(featureDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();

/** Source text with comments removed, so a rule can be explained in a comment without breaking it. */
function codeOf(name: string): string {
  return readFileSync(path.join(featureDir, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

/**
 * The files that plug the screens into the plugin: the host on top of the
 * project store, the opening of the panes, the line at the top of the
 * inspector, and the registration. Every other file is a screen (or a piece
 * of one) and knows only its host.
 */
const wiring = ['index.ts', 'panes.ts', 'sceneEntities.ts', 'storeHost.ts', 'summaryLine.ts'];
const screens = files.filter((name) => !wiring.includes(name));

describe('the source of the corkboard feature', () => {
  it('is made of the expected files: the screens, and what plugs them into the plugin', () => {
    expect(files).toEqual([
      'cardElements.ts',
      'corkboardView.ts',
      'dropGap.ts',
      'host.ts',
      'index.ts',
      'inspectorView.ts',
      'panes.ts',
      'parts.ts',
      'sceneEntities.ts',
      'storeHost.ts',
      'summaryLine.ts',
      'synopsisModal.ts',
      'tagListsModal.ts',
    ]);
    expect(screens).toHaveLength(8);
  });

  it('has the agreed view type ids', () => {
    expect(CORKBOARD_VIEW_TYPE).toBe('spellbook-corkboard');
    expect(INSPECTOR_VIEW_TYPE).toBe('spellbook-inspector');
  });

  it("gives no method of a view or a window a name that Obsidian uses for its own work on them", () => {
    // Obsidian opens, closes, loads and lays out views and windows through
    // methods of these names, most of which its type declarations do not
    // list. A method of the plugin's by the same name would quietly replace
    // Obsidian's, and the view would never open.
    const taken = new Set([
      'open', 'close', 'load', 'unload', 'onload', 'onunload', 'show', 'hide', 'register', 'registerEvent',
      'registerDomEvent', 'registerInterval', 'addChild', 'removeChild', 'getEphemeralState', 'setEphemeralState',
      'onPaneMenu', 'onHeaderMenu', 'onTabMenu', 'onMoreOptions', 'addAction', 'updateNavButtons', 'handleDrop',
      'handlePaste', 'handleCopy', 'handleCut', 'setTitle', 'setContent', 'onEscapeKey', 'onWindowClose',
    ]);
    const classes = { CorkboardView, InspectorView, SynopsisModal, TagListsModal };
    for (const [name, made] of Object.entries(classes)) {
      const own = Object.getOwnPropertyNames(made.prototype);
      expect(own.length, name).toBeGreaterThan(3);
      expect(own.filter((member) => taken.has(member)), name).toEqual([]);
    }
    // The fields too: read from the source, since they only exist on a view that was made.
    for (const file of ['corkboardView.ts', 'inspectorView.ts', 'synopsisModal.ts', 'tagListsModal.ts']) {
      const fields = [...codeOf(file).matchAll(/^ {2}private (?:readonly )?(\w+)[:=?! ]/gm)].map((match) => match[1] ?? '');
      expect(fields.length, file).toBeGreaterThan(3);
      const reserved = ['scope', 'app', 'leaf', 'icon', 'navigation', 'containerEl', 'contentEl', 'titleEl', 'modalEl', 'headerEl'];
      expect(fields.filter((field) => taken.has(field) || reserved.includes(field)), file).toEqual([]);
    }
  });

  it('lets the screens know the project only through their host: no store, no vault, no device storage', () => {
    const allowed = [
      /^obsidian$/,
      /^\.\/\w+$/,
      /^\.\.\/\.\.\/core\/cards$/,
      /^\.\.\/\.\.\/core\/(binderModel|dropTarget|names|types)$/,
      // missingNote: the wording of the warning on an entry whose note is missing, shared with the binder.
      /^\.\.\/\.\.\/ui\/(confirmModal|dragDrop|icons|keys|missingNote|notices|safely|textPromptModal)$/,
    ];
    for (const name of screens) {
      const code = codeOf(name);
      for (const target of importsOf(code)) {
        expect(allowed.some((pattern) => pattern.test(target)), `${name} imports ${target}`).toBe(true);
        // A screen never reaches for the files that plug it in.
        expect(wiring.includes(`${target.slice(2)}.ts`), `${name} imports ${target}`).toBe(false);
      }
      expect(/\b(ProjectStore|ProjectSession|VaultPort|WordCountCache|DevicePrefs)\b/.test(code), name).toBe(false);
      expect(/\b(store|vault|storage|wordCounts)\s*\.\s*\w+\s*\(/.test(code), name).toBe(false);
    }
  });

  it('reaches nothing outside its own folder but the core, the shared pieces of screen and the registry', () => {
    // No file of the feature imports the binder's views, the plugin's entry or another feature.
    const allowed = [/^obsidian$/, /^\.\/\w+$/, /^\.\.\/\.\.\/core\/[\w/]+$/, /^\.\.\/\.\.\/ui\/\w+$/, /^\.\.\/registry$/];
    for (const name of files) {
      for (const target of importsOf(codeOf(name))) {
        expect(allowed.some((pattern) => pattern.test(target)), `${name} imports ${target}`).toBe(true);
      }
    }
    // Only what plugs the screens in is handed the plugin's working parts.
    expect(files.filter((name) => importsOf(codeOf(name)).includes('../registry'))).toEqual([
      'index.ts',
      'sceneEntities.ts',
      'storeHost.ts',
      'summaryLine.ts',
    ]);
  });

  it('changes the vault only through the project store, and reads it only through the vault doorway', () => {
    // The host is handed the vault doorway to read notes and to listen. Its
    // writing methods are never called: a change is an intent of the store.
    const doorwayWrites = /\.\s*(updateFrontmatter|updateText|createFile|createFolder|rename|trash)\s*\(/;
    for (const name of files) {
      const code = codeOf(name);
      expect(doorwayWrites.test(code), name).toBe(false);
      // Obsidian's own vault, file manager and index are never touched from here.
      expect(/\bapp\s*\.\s*(vault|fileManager|metadataCache)\b/.test(code), name).toBe(false);
      expect(/\.\s*(processFrontMatter|trashFile|renameFile|getMarkdownFiles|getFileCache)\s*\(/.test(code), name).toBe(false);
      // What one device remembers goes through the storage it is handed, never the synced plugin data.
      expect(/\.\s*(saveData|loadData)\s*\(/.test(code), name).toBe(false);
    }
    expect(doorwayWrites.test('await this.context.vault.updateFrontmatter(path, change);')).toBe(true);
    expect(doorwayWrites.test('submit: (value) => this.rename(kind, tag.name, value),')).toBe(true);

    const host = codeOf('storeHost.ts');
    // The vault doorway: reading a text and listening, nothing else.
    const doorwayCalls = [...host.matchAll(/\bvault\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1] ?? '');
    expect([...new Set(doorwayCalls)].sort()).toEqual(['on', 'readText']);
    // The store: reading, listening, and the intents that change something.
    const storeCalls = [...host.matchAll(/\bstore\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1] ?? '');
    expect([...new Set(storeCalls)].sort()).toEqual([
      'moveNode',
      'onChange',
      'projectData',
      'projectNotes',
      'updateNoteProperties',
      'updateProjectData',
      'vaultPathOf',
    ]);
    // The device's own storage: the card size, and nothing else.
    const storageCalls = [...host.matchAll(/\bstorage\s*\.\s*(\w+)\s*\(\s*(\w+)/g)].map((match) => `${match[1]} ${match[2]}`);
    expect(storageCalls.sort()).toEqual(['load CARD_SIZE_KEY', 'save CARD_SIZE_KEY']);
    // The other files that plug the screens in call none of them.
    for (const name of wiring.filter((file) => file !== 'storeHost.ts')) {
      expect(/\b(vault|storage|wordCounts)\s*\.\s*\w+\s*\(/.test(codeOf(name)), name).toBe(false);
    }
  });

  it("never puts the writer's text on the screen as a page of its own", () => {
    const asPage = /\b(innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|document\s*\.\s*write)\b/;
    for (const name of files) expect(asPage.test(codeOf(name)), name).toBe(false);
    expect(asPage.test("el.innerHTML = '<b>x</b>';")).toBe(true);
  });

  it('runs every timer on the clock its host hands it, so that closing leaves none behind', () => {
    const ownTimer = /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/;
    for (const name of files) expect(ownTimer.test(codeOf(name)), name).toBe(false);
    expect(ownTimer.test('window.setTimeout(f, 1);')).toBe(true);
  });

  it('uses no regular-expression lookbehind, no Node or Electron, and no network', () => {
    for (const name of files) {
      const text = readFileSync(path.join(featureDir, name), 'utf8');
      expect(/\(\?<[=!]/.test(text), name).toBe(false);
      const code = codeOf(name);
      expect(/from\s+['"](node:[^'"]+|fs|path|os|child_process|electron|http|https|net|crypto)['"]/.test(code), name).toBe(false);
      expect(/\brequire\s*\(/.test(code), name).toBe(false);
      expect(/\b(fetch|XMLHttpRequest|WebSocket|requestUrl|sendBeacon)\b/.test(code), name).toBe(false);
    }
  });

  it('names sides "start" and "end" in what it sets from code, and gives every class the plugin\'s prefix', () => {
    for (const name of files) {
      const code = codeOf(name);
      expect(/\.style\s*\.\s*(left|right|marginLeft|marginRight|paddingLeft|paddingRight)\b/.test(code), name).toBe(false);
      // Classes of the plugin's own; Obsidian's are used next to them so that themes apply.
      const obsidianOwn = new Set(['clickable-icon', 'dropdown', 'checkbox-container', 'is-enabled', 'is-disabled']);
      const classLists = [...code.matchAll(/\bcls:\s*(?:'([^']*)'|`([^`]*)`)/g)].map((match) => match[1] ?? match[2] ?? '');
      // Some files put nothing on the screen themselves: the host interface, the hit-test, and three of the files that plug the screens in.
      const drawsNothing = ['host.ts', 'dropGap.ts', 'index.ts', 'panes.ts', 'storeHost.ts'];
      expect(classLists.length + (drawsNothing.includes(name) ? 1 : 0), name).toBeGreaterThan(0);
      for (const list of classLists) {
        // (What a class list takes in from a variable is checked where the variable is given.)
        for (const cls of list.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
          if (cls === '' || obsidianOwn.has(cls)) continue;
          expect(cls.startsWith('spellbook-'), `${name}: class "${cls}"`).toBe(true);
        }
      }
    }
  });
});

describe('corkboard.css', () => {
  const raw = readFileSync(cssFile, 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
    body: match[2] ?? '',
  }));
  const ruleFor = (selector: string): string | undefined =>
    rules.find((candidate) => candidate.selectors.includes(selector))?.body;
  /** What stands inside every "@media (query)" block of the file, joined. */
  const media = (query: string): string => {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    return [...css.matchAll(new RegExp(`@media\\s*${escaped}\\s*\\{([\\s\\S]*?\\})\\s*\\}`, 'g'))]
      .map((match) => match[1] ?? '')
      .join('\n');
  };

  it('only styles things the plugin itself marked', () => {
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

  it('maps each of the eight colour names to Obsidian\'s own colour of that name', () => {
    for (const color of CARD_COLORS) {
      const body = ruleFor(`.${colorClass(color)}`);
      expect(body, color).toMatch(new RegExp(`--spellbook-tag-color:\\s*var\\(${colorVariable(color)}\\)`));
    }
    // No colour is a colour of its own, so that it is not taken from what is around it.
    expect(ruleFor('.spellbook-no-color')).toMatch(/--spellbook-tag-color:/);
    expect(rules.filter((rule) => rule.selectors.some((selector) => /^\.spellbook-color-\w+$/.test(selector)))).toHaveLength(
      CARD_COLORS.length,
    );
  });

  it('names sides "start" and "end", never left and right, and sets no direction of its own', () => {
    for (const rule of rules) {
      const where = `${rule.selectors.join(', ')} { ${rule.body.trim()} }`;
      expect(/\b(left|right)\b/.test(rule.body), where).toBe(false);
      expect(/(^|[;\s])direction\s*:|unicode-bidi\s*:/.test(rule.body), where).toBe(false);
    }
  });

  it("gives its own variables the plugin's prefix", () => {
    const declared = rules.flatMap((rule) => [...rule.body.matchAll(/(?:^|[;\s])(--[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ''));
    expect(declared.length).toBeGreaterThan(10);
    for (const name of declared) expect(name.startsWith('--spellbook-'), name).toBe(true);
  });

  it('never hides or reveals anything on hover, and makes nothing invisible', () => {
    for (const rule of rules) {
      const where = rule.selectors.join(', ');
      if (rule.selectors.some((selector) => selector.includes(':hover'))) {
        expect(/\b(display|visibility|opacity|pointer-events)\s*:/.test(rule.body), where).toBe(false);
      }
      expect(/\b(opacity:\s*0(?![.\d])|visibility:\s*hidden\b)/.test(rule.body), where).toBe(false);
    }
    // Every rule that answers to hover is for a pointer that can hover.
    const hoverRules = rules.filter((rule) => rule.selectors.some((selector) => selector.includes(':hover')));
    expect(hoverRules.length).toBeGreaterThan(0);
    for (const rule of hoverRules) expect(media('(hover: hover)').includes(rule.body), rule.selectors.join(', ')).toBe(true);
  });

  it('makes what is tapped at least 44px on touch screens, and only there', () => {
    for (const part of ['board', 'inspector', 'tags']) {
      expect(css, part).toMatch(new RegExp(`--spellbook-${part}-touch:\\s*44px`));
    }
    const touchRules = rules.filter((rule) => /min-(height|width):\s*var\(--spellbook-\w+-touch\)/.test(rule.body));
    expect(touchRules.length).toBeGreaterThanOrEqual(6);
    const coarse = media('(pointer: coarse)');
    for (const rule of touchRules) {
      const byClass = rule.selectors.every((selector) => selector.includes('.spellbook-is-mobile'));
      expect(byClass || coarse.includes(rule.body), rule.selectors.join(', ')).toBe(true);
    }
    // The buttons that matter, on any touch screen: the "more" of a card, the steps of the trail, the rows of the lists.
    for (const selector of [
      '.spellbook-board .spellbook-card-more',
      '.spellbook-board .spellbook-crumb',
      '.spellbook-board .spellbook-board-size',
      '.spellbook-inspector .spellbook-field-input',
      '.spellbook-tags .spellbook-tag-button',
      '.spellbook-tags .spellbook-tag-color',
    ]) {
      expect(coarse, selector).toContain(selector);
    }
  });

  it('leaves room under the last card and the last field for the bar that floats over the bottom of a phone', () => {
    for (const part of ['board', 'inspector']) {
      const body = ruleFor(`.spellbook-${part}.spellbook-is-phone .spellbook-${part}-scroll`);
      expect(body, part).toMatch(/padding-block-end:/);
      expect(body, part).toMatch(/var\(--mobile-navbar-height, 0px\)/);
      expect(body, part).toMatch(/var\(--safe-area-inset-bottom, 0px\)/);
      expect(body, part).toMatch(new RegExp(`max\\([^;]*var\\(--spellbook-${part}-bar-room\\)`));
      expect(css, part).toMatch(new RegExp(`--spellbook-${part}-bar-room:\\s*80px`));
    }
  });

  it("keeps a finger that rests on a card from selecting its text or raising the phone's own bubble", () => {
    const card = ruleFor('.spellbook-board .spellbook-card');
    expect(card).toMatch(/-webkit-touch-callout:\s*none/);
    expect(card).toMatch(/-webkit-user-select:\s*none/);
    expect(card).toMatch(/[^-]user-select:\s*none/);
  });

  it('shows one column until the board was measured, and lets the code set the columns', () => {
    const grid = ruleFor('.spellbook-board-grid');
    expect(grid).toMatch(/display:\s*grid/);
    expect(grid).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).not.toMatch(/auto-fill|auto-fit/);
  });

  it('shows a derived synopsis in a quieter colour, and the label as the starting edge of the card', () => {
    expect(ruleFor('.spellbook-board .spellbook-card-synopsis.spellbook-is-derived')).toMatch(/color:\s*var\(--text-faint\)/);
    expect(ruleFor('.spellbook-board .spellbook-card.spellbook-has-label')).toMatch(
      /border-inline-start-color:\s*var\(--spellbook-tag-color\)/,
    );
    expect(ruleFor('.spellbook-board .spellbook-card-status')).toMatch(/var\(--spellbook-tag-color\)/);
  });

  it('ends with the rule that keeps things out of sight, so that it outweighs what lays them out', () => {
    const last = rules[rules.length - 1];
    expect(last?.selectors).toEqual(['.spellbook-is-off.spellbook-is-off.spellbook-is-off']);
    expect(last?.body).toMatch(/display:\s*none/);
  });

  it('can be joined to styles.css without upsetting the rules that file is held to', () => {
    // styles.css is checked for exactly one use of these two, in the binder.
    expect(css).not.toMatch(/--spellbook-touch-target/);
    expect(css).not.toMatch(/--spellbook-phone-bar-room/);
    // Its checks split selectors at commas and read rules by their braces.
    for (const rule of rules) {
      for (const selector of rule.selectors) expect(selector, selector).not.toMatch(/[()]\s*$|^\s*$/);
    }
    expect(raw).not.toMatch(/@import|url\(/);
    // No class of the binder is styled again here.
    for (const rule of rules) {
      for (const selector of rule.selectors) expect(selector).not.toMatch(/\.spellbook-(binder|row|title|count)\b/);
    }
  });
});
