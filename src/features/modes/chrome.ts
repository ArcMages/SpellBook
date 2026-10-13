// What the writing modes show and hide around the editors.
//
//   Zen        a class on the page's body hides the interface (the rules are
//              in src/styles/modes.css); on a desktop the two sidebars are
//              folded away and opened again afterwards; the Escape key
//              leaves; and on a phone or tablet, which has no Escape key, a
//              small button in the corner of the screen leaves.
//   Hemingway  a lock in the header of every note says that the mode is on,
//              and switches it off when pressed. In Zen the header is
//              hidden, so the lock sits in the corner of the screen instead.
//              When something is refused the lock and the edge of the editor
//              light up for a moment, and the first time a notice says why.
//
// Everything put on the page here is the plugin's own: its classes on the
// body, its elements, its listeners. `release` takes all of it away again,
// and never removes a class or an element that is not the plugin's.

import { Notice } from 'obsidian';
import type { App, EventRef } from 'obsidian';
import { blockedText } from '../../core/modes/index';
import type { Blocked, ModeId, ModeSet, ModeSettings } from '../../core/modes/index';
import { iconName, showIcon } from '../../ui/icons';
import type { FeatureClock } from '../registry';

/** On the body while Zen is on. */
export const ZEN_CLASS = 'spellbook-zen';
/** On the body while Zen is on and hides a note's properties. */
export const ZEN_NO_PROPERTIES_CLASS = 'spellbook-zen-no-properties';
/** On the body while Zen is on and hides a note's title. */
export const ZEN_NO_TITLE_CLASS = 'spellbook-zen-no-title';
/** Every class this file may put on the body. */
export const BODY_CLASSES = [ZEN_CLASS, ZEN_NO_PROPERTIES_CLASS, ZEN_NO_TITLE_CLASS] as const;

/** The place in the corner of the screen for the buttons Zen needs. */
export const CORNER_CLASS = 'spellbook-modes-corner';
export const CORNER_BUTTON_CLASS = 'spellbook-modes-corner-button';
export const EXIT_CLASS = 'spellbook-modes-exit';
/** On every lock: the one in a note's header and the one in the corner. */
export const LOCK_CLASS = 'spellbook-modes-lock';
/** On a lock for a moment after something was refused. */
export const FLASH_CLASS = 'spellbook-modes-flash';
/** The frame that lights up around an editor for a moment after something was refused. */
export const REFUSED_CLASS = 'spellbook-modes-refused';

export const EXIT_ZEN_TEXT = 'Leave Zen mode';
export const LOCK_TEXT = 'Hemingway mode is on: nothing can be deleted. Press to switch it off.';
export const HOW_TO_SWITCH_OFF_TEXT = 'Press the lock to switch it off.';

const EXIT_ICON = ['minimize-2', 'minimize', 'x'] as const;
const LOCK_ICON = ['lock-keyhole', 'lock'] as const;

/** How long the lock and the frame stay lit after something was refused. */
export const FLASH_MS = 450;
/** How long the notice about the first refusal stays. */
export const REFUSED_NOTICE_MS = 8000;

/** Things that take the Escape key for themselves while they are open. */
const ESCAPE_TAKERS = '.modal-container, .menu, .suggestion-container, .prompt';

/** A note's pane, as far as the lock in its header goes. */
interface HeaderView {
  getViewType(): string;
  addAction(icon: string, title: string, callback: () => unknown): HTMLElement;
}

function isHeaderView(view: unknown): view is HeaderView {
  const candidate = view as Partial<HeaderView> | null | undefined;
  return typeof candidate?.getViewType === 'function' && typeof candidate.addAction === 'function';
}

export interface ChromeNeeds {
  readonly app: App;
  readonly clock: FeatureClock;
  /** A phone or tablet: there is no Escape key, and the sidebars are drawers that are left alone. */
  readonly mobile: boolean;
  /** Switch a mode off (the buttons here only ever switch off). */
  switchOff(id: ModeId): void;
}

export class ModesChrome {
  private readonly needs: ChromeNeeds;
  private zen = false;
  private hemingway = false;
  private escape = false;
  private released = false;
  /** The sidebars that were open when Zen began, to be opened again when it ends. */
  private folded: { left: boolean; right: boolean } | null = null;
  private corner: HTMLElement | null = null;
  private cornerLock: HTMLElement | null = null;
  /** The lock put into the header of each note that is open. */
  private readonly headerLocks = new Map<HeaderView, HTMLElement>();
  private layoutRef: EventRef | null = null;
  private listening = false;
  /** The frames that are lit now, and what puts each out. */
  private readonly lit = new Map<HTMLElement, () => void>();
  private cancelFlash: (() => void) | null = null;
  private cancelReport: (() => void) | null = null;
  private pending: { what: Blocked; editorEl: HTMLElement | null } | null = null;
  /** Whether the writer was told, since Hemingway was last switched on, why nothing happens. */
  private told = false;

  constructor(needs: ChromeNeeds) {
    this.needs = needs;
  }

  private get page(): Document {
    return this.needs.app.workspace.containerEl.ownerDocument;
  }

  /** Make the page agree with the modes that are on. */
  apply(modes: ModeSet, settings: ModeSettings): void {
    if (this.released) return;
    const wasZen = this.zen;
    const wasHemingway = this.hemingway;
    this.zen = modes.zen;
    this.hemingway = modes.hemingway;
    this.escape = settings.zenEscape;

    const { body } = this.page;
    body.toggleClass(ZEN_CLASS, this.zen);
    body.toggleClass(ZEN_NO_PROPERTIES_CLASS, this.zen && settings.zenHideProperties);
    body.toggleClass(ZEN_NO_TITLE_CLASS, this.zen && settings.zenHideTitle);

    if (this.zen !== wasZen) {
      if (this.zen) this.foldSidebars();
      else this.unfoldSidebars();
    }
    this.listenForEscape(this.zen);
    if (this.hemingway && !wasHemingway) this.told = false;
    this.drawCorner();
    this.watchLayout(this.hemingway);
    this.syncHeaderLocks();
  }

  /**
   * Hemingway refused something. This may be called from inside an editor's
   * own work, so nothing is touched until the screen is next drawn.
   */
  blocked(what: Blocked, editorEl: HTMLElement | null): void {
    if (this.released || !this.hemingway) return;
    // One key can be refused in more than one place: the one that knows the editor wins.
    if (!this.pending || (editorEl && !this.pending.editorEl)) this.pending = { what, editorEl };
    this.cancelReport ??= this.needs.clock.nextFrame(() => {
      this.cancelReport = null;
      const pending = this.pending;
      this.pending = null;
      if (pending && !this.released && this.hemingway) this.flash(pending.what, pending.editorEl);
    });
  }

  /** The plugin is being switched off: the page goes back to how Obsidian made it. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.cancelReport?.();
    this.cancelReport = null;
    this.pending = null;
    this.unlight();
    const { body } = this.page;
    for (const cls of BODY_CLASSES) body.removeClass(cls);
    if (this.zen) this.unfoldSidebars();
    this.zen = this.hemingway = false;
    this.listenForEscape(false);
    this.watchLayout(false);
    this.drawCorner();
    this.syncHeaderLocks();
  }

  // ----------------------------------------------------------------- sidebars

  private foldSidebars(): void {
    if (this.needs.mobile) return;
    const { workspace } = this.needs.app;
    // Once Obsidian has put its panes back: before that, it would only open them again.
    workspace.onLayoutReady(() => {
      if (this.released || !this.zen || this.folded) return;
      this.folded = { left: !workspace.leftSplit.collapsed, right: !workspace.rightSplit.collapsed };
      if (this.folded.left) workspace.leftSplit.collapse();
      if (this.folded.right) workspace.rightSplit.collapse();
    });
  }

  private unfoldSidebars(): void {
    const folded = this.folded;
    this.folded = null;
    if (!folded) return;
    const { workspace } = this.needs.app;
    if (folded.left) workspace.leftSplit.expand();
    if (folded.right) workspace.rightSplit.expand();
  }

  // ------------------------------------------------------------------- Escape

  private listenForEscape(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    if (on) this.page.addEventListener('keydown', this.keyPressed);
    else this.page.removeEventListener('keydown', this.keyPressed);
  }

  private readonly keyPressed = (event: KeyboardEvent): void => {
    if (!this.zen || !this.escape || event.key !== 'Escape') return;
    // Something else used the key (the editor's Vim mode, say), or a window, menu or list of suggestions is open and Escape closes it.
    if (event.defaultPrevented || event.isComposing) return;
    if (this.page.querySelector(ESCAPE_TAKERS)) return;
    this.needs.switchOff('zen');
  };

  // --------------------------------------------------------------- the corner

  /** The buttons in the corner of the screen: there only in Zen, and only when there is a button to show. */
  private drawCorner(): void {
    const exit = this.zen && this.needs.mobile;
    const lock = this.zen && this.hemingway;
    this.corner?.remove();
    this.corner = this.cornerLock = null;
    if (!exit && !lock) return;

    const corner = this.page.body.createDiv({ cls: CORNER_CLASS });
    corner.toggleClass('spellbook-is-mobile', this.needs.mobile);
    this.corner = corner;
    if (lock) {
      this.cornerLock = this.cornerButton(corner, LOCK_CLASS, LOCK_ICON, LOCK_TEXT, 'hemingway');
    }
    if (exit) this.cornerButton(corner, EXIT_CLASS, EXIT_ICON, EXIT_ZEN_TEXT, 'zen');
  }

  private cornerButton(corner: HTMLElement, cls: string, icon: readonly string[], text: string, mode: ModeId): HTMLElement {
    const button = corner.createEl('button', { cls: [CORNER_BUTTON_CLASS, 'clickable-icon', cls], attr: { type: 'button', 'aria-label': text } });
    showIcon(button, ...icon);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      this.needs.switchOff(mode);
    });
    return button;
  }

  // ------------------------------------------------------- locks in the headers

  private watchLayout(on: boolean): void {
    const { workspace } = this.needs.app;
    if (on && !this.layoutRef) {
      // Notes are opened and closed while the mode is on: each gets its lock.
      this.layoutRef = workspace.on('layout-change', () => {
        this.syncHeaderLocks();
      });
    } else if (!on && this.layoutRef) {
      workspace.offref(this.layoutRef);
      this.layoutRef = null;
    }
  }

  private syncHeaderLocks(): void {
    const open = new Set<HeaderView>();
    if (this.hemingway) {
      const icon = iconName(...LOCK_ICON) ?? 'lock';
      this.needs.app.workspace.iterateAllLeaves((leaf) => {
        const view: unknown = leaf.view;
        if (!isHeaderView(view) || view.getViewType() !== 'markdown') return;
        open.add(view);
        if (this.headerLocks.has(view)) return;
        const lock = view.addAction(icon, LOCK_TEXT, () => {
          this.needs.switchOff('hemingway');
        });
        lock.addClass(LOCK_CLASS);
        this.headerLocks.set(view, lock);
      });
    }
    for (const [view, lock] of this.headerLocks) {
      if (open.has(view)) continue;
      lock.remove();
      this.headerLocks.delete(view);
    }
  }

  // ---------------------------------------------------------------- refusals

  private flash(what: Blocked, editorEl: HTMLElement | null): void {
    if (!this.told) {
      this.told = true;
      new Notice(`${blockedText(what)} ${HOW_TO_SWITCH_OFF_TEXT}`, REFUSED_NOTICE_MS);
    }
    this.unlight();
    const locks = [...this.headerLocks.values(), ...(this.cornerLock ? [this.cornerLock] : [])];
    for (const lock of locks) {
      lock.addClass(FLASH_CLASS);
      this.lit.set(lock, () => lock.removeClass(FLASH_CLASS));
    }
    if (editorEl) {
      // An element of the plugin's own, laid over the editor: the text itself is not touched.
      const frame = editorEl.createDiv({ cls: REFUSED_CLASS, attr: { 'aria-hidden': 'true' } });
      this.lit.set(frame, () => frame.remove());
    }
    this.cancelFlash = this.needs.clock.setTimer(() => {
      this.cancelFlash = null;
      this.unlight();
    }, FLASH_MS);
  }

  private unlight(): void {
    this.cancelFlash?.();
    this.cancelFlash = null;
    for (const putOut of this.lit.values()) putOut();
    this.lit.clear();
  }
}
