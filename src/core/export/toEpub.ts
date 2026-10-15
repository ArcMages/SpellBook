// The manuscript as an e-book: an EPUB 3 file, which Apple Books, Google
// Play Books, Kobo and most other readers open (Kindle takes it through
// Amazon's "Send to Kindle").
//
// An EPUB is a zip, written here with the plugin's own zip writer (zip.ts).
// Its rules, as far as this writer is concerned:
//   - the first file is "mimetype", stored as it is, holding only
//     "application/epub+zip";
//   - META-INF/container.xml says where the package file is;
//   - the package file (content.opf) names the book (title, author,
//     language, an identifier, the day it was made), lists every file in the
//     book (the manifest) and the order they are read in (the spine);
//   - a navigation document (nav.xhtml) holds the table of contents;
//   - every page is an XHTML file: HTML written as strict XML.
//
// The book holds, in order: the cover (when a picture is chosen), the title
// page, the dedication and the epigraph, the list of contents (when it is
// asked for), the text with one file for each chapter (binder folder), and
// the acknowledgements and about the author. A scene that starts a new page
// (export-page-break) starts a new file. Scenes in one file are set apart by
// the preset's scene break, or by their titles.
//
// A Hebrew book is marked as Hebrew, right to left: its pages turn the other
// way (page-progression-direction="rtl"), and every paragraph carries the
// direction of its own text, as in the other formats.
//
// Nothing in the book fetches or runs anything: no script, no address
// outside the book. The cover picture is a file inside it.

import type { Direction } from './direction';
import { PRESETS, headingDirection } from './manuscript';
import type { ExportOptions, Manuscript, MatterKind, MatterPart, Preset } from './manuscript';
import type { Block, Run } from './markdown';
import { escapeXml } from './toDocx';
import { crc32, utf8, zipStored } from './zip';
import type { ZipEntry } from './zip';

/** What the first file of every EPUB says. */
export const EPUB_MIMETYPE = 'application/epub+zip';

/** The kinds of picture an EPUB may hold as its cover, by the ending of the file's name. */
export const COVER_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Whether a file can be the cover of an e-book: a picture of one of COVER_TYPES. */
export function isCoverPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && Object.prototype.hasOwnProperty.call(COVER_TYPES, name.slice(dot + 1).toLowerCase());
}

export interface EpubCover {
  readonly data: Uint8Array;
  /** The ending of the picture's file name: one of COVER_TYPES. */
  readonly extension: string;
}

export interface EpubExtras {
  /** The picture for the cover; null or absent for a book without one. */
  readonly cover?: EpubCover | null;
  /** The day the book is made, as YYYY-MM-DD. */
  readonly modified: string;
}

type EpubOptions = Pick<ExportOptions, 'titlePage' | 'contents'> & Partial<Pick<ExportOptions, 'preset'>>;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const XHTML = 'http://www.w3.org/1999/xhtml';
const OPS = 'http://www.idpf.org/2007/ops';
/** The folder inside the zip that holds the book. */
const BOOK = 'OEBPS';
const STYLE_FILE = 'style.css';
const NAV_FILE = 'nav.xhtml';

/** One page file of the book. */
interface Section {
  /** The file's name inside the book folder: "text-001.xhtml". */
  readonly file: string;
  /** The id the package file knows it by. */
  readonly id: string;
  /** What it is, in the words of EPUB: "chapter", "dedication", "titlepage". */
  readonly type: string;
  readonly title: string;
  readonly body: string[];
  /** Whether it is read in its place (all are, except the list of contents when it is not asked for). */
  readonly linear: boolean;
}

/** An entry of the table of contents. */
interface TocEntry {
  readonly level: number;
  readonly title: string;
  readonly href: string;
  readonly direction: Direction;
}

function runsXhtml(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      let html = escapeXml(run.text);
      if (run.code) html = `<code>${html}</code>`;
      if (run.strike) html = `<s>${html}</s>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      return html;
    })
    .join('');
}

/**
 * Blocks of text as XHTML.
 *
 * @param inner the heading level a heading inside the text gets
 */
function blocksXhtml(blocks: readonly Block[], base: Direction, out: string[], breakMark: string, inner: number, cls = ''): void {
  // The first paragraph after a heading or a break is not set in.
  let first = true;
  const extra = cls === '' ? '' : ` ${cls}`;
  for (const block of blocks) {
    if (block.kind === 'break') {
      out.push(`<p class="break">${escapeXml(breakMark)}</p>`);
      first = true;
      continue;
    }
    if (block.kind === 'code') {
      out.push(`<pre dir="ltr">${block.lines.map(escapeXml).join('\n')}</pre>`);
      first = true;
      continue;
    }
    const dir = block.direction ?? base;
    const text = runsXhtml(block.runs);
    if (block.kind === 'heading') {
      const level = Math.min(6, inner);
      out.push(`<h${level} class="inner" dir="${dir}">${text}</h${level}>`);
      first = true;
    } else if (block.kind === 'quote') {
      out.push(`<blockquote dir="${dir}"><p class="first">${text}</p></blockquote>`);
    } else if (block.kind === 'item') {
      out.push(`<p class="item depth-${block.depth}" dir="${dir}"><span class="marker">${escapeXml(block.marker)}</span> ${text}</p>`);
    } else {
      out.push(`<p class="${first ? 'first' : 'text'}${extra}" dir="${dir}">${text}</p>`);
      first = false;
    }
  }
}

/** A whole page file. */
function xhtmlPage(title: string, manuscript: Manuscript, type: string, body: readonly string[]): string {
  const lang = manuscript.language;
  return (
    `${XML_HEAD}<!DOCTYPE html>\n` +
    `<html xmlns="${XHTML}" xmlns:epub="${OPS}" xml:lang="${lang}" lang="${lang}" dir="${manuscript.direction}">\n` +
    `<head>\n<meta charset="utf-8"/>\n<title>${escapeXml(title)}</title>\n<link rel="stylesheet" type="text/css" href="${STYLE_FILE}"/>\n</head>\n` +
    `<body epub:type="${type}">\n${body.join('\n')}\n</body>\n</html>\n`
  );
}

function stylesheet(preset: Preset): string {
  const align = preset.justify ? 'justify' : 'start';
  return `body { margin: 0 4%; font-family: serif; line-height: 1.4; }
p { margin: 0; text-indent: 1.5em; text-align: ${align}; orphans: 2; widows: 2; }
p.first, p.item, .title-page p, .dedication p, .epigraph p, .contents p { text-indent: 0; }
p.break { text-indent: 0; text-align: center; margin: 1em 0; page-break-after: avoid; }
p.item { padding-inline-start: 1.5em; }
p.item.depth-1 { padding-inline-start: 3em; }
p.item.depth-2 { padding-inline-start: 4.5em; }
p.item.depth-3 { padding-inline-start: 6em; }
blockquote { margin: 0.5em 1.5em; }
pre { white-space: pre-wrap; font-family: monospace; font-size: 0.9em; text-align: left; }
h1, h2, h3, h4, h5, h6 { text-align: center; font-weight: normal; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 1.6em; margin: 2em 0 1em; }
h2 { font-size: 1.4em; margin: 2em 0 1em; }
h3 { font-size: 1.2em; margin: 1.5em 0 1em; }
h4, h5, h6 { font-size: 1em; font-weight: bold; margin: 1.5em 0 0.5em; }
h1.scene, h2.scene, h3.scene, h4.scene, h5.scene, h6.scene { font-size: 1.1em; font-weight: bold; margin: 1.5em 0 0.5em; }
.inner { text-align: start; }
.new-page { page-break-before: always; break-before: page; }
.title-page { text-align: center; margin-top: 30%; }
.title-page h1 { margin: 0 0 1em; }
.title-page p { text-align: center; }
.dedication { margin-top: 30%; text-align: center; }
.dedication p { text-align: center; }
.epigraph { margin: 30% 10% 0; }
.contents ol { list-style-type: none; padding-inline-start: 0; }
.contents ol ol { padding-inline-start: 1.5em; }
.contents a { text-decoration: none; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }
`;
}

/** The levels of the table of contents as nested lists. Every item has a link. */
function tocList(entries: readonly TocEntry[]): string {
  const out: string[] = [];
  const open: number[] = [];
  for (const entry of entries) {
    const level = Math.max(1, entry.level);
    if (open.length === 0) {
      out.push('<ol>');
      open.push(level);
    } else if (level > (open[open.length - 1] as number)) {
      // A deeper entry goes into the item before it.
      out.push('<ol>');
      open.push(level);
    } else {
      out.push('</li>');
      while (open.length > 1 && level < (open[open.length - 1] as number)) {
        out.push('</ol></li>');
        open.pop();
      }
    }
    out.push(`<li><a href="${escapeXml(entry.href)}" dir="${entry.direction}">${escapeXml(entry.title)}</a>`);
  }
  if (open.length === 0) return '';
  out.push('</li>');
  while (open.length > 1) {
    out.push('</ol></li>');
    open.pop();
  }
  out.push('</ol>');
  return out.join('');
}

/**
 * An identifier for the book that stays the same when the same book is
 * exported again (so that a reader can tell it is a new copy of the same
 * book), in the form of a UUID.
 */
function bookIdentifier(manuscript: Manuscript): string {
  const seed = `${manuscript.title}\u0000${manuscript.author}`;
  const hex = [1, 2, 3, 4].map((salt) => crc32(utf8(`${salt}\u0000${seed}`)).toString(16).padStart(8, '0')).join('');
  // Marked as a name-based UUID (version 5, variant 1).
  const digits = `${hex.slice(0, 12)}5${hex.slice(13, 16)}${((parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17)}`;
  return `urn:uuid:${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20, 32)}`;
}

const MATTER_TYPES: Readonly<Record<MatterKind, string>> = {
  dedication: 'dedication',
  epigraph: 'epigraph',
  acknowledgements: 'acknowledgments',
  about: 'appendix',
};

/** The files an EPUB of this manuscript is made of, in the order they go into the zip. */
export function epubParts(manuscript: Manuscript, options: EpubOptions, extras: EpubExtras): ZipEntry[] {
  const preset = PRESETS[options.preset ?? 'manuscript'];
  const words = manuscript.headings;
  const base = manuscript.direction;
  const breakMark = preset.sceneBreak;
  const sections: Section[] = [];
  const toc: TocEntry[] = [];
  const cover = extras.cover && Object.prototype.hasOwnProperty.call(COVER_TYPES, extras.cover.extension.toLowerCase()) ? extras.cover : null;
  const coverExtension = cover ? cover.extension.toLowerCase() : '';
  const coverHref = `images/cover.${coverExtension}`;

  if (cover) {
    sections.push({
      file: 'cover.xhtml',
      id: 'cover',
      type: 'cover',
      title: words.cover,
      body: [`<div class="cover"><img src="${coverHref}" alt="${escapeXml(manuscript.title)}"/></div>`],
      linear: true,
    });
  }

  if (options.titlePage) {
    const body = ['<section class="title-page" epub:type="titlepage">', `<h1 dir="auto">${escapeXml(manuscript.title)}</h1>`];
    if (manuscript.author !== '') body.push(`<p class="author" dir="auto">${escapeXml(manuscript.author)}</p>`);
    body.push('</section>');
    sections.push({ file: 'title.xhtml', id: 'title', type: 'frontmatter', title: manuscript.title, body, linear: true });
  }

  const matterSection = (part: MatterPart): void => {
    const file = `${part.role}.xhtml`;
    const body = [`<section class="${part.role}" epub:type="${MATTER_TYPES[part.role]}" id="${part.id}" dir="${part.direction}">`];
    if (part.title !== null) {
      body.push(`<h1 dir="${part.direction}">${escapeXml(part.title)}</h1>`);
      toc.push({ level: 1, title: part.title, href: file, direction: part.direction });
    }
    blocksXhtml(part.blocks, base, body, breakMark, 2);
    body.push('</section>');
    sections.push({ file, id: part.role, type: MATTER_TYPES[part.role], title: part.title ?? words[part.role], body, linear: true });
  };
  manuscript.front.forEach(matterSection);

  // The list of contents is always in the book (readers show it from their menus); in the pages only when it is asked for.
  const navIndex = sections.length;

  // The text: a new file for every chapter, and for a scene that starts a new page.
  let count = 0;
  let current: (Section & { fresh: boolean }) | null = null;
  const start = (title: string): Section & { fresh: boolean } => {
    count++;
    const name = `text-${String(count).padStart(3, '0')}`;
    const section = { file: `${name}.xhtml`, id: name, type: 'bodymatter', title, body: [] as string[], linear: true, fresh: true };
    sections.push(section);
    return section;
  };
  for (const part of manuscript.parts) {
    if (part.kind === 'chapter') {
      current = start(part.title);
      const level = Math.min(6, part.level);
      current.body.push(`<h${level} class="chapter${part.bookPart === true ? ' book-part' : ''}" id="${part.id}" dir="${part.direction}">${escapeXml(part.title)}</h${level}>`);
      toc.push({ level: part.level, title: part.title, href: `${current.file}#${part.id}`, direction: part.direction });
      continue;
    }
    if (current === null || part.opens === 'page') {
      current = start(part.title);
    }
    if (part.titled) {
      const level = Math.min(6, part.level);
      current.body.push(`<h${level} class="scene" id="${part.id}" dir="${part.direction}">${escapeXml(part.title)}</h${level}>`);
      toc.push({ level: part.level, title: part.title, href: `${current.file}#${part.id}`, direction: part.direction });
    } else if (part.opens === 'break' && !current.fresh) {
      current.body.push(`<p class="break">${escapeXml(breakMark)}</p>`);
    }
    blocksXhtml(part.blocks, base, current.body, breakMark, part.level + 1);
    current.fresh = false;
  }
  const firstText = sections.find((section) => section.type === 'bodymatter');

  manuscript.back.forEach(matterSection);

  // A table of contents must have an entry: a book with no chapters and no titles has its title.
  const target = firstText ?? sections[sections.length - 1];
  if (toc.length === 0) toc.push({ level: 1, title: manuscript.title, href: target ? target.file : NAV_FILE, direction: base });
  const contentsDirection: Direction = headingDirection(manuscript, 'contents');
  const navBody = [
    `<nav epub:type="toc" id="toc" class="contents">`,
    `<h1 dir="${contentsDirection}">${escapeXml(words.contents)}</h1>`,
    tocList(toc),
    '</nav>',
    '<nav epub:type="landmarks" id="landmarks" hidden="hidden">',
    `<h2>${escapeXml(words.contents)}</h2>`,
    '<ol>',
    ...(cover ? [`<li><a epub:type="cover" href="cover.xhtml">${escapeXml(words.cover)}</a></li>`] : []),
    ...(options.titlePage ? [`<li><a epub:type="titlepage" href="title.xhtml">${escapeXml(words.titlePage)}</a></li>`] : []),
    `<li><a epub:type="toc" href="${NAV_FILE}#toc">${escapeXml(words.contents)}</a></li>`,
    ...(firstText ? [`<li><a epub:type="bodymatter" href="${firstText.file}">${escapeXml(words.start)}</a></li>`] : []),
    '</ol>',
    '</nav>',
  ];
  sections.splice(navIndex, 0, { file: NAV_FILE, id: 'nav', type: 'frontmatter', title: words.contents, body: navBody, linear: options.contents });

  // ------------------------------------------------------------ the package
  const day = /^\d{4}-\d{2}-\d{2}$/.test(extras.modified) ? extras.modified : '2000-01-01';
  const manifest = [
    `<item id="css" href="${STYLE_FILE}" media-type="text/css"/>`,
    ...(cover ? [`<item id="cover-image" href="${coverHref}" media-type="${COVER_TYPES[coverExtension]}" properties="cover-image"/>`] : []),
    ...sections.map(
      (section) => `<item id="${section.id}" href="${section.file}" media-type="application/xhtml+xml"${section.file === NAV_FILE ? ' properties="nav"' : ''}/>`,
    ),
  ];
  const spine = sections.map((section) => `<itemref idref="${section.id}"${section.linear ? '' : ' linear="no"'}/>`);
  const metadata = [
    `<dc:identifier id="book-id">${bookIdentifier(manuscript)}</dc:identifier>`,
    `<dc:title>${escapeXml(manuscript.title)}</dc:title>`,
    `<dc:language>${manuscript.language}</dc:language>`,
    ...(manuscript.author !== '' ? [`<dc:creator id="author">${escapeXml(manuscript.author)}</dc:creator>`] : []),
    `<meta property="dcterms:modified">${day}T00:00:00Z</meta>`,
    // For readers made for the older EPUB 2, which look for the cover this way.
    ...(cover ? ['<meta name="cover" content="cover-image"/>'] : []),
  ];
  const opf =
    `${XML_HEAD}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${manuscript.language}" dir="${base}">\n` +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n${metadata.join('\n')}\n</metadata>\n` +
    `<manifest>\n${manifest.join('\n')}\n</manifest>\n` +
    `<spine page-progression-direction="${base}">\n${spine.join('\n')}\n</spine>\n` +
    '</package>\n';
  const container =
    `${XML_HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
    `<rootfiles><rootfile full-path="${BOOK}/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n`;

  const entries: ZipEntry[] = [
    { name: 'mimetype', data: utf8(EPUB_MIMETYPE) },
    { name: 'META-INF/container.xml', data: utf8(container) },
    { name: `${BOOK}/content.opf`, data: utf8(opf) },
    { name: `${BOOK}/${STYLE_FILE}`, data: utf8(stylesheet(preset)) },
  ];
  if (cover) entries.push({ name: `${BOOK}/${coverHref}`, data: cover.data });
  for (const section of sections) {
    entries.push({ name: `${BOOK}/${section.file}`, data: utf8(xhtmlPage(section.title, manuscript, section.type, section.body)) });
  }
  return entries;
}

/** The manuscript as the bytes of an .epub file. */
export function toEpub(manuscript: Manuscript, options: EpubOptions, extras: EpubExtras): Uint8Array {
  return zipStored(epubParts(manuscript, options, extras));
}
