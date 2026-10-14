// Ages on the screen, from end to end: the real world-building feature (and
// the corkboard's inspector) on a project store over the tests' memory
// vault. Born, Died and Age near the top of a character's sheet; the story's
// present, set from the World browser and stored in the project index; the
// age in each scene, on the sheet's list of scenes and on the inspector's
// chips, with a mark for a character not born yet or already dead.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CALENDAR_PRESETS, calendarToIndexValue } from '../../../src/core/timeline';
import type { StoryCalendar } from '../../../src/core/timeline';
import { INSPECTOR_VIEW_TYPE } from '../../../src/features/corkboard/inspectorView';
import { MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Modal as StubModal, Notice as StubNotice, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import type { ButtonComponent, FakeElement } from '../../obsidianStub';
import { INDEX_BODY } from '../../storeHarness';
import { CLOSING, MARA, MARA_HE, MARA_HE_PATH, NIGHT, NOVEL_INDEX, OPENING, SALTWICK, calm, cardNamed, inNovel, lastWindow, novelVault, one, openWorld, typeInto, wire } from './stage';
import type { Wired } from './stage';

const EMBER = CALENDAR_PRESETS.find((preset) => preset.id === 'ten-months')?.calendar as StoryCalendar;
const stages: Wired[] = [];

beforeEach(() => {
  StubMenu.shown.length = 0;
  StubNotice.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
  resetPlatform();
});

afterEach(() => {
  for (const made of stages.splice(0)) made.switchOff();
});

async function stage(vault: MemoryVault, inspector = false): Promise<Wired> {
  const made = await wire(vault, { inspector });
  stages.push(made);
  return made;
}

/**
 * The novel with dates: Mara born 17 Apr 1889, the Hebrew Mara born 1930
 * (after every scene), the scenes "Opening" on 14 Oct 1923 and "Night" on
 * 2 Jan 1925. Both Maras are in "Night".
 */
function datedVault(): MemoryVault {
  const vault = novelVault();
  vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
    frontmatter['date'] = '1889-04-17';
  });
  vault.external.editFrontmatter(inNovel(MARA_HE_PATH), (frontmatter) => {
    frontmatter['date'] = 1930;
  });
  vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
    frontmatter['date'] = '1923-10-14';
  });
  vault.external.editFrontmatter(inNovel(NIGHT), (frontmatter) => {
    frontmatter['date'] = '1925-01-02';
    frontmatter['entities'] = ['[[Mara]]', `[[${MARA_HE}]]`];
  });
  return vault;
}

async function sheetOf(s: Wired, name: string): Promise<{ pane: FakeElement; sheet: () => FakeElement }> {
  const { pane } = await openWorld(s);
  cardNamed(pane, name).fire('click');
  return { pane, sheet: () => one(pane, 'spellbook-world-detail') };
}

/** The lines of a character's life: word and what it says. */
function lifeRows(sheet: FakeElement): string[] {
  const life = one(sheet, 'spellbook-world-life');
  return life.children.map((row) => {
    const value = row.withClass('spellbook-world-time-value')[0] ?? row.withClass('spellbook-world-age-value')[0];
    return `${one(row, 'spellbook-world-time-word').text}: ${value?.fullText ?? ''}`;
  });
}

/** The names of the form's fields, as the sheet shows them. */
const fieldNames = (sheet: FakeElement): string[] => sheet.withClass('spellbook-world-field-name').map((name) => name.text);

function buttons(): ButtonComponent[] {
  return (lastWindow().contentEl.settings[0]?.components ?? []) as ButtonComponent[];
}

async function save(s: Wired): Promise<void> {
  (buttons()[buttons().length - 1] as ButtonComponent).click();
  await calm(s);
}

describe('Born, Died and Age near the top of a character\'s sheet', () => {
  it('puts them right after the other names, and leaves only the moments under "Time"', async () => {
    const s = await stage(datedVault());
    const { sheet } = await sheetOf(s, 'Mara');
    const parts = sheet().children.map((child) => [...child.classes].find((cls) => /^spellbook-world-(aliases|life|detail-summary)$/.test(cls))).filter(Boolean);
    expect(parts).toEqual(['spellbook-world-aliases', 'spellbook-world-life', 'spellbook-world-detail-summary']);
    // The latest date in the story is the scene "Night", 2 Jan 1925.
    expect(lifeRows(sheet())).toEqual(['Born: 17 Apr 1889', 'Died: Not set', 'Age: 35 at 2 Jan 1925 (latest date in the story)']);
    // The two dates are not shown a second time under "Time".
    const rest = one(sheet(), 'spellbook-world-sheet-rest');
    expect(rest.withClass('spellbook-world-time-row')).toEqual([]);
    expect(rest.withClass('spellbook-world-time-head')[0]?.fullText).toBe('Time');
    // The typed age (34) differs from the age worked out (35): it is kept, as "Age (typed)".
    expect(fieldNames(sheet())).toContain('Age (typed)');
    expect(s.vault.writes).toEqual([]);
  });

  it('says "Died at" once a death is set, and hides a typed age that says the same', async () => {
    const s = await stage(datedVault());
    const { sheet } = await sheetOf(s, 'Mara');
    (sheet().withClass('spellbook-world-time-set')[1] as FakeElement).fire('click');
    expect(lastWindow().titleEl.text).toBe('Died');
    typeInto(one(lastWindow().contentEl, 'spellbook-world-time-date'), '1923-03');
    await save(s);
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['end']).toBe('1923-03');
    expect(lifeRows(sheet())).toEqual(['Born: 17 Apr 1889', 'Died: Mar 1923', 'Age: Died at 33']);
    // "Age (typed)" says 34, the death says 33: still shown. Typed as 33, it goes.
    s.vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['age'] = '33';
    });
    await calm(s);
    expect(fieldNames(sheet())).not.toContain('Age (typed)');
    expect(fieldNames(sheet())).not.toContain('age');
  });

  it('keeps the typed age as it always was when there is no birth date', async () => {
    const s = await stage(novelVault());
    const { sheet } = await sheetOf(s, 'Mara');
    expect(lifeRows(sheet())).toEqual(['Born: Not set', 'Died: Not set', 'Age: Set "Born" to work it out']);
    expect(fieldNames(sheet())).toContain('age');
    expect(sheet().withClass('spellbook-world-field-box').map((box) => box.value)).toContain('34');
  });

  it('says when the story has no date to work the age out at, and when the death is not after the birth', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['date'] = 1889;
    });
    vault.external.editFrontmatter(inNovel(MARA_HE_PATH), (frontmatter) => {
      frontmatter['date'] = 1889;
      frontmatter['end'] = 1850;
    });
    // The event "The fire" has a date: take it away, so that nothing in the story is dated.
    vault.external.editFrontmatter(inNovel('Timeline/The fire.md'), (frontmatter) => {
      delete frontmatter['date'];
    });
    const s = await stage(vault);
    const { pane, sheet } = await sheetOf(s, 'Mara');
    expect(lifeRows(sheet())[2]).toBe("Age: No date in the story yet: give a scene a date, or set the story's present");
    cardNamed(pane, MARA_HE).fire('click');
    await calm(s);
    expect(lifeRows(sheet())).toEqual(['Born: 1889', 'Died: 1850 (cannot be read as a date)', 'Age: Cannot be worked out: "Died" is not later than "Born"']);
  });

  it('shows no age for a place: its dates stay under "Time"', async () => {
    const s = await stage(datedVault());
    const { sheet } = await sheetOf(s, 'Saltwick');
    expect(sheet().withClass('spellbook-world-life')).toEqual([]);
    expect(one(sheet(), 'spellbook-world-sheet-rest').withClass('spellbook-world-time-row').length).toBe(2);
    expect(sheet().withClass('spellbook-world-age-row')).toEqual([]);
  });

  it('shows the age for a creature once its dates are called "Born" and "Died"', async () => {
    const vault = datedVault();
    vault.seed(inNovel('World/Creatures/Old Grey.md'), { frontmatter: { type: 'creature', date: 1900, summary: '' }, body: '' });
    const s = await stage(vault);
    const { pane, sheet } = await sheetOf(s, 'Old Grey');
    expect(sheet().withClass('spellbook-world-life')).toEqual([]);
    await s.store.updateProjectData('entityTypes', () => [{ id: 'creature', name: 'Creature', folder: 'Creatures', dateWords: ['Born', 'Died'] }]);
    await calm(s);
    cardNamed(pane, 'Old Grey').fire('click');
    await calm(s);
    expect(lifeRows(sheet())).toEqual(['Born: 1900', 'Died: Not set', 'Age: 25 at 2 Jan 1925 (latest date in the story)']);
  });
});

describe('the story\'s present', () => {
  it('is set from the World browser into the project index alone, and the ages follow; "Remove" goes back to the latest date', async () => {
    const s = await stage(datedVault());
    const { pane, sheet } = await sheetOf(s, 'Mara');
    const button = one(pane, 'spellbook-world-present');
    expect(button.getAttr('aria-label')).toBe("Story's present: 2 Jan 1925 (latest date in the story)");
    button.fire('click');
    expect(lastWindow().titleEl.text).toBe("Story's present");
    typeInto(one(lastWindow().contentEl, 'spellbook-world-time-date'), '1912-05');
    await save(s);
    expect(s.vault.writes.map((write) => write.path)).toEqual([NOVEL_INDEX]);
    expect(s.vault.frontmatterOf(NOVEL_INDEX)?.['storyPresent']).toBe('1912-05');
    expect(s.vault.bodyOf(NOVEL_INDEX)).toBe(INDEX_BODY);
    expect(lifeRows(sheet())[2]).toBe('Age: 23 at May 1912');
    expect(one(pane, 'spellbook-world-present').getAttr('aria-label')).toBe("Story's present: May 1912");
    // From the sheet too: the button beside the age.
    one(sheet(), 'spellbook-world-age-present').fire('click');
    expect(buttons().map((b) => b.buttonEl.text)).toEqual(['Remove', 'Cancel', 'Save']);
    (buttons()[0] as ButtonComponent).click();
    await calm(s);
    expect(s.vault.frontmatterOf(NOVEL_INDEX)).not.toHaveProperty('storyPresent');
    expect(lifeRows(sheet())[2]).toBe('Age: 35 at 2 Jan 1925 (latest date in the story)');
  });

  it('says "Not born yet" for a character born after the present', async () => {
    const s = await stage(datedVault());
    const { sheet } = await sheetOf(s, MARA_HE);
    expect(lifeRows(sheet())[2]).toBe('Age: Not born yet at 2 Jan 1925 (latest date in the story)');
  });

  it('is read and written in the project\'s invented calendar', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(NOVEL_INDEX, (frontmatter) => {
      frontmatter['calendar'] = calendarToIndexValue(EMBER);
      frontmatter['storyPresent'] = '1203-04-17 AE';
    });
    vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['date'] = '1180-04-18 AE';
    });
    const s = await stage(vault);
    const { pane, sheet } = await sheetOf(s, 'Mara');
    expect(lifeRows(sheet())[2]).toBe('Age: 22 at 17 Highsun 1203 AE');
    one(pane, 'spellbook-world-present').fire('click');
    typeInto(one(lastWindow().contentEl, 'spellbook-timeline-year-input'), '1210');
    await save(s);
    expect(s.vault.frontmatterOf(NOVEL_INDEX)?.['storyPresent']).toMatch(/^1210.* AE$/);
    expect(lifeRows(sheet())[2]).toMatch(/^Age: 29 at /);
  });
});

describe('the age in each scene', () => {
  it('is on the sheet\'s list of scenes, with a mark for a scene before the birth', async () => {
    const s = await stage(datedVault());
    const { pane, sheet } = await sheetOf(s, 'Mara');
    const rows = (): FakeElement[] => one(sheet(), 'spellbook-world-sheet-rest').withClass('spellbook-world-appearance');
    expect(rows().map((row) => row.withClass('spellbook-world-row-age')[0]?.text ?? '')).toEqual(['age 34', 'age 35']);
    cardNamed(pane, MARA_HE).fire('click');
    await calm(s);
    const mark = one(rows()[0] as FakeElement, 'spellbook-world-row-warning');
    expect(mark.getAttr('aria-label')).toBe('not born yet in this scene');
    expect(rows()[0]?.withClass('spellbook-world-row-age')).toEqual([]);
  });

  it('is on the inspector\'s chips: "Mara · 35", and a warning mark for one who is not born yet or already dead', async () => {
    const vault = datedVault();
    vault.external.editFrontmatter(inNovel(SALTWICK), (frontmatter) => {
      frontmatter['date'] = 1688;
    });
    const s = await stage(vault, true);
    s.activate(inNovel(NIGHT));
    s.command('open-inspector').callback?.();
    await calm(s);
    const view = s.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE)[0]?.view as unknown as { contentEl: FakeElement };
    const chips = (): FakeElement[] => view.contentEl.withClass('spellbook-entity-chip');
    expect(chips().map((chip) => chip.withClass('spellbook-entity-chip-age')[0]?.text ?? '')).toEqual(['· 35', '']);
    expect(one(chips()[0] as FakeElement, 'spellbook-entity-chip-open').getAttr('aria-label')).toBe('Mara, age 35 (Character)');
    const unborn = chips()[1] as FakeElement;
    expect(unborn.hasClass('spellbook-entity-chip-warned')).toBe(true);
    expect(one(unborn, 'spellbook-entity-chip-warning').getAttr('aria-label')).toBe('not born yet in this scene');

    // Mara dies before the scene.
    s.vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['end'] = '1924-12';
    });
    await calm(s);
    expect(one(chips()[0] as FakeElement, 'spellbook-entity-chip-warning').getAttr('aria-label')).toBe('died before this scene');
    expect(chips()[0]?.withClass('spellbook-entity-chip-age')).toEqual([]);

    // A scene without a date, and a place: no ages, no marks.
    s.activate(inNovel(CLOSING));
    await calm(s);
    expect(view.contentEl.withClass('spellbook-entity-chip-age')).toEqual([]);
    expect(view.contentEl.withClass('spellbook-entity-chip-warning')).toEqual([]);
    expect(s.vault.writes).toEqual([]);
  });
});
