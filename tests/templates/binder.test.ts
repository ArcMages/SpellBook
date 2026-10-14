// "New scene" in the binder when the project has scene templates: the
// window offers them under "Start from", and the scene starts with what the
// chosen one holds. With no templates the window is as it always was. The
// templates themselves never show in the binder.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SCENE_CHOICE } from '../../src/views/binderActions';
import { picture, tap, toolbarButton } from '../binderScreen';
import { clearScreen, novel, notices, prompt, rest, stage } from '../binderStage';
import type { Stage } from '../binderStage';
import { DropdownComponent, resetPlatform } from '../obsidianStub';
import type { FakeElement } from '../obsidianStub';
import { TODAY } from '../storeHarness';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

const ACTION = 'Novel/Templates/Scenes/Action.md';
const HEBREW = 'Novel/Templates/Scenes/פגישה.md';

function withTemplates(): ReturnType<typeof novel> {
  const vault = novel();
  vault.seed(ACTION, { frontmatter: { synopsis: 'A chase in {{project}}', status: 'First draft', label: 'Red', order: 5 }, body: '# {{title}}\n\nStarted {{date}}.\n' });
  vault.seed(HEBREW, { frontmatter: { synopsis: 'שניים נפגשים' }, body: 'מי? איפה?\n' });
  return vault;
}

/** The "Start from" list of the open window, or null when it has none. */
function startFrom(s: Stage): DropdownComponent | null {
  const window = prompt(s).modal.contentEl as FakeElement;
  const row = window.withClass('spellbook-prompt-choice-row')[0];
  const component = row?.settings[0]?.components[0];
  return component instanceof DropdownComponent ? component : null;
}

describe('New scene with scene templates', () => {
  it('offers an empty scene first, then the templates by name, each picking its own direction', async () => {
    const s = await stage(withTemplates());
    tap(toolbarButton(s.pane, 'New scene'));
    const list = startFrom(s);
    expect(list?.selectEl.children.map((option) => [option.value, option.text, option.attrs['dir']])).toEqual([
      ['', EMPTY_SCENE_CHOICE, 'auto'],
      ['Templates/Scenes/Action.md', 'Action', 'auto'],
      ['Templates/Scenes/פגישה.md', 'פגישה', 'auto'],
    ]);
    expect(list?.getValue()).toBe('');
    expect(prompt(s).modal.contentEl.withClass('spellbook-prompt-choice-row')[0]?.settings[0]?.nameEl.text).toBe('Start from');
  });

  it('makes the scene from the chosen template, with the placeholders filled in', async () => {
    const s = await stage(withTemplates());
    tap(toolbarButton(s.pane, 'New scene'));
    startFrom(s)?.choose('Templates/Scenes/Action.md');
    await prompt(s).answer('Night Train');
    expect(s.vault.frontmatterOf('Novel/Manuscript/Night Train.md')).toEqual({
      synopsis: 'A chase in My Novel',
      status: 'First draft',
      label: 'Red',
      compile: true,
      order: expect.any(Number) as unknown as number,
      created: TODAY,
    });
    expect(s.vault.frontmatterOf('Novel/Manuscript/Night Train.md')?.['order']).not.toBe(5);
    expect(s.vault.bodyOf('Novel/Manuscript/Night Train.md')).toBe(`# Night Train\n\nStarted ${TODAY}.\n`);
    // The template itself is untouched.
    expect(s.vault.bodyOf(ACTION)).toBe('# {{title}}\n\nStarted {{date}}.\n');
    expect(s.vault.writesTo(ACTION)).toEqual([]);
  });

  it('makes an empty scene when nothing is chosen', async () => {
    const s = await stage(withTemplates());
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('Plain');
    expect(s.vault.bodyOf('Novel/Manuscript/Plain.md')).toBe('');
    expect(s.vault.frontmatterOf('Novel/Manuscript/Plain.md')?.['status']).toBe('To do');
  });

  it('says so, and stays open, when the template went away in the meantime', async () => {
    const s = await stage(withTemplates());
    tap(toolbarButton(s.pane, 'New scene'));
    startFrom(s)?.choose('Templates/Scenes/Action.md');
    await s.vault.trash(ACTION);
    await rest(s);
    const window = prompt(s);
    await window.answer('Night Train');
    expect(window.message()).toMatch(/no longer there/);
    expect(window.modal.isOpen).toBe(true);
    expect(s.vault.has('Novel/Manuscript/Night Train.md')).toBe(false);
  });

  it('shows no list when the project has no templates', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New scene'));
    expect(startFrom(s)).toBeNull();
    expect(prompt(s).modal.contentEl.withClass('spellbook-prompt-choice-row')).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('never shows a template in the binder', async () => {
    const s = await stage(withTemplates());
    const lines = picture(s.pane).join('\n');
    expect(lines).not.toMatch(/Action|פגישה|Templates/);
  });
});
