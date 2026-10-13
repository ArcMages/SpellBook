// What this screen offers the inspector: who and what is in a scene, and the
// ways to change that (see src/core/world/services.ts for the name and the
// shape). Everything it says comes from the host; it keeps nothing itself.

import type { App } from 'obsidian';
import type { SceneEntitiesService, SceneEntityChip } from '../../core/world';
import type { WorldHost } from './host';
import { openEntityPicker } from './pickerModal';

export function sceneEntitiesService(app: App, host: WorldHost): SceneEntitiesService {
  return {
    of: (scenePath) =>
      host.links.linksOf(scenePath).map((link): SceneEntityChip => {
        const type = link.entity === null ? null : host.typeOf(link.entity);
        return {
          key: link.raw,
          name: link.label,
          typeName: type?.name ?? '',
          color: type?.color ?? null,
          icon: type?.icon ?? null,
          found: link.entity !== null,
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
