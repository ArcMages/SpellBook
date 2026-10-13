// The three writers (src/core/export/toMarkdown.ts, toHtml.ts, toDocx.ts):
// the same manuscript as a Markdown note, a web page and a Word file. Each
// must hold the scenes in binder order, leave out what is switched off, and
// carry Hebrew right to left. The Word file is opened again with the
// plugin's own zip reader and its XML is checked part by part.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_OPTIONS,
  DOCX_STYLES,
  buildManuscript,
  docxParts,
  fromUtf8,
  toDocx,
  toHtml,
  toMarkdown,
  unzipStored,
} from '../../../src/core/export';
import type { ExportOptions, Manuscript } from '../../../src/core/export';
import type { TreeNode } from '../../../src/core/types';
import { readXml, textOf } from './xml';

const scene = (title: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${title}.md`, title, missing: false });

const HEBREW_FOLDER = 'חלק שני';
const HEBREW_SCENE = 'לילה בנמל';
const HEBREW_LINE = 'שלום לך אחותי היקרה.';
const MIXED_LINE = 'הוא אמר hello והלך.';

const TREE: TreeNode[] = [
  scene('Opening'),
  {
    kind: 'folder',
    id: 'one',
    name: 'Part one',
    children: [scene('The Letter'), scene('Draft'), scene('Reply'), { kind: 'folder', id: 'inner', name: HEBREW_FOLDER, children: [scene(HEBREW_SCENE)] }],
  },
  scene('Closing'),
];

const TEXTS: Record<string, { compile: boolean; text: string }> = {
  Opening: {
    compile: true,
    text: '---\nstatus: Done\nsynopsis: Anna arrives\n---\nIt was a **dark** night, said *Anna*. %%check the weather%%\nShe read [the letter](https://example.com) & wept <quietly>.\n\n***\n\nMorning came.\n> Quoted words.\n- first item\n## A heading inside\n',
  },
  'The Letter': { compile: true, text: 'Dear Anna.\nHe said שלום and left.\n' },
  Draft: { compile: false, text: 'SECRET DRAFT TEXT.\n' },
  Reply: { compile: true, text: 'Dear Daniel.\n' },
  [HEBREW_SCENE]: { compile: true, text: `${HEBREW_LINE}\n${MIXED_LINE}\nכתבתי **שלושה** מכתבים.\n` },
  Closing: { compile: true, text: 'The end came quietly.\n' },
};

const SCENES = new Map(Object.entries(TEXTS).map(([title, source]) => [`Manuscript/${title}.md`, source]));

function manuscript(options: Partial<ExportOptions> = {}): { manuscript: Manuscript; options: ExportOptions } {
  const all = { ...DEFAULT_EXPORT_OPTIONS, author: 'Dana Marlow', ...options };
  return { manuscript: buildManuscript({ title: 'My Novel', tree: TREE, options: all, scenes: SCENES }), options: all };
}

/** The sentences that must appear, in this order, in every export of the whole manuscript. */
const IN_ORDER = ['It was a', 'Morning came.', 'Part one', 'Dear Anna.', 'Dear Daniel.', HEBREW_FOLDER, HEBREW_LINE, 'The end came quietly.'];

function expectInOrder(text: string, pieces: readonly string[]): void {
  let from = 0;
  for (const piece of pieces) {
    const at = text.indexOf(piece, from);
    expect(at, `"${piece}" should come after what is before it`).toBeGreaterThanOrEqual(from);
    from = at + piece.length;
  }
}

function expectNothingPrivate(text: string): void {
  expect(text).not.toContain('SECRET DRAFT');
  expect(text).not.toContain('check the weather');
  expect(text).not.toContain('status: Done');
  expect(text).not.toContain('Anna arrives');
  expect(text).not.toContain('Manuscript/');
  expect(text).not.toContain('.md');
}

// ------------------------------------------------------------------ Markdown

describe('toMarkdown', () => {
  it('holds the scenes in binder order under their chapters, without what is switched off, the properties or the comments', () => {
    const { manuscript: built, options } = manuscript();
    const text = toMarkdown(built, options);
    expectInOrder(text, IN_ORDER);
    expectNothingPrivate(text);
  });

  it('keeps the text as the writer wrote it, links and emphasis and all', () => {
    const { manuscript: built, options } = manuscript();
    const text = toMarkdown(built, options);
    expect(text).toContain('It was a **dark** night, said *Anna*.\nShe read [the letter](https://example.com) & wept <quietly>.');
    expect(text).toContain(`${HEBREW_LINE}\n${MIXED_LINE}`);
  });

  it('starts with the title, the author and the word count, and puts chapters under them', () => {
    const { manuscript: built, options } = manuscript();
    const text = toMarkdown(built, options);
    expect(text.startsWith(`# My Novel\n\nDana Marlow\n\n${built.words} words\n\n`)).toBe(true);
    expect(text).toContain('\n## Part one\n');
    expect(text).toContain(`\n### ${HEBREW_FOLDER}\n`);
    // The scene's own heading sits below its chapter's.
    expect(text).toContain('\n### A heading inside\n');
    expect(text).toContain('\nDear Anna.\nHe said שלום and left.\n\n* * *\n\nDear Daniel.\n');
  });

  it('without a title page the chapters are at the top level; with scene titles each scene has a heading', () => {
    const plain = manuscript({ titlePage: false });
    expect(toMarkdown(plain.manuscript, plain.options).startsWith('It was a')).toBe(true);
    expect(toMarkdown(plain.manuscript, plain.options)).toContain('\n# Part one\n');
    const titled = manuscript({ titlePage: false, sceneTitles: true });
    const text = toMarkdown(titled.manuscript, titled.options);
    expect(text.startsWith('# Opening\n\nIt was a')).toBe(true);
    expect(text).toContain('\n# Part one\n\n## The Letter\n\nDear Anna.');
    expect(text).toContain(`\n## ${HEBREW_FOLDER}\n\n### ${HEBREW_SCENE}\n`);
    expect(text).not.toContain('* * *');
  });

  it('lists the chapters when the contents are asked for', () => {
    const { manuscript: built, options } = manuscript({ contents: true });
    expect(toMarkdown(built, options)).toContain(`\n- Part one\n  - ${HEBREW_FOLDER}\n`);
  });
});

// ----------------------------------------------------------------- web page

describe('toHtml', () => {
  const { manuscript: built, options } = manuscript({ contents: true });
  const html = toHtml(built, options);
  const body = html.slice(html.indexOf('<body>'));

  it('holds the scenes in binder order under their chapters, without what is switched off, the properties or the comments', () => {
    expectInOrder(textOf(body), ['My Novel', 'Dana Marlow', 'Contents', ...IN_ORDER]);
    expectNothingPrivate(html);
  });

  it('is a whole page that says what it is', () => {
    expect(html.startsWith('<!DOCTYPE html>\n<html dir="ltr">')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>My Novel</title>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('marks every Hebrew paragraph and heading as right to left, and the others as left to right', () => {
    expect(body).toContain(`<p class="first" dir="rtl">${HEBREW_LINE}</p>`);
    expect(body).toContain(`<p dir="rtl">${MIXED_LINE}</p>`);
    expect(body).toContain('<p dir="rtl">כתבתי <strong>שלושה</strong> מכתבים.</p>');
    expect(body).toContain('<p dir="ltr">He said שלום and left.</p>');
    expect(body).toMatch(new RegExp(`<h3 class="chapter level-2" id="part-\\d+" dir="rtl">${HEBREW_FOLDER}</h3>`));
    // Every block of text says which way it runs.
    for (const tag of body.match(/<(p|h[1-4]|blockquote)\b[^>]*>/g) ?? []) {
      if (/class="(break|author|words)"/.test(tag) || tag === '<p>') continue;
      expect(tag, tag).toMatch(/ dir="(ltr|rtl|auto)"/);
    }
  });

  it('turns the Markdown into the page\'s own marks, and makes the writer\'s text safe', () => {
    expect(body).toContain('<p class="first" dir="ltr">It was a <strong>dark</strong> night, said <em>Anna</em>.</p>');
    expect(body).toContain('<p dir="ltr">She read the letter &amp; wept .</p>');
    expect(body).toContain('<p class="break">#</p>\n<p class="first" dir="ltr">Morning came.</p>');
    expect(body).toContain('<blockquote dir="ltr"><p>Quoted words.</p></blockquote>');
    expect(body).toContain('<span class="marker">•</span> first item</p>');
    expect(body).toContain('<h4 dir="ltr">A heading inside</h4>');
    const risky = buildManuscript({
      title: 'A "quoted" <title> & more',
      tree: [scene('Opening')],
      options: DEFAULT_EXPORT_OPTIONS,
      scenes: new Map([['Manuscript/Opening.md', { compile: true, text: 'x < y & "z" \\<b\\>\n' }]]),
    });
    const page = toHtml(risky, DEFAULT_EXPORT_OPTIONS);
    expect(page).toContain('<title>A &quot;quoted&quot; &lt;title&gt; &amp; more</title>');
    expect(page).toContain('x &lt; y &amp; &quot;z&quot; &lt;b&gt;');
    // The line at the top of the page is a string of the stylesheet: nothing in it can end the string or the sheet.
    expect(page).toMatch(/content: "A \\22 quoted\\22  \\3c title\\3e  \\26  more \/ " counter\(page\)/);
  });

  it('is laid out as a standard manuscript on paper', () => {
    expect(html).toContain('@page { size: A4; margin: 1in; @top-right { content: "Marlow / My Novel / " counter(page);');
    expect(html).toContain('@page :first { @top-right { content: none; } }');
    expect(html).toMatch(/body \{[^}]*"Times New Roman"[^}]*font-size: 12pt; line-height: 2;/);
    expect(html).toMatch(/\np \{[^}]*text-indent: 0\.5in;/);
    expect(html).toMatch(/\.chapter, \.new-page \{ break-before: page;/);
    // The first chapter after other text starts a page; a scene that follows a chapter does too.
    expect(body).toContain('<h2 class="chapter level-1"');
    expect(body).toContain('<div class="new-page"></div>\n<p class="first" dir="ltr">The end came quietly.</p>');
    const letter = manuscript({ paper: 'letter', header: false });
    const other = toHtml(letter.manuscript, letter.options);
    expect(other).toContain('@page { size: letter; margin: 1in; }');
    expect(other).not.toContain('counter(page)');
  });

  it('lists the chapters, each a link to its heading', () => {
    const links = [...body.matchAll(/<a href="#(part-\d+)">([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]);
    expect(links.map((link) => link[1])).toEqual(['Part one', HEBREW_FOLDER]);
    for (const [id] of links) expect(body).toContain(` id="${id}"`);
  });

  it('carries no script, except the Print button of the page made for printing', () => {
    expect(html).not.toMatch(/<script|onclick|javascript:/i);
    const printable = toHtml(built, options, true);
    expect(printable).toContain('<button type="button" onclick="print()">Print / save as PDF</button>');
    expect(printable).toContain('@media print { body { max-width: none; padding: 0; } .print-bar { display: none; } }');
    expect(printable).not.toMatch(/<script|javascript:|https?:/i);
  });

  it('a Hebrew manuscript is a right-to-left page, with the page line at the other corner', () => {
    const hebrew = manuscript({ scope: 'inner' });
    const page = toHtml(hebrew.manuscript, hebrew.options);
    expect(page).toContain('<html lang="he" dir="rtl">');
    expect(page).toContain('@top-left { content: "Marlow / My Novel / " counter(page);');
  });
});

// --------------------------------------------------------------------- Word

describe('toDocx', () => {
  const { manuscript: built, options } = manuscript({ contents: true });
  const files = new Map(unzipStored(toDocx(built, options)).map((entry) => [entry.name, fromUtf8(entry.data)]));
  const main = files.get('word/document.xml') ?? '';
  const paragraphs = main.match(/<w:p>.*?<\/w:p>/g) ?? [];
  const paragraphWith = (text: string): string => {
    const found = paragraphs.filter((paragraph) => textOf(paragraph).includes(text));
    if (found.length === 0) throw new Error(`no paragraph says "${text}"`);
    return found[found.length - 1] as string;
  };

  it('is a zip that holds the parts of a Word file, the list of kinds first', () => {
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/settings.xml',
      'word/header1.xml',
      'docProps/core.xml',
    ]);
    expect(docxParts(built, options).map((entry) => entry.name)).toEqual([...files.keys()]);
  });

  it('every part is well-formed XML', () => {
    for (const [name, xml] of files) {
      expect(() => readXml(xml), name).not.toThrow();
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name).toBe(true);
    }
  });

  it('every part is named in the list of kinds, and every link between parts leads to a part', () => {
    const kinds = readXml(files.get('[Content_Types].xml') ?? '');
    const named = kinds.filter((element) => element.name === 'Override').map((element) => element.attributes['PartName']);
    expect(named.sort()).toEqual(['/docProps/core.xml', '/word/document.xml', '/word/header1.xml', '/word/settings.xml', '/word/styles.xml']);
    const targets = (rels: string, base: string): string[] =>
      readXml(files.get(rels) ?? '')
        .filter((element) => element.name === 'Relationship')
        .map((element) => base + (element.attributes['Target'] ?? ''));
    for (const target of [...targets('_rels/.rels', ''), ...targets('word/_rels/document.xml.rels', 'word/')]) {
      expect(files.has(target), target).toBe(true);
    }
    // What the text refers to by id is there: the header.
    const ids = readXml(files.get('word/_rels/document.xml.rels') ?? '').map((element) => element.attributes['Id']);
    for (const reference of main.matchAll(/r:id="([^"]+)"/g)) expect(ids).toContain(reference[1]);
  });

  it('holds the scenes in binder order under their chapters, without what is switched off, the properties or the comments', () => {
    expectInOrder(paragraphs.map(textOf).join('\n'), ['My Novel', 'Dana Marlow', 'Contents', ...IN_ORDER]);
    for (const xml of files.values()) expectNothingPrivate(xml);
  });

  it('uses only styles it defines', () => {
    const defined = readXml(files.get('word/styles.xml') ?? '')
      .filter((element) => element.name === 'w:style')
      .map((element) => element.attributes['w:styleId']);
    const used = new Set([...main.matchAll(/<w:pStyle w:val="([^"]+)"\/>/g)].map((match) => match[1]));
    expect(used.size).toBeGreaterThan(6);
    for (const style of used) expect(defined, style).toContain(style);
    expect(defined).toContain(DOCX_STYLES.header);
  });

  it('is a standard manuscript: 12 point Times New Roman, double spaced, first lines set in, one inch of margin', () => {
    const styles = files.get('word/styles.xml') ?? '';
    expect(styles).toContain('<w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/>');
    expect(styles).toContain('<w:spacing w:after="0" w:line="480" w:lineRule="auto"/>');
    expect(styles).toMatch(/w:styleId="ManuscriptText">.*?<w:ind w:firstLine="720"\/>/);
    expect(main).toContain('<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>');
    // The first paragraph of a scene is not set in; the next one is.
    expect(paragraphWith('It was a')).toContain('<w:pStyle w:val="ManuscriptTextFirst"/>');
    expect(paragraphWith('She read')).toContain('<w:pStyle w:val="ManuscriptText"/>');
  });

  it('marks scene breaks with a centred #, and starts every chapter on a new page', () => {
    const breaks = paragraphs.filter((paragraph) => paragraph.includes('<w:pStyle w:val="SceneBreak"/>'));
    expect(breaks.map(textOf)).toEqual(['#', '#']); // inside Opening, and between The Letter and Reply
    expect(files.get('word/styles.xml')).toMatch(/w:styleId="SceneBreak">.*?<w:jc w:val="center"\/>/);
    expect(paragraphWith('Part one')).toContain('<w:pStyle w:val="Heading1"/><w:pageBreakBefore/>');
    expect(paragraphWith(HEBREW_FOLDER)).toContain('<w:pStyle w:val="Heading2"/><w:pageBreakBefore/><w:bidi/>');
    // A scene that follows a chapter without being part of it starts a page too; the text after the contents as well.
    expect(paragraphWith('The end came quietly.')).toContain('<w:pageBreakBefore/>');
    expect(paragraphWith('It was a')).toContain('<w:pageBreakBefore/>');
    expect(paragraphWith('Dear Anna.')).not.toContain('<w:pageBreakBefore/>');
  });

  it('marks a Hebrew paragraph as right to left, and every stretch of Hebrew letters as right-to-left script', () => {
    expect(paragraphWith(HEBREW_LINE)).toBe(
      `<w:p><w:pPr><w:pStyle w:val="ManuscriptTextFirst"/><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${HEBREW_LINE}</w:t></w:r></w:p>`,
    );
    // Hebrew with an English word in it: a right-to-left paragraph, the English word in a run of its own.
    expect(paragraphWith(MIXED_LINE)).toBe(
      '<w:p><w:pPr><w:pStyle w:val="ManuscriptText"/><w:bidi/></w:pPr>' +
        '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">הוא אמר </w:t></w:r>' +
        '<w:r><w:t xml:space="preserve">hello </w:t></w:r>' +
        '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">והלך.</w:t></w:r></w:p>',
    );
    // English with a Hebrew word in it: a left-to-right paragraph, the Hebrew word marked.
    const english = paragraphWith('He said');
    expect(english).not.toContain('<w:bidi/>');
    expect(english).toContain('<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">שלום </w:t></w:r>');
    // Bold Hebrew is bold as right-to-left script as well.
    expect(paragraphWith('שלושה')).toContain('<w:rPr><w:b/><w:bCs/><w:rtl/></w:rPr><w:t xml:space="preserve">שלושה</w:t>');
    expect(files.get('word/styles.xml')).toContain('w:bidi="he-IL"');
  });

  it('turns emphasis into bold and italics, and makes the writer\'s text safe', () => {
    const opening = paragraphWith('It was a');
    expect(opening).toContain('<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">dark</w:t></w:r>');
    expect(opening).toContain('<w:r><w:rPr><w:i/><w:iCs/></w:rPr><w:t xml:space="preserve">Anna</w:t></w:r>');
    expect(paragraphWith('She read')).toContain('She read the letter &amp; wept .');
    expect(paragraphWith('Quoted words.')).toContain('<w:pStyle w:val="ManuscriptQuote"/>');
    expect(paragraphWith('first item')).toContain('<w:pStyle w:val="ManuscriptList"/><w:ind w:left="720" w:hanging="360"/>');
    expect(paragraphWith('A heading inside')).toContain('<w:pStyle w:val="Subheading"/>');
  });

  it('writes the elements of a paragraph and of a run in the order the format lays down', () => {
    const paragraphOrder = ['w:pStyle', 'w:keepNext', 'w:pageBreakBefore', 'w:widowControl', 'w:bidi', 'w:spacing', 'w:ind', 'w:jc', 'w:outlineLvl', 'w:rPr', 'w:sectPr'];
    const runOrder = ['w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:strike', 'w:sz', 'w:szCs', 'w:rtl', 'w:lang'];
    const sectionOrder = ['w:headerReference', 'w:pgSz', 'w:pgMar', 'w:pgNumType', 'w:vAlign', 'w:bidi'];
    const styleOrder = ['w:name', 'w:basedOn', 'w:next', 'w:qFormat', 'w:pPr', 'w:rPr'];
    const orders: Record<string, string[]> = { 'w:pPr': paragraphOrder, 'w:rPr': runOrder, 'w:sectPr': sectionOrder, 'w:style': styleOrder };
    let checked = 0;
    for (const name of ['word/document.xml', 'word/styles.xml', 'word/header1.xml']) {
      for (const element of readXml(files.get(name) ?? '')) {
        const order = orders[element.name];
        if (!order) continue;
        const places = element.children.map((child) => order.indexOf(child));
        expect(places.includes(-1), `${name}: <${element.name}> holds ${element.children.join(', ')}`).toBe(false);
        expect([...places].sort((a, b) => a - b), `${name}: <${element.name}> holds ${element.children.join(', ')}`).toEqual(places);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('has a title page of its own, centred on its page, and numbers the pages from the text on', () => {
    expect(paragraphs.slice(0, 3).map(textOf)).toEqual(['My Novel', 'Dana Marlow', `${built.words} words`]);
    expect(paragraphs[3]).toBe(
      '<w:p><w:pPr><w:pStyle w:val="ManuscriptTitle"/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:vAlign w:val="center"/></w:sectPr></w:pPr></w:p>',
    );
    expect(main).toMatch(/<w:sectPr><w:headerReference w:type="default" r:id="rId3"\/><w:pgSz [^>]*\/><w:pgMar [^>]*\/><w:pgNumType w:start="1"\/><\/w:sectPr><\/w:body><\/w:document>$/);
  });

  it('prints the author, the title and the page number at the top of every page', () => {
    const header = files.get('word/header1.xml') ?? '';
    expect(textOf(header)).toContain('Marlow / My Novel / ');
    expect(header).toContain('<w:pStyle w:val="Header"/><w:jc w:val="right"/>');
    expect(header).toContain('<w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/>');
    expect(header).toContain('<w:fldChar w:fldCharType="end"/>');
  });

  it('lists the chapters, each a link to a bookmark on its heading', () => {
    const anchors = [...main.matchAll(/<w:hyperlink w:anchor="([^"]+)"/g)].map((match) => match[1]);
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      const start = new RegExp(`<w:bookmarkStart w:id="(\\d+)" w:name="${anchor}"/>`).exec(main);
      expect(start, anchor).not.toBeNull();
      expect(main).toContain(`<w:bookmarkEnd w:id="${start?.[1]}"/>`);
    }
    expect(paragraphWith('Part one')).toContain('<w:bookmarkStart');
  });

  it('leaves out the header, the title page and the contents when they are switched off, and prints scene titles when asked', () => {
    const bare = manuscript({ header: false, titlePage: false, sceneTitles: true });
    const parts = new Map(unzipStored(toDocx(bare.manuscript, bare.options)).map((entry) => [entry.name, fromUtf8(entry.data)]));
    expect(parts.has('word/header1.xml')).toBe(false);
    expect(parts.get('[Content_Types].xml')).not.toContain('header');
    expect(parts.get('word/_rels/document.xml.rels')).not.toContain('header');
    const text = parts.get('word/document.xml') ?? '';
    expect(text).not.toContain('headerReference');
    expect(text).not.toContain('hyperlink');
    expect((text.match(/<w:sectPr>/g) ?? []).length).toBe(1);
    const lines = (text.match(/<w:p>.*?<\/w:p>/g) ?? []).map(textOf);
    expect(lines.slice(0, 2)).toEqual(['Opening', 'It was a dark night, said Anna.']);
    expect(lines).toContain(HEBREW_SCENE);
    // The very first paragraph asks for no new page: there is nothing before it.
    expect(text.indexOf('<w:pageBreakBefore/>')).toBeGreaterThan(text.indexOf('Opening'));
    for (const xml of parts.values()) expect(() => readXml(xml)).not.toThrow();
  });

  it('a Hebrew manuscript is a right-to-left document, on the paper chosen', () => {
    const hebrew = manuscript({ scope: 'inner', paper: 'letter', author: 'דנה מרלו' });
    const parts = new Map(unzipStored(toDocx(hebrew.manuscript, hebrew.options)).map((entry) => [entry.name, fromUtf8(entry.data)]));
    expect(parts.get('word/document.xml')).toMatch(/<w:pgSz w:w="12240" w:h="15840"\/><w:pgMar [^>]*\/><w:pgNumType w:start="1"\/><w:bidi\/><\/w:sectPr><\/w:body>/);
    expect(parts.get('word/header1.xml')).toContain('<w:pStyle w:val="Header"/><w:bidi/><w:jc w:val="right"/>');
    expect(parts.get('docProps/core.xml')).toContain('<dc:creator>דנה מרלו</dc:creator>');
  });

  it('gives the same file for the same manuscript, and still a file for a manuscript with nothing in it', () => {
    expect(toDocx(built, options)).toEqual(toDocx(built, options));
    const empty = buildManuscript({ title: 'Empty', tree: [], options: DEFAULT_EXPORT_OPTIONS, scenes: new Map() });
    const parts = unzipStored(toDocx(empty, { ...DEFAULT_EXPORT_OPTIONS, titlePage: false, header: false }));
    expect(fromUtf8(parts[2]!.data)).toContain('<w:p><w:pPr><w:pStyle w:val="ManuscriptTextFirst"/></w:pPr></w:p><w:sectPr>');
  });

  it('drops characters that no XML file may hold', () => {
    const odd = buildManuscript({
      title: 'T',
      tree: [scene('Opening')],
      options: DEFAULT_EXPORT_OPTIONS,
      scenes: new Map([['Manuscript/Opening.md', { compile: true, text: `Bell${String.fromCharCode(7)} and\ttab ${String.fromCharCode(0xb)}end.\n` }]]),
    });
    const text = fromUtf8(unzipStored(toDocx(odd, DEFAULT_EXPORT_OPTIONS))[2]!.data);
    expect(text).toContain('Bell and tab end.');
  });
});
