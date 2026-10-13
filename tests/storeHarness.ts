// Shared set-up for the project store tests.

import { ProjectStore } from '../src/core/projectStore';
import type { Frontmatter, IntentResult, ProjectSnapshot, StoreChange, TreeNode } from '../src/core/types';
import { ManualTimers, MemoryVault } from './memoryVault';

export const TODAY = '2026-10-13';

export interface Harness {
  vault: MemoryVault;
  timers: ManualTimers;
  store: ProjectStore;
  /** Every change the store announced, in order. */
  changes: StoreChange[];
}

/** A repeatable stand-in for Math.random. */
export function fixedRandom(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A store on a memory vault, with timers and the date under the test's control. */
export function makeStore(vault: MemoryVault = new MemoryVault()): Harness {
  const timers = new ManualTimers();
  const store = new ProjectStore({ vault, today: () => TODAY, setTimer: timers.set, random: fixedRandom() });
  const changes: StoreChange[] = [];
  store.onChange((change) => changes.push(change));
  store.start();
  // What the store announces while starting up is not interesting to the tests.
  changes.length = 0;
  return { vault, timers, store, changes };
}

export interface SeedOptions {
  /** Project folder (and index note name). Default "Novel". */
  folder?: string;
  title?: string | null;
  /** The binder exactly as it should appear in the index frontmatter. */
  binder?: unknown;
  /** Scene notes to create under Manuscript/: name (without .md) -> order key, or null for no key. */
  scenes?: Record<string, number | null>;
  /** Extra frontmatter keys for the index. */
  extra?: Frontmatter;
}

export const INDEX_BODY = 'Notes about the novel.\n\nThis text belongs to the writer.';

/** The text every seeded scene starts with (so tests can prove it never changes). */
export function sceneBody(name: string): string {
  return `It was a dark and stormy night in ${name}.\n\n%%a private note%%\n`;
}

/** Put a project into the vault before the store looks at it. Returns the index path. */
export function seedProject(vault: MemoryVault, options: SeedOptions = {}): string {
  const folder = options.folder ?? 'Novel';
  const scenes = options.scenes ?? {};
  const indexPath = `${folder}/${folder.split('/').pop()}.md`;
  const frontmatter: Frontmatter = { spellbook: 'project', version: 1 };
  if (options.title !== null) frontmatter['title'] = options.title ?? 'My Novel';
  frontmatter['binder'] = options.binder ?? Object.keys(scenes).map((name) => `Manuscript/${name}.md`);
  Object.assign(frontmatter, options.extra ?? {});
  vault.seed(indexPath, { frontmatter, body: INDEX_BODY });
  vault.seedFolder(`${folder}/Manuscript`);
  for (const [name, order] of Object.entries(scenes)) {
    vault.seed(`${folder}/Manuscript/${name}.md`, {
      frontmatter: order === null ? { status: 'To do' } : { status: 'To do', order },
      body: sceneBody(name),
    });
  }
  return indexPath;
}

/** A store with one seeded project already open. */
export async function openSeeded(options: SeedOptions = {}, vault: MemoryVault = new MemoryVault()): Promise<Harness & { indexPath: string }> {
  const indexPath = seedProject(vault, options);
  const harness = makeStore(vault);
  const opened = await harness.store.openProject(indexPath);
  if (opened.status !== 'done') throw new Error(`could not open the seeded project: ${JSON.stringify(opened)}`);
  harness.changes.length = 0;
  vault.clearWrites();
  return { ...harness, indexPath };
}

/** The open project, or a failed test. */
export function project(store: ProjectStore): ProjectSnapshot {
  const snapshot = store.project;
  if (!snapshot) throw new Error('no project is open');
  return snapshot;
}

/** A compact picture of the binder: "Opening Part one[The Letter Night Train?]" (? = missing). */
export function draw(tree: readonly TreeNode[]): string {
  return tree
    .map((node) =>
      node.kind === 'scene'
        ? `${node.title}${node.missing ? '?' : ''}`
        : `${node.name}[${draw(node.children)}]`,
    )
    .join(' ');
}

export function picture(store: ProjectStore): string {
  return draw(project(store).tree);
}

/** The binder as stored in the index note on disk. */
export function binderOnDisk(vault: MemoryVault, indexPath: string): unknown {
  return vault.frontmatterOf(indexPath)?.['binder'];
}

/** The value of a finished intent, or a failed test that shows what happened instead. */
export function valueOf<T>(result: IntentResult<T>): T {
  if (result.status !== 'done') throw new Error(`expected "done", got ${JSON.stringify(result)}`);
  return result.value;
}

/** Let the store finish everything it has queued, including work started by events. */
export async function settle(store: ProjectStore): Promise<void> {
  await store.idle();
  await Promise.resolve();
  await store.idle();
}
