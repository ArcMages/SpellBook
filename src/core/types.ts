// Shared types for the project model. Nothing here depends on Obsidian.

/** Parsed YAML properties of a note. */
export type Frontmatter = Record<string, unknown>;

/**
 * A scene in the binder. `path` is the scene note's path relative to the
 * project folder, with forward slashes, for example "Manuscript/Opening.md".
 */
export interface SceneNode {
  readonly kind: 'scene';
  readonly path: string;
}

/**
 * A binder folder. Binder folders are virtual: they only exist in the project
 * index, and nesting a scene in one never moves its file on disk.
 */
export interface FolderNode {
  readonly kind: 'folder';
  /** Short, stable id, unique within the project. */
  readonly id: string;
  /** Display name. Free text in any language. */
  readonly name: string;
  readonly children: Binder;
  /** Keys found on the folder that this version does not know; kept on every write. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export type BinderNode = SceneNode | FolderNode;

/** The binder: an ordered tree of scenes and folders. Treated as immutable. */
export type Binder = readonly BinderNode[];

/** Points at one node: a scene by its path, a folder by its id. */
export type NodeRef =
  | { readonly kind: 'scene'; readonly path: string }
  | { readonly kind: 'folder'; readonly id: string };

/**
 * Where a node should go. `parentId` is a folder id, or null for the top
 * level. "before" and "after" follow the sibling wherever it currently is.
 */
export type Placement =
  | { readonly at: 'start'; readonly parentId: string | null }
  | { readonly at: 'end'; readonly parentId: string | null }
  | { readonly at: 'before'; readonly sibling: NodeRef }
  | { readonly at: 'after'; readonly sibling: NodeRef };

/** A project found in the vault. */
export interface ProjectSummary {
  /** Vault path of the project index note. */
  readonly indexPath: string;
  /** Vault path of the project folder ("" when the index sits in the vault root). */
  readonly folder: string;
  readonly title: string;
}

/** A project that was just created. */
export interface CreatedProject extends ProjectSummary {
  /**
   * The scenes it was created with, in manuscript order, as paths relative to
   * the project folder. Empty for a project created without any.
   */
  readonly scenes: readonly string[];
}

/** One row of the binder as the views see it. */
export type TreeNode =
  | {
      readonly kind: 'scene';
      /** Path relative to the project folder; also the scene's identity. */
      readonly path: string;
      /** File name without ".md". */
      readonly title: string;
      /** True when the binder lists the scene but its note is not in the vault (yet). */
      readonly missing: boolean;
    }
  | {
      readonly kind: 'folder';
      readonly id: string;
      readonly name: string;
      readonly children: readonly TreeNode[];
    };

/** Everything the views need to draw the open project. A new object on every change. */
export interface ProjectSnapshot extends ProjectSummary {
  /** True when the index could not be understood. Nothing is written in that state. */
  readonly readOnly: boolean;
  /** Why the project is read-only, in plain language; null when it is fine. */
  readonly error: string | null;
  /** Things that were tidied up while reading the index (for example duplicates). */
  readonly notes: readonly string[];
  readonly tree: readonly TreeNode[];
  /** Notes under Manuscript/ that are not in the binder, as paths relative to the project. */
  readonly unfiled: readonly string[];
  /** Binder scenes whose note does not exist, in manuscript order. */
  readonly missing: readonly string[];
  /** Notes under Research/, as paths relative to the project. */
  readonly research: readonly string[];
  /** Goes up by one each time the snapshot changes. */
  readonly revision: number;
}

/** Why an intent changed nothing. */
export type NoopReason =
  | 'not-found'
  | 'target-missing'
  | 'unchanged'
  | 'already-in-binder'
  | 'file-exists';

/** Why an intent was refused before anything was written. */
export type RefusalReason =
  | 'no-project'
  | 'other-project'
  | 'read-only'
  | 'invalid-name'
  | 'invalid-path'
  | 'invalid-move'
  | 'exists'
  | 'parent-missing'
  | 'inside-project'
  | 'missing-file'
  | 'not-a-project'
  | 'not-found';

/**
 * What happened to an intent.
 *  - done:    it was applied and written.
 *  - noop:    it no longer applied (for example the node vanished after a sync); nothing was written.
 *  - refused: it is not allowed (read-only project, invalid move, name taken); nothing was written.
 *  - failed:  reading or writing went wrong part-way; `message` says what was and was not done.
 */
export type IntentResult<T = undefined> =
  | { readonly status: 'done'; readonly value: T; readonly warning?: string }
  | { readonly status: 'noop'; readonly reason: NoopReason; readonly message: string }
  | { readonly status: 'refused'; readonly reason: RefusalReason; readonly message: string }
  | { readonly status: 'failed'; readonly message: string };

/** What a store listener is told. Listeners then read the store again. */
export type StoreChange =
  | { readonly type: 'projects' } // the list of projects in the vault changed
  | { readonly type: 'project' }; // the open project changed (or was opened or closed)
