// A vault kept in memory, for the unit tests. It implements VaultPort the way
// Obsidian behaves, and adds controls for the awkward situations the store
// must survive:
//
//   - an external edit: another device (or the writer, by hand) changes a
//     file. `external.*` methods do this; with { silent: true } the change is
//     on "disk" but no event has been delivered yet.
//   - an out-of-order sync: `sync([...])` hands files over one at a time, so
//     a test can let the index arrive before its scene notes.
//   - a failing write: `failNext('updateFrontmatter')` makes the next such
//     call reject without changing anything.
//   - a slow index: `holdMetadata()` freezes what listMarkdownFiles() reports
//     (like Obsidian's metadata cache lagging behind the disk) until
//     `releaseMetadata()`.
//
// Every write the code under test makes is recorded in `writes`, so tests can
// assert exactly which files were touched.

import { clashKey, isInside, isMarkdownPath, joinPath, parentPath } from '../src/core/paths';
import type { Frontmatter } from '../src/core/types';
import { VaultFileMissingError } from '../src/core/vaultPort';
import type { MarkdownFileInfo, VaultEvent, VaultListener, VaultPort } from '../src/core/vaultPort';

export type WriteOp = 'createFile' | 'createFolder' | 'rename' | 'trash' | 'updateFrontmatter';

export interface WriteRecord {
  readonly op: WriteOp;
  readonly path: string;
  /** For a rename: the new path. */
  readonly to?: string;
}

export interface FileContent {
  frontmatter?: Frontmatter | null;
  body?: string;
}

interface StoredFile {
  frontmatter: Frontmatter | null;
  body: string;
  /** True when the properties block is broken YAML. */
  corrupt: boolean;
}

interface ExternalOptions {
  /** The change is on disk but the vault has not noticed: no events, index not updated. */
  silent?: boolean;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryVault implements VaultPort {
  private readonly files = new Map<string, StoredFile>();
  private readonly folders = new Set<string>();
  /** What the "metadata cache" has indexed: path -> frontmatter. */
  private readonly indexed = new Map<string, Frontmatter | null>();
  private readonly listeners = new Set<VaultListener>();
  private readonly failures: Array<{ op: WriteOp; path?: string; message: string }> = [];
  private holding = false;
  private readonly heldPaths = new Set<string>();

  /** Every write made through the VaultPort methods, in order. */
  readonly writes: WriteRecord[] = [];
  /** Paths moved to the trash, in order. */
  readonly trashed: string[] = [];
  /** How many times each read happened, for tests that care. */
  readonly reads = { readFrontmatter: 0, readText: 0 };
  /** In which order a folder rename reports itself and the files inside it. */
  folderRenameOrder: 'folder-first' | 'files-first' = 'folder-first';

  /** External changes: made by "another device", not through the port. */
  readonly external = {
    /** Create a file (and any folders above it). */
    create: (path: string, content: FileContent = {}, options: ExternalOptions = {}): void => {
      if (this.files.has(path)) throw new Error(`external.create: "${path}" already exists`);
      this.ensureFolders(parentPath(path), options.silent === true);
      this.files.set(path, {
        frontmatter: content.frontmatter === undefined ? null : clone(content.frontmatter),
        body: content.body ?? '',
        corrupt: false,
      });
      if (options.silent) return;
      this.emit({ type: 'create', path, folder: false });
      this.index(path);
    },
    /** Replace a file's properties and/or text. */
    write: (path: string, content: FileContent, options: ExternalOptions = {}): void => {
      const file = this.requireFile(path);
      if (content.frontmatter !== undefined) {
        file.frontmatter = content.frontmatter === null ? null : clone(content.frontmatter);
        file.corrupt = false;
      }
      if (content.body !== undefined) file.body = content.body;
      if (options.silent) return;
      this.emit({ type: 'modify', path });
      this.index(path);
    },
    /** Change a file's properties in place. */
    editFrontmatter: (
      path: string,
      edit: (frontmatter: Frontmatter) => void,
      options: ExternalOptions = {},
    ): void => {
      const file = this.requireFile(path);
      const next = clone(file.frontmatter ?? {});
      edit(next);
      this.external.write(path, { frontmatter: next }, options);
    },
    /** Break a file's properties block, as a bad merge would. */
    corrupt: (path: string, options: ExternalOptions = {}): void => {
      const file = this.requireFile(path);
      file.corrupt = true;
      if (options.silent) return;
      this.emit({ type: 'modify', path });
      this.index(path);
    },
    /** Delete a file, or a folder with everything in it. */
    delete: (path: string, options: ExternalOptions = {}): void => {
      this.removeEntry(path, options.silent === true);
    },
    /** Rename or move a file or a folder. */
    rename: (from: string, to: string, options: ExternalOptions = {}): void => {
      this.moveEntry(from, to, options.silent === true);
    },
  };

  // -------------------------------------------------------------- test set-up

  /** Put a file in the vault before the test starts: no events, already indexed. */
  seed(path: string, content: FileContent = {}): this {
    this.ensureFolders(parentPath(path), true);
    const frontmatter = content.frontmatter === undefined ? null : clone(content.frontmatter);
    this.files.set(path, { frontmatter, body: content.body ?? '', corrupt: false });
    this.indexed.set(path, frontmatter === null ? null : clone(frontmatter));
    return this;
  }

  /** Put an empty folder in the vault before the test starts. */
  seedFolder(path: string): this {
    this.ensureFolders(path, true);
    return this;
  }

  /**
   * Files arriving from another device, one at a time, in the order given.
   * Call the returned function to deliver the next one; it returns false when
   * there is nothing left.
   */
  sync(arrivals: ReadonlyArray<{ path: string } & FileContent>): () => boolean {
    const queue = [...arrivals];
    return () => {
      const next = queue.shift();
      if (!next) return false;
      if (this.files.has(next.path)) this.external.write(next.path, next);
      else this.external.create(next.path, next);
      return true;
    };
  }

  /** Make the next matching write reject, leaving the vault as it was. */
  failNext(op: WriteOp, path?: string, message = 'The disk is not available'): void {
    this.failures.push(path === undefined ? { op, message } : { op, path, message });
  }

  /** Stop the index from following the disk: listMarkdownFiles() keeps reporting old properties. */
  holdMetadata(): void {
    this.holding = true;
  }

  /** Let the index catch up and report every note that changed in the meantime. */
  releaseMetadata(): void {
    this.holding = false;
    const paths = [...this.heldPaths];
    this.heldPaths.clear();
    for (const path of paths) this.index(path);
  }

  /** Tell listeners to look at everything again (as when the vault finishes loading). */
  refresh(): void {
    this.emit({ type: 'refresh' });
  }

  /**
   * As when Obsidian has listed the files but not indexed their properties
   * yet: every note reports no frontmatter until `finishIndexing()`.
   */
  forgetIndex(): void {
    this.indexed.clear();
  }

  /**
   * The index catches up with every note it has not indexed yet, then sends
   * "refresh". With 'each-note' every note is also reported on its own (as
   * Obsidian does for notes it indexes for the first time); with
   * 'refresh-only' the index fills quietly (as when it is restored from
   * Obsidian's saved cache) and the "refresh" is the only signal.
   */
  finishIndexing(report: 'each-note' | 'refresh-only' = 'each-note'): void {
    for (const [path, file] of this.files) {
      if (this.indexed.has(path) || !isMarkdownPath(path)) continue;
      if (report === 'each-note') this.index(path);
      else this.indexed.set(path, file.corrupt || file.frontmatter === null ? null : clone(file.frontmatter));
    }
    this.refresh();
  }

  // ------------------------------------------------------------- inspection

  frontmatterOf(path: string): Frontmatter | null {
    const file = this.requireFile(path);
    return file.frontmatter === null ? null : clone(file.frontmatter);
  }

  bodyOf(path: string): string {
    return this.requireFile(path).body;
  }

  has(path: string): boolean {
    return this.files.has(path) || this.folders.has(path);
  }

  hasFolder(path: string): boolean {
    return this.folders.has(path);
  }

  /** Every file path, sorted. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  /** The writes made to one path. */
  writesTo(path: string): WriteRecord[] {
    return this.writes.filter((write) => write.path === path || write.to === path);
  }

  clearWrites(): void {
    this.writes.length = 0;
  }

  // ---------------------------------------------------------------- VaultPort

  on(listener: VaultListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  listMarkdownFiles(under?: string): MarkdownFileInfo[] {
    const out: MarkdownFileInfo[] = [];
    for (const path of this.files.keys()) {
      if (!isMarkdownPath(path)) continue;
      if (under !== undefined && under !== '' && !isInside(under, path)) continue;
      const frontmatter = this.indexed.get(path) ?? null;
      out.push({ path, frontmatter: frontmatter === null ? null : Object.freeze(clone(frontmatter)) });
    }
    return out;
  }

  exists(path: string): boolean {
    const wanted = clashKey(path);
    for (const file of this.files.keys()) if (clashKey(file) === wanted) return true;
    for (const folder of this.folders) if (clashKey(folder) === wanted) return true;
    return false;
  }

  async readText(path: string): Promise<string> {
    this.reads.readText++;
    const file = this.requireFile(path);
    if (file.corrupt) return `---\nbinder: [unclosed\n---\n${file.body}`;
    if (file.frontmatter === null) return file.body;
    const lines = Object.entries(file.frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    return `---\n${lines.join('\n')}\n---\n${file.body}`;
  }

  async readFrontmatter(path: string): Promise<Frontmatter | null> {
    this.reads.readFrontmatter++;
    const file = this.requireFile(path);
    if (file.corrupt) throw new Error('YAMLParseError: bad indentation of a mapping entry');
    return file.frontmatter === null ? null : clone(file.frontmatter);
  }

  async createFile(path: string, body: string, frontmatter?: Readonly<Frontmatter>): Promise<string> {
    this.maybeFail('createFile', path);
    if (this.exists(path)) throw new Error(`File already exists: ${path}`);
    const parent = parentPath(path);
    if (parent !== '' && !this.folders.has(parent)) throw new Error(`Folder does not exist: ${parent}`);
    this.writes.push({ op: 'createFile', path });
    this.files.set(path, {
      frontmatter: frontmatter === undefined ? null : clone(frontmatter as Frontmatter),
      body,
      corrupt: false,
    });
    this.emit({ type: 'create', path, folder: false });
    this.index(path);
    return path;
  }

  async createFolder(path: string): Promise<void> {
    this.maybeFail('createFolder', path);
    if (this.folders.has(path)) return;
    if (this.exists(path)) throw new Error(`Something already exists at: ${path}`);
    this.writes.push({ op: 'createFolder', path });
    this.ensureFolders(path, false);
  }

  async rename(from: string, to: string): Promise<string> {
    this.maybeFail('rename', from);
    if (!this.files.has(from)) throw new VaultFileMissingError(from);
    this.writes.push({ op: 'rename', path: from, to });
    this.moveEntry(from, to, false);
    return to;
  }

  async trash(path: string): Promise<void> {
    this.maybeFail('trash', path);
    if (!this.files.has(path)) throw new VaultFileMissingError(path);
    this.writes.push({ op: 'trash', path });
    this.trashed.push(path);
    this.removeEntry(path, false);
  }

  async updateFrontmatter(path: string, change: (frontmatter: Frontmatter) => boolean): Promise<boolean> {
    const file = this.files.get(path);
    if (!file) throw new VaultFileMissingError(path);
    if (file.corrupt) throw new Error('YAMLParseError: bad indentation of a mapping entry');
    // The callback always sees the file as it is on disk right now.
    const draft = clone(file.frontmatter ?? {});
    if (!change(draft)) return false;
    // The save itself can fail after the callback has run, as on a real disk.
    this.maybeFail('updateFrontmatter', path);
    this.writes.push({ op: 'updateFrontmatter', path });
    file.frontmatter = clone(draft);
    this.emit({ type: 'modify', path });
    this.index(path);
    return true;
  }

  // ------------------------------------------------------------------ helpers

  private requireFile(path: string): StoredFile {
    const file = this.files.get(path);
    if (!file) throw new VaultFileMissingError(path);
    return file;
  }

  private maybeFail(op: WriteOp, path: string): void {
    const at = this.failures.findIndex((rule) => rule.op === op && (rule.path === undefined || rule.path === path));
    if (at < 0) return;
    const [rule] = this.failures.splice(at, 1);
    throw new Error(rule?.message ?? 'write failed');
  }

  private emit(event: VaultEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  /** The "metadata cache" indexes a note and reports it, unless it is being held back. */
  private index(path: string): void {
    if (!isMarkdownPath(path)) return;
    if (this.holding) {
      this.heldPaths.add(path);
      return;
    }
    const file = this.files.get(path);
    if (!file) return;
    const frontmatter = file.corrupt || file.frontmatter === null ? null : clone(file.frontmatter);
    this.indexed.set(path, frontmatter);
    this.emit({ type: 'metadata', path, frontmatter: frontmatter === null ? null : Object.freeze(clone(frontmatter)) });
  }

  private ensureFolders(path: string, silent: boolean): void {
    if (path === '') return;
    const parts = path.split('/');
    for (let depth = 1; depth <= parts.length; depth++) {
      const folder = parts.slice(0, depth).join('/');
      if (this.folders.has(folder)) continue;
      this.folders.add(folder);
      if (!silent) this.emit({ type: 'create', path: folder, folder: true });
    }
  }

  private removeEntry(path: string, silent: boolean): void {
    if (this.files.has(path)) {
      this.files.delete(path);
      this.indexed.delete(path);
      this.heldPaths.delete(path);
      if (!silent) this.emit({ type: 'delete', path, folder: false });
      return;
    }
    if (!this.folders.has(path)) throw new VaultFileMissingError(path);
    for (const file of [...this.files.keys()].filter((candidate) => isInside(path, candidate))) {
      this.removeEntry(file, silent);
    }
    for (const folder of [...this.folders].filter((candidate) => isInside(path, candidate))) {
      this.folders.delete(folder);
      if (!silent) this.emit({ type: 'delete', path: folder, folder: true });
    }
    this.folders.delete(path);
    if (!silent) this.emit({ type: 'delete', path, folder: true });
  }

  private moveEntry(from: string, to: string, silent: boolean): void {
    if (clashKey(from) !== clashKey(to) && this.exists(to)) {
      throw new Error(`Destination already exists: ${to}`);
    }
    if (this.files.has(from)) {
      this.ensureFolders(parentPath(to), silent);
      this.moveFile(from, to);
      if (!silent) this.emit({ type: 'rename', path: to, oldPath: from, folder: false });
      return;
    }
    if (!this.folders.has(from)) throw new VaultFileMissingError(from);

    this.ensureFolders(parentPath(to), silent);
    const movedFiles: Array<[string, string]> = [];
    for (const file of [...this.files.keys()].filter((candidate) => isInside(from, candidate))) {
      const target = joinPath(to, file.slice(from.length + 1));
      this.moveFile(file, target);
      movedFiles.push([file, target]);
    }
    const movedFolders: Array<[string, string]> = [];
    for (const folder of [...this.folders].filter((candidate) => isInside(from, candidate))) {
      const target = joinPath(to, folder.slice(from.length + 1));
      this.folders.delete(folder);
      this.folders.add(target);
      movedFolders.push([folder, target]);
    }
    this.folders.delete(from);
    this.folders.add(to);
    if (silent) return;

    const reportFolder = (): void => {
      this.emit({ type: 'rename', path: to, oldPath: from, folder: true });
      for (const [oldPath, path] of movedFolders) this.emit({ type: 'rename', path, oldPath, folder: true });
    };
    const reportFiles = (): void => {
      for (const [oldPath, path] of movedFiles) this.emit({ type: 'rename', path, oldPath, folder: false });
    };
    if (this.folderRenameOrder === 'folder-first') {
      reportFolder();
      reportFiles();
    } else {
      reportFiles();
      reportFolder();
    }
  }

  /** Move one file's content and index entry. Obsidian sends no "metadata" event for a rename. */
  private moveFile(from: string, to: string): void {
    const file = this.files.get(from);
    if (!file) return;
    this.files.delete(from);
    this.files.set(to, file);
    if (this.indexed.has(from)) {
      this.indexed.set(to, this.indexed.get(from) ?? null);
      this.indexed.delete(from);
    }
    if (this.heldPaths.delete(from)) this.heldPaths.add(to);
  }
}

/**
 * Timers under the test's control: nothing fires until `advance()` is called.
 * Hand `set` to the store as its `setTimer`.
 */
export class ManualTimers {
  private now = 0;
  private nextId = 1;
  private timers: Array<{ id: number; at: number; callback: () => void }> = [];

  readonly set = (callback: () => void, ms: number): (() => void) => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.now + ms, callback });
    return () => {
      this.timers = this.timers.filter((timer) => timer.id !== id);
    };
  };

  /** How many timers are waiting. */
  get pending(): number {
    return this.timers.length;
  }

  /** Let `ms` milliseconds pass, firing every timer that comes due, in order. */
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.now = due.at;
      due.callback();
    }
    this.now = until;
  }
}
