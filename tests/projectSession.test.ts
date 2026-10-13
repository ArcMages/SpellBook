// The session: which project is open, and what this device remembers of the
// writer's choice.

import { describe, expect, it } from 'vitest';
import { ACTIVE_PROJECT_KEY, DevicePrefs } from '../src/core/devicePrefs';
import { createStarterProject } from '../src/core/newProject';
import { ProjectSession } from '../src/core/projectSession';
import type { ProjectStore } from '../src/core/projectStore';
import { MemoryVault } from './memoryVault';
import { MemoryDeviceStorage, makeStore, quiet, seedProject } from './storeHarness';

const ALPHA = 'Alpha/Alpha.md';
const BETA = 'Beta/Beta.md';
const GAMMA = 'Gamma/Gamma.md';

function twoProjects(): MemoryVault {
  const vault = new MemoryVault();
  seedProject(vault, { folder: 'Alpha', title: 'Alpha', scenes: { One: 1024 } });
  seedProject(vault, { folder: 'Beta', title: 'Beta', scenes: { Two: 1024 } });
  return vault;
}

interface Stage {
  vault: MemoryVault;
  storage: MemoryDeviceStorage;
  store: ProjectStore;
  prefs: DevicePrefs;
  session: ProjectSession;
}

/** A store and a session on a vault, as after Obsidian has started. */
async function begin(vault: MemoryVault, storage: MemoryDeviceStorage = new MemoryDeviceStorage()): Promise<Stage> {
  const { store } = makeStore(vault);
  const prefs = new DevicePrefs(storage);
  const session = new ProjectSession(store, prefs);
  session.start();
  await quiet(store);
  return { vault, storage, store, prefs, session };
}

const openPath = (store: ProjectStore): string | null => store.project?.indexPath ?? null;
const remembered = (storage: MemoryDeviceStorage): unknown => storage.load(ACTIVE_PROJECT_KEY);

describe('which project is opened', () => {
  it('opens nothing in a vault without projects', async () => {
    const { store, session, storage } = await begin(new MemoryVault().seed('Notes/Plain.md'));
    expect(store.project).toBeNull();
    expect(session.problem).toBeNull();
    expect(storage.saves).toEqual([]);
  });

  it('opens the only project, without writing anything or recording a choice', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'Alpha', title: 'Alpha', scenes: { One: 1024 } });
    const { store, storage } = await begin(vault);
    expect(openPath(store)).toBe(ALPHA);
    expect(vault.writes).toEqual([]);
    expect(storage.saves).toEqual([]);
  });

  it('opens the first project in the list when nothing was ever chosen', async () => {
    const { store, storage } = await begin(twoProjects());
    expect(openPath(store)).toBe(ALPHA);
    expect(storage.saves).toEqual([]);
  });

  it('opens the project that was chosen on this device', async () => {
    const storage = new MemoryDeviceStorage();
    storage.save(ACTIVE_PROJECT_KEY, BETA);
    const { store } = await begin(twoProjects(), storage);
    expect(openPath(store)).toBe(BETA);
  });

  it('opens a project that appears in an empty vault', async () => {
    const { store, vault } = await begin(new MemoryVault());
    expect(store.project).toBeNull();
    vault.external.create(ALPHA, { frontmatter: { spellbook: 'project', version: 1, binder: [] } });
    await quiet(store);
    expect(openPath(store)).toBe(ALPHA);
  });
});

describe('choosing a project', () => {
  it('opens it and remembers it, also after Obsidian is closed and opened again', async () => {
    const first = await begin(twoProjects());
    const result = await first.session.choose(BETA);
    expect(result.status).toBe('done');
    expect(openPath(first.store)).toBe(BETA);
    expect(remembered(first.storage)).toBe(BETA);
    expect(first.vault.writes).toEqual([]);

    first.session.dispose();
    first.store.dispose();
    const second = await begin(first.vault, first.storage);
    expect(openPath(second.store)).toBe(BETA);
  });

  it('keeps the old choice when the new one cannot be opened', async () => {
    const { session, store, storage } = await begin(twoProjects());
    await session.choose(BETA);
    const result = await session.choose('Nowhere/Nowhere.md');
    expect(result.status).toBe('refused');
    expect(remembered(storage)).toBe(BETA);
    await quiet(store);
    expect(openPath(store)).toBe(BETA);
  });

  it('remembers a project that was just created as the choice', async () => {
    const { session, store, storage } = await begin(twoProjects());
    const made = await createStarterProject(store, 'Gamma');
    expect(made.status).toBe('done');
    session.remember(GAMMA);
    await quiet(store);
    expect(openPath(store)).toBe(GAMMA);
    expect(remembered(storage)).toBe(GAMMA);
  });
});

describe('when the chosen project is not there', () => {
  it('opens another one as a stand-in and keeps the choice', async () => {
    const storage = new MemoryDeviceStorage();
    storage.save(ACTIVE_PROJECT_KEY, GAMMA);
    const { store } = await begin(twoProjects(), storage);
    expect(openPath(store)).toBe(ALPHA);
    expect(remembered(storage)).toBe(GAMMA); // it may simply not have arrived yet
  });

  it('opens the chosen project in place of the stand-in when it arrives', async () => {
    const storage = new MemoryDeviceStorage();
    storage.save(ACTIVE_PROJECT_KEY, GAMMA);
    const { store, vault } = await begin(twoProjects(), storage);
    expect(openPath(store)).toBe(ALPHA);

    vault.external.create(GAMMA, { frontmatter: { spellbook: 'project', version: 1, title: 'Gamma', binder: [] } });
    await quiet(store);
    expect(openPath(store)).toBe(GAMMA);
    expect(vault.writes).toEqual([]);
  });

  it('finds the chosen project when the vault only learns of its notes one by one', async () => {
    // As on a first start: the files are listed, but nothing is known about them yet.
    const vault = twoProjects();
    vault.forgetIndex();
    const storage = new MemoryDeviceStorage();
    storage.save(ACTIVE_PROJECT_KEY, BETA);
    const { store } = await begin(vault, storage);
    expect(store.project).toBeNull();

    vault.finishIndexing('each-note');
    await quiet(store);
    expect(openPath(store)).toBe(BETA);
    expect(remembered(storage)).toBe(BETA);
  });

  it('leaves the stand-in open when the writer picks it', async () => {
    const storage = new MemoryDeviceStorage();
    storage.save(ACTIVE_PROJECT_KEY, GAMMA);
    const { store, session, vault } = await begin(twoProjects(), storage);
    await session.choose(BETA);

    vault.external.create(GAMMA, { frontmatter: { spellbook: 'project', version: 1, binder: [] } });
    await quiet(store);
    expect(openPath(store)).toBe(BETA);
    expect(remembered(storage)).toBe(BETA);
  });

  it('opens another project when the open one is deleted, and comes back if it returns', async () => {
    const { store, session, vault, storage } = await begin(twoProjects());
    await session.choose(BETA);
    vault.external.delete('Beta');
    await quiet(store);
    expect(openPath(store)).toBe(ALPHA);
    expect(remembered(storage)).toBe(BETA);

    seedProjectLive(vault, BETA);
    await quiet(store);
    expect(openPath(store)).toBe(BETA);
  });

  it('shows nothing when the last project is deleted', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'Alpha', title: 'Alpha' });
    const { store } = await begin(vault);
    vault.external.delete('Alpha');
    await quiet(store);
    expect(store.project).toBeNull();
  });
});

function seedProjectLive(vault: MemoryVault, indexPath: string): void {
  vault.external.create(indexPath, { frontmatter: { spellbook: 'project', version: 1, binder: [] } });
}

describe('when the open project moves', () => {
  it('follows a renamed index note with the choice', async () => {
    const { store, session, vault, storage } = await begin(twoProjects());
    await session.choose(BETA);
    vault.external.rename(BETA, 'Beta/The Book.md');
    await quiet(store);
    expect(openPath(store)).toBe('Beta/The Book.md');
    expect(remembered(storage)).toBe('Beta/The Book.md');
  });

  it('follows a renamed project folder with the choice', async () => {
    const { store, session, vault, storage } = await begin(twoProjects());
    await session.choose(BETA);
    vault.external.rename('Beta', 'Zeta');
    await quiet(store);
    expect(openPath(store)).toBe('Zeta/Beta.md');
    expect(remembered(storage)).toBe('Zeta/Beta.md');

    // After a restart the renamed project is still the one that opens.
    session.dispose();
    store.dispose();
    const again = await begin(vault, storage);
    expect(openPath(again.store)).toBe('Zeta/Beta.md');
  });

  it('does not turn a stand-in into the choice because it was renamed', async () => {
    const storage = new MemoryDeviceStorage();
    storage.save(ACTIVE_PROJECT_KEY, GAMMA);
    const { store, vault } = await begin(twoProjects(), storage);
    vault.external.rename(ALPHA, 'Alpha/Renamed.md');
    await quiet(store);
    expect(openPath(store)).toBe('Alpha/Renamed.md');
    expect(remembered(storage)).toBe(GAMMA);
  });
});

describe('a project that cannot be opened', () => {
  /** The vault still lists the note as a project, but on disk it no longer is one. */
  function spoil(vault: MemoryVault, indexPath: string): void {
    vault.holdMetadata();
    vault.external.write(indexPath, { frontmatter: { title: 'Just a note now' } }, { silent: true });
  }

  it('is passed over for the next one, without trying again and again', async () => {
    const vault = twoProjects();
    spoil(vault, ALPHA);
    const { store, session } = await begin(vault);
    expect(openPath(store)).toBe(BETA);
    expect(session.problem).toBeNull(); // a project is open: nothing to report
    expect(vault.reads.readFrontmatter).toBeLessThan(6);
  });

  it('is reported when there is no other, and tried again when the list of projects changes', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'Alpha', title: 'Alpha' });
    spoil(vault, ALPHA);
    const storage = new MemoryDeviceStorage();
    const { store } = makeStore(vault);
    const session = new ProjectSession(store, new DevicePrefs(storage));
    let told = 0;
    session.onProblem(() => told++);
    session.start();
    await quiet(store);

    expect(store.project).toBeNull();
    expect(session.problem).toMatch(/not a Spellbook project/);
    expect(told).toBe(1);
    const readsSoFar = vault.reads.readFrontmatter;
    await quiet(store);
    expect(vault.reads.readFrontmatter).toBe(readsSoFar); // it gave up; no loop

    // Another project appears: the list changed, so everything is looked at afresh.
    seedProjectLive(vault, BETA);
    vault.releaseMetadata();
    await quiet(store);
    expect(openPath(store)).toBe(BETA);
    expect(session.problem).toBeNull();
    expect(told).toBeGreaterThanOrEqual(2);
  });
});

describe('stopping', () => {
  it('does nothing more once disposed', async () => {
    const { store, session, vault, storage } = await begin(twoProjects());
    session.dispose();
    vault.external.delete('Alpha');
    await quiet(store);
    expect(store.project).toBeNull(); // nobody opened Beta
    session.remember(BETA);
    expect(storage.saves).toEqual([]);
  });

  it('can be started twice without harm', async () => {
    const { store, session } = await begin(twoProjects());
    session.start();
    await quiet(store);
    expect(openPath(store)).toBe(ALPHA);
  });
});
