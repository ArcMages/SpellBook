// The texts the welcome ships, against the files they come from and the
// commands the plugin really has: so that the "What is new" note, the Help
// pane and the welcome page cannot drift from CHANGELOG.md, the guide, the
// tutorial and the code.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WELCOME_MODULE, readWelcomeModule, sectionOf, tidy, welcomeModule } from '../../../scripts/welcome.mjs';
import { COMMANDS_SERVICE, notesBetween, parseChangelog, parseCommandTable, parseTutorialSteps } from '../../../src/core/welcome/index';
import type { CommandsService } from '../../../src/core/welcome/index';
import {
  CHANGELOG_TEXT,
  COMMANDS_TEXT,
  CREATE_COMMAND,
  OPEN_BINDER_COMMAND,
  OPEN_INSPECTOR_COMMAND,
  PLACES,
  SAMPLE_COMMAND,
  STEP_HINTS,
  TOUR_STOPS,
  TUTORIAL_CONTENTS_TEXT,
} from '../../../src/features/welcome/index';
import SpellbookPlugin from '../../../src/main';
import { FakeObsidian } from '../../fakeObsidianApp';
import { resetFakeDocument } from '../../obsidianStub';
import type { Plugin as StubPlugin } from '../../obsidianStub';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');
const manifest = JSON.parse(read('manifest.json')) as { version: string };

const loaded: SpellbookPlugin[] = [];
afterEach(() => {
  for (const plugin of loaded.splice(0)) plugin.unload();
  resetFakeDocument();
});

/** The whole plugin, started in the stand-in app, with every command it registers. */
function started(): { plugin: SpellbookPlugin; stub: StubPlugin; service: CommandsService; fake: FakeObsidian } {
  const fake = new FakeObsidian();
  const plugin = new SpellbookPlugin(fake.app, { id: 'spellbook-novel-writer', name: 'Spellbook', version: manifest.version } as never);
  loaded.push(plugin);
  plugin.onload();
  fake.finishStartup();
  const service = plugin.features?.services.get<CommandsService>(COMMANDS_SERVICE);
  if (!service) throw new Error('the plugin offers no commands');
  return { plugin, stub: plugin as unknown as StubPlugin, service, fake };
}

describe('one source for each text', () => {
  it('ships exactly what the files say', () => {
    // When this fails: a file was changed without a build. Run "npm run build".
    expect(WELCOME_MODULE).toBe('src/features/welcome/bundledText.ts');
    expect(read(WELCOME_MODULE)).toBe(readWelcomeModule(repoRoot));
    expect(CHANGELOG_TEXT).toBe(tidy(read('CHANGELOG.md')));
    expect(COMMANDS_TEXT).toBe(sectionOf(read('docs/guide.md'), 'All commands'));
    expect(TUTORIAL_CONTENTS_TEXT).toBe(sectionOf(read('docs/tutorial.md'), 'Contents'));
  });

  it('takes a section up to the next heading of its level, and fails loudly on a missing one', () => {
    const markdown = '# Title\n\n## One\n\nfirst\n\n### Inside\n\nstill one\n\n## Two\n\nsecond\n';
    expect(sectionOf(markdown, 'One')).toBe('first\n\n### Inside\n\nstill one\n');
    expect(sectionOf(markdown, 'Two')).toBe('second\n');
    expect(() => sectionOf(markdown, 'Three')).toThrow(/no heading/);
    expect(welcomeModule({ changelog: '# C\r\n', guide: markdown.replace('One', 'All commands'), tutorial: markdown.replace('Two', 'Contents') })).toContain('"# C\\n"');
  });
});

describe('the changelog', () => {
  it("describes the manifest's version, so that \"What is new\" has something to say after this update", () => {
    const entries = parseChangelog(CHANGELOG_TEXT);
    expect(entries.length).toBeGreaterThan(0);
    const notes = notesBetween(entries, null, manifest.version);
    expect(notes.map((entry) => entry.version)).toEqual([manifest.version]);
    expect(notes[0]?.blocks.length).toBeGreaterThan(0);
  });
});

describe('the commands', () => {
  it('are all offered to the Help pane, with the names the plugin gave them', () => {
    const { stub, service } = started();
    expect(service.list()).toEqual(stub.commands.map((command) => ({ id: command.id, name: command.name })));
    expect(service.list().length).toBeGreaterThan(40);
  });

  it('are each described in the guide\'s table of commands, which the Help pane shows', () => {
    // When this fails: a command was added without a row in docs/guide.md, "All commands".
    const { service } = started();
    const described = parseCommandTable(COMMANDS_TEXT);
    const missing = service.list().filter((command) => !described.has(command.name));
    expect(missing).toEqual([]);
  });

  it('that the welcome page names are there, under those names', () => {
    const { service } = started();
    const names = new Map(service.list().map((command) => [command.id, command.name]));
    for (const id of [SAMPLE_COMMAND, CREATE_COMMAND, OPEN_BINDER_COMMAND, OPEN_INSPECTOR_COMMAND]) expect(names.has(id), id).toBe(true);
    for (const place of PLACES) expect(names.get(place.command), place.name).toBe(place.commandName);
  });

  it('can be run from the welcome page: a command that can run now runs, and one that cannot is refused', async () => {
    const { service, fake } = started();
    expect(service.run('open-binder')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.workspace.getLeavesOfType('spellbook-binder')).toHaveLength(1);
    expect(service.run('move-scene-up')).toBe(false); // no scene is open
    expect(service.run('no-such-command')).toBe(false);
  });
});

describe('the tutorial in short', () => {
  it('has a line for every step of the tutorial', () => {
    const steps = parseTutorialSteps(TUTORIAL_CONTENTS_TEXT);
    expect(steps.length).toBeGreaterThanOrEqual(10);
    expect(steps.map((step) => step.number)).toEqual(steps.map((_, at) => at + 1));
    expect(Object.keys(STEP_HINTS).sort()).toEqual(steps.map((step) => step.title).sort());
  });
});

describe('the tour', () => {
  it('points at four to six things, the plugin\'s own panes by their kinds', () => {
    expect(TOUR_STOPS.length).toBeGreaterThanOrEqual(4);
    // At most six on any one device: one of the bottom bar and the inspector's line is shown.
    expect(TOUR_STOPS.filter((stop) => stop.phone !== true).length).toBeLessThanOrEqual(6);
    expect(TOUR_STOPS.filter((stop) => stop.phone !== false).length).toBeLessThanOrEqual(6);
    const kinds = TOUR_STOPS.flatMap((stop) => stop.selectors).flatMap((selector) => [...selector.matchAll(/data-type="([^"]+)"/g)].map((match) => match[1]));
    expect(kinds.sort()).toEqual(['spellbook-binder', 'spellbook-inspector', 'spellbook-inspector'].sort());
  });
});
