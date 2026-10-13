// Pure operations on the binder tree. Every function returns a new tree and
// leaves its input untouched, so the store can compare before and after and
// tests can run without Obsidian.

import { pathKey } from './paths';
import type { Binder, BinderNode, FolderNode, NodeRef, Placement, SceneNode } from './types';

export function sceneRef(path: string): NodeRef {
  return { kind: 'scene', path };
}

export function folderRef(id: string): NodeRef {
  return { kind: 'folder', id };
}

export function refOf(node: BinderNode): NodeRef {
  return node.kind === 'scene' ? sceneRef(node.path) : folderRef(node.id);
}

export function sameRef(a: NodeRef, b: NodeRef): boolean {
  if (a.kind === 'scene') return b.kind === 'scene' && pathKey(a.path) === pathKey(b.path);
  return b.kind === 'folder' && a.id === b.id;
}

function matches(node: BinderNode, ref: NodeRef): boolean {
  return sameRef(refOf(node), ref);
}

/** Where a node sits: its parent folder (null = top level) and position in it. */
export interface NodeLocation {
  readonly node: BinderNode;
  readonly parentId: string | null;
  readonly index: number;
}

/** Find a node anywhere in the tree. */
export function locate(binder: Binder, ref: NodeRef, parentId: string | null = null): NodeLocation | null {
  for (let index = 0; index < binder.length; index++) {
    const node = binder[index] as BinderNode;
    if (matches(node, ref)) return { node, parentId, index };
    if (node.kind === 'folder') {
      const inner = locate(node.children, ref, node.id);
      if (inner) return inner;
    }
  }
  return null;
}

export function findFolder(binder: Binder, id: string): FolderNode | null {
  const found = locate(binder, folderRef(id));
  return found && found.node.kind === 'folder' ? found.node : null;
}

export function hasScene(binder: Binder, path: string): boolean {
  return locate(binder, sceneRef(path)) !== null;
}

/** The children of a folder (or of the top level for null); null when the folder is not there. */
export function childrenOf(binder: Binder, parentId: string | null): Binder | null {
  if (parentId === null) return binder;
  return findFolder(binder, parentId)?.children ?? null;
}

/** Every scene path in manuscript order: depth-first, top to bottom. */
export function flattenScenes(binder: Binder): string[] {
  const out: string[] = [];
  const walk = (nodes: Binder): void => {
    for (const node of nodes) {
      if (node.kind === 'scene') out.push(node.path);
      else walk(node.children);
    }
  };
  walk(binder);
  return out;
}

/** The scenes a node stands for: itself, or everything inside a folder. */
export function scenesIn(node: BinderNode): string[] {
  return flattenScenes([node]);
}

/** Every folder id in the tree. */
export function folderIds(binder: Binder): string[] {
  const out: string[] = [];
  const walk = (nodes: Binder): void => {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        out.push(node.id);
        walk(node.children);
      }
    }
  };
  walk(binder);
  return out;
}

/**
 * Rebuild the tree with one folder's children replaced. Only the nodes on the
 * way down to that folder are copied. Returns null when the folder is not there.
 */
function withChildren(
  binder: Binder,
  parentId: string | null,
  change: (children: Binder) => Binder,
): Binder | null {
  if (parentId === null) return change(binder);
  let found = false;
  const next = binder.map((node): BinderNode => {
    if (found || node.kind !== 'folder') return node;
    if (node.id === parentId) {
      found = true;
      return { ...node, children: change(node.children) };
    }
    const inner = withChildren(node.children, parentId, change);
    if (inner === null) return node;
    found = true;
    return { ...node, children: inner };
  });
  return found ? next : null;
}

function clamp(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

export type InsertResult =
  | { readonly ok: true; readonly binder: Binder }
  | { readonly ok: false; readonly reason: 'parent-missing' | 'duplicate' };

/**
 * Put a node into a folder (null = top level) at a position. The position is
 * clamped to the folder's length. Refuses to add a scene path or folder id
 * that the tree (or the node itself) already uses.
 */
export function insertNode(
  binder: Binder,
  node: BinderNode,
  parentId: string | null,
  index: number,
): InsertResult {
  const incomingScenes = scenesIn(node).map(pathKey);
  const incomingFolders = folderIds([node]);
  if (
    new Set(incomingScenes).size !== incomingScenes.length ||
    new Set(incomingFolders).size !== incomingFolders.length
  ) {
    return { ok: false, reason: 'duplicate' };
  }
  const existingScenes = new Set(flattenScenes(binder).map(pathKey));
  const existingFolders = new Set(folderIds(binder));
  if (
    incomingScenes.some((key) => existingScenes.has(key)) ||
    incomingFolders.some((id) => existingFolders.has(id))
  ) {
    return { ok: false, reason: 'duplicate' };
  }
  const next = withChildren(binder, parentId, (children) => {
    const at = clamp(index, children.length);
    return [...children.slice(0, at), node, ...children.slice(at)];
  });
  return next === null ? { ok: false, reason: 'parent-missing' } : { ok: true, binder: next };
}

/** Take a node (and, for a folder, everything in it) out of the tree. Null when it is not there. */
export function removeNode(binder: Binder, ref: NodeRef): { binder: Binder; node: BinderNode } | null {
  const found = locate(binder, ref);
  if (!found) return null;
  const next = withChildren(binder, found.parentId, (children) =>
    children.filter((_, index) => index !== found.index),
  );
  return next === null ? null : { binder: next, node: found.node };
}

/** True when `candidateId` is `folder` itself or a folder somewhere inside it. */
function isSelfOrDescendant(folder: FolderNode, candidateId: string): boolean {
  return folder.id === candidateId || folderIds(folder.children).includes(candidateId);
}

/**
 * Turn a placement into a concrete folder and position.
 * Returns null when the folder or the sibling it refers to is not in the tree.
 */
export function resolvePlacement(
  binder: Binder,
  placement: Placement,
): { parentId: string | null; index: number } | null {
  if (placement.at === 'start' || placement.at === 'end') {
    const children = childrenOf(binder, placement.parentId);
    if (children === null) return null;
    return { parentId: placement.parentId, index: placement.at === 'start' ? 0 : children.length };
  }
  const sibling = locate(binder, placement.sibling);
  if (!sibling) return null;
  return {
    parentId: sibling.parentId,
    index: placement.at === 'before' ? sibling.index : sibling.index + 1,
  };
}

/**
 * Where a node sits, as a placement that would put it there again: straight
 * after the node in front of it, or at the start of its folder. Null when the
 * node is not in the tree.
 */
export function placementOf(binder: Binder, ref: NodeRef): Placement | null {
  const found = locate(binder, ref);
  if (!found) return null;
  const before = found.index > 0 ? childrenOf(binder, found.parentId)?.[found.index - 1] : undefined;
  return before ? { at: 'after', sibling: refOf(before) } : { at: 'start', parentId: found.parentId };
}

export type MoveResult =
  | { readonly ok: true; readonly binder: Binder }
  | {
      readonly ok: false;
      /**
       * not-found:      the node to move is not in the tree
       * target-missing: the folder or sibling to move next to is not in the tree
       * into-itself:    a folder cannot go inside itself or one of its own folders
       * unchanged:      the node is already exactly there
       */
      readonly reason: 'not-found' | 'target-missing' | 'into-itself' | 'unchanged';
    };

/** Move a node (with everything in it) to a new place. Files on disk are not involved. */
export function moveNode(binder: Binder, ref: NodeRef, placement: Placement): MoveResult {
  const from = locate(binder, ref);
  if (!from) return { ok: false, reason: 'not-found' };

  const nextToItself =
    (placement.at === 'before' || placement.at === 'after') && sameRef(placement.sibling, ref);
  if (nextToItself) return { ok: false, reason: 'unchanged' };

  // Decide the destination folder on the tree as it is now, so the guard
  // below sees the node still in place.
  const destination = resolvePlacement(binder, placement);
  if (!destination) return { ok: false, reason: 'target-missing' };
  if (
    from.node.kind === 'folder' &&
    destination.parentId !== null &&
    isSelfOrDescendant(from.node, destination.parentId)
  ) {
    return { ok: false, reason: 'into-itself' };
  }

  // Take the node out first, then work out the position among what is left.
  const removed = removeNode(binder, ref);
  if (!removed) return { ok: false, reason: 'not-found' };
  const target = resolvePlacement(removed.binder, placement);
  if (!target) return { ok: false, reason: 'target-missing' };
  if (target.parentId === from.parentId && target.index === from.index) {
    return { ok: false, reason: 'unchanged' };
  }
  const inserted = insertNode(removed.binder, removed.node, target.parentId, target.index);
  if (!inserted.ok) return { ok: false, reason: 'target-missing' };
  return { ok: true, binder: inserted.binder };
}

/** One step towards the top of the binder, or towards its end. */
export type StepDirection = 'up' | 'down';

/**
 * Where a node goes when it is moved one step ("Move up", "Move down"): past
 * the sibling next to it or, at the edge of its folder, out to the level
 * above, straight before the folder (going up) or straight after it (going
 * down). Null when the node is not in the tree, or when it is already the
 * first (or the last) thing at the top level.
 */
export function stepPlacement(binder: Binder, ref: NodeRef, direction: StepDirection): Placement | null {
  const found = locate(binder, ref);
  if (!found) return null;
  const siblings = childrenOf(binder, found.parentId) ?? [];
  const neighbour = siblings[direction === 'up' ? found.index - 1 : found.index + 1];
  const at = direction === 'up' ? 'before' : 'after';
  if (neighbour) return { at, sibling: refOf(neighbour) };
  if (found.parentId === null) return null;
  return { at, sibling: folderRef(found.parentId) };
}

/** Give a folder a new display name. Null when the folder is not there. */
export function renameFolder(binder: Binder, id: string, name: string): Binder | null {
  const found = locate(binder, folderRef(id));
  if (!found || found.node.kind !== 'folder') return null;
  const renamed: FolderNode = { ...found.node, name };
  return withChildren(binder, found.parentId, (children) =>
    children.map((child, index) => (index === found.index ? renamed : child)),
  );
}

/**
 * Remove a folder but keep what was in it: its children move up into the
 * parent, at the place where the folder was. Null when the folder is not there.
 */
export function removeFolderKeepChildren(binder: Binder, id: string): Binder | null {
  const found = locate(binder, folderRef(id));
  if (!found || found.node.kind !== 'folder') return null;
  const kept = found.node.children;
  return withChildren(binder, found.parentId, (children) => [
    ...children.slice(0, found.index),
    ...kept,
    ...children.slice(found.index + 1),
  ]);
}

/**
 * Point a scene entry at a new path (after its note was renamed or moved).
 * Null when the old path is not in the tree, or the new one already is.
 */
export function replaceScenePath(binder: Binder, oldPath: string, newPath: string): Binder | null {
  const found = locate(binder, sceneRef(oldPath));
  if (!found) return null;
  if (pathKey(oldPath) !== pathKey(newPath) && hasScene(binder, newPath)) return null;
  const replacement: SceneNode = { kind: 'scene', path: newPath };
  return withChildren(binder, found.parentId, (children) =>
    children.map((child, index) => (index === found.index ? replacement : child)),
  );
}

/**
 * Apply several path changes at once (for example after a folder of notes
 * was renamed). They are worked out together against the tree as it is, not
 * one after another, so that two notes that swapped names are both followed.
 * A change is skipped when its old path is not in the tree, or when the tree
 * would then list its new path twice. `changed` tells whether anything was
 * replaced.
 */
export function replaceScenePaths(
  binder: Binder,
  renames: Iterable<readonly [oldPath: string, newPath: string]>,
): { binder: Binder; changed: boolean } {
  const listed = new Set(flattenScenes(binder).map(pathKey));
  // Key of the old path -> the new path, for the entries that are in the tree.
  const moves = new Map<string, string>();
  for (const [oldPath, newPath] of renames) {
    const from = pathKey(oldPath);
    if (from === pathKey(newPath) || !listed.has(from) || moves.has(from)) continue;
    moves.set(from, newPath);
  }

  // Whether a new path is free depends on the other changes: the entry that
  // holds it may itself be moving away. Dropping one change can therefore
  // block another, so look again until nothing more is dropped.
  for (let settled = false; !settled; ) {
    settled = true;
    const taken = new Set([...listed].filter((key) => !moves.has(key)));
    for (const [from, newPath] of moves) {
      const to = pathKey(newPath);
      if (taken.has(to)) {
        moves.delete(from);
        settled = false;
      } else {
        taken.add(to);
      }
    }
  }
  if (moves.size === 0) return { binder, changed: false };

  const walk = (nodes: Binder): Binder =>
    nodes.map((node): BinderNode => {
      if (node.kind === 'folder') return { ...node, children: walk(node.children) };
      const newPath = moves.get(pathKey(node.path));
      return newPath === undefined ? node : { kind: 'scene', path: newPath };
    });
  return { binder: walk(binder), changed: true };
}

/**
 * Drop repeated scene paths, keeping the first one in manuscript order.
 * Returns the paths that were dropped (empty when nothing was repeated, in
 * which case the same tree object is returned).
 */
export function dropDuplicateScenes(binder: Binder): { binder: Binder; dropped: string[] } {
  const seen = new Set<string>();
  const dropped: string[] = [];
  const walk = (nodes: Binder): Binder => {
    let changed = false;
    const out: BinderNode[] = [];
    for (const node of nodes) {
      if (node.kind === 'scene') {
        const key = pathKey(node.path);
        if (seen.has(key)) {
          dropped.push(node.path);
          changed = true;
          continue;
        }
        seen.add(key);
        out.push(node);
      } else {
        const children = walk(node.children);
        if (children !== node.children) changed = true;
        out.push(children === node.children ? node : { ...node, children });
      }
    }
    return changed ? out : nodes;
  };
  const next = walk(binder);
  return { binder: next, dropped };
}
