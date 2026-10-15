// The work of an export, between the window and the project.
//
// It reads the scenes of the open project in binder order, has the core put
// the manuscript together and turn it into a file (src/core/export), and
// saves that as a new file in the project's Exports folder. The only thing
// it ever writes is that one new file, through the project store, which
// refuses every other place and never replaces a file. The scenes are read
// and nothing else: no note of the writer's is changed by an export.
//
// Besides the scenes it reads the notes the writer picks for the pages
// before and after the text, and, for an e-book, the picture picked for the
// cover. The window's choices are remembered on this device, for each
// project by itself.

import { readSceneFields } from '../../core/cards';
import {
  DEFAULT_EXPORT_OPTIONS,
  MATTER_KINDS,
  MAX_NAME_TRIES,
  buildManuscript,
  exportFileName,
  guessBookLanguage,
  isCoverPath,
  readExportOptions,
  readSceneExportChoices,
  scenesInScope,
  scopeChoices,
  scopeOf,
  toDocx,
  toEpub,
  toHtml,
  toMarkdown,
  utf8,
} from '../../core/export';
import type { BookLanguage, EpubCover, ExportFormat, ExportOptions, Manuscript, MatterKind, SceneSource, ScopeChoice } from '../../core/export';
import { isInside, joinPath, noteTitle, pathKey } from '../../core/paths';
import { AI_HELPER_FOLDER, EXPORTS_FOLDER, SNAPSHOTS_FOLDER, STATS_FOLDER } from '../../core/projectLayout';
import type { Frontmatter, TreeNode } from '../../core/types';
import { showInFileList } from '../../obsidian/fileList';
import type { FeatureContext } from '../registry';

/** Where this device keeps the choices of the last export, of whichever project. Never synced. */
export const OPTIONS_KEY = 'spellbook-export-options';

/** Where this device keeps the choices of the last export of each project, by the path of the project's index. Never synced. */
export const PROJECT_OPTIONS_KEY = 'spellbook-export-project-options';

/** The number of projects whose choices are kept; the one exported longest ago is forgotten first. */
export const MAX_REMEMBERED_PROJECTS = 30;

/** The project's own "author" property, when the writer has given the index note one. */
export const AUTHOR_KEY = 'author';

/** What the export window shows of the open project. */
export interface ExportProject {
  readonly indexPath: string;
  readonly title: string;
  /** The folders that can be exported by themselves, in binder order. */
  readonly folders: readonly ScopeChoice[];
}

/** A note of the project that the pages before and after the text can be taken from. */
export interface MatterNoteChoice {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
}

/** How many scenes an export would take, as far as can be told without reading them. */
export interface ExportCount {
  /** Scenes that would be exported. */
  readonly scenes: number;
  /** Scenes left out because their "compile" switch is off. */
  readonly switchedOff: number;
  /** Scenes the binder lists that have no note. */
  readonly missing: number;
  /** How many of `scenes` are notes that are whole chapters. Absent: none. */
  readonly chapters?: number;
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
      /** How many of `scenes` are notes that are whole chapters. Absent: none. */
      readonly chapters?: number;
      readonly words: number;
      /** The titles of the scenes left out because their "compile" switch is off. */
      readonly switchedOff: readonly string[];
      /** The titles of the scenes left out because they have no note or could not be read. */
      readonly unread: readonly string[];
      /** What did not go as chosen but did not stop the export (a cover that could not be read), in sentences. */
      readonly warnings: readonly string[];
    }
  /** Nothing was written: there was nothing to export, or something went wrong. `message` says which. */
  | { readonly status: 'nothing' | 'failed'; readonly message: string };

export const NO_PROJECT_TEXT = 'Open a Spellbook project first: there is no manuscript to export.';
export const NOTHING_TEXT = 'There is nothing to export: no scene here is switched on for compiling and has text.';

/** What the pages before and after the text are called in the window and in its messages. */
export const MATTER_NAMES: Readonly<Record<MatterKind, string>> = {
  dedication: 'Dedication',
  epigraph: 'Epigraph',
  acknowledgements: 'Acknowledgements',
  about: 'About the author',
};

/** The bytes of the file for a manuscript, in the format chosen. */
export function fileOf(manuscript: Manuscript, options: ExportOptions, extras: { cover?: EpubCover | null; day?: string } = {}): Uint8Array {
  if (options.format === 'docx') return toDocx(manuscript, options);
  if (options.format === 'epub') return toEpub(manuscript, options, { cover: extras.cover ?? null, modified: extras.day ?? '' });
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
   * The choices to start from: those of the last export of this project on
   * this device. A project not exported here before starts from the last
   * export of any project, without its folder, cover, pages before and
   * after the text and headings, and with the author from the project's own "author"
   * property when it has one. A folder, a cover or a note that is no longer
   * there is forgotten.
   */
  options(): ExportOptions {
    const project = this.context.store.project;
    let saved: ExportOptions = DEFAULT_EXPORT_OPTIONS;
    let ownSaved = false;
    let known = false;
    try {
      const mine = project ? this.rememberedProjects()[project.indexPath] : undefined;
      if (mine !== undefined) {
        saved = readExportOptions(mine);
        ownSaved = true;
      } else {
        const stored = this.context.storage.load(OPTIONS_KEY);
        known = stored !== null && stored !== undefined;
        const last = readExportOptions(stored);
        saved = { ...last, scope: null, cover: null, matter: DEFAULT_EXPORT_OPTIONS.matter, headings: DEFAULT_EXPORT_OPTIONS.headings };
      }
    } catch {
      // A storage that fails is ignored: the export starts from the defaults.
    }
    const scope = project && saved.scope !== null && scopeOf(project.tree, saved.scope).folder ? saved.scope : null;
    const own = this.context.store.projectData(AUTHOR_KEY);
    const author = !ownSaved && (!known || saved.author === '') && typeof own === 'string' ? readExportOptions({ author: own }).author : saved.author;
    const cover = saved.cover !== null && this.coverChoices().includes(saved.cover) ? saved.cover : null;
    const notes = new Set(this.noteChoices().map((note) => pathKey(note.path)));
    const matter = { ...saved.matter };
    for (const kind of MATTER_KINDS) {
      const choice = matter[kind];
      if (choice.note !== null && !notes.has(pathKey(choice.note))) matter[kind] = { ...choice, from: choice.from === 'note' ? 'none' : choice.from, note: null };
    }
    return { ...saved, scope, author, cover, matter };
  }

  /** Keep the choices for the next export of this project on this device, and as the starting point for other projects. */
  remember(options: ExportOptions): void {
    try {
      this.context.storage.save(OPTIONS_KEY, JSON.stringify(options));
      const project = this.context.store.project;
      if (!project) return;
      const all = this.rememberedProjects();
      // The project goes to the end: the most recent last, the oldest forgotten first.
      delete all[project.indexPath];
      all[project.indexPath] = options;
      const keys = Object.keys(all);
      for (const key of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_PROJECTS))) delete all[key];
      this.context.storage.save(PROJECT_OPTIONS_KEY, JSON.stringify(all));
    } catch {
      // The choices then last until the window closes.
    }
  }

  /**
   * The pictures that can be the cover of an e-book: those of the vault that
   * an EPUB can hold, the ones inside the project's folder first. Reads no files.
   */
  coverChoices(): string[] {
    const project = this.context.store.project;
    const pictures = this.context.vault.listImageFiles().filter(isCoverPath);
    if (!project) return pictures;
    const inside = pictures.filter((path) => isInside(project.folder, path));
    return [...inside, ...pictures.filter((path) => !isInside(project.folder, path))];
  }

  /**
   * The notes of the project the pages before and after the text can be
   * taken from: all of them, except the plugin's own (word logs, snapshots,
   * exports and the AI helper note). Reads no files.
   */
  noteChoices(): MatterNoteChoice[] {
    const own = [STATS_FOLDER, SNAPSHOTS_FOLDER, EXPORTS_FOLDER, AI_HELPER_FOLDER];
    return this.context.store
      .projectNotes()
      .filter((note) => !own.some((folder) => isInside(folder, note.path)))
      .map((note) => ({ path: note.path, title: noteTitle(note.path) }));
  }

  /**
   * The language the book's usual headings are likely in, guessed from the
   * names of the project, its chapters and its scenes. Reads no files: the
   * export itself decides from the text.
   */
  language(): BookLanguage {
    const project = this.context.store.project;
    if (!project) return 'en';
    const names: string[] = [project.title];
    const walk = (nodes: readonly TreeNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'folder') {
          names.push(node.name);
          walk(node.children);
        } else names.push(node.title);
      }
    };
    walk(project.tree);
    return guessBookLanguage(names);
  }

  /** The choices of every project, as they were saved on this device. */
  private rememberedProjects(): Record<string, unknown> {
    const stored = this.context.storage.load(PROJECT_OPTIONS_KEY);
    let value: unknown = stored;
    if (typeof stored === 'string') {
      try {
        value = JSON.parse(stored) as unknown;
      } catch {
        value = null;
      }
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return { ...(value as Record<string, unknown>) };
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
    let chapters = 0;
    for (const scene of scenesInScope(project.tree, scope)) {
      if (scene.missing) missing++;
      else if (readSceneFields(indexed.get(pathKey(scene.path))).compile) {
        scenes++;
        if (scene.chapter === true) chapters++;
      } else switchedOff++;
    }
    return chapters > 0 ? { scenes, switchedOff, missing, chapters } : { scenes, switchedOff, missing };
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
        const properties = await this.propertiesOf(vaultPath, indexed.get(pathKey(scene.path)));
        const own = readSceneExportChoices(properties);
        sources.set(scene.path, { text, compile: readSceneFields(properties).compile, pageBreak: own.pageBreak, title: own.title });
      } catch (error) {
        // A scene that cannot be read is left out, and the writer is told which.
        console.error(`Spellbook: "${scene.path}" could not be read for the export`, error);
      }
    }

    const warnings: string[] = [];
    const matter = new Map<MatterKind, string>();
    for (const kind of MATTER_KINDS) {
      const choice = options.matter[kind];
      if (choice.from === 'typed') {
        if (choice.text.trim() !== '') matter.set(kind, choice.text);
        continue;
      }
      if (choice.from !== 'note' || choice.note === null) continue;
      const vaultPath = store.vaultPathOf(choice.note);
      try {
        if (vaultPath === null) throw new Error('there is no such note in the project');
        matter.set(kind, await vault.readText(vaultPath));
      } catch (error) {
        console.error(`Spellbook: "${choice.note}" could not be read for the export`, error);
        warnings.push(`${MATTER_NAMES[kind]} left out: the note "${noteTitle(choice.note)}" could not be read.`);
      }
    }

    const manuscript = buildManuscript({ title: project.title, tree: project.tree, options, scenes: sources, matter });
    const chapterNotes = new Set(manuscript.parts.flatMap((part) => (part.kind === 'chapter' && part.note !== undefined ? [part.note] : [])));
    const scenes = manuscript.parts.filter((part) => part.kind === 'scene' && !chapterNotes.has(part.path)).length + chapterNotes.size;
    if (manuscript.parts.every((part) => part.kind !== 'scene')) return { status: 'nothing', message: NOTHING_TEXT };
    for (const kind of MATTER_KINDS) {
      if (matter.has(kind) && ![...manuscript.front, ...manuscript.back].some((part) => part.role === kind)) {
        warnings.push(`${MATTER_NAMES[kind]} left out: it has no text.`);
      }
    }

    let cover: EpubCover | null = null;
    if (options.format === 'epub' && options.cover !== null) {
      try {
        if (!isCoverPath(options.cover) || !vault.exists(options.cover)) throw new Error('there is no such picture');
        cover = { data: await vault.readBinary(options.cover), extension: options.cover.slice(options.cover.lastIndexOf('.') + 1).toLowerCase() };
      } catch (error) {
        console.error(`Spellbook: the cover "${options.cover}" could not be read`, error);
        warnings.push('The cover picture could not be read, so the book has no cover.');
      }
    }

    const day = clock.today();
    let data: Uint8Array;
    try {
      data = fileOf(manuscript, options, { cover, day });
    } catch (error) {
      console.error('Spellbook: the export could not be put together', error);
      return { status: 'failed', message: `The export could not be put together: ${error instanceof Error ? error.message : String(error)}` };
    }

    const folder = scopeOf(project.tree, options.scope).folder?.name ?? null;
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
          ...(chapterNotes.size > 0 ? { chapters: chapterNotes.size } : {}),
          words: manuscript.words,
          switchedOff: manuscript.switchedOff.map(noteTitle),
          unread: manuscript.unread.map(noteTitle),
          warnings,
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
   * a web page, a Word file or an e-book is handed to Obsidian to open, which
   * passes it on to the device's own app for such files.
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
   * A scene's properties ("compile", "export-page-break", "export-title"),
   * read from the note itself: the index may be a moment behind when a
   * switch has only just been flipped. When the note's properties cannot be
   * read, what the index holds decides.
   */
  private async propertiesOf(vaultPath: string, indexed: Readonly<Frontmatter> | null | undefined): Promise<Readonly<Frontmatter> | null | undefined> {
    try {
      return await this.context.vault.readFrontmatter(vaultPath);
    } catch {
      return indexed;
    }
  }
}
