// The logic of the welcome, without the screen: versions, the changelog, the
// first-run decision, where the tour's bubble goes, and the help lists.

import { describe, expect, it } from 'vitest';
import {
  commandHelp,
  compareVersions,
  hasProjectShape,
  isOnScreen,
  nextStep,
  notesBetween,
  parseChangelog,
  parseCommandTable,
  parseTutorialSteps,
  parseVersion,
  placeBubble,
  plainText,
  planStart,
  quietBeforeDeciding,
} from '../../../src/core/welcome/index';
import type { StartFacts } from '../../../src/core/welcome/index';

describe('versions', () => {
  it('reads the versions the manifest and the changelog write', () => {
    expect(parseVersion('0.9.0')).toEqual({ major: 0, minor: 9, patch: 0, pre: [] });
    expect(parseVersion('1.1')).toEqual({ major: 1, minor: 1, patch: 0, pre: [] });
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion('1.1.0-beta.2')).toEqual({ major: 1, minor: 1, patch: 0, pre: ['beta', '2'] });
    for (const wrong of ['', 'Unreleased', '1', '1.x.0', '1.2.3.4', null, 3, undefined]) expect(parseVersion(wrong), String(wrong)).toBeNull();
  });

  it('puts them in order', () => {
    expect(compareVersions('0.9.0', '1.1.0')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
    expect(compareVersions('1.1.0-beta.1', '1.1.0')).toBe(-1);
    expect(compareVersions('1.1.0-beta.2', '1.1.0-beta.10')).toBe(-1);
    expect(compareVersions('1.1.0-alpha', '1.1.0-beta')).toBe(-1);
    expect(compareVersions('1.1.0-beta', '1.1.0-beta.1')).toBe(-1);
    expect(compareVersions('1.1.0-1', '1.1.0-beta')).toBe(-1);
    expect(compareVersions('nonsense', '1.0.0')).toBeNull();
  });
});

const CHANGELOG = [
  '# Changelog',
  '',
  'What changed in each version.',
  '',
  '## Unreleased',
  '',
  '- Not out yet.',
  '',
  '## 1.1.0 (3 November 2026)',
  '',
  'A **welcome** for new writers.',
  '',
  '### Added',
  '',
  '- A [welcome page](docs/guide.md#the-welcome-page).',
  '- `Help` lists every command,',
  '  with what it does.',
  '',
  '## 1.0.0',
  '',
  '- Stable.',
  '',
  '## 0.9.0 (14 October 2026)',
  '',
  'The first tester release.',
  '',
  '- Organise: binder.',
  '',
].join('\n');

describe('the changelog', () => {
  it('reads each version with its date, paragraphs, headings and lists, as plain text', () => {
    const entries = parseChangelog(CHANGELOG);
    expect(entries.map((entry) => [entry.version, entry.date])).toEqual([
      ['1.1.0', '3 November 2026'],
      ['1.0.0', null],
      ['0.9.0', '14 October 2026'],
    ]);
    expect(entries[0]?.blocks).toEqual([
      { kind: 'paragraph', text: 'A welcome for new writers.' },
      { kind: 'heading', text: 'Added' },
      { kind: 'list', items: ['A welcome page.', 'Help lists every command, with what it does.'] },
    ]);
    expect(entries[2]?.blocks).toEqual([
      { kind: 'paragraph', text: 'The first tester release.' },
      { kind: 'list', items: ['Organise: binder.'] },
    ]);
  });

  it('takes Windows line ends as well', () => {
    expect(parseChangelog(CHANGELOG.replace(/\n/g, '\r\n'))).toEqual(parseChangelog(CHANGELOG));
  });

  it('makes Markdown into plain text and leaves the rest alone', () => {
    expect(plainText('**Bold** and *italic* and `code` and [a link](https://example.invalid)')).toBe('Bold and italic and code and a link');
    expect(plainText('snake_case_name and 2 * 3 * 4')).toBe('snake_case_name and 2 * 3 * 4');
    expect(plainText('  many   spaces\n')).toBe('many spaces');
    expect(plainText('עברית **מודגשת**')).toBe('עברית מודגשת');
  });

  it('picks the versions after the one last run, up to the one running, newest first', () => {
    const entries = parseChangelog(CHANGELOG);
    expect(notesBetween(entries, '0.9.0', '1.1.0').map((entry) => entry.version)).toEqual(['1.1.0', '1.0.0']);
    expect(notesBetween(entries, '1.0.0', '1.1.0').map((entry) => entry.version)).toEqual(['1.1.0']);
    expect(notesBetween(entries, '1.1.0', '1.1.0')).toEqual([]);
    expect(notesBetween(entries, null, '1.0.0').map((entry) => entry.version)).toEqual(['1.0.0']);
    expect(notesBetween(entries, null, '2.0.0')).toEqual([]); // a version the changelog does not describe
  });
});

describe('what to show when Spellbook starts', () => {
  const entries = parseChangelog(CHANGELOG);
  const facts = (over: Partial<StartFacts>): StartFacts => ({
    welcomeSeen: false,
    hasProjects: false,
    storedVersion: null,
    currentVersion: '1.1.0',
    whatsNewOn: true,
    ...over,
  });
  const versions = (over: Partial<StartFacts>): string[] => planStart(facts(over), entries).whatsNew.map((entry) => entry.version);

  it('the first time on a device with no project: the welcome page, and no "What is new"', () => {
    expect(planStart(facts({}), entries)).toEqual({ welcome: 'show', whatsNew: [], saveVersion: '1.1.0' });
  });

  it('never the welcome on a device whose vault holds a project: it only remembers that', () => {
    const plan = planStart(facts({ hasProjects: true }), entries);
    expect(plan.welcome).toBe('mark-seen');
    // A writer from before the welcome existed: the notes of the version they now have.
    expect(plan.whatsNew.map((entry) => entry.version)).toEqual(['1.1.0']);
  });

  it('only once', () => {
    expect(planStart(facts({ welcomeSeen: true, storedVersion: '1.1.0' }), entries)).toEqual({ welcome: 'none', whatsNew: [], saveVersion: null });
  });

  it('"What is new" after an update, with every version since the last one run', () => {
    expect(versions({ welcomeSeen: true, storedVersion: '0.9.0' })).toEqual(['1.1.0', '1.0.0']);
    expect(planStart(facts({ welcomeSeen: true, storedVersion: '0.9.0' }), entries).saveVersion).toBe('1.1.0');
  });

  it('no note when the writer turned it off, but the version is still remembered', () => {
    expect(planStart(facts({ welcomeSeen: true, storedVersion: '0.9.0', whatsNewOn: false }), entries)).toEqual({ welcome: 'none', whatsNew: [], saveVersion: '1.1.0' });
  });

  it('no note when going back to an older version, or with no notes for the version', () => {
    expect(planStart(facts({ welcomeSeen: true, storedVersion: '2.0.0' }), entries)).toEqual({ welcome: 'none', whatsNew: [], saveVersion: '1.1.0' });
    expect(versions({ welcomeSeen: true, storedVersion: '1.1.0', currentVersion: '1.2.0' })).toEqual([]);
  });

  it('waits longer for a quiet vault on a phone or tablet', () => {
    expect(quietBeforeDeciding(true)).toBeGreaterThan(quietBeforeDeciding(false));
  });
});

describe('a vault that looks like it holds a project', () => {
  const files: Record<string, string[]> = {
    Novel: ['Novel/Novel.md', 'Novel/To-do.md'],
    'Books/Second': ['Books/Second/second.md'],
    Loose: ['Loose/Other.md'],
  };
  const filesIn = (folder: string): string[] => files[folder] ?? [];

  it('is told by a folder with a note of its own name and a Manuscript folder', () => {
    expect(hasProjectShape(['Novel', 'Novel/Manuscript'], filesIn)).toBe(true);
    expect(hasProjectShape(['Books', 'Books/Second', 'Books/Second/manuscript'], filesIn)).toBe(true); // capitals do not matter
  });

  it('is not told by either alone', () => {
    expect(hasProjectShape(['Novel'], filesIn)).toBe(false);
    expect(hasProjectShape(['Loose', 'Loose/Manuscript'], filesIn)).toBe(false);
    expect(hasProjectShape([], filesIn)).toBe(false);
  });
});

describe('the tour', () => {
  const viewport = { width: 1000, height: 800 };
  const bubble = { width: 300, height: 150 };

  it('puts the bubble below its target when there is room, centred on it and inside the window', () => {
    expect(placeBubble({ top: 10, left: 400, width: 200, height: 40 }, bubble, viewport)).toEqual({ top: 62, left: 350, side: 'below' });
    // Near the window's edge it is pushed back inside.
    expect(placeBubble({ top: 10, left: 0, width: 40, height: 40 }, bubble, viewport).left).toBe(8);
    expect(placeBubble({ top: 10, left: 980, width: 20, height: 20 }, bubble, viewport).left).toBe(692);
  });

  it('above, beside, or in the middle when the target fills the window', () => {
    expect(placeBubble({ top: 700, left: 400, width: 100, height: 40 }, bubble, viewport).side).toBe('above');
    // A sidebar, as tall as the window.
    expect(placeBubble({ top: 0, left: 0, width: 300, height: 800 }, bubble, viewport)).toEqual({ top: 325, left: 312, side: 'beside-after' });
    expect(placeBubble({ top: 0, left: 700, width: 300, height: 800 }, bubble, viewport)).toEqual({ top: 325, left: 388, side: 'beside-before' });
    // A drawer over a phone's whole screen.
    const phone = { width: 390, height: 800 };
    expect(placeBubble({ top: 0, left: 0, width: 390, height: 800 }, bubble, phone)).toEqual({ top: 325, left: 45, side: 'centre' });
    expect(placeBubble(null, bubble, phone).side).toBe('centre');
  });

  it('a bubble wider than the window still starts inside it', () => {
    expect(placeBubble(null, { width: 500, height: 900 }, { width: 390, height: 800 })).toEqual({ top: 8, left: 8, side: 'centre' });
  });

  it('tells what is on the screen', () => {
    expect(isOnScreen({ top: 0, left: 0, width: 10, height: 10 }, viewport)).toBe(true);
    expect(isOnScreen({ top: 0, left: 0, width: 0, height: 10 }, viewport)).toBe(false); // a folded sidebar
    expect(isOnScreen({ top: 0, left: -400, width: 390, height: 800 }, viewport)).toBe(false); // a drawer slid away
    expect(isOnScreen({ top: 900, left: 0, width: 10, height: 10 }, viewport)).toBe(false);
    expect(isOnScreen(null, viewport)).toBe(false);
  });

  it('passes over the steps that cannot be shown, both ways', () => {
    const shown = [false, true, false, true, true];
    const can = (step: number): boolean => shown[step] === true;
    expect(nextStep(5, -1, 1, can)).toBe(1);
    expect(nextStep(5, 1, 1, can)).toBe(3);
    expect(nextStep(5, 4, 1, can)).toBeNull();
    expect(nextStep(5, 3, -1, can)).toBe(1);
    expect(nextStep(5, 1, -1, can)).toBeNull();
    expect(nextStep(0, -1, 1, can)).toBeNull();
  });
});

describe('the help lists', () => {
  const table = [
    '| Command | What it does |',
    '| --- | --- |',
    '| Create project | Asks for a name. |',
    '| Open to-do note | Opens the project\'s `To-do.md`. |',
    '',
    'Other text.',
  ].join('\n');

  it('reads what each command does from the guide\'s table, as plain text, without its header', () => {
    expect([...parseCommandTable(table)]).toEqual([
      ['Create project', 'Asks for a name.'],
      ['Open to-do note', "Opens the project's To-do.md."],
    ]);
  });

  it('lists every registered command once, in order, with what the guide says or nothing', () => {
    const help = commandHelp(
      [
        { id: 'create-project', name: 'Create project' },
        { id: 'new-thing', name: 'New thing' },
        { id: 'create-project', name: 'Create project' },
      ],
      parseCommandTable(table),
    );
    expect(help).toEqual([
      { id: 'create-project', name: 'Create project', description: 'Asks for a name.' },
      { id: 'new-thing', name: 'New thing', description: null },
    ]);
  });

  it("reads the tutorial's numbered steps from its list of contents", () => {
    const contents = ['1. [Install Spellbook](#1-install)', '2. [Create **your** project](#2-create)', '', 'Then: [A daily routine](#a-daily-routine).'].join('\n');
    expect(parseTutorialSteps(contents)).toEqual([
      { number: 1, title: 'Install Spellbook' },
      { number: 2, title: 'Create your project' },
    ]);
  });
});
