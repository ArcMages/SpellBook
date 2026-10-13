// Small pieces of screen the outliner is built from.

import { Notice } from 'obsidian';
import type { MenuPositionDef } from 'obsidian';
import { CARD_COLORS } from '../../core/cards';
import type { CardColor } from '../../core/cards';
import { showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';

/** What a "more" button is called (read out, and shown as a tooltip). The binder's wording. */
export const MORE_LABEL = 'More options';

/** On something that is there but not shown at the moment. */
export const OFF_CLASS = 'spellbook-outliner-off';

/** A small round patch of a status's or a label's colour. */
export const DOT_CLASS = 'spellbook-outliner-dot';

/** On something that has a colour of its own but, for now, none of the eight. */
export const NO_COLOR_CLASS = 'spellbook-outliner-no-color';

/** On whatever a press must not pick up for dragging: buttons, tick boxes, fields. */
export const NO_DRAG_CLASS = 'spellbook-outliner-nodrag';

/** How long a notice about something that went wrong stays up, in milliseconds. */
export const PROBLEM_NOTICE_MS = 10000;

/**
 * The class that gives an element one of the eight colours. The stylesheet
 * maps each to Obsidian's own colour variable, so it follows the theme.
 */
export function colorClass(color: CardColor): string {
  return `spellbook-outliner-color-${color}`;
}

/** Give an element a colour, or none (null). Takes the colour it had away. */
export function setColor(el: HTMLElement, color: CardColor | null): void {
  for (const other of CARD_COLORS) el.toggleClass(colorClass(other), other === color);
  el.toggleClass(NO_COLOR_CLASS, color === null);
}

/** Show something, or keep it out of sight. */
export function setShown(el: HTMLElement, shown: boolean): void {
  el.toggleClass(OFF_CLASS, !shown);
}

/**
 * A small button that shows an icon, built the way Obsidian builds its own
 * (so that themes style it). It can be reached and pressed from the keyboard.
 *
 * @param press what a tap does; it is handed the button, to show a menu under it
 */
export function iconButton(
  parent: HTMLElement,
  cls: string,
  label: string,
  icons: readonly string[],
  press: (button: HTMLElement) => unknown,
): HTMLElement {
  const button = parent.createDiv({
    cls: `clickable-icon ${NO_DRAG_CLASS} ${cls}`,
    // The label is read out by screen readers, and shown by Obsidian as a tooltip.
    attr: { role: 'button', tabindex: 0, 'aria-label': label },
  });
  showIcon(button, ...icons);
  const run = (): void => {
    safely(label, () => press(button));
  };
  button.addEventListener('click', (event) => {
    // A button inside a row: the row must not take the tap for itself.
    event.stopPropagation();
    run();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    run();
  });
  return button;
}

/** A button with words on it, for the bar above the table. */
export function textButton(parent: HTMLElement, cls: string, text: string, press: (button: HTMLElement) => unknown): HTMLElement {
  const button = parent.createEl('button', { cls, text, attr: { type: 'button' } });
  button.addEventListener('click', () => {
    safely(text, () => press(button));
  });
  return button;
}

/** The place for a menu that opens under something. */
export function placeUnder(anchor: HTMLElement): MenuPositionDef {
  const box = anchor.getBoundingClientRect();
  return { x: box.left, y: box.bottom, width: box.width };
}

/** A status or a label as the title of a menu item: a patch of its colour, then its name (the writer's own text). */
export function tagTitle(name: string, color: CardColor | null): DocumentFragment {
  const fragment = createFragment();
  setColor(fragment.createSpan({ cls: DOT_CLASS }), color);
  fragment.createSpan({ cls: 'spellbook-outliner-menu-name', text: name, attr: { dir: 'auto' } });
  return fragment;
}

/**
 * Wait for the answer to a request for a change. When it says why it could
 * not be done, or fails, the writer is told in a notice.
 *
 * @returns true when it was done
 */
export async function settle(answer: Promise<string | null>): Promise<boolean> {
  let message: string | null;
  try {
    message = await answer;
  } catch (error) {
    console.error('Spellbook: a change could not be saved', error);
    message = error instanceof Error ? error.message : String(error);
  }
  if (message === null) return true;
  new Notice(message, PROBLEM_NOTICE_MS);
  return false;
}
