// Putting the manuscript together for an export: the scenes of the binder in
// their order, the folders around them as chapters, and the scenes whose
// "compile" switch is off left out.
//
// Nothing here reads a file. The texts of the scenes are handed in, and what
// comes out is the manuscript as a list of parts that each of the three
// writers (Markdown, web page, Word) turns into a file.

import type { TreeNode } from '../types';
import { countPlainWords } from '../wordCount';
import { directionOf } from './direction';
import type { Direction } from './direction';
import { manuscriptText, parseBlocks, plainTextOfBlocks } from './markdown';
import type { Block } from './markdown';

export type ExportFormat = 'docx' | 'html' | 'markdown' | 'print';
export type PaperId = 'a4' | 'letter';

/** What the writer chooses in the export window. */
export interface ExportOptions {
  /** 'print' is the web page laid out for printing, with a Print button on it: the way to a PDF. */
  readonly format: ExportFormat;
  /** The id of the binder folder to export, or null for the whole manuscript. */
  readonly scope: string | null;
  /** A first page with the title, the author and the number of words. */
  readonly titlePage: boolean;
  /** "Author / Title / page number" at the top of every page (Word, and a printed web page). */
  readonly header: boolean;
  /** A list of the chapters after the title page. */
  readonly contents: boolean;
  /** Print each scene's title above it. When off, scenes are set apart by a line with a # on it. */
  readonly sceneTitles: boolean;
  readonly author: string;
  readonly paper: PaperId;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = Object.freeze({
  format: 'docx',
  scope: null,
  titlePage: true,
  header: true,
  contents: false,
  sceneTitles: false,
  author: '',
  paper: 'a4',
});

export const EXPORT_FORMATS: readonly ExportFormat[] = ['docx', 'html', 'markdown', 'print'];
export const PAPERS: readonly PaperId[] = ['a4', 'letter'];

/** The sizes of paper, in twentieths of a point (1440 to the inch), as Word counts them. */
export const PAPER_SIZES: Readonly<Record<PaperId, { readonly width: number; readonly height: number; readonly css: string }>> = {
  a4: { width: 11906, height: 16838, css: 'A4' },
  letter: { width: 12240, height: 15840, css: 'letter' },
};

/** One inch of margin on every side: the standard for a manuscript. */
export const MARGIN_TWIPS = 1440;

/** The mark printed between two scenes. */
export const SCENE_BREAK_MARK = '#';

/**
 * The options as they were saved on this device, made whole and safe:
 * whatever is missing or of the wrong kind takes its default. `saved` may be
 * anything (the text that was stored, or what an older version stored).
 */
export function readExportOptions(saved: unknown): ExportOptions {
  let source: unknown = saved;
  if (typeof saved === 'string') {
    try {
      source = JSON.parse(saved) as unknown;
    } catch {
      source = null;
    }
  }
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return DEFAULT_EXPORT_OPTIONS;
  const given = source as Record<string, unknown>;
  const flag = (key: 'titlePage' | 'header' | 'contents' | 'sceneTitles'): boolean =>
    typeof given[key] === 'boolean' ? (given[key] as boolean) : DEFAULT_EXPORT_OPTIONS[key];
  return {
    format: EXPORT_FORMATS.includes(given['format'] as ExportFormat) ? (given['format'] as ExportFormat) : DEFAULT_EXPORT_OPTIONS.format,
    scope: typeof given['scope'] === 'string' && given['scope'] !== '' ? given['scope'] : null,
    titlePage: flag('titlePage'),
    header: flag('header'),
    contents: flag('contents'),
    sceneTitles: flag('sceneTitles'),
    author: typeof given['author'] === 'string' ? given['author'].replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    paper: PAPERS.includes(given['paper'] as PaperId) ? (given['paper'] as PaperId) : DEFAULT_EXPORT_OPTIONS.paper,
  };
}

// ------------------------------------------------------------- what to read

/** A scene of the binder that an export would look at. */
export interface ScopedScene {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
  /** True when the binder lists the scene but it has no note. */
  readonly missing: boolean;
}

type FolderNode = Extract<TreeNode, { kind: 'folder' }>;

function findFolder(tree: readonly TreeNode[], id: string): FolderNode | null {
  for (const node of tree) {
    if (node.kind !== 'folder') continue;
    if (node.id === id) return node;
    const inner = findFolder(node.children, id);
    if (inner) return inner;
  }
  return null;
}

/**
 * The part of the binder an export covers: the whole of it, or one folder
 * (which then stands at the top, as a chapter). A folder that is no longer
 * there gives the whole binder.
 */
export function scopeOf(tree: readonly TreeNode[], scope: string | null): { readonly nodes: readonly TreeNode[]; readonly folder: FolderNode | null } {
  const folder = scope === null ? null : findFolder(tree, scope);
  return folder ? { nodes: [folder], folder } : { nodes: tree, folder: null };
}

/** The scenes an export covers, in manuscript order. */
export function scenesInScope(tree: readonly TreeNode[], scope: string | null): ScopedScene[] {
  const scenes: ScopedScene[] = [];
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'scene') scenes.push({ path: node.path, title: node.title, missing: node.missing });
      else walk(node.children);
    }
  };
  walk(scopeOf(tree, scope).nodes);
  return scenes;
}

/** A folder that can be chosen in the export window. */
export interface ScopeChoice {
  readonly id: string;
  readonly name: string;
  /** 0 for a folder at the top of the binder. */
  readonly depth: number;
}

/** Every folder of the binder that holds at least one scene, in binder order. */
export function scopeChoices(tree: readonly TreeNode[]): ScopeChoice[] {
  const choices: ScopeChoice[] = [];
  const walk = (nodes: readonly TreeNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      if (scenesInScope([node], null).length > 0) choices.push({ id: node.id, name: node.name, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return choices;
}

// ----------------------------------------------------------- the manuscript

/** A scene as it was read for the export. */
export interface SceneSource {
  /** The whole note, properties block and all. */
  readonly text: string;
  /** The scene's "compile" switch. */
  readonly compile: boolean;
}

/** A chapter heading: the name of a binder folder. Every chapter starts on a new page. */
export interface ChapterPart {
  readonly kind: 'chapter';
  /** A name for linking to it from the list of contents: "part-3". */
  readonly id: string;
  readonly title: string;
  /** 1 for a folder at the top, 2 for a folder inside it, and so on. */
  readonly level: number;
  readonly direction: Direction;
}

export interface ScenePart {
  readonly kind: 'scene';
  readonly id: string;
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
  /** The heading level its title has when titles are printed: one below its chapter's. */
  readonly level: number;
  readonly direction: Direction;
  /**
   * How the scene begins: 'first' straight after a chapter heading or at the
   * very start; 'break' after the scene before it, set apart by the scene
   * break; 'page' on a new page, for a scene that follows a chapter without
   * being part of it.
   */
  readonly opens: 'first' | 'break' | 'page';
  readonly blocks: readonly Block[];
  /** The scene's text as Markdown, without properties and comments. */
  readonly markdown: string;
}

export type ManuscriptPart = ChapterPart | ScenePart;

export interface Manuscript {
  readonly title: string;
  readonly author: string;
  /** The direction most of the text runs in; what has no direction of its own follows it. */
  readonly direction: Direction;
  /** The words in the exported scenes. */
  readonly words: number;
  readonly parts: readonly ManuscriptPart[];
  /** The scenes that were exported, in order, as paths relative to the project folder. */
  readonly included: readonly string[];
  /** The scenes left out because their "compile" switch is off. */
  readonly switchedOff: readonly string[];
  /** The scenes left out because they have no note, or their note could not be read. */
  readonly unread: readonly string[];
}

export interface ManuscriptInput {
  readonly title: string;
  readonly tree: readonly TreeNode[];
  readonly options: Pick<ExportOptions, 'scope' | 'author' | 'sceneTitles'>;
  /** The scenes that were read, by their path relative to the project folder. A scene that is not here is left out as unread. */
  readonly scenes: ReadonlyMap<string, SceneSource>;
}

/** Put the manuscript together: see the top of this file. */
export function buildManuscript(input: ManuscriptInput): Manuscript {
  const { options, scenes } = input;
  const included: string[] = [];
  const switchedOff: string[] = [];
  const unread: string[] = [];
  let words = 0;
  let rtlBlocks = 0;
  let ltrBlocks = 0;
  let nextId = 1;

  // The first pass leaves directions open (null) where the text has none; they are filled in at the end.
  type Draft =
    | (Omit<ChapterPart, 'direction'> & { direction: Direction | null })
    | (Omit<ScenePart, 'direction' | 'opens'> & { direction: Direction | null; opens: ScenePart['opens'] });

  const walk = (nodes: readonly TreeNode[], level: number): Draft[] => {
    const parts: Draft[] = [];
    let fresh = true;
    let afterChapter = false;
    for (const node of nodes) {
      if (node.kind === 'folder') {
        const id = `part-${nextId++}`;
        const inner = walk(node.children, level + 1);
        // A folder with nothing to print in it leaves no heading behind.
        if (!inner.some((part) => part.kind === 'scene')) continue;
        parts.push({ kind: 'chapter', id, title: node.name, level, direction: directionOf(node.name) }, ...inner);
        afterChapter = true;
        fresh = false;
        continue;
      }
      const source = node.missing ? undefined : scenes.get(node.path);
      if (!source) {
        unread.push(node.path);
        continue;
      }
      if (!source.compile) {
        switchedOff.push(node.path);
        continue;
      }
      const markdown = manuscriptText(source.text).trim();
      const blocks = parseBlocks(markdown);
      included.push(node.path);
      // A scene with no text yet has nothing to print, unless its title is printed.
      if (blocks.length === 0 && !options.sceneTitles) continue;
      words += countPlainWords(plainTextOfBlocks(blocks));
      for (const block of blocks) {
        if (block.kind === 'break' || block.kind === 'code') continue;
        if (block.direction === 'rtl') rtlBlocks++;
        else if (block.direction === 'ltr') ltrBlocks++;
      }
      parts.push({
        kind: 'scene',
        id: `part-${nextId++}`,
        path: node.path,
        title: node.title,
        level,
        direction: directionOf(node.title),
        opens: afterChapter ? 'page' : fresh ? 'first' : 'break',
        blocks,
        markdown,
      });
      afterChapter = false;
      fresh = false;
    }
    return parts;
  };

  const drafts = walk(scopeOf(input.tree, options.scope).nodes, 1);
  const direction: Direction = rtlBlocks > ltrBlocks ? 'rtl' : 'ltr';
  const parts = drafts.map((part): ManuscriptPart => ({ ...part, direction: part.direction ?? direction }));
  return {
    title: input.title,
    author: options.author.replace(/\s+/g, ' ').trim(),
    direction,
    words,
    parts,
    included,
    switchedOff,
    unread,
  };
}

// ------------------------------------------------------------ small pieces

/** The entries of the list of contents: the chapters, and the scenes too when their titles are printed. */
export function contentsOf(manuscript: Manuscript, sceneTitles: boolean): ManuscriptPart[] {
  return manuscript.parts.filter((part) => part.kind === 'chapter' || sceneTitles);
}

/**
 * A number of words as a title page gives it: rounded, because nobody
 * counts a novel to the word. To the nearest 100 up to 10,000 words, to the
 * nearest 1,000 above; a text under 100 words keeps its exact count.
 */
export function roundWords(words: number): number {
  if (words < 100) return Math.max(0, Math.round(words));
  const step = words < 10000 ? 100 : 1000;
  return Math.round(words / step) * step;
}

function grouped(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+$)/g, ',');
}

/** The line of the title page that gives the number of words: "about 80,000 words". */
export function wordsLine(words: number): string {
  const rounded = roundWords(words);
  if (rounded === 1) return '1 word';
  return words < 100 ? `${rounded} words` : `about ${grouped(rounded)} words`;
}

/**
 * The line at the top of every page, without the page number that follows
 * it: "Surname / Title / ". The surname is the last word of the author's
 * name; with no author it is "Title / ".
 */
export function headerText(manuscript: Pick<Manuscript, 'title' | 'author'>): string {
  const surname = manuscript.author.split(' ').filter((word) => word !== '').pop() ?? '';
  return surname === '' ? `${manuscript.title} / ` : `${surname} / ${manuscript.title} / `;
}
