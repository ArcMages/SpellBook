// What a scene note looks like when the plugin creates it.

import type { Frontmatter } from './types';

export { formatLocalDate } from './dates';

/** The stages a scene goes through, from not started to finished. */
export const SCENE_STATUSES = ['To do', 'First draft', 'Revised', 'Final'] as const;

/** The status every new scene starts with. */
export const DEFAULT_STATUS: string = SCENE_STATUSES[0];

/** File name for a scene created without a usable title. */
export const DEFAULT_SCENE_NAME = 'Untitled scene';

/** The properties of a new scene that a caller may fill in; the rest are fixed. */
export interface SceneDetails {
  readonly synopsis?: string;
  readonly status?: string;
  readonly label?: string;
}

/**
 * The properties written into a new scene, in this order.
 *
 * @param order   the scene's sort key (see orderKeys.ts)
 * @param created the local date it was created, as YYYY-MM-DD
 * @param details synopsis, status and label, for a scene that starts with them
 */
export function newSceneFrontmatter(order: number, created: string, details: SceneDetails = {}): Frontmatter {
  return {
    synopsis: details.synopsis ?? '',
    status: details.status ?? DEFAULT_STATUS,
    label: details.label ?? '',
    compile: true,
    order,
    created,
  };
}
