// Rules about the export's own source, checked by reading the files. They
// keep the promises of the design: the window knows the project only through
// the exporter, the exporter writes one thing only (a new file, through the
// store), and nothing in the feature can change a note of the writer's.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STYLE_FILES } from '../../../scripts/styles.mjs';
import { ExportDoneModal, ExportModal, exportFeature } from '../../../src/features/export/index';
import { FEATURES } from '../../../src/features/registry';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const featureDir = path.join(root, 'src', 'features', 'export');
const coreDir = path.join(root, 'src', 'core', 'export');

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

describe('the source of the export', () => {
  it('is made of the expected files', () => {
    expect(files).toEqual(['doneModal.ts', 'exportModal.ts', 'exporter.ts', 'index.ts']);
    expect(readdirSync(coreDir).sort()).toEqual([
      'direction.ts',
      'fileName.ts',
      'index.ts',
      'manuscript.ts',
      'markdown.ts',
      'toDocx.ts',
      'toEpub.ts',
      'toHtml.ts',
      'toMarkdown.ts',
      'zip.ts',
    ]);
    expect(STYLE_FILES).toContain('export.css');
  });

  it('exports the feature as "exportFeature", and no other feature has its name', () => {
    expect(exportFeature.id).toBe('export');
    expect(FEATURES).toContain(exportFeature);
    expect(FEATURES.filter((feature) => feature.id === 'export')).toEqual([exportFeature]);
  });

  it('lets the windows know the project only through the exporter: no store, no vault, no device storage', () => {
    const allowed = [/^obsidian$/, /^\.\/exporter$/, /^\.\/doneModal$/, /^\.\.\/\.\.\/core\/export$/, /^\.\.\/\.\.\/ui\/(notices|safely)$/];
    for (const name of ['exportModal.ts', 'doneModal.ts']) {
      const code = codeOf(name);
      for (const target of importsOf(code)) {
        expect(allowed.some((pattern) => pattern.test(target)), `${name} imports ${target}`).toBe(true);
      }
      expect(/\b(ProjectStore|VaultPort|DeviceStorage|FeatureContext)\b/.test(code)).toBe(false);
      expect(/\b(store|vault|storage|context)\s*\.\s*\w+/.test(code)).toBe(false);
      // The exporter is taken by its type only: the windows make none of their own.
      expect(code).toMatch(/import type \{[^}]*\bExporter\b[^}]*\} from '\.\/exporter'/);
    }
  });

  it('reaches nothing outside its own folder but the core, the shared pieces of screen and the registry', () => {
    const allowed = [/^obsidian$/, /^\.\/\w+$/, /^\.\.\/\.\.\/core\/[\w/]+$/, /^\.\.\/\.\.\/ui\/\w+$/, /^\.\.\/registry$/];
    // One more, for the exporter alone: pointing at the new file in Obsidian's file list.
    const fileList = '../../obsidian/fileList';
    expect(importsOf(codeOf('exporter.ts'))).toContain(fileList);
    for (const name of files) {
      for (const target of importsOf(codeOf(name))) {
        if (name === 'exporter.ts' && target === fileList) continue;
        expect(allowed.some((pattern) => pattern.test(target)), `${name} imports ${target}`).toBe(true);
      }
    }
    // What is reached there only looks: it changes no file.
    const helper = strip(readFileSync(path.join(root, 'src', 'obsidian', 'fileList.ts'), 'utf8'));
    expect([...helper.matchAll(/\bvault\s*\.\s*(\w+)\s*\(/g)].map((call) => call[1])).toEqual(['getAbstractFileByPath']);
  });

  it('writes one thing only: a new export, through the store', () => {
    // Of everything the store offers, the feature calls what reads, and createExportFile.
    const calls = new Set<string>();
    for (const name of files) {
      for (const call of codeOf(name).matchAll(/\bstore\s*\.\s*(\w+)\s*\(/g)) calls.add(call[1] ?? '');
    }
    expect([...calls].sort()).toEqual(['createExportFile', 'projectData', 'projectNotes', 'vaultPathOf']);
    // Of the vault doorway it only reads.
    const doorway = new Set<string>();
    for (const name of files) {
      for (const call of codeOf(name).matchAll(/\bvault\s*\.\s*(\w+)\s*\(/g)) doorway.add(call[1] ?? '');
    }
    expect([...doorway].sort()).toEqual(['exists', 'listImageFiles', 'readBinary', 'readFrontmatter', 'readText']);
    // Bytes are read for one thing: the picture chosen for the cover of an e-book.
    expect(codeOf('exporter.ts').match(/vault\.readBinary\([^)]*\)/g)).toEqual(['vault.readBinary(options.cover)']);
    expect((codeOf('exporter.ts').match(/createExportFile\(/g) ?? []).length).toBe(1);
  });

  it('decides by the kind of device in one place', () => {
    for (const name of files) {
      expect(/\bPlatform\b/.test(codeOf(name)), name).toBe(name === 'exportModal.ts');
    }
    expect(codeOf('exportModal.ts').match(/\bPlatform\s*\./g)).toHaveLength(1);
    expect(codeOf('exportModal.ts')).toMatch(/export function canPrintHere\(\): boolean \{\s*return !Platform\.isMobile;/);
  });

  it('marks the writer\'s own text so that it chooses its own direction', () => {
    // The project's title, a folder's name, the author, the path of the new file, the titles of scenes left out.
    const code = codeOf('exportModal.ts') + codeOf('doneModal.ts');
    expect((code.match(/dir: 'auto'|'dir', 'auto'/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it('gives no method of the window a name that Obsidian uses for its own work on windows', () => {
    const taken = new Set(['open', 'close', 'setTitle', 'setContent', 'onEscapeKey', 'onWindowClose', 'load', 'unload', 'scope', 'app']);
    const reserved = ['scope', 'app', 'containerEl', 'modalEl', 'titleEl', 'contentEl', 'shouldRestoreSelection', 'selection', 'bgEl', 'dimBackground'];
    for (const [window, file] of [[ExportModal, 'exportModal.ts'], [ExportDoneModal, 'doneModal.ts']] as const) {
      const own = Object.getOwnPropertyNames(window.prototype).filter((name) => name !== 'constructor' && name !== 'onOpen' && name !== 'onClose');
      expect(own.length).toBeGreaterThan(2);
      expect(own.filter((member) => taken.has(member))).toEqual([]);
      const fields = [...codeOf(file).matchAll(/^ {2}private (?:readonly )?(\w+)[:=?! ]/gm)].map((match) => match[1] ?? '');
      expect(fields.filter((field) => taken.has(field) || reserved.includes(field))).toEqual([]);
    }
  });

  it('puts nothing into an exported file that could fetch or run anything', () => {
    // The one picture an e-book shows is its cover, a file inside the book itself.
    const coverImage = '<img src="${coverHref}"';
    const epub = strip(readFileSync(path.join(coreDir, 'toEpub.ts'), 'utf8'));
    expect(epub.split(coverImage)).toHaveLength(2);
    expect(epub).toContain('const coverHref = `images/cover.${coverExtension}`;');
    for (const name of readdirSync(coreDir)) {
      const code = strip(readFileSync(path.join(coreDir, name), 'utf8')).replace(coverImage, '');
      expect(/<script|javascript:|\bsrc=|@import|url\(/i.test(code), name).toBe(false);
    }
    // The one thing a page can do: the Print button of the page made for printing.
    const page = strip(readFileSync(path.join(coreDir, 'toHtml.ts'), 'utf8'));
    expect(page.match(/onclick="[^"]*"/g)).toEqual(['onclick="print()"']);
  });
});
