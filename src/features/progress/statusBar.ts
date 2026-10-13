// The bottom bar: the line of figures for the open note, drawn in an item of
// Obsidian's status bar (a desktop and a tablet have one; a phone does not).
// A click on it opens the targets window.

import type { StatusSegment } from '../../core/progress/index';

export const STATUS_CLASS = 'spellbook-status';

export class StatusBar {
  private readonly element: HTMLElement;
  private readonly onOpen: () => void;
  private readonly click = (): void => {
    this.onOpen();
  };
  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.onOpen();
  };

  /**
   * @param element the status bar item Obsidian made for the plugin
   * @param onOpen  called when the bar is clicked (or Enter is pressed on it)
   */
  constructor(element: HTMLElement, onOpen: () => void) {
    this.element = element;
    this.onOpen = onOpen;
    element.addClass(STATUS_CLASS, 'mod-clickable');
    element.setAttr('role', 'button');
    element.setAttr('tabindex', 0);
    element.setAttr('aria-label', 'Writing progress. Click to set writing targets.');
    element.addEventListener('click', this.click);
    element.addEventListener('keydown', this.keydown);
    this.show([]);
  }

  /** Draw the pieces of the line; with none, the item takes no room. */
  show(segments: readonly StatusSegment[]): void {
    const { element } = this;
    element.empty();
    element.toggleClass('spellbook-is-empty', segments.length === 0);
    for (const segment of segments) {
      const piece = element.createSpan({
        cls: ['spellbook-status-segment', `spellbook-status-${segment.id}`],
      });
      if (segment.met === true) piece.addClass('spellbook-is-met');
      piece.createSpan({ cls: 'spellbook-status-label', text: segment.label });
      // Figures and dates read left to right, also when Obsidian itself runs right to left.
      piece.createSpan({ cls: 'spellbook-status-value', text: segment.value, attr: { dir: 'ltr' } });
    }
  }

  /** Take the bar away again. */
  remove(): void {
    this.element.removeEventListener('click', this.click);
    this.element.removeEventListener('keydown', this.keydown);
    this.element.remove();
  }
}
