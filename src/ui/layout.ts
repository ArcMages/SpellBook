// The one place that answers "which layout do Spellbook's screens use here?"
//
// There are two kinds of question about the device, and they must not be
// mixed up:
//
// 1. LAYOUT: how a screen is laid out. Big targets for a finger, buttons
//    that are always shown instead of on hover, a pane taken to be narrow
//    before it is measured. These follow the writer's "Layout" setting and
//    are asked here, with isTouchLayout() and isPhoneLayout(). Screens put
//    the classes on their root element with followLayout() or
//    applyLayoutClasses(), and so change at once when the setting changes.
//
// 2. CAPABILITY: what the device can do, or what Obsidian itself does
//    differently on it. These stay with Obsidian's own Platform checks, and
//    the setting never changes them, so that Spellbook never asks a device
//    for something it cannot do:
//    - printing (Export offers "Print" on computers only);
//    - Obsidian's sidebars that slide in over the page on a phone, and are
//      slid away again after a pane opens (leftSplit and rightSplit);
//    - the navigation bar that floats over the bottom of a phone's panes
//      (the `spellbook-is-phone` class leaves room for it);
//    - the bottom bar (a phone has none, so the inspector shows its figures
//      there whatever the layout) and the room left for it;
//    - the editor: the phone's toolbar, the on-screen keyboard, how marks are
//      kept still while typing on iOS, the writing modes' exit button where
//      there is no Escape key;
//    - how long a slow device is given to start up before the welcome.
//
// Touch screens are also caught by the stylesheet's `(pointer: coarse)`
// rules. Those that only make targets bigger step aside under the desktop
// layout (`spellbook-is-desktop-layout`); those about hovering do not,
// because a finger cannot hover whatever the layout.
//
// A source rule in tests/layout.test.ts keeps every other file away from
// Platform.isMobile, isPhone and isTablet unless it is listed there as a
// capability check.

import { Platform } from 'obsidian';
import type { DeviceStorage } from '../core/devicePrefs';
import { LAYOUT_KEY, parseLayoutChoice, resolveLayout } from '../core/layout';
import type { Layout, LayoutChoice } from '../core/layout';

/** On a screen's root element: the touch layout (big targets). */
export const TOUCH_LAYOUT_CLASS = 'spellbook-is-mobile';
/** On a screen's root element: the desktop layout was chosen, so the touch-screen sizing steps aside. */
export const DESKTOP_LAYOUT_CLASS = 'spellbook-is-desktop-layout';

let choice: LayoutChoice = 'auto';
let storage: DeviceStorage | null = null;
const listeners = new Set<() => void>();

/** Read the writer's choice from this device's storage. Called when the plugin loads. */
export function startLayout(deviceStorage: DeviceStorage): void {
  storage = deviceStorage;
  try {
    choice = parseLayoutChoice(deviceStorage.load(LAYOUT_KEY));
  } catch (error) {
    console.error('Spellbook: the layout setting could not be read', error);
    choice = 'auto';
  }
}

/** Forget the choice and the listeners. Called when the plugin unloads, and by tests. */
export function stopLayout(): void {
  storage = null;
  choice = 'auto';
  listeners.clear();
}

/** The writer's choice on this device. */
export function layoutChoice(): LayoutChoice {
  return choice;
}

/** Change the choice, keep it on this device, and tell the open screens. */
export function setLayoutChoice(next: LayoutChoice): void {
  const wanted = parseLayoutChoice(next);
  if (wanted === choice) return;
  choice = wanted;
  try {
    // Nothing is stored while it is as it comes.
    storage?.save(LAYOUT_KEY, wanted === 'auto' ? null : wanted);
  } catch (error) {
    console.error('Spellbook: the layout setting could not be saved', error);
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error('Spellbook: a screen could not follow the layout', error);
    }
  }
}

/** Be told when the choice changes. Returns the function that stops it. */
export function onLayoutChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The width of a window, or 0 when there is none to measure. */
function widthOf(win: Window | null | undefined): number {
  const chosen = win ?? (typeof activeWindow === 'undefined' ? undefined : activeWindow);
  const width = chosen?.innerWidth;
  return typeof width === 'number' && Number.isFinite(width) ? width : 0;
}

/** The layout now, for a screen in `win` (the active window when left out). */
export function currentLayout(win?: Window | null): Layout {
  return resolveLayout(choice, { isMobile: Platform.isMobile, isPhone: Platform.isPhone }, choice === 'touch' ? widthOf(win) : 0);
}

/** Whether screens get the touch layout: big targets for a finger. */
export function isTouchLayout(): boolean {
  return currentLayout().touch;
}

/** Whether screens get the phone's narrow sizing (until a pane is measured). */
export function isPhoneLayout(win?: Window | null): boolean {
  return currentLayout(win).phone;
}

/** Put the layout's classes on a screen's root element, as the layout is now. */
export function applyLayoutClasses(el: HTMLElement): void {
  el.toggleClass(TOUCH_LAYOUT_CLASS, isTouchLayout());
  el.toggleClass(DESKTOP_LAYOUT_CLASS, choice === 'desktop');
}

/**
 * Put the layout's classes on a screen's root element now, and keep them in
 * step with the setting for as long as `owner` (a view) lives.
 *
 * @param onChange also called when the setting changes, after the classes
 */
export function followLayout(owner: { register(callback: () => unknown): void }, el: HTMLElement, onChange?: () => void): void {
  applyLayoutClasses(el);
  owner.register(
    onLayoutChange(() => {
      applyLayoutClasses(el);
      onChange?.();
    }),
  );
}
