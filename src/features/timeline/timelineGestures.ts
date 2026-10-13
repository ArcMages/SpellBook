// The pointer on the timeline: sliding the view, zooming it, and picking a
// card up. It knows nothing about dates or lanes; the screen says what a
// press landed on and what each movement means.
//
//   A press that hardly moves is a tap.
//   A mouse that moves with the button down slides the view, or carries the
//   card it was pressed on.
//   A finger that moves slides the view, also when it started on a card. A
//   finger that rests on a card picks it up (as in the binder); it then
//   carries the card, and letting go without moving counts as "held".
//   Two fingers zoom about the point between them, and slide with it.
//   The wheel slides; with Ctrl or Cmd it zooms about the pointer (which is
//   also what a pinch on a trackpad sends).
//   Escape, the device taking the pointer away, and the window losing focus
//   cancel whatever is going on.
//
// Once the view slides or a card is carried, the pointer is captured, so it
// is heard wherever it goes, and the page under a finger is kept from
// scrolling by a "touchmove" listener that is allowed to refuse (it refuses
// only then). Every listener is taken away by destroy().

import { MOUSE_DRAG_DISTANCE, TOUCH_HOLD_MS, TOUCH_HOLD_SLOP } from '../../ui/dragDrop';
import type { DragClock } from '../../ui/dragDrop';

/** A place in the window, as pointer events give it. */
export interface GesturePoint {
  readonly x: number;
  readonly y: number;
}

/** How fast the wheel zooms: the size of a day changes by this power of e for every pixel of wheel. */
const WHEEL_ZOOM_RATE = 0.0025;
/** One "line" of a wheel that counts in lines, in pixels. */
const WHEEL_LINE = 16;

export interface GestureOptions<H> {
  /** The element pressed on, and the one that captures the pointer. */
  readonly surface: HTMLElement;
  readonly clock: DragClock;
  /** What a press here lands on; null when the press is not the timeline's business. */
  hit(target: EventTarget | null, point: GesturePoint): H | null;
  /** True when what was pressed can be carried. */
  canCarry(hit: H): boolean;
  /**
   * Whether a finger moving this far from its press should slide the view.
   * False leaves the movement to whatever is around the timeline (a swipe
   * that opens a phone's side drawer, say).
   */
  claims(dx: number, dy: number): boolean;
  tap(hit: H, point: GesturePoint, event: PointerEvent): void;
  slide(dx: number, dy: number): void;
  zoom(factor: number, at: GesturePoint): void;
  carryStart(hit: H): void;
  carryMove(hit: H, from: GesturePoint, to: GesturePoint): void;
  /** @param held true when a finger picked the card up by resting on it */
  carryEnd(hit: H, from: GesturePoint, to: GesturePoint, held: boolean): void;
  carryCancel(hit: H): void;
}

type Phase<H> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'press'; readonly id: number; readonly hit: H; readonly start: GesturePoint; readonly byTouch: boolean }
  | { readonly kind: 'slide'; readonly id: number; last: GesturePoint }
  | { readonly kind: 'carry'; readonly id: number; readonly hit: H; readonly start: GesturePoint; readonly held: boolean }
  | { readonly kind: 'pinch'; readonly a: number; readonly b: number; distance: number; middle: GesturePoint };

const IDLE = { kind: 'idle' } as const;

function between(a: GesturePoint, b: GesturePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function middleOf(a: GesturePoint, b: GesturePoint): GesturePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export class TimelineGestures<H> {
  private readonly options: GestureOptions<H>;
  private phase: Phase<H> = IDLE;
  private destroyed = false;
  /** Where every pointer that is down on the timeline is. */
  private readonly pointers = new Map<number, GesturePoint>();
  private captured: number[] = [];
  private watched: Document | null = null;
  private stopHold: (() => void) | null = null;
  /** True when the last press was a finger or a pen. */
  private touch = false;

  constructor(options: GestureOptions<H>) {
    this.options = options;
    const { surface } = options;
    surface.addEventListener('pointerdown', this.onPointerDown);
    // Not passive: while a finger slides the view or carries a card, this keeps the page from scrolling.
    surface.addEventListener('touchmove', this.onTouchMove, { passive: false });
    surface.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** True while the view slides, a card is carried or two fingers zoom. */
  get active(): boolean {
    return this.phase.kind === 'slide' || this.phase.kind === 'carry' || this.phase.kind === 'pinch';
  }

  /** True while a card is carried. */
  get carrying(): boolean {
    return this.phase.kind === 'carry';
  }

  /** True when the last press was made with a finger or a pen. */
  get lastPressByTouch(): boolean {
    return this.touch;
  }

  /** Stop whatever is going on; a carried card is put back. */
  cancel(): void {
    const phase = this.phase;
    this.forget();
    if (phase.kind === 'carry') this.options.carryCancel(phase.hit);
  }

  /** Stop everything and take away every listener. */
  destroy(): void {
    if (this.destroyed) return;
    this.cancel();
    this.destroyed = true;
    const { surface } = this.options;
    surface.removeEventListener('pointerdown', this.onPointerDown);
    surface.removeEventListener('touchmove', this.onTouchMove);
    surface.removeEventListener('wheel', this.onWheel);
  }

  // ------------------------------------------------------------- the pointer

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.destroyed) return;
    const byTouch = event.pointerType !== 'mouse';
    if (!byTouch && event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    const phase = this.phase;

    if (phase.kind !== 'idle') {
      // A second finger: the two of them zoom. Anything else that comes down meanwhile is ignored.
      const first = phase.kind === 'pinch' ? undefined : phase.id;
      const firstAt = first === undefined ? undefined : this.pointers.get(first);
      if (!byTouch || first === undefined || firstAt === undefined || first === event.pointerId) return;
      this.endHold();
      if (phase.kind === 'carry') this.options.carryCancel(phase.hit);
      this.pointers.set(event.pointerId, point);
      this.phase = {
        kind: 'pinch',
        a: first,
        b: event.pointerId,
        distance: between(firstAt, point),
        middle: middleOf(firstAt, point),
      };
      this.capture(first);
      this.capture(event.pointerId);
      return;
    }

    const hit = this.options.hit(event.target, point);
    if (hit === null) return;
    this.touch = byTouch;
    this.pointers.clear();
    this.pointers.set(event.pointerId, point);
    this.phase = { kind: 'press', id: event.pointerId, hit, start: point, byTouch };
    this.watch(this.options.surface.ownerDocument);
    if (byTouch && this.options.canCarry(hit)) {
      this.stopHold = this.options.clock.setTimer(() => {
        this.stopHold = null;
        const now = this.phase;
        if (now.kind !== 'press' || now.id !== event.pointerId) return;
        this.phase = { kind: 'carry', id: now.id, hit: now.hit, start: now.start, held: true };
        this.capture(now.id);
        this.options.carryStart(now.hit);
      }, TOUCH_HOLD_MS);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, point);
    const phase = this.phase;

    if (phase.kind === 'pinch') {
      const a = this.pointers.get(phase.a);
      const b = this.pointers.get(phase.b);
      if (!a || !b) return;
      const distance = between(a, b);
      const middle = middleOf(a, b);
      if (phase.distance > 0 && distance > 0) this.options.zoom(distance / phase.distance, middle);
      this.options.slide(middle.x - phase.middle.x, middle.y - phase.middle.y);
      phase.distance = distance;
      phase.middle = middle;
      return;
    }
    if (phase.kind === 'idle' || phase.id !== event.pointerId) return;

    if (phase.kind === 'press') {
      const dx = point.x - phase.start.x;
      const dy = point.y - phase.start.y;
      const moved = Math.hypot(dx, dy);
      if (!phase.byTouch && (event.buttons & 1) === 0) {
        // A mouse whose button came up somewhere this did not hear of.
        this.forget();
      } else if (phase.byTouch ? moved > TOUCH_HOLD_SLOP : moved >= MOUSE_DRAG_DISTANCE) {
        this.endHold();
        if (!phase.byTouch && this.options.canCarry(phase.hit)) {
          this.phase = { kind: 'carry', id: phase.id, hit: phase.hit, start: phase.start, held: false };
          this.capture(phase.id);
          this.options.carryStart(phase.hit);
          this.options.carryMove(phase.hit, phase.start, point);
        } else if (!phase.byTouch || this.options.claims(dx, dy)) {
          this.phase = { kind: 'slide', id: phase.id, last: point };
          this.capture(phase.id);
          this.options.slide(dx, dy);
        } else {
          this.forget();
        }
      }
      return;
    }
    if (phase.kind === 'slide') {
      this.options.slide(point.x - phase.last.x, point.y - phase.last.y);
      phase.last = point;
      return;
    }
    this.options.carryMove(phase.hit, phase.start, point);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    const phase = this.phase;
    if (phase.kind === 'pinch') {
      this.afterPinch(event.pointerId);
      return;
    }
    if (phase.kind === 'idle' || phase.id !== event.pointerId) return;
    this.forget();
    if (phase.kind === 'press') this.options.tap(phase.hit, point, event);
    else if (phase.kind === 'carry') this.options.carryEnd(phase.hit, phase.start, point, phase.held);
  };

  /** The device took the pointer away (for a gesture of its own, say). */
  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    if (this.phase.kind === 'pinch') this.afterPinch(event.pointerId);
    else this.cancel();
  };

  /** One of two fingers left: the other goes on sliding the view. */
  private afterPinch(gone: number): void {
    const phase = this.phase;
    if (phase.kind !== 'pinch') return;
    this.pointers.delete(gone);
    const rest = phase.a === gone ? phase.b : phase.a;
    const at = this.pointers.get(rest);
    if (at === undefined) {
      this.forget();
      return;
    }
    this.release(gone);
    this.phase = { kind: 'slide', id: rest, last: at };
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.active) return;
    // The key belongs to the gesture: it must not also close something.
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };

  private readonly onBlur = (): void => {
    this.cancel();
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    if (!this.active) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.destroyed) return;
    if (event.cancelable) event.preventDefault();
    const unit = event.deltaMode === 1 ? WHEEL_LINE : 1;
    const dx = (event.deltaX || 0) * unit;
    const dy = (event.deltaY || 0) * unit;
    if (event.ctrlKey || event.metaKey) {
      const turn = Math.max(-200, Math.min(200, dy));
      this.options.zoom(Math.exp(-turn * WHEEL_ZOOM_RATE), { x: event.clientX, y: event.clientY });
      return;
    }
    // Shift turns an up-and-down wheel into a sideways one.
    if (event.shiftKey && dx === 0) this.options.slide(-dy, 0);
    else this.options.slide(-dx, -dy);
  };

  // ------------------------------------------------------------------ phases

  private endHold(): void {
    this.stopHold?.();
    this.stopHold = null;
  }

  private capture(pointerId: number): void {
    try {
      this.options.surface.setPointerCapture(pointerId);
      this.captured.push(pointerId);
    } catch {
      // The pointer is already gone; its "cancel" will follow.
    }
  }

  private release(pointerId: number): void {
    this.captured = this.captured.filter((id) => id !== pointerId);
    try {
      this.options.surface.releasePointerCapture(pointerId);
    } catch {
      // It was let go of already.
    }
  }

  /** Heard on the whole page and on the way down, so nothing can keep a release from being heard. */
  private watch(doc: Document): void {
    this.unwatch();
    this.watched = doc;
    doc.addEventListener('pointermove', this.onPointerMove, true);
    doc.addEventListener('pointerup', this.onPointerUp, true);
    doc.addEventListener('pointercancel', this.onPointerCancel, true);
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
    doc.removeEventListener('keydown', this.onKeyDown, true);
    doc.defaultView?.removeEventListener('blur', this.onBlur);
  }

  /** Back to doing nothing: no timer, no captured pointer, nobody listening on the page. */
  private forget(): void {
    this.endHold();
    for (const id of [...this.captured]) this.release(id);
    this.unwatch();
    this.pointers.clear();
    this.phase = IDLE;
  }
}
