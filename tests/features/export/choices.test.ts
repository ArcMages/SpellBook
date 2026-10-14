// The choices added in 1.1 (src/core/export/manuscript.ts and the writers):
// the three presets, a scene's own "export-page-break" and "export-title",
// the pages before and after the text, and the language of the book.

import { describe, expect, it } from 'vitest';
import {
  BOOK_SCENE_BREAK,
  BOOK_WORDS,
  DEFAULT_EXPORT_OPTIONS,
  PRESETS,
  buildManuscript,
  contentsOf,
  fromUtf8,
  readExportOptions,
  readSceneExportChoices,
  toDocx,
  toHtml,
  toMarkdown,
  unzipStored,
  withPreset,
} from '../../../src/core/export';
import type { ExportOptions, Manuscript, MatterKind, SceneSource } from '../../../src/core/export';
import type { TreeNode } from '../../../src/core/types';
import { readXml, textOf } from './xml';

const scene = (title: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${title}.md`, title, missing: false });

const TREE: TreeNode[] = [
  { kind: 'folder', id: 'one', name: 'Chapter One', children: [scene('Arrival'), scene('Letter'), scene('Storm')] },
  { kind: 'folder', id: 'two', name: 'Chapter Two', children: [scene('Morning')] },
];

const TEXTS: Record<string, SceneSource> = {
  Arrival: { compile: true, text: 'Anna came to the town.\n' },
  Letter: { compile: true, text: 'The letter was short.\n', title: true },
  Storm: { compile: true, text: 'The storm broke.\n', pageBreak: true },
  Morning: { compile: true, text: 'Morning came.\n' },
};

function build(options: Partial<ExportOptions> = {}, texts: Record<string, SceneSource> = TEXTS, matter?: Map<MatterKind, string>): Manuscript {
  const scenes = new Map(Object.entries(texts).map(([title, source]) => [`Manuscript/${title}.md`, source]));
  return buildManuscript({ title: 'My Novel', tree: TREE, options: { ...DEFAULT_EXPORT_OPTIONS, author: 'Dana Marlow', ...options }, scenes, ...(matter ? { matter } : {}) });
}

const MATTER = new Map<MatterKind, string>([
  ['dedication', 'For my sister.'],
  ['epigraph', 'All happy families are alike.'],
  ['acknowledgements', 'Thanks to everyone.'],
  ['about', '---\nstatus: Done\n---\n# About Dana\nDana lives by the sea. %%private%%\n'],
]);

describe('a scene\'s own choices', () => {
  it('are read from its properties, and anything that is not true or false counts as not given', () => {
    expect(readSceneExportChoices({ 'export-page-break': true, 'export-title': false })).toEqual({ pageBreak: true, title: false });
    expect(readSceneExportChoices({ 'export-page-break': 'yes', 'export-title': 'true' })).toEqual({ pageBreak: true, title: true });
    expect(readSceneExportChoices({ 'export-page-break': 3, 'export-title': ['x'] })).toEqual({ pageBreak: false, title: null });
    expect(readSceneExportChoices(null)).toEqual({ pageBreak: false, title: null });
  });

  it('start a scene on a new page, and print or hide its title whatever the window says', () => {
    const manuscript = build();
    const parts = manuscript.parts.filter((part) => part.kind === 'scene');
    expect(parts.map((part) => (part.kind === 'scene' ? `${part.title} ${part.opens} ${part.titled}` : ''))).toEqual([
      'Arrival first false',
      'Letter break true',
      'Storm page false',
      'Morning first false',
    ]);
    const hidden = build({ sceneTitles: true }, { ...TEXTS, Morning: { compile: true, text: 'Morning came.\n', title: false } });
    expect(hidden.parts.filter((part) => part.kind === 'scene' && part.titled).map((part) => part.title)).toEqual(['Arrival', 'Letter', 'Storm']);
    // The contents list the scenes whose titles are printed.
    expect(contentsOf(manuscript).map((part) => part.title)).toEqual(['Chapter One', 'Letter', 'Chapter Two']);
  });

  it('a page break straight under a chapter heading asks for nothing more', () => {
    const manuscript = build({}, { ...TEXTS, Arrival: { compile: true, text: 'Anna came.\n', pageBreak: true } });
    expect(manuscript.parts.find((part) => part.kind === 'scene' && part.title === 'Arrival')).toMatchObject({ opens: 'first' });
  });

  it('show in every format', () => {
    const manuscript = build();
    const html = toHtml(manuscript, DEFAULT_EXPORT_OPTIONS);
    expect(html).toContain('<h4 class="scene-title" id="part-3" dir="ltr">Letter</h4>');
    expect(html).toContain('<div class="new-page"></div>\n<p class="first" dir="ltr">The storm broke.</p>');
    const markdown = toMarkdown(manuscript, DEFAULT_EXPORT_OPTIONS);
    expect(markdown).toContain('\n### Letter\n\nThe letter was short.\n\n* * *\n\nThe storm broke.');
    const main = fromUtf8(unzipStored(toDocx(manuscript, DEFAULT_EXPORT_OPTIONS)).find((entry) => entry.name === 'word/document.xml')?.data ?? new Uint8Array());
    const storm = (main.match(/<w:p>.*?<\/w:p>/g) ?? []).find((paragraph) => textOf(paragraph).includes('The storm broke.')) ?? '';
    expect(storm).toContain('<w:pageBreakBefore/>');
    expect((main.match(/<w:p>.*?<\/w:p>/g) ?? []).some((paragraph) => paragraph.includes('Heading2') && textOf(paragraph) === 'Letter')).toBe(true);
  });
});

describe('the presets', () => {
  it('a preset sets the switches; the rest of the choices stay', () => {
    const chosen = withPreset({ ...DEFAULT_EXPORT_OPTIONS, author: 'Dana', format: 'epub' }, 'reading');
    expect(chosen).toMatchObject({ preset: 'reading', author: 'Dana', format: 'epub', header: false, contents: true, titlePage: true });
    expect(withPreset(chosen, 'proof')).toMatchObject({ preset: 'proof', header: true, sceneTitles: true, contents: false });
    // Saved choices from before presets existed are a standard manuscript.
    expect(readExportOptions({ format: 'html', titlePage: false }).preset).toBe('manuscript');
    expect(readExportOptions({ preset: 'reading' })).toMatchObject({ preset: 'reading', header: false, contents: true });
    expect(readExportOptions({ preset: 'novel' }).preset).toBe('manuscript');
  });

  it('a reading copy in Word: book-like spacing, lines flush with both margins, stars between scenes, no word count', () => {
    const options = withPreset(DEFAULT_EXPORT_OPTIONS, 'reading');
    const manuscript = build({ ...options, sceneTitles: false }, { ...TEXTS, Letter: { compile: true, text: 'The letter was short.\n' } });
    const files = new Map(unzipStored(toDocx(manuscript, options)).map((entry) => [entry.name, fromUtf8(entry.data)]));
    const styles = files.get('word/styles.xml') ?? '';
    expect(styles).toContain(`w:line="${Math.round(240 * PRESETS.reading.lineSpacing)}"`);
    expect(styles).toMatch(/w:styleId="ManuscriptText">.*?<w:jc w:val="both"\/>/);
    const main = files.get('word/document.xml') ?? '';
    expect(main).toContain(BOOK_SCENE_BREAK);
    expect(textOf(main)).not.toContain('words');
    expect(main).not.toContain('w:headerReference');
    for (const xml of files.values()) expect(() => readXml(xml)).not.toThrow();
  });

  it('a proof in Word: two inches at the sides, and numbered lines', () => {
    const options = withPreset(DEFAULT_EXPORT_OPTIONS, 'proof');
    const main = fromUtf8(unzipStored(toDocx(build(options), options)).find((entry) => entry.name === 'word/document.xml')?.data ?? new Uint8Array());
    expect(main).toContain('<w:pgMar w:top="1440" w:right="2880" w:bottom="1440" w:left="2880"');
    expect(main).toMatch(/<w:pgMar [^>]*\/><w:lnNumType w:countBy="1" w:distance="360" w:restart="newPage"\/><w:pgNumType/);
  });

  it('a proof printed from the web page has the same margins; a reading copy is not double spaced', () => {
    const proof = withPreset(DEFAULT_EXPORT_OPTIONS, 'proof');
    expect(toHtml(build(proof), proof, true)).toContain('@page { size: A4; margin: 1in 2in;');
    const reading = withPreset(DEFAULT_EXPORT_OPTIONS, 'reading');
    const page = toHtml(build(reading), reading, true);
    expect(page).toMatch(/body \{[^}]*line-height: 1\.4;/);
    expect(page).toContain('p[dir] { text-align: justify; }');
  });

  it('the page made for printing says which paper and margins to choose', () => {
    const page = toHtml(build({ paper: 'letter' }), { ...DEFAULT_EXPORT_OPTIONS, paper: 'letter' }, true);
    expect(page).toContain('Paper: US Letter, upright. The margins are 1in on every side');
    expect(page).toContain('Headers and footers');
  });
});

describe('the pages before and after the text', () => {
  it('come before and after the text, without properties or comments, with the writer\'s own heading when there is one', () => {
    const manuscript = build({}, TEXTS, MATTER);
    expect(manuscript.front.map((part) => part.role)).toEqual(['dedication', 'epigraph']);
    expect(manuscript.back.map((part) => [part.role, part.title])).toEqual([
      ['acknowledgements', 'Acknowledgements'],
      ['about', 'About Dana'],
    ]);
    expect(manuscript.front[0]?.title).toBeNull();
    expect(manuscript.back[1]?.markdown).toBe('Dana lives by the sea.');
    // They are not part of the manuscript's words.
    expect(manuscript.words).toBe(build().words);
    // A page with nothing to print is left out.
    expect(build({}, TEXTS, new Map([['dedication', '   %%only a note%%  ']])).front).toEqual([]);
  });

  it('are placed in every format: after the title page, and at the end', () => {
    const manuscript = build({ contents: true }, TEXTS, MATTER);
    const order = ['My Novel', 'For my sister.', 'All happy families', 'Chapter One', 'Anna came', 'Morning came.', 'Acknowledgements', 'Thanks to everyone.', 'About Dana', 'Dana lives by the sea.'];
    const expectInOrder = (text: string): void => {
      let from = 0;
      for (const piece of order) {
        const at = text.indexOf(piece, from);
        expect(at, piece).toBeGreaterThanOrEqual(from);
        from = at + piece.length;
      }
    };
    const html = toHtml(manuscript, { ...DEFAULT_EXPORT_OPTIONS, contents: true });
    expectInOrder(textOf(html.slice(html.indexOf('<body>')).replace(/<nav[\s\S]*?<\/nav>/, '')));
    expect(html).toContain('<section class="matter dedication new-page"');
    expect(html).not.toContain('private');
    const markdown = toMarkdown(manuscript, DEFAULT_EXPORT_OPTIONS);
    expectInOrder(markdown);
    expect(markdown).toContain('\n> All happy families are alike.\n');
    expect(markdown).toContain('\n## About Dana\n\nDana lives by the sea.\n');
    const main = fromUtf8(unzipStored(toDocx(manuscript, { ...DEFAULT_EXPORT_OPTIONS, contents: true })).find((entry) => entry.name === 'word/document.xml')?.data ?? new Uint8Array());
    const paragraphs = (main.match(/<w:p>.*?<\/w:p>/g) ?? []).map(textOf).join('\n');
    expectInOrder(paragraphs.replace(/Contents[\s\S]*?About Dana\n/, ''));
    expect(main).toMatch(/<w:pStyle w:val="Dedication"\/>/);
    expect(main).toMatch(/<w:pStyle w:val="Epigraph"\/><w:pageBreakBefore\/>/);
    // The acknowledgements are in the list of contents, as a link.
    expect(main).toMatch(/<w:hyperlink w:anchor="spellbook_part_\d+" w:history="1">.*?Acknowledgements/);
  });

  it('a Hebrew book gets Hebrew headings for its own pages and its contents', () => {
    const hebrew: Record<string, SceneSource> = Object.fromEntries(Object.keys(TEXTS).map((title) => [title, { compile: true, text: 'שלום לך אחותי היקרה.\n' }]));
    const manuscript = build({ contents: true }, hebrew, new Map([['acknowledgements', 'תודה לכולם.']]));
    expect(manuscript.language).toBe('he');
    expect(manuscript.back[0]?.title).toBe(BOOK_WORDS.he.acknowledgements);
    expect(manuscript.back[0]?.direction).toBe('rtl');
    const html = toHtml(manuscript, { ...DEFAULT_EXPORT_OPTIONS, contents: true });
    expect(html).toContain(`<h2 dir="rtl">${BOOK_WORDS.he.contents}</h2>`);
    expect(build().language).toBe('en');
  });
});
