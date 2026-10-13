// Reading the binder panel in tests: what a writer would see and tap, taken
// from the stand-in elements (tests/obsidianStub.ts).

import type { FakeElement, FakeEvent } from './obsidianStub';

/** The one element with this class inside `pane`, or a failed test. */
export function one(pane: FakeElement, cls: string): FakeElement {
  const found = pane.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The first element with this class inside a row, if any. */
export function partOf(row: FakeElement, cls: string): FakeElement | undefined {
  return row.withClass(cls)[0];
}

/**
 * The list as a reader sees it, one line per row:
 *   "v" in front of something that can be folded and is open, ">" when it is
 *   folded shut (what is inside is then hidden), "!" for a missing entry;
 *   then the title, the word count, " -- " and a second line if there is
 *   one, and " *" for the active note. Other text is shown in brackets.
 */
export function picture(pane: FakeElement): string[] {
  const lines: string[] = [];
  const walk = (container: FakeElement, depth: number): void => {
    for (const item of container.children) {
      const indent = '  '.repeat(depth);
      if (!item.hasClass('spellbook-row')) {
        lines.push(`${indent}(${item.fullText})`);
        continue;
      }
      const self = item.children.find((child) => child.hasClass('spellbook-row-self')) as FakeElement;
      const inside = item.children.find((child) => child.hasClass('spellbook-children'));
      const folded = item.hasClass('is-collapsed');
      const mark = inside ? (folded ? '> ' : 'v ') : item.hasClass('spellbook-is-missing') ? '! ' : '';
      const count = partOf(self, 'spellbook-count')?.text ?? '';
      const note = partOf(self, 'spellbook-row-note')?.text ?? '';
      lines.push(
        `${indent}${mark}${partOf(self, 'spellbook-title')?.text ?? ''}` +
          `${count === '' ? '' : ` ${count}`}${note === '' ? '' : ` -- ${note}`}${self.hasClass('is-active') ? ' *' : ''}`,
      );
      if (inside && !folded) walk(inside, depth + 1);
    }
  };
  walk(one(pane, 'spellbook-binder-body'), 0);
  return lines;
}

/** The row with this title (the part that is tapped). */
export function rowOf(pane: FakeElement, title: string): FakeElement {
  const found = pane.withClass('spellbook-row-self').filter((self) => partOf(self, 'spellbook-title')?.text === title);
  if (found.length !== 1) throw new Error(`expected one row called "${title}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The word count shown on the row with this title ("" when it shows none). */
export function countOf(pane: FakeElement, title: string): string {
  return partOf(rowOf(pane, title), 'spellbook-count')?.text ?? '';
}

/** The last thing in a list, if it has any. */
export function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

/** What every event can be asked to do; the stand-in elements do not pass events on, so these do nothing. */
const INERT = { stopPropagation: (): void => {}, preventDefault: (): void => {} };

/** As if the writer tapped (or clicked) an element. */
export function tap(element: FakeElement, event: Record<string, unknown> = {}): void {
  element.dispatch('click', { button: 0, ...INERT, ...event });
}

/** As if the writer pressed a key while the element had the keyboard's focus. */
export function press(element: FakeElement, key: string, event: Record<string, unknown> = {}): void {
  element.dispatch('keydown', { key, ...INERT, ...event });
}

/** As if the writer clicked an element with the right mouse button. */
export function rightClick(element: FakeElement, event: Record<string, unknown> = {}): void {
  element.dispatch('contextmenu', { button: 2, ...INERT, ...event });
}

export const heading = (pane: FakeElement): FakeElement => one(pane, 'spellbook-binder-heading');
export const scroller = (pane: FakeElement): FakeElement => one(pane, 'spellbook-binder-scroll');
export const toolbar = (pane: FakeElement): FakeElement => one(pane, 'spellbook-binder-toolbar');

/** The names of the toolbar's buttons, in order. */
export function toolbarLabels(pane: FakeElement): string[] {
  return toolbar(pane).children.map((button) => String(button.attrs['aria-label'] ?? ''));
}

/** The toolbar button with this name. */
export function toolbarButton(pane: FakeElement, label: string): FakeElement {
  const found = toolbar(pane).children.filter((button) => button.attrs['aria-label'] === label);
  if (found.length !== 1) throw new Error(`expected one toolbar button "${label}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The "more" button of the row with this title, if the row has one. */
export function moreOf(pane: FakeElement, title: string): FakeElement | undefined {
  return partOf(rowOf(pane, title), 'spellbook-row-more');
}

/** The title of the selected row, or null when no row is selected. */
export function selectedTitle(pane: FakeElement): string | null {
  const found = pane.withClass('spellbook-row-self', 'spellbook-is-selected');
  if (found.length > 1) throw new Error(`expected at most one selected row, found ${found.length}`);
  return found[0] ? (partOf(found[0], 'spellbook-title')?.text ?? '') : null;
}

/** The title of a row (the part that is tapped). */
export function titleOf(row: FakeElement): string {
  return partOf(row, 'spellbook-title')?.text ?? '';
}

// ---------------------------------------------------------------- the layout

/** How high the stand-in rows are, and where the list starts, once layOut() has run. */
export const ROW_HEIGHT = 30;
export const LIST_TOP = 100;
export const LIST_WIDTH = 300;
/** How much further in each level of nesting starts. */
export const INDENT = 10;

const NOWHERE = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };

/**
 * Give every row a place on the screen, as a browser's layout would: the
 * list starts at LIST_TOP, every row is ROW_HEIGHT high, rows inside a
 * folder start INDENT further in, and what is folded shut has no size. The
 * list's own scroll position shifts everything up.
 *
 * The stand-in elements lay nothing out themselves, so call this again
 * whenever rows were added, moved, folded or scrolled.
 */
export function layOut(pane: FakeElement, height = 600): void {
  const list = scroller(pane);
  list.rect = { top: LIST_TOP, bottom: LIST_TOP + height, left: 0, right: LIST_WIDTH, width: LIST_WIDTH, height };
  let y = LIST_TOP - list.scrollTop;
  const hide = (container: FakeElement): void => {
    for (const element of container.all()) element.rect = { ...NOWHERE };
  };
  const walk = (container: FakeElement, depth: number): void => {
    for (const item of container.children) {
      const top = y;
      const left = depth * INDENT;
      if (!item.hasClass('spellbook-row')) {
        // A line of text: as high as a row.
        y += ROW_HEIGHT;
        item.rect = { top, bottom: y, left, right: LIST_WIDTH, width: LIST_WIDTH - left, height: ROW_HEIGHT };
        continue;
      }
      const self = item.children.find((child) => child.hasClass('spellbook-row-self')) as FakeElement;
      const inside = item.children.find((child) => child.hasClass('spellbook-children'));
      y += ROW_HEIGHT;
      self.rect = { top, bottom: y, left, right: LIST_WIDTH, width: LIST_WIDTH - left, height: ROW_HEIGHT };
      if (inside) {
        if (item.hasClass('is-collapsed')) hide(inside);
        else walk(inside, depth + 1);
      }
      item.rect = { top, bottom: y, left, right: LIST_WIDTH, width: LIST_WIDTH - left, height: y - top };
    }
  };
  walk(one(pane, 'spellbook-binder-body'), 0);
}

/** A height within a row: 0 is its top edge, 1 its bottom edge, 0.5 its middle. */
export function inRow(row: FakeElement, part: number): number {
  return row.rect.top + part * (row.rect.bottom - row.rect.top);
}

// --------------------------------------------------------------- the pointer

export type PointerKind = 'mouse' | 'touch' | 'pen';

/**
 * A pointer event as a browser sends it, on its way from the window down to
 * `target` and back up, so that listeners on the list and on the document
 * hear it too. Returns the event, to see what was done with it.
 */
export function point(
  target: FakeElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  kind: PointerKind = 'mouse',
  extra: Record<string, unknown> = {},
): FakeEvent {
  return target.fire(type, {
    pointerId: 1,
    pointerType: kind,
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: x,
    clientY: y,
    ...extra,
  });
}

/** Where a press on a row lands: on its title, a little in from the row's start. */
export function gripOf(row: FakeElement): { target: FakeElement; x: number; y: number } {
  return { target: partOf(row, 'spellbook-title') ?? row, x: row.rect.left + 20, y: inRow(row, 0.5) };
}

/**
 * Pick a row up with the mouse and carry it to a place on the screen,
 * without letting go: press on the row, then move there.
 */
export function carry(row: FakeElement, x: number, y: number): void {
  const grip = gripOf(row);
  point(grip.target, 'pointerdown', grip.x, grip.y);
  // The first move starts the drag; the second is the place itself.
  point(grip.target, 'pointermove', grip.x, grip.y + 6);
  point(grip.target, 'pointermove', x, y);
}

/** Let go of the mouse button at a place on the screen. */
export function letGo(row: FakeElement, x: number, y: number): void {
  point(gripOf(row).target, 'pointerup', x, y);
}

/** As if the writer pressed a key on an element, with the event travelling as in a browser. */
export function type(element: FakeElement, key: string, event: Record<string, unknown> = {}): FakeEvent {
  return element.fire('keydown', { key, ...event });
}
