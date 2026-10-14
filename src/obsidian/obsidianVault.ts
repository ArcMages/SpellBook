// The real vault: implements VaultPort with Obsidian's API.
//
// This is the only file in the plugin that reads or writes notes. Everything
// goes through Obsidian's Vault, FileManager and MetadataCache, so it works
// the same on desktop, iPhone and iPad:
//   - properties are changed with fileManager.processFrontMatter (a note's
//     text is never touched),
//   - notes are removed with fileManager.trashFile (never deleted outright),
//   - notes are renamed with fileManager.renameFile (links are kept working),
//   - a whole text is only ever replaced in the plugin's own files (the to-do
//     list and the word logs), in one place: updateText below, which reads,
//     changes and saves in one step with vault.process,
//   - a file is written from bytes in one place only: createBinary below,
//     which makes a new exported manuscript and can replace nothing,
//   - the text of a note the writer writes in is replaced for one thing
//     only, restoring a scene from a snapshot: replaceText below, which goes
//     through the same one step and never creates a file.

import { TFile, TFolder, getFrontMatterInfo, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import type { App, EventRef, Events, TAbstractFile } from 'obsidian';
import { clashKey, isImagePath, isInside } from '../core/paths';
import type { Frontmatter } from '../core/types';
import { VaultFileMissingError } from '../core/vaultPort';
import type { MarkdownFileInfo, VaultEvent, VaultListener, VaultPort } from '../core/vaultPort';
import { localDay } from './systemClock';

/** Thrown inside processFrontMatter or process to leave a file untouched. Never leaves this file. */
class LeaveUntouched extends Error {}

function isRecord(value: unknown): value is Frontmatter {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ObsidianVault implements VaultPort {
  private readonly app: App;
  private readonly listeners = new Set<VaultListener>();
  private readonly refs: Array<{ source: Events; ref: EventRef }> = [];
  private started = false;
  private registerEvent: ((ref: EventRef) => void) | null = null;

  constructor(app: App) {
    this.app = app;
  }

  // ------------------------------------------------------------------ startup

  /**
   * Begin passing vault events on to listeners.
   *
   * When a plugin loads, Obsidian may not have listed the vault's files yet,
   * and its index of note properties may still be filling. So this sends a
   * "refresh" (look at everything again) at each point where a full picture
   * becomes available:
   *   - when the workspace layout is ready (all files are listed), and
   *   - the first time the index reports that it has finished.
   * Notes indexed in between arrive one by one as "metadata" events.
   *
   * @param registerEvent the plugin's own registerEvent, so that Obsidian
   *   also detaches every listener when the plugin unloads (stop() detaches
   *   them as well; doing both is harmless)
   */
  start(registerEvent?: (ref: EventRef) => void): void {
    if (this.started) return;
    this.started = true;
    this.registerEvent = registerEvent ?? null;
    const { vault, metadataCache, workspace } = this.app;

    this.track(
      metadataCache,
      metadataCache.on('changed', (file, _data, cache) => {
        const frontmatter = cache.frontmatter;
        this.emit({ type: 'metadata', path: file.path, frontmatter: isRecord(frontmatter) ? frontmatter : null });
      }),
    );

    const firstResolved = metadataCache.on('resolved', () => {
      metadataCache.offref(firstResolved);
      if (this.started) this.emit({ type: 'refresh' });
    });
    this.track(metadataCache, firstResolved);

    // Obsidian reports every existing file as "created" while it loads the
    // vault. Listening only once the layout is ready skips that flood.
    workspace.onLayoutReady(() => {
      if (!this.started) return;
      this.track(
        vault,
        vault.on('create', (file) => {
          this.emit({ type: 'create', path: file.path, folder: file instanceof TFolder });
        }),
      );
      this.track(
        vault,
        vault.on('delete', (file) => {
          this.emit({ type: 'delete', path: file.path, folder: file instanceof TFolder });
        }),
      );
      this.track(
        vault,
        vault.on('rename', (file, oldPath) => {
          this.emit({ type: 'rename', path: file.path, oldPath, folder: file instanceof TFolder });
        }),
      );
      this.track(
        vault,
        vault.on('modify', (file) => {
          if (file instanceof TFile) this.emit({ type: 'modify', path: file.path });
        }),
      );
      this.emit({ type: 'refresh' });
    });
  }

  /** Stop passing events on. */
  stop(): void {
    this.started = false;
    this.registerEvent = null;
    for (const { source, ref } of this.refs) source.offref(ref);
    this.refs.length = 0;
  }

  private track(source: Events, ref: EventRef): void {
    this.refs.push({ source, ref });
    this.registerEvent?.(ref);
  }

  private emit(event: VaultEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('Spellbook: a vault listener failed', error);
      }
    }
  }

  // ---------------------------------------------------------------- VaultPort

  on(listener: VaultListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  listMarkdownFiles(under?: string): MarkdownFileInfo[] {
    const folder = under === undefined ? '' : normalizePath(under);
    const all = folder === '' || folder === '/';
    const out: MarkdownFileInfo[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!all && !isInside(folder, file.path)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      out.push({ path: file.path, frontmatter: isRecord(frontmatter) ? frontmatter : null });
    }
    return out;
  }

  listFolders(): string[] {
    return this.app.vault.getAllFolders(false).map((folder) => folder.path);
  }

  listFiles(folder: string): string[] {
    const found = this.find(folder);
    if (!(found instanceof TFolder)) return [];
    return found.children.filter((child): child is TFile => child instanceof TFile).map((file) => file.path);
  }

  listImageFiles(): string[] {
    return this.app.vault
      .getFiles()
      .map((file) => file.path)
      .filter(isImagePath)
      .sort();
  }

  resourceUrl(path: string): string | null {
    const file = this.find(path);
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
  }

  createdDay(path: string): string | null {
    const file = this.find(path);
    if (!(file instanceof TFile)) return null;
    const created = file.stat?.ctime;
    return typeof created === 'number' && Number.isFinite(created) && created > 0 ? localDay(created) : null;
  }

  exists(path: string): boolean {
    const wanted = normalizePath(path);
    if (this.find(path)) return true;
    // Same name in different capitals counts too: phones and Macs would
    // treat the two as one file.
    const slash = wanted.lastIndexOf('/');
    const parent = slash < 0 ? this.app.vault.getRoot() : this.app.vault.getFolderByPath(wanted.slice(0, slash));
    if (!parent) return false;
    const name = clashKey(wanted.slice(slash + 1));
    return parent.children.some((child) => clashKey(child.name) === name);
  }

  resolveLink(link: string, from: string): string | null {
    return this.app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? null;
  }

  async readText(path: string): Promise<string> {
    return this.app.vault.cachedRead(this.requireFile(path));
  }

  async readBinary(path: string): Promise<Uint8Array> {
    return new Uint8Array(await this.app.vault.readBinary(this.requireFile(path)));
  }

  async readFrontmatter(path: string): Promise<Frontmatter | null> {
    const text = await this.app.vault.read(this.requireFile(path));
    const info = getFrontMatterInfo(text);
    if (!info.exists) return null;
    const parsed: unknown = parseYaml(info.frontmatter);
    return isRecord(parsed) ? parsed : null;
  }

  async createFile(path: string, body: string, frontmatter?: Readonly<Frontmatter>): Promise<string> {
    let text = body;
    if (frontmatter !== undefined) {
      const yaml = stringifyYaml(frontmatter);
      text = `---\n${yaml}${yaml.endsWith('\n') ? '' : '\n'}---\n${body}`;
    }
    const file = await this.app.vault.create(normalizePath(path), text);
    return file.path;
  }

  /**
   * The one place in the plugin that writes a file from bytes. Only the
   * project store calls it, and only for a new file in a project's Exports
   * folder: see createExportFile in src/core/projectStore.ts. It makes a new
   * file or fails; it cannot change one that is there.
   */
  async createBinary(path: string, data: Uint8Array): Promise<string> {
    const wanted = normalizePath(path);
    if (this.exists(wanted)) throw new Error(`There is already a file at "${wanted}".`);
    // Exactly these bytes, in a buffer of their own.
    const bytes = new Uint8Array(data.length);
    bytes.set(data);
    const file = await this.app.vault.createBinary(wanted, bytes.buffer);
    return file.path;
  }

  async createFolder(path: string): Promise<void> {
    const wanted = normalizePath(path);
    if (this.app.vault.getFolderByPath(wanted)) return;
    await this.app.vault.createFolder(wanted);
  }

  async rename(from: string, to: string): Promise<string> {
    const file = this.requireFile(from);
    await this.app.fileManager.renameFile(file, normalizePath(to));
    return file.path;
  }

  async trash(path: string): Promise<void> {
    await this.app.fileManager.trashFile(this.requireFile(path));
  }

  async updateFrontmatter(path: string, change: (frontmatter: Frontmatter) => boolean): Promise<boolean> {
    const file = this.requireFile(path);
    let saved = false;
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
        // Throwing here is how processFrontMatter is told to write nothing.
        if (!isRecord(frontmatter) || !change(frontmatter)) throw new LeaveUntouched();
        saved = true;
      });
    } catch (error) {
      if (error instanceof LeaveUntouched) return false;
      throw error;
    }
    return saved;
  }

  /**
   * The one place in the plugin that replaces a file's whole text. Only the
   * project store calls it, and only for the plugin's own files (the to-do
   * list and the word logs): see updateDataFile in src/core/projectStore.ts.
   */
  async updateText(path: string, change: (current: string | null) => string | null): Promise<boolean> {
    const existing = this.find(path);
    if (existing !== null && !(existing instanceof TFile)) {
      throw new Error(`"${path}" is a folder, not a file.`);
    }
    if (existing === null) {
      const text = change(null);
      if (text === null) return false;
      try {
        await this.app.vault.create(normalizePath(path), text);
        return true;
      } catch (error) {
        // The file may have arrived (from another device) at this very
        // moment. If it is there now, change it as it is; never replace it
        // with what was worked out for a file that did not exist.
        if (!(this.find(path) instanceof TFile)) throw error;
      }
    }
    return this.changeText(this.requireFile(path), change);
  }

  /**
   * Replaces the text of a note that is there; it never creates one. Only
   * the project store calls it, and only to restore a scene from a snapshot:
   * see replaceSceneText in src/core/projectStore.ts.
   */
  async replaceText(path: string, change: (current: string) => string | null): Promise<boolean> {
    return this.changeText(this.requireFile(path), (current) => change(current ?? ''));
  }

  /**
   * Changes the text of an idea board (a Canvas file) that is there; it
   * never creates one, and refuses every file that is not a board. Only the
   * project store calls it: see updateBoardFile in src/core/projectStore.ts.
   */
  async updateBoardText(path: string, change: (current: string) => string | null): Promise<boolean> {
    const file = this.requireFile(path);
    if (file.extension.toLowerCase() !== 'canvas') throw new Error(`"${path}" is not a board.`);
    return this.changeText(file, (current) => change(current ?? ''));
  }

  /** Read, change and save an existing file's text in one step; nothing is written when `change` gives null. */
  private async changeText(file: TFile, change: (current: string | null) => string | null): Promise<boolean> {
    let saved = false;
    try {
      await this.app.vault.process(file, (current) => {
        const text = change(current);
        // Throwing here is how the vault is told to write nothing.
        if (text === null || text === current) throw new LeaveUntouched();
        saved = true;
        return text;
      });
    } catch (error) {
      if (error instanceof LeaveUntouched) return false;
      throw error;
    }
    return saved;
  }

  // ------------------------------------------------------------------ helpers

  /** The file or folder at a path: first exactly as given, then in Obsidian's normal form. */
  private find(path: string): TAbstractFile | null {
    return (
      this.app.vault.getAbstractFileByPath(path) ?? this.app.vault.getAbstractFileByPath(normalizePath(path))
    );
  }

  private requireFile(path: string): TFile {
    const file = this.find(path);
    if (!(file instanceof TFile)) throw new VaultFileMissingError(path);
    return file;
  }
}
