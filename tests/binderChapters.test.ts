// The binder and chapter notes: the mark, "Treat as a chapter" and back, and
// the wording that follows what the note (or the project) is.

import { beforeEach, describe, expect, it } from 'vitest';
import { CHAPTERS_KEY, WRITES_IN_KEY } from '../src/core/noteKind';
import { rowOf, toolbarLabels } from './binderScreen';
import { INDEX, clearScreen, menuOf, novel, prompt, rest, stage, toolbarMenu } from './binderStage';
import { MemoryVault } from './memoryVault';

beforeEach(() => {
  clearScreen();
});

function chapterNovel(extra: Record<string, unknown>): MemoryVault {
  const vault = novel();
  const index = vault.frontmatterOf(INDEX) ?? {};
  vault.seed(INDEX, { frontmatter: { ...index, ...extra }, body: '' });
  return vault;
}

describe('chapter notes in the binder', () => {
  it('marks a note as a chapter from its menu, shows the mark, and turns it back', async () => {
    const s = await stage(novel());
    expect(rowOf(s.pane, 'Opening').hasClass('spellbook-is-chapter')).toBe(false);
    menuOf(s.pane, 'Opening').item('Treat as a chapter').click();
    await rest(s);
    expect(s.vault.frontmatterOf(INDEX)?.[CHAPTERS_KEY]).toEqual(['Manuscript/Opening.md']);
    const row = rowOf(s.pane, 'Opening');
    expect(row.hasClass('spellbook-is-chapter')).toBe(true);

    const menu = menuOf(s.pane, 'Opening');
    expect(menu.outline).toContain('Treat as a scene');
    expect(menu.outline).toContain('Delete chapter');
    expect(menu.outline).toContain('New chapter below');
    menu.item('Treat as a scene').click();
    await rest(s);
    expect(s.vault.frontmatterOf(INDEX)).not.toHaveProperty(CHAPTERS_KEY);
    expect(rowOf(s.pane, 'Opening').hasClass('spellbook-is-chapter')).toBe(false);
  });

  it('says New chapter in a project that is written in chapters', async () => {
    const s = await stage(chapterNovel({ [WRITES_IN_KEY]: 'chapters' }));
    expect(toolbarLabels(s.pane)).toContain('New chapter');
    // Inside a folder of scenes, a new note is a scene all the same.
    expect(menuOf(s.pane, 'Part one').outline).toContain('New scene inside');
    expect(menuOf(s.pane, 'The Letter').outline).toContain('New scene below');
  });

  it('changes what the project usually writes in from the toolbar menu', async () => {
    const s = await stage(novel());
    toolbarMenu(s.pane).item('I usually write in chapters').click();
    await rest(s);
    expect(s.vault.frontmatterOf(INDEX)?.[WRITES_IN_KEY]).toBe('chapters');
    expect(toolbarLabels(s.pane)).toContain('New chapter');
    expect(toolbarMenu(s.pane).item('I usually write in chapters').checked).toBe(true);
  });

  it('asks for the name of a chapter and makes one', async () => {
    const s = await stage(chapterNovel({ [CHAPTERS_KEY]: ['Manuscript/Opening.md'] }));
    menuOf(s.pane, 'Opening').item('New chapter below').click();
    const window = prompt(s);
    expect(window.title).toBe('New chapter');
    window.type('The Spark');
    window.enter();
    await rest(s);
    expect(s.vault.frontmatterOf(INDEX)?.[CHAPTERS_KEY]).toEqual(['Manuscript/Opening.md', 'Manuscript/The Spark.md']);
  });
});
