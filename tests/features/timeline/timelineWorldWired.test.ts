// The world lanes as they are plugged into the plugin: the timeline's host
// on the project store over the tests' memory vault. What it hands the
// screen of the world, what this device remembers, the sheet asked of the
// World browser by name, the command "Open world history", and a change of
// an entity's dates that reaches the note through the store alone.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTITY_SHEET_SERVICE, WORLD_HISTORY_SERVICE } from '../../../src/core/world';
import { WORLD_LANES_KEY } from '../../../src/features/timeline/hiddenLanes';
import { OPEN_WORLD_HISTORY_COMMAND } from '../../../src/features/timeline/index';
import type { TimelineData } from '../../../src/features/timeline/timelineHost';
import { TimelineView } from '../../../src/features/timeline/timelineView';
import { resetPlatform } from '../../obsidianStub';
import { clearScreen } from './screen';
import { NOVEL, hostOf, novelVault, rest, wireOpen } from './wired';
import type { Wired } from './wired';

const MARA = 'World/Characters/Mara.md';
const BODY = 'Her story, in the writer\'s own words.\n';

function worldVault(): ReturnType<typeof novelVault> {
  const vault = novelVault();
  vault.seed(`Novel/${MARA}`, {
    frontmatter: { type: 'character', role: 'Keeper', summary: 'A long one.', date: '1889-04-17', end: 1923, moments: ['1911 | qualifies'] },
    body: BODY,
  });
  vault.seed('Novel/World/Places/Saltwick.md', { frontmatter: { type: 'place', summary: 'No date.' }, body: '' });
  return vault;
}

const units: Wired[] = [];

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  for (const w of units.splice(0)) w.unload();
  resetPlatform();
});

async function wired(): Promise<Wired> {
  const w = await wireOpen(NOVEL, worldVault());
  units.push(w);
  return w;
}

describe('the world, as the timeline\'s host hands it out', () => {
  it('gives each entity note with only what the timeline shows of it, and the world lanes off', async () => {
    const w = await wired();
    const host = hostOf(w);
    const data = host.getData() as TimelineData;
    expect(data.worldNotes).toEqual([
      { path: MARA, frontmatter: { type: 'character', date: '1889-04-17', end: 1923, moments: ['1911 | qualifies'] } },
      { path: 'World/Places/Saltwick.md', frontmatter: { type: 'place' } },
    ]);
    expect(data.worldLanes).toEqual({ on: false, hidden: [] });
    expect(w.vault.writes).toEqual([]);
  });

  it('remembers what this device shows of the world in its own storage, never in the project', async () => {
    const w = await wired();
    const host = hostOf(w);
    host.setWorldLanes({ on: true, hidden: ['place'] });
    await rest(w);
    expect(host.getData()?.worldLanes).toEqual({ on: true, hidden: ['place'] });
    expect(JSON.parse(w.storage.load(WORLD_LANES_KEY) as string)).toEqual({ [NOVEL]: ['on', 'hide:place'] });
    expect(w.vault.writes).toEqual([]);
  });

  it('asks the World browser for a sheet by name, and says so when nobody offers one', async () => {
    const w = await wired();
    const host = hostOf(w);
    expect(host.showEntity(MARA)).toBe(false);
    const shown: string[] = [];
    w.registered.services.provide(ENTITY_SHEET_SERVICE, { show: (path: string) => shown.push(path) });
    expect(host.showEntity(MARA)).toBe(true);
    expect(shown).toEqual([MARA]);
  });

  it('re-dates an entity through the store: its "date" changes, its text and its other properties do not', async () => {
    const w = await wired();
    const host = hostOf(w);
    await host.applyNoteChanges([{ path: MARA, patch: { date: '1890-04-17' }, remake: () => ({ date: '1890-04-17' }) }]);
    await rest(w);
    expect(w.vault.writes).toEqual([{ op: 'updateFrontmatter', path: `Novel/${MARA}` }]);
    expect(w.vault.frontmatterOf(`Novel/${MARA}`)).toEqual({
      type: 'character',
      role: 'Keeper',
      summary: 'A long one.',
      date: '1890-04-17',
      end: 1923,
      moments: ['1911 | qualifies'],
    });
    expect(w.vault.bodyOf(`Novel/${MARA}`)).toBe(BODY);
  });
});

describe('"Open world history"', () => {
  it('is a command, and a service the World browser asks for, that opens the timeline with the world on and the scenes off', async () => {
    const w = await wired();
    const command = w.plugin.commands.find((candidate) => candidate.id === OPEN_WORLD_HISTORY_COMMAND);
    expect(command?.name).toBe('Open world history');
    expect(w.registered.services.get(WORLD_HISTORY_SERVICE)).toBeDefined();
    command?.callback?.();
    await rest(w);
    await rest(w);
    expect(w.panes()).toHaveLength(1);
    expect(w.panes()[0]?.view).toBeInstanceOf(TimelineView);
    const prefs = JSON.parse(w.storage.load(WORLD_LANES_KEY) as string) as Record<string, string[]>;
    expect(prefs[NOVEL]).toEqual(['on']);
    expect(JSON.parse(w.storage.load('spellbook-timeline-hidden-lanes') as string)).toEqual({ [NOVEL]: ['Manuscript'] });
    // Asked again, it opens no second timeline.
    command?.callback?.();
    await rest(w);
    expect(w.panes()).toHaveLength(1);
    expect(w.vault.writes).toEqual([]);
  });
});
