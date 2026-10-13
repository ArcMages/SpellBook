// The small bubble that says what a mark is: 'Repeated: "tide" 3 times in 40
// words'. It comes up when the pointer rests on a mark, and when a mark is
// tapped: on a touch screen there is no hovering, so a tap must do.
//
// A word can carry several marks at once (an adverb that is also a filler
// word, inside a long sentence): the bubble lists them all, the innermost
// first. It is one element at the end of the page, which never takes a tap
// or the keyboard, and it is gone as soon as the writer types or scrolls.

import { MARK_MESSAGE } from './marks';

export const TIP_CLASS = 'spellbook-prose-tip';

/** How far under the pointer the bubble appears, and how far it stays from the edges, in pixels. */
const BELOW = 22;
const EDGE = 8;

/** The part of an element this file asks for (so that the tests can stand in for one). */
interface Markable {
  getAttr(name: string): string | null;
  readonly parentElement: Markable | null;
}

/**
 * What the marks at an element say: the element's own and those around it,
 * up to (and not including) `within`.
 */
export function messagesAt(target: unknown, within: unknown): string[] {
  const messages: string[] = [];
  let element = target as Markable | null;
  for (let steps = 0; element && element !== within && steps < 12; steps++) {
    if (typeof element.getAttr !== 'function') break;
    const message = element.getAttr(MARK_MESSAGE);
    if (message !== null && message !== '' && !messages.includes(message)) messages.push(message);
    element = element.parentElement;
  }
  return messages;
}

export class ProseTip {
  private element: HTMLElement | null = null;
  /** What the bubble says, so that it is not built again while the pointer moves inside one mark. */
  private showing = '';

  get shown(): boolean {
    return this.element !== null;
  }

  /**
   * Show the bubble near a point of the page.
   *
   * @param page the document the editor is in (a note may be in a window of its own)
   */
  show(page: Document, messages: readonly string[], x: number, y: number): void {
    if (messages.length === 0) {
      this.hide();
      return;
    }
    const text = messages.join('\n');
    if (this.element && this.showing === text) return;
    this.hide();
    const tip = page.body.createDiv({ cls: TIP_CLASS, attr: { role: 'tooltip' } });
    // The sentence may quote the writer's own words, in either language.
    for (const message of messages) tip.createDiv({ cls: `${TIP_CLASS}-line`, text: message, attr: { dir: 'auto' } });
    const view = page.defaultView;
    const width = tip.offsetWidth || 0;
    const height = tip.offsetHeight || 0;
    const roomAcross = (view?.innerWidth ?? 0) - width - EDGE;
    const roomDown = (view?.innerHeight ?? 0) - height - EDGE;
    const across = Math.max(EDGE, roomAcross > EDGE ? Math.min(x, roomAcross) : EDGE);
    // Under the pointer or the finger; above it when there is no room below.
    const down = roomDown > 0 && y + BELOW > roomDown ? Math.max(EDGE, y - BELOW - height) : y + BELOW;
    tip.style.left = `${Math.round(across)}px`;
    tip.style.top = `${Math.round(down)}px`;
    this.element = tip;
    this.showing = text;
  }

  hide(): void {
    this.element?.remove();
    this.element = null;
    this.showing = '';
  }
}
