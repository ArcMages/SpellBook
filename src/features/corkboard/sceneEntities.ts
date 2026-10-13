// "In this scene": the characters, places and other entities the open scene
// lists, as chips in the inspector, with a button to add one and a small
// button on each to take it out again.
//
// Who is in a scene, and everything that changes it, belongs to another
// screen of the plugin (the world-building), which offers it to the others
// under a name; this file only puts it on the screen. When nobody offers it,
// or no scene is open, nothing is shown.

import { Notice } from 'obsidian';
// The service's name and its shape are declared once, in the core, for the
// screen that offers it and for this one that shows it.
import { SCENE_ENTITIES_SERVICE } from '../../core/world/index';
import type { SceneEntitiesService, SceneEntityChip } from '../../core/world/index';
import { showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';
import type { FeatureClock, FeatureServices } from '../registry';
import type { SceneEntitiesPart } from './host';

export const SCENE_ENTITIES_HEADING = 'In this scene';
export const SCENE_ENTITIES_NONE = 'Nobody and nothing yet.';
export const SCENE_ENTITIES_ADD = 'Add';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

/**
 * Whether what was found under the service's name can be used. It is looked
 * up by name, so it is checked before it is trusted.
 */
function isSceneEntities(value: unknown): value is SceneEntitiesService {
  if (typeof value !== 'object' || value === null) return false;
  const service = value as Partial<SceneEntitiesService>;
  return (
    typeof service.of === 'function' &&
    typeof service.canChange === 'function' &&
    typeof service.add === 'function' &&
    typeof service.remove === 'function' &&
    typeof service.open === 'function' &&
    typeof service.onChange === 'function'
  );
}

function chipsOf(service: SceneEntitiesService, path: string): readonly SceneEntityChip[] {
  try {
    const chips: unknown = service.of(path);
    return Array.isArray(chips) ? (chips as SceneEntityChip[]).filter((chip) => typeof chip?.key === 'string' && typeof chip.name === 'string') : [];
  } catch (error) {
    console.error('Spellbook: the entities of the scene could not be read', error);
    return [];
  }
}

function draw(slot: HTMLElement, service: SceneEntitiesService, path: string | null): void {
  slot.empty();
  if (path === null) return;
  const canChange = service.canChange() === true;
  const part = slot.createDiv({ cls: 'spellbook-inspector-entities' });
  part.createDiv({ cls: 'spellbook-field-name spellbook-inspector-entities-head', text: SCENE_ENTITIES_HEADING });
  const chips = chipsOf(service, path);
  const list = part.createDiv({ cls: 'spellbook-inspector-entities-chips', attr: { role: 'list' } });
  if (chips.length === 0) list.createSpan({ cls: 'spellbook-inspector-entities-none', text: SCENE_ENTITIES_NONE });

  for (const chip of chips) {
    const item = list.createSpan({ cls: 'spellbook-entity-chip', attr: { role: 'listitem' } });
    // The chip takes its type's colour from the world-building stylesheet.
    item.addClass(typeof chip.color === 'string' ? `spellbook-world-color-${chip.color}` : 'spellbook-world-no-color');
    item.toggleClass('spellbook-entity-chip-lost', chip.found !== true);
    const open = item.createEl('button', {
      cls: 'spellbook-entity-chip-open',
      attr: { type: 'button', ...(chip.typeName ? { 'aria-label': `${chip.name} (${chip.typeName})` } : {}) },
    });
    if (typeof chip.icon === 'string' && chip.icon !== '') {
      showIcon(open.createSpan({ cls: 'spellbook-entity-chip-icon', attr: { 'aria-hidden': 'true' } }), chip.icon, 'circle');
    }
    // An entity's name is the writer's own text.
    open.createSpan({ cls: 'spellbook-entity-chip-name', text: chip.name, attr: { dir: 'auto' } });
    open.disabled = chip.found !== true;
    open.addEventListener('click', () => {
      safely(chip.name, () => {
        service.open(path, chip.key);
      });
    });
    if (!canChange) continue;
    const remove = item.createEl('button', {
      cls: 'spellbook-entity-chip-remove',
      attr: { type: 'button', 'aria-label': `Take ${chip.name} out of this scene` },
    });
    showIcon(remove, 'x');
    remove.addEventListener('click', () => {
      safely('Take out of this scene', async () => {
        const problem = await service.remove(path, chip.key);
        if (typeof problem === 'string') new Notice(problem, PROBLEM_NOTICE_MS);
      });
    });
  }

  if (!canChange) return;
  const add = part.createEl('button', { cls: 'spellbook-inspector-entities-add', text: SCENE_ENTITIES_ADD, attr: { type: 'button' } });
  add.addEventListener('click', () => {
    safely(SCENE_ENTITIES_HEADING, () => {
      service.add(path);
    });
  });
}

/**
 * Fill a place in the inspector with the entities of the scene it shows, and
 * keep it up to date. Shows nothing when no such service is offered.
 *
 * @param slot      the empty element in the inspector
 * @param scenePath the scene the inspector shows now (relative to the project folder), or null
 */
export function mountSceneEntities(
  slot: HTMLElement,
  services: Pick<FeatureServices, 'get'>,
  clock: Pick<FeatureClock, 'setTimer'>,
  scenePath: () => string | null,
): SceneEntitiesPart {
  let stopped = false;
  let service: SceneEntitiesService | null = null;
  let stopListening: (() => void) | null = null;
  let stopWaiting: (() => void) | null = null;

  const refresh = (): void => {
    if (stopped || service === null) return;
    draw(slot, service, scenePath());
  };

  /** @returns whether the service was there */
  const start = (): boolean => {
    const found: unknown = services.get(SCENE_ENTITIES_SERVICE);
    if (!isSceneEntities(found)) return false;
    service = found;
    stopListening = found.onChange(refresh);
    refresh();
    return true;
  };

  // An inspector that Obsidian puts back at start-up may open while the
  // screens are still plugging themselves in: look once more in a moment.
  if (!start()) {
    stopWaiting = clock.setTimer(() => {
      stopWaiting = null;
      if (!stopped) start();
    }, 0);
  }

  return {
    refresh,
    stop: () => {
      stopped = true;
      stopWaiting?.();
      stopWaiting = null;
      stopListening?.();
      stopListening = null;
      service = null;
      slot.empty();
    },
  };
}
