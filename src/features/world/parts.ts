// Small pieces of screen the World browser and its windows are built from.

import { Notice } from 'obsidian';
import type { MenuPositionDef } from 'obsidian';
import { CARD_COLORS } from '../../core/cards';
import type { CardColor } from '../../core/cards';
import type { EntityType } from '../../core/world';
import { showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';

/** What a "more" button is called (read out, and shown as a tooltip). The binder's wording. */
export const MORE_LABEL = 'More options';

/** On something that is there but not shown at the moment. */
export const OFF_CLASS = 'spellbook-world-off';

/** On something that has a colour of its own but, for now, none of the eight. */
export const NO_COLOR_CLASS = 'spellbook-world-no-color';

/** The icon shown when a type's own is not known to this version of Obsidian. */
export const FALLBACK_ICON = 'circle';

/** How long a notice about something that went wrong stays up, in milliseconds. */
export const PROBLEM_NOTICE_MS = 10000;

export const NO_PROJECT_TEXT = 'No Spellbook project is open.';
export const READ_ONLY_TEXT = 'This project is read-only, so nothing can be changed.';

/** The icons of the browser's own buttons and menu items. */
export const WORLD_ICONS = {
  view: ['globe', 'globe-2', 'earth'],
  add: ['plus'],
  types: ['settings-2', 'settings', 'sliders-horizontal'],
  open: ['file-text', 'file'],
  openInNewTab: ['file-plus', 'file'],
  details: ['panel-right', 'info'],
  rename: ['pencil', 'edit-3'],
  remove: ['trash-2', 'trash'],
  unlink: ['x'],
  back: ['arrow-left', 'chevron-left'],
  close: ['x'],
  moveUp: ['arrow-up'],
  moveDown: ['arrow-down'],
  folder: ['folder'],
  fields: ['list'],
  sheet: ['id-card', 'contact', 'panel-right'],
  picture: ['image', 'image-plus'],
  relate: ['plus'],
  label: ['pencil', 'edit-3'],
  cards: ['layout-grid', 'grid'],
  list: ['list', 'table'],
  sortUp: ['arrow-up', 'chevron-up'],
  sortDown: ['arrow-down', 'chevron-down'],
} as const satisfies Record<string, readonly string[]>;

/**
 * The class that gives an element one of the eight colours. The stylesheet
 * maps each to Obsidian's own colour variable, so it follows the theme.
 */
export function colorClass(color: CardColor): string {
  return `spellbook-world-color-${color}`;
}

/** Give an element a colour, or none (null). Takes the colour it had away. */
export function setColor(el: HTMLElement, color: CardColor | null): void {
  for (const other of CARD_COLORS) el.toggleClass(colorClass(other), other === color);
  el.toggleClass(NO_COLOR_CLASS, color === null);
}

/** What a colour is called in a menu. */
export function colorName(color: CardColor | null): string {
  return color === null ? 'No colour' : color.charAt(0).toUpperCase() + color.slice(1);
}

/** Show something, or keep it out of sight. */
export function setShown(el: HTMLElement, shown: boolean): void {
  el.toggleClass(OFF_CLASS, !shown);
}

/** A type's icon in its colour: in front of a group, on a card, in a list. Null stands for "Other". */
export function typeBadge(parent: HTMLElement, type: EntityType | null, cls = ''): HTMLElement {
  const badge = parent.createSpan({ cls: `spellbook-world-badge ${cls}`.trim(), attr: { 'aria-hidden': 'true' } });
  setColor(badge, type?.color ?? null);
  showIcon(badge, type?.icon ?? FALLBACK_ICON, FALLBACK_ICON);
  return badge;
}

/** On the frame of a picture that shows the type's icon: the entity has no picture, or it could not be shown. */
export const NO_PICTURE_CLASS = 'spellbook-world-picture-none';

/**
 * An entity's picture in a frame: cropped to fill it, on a card and on the
 * sheet. Without a picture the frame shows the type's icon in its colour,
 * and so does a picture that turns out not to load (a file that is broken or
 * still on its way from another device).
 *
 * @param url the address of the picture (see WorldHost.imageOf), or null for none
 */
export function entityPicture(parent: HTMLElement, url: string | null, type: EntityType | null, cls = ''): HTMLElement {
  // The name beside it says who it is: the picture itself is not read out.
  const frame = parent.createDiv({ cls: `spellbook-world-picture ${cls}`.trim(), attr: { 'aria-hidden': 'true' } });
  setColor(frame, type?.color ?? null);
  const showIconInstead = (): void => {
    frame.empty();
    frame.addClass(NO_PICTURE_CLASS);
    typeBadge(frame, type);
  };
  if (url === null) {
    showIconInstead();
    return frame;
  }
  const picture = frame.createEl('img', { cls: 'spellbook-world-picture-img', attr: { src: url, alt: '', loading: 'lazy', draggable: 'false' } });
  picture.addEventListener('error', showIconInstead);
  return frame;
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
    safely(label, () => press(button));
  };
  button.addEventListener('click', (event) => {
    // A button inside a card or a row: that must not take the tap for itself.
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

/** A button with words on it. */
export function textButton(parent: HTMLElement, cls: string, text: string, press: (button: HTMLElement) => unknown): HTMLButtonElement {
  const button = parent.createEl('button', { cls, text, attr: { type: 'button' } });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    safely(text, () => press(button));
  });
  return button;
}

/** The place for a menu that opens under something. */
export function placeUnder(anchor: HTMLElement): MenuPositionDef {
  const box = anchor.getBoundingClientRect();
  return { x: box.left, y: box.bottom, width: box.width };
}

/** A type as the title of a menu item: its icon in its colour, then its name (the writer's own text). */
export function typeTitle(type: EntityType | null, name: string): DocumentFragment {
  const fragment = createFragment();
  const badge = fragment.createSpan({ cls: 'spellbook-world-badge spellbook-world-menu-badge', attr: { 'aria-hidden': 'true' } });
  setColor(badge, type?.color ?? null);
  showIcon(badge, type?.icon ?? FALLBACK_ICON, FALLBACK_ICON);
  fragment.createSpan({ cls: 'spellbook-world-menu-name', text: name, attr: { dir: 'auto' } });
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
