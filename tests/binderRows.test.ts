// The calculations behind editing the binder: finding a row, where new things
// go, where something can be moved to, which row is selected, whether a typed
// name will do, and folding everything at once.

import { describe, expect, it } from 'vitest';
import {
  TOP_LEVEL_LABEL,
  canStep,
  findNode,
  foldKey,
  folderChoices,
  folderFoldKeys,
  nodeTitle,
  owningProject,
  placeOfNote,
  placementForNewFolder,
  placementForNewScene,
  rowKey,
  sceneCount,
} from '../src/core/binderModel';
import { BinderSelection } from '../src/core/binderSelection';
import { folderRef, sceneRef } from '../src/core/binderTree';
import { DevicePrefs } from '../src/core/devicePrefs';
import { MAX_NAME_BYTES, checkFolderName, checkSceneName } from '../src/core/names';
import type { TreeNode } from '../src/core/types';
import { MemoryDeviceStorage, foldedIn } from './storeHarness';

function scene(name: string, missing = false): TreeNode {
  return { kind: 'scene', path: `Manuscript/${name}.md`, title: name, missing };
}

function folder(id: string, name: string, children: TreeNode[] = []): TreeNode {
  return { kind: 'folder', id, name, children };
}

/**
 * Opening
 * Part one (f-one) [ The Letter, Chapter (f-inner) [ Night Train ], Ghost? ]
 * Ending
 * חלק שני (f-two) [ ]
 */
function tree(): TreeNode[] {
  return [
    scene('Opening'),
    folder('f-one', 'Part one', [scene('The Letter'), folder('f-inner', 'Chapter', [scene('Night Train')]), scene('Ghost', true)]),
    scene('Ending'),
    folder('f-two', 'חלק שני'),
  ];
}

const at = (name: string) => sceneRef(`Manuscript/${name}.md`);

describe('rowKey', () => {
  it('tells notes and folders apart, and one note from another', () => {
    expect(rowKey(at('Opening'))).toBe('scene:Manuscript/Opening.md');
    expect(rowKey(folderRef('f-one'))).toBe('folder:f-one');
    expect(rowKey(at('Opening'))).not.toBe(rowKey(at('Ending')));
    // A folder cannot be mistaken for a note, whatever its id.
    expect(rowKey(folderRef('Manuscript/Opening.md'))).not.toBe(rowKey(at('Opening')));
  });

  it('gives one key to two spellings of the same pointed or accented name', () => {
    const composed = 'Manuscript/Café שָׁלוֹם.md'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    expect(composed).not.toBe(decomposed);
    expect(rowKey(sceneRef(composed))).toBe(rowKey(sceneRef(decomposed)));
  });
});

describe('findNode, nodeTitle and sceneCount', () => {
  it('finds scenes and folders at any depth', () => {
    expect(findNode(tree(), at('Night Train'))).toMatchObject({ kind: 'scene', title: 'Night Train' });
    expect(findNode(tree(), folderRef('f-inner'))).toMatchObject({ kind: 'folder', name: 'Chapter' });
    expect(findNode(tree(), at('Nowhere'))).toBeNull();
    expect(findNode(tree(), folderRef('f-nope'))).toBeNull();
    expect(findNode([], at('Opening'))).toBeNull();
  });

  it('names a scene by its title and a folder by its name', () => {
    expect(nodeTitle(scene('Opening'))).toBe('Opening');
    expect(nodeTitle(folder('f-two', 'חלק שני'))).toBe('חלק שני');
  });

  it('counts the scenes an entry stands for', () => {
    expect(sceneCount(scene('Opening'))).toBe(1);
    expect(sceneCount(findNode(tree(), folderRef('f-one')) as TreeNode)).toBe(3); // the missing one counts: it is an entry
    expect(sceneCount(folder('f-two', 'Empty'))).toBe(0);
  });
});

describe('canStep', () => {
  it('is false only at the two ends of the top level, and for what is not in the binder', () => {
    expect(canStep(tree(), at('Opening'), 'up')).toBe(false);
    expect(canStep(tree(), at('Opening'), 'down')).toBe(true);
    expect(canStep(tree(), folderRef('f-two'), 'down')).toBe(false);
    expect(canStep(tree(), folderRef('f-two'), 'up')).toBe(true);
    // At the edge of a folder there is still somewhere to go: out of it.
    expect(canStep(tree(), at('The Letter'), 'up')).toBe(true);
    expect(canStep(tree(), at('Ghost'), 'down')).toBe(true);
    expect(canStep(tree(), at('Night Train'), 'up')).toBe(true);
    expect(canStep(tree(), at('Night Train'), 'down')).toBe(true);
    expect(canStep(tree(), at('Loose'), 'up')).toBe(false);
  });
});

describe('where a new scene goes', () => {
  it('goes below the chosen scene', () => {
    expect(placementForNewScene(tree(), at('The Letter'))).toEqual({ at: 'after', sibling: at('The Letter') });
    // Also below a missing entry: it is a place in the binder like any other.
    expect(placementForNewScene(tree(), at('Ghost'))).toEqual({ at: 'after', sibling: at('Ghost') });
  });

  it('goes inside the chosen folder, at its end', () => {
    expect(placementForNewScene(tree(), folderRef('f-one'))).toEqual({ at: 'end', parentId: 'f-one' });
    expect(placementForNewScene(tree(), folderRef('f-two'))).toEqual({ at: 'end', parentId: 'f-two' });
  });

  it('goes to the end of the binder when nothing in the binder is chosen', () => {
    const end = { at: 'end', parentId: null };
    expect(placementForNewScene(tree(), null)).toEqual(end);
    expect(placementForNewScene(tree(), sceneRef('Research/Trains.md'))).toEqual(end); // a research note
    expect(placementForNewScene(tree(), folderRef('f-gone'))).toEqual(end);
    expect(placementForNewScene([], at('Opening'))).toEqual(end);
  });

  it('refers to the chosen scene by the spelling the binder uses', () => {
    const composed = 'Manuscript/Café.md'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    const binder: TreeNode[] = [{ kind: 'scene', path: composed, title: 'Café', missing: false }];
    expect(placementForNewScene(binder, sceneRef(decomposed))).toEqual({ at: 'after', sibling: sceneRef(composed) });
  });
});

describe('where a new folder goes', () => {
  it('goes straight below the chosen entry, at the same level', () => {
    expect(placementForNewFolder(tree(), at('The Letter'))).toEqual({ at: 'after', sibling: at('The Letter') });
    // Below a folder, not inside it: "New folder inside" is the way to nest.
    expect(placementForNewFolder(tree(), folderRef('f-one'))).toEqual({ at: 'after', sibling: folderRef('f-one') });
  });

  it('goes to the end of the binder when nothing in the binder is chosen', () => {
    expect(placementForNewFolder(tree(), null)).toEqual({ at: 'end', parentId: null });
    expect(placementForNewFolder(tree(), sceneRef('Manuscript/Loose.md'))).toEqual({ at: 'end', parentId: null });
  });
});

describe('where something can be moved to', () => {
  const labels = (ref: Parameters<typeof folderChoices>[1]): string[] => folderChoices(tree(), ref).map((choice) => choice.label);

  it('offers the top level and every folder, each with the folders around it', () => {
    expect(folderChoices(tree(), at('Night Train'))).toEqual([
      { parentId: null, label: TOP_LEVEL_LABEL },
      { parentId: 'f-one', label: 'Part one' },
      { parentId: 'f-inner', label: 'Part one / Chapter' },
      { parentId: 'f-two', label: 'חלק שני' },
    ]);
    expect(TOP_LEVEL_LABEL).toBe('Top level');
  });

  it('offers the same list for every scene, wherever it is: its own place too (picking it sends it to the end)', () => {
    const all = ['Top level', 'Part one', 'Part one / Chapter', 'חלק שני'];
    expect(labels(at('Opening'))).toEqual(all);
    expect(labels(at('The Letter'))).toEqual(all);
    expect(labels(at('Ghost'))).toEqual(all); // a missing entry can be moved like any other
  });

  it('never offers a folder itself, or anything inside it, as a place for that folder', () => {
    expect(labels(folderRef('f-one'))).toEqual(['Top level', 'חלק שני']);
    expect(labels(folderRef('f-inner'))).toEqual(['Top level', 'Part one', 'חלק שני']);
    expect(labels(folderRef('f-two'))).toEqual(['Top level', 'Part one', 'Part one / Chapter']);
  });

  it('always offers the top level, and nothing at all for something that is not in the binder', () => {
    expect(labels(at('Loose'))).toEqual([]);
    expect(folderChoices([scene('Only')], at('Only'))).toEqual([{ parentId: null, label: 'Top level' }]);
    expect(folderChoices([folder('f-1', 'Alone')], folderRef('f-1'))).toEqual([{ parentId: null, label: 'Top level' }]);
    expect(folderChoices([], at('Only'))).toEqual([]);
  });
});

describe('where a note has a row', () => {
  const project = {
    tree: tree(),
    unfiled: ['Manuscript/Loose.md'],
    research: ['Research/Trains.md', 'Research/Maps/City.md'],
  };

  it('tells the binder, Unfiled and Research apart', () => {
    expect(placeOfNote(project, 'Manuscript/Night Train.md')).toBe('binder');
    expect(placeOfNote(project, 'Manuscript/Ghost.md')).toBe('binder'); // a missing entry is still a row
    expect(placeOfNote(project, 'Manuscript/Loose.md')).toBe('unfiled');
    expect(placeOfNote(project, 'Research/Maps/City.md')).toBe('research');
  });

  it('is nowhere for the project\'s other notes', () => {
    expect(placeOfNote(project, 'To-do.md')).toBeNull();
    expect(placeOfNote(project, 'Novel.md')).toBeNull();
    expect(placeOfNote(project, 'Timeline/Event.md')).toBeNull();
  });

  it('does not mind which Unicode form a name is in', () => {
    const composed = 'Manuscript/Café.md'.normalize('NFC');
    expect(placeOfNote({ tree: [], unfiled: [composed], research: [] }, composed.normalize('NFD'))).toBe('unfiled');
  });
});

describe('which project a file belongs to', () => {
  const projects = [
    { folder: 'Novel', title: 'Novel' },
    { folder: 'Writing/Drafts/Second', title: 'Second' },
  ];

  it('is the project whose folder holds the file', () => {
    expect(owningProject(projects, 'Novel/Manuscript/Opening.md')?.title).toBe('Novel');
    expect(owningProject(projects, 'Writing/Drafts/Second/Research/Maps/City.md')?.title).toBe('Second');
  });

  it('is none for a file outside every project', () => {
    expect(owningProject(projects, 'Notes/Plain.md')).toBeNull();
    expect(owningProject(projects, 'Novel.md')).toBeNull(); // a note beside the folder, not in it
    expect(owningProject(projects, 'Novelties/Other.md')).toBeNull(); // a folder that only starts the same
    expect(owningProject([], 'Novel/Manuscript/Opening.md')).toBeNull();
  });

  it('is the innermost project when one sits at the top of the vault', () => {
    const withRoot = [{ folder: '', title: 'Whole vault' }, ...projects];
    expect(owningProject(withRoot, 'Novel/Manuscript/Opening.md')?.title).toBe('Novel');
    expect(owningProject(withRoot, 'Notes/Plain.md')?.title).toBe('Whole vault');
  });
});

describe('the names of everything that can be folded by "Collapse all"', () => {
  it('lists the binder\'s folders and the sub-folders of Research, not the sections', () => {
    const keys = folderFoldKeys(tree(), ['Research/Trains.md', 'Research/Maps/City.md', 'Research/Maps/Old/Harbour.md']);
    expect(keys).toEqual([
      foldKey.folder('f-one'),
      foldKey.folder('f-inner'),
      foldKey.folder('f-two'),
      foldKey.research('Research/Maps'),
      foldKey.research('Research/Maps/Old'),
    ]);
    expect(keys.some((key) => key.startsWith('section:'))).toBe(false);
  });

  it('is empty for a project without folders', () => {
    expect(folderFoldKeys([scene('Opening')], ['Research/Trains.md'])).toEqual([]);
  });
});

describe('BinderSelection', () => {
  const NOVEL = 'Novel/Novel.md';
  const OTHER = 'Other/Other.md';

  function watched(): { selection: BinderSelection; told: () => number } {
    const selection = new BinderSelection();
    let count = 0;
    selection.onChange(() => count++);
    return { selection, told: () => count };
  }

  it('starts with nothing selected', () => {
    const selection = new BinderSelection();
    expect(selection.currentIn(NOVEL)).toBeNull();
    expect(selection.revealCount).toBe(0);
  });

  it('remembers the selected row and tells its listeners', () => {
    const { selection, told } = watched();
    selection.select(NOVEL, at('Opening'));
    expect(selection.currentIn(NOVEL)).toEqual(at('Opening'));
    expect(told()).toBe(1);
    selection.select(NOVEL, folderRef('f-one'));
    expect(selection.currentIn(NOVEL)).toEqual(folderRef('f-one'));
    expect(told()).toBe(2);
  });

  it('says nothing when the same row is selected again', () => {
    const { selection, told } = watched();
    selection.select(NOVEL, at('Opening'));
    selection.select(NOVEL, at('Opening'));
    selection.select(NOVEL, sceneRef('Manuscript/Opening.md'.normalize('NFD'))); // the same note, spelled another way
    expect(told()).toBe(1);
    expect(selection.revealCount).toBe(0);
  });

  it('counts each request to bring the row into view, also for the row that is already selected', () => {
    const { selection, told } = watched();
    selection.select(NOVEL, at('Opening'), { reveal: true });
    selection.select(NOVEL, at('Opening'), { reveal: true });
    expect(selection.revealCount).toBe(2);
    expect(told()).toBe(2);
    selection.select(NOVEL, at('Ending'));
    expect(selection.revealCount).toBe(2); // a plain selection asks for nothing
  });

  it('belongs to one project: another project sees nothing selected', () => {
    const { selection } = watched();
    selection.select(NOVEL, at('Opening'));
    expect(selection.currentIn(OTHER)).toBeNull(); // the other project may have an "Opening" too
    selection.select(OTHER, at('Elsewhere'));
    expect(selection.currentIn(OTHER)).toEqual(at('Elsewhere'));
    expect(selection.currentIn(NOVEL)).toBeNull();
  });

  it('can be cleared, and there is nothing to bring into view then', () => {
    const { selection, told } = watched();
    selection.select(NOVEL, at('Opening'));
    selection.select(NOVEL, null, { reveal: true });
    expect(selection.currentIn(NOVEL)).toBeNull();
    expect(selection.revealCount).toBe(0);
    expect(told()).toBe(2);
    selection.select(NOVEL, null);
    expect(told()).toBe(2);
  });

  it('drops the selection only when it is the row that went away', () => {
    const { selection, told } = watched();
    selection.select(NOVEL, at('Opening'));
    selection.drop(NOVEL, at('Ending'));
    selection.drop(OTHER, at('Opening'));
    expect(selection.currentIn(NOVEL)).toEqual(at('Opening'));
    expect(told()).toBe(1);
    selection.drop(NOVEL, at('Opening'));
    expect(selection.currentIn(NOVEL)).toBeNull();
    expect(told()).toBe(2);
  });

  it('stops telling a listener that asked to stop, and survives one that fails', () => {
    const selection = new BinderSelection();
    let first = 0;
    let second = 0;
    const stop = selection.onChange(() => {
      first++;
      throw new Error('this listener is broken');
    });
    selection.onChange(() => second++);
    const quiet = console.error;
    console.error = (): void => {};
    try {
      selection.select(NOVEL, at('Opening'));
    } finally {
      console.error = quiet;
    }
    expect([first, second]).toEqual([1, 1]);
    stop();
    selection.select(NOVEL, at('Ending'));
    expect([first, second]).toEqual([1, 2]);

    selection.dispose();
    selection.select(NOVEL, at('Opening'));
    expect(second).toBe(2);
  });
});

describe('checking a name typed for a scene', () => {
  it('accepts an ordinary title, in any language', () => {
    expect(checkSceneName('The Letter')).toEqual({ ok: true, name: 'The Letter' });
    expect(checkSceneName('מכתב לאחותי')).toEqual({ ok: true, name: 'מכתב לאחותי' });
    expect(checkSceneName('  Night   Train ')).toEqual({ ok: true, name: 'Night Train' });
  });

  it('takes out what a file name cannot hold', () => {
    expect(checkSceneName('Chapter 1: "Fire"?')).toEqual({ ok: true, name: 'Chapter 1 Fire' });
    expect(checkSceneName('Either/Or [draft] #2')).toEqual({ ok: true, name: 'Either Or draft 2' });
    expect(checkSceneName('.hidden.')).toEqual({ ok: true, name: 'hidden' });
  });

  it('turns down an empty name, with a message to show', () => {
    for (const empty of ['', '   ', '\t', '\n']) {
      expect(checkSceneName(empty), JSON.stringify(empty)).toEqual({ ok: false, message: 'Give the scene a name.' });
    }
  });

  it('turns down a name of which nothing is left, saying why', () => {
    for (const hopeless of ['???', '/', '...', '#^[]', ': :']) {
      const result = checkSceneName(hopeless);
      expect(result.ok, hopeless).toBe(false);
      expect(result.ok === false && result.message, hopeless).toMatch(/no characters that can be used in a file name/);
    }
  });

  it('cuts a very long name down to what a file system takes', () => {
    const result = checkSceneName('ש'.repeat(500));
    expect(result.ok).toBe(true);
    expect(result.ok && new TextEncoder().encode(result.name).length).toBeLessThanOrEqual(MAX_NAME_BYTES);
  });
});

describe('checking a name typed for a folder', () => {
  it('accepts any text, tidied, including what a file name could not hold', () => {
    expect(checkFolderName('Part one')).toEqual({ ok: true, name: 'Part one' });
    expect(checkFolderName('  חלק   שני ')).toEqual({ ok: true, name: 'חלק שני' });
    expect(checkFolderName('Act 1: "Fire"?')).toEqual({ ok: true, name: 'Act 1: "Fire"?' });
  });

  it('turns down an empty name, with a message to show', () => {
    const invisible = String.fromCharCode(0x200f, 0x200e); // direction marks only
    for (const empty of ['', '   ', '\n', invisible]) {
      expect(checkFolderName(empty), JSON.stringify(empty)).toEqual({ ok: false, message: 'Give the folder a name.' });
    }
  });
});

describe('folding everything at once', () => {
  const NOVEL = 'Novel/Novel.md';

  it('replaces what was folded in the project, in one save', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setCollapsed(NOVEL, 'folder:f-old', true);
    prefs.setCollapsed('Other/Other.md', 'folder:f-x', true);
    storage.saves.length = 0;

    prefs.setCollapsedItems(NOVEL, ['section:research', 'folder:f-one', 'folder:f-two']);
    expect(storage.saves).toHaveLength(1);
    expect(prefs.isCollapsed(NOVEL, 'folder:f-one')).toBe(true);
    expect(prefs.isCollapsed(NOVEL, 'folder:f-two')).toBe(true);
    expect(prefs.isCollapsed(NOVEL, 'section:research')).toBe(true);
    expect(prefs.isCollapsed(NOVEL, 'folder:f-old')).toBe(false);
    // The other project is left as it was.
    expect(foldedIn(storage)).toEqual({
      'Other/Other.md': ['folder:f-x'],
      [NOVEL]: ['section:research', 'folder:f-one', 'folder:f-two'],
    });
    // And it is still there after Obsidian was closed and opened again.
    expect(new DevicePrefs(storage).isCollapsed(NOVEL, 'folder:f-two')).toBe(true);
  });

  it('unfolds everything when given nothing', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setCollapsedItems(NOVEL, ['folder:f-one', 'folder:f-two']);
    prefs.setCollapsedItems(NOVEL, []);
    expect(prefs.isCollapsed(NOVEL, 'folder:f-one')).toBe(false);
    expect(foldedIn(storage)).toBeNull();
  });

  it('saves nothing when nothing changes', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setCollapsedItems(NOVEL, []);
    expect(storage.saves).toEqual([]);
    prefs.setCollapsedItems(NOVEL, ['folder:f-one', 'folder:f-two']);
    prefs.setCollapsedItems(NOVEL, ['folder:f-two', 'folder:f-one', 'folder:f-one']);
    expect(storage.saves).toHaveLength(1);
  });

  it('carries on when the storage fails', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    storage.broken = true;
    const quiet = console.error;
    console.error = (): void => {};
    try {
      prefs.setCollapsedItems(NOVEL, ['folder:f-one']);
    } finally {
      console.error = quiet;
    }
    expect(prefs.isCollapsed(NOVEL, 'folder:f-one')).toBe(true); // remembered until Obsidian closes
  });
});
