// What this screen offers the inspector: who and what is in a scene, and the
// ways to change that (see src/core/world/services.ts for the name and the
// shape). Everything it says comes from the host; it keeps nothing itself.

import type { App } from 'obsidian';
import type { AgeAt, SceneEntitiesService, SceneEntityChip } from '../../core/world';
import type { WorldHost } from './host';
import { openEntityPicker } from './pickerModal';

export const UNBORN_IN_SCENE_TEXT = 'not born yet in this scene';
export const DEAD_IN_SCENE_TEXT = 'died before this scene';

/** The continuity warning for an entity at a scene's date; null for none. */
export function ageWarning(age: AgeAt | null | undefined): string | null {
  if (age?.kind === 'unborn') return UNBORN_IN_SCENE_TEXT;
  if (age?.kind === 'dead') return DEAD_IN_SCENE_TEXT;
  return null;
}

export function sceneEntitiesService(app: App, host: WorldHost): SceneEntitiesService {
  return {
    of: (scenePath) =>
      host.links.linksOf(scenePath).map((link): SceneEntityChip => {
        const type = link.entity === null ? null : host.typeOf(link.entity);
        const age = link.entity === null ? null : host.ageInScene(link.entity, scenePath);
        return {
          key: link.raw,
          name: link.label,
          typeName: type?.name ?? '',
          color: type?.color ?? null,
          icon: type?.icon ?? null,
          found: link.entity !== null,
          age: age?.kind === 'age' ? age.years : null,
          warning: ageWarning(age),
        };
      }),
    canChange: () => host.canChange,
    add: (scenePath) => {
      openEntityPicker(app, host, scenePath);
    },
    remove: (scenePath, key) => host.unlink(scenePath, { raw: key }),
    open: (scenePath, key) => {
      const entity = host.links.linksOf(scenePath).find((link) => link.raw === key)?.entity;
      if (entity) void host.open(entity.path, false);
    },
    onChange: (listener) => host.onChange(listener),
  };
}
