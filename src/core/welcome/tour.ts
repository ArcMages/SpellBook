// The short tour of the interface: where its bubble goes, and which step
// comes next when some of the things it points at are not on the screen.

/** A box on the screen, in pixels from the window's top-left corner. */
export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where a bubble was put, beside its target or in the middle of the window. */
export interface Placement {
  readonly top: number;
  readonly left: number;
  readonly side: 'below' | 'above' | 'beside-after' | 'beside-before' | 'centre';
}

/** Room kept between the bubble and its target, and between the bubble and the window's edge, in pixels. */
export const BUBBLE_GAP = 12;
export const WINDOW_MARGIN = 8;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/**
 * Where to put a bubble of the given size next to a target. Below it when
 * there is room, else above, else beside it, else in the middle of the
 * window (over a target that fills the screen, as a sidebar does on a phone).
 * The bubble always stays inside the window.
 */
export function placeBubble(target: Box | null, bubble: Size, viewport: Size, gap = BUBBLE_GAP, margin = WINDOW_MARGIN): Placement {
  const maxLeft = Math.max(margin, viewport.width - bubble.width - margin);
  const maxTop = Math.max(margin, viewport.height - bubble.height - margin);
  const centre: Placement = {
    top: clamp((viewport.height - bubble.height) / 2, margin, maxTop),
    left: clamp((viewport.width - bubble.width) / 2, margin, maxLeft),
    side: 'centre',
  };
  if (!target) return centre;

  const bottom = target.top + target.height;
  const right = target.left + target.width;
  const acrossLeft = clamp(target.left + target.width / 2 - bubble.width / 2, margin, maxLeft);
  const acrossTop = clamp(target.top + target.height / 2 - bubble.height / 2, margin, maxTop);

  if (bottom + gap + bubble.height <= viewport.height - margin) return { top: bottom + gap, left: acrossLeft, side: 'below' };
  if (target.top - gap - bubble.height >= margin) return { top: target.top - gap - bubble.height, left: acrossLeft, side: 'above' };
  if (right + gap + bubble.width <= viewport.width - margin) return { top: acrossTop, left: right + gap, side: 'beside-after' };
  if (target.left - gap - bubble.width >= margin) return { top: acrossTop, left: target.left - gap - bubble.width, side: 'beside-before' };
  return centre;
}

/** Whether a box can be seen in the window: it has a size and some of it lies inside. */
export function isOnScreen(box: Box | null, viewport: Size): boolean {
  if (!box || box.width <= 0 || box.height <= 0) return false;
  return box.left < viewport.width && box.top < viewport.height && box.left + box.width > 0 && box.top + box.height > 0;
}

/**
 * The step to show after `from`, going forward (1) or back (-1), passing over
 * the steps that cannot be shown. `from` -1 going forward asks for the first
 * step. Null when there is none in that direction.
 */
export function nextStep(count: number, from: number, direction: 1 | -1, canShow: (step: number) => boolean): number | null {
  for (let step = from + direction; step >= 0 && step < count; step += direction) {
    if (canShow(step)) return step;
  }
  return null;
}
