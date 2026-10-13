// What a scene note looks like when the plugin creates it.

import type { Frontmatter } from './types';

/** The status every new scene starts with. */
export const DEFAULT_STATUS = 'To do';

/** File name for a scene created without a usable title. */
export const DEFAULT_SCENE_NAME = 'Untitled scene';

/**
 * The properties written into a new scene, in this order.
 *
 * @param order   the scene's sort key (see orderKeys.ts)
 * @param created the local date it was created, as YYYY-MM-DD
 */
export function newSceneFrontmatter(order: number, created: string): Frontmatter {
  return {
    synopsis: '',
    status: DEFAULT_STATUS,
    label: '',
    compile: true,
    order,
    created,
  };
}

/** Format a calendar date as YYYY-MM-DD. `month` is 1 to 12. */
export function formatLocalDate(year: number, month: number, day: number): string {
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}
