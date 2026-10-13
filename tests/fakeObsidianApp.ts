// A small imitation of the Obsidian `app` object for testing
// src/obsidian/obsidianVault.ts and the plugin as a whole. It models only
// what the plugin relies on, as documented in obsidian.d.ts:
//
//  - vault events ("create" also fires for every existing file while the
//    vault loads, before the layout is ready),
//  - the metadata cache, which is filled separately from the file list and
//    announces "changed" per note and "resolved" when it has caught up,
//  - fileManager.processFrontMatter, which writes nothing when its callback throws,
//  - the workspace: panes ("leaves") in the two sidebars and the main area,
//    each holding a view made by the view type's registered creator; which
//    note is being worked on, announced as "file-open",
//  - the per-vault storage on the device (loadLocalStorage, saveLocalStorage).
//
// The destructive Vault methods (delete, trash, modify, rename) throw, so a
// test fails loudly if the plugin ever reaches for them instead of the
// FileManager ones.

import { TFile, TFolder, getFrontMatterInfo, parseYaml, stringifyYaml } from 'obsidian';
import type { App, CachedMetadata, TAbstractFile } from 'obsidian';
import { resolveLinkAmong } from './memoryVault';
import { FakeElement } from './obsidianStub';

interface Ref {
  name: string;
  callback: (...args: unknown[]) => unknown;
  /** Where the listener is attached; Obsidian uses this to detach events given to registerEvent. */
  e: FakeEvents;
}

class FakeEvents {
  private readonly refs = new Set<Ref>();

  on(name: string, callback: (...args: never[]) => unknown): Ref {
    const ref: Ref = { name, callback: callback as (...args: unknown[]) => unknown, e: this };
    this.refs.add(ref);
    return ref;
  }

  offref(ref: Ref): void {
    this.refs.delete(ref);
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const ref of [...this.refs]) if (ref.name === name) ref.callback(...args);
  }

  /** How many listeners are attached, for one event or for all. */
  listenerCount(name?: string): number {
    return [...this.refs].filter((ref) => name === undefined || ref.name === name).length;
  }
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '/' : path.slice(0, slash);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

class FakeVault extends FakeEvents {
  readonly root: TFolder;
  readonly entries = new Map<string, TAbstractFile>();
  readonly text = new Map<string, string>();

  constructor(private readonly owner: FakeObsidian) {
    super();
    this.root = new TFolder();
    this.root.path = '/';
    this.entries.set('/', this.root);
  }

  getRoot(): TFolder {
    return this.root;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.entries.get(path) ?? null;
  }

  getFileByPath(path: string): TFile | null {
    const entry = this.entries.get(path);
    return entry instanceof TFile ? entry : null;
  }

  getFolderByPath(path: string): TFolder | null {
    const entry = this.entries.get(path);
    return entry instanceof TFolder ? entry : null;
  }

  getAllFolders(includeRoot = false): TFolder[] {
    return [...this.entries.values()].filter(
      (entry): entry is TFolder => entry instanceof TFolder && (includeRoot || entry !== this.root),
    );
  }

  getFiles(): TFile[] {
    return [...this.entries.values()].filter((entry): entry is TFile => entry instanceof TFile);
  }

  /** An address a file can be shown at. (Obsidian's own leads into the app; the tests only tell files apart.) */
  getResourcePath(file: TFile): string {
    return `app://vault/${file.path}`;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.entries.values()].filter(
      (entry): entry is TFile => entry instanceof TFile && entry.extension === 'md',
    );
  }

  async read(file: TFile): Promise<string> {
    return this.text.get(file.path) ?? '';
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async create(path: string, data: string): Promise<TFile> {
    if (this.entries.has(path)) throw new Error('File already exists.');
    if (!this.getFolderByPath(parentOf(path))) throw new Error(`ENOENT: no such folder, ${parentOf(path)}`);
    const file = this.attachFile(path, data);
    this.trigger('create', file);
    this.owner.metadataCache.index(file);
    return file;
  }

  async createFolder(path: string): Promise<TFolder> {
    if (this.entries.has(path)) throw new Error('Folder already exists.');
    const folder = this.attachFolder(path);
    this.trigger('create', folder);
    return folder;
  }

  /**
   * Read, change and save a file's text in one step. As in Obsidian, nothing
   * is written when the callback throws. Every call is counted, so a test
   * can tell that a file was (or was not) written this way.
   */
  readonly processed: string[] = [];

  async process(file: TFile, change: (data: string) => string): Promise<string> {
    if (!this.entries.has(file.path)) throw new Error(`ENOENT: no such file, ${file.path}`);
    const next = change(this.text.get(file.path) ?? '');
    this.processed.push(file.path);
    this.text.set(file.path, next);
    this.trigger('modify', file);
    this.owner.metadataCache.index(file);
    return next;
  }

  async delete(): Promise<void> {
    throw new Error('vault.delete must never be used: notes go to the trash');
  }

  async trash(): Promise<void> {
    throw new Error('vault.trash must not be used: use fileManager.trashFile');
  }

  async modify(): Promise<void> {
    throw new Error('vault.modify must never be used: a note\'s text is not the plugin\'s to rewrite');
  }

  async rename(): Promise<void> {
    throw new Error('vault.rename must not be used: use fileManager.renameFile so links are updated');
  }

  // --- helpers for building the fake vault

  attachFolder(path: string): TFolder {
    const existing = this.getFolderByPath(path);
    if (existing) return existing;
    const parent = parentOf(path) === '/' ? this.root : this.attachFolder(parentOf(path));
    const folder = new TFolder();
    folder.path = path;
    folder.name = nameOf(path);
    folder.parent = parent;
    parent.children.push(folder);
    this.entries.set(path, folder);
    return folder;
  }

  attachFile(path: string, data: string): TFile {
    const parent = parentOf(path) === '/' ? this.root : this.attachFolder(parentOf(path));
    const file = new TFile();
    file.path = path;
    file.name = nameOf(path);
    const dot = file.name.lastIndexOf('.');
    file.basename = dot < 0 ? file.name : file.name.slice(0, dot);
    file.extension = dot < 0 ? '' : file.name.slice(dot + 1);
    file.parent = parent;
    parent.children.push(file);
    this.entries.set(path, file);
    this.text.set(path, data);
    return file;
  }

  detach(file: TAbstractFile): void {
    this.entries.delete(file.path);
    this.text.delete(file.path);
    if (file.parent) file.parent.children = file.parent.children.filter((child) => child !== file);
  }
}

class FakeMetadataCache extends FakeEvents {
  private readonly cache = new Map<string, CachedMetadata>();

  constructor(private readonly owner: FakeObsidian) {
    super();
  }

  getFileCache(file: TFile): CachedMetadata | null {
    return this.cache.get(file.path) ?? null;
  }

  /** Where a link written in the note at `sourcePath` leads, or null. */
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    const paths = this.owner.vault.getFiles().map((file) => file.path);
    const found = resolveLinkAmong(paths, linkpath, sourcePath);
    return found === null ? null : this.owner.vault.getFileByPath(found);
  }

  private parse(file: TFile): CachedMetadata {
    const text = this.owner.vault.text.get(file.path) ?? '';
    const info = getFrontMatterInfo(text);
    let frontmatter: unknown = null;
    if (info.exists) {
      try {
        frontmatter = parseYaml(info.frontmatter);
      } catch {
        frontmatter = null; // broken YAML: Obsidian caches no frontmatter
      }
    }
    return frontmatter && typeof frontmatter === 'object' ? { frontmatter: frontmatter as Record<string, unknown> } : {};
  }

  /** Index one note and announce it, as Obsidian does after a note changes. */
  index(file: TFile): void {
    if (file.extension !== 'md') return;
    const entry = this.parse(file);
    this.cache.set(file.path, entry);
    this.trigger('changed', file, this.owner.vault.text.get(file.path) ?? '', entry);
  }

  /** Fill the cache for every note without announcing each one (as when it is restored from disk). */
  restoreQuietly(): void {
    for (const file of this.owner.vault.getMarkdownFiles()) this.cache.set(file.path, this.parse(file));
  }

  forget(path: string): void {
    this.cache.delete(path);
  }

  move(from: string, to: string): void {
    const entry = this.cache.get(from);
    this.cache.delete(from);
    if (entry) this.cache.set(to, entry);
  }
}

/** A view as the fake workspace handles it: the stand-in ItemView from tests/obsidianStub.ts. */
interface FakeView {
  getViewType(): string;
  open(): Promise<void>;
  close(): Promise<void>;
}

/** One of the three places a pane can be: a sidebar (a drawer on a phone) or the main area. */
export class FakeSplit {
  collapsed = true;
  /** How often collapse() was called. */
  collapses = 0;

  constructor(readonly name: 'left' | 'right' | 'root') {}

  collapse(): void {
    this.collapsed = true;
    this.collapses++;
  }

  expand(): void {
    this.collapsed = false;
  }
}

/** A pane. It holds one view, created from the type's registered view creator. */
export class FakeLeaf {
  view: FakeView | null = null;
  type = 'empty';
  detached = false;

  constructor(
    private readonly workspace: FakeWorkspace,
    readonly app: unknown,
    readonly split: FakeSplit,
    private readonly noteOpener: NoteOpener['openFile'] | null = null,
  ) {}

  getRoot(): FakeSplit {
    return this.split;
  }

  getViewState(): { type: string } {
    return { type: this.type };
  }

  async setViewState(state: { type: string; active?: boolean }): Promise<void> {
    // A new tab that was only handed out so far takes its place now.
    if (!this.detached && !this.workspace.leaves.includes(this)) this.workspace.leaves.push(this);
    await this.view?.close();
    this.view = null;
    this.type = state.type;
    const creator = this.workspace.viewCreators.get(state.type);
    if (!creator) return; // an unknown type shows nothing, as in Obsidian
    this.view = creator(this) as FakeView;
    await this.view.open();
  }

  /** Show a note in this pane. Only a pane of the main area can (see FakeWorkspace.getLeaf). */
  async openFile(file: TFile, state?: unknown): Promise<void> {
    if (!this.noteOpener) throw new Error('this pane is not one that shows notes');
    await this.noteOpener(file, state);
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    const at = this.workspace.leaves.indexOf(this);
    if (at >= 0) this.workspace.leaves.splice(at, 1);
    void this.view?.close();
    this.view = null;
  }
}

/** What the plugin asks of a pane to show a note in it. */
export interface NoteOpener {
  openFile(file: TFile, state?: unknown): Promise<void>;
}

/** One call to leaf.openFile(), with where the leaf came from. */
export interface OpenCall {
  path: string;
  /** What getLeaf() was asked for: false = the current tab, 'tab' = a new one, and so on. */
  where: unknown;
  /** The second argument of openFile(), if any. */
  state: unknown;
}

export class FakeWorkspace extends FakeEvents {
  layoutReady = false;
  /** Paths of the notes opened through getLeaf().openFile(), in order. */
  readonly opened: string[] = [];
  /** The same, with how each one was opened. */
  readonly openCalls: OpenCall[] = [];
  /** The note being worked on in the main area. */
  activeFile: TFile | null = null;

  readonly leftSplit = new FakeSplit('left');
  readonly rightSplit = new FakeSplit('right');
  readonly rootSplit = new FakeSplit('root');
  readonly leaves: FakeLeaf[] = [];
  readonly viewCreators = new Map<string, (leaf: unknown) => unknown>();
  /** Set to make getLeftLeaf() return null, as Obsidian may. */
  noRoomOnTheLeft = false;
  /** Set to make getRightLeaf() return null, as Obsidian may. */
  noRoomOnTheRight = false;
  /** The leaves handed to revealLeaf(), in order. */
  readonly revealed: FakeLeaf[] = [];
  /** Everything getLeaf() was asked for, in order (false = the tab in use). */
  readonly leavesAskedFor: unknown[] = [];
  /** How often a view asked for the layout to be saved. */
  layoutSaves = 0;
  /** How often the editors were asked to take their extensions anew. */
  optionsUpdated = 0;
  /** The element the whole workspace is drawn in; it belongs to the page. */
  readonly containerEl = new FakeElement('div');
  /** The notes open in tabs, as vault paths (see showNote and closeNoteTab). */
  noteTabs: string[] = [];

  private waiting: Array<() => unknown> = [];

  constructor(private readonly app: unknown) {
    super();
  }

  /**
   * A pane of the main area. Asked for a new tab ('tab' or true) it is a
   * real pane in the root, which can hold one of the plugin's views as well
   * as a note; anything else is the tab in use (or a split, or a window),
   * which the plugin only ever uses to show a note.
   */
  getLeaf(newLeaf?: unknown): NoteOpener {
    this.leavesAskedFor.push(newLeaf ?? false);
    const opener: NoteOpener = {
      openFile: async (file: TFile, state?: unknown): Promise<void> => {
        this.opened.push(file.path);
        this.openCalls.push({ path: file.path, where: newLeaf ?? false, state });
        this.setActiveFile(file);
      },
    };
    if (newLeaf !== 'tab' && newLeaf !== true) return opener;
    // The pane only takes up room once it holds something: a note that is
    // opened in it is a note tab, not one of the plugin's panes.
    return new FakeLeaf(this, this.app, this.rootSplit, opener.openFile);
  }

  /** A new pane in the right sidebar, or null when there is no room for one. */
  getRightLeaf(_split: boolean): FakeLeaf | null {
    if (this.noRoomOnTheRight) return null;
    return this.addLeaf(this.rightSplit);
  }

  requestSaveLayout(): void {
    this.layoutSaves++;
  }

  updateOptions(): void {
    this.optionsUpdated++;
  }

  /**
   * Every pane, as Obsidian hands them out: the plugin's own, and one for
   * each note that is open in a tab.
   */
  iterateAllLeaves(callback: (leaf: unknown) => unknown): void {
    for (const leaf of [...this.leaves]) callback(leaf);
    for (const path of this.noteTabs) {
      callback({ view: { file: { path } }, getViewState: () => ({ type: 'markdown', state: { file: path } }) });
    }
  }

  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  /** A tab with a note is closed without another note coming to the front. */
  closeNoteTab(path: string): void {
    this.noteTabs = this.noteTabs.filter((tab) => tab !== path);
    this.trigger('layout-change');
  }

  /** The writer moves to another note (or to none): Obsidian announces it. */
  setActiveFile(file: TFile | null): void {
    if (file === this.activeFile) return;
    this.activeFile = file;
    if (file !== null && !this.noteTabs.includes(file.path)) this.noteTabs.push(file.path);
    this.trigger('file-open', file);
  }

  // --- panes and views

  registerViewCreator(type: string, creator: (leaf: unknown) => unknown): void {
    this.viewCreators.set(type, creator);
  }

  /** The plugin that made this view type is gone: its views close, their panes stay. */
  unregisterViewCreator(type: string): void {
    this.viewCreators.delete(type);
    for (const leaf of this.leaves) {
      if (leaf.type !== type) continue;
      void leaf.view?.close();
      leaf.view = null;
    }
  }

  getLeavesOfType(type: string): FakeLeaf[] {
    return this.leaves.filter((leaf) => leaf.type === type);
  }

  getLeftLeaf(_split: boolean): FakeLeaf | null {
    if (this.noRoomOnTheLeft) return null;
    return this.addLeaf(this.leftSplit);
  }

  /** A new, empty pane in one of the three places. */
  addLeaf(split: FakeSplit): FakeLeaf {
    const leaf = new FakeLeaf(this, this.app, split);
    this.leaves.push(leaf);
    return leaf;
  }

  async revealLeaf(leaf: FakeLeaf): Promise<void> {
    this.revealed.push(leaf);
    leaf.split.expand();
  }

  // --- start-up

  onLayoutReady(callback: () => unknown): void {
    if (this.layoutReady) callback();
    else this.waiting.push(callback);
  }

  becomeReady(): void {
    this.layoutReady = true;
    for (const callback of this.waiting.splice(0)) callback();
  }
}

export class FakeObsidian {
  readonly vault = new FakeVault(this);
  readonly metadataCache = new FakeMetadataCache(this);
  readonly workspace: FakeWorkspace = new FakeWorkspace(this);
  /** What app.saveLocalStorage() has stored, as JSON text, by key. */
  readonly localStorage = new Map<string, string>();
  /** Calls made to the FileManager, so tests can check the right doorway was used. */
  readonly calls: string[] = [];
  /** Paths moved to the trash. */
  readonly trashed: string[] = [];

  readonly fileManager = {
    processFrontMatter: async (file: TFile, change: (frontmatter: Record<string, unknown>) => void): Promise<void> => {
      this.calls.push(`processFrontMatter ${file.path}`);
      const text = this.vault.text.get(file.path) ?? '';
      const info = getFrontMatterInfo(text);
      const parsed = info.exists ? parseYaml(info.frontmatter) : null; // throws on broken YAML, like Obsidian
      const frontmatter = (parsed ?? {}) as Record<string, unknown>;
      change(frontmatter); // if this throws, nothing below runs: the note is not written
      const body = text.slice(info.contentStart);
      this.vault.text.set(file.path, `---\n${stringifyYaml(frontmatter)}---\n${body}`);
      this.saves.push(file.path);
      this.vault.trigger('modify', file);
      this.metadataCache.index(file);
    },
    renameFile: async (file: TAbstractFile, newPath: string): Promise<void> => {
      this.calls.push(`renameFile ${file.path} -> ${newPath}`);
      if (this.vault.entries.has(newPath)) throw new Error('Destination file already exists!');
      const oldPath = file.path;
      const text = this.vault.text.get(oldPath) ?? '';
      this.vault.detach(file);
      const parent = this.vault.attachFolder(parentOf(newPath));
      file.path = newPath;
      file.name = nameOf(newPath);
      if (file instanceof TFile) {
        const dot = file.name.lastIndexOf('.');
        file.basename = dot < 0 ? file.name : file.name.slice(0, dot);
      }
      file.parent = parent;
      parent.children.push(file);
      this.vault.entries.set(newPath, file);
      this.vault.text.set(newPath, text);
      this.metadataCache.move(oldPath, newPath);
      this.vault.trigger('rename', file, oldPath);
    },
    trashFile: async (file: TAbstractFile): Promise<void> => {
      this.calls.push(`trashFile ${file.path}`);
      this.trashed.push(file.path);
      this.vault.detach(file);
      this.metadataCache.forget(file.path);
      this.vault.trigger('delete', file);
    },
  };

  /** Paths whose text was actually written by processFrontMatter. */
  readonly saves: string[] = [];

  /** The object to hand to the plugin's code. */
  get app(): App {
    return this as unknown as App;
  }

  /** Obsidian's per-vault storage on this device. Values go through JSON, as they do there. */
  loadLocalStorage(key: string): unknown {
    const stored = this.localStorage.get(key);
    return stored === undefined ? null : (JSON.parse(stored) as unknown);
  }

  saveLocalStorage(key: string, data: unknown): void {
    if (data === null || data === undefined) this.localStorage.delete(key);
    else this.localStorage.set(key, JSON.stringify(data));
  }

  /** Put a note on "disk" without any event, as if it was there before Obsidian started. */
  addNote(path: string, text: string): TFile {
    return this.vault.attachFile(path, text);
  }

  addFolder(path: string): TFolder {
    return this.vault.attachFolder(path);
  }

  textOf(path: string): string {
    const text = this.vault.text.get(path);
    if (text === undefined) throw new Error(`no file at ${path}`);
    return text;
  }

  /**
   * Obsidian has finished starting up: the file list is complete, the
   * metadata cache is filled, and "resolved" is announced.
   */
  finishStartup(): void {
    this.metadataCache.restoreQuietly();
    this.workspace.becomeReady();
    this.metadataCache.trigger('resolved');
  }
}

/** A note's text with a frontmatter block, in the stand-in's JSON-as-YAML form. */
export function note(frontmatter: Record<string, unknown>, body = ''): string {
  return `---\n${stringifyYaml(frontmatter)}---\n${body}`;
}
