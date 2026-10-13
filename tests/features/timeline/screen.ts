// A stage for the timeline screen: the view opened the way Obsidian opens it,
// on stand-in elements (tests/obsidianStub.ts), with a size the test gives
// it. The stand-ins lay nothing out, so the test says how big the pane is.

import { TimelineView, createTimelineView } from '../../../src/features/timeline/timelineView';
import { point } from '../../binderScreen';
import type { PointerKind } from '../../binderScreen';
import { Menu as StubMenu, Modal as StubModal, Notice as StubNotice, resetFakeDocument } from '../../obsidianStub';
import type { ButtonComponent, FakeElement, FakeEvent, ItemView as StubItemView } from '../../obsidianStub';
import { FRAME_MS, FakeHost } from './fakeHost';

/** Where the visible part of the timeline is in the window, and how wide the pane is. */
export interface PaneSize {
  readonly pane: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A wide pane: the lanes' names take the first 140 pixels. */
export const WIDE: PaneSize = { pane: 900, left: 140, top: 100, width: 760, height: 400 };
/** A pane as narrow as a phone: the axis takes the first 76 pixels. */
export const PHONE: PaneSize = { pane: 380, left: 76, top: 150, width: 304, height: 500 };

export interface Stage {
  host: FakeHost;
  view: TimelineView;
  shell: StubItemView;
  pane: FakeElement;
  viewport: FakeElement;
}

/** Forget the notices, menus and windows of earlier tests. Call it before each test. */
export function clearScreen(): void {
  StubNotice.shown.length = 0;
  StubMenu.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
}

export function resize(s: Pick<Stage, 'view' | 'pane' | 'viewport'>, size: PaneSize): void {
  s.pane.clientWidth = size.pane;
  s.viewport.rect = {
    left: size.left,
    top: size.top,
    width: size.width,
    height: size.height,
    right: size.left + size.width,
    bottom: size.top + size.height,
  };
  s.view.onResize();
}

export async function open(host: FakeHost = new FakeHost(), size: PaneSize | null = WIDE): Promise<Stage> {
  const view = createTimelineView({ app: host.app } as never, host);
  const shell = view as unknown as StubItemView;
  const pane = view.contentEl as unknown as FakeElement;
  await shell.open();
  const viewport = one(pane, 'spellbook-timeline-viewport');
  const s: Stage = { host, view, shell, pane, viewport };
  if (size) resize(s, size);
  await settle(s);
  return s;
}

/** Let the frames that are waiting be drawn, and what was asked of the host come back. */
export async function settle(s: Pick<Stage, 'host'>, ms = 5 * FRAME_MS): Promise<void> {
  for (let turn = 0; turn < 4; turn++) {
    await Promise.resolve();
    s.host.timers.advance(ms);
  }
  await Promise.resolve();
}

// ------------------------------------------------------------------ reading

/** The one element with this class, or a failed test. */
export function one(root: FakeElement, cls: string): FakeElement {
  const found = root.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

export const cards = (s: Pick<Stage, 'pane'>): FakeElement[] => s.pane.withClass('spellbook-timeline-card');

export const titleOf = (card: FakeElement): string => card.withClass('spellbook-timeline-card-title')[0]?.text ?? '';

/** The titles of the event cards on the page, in the order they were made. */
export const titles = (s: Pick<Stage, 'pane'>): string[] =>
  cards(s)
    .filter((card) => !card.hasClass('spellbook-timeline-cluster'))
    .map(titleOf);

/** The card with this title (the first one, when an event shows in several lanes). */
export function cardOf(s: Pick<Stage, 'pane'>, title: string): FakeElement {
  const found = cards(s).find((card) => titleOf(card) === title);
  if (!found) throw new Error(`no card called "${title}"`);
  return found;
}

/** A length the view set on an element, as a number of pixels. */
export const pixels = (value: string | undefined): number => Number.parseFloat(value ?? 'NaN');

/** Where a card is: along the row or column it is in. */
export function boxOf(card: FakeElement): { x: number; y: number; width: number; height: number } {
  return {
    x: pixels(card.style['insetInlineStart']),
    y: pixels(card.style['insetBlockStart']),
    width: pixels(card.style['inlineSize']),
    height: pixels(card.style['blockSize']),
  };
}

/** The x and y a layer was moved by. */
export function shiftOf(layer: FakeElement): { x: number; y: number } {
  const match = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(layer.style['transform'] ?? '');
  return { x: Number(match?.[1] ?? 'NaN'), y: Number(match?.[2] ?? 'NaN') };
}

export const rangeOf = (s: Pick<Stage, 'pane'>): string => one(s.pane, 'spellbook-timeline-range').text;

/** The names of the lanes at the start side of a wide pane, top to bottom. */
export const laneNames = (s: Pick<Stage, 'pane'>): string[] =>
  s.pane.withClass('spellbook-timeline-lane-name').map((name) => name.fullText);

/** The header button with this name. */
export function button(s: Pick<Stage, 'pane'>, label: string): FakeElement {
  const found = s.pane.withClass('spellbook-timeline-button').filter((el) => el.attrs['aria-label'] === label);
  if (found.length !== 1) throw new Error(`expected one button "${label}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** Every element that lets its text choose its own direction, by its class. */
export function ownTextClasses(root: FakeElement): string[] {
  const found = new Set<string>();
  for (const el of root.all()) if (el.attrs['dir'] === 'auto') for (const cls of el.classes) found.add(cls);
  return [...found].sort();
}

// ------------------------------------------------------------------- acting

/** A click as a browser sends it: heard by the element and by everything around it. */
export function click(el: FakeElement, init: Record<string, unknown> = {}): FakeEvent {
  return el.fire('click', { button: 0, ...init });
}

/** A place in the window, from a place in the visible part of the timeline. */
export function at(s: Pick<Stage, 'viewport'>, x: number, y: number): { x: number; y: number } {
  return { x: s.viewport.rect.left + x, y: s.viewport.rect.top + y };
}

/** Where a card is in the window: its middle, a little in from its start. */
export function grip(s: Stage, card: FakeElement): { x: number; y: number } {
  const layer = shiftOf(one(s.pane, 'spellbook-timeline-cards'));
  const box = boxOf(card);
  return at(s, box.x + layer.x + 12, box.y + layer.y + box.height / 2);
}

/** Press, move and let go: a drag with the mouse, or with a finger that goes straight off. */
export function drag(
  target: FakeElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  kind: PointerKind = 'mouse',
  extra: Record<string, unknown> = {},
): void {
  point(target, 'pointerdown', from.x, from.y, kind, extra);
  point(target, 'pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2, kind, extra);
  point(target, 'pointermove', to.x, to.y, kind, extra);
  point(target, 'pointerup', to.x, to.y, kind, extra);
}

/** Press and let go in one place. */
export function tapAt(target: FakeElement, where: { x: number; y: number }, kind: PointerKind = 'mouse', extra = {}): void {
  point(target, 'pointerdown', where.x, where.y, kind, extra);
  point(target, 'pointerup', where.x, where.y, kind, extra);
}

// ------------------------------------------------------- menus and windows

export function lastMenu(): StubMenu {
  const menu = StubMenu.shown[StubMenu.shown.length - 1];
  if (!menu) throw new Error('no menu was shown');
  return menu;
}

/** The window on top: the one opened last of those that are still open. */
export function openWindow(): StubModal {
  const modal = [...StubModal.opened].reverse().find((candidate) => candidate.isOpen);
  if (!modal) throw new Error('no window is open');
  return modal;
}

export const openWindows = (): number => StubModal.opened.filter((modal) => modal.isOpen).length;

export const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

/** The fields and buttons of the window that is open: a field by its class, the two buttons at the bottom. */
export function windowParts(): {
  modal: StubModal;
  field: (cls: string) => FakeElement;
  type: (cls: string, text: string) => void;
  message: () => string;
  confirm: ButtonComponent;
  cancel: ButtonComponent;
} {
  const modal = openWindow();
  const buttons = (modal.contentEl.settings[0]?.components ?? []) as ButtonComponent[];
  const field = (cls: string): FakeElement => one(modal.contentEl, cls);
  return {
    modal,
    field,
    type: (cls, text) => {
      const input = field(cls);
      input.value = text;
      input.dispatch('input', {});
    },
    message: () => modal.contentEl.withClass('spellbook-prompt-message')[0]?.text ?? '',
    cancel: buttons[0] as ButtonComponent,
    confirm: buttons[1] as ButtonComponent,
  };
}
