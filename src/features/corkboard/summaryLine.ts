// The line at the top of the inspector in the touch layout: the open scene's
// word count and dates, and the session and project totals, and after them
// the shortcut buttons the writer put in the bottom bar.
//
// On a desktop Obsidian shows that line in its bottom bar. Obsidian gives
// plugins no bottom bar on a phone or tablet ("not available on mobile"), so
// there the inspector always shows it, whatever the layout setting: that is
// about what the device has, not about the layout. In the touch layout on a
// computer it is shown there too. The line itself belongs
// to another screen of the plugin (the writing progress), which offers it to
// the others under a name; this file only puts it on the screen. When nobody
// offers it, nothing is shown.

import { Platform, getIcon, setIcon } from 'obsidian';
import { isTouchLayout, onLayoutChange } from '../../ui/layout';
// The line's name and its shape are declared once, in the core, for the
// screen that offers it and for this one that shows it.
import { SCENE_LINE_SERVICE } from '../../core/progress/index';
import type { SceneLineButton, SceneLineService, StatusSegment } from '../../core/progress/index';
import type { FeatureClock, FeatureServices } from '../registry';

/**
 * Whether what was found under the line's name can be used as the line. It
 * is looked up by name, so it is checked before it is trusted.
 */
function isSceneLine(value: unknown): value is SceneLineService {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Partial<SceneLineService>;
  return typeof line.current === 'function' && typeof line.onChange === 'function';
}

/** Whether what a line gave as a button can be drawn as one. */
function isButton(value: unknown): value is SceneLineButton {
  if (typeof value !== 'object' || value === null) return false;
  const button = value as Partial<SceneLineButton>;
  return (
    typeof button.command === 'string' &&
    typeof button.label === 'string' &&
    typeof button.name === 'string' &&
    typeof button.available === 'boolean' &&
    (button.icon === null || typeof button.icon === 'string')
  );
}

/** Whether Obsidian knows an icon by this name. An icon it does not know is never drawn. */
function hasIcon(icon: string | null): icon is string {
  if (icon === null) return false;
  try {
    return getIcon(icon) !== null;
  } catch {
    return false;
  }
}

function drawFigures(place: HTMLElement, line: SceneLineService): void {
  let segments: readonly StatusSegment[] = [];
  try {
    const now: unknown = line.current();
    if (Array.isArray(now)) segments = now as StatusSegment[];
  } catch (error) {
    console.error('Spellbook: the word count line could not be read', error);
  }
  place.empty();
  for (const segment of segments) {
    if (typeof segment?.label !== 'string' || typeof segment.value !== 'string') continue;
    // A word of the app's own and a number or a date: read left to right in every language.
    const item = place.createSpan({ cls: 'spellbook-summary-item', attr: { dir: 'ltr' } });
    item.createSpan({ cls: 'spellbook-summary-label', text: segment.label });
    // The writer's own text (a status, a scene's title) picks its own direction.
    item.createSpan({ cls: 'spellbook-summary-value', text: segment.value, attr: segment.ownText === true ? { dir: 'auto' } : {} });
  }
}

/** The buttons a line offers now; none when it offers none, or they cannot be read. */
function buttonsOf(line: SceneLineService): SceneLineButton[] {
  if (typeof line.buttons !== 'function' || typeof line.run !== 'function') return [];
  try {
    const now: unknown = line.buttons();
    return Array.isArray(now) ? now.filter(isButton) : [];
  } catch (error) {
    console.error('Spellbook: the shortcut buttons could not be read', error);
    return [];
  }
}

function drawButton(place: HTMLElement, line: SceneLineService, button: SceneLineButton): void {
  const title = button.label !== '' && button.label !== button.name ? `${button.label}: ${button.name}` : button.name;
  const root = place.createSpan({
    cls: 'spellbook-summary-button',
    attr: {
      role: 'button',
      tabindex: 0,
      'aria-label': button.available ? title : `${title} (this command is not available)`,
    },
  });
  // A button whose command is not there (its plugin is switched off): dimmed.
  if (!button.available) {
    root.addClass('spellbook-is-unavailable');
    root.setAttr('aria-disabled', 'true');
  }
  const withIcon = hasIcon(button.icon);
  if (withIcon) {
    const icon = root.createSpan({ cls: 'spellbook-summary-button-icon', attr: { 'aria-hidden': 'true' } });
    setIcon(icon, button.icon as string);
  }
  // Without an icon the button must say something: its label, or else what the command is called.
  const text = button.label !== '' ? button.label : withIcon ? '' : button.name;
  if (text !== '') root.createSpan({ cls: 'spellbook-summary-button-label', text, attr: { dir: 'auto' } });

  const run = (): void => {
    try {
      line.run?.(button.command);
    } catch (error) {
      console.error(`Spellbook: the command "${button.command}" could not be run`, error);
    }
  };
  root.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation?.();
    run();
  });
  root.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault?.();
    event.stopPropagation?.();
    run();
  });
}

/** What the slot holds: the figures, and after them the buttons (only while there are some). */
interface Drawing {
  readonly figures: HTMLElement;
  buttons: HTMLElement | null;
  /** The buttons as they were drawn, to tell when they must be drawn again. */
  drawnButtons: string;
}

/** The class the slot has while the line has nothing in it, so that it takes no room. */
const EMPTY_CLASS = 'spellbook-summary-is-empty';

function draw(slot: HTMLElement, line: SceneLineService, drawing: Drawing): void {
  drawFigures(drawing.figures, line);
  drawButtons(slot, line, drawing);
  slot.toggleClass(EMPTY_CLASS, drawing.figures.children.length === 0 && drawing.buttons === null);
}

function drawButtons(slot: HTMLElement, line: SceneLineService, drawing: Drawing): void {
  // The buttons are left standing while they are the same: a figure that
  // changes while a finger is on a button does not take the button away.
  const buttons = buttonsOf(line);
  const wanted = JSON.stringify(buttons);
  if (wanted === drawing.drawnButtons) return;
  drawing.drawnButtons = wanted;
  drawing.buttons?.remove();
  drawing.buttons = null;
  if (buttons.length === 0) return;
  const place = slot.createDiv({ cls: 'spellbook-summary-buttons', attr: { role: 'group', 'aria-label': 'Shortcuts' } });
  drawing.buttons = place;
  for (const button of buttons) drawButton(place, line, button);
}

/**
 * Fill the empty place at the top of the inspector with the line, and keep it
 * up to date. Shows nothing in the desktop layout on a computer, and nothing
 * when no line is offered.
 *
 * @param slot the empty element at the top of the inspector
 * @returns the function to call when the inspector closes
 */
export function mountSceneLine(
  slot: HTMLElement,
  services: Pick<FeatureServices, 'get'>,
  clock: Pick<FeatureClock, 'setTimer'>,
): () => void {
  let unmount: (() => void) | null = null;
  const follow = (): void => {
    const wanted = sceneLineInInspector();
    if (wanted && !unmount) unmount = showSceneLine(slot, services, clock);
    else if (!wanted && unmount) {
      unmount();
      unmount = null;
    }
  };
  follow();
  // The layout setting can change while the inspector is open.
  const stopFollowing = onLayoutChange(follow);
  return () => {
    stopFollowing();
    unmount?.();
    unmount = null;
  };
}

/**
 * Whether the inspector shows the line: on a phone or tablet, where a plugin
 * may get no bottom bar (a CAPABILITY: Platform.isMobile, whatever the
 * layout), and in the touch layout (a LAYOUT choice).
 */
export function sceneLineInInspector(): boolean {
  return Platform.isMobile || isTouchLayout();
}

function showSceneLine(
  slot: HTMLElement,
  services: Pick<FeatureServices, 'get'>,
  clock: Pick<FeatureClock, 'setTimer'>,
): () => void {
  let stopped = false;
  let stopListening: (() => void) | null = null;
  let stopWaiting: (() => void) | null = null;

  /** @returns whether the line was there to show */
  const start = (): boolean => {
    const line: unknown = services.get(SCENE_LINE_SERVICE);
    if (!isSceneLine(line)) return false;
    slot.empty();
    const drawing: Drawing = { figures: slot.createSpan({ cls: 'spellbook-summary-figures' }), buttons: null, drawnButtons: '[]' };
    draw(slot, line, drawing);
    stopListening = line.onChange(() => {
      if (!stopped) draw(slot, line, drawing);
    });
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

  return () => {
    stopped = true;
    stopWaiting?.();
    stopWaiting = null;
    stopListening?.();
    stopListening = null;
    slot.removeClass(EMPTY_CLASS);
    slot.empty();
  };
}
