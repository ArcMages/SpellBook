// The one doorway between the project logic and the vault.
//
// Everything in src/core talks to notes through this interface and nothing
// else. In Obsidian it is implemented by src/obsidian/obsidianVault.ts; in the
// unit tests by tests/memoryVault.ts, which keeps a vault in memory.
//
// All paths are vault paths: forward slashes, no leading slash, "" = the root.

import type { Frontmatter } from './types';

/** A markdown note together with the frontmatter Obsidian has indexed for it. */
export interface MarkdownFileInfo {
  readonly path: string;
  /**
   * The note's properties as last indexed, or null when it has none or has
   * not been indexed yet. Read-only: never change this object.
   */
  readonly frontmatter: Readonly<Frontmatter> | null;
}

/** Something that happened in the vault, whoever caused it. */
export type VaultEvent =
  | { readonly type: 'create'; readonly path: string; readonly folder: boolean }
  | { readonly type: 'delete'; readonly path: string; readonly folder: boolean }
  /** `path` is the new path. Renaming a folder also reports every file inside it. */
  | { readonly type: 'rename'; readonly path: string; readonly oldPath: string; readonly folder: boolean }
  /** A file's text changed on disk. */
  | { readonly type: 'modify'; readonly path: string }
  /** A note was indexed (again); `frontmatter` is what the index now holds. */
  | {
      readonly type: 'metadata';
      readonly path: string;
      readonly frontmatter: Readonly<Frontmatter> | null;
    }
  /** The list of files or their properties may have changed wholesale: look again. */
  | { readonly type: 'refresh' };

export type VaultListener = (event: VaultEvent) => void;

/** Thrown by reads and writes when there is no file at the path. */
export class VaultFileMissingError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`There is no note at "${path}".`);
    this.name = 'VaultFileMissingError';
    this.path = path;
  }
}

export interface VaultPort {
  /**
   * Every markdown note, or only those inside `under` (a folder path), with
   * the frontmatter currently indexed for each. Cheap; reads no files.
   */
  listMarkdownFiles(under?: string): MarkdownFileInfo[];

  /** Every folder in the vault, as vault paths, without the root itself. Cheap; reads no files. */
  listFolders(): string[];

  /**
   * Every file directly inside a folder (not those in its sub-folders), of
   * any kind, as vault paths. Empty when there is no such folder. Cheap;
   * reads no files.
   */
  listFiles(folder: string): string[];

  /**
   * Every picture in the vault (a file whose name ends in one of
   * IMAGE_EXTENSIONS, see src/core/paths.ts), as vault paths, sorted. For
   * the list a picture is chosen from. Cheap; reads no files.
   */
  listImageFiles(): string[];

  /**
   * An address the app can show a file of the vault at, in an image element:
   * for showing a picture. Null when there is no such file. Nothing is read
   * and nothing leaves the device: the address leads to the file in the
   * vault itself.
   */
  resourceUrl(path: string): string | null;

  /**
   * The day a file was created, on this device's calendar, as YYYY-MM-DD.
   * Null when there is no such file or the vault does not know.
   */
  createdDay(path: string): string | null;

  /**
   * Whether a file or folder is at this path. Upper and lower case are not
   * told apart ("letter.md" exists when "Letter.md" does), because that is
   * how phones and Macs store files. Use it to avoid name clashes.
   */
  exists(path: string): boolean;

  /** The whole text of a file, properties block included. */
  readText(path: string): Promise<string>;

  /**
   * The bytes of a file, of any kind: for a picture that goes into an
   * exported book as its cover. Reads only; rejects with
   * VaultFileMissingError when there is no such file.
   */
  readBinary(path: string): Promise<Uint8Array>;

  /**
   * A note's properties, read from the file itself (not from the index, which
   * may lag behind). Null when the note has no properties block.
   * Rejects with VaultFileMissingError when there is no such file, and with
   * another error when the block cannot be read as YAML.
   */
  readFrontmatter(path: string): Promise<Frontmatter | null>;

  /**
   * Create a file. Rejects when something is already there or its folder is
   * missing. Resolves with the path the file was actually created at.
   */
  createFile(path: string, body: string, frontmatter?: Readonly<Frontmatter>): Promise<string>;

  /**
   * Create a new file from bytes: for a file the plugin makes that is not a
   * note, such as an exported manuscript. Nothing is ever replaced: rejects
   * when something is already at the path (whatever its capitals) or its
   * folder is missing. Resolves with the path the file was created at.
   *
   * The project store is the only caller, and it creates nothing but new
   * files in a project's Exports folder: see createExportFile there.
   */
  createBinary(path: string, data: Uint8Array): Promise<string>;

  /** Create a folder. Does nothing when it already exists. */
  createFolder(path: string): Promise<void>;

  /**
   * Rename or move a file or a folder (with everything in it), and nothing
   * else: the links to it are left as they are, and the vault asks the
   * writer nothing. Rejects with VaultFileMissingError when there is nothing
   * at `from`, and with another error when the new path is taken. Resolves
   * with the new path.
   *
   * Only the project store calls it, in relocate, and brings the links up to
   * date itself: every rename and move Spellbook makes goes through there.
   * (Obsidian's own rename, fileManager.renameFile, is not used: it stops to
   * ask about links when the writer has not told Obsidian to "Always update
   * internal links", and the rename waits until they answer.)
   */
  moveFile(from: string, to: string): Promise<string>;

  /**
   * The notes whose links the vault has found to lead to a file, as vault
   * paths, sorted. Cheap; reads no files. It may lag a moment behind a note
   * that was just changed.
   */
  linkSources(path: string): string[];

  /**
   * Read, change and save the text of a note that is there, in one step,
   * against the file as it is on disk at that moment, so that its links lead
   * to a note that was renamed. Nothing is ever created: rejects with
   * VaultFileMissingError when there is no such file.
   *
   * The project store is the only caller, in relocate, and the change it
   * hands in alters nothing but the stretches of links that name the
   * renamed note (see retargetLinks in src/core/links.ts), and never the
   * properties block.
   *
   * Resolves with whether the file was written. Rejects when the save fails.
   */
  updateLinks(path: string, change: (current: string) => string | null): Promise<boolean>;

  /** Move a file to the trash (never deletes it outright). */
  trash(path: string): Promise<void>;

  /**
   * Read, change and save a note's properties in one step, against the file
   * as it is on disk at that moment. The note's text is never touched.
   *
   * `change` receives the current properties ({} when there are none) and
   * edits them in place. It must return true to save, or false to leave the
   * file completely untouched (nothing is written, not even unchanged data).
   *
   * Resolves with whether the file was saved. Rejects when the file is
   * missing, its properties cannot be read, or the save fails.
   */
  updateFrontmatter(path: string, change: (frontmatter: Frontmatter) => boolean): Promise<boolean>;

  /**
   * Read, change and save the WHOLE text of a file in one step, against the
   * file as it is on disk at that moment. A file that is not there yet is
   * created (its folder must exist).
   *
   * This replaces everything in the file, so it is only for files the plugin
   * itself owns (its to-do list, its word logs and its reference for AI
   * assistants). It must never be used on
   * a scene or any other note the writer writes in: the project store is the
   * only caller, and it refuses every other path.
   *
   * `change` receives the current text, or null when there is no such file.
   * It returns the new text, or null to leave things exactly as they are
   * (nothing is written, and a missing file is not created).
   *
   * Resolves with whether the file was written. Rejects when the save fails.
   */
  updateText(path: string, change: (current: string | null) => string | null): Promise<boolean>;

  /**
   * Read, change and save the whole text of a note that is there, in one
   * step, against the file as it is on disk at that moment. Nothing is ever
   * created: rejects with VaultFileMissingError when there is no such file.
   *
   * This replaces a note's text, so it has one use only: putting back an
   * earlier version of a scene that the writer asked to restore. The project
   * store is the only caller, and it accepts nothing but a scene of the open
   * project: see replaceSceneText there.
   *
   * `change` receives the current text and returns the new text, or null to
   * leave the file exactly as it is (nothing is written).
   *
   * Resolves with whether the file was written. Rejects when the save fails.
   */
  replaceText(path: string, change: (current: string) => string | null): Promise<boolean>;

  /**
   * Read, change and save the whole text of an idea board (a Canvas file,
   * ending in ".canvas") that is there, in one step, against the file as it
   * is on disk at that moment. Nothing is ever created, and nothing but a
   * board is accepted: rejects with VaultFileMissingError when there is no
   * such file, and with another error for a file that is not a board.
   *
   * The project store is the only caller: in updateBoardFile, which accepts
   * nothing but a board directly inside the open project's Boards folder, and
   * in relocate, which points a board's cards at a note that was renamed or
   * moved and changes nothing else. A note's text is never reached this way.
   *
   * `change` receives the current text and returns the new text, or null to
   * leave the file exactly as it is (nothing is written).
   *
   * Resolves with whether the file was written. Rejects when the save fails.
   */
  updateBoardText(path: string, change: (current: string) => string | null): Promise<boolean>;

  /**
   * The note a link points at, as the vault itself resolves it: `link` is
   * what stands between the double brackets of a wikilink, without a heading
   * or a shown name ("Mara", "World/Characters/Mara"), and `from` is the
   * vault path of the note the link is written in. Null when the link leads
   * to no file. Cheap; reads no files.
   */
  resolveLink(link: string, from: string): string | null;

  /** Listen to vault events. Returns a function that stops listening. */
  on(listener: VaultListener): () => void;
}
