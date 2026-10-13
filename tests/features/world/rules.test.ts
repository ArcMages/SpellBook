// Rules about the world-building feature's own source and stylesheet, checked
// by reading the files. They keep the promises of the design: the screens
// know the project only through their host, the engine is pure, the service
// the inspector uses is declared once, and the stylesheet has a colour for
// every colour a type can have.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STYLE_FILES } from '../../../scripts/styles.mjs';
import { CARD_COLORS, colorVariable } from '../../../src/core/cards';
import { SCENE_ENTITIES_SERVICE } from '../../../src/core/world';
import { FEATURES } from '../../../src/features/registry';
import { WorldPane, worldFeature } from '../../../src/features/world/index';
import { TypeChoiceModal } from '../../../src/features/world/newEntity';
import { NO_COLOR_CLASS, colorClass } from '../../../src/features/world/parts';
import { EntityPickerModal } from '../../../src/features/world/pickerModal';
import { EntityTypesModal } from '../../../src/features/world/typesModal';
import { WORLD_VIEW_TYPE, WorldView } from '../../../src/features/world/worldView';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const srcDir = path.join(root, 'src');
const featureDir = path.join(srcDir, 'features', 'world');
const coreDir = path.join(srcDir, 'core', 'world');
const cssFile = path.join(srcDir, 'styles', 'world.css');

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

function allSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return allSources(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('the source of the world-building feature', () => {
  it('is made of the expected files, with its engine in the core', () => {
    expect(files).toEqual(['host.ts', 'index.ts', 'newEntity.ts', 'parts.ts', 'pickerModal.ts', 'sceneService.ts', 'typesModal.ts', 'worldView.ts']);
    expect(readdirSync(coreDir).sort()).toEqual(['browse.ts', 'entity.ts', 'index.ts', 'links.ts', 'mentions.ts', 'services.ts', 'types.ts']);
    expect(STYLE_FILES).toContain('world.css');
    expect(FEATURES).toContain(worldFeature);
    expect(worldFeature.id).toBe('world');
    expect(WORLD_VIEW_TYPE).toBe('spellbook-world');
  });

  it('lets the screens and windows know the project only through the host: no store, no vault, no device storage', () => {
    // host.ts is the one file that is handed the store and the vault doorway.
    for (const name of files.filter((file) => file !== 'host.ts')) {
      const code = codeOf(name);
      expect(/\b(ProjectStore|VaultPort|WordCountCache|DeviceStorage)\b/.test(code), name).toBe(false);
      expect(/\b(store|vault|storage|wordCounts)\s*\.\s*\w+\s*\(/.test(code), name).toBe(false);
    }
    // And nothing reaches outside the feature but the core, the shared pieces of screen and the registry.
    const allowed = [/^obsidian$/, /^\.\/\w+$/, /^\.\.\/\.\.\/core\/[\w/]+$/, /^\.\.\/\.\.\/ui\/\w+$/, /^\.\.\/registry$/];
    for (const name of files) {
      for (const target of importsOf(codeOf(name))) {
        expect(allowed.some((pattern) => pattern.test(target)), `${name} imports ${target}`).toBe(true);
      }
    }
  });

  it('changes the project only through the store\'s own intents, and never a note\'s text', () => {
    const host = codeOf('host.ts');
    const asked = [...host.matchAll(/\bstore\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1] ?? '');
    const changing = new Set(asked.filter((name) => /^(add|rename|trash|update|delete|create|move|remove|merge)/.test(name)));
    expect([...changing].sort()).toEqual(['addWorldNote', 'renameWorldNote', 'trashWorldNote', 'updateNoteProperties', 'updateProjectData']);
    // The vault doorway is only read from and listened to.
    const doorway = [...host.matchAll(/\bvault\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1] ?? '');
    expect([...new Set(doorway)].sort()).toEqual(['on', 'readText', 'resolveLink']);
    for (const name of files) expect(/updateDataFile|updateStatsFile|createExportFile/.test(codeOf(name)), name).toBe(false);
  });

  it('gives no method or field of a view or a window a name that Obsidian uses for its own work on them', () => {
    const taken = new Set([
      'open', 'close', 'load', 'unload', 'onload', 'onunload', 'show', 'hide', 'register', 'registerEvent',
      'registerDomEvent', 'registerInterval', 'addChild', 'removeChild', 'getEphemeralState', 'setEphemeralState',
      'onPaneMenu', 'onHeaderMenu', 'onTabMenu', 'onMoreOptions', 'addAction', 'updateNavButtons', 'handleDrop',
      'handlePaste', 'handleCopy', 'handleCut', 'setTitle', 'setContent', 'onEscapeKey', 'onWindowClose',
    ]);
    const classes = { WorldView, EntityPickerModal, EntityTypesModal, TypeChoiceModal };
    for (const [name, made] of Object.entries(classes)) {
      const own = Object.getOwnPropertyNames(made.prototype);
      expect(own.filter((member) => taken.has(member)), name).toEqual([]);
    }
    for (const file of ['worldView.ts', 'pickerModal.ts', 'typesModal.ts', 'newEntity.ts']) {
      const fields = [...codeOf(file).matchAll(/^ {2}private (?:readonly )?(\w+)[:=?! ]/gm)].map((match) => match[1] ?? '');
      expect(fields.length, file).toBeGreaterThan(1);
      const reserved = ['scope', 'app', 'leaf', 'icon', 'navigation', 'containerEl', 'contentEl', 'titleEl', 'modalEl', 'headerEl'];
      expect(fields.filter((field) => taken.has(field) || reserved.includes(field)), file).toEqual([]);
    }
    expect(Object.getOwnPropertyNames(WorldPane.prototype)).toEqual(expect.arrayContaining(['reveal', 'release']));
  });

  it('declares what it offers the inspector once, in the core, for both sides to go by', () => {
    expect(SCENE_ENTITIES_SERVICE).toBe('world.sceneEntities');
    const home = path.join(coreDir, 'services.ts');
    for (const file of allSources(srcDir)) {
      const code = strip(readFileSync(file, 'utf8'));
      const where = path.relative(srcDir, file);
      expect(/'world\.sceneEntities'/.test(code), `${where} spells out the service's name`).toBe(file === home);
      expect(/\binterface\s+(SceneEntitiesService|SceneEntityChip)\b/.test(code), `${where} declares the service's shape`).toBe(file === home);
    }
    // The inspector's part goes by it, and knows nothing else of this feature.
    const part = strip(readFileSync(path.join(srcDir, 'features', 'corkboard', 'sceneEntities.ts'), 'utf8'));
    expect(importsOf(part).filter((target) => target.includes('world'))).toEqual(['../../core/world/index', '../../core/world/index']);
    expect(/features\/world|\.\.\/world\//.test(part)).toBe(false);
  });
});

describe('the stylesheet of the world-building feature', () => {
  const css = readFileSync(cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('maps each of the eight colours a type can have to Obsidian\'s own colour, and has a quiet one for none', () => {
    for (const color of CARD_COLORS) {
      const rule = new RegExp(`\\.${colorClass(color)}\\s*\\{\\s*--spellbook-world-tag:\\s*var\\(${colorVariable(color)}\\);\\s*\\}`);
      expect(rule.test(css), color).toBe(true);
    }
    expect(css).toMatch(new RegExp(`\\.${NO_COLOR_CLASS}\\s*\\{\\s*--spellbook-world-tag:`));
    // The chips in the inspector take the same classes (the inspector's part builds their names).
    const part = readFileSync(path.join(srcDir, 'features', 'corkboard', 'sceneEntities.ts'), 'utf8');
    expect(part).toContain('`spellbook-world-color-${chip.color}`');
    expect(part).toContain(`'${NO_COLOR_CLASS}'`);
  });

  it('shows one column in a narrow pane, and the details in place of the list', () => {
    expect(css).toMatch(/\.spellbook-world-narrow \.spellbook-world-cards\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.spellbook-world-narrow\.spellbook-world-has-detail \.spellbook-world-list\s*\{\s*display:\s*none;/);
    // The width is measured by the code: the stylesheet asks no question of the screen's size.
    expect(css).not.toMatch(/@media[^{]*(max|min)-width/);
  });

  it('makes what is tapped tall enough for a finger on phones and tablets, and leaves room for the phone\'s floating bar', () => {
    expect(css).toMatch(/--spellbook-world-touch:\s*44px/);
    expect(css).toMatch(/\.spellbook-world\.spellbook-is-mobile \.spellbook-world-row-open[\s\S]*?min-height:\s*var\(--spellbook-world-touch\)/);
    expect(css).toMatch(/@media \(pointer: coarse\)/);
    expect(css).toMatch(/\.spellbook-world\.spellbook-is-phone \.spellbook-world-list,[\s\S]*?padding-block-end:\s*max\(/);
  });
});
