// Which scenes the continuous manuscript shows (the whole manuscript, or one
// folder of the binder), and how the scenes on show are carried over when the
// binder changes: a scene that was moved, or renamed, keeps what was drawn
// for it, and only what is new is made.

import { pathKey } from '../paths';
import { resolveScope } from '../report/scope';
import type { TreeNode } from '../types';

export type ScriveningsScope = { readonly kind: 'manuscript' } | { readonly kind: 'folder'; readonly id: string };

export function sameScriveningsScope(a: ScriveningsScope, b: ScriveningsScope): boolean {
  if (a.kind === 'folder' && b.kind === 'folder') return a.id === b.id;
  return a.kind === b.kind;
}

/** A scene as the binder lists it. */
export interface ListedScene {
  /** Path relative to the project folder; the scene's identity. */
  readonly path: string;
  readonly title: string;
  /** True when the binder lists the scene but its note is not in the vault. */
  readonly missing: boolean;
}

/** The scenes of a scope in manuscript order. Null when the scope's folder is no longer in the binder. */
export function scenesOfScope(tree: readonly TreeNode[], scope: ScriveningsScope): ListedScene[] | null {
  const found = resolveScope(tree, scope, null);
  if (found.kind === 'no-folder' || found.kind === 'no-scene') return null;
  return [...found.scenes];
}

/** What is known of a scene that is on show: its path in the binder, and where its note is in the vault. */
export interface ShownScene {
  readonly path: string;
  /** Null when the scene has no note. */
  readonly vaultPath: string | null;
}

/**
 * For every scene of the new list, the scene on show that it carries on from
 * (its place in `shown`), or -1 when it is new.
 *
 * A scene is the same scene when its path is the same. A scene whose note
 * was renamed has another path: it is known again by the vault's own word
 * (`renamed`: where a note was, where it is now) or, when that word has not
 * come yet, by being the one scene that left and the one that came in the
 * same place of the list.
 *
 * @param renamed vault paths that changed: the old path (as pathKey spells it) to the new one
 */
export function carryOver(shown: readonly ShownScene[], next: readonly ShownScene[], renamed: ReadonlyMap<string, string>): number[] {
  const byPath = new Map<string, number>();
  shown.forEach((scene, at) => byPath.set(scene.path, at));
  const from = next.map((scene) => byPath.get(scene.path) ?? -1);
  const taken = new Set(from.filter((at) => at >= 0));
  const left = shown.map((_, at) => at).filter((at) => !taken.has(at));
  if (left.length === 0) return from;

  const byNewVaultPath = new Map<string, number>();
  for (const at of left) {
    const vaultPath = shown[at]?.vaultPath ?? null;
    const now = vaultPath === null ? undefined : renamed.get(pathKey(vaultPath));
    if (now !== undefined) byNewVaultPath.set(pathKey(now), at);
  }
  const came: number[] = [];
  next.forEach((scene, at) => {
    if (from[at] !== -1) return;
    const old = scene.vaultPath === null ? undefined : byNewVaultPath.get(pathKey(scene.vaultPath));
    if (old !== undefined && !taken.has(old)) {
      from[at] = old;
      taken.add(old);
    } else {
      came.push(at);
    }
  });

  // One left and one came, at the same place of the list: the same scene under another name.
  const stillLeft = left.filter((at) => !taken.has(at));
  if (stillLeft.length === 1 && came.length === 1 && shown.length === next.length && stillLeft[0] === came[0]) {
    from[came[0] as number] = stillLeft[0] as number;
  }
  return from;
}
