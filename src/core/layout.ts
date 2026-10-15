// Which layout Spellbook's screens use on this device: the writer's choice
// in the settings, put together with the kind of device Obsidian says it is.
//
// The choice belongs to the device, like the other things in devicePrefs.ts:
// an iPad can use the desktop layout while the phone keeps the touch one.
//
// This file only decides; src/ui/layout.ts asks Obsidian about the device,
// keeps the choice and tells the open screens when it changes.

/**
 * "auto": as the device is (the touch layout on phones and tablets, the
 * desktop layout on computers). "touch": big targets for a finger anywhere,
 * for example on a touch-screen laptop. "desktop": the full desktop screens
 * anywhere, for example on an iPad with a keyboard and trackpad.
 */
export type LayoutChoice = 'auto' | 'touch' | 'desktop';

export const LAYOUT_CHOICES: readonly LayoutChoice[] = ['auto', 'touch', 'desktop'];

/** Where the choice is kept in the device's own storage. */
export const LAYOUT_KEY = 'spellbook-layout';

/**
 * A window narrower than this is taken to be phone-sized when the touch
 * layout is chosen on a tablet or a computer. Obsidian itself treats a
 * screen under 600 pixels wide as a phone.
 */
export const PHONE_NARROW_BELOW = 600;

/** What Obsidian says about the device. */
export interface DeviceKind {
  /** A phone or a tablet. */
  readonly isMobile: boolean;
  /** A phone. */
  readonly isPhone: boolean;
}

/** The layout the screens use. */
export interface Layout {
  /** Big targets for a finger, and the touch screens' own ways of doing things. */
  readonly touch: boolean;
  /** The phone's narrow sizing, before a pane is measured. */
  readonly phone: boolean;
}

/** A stored value as a choice; anything unknown is "auto". */
export function parseLayoutChoice(value: unknown): LayoutChoice {
  return value === 'touch' || value === 'desktop' ? value : 'auto';
}

/**
 * The layout for a choice on a device.
 *
 * - "auto" is what the device is: a phone gets the phone layout, a tablet
 *   the touch layout at tablet size, a computer the desktop layout.
 * - "touch" gives big targets everywhere. A phone stays a phone; a tablet or
 *   a computer keeps its own sizing unless its window is phone-narrow.
 * - "desktop" gives the desktop layout everywhere, a phone included.
 *
 * @param windowWidth the width of the window in pixels; 0 when not known
 */
export function resolveLayout(choice: LayoutChoice, device: DeviceKind, windowWidth: number): Layout {
  switch (choice) {
    case 'desktop':
      return { touch: false, phone: false };
    case 'touch':
      return { touch: true, phone: device.isPhone || (windowWidth > 0 && windowWidth < PHONE_NARROW_BELOW) };
    default:
      return { touch: device.isMobile, phone: device.isPhone };
  }
}
