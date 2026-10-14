// Small pieces of screen that the corkboard, the inspector and the
// statuses-and-labels window share.

import { Notice } from 'obsidian';
import type { MenuPositionDef } from 'obsidian';
import { CARD_COLORS } from '../../core/cards';
import type { CardColor } from '../../core/cards';
import { showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';
import { PROBLEM_NOTICE_MS } from '../../ui/notices';

/** What a "more" button is called (read out, and shown as a tooltip). The binder's wording. */
export const MORE_LABEL = 'More options';

/** On something that is there but not shown at the moment. */
export const OFF_CLASS = 'spellbook-is-off';

/** A small round patch of a status's or a label's colour. */
export const SWATCH_CLASS = 'spellbook-swatch';

/** On something that has a colour of its own but, for now, none of the eight. */
export const NO_COLOR_CLASS = 'spellbook-no-color';

export { PROBLEM_NOTICE_MS };

/**
 * The class that gives an element one of the eight colours. The stylesheet
 * maps each to Obsidian's own colour variable, so it follows the theme.
 */
export function colorClass(color: CardColor): string {
  return `spellbook-color-${color}`;
}

/** Give an element a colour, or none (null). Takes the colour it had away. */
export function setColor(el: HTMLElement, color: CardColor | null): void {
  for (const other of CARD_COLORS) el.toggleClass(colorClass(other), other === color);
  el.toggleClass(NO_COLOR_CLASS, color === null);
}

/** A colour's name as a menu shows it: "Red". */
export function colorName(color: CardColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

/** Show something, or keep it out of sight. */
export function setShown(el: HTMLElement, shown: boolean): void {
  el.toggleClass(OFF_CLASS, !shown);
}

/** Set an element's text, touching the screen only when it changes. */
export function setTextOnce(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.setText(text);
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
    cls: `clickable-icon ${cls}`,
    // The label is read out by screen readers, and shown by Obsidian as a tooltip.
    attr: { role: 'button', tabindex: 0, 'aria-label': label },
  });
  showIcon(button, ...icons);
  const run = (): void => {
    if (button.getAttr('aria-disabled') === 'true') return;
    safely(label, () => press(button));
  };
  button.addEventListener('click', (event) => {
    // A button inside a card or a row: what is around it must not take the tap for itself.
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

/** Switch an icon button off (it stays in its place, greyed) or on again. */
export function setButtonOff(button: HTMLElement, off: boolean): void {
  button.setAttr('aria-disabled', off ? 'true' : null);
  button.toggleClass('spellbook-is-disabled', off);
}

/** The place for a menu that opens under a button. */
export function placeUnder(anchor: HTMLElement): MenuPositionDef {
  const box = anchor.getBoundingClientRect();
  return { x: box.left, y: box.bottom, width: box.width };
}

/**
 * A status or a label as the title of a menu item: a patch of its colour,
 * then its name.
 *
 * @param ownText true when the name is the writer's own text, which chooses
 *                its own direction; false for a word of the app's own (the
 *                name of a colour)
 */
export function tagTitle(name: string, color: CardColor | null, ownText = true): DocumentFragment {
  const fragment = createFragment();
  setColor(fragment.createSpan({ cls: SWATCH_CLASS }), color);
  const text = fragment.createSpan({ cls: 'spellbook-menu-name', text: name });
  if (ownText) text.setAttr('dir', 'auto');
  return fragment;
}

/**
 * Wait for the host's answer to a request. When it says why it could not be
 * done, or fails, the writer is told in a notice.
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
