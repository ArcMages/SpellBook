// The short tour: a small bubble next to each of the main parts of the
// screen in turn, with Back, Next and Done, and a ring around the part it
// points at. A part that is not on the screen is passed over without a word.
//
// It is built from Obsidian's public page structure and the plugin's own
// elements only, adds nothing but its own two elements (both with the
// plugin's classes), and takes them away again completely when it ends, when
// a new tour starts and when the plugin is switched off. Nothing in it
// catches a tap meant for the page: the ring lets taps through, and the
// bubble is small.
//
// On a phone the binder and the inspector live in sidebars that are drawers,
// closed most of the time. Before a stop inside one, the tour slides that
// drawer out (and the other one away); when the pane is not open anywhere,
// the stop is a card in the middle of the screen saying where to find it.
// A stop that is not in a drawer slides both away again, and so does the end
// of the tour, when the tour opened one.

import type { Workspace } from 'obsidian';
import type { Box, Size } from '../../core/welcome/index';
import { isOnScreen, nextStep, placeBubble } from '../../core/welcome/index';
import { BACK_BUTTON, DONE_BUTTON, NEXT_BUTTON, TOUR_LABEL, stepCount } from './texts';
import type { TourSidebar, TourStop } from './texts';

/** How far the ring stands out around the part it marks, in pixels. */
const RING_ROOM = 4;

/** How long a phone's drawer is given to slide out before the ring is put around what is in it, in milliseconds. */
export const DRAWER_SETTLE_MS = 350;

/** The page, as the tour sees it. */
export interface TourScreen {
  /** The first element that matches one of the selectors, in order, and is on the screen; null when none is. */
  find(selectors: readonly string[]): HTMLElement | null;
  /** The size of the window's inside. */
  viewport(): Size;
  /** Where the tour puts its elements: the page's body. */
  readonly layer: HTMLElement;
  /** Listen to the window. Returns a function that stops listening. */
  listen(type: 'resize' | 'keydown', handler: (event: Event) => void): () => void;
  /** Whether this is a phone (some stops are for a phone only, some never on one). */
  readonly isPhone: boolean;
  /** Whether this is a phone or a tablet: the buttons are made large enough for a finger. */
  readonly isMobile: boolean;
  /**
   * On a phone: slide out the sidebar that holds a pane of this kind, and
   * slide the other one away. Returns false when no such pane is open in a
   * sidebar (then both are slid away).
   */
  openSidebar?(where: TourSidebar): boolean;
  /** On a phone: slide both sidebars away. */
  closeSidebars?(): void;
  /** Run a handler once, after a while. Returns a function that cancels it. */
  later?(handler: () => void, ms: number): () => void;
}

/** The page of a document, for the tour. */
export function pageScreen(doc: Document, isPhone: boolean, isMobile: boolean, workspace?: Workspace): TourScreen {
  const win = doc.defaultView;
  const viewport = (): Size => ({
    width: doc.documentElement.clientWidth || win?.innerWidth || 0,
    height: doc.documentElement.clientHeight || win?.innerHeight || 0,
  });
  return {
    find(selectors) {
      const size = viewport();
      for (const selector of selectors) {
        let found: NodeListOf<HTMLElement>;
        try {
          found = doc.querySelectorAll<HTMLElement>(selector);
        } catch {
          continue; // a selector this version of the app cannot read
        }
        for (const element of Array.from(found)) {
          if (isOnScreen(element.getBoundingClientRect(), size)) return element;
        }
      }
      return null;
    },
    viewport,
    layer: doc.body,
    listen(type, handler) {
      if (!win) return () => undefined;
      win.addEventListener(type, handler);
      return () => {
        win.removeEventListener(type, handler);
      };
    },
    isPhone,
    isMobile,
    openSidebar(where) {
      if (!workspace) return false;
      const leaf = workspace.getLeavesOfType(where.view)[0];
      const root = leaf?.getRoot();
      const side = root === workspace.leftSplit ? 'left' : root === workspace.rightSplit ? 'right' : null;
      if (!leaf || side === null) {
        workspace.leftSplit.collapse();
        workspace.rightSplit.collapse();
        return false;
      }
      (side === 'left' ? workspace.rightSplit : workspace.leftSplit).collapse();
      (side === 'left' ? workspace.leftSplit : workspace.rightSplit).expand();
      void Promise.resolve(workspace.revealLeaf(leaf)).catch(() => undefined);
      return true;
    },
    closeSidebars() {
      if (!workspace) return;
      workspace.leftSplit.collapse();
      workspace.rightSplit.collapse();
    },
    later(handler, ms) {
      if (!win) return () => undefined;
      const id = win.setTimeout(handler, ms);
      return () => {
        win.clearTimeout(id);
      };
    },
  };
}

/** A box as plain numbers. */
function boxOf(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export class Tour {
  private readonly screen: TourScreen;
  private readonly stops: readonly TourStop[];
  private readonly onEnd: () => void;
  private ring: HTMLElement | null = null;
  private bubble: HTMLElement | null = null;
  private stopListening: Array<() => void> = [];
  private at = -1;
  private ended = false;
  /** Whether the tour slid a phone's sidebar out (it slides it away again at the end). */
  private openedSidebar = false;
  private cancelSettle: (() => void) | null = null;

  constructor(screen: TourScreen, stops: readonly TourStop[], onEnd: () => void = () => undefined) {
    this.screen = screen;
    this.stops = stops;
    this.onEnd = onEnd;
  }

  /** The stop on show, by its id; null before the tour starts and after it ends. */
  get current(): string | null {
    return this.ended || this.at < 0 ? null : (this.stops[this.at]?.id ?? null);
  }

  get isRunning(): boolean {
    return !this.ended && this.at >= 0;
  }

  /**
   * Show the first stop that can be shown.
   *
   * @returns false when there is none (the tour then ends at once)
   */
  start(): boolean {
    if (this.ended || this.at >= 0) return this.isRunning;
    const first = nextStep(this.stops.length, -1, 1, (step) => this.canShow(step));
    if (first === null) {
      this.end();
      return false;
    }
    this.ring = this.screen.layer.createDiv({ cls: 'spellbook-tour-ring', attr: { 'aria-hidden': 'true' } });
    this.bubble = this.screen.layer.createDiv({
      cls: 'spellbook-tour-bubble',
      attr: { role: 'dialog', 'aria-label': TOUR_LABEL, 'aria-live': 'polite' },
    });
    this.bubble.toggleClass('spellbook-is-mobile', this.screen.isMobile);
    this.stopListening.push(
      this.screen.listen('resize', () => {
        this.place();
      }),
      this.screen.listen('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Escape') this.end();
      }),
    );
    this.show(first);
    return true;
  }

  next(): void {
    if (!this.isRunning) return;
    const step = nextStep(this.stops.length, this.at, 1, (index) => this.canShow(index));
    if (step === null) this.end();
    else this.show(step);
  }

  back(): void {
    if (!this.isRunning) return;
    const step = nextStep(this.stops.length, this.at, -1, (index) => this.canShow(index));
    if (step !== null) this.show(step);
  }

  /** Take everything away. Calling it again does nothing. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.cancelSettle?.();
    this.cancelSettle = null;
    if (this.openedSidebar) this.screen.closeSidebars?.();
    this.openedSidebar = false;
    for (const stop of this.stopListening.splice(0)) stop();
    this.ring?.remove();
    this.bubble?.remove();
    this.ring = null;
    this.bubble = null;
    this.onEnd();
  }

  private canShow(index: number): boolean {
    const stop = this.stops[index];
    if (!stop) return false;
    if (stop.phone !== undefined && stop.phone !== this.screen.isPhone) return false;
    // On a phone a stop in a sidebar is always shown: its drawer is slid out
    // first, or else it is a card saying where to find the thing.
    if (this.screen.isPhone && stop.sidebar) return true;
    return stop.selectors.length === 0 || this.screen.find(stop.selectors) !== null;
  }

  private show(index: number): void {
    const bubble = this.bubble;
    const stop = this.stops[index];
    if (!bubble || !stop) return;
    this.at = index;
    this.cancelSettle?.();
    this.cancelSettle = null;
    const phone = this.screen.isPhone;
    if (phone && stop.sidebar && this.screen.openSidebar) {
      if (this.screen.openSidebar(stop.sidebar)) this.openedSidebar = true;
    } else if (phone && this.openedSidebar) {
      this.screen.closeSidebars?.();
      this.openedSidebar = false;
    }
    const shown = this.stops.map((_, step) => step).filter((step) => step === index || this.canShow(step));
    const before = nextStep(this.stops.length, index, -1, (step) => this.canShow(step));
    const after = nextStep(this.stops.length, index, 1, (step) => this.canShow(step));

    bubble.empty();
    bubble.setAttr('data-stop', stop.id);
    bubble.createDiv({ cls: 'spellbook-tour-count', text: stepCount(shown.indexOf(index) + 1, shown.length) });
    bubble.createDiv({ cls: 'spellbook-tour-title', text: stop.title });
    bubble.createEl('p', { cls: 'spellbook-tour-text', text: phone ? (stop.phoneText ?? stop.text) : stop.text });
    const buttons = bubble.createDiv({ cls: 'spellbook-tour-buttons' });
    const back = buttons.createEl('button', { cls: 'spellbook-tour-back', text: BACK_BUTTON, attr: { type: 'button' } });
    back.disabled = before === null;
    back.addEventListener('click', () => {
      this.back();
    });
    let next: HTMLButtonElement | null = null;
    if (after !== null) {
      next = buttons.createEl('button', { cls: 'spellbook-tour-next mod-cta', text: NEXT_BUTTON, attr: { type: 'button' } });
      next.addEventListener('click', () => {
        this.next();
      });
    }
    const done = buttons.createEl('button', {
      cls: after === null ? 'spellbook-tour-done mod-cta' : 'spellbook-tour-done',
      text: DONE_BUTTON,
      attr: { type: 'button' },
    });
    done.addEventListener('click', () => {
      this.end();
    });
    this.place();
    (next ?? done).focus();
    // A drawer takes a moment to slide out: put the ring around what is in it once it has.
    if (phone && stop.sidebar && this.screen.later) {
      this.cancelSettle = this.screen.later(() => {
        this.cancelSettle = null;
        this.place();
      }, DRAWER_SETTLE_MS);
    }
  }

  /** Put the ring around the part on show and the bubble next to it. */
  private place(): void {
    const ring = this.ring;
    const bubble = this.bubble;
    const stop = this.stops[this.at];
    if (!ring || !bubble || !stop) return;
    const target = stop.selectors.length === 0 ? null : this.screen.find(stop.selectors);
    const box = target ? boxOf(target) : null;
    if (box) {
      ring.toggleClass('spellbook-is-hidden', false);
      ring.style.top = `${box.top - RING_ROOM}px`;
      ring.style.left = `${box.left - RING_ROOM}px`;
      ring.style.width = `${box.width + 2 * RING_ROOM}px`;
      ring.style.height = `${box.height + 2 * RING_ROOM}px`;
    } else {
      ring.toggleClass('spellbook-is-hidden', true);
    }
    const size = bubble.getBoundingClientRect();
    const placed = placeBubble(box, { width: size.width, height: size.height }, this.screen.viewport());
    bubble.setAttr('data-side', placed.side);
    bubble.style.top = `${Math.round(placed.top)}px`;
    bubble.style.left = `${Math.round(placed.left)}px`;
  }
}
