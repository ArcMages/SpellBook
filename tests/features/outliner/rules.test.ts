// Rules about the outliner's own source and stylesheet, checked by reading
// the files. They keep the promises of the design: the table knows only its
// host, the writer's text is never treated as a page, the shared word counter
// is reached through one file, and the stylesheet follows the same rules as
// styles.css (and can be joined to it).

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STYLES_DIR, STYLE_FILES, joinStyles } from '../../../scripts/styles.mjs';
import { CARD_COLORS, colorVariable } from '../../../src/core/cards';
import { BUILT_IN_COLUMNS, TARGET_BANDS } from '../../../src/core/outliner';
import { columnClass } from '../../../src/features/outliner/cells';
import { OutlinerPane, outlinerFeature } from '../../../src/features/outliner/index';
import { OUTLINER_VIEW_TYPE, OutlinerView } from '../../../src/features/outliner/outlinerView';
import { colorClass } from '../../../src/features/outliner/parts';
import { WORD_COUNT_ASKER } from '../../../src/features/outliner/wordCounts';
import { FEATURES } from '../../../src/features/registry';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const featureDir = path.join(root, 'src', 'features', 'outliner');
const coreDir = path.join(root, 'src', 'core', 'outliner');
const cssFile = path.join(root, 'src', 'styles', 'outliner.css');

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

describe('the source of the outliner', () => {
  it('is made of the expected files', () => {
    expect(files).toEqual(['cells.ts', 'host.ts', 'index.ts', 'outlinerView.ts', 'parts.ts', 'wordCounts.ts']);
    expect(readdirSync(coreDir).sort()).toEqual([
      'columns.ts',
      'filter.ts',
      'index.ts',
      'moves.ts',
      'progress.ts',
      'properties.ts',
      'readTime.ts',
      'rows.ts',
      'sort.ts',
      'tasks.ts',
      'viewPrefs.ts',
    ]);
  });

  it('exports the feature as "outlinerFeature", with the agreed view type', () => {
    expect(outlinerFeature.id).toBe('outliner');
    expect(typeof outlinerFeature.register).toBe('function');
    expect(OUTLINER_VIEW_TYPE).toBe('spellbook-outliner');
    // No other feature of the plugin has the same name.
    expect(FEATURES.filter((feature) => feature.id === outlinerFeature.id && feature !== outlinerFeature)).toEqual([]);
  });

  it('gives no method of the view a name that Obsidian uses for its own work on views', () => {
    // Obsidian opens, closes, loads and lays out views through methods of
    // these names, most of which its type declarations do not list. A method
    // of the plugin's by the same name would quietly replace Obsidian's.
    const taken = new Set([
      'open', 'close', 'load', 'unload', 'onload', 'onunload', 'show', 'hide', 'register', 'registerEvent',
      'registerDomEvent', 'registerInterval', 'addChild', 'removeChild', 'getEphemeralState', 'setEphemeralState',
      'onPaneMenu', 'onHeaderMenu', 'onTabMenu', 'onMoreOptions', 'addAction', 'updateNavButtons', 'handleDrop',
      'handlePaste', 'handleCopy', 'handleCut', 'setTitle', 'setContent', 'onEscapeKey', 'onWindowClose',
    ]);
    for (const [name, made] of Object.entries({ OutlinerView, OutlinerPane })) {
      const own = Object.getOwnPropertyNames(made.prototype);
      expect(own.length, name).toBeGreaterThan(3);
      expect(own.filter((member) => taken.has(member)), name).toEqual([]);
    }
    // The fields too: read from the source, since they only exist on a view that was made.
    const fields = [...codeOf('outlinerView.ts').matchAll(/^ {2}private (?:readonly )?(\w+)[:=?! ]/gm)].map((match) => match[1] ?? '');
    expect(fields.length).toBeGreaterThan(10);
    const reserved = ['scope', 'app', 'leaf', 'icon', 'navigation', 'containerEl', 'contentEl', 'titleEl', 'headerEl', 'actions', 'actionsEl'];
    expect(fields.filter((field) => taken.has(field) || reserved.includes(field))).toEqual([]);
  });

  it('lets the table know the project only through its host: no store, no vault, no device storage', () => {
    const allowed = [
      /^obsidian$/,
      /^\.\/(cells|host|parts)$/,
      /^\.\.\/\.\.\/core\/(cards|outliner)$/,
      /^\.\.\/\.\.\/core\/(binderModel|dropTarget|projectLayout|types)$/,
      /^\.\.\/\.\.\/ui\/(dragDrop|icons|keys|missingNote|notices|ownText|safely)$/,
      // layout: which layout the writer chose for this device (it only reads the choice).
      /^\.\.\/\.\.\/ui\/layout$/,
    ];
    for (const name of ['cells.ts', 'outlinerView.ts', 'parts.ts']) {
      const code = codeOf(name);
      for (const target of importsOf(code)) {
        expect(allowed.some((pattern) => pattern.test(target)), `${name} imports ${target}`).toBe(true);
      }
      expect(/\b(ProjectStore|ProjectSession|VaultPort|WordCountCache|DevicePrefs|FeatureContext)\b/.test(code), name).toBe(false);
      expect(/\b(store|vault|storage|wordCounts)\s*\.\s*\w+\s*\(/.test(code), name).toBe(false);
    }
    // The view takes the host's type only: it makes no host of its own.
    expect(codeOf('outlinerView.ts')).toMatch(/import type \{[^}]*\bOutlinerHost\b[^}]*\} from '\.\/host'/);
    expect(codeOf('outlinerView.ts')).not.toMatch(/new OutlinerHost/);
  });

  it('reaches nothing outside its own folder but the core, the shared pieces of screen and the registry', () => {
    const allowed = [/^obsidian$/, /^\.\/\w+$/, /^\.\.\/\.\.\/core\/[\w/]+$/, /^\.\.\/\.\.\/ui\/\w+$/, /^\.\.\/registry$/];
    for (const name of files) {
      for (const target of importsOf(codeOf(name))) {
        expect(allowed.some((pattern) => pattern.test(target)), `${name} imports ${target}`).toBe(true);
      }
    }
    // Only what plugs the table in is handed the plugin's working parts.
    expect(files.filter((name) => importsOf(codeOf(name)).includes('../registry'))).toEqual(['host.ts', 'index.ts']);
  });

  it('reaches the shared word counter through one small file, and nowhere else', () => {
    // When the cache changes, wordCounts.ts is the one file of the outliner
    // that has to follow.
    for (const name of files) {
      const code = codeOf(name);
      const touches = /wordCountCache|\bWordCountCache\b/.test(code);
      expect(touches, name).toBe(name === 'wordCounts.ts');
      if (name === 'wordCounts.ts') continue;
      // Nobody else calls the cache's own methods; the host hands it on, once, to the doorway.
      expect(/\bwordCounts\s*\.\s*\w+\s*\(/.test(code), name).toBe(false);
    }
    expect((codeOf('host.ts').match(/\.\s*wordCounts\b/g) ?? []).length).toBe(1);
    expect(codeOf('host.ts')).toMatch(/outlinerWordCounts\(context\.wordCounts\)/);
    const doorway = readFileSync(path.join(featureDir, 'wordCounts.ts'), 'utf8');
    expect(doorway.split('\n').length).toBeLessThan(60);
    // What it uses of the cache: it asks and lets go under a name of its own.
    const calls = [...codeOf('wordCounts.ts').matchAll(/\bcache\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1] ?? '');
    expect([...new Set(calls)].sort()).toEqual(['get', 'onChange', 'release', 'track']);
    expect(WORD_COUNT_ASKER).toBe('outliner');
    expect(codeOf('wordCounts.ts')).toMatch(/cache\.track\(WORD_COUNT_ASKER,/);
    expect(codeOf('wordCounts.ts')).toMatch(/cache\.release\(WORD_COUNT_ASKER\)/);
    for (const file of readdirSync(coreDir)) {
      expect(/wordCountCache/.test(strip(readFileSync(path.join(coreDir, file), 'utf8'))), file).toBe(false);
    }
  });

  it('changes the vault only through the project store, and reads it only through the vault doorway', () => {
    const doorwayWrites = /\.\s*(updateFrontmatter|updateText|createFile|createFolder|rename|trash)\s*\(/;
    for (const name of files) {
      const code = codeOf(name);
      expect(doorwayWrites.test(code), name).toBe(false);
      // Obsidian's own vault, file manager and index are never touched from here.
      expect(/\bapp\s*\.\s*(vault|fileManager|metadataCache)\b/.test(code), name).toBe(false);
      expect(/\.\s*(processFrontMatter|trashFile|renameFile|getMarkdownFiles|getFileCache)\s*\(/.test(code), name).toBe(false);
      // What one device remembers goes through the storage it is handed, never the synced plugin data.
      expect(/\.\s*(saveData|loadData)\s*\(/.test(code), name).toBe(false);
      expect(/\b(loadLocalStorage|saveLocalStorage|localStorage)\b/.test(code), name).toBe(false);
    }
    const host = codeOf('host.ts');
    // The vault doorway: reading a text and listening, nothing else.
    const doorwayCalls = [...host.matchAll(/\bvault\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1] ?? '');
    expect([...new Set(doorwayCalls)].sort()).toEqual(['on', 'readText']);
    // The store: reading, listening, and the two intents that change something.
    const storeCalls = [...host.matchAll(/\bstore\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1] ?? '');
    expect([...new Set(storeCalls)].sort()).toEqual([
      'moveNode',
      'onChange',
      'projectData',
      'projectNotes',
      'updateNoteProperties',
      'vaultPathOf',
    ]);
    // Every edit of a scene is checked by the cards engine's inspector patch, in the store's own step.
    expect(host).toMatch(/updateNoteProperties\(\s*path,\s*\(frontmatter\) => \{\s*const onDisk = inspectorPatch\(frontmatter, edits, lists\)/);
    // The device's own storage: the two keys of the outliner, and nothing else.
    expect(host).toMatch(/COLUMNS_KEY = 'spellbook-outliner-columns'/);
    expect(host).toMatch(/VIEW_KEY = 'spellbook-outliner-view'/);
    const keys = [...host.matchAll(/this\.(?:load|save)\((\w+)/g)].map((match) => match[1] ?? '');
    expect([...new Set(keys)].sort()).toEqual(['COLUMNS_KEY', 'VIEW_KEY']);
  });

  it("never puts the writer's text on the screen as a page of its own", () => {
    const asPage = /\b(innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|document\s*\.\s*write)\b/;
    for (const name of files) expect(asPage.test(codeOf(name)), name).toBe(false);
    expect(asPage.test("el.innerHTML = '<b>x</b>';")).toBe(true);
  });

  it('runs every timer on the clock it is handed, so that closing leaves none behind', () => {
    const ownTimer = /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/;
    for (const name of files) expect(ownTimer.test(codeOf(name)), name).toBe(false);
    expect(ownTimer.test('window.setTimeout(f, 1);')).toBe(true);
  });

  it('uses no regular-expression lookbehind, no Node or Electron, and no network', () => {
    const sources = [
      ...files.map((name) => path.join(featureDir, name)),
      ...readdirSync(coreDir).map((name) => path.join(coreDir, name)),
    ];
    expect(sources.length).toBe(17);
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(/\(\?<[=!]/.test(text), file).toBe(false);
      const code = strip(text);
      expect(/from\s+['"](node:[^'"]+|fs|path|os|child_process|electron|http|https|net|crypto)['"]/.test(code), file).toBe(false);
      expect(/\brequire\s*\(/.test(code), file).toBe(false);
      expect(/\b(fetch|XMLHttpRequest|WebSocket|requestUrl|sendBeacon)\b/.test(code), file).toBe(false);
      expect(/\.\s*scrollIntoView\s*\(/.test(code), file).toBe(false);
    }
  });

  it('names sides "start" and "end" in what it sets from code, and gives every class the plugin\'s prefix', () => {
    for (const name of files) {
      const code = codeOf(name);
      expect(/\.style\s*\.\s*(left|right|marginLeft|marginRight|paddingLeft|paddingRight)\b/.test(code), name).toBe(false);
      // Classes of the plugin's own; Obsidian's are used next to them so that themes apply.
      const obsidianOwn = new Set(['clickable-icon']);
      const classLists = [...code.matchAll(/\bcls:\s*(?:'([^']*)'|`([^`]*)`)/g)].map((match) => match[1] ?? match[2] ?? '');
      for (const list of classLists) {
        // (What a class list takes in from a variable is checked where the variable is given.)
        for (const cls of list.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
          if (cls === '' || obsidianOwn.has(cls)) continue;
          expect(cls.startsWith('spellbook-'), `${name}: class "${cls}"`).toBe(true);
        }
      }
      // Every class named anywhere else in the code is the plugin's own too.
      const named = [...code.matchAll(/'((?:spellbook|is|has|mod)-[\w-]+)'/g)].map((match) => match[1] ?? '');
      for (const cls of named) expect(cls.startsWith('spellbook-'), `${name}: "${cls}"`).toBe(true);
    }
    for (const column of BUILT_IN_COLUMNS) expect(columnClass(column)).toBe(`spellbook-outliner-col-${column}`);
    expect(columnClass('prop:anything at all')).toBe('spellbook-outliner-col-property');
  });

  it('marks as the writer\'s own text exactly the elements that hold it', () => {
    // dir="auto" lets a Hebrew title read right to left in an English app. It
    // goes on the elements that hold the writer's text and on no cell, row or
    // number: a number column must not change sides with the language of a title.
    const cells = codeOf('cells.ts');
    // (Each element is made on a line of its own.)
    const marked = [...cells.matchAll(/cls: '([\w-]+)'[^\n]*?dir: 'auto'/g)].map((match) => match[1] ?? '').sort();
    expect(marked).toEqual([
      'spellbook-outliner-folder-name',
      'spellbook-outliner-label-name',
      'spellbook-outliner-status',
      'spellbook-outliner-tag',
      'spellbook-outliner-text',
      'spellbook-outliner-text',
    ]);
    expect(cells).toMatch(/cls: TITLE_CLASS, text: row\.title, attr: \{ dir: 'auto'/);
    expect((cells.match(/dir: 'auto'/g) ?? []).length).toBe(7);
    // Never on a cell itself.
    expect(cells).not.toMatch(/cell\.setAttr\('dir'/);
    expect(codeOf('outlinerView.ts')).not.toMatch(/(cell|tr|th|table|body|foot|scroll|root)\.setAttr\('dir'/);
  });
});

describe('outliner.css', () => {
  const raw = readFileSync(cssFile, 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulesOf = (text: string): Array<{ selectors: string[]; body: string }> =>
    [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
      selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
      body: match[2] ?? '',
    }));
  const rules = rulesOf(css);
  const ruleFor = (selector: string): string | undefined =>
    rules.find((candidate) => candidate.selectors.includes(selector))?.body;
  /** What stands inside every "@media (query)" block of a stylesheet, joined. */
  const media = (text: string, query: string): string => {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    return [...text.matchAll(new RegExp(`@media\\s*${escaped}\\s*\\{([\\s\\S]*?\\})\\s*\\}`, 'g'))]
      .map((match) => match[1] ?? '')
      .join('\n');
  };

  it('only styles things the plugin itself marked', () => {
    expect(rules.length).toBeGreaterThan(50);
    for (const rule of rules) {
      for (const selector of rule.selectors) expect(selector.startsWith('.spellbook-'), selector).toBe(true);
    }
  });

  it('styles nothing of the other screens, and nothing by a class it does not use', () => {
    const used = new Set<string>();
    for (const name of files) {
      for (const match of codeOf(name).matchAll(/spellbook-[\w-]+/g)) used.add(match[0]);
    }
    // Made up in the code from a name: the eight colours, the four bands, the columns.
    for (const color of CARD_COLORS) used.add(colorClass(color));
    for (const band of TARGET_BANDS) used.add(`spellbook-outliner-band-${band}`);
    for (const column of BUILT_IN_COLUMNS) used.add(columnClass(column));
    // Put on by the drag engine (src/ui/dragDrop.ts) on what a drop would go into.
    used.add('spellbook-is-drop-target');
    // Put on by src/ui/layout.ts: the touch layout, and the desktop layout chosen on a touch screen.
    used.add('spellbook-is-mobile');
    used.add('spellbook-is-desktop-layout');
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        const classes = [...selector.matchAll(/\.(spellbook-[\w-]+)/g)].map((match) => match[1] ?? '');
        expect(classes.length, selector).toBeGreaterThan(0);
        // Every rule is tied to something of the outliner's own.
        expect(classes.some((cls) => cls.startsWith('spellbook-outliner')), selector).toBe(true);
        for (const cls of classes) expect(used.has(cls), `${selector}: .${cls}`).toBe(true);
      }
    }
  });

  it('takes its colours from the theme, never from fixed values', () => {
    for (const rule of rules) {
      expect(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test(rule.body), rule.selectors.join(', ')).toBe(false);
    }
  });

  it("maps each of the eight colour names to Obsidian's own colour of that name", () => {
    for (const color of CARD_COLORS) {
      expect(ruleFor(`.${colorClass(color)}`), color).toMatch(new RegExp(`--spellbook-outliner-tag:\\s*var\\(${colorVariable(color)}\\)`));
    }
    expect(ruleFor('.spellbook-outliner-no-color')).toMatch(/--spellbook-outliner-tag:/);
    expect(ruleFor('.spellbook-outliner-status')).toMatch(/var\(--spellbook-outliner-tag\)/);
    expect(ruleFor('.spellbook-outliner-dot')).toMatch(/background-color:\s*var\(--spellbook-outliner-tag\)/);
  });

  it('colours the target bar by its band with Obsidian\'s red, orange, yellow and green, at low strength', () => {
    const colours = { low: 'red', mid: 'orange', near: 'yellow', done: 'green' } as const;
    for (const band of TARGET_BANDS) {
      expect(ruleFor(`.spellbook-outliner-band-${band}`), band).toMatch(
        new RegExp(`--spellbook-outliner-band:\\s*var\\(--color-${colours[band]}\\)`),
      );
    }
    const bar = ruleFor('.spellbook-outliner-bar');
    expect(bar).toMatch(/background-color:\s*var\(--spellbook-outliner-band\)/);
    expect(bar).toMatch(/opacity:\s*0\.3/);
    // Behind the number, from the starting edge; how far it reaches is set from the code.
    expect(bar).toMatch(/position:\s*absolute/);
    expect(bar).toMatch(/inset-inline-start:\s*0/);
    expect(bar).not.toMatch(/width/);
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
    for (const name of declared) expect(name.startsWith('--spellbook-outliner-'), name).toBe(true);
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
    for (const rule of hoverRules) expect(media(css, '(hover: hover)').includes(rule.body), rule.selectors.join(', ')).toBe(true);
  });

  it('keeps the header row at the top, the Name column at the start and the Total row at the foot', () => {
    const head = ruleFor('.spellbook-outliner-head');
    expect(head).toMatch(/position:\s*sticky/);
    expect(head).toMatch(/inset-block-start:\s*0/);
    const name = ruleFor('.spellbook-outliner-col-name');
    expect(name).toMatch(/position:\s*sticky/);
    expect(name).toMatch(/inset-inline-start:\s*0/);
    const total = ruleFor('.spellbook-outliner-total > .spellbook-outliner-cell');
    expect(total).toMatch(/position:\s*sticky/);
    expect(total).toMatch(/inset-block-end:\s*0/);
    // What stays in place is opaque, so that the rows scrolling under it do not show through.
    expect(ruleFor('.spellbook-outliner-cell')).toMatch(/background-color:\s*var\(--background-primary\)/);
    expect(head).toMatch(/background-color:\s*var\(--background-secondary\)/);
    expect(total).toMatch(/background-color:\s*var\(--background-secondary\)/);
    // The table is as wide as its columns need, inside a box that scrolls both ways.
    expect(ruleFor('.spellbook-outliner-table')).toMatch(/width:\s*max-content/);
    expect(ruleFor('.spellbook-outliner-table')).toMatch(/border-collapse:\s*separate/);
    expect(ruleFor('.spellbook-outliner-scroll')).toMatch(/overflow:\s*auto/);
  });

  it('cuts a long name, synopsis or value short with an ellipsis, on one line', () => {
    for (const selector of ['.spellbook-outliner-text', '.spellbook-outliner-title']) {
      const body = ruleFor(selector);
      expect(body, selector).toMatch(/overflow:\s*hidden/);
      expect(body, selector).toMatch(/text-overflow:\s*ellipsis/);
      expect(body, selector).toMatch(/white-space:\s*nowrap/);
      expect(body, selector).toMatch(/text-align:\s*start/);
    }
    expect(ruleFor('.spellbook-outliner-col-synopsis')).toMatch(/max-width:/);
    expect(ruleFor('.spellbook-outliner-col-name')).toMatch(/max-width:\s*var\(--spellbook-outliner-name-width\)/);
  });

  it('stands numbers at the end of their cells', () => {
    const numbers = rules.find((rule) => rule.selectors.includes('.spellbook-outliner-col-words'));
    expect(numbers?.selectors).toEqual([
      '.spellbook-outliner-col-number',
      '.spellbook-outliner-col-words',
      '.spellbook-outliner-col-tasks',
      '.spellbook-outliner-col-readTime',
    ]);
    expect(numbers?.body).toMatch(/text-align:\s*end/);
    expect(ruleFor('.spellbook-outliner-table')).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('makes rows and what is tapped at least 44px on touch screens, and only there', () => {
    expect(css).toMatch(/--spellbook-outliner-touch:\s*44px/);
    const touchRules = rules.filter((rule) => /(min-)?(height|width):\s*var\(--spellbook-outliner-touch\)/.test(rule.body));
    expect(touchRules.length).toBeGreaterThanOrEqual(5);
    const coarse = media(css, '(pointer: coarse)');
    for (const rule of touchRules) {
      const byClass = rule.selectors.every((selector) => selector.includes('.spellbook-is-mobile'));
      expect(byClass || coarse.includes(rule.body), rule.selectors.join(', ')).toBe(true);
    }
    // Every row, and the things that are tapped.
    for (const selector of [
      '.spellbook-outliner .spellbook-outliner-cell',
      '.spellbook-outliner .spellbook-outliner-head-button',
      '.spellbook-outliner .spellbook-outliner-more',
      '.spellbook-outliner .spellbook-outliner-fold',
      '.spellbook-outliner .spellbook-outliner-search',
      '.spellbook-outliner .spellbook-outliner-filter',
      '.spellbook-outliner .spellbook-outliner-columns',
      '.spellbook-outliner .spellbook-outliner-chip',
    ]) {
      // Unless the desktop layout was chosen (src/ui/layout.ts).
      expect(coarse, selector).toContain(selector.replace(' ', ':not(:where(.spellbook-is-desktop-layout)) '));
    }
    expect(rulesOf(coarse).find((rule) => rule.selectors.includes('.spellbook-outliner:not(:where(.spellbook-is-desktop-layout)) .spellbook-outliner-cell'))?.body).toMatch(
      /height:\s*var\(--spellbook-outliner-touch\)/,
    );
  });

  it('keeps the table clear of the bar that floats over the bottom of a phone', () => {
    const body = ruleFor('.spellbook-outliner.spellbook-is-phone .spellbook-outliner-scroll');
    expect(body).toMatch(/margin-block-end:/);
    expect(body).toMatch(/var\(--mobile-navbar-height, 0px\)/);
    expect(body).toMatch(/var\(--safe-area-inset-bottom, 0px\)/);
    expect(body).toMatch(/max\(\s*var\(--spellbook-outliner-bar-room\)/);
    expect(css).toMatch(/--spellbook-outliner-bar-room:\s*80px/);
  });

  it("keeps a finger that rests on a row from selecting its text or raising the phone's own bubble", () => {
    const row = ruleFor('.spellbook-outliner.spellbook-is-reorderable .spellbook-outliner-row');
    expect(row).toMatch(/-webkit-touch-callout:\s*none/);
    expect(row).toMatch(/-webkit-user-select:\s*none/);
    expect(row).toMatch(/[^-]user-select:\s*none/);
  });

  it('shows only the field in a cell that is being edited', () => {
    expect(ruleFor('.spellbook-outliner-cell.spellbook-is-editing > *')).toMatch(/display:\s*none/);
    expect(ruleFor('.spellbook-outliner-cell.spellbook-is-editing > .spellbook-outliner-input')).toMatch(/display:\s*block/);
  });

  it('ends with the rule that keeps things out of sight, so that it outweighs what lays them out', () => {
    const last = rules[rules.length - 1];
    expect(last?.selectors).toEqual(['.spellbook-outliner-off.spellbook-outliner-off.spellbook-outliner-off']);
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
    // No class of the binder or of another screen is styled again here.
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        expect(selector).not.toMatch(/\.spellbook-(binder|row|title|count|board|card|inspector|tags|planner|timeline|progress)\b/);
      }
    }
  });

  it('passes the checks of the whole stylesheet once it is joined to it', () => {
    // The stylesheet as the build puts it together: "outliner.css" is in the
    // list of scripts/styles.mjs, after what the screens share.
    expect(STYLE_FILES).toContain('outliner.css');
    const whole = joinStyles(
      STYLE_FILES.map((name) => ({ name, text: readFileSync(path.join(root, STYLES_DIR, name), 'utf8') })),
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const all = rulesOf(whole);
    expect(all.length).toBeGreaterThan(rules.length);
    for (const rule of all) {
      for (const selector of rule.selectors) expect(selector.startsWith('.spellbook-'), selector).toBe(true);
      expect(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test(rule.body), rule.selectors.join(', ')).toBe(false);
      expect(/\b(left|right)\b/.test(rule.body), rule.selectors.join(', ')).toBe(false);
    }
    // The binder's rule about rows tall enough for a finger still holds for every rule that uses its variable.
    const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?\})\s*\}/.exec(whole)?.[1] ?? '';
    for (const rule of all.filter((candidate) => /min-height:\s*var\(--spellbook-touch-target\)/.test(candidate.body))) {
      const guarded = rule.selectors.every((selector) => selector.includes('.spellbook-is-mobile')) || coarse.includes(rule.body);
      expect(guarded, rule.selectors.join(', ')).toBe(true);
    }
    // Still exactly one thing comes into view on hover (the binder's "more" button, with a mouse).
    const revealed = all.filter(
      (rule) =>
        rule.selectors.some((selector) => selector.includes(':hover')) &&
        /\b(display|visibility|opacity|pointer-events)\s*:/.test(rule.body),
    );
    expect(revealed).toHaveLength(1);
    // And still only the binder leaves room with its own variable.
    expect(all.filter((rule) => /--spellbook-phone-bar-room\)/.test(rule.body))).toHaveLength(1);
  });
});
