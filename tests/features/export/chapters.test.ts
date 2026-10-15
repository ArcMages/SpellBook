// Books that mix the two ways of writing: some chapters written as one note,
// others as a binder folder of scene notes. A chapter note becomes a chapter
// heading of its own; a folder that holds chapter notes heads a part of the
// book above them; folders of scenes stay chapters, and scenes keep their
// scene breaks. Checked in every writer.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_OPTIONS,
  buildManuscript,
  contentsOf,
  fromUtf8,
  toDocx,
  toEpub,
  toHtml,
  toMarkdown,
  unzipStored,
  withPreset,
} from '../../../src/core/export';
import type { ChapterPart, ExportOptions, Manuscript, ScenePart } from '../../../src/core/export';
import type { TreeNode } from '../../../src/core/types';

const scene = (title: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${title}.md`, title, missing: false });
const chapter = (title: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${title}.md`, title, missing: false, chapter: true });

// Part One holds two chapter notes; then a chapter written as a folder of
// scenes; then a chapter note at the top level; then a loose scene.
const TREE: TreeNode[] = [
  { kind: 'folder', id: 'p1', name: 'Part One: The Spark', children: [chapter('Arrival'), chapter('The Letter')] },
  { kind: 'folder', id: 'c3', name: 'The Storm', children: [scene('Thunder'), scene('Rain')] },
  chapter('Morning'),
  scene('Coda'),
];

const TEXTS: Record<string, string> = {
  Arrival: 'Anna came by the night train.\n\n## A heading inside\n\nShe slept.\n',
  'The Letter': 'Dear sister.\n',
  Thunder: 'The sky broke.\n',
  Rain: 'It rained for days.\n',
  Morning: 'The sun rose.\n',
  Coda: 'The end.\n',
};

function build(options: Partial<ExportOptions> = {}, tree: TreeNode[] = TREE): { manuscript: Manuscript; options: ExportOptions } {
  const all = { ...withPreset(DEFAULT_EXPORT_OPTIONS, 'reading'), author: 'Dana Marlow', ...options };
  const scenes = new Map(Object.entries(TEXTS).map(([title, text]) => [`Manuscript/${title}.md`, { compile: true, text }]));
  return { manuscript: buildManuscript({ title: 'My Novel', tree, options: all, scenes }), options: all };
}

function outline(manuscript: Manuscript): string[] {
  return manuscript.parts.map((part) =>
    part.kind === 'chapter'
      ? `${'#'.repeat(part.level)} ${part.title}${part.bookPart === true ? ' (part)' : ''}`
      : `${part.opens}:${part.title}${part.titled ? ' (titled)' : ''}`,
  );
}

function expectInOrder(text: string, pieces: readonly string[]): void {
  let from = 0;
  for (const piece of pieces) {
    const at = text.indexOf(piece, from);
    expect(at, `"${piece}" should come after what is before it`).toBeGreaterThanOrEqual(from);
    from = at + piece.length;
  }
}

const IN_ORDER = ['Part One: The Spark', 'Arrival', 'Anna came', 'The Letter', 'Dear sister.', 'The Storm', 'The sky broke.', 'It rained', 'Morning', 'The sun rose.', 'The end.'];

describe('a mixed book, put together', () => {
  const { manuscript } = build();

  it('makes a chapter heading of each chapter note, and a part heading of the folder that holds them', () => {
    expect(outline(manuscript)).toEqual([
      '# Part One: The Spark (part)',
      '## Arrival',
      'first:Arrival',
      '## The Letter',
      'first:The Letter',
      '# The Storm',
      'first:Thunder',
      'break:Rain',
      '# Morning',
      'first:Morning',
      'page:Coda',
    ]);
  });

  it('lists every chapter in the contents, the chapter notes among them, and never their text twice', () => {
    expect(contentsOf(manuscript).map((part) => part.title)).toEqual(['Part One: The Spark', 'Arrival', 'The Letter', 'The Storm', 'Morning']);
    const morning = manuscript.parts.find((part): part is ChapterPart => part.kind === 'chapter' && part.title === 'Morning');
    expect(morning?.note).toBe('Manuscript/Morning.md');
  });

  it('counts the words of chapter notes and scenes alike, and says which notes went in', () => {
    expect(manuscript.included).toEqual(Object.keys(TEXTS).map((title) => `Manuscript/${title}.md`));
    expect(manuscript.words).toBe(25);
  });

  it('puts the text of a chapter note one level under its heading', () => {
    const text = manuscript.parts.find((part): part is ScenePart => part.kind === 'scene' && part.title === 'Arrival');
    expect(text?.level).toBe(3);
  });

  it('leaves a chapter note out with its heading when its compile switch is off', () => {
    const all = { ...DEFAULT_EXPORT_OPTIONS };
    const scenes = new Map(Object.entries(TEXTS).map(([title, text]) => [`Manuscript/${title}.md`, { compile: title !== 'Morning', text }]));
    const built = buildManuscript({ title: 'My Novel', tree: TREE, options: all, scenes });
    expect(outline(built)).not.toContain('# Morning');
    expect(built.switchedOff).toEqual(['Manuscript/Morning.md']);
  });

  it('keeps a chapter note with no text yet as a heading', () => {
    const all = { ...DEFAULT_EXPORT_OPTIONS };
    const scenes = new Map([['Manuscript/Morning.md', { compile: true, text: '---\nstatus: To do\n---\n' }]]);
    const built = buildManuscript({ title: 'My Novel', tree: [chapter('Morning')], options: all, scenes });
    expect(outline(built)).toEqual(['# Morning']);
  });

  it('prints no scene title over a chapter note, even with scene titles switched on', () => {
    const titled = build({ sceneTitles: true }).manuscript;
    expect(outline(titled)).toContain('first:Morning');
    expect(outline(titled)).toContain('first:Thunder (titled)');
  });

  it('a book of scenes only is as it always was', () => {
    const plain = build({}, [{ kind: 'folder', id: 'c1', name: 'One', children: [scene('Thunder'), scene('Rain')] }]).manuscript;
    expect(outline(plain)).toEqual(['# One', 'first:Thunder', 'break:Rain']);
  });
});

describe('a mixed book, written out', () => {
  it('as Markdown: headings at their levels, scene breaks only between scenes', () => {
    const { manuscript, options } = build({ titlePage: false, contents: false });
    const text = toMarkdown(manuscript, options);
    expectInOrder(text, IN_ORDER);
    expect(text).toContain('# Part One: The Spark\n\n## Arrival\n\nAnna came');
    expect(text).toContain('### A heading inside');
    expect(text).toContain('# Morning\n\nThe sun rose.');
    // A break between the two scenes of The Storm, and before the loose scene after Morning; none around the chapter notes.
    expect(text.split('* * *').length - 1).toBe(2);
    expect(text).toContain('The sun rose.\n\n* * *\n\nThe end.');
  });

  it('as a web page: every chapter note a heading with a link in the contents', () => {
    const { manuscript, options } = build({ format: 'html', contents: true });
    const html = toHtml(manuscript, options);
    expectInOrder(html, IN_ORDER);
    for (const title of ['Arrival', 'The Letter', 'Morning']) {
      const heading = manuscript.parts.find((part) => part.kind === 'chapter' && part.title === title);
      expect(html).toContain(`<a href="#${heading?.id}">${title}</a>`);
      expect(html).toContain(`id="${heading?.id}"`);
    }
  });

  it('as a web page: the heading of a part is marked as a part, and no other', () => {
    const { manuscript, options } = build({ format: 'html', contents: true });
    const html = toHtml(manuscript, options);
    const parts = manuscript.parts.filter((part) => part.kind === 'chapter' && part.bookPart === true);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(html).toMatch(new RegExp(`class="[^"]*book-part[^"]*" id="${part.id}"`));
    expect(html.split('book-part"').length - 1).toBe(parts.length);
  });

  it('as a print page, the same', () => {
    const { manuscript, options } = build({ format: 'print', contents: true });
    expectInOrder(toHtml(manuscript, options), IN_ORDER);
  });

  it('as Word: chapter notes are headings, Morning on a new page', () => {
    const { manuscript, options } = build({ format: 'docx', contents: true });
    const files = new Map(unzipStored(toDocx(manuscript, options)).map((entry) => [entry.name, fromUtf8(entry.data)]));
    const main = files.get('word/document.xml') ?? '';
    expectInOrder(main, IN_ORDER);
    const morning = main.slice(0, main.lastIndexOf('>Morning<'));
    const lastParagraph = morning.slice(morning.lastIndexOf('<w:p>'));
    expect(lastParagraph).toContain('Heading1');
    expect(lastParagraph).toContain('w:pageBreakBefore');
  });

  it('as an e-book: a file for each chapter note, and every chapter in the contents', () => {
    const { manuscript, options } = build({ format: 'epub', contents: true });
    const files = new Map(unzipStored(toEpub(manuscript, options, { cover: null, modified: '2026-10-14' })).map((entry) => [entry.name, fromUtf8(entry.data)]));
    const nav = [...files.entries()].find(([name]) => name.endsWith('nav.xhtml'))?.[1] ?? '';
    expectInOrder(nav, ['Part One: The Spark', 'Arrival', 'The Letter', 'The Storm', 'Morning']);
    const pages = [...files.entries()].filter(([name]) => /text-\d+\.xhtml$/.test(name));
    const holding = (text: string): number => pages.filter(([, page]) => page.includes(text)).length;
    expect(holding('Anna came')).toBe(1);
    const arrivalPage = pages.find(([, page]) => page.includes('Anna came'))?.[1] ?? '';
    expect(arrivalPage).toContain('>Arrival</h2>');
    expect(arrivalPage).not.toContain('Dear sister.');
    expect(pages.find(([, page]) => page.includes('The sun rose.'))?.[1]).toContain('>Morning</h1>');
  });
});

describe('what the export window says about a mixed book', () => {
  it('counts chapter notes and scenes apart', async () => {
    const { countText } = await import('../../../src/features/export/exportModal');
    expect(countText({ scenes: 5, switchedOff: 0, missing: 0, chapters: 3 })).toBe('3 chapters and 2 scenes will be exported, in binder order.');
    expect(countText({ scenes: 3, switchedOff: 1, missing: 0, chapters: 3 })).toBe(
      '3 chapters will be exported, in binder order. 1 note is left out: the "compile" switch is off.',
    );
    expect(countText({ scenes: 2, switchedOff: 0, missing: 0 })).toBe('2 scenes will be exported, in binder order.');
  });
});
