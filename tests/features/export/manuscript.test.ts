// Putting the manuscript together (src/core/export/manuscript.ts): binder
// order, folders as chapters, the "compile" switch, one folder alone, and the
// small pieces around it (options, file names, the title page's word count).

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_OPTIONS,
  buildManuscript,
  contentsOf,
  exportFileName,
  headerText,
  readExportOptions,
  roundWords,
  scenesInScope,
  scopeChoices,
  wordsLine,
} from '../../../src/core/export';
import type { Manuscript, SceneSource } from '../../../src/core/export';
import type { TreeNode } from '../../../src/core/types';

const scene = (title: string, missing = false): TreeNode => ({ kind: 'scene', path: `Manuscript/${title}.md`, title, missing });
const folder = (id: string, name: string, children: TreeNode[]): TreeNode => ({ kind: 'folder', id, name, children });

const HEBREW_FOLDER = 'חלק שני';
const HEBREW_SCENE = 'לילה בנמל';

/**
 *   Opening
 *   Part one            [one]
 *     The Letter
 *     Draft             (compile off)
 *     (Hebrew folder)   [inner]
 *       (Hebrew scene)
 *   Empty folder        [empty]
 *   Ghost               (missing)
 *   Closing
 */
const TREE: TreeNode[] = [
  scene('Opening'),
  folder('one', 'Part one', [scene('The Letter'), scene('Draft'), folder('inner', HEBREW_FOLDER, [scene(HEBREW_SCENE)])]),
  folder('empty', 'Empty folder', []),
  scene('Ghost', true),
  scene('Closing'),
];

const TEXTS: Record<string, SceneSource> = {
  Opening: { compile: true, text: '---\nstatus: Done\n---\nIt was a dark night.\nThe rain fell.\n' },
  'The Letter': { compile: true, text: 'Dear Anna.\n' },
  Draft: { compile: false, text: 'Not ready to be read.\n' },
  [HEBREW_SCENE]: { compile: true, text: 'שלום לך אחותי.\nכתבתי לך מכתב.\nShe wrote in English too.\n' },
  Closing: { compile: true, text: 'The end.\n' },
};

function build(options: Partial<typeof DEFAULT_EXPORT_OPTIONS> = {}, texts: Record<string, SceneSource> = TEXTS): Manuscript {
  const scenes = new Map(Object.entries(texts).map(([title, source]) => [`Manuscript/${title}.md`, source]));
  return buildManuscript({ title: 'My Novel', tree: TREE, options: { ...DEFAULT_EXPORT_OPTIONS, ...options }, scenes });
}

/** The parts in short: "# chapter" and "scene(how it opens)". */
function outline(manuscript: Manuscript): string[] {
  return manuscript.parts.map((part) => (part.kind === 'chapter' ? `${'#'.repeat(part.level)} ${part.title}` : `${part.title} (${part.opens})`));
}

describe('buildManuscript', () => {
  it('takes the scenes in binder order, under their folders as chapters', () => {
    const manuscript = build();
    expect(outline(manuscript)).toEqual([
      'Opening (first)',
      '# Part one',
      'The Letter (first)',
      `## ${HEBREW_FOLDER}`,
      `${HEBREW_SCENE} (first)`,
      'Closing (page)',
    ]);
    expect(manuscript.included).toEqual(['Opening', 'The Letter', HEBREW_SCENE, 'Closing'].map((title) => `Manuscript/${title}.md`));
  });

  it('leaves out scenes whose "compile" switch is off, and says which', () => {
    const manuscript = build();
    expect(manuscript.switchedOff).toEqual(['Manuscript/Draft.md']);
    expect(JSON.stringify(manuscript.parts)).not.toContain('Not ready');
  });

  it('leaves out a scene with no note, or one that was not read, and says which', () => {
    expect(build().unread).toEqual(['Manuscript/Ghost.md']);
    const { Closing: _gone, ...rest } = TEXTS;
    expect(build({}, rest).unread).toEqual(['Manuscript/Ghost.md', 'Manuscript/Closing.md']);
  });

  it('sets scenes that follow each other apart by a break', () => {
    const all = { ...TEXTS, Draft: { compile: true, text: 'Now it is ready.\n' } };
    expect(outline(build({}, all)).slice(1, 4)).toEqual(['# Part one', 'The Letter (first)', 'Draft (break)']);
  });

  it('leaves no heading behind for a folder with nothing to print in it', () => {
    const none = { ...TEXTS, 'The Letter': { compile: false, text: 'x' }, [HEBREW_SCENE]: { compile: false, text: 'x' } };
    expect(outline(build({}, none))).toEqual(['Opening (first)', 'Closing (break)']);
  });

  it('skips a scene with no text, unless scene titles are printed', () => {
    const blank = { ...TEXTS, 'The Letter': { compile: true, text: '---\nstatus: x\n---\n\n%%only a note%%\n' } };
    expect(outline(build({}, blank))).not.toContain('The Letter (first)');
    expect(outline(build({ sceneTitles: true }, blank))).toContain('The Letter (first)');
  });

  it('exports one folder alone, as a chapter at the top', () => {
    const manuscript = build({ scope: 'inner' });
    expect(outline(manuscript)).toEqual([`# ${HEBREW_FOLDER}`, `${HEBREW_SCENE} (first)`]);
    expect(manuscript.switchedOff).toEqual([]);
    // A folder that is gone gives the whole manuscript.
    expect(outline(build({ scope: 'no-such-folder' }))).toHaveLength(6);
  });

  it('counts the words of what is exported only', () => {
    expect(build().words).toBe(5 + 3 + 2 + (3 + 3 + 5) + 2);
    expect(build({ scope: 'inner' }).words).toBe(11);
  });

  it('gives every heading the direction of its own words, and the manuscript that of most of its paragraphs', () => {
    const manuscript = build();
    expect(manuscript.direction).toBe('ltr');
    expect(manuscript.parts.filter((part) => part.direction === 'rtl').map((part) => part.title)).toEqual([HEBREW_FOLDER, HEBREW_SCENE]);
    expect(build({ scope: 'inner' }).direction).toBe('rtl');
  });

  it('keeps the scene\'s own Markdown, without properties and comments', () => {
    const opening = build().parts[0];
    expect(opening?.kind === 'scene' ? opening.markdown : null).toBe('It was a dark night.\nThe rain fell.');
  });

  it('lists the chapters for the contents, and the scenes too when their titles are printed', () => {
    expect(contentsOf(build(), false).map((part) => part.title)).toEqual(['Part one', HEBREW_FOLDER]);
    expect(contentsOf(build(), true)).toHaveLength(6);
    const ids = build().parts.map((part) => part.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('what an export covers', () => {
  it('lists the scenes of the binder, or of one folder, in order', () => {
    expect(scenesInScope(TREE, null).map((entry) => entry.title)).toEqual(['Opening', 'The Letter', 'Draft', HEBREW_SCENE, 'Ghost', 'Closing']);
    expect(scenesInScope(TREE, 'one').map((entry) => entry.title)).toEqual(['The Letter', 'Draft', HEBREW_SCENE]);
    expect(scenesInScope(TREE, null).find((entry) => entry.title === 'Ghost')?.missing).toBe(true);
  });

  it('offers the folders that hold a scene', () => {
    expect(scopeChoices(TREE)).toEqual([
      { id: 'one', name: 'Part one', depth: 0 },
      { id: 'inner', name: HEBREW_FOLDER, depth: 1 },
    ]);
  });
});

describe('the options', () => {
  it('start as the standard manuscript: Word, title page and running header on', () => {
    expect(DEFAULT_EXPORT_OPTIONS).toEqual({
      format: 'docx',
      scope: null,
      titlePage: true,
      header: true,
      contents: false,
      sceneTitles: false,
      author: '',
      paper: 'a4',
    });
  });

  it('come back from what was saved, with anything odd put right', () => {
    const chosen = { ...DEFAULT_EXPORT_OPTIONS, format: 'markdown' as const, scope: 'one', contents: true, author: 'דנה מרלו', paper: 'letter' as const };
    expect(readExportOptions(JSON.stringify(chosen))).toEqual(chosen);
    expect(readExportOptions(chosen)).toEqual(chosen);
    expect(readExportOptions(null)).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(readExportOptions('{not json')).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(readExportOptions([1, 2])).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(readExportOptions({ format: 'pdf', scope: 7, titlePage: 'yes', paper: 'a3', author: '  Dana \n Marlow ' })).toEqual({
      ...DEFAULT_EXPORT_OPTIONS,
      author: 'Dana Marlow',
    });
  });
});

describe('the small pieces', () => {
  it('rounds the word count of the title page', () => {
    expect([0, 42, 99, 149, 1234, 9949, 80499, 80500].map(roundWords)).toEqual([0, 42, 99, 100, 1200, 9900, 80000, 81000]);
    expect(wordsLine(42)).toBe('42 words');
    expect(wordsLine(1)).toBe('1 word');
    expect(wordsLine(1234)).toBe('about 1,200 words');
    expect(wordsLine(123456)).toBe('about 123,000 words');
  });

  it('makes the line at the top of a page from the surname and the title', () => {
    expect(headerText({ title: 'My Novel', author: 'Dana Marlow' })).toBe('Marlow / My Novel / ');
    expect(headerText({ title: 'My Novel', author: '' })).toBe('My Novel / ');
  });

  it('names the file after the project and the day, with a number from the second try on', () => {
    expect(exportFileName('My Novel', null, 'docx', '2026-10-13')).toBe('My Novel 2026-10-13.docx');
    expect(exportFileName('My Novel', null, 'docx', '2026-10-13', 2)).toBe('My Novel 2026-10-13 2.docx');
    expect(exportFileName('My Novel', 'Part one', 'markdown', '2026-10-13')).toBe('My Novel - Part one 2026-10-13.md');
    expect(exportFileName('My Novel', null, 'html', '2026-10-13')).toBe('My Novel 2026-10-13.html');
    expect(exportFileName('My Novel', null, 'print', '2026-10-13', 3)).toBe('My Novel (to print) 2026-10-13 3.html');
    expect(exportFileName('הרומן שלי', null, 'docx', '2026-10-13')).toBe('הרומן שלי 2026-10-13.docx');
  });

  it('never puts into a name what a file name cannot hold, and keeps a long title short', () => {
    expect(exportFileName('Either/Or: a "novel"?', null, 'docx', '2026-10-13')).toBe('Either Or a novel 2026-10-13.docx');
    expect(exportFileName('', null, 'docx', '2026-10-13')).toBe('Manuscript 2026-10-13.docx');
    const long = exportFileName('word '.repeat(60), null, 'docx', '2026-10-13', 12);
    expect(long.length).toBeLessThan(110);
    expect(long.endsWith(' 2026-10-13 12.docx')).toBe(true);
  });
});
