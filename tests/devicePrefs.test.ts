// What a device remembers for itself: the project that was chosen and what
// was folded shut in the binder.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_PROJECT_KEY, COLLAPSED_KEY, DevicePrefs } from '../src/core/devicePrefs';
import type { DeviceStorage } from '../src/core/devicePrefs';
import { MemoryDeviceStorage, foldedIn } from './storeHarness';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the chosen project', () => {
  it('is nothing on a device that has never chosen', () => {
    expect(new DevicePrefs(new MemoryDeviceStorage()).getActiveProject()).toBeNull();
  });

  it('is remembered, also after Obsidian is closed and opened again', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setActiveProject('Novel/Novel.md');
    expect(prefs.getActiveProject()).toBe('Novel/Novel.md');
    expect(new DevicePrefs(storage).getActiveProject()).toBe('Novel/Novel.md');

    prefs.setActiveProject('הרומן שלי/הרומן שלי.md');
    expect(new DevicePrefs(storage).getActiveProject()).toBe('הרומן שלי/הרומן שלי.md');
  });

  it('can be cleared', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setActiveProject('Novel/Novel.md');
    prefs.setActiveProject(null);
    expect(prefs.getActiveProject()).toBeNull();
    expect(storage.values.has(ACTIVE_PROJECT_KEY)).toBe(false);
  });

  it('saves only when the choice changes', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setActiveProject('Novel/Novel.md');
    prefs.setActiveProject('Novel/Novel.md');
    prefs.setActiveProject('Novel/Novel.md');
    expect(storage.saves).toEqual([[ACTIVE_PROJECT_KEY, 'Novel/Novel.md']]);
  });

  it('ignores anything in the storage that is not a path', () => {
    for (const junk of [42, true, '', ['Novel/Novel.md'], { path: 'Novel/Novel.md' }]) {
      const storage = new MemoryDeviceStorage();
      storage.values.set(ACTIVE_PROJECT_KEY, JSON.stringify(junk));
      expect(new DevicePrefs(storage).getActiveProject(), JSON.stringify(junk)).toBeNull();
    }
  });
});

describe('what is folded shut', () => {
  it('is nothing to begin with', () => {
    const prefs = new DevicePrefs(new MemoryDeviceStorage());
    expect(prefs.isCollapsed('Novel/Novel.md', 'folder:f-1')).toBe(false);
  });

  it('goes along with a project whose index note is at another path now', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setCollapsed('Novel/Novel.md', 'folder:f-1', true);
    prefs.setCollapsed('Novel/Novel.md', 'section:research', true);
    prefs.setCollapsed('Other/Other.md', 'folder:f-2', true);
    storage.saves.length = 0;

    prefs.moveCollapsed('Novel/Novel.md', 'My Novel/Novel.md');
    expect(prefs.isCollapsed('My Novel/Novel.md', 'folder:f-1')).toBe(true);
    expect(prefs.isCollapsed('My Novel/Novel.md', 'section:research')).toBe(true);
    expect(prefs.isCollapsed('Novel/Novel.md', 'folder:f-1')).toBe(false); // nothing is left under the old path
    expect(foldedIn(storage)).toEqual({
      'Other/Other.md': ['folder:f-2'],
      'My Novel/Novel.md': ['folder:f-1', 'section:research'],
    });
    expect(storage.saves).toHaveLength(1);
    // It is there after a restart as well.
    expect(new DevicePrefs(storage).isCollapsed('My Novel/Novel.md', 'folder:f-1')).toBe(true);

    // Nothing to move, or nowhere to move it: nothing is saved.
    prefs.moveCollapsed('Nowhere/Nowhere.md', 'Somewhere/Somewhere.md');
    prefs.moveCollapsed('Other/Other.md', 'Other/Other.md');
    expect(storage.saves).toHaveLength(1);
  });

  it('is remembered per project and per item, also after a restart', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setCollapsed('Novel/Novel.md', 'folder:f-1', true);
    prefs.setCollapsed('Novel/Novel.md', 'section:research', true);
    prefs.setCollapsed('Other/Other.md', 'folder:f-2', true);

    const later = new DevicePrefs(storage);
    expect(later.isCollapsed('Novel/Novel.md', 'folder:f-1')).toBe(true);
    expect(later.isCollapsed('Novel/Novel.md', 'section:research')).toBe(true);
    expect(later.isCollapsed('Novel/Novel.md', 'folder:f-2')).toBe(false); // that one belongs to the other project
    expect(later.isCollapsed('Other/Other.md', 'folder:f-2')).toBe(true);
    expect(later.isCollapsed('Other/Other.md', 'folder:f-1')).toBe(false);
  });

  it('is forgotten again when the item is opened', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setCollapsed('Novel/Novel.md', 'folder:f-1', true);
    prefs.setCollapsed('Novel/Novel.md', 'folder:f-2', true);
    prefs.setCollapsed('Novel/Novel.md', 'folder:f-1', false);
    expect(prefs.isCollapsed('Novel/Novel.md', 'folder:f-1')).toBe(false);
    expect(foldedIn(storage)).toEqual({ 'Novel/Novel.md': ['folder:f-2'] });

    prefs.setCollapsed('Novel/Novel.md', 'folder:f-2', false);
    expect(storage.values.has(COLLAPSED_KEY)).toBe(false); // nothing left to remember
    expect(foldedIn(storage)).toBeNull();
  });

  it('is saved as text, and read back whether the storage hands back text or an object', () => {
    const storage = new MemoryDeviceStorage();
    new DevicePrefs(storage).setCollapsed('Novel/Novel.md', 'folder:f-1', true);
    expect(typeof storage.load(COLLAPSED_KEY)).toBe('string');
    expect(new DevicePrefs(storage).isCollapsed('Novel/Novel.md', 'folder:f-1')).toBe(true);

    const other = new MemoryDeviceStorage();
    other.values.set(COLLAPSED_KEY, JSON.stringify({ 'Novel/Novel.md': ['folder:f-1'] })); // an object, not text
    expect(new DevicePrefs(other).isCollapsed('Novel/Novel.md', 'folder:f-1')).toBe(true);
  });

  it('saves only when something changes', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setCollapsed('Novel/Novel.md', 'folder:f-1', false); // was already open
    expect(storage.saves).toEqual([]);
    prefs.setCollapsed('Novel/Novel.md', 'folder:f-1', true);
    prefs.setCollapsed('Novel/Novel.md', 'folder:f-1', true);
    expect(storage.saves).toHaveLength(1);
  });

  it('ignores anything in the storage that it does not understand', () => {
    const storage = new MemoryDeviceStorage();
    storage.values.set(
      COLLAPSED_KEY,
      JSON.stringify({
        'Novel/Novel.md': ['folder:f-1', 7, null, { id: 'f-2' }, 'folder:f-3'],
        'Bad/Bad.md': 'folder:f-9',
        'Empty/Empty.md': [],
      }),
    );
    const prefs = new DevicePrefs(storage);
    expect(prefs.isCollapsed('Novel/Novel.md', 'folder:f-1')).toBe(true);
    expect(prefs.isCollapsed('Novel/Novel.md', 'folder:f-3')).toBe(true);
    expect(prefs.isCollapsed('Bad/Bad.md', 'folder:f-9')).toBe(false);

    for (const junk of [null, 3, 'folded', '{"Novel/Novel.md":', '["folder:f-1"]', ['folder:f-1']]) {
      const other = new MemoryDeviceStorage();
      other.values.set(COLLAPSED_KEY, JSON.stringify(junk));
      expect(new DevicePrefs(other).isCollapsed('Novel/Novel.md', 'folder:f-1'), JSON.stringify(junk)).toBe(false);
    }
  });

  it('copes with a project whose path looks like a built-in name', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    prefs.setCollapsed('__proto__', 'folder:f-1', true);
    prefs.setCollapsed('constructor', 'folder:f-2', true);
    const later = new DevicePrefs(storage);
    expect(later.isCollapsed('__proto__', 'folder:f-1')).toBe(true);
    expect(later.isCollapsed('constructor', 'folder:f-2')).toBe(true);
    expect(later.isCollapsed('toString', 'folder:f-1')).toBe(false);
    expect(({} as Record<string, unknown>)['folder:f-1']).toBeUndefined(); // nothing leaked onto every object
  });

  it('does not grow without end', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new DevicePrefs(storage);
    for (let n = 0; n < 1100; n++) prefs.setCollapsed('Novel/Novel.md', `folder:f-${n}`, true);
    expect(prefs.isCollapsed('Novel/Novel.md', 'folder:f-0')).toBe(false); // the oldest went
    expect(prefs.isCollapsed('Novel/Novel.md', 'folder:f-1099')).toBe(true);
    expect(foldedIn(storage)?.['Novel/Novel.md']).toHaveLength(1000);

    for (let n = 0; n < 60; n++) prefs.setCollapsed(`P${n}/P${n}.md`, 'folder:f-1', true);
    expect(Object.keys(foldedIn(storage) ?? {})).toHaveLength(40);
    expect(prefs.isCollapsed('P59/P59.md', 'folder:f-1')).toBe(true); // the newest is kept
  });
});

describe('a storage that keeps nothing but plain text', () => {
  it('is enough: everything is remembered through it', () => {
    // Whether Obsidian's storage keeps values as they are or as text is not
    // documented, so the plugin only ever hands it text.
    const kept = new Map<string, string>();
    const raw: DeviceStorage = {
      load: (key) => kept.get(key) ?? null,
      save: (key, value) => {
        if (value === null) kept.delete(key);
        else kept.set(key, String(value));
      },
    };
    const prefs = new DevicePrefs(raw);
    prefs.setActiveProject('הרומן שלי/הרומן שלי.md');
    prefs.setCollapsed('הרומן שלי/הרומן שלי.md', 'folder:f-1', true);
    prefs.setCollapsed('הרומן שלי/הרומן שלי.md', 'research:Research/מפות', true);
    expect([...kept.values()].every((value) => !value.includes('[object'))).toBe(true);

    const later = new DevicePrefs(raw);
    expect(later.getActiveProject()).toBe('הרומן שלי/הרומן שלי.md');
    expect(later.isCollapsed('הרומן שלי/הרומן שלי.md', 'folder:f-1')).toBe(true);
    expect(later.isCollapsed('הרומן שלי/הרומן שלי.md', 'research:Research/מפות')).toBe(true);
  });
});

describe('a storage that does not work', () => {
  it('is survived: choices last until Obsidian closes', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = new MemoryDeviceStorage();
    storage.broken = true;
    const prefs = new DevicePrefs(storage);

    expect(prefs.getActiveProject()).toBeNull();
    prefs.setActiveProject('Novel/Novel.md');
    expect(prefs.getActiveProject()).toBe('Novel/Novel.md');

    expect(prefs.isCollapsed('Novel/Novel.md', 'folder:f-1')).toBe(false);
    prefs.setCollapsed('Novel/Novel.md', 'folder:f-1', true);
    expect(prefs.isCollapsed('Novel/Novel.md', 'folder:f-1')).toBe(true);
    expect(logged).toHaveBeenCalled();
  });
});
