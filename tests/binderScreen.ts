// Reading the binder panel in tests: what a writer would see and tap, taken
// from the stand-in elements (tests/obsidianStub.ts).

import type { FakeElement } from './obsidianStub';

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
