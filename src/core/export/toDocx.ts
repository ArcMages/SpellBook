// The manuscript as a Word file (.docx), in standard manuscript format:
// Times New Roman 12 point, double spacing, first lines set in by half an
// inch, a centred # between scenes, every chapter on a new page, one inch
// of margin, and "Author / Title / page" at the top of every page.
//
// A .docx is a zip of a few XML files. They are written here by hand, with
// the plugin's own zip writer (zip.ts), so that the export needs no library
// and works on a phone. The elements are written in the order the format
// lays down, because readers other than Word (Pages, Google Docs) can be
// strict about it.
//
// Right-to-left text: a paragraph whose text is Hebrew is marked as a
// right-to-left paragraph (it then starts at the right margin and is set in
// from there), and every stretch of Hebrew letters is marked as
// right-to-left script, which is what makes Word use the right font and keep
// bold and italics for it. A mixed manuscript has both kinds of paragraph.
//
// The preset changes the look: a reading copy has book-like spacing, lines
// set flush with both margins and three stars between scenes; a proof has
// two inches of margin at the sides and numbered lines. A dedication and an
// epigraph follow the title page, each on a page of its own; the
// acknowledgements and about the author close the book.

import { directionOf, splitByScript } from './direction';
import type { Direction } from './direction';
import { MARGIN_TWIPS, PAPER_SIZES, PRESETS, bookWords, contentsOf, headerText, titledMatter, wordsLine } from './manuscript';
import type { ExportOptions, Manuscript, MatterPart, Preset } from './manuscript';
import type { Block, Run } from './markdown';
import { utf8, zipStored } from './zip';
import type { ZipEntry } from './zip';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/** The face of the text. It has Hebrew letters too, on Windows and on Apple devices. */
const FONT = 'Times New Roman';
const CODE_FONT = 'Courier New';

/**
 * The name of the file inside the zip that holds the text. (Written once, here: the
 * rules that keep src/core away from the screen read a file name spelled out
 * with its ending as a use of the page.)
 */
const MAIN_PART = 'document';

/** The names of the paragraph styles the file defines. */
export const DOCX_STYLES = {
  text: 'ManuscriptText',
  textFirst: 'ManuscriptTextFirst',
  sceneBreak: 'SceneBreak',
  heading: 'Heading',
  subheading: 'Subheading',
  quote: 'ManuscriptQuote',
  item: 'ManuscriptList',
  code: 'ManuscriptCode',
  title: 'ManuscriptTitle',
  contentsTitle: 'ContentsTitle',
  contentsEntry: 'ContentsEntry',
  header: 'Header',
  dedication: 'Dedication',
  epigraph: 'Epigraph',
} as const;

/** Text made safe for XML: the five special characters, and nothing that XML does not allow at all. */
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[\t\n\r]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface Look {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly strike?: boolean;
  readonly code?: boolean;
}

/** One stretch of text. `rtl` marks right-to-left script. */
function run(text: string, look: Look, rtl: boolean): string {
  const props = [
    look.code ? `<w:rFonts w:ascii="${CODE_FONT}" w:hAnsi="${CODE_FONT}" w:cs="${CODE_FONT}"/>` : '',
    look.bold ? '<w:b/><w:bCs/>' : '',
    look.italic ? '<w:i/><w:iCs/>' : '',
    look.strike ? '<w:strike/>' : '',
    rtl ? '<w:rtl/>' : '',
  ].join('');
  return `<w:r>${props === '' ? '' : `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** Text as runs, cut where the script changes direction. */
function textRuns(text: string, look: Look, direction: Direction): string {
  return splitByScript(text, direction)
    .map((stretch) => run(stretch.text, look, stretch.rtl))
    .join('');
}

function runsXml(runs: readonly Run[], direction: Direction): string {
  return runs.map((piece) => textRuns(piece.text, piece, direction)).join('');
}

interface ParagraphLook {
  readonly direction: Direction;
  readonly pageBreak?: boolean;
  /** How far the paragraph is set in from its starting side, in twentieths of a point. */
  readonly indent?: number;
  /** A name to link to: see the list of contents. */
  readonly bookmark?: { readonly id: number; readonly name: string };
}

function paragraph(style: string, content: string, look: ParagraphLook): string {
  const props = [
    `<w:pStyle w:val="${style}"/>`,
    look.pageBreak ? '<w:pageBreakBefore/>' : '',
    look.direction === 'rtl' ? '<w:bidi/>' : '',
    look.indent !== undefined ? `<w:ind w:left="${look.indent + 360}" w:hanging="360"/>` : '',
  ].join('');
  const inner = look.bookmark
    ? `<w:bookmarkStart w:id="${look.bookmark.id}" w:name="${look.bookmark.name}"/>${content}<w:bookmarkEnd w:id="${look.bookmark.id}"/>`
    : content;
  return `<w:p><w:pPr>${props}</w:pPr>${inner}</w:p>`;
}

/**
 * @param newPage true when the first of these paragraphs has to start a new page
 */
function blocksXml(blocks: readonly Block[], base: Direction, out: string[], breakMark: string, newPage = false, textStyle?: string): void {
  // The first paragraph after a heading or a break is not set in.
  let first = true;
  let pageBreak = newPage;
  const add = (style: string, content: string, look: ParagraphLook): void => {
    out.push(paragraph(style, content, pageBreak ? { ...look, pageBreak } : look));
    pageBreak = false;
  };
  for (const block of blocks) {
    if (block.kind === 'break') {
      add(DOCX_STYLES.sceneBreak, run(breakMark, {}, false), { direction: 'ltr' });
      first = true;
      continue;
    }
    if (block.kind === 'code') {
      for (const line of block.lines) add(DOCX_STYLES.code, run(line, {}, false), { direction: 'ltr' });
      first = true;
      continue;
    }
    const direction = block.direction ?? base;
    const content = runsXml(block.runs, direction);
    if (block.kind === 'heading') {
      add(DOCX_STYLES.subheading, content, { direction });
      first = true;
    } else if (block.kind === 'quote') {
      add(DOCX_STYLES.quote, content, { direction });
    } else if (block.kind === 'item') {
      const marker = textRuns(`${block.marker} `, {}, direction);
      add(DOCX_STYLES.item, marker + content, { direction, indent: 360 + block.depth * 360 });
    } else {
      add(textStyle ?? (first ? DOCX_STYLES.textFirst : DOCX_STYLES.text), content, { direction });
      first = false;
    }
  }
}

function pageSetup(options: Pick<ExportOptions, 'paper'>, preset: Preset): string {
  const paper = PAPER_SIZES[options.paper];
  const twips = (inches: number): number => Math.round(inches * MARGIN_TWIPS);
  const top = twips(preset.margins.top);
  const bottom = twips(preset.margins.bottom);
  const side = twips(preset.margins.side);
  return `<w:pgSz w:w="${paper.width}" w:h="${paper.height}"/><w:pgMar w:top="${top}" w:right="${side}" w:bottom="${bottom}" w:left="${side}" w:header="720" w:footer="720" w:gutter="0"/>`;
}

type DocxOptions = Pick<ExportOptions, 'titlePage' | 'header' | 'contents' | 'paper'> & Partial<Pick<ExportOptions, 'preset'>>;

function presetOf(options: DocxOptions): Preset {
  return PRESETS[options.preset ?? 'manuscript'];
}

/** A page before or after the text. It starts a page of its own, unless the page it would start on is still empty. */
function matterXml(part: MatterPart, base: Direction, out: string[], breakMark: string, newPage: boolean, bookmark: { id: number; name: string } | undefined): void {
  let pageBreak = newPage;
  if (part.title !== null) {
    out.push(
      paragraph(`${DOCX_STYLES.heading}1`, textRuns(part.title, {}, part.direction), {
        direction: part.direction,
        pageBreak,
        ...(bookmark ? { bookmark } : {}),
      }),
    );
    pageBreak = false;
  }
  const style = part.role === 'dedication' ? DOCX_STYLES.dedication : part.role === 'epigraph' ? DOCX_STYLES.epigraph : undefined;
  blocksXml(part.blocks, base, out, breakMark, pageBreak, style);
}

function documentXml(manuscript: Manuscript, options: DocxOptions): string {
  const base = manuscript.direction;
  const preset = presetOf(options);
  const breakMark = preset.sceneBreak;
  const words = bookWords(manuscript.language);
  const body: string[] = [];
  const bookmarks = new Map<string, { id: number; name: string }>();
  const entries = options.contents ? [...contentsOf(manuscript), ...titledMatter(manuscript.back)] : [];
  entries.forEach((entry, index) => bookmarks.set(entry.id, { id: index + 1, name: `spellbook_${entry.id.replace(/-/g, '_')}` }));
  const linkTo = (id: string): { bookmark?: { id: number; name: string } } => {
    const bookmark = bookmarks.get(id);
    return bookmark ? { bookmark } : {};
  };

  if (options.titlePage) {
    const own = (text: string): Direction => directionOf(text) ?? base;
    body.push(paragraph(DOCX_STYLES.title, textRuns(manuscript.title, { bold: true }, base), { direction: own(manuscript.title) }));
    if (manuscript.author !== '') {
      body.push(paragraph(DOCX_STYLES.title, textRuns(manuscript.author, {}, base), { direction: own(manuscript.author) }));
    }
    if (preset.wordsOnTitlePage) body.push(paragraph(DOCX_STYLES.title, run(wordsLine(manuscript.words), {}, false), { direction: 'ltr' }));
    // The title page is a section of its own: centred on its page, without the line at the top.
    body.push(
      `<w:p><w:pPr><w:pStyle w:val="${DOCX_STYLES.title}"/><w:sectPr>${pageSetup(options, preset)}<w:vAlign w:val="center"/></w:sectPr></w:pPr></w:p>`,
    );
  }

  // Nothing has been printed on the page the text starts on: its first heading needs no new page.
  let pageIsNew = true;
  for (const part of manuscript.front) {
    matterXml(part, base, body, breakMark, !pageIsNew, undefined);
    pageIsNew = false;
  }
  let afterContents = !pageIsNew;
  if (entries.length > 0) {
    const contentsDirection: Direction = manuscript.language === 'he' ? 'rtl' : 'ltr';
    body.push(
      paragraph(DOCX_STYLES.contentsTitle, textRuns(words.contents, { bold: true }, contentsDirection), {
        direction: contentsDirection,
        pageBreak: !pageIsNew,
      }),
    );
    for (const entry of entries) {
      const link = `<w:hyperlink w:anchor="${bookmarks.get(entry.id)?.name ?? ''}" w:history="1">${textRuns(entry.title ?? '', {}, entry.direction)}</w:hyperlink>`;
      const style = `${DOCX_STYLES.contentsEntry}${entry.kind === 'matter' ? 1 : Math.min(3, entry.level)}`;
      body.push(paragraph(style, link, { direction: entry.direction }));
    }
    pageIsNew = false;
    afterContents = true;
  }

  for (const part of manuscript.parts) {
    if (part.kind === 'chapter') {
      const style = `${DOCX_STYLES.heading}${Math.min(3, part.level)}`;
      body.push(
        paragraph(style, textRuns(part.title, {}, part.direction), { direction: part.direction, pageBreak: !pageIsNew, ...linkTo(part.id) }),
      );
      pageIsNew = true;
      afterContents = false;
      continue;
    }
    // After the list of contents the text starts on a page of its own, whatever it starts with.
    const newPage = (part.opens === 'page' || afterContents) && !pageIsNew;
    afterContents = false;
    if (part.titled) {
      const style = `${DOCX_STYLES.heading}${Math.min(3, part.level)}`;
      // Under a chapter's heading the title is one level down; a new page is only for a scene that follows a chapter or asks for one.
      body.push(
        paragraph(style, textRuns(part.title, {}, part.direction), { direction: part.direction, pageBreak: newPage, ...linkTo(part.id) }),
      );
      blocksXml(part.blocks, base, body, breakMark);
    } else {
      if (part.opens === 'break') body.push(paragraph(DOCX_STYLES.sceneBreak, run(breakMark, {}, false), { direction: 'ltr' }));
      // With no title to carry it, the new page is asked for by the scene's first paragraph.
      blocksXml(part.blocks, base, body, breakMark, newPage);
    }
    pageIsNew = false;
  }

  for (const part of manuscript.back) {
    matterXml(part, base, body, breakMark, !pageIsNew, bookmarks.get(part.id));
    pageIsNew = false;
  }

  const header = options.header ? '<w:headerReference w:type="default" r:id="rId3"/>' : '';
  // Numbered lines, counted afresh on every page, for a proof.
  const lines = preset.lineNumbers ? '<w:lnNumType w:countBy="1" w:distance="360" w:restart="newPage"/>' : '';
  const numbering = options.titlePage ? '<w:pgNumType w:start="1"/>' : '';
  const bidi = base === 'rtl' ? '<w:bidi/>' : '';
  // A file must hold at least one paragraph.
  if (body.length === 0) body.push(paragraph(DOCX_STYLES.textFirst, '', { direction: base }));
  return `${XML_HEAD}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join('')}<w:sectPr>${header}${pageSetup(options, preset)}${lines}${numbering}${bidi}</w:sectPr></w:body></w:document>`;
}

function style(id: string, name: string, paragraphProps: string, runProps = '', extra = ''): string {
  return (
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/>` +
    `${paragraphProps === '' ? '' : `<w:pPr>${paragraphProps}</w:pPr>`}${runProps === '' ? '' : `<w:rPr>${runProps}</w:rPr>`}</w:style>`
  );
}

function stylesXml(preset: Preset): string {
  const s = DOCX_STYLES;
  const next = `<w:next w:val="${s.textFirst}"/>`;
  const line = Math.round(240 * preset.lineSpacing);
  // "both" sets a line flush with both margins; it works the same in a right-to-left paragraph.
  const justify = preset.justify ? '<w:jc w:val="both"/>' : '';
  const headings = [1, 2, 3]
    .map((level) =>
      style(
        `${s.heading}${level}`,
        `heading ${level}`,
        `<w:keepNext/><w:spacing w:before="${level === 1 ? 960 : 480}" w:after="480"/><w:jc w:val="center"/><w:outlineLvl w:val="${level - 1}"/>`,
        preset.largeChapterTitles && level < 3 ? `<w:sz w:val="${level === 1 ? 36 : 32}"/><w:szCs w:val="${level === 1 ? 36 : 32}"/>` : '<w:b/><w:bCs/>',
        next,
      ),
    )
    .join('');
  const contents = [1, 2, 3]
    .map((level) => style(`${s.contentsEntry}${level}`, `toc ${level}`, level === 1 ? '' : `<w:ind w:left="${(level - 1) * 720}"/>`))
    .join('');
  return (
    `${XML_HEAD}<w:styles xmlns:w="${W}">` +
    '<w:docDefaults>' +
    `<w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="he-IL"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    style(s.text, 'Manuscript Text', `<w:ind w:firstLine="720"/>${justify}`) +
    style(s.textFirst, 'Manuscript Text First', justify, '', `<w:next w:val="${s.text}"/>`) +
    style(s.sceneBreak, 'Scene Break', '<w:keepNext/><w:jc w:val="center"/>', '', next) +
    headings +
    style(s.subheading, 'Manuscript Subheading', '<w:keepNext/><w:spacing w:before="480"/>', '<w:b/><w:bCs/>', next) +
    style(s.quote, 'Manuscript Quote', '<w:ind w:left="720" w:right="720"/>') +
    style(s.item, 'Manuscript List', '<w:ind w:left="720" w:hanging="360"/>') +
    style(s.code, 'Manuscript Code', '<w:spacing w:line="240" w:lineRule="auto"/>', `<w:rFonts w:ascii="${CODE_FONT}" w:hAnsi="${CODE_FONT}" w:cs="${CODE_FONT}"/>`) +
    style(s.title, 'Manuscript Title', '<w:jc w:val="center"/>') +
    style(s.contentsTitle, 'Contents Title', '<w:spacing w:after="480"/><w:jc w:val="center"/>') +
    contents +
    style(s.header, 'header', '<w:spacing w:line="240" w:lineRule="auto"/>') +
    // Two inches down the page; between two of its own paragraphs no space is added (contextualSpacing).
    style(s.dedication, 'Dedication', '<w:spacing w:before="2880"/><w:contextualSpacing/><w:jc w:val="center"/>') +
    style(s.epigraph, 'Epigraph', '<w:spacing w:before="2880"/><w:ind w:left="1440" w:right="1440"/><w:contextualSpacing/>') +
    '</w:styles>'
  );
}

function headerXml(manuscript: Manuscript): string {
  const text = headerText(manuscript);
  const direction: Direction = directionOf(text) ?? manuscript.direction;
  const field =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  // "right" is the far side of the line: the right of a left-to-right paragraph, the left of a right-to-left one.
  const props = `<w:pStyle w:val="${DOCX_STYLES.header}"/>${direction === 'rtl' ? '<w:bidi/>' : ''}<w:jc w:val="right"/>`;
  return `${XML_HEAD}<w:hdr xmlns:w="${W}" xmlns:r="${R}"><w:p><w:pPr>${props}</w:pPr>${textRuns(text, {}, direction)}${field}</w:p></w:hdr>`;
}

function contentTypesXml(header: boolean): string {
  return (
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/word/${MAIN_PART}.xml" ContentType="${WORD_TYPE}.${MAIN_PART}.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="${WORD_TYPE}.styles+xml"/>` +
    `<Override PartName="/word/settings.xml" ContentType="${WORD_TYPE}.settings+xml"/>` +
    (header ? `<Override PartName="/word/header1.xml" ContentType="${WORD_TYPE}.header+xml"/>` : '') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>'
  );
}

function relationships(list: ReadonlyArray<readonly [id: string, type: string, target: string]>): string {
  const items = list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('');
  return `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELS}">${items}</Relationships>`;
}

function settingsXml(): string {
  return (
    `${XML_HEAD}<w:settings xmlns:w="${W}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/>` +
    '<w:characterSpacingControl w:val="doNotCompress"/>' +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    '<w:themeFontLang w:val="en-US" w:bidi="he-IL"/></w:settings>'
  );
}

function corePropertiesXml(manuscript: Manuscript): string {
  return (
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${escapeXml(manuscript.title)}</dc:title><dc:creator>${escapeXml(manuscript.author)}</dc:creator></cp:coreProperties>`
  );
}

/** The files a .docx of this manuscript is made of, in the order they go into the zip. */
export function docxParts(manuscript: Manuscript, options: DocxOptions): ZipEntry[] {
  const parts: Array<[string, string]> = [
    ['[Content_Types].xml', contentTypesXml(options.header)],
    [
      '_rels/.rels',
      relationships([
        ['rId1', `${R}/officeDocument`, `word/${MAIN_PART}.xml`],
        ['rId2', `${PACKAGE_RELS}/metadata/core-properties`, 'docProps/core.xml'],
      ]),
    ],
    [`word/${MAIN_PART}.xml`, documentXml(manuscript, options)],
    [
      `word/_rels/${MAIN_PART}.xml.rels`,
      relationships([
        ['rId1', `${R}/styles`, 'styles.xml'],
        ['rId2', `${R}/settings`, 'settings.xml'],
        ...(options.header ? ([['rId3', `${R}/header`, 'header1.xml']] as const) : []),
      ]),
    ],
    ['word/styles.xml', stylesXml(presetOf(options))],
    ['word/settings.xml', settingsXml()],
    ...(options.header ? ([['word/header1.xml', headerXml(manuscript)]] as Array<[string, string]>) : []),
    ['docProps/core.xml', corePropertiesXml(manuscript)],
  ];
  return parts.map(([name, text]) => ({ name, data: utf8(text) }));
}

/** The manuscript as the bytes of a .docx file. */
export function toDocx(manuscript: Manuscript, options: DocxOptions): Uint8Array {
  return zipStored(docxParts(manuscript, options));
}
