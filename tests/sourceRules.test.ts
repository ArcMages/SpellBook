// Rules about the plugin's own source code, checked by reading the files.
// They keep the promises made in the design: the core stays testable without
// Obsidian, and nothing in the plugin can reach outside the vault API.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STYLES_DIR, STYLES_OUTPUT, STYLE_FILES, joinStyles, readStyles } from '../scripts/styles.mjs';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '..');
const srcDir = path.join(repoRoot, 'src');

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
const featureFiles = allFiles.filter((file) => /^features\/[^/]+\//.test(relative(file)));

/**
 * What a piece of code imports from other files of the plugin: for every
 * import, export-from or dynamic import of a relative path, the file or
 * folder it points at, as a path relative to src ("core/dates",
 * "features/registry"). A path that leaves src starts with "../". Imports of
 * packages ("obsidian") are not listed.
 *
 * @param from the importing file's own path relative to src
 */
function importsOf(code: string, from: string): string[] {
  const specifiers = [
    ...code.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g),
    ...code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1] ?? '');
  return specifiers
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)));
}

/** True when an import path (relative to src) is `area` itself or something inside it. */
const within = (target: string, area: string): boolean => target === area || target.startsWith(`${area}/`);

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
      'core/binderModel.ts',
      'core/devicePrefs.ts',
      'core/projectSession.ts',
      'core/wordCountCache.ts',
      'obsidian/obsidianVault.ts',
      'obsidian/openNote.ts',
      'obsidian/deviceStorage.ts',
      'ui/createProjectModal.ts',
      'ui/icons.ts',
      'views/binderView.ts',
      'core/binderSelection.ts',
      'ui/textPromptModal.ts',
      'ui/confirmModal.ts',
      'ui/folderPickerModal.ts',
      'ui/safely.ts',
      'views/binderActions.ts',
      'views/binderMenus.ts',
      'core/dropTarget.ts',
      'core/conflictCopies.ts',
      'ui/dragDrop.ts',
      'ui/ownText.ts',
      'core/projectLayout.ts',
      'core/dates.ts',
      'core/deviceId.ts',
      'features/registry.ts',
      'features/corkboard/index.ts',
      'features/progress/index.ts',
      'features/planner/index.ts',
      'features/timeline/index.ts',
      'features/outliner/index.ts',
      'features/schemes/index.ts',
      'features/report/index.ts',
      'features/export/index.ts',
      'features/prose/index.ts',
      'features/scrivenings/index.ts',
      'features/snapshots/index.ts',
      'features/world/index.ts',
      'features/aihelper/index.ts',
      'features/plotgrid/index.ts',
      'features/welcome/index.ts',
      'core/welcome/index.ts',
      'features/templates/index.ts',
      'core/templates/index.ts',
      'features/boards/index.ts',
      'core/boards/index.ts',
      'features/revision/index.ts',
      'core/revision/index.ts',
    ]) {
      expect(names, expected).toContain(expected);
    }
    expect(coreFiles.length).toBeGreaterThanOrEqual(8);
  });
});

describe('src/core is pure', () => {
  const forbidden: Array<[string, RegExp]> = [
    ['an import from "obsidian"', /from\s+['"]obsidian['"]|require\(\s*['"]obsidian['"]\s*\)/],
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
      // Whatever it imports is in src/core as well. A file in a sub-folder of
      // src/core may reach the rest of src/core ("../dates"); the path is
      // worked out, not judged by how it is spelled.
      for (const target of importsOf(code, relative(file))) {
        expect(within(target, 'core'), `${relative(file)} must not import "${target}", which is outside src/core`).toBe(true);
      }
    });
  }

  it('the rule about imports works out where a path leads, whatever folder it starts from', () => {
    const leads = (from: string, specifier: string): string[] => importsOf(`import { x } from '${specifier}';`, from);
    // From a sub-folder of src/core, the folder above is still src/core.
    expect(leads('core/planner/todo.ts', '../dates')).toEqual(['core/dates']);
    expect(leads('core/planner/todo.ts', './../dates')).toEqual(['core/dates']);
    expect(leads('core/planner/todo.ts', './marks')).toEqual(['core/planner/marks']);
    expect(leads('core/timeline/layout/rows.ts', '../../types')).toEqual(['core/types']);
    // Out of src/core, however it is spelled.
    for (const [from, specifier] of [
      ['core/projectStore.ts', '../obsidian/obsidianVault'],
      ['core/planner/todo.ts', '../../ui/icons'],
      ['core/planner/todo.ts', './../../views/binderView'],
      ['core/planner/todo.ts', '../../../scripts/deploy.mjs'],
    ] as const) {
      const [target] = leads(from, specifier);
      expect(within(target ?? '', 'core'), `${from} -> ${specifier}`).toBe(false);
    }
    expect(within('corex/thing', 'core')).toBe(false); // a folder whose name merely starts the same
    // Every way of importing is seen, and packages are not paths.
    const code = [
      "import type { A } from './a';",
      "export { b } from '../b';",
      "export * from './c';",
      "const d = await import('./d');",
      "import './e';",
      "import { Plugin } from 'obsidian';",
    ].join('\n');
    expect(importsOf(code, 'core/sub/file.ts')).toEqual(['core/sub/a', 'core/b', 'core/sub/c', 'core/sub/d', 'core/sub/e']);
  });

  it('the rule itself works: it would catch each forbidden thing', () => {
    const samples = [
      "import { TFile } from 'obsidian';",
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
  it('calls the continuous view "Novel view" in every text that can be read, and "scrivenings" only in ids', () => {
    // The folder, the ids and the class names keep the old word; a name, a
    // notice, a tooltip or a message does not. A text is told from an id by
    // its looks: an id has no spaces and no capital at its start.
    const id = /^[a-z0-9]+([-:./][a-z0-9]+)*(\.css|\.ts)?$/;
    const strings = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    const readable: string[] = [];
    for (const file of allFiles) {
      for (const match of codeOf(file).matchAll(strings)) {
        const text = match[1] ?? match[2] ?? match[3] ?? '';
        // (Not the path of a file that is imported.)
        if (!/scrivening/i.test(text) || /^\.{1,2}\//.test(text)) continue;
        // (A class name put together from a piece that changes: `spellbook-scrivenings-menu-depth-${...}`.)
        const plain = text.replace(/\$\{[^}]*\}/g, '0');
        const pieces = plain.split(/\s+/).filter((piece) => piece !== '');
        const isId = pieces.every((piece) => id.test(piece)) && pieces.every((piece) => /scrivening/.test(piece) || /^spellbook-/.test(piece));
        if (!isId) readable.push(`${relative(file)}: ${text}`);
      }
    }
    expect(readable).toEqual([]);
    // The check itself works.
    expect(id.test('spellbook-scrivenings-pane')).toBe(true);
    expect(id.test('open-scrivenings')).toBe(true);
    expect(id.test('Open scrivenings')).toBe(false);
    expect(id.test('Scrivenings')).toBe(false);
  });

  it('reaches notes only through src/obsidian', () => {
    for (const file of outsideAdapter) {
      const code = codeOf(file);
      expect(/\bapp\s*\.\s*(vault|fileManager|metadataCache)\b/.test(code), relative(file)).toBe(false);
      expect(/\.\s*(processFrontMatter|trashFile|renameFile|getMarkdownFiles|getFileCache)\s*\(/.test(code), relative(file)).toBe(false);
    }
  });

  it('never deletes a note outright or rewrites its text', () => {
    // In src/obsidian, "vault" is Obsidian's Vault. Its destructive methods are
    // off limits: the FileManager ones (trashFile, processFrontMatter) are used instead.
    expect(adapterFiles.length).toBeGreaterThan(0);
    const destructive = /\bvault\s*\.\s*(delete|trash|modify|modifyBinary|append|appendBinary|rename|copy)\s*\(/;
    // One exception: renaming or moving a note or folder, whose links the
    // store brings up to date itself (see the rule about links below). It is
    // the one call to vault.rename, in moveFile, and it renames and does nothing else.
    const doorway = codeOf(path.join(srcDir, 'obsidian', 'obsidianVault.ts'));
    const moveFile = /\n  async moveFile\([\s\S]*?\n  \}\n/.exec(doorway)?.[0] ?? '';
    expect((moveFile.match(/\bvault\s*\.\s*rename\s*\(/g) ?? []).length).toBe(1);
    expect((doorway.match(/\bvault\s*\.\s*rename\s*\(/g) ?? []).length).toBe(1);
    for (const file of adapterFiles) {
      const code = relative(file) === 'obsidian/obsidianVault.ts' ? codeOf(file).replace(moveFile, '') : codeOf(file);
      expect(destructive.test(code), relative(file)).toBe(false);
    }
    for (const file of allFiles) {
      expect(/\badapter\s*\./.test(codeOf(file)), `${relative(file)} must not use the low-level adapter`).toBe(false);
    }
    // the pattern would catch a slip
    expect(destructive.test('await this.app.vault.delete(file);')).toBe(true);
    expect(destructive.test('await this.app.vault.modify(file, text);')).toBe(true);
  });

  it('replaces a whole text in one place only, which only the store can reach, and only for the plugin\'s own files', () => {
    // vault.process and vault.create are how the to-do list and the word logs
    // are written. They appear in one method of one file (updateText in
    // src/obsidian/obsidianVault.ts) and nowhere else in the plugin.
    const wholeText = /\bvault\s*\.\s*process\s*\(/g;
    for (const file of allFiles) {
      const uses = (codeOf(file).match(wholeText) ?? []).length;
      expect(uses, relative(file)).toBe(relative(file) === 'obsidian/obsidianVault.ts' ? 1 : 0);
    }
    // That method is only ever called by the project store, in the one place
    // that first checks the path (dataFilePath): no screen and no feature can
    // call it, even though features are handed the vault doorway to read with.
    const callers = allFiles.filter((file) => /\.\s*updateText\s*\(/.test(codeOf(file))).map(relative);
    expect(callers).toEqual(['core/projectStore.ts']);
    const store = codeOf(path.join(srcDir, 'core', 'projectStore.ts'));
    expect((store.match(/\.\s*updateText\s*\(/g) ?? []).length).toBe(1);
    // In the store it sits in one private routine, which is reached from two
    // methods for the plugin's data: updateDataFile (the open project's To-do.md
    // and word logs) and updateStatsFile (a word log of a project named by its index).
    const writer = /\n  private async writeDataFile\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    expect(writer).toMatch(/\.updateText\(/);
    const methodOf = (name: string): string => new RegExp(`\\n  ${name}\\([\\s\\S]*?\\n  \\}\\n`).exec(store)?.[0] ?? '';
    const writesIn = (code: string): number => (code.match(/this\.writeDataFile\(/g) ?? []).length;
    const open = methodOf('updateDataFile');
    const named = methodOf('updateStatsFile');
    expect(writesIn(open)).toBe(1);
    expect(writesIn(named)).toBe(2); // the open project, or another one
    // A third method reaches it, for one fixed note and no other: the
    // reference for AI assistants, in the open project's "AI helper" folder.
    // It takes no path at all; the place comes from helperNotePath, whose
    // refusal is returned first.
    const helper = methodOf('updateHelperNote');
    expect(writesIn(helper)).toBe(1);
    expect(helper).toMatch(/updateHelperNote\(\s*change: \(current: string \| null\) => string \| null,\s*inProject\?: string,\s*\)/);
    expect(helper).toMatch(/const blocked = this\.whyNotWritable\(active\);\s*if \(blocked \|\| !active\) return /);
    expect(helper).toMatch(/const rel = this\.helperNotePath\(active\);\s*if \(typeof rel !== 'string'\) return rel;\s*return this\.writeDataFile\(active\.folder, rel, change\);/);
    const place = /\n  private helperNotePath\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    expect(place).toMatch(/const rel = `\$\{AI_HELPER_FOLDER\}\/\$\{AI_HELPER_FILE\}`;/);
    expect(place).toMatch(/flattenScenes\(this\.effectiveBinder\(active\)\)\.some\(/);
    const helperUsers = allFiles.filter((file) => /\.\s*updateHelperNote\s*\(/.test(codeOf(file))).map(relative);
    expect(helperUsers).toEqual(['features/aihelper/helperNote.ts']);
    expect(writesIn(store)).toBe(4); // and nowhere else
    // Each write comes right after its own check of the path (dataFilePath), whose refusal is returned first.
    for (const method of [open, named]) {
      const pieces = method.split('this.writeDataFile(').slice(0, -1);
      for (const piece of pieces) {
        expect(piece).toMatch(/const rel = this\.dataFilePath\([^;]*\);\s*if \(typeof rel !== 'string'\) return rel;\s*return $/);
      }
    }
    // A project named by its index gets a word log written and nothing else: never To-do.md.
    expect(named.match(/this\.dataFilePath\([^;]*\)/g)?.every((call) => /, true\)$/.test(call))).toBe(true);
    expect(open).toMatch(/this\.dataFilePath\([^;]*, false\)/);
  });

  it('writes a file from bytes in one place only, which only the store can reach, and only as a new export', () => {
    // Obsidian's vault.createBinary is how an exported manuscript is saved. It appears
    // in one method of one file (createBinary in src/obsidian/obsidianVault.ts),
    // which makes a new file or fails: it cannot change a file that is there.
    const fromBytes = /\bapp\s*\.\s*vault\s*\.\s*createBinary\s*\(/g;
    for (const file of allFiles) {
      const uses = (codeOf(file).match(fromBytes) ?? []).length;
      expect(uses, relative(file)).toBe(relative(file) === 'obsidian/obsidianVault.ts' ? 1 : 0);
    }
    // That method is only ever called by the project store, once, in createExportFile.
    const callers = allFiles.filter((file) => /\.\s*createBinary\s*\(/.test(codeOf(file))).map(relative);
    expect(callers.sort()).toEqual(['core/projectStore.ts', 'obsidian/obsidianVault.ts']);
    const store = codeOf(path.join(srcDir, 'core', 'projectStore.ts'));
    expect((store.match(/\.\s*createBinary\s*\(/g) ?? []).length).toBe(1);
    const method = /\n  createExportFile\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    expect(method).toMatch(/this\.vault\.createBinary\(target, data\)/);
    // The place is worked out by the store itself, from a bare file name that
    // has passed exportFilePath (whose refusal is returned first): directly
    // inside the Exports folder. And nothing is written where something is.
    expect(method).toMatch(/const rel = this\.exportFilePath\(active, name\);\s*if \(typeof rel !== 'string'\) return rel;\s*const target = joinPath\(active\.folder, rel\);\s*if \(this\.vault\.exists\(target\)\) \{\s*return refused\('exists'/);
    const check = /\n  private exportFilePath\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    expect(check).toMatch(/const rel = `\$\{EXPORTS_FOLDER\}\/\$\{name\}`;/);
    expect(check).toMatch(/parentPath\(rel\) !== EXPORTS_FOLDER\) return no;/);
    expect(check).toMatch(/sanitiseFileName\(stem, ''\) !== stem\) return no;/);
    expect(check).toMatch(/EXPORT_EXTENSIONS\.includes\(/);
  });

  it('changes the text of a note the writer writes in through two paths only: restoring a snapshot, and replacing ticked words', () => {
    // Obsidian's vault.process is still used in one place (the rule above).
    // A second method of the vault doorway reaches it, replaceText, which
    // never creates a file. Only the project store calls that, twice: in
    // replaceSceneText (restoring a snapshot) and in replaceInSceneBody
    // (Find and replace, Rename everywhere). No screen and no feature can.
    const callers = allFiles.filter((file) => /\.\s*replaceText\s*\(/.test(codeOf(file))).map(relative);
    expect(callers).toEqual(['core/projectStore.ts']);
    const store = codeOf(path.join(srcDir, 'core', 'projectStore.ts'));
    expect((store.match(/\.\s*replaceText\s*\(/g) ?? []).length).toBe(2);
    const restore = /\n  replaceSceneText\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    const replace = /\n  replaceInSceneBody\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    expect(restore).toMatch(/saved = await this\.vault\.replaceText\(file\.path, change\);/);
    expect(replace).toMatch(/saved = await this\.vault\.replaceText\(file\.path, \(current\) => \{/);
    // The one call in each method, and in no other.
    for (const method of [restore, replace]) expect((method.match(/\.\s*replaceText\s*\(/g) ?? []).length).toBe(1);
    // Before each: the project can be written, the path stays inside it, the
    // note is a scene (and not a snapshot), it is there, and it is no index.
    for (const method of [restore, replace]) {
      const before = method.split('this.vault.replaceText(')[0] ?? '';
      expect(before).toMatch(/const blocked = this\.whyNotWritable\(active\);\s*if \(blocked \|\| !active\) return /);
      expect(before).toMatch(/const rel = this\.checkedPath\(active, path, true\);\s*if \(typeof rel !== 'string'\) return rel;/);
      expect(before).toMatch(/if \(!this\.isSceneNote\(active, rel\) \|\| isInside\(SNAPSHOTS_FOLDER, rel\)\) \{\s*return refused\('invalid-path'/);
      expect(before).toMatch(/const file = this\.projectFiles\(active\)\.get\(pathKey\(rel\)\);\s*if \(!file\) \{\s*return refused\('missing-file'/);
      expect(before).toMatch(/if \(this\.projects\.has\(file\.path\)\) \{\s*return refused\('invalid-path'/);
    }
    // Replacing ticked words decides on the text as it is on disk at the
    // moment of writing, through one pure routine (src/core/revision/edits.ts):
    // the text without its properties must still be the one searched, every
    // change must find its words, and the properties are kept as they are.
    expect(replace).toMatch(/const next = applyToNote\(current, expectedBody, wanted\);/);
    expect(replace).toMatch(/return refused\('scene-changed'/);
    const edits = codeOf(path.join(srcDir, 'core', 'revision', 'edits.ts'));
    expect(edits).toMatch(/if \(body !== expectedBody\) return null;/);
    expect(edits).toMatch(/if \(splitBody\(result\)\.head !== head\) return null;/);
    // In the doorway it goes through the same routine as the plugin's own files, for a file that is there.
    const doorway = codeOf(path.join(srcDir, 'obsidian', 'obsidianVault.ts'));
    const replaceText = /\n  async replaceText\([\s\S]*?\n  \}\n/.exec(doorway)?.[0] ?? '';
    expect(replaceText).toMatch(/return this\.changeText\(this\.requireFile\(path\), /);
    expect(replaceText).not.toMatch(/\.create\(/);
    // A feature reaches each through the store alone: the snapshots restore,
    // and the revision tools replace (after a snapshot, through the snapshots' service).
    const restorers = allFiles.filter((file) => /\.\s*replaceSceneText\s*\(/.test(codeOf(file))).map(relative);
    expect(restorers).toEqual(['features/snapshots/keeper.ts']);
    const replacers = allFiles.filter((file) => /\.\s*replaceInSceneBody\s*\(/.test(codeOf(file))).map(relative);
    expect(replacers).toEqual(['features/revision/keeper.ts']);
    const keeper = codeOf(path.join(srcDir, 'features', 'revision', 'keeper.ts'));
    const replaceRun = /\n  async replace\([\s\S]*?\n  \}\n/.exec(keeper)?.[0] ?? '';
    expect(replaceRun.indexOf('taker.takeNamed(')).toBeGreaterThan(0);
    expect(replaceRun.indexOf('this.context.store.replaceInSceneBody(')).toBeGreaterThan(replaceRun.indexOf('taker.takeNamed('));
    expect(replaceRun).toMatch(/if \(snapshot !== null\) \{\s*problems\.push\([^;]*\);\s*continue;\s*\}/);
  });

  it('renames and moves notes and folders without the vault\'s own link updating, in one place, and then points the links at them', () => {
    // Obsidian's own rename (fileManager.renameFile) stops to ask about links
    // unless the writer told it to "Always update internal links", and the
    // rename waits until they answer: it is used nowhere in the plugin.
    for (const file of allFiles) {
      expect(/\brenameFile\b/.test(codeOf(file)), relative(file)).toBe(false);
    }
    // moveFile (a rename that leaves the links alone), linkSources and
    // updateLinks are reached from the project store alone, and moveFile and
    // updateLinks only in relocate: so no note is ever renamed with its links
    // left behind, and no other text is changed through updateLinks.
    for (const method of ['moveFile', 'updateLinks', 'linkSources']) {
      const callers = allFiles.filter((file) => new RegExp(`\\.\\s*${method}\\s*\\(`).test(codeOf(file))).map(relative);
      expect(callers.filter((file) => file !== 'obsidian/obsidianVault.ts'), method).toEqual(['core/projectStore.ts']);
    }
    const store = codeOf(path.join(srcDir, 'core', 'projectStore.ts'));
    const relocate = /\n  private async relocate\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    for (const method of ['moveFile', 'updateLinks']) {
      const uses = (store.match(new RegExp(`\\.\\s*${method}\\s*\\(`, 'g')) ?? []).length;
      expect(uses, method).toBe(1);
      expect(relocate, method).toMatch(new RegExp(`this\\.vault\\.${method}\\(`));
    }
    // Every rename and move of the store goes through relocate, each after its own checks.
    const checks: Record<string, RegExp> = {
      renameScene: /if \(!this\.isSceneNote\(active, rel\)\) \{/,
      renameWorldNote: /const file = this\.worldNote\(active, path\);\s*if \('status' in file\) return file;/,
      renameBoardFile: /const rel = this\.boardFilePath\(active, path\);\s*if \(typeof rel !== 'string'\) return rel;/,
      moveInProject: /if \(indexes\.some\(/,
    };
    for (const [name, check] of Object.entries(checks)) {
      const method = new RegExp(`\\n  ${name}\\([\\s\\S]*?\\n  \\}\\n`).exec(store)?.[0] ?? '';
      const before = method.split('this.relocate(')[0] ?? '';
      expect(method, name).toMatch(/this\.relocate\(active, /);
      expect(before, name).toMatch(/const blocked = this\.whyNotWritable\(active\);\s*if \(blocked \|\| !active\) return /);
      expect(before, name).toMatch(check);
    }
    expect((store.match(/this\.relocate\(/g) ?? []).length).toBe(4);
    // Notes and boards outside the project are changed only when the writer chose the whole vault.
    expect(relocate).toMatch(/const inScope = \(path: string\): boolean => scope === 'vault' \|\| isInside\(active\.folder, path\);/);
    expect(relocate).toMatch(/if \(!inScope\(source\)\) \{\s*outside\.add\(source\);\s*continue;\s*\}/);
    expect(relocate).toMatch(/if \(inScope\(board\)\) boards\.set\(board, named\);\s*else outside\.add\(board\);/);
    // The text keeps its properties block as it is, and nothing but link targets change.
    expect(relocate).toMatch(/const result = retargetLinks\(body, retarget\);/);
    expect(relocate).toMatch(/return result\.count > 0 \? head \+ result\.text : null;/);
    expect(relocate).toMatch(/const result = retargetBoard\(current, /);
    const doorway = codeOf(path.join(srcDir, 'obsidian', 'obsidianVault.ts'));
    const update = /\n  async updateLinks\([\s\S]*?\n  \}\n/.exec(doorway)?.[0] ?? '';
    expect(update).toMatch(/return this\.changeText\(this\.requireFile\(path\), /);
    expect(update).not.toMatch(/\.create\(/);
  });

  it('writes and trashes snapshots in one folder only, through the store', () => {
    const store = codeOf(path.join(srcDir, 'core', 'projectStore.ts'));
    const check = /\n  private snapshotNotePath\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    expect(check).toMatch(/parts\.length !== 3 \|\| parts\[0\] !== SNAPSHOTS_FOLDER \|\| !isSafeRelativePath\(path\) \|\| !isMarkdownPath\(path\)\) return no;/);
    expect(check).toMatch(/sanitiseFileName\(folder, ''\) !== folder \|\| sanitiseFileName\(name, ''\) !== name\) return no;/);
    for (const name of ['createSnapshotNote', 'trashSnapshotNote']) {
      const method = new RegExp(`\\n  ${name}\\([\\s\\S]*?\\n  \\}\\n`).exec(store)?.[0] ?? '';
      // The path is checked, and its refusal returned, before anything else is done with it.
      expect(method, name).toMatch(/const rel = this\.snapshotNotePath\(active, [^;]*\);\s*if \(typeof rel !== 'string'\) return rel;/);
      const write = name === 'createSnapshotNote' ? 'this.vault.createFile(' : 'this.vault.trash(';
      expect(method.indexOf('this.snapshotNotePath('), name).toBeGreaterThan(0);
      expect(method.indexOf(write), name).toBeGreaterThan(method.indexOf("if (typeof rel !== 'string') return rel;"));
    }
    const users = allFiles.filter((file) => /\.\s*(createSnapshotNote|trashSnapshotNote)\s*\(/.test(codeOf(file))).map(relative);
    expect(users).toEqual(['features/snapshots/keeper.ts']);
  });

  it('writes, changes and trashes idea boards in one folder only, through the store, and never a note', () => {
    const store = codeOf(path.join(srcDir, 'core', 'projectStore.ts'));
    const check = /\n  private boardFilePath\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    expect(check).toMatch(/parts\.length !== 2 \|\| parts\[0\] !== BOARDS_FOLDER \|\| !isSafeRelativePath\(path\)\) return no;/);
    expect(check).toMatch(/if \(!file\.endsWith\(ending\)\) return no;/);
    expect(check).toMatch(/sanitiseFileName\(name, ''\) !== name\) return no;/);
    const writes: Record<string, string> = {
      createBoardFile: 'this.vault.createFile(',
      updateBoardFile: 'this.vault.updateBoardText(',
      renameBoardFile: 'this.relocate(',
      trashBoardFile: 'this.vault.trash(',
    };
    for (const [name, write] of Object.entries(writes)) {
      const method = new RegExp(`\\n  ${name}\\([\\s\\S]*?\\n  \\}\\n`).exec(store)?.[0] ?? '';
      // The path is checked, and its refusal returned, before anything is written.
      expect(method, name).toMatch(/const rel = this\.boardFilePath\(active, [^;]*\);\s*if \(typeof rel !== 'string'\) return rel;/);
      expect(method.indexOf(write), name).toBeGreaterThan(method.indexOf("if (typeof rel !== 'string') return rel;"));
      expect(method, name).toMatch(/const blocked = this\.whyNotWritable\(active\);/);
    }
    // A new board never lands where something is.
    const create = /\n  createBoardFile\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '';
    expect(create).toMatch(/if \(this\.vault\.exists\(target\)\) \{\s*return refused\('exists'/);
    // The doorway's method for a board's text is reached from the store alone, once, and it never creates a file.
    const callers = allFiles.filter((file) => /\.\s*updateBoardText\s*\(/.test(codeOf(file))).map(relative);
    expect(callers).toEqual(['core/projectStore.ts']);
    // Twice: for a board of the Boards folder (updateBoardFile), and to point a board's cards at a note that was renamed (relocate).
    expect((store.match(/\.\s*updateBoardText\s*\(/g) ?? []).length).toBe(2);
    expect(/\n  private async relocate\([\s\S]*?\n  \}\n/.exec(store)?.[0] ?? '').toMatch(/this\.vault\.updateBoardText\(/);
    const doorway = codeOf(path.join(srcDir, 'obsidian', 'obsidianVault.ts'));
    const method = /\n  async updateBoardText\([\s\S]*?\n  \}\n/.exec(doorway)?.[0] ?? '';
    expect(method).toMatch(/const file = this\.requireFile\(path\);\s*if \(file\.extension\.toLowerCase\(\) !== 'canvas'\) throw/);
    expect(method).toMatch(/return this\.changeText\(file, /);
    expect(method).not.toMatch(/\.create\(/);
    // Only the idea boards use the board methods.
    const users = allFiles
      .filter((file) => /\.\s*(createBoardFile|updateBoardFile|renameBoardFile|trashBoardFile|readBoardFile)\s*\(/.test(codeOf(file)))
      .map(relative);
    expect(users).toEqual(['features/boards/keeper.ts']);
  });

  it('declares what the writing progress offers the other screens once, in the core', () => {
    // The two services are looked up by name. The names, and the shapes of
    // what is found under them, are written down in one file that every
    // screen may import; neither the screen that offers them nor a screen
    // that uses them spells out a name or declares a shape of its own.
    const home = 'core/progress/services.ts';
    const names = /'progress\.(sceneLine|stats)'/;
    const shapes = /\binterface\s+(SceneLineService|StatsService|StatsSummary|SceneLine|SceneLineSegment|ProgressStats|ProgressSummary)\b/;
    for (const file of allFiles) {
      const code = codeOf(file);
      expect(names.test(code), `${relative(file)} spells out a service name`).toBe(relative(file) === home);
      expect(shapes.test(code), `${relative(file)} declares a service shape`).toBe(relative(file) === home);
    }
    const declared = codeOf(path.join(srcDir, 'core', 'progress', 'services.ts'));
    expect(declared).toMatch(/export const SCENE_LINE_SERVICE = 'progress\.sceneLine'/);
    expect(declared).toMatch(/export const STATS_SERVICE = 'progress\.stats'/);
    for (const shape of ['SceneLineService', 'StatsService', 'StatsSummary', 'DayWords']) {
      expect(declared, shape).toMatch(new RegExp(`export interface ${shape}\\b`));
    }
    // Both sides go by it: the provider, the inspector's line and the planner.
    const usesCore = /from '\.\.\/\.\.\/core\/progress(\/index)?'/;
    for (const user of ['features/progress/services.ts', 'features/corkboard/summaryLine.ts', 'features/planner/plannerNumbers.ts']) {
      expect(usesCore.test(codeOf(path.join(srcDir, user))), user).toBe(true);
    }
  });

  it('keeps every feature in its own folder, away from the other features', () => {
    // The screens are built at the same time by different hands. A feature
    // may use the core, the vault doorway's folder, the shared pieces of
    // screen and the registry; it may never reach into another feature.
    const allowed = ['core', 'obsidian', 'ui', 'features/registry'];
    const folders = new Set(featureFiles.map((file) => relative(file).split('/').slice(0, 2).join('/')));
    expect([...folders].sort()).toEqual([
      'features/aihelper',
      'features/boards',
      'features/corkboard',
      'features/export',
      'features/modes',
      'features/outliner',
      'features/planner',
      'features/plotgrid',
      'features/progress',
      'features/prose',
      'features/report',
      'features/revision',
      'features/schemes',
      'features/scrivenings',
      'features/snapshots',
      'features/templates',
      'features/timeline',
      'features/welcome',
      'features/world',
    ]);
    for (const file of featureFiles) {
      const own = relative(file).split('/').slice(0, 2).join('/');
      for (const target of importsOf(codeOf(file), relative(file))) {
        const ok = within(target, own) || allowed.some((area) => within(target, area));
        expect(ok, `${relative(file)} must not import "${target}"`).toBe(true);
      }
    }
    // Nothing else in the plugin reaches into a feature, except the registry, which lists them.
    for (const file of allFiles) {
      if (featureFiles.includes(file) || relative(file) === 'features/registry.ts') continue;
      for (const target of importsOf(codeOf(file), relative(file))) {
        expect(within(target, 'features') && target !== 'features/registry', `${relative(file)} must not import "${target}"`).toBe(false);
      }
    }
    // The rule would catch a slip.
    const slip = importsOf("import { board } from '../corkboard/board';", 'features/planner/index.ts');
    expect(slip).toEqual(['features/corkboard/board']);
    expect(within(slip[0] ?? '', 'features/planner') || allowed.some((area) => within(slip[0] ?? '', area))).toBe(false);
    expect(allowed.some((area) => within('features/registry', area))).toBe(true);
    expect(allowed.some((area) => within('views/binderView', area))).toBe(false);
    expect(allowed.some((area) => within('main', area))).toBe(false);
  });

  it('lets a feature change the vault only through the store', () => {
    // A feature is handed the vault doorway to list notes, read them and
    // listen for changes. Everything that writes goes through the project
    // store, which checks what may be written.
    const writes = /\.\s*(updateFrontmatter|updateText|replaceText|createFile|createBinary|createFolder|rename|trash)\s*\(/;
    for (const file of featureFiles) {
      expect(writes.test(codeOf(file)), relative(file)).toBe(false);
    }
    expect(writes.test('await context.vault.updateFrontmatter(path, change);')).toBe(true);
    expect(writes.test('await context.store.updateNoteProperties(path, change);')).toBe(false);
    expect(writes.test('await context.store.updateDataFile(path, change);')).toBe(false);
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

  it('keeps what belongs to one device out of the synced plugin data', () => {
    // The open project and what is folded shut differ per device. They go
    // through app.loadLocalStorage / app.saveLocalStorage, in one file.
    for (const file of allFiles) {
      const code = codeOf(file);
      expect(/\.\s*(saveData|loadData)\s*\(/.test(code), `${relative(file)} must not use the plugin's synced data`).toBe(false);
      if (relative(file) === 'obsidian/deviceStorage.ts') continue;
      expect(/\b(loadLocalStorage|saveLocalStorage|localStorage)\b/.test(code), relative(file)).toBe(false);
    }
    const storage = codeOf(path.join(srcDir, 'obsidian', 'deviceStorage.ts'));
    expect(storage).toMatch(/app\s*\.\s*loadLocalStorage\(/);
    expect(storage).toMatch(/app\s*\.\s*saveLocalStorage\(/);
    expect(/\bwindow\s*\.\s*localStorage\b/.test(storage)).toBe(false); // Obsidian's per-vault storage, not the raw one
  });

  it('lets the browser scroll nothing but the plugin\'s own lists', () => {
    // element.scrollIntoView() may also shift whatever the list sits in, such
    // as a phone's side drawer. The views move their own scroll position instead.
    for (const file of allFiles) {
      expect(/\.\s*scrollIntoView\s*\(/.test(codeOf(file)), relative(file)).toBe(false);
    }
  });

  it('lets the views and windows change a project only through the store, never through the vault doorway', () => {
    // A button or a menu asks the project store for an intent (add, rename,
    // move, remove). It never reads or writes a note itself.
    const screenFiles = allFiles.filter((file) => /^(views|ui)\//.test(relative(file)));
    expect(screenFiles.length).toBeGreaterThanOrEqual(8);
    const doorway = /\bVaultPort\b|\b[vV]ault\s*\.\s*\w+\s*\(|\.\s*(updateFrontmatter|createFile|createBinary|createFolder|readText|readFrontmatter)\s*\(/;
    for (const file of screenFiles) {
      expect(doorway.test(codeOf(file)), relative(file)).toBe(false);
    }
    expect(doorway.test('await this.vault.trash(path);')).toBe(true);
    expect(doorway.test("await port.updateFrontmatter(path, () => true);")).toBe(true);
    expect(doorway.test('const path = store.vaultPathOf(rel);')).toBe(false); // asking the store where a note is, is fine
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

describe('the stylesheet is put together from one file per screen', () => {
  const stylesDir = path.join(repoRoot, STYLES_DIR);

  it('joins every file in src/styles, in a fixed order: what is shared first, then one file per screen', () => {
    expect([...STYLE_FILES]).toEqual([
      'base.css',
      'binder.css',
      'corkboard.css',
      'progress.css',
      'planner.css',
      'timeline.css',
      'outliner.css',
      'schemes.css',
      'modes.css',
      'report.css',
      'export.css',
      'prose.css',
      'scrivenings.css',
      'snapshots.css',
      'world.css',
      'plotgrid.css',
      'welcome.css',
      'templates.css',
      'boards.css',
      'revision.css',
    ]);
    // No stylesheet is left out, and none is listed that is not there.
    expect(readdirSync(stylesDir).filter((name) => name.endsWith('.css')).sort()).toEqual([...STYLE_FILES].sort());
    const whole = readStyles(repoRoot);
    let from = 0;
    for (const name of STYLE_FILES) {
      const text = readFileSync(path.join(stylesDir, name), 'utf8').trim();
      const at = whole.indexOf(text, from);
      expect(at, name).toBeGreaterThanOrEqual(from);
      from = at + text.length;
    }
    expect(whole).toMatch(/generated by the build/);
    expect(readStyles(repoRoot)).toBe(whole); // the same sources give the same stylesheet
  });

  it('joins the parts in the order given, each under a line that names its file', () => {
    const joined = joinStyles([
      { name: 'one.css', text: '.spellbook-a { color: var(--text-normal); }\n\n' },
      { name: 'two.css', text: '\n.spellbook-b { color: var(--text-muted); }' },
    ]);
    const lines = joined.split('\n').filter((line) => line.includes('spellbook-') || line.includes('====='));
    expect(lines).toEqual([
      '/* ===== src/styles/one.css ===== */',
      '.spellbook-a { color: var(--text-normal); }',
      '/* ===== src/styles/two.css ===== */',
      '.spellbook-b { color: var(--text-muted); }',
    ]);
    expect(joined.endsWith('}\n')).toBe(true);
  });

  it('keeps the generated stylesheet out of git', () => {
    expect(STYLES_OUTPUT).toBe('styles.css');
    const ignored = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8').split('\n').map((line) => line.trim());
    expect(ignored).toContain('/styles.css');
  });

  it('gives each screen a stylesheet of its own, so that screens built side by side never share a file', () => {
    for (const feature of ['corkboard', 'progress', 'planner', 'timeline', 'outliner', 'schemes', 'report', 'export', 'prose', 'scrivenings', 'snapshots', 'world', 'plotgrid', 'welcome', 'templates', 'boards', 'revision']) {
      expect(STYLE_FILES, feature).toContain(`${feature}.css`);
    }
  });
});

describe('the styles', () => {
  // Checked on the sources as the build joins them, so no build is needed first.
  const css = readStyles(repoRoot).replace(/\/\*[\s\S]*?\*\//g, '');
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

  it('names sides "start" and "end", never left and right, so that everything mirrors in a right-to-left app', () => {
    const physical = /\b(left|right)\b/;
    for (const rule of rules) {
      expect(physical.test(rule.body), `${rule.selectors.join(', ')} { ${rule.body.trim()} }`).toBe(false);
    }
    expect(physical.test('margin-left: 4px;')).toBe(true);
    expect(physical.test('text-align: right;')).toBe(true);
    expect(physical.test('float: left;')).toBe(true);
    expect(physical.test('margin-inline-start: 4px; text-align: start;')).toBe(false);
  });

  it('gives its own variables the plugin\'s prefix', () => {
    const declared = rules.flatMap((rule) => [...rule.body.matchAll(/(?:^|[;\s])(--[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ''));
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) expect(name.startsWith('--spellbook-'), name).toBe(true);
  });

  it('makes rows tall enough for a finger on touch screens, and only there', () => {
    expect(css).toMatch(/--spellbook-touch-target:\s*44px/);
    const touchRules = rules.filter((rule) => /min-height:\s*var\(--spellbook-touch-target\)/.test(rule.body));
    expect(touchRules.length).toBeGreaterThanOrEqual(2);
    // Every such rule is either inside the touch-screen media rule or asks for the mobile class.
    const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? '';
    expect(coarse).toMatch(/\.spellbook-row-self/);
    for (const rule of touchRules) {
      const guarded = rule.selectors.every((selector) => selector.includes('.spellbook-is-mobile')) || coarse.includes(rule.body);
      expect(guarded, rule.selectors.join(', ')).toBe(true);
    }
  });

  it('leaves room under the last row of the binder for the bar that floats over the bottom of a phone', () => {
    // Without it, the last rows lie under Obsidian's own bar and cannot be read or tapped.
    const selector = '.spellbook-binder.spellbook-is-phone .spellbook-binder-scroll';
    const rule = rules.find((candidate) => candidate.selectors.includes(selector));
    expect(rule?.body).toMatch(/padding-block-end:/);
    // Obsidian's own figures where it gives them, and the plugin's own as the least.
    expect(rule?.body).toMatch(/var\(--mobile-navbar-height, 0px\)/);
    expect(rule?.body).toMatch(/var\(--safe-area-inset-bottom, 0px\)/);
    expect(rule?.body).toMatch(/max\([^;]*var\(--spellbook-phone-bar-room\)/);
    expect(css).toMatch(/--spellbook-phone-bar-room:\s*80px/);
    // Only on a phone: the rule asks for the class that is set from Obsidian's own platform check.
    const padded = rules.filter((candidate) => /--spellbook-phone-bar-room\)/.test(candidate.body));
    expect(padded.map((candidate) => candidate.selectors)).toEqual([[selector]]);
  });

  it('keeps every word count at the end of its row, whatever the language of the title', () => {
    // The title has a direction of its own; the row around it must not get
    // one from the stylesheet, or a Hebrew title would send its count to the
    // other side.
    for (const rule of rules) {
      expect(/(^|[;\s])direction\s*:|unicode-bidi\s*:/.test(rule.body), rule.selectors.join(', ')).toBe(false);
    }
    const title = rules.find((candidate) => candidate.selectors.includes('.spellbook-binder .spellbook-title'));
    expect(title?.body).toMatch(/text-align:\s*start/);
    expect(title?.body).toMatch(/flex:\s*1 1 auto/);
    const count = rules.find((candidate) => candidate.selectors.includes('.spellbook-binder .spellbook-count-outer'));
    expect(count?.body).toMatch(/flex:\s*0 0 auto/);
  });

  it('never hides or reveals anything on hover alone', () => {
    // Hover may tint a row. It may not be the only way to see or reach
    // something. One thing does come into view on hover: the "more" button of
    // a row, with a mouse. That is allowed on three conditions, checked here:
    //   - the rule only applies where there is a mouse, and never on phones
    //     and tablets: on a touch screen the button is always there;
    //   - holding the keyboard's focus shows the button just as pointing does;
    //   - the button is only made see-through, so it can still be focused
    //     and pressed.
    const mouseOnly = [...css.matchAll(/@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{([\s\S]*?\})\s*\}/g)]
      .map((match) => match[1] ?? '')
      .join('\n');
    const changesWhatIsSeen = /\b(display|visibility|opacity|pointer-events)\s*:/;
    let exceptions = 0;
    for (const rule of rules) {
      if (!rule.selectors.some((selector) => selector.includes(':hover'))) continue;
      if (!changesWhatIsSeen.test(rule.body)) continue;
      exceptions++;
      const where = rule.selectors.join(', ');
      expect(rule.body.trim(), where).toBe('opacity: 0;');
      expect(mouseOnly.includes(rule.body), where).toBe(true);
      for (const selector of rule.selectors) {
        expect(selector, where).toContain(':not(.spellbook-is-mobile)');
        expect(selector, where).toContain(':not(:hover)');
        expect(selector, where).toContain(':not(:focus-within)');
        expect(selector.endsWith('> .spellbook-row-more'), where).toBe(true);
      }
    }
    expect(exceptions).toBe(1);
    // Nothing is made invisible anywhere else. (Dimmed is not invisible: a
    // row that is being dragged is at half strength, and can still be seen.)
    const invisible = /\b(opacity:\s*0(?![.\d])|visibility:\s*hidden\b)/;
    for (const rule of rules) {
      if (invisible.test(rule.body)) expect(mouseOnly.includes(rule.body), rule.selectors.join(', ')).toBe(true);
    }
    expect(changesWhatIsSeen.test('opacity: 0;')).toBe(true);
    expect(invisible.test('opacity: 0;')).toBe(true);
    expect(invisible.test('opacity:0')).toBe(true);
    expect(invisible.test('visibility: hidden;')).toBe(true);
    expect(invisible.test('opacity: 0.5;')).toBe(false);
  });

  it('keeps a finger that rests on a row from selecting its text or raising the phone\'s own bubble', () => {
    // A long press picks a row up (src/ui/dragDrop.ts). Without these, an
    // iPhone would also start a text selection and show its bubble.
    const row = rules.find((rule) => rule.selectors.includes('.spellbook-binder .spellbook-row > .spellbook-row-self'));
    expect(row?.body).toMatch(/-webkit-touch-callout:\s*none/);
    expect(row?.body).toMatch(/-webkit-user-select:\s*none/);
    expect(row?.body).toMatch(/[^-]user-select:\s*none/);
  });

  it('never lets the ghost of a dragged row, or the line that shows where it would go, take a tap', () => {
    for (const selector of ['.spellbook-drag-ghost', '.spellbook-drop-line']) {
      const rule = rules.find((candidate) => candidate.selectors.includes(selector));
      expect(rule?.body, selector).toMatch(/position:\s*fixed/);
      expect(rule?.body, selector).toMatch(/pointer-events:\s*none/);
    }
  });

  it('the checks themselves work', () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test('color: #fff;')).toBe(true);
    expect(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test('color: var(--text-normal);')).toBe(false);
    // Rules inside a media rule are checked like any other.
    expect(rules.some((rule) => rule.selectors.includes('.spellbook-binder .spellbook-row-self.is-clickable:hover'))).toBe(true);
  });
});
