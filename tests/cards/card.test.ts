// One scene as an index card.

import { describe, expect, it } from 'vitest';
import { buildSceneCard, readTagLists, targetProgress } from '../../src/core/cards';
import type { SceneCard } from '../../src/core/cards';
import { ENGLISH_PROSE, HEBREW, deepFreeze, sampleLists } from './helpers';

const lists = sampleLists();

function note(properties: string, body: string): string {
  return `---\n${properties}\n---\n${body}`;
}

describe('buildSceneCard', () => {
  it('shows everything an index card needs', () => {
    const card = buildSceneCard(
      {
        path: 'Manuscript/The Letter.md',
        frontmatter: { synopsis: 'Anna finds the letter.', status: 'First draft', label: 'Anna', target: 1000, compile: true, order: 2 },
        text: note('synopsis: Anna finds the letter.', ENGLISH_PROSE),
        words: 250,
      },
      lists,
    );
    const expected: SceneCard = {
      kind: 'scene',
      path: 'Manuscript/The Letter.md',
      title: 'The Letter',
      synopsis: 'Anna finds the letter.',
      synopsisDerived: false,
      status: { name: 'First draft', color: 'orange', listed: true },
      label: { name: 'Anna', color: 'purple', listed: true },
      words: 250,
      target: 1000,
      progress: { words: 250, target: 1000, fraction: 0.25, percent: 25, remaining: 750, reached: false },
      missing: false,
      compile: true,
    };
    expect(card).toEqual(expected);
  });

  it('shows a Hebrew scene: title, synopsis, status and label unchanged', () => {
    const card = buildSceneCard(
      {
        path: `Manuscript/${HEBREW.opening}.md`,
        frontmatter: { synopsis: HEBREW.synopsis, status: HEBREW.final, label: HEBREW.daniel },
        words: 80,
      },
      lists,
    );
    expect(card.title).toBe(HEBREW.opening);
    expect(card.synopsis).toBe(HEBREW.synopsis);
    expect(card.synopsisDerived).toBe(false);
    expect(card.status).toEqual({ name: HEBREW.final, color: 'green', listed: true });
    expect(card.label).toEqual({ name: HEBREW.daniel, color: 'cyan', listed: true });
  });

  it('passes pointed Hebrew through code for code, never tidying or reordering its marks', () => {
    expect(HEBREW.untidy.normalize('NFC')).not.toBe(HEBREW.untidy);
    const written = buildSceneCard(
      { path: `Manuscript/${HEBREW.untidy}.md`, frontmatter: { synopsis: HEBREW.untidy, status: HEBREW.untidy, label: HEBREW.untidy } },
      lists,
    );
    expect(written.title).toBe(HEBREW.untidy);
    expect(written.path).toBe(`Manuscript/${HEBREW.untidy}.md`);
    expect(written.synopsis).toBe(HEBREW.untidy);
    expect(written.status?.name).toBe(HEBREW.untidy);
    expect(written.label?.name).toBe(HEBREW.untidy);
    const derived = buildSceneCard({ path: 'a.md', frontmatter: {}, text: `---\nlabel: x\n---\n${HEBREW.untidy}\n` }, lists);
    expect(derived.synopsis).toBe(HEBREW.untidy);
  });

  describe('the title', () => {
    it('is the file name without its extension, wherever the file is', () => {
      const title = (path: string): string => buildSceneCard({ path }, lists).title;
      expect(title('Manuscript/Opening.md')).toBe('Opening');
      expect(title('Manuscript/Part one/A night out.md')).toBe('A night out');
      expect(title('Opening.MD')).toBe('Opening');
      expect(title('Manuscript/Dr. No.md')).toBe('Dr. No');
      expect(title(`Manuscript/${HEBREW.chapterOne}.md`)).toBe(HEBREW.chapterOne);
    });
  });

  describe('the synopsis', () => {
    it('is the synopsis property exactly as written, when there is one', () => {
      const synopsis = `  ${HEBREW.synopsis}\n  two  spaces  `;
      const card = buildSceneCard({ path: 'a.md', frontmatter: { synopsis }, text: ENGLISH_PROSE }, lists);
      expect(card.synopsis).toBe(synopsis);
      expect(card.synopsisDerived).toBe(false);
    });

    it('is taken from the text when the property is empty, and marked as derived', () => {
      for (const empty of ['', '   ', '\n', null, undefined]) {
        const card = buildSceneCard(
          { path: 'a.md', frontmatter: { synopsis: empty }, text: note('synopsis: ""', '# Heading\n\nAnna stood by the window.') },
          lists,
        );
        expect(card.synopsis, String(empty)).toBe('Anna stood by the window.');
        expect(card.synopsisDerived).toBe(true);
      }
    });

    it('is taken from the text when the scene has no properties at all', () => {
      const card = buildSceneCard({ path: 'a.md', frontmatter: null, text: HEBREW.synopsis }, lists);
      expect(card.synopsis).toBe(HEBREW.synopsis);
      expect(card.synopsisDerived).toBe(true);
    });

    it('is a preview of about 200 characters, cut between words, for a long scene', () => {
      for (const prose of [ENGLISH_PROSE, HEBREW.prose]) {
        const card = buildSceneCard({ path: 'a.md', frontmatter: { synopsis: '' }, text: note('synopsis: ""', prose) }, lists);
        expect(card.synopsisDerived).toBe(true);
        expect(card.synopsis.endsWith('\u{2026}')).toBe(true);
        const body = card.synopsis.slice(0, -1);
        expect(prose.startsWith(body)).toBe(true);
        expect(prose.charAt(body.length)).toBe(' ');
        expect(body.length).toBeGreaterThan(180);
        expect(body.length).toBeLessThanOrEqual(200);
      }
    });

    it('can be made shorter', () => {
      const card = buildSceneCard({ path: 'a.md', text: 'one two three four five' }, lists, 8);
      expect(card.synopsis).toBe('one two\u{2026}');
    });

    it('is empty, and not marked as derived, when there is no synopsis and no text to take one from', () => {
      for (const text of [undefined, null, '', '---\nsynopsis: ""\n---\n', '# Only a heading']) {
        const card = buildSceneCard({ path: 'a.md', frontmatter: { synopsis: '  ' }, text }, lists);
        expect(card.synopsis, String(text)).toBe('');
        expect(card.synopsisDerived).toBe(false);
      }
    });
  });

  describe('status and label', () => {
    it('take their colour from the project lists, whatever the capitals in the scene', () => {
      const card = buildSceneCard({ path: 'a.md', frontmatter: { status: 'first DRAFT', label: ' anna ' } }, lists);
      expect(card.status).toEqual({ name: 'First draft', color: 'orange', listed: true });
      expect(card.label).toEqual({ name: 'Anna', color: 'purple', listed: true });
    });

    it('are shown without a colour when the list does not have them', () => {
      const card = buildSceneCard({ path: 'a.md', frontmatter: { status: 'Abandoned', label: HEBREW.anna } }, lists);
      expect(card.status).toEqual({ name: 'Abandoned', color: null, listed: false });
      expect(card.label).toEqual({ name: HEBREW.anna, color: null, listed: false });
    });

    it('are null when the scene has none', () => {
      for (const frontmatter of [{}, { status: '', label: '  ' }, { status: null, label: null }, null]) {
        const card = buildSceneCard({ path: 'a.md', frontmatter }, lists);
        expect(card.status).toBeNull();
        expect(card.label).toBeNull();
      }
    });

    it('have no colour when the list gives the status none, or one that is not a colour', () => {
      const plain = readTagLists({ statuses: [{ name: 'Draft' }, { name: 'Odd', color: 'teal' }], labels: [] });
      expect(buildSceneCard({ path: 'a.md', frontmatter: { status: 'Draft' } }, plain).status).toEqual({ name: 'Draft', color: null, listed: true });
      expect(buildSceneCard({ path: 'a.md', frontmatter: { status: 'Odd' } }, plain).status).toEqual({ name: 'Odd', color: null, listed: true });
    });

    it('use the built-in statuses for a project that has not chosen its own', () => {
      const builtIn = readTagLists({});
      const card = buildSceneCard({ path: 'a.md', frontmatter: { status: 'Revised', label: 'Anna' } }, builtIn);
      expect(card.status).toEqual({ name: 'Revised', color: 'blue', listed: true });
      expect(card.label).toEqual({ name: 'Anna', color: null, listed: false });
    });
  });

  describe('words, target and progress', () => {
    const card = (words: number | null | undefined, target: unknown): SceneCard =>
      buildSceneCard({ path: 'a.md', frontmatter: { target }, words }, lists);

    it('shows the count as a whole number', () => {
      expect(card(1234, undefined).words).toBe(1234);
      expect(card(0, undefined).words).toBe(0);
      expect(card(12.6, undefined).words).toBe(13);
    });

    it('shows no count while the scene is still being counted or cannot be read', () => {
      expect(card(undefined, 500).words).toBeNull();
      expect(card(null, 500).words).toBeNull();
      expect(card(Number.NaN, 500).words).toBeNull();
      expect(card(undefined, 500).progress).toBeNull();
      expect(card(undefined, 500).target).toBe(500);
    });

    it('has no target and no progress when the scene sets none', () => {
      for (const target of [undefined, null, 0, '', 'soon', -100]) {
        expect(card(300, target).target, String(target)).toBeNull();
        expect(card(300, target).progress, String(target)).toBeNull();
      }
    });

    it('reads a target typed as text', () => {
      expect(card(300, '1,200').target).toBe(1200);
      expect(card(300, '1,200').progress?.percent).toBe(25);
    });

    it('measures progress toward the target', () => {
      expect(card(0, 1500).progress).toEqual({ words: 0, target: 1500, fraction: 0, percent: 0, remaining: 1500, reached: false });
      expect(card(750, 1500).progress).toEqual({ words: 750, target: 1500, fraction: 0.5, percent: 50, remaining: 750, reached: false });
      expect(card(1500, 1500).progress).toEqual({ words: 1500, target: 1500, fraction: 1, percent: 100, remaining: 0, reached: true });
    });

    it('does not say 100 per cent one word short of the target', () => {
      const progress = card(1499, 1500).progress;
      expect(progress?.percent).toBe(99);
      expect(progress?.reached).toBe(false);
      expect(progress?.remaining).toBe(1);
      expect(progress?.fraction).toBeLessThan(1);
    });

    it('keeps the bar full and the per cent rising once the target is passed', () => {
      expect(card(1800, 1500).progress).toEqual({ words: 1800, target: 1500, fraction: 1, percent: 120, remaining: 0, reached: true });
    });
  });

  describe('compile', () => {
    it('is yes unless the scene says no', () => {
      expect(buildSceneCard({ path: 'a.md', frontmatter: {} }, lists).compile).toBe(true);
      expect(buildSceneCard({ path: 'a.md', frontmatter: null }, lists).compile).toBe(true);
      expect(buildSceneCard({ path: 'a.md', frontmatter: { compile: true } }, lists).compile).toBe(true);
      expect(buildSceneCard({ path: 'a.md', frontmatter: { compile: false } }, lists).compile).toBe(false);
      expect(buildSceneCard({ path: 'a.md', frontmatter: { compile: 'no' } }, lists).compile).toBe(false);
    });
  });

  describe('a missing scene', () => {
    it('still gets a card, marked as missing, with its title and nothing else', () => {
      const card = buildSceneCard({ path: `Manuscript/${HEBREW.letter}.md`, missing: true }, lists);
      expect(card).toEqual({
        kind: 'scene',
        path: `Manuscript/${HEBREW.letter}.md`,
        title: HEBREW.letter,
        synopsis: '',
        synopsisDerived: false,
        status: null,
        label: null,
        words: null,
        target: null,
        progress: null,
        missing: true,
        compile: true,
      });
    });

    it('shows no word count even if an old one is still at hand', () => {
      const card = buildSceneCard({ path: 'a.md', missing: true, words: 900, frontmatter: { target: 1000 } }, lists);
      expect(card.words).toBeNull();
      expect(card.progress).toBeNull();
    });

    it('is not missing unless it is said to be', () => {
      expect(buildSceneCard({ path: 'a.md' }, lists).missing).toBe(false);
      expect(buildSceneCard({ path: 'a.md', missing: false }, lists).missing).toBe(false);
    });
  });

  it('never throws on properties written by hand, and never changes them', () => {
    const odd = deepFreeze({ synopsis: ['a', 'b'], status: { name: 'x' }, label: 7, target: 'many', compile: 'perhaps', created: 12, extra: { deep: [1] } });
    const card = buildSceneCard({ path: 'a.md', frontmatter: odd, text: 'Anna stood.', words: 2 }, lists);
    expect(card.synopsis).toBe('Anna stood.');
    expect(card.synopsisDerived).toBe(true);
    expect(card.status).toBeNull();
    expect(card.label).toEqual({ name: '7', color: null, listed: false });
    expect(card.target).toBeNull();
    expect(card.compile).toBe(true);
  });
});

describe('targetProgress', () => {
  it('is null without a real target or a known count', () => {
    expect(targetProgress(100, null)).toBeNull();
    expect(targetProgress(100, undefined)).toBeNull();
    expect(targetProgress(100, 0)).toBeNull();
    expect(targetProgress(100, -5)).toBeNull();
    expect(targetProgress(100, Number.NaN)).toBeNull();
    expect(targetProgress(null, 500)).toBeNull();
    expect(targetProgress(undefined, 500)).toBeNull();
    expect(targetProgress(Number.NaN, 500)).toBeNull();
  });

  it('rounds the per cent down and never lets the fraction pass 1', () => {
    expect(targetProgress(1, 3)).toEqual({ words: 1, target: 3, fraction: 1 / 3, percent: 33, remaining: 2, reached: false });
    expect(targetProgress(2, 3)?.percent).toBe(66);
    expect(targetProgress(999, 1000)?.percent).toBe(99);
    expect(targetProgress(5000, 1000)?.fraction).toBe(1);
    expect(targetProgress(5000, 1000)?.percent).toBe(500);
  });

  it('treats a count below zero as zero', () => {
    expect(targetProgress(-20, 100)).toEqual({ words: 0, target: 100, fraction: 0, percent: 0, remaining: 100, reached: false });
  });
});
