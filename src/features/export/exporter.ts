// The work of an export, between the window and the project.
//
// It reads the scenes of the open project in binder order, has the core put
// the manuscript together and turn it into a file (src/core/export), and
// saves that as a new file in the project's Exports folder. The only thing
// it ever writes is that one new file, through the project store, which
// refuses every other place and never replaces a file. The scenes are read
// and nothing else: no note of the writer's is changed by an export.

import { readSceneFields } from '../../core/cards';
import {
  DEFAULT_EXPORT_OPTIONS,
  MAX_NAME_TRIES,
  buildManuscript,
  exportFileName,
  readExportOptions,
  scenesInScope,
  scopeChoices,
  scopeOf,
  toDocx,
  toHtml,
  toMarkdown,
  utf8,
} from '../../core/export';
import type { ExportFormat, ExportOptions, Manuscript, SceneSource, ScopeChoice } from '../../core/export';
import { joinPath, noteTitle, pathKey } from '../../core/paths';
import { EXPORTS_FOLDER } from '../../core/projectLayout';
import type { Frontmatter } from '../../core/types';
import { showInFileList } from '../../obsidian/fileList';
import type { FeatureContext } from '../registry';

/** Where this device keeps the choices of the last export. Never synced. */
export const OPTIONS_KEY = 'spellbook-export-options';

/** The project's own "author" property, when the writer has given the index note one. */
export const AUTHOR_KEY = 'author';

/** What the export window shows of the open project. */
export interface ExportProject {
  readonly indexPath: string;
  readonly title: string;
  /** The folders that can be exported by themselves, in binder order. */
  readonly folders: readonly ScopeChoice[];
}

/** How many scenes an export would take, as far as can be told without reading them. */
export interface ExportCount {
  /** Scenes that would be exported. */
  readonly scenes: number;
  /** Scenes left out because their "compile" switch is off. */
  readonly switchedOff: number;
  /** Scenes the binder lists that have no note. */
  readonly missing: number;
}

export type ExportOutcome =
  | {
      readonly status: 'done';
      readonly format: ExportFormat;
      /** The new file's vault path. */
      readonly path: string;
      /** The new file's path inside the project folder: "Exports/My Novel 2026-10-13.docx". */
      readonly rel: string;
      readonly scenes: number;
      readonly words: number;
      /** The titles of the scenes left out because their "compile" switch is off. */
      readonly switchedOff: readonly string[];
      /** The titles of the scenes left out because they have no note or could not be read. */
      readonly unread: readonly string[];
    }
  /** Nothing was written: there was nothing to export, or something went wrong. `message` says which. */
  | { readonly status: 'nothing' | 'failed'; readonly message: string };

export const NO_PROJECT_TEXT = 'Open a Spellbook project first: there is no manuscript to export.';
export const NOTHING_TEXT = 'There is nothing to export: no scene here is switched on for compiling and has text.';

/** The bytes of the file for a manuscript, in the format chosen. */
export function fileOf(manuscript: Manuscript, options: ExportOptions): Uint8Array {
  if (options.format === 'docx') return toDocx(manuscript, options);
  if (options.format === 'markdown') return utf8(toMarkdown(manuscript, options));
  return utf8(toHtml(manuscript, options, options.format === 'print'));
}

export class Exporter {
  private readonly context: FeatureContext;

  constructor(context: FeatureContext) {
    this.context = context;
  }

  /** The open project, or null when there is none. */
  project(): ExportProject | null {
    const project = this.context.store.project;
    if (!project) return null;
    return { indexPath: project.indexPath, title: project.title, folders: scopeChoices(project.tree) };
  }

  /**
   * The choices to start from: those of the last export on this device. The
   * folder is forgotten when the project no longer has it, and an author
   * that was never typed is taken from the project's own "author" property.
   */
  options(): ExportOptions {
    let saved: ExportOptions = DEFAULT_EXPORT_OPTIONS;
    let known = false;
    try {
      const stored = this.context.storage.load(OPTIONS_KEY);
      known = stored !== null && stored !== undefined;
      saved = readExportOptions(stored);
    } catch {
      // A storage that fails is ignored: the export starts from the defaults.
    }
    const project = this.context.store.project;
    const scope = project && saved.scope !== null && scopeOf(project.tree, saved.scope).folder ? saved.scope : null;
    const own = this.context.store.projectData(AUTHOR_KEY);
    const author = !known && typeof own === 'string' ? readExportOptions({ author: own }).author : saved.author;
    return { ...saved, scope, author };
  }

  /** Keep the choices for the next export on this device. */
  remember(options: ExportOptions): void {
    try {
      this.context.storage.save(OPTIONS_KEY, JSON.stringify(options));
    } catch {
      // The choices then last until the window closes.
    }
  }

  /** How many scenes an export of this part of the binder would take. Cheap: reads no files. */
  count(scope: string | null): ExportCount {
    const { store } = this.context;
    const project = store.project;
    if (!project) return { scenes: 0, switchedOff: 0, missing: 0 };
    const indexed = this.indexedProperties();
    let scenes = 0;
    let switchedOff = 0;
    let missing = 0;
    for (const scene of scenesInScope(project.tree, scope)) {
      if (scene.missing) missing++;
      else if (readSceneFields(indexed.get(pathKey(scene.path))).compile) scenes++;
      else switchedOff++;
    }
    return { scenes, switchedOff, missing };
  }

  /**
   * Export the manuscript of the open project: read its scenes, build the
   * file and save it as a new file in the Exports folder.
   */
  async run(options: ExportOptions): Promise<ExportOutcome> {
    const { store, vault, clock } = this.context;
    const project = store.project;
    if (!project) return { status: 'nothing', message: NO_PROJECT_TEXT };

    const indexed = this.indexedProperties();
    const sources = new Map<string, SceneSource>();
    for (const scene of scenesInScope(project.tree, options.scope)) {
      const vaultPath = scene.missing ? null : store.vaultPathOf(scene.path);
      if (vaultPath === null) continue;
      try {
        const text = await vault.readText(vaultPath);
        sources.set(scene.path, { text, compile: await this.compileOf(vaultPath, indexed.get(pathKey(scene.path))) });
      } catch (error) {
        // A scene that cannot be read is left out, and the writer is told which.
        console.error(`Spellbook: "${scene.path}" could not be read for the export`, error);
      }
    }

    const manuscript = buildManuscript({ title: project.title, tree: project.tree, options, scenes: sources });
    const scenes = manuscript.parts.filter((part) => part.kind === 'scene').length;
    if (scenes === 0) return { status: 'nothing', message: NOTHING_TEXT };

    let data: Uint8Array;
    try {
      data = fileOf(manuscript, options);
    } catch (error) {
      console.error('Spellbook: the export could not be put together', error);
      return { status: 'failed', message: `The export could not be put together: ${error instanceof Error ? error.message : String(error)}` };
    }

    const folder = scopeOf(project.tree, options.scope).folder?.name ?? null;
    const day = clock.today();
    for (let attempt = 1; attempt <= MAX_NAME_TRIES; attempt++) {
      const name = exportFileName(project.title, folder, options.format, day, attempt);
      // For the project that was read: refused when another one has been opened meanwhile.
      const saved = await store.createExportFile(name, data, project.indexPath);
      if (saved.status === 'done') {
        return {
          status: 'done',
          format: options.format,
          path: joinPath(project.folder, saved.value.path),
          rel: saved.value.path,
          scenes,
          words: manuscript.words,
          switchedOff: manuscript.switchedOff.map(noteTitle),
          unread: manuscript.unread.map(noteTitle),
        };
      }
      // A file of that name is there already: nothing is replaced, the next name is tried.
      if (saved.status === 'refused' && saved.reason === 'exists') continue;
      return { status: 'failed', message: saved.message };
    }
    return { status: 'failed', message: `The ${EXPORTS_FOLDER} folder already holds too many exports of today. Move some away and try again.` };
  }

  /**
   * Show an exported file. A Markdown export opens as a note, in a new tab;
   * a web page or a Word file is handed to Obsidian to open, which passes it
   * on to the device's own app for such files.
   */
  open(outcome: Extract<ExportOutcome, { status: 'done' }>): Promise<boolean> {
    return this.context.openNote(outcome.path, outcome.format === 'markdown' ? 'tab' : false).catch((error: unknown) => {
      console.error('Spellbook: the exported file could not be opened', error);
      return false;
    });
  }

  /**
   * Show where an exported file is: Obsidian's file list comes to the front
   * and points at it.
   *
   * @returns whether the file list could be shown
   */
  showInFolder(outcome: Extract<ExportOutcome, { status: 'done' }>): Promise<boolean> {
    return showInFileList(this.context.app, outcome.path);
  }

  /** The properties the vault has indexed for the notes of the open project, by path inside the project (see pathKey). */
  private indexedProperties(): Map<string, Readonly<Frontmatter> | null> {
    return new Map(this.context.store.projectNotes().map((note) => [pathKey(note.path), note.frontmatter]));
  }

  /**
   * A scene's "compile" switch, read from the note itself: the index may be
   * a moment behind when the switch has only just been flipped. When the
   * note's properties cannot be read, what the index holds decides.
   */
  private async compileOf(vaultPath: string, indexed: Readonly<Frontmatter> | null | undefined): Promise<boolean> {
    try {
      return readSceneFields(await this.context.vault.readFrontmatter(vaultPath)).compile;
    } catch {
      return readSceneFields(indexed).compile;
    }
  }
}
