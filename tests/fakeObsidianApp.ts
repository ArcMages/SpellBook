// A small imitation of the Obsidian `app` object for testing
// src/obsidian/obsidianVault.ts. It models only what that file relies on, as
// documented in obsidian.d.ts:
//
//  - vault events ("create" also fires for every existing file while the
//    vault loads, before the layout is ready),
//  - the metadata cache, which is filled separately from the file list and
//    announces "changed" per note and "resolved" when it has caught up,
//  - fileManager.processFrontMatter, which writes nothing when its callback throws.
//
// The destructive Vault methods (delete, trash, modify, rename) throw, so a
// test fails loudly if the plugin ever reaches for them instead of the
// FileManager ones.

import { TFile, TFolder, getFrontMatterInfo, parseYaml, stringifyYaml } from 'obsidian';
import type { App, CachedMetadata, TAbstractFile } from 'obsidian';

interface Ref {
  name: string;
  callback: (...args: unknown[]) => unknown;
}

class FakeEvents {
  private readonly refs = new Set<Ref>();

  on(name: string, callback: (...args: never[]) => unknown): Ref {
    const ref: Ref = { name, callback: callback as (...args: unknown[]) => unknown };
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

class FakeWorkspace {
  layoutReady = false;
  private waiting: Array<() => unknown> = [];

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
  readonly workspace = new FakeWorkspace();
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
