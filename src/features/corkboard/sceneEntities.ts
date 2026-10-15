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
import { PROBLEM_NOTICE_MS } from '../../ui/notices';

export const SCENE_ENTITIES_HEADING = 'In this scene';
/** The same heading for a note that is a whole chapter. */
export const CHAPTER_ENTITIES_HEADING = 'In this chapter';
export const SCENE_ENTITIES_NONE = 'Nobody and nothing yet.';
export const SCENE_ENTITIES_ADD = 'Add';
// The dot between a name and an age, built from its number so that this file stays plain ASCII.
const MIDDLE_DOT = String.fromCharCode(0xb7);

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

function draw(slot: HTMLElement, service: SceneEntitiesService, path: string | null, chapter: boolean): void {
  slot.empty();
  if (path === null) return;
  const canChange = service.canChange() === true;
  const heading = chapter ? CHAPTER_ENTITIES_HEADING : SCENE_ENTITIES_HEADING;
  const noun = chapter ? 'chapter' : 'scene';
  const part = slot.createDiv({ cls: 'spellbook-inspector-entities' });
  part.createDiv({ cls: 'spellbook-field-name spellbook-inspector-entities-head', text: heading });
  const chips = chipsOf(service, path);
  const list = part.createDiv({ cls: 'spellbook-inspector-entities-chips', attr: { role: 'list' } });
  if (chips.length === 0) list.createSpan({ cls: 'spellbook-inspector-entities-none', text: SCENE_ENTITIES_NONE });

  for (const chip of chips) {
    const item = list.createSpan({ cls: 'spellbook-entity-chip', attr: { role: 'listitem' } });
    // The chip takes its type's colour from the world-building stylesheet.
    item.addClass(typeof chip.color === 'string' ? `spellbook-world-color-${chip.color}` : 'spellbook-world-no-color');
    item.toggleClass('spellbook-entity-chip-lost', chip.found !== true);
    const age = typeof chip.age === 'number' && Number.isFinite(chip.age) ? chip.age : null;
    const warning = typeof chip.warning === 'string' && chip.warning !== '' ? chip.warning : null;
    item.toggleClass('spellbook-entity-chip-warned', warning !== null);
    // What is read out: the name, its age or its warning, its type.
    const said = [chip.name, ...(age !== null ? [`age ${age}`] : []), ...(warning !== null ? [warning] : [])].join(', ');
    const open = item.createEl('button', {
      cls: 'spellbook-entity-chip-open',
      attr: { type: 'button', ...(chip.typeName || age !== null || warning !== null ? { 'aria-label': chip.typeName ? `${said} (${chip.typeName})` : said } : {}) },
    });
    if (typeof chip.icon === 'string' && chip.icon !== '') {
      showIcon(open.createSpan({ cls: 'spellbook-entity-chip-icon', attr: { 'aria-hidden': 'true' } }), chip.icon, 'circle');
    }
    // An entity's name is the writer's own text.
    open.createSpan({ cls: 'spellbook-entity-chip-name', text: chip.name, attr: { dir: 'auto' } });
    // Its age at the scene's date: "Wren · 14".
    if (age !== null) open.createSpan({ cls: 'spellbook-entity-chip-age', text: `${MIDDLE_DOT} ${age}`, attr: { dir: 'ltr', 'aria-hidden': 'true' } });
    // Not born yet, or already dead, at the scene's date: a small mark, its words as a tooltip.
    if (warning !== null) {
      const mark = open.createSpan({ cls: 'spellbook-entity-chip-warning', attr: { 'aria-label': warning, title: warning } });
      showIcon(mark, 'alert-triangle', 'alert-circle');
    }
    open.disabled = chip.found !== true;
    open.addEventListener('click', () => {
      safely(chip.name, () => {
        service.open(path, chip.key);
      });
    });
    if (!canChange) continue;
    const remove = item.createEl('button', {
      cls: 'spellbook-entity-chip-remove',
      attr: { type: 'button', 'aria-label': `Take ${chip.name} out of this ${noun}` },
    });
    showIcon(remove, 'x');
    remove.addEventListener('click', () => {
      safely(`Take out of this ${noun}`, async () => {
        const problem = await service.remove(path, chip.key);
        if (typeof problem === 'string') new Notice(problem, PROBLEM_NOTICE_MS);
      });
    });
  }

  if (!canChange) return;
  const add = part.createEl('button', { cls: 'spellbook-inspector-entities-add', text: SCENE_ENTITIES_ADD, attr: { type: 'button' } });
  add.addEventListener('click', () => {
    safely(heading, () => {
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
  isChapter: (path: string) => boolean = () => false,
): SceneEntitiesPart {
  let stopped = false;
  let service: SceneEntitiesService | null = null;
  let stopListening: (() => void) | null = null;
  let stopWaiting: (() => void) | null = null;

  const refresh = (): void => {
    if (stopped || service === null) return;
    const path = scenePath();
    draw(slot, service, path, path !== null && isChapter(path));
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
