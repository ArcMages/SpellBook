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

/** As if the writer tapped (or clicked) an element. */
export function tap(element: FakeElement, event: Record<string, unknown> = {}): void {
  element.dispatch('click', { button: 0, ...event });
}

export const heading = (pane: FakeElement): FakeElement => one(pane, 'spellbook-binder-heading');
export const scroller = (pane: FakeElement): FakeElement => one(pane, 'spellbook-binder-scroll');
