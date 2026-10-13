// What a writing report is about: the scene that is open, a folder of the
// binder (a chapter), or the whole manuscript in binder order.

import type { TreeNode } from '../types';

export type ReportScope =
  | { readonly kind: 'scene' }
  | { readonly kind: 'folder'; readonly id: string }
  | { readonly kind: 'manuscript' };

/** A folder of the binder, as the scope menu lists it. */
export interface ScopeFolder {
  readonly id: string;
  /** The folder's name: the writer's own text. */
  readonly name: string;
  /** How deep it sits: 0 for a folder at the top of the binder. */
  readonly depth: number;
}

/** A scene a report reads. */
export interface ScopeScene {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
  /** True when the binder lists the scene but its note is not in the vault. */
  readonly missing: boolean;
}

/** What a scope comes to in the binder as it is now. */
export type ScopeSubject =
  | { readonly kind: 'scene'; readonly title: string; readonly scenes: readonly ScopeScene[] }
  | { readonly kind: 'folder'; readonly title: string; readonly scenes: readonly ScopeScene[] }
  | { readonly kind: 'manuscript'; readonly scenes: readonly ScopeScene[] }
  /** The note that is open is not a scene of the binder (or no note is open). */
  | { readonly kind: 'no-scene' }
  /** The folder is no longer in the binder. */
  | { readonly kind: 'no-folder' };

export function sameScope(a: ReportScope, b: ReportScope): boolean {
  if (a.kind === 'folder' && b.kind === 'folder') return a.id === b.id;
  return a.kind === b.kind;
}

/** Every folder of the binder, top to bottom, each with how deep it sits. */
export function foldersOf(tree: readonly TreeNode[]): ScopeFolder[] {
  const folders: ScopeFolder[] = [];
  const walk = (nodes: readonly TreeNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      folders.push({ id: node.id, name: node.name, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return folders;
}

/** Every scene under some rows of the binder, in manuscript order. */
export function scenesUnder(nodes: readonly TreeNode[]): ScopeScene[] {
  const scenes: ScopeScene[] = [];
  const walk = (rows: readonly TreeNode[]): void => {
    for (const node of rows) {
      if (node.kind === 'folder') walk(node.children);
      else scenes.push({ path: node.path, title: node.title, missing: node.missing });
    }
  };
  walk(nodes);
  return scenes;
}

function findFolder(nodes: readonly TreeNode[], id: string): (TreeNode & { kind: 'folder' }) | null {
  for (const node of nodes) {
    if (node.kind !== 'folder') continue;
    if (node.id === id) return node;
    const inside = findFolder(node.children, id);
    if (inside) return inside;
  }
  return null;
}

/**
 * The scenes a scope stands for.
 *
 * @param openScene the scene that is open, as the binder spells its path; null when none is
 */
export function resolveScope(tree: readonly TreeNode[], scope: ReportScope, openScene: string | null): ScopeSubject {
  switch (scope.kind) {
    case 'manuscript':
      return { kind: 'manuscript', scenes: scenesUnder(tree) };
    case 'folder': {
      const folder = findFolder(tree, scope.id);
      return folder ? { kind: 'folder', title: folder.name, scenes: scenesUnder(folder.children) } : { kind: 'no-folder' };
    }
    case 'scene': {
      const scene = openScene === null ? undefined : scenesUnder(tree).find((candidate) => candidate.path === openScene);
      return scene ? { kind: 'scene', title: scene.title, scenes: [scene] } : { kind: 'no-scene' };
    }
  }
}
