// The first day of the week, taken from Obsidian's language setting. The
// stand-in for Obsidian has no `moment`; this file gives it one, so that the
// way from the feature's registration to the calendar's headings is driven
// as a whole. (Which day each language starts its week on is Obsidian's and
// moment's own business, and is not tested here.)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearScreen } from './plannerStage';
import { NOVEL_TODO, hostOf, openPlanner, paneOf, rest, wire } from './wiredStage';

const language = vi.hoisted(() => ({ firstDay: 1 as unknown }));

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  moment: { localeData: () => ({ firstDayOfWeek: () => language.firstDay }) },
}));

beforeEach(() => {
  clearScreen();
  language.firstDay = 1;
});

describe("the week's first day", () => {
  it("is the one of Obsidian's language, asked again at every drawing", async () => {
    const w = await wire({ todo: '- [ ] Call the printer' });
    const leaf = await openPlanner(w);
    const headings = (): string[] => paneOf(leaf).withClass('spellbook-calendar-weekday').map((heading) => heading.text);
    expect(hostOf(leaf).firstDayOfWeek).toBe(1);
    expect(headings()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

    language.firstDay = 6;
    w.vault.external.write(NOVEL_TODO, { body: '- [x] Call the printer' });
    await rest(w);
    expect(headings()).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  });

  it('is Sunday when the language does not say', async () => {
    language.firstDay = 'monday';
    const w = await wire();
    const leaf = await openPlanner(w);
    expect(hostOf(leaf).firstDayOfWeek).toBe(0);
    expect(paneOf(leaf).withClass('spellbook-calendar-weekday').map((heading) => heading.text)[0]).toBe('Sun');
  });
});
