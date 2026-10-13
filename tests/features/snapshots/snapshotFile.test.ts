// What a snapshot is on disk: its properties, its text (the scene's own
// properties kept inert in a code block), which scene it belongs to, and
// what a scene reads after a restore.

import { describe, expect, it } from 'vitest';
import {
  ONE_COLUMN_BELOW,
  SCENE_ID_KEY,
  TWO_COLUMNS_FROM,
  automaticToRemove,
  belongsTo,
  isNarrowPane,
  newSceneId,
  readSnapshotInfo,
  readSnapshotText,
  restoredText,
  sceneIdOf,
  shownDate,
  shownName,
  snapshotBody,
  snapshotFileName,
  snapshotFolderName,
  snapshotFrontmatter,
  snapshotsOf,
  splitNote,
  stampOf,
  tidySnapshotName,
} from '../../../src/core/snapshots';
import type { LocalMoment, SnapshotInfo } from '../../../src/core/snapshots';
import { sanitiseFileName } from '../../../src/core/names';
import { isProjectIndex } from '../../../src/core/projectIndex';

const MOMENT: LocalMoment = { year: 2026, month: 10, day: 4, hour: 9, minute: 5, second: 7 };
const SCENE = '---\nsynopsis: Anna arrives.\nstatus: First draft\n---\n# פרק ראשון\n\nשלום לך אחותי.\n';

function info(over: Partial<SnapshotInfo> & { path: string }): SnapshotInfo {
  return { sceneId: 'abc', scenePath: 'Manuscript/Opening.md', name: '', taken: '2026-10-04T09:05:07', takenAt: 1000, automatic: false, words: 3, device: 'dev', ...over };
}

describe('the properties of a snapshot', () => {
  it('say which scene, when, under what name and how many words, and read back the same', () => {
    const frontmatter = snapshotFrontmatter({
      sceneId: 'abc',
      scenePath: 'Manuscript/Opening.md',
      name: 'לפני השכתוב',
      moment: MOMENT,
      takenAt: 1791000000000,
      automatic: false,
      words: 1234,
      device: 'dev1',
    });
    expect(frontmatter).toEqual({
      'spellbook-snapshot': 1,
      'scene-id': 'abc',
      scene: 'Manuscript/Opening.md',
      name: 'לפני השכתוב',
      taken: '2026-10-04T09:05:07',
      'taken-at': 1791000000000,
      automatic: false,
      words: 1234,
      device: 'dev1',
    });
    // Nothing in them makes the note a project, a scene with an order, or a timeline event.
    expect(isProjectIndex(frontmatter)).toBe(false);
    for (const key of ['spellbook', 'order', 'status', 'label', 'synopsis', 'target', 'compile', 'date', 'timelines', 'scenes', SCENE_ID_KEY]) {
      expect(Object.keys(frontmatter)).not.toContain(key);
    }
    expect(readSnapshotInfo('Snapshots/Opening - abc/x.md', frontmatter)).toEqual({
      path: 'Snapshots/Opening - abc/x.md',
      sceneId: 'abc',
      scenePath: 'Manuscript/Opening.md',
      name: 'לפני השכתוב',
      taken: '2026-10-04T09:05:07',
      takenAt: 1791000000000,
      automatic: false,
      words: 1234,
      device: 'dev1',
    });
  });

  it('are read with care: a note that is no snapshot is none, and what was changed by hand is "unknown"', () => {
    expect(readSnapshotInfo('a.md', null)).toBeNull();
    expect(readSnapshotInfo('a.md', { status: 'Draft' })).toBeNull();
    expect(readSnapshotInfo('a.md', { 'spellbook-snapshot': 1, 'taken-at': 'yesterday', words: -4, name: ['x'], automatic: 'yes' })).toEqual({
      path: 'a.md',
      sceneId: null,
      scenePath: null,
      name: '',
      taken: '',
      takenAt: 0,
      automatic: false,
      words: null,
      device: '',
    });
  });

  it('show a name and a date', () => {
    expect(stampOf(MOMENT)).toBe('2026-10-04T09:05:07');
    expect(shownDate('2026-10-04T09:05:07')).toBe('2026-10-04 09:05');
    expect(shownDate('some day')).toBe('');
    expect(shownName({ name: 'Before the rewrite', automatic: false })).toBe('Before the rewrite');
    expect(shownName({ name: '', automatic: false })).toBe('Snapshot');
    expect(shownName({ name: '', automatic: true })).toBe('Automatic');
    expect(tidySnapshotName('  two\n lines  ')).toBe('two lines');
    expect(tidySnapshotName('x'.repeat(300))).toHaveLength(120);
  });
});

describe('the names of a snapshot on disk', () => {
  it('are tidy file names as they stand, in any language', () => {
    const names = [
      snapshotFileName(MOMENT, ''),
      snapshotFileName(MOMENT, 'Before the rewrite'),
      snapshotFileName(MOMENT, 'לפני השכתוב'),
      snapshotFileName(MOMENT, 'Before restore: Draft 2, 2026-10-04 09:05'),
      snapshotFileName(MOMENT, 'a/b\\c:d*e?"f<g>h|i'),
      snapshotFileName(MOMENT, 'x'.repeat(500)),
      snapshotFileName(MOMENT, '', 1),
      snapshotFileName(MOMENT, 'Again', 2),
      snapshotFolderName('Opening', 'abc'),
      snapshotFolderName('לילה בנמל', 'abc'),
      snapshotFolderName('y'.repeat(500), 'abc'),
      snapshotFolderName('..', 'abc'),
      snapshotFolderName('', 'abc'),
    ];
    for (const name of names) {
      expect(sanitiseFileName(name, ''), name).toBe(name);
      expect(name).not.toMatch(/[/\\]/);
    }
    expect(names.slice(0, 3)).toEqual(['2026-10-04 09.05.07', '2026-10-04 09.05.07 Before the rewrite', '2026-10-04 09.05.07 לפני השכתוב']);
    expect(names[6]).toBe('2026-10-04 09.05.07a');
    expect(names[7]).toBe('2026-10-04 09.05.07b Again');
    expect(names[8]).toBe('Opening - abc');
    expect(names[9]).toBe('לילה בנמל - abc');
    expect(names[10]?.endsWith(' - abc')).toBe(true);
  });

  it('give a scene an id of lower-case letters and digits, different each time', () => {
    const ids = [newSceneId(1791000000000, 'Dev-1!x9', 0), newSceneId(1791000000000, 'Dev-1!x9', 1), newSceneId(1791000000001, 'Dev-1!x9', 0)];
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8,}$/);
    expect(new Set(ids).size).toBe(3);
    expect(sceneIdOf({ [SCENE_ID_KEY]: ' abc ' })).toBe('abc');
    expect(sceneIdOf({ [SCENE_ID_KEY]: '' })).toBeNull();
    expect(sceneIdOf({ status: 'Draft' })).toBeNull();
    expect(sceneIdOf(null)).toBeNull();
  });
});

describe('the text of a snapshot', () => {
  it('holds the scene whole: its properties inert in a code block, then its text exactly as it was', () => {
    const body = snapshotBody(SCENE);
    expect(body).toBe('```yaml\nsynopsis: Anna arrives.\nstatus: First draft\n```\n# פרק ראשון\n\nשלום לך אחותי.\n');
    // Under the snapshot's own properties it reads back letter for letter.
    const note = `---\nspellbook-snapshot: 1\nname: x\n---\n${body}`;
    expect(readSnapshotText(note)).toEqual({ yaml: 'synopsis: Anna arrives.\nstatus: First draft', body: '# פרק ראשון\n\nשלום לך אחותי.\n' });
    // The scene's properties are not the snapshot's: its own block ends where its own "---" does.
    expect(splitNote(note).yaml).toBe('spellbook-snapshot: 1\nname: x');
  });

  it('comes back the same for every kind of scene', () => {
    const scenes = [
      SCENE,
      'No properties at all.\n',
      '',
      '---\n---\nEmpty properties.',
      '---\nstatus: Draft\n---\n',
      '---\nstatus: Draft\n---',
      '---\nsynopsis: "has ``` and ```` inside"\n---\nText with ```\ncode\n```\n',
      '```yaml\nlooks: like a block\n```\nbut is the text of a scene with no properties\n',
      '---\nnever closed\nso it is text\n',
      'Line one.\r\nLine two.\r\n',
      '\n\n  Leading blank lines and spaces are text too.  \n\n',
    ];
    for (const scene of scenes) {
      const read = readSnapshotText(`---\nspellbook-snapshot: 1\n---\n${snapshotBody(scene)}`);
      const parts = splitNote(scene);
      expect(read.body, JSON.stringify(scene)).toBe(parts.body);
      expect(read.yaml, JSON.stringify(scene)).toBe(parts.yaml === '' ? null : parts.yaml);
      expect(parts.head + parts.body).toBe(scene);
    }
  });

  it('is read as plain text when the block was taken out or broken by hand', () => {
    expect(readSnapshotText('---\nspellbook-snapshot: 1\n---\nJust text.\n')).toEqual({ yaml: null, body: 'Just text.\n' });
    expect(readSnapshotText('```yaml\nstatus: Draft\nnever closed\n')).toEqual({ yaml: null, body: '```yaml\nstatus: Draft\nnever closed\n' });
  });
});

describe('what a scene reads after a restore', () => {
  const snapshot = readSnapshotText(`---\nspellbook-snapshot: 1\n---\n${snapshotBody(SCENE)}`);
  const current = '---\nsynopsis: Anna leaves.\nstatus: Final\nlabel: Red\n---\nA newer text.\n';

  it('keeps the properties it has now, and takes the text of the snapshot', () => {
    expect(restoredText(current, snapshot, false)).toBe('---\nsynopsis: Anna leaves.\nstatus: Final\nlabel: Red\n---\n# פרק ראשון\n\nשלום לך אחותי.\n');
    // A scene with no properties stays without.
    expect(restoredText('A newer text.\n', snapshot, false)).toBe('# פרק ראשון\n\nשלום לך אחותי.\n');
    // A properties block that ends the file gets its line break.
    expect(restoredText('---\nstatus: Final\n---', snapshot, false)).toBe('---\nstatus: Final\n---\n# פרק ראשון\n\nשלום לך אחותי.\n');
  });

  it('takes the properties of the time too, when asked', () => {
    expect(restoredText(current, snapshot, true)).toBe(SCENE);
    expect(restoredText(current, { yaml: null, body: 'Only text.\n' }, true)).toBe('Only text.\n');
  });
});

describe('which snapshots are a scene\'s', () => {
  const mine = info({ path: 'Snapshots/Opening - abc/1.md', takenAt: 1000 });
  const newer = info({ path: 'Snapshots/Opening - abc/2.md', takenAt: 3000, name: 'Draft 2' });
  const other = info({ path: 'Snapshots/Closing - xyz/1.md', sceneId: 'xyz', scenePath: 'Manuscript/Closing.md', takenAt: 2000 });

  it('goes by the scene\'s id, whatever the scene is called by now; newest first', () => {
    const renamed = { id: 'abc', path: 'Manuscript/A new name.md' };
    expect(snapshotsOf([mine, other, newer], renamed).map((each) => each.path)).toEqual([newer.path, mine.path]);
    expect(belongsTo(other, renamed)).toBe(false);
    // Another scene that now has the old path does not inherit them.
    expect(snapshotsOf([mine, other, newer], { id: 'new', path: 'Manuscript/Opening.md' })).toEqual([]);
  });

  it('goes by the path for a scene that has no id', () => {
    expect(snapshotsOf([mine, other, newer], { id: null, path: 'Manuscript/Opening.md' }).map((each) => each.path)).toEqual([newer.path, mine.path]);
    expect(snapshotsOf([mine, other, newer], { id: null, path: 'Manuscript/Elsewhere.md' })).toEqual([]);
  });

  it('lists a snapshot once when a sync service left a second copy of it', () => {
    const copy = { ...newer, path: 'Snapshots/Opening - abc/2 2.md' };
    const conflicted = { ...newer, path: 'Snapshots/Opening - abc/2 (conflicted copy).md' };
    expect(snapshotsOf([copy, mine, conflicted, newer], { id: 'abc', path: 'x.md' }).map((each) => each.path)).toEqual([newer.path, mine.path]);
    // Two snapshots whose moment is unknown are two snapshots.
    const a = info({ path: 'a.md', takenAt: 0 });
    const b = info({ path: 'b.md', takenAt: 0 });
    expect(snapshotsOf([a, b], { id: 'abc', path: 'x.md' })).toHaveLength(2);
  });

  it('removes automatic snapshots beyond the newest few, and never one the writer took', () => {
    const automatic = [1, 2, 3, 4, 5].map((at) => info({ path: `auto ${at}.md`, takenAt: at * 1000, automatic: true }));
    const named = [1, 2, 3].map((at) => info({ path: `named ${at}.md`, takenAt: at * 100, name: 'Mine' }));
    const copy = { ...(automatic[4] as SnapshotInfo), path: 'auto 5 2.md' };
    const oldCopy = { ...(automatic[0] as SnapshotInfo), path: 'auto 1 2.md' };
    const all = [...named, ...automatic, copy, oldCopy];
    expect(automaticToRemove(all, 2).map((each) => each.path).sort()).toEqual(['auto 1 2.md', 'auto 1.md', 'auto 2.md', 'auto 3.md']);
    expect(automaticToRemove(all, 5)).toEqual([]);
    expect(automaticToRemove(all, 0).map((each) => each.path)).not.toContain('auto 5.md'); // at least one is always kept
    expect(automaticToRemove(named, 1)).toEqual([]);
  });
});

describe('one column or two', () => {
  it('goes by the measured width, with a little room between the two limits', () => {
    expect(isNarrowPane(390, false)).toBe(true);
    expect(isNarrowPane(1000, true)).toBe(false);
    expect(isNarrowPane(ONE_COLUMN_BELOW, false)).toBe(false);
    expect(isNarrowPane(ONE_COLUMN_BELOW - 1, false)).toBe(true);
    expect(isNarrowPane(TWO_COLUMNS_FROM - 1, true)).toBe(true);
    expect(isNarrowPane(TWO_COLUMNS_FROM, true)).toBe(false);
    // A hidden pane keeps what it had.
    expect(isNarrowPane(0, true)).toBe(true);
    expect(isNarrowPane(0, false)).toBe(false);
  });
});
