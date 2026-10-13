// Dragging with a mouse, a finger or a pen.
//
// One engine for every list of the plugin that can be put in order by hand
// (the binder now, the corkboard later). It knows nothing about what is
// dragged: the view says what a press would pick up, what a drop at a place
// would do, and does the drop; the engine does the rest.
//
//   Picking up   With a mouse, a drag starts once the pointer has moved a few
//                pixels. With a finger or a pen it starts after a long press:
//                until then the list scrolls as usual, and a finger that
//                moves is taken for scrolling.
//   Feedback     A floating ghost of what is dragged, a thin line where it
//                would be put, a highlight on what it would go into. Near the
//                top or bottom edge the list scrolls by itself, and something
//                folded shut opens when the pointer rests on it.
//   Ending       Letting go drops. Escape, the window losing focus, or the
//                device taking the pointer away cancel. The click (or the
//                long-press menu) that the same press would bring is kept
//                from the list, so a drag never also opens something.
//
// How it holds on to a touch: once a finger drags, the list must not scroll
// under it. That takes a "touchmove" listener that is allowed to refuse the
// scroll (not "passive"), and it has to be there before the finger comes
// down, so it is attached for good and only refuses while a drag is on.
//
// Everything the engine puts on the screen has a "spellbook-" class and is
// taken away again when the drag ends and when the engine is destroyed.

import { autoScrollSpeed, distanceBetween } from '../core/dropTarget';
import type { ScreenPoint } from '../core/dropTarget';

/** How far a mouse must move with the button down before a drag starts, in pixels. */
export const MOUSE_DRAG_DISTANCE = 4;
/** How long a finger or a pen must rest on something before it is picked up, in milliseconds. */
export const TOUCH_HOLD_MS = 350;
/** A finger that moves further than this while resting is scrolling, not picking up; in pixels. */
export const TOUCH_HOLD_SLOP = 8;
/** How long the pointer must rest on something folded shut before it opens, in milliseconds. */
export const SPRING_OPEN_MS = 700;
/** How long after a drag a late click is still taken for part of it, in milliseconds. */
export const SWALLOW_MS = 500;

/** On what is being dragged. */
export const DRAGGED_CLASS = 'spellbook-is-dragged';
/** On what a drop would go into. */
export const DROP_TARGET_CLASS = 'spellbook-is-drop-target';
/** On the list while something is dragged over it. */
export const DRAG_ACTIVE_CLASS = 'spellbook-drag-active';
export const GHOST_CLASS = 'spellbook-drag-ghost';
export const DROP_LINE_CLASS = 'spellbook-drop-line';

/** The timers the engine uses. Handed in, so that tests can keep the time. */
export interface DragClock {
  /** Call `callback` once after `ms` milliseconds. Returns a function that cancels it. */
  setTimer(callback: () => void, ms: number): () => void;
  /** Call `callback` once before the screen is next drawn, with the time in milliseconds. Returns a function that cancels it. */
  nextFrame(callback: (time: number) => void): () => void;
}

/** What is picked up. */
export interface Picked<T> {
  /** The element that stands for it: dimmed while it is dragged; the ghost takes its size. */
  readonly el: HTMLElement;
  /** What it is, in the view's own terms. */
  readonly data: T;
}

/** What to show for the place the pointer is at. Places are in the window's own coordinates. */
export interface DropHint {
  /** A line where the dragged thing would be put: its start and its width. */
  readonly line?: { readonly x: number; readonly y: number; readonly width: number } | null;
  /** The element the dragged thing would go into. */
  readonly into?: HTMLElement | null;
  /**
   * Something folded shut under the pointer. When the pointer stays on the
   * same one (the same `key`) for a moment, `open` is called once and the
   * view is asked again.
   */
  readonly spring?: { readonly key: string; readonly open: () => void } | null;
}

export interface DragDropOptions<T> {
  /** Presses inside this element are looked at. It holds everything that can be picked up. */
  readonly container: HTMLElement;
  /** The element that scrolls by itself when the pointer is near its top or bottom edge. */
  readonly scroller: HTMLElement;
  readonly clock: DragClock;
  /** What a press on `target` would pick up, or null when nothing there can be dragged. */
  pick(target: EventTarget | null): Picked<T> | null;
  /** Fill the floating ghost of what was picked up. */
  ghost(ghost: HTMLElement, picked: Picked<T>): void;
  /** A drag has begun. */
  start?(picked: Picked<T>): void;
  /** What a drop at `point` would do; null when it would do nothing. Asked again whenever the list has scrolled. */
  hover(picked: Picked<T>, point: ScreenPoint): DropHint | null;
  /** The pointer was let go at `point`. Called after the drag's own traces are gone from the screen. */
  drop(picked: Picked<T>, point: ScreenPoint): void;
  /** The drag is over, dropped or not. */
  end?(picked: Picked<T>): void;
}

/**
 *  idle      nothing is going on
 *  pending   something is pressed, but it is not (yet) a drag
 *  dragging  it is
 *  draining  the drag was cancelled while the pointer was still down; waiting for it to be let go
 */
type Phase = 'idle' | 'pending' | 'dragging' | 'draining';

const NOWHERE: ScreenPoint = { x: 0, y: 0 };

/** The longest stretch of time one step of scrolling may make up for, in milliseconds. */
const LONGEST_FRAME_MS = 50;
/** The time one step of scrolling stands for when the last one is not known, in milliseconds. */
const USUAL_FRAME_MS = 16;

function complain(what: string, error: unknown): void {
  console.error(`Spellbook: ${what} failed while dragging`, error);
}

export class DragDrop<T> {
  private readonly options: DragDropOptions<T>;
  private phase: Phase = 'idle';
  private destroyed = false;

  private picked: Picked<T> | null = null;
  private pointerId = -1;
  /** True for a finger or a pen, false for a mouse. */
  private byTouch = false;
  private pressedAt: ScreenPoint = NOWHERE;
  private point: ScreenPoint = NOWHERE;
  /** Where in the picked-up element the pointer took hold of it. */
  private grab: ScreenPoint = NOWHERE;
  /** The element that keeps hearing from the pointer while it is dragged. */
  private captured: Element | null = null;
  /** The document whose pointer and keyboard are being listened to. */
  private watched: Document | null = null;

  private ghost: HTMLElement | null = null;
  private line: HTMLElement | null = null;
  /** Where the line was last put ("" while it is hidden). */
  private lineAt = '';
  private into: HTMLElement | null = null;
  private springKey: string | null = null;

  private stopHold: (() => void) | null = null;
  private stopSpring: (() => void) | null = null;
  private stopFrame: (() => void) | null = null;
  private stopSwallow: (() => void) | null = null;

  /** How fast the list is scrolling by itself, in pixels per second. */
  private speed = 0;
  private lastFrame: number | null = null;
  /** The part of a pixel that the last step of scrolling could not do. */
  private carry = 0;
  /** True while a click or a menu that arrives belongs to a drag that is over. */
  private swallowing = false;

  constructor(options: DragDropOptions<T>) {
    this.options = options;
    const { container } = options;
    container.addEventListener('pointerdown', this.onPointerDown);
    // Not passive: while a finger drags, this is what keeps the list from scrolling.
    container.addEventListener('touchmove', this.onTouchMove, { passive: false });
    // Heard on the way down, before any row hears them.
    container.addEventListener('click', this.onClick, true);
    container.addEventListener('contextmenu', this.onContextMenu, true);
  }

  /** True while something is being dragged. */
  get active(): boolean {
    return this.phase === 'dragging';
  }

  /**
   * Stop dragging without dropping anything. Does nothing when no drag is on.
   * What the pointer does when it is let go afterwards is still kept from the list.
   */
  cancel(): void {
    if (this.phase === 'pending') {
      this.forget();
      return;
    }
    if (this.phase !== 'dragging') return;
    const picked = this.stopDragging();
    this.phase = 'draining';
    this.swallowing = true;
    this.tellEnd(picked);
  }

  /** Stop everything and take away every listener. The engine cannot be used afterwards. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort();
    this.stopSwallowing();
    const { container } = this.options;
    container.removeEventListener('pointerdown', this.onPointerDown);
    container.removeEventListener('touchmove', this.onTouchMove);
    container.removeEventListener('click', this.onClick, true);
    container.removeEventListener('contextmenu', this.onContextMenu, true);
  }

  // ------------------------------------------------------------- the pointer

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.destroyed || !event.isPrimary) return;
    // A new press. Whatever was left of the last one is over.
    this.stopSwallowing();
    this.abort();
    if (event.button !== 0) return;
    const picked = this.options.pick(event.target);
    if (!picked) return;

    this.picked = picked;
    this.pointerId = event.pointerId;
    this.byTouch = event.pointerType !== 'mouse';
    this.pressedAt = { x: event.clientX, y: event.clientY };
    this.point = this.pressedAt;
    const target = event.target as Element | null;
    this.captured = target && typeof target.setPointerCapture === 'function' ? target : picked.el;
    this.phase = 'pending';
    this.watch(picked.el.ownerDocument);
    if (this.byTouch) {
      this.stopHold = this.options.clock.setTimer(() => {
        this.stopHold = null;
        this.begin(false);
      }, TOUCH_HOLD_MS);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    // A mouse whose button is up again without this engine having heard of it.
    const letGo = !this.byTouch && (event.buttons & 1) === 0;

    if (this.phase === 'pending') {
      const moved = distanceBetween(this.pressedAt, point);
      if (letGo || (this.byTouch && moved > TOUCH_HOLD_SLOP)) {
        // A finger that moves before it was picked up is scrolling the list.
        this.forget();
      } else if (!this.byTouch && moved >= MOUSE_DRAG_DISTANCE) {
        this.point = point;
        this.begin(true);
      }
      return;
    }
    if (this.phase === 'draining') {
      if (letGo) this.settle();
      return;
    }
    if (this.phase !== 'dragging') return;
    if (letGo) {
      const picked = this.stopDragging();
      this.settle();
      this.tellEnd(picked);
      return;
    }
    this.point = point;
    this.follow(true);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    if (this.phase === 'pending') {
      // An ordinary click or tap: it is the list's.
      this.forget();
      return;
    }
    if (this.phase === 'draining') {
      this.settle();
      return;
    }
    if (this.phase !== 'dragging') return;
    const point = { x: event.clientX, y: event.clientY };
    const picked = this.stopDragging();
    this.settle();
    if (!picked) return;
    try {
      this.options.drop(picked, point);
    } catch (error) {
      complain('the drop', error);
    }
    this.tellEnd(picked);
  };

  /** The device took the pointer away (to scroll, say, or for a gesture of its own). */
  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    if (this.phase === 'pending') {
      this.forget();
      return;
    }
    const picked = this.phase === 'dragging' ? this.stopDragging() : null;
    if (this.phase !== 'idle') this.settle();
    this.tellEnd(picked);
  };

  private readonly onLostCapture = (event: PointerEvent): void => {
    if (this.phase === 'dragging' && event.pointerId === this.pointerId) this.cancel();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.phase !== 'dragging' || event.key !== 'Escape') return;
    // The key belongs to the drag: it must not also close something.
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };

  private readonly onBlur = (): void => {
    this.cancel();
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    if (this.phase !== 'dragging' || !this.byTouch) return;
    // The finger is carrying something: its moves are the drag's alone. They
    // must not scroll the list, and whatever the list sits in (a phone's side
    // drawer, which follows a sideways swipe) need not hear of them.
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };

  // ----------------------------------------- what follows a drag: click, menu

  private readonly onClick = (event: Event): void => {
    if (!this.holdsBack()) return;
    event.preventDefault();
    event.stopPropagation();
    // One press brings one click at most.
    if (this.phase === 'idle') this.stopSwallowing();
  };

  private readonly onContextMenu = (event: Event): void => {
    if (this.phase === 'pending' && !this.byTouch) {
      // A mouse asked for the menu with the press itself (Ctrl-click on a Mac): the menu wins.
      this.forget();
      return;
    }
    // A finger that rests is picking something up. Devices differ in how soon
    // they take a long press for a menu request, so one that comes early is
    // held back like one that comes late: the row's "more" button has the menu.
    if (this.phase !== 'pending' && !this.holdsBack()) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private holdsBack(): boolean {
    return this.swallowing || this.phase === 'dragging' || this.phase === 'draining';
  }

  private stopSwallowing(): void {
    this.swallowing = false;
    this.stopSwallow?.();
    this.stopSwallow = null;
  }

  // ------------------------------------------------------------------ phases

  /**
   * Follow the pointer and the keyboard for as long as something is pressed.
   * Listened for on the whole page, and on the way down ("capture"): so the
   * pointer is heard wherever it goes, and nothing on the page can keep its
   * release from being heard.
   */
  private watch(doc: Document): void {
    this.watched = doc;
    doc.addEventListener('pointermove', this.onPointerMove, true);
    doc.addEventListener('pointerup', this.onPointerUp, true);
    doc.addEventListener('pointercancel', this.onPointerCancel, true);
    doc.addEventListener('lostpointercapture', this.onLostCapture, true);
    doc.addEventListener('keydown', this.onKeyDown, true);
    doc.defaultView?.addEventListener('blur', this.onBlur);
  }

  private unwatch(): void {
    const doc = this.watched;
    if (!doc) return;
    this.watched = null;
    doc.removeEventListener('pointermove', this.onPointerMove, true);
    doc.removeEventListener('pointerup', this.onPointerUp, true);
    doc.removeEventListener('pointercancel', this.onPointerCancel, true);
    doc.removeEventListener('lostpointercapture', this.onLostCapture, true);
    doc.removeEventListener('keydown', this.onKeyDown, true);
    doc.defaultView?.removeEventListener('blur', this.onBlur);
  }

  /** A press that did not become a drag is over: back to doing nothing. */
  private forget(): void {
    this.stopHold?.();
    this.stopHold = null;
    this.unwatch();
    this.picked = null;
    this.captured = null;
    this.phase = 'idle';
  }

  /** Whatever is going on, stop it, without holding anything back afterwards. */
  private abort(): void {
    const picked = this.phase === 'dragging' ? this.stopDragging() : null;
    this.forget();
    this.tellEnd(picked);
  }

  /** The press has become a drag. */
  private begin(scroll: boolean): void {
    const picked = this.picked;
    if (!picked || this.phase !== 'pending') return;
    this.stopHold?.();
    this.stopHold = null;
    this.phase = 'dragging';
    try {
      // From now on the pointer is heard wherever it goes.
      this.captured?.setPointerCapture(this.pointerId);
    } catch {
      // The pointer is already gone; its "cancel" will follow.
    }

    const box = picked.el.getBoundingClientRect();
    this.grab = { x: this.pressedAt.x - box.left, y: this.pressedAt.y - box.top };
    const body = picked.el.ownerDocument.body;
    const ghost = body.createDiv({ cls: GHOST_CLASS, attr: { 'aria-hidden': 'true' } });
    // Placed from the corner of the window by the pointer, whichever way the app reads.
    ghost.style.top = '0';
    ghost.style.left = '0';
    ghost.style.width = `${box.width}px`;
    ghost.style.minHeight = `${box.height}px`;
    this.ghost = ghost;
    const line = body.createDiv({ cls: DROP_LINE_CLASS, attr: { 'aria-hidden': 'true' } });
    line.style.top = '0';
    line.style.left = '0';
    line.style.display = 'none';
    this.line = line;
    this.lineAt = '';
    try {
      this.options.ghost(ghost, picked);
    } catch (error) {
      complain('drawing what is dragged', error);
    }
    picked.el.addClass(DRAGGED_CLASS);
    this.options.container.addClass(DRAG_ACTIVE_CLASS);
    try {
      this.options.start?.(picked);
    } catch (error) {
      complain('starting', error);
    }
    this.follow(scroll);
  }

  /** Take everything a drag put on the screen away again. Gives back what was being dragged. */
  private stopDragging(): Picked<T> | null {
    const picked = this.picked;
    this.stopHold?.();
    this.stopSpring?.();
    this.stopFrame?.();
    this.stopHold = this.stopSpring = this.stopFrame = null;
    this.springKey = null;
    this.speed = 0;
    this.carry = 0;
    this.lastFrame = null;

    this.ghost?.remove();
    this.line?.remove();
    this.ghost = this.line = null;
    this.into?.removeClass(DROP_TARGET_CLASS);
    this.into = null;
    picked?.el.removeClass(DRAGGED_CLASS);
    this.options.container.removeClass(DRAG_ACTIVE_CLASS);
    try {
      if (this.captured?.hasPointerCapture(this.pointerId)) this.captured.releasePointerCapture(this.pointerId);
    } catch {
      // Nothing to let go of.
    }
    this.captured = null;
    this.picked = null;
    return picked;
  }

  /** Tell the view that the drag of `picked` is over. */
  private tellEnd(picked: Picked<T> | null): void {
    if (!picked) return;
    try {
      this.options.end?.(picked);
    } catch (error) {
      complain('finishing', error);
    }
  }

  /**
   * The pointer is up (or gone). The click it may still bring belongs to the
   * drag: hold it back, until the next press or for a short while.
   */
  private settle(): void {
    this.unwatch();
    this.phase = 'idle';
    this.swallowing = true;
    this.stopSwallow?.();
    this.stopSwallow = this.options.clock.setTimer(() => {
      this.stopSwallow = null;
      this.swallowing = false;
    }, SWALLOW_MS);
  }

  // ---------------------------------------------------------------- feedback

  /** Bring the ghost to the pointer and show what a drop here would do. */
  private follow(scroll: boolean): void {
    const picked = this.picked;
    if (this.phase !== 'dragging' || !picked) return;
    if (this.ghost) {
      this.ghost.style.transform = `translate(${this.point.x - this.grab.x}px, ${this.point.y - this.grab.y}px)`;
    }
    this.show(this.ask(picked));
    if (scroll) this.scrollNearEdges();
  }

  private ask(picked: Picked<T>): DropHint | null {
    try {
      return this.options.hover(picked, this.point);
    } catch (error) {
      complain('finding the place', error);
      return null;
    }
  }

  private show(hint: DropHint | null): void {
    const line = this.line;
    const at = hint?.line ?? null;
    // The pointer mostly moves within one place: the page is only touched when the line does move.
    const wanted = at ? `${at.x},${at.y},${at.width}` : '';
    if (line && wanted !== this.lineAt) {
      this.lineAt = wanted;
      if (at) {
        line.style.transform = `translate(${at.x}px, ${at.y}px)`;
        line.style.width = `${at.width}px`;
        line.style.display = '';
      } else {
        line.style.display = 'none';
      }
    }

    const into = hint?.into ?? null;
    if (into !== this.into) {
      this.into?.removeClass(DROP_TARGET_CLASS);
      into?.addClass(DROP_TARGET_CLASS);
      this.into = into;
    }

    const spring = hint?.spring ?? null;
    const key = spring?.key ?? null;
    if (key === this.springKey) return;
    this.stopSpring?.();
    this.stopSpring = null;
    this.springKey = key;
    if (!spring) return;
    this.stopSpring = this.options.clock.setTimer(() => {
      this.stopSpring = null;
      const picked = this.picked;
      if (this.phase !== 'dragging' || !picked) return;
      try {
        spring.open();
      } catch (error) {
        complain('opening what the pointer rests on', error);
      }
      // What was folded shut is open now: the rows are in other places.
      this.show(this.ask(picked));
    }, SPRING_OPEN_MS);
  }

  /** Start or stop the list scrolling by itself, going by where the pointer is. */
  private scrollNearEdges(): void {
    const box = this.options.scroller.getBoundingClientRect();
    const beside = this.point.x < box.left || this.point.x > box.right;
    this.speed = beside ? 0 : autoScrollSpeed(this.point.y, box.top, box.bottom);
    if (this.speed === 0) {
      this.stopFrame?.();
      this.stopFrame = null;
      this.carry = 0;
      this.lastFrame = null;
      return;
    }
    this.stopFrame ??= this.options.clock.nextFrame(this.onFrame);
  }

  private readonly onFrame = (time: number): void => {
    this.stopFrame = null;
    const picked = this.picked;
    if (this.phase !== 'dragging' || !picked || this.speed === 0) return;
    const passed =
      this.lastFrame === null ? USUAL_FRAME_MS : Math.max(0, Math.min(LONGEST_FRAME_MS, time - this.lastFrame));
    this.lastFrame = time;
    const wanted = (this.speed * passed) / 1000 + this.carry;
    const step = Math.trunc(wanted);
    this.carry = wanted - step;
    if (step !== 0) {
      const { scroller } = this.options;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + step;
      // (Compared loosely: on some screens a list's position is not a whole number.)
      if (Math.abs(scroller.scrollTop - before) < 0.5) {
        // The list is at its end. Wait for the pointer to move before trying again.
        this.carry = 0;
        this.lastFrame = null;
        return;
      }
      // The rows have moved under the pointer.
      this.show(this.ask(picked));
    }
    this.stopFrame = this.options.clock.nextFrame(this.onFrame);
  };
}
