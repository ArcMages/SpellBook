// Putting the manuscript together for an export: the scenes of the binder in
// their order, the folders around them as chapters, and the scenes whose
// "compile" switch is off left out.
//
// Nothing here reads a file. The texts of the scenes are handed in, and what
// comes out is the manuscript as a list of parts that each of the three
// writers (Markdown, web page, Word, e-book) turns into a file, with the
// pages before and after the text (dedication, epigraph, acknowledgements,
// about the author) and the presets that decide how the pages look.

import type { TreeNode } from '../types';
import { countPlainWords } from '../wordCount';
import { directionOf, looksArabic } from './direction';
import type { Direction } from './direction';
import { manuscriptText, parseBlocks, parseInline, plainText, plainTextOfBlocks } from './markdown';
import type { Block } from './markdown';

export type ExportFormat = 'docx' | 'epub' | 'html' | 'markdown' | 'print';
export type PaperId = 'a4' | 'letter';

/**
 * The three ways a manuscript can be laid out:
 *   manuscript  "Manuscript for an agent": the standard manuscript format
 *   reading     "Reading copy": like a book, no double spacing, a row of stars between scenes
 *   proof       "Proof": wide margins to write notes in, numbered lines in Word
 */
export type PresetId = 'manuscript' | 'reading' | 'proof';

/** The pages that can stand before and after the text. */
export type MatterKind = 'dedication' | 'epigraph' | 'acknowledgements' | 'about';

/** Where one of those pages takes its text from. */
export interface MatterChoice {
  /** 'none': no such page; 'typed': the text typed in the window; 'note': the text of a note of the project. */
  readonly from: 'none' | 'typed' | 'note';
  readonly text: string;
  /** The note's path relative to the project folder. */
  readonly note: string | null;
}

/** What the writer chooses in the export window. */
export interface ExportOptions {
  /** 'print' is the web page laid out for printing, with a Print button on it: the way to a PDF. */
  readonly format: ExportFormat;
  readonly preset: PresetId;
  /** The id of the binder folder to export, or null for the whole manuscript. */
  readonly scope: string | null;
  /** A first page with the title, the author and the number of words. */
  readonly titlePage: boolean;
  /** "Author / Title / page number" at the top of every page (Word, and a printed web page). */
  readonly header: boolean;
  /** A list of the chapters after the title page. */
  readonly contents: boolean;
  /** Print each scene's title above it. When off, scenes are set apart by the scene break. */
  readonly sceneTitles: boolean;
  readonly author: string;
  readonly paper: PaperId;
  /** The picture on the cover of an e-book, as a vault path; null for none. */
  readonly cover: string | null;
  readonly matter: Readonly<Record<MatterKind, MatterChoice>>;
  /**
   * The headings the writer typed for the book's own pages ("Contents",
   * "About the Author" and the rest). A heading that is not here takes the
   * usual word in the book's language.
   */
  readonly headings: HeadingChoices;
}

/** The headings an exported book writes by itself: its list of contents, the pages before and after the text, and the e-book's menu entries. */
export type HeadingKey = 'contents' | 'cover' | 'titlePage' | 'start' | MatterKind;

/** The headings the writer typed, by what they head. Only those typed are here. */
export type HeadingChoices = Readonly<Partial<Record<HeadingKey, string>>>;

/** The headings in the order the export window lists them. */
export const HEADING_KEYS: readonly HeadingKey[] = ['contents', 'dedication', 'epigraph', 'acknowledgements', 'about', 'cover', 'titlePage', 'start'];

/** The longest heading the writer may type, in characters. */
export const MAX_HEADING_TEXT = 200;

/** A heading as the writer typed it, on one line and trimmed; '' for one not given. */
export function cleanHeading(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_HEADING_TEXT).trim() : '';
}

/** The headings the writer typed, made safe: what is empty or not text is left out. */
export function readHeadingChoices(value: unknown): HeadingChoices {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const given = value as Record<string, unknown>;
  const headings: Partial<Record<HeadingKey, string>> = {};
  for (const key of HEADING_KEYS) {
    const heading = cleanHeading(given[key]);
    if (heading !== '') headings[key] = heading;
  }
  return headings;
}

/** What a preset sets: how the pages look, and where the switches of the window start. */
export interface Preset {
  readonly id: PresetId;
  /** Lines of text in a line's height: 2 is double spacing. */
  readonly lineSpacing: number;
  /** What stands between two scenes. */
  readonly sceneBreak: string;
  /** The margins, in inches. "side" is both the left and the right. */
  readonly margins: { readonly top: number; readonly bottom: number; readonly side: number };
  /** Lines set flush with both margins, as in a printed book. */
  readonly justify: boolean;
  /** Numbered lines down the margin: only Word can do this. */
  readonly lineNumbers: boolean;
  /** "about 80,000 words" on the title page. */
  readonly wordsOnTitlePage: boolean;
  /** Chapter titles set larger than the text. */
  readonly largeChapterTitles: boolean;
  /** Where the switches of the window are set when the preset is chosen. */
  readonly switches: Pick<ExportOptions, 'titlePage' | 'header' | 'contents' | 'sceneTitles'>;
}

/** The mark printed between two scenes in a manuscript. */
export const SCENE_BREAK_MARK = '#';

/** The mark between two scenes in a book: three stars. */
export const BOOK_SCENE_BREAK = '* * *';

export const PRESETS: Readonly<Record<PresetId, Preset>> = {
  manuscript: {
    id: 'manuscript',
    lineSpacing: 2,
    sceneBreak: SCENE_BREAK_MARK,
    margins: { top: 1, bottom: 1, side: 1 },
    justify: false,
    lineNumbers: false,
    wordsOnTitlePage: true,
    largeChapterTitles: false,
    switches: { titlePage: true, header: true, contents: false, sceneTitles: false },
  },
  reading: {
    id: 'reading',
    lineSpacing: 1.4,
    sceneBreak: BOOK_SCENE_BREAK,
    margins: { top: 1, bottom: 1, side: 1 },
    justify: true,
    lineNumbers: false,
    wordsOnTitlePage: false,
    largeChapterTitles: true,
    switches: { titlePage: true, header: false, contents: true, sceneTitles: false },
  },
  proof: {
    id: 'proof',
    lineSpacing: 2,
    sceneBreak: SCENE_BREAK_MARK,
    margins: { top: 1, bottom: 1, side: 2 },
    justify: false,
    lineNumbers: true,
    wordsOnTitlePage: true,
    largeChapterTitles: false,
    switches: { titlePage: true, header: true, contents: false, sceneTitles: true },
  },
};

export const PRESET_IDS: readonly PresetId[] = ['manuscript', 'reading', 'proof'];
export const MATTER_KINDS: readonly MatterKind[] = ['dedication', 'epigraph', 'acknowledgements', 'about'];
/** The pages before the text, and those after it. */
export const FRONT_MATTER: readonly MatterKind[] = ['dedication', 'epigraph'];
export const BACK_MATTER: readonly MatterKind[] = ['acknowledgements', 'about'];

/** The most text one of those pages may have typed in the window, in characters. */
export const MAX_MATTER_TEXT = 20000;

const NO_MATTER: MatterChoice = Object.freeze({ from: 'none', text: '', note: null });

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = Object.freeze({
  format: 'docx',
  preset: 'manuscript',
  scope: null,
  ...PRESETS.manuscript.switches,
  author: '',
  paper: 'a4',
  cover: null,
  matter: Object.freeze({ dedication: NO_MATTER, epigraph: NO_MATTER, acknowledgements: NO_MATTER, about: NO_MATTER }),
  headings: Object.freeze({}),
});

export const EXPORT_FORMATS: readonly ExportFormat[] = ['docx', 'epub', 'html', 'markdown', 'print'];
export const PAPERS: readonly PaperId[] = ['a4', 'letter'];

/** The sizes of paper, in twentieths of a point (1440 to the inch), as Word counts them. */
export const PAPER_SIZES: Readonly<Record<PaperId, { readonly width: number; readonly height: number; readonly css: string }>> = {
  a4: { width: 11906, height: 16838, css: 'A4' },
  letter: { width: 12240, height: 15840, css: 'letter' },
};

/** One inch, in twentieths of a point. One inch of margin on every side is the standard for a manuscript. */
export const MARGIN_TWIPS = 1440;

function readMatterChoice(value: unknown): MatterChoice {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return NO_MATTER;
  const given = value as Record<string, unknown>;
  const from = given['from'] === 'typed' || given['from'] === 'note' ? given['from'] : 'none';
  const text = typeof given['text'] === 'string' ? given['text'].replace(/\r\n?/g, '\n').slice(0, MAX_MATTER_TEXT) : '';
  const note = typeof given['note'] === 'string' && given['note'] !== '' ? given['note'] : null;
  return { from, text, note };
}

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
  const preset = PRESET_IDS.includes(given['preset'] as PresetId) ? (given['preset'] as PresetId) : DEFAULT_EXPORT_OPTIONS.preset;
  const switches = PRESETS[preset].switches;
  const flag = (key: 'titlePage' | 'header' | 'contents' | 'sceneTitles'): boolean =>
    typeof given[key] === 'boolean' ? (given[key] as boolean) : switches[key];
  const matterGiven = typeof given['matter'] === 'object' && given['matter'] !== null ? (given['matter'] as Record<string, unknown>) : {};
  return {
    format: EXPORT_FORMATS.includes(given['format'] as ExportFormat) ? (given['format'] as ExportFormat) : DEFAULT_EXPORT_OPTIONS.format,
    preset,
    scope: typeof given['scope'] === 'string' && given['scope'] !== '' ? given['scope'] : null,
    titlePage: flag('titlePage'),
    header: flag('header'),
    contents: flag('contents'),
    sceneTitles: flag('sceneTitles'),
    author: typeof given['author'] === 'string' ? given['author'].replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    paper: PAPERS.includes(given['paper'] as PaperId) ? (given['paper'] as PaperId) : DEFAULT_EXPORT_OPTIONS.paper,
    cover: typeof given['cover'] === 'string' && given['cover'] !== '' ? given['cover'] : null,
    matter: {
      dedication: readMatterChoice(matterGiven['dedication']),
      epigraph: readMatterChoice(matterGiven['epigraph']),
      acknowledgements: readMatterChoice(matterGiven['acknowledgements']),
      about: readMatterChoice(matterGiven['about']),
    },
    headings: readHeadingChoices(given['headings']),
  };
}

/** The options with a preset chosen: its look, and its switches where they start. */
export function withPreset(options: ExportOptions, preset: PresetId): ExportOptions {
  return { ...options, preset, ...PRESETS[preset].switches };
}

// --------------------------------------------------------- per-scene choices

/** The scene property that starts a scene on a new page. */
export const PAGE_BREAK_KEY = 'export-page-break';
/** The scene property that prints, or hides, a scene's title whatever the window says. */
export const TITLE_KEY = 'export-title';

function yesNo(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const word = value.trim().toLowerCase();
    if (word === 'true' || word === 'yes') return true;
    if (word === 'false' || word === 'no') return false;
  }
  return null;
}

/** A scene's own export choices, read from its properties. Anything not true or false counts as not given. */
export function readSceneExportChoices(frontmatter: Readonly<Record<string, unknown>> | null | undefined): {
  readonly pageBreak: boolean;
  readonly title: boolean | null;
} {
  return { pageBreak: yesNo(frontmatter?.[PAGE_BREAK_KEY]) === true, title: yesNo(frontmatter?.[TITLE_KEY]) };
}

// ------------------------------------------------------------- what to read

/** A scene of the binder that an export would look at. */
export interface ScopedScene {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
  /** True when the binder lists the scene but it has no note. */
  readonly missing: boolean;
  /** True for a note that is a whole chapter. */
  readonly chapter?: boolean;
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
      if (node.kind === 'scene') {
        scenes.push({ path: node.path, title: node.title, missing: node.missing, ...(node.chapter === true ? { chapter: true } : {}) });
      }
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
  /** The scene's "export-page-break": start it on a new page. */
  readonly pageBreak?: boolean;
  /** The scene's "export-title": print its title (true), never (false), or as the window says (null, absent). */
  readonly title?: boolean | null;
}

/**
 * A chapter heading: the name of a binder folder, or the title of a note
 * that is a whole chapter by itself. Every chapter starts on a new page.
 */
export interface ChapterPart {
  readonly kind: 'chapter';
  /** A name for linking to it from the list of contents: "part-3". */
  readonly id: string;
  readonly title: string;
  /** 1 for a folder (or chapter note) at the top, 2 for one inside a folder, and so on. */
  readonly level: number;
  readonly direction: Direction;
  /**
   * Set for the heading of a chapter note: the note's path relative to the
   * project folder. Its text follows as a ScenePart that opens 'first'.
   */
  readonly note?: string;
  /** True for a folder that holds chapter notes: it heads a part of the book, above its chapters. */
  readonly bookPart?: boolean;
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
   * being part of it or that asks for a new page itself (export-page-break).
   */
  readonly opens: 'first' | 'break' | 'page';
  /** Whether the scene's title is printed above it: the window's choice, or the scene's own (export-title). */
  readonly titled: boolean;
  readonly blocks: readonly Block[];
  /** The scene's text as Markdown, without properties and comments. */
  readonly markdown: string;
}

export type ManuscriptPart = ChapterPart | ScenePart;

/** A page before or after the text: a dedication, an epigraph, acknowledgements, about the author. */
export interface MatterPart {
  readonly kind: 'matter';
  readonly role: MatterKind;
  readonly id: string;
  /**
   * The heading the page has: the writer's own when the text starts with a
   * heading line, else the one typed in the export window, else the usual
   * one for acknowledgements and about the author in the book's language. A
   * dedication and an epigraph have none unless the writer gave one.
   */
  readonly title: string | null;
  readonly direction: Direction;
  readonly blocks: readonly Block[];
  /** The text as Markdown, without its heading line. */
  readonly markdown: string;
}

/** The languages a book's words (its headings) are given in. */
export type BookLanguage = 'en' | 'he' | 'ar';

export type BookWords = Readonly<Record<HeadingKey, string>>;

/** The words an exported book uses for its own headings, in its language. Arabic books get the English ones. */
export const BOOK_WORDS: Readonly<Record<'en' | 'he', BookWords>> = {
  en: {
    contents: 'Contents',
    cover: 'Cover',
    titlePage: 'Title Page',
    start: 'Start',
    dedication: 'Dedication',
    epigraph: 'Epigraph',
    acknowledgements: 'Acknowledgements',
    about: 'About the Author',
  },
  he: {
    contents: 'תוכן העניינים',
    cover: 'כריכה',
    titlePage: 'שער',
    start: 'התחלה',
    dedication: 'הקדשה',
    epigraph: 'מוטו',
    acknowledgements: 'תודות',
    about: 'על המחבר',
  },
};

/** The words of a book in this language, with the headings the writer typed in place of the usual ones. */
export function bookWords(language: BookLanguage, own: HeadingChoices = {}): BookWords {
  const usual = language === 'he' ? BOOK_WORDS.he : BOOK_WORDS.en;
  const words: Record<HeadingKey, string> = { ...usual };
  for (const key of HEADING_KEYS) {
    const heading = cleanHeading(own[key]);
    if (heading !== '') words[key] = heading;
  }
  return words;
}

/**
 * The language a book's usual headings would be in, guessed from a few of
 * its texts (the titles of its scenes and chapters, say): Hebrew or Arabic
 * when most of them run right to left, else English. The export itself
 * decides from the text; this is for showing the usual headings beforehand.
 */
export function guessBookLanguage(texts: readonly string[]): BookLanguage {
  let rtl = 0;
  let ltr = 0;
  for (const text of texts) {
    const direction = directionOf(text);
    if (direction === 'rtl') rtl++;
    else if (direction === 'ltr') ltr++;
  }
  if (rtl <= ltr) return 'en';
  return looksArabic(texts.join(' ')) ? 'ar' : 'he';
}

/** The direction a heading of the book is set in: its own, or the usual one for the book's language. */
export function headingDirection(manuscript: Pick<Manuscript, 'language' | 'headings'>, key: HeadingKey): Direction {
  return directionOf(manuscript.headings[key]) ?? (manuscript.language === 'he' ? 'rtl' : 'ltr');
}

export interface Manuscript {
  readonly title: string;
  readonly author: string;
  /** The direction most of the text runs in; what has no direction of its own follows it. */
  readonly direction: Direction;
  /** The language of the text: Hebrew or Arabic when most of it runs right to left, else English. */
  readonly language: BookLanguage;
  /** The headings the book writes by itself: the usual words of its language, or the writer's own. */
  readonly headings: BookWords;
  /** The words in the exported scenes. */
  readonly words: number;
  readonly parts: readonly ManuscriptPart[];
  /** The pages before the text (dedication, epigraph) and after it (acknowledgements, about the author), in order. */
  readonly front: readonly MatterPart[];
  readonly back: readonly MatterPart[];
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
  readonly options: Pick<ExportOptions, 'scope' | 'author' | 'sceneTitles'> & { readonly headings?: HeadingChoices };
  /** The scenes that were read, by their path relative to the project folder. A scene that is not here is left out as unread. */
  readonly scenes: ReadonlyMap<string, SceneSource>;
  /** The texts of the pages before and after the text, as Markdown (a note's whole text will do). */
  readonly matter?: ReadonlyMap<MatterKind, string>;
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

  const countDirections = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      if (block.kind === 'break' || block.kind === 'code') continue;
      if (block.direction === 'rtl') rtlBlocks++;
      else if (block.direction === 'ltr') ltrBlocks++;
    }
  };

  const walk = (nodes: readonly TreeNode[], level: number): Draft[] => {
    const parts: Draft[] = [];
    let fresh = true;
    let afterChapter = false;
    for (const node of nodes) {
      if (node.kind === 'folder') {
        const id = `part-${nextId++}`;
        const inner = walk(node.children, level + 1);
        // A folder with nothing to print in it leaves no heading behind.
        if (inner.length === 0) continue;
        // A folder that holds chapter notes is a part of the book, above its chapters.
        const holdsChapters = inner.some((part) => part.kind === 'chapter' && part.note !== undefined && part.level === level + 1);
        parts.push(
          { kind: 'chapter', id, title: node.name, level, direction: directionOf(node.name), ...(holdsChapters ? { bookPart: true } : {}) },
          ...inner,
        );
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
      words += node.chapter === true ? countPlainWords(plainTextOfBlocks(blocks)) : 0;
      countDirections(blocks);
      if (node.chapter === true) {
        // A whole chapter in one note: its title is the chapter's heading, at
        // the level a folder here would have, and its text follows straight under it.
        parts.push({ kind: 'chapter', id: `part-${nextId++}`, title: node.title, level, direction: directionOf(node.title), note: node.path });
        if (blocks.length > 0) {
          parts.push({
            kind: 'scene',
            id: `part-${nextId++}`,
            path: node.path,
            title: node.title,
            level: level + 1,
            direction: directionOf(node.title),
            opens: 'first',
            titled: false,
            blocks,
            markdown,
          });
        }
        // What follows at this level is not part of the chapter.
        afterChapter = true;
        fresh = false;
        continue;
      }
      const titled = typeof source.title === 'boolean' ? source.title : options.sceneTitles;
      // A scene with no text yet has nothing to print, unless its title is printed.
      if (blocks.length === 0 && !titled) continue;
      words += countPlainWords(plainTextOfBlocks(blocks));
      parts.push({
        kind: 'scene',
        id: `part-${nextId++}`,
        path: node.path,
        title: node.title,
        level,
        direction: directionOf(node.title),
        // A scene that asks for a new page gets one, except straight under its chapter's heading.
        opens: afterChapter ? 'page' : fresh ? 'first' : source.pageBreak === true ? 'page' : 'break',
        titled,
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
  const sample = parts.map((part) => (part.kind === 'scene' ? plainTextOfBlocks(part.blocks.slice(0, 3)) : part.title)).join(' ');
  const language: BookLanguage = direction === 'rtl' ? (looksArabic(sample) ? 'ar' : 'he') : 'en';
  const headings = bookWords(language, options.headings);
  const matterOf = (kinds: readonly MatterKind[]): MatterPart[] =>
    kinds.flatMap((role) => {
      const text = input.matter?.get(role);
      if (text === undefined) return [];
      const part = matterPart(role, text, headings, cleanHeading(options.headings?.[role]), direction, `part-${nextId}`);
      if (part) nextId++;
      return part ? [part] : [];
    });
  const front = matterOf(FRONT_MATTER);
  const back = matterOf(BACK_MATTER);
  return {
    title: input.title,
    author: options.author.replace(/\s+/g, ' ').trim(),
    direction,
    language,
    headings,
    words,
    parts,
    front,
    back,
    included,
    switchedOff,
    unread,
  };
}

/**
 * One page before or after the text, from its Markdown. Null when the text
 * holds nothing to print. A heading on its first line becomes the page's title.
 */
function matterPart(role: MatterKind, text: string, words: BookWords, typed: string, base: Direction, id: string): MatterPart | null {
  let markdown = manuscriptText(text).trim();
  let title: string | null = null;
  const first = /^#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*(?:\n|$)/.exec(markdown);
  if (first) {
    const heading = plainText(parseInline(first[1] ?? '')).trim();
    if (heading !== '') title = heading;
    markdown = markdown.slice(first[0].length).trim();
  }
  const blocks = parseBlocks(markdown);
  if (blocks.length === 0) return null;
  if (title === null && typed !== '') title = typed;
  if (title === null && (role === 'acknowledgements' || role === 'about')) title = words[role];
  const direction = (title === null ? null : directionOf(title)) ?? blocks.map((block) => ('direction' in block ? block.direction : null)).find((found) => found !== null) ?? base;
  return { kind: 'matter', role, id, title, direction, blocks, markdown };
}

// ------------------------------------------------------------ small pieces

/** The entries of the list of contents: the chapters, and the scenes whose titles are printed. */
export function contentsOf(manuscript: Manuscript): ManuscriptPart[] {
  return manuscript.parts.filter((part) => part.kind === 'chapter' || part.titled);
}

/** The pages before and after the text that have a title, for a list of contents. */
export function titledMatter(parts: readonly MatterPart[]): Array<MatterPart & { readonly title: string }> {
  return parts.filter((part): part is MatterPart & { readonly title: string } => part.title !== null);
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
