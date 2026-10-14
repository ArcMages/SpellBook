// The e-book (src/core/export/toEpub.ts), opened again with the plugin's own
// zip reader and checked against the rules of EPUB 3 that can be checked
// without a validator: the mimetype file first and stored, the container
// pointing at the package, every file listed and every listed file there,
// the reading order, the table of contents, well-formed XHTML, the metadata
// and the direction of a Hebrew book.

import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_OPTIONS, EPUB_MIMETYPE, buildManuscript, epubParts, fromUtf8, isCoverPath, toEpub, unzipStored, withPreset } from '../../../src/core/export';
import type { ExportOptions, Manuscript, MatterKind, SceneSource } from '../../../src/core/export';
import type { TreeNode } from '../../../src/core/types';
import { readXml, textOf } from './xml';
import type { XmlElement } from './xml';

const scene = (title: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${title}.md`, title, missing: false });

const HEBREW_FOLDER = 'חלק שני';
const HEBREW_SCENE = 'לילה בנמל';
const HEBREW_LINE = 'שלום לך אחותי היקרה.';

/**
 *   Prologue
 *   Part one        [one]
 *     Arrival
 *     Letter
 *     Storm         (export-page-break)
 *     (Hebrew name) [inner]
 *       (Hebrew title)
 *   Part two        [two]
 *     Draft         (compile off)
 *     Morning
 */
const TREE: TreeNode[] = [
  scene('Prologue'),
  {
    kind: 'folder',
    id: 'one',
    name: 'Part one',
    children: [scene('Arrival'), scene('Letter'), scene('Storm'), { kind: 'folder', id: 'inner', name: HEBREW_FOLDER, children: [scene(HEBREW_SCENE)] }],
  },
  { kind: 'folder', id: 'two', name: 'Part two', children: [scene('Draft'), scene('Morning')] },
];

const TEXTS: Record<string, SceneSource> = {
  Prologue: { compile: true, text: 'Long ago, & far away <there>.\n' },
  Arrival: { compile: true, text: '---\nstatus: Done\n---\nAnna came to the **old** town. %%check%%\n\n***\n\nShe slept.\n' },
  Letter: { compile: true, text: 'The letter was short.\n' },
  Storm: { compile: true, text: 'The storm broke.\n', pageBreak: true },
  [HEBREW_SCENE]: { compile: true, text: `${HEBREW_LINE}\n` },
  Draft: { compile: false, text: 'SECRET DRAFT.\n' },
  Morning: { compile: true, text: 'Morning came.\n```\ncode line\n```\n' },
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function build(options: Partial<ExportOptions> = {}, texts: Record<string, SceneSource> = TEXTS, matter?: Map<MatterKind, string>): { manuscript: Manuscript; options: ExportOptions } {
  const all = { ...DEFAULT_EXPORT_OPTIONS, format: 'epub' as const, author: 'Dana Marlow', ...options };
  const scenes = new Map(Object.entries(texts).map(([title, source]) => [`Manuscript/${title}.md`, source]));
  return { manuscript: buildManuscript({ title: 'My Novel', tree: TREE, options: all, scenes, ...(matter ? { matter } : {}) }), options: all };
}

interface Book {
  readonly bytes: Uint8Array;
  readonly names: string[];
  readonly files: Map<string, string>;
  readonly opf: XmlElement[];
  readonly opfText: string;
  /** The page files in reading order, with whether they are read in their place. */
  readonly spine: Array<{ file: string; linear: boolean }>;
}

function open(manuscript: Manuscript, options: ExportOptions, cover: { data: Uint8Array; extension: string } | null = null): Book {
  const bytes = toEpub(manuscript, options, { cover, modified: '2026-10-14' });
  const entries = unzipStored(bytes);
  const names = entries.map((entry) => entry.name);
  const files = new Map(entries.map((entry) => [entry.name, fromUtf8(entry.data)]));
  const container = readXml(files.get('META-INF/container.xml') ?? '');
  const opfPath = container.find((element) => element.name === 'rootfile')?.attributes['full-path'] ?? '';
  const opfText = files.get(opfPath) ?? '';
  const opf = readXml(opfText);
  const base = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
  const items = new Map(opf.filter((element) => element.name === 'item').map((element) => [element.attributes['id'], element.attributes['href']]));
  const spine = opf
    .filter((element) => element.name === 'itemref')
    .map((element) => ({ file: base + (items.get(element.attributes['idref']) ?? '?'), linear: element.attributes['linear'] !== 'no' }));
  return { bytes, names, files, opf, opfText, spine };
}

/** An XHTML page as the XML checker reads it: the doctype is not XML's business. */
function xhtml(text: string): XmlElement[] {
  return readXml(text.replace('<!DOCTYPE html>\n', ''));
}

describe('an e-book', () => {
  const { manuscript, options } = build({ contents: true });
  const book = open(manuscript, options);

  it('starts with the mimetype file, stored as it is with no extra field, then the container', () => {
    const view = new DataView(book.bytes.buffer, book.bytes.byteOffset);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0); // stored, not compressed
    expect(view.getUint16(26, true)).toBe(8); // the name's length
    expect(view.getUint16(28, true)).toBe(0); // no extra field
    expect(fromUtf8(book.bytes.subarray(30, 38))).toBe('mimetype');
    expect(fromUtf8(book.bytes.subarray(38, 38 + EPUB_MIMETYPE.length))).toBe('application/epub+zip');
    expect(book.names[0]).toBe('mimetype');
    expect(book.names[1]).toBe('META-INF/container.xml');
  });

  it('every file in the book is listed in the package, and everything listed is there', () => {
    const listed = book.opf.filter((element) => element.name === 'item').map((element) => `OEBPS/${element.attributes['href']}`);
    const inBook = book.names.filter((name) => !['mimetype', 'META-INF/container.xml', 'OEBPS/content.opf'].includes(name));
    expect([...listed].sort()).toEqual([...inBook].sort());
    // Ids are unique, and every page is XHTML.
    const ids = book.opf.filter((element) => element.name === 'item').map((element) => element.attributes['id']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const element of book.opf.filter((item) => item.name === 'item' && (item.attributes['href'] ?? '').endsWith('.xhtml'))) {
      expect(element.attributes['media-type']).toBe('application/xhtml+xml');
    }
    // Exactly one navigation document.
    const nav = book.opf.filter((element) => element.name === 'item' && element.attributes['properties'] === 'nav');
    expect(nav.map((element) => element.attributes['href'])).toEqual(['nav.xhtml']);
  });

  it('every XML file and every page is well-formed', () => {
    for (const [name, text] of book.files) {
      if (name === 'mimetype' || name.endsWith('.css')) continue;
      expect(() => (name.endsWith('.xhtml') ? xhtml(text) : readXml(text)), name).not.toThrow();
      expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), name).toBe(true);
    }
  });

  it('names the book: identifier, title, author, language and the day it was made', () => {
    const pack = book.opf.find((element) => element.name === 'package');
    expect(pack?.attributes).toMatchObject({ version: '3.0', 'unique-identifier': 'book-id', 'xml:lang': 'en', dir: 'ltr' });
    const identifier = /<dc:identifier id="book-id">([^<]+)<\/dc:identifier>/.exec(book.opfText)?.[1] ?? '';
    expect(identifier).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(book.opfText).toContain('<dc:title>My Novel</dc:title>');
    expect(book.opfText).toContain('<dc:creator id="author">Dana Marlow</dc:creator>');
    expect(book.opfText).toContain('<dc:language>en</dc:language>');
    expect(book.opfText).toContain('<meta property="dcterms:modified">2026-10-14T00:00:00Z</meta>');
    // The same book exported again is the same book to a reader.
    expect(open(manuscript, options).opfText).toBe(book.opfText);
    const other = build({ contents: true, author: 'Someone Else' });
    expect(/<dc:identifier[^>]*>([^<]+)</.exec(open(other.manuscript, other.options).opfText)?.[1]).not.toBe(identifier);
  });

  it('is read in binder order: title page, contents, one file for each chapter, a new file for a scene that asks for a new page', () => {
    expect(book.spine.map((entry) => entry.file.replace('OEBPS/', ''))).toEqual([
      'title.xhtml',
      'nav.xhtml',
      'text-001.xhtml', // Prologue
      'text-002.xhtml', // Part one: Arrival, Letter
      'text-003.xhtml', // Storm, on a new page
      'text-004.xhtml', // the Hebrew chapter
      'text-005.xhtml', // Part two: Morning
    ]);
    const page = (n: number): string => textOf(book.files.get(`OEBPS/text-00${n}.xhtml`) ?? '');
    expect(page(1)).toContain('Long ago, & far away .');
    expect(page(2)).toMatch(/Part one[\s\S]*Anna came to the old town\.[\s\S]*She slept\.[\s\S]*The letter was short\./);
    expect(page(3)).toContain('The storm broke.');
    expect(page(4)).toMatch(new RegExp(`${HEBREW_FOLDER}[\\s\\S]*${HEBREW_LINE}`));
    expect(page(5)).toMatch(/Part two[\s\S]*Morning came\.[\s\S]*code line/);
    const all = [...book.files.values()].join('\n');
    expect(all).not.toContain('SECRET DRAFT');
    expect(all).not.toContain('status: Done');
    expect(all).not.toContain('%%check');
    expect(all).not.toContain('Manuscript/');
  });

  it('sets scenes apart with the scene break of the preset, and marks bold text', () => {
    const part = book.files.get('OEBPS/text-002.xhtml') ?? '';
    expect(part).toContain('Anna came to the <strong>old</strong> town.');
    // The break inside Arrival, and the one between Arrival and Letter.
    expect(part.match(/<p class="break">#<\/p>/g)).toHaveLength(2);
    const reading = withPreset(options, 'reading');
    const readingBook = open(build(reading).manuscript, reading);
    expect(readingBook.files.get('OEBPS/text-002.xhtml')).toContain('<p class="break">* * *</p>');
    expect(readingBook.files.get('OEBPS/style.css')).toContain('text-align: justify');
  });

  it('has a table of contents with the chapters in order and nested, each a link to a place in the book', () => {
    const nav = book.files.get('OEBPS/nav.xhtml') ?? '';
    const elements = xhtml(nav);
    const toc = elements.find((element) => element.name === 'nav' && element.attributes['epub:type'] === 'toc');
    expect(toc).toBeDefined();
    const links = [...nav.slice(0, nav.indexOf('landmarks')).matchAll(/<a href="([^"]+)" dir="(?:ltr|rtl)">([^<]+)<\/a>/g)].map((match) => [match[1] ?? '', match[2] ?? '']);
    expect(links.map((link) => link[1])).toEqual(['Part one', HEBREW_FOLDER, 'Part two']);
    for (const [href = ''] of links) {
      const [file, id] = href.split('#');
      const target = book.files.get(`OEBPS/${file}`) ?? '';
      expect(target, href).not.toBe('');
      if (id) expect(target, href).toContain(` id="${id}"`);
    }
    // The Hebrew chapter is nested under Part one.
    expect(nav).toMatch(new RegExp(`Part one</a><ol><li><a href="[^"]+" dir="rtl">${HEBREW_FOLDER}</a></li></ol></li><li>`));
    // Landmarks for the reader's "go to" menu.
    expect(nav).toContain('epub:type="bodymatter" href="text-001.xhtml"');
    expect(nav).toContain('<nav epub:type="landmarks" id="landmarks" hidden="hidden">');
  });

  it('keeps the contents out of the pages when they are not asked for, but still has them for the reader\'s menu', () => {
    const plain = build({ contents: false });
    const plainBook = open(plain.manuscript, plain.options);
    expect(plainBook.spine.find((entry) => entry.file === 'OEBPS/nav.xhtml')).toEqual({ file: 'OEBPS/nav.xhtml', linear: false });
  });

  it('a book with no chapters and no titles still has an entry in its contents', () => {
    const tree: TreeNode[] = [scene('Prologue')];
    const lone = buildManuscript({ title: 'Short', tree, options: DEFAULT_EXPORT_OPTIONS, scenes: new Map([['Manuscript/Prologue.md', { compile: true, text: 'Once.\n' }]]) });
    const nav = epubParts(lone, { titlePage: false, contents: false }, { modified: '2026-10-14' }).find((entry) => entry.name === 'OEBPS/nav.xhtml');
    expect(fromUtf8(nav?.data ?? new Uint8Array())).toContain('<li><a href="text-001.xhtml" dir="ltr">Short</a></li>');
  });

  it('has a cover when a picture is chosen: first in the book, marked as the cover', () => {
    const covered = open(manuscript, options, { data: PNG, extension: 'PNG' });
    expect(covered.names).toContain('OEBPS/images/cover.png');
    expect(unzipStored(covered.bytes).find((entry) => entry.name === 'OEBPS/images/cover.png')?.data).toEqual(PNG);
    expect(covered.opfText).toContain('<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>');
    expect(covered.opfText).toContain('<meta name="cover" content="cover-image"/>');
    expect(covered.spine[0]?.file).toBe('OEBPS/cover.xhtml');
    expect(covered.files.get('OEBPS/cover.xhtml')).toContain('<img src="images/cover.png" alt="My Novel"/>');
    // A picture of a kind an e-book cannot hold is left out.
    expect(open(manuscript, options, { data: PNG, extension: 'bmp' }).names.some((name) => name.includes('cover'))).toBe(false);
    expect(['a/b.jpg', 'c.JPEG', 'd.png', 'e.webp', 'f.gif'].every(isCoverPath)).toBe(true);
    expect(['a.bmp', 'b.svg', 'c.avif', 'jpg'].some(isCoverPath)).toBe(false);
  });

  it('puts the dedication and epigraph after the title page and the acknowledgements and about the author at the end', () => {
    const matter = new Map<MatterKind, string>([
      ['dedication', 'For my sister.'],
      ['epigraph', 'All happy families are alike.'],
      ['acknowledgements', 'Thanks.'],
      ['about', 'Dana lives by the sea.'],
    ]);
    const full = build({ contents: true }, TEXTS, matter);
    const fullBook = open(full.manuscript, full.options);
    expect(fullBook.spine.map((entry) => entry.file.replace('OEBPS/', ''))).toEqual([
      'title.xhtml',
      'dedication.xhtml',
      'epigraph.xhtml',
      'nav.xhtml',
      'text-001.xhtml',
      'text-002.xhtml',
      'text-003.xhtml',
      'text-004.xhtml',
      'text-005.xhtml',
      'acknowledgements.xhtml',
      'about.xhtml',
    ]);
    expect(fullBook.files.get('OEBPS/dedication.xhtml')).toContain('epub:type="dedication"');
    const nav = fullBook.files.get('OEBPS/nav.xhtml') ?? '';
    expect(nav).toMatch(/Part two<\/a><\/li><li><a href="acknowledgements.xhtml" dir="ltr">Acknowledgements<\/a><\/li><li><a href="about.xhtml" dir="ltr">About the Author<\/a>/);
  });
});

describe('a Hebrew e-book', () => {
  const hebrew: Record<string, SceneSource> = Object.fromEntries(Object.keys(TEXTS).map((title) => [title, { compile: true, text: `${HEBREW_LINE}\nכתבתי לך מכתב.\nHe said hello.\n` }]));
  const { manuscript, options } = build({ contents: true, author: 'דנה' }, hebrew);
  const book = open(manuscript, options);

  it('is marked as Hebrew, right to left, and its pages turn the other way', () => {
    expect(book.opfText).toContain('<dc:language>he</dc:language>');
    expect(book.opfText).toContain('<spine page-progression-direction="rtl">');
    expect(book.opf.find((element) => element.name === 'package')?.attributes).toMatchObject({ 'xml:lang': 'he', dir: 'rtl' });
    const page = book.files.get('OEBPS/text-002.xhtml') ?? '';
    expect(page).toContain('xml:lang="he" lang="he" dir="rtl"');
    // Every paragraph runs the way of its own text.
    expect(page).toContain(`<p class="first" dir="rtl">${HEBREW_LINE}</p>`);
    expect(page).toContain('<p class="text" dir="ltr">He said hello.</p>');
    expect(book.files.get('OEBPS/nav.xhtml')).toContain('<h1 dir="rtl">תוכן העניינים</h1>');
  });
});
