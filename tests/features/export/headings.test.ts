// The headings a book writes by itself (src/core/export/manuscript.ts): the
// usual words of the book's language, or the writer's own, typed in the
// export window. English and Hebrew books, in the web page, Word and EPUB.

import { describe, expect, it } from 'vitest';
import {
  BOOK_WORDS,
  DEFAULT_EXPORT_OPTIONS,
  MAX_HEADING_TEXT,
  bookWords,
  buildManuscript,
  fromUtf8,
  guessBookLanguage,
  readExportOptions,
  readHeadingChoices,
  toDocx,
  toEpub,
  toHtml,
  unzipStored,
} from '../../../src/core/export';
import type { ExportOptions, HeadingChoices, Manuscript, MatterKind, SceneSource } from '../../../src/core/export';
import type { TreeNode } from '../../../src/core/types';

const scene = (title: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${title}.md`, title, missing: false });
const TREE: TreeNode[] = [{ kind: 'folder', id: 'one', name: 'Chapter One', children: [scene('Arrival'), scene('Storm')] }];

const ENGLISH: Record<string, SceneSource> = {
  Arrival: { compile: true, text: 'Anna came to the town.\n' },
  Storm: { compile: true, text: 'The storm broke.\n' },
};
const HEBREW: Record<string, SceneSource> = {
  Arrival: { compile: true, text: 'אנה הגיעה לעיר.\n' },
  Storm: { compile: true, text: 'הסערה פרצה.\n' },
};

const ALL_MATTER = (language: 'en' | 'he'): Map<MatterKind, string> =>
  new Map<MatterKind, string>(
    language === 'en'
      ? [
          ['dedication', 'For my sister.'],
          ['epigraph', 'All happy families are alike.'],
          ['acknowledgements', 'Thanks to everyone.'],
          ['about', 'Dana lives by the sea.'],
        ]
      : [
          ['dedication', 'לאחותי.'],
          ['epigraph', 'כל המשפחות המאושרות דומות.'],
          ['acknowledgements', 'תודה לכולם.'],
          ['about', 'דנה גרה ליד הים.'],
        ],
  );

function build(texts: Record<string, SceneSource>, headings: HeadingChoices = {}, matter?: Map<MatterKind, string>): Manuscript {
  const scenes = new Map(Object.entries(texts).map(([title, source]) => [`Manuscript/${title}.md`, source]));
  return buildManuscript({ title: 'My Novel', tree: TREE, options: { ...DEFAULT_EXPORT_OPTIONS, headings }, scenes, ...(matter ? { matter } : {}) });
}

const withContents: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, contents: true };

function docxText(manuscript: Manuscript): string {
  return fromUtf8(unzipStored(toDocx(manuscript, withContents)).find((entry) => entry.name === 'word/document.xml')?.data ?? new Uint8Array());
}

function epubFiles(manuscript: Manuscript): Map<string, string> {
  const entries = unzipStored(toEpub(manuscript, { ...withContents, titlePage: true }, { cover: { data: new Uint8Array([1]), extension: 'png' }, modified: '2026-10-14' }));
  return new Map(entries.map((entry) => [entry.name, fromUtf8(entry.data)]));
}

describe('the usual headings', () => {
  it('are English for an English book and Hebrew for a Hebrew one, as before', () => {
    expect(build(ENGLISH).headings).toEqual(BOOK_WORDS.en);
    expect(build(HEBREW).headings).toEqual(BOOK_WORDS.he);
    const html = toHtml(build(HEBREW, {}, ALL_MATTER('he')), withContents);
    expect(html).toContain(`<h2 dir="rtl">${BOOK_WORDS.he.contents}</h2>`);
    expect(html).toContain(BOOK_WORDS.he.about);
  });

  it('an empty heading, or one of only spaces, keeps the usual word', () => {
    expect(bookWords('he', { about: '   ', contents: '' })).toEqual(BOOK_WORDS.he);
    expect(bookWords('ar', {})).toEqual(BOOK_WORDS.en);
  });
});

describe('the writer\'s own headings', () => {
  it('stand in an English book\'s web page, Word document and e-book', () => {
    const own: HeadingChoices = { contents: 'Chapters', acknowledgements: 'With Thanks', about: 'About Dana', dedication: 'For Her', cover: 'Front', titlePage: 'Title', start: 'Begin' };
    const manuscript = build(ENGLISH, own, ALL_MATTER('en'));
    expect(manuscript.back.map((part) => part.title)).toEqual(['With Thanks', 'About Dana']);
    // A dedication has no heading unless the writer gives one; an epigraph given none keeps none.
    expect(manuscript.front.map((part) => part.title)).toEqual(['For Her', null]);

    const html = toHtml(manuscript, withContents);
    expect(html).toContain('<h2 dir="ltr">Chapters</h2>');
    expect(html).not.toContain('>Contents<');
    expect(html).toContain('About Dana');
    expect(html).not.toContain('About the Author');

    const word = docxText(manuscript);
    expect(word).toContain('Chapters');
    expect(word).toContain('With Thanks');
    expect(word).not.toContain('Acknowledgements');

    const files = epubFiles(manuscript);
    const nav = files.get('OEBPS/nav.xhtml') ?? [...files.entries()].find(([name]) => name.endsWith('nav.xhtml'))?.[1] ?? '';
    expect(nav).toContain('<h1 dir="ltr">Chapters</h1>');
    expect(nav).toContain('>Front</a>');
    expect(nav).toContain('>Title</a>');
    expect(nav).toContain('>Begin</a>');
    expect(nav).not.toMatch(/>(Contents|Cover|Title Page|Start)</);
    const everything = [...files.values()].join('\n');
    expect(everything).toContain('About Dana');
    expect(everything).not.toContain('About the Author');
  });

  it('a Hebrew writer can put "about the author" in the feminine', () => {
    const about = 'על המחברת';
    const manuscript = build(HEBREW, { about, contents: 'פרקים' }, ALL_MATTER('he'));
    expect(manuscript.language).toBe('he');
    expect(manuscript.back.find((part) => part.role === 'about')?.title).toBe(about);
    expect(manuscript.back.find((part) => part.role === 'acknowledgements')?.title).toBe(BOOK_WORDS.he.acknowledgements);
    const html = toHtml(manuscript, withContents);
    expect(html).toContain(about);
    // The usual masculine form is a prefix of the feminine one: look for it outside the writer's heading.
    const without = (text: string): string => text.split(about).join('');
    expect(without(html)).not.toContain(BOOK_WORDS.he.about);
    expect(html).toContain('<h2 dir="rtl">פרקים</h2>');
    expect(docxText(manuscript)).toContain(about);
    const everything = [...epubFiles(manuscript).values()].join('\n');
    expect(everything).toContain(about);
    expect(without(everything)).not.toContain(BOOK_WORDS.he.about);
  });

  it('an English heading in a Hebrew book runs left to right', () => {
    const html = toHtml(build(HEBREW, { contents: 'Contents' }, ALL_MATTER('he')), withContents);
    expect(html).toContain('<h2 dir="ltr">Contents</h2>');
  });

  it('a heading on the first line of the page\'s own text still comes first', () => {
    const matter = new Map<MatterKind, string>([['about', '# Who I am\nDana lives by the sea.']]);
    expect(build(ENGLISH, { about: 'About Dana' }, matter).back[0]?.title).toBe('Who I am');
  });
});

describe('the headings as they are remembered', () => {
  it('come back from what was saved, on one line, and only those typed', () => {
    const chosen: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, headings: { about: 'על המחברת', contents: 'Chapters' } };
    expect(readExportOptions(JSON.stringify(chosen))).toEqual(chosen);
    expect(readHeadingChoices({ about: '  About \n Dana ', contents: '', start: 7, nonsense: 'x', cover: '   ' })).toEqual({ about: 'About Dana' });
    expect(readHeadingChoices('nope')).toEqual({});
    expect(readHeadingChoices({ about: 'x'.repeat(MAX_HEADING_TEXT + 50) }).about).toHaveLength(MAX_HEADING_TEXT);
    expect(readExportOptions({ format: 'html' }).headings).toEqual({});
  });
});

describe('guessing the language before the export', () => {
  it('goes by most of the names', () => {
    expect(guessBookLanguage(['My Novel', 'Chapter One', 'Arrival'])).toBe('en');
    expect(guessBookLanguage(['הרומן שלי', 'פרק ראשון', 'Storm'])).toBe('he');
    expect(guessBookLanguage(['روايتي', 'الفصل الأول'])).toBe('ar');
    expect(guessBookLanguage([])).toBe('en');
  });
});
