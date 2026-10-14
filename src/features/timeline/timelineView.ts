// The timeline: the project's events on a time axis, lane by lane.
//
//   header    the dates in view, and the buttons: By date / By story order,
//             zoom out, zoom in, Fit, New event, Lanes, Calendar, Entities,
//             and World: the switch for the world lanes (one per type of
//             entity, after the other lanes; see worldCards.ts)
//   filter    only while the timeline is narrowed to some entities: which
//             ones, and the button that shows every event again
//   switcher  on a narrow pane only: the lanes, one of which is shown
//   undated   a strip that folds open: the events without a date
//   main      wide: the lanes' names at the start side, the axis along the
//             top, each lane a band across. Narrow: the axis down the start
//             side, time running from top to bottom, one lane.
//
// Everything it shows comes from the host (timelineHost.ts) and is worked out
// by the timeline engine (src/core/timeline, through timelineScene.ts). The
// view draws, and turns taps, drags and menu choices into requests for the
// host (timelineActions.ts). It never reads or writes a note.
//
// Drawing is done in three depths, each cheaper than the one before:
//   refresh     the data changed: read it again, then lay out
//   relayout    the zoom, the order, the size or the lanes changed: place every card again
//   reposition  the view slid: move the layers, and draw the cards that came near
// Only the cards near what can be seen exist on the page, and new ones are
// made a batch per frame, so a timeline of thousands of events stays light.
//
// Text in any language: titles, tags and lane names are the writer's own and
// choose their own direction; dates, counts and buttons do not.

import { ItemView, Keymap, Notice, Platform } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import {
  LANE_COLORS,
  chipsThatFit,
  dateAtPosition,
  dayToPosition,
  describeEventProblem,
  formatStoryDateRange,
  laneAt,
  laneNameFor,
  panBy,
  precisionForScale,
  resolveDrag,
} from '../../core/timeline';
import type { DragOutcome, LaneColor, TimeScale, TimelineEvent } from '../../core/timeline';
import { iconName, showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';
import { EntityPickerModal } from './entityPicker';
import { LanesModal } from './lanesModal';
import { TimelineActions } from './timelineActions';
import { TimelineGestures } from './timelineGestures';
import type { GesturePoint } from './timelineGestures';
import type { TimelineData, TimelineHost } from './timelineHost';
import { MORE_LABEL, TIMELINE_ICONS, eventMenu, worldMenu } from './timelineMenus';
import {
  META_FROM_WIDTH,
  MIN_CARD_WIDTH,
  anyCardInView,
  axisTicks,
  boxCross,
  boxesIn,
  fitScale,
  isPhoneWidth,
  laneOnShow,
  layoutScene,
  rangeText,
  readContent,
  worldLaneAt,
  worldRowOf,
  zoomIntoCluster,
  zoomScale,
} from './timelineScene';
import type { PlacedBox, Scene, SceneWindow, TimeMode, TimelineContent } from './timelineScene';
import { fillWorldCard, placeWorldCard, worldCardDrawn } from './worldCards';

export const TIMELINE_VIEW_TYPE = 'spellbook-timeline';
export const TIMELINE_VIEW_NAME = 'Timeline';

export const BY_DATE_LABEL = 'By date';
export const BY_STORY_LABEL = 'By story order';
export const NO_PROJECT_MESSAGE = 'No Spellbook project is open.';
export const NO_EVENTS_HINT = 'No events yet. Tap a lane to add one.';
export const UNDATED_LABEL = 'Undated';
export const SET_DATE_LABEL = 'Set date';
export const CALENDAR_LABEL = 'Calendar';
export const FILTER_LABEL = 'Only events with';
export const SHOW_ALL_LABEL = 'Show all events';
export const NO_MATCHING_EVENTS = 'No event names any of these entities.';
export const WORLD_LABEL = 'World';
export const WORLD_HINT = 'Show the world on the timeline: a lane for each type of entity';
export const NO_WORLD_DATES = 'No entity of the world has a date yet. Give one a date on its sheet in the World browser, under "Time".';
/** A card shows this many entities at most; the rest are counted. */
export const CARD_ENTITIES = 3;
/** The space between two chips on a card, in pixels (--size-2-1 in the stylesheet). */
const CHIP_GAP = 2;

/** How much one press of a zoom button changes the size of a day. */
const ZOOM_STEP = 1.5;
/** How many new cards are made in one frame. */
export const CARDS_PER_FRAME = 120;
/** Slid further than this from where the cards were placed, they are placed again, so no number on the page grows huge. */
const REBASE_AT = 200000;
/** How far an arrow key slides the view. */
const KEY_SLIDE = 80;
const KEY_STEPS: Readonly<Record<string, readonly [number, number] | undefined>> = {
  ArrowLeft: [KEY_SLIDE, 0],
  ArrowRight: [-KEY_SLIDE, 0],
  ArrowUp: [0, KEY_SLIDE],
  ArrowDown: [0, -KEY_SLIDE],
};
/** A long bar is cut this far beyond what is drawn. */
const BAR_SLACK = 64;
/** The undated strip lists this many events at most; the rest are counted. */
const UNDATED_SHOWN = 300;
/**
 * Room left after the last lane, so that it can be scrolled clear of what
 * floats over the bottom of the pane: Obsidian's status bar on a desktop and
 * a tablet (about 30 pixels high, in the bottom corner), and its taller
 * navigation bar on a phone.
 */
export const END_ROOM = 48;
export const PHONE_END_ROOM = 96;

const HIDDEN = 'spellbook-is-hidden';
const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

interface Elements {
  readonly root: HTMLElement;
  readonly range: HTMLElement;
  readonly byDate: HTMLElement;
  readonly byStory: HTMLElement;
  readonly alerts: HTMLElement;
  readonly filter: HTMLElement;
  readonly filterButton: HTMLElement;
  readonly switcher: HTMLElement;
  readonly undated: HTMLElement;
  readonly main: HTMLElement;
  readonly axis: HTMLElement;
  readonly names: HTMLElement;
  readonly viewport: HTMLElement;
  readonly grid: HTMLElement;
  readonly bands: HTMLElement;
  readonly cards: HTMLElement;
  readonly carried: HTMLElement;
  readonly empty: HTMLElement;
}

/** A card on the page. */
interface Card {
  readonly el: HTMLElement;
  placed: PlacedBox;
  /** What the card's contents were last drawn for. */
  drawn: string;
  /** Holds the title, the date and the tags; null for a cluster. */
  text: HTMLElement | null;
  more: HTMLElement | null;
  /** Where it was put along the axis, and how long (a long bar is cut to what is near the view). */
  along: number;
  size: number;
  /** The entities on the card: their chips and the "+N" that counts the ones not shown. Null when it shows none. */
  entities: CardEntities | null;
  /** How wide the card is now, as it is written in its style. */
  width: string;
}

/** The chips of a card. As many are shown as fit whole; the "+N" counts the rest. */
interface CardEntities {
  /** Holds the chips and the "+N": the room they have is its width. */
  readonly room: HTMLElement;
  readonly box: HTMLElement;
  readonly chips: readonly HTMLElement[];
  readonly more: HTMLElement;
  /** The names of all the entities the event names, the chips' first. */
  readonly names: readonly string[];
  /** The width of the card the chips were last fitted to; "" when they are still to be fitted. */
  fitted: string;
}

/** What a press on the timeline lands on. */
type Hit =
  | { readonly kind: 'card'; readonly card: Card; readonly more: boolean }
  | { readonly kind: 'cluster'; readonly card: Card }
  | { readonly kind: 'ground' };

type Tap = (event: MouseEvent) => void;

/** The elements from `target` up to, but not including, `stop`. */
function pathTo(target: EventTarget | null, stop: HTMLElement): HTMLElement[] {
  const path: HTMLElement[] = [];
  for (let el = target as HTMLElement | null; el && el !== stop; el = el.parentElement) path.push(el);
  return path;
}

export class TimelineView extends ItemView {
  private readonly host: TimelineHost;
  private readonly actions: TimelineActions;
  private els: Elements | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  private observer: ResizeObserver | null = null;
  private gestures: TimelineGestures<Hit> | null = null;

  private lastData: TimelineData | null = null;
  private content: TimelineContent | null = null;
  private projectId: string | null = null;
  /** The calendar the view was last fitted in, as it is stored: another one counts its days from another place. */
  private calendarShown = 'null';
  private scene: Scene | null = null;
  private mode: TimeMode = 'date';
  /** True for the phone layout: time runs down and one lane shows. */
  private vertical = false;
  private rtl = false;
  /** The view of each order: its zoom and the day at the start. Null until it was fitted. */
  private scales: Record<TimeMode, TimeScale | null> = { date: null, story: null };
  /** How far the lanes are scrolled across the time axis. */
  private crossScroll = 0;
  /** The size of the visible area, along the time axis and across it. */
  private alongLength = 0;
  private crossLength = 0;
  /** The lane shown in the phone layout. */
  private laneKey: string | null = null;
  /** Set when another lane came on show in the phone layout: at the next layout the view goes to its events, unless some are in view already. */
  private seekLane = false;
  private undatedOpen = false;
  private undatedDrawn = '';
  /** The entities the timeline is narrowed to, by key; empty when every event shows. Kept while the view is open. */
  private filter: readonly string[] = [];
  private filterDrawn = '';
  private filterTaps = new Map<HTMLElement, Tap>();

  private cards = new Map<string, Card>();
  private cardOf = new Map<HTMLElement, Card>();
  /** The part of the scene the cards on the page were drawn for. */
  private drawnPart: SceneWindow | null = null;
  /** Cards still to be made, the visible ones first. */
  private queue: PlacedBox[] = [];
  private stopBuild: (() => void) | null = null;
  /** The cards whose chips are to be fitted to their width (again). */
  private readonly toFit = new Set<Card>();
  private bandEls = new Map<string, HTMLElement>();
  private tickEls: HTMLElement[] = [];
  private lineEls: HTMLElement[] = [];
  private switcherTaps = new Map<HTMLElement, Tap>();
  private undatedTaps = new Map<HTMLElement, Tap>();
  private dropBand: HTMLElement | null = null;
  /** Who wants to hear that the data was read again: the window that lists the lanes, while it is open. */
  private watchers = new Set<() => void>();
  /** The switch for the world lanes. */
  private worldButton: HTMLElement | null = null;
  /** Set when the world's history was asked for: at the next layout the view is fitted to the world's dates. */
  private fitWorld = false;

  /** What is waiting to be drawn at the next frame: 0 nothing, 1 reposition, 2 relayout, 3 refresh. */
  private dirty = 0;
  private stopFrame: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, host: TimelineHost) {
    super(leaf);
    this.host = host;
    this.navigation = false;
    this.actions = new TimelineActions(
      host,
      () => this.content,
      () => this.mode,
    );
  }

  override getViewType(): string {
    return TIMELINE_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return TIMELINE_VIEW_NAME;
  }

  override getIcon(): string {
    return iconName(...TIMELINE_ICONS.view) ?? '';
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-timeline-pane');

    const root = pane.createDiv({ cls: 'spellbook-timeline' });
    // Touch needs bigger targets; the stylesheet also covers touch screens on desktop.
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    root.toggleClass('spellbook-is-phone', Platform.isPhone);

    const header = root.createDiv({ cls: 'spellbook-timeline-header' });
    const range = header.createDiv({ cls: 'spellbook-timeline-range' });
    const toolbar = header.createDiv({ cls: 'spellbook-timeline-toolbar' });
    const modes = toolbar.createDiv({ cls: 'spellbook-timeline-modes', attr: { role: 'group', 'aria-label': 'Order' } });
    const byDate = this.button(modes, BY_DATE_LABEL, null, () => {
      this.setMode('date');
    });
    const byStory = this.button(modes, BY_STORY_LABEL, null, () => {
      this.setMode('story');
    });
    this.button(toolbar, 'Zoom out', TIMELINE_ICONS.zoomOut, () => {
      this.zoomBy(1 / ZOOM_STEP);
    });
    this.button(toolbar, 'Zoom in', TIMELINE_ICONS.zoomIn, () => {
      this.zoomBy(ZOOM_STEP);
    });
    this.button(toolbar, 'Fit', null, () => {
      this.fit();
    });
    this.button(toolbar, 'New event', TIMELINE_ICONS.newEvent, () => {
      this.newEventInView();
    });
    this.button(toolbar, 'Lanes', TIMELINE_ICONS.lanes, () => {
      new LanesModal(this.app, this.host, this.actions, {
        problems: () => this.content?.laneList.problems ?? [],
        watch: (listener) => {
          this.watchers.add(listener);
          return () => {
            this.watchers.delete(listener);
          };
        },
      }).open();
    });
    this.button(toolbar, CALENDAR_LABEL, TIMELINE_ICONS.calendar, () => {
      this.actions.askCalendar();
    });
    const filterButton = this.button(toolbar, FILTER_LABEL, TIMELINE_ICONS.filter, () => {
      this.askFilter();
    });
    // The world on the timeline: a lane per type of entity, on or off.
    this.worldButton = this.button(toolbar, WORLD_LABEL, null, () => {
      this.toggleWorld();
    });
    this.worldButton.addClass('spellbook-timeline-world-switch');
    this.worldButton.setAttr('title', WORLD_HINT);

    const alerts = root.createDiv({ cls: ['spellbook-timeline-alerts', HIDDEN] });
    const filter = root.createDiv({ cls: ['spellbook-timeline-filter', HIDDEN], attr: { role: 'status' } });
    const switcher = root.createDiv({ cls: ['spellbook-timeline-switcher', HIDDEN], attr: { role: 'group', 'aria-label': 'Lane' } });
    const undated = root.createDiv({ cls: ['spellbook-timeline-undated', HIDDEN] });
    const main = root.createDiv({ cls: 'spellbook-timeline-main' });
    main.createDiv({ cls: 'spellbook-timeline-corner' });
    const axis = main.createDiv({ cls: 'spellbook-timeline-axis' });
    const names = main.createDiv({ cls: 'spellbook-timeline-names' }).createDiv({ cls: 'spellbook-timeline-names-layer' });
    const viewport = main.createDiv({ cls: 'spellbook-timeline-viewport', attr: { tabindex: '0', 'aria-label': TIMELINE_VIEW_NAME } });
    const grid = viewport.createDiv({ cls: 'spellbook-timeline-grid' });
    const bands = viewport.createDiv({ cls: 'spellbook-timeline-bands' });
    const cards = viewport.createDiv({ cls: 'spellbook-timeline-cards' });
    const carried = viewport.createDiv({ cls: ['spellbook-timeline-carried', HIDDEN] });
    const empty = root.createDiv({ cls: ['spellbook-timeline-empty', HIDDEN] });
    this.els = { root, range, byDate, byStory, alerts, filter, filterButton, switcher, undated, main, axis, names, viewport, grid, bands, cards, carried, empty };

    this.delegate(switcher, this.switcherTaps);
    this.delegate(undated, this.undatedTaps);
    this.delegate(filter, this.filterTaps);
    this.listen(viewport, 'keydown', (event) => {
      this.onKey(event);
    });
    this.listen(viewport, 'contextmenu', (event) => {
      this.onContextMenu(event);
    });

    this.gestures = new TimelineGestures<Hit>({
      surface: viewport,
      clock: this.host.clock,
      hit: (target) => this.hitAt(target),
      canCarry: (hit) => this.canCarry(hit),
      claims: (dx, dy) => !this.vertical || Math.abs(dy) >= Math.abs(dx) || this.crossMax() > 0,
      tap: (hit, point, event) => {
        safely('Timeline', () => {
          this.onTap(hit, point, event);
        });
      },
      slide: (dx, dy) => {
        this.slide(dx, dy);
      },
      zoom: (factor, at) => {
        this.zoomAt(factor, this.local(at).along);
      },
      carryStart: (hit) => {
        if (hit.kind !== 'card') return;
        hit.card.el.addClass('spellbook-is-dragged');
        this.els?.root.addClass('spellbook-drag-active');
      },
      carryMove: (hit, from, to) => {
        if (hit.kind === 'card') this.showCarry(hit.card, from, to);
      },
      carryEnd: (hit, from, to, held) => {
        if (hit.kind !== 'card') return;
        const outcome = this.outcomeOf(hit.card, from, to);
        this.endCarry(hit.card);
        safely('Move event', () => {
          this.onDrop(hit.card, outcome, to, held);
        });
      },
      carryCancel: (hit) => {
        if (hit.kind === 'card') this.endCarry(hit.card);
      },
    });

    this.stops.push(
      this.host.onChange(() => {
        this.schedule(3);
      }),
    );
    // The layout goes by the pane's measured size, never by the kind of device.
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        this.measure();
      });
      this.observer.observe(pane);
      this.observer.observe(viewport);
    }
    this.measure();
    this.refresh();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    this.gestures?.destroy();
    this.gestures = null;
    for (const stop of this.stops.splice(0)) stop();
    this.observer?.disconnect();
    this.observer = null;
    this.stopFrame?.();
    this.stopFrame = null;
    this.stopBuild?.();
    this.stopBuild = null;
    this.dirty = 0;
    this.queue = [];
    this.forgetCards();
    this.bandEls.clear();
    this.tickEls = [];
    this.lineEls = [];
    this.switcherTaps.clear();
    this.undatedTaps.clear();
    this.filterTaps.clear();
    this.filterDrawn = '';
    this.dropBand = null;
    this.watchers.clear();
    this.worldButton = null;
    this.fitWorld = false;
    this.content = null;
    this.lastData = null;
    this.scene = null;
    this.undatedDrawn = '';
    this.els = null;
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-timeline-pane');
  }

  override onResize(): void {
    this.measure();
  }

  /** Listen on an element until the view closes. */
  private listen<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    el.addEventListener(type, handler);
    this.stops.push(() => {
      el.removeEventListener(type, handler);
    });
  }

  /** One listener for everything that can be tapped inside a part that is drawn again and again. */
  private delegate(container: HTMLElement, taps: Map<HTMLElement, Tap>): void {
    this.listen(container, 'click', (event) => {
      for (const el of pathTo(event.target, container)) {
        const tap = taps.get(el);
        if (!tap) continue;
        safely('Timeline', () => {
          tap(event);
        });
        return;
      }
    });
  }

  /** A button of the header: with an icon and a name that is read out, or with its name as its text. */
  private button(parent: HTMLElement, label: string, icon: readonly string[] | null, action: () => void): HTMLElement {
    const button = parent.createEl('button', { cls: 'spellbook-timeline-button', attr: { 'aria-label': label } });
    if (icon === null) button.setText(label);
    else {
      button.addClass('clickable-icon');
      showIcon(button, ...icon);
    }
    this.listen(button, 'click', () => {
      safely(label, action);
    });
    return button;
  }

  // ------------------------------------------------------------------ drawing

  /** Draw at the next frame, at least as deep as asked: 1 reposition, 2 relayout, 3 refresh. */
  private schedule(depth: number): void {
    if (this.closed) return;
    this.dirty = Math.max(this.dirty, depth);
    if (this.stopFrame) return;
    this.stopFrame = this.host.clock.nextFrame(() => {
      this.stopFrame = null;
      const dirty = this.dirty;
      this.dirty = 0;
      if (dirty >= 3) this.refresh();
      else if (dirty === 2) this.relayout();
      else if (dirty === 1) this.reposition();
    });
  }

  private measure(): void {
    if (this.readSize()) this.relayout();
  }

  /** Measure the pane and the visible area. True when the layout or the size changed. */
  private readSize(): boolean {
    const els = this.els;
    if (!els) return false;
    const vertical = isPhoneWidth(this.contentEl.clientWidth, this.vertical);
    let changed = vertical !== this.vertical;
    if (changed) {
      this.vertical = vertical;
      // Time runs the other way now: the old views no longer mean anything.
      this.scales = { date: null, story: null };
      this.crossScroll = 0;
    }
    els.root.toggleClass('spellbook-is-vertical', this.vertical);
    const box = els.viewport.getBoundingClientRect();
    const along = this.vertical ? box.height : box.width;
    const cross = this.vertical ? box.width : box.height;
    // A size of zero means the pane is hidden: keep what was measured before.
    if (along > 0 && cross > 0 && (along !== this.alongLength || cross !== this.crossLength)) {
      this.alongLength = along;
      this.crossLength = cross;
      changed = true;
    }
    return changed;
  }

  /** The data changed: read it again, then lay out. */
  private refresh(): void {
    if (this.closed) return;
    const data = this.host.getData();
    const hadDates = (this.content?.model.dated.length ?? 0) > 0;
    // Another project: what the timeline was narrowed to belongs to the last one.
    if ((data?.projectId ?? null) !== this.projectId) this.filter = [];
    const filtered = this.content !== null && this.content.filter.join('\n') !== this.filter.join('\n');
    if (data !== this.lastData || (data === null) !== (this.content === null) || filtered) {
      this.lastData = data;
      this.content = data === null ? null : readContent(data, this.filter);
      // An entity that is gone no longer narrows anything.
      this.filter = this.content?.filter ?? [];
    }
    // Another calendar counts its days from another place: where the view stood means nothing in it.
    const calendarNow = JSON.stringify(this.content?.data.calendar ?? null);
    if (calendarNow !== this.calendarShown) {
      this.calendarShown = calendarNow;
      this.scales.date = null;
    }
    this.els?.root.toggleClass('spellbook-has-calendar', (this.content?.calendar ?? null) !== null);
    // The first dated event: the view was centred on today, now it shows the event.
    if (!hadDates && (this.content?.model.dated.length ?? 0) > 0) this.scales.date = null;
    const projectId = this.content?.data.projectId ?? null;
    if (projectId !== this.projectId) {
      // Another project: its view starts afresh.
      this.projectId = projectId;
      this.scales = { date: null, story: null };
      this.crossScroll = 0;
      this.laneKey = null;
    }
    // With no project the timeline is not on the page; once there is one, it must be measured.
    this.els?.root.toggleClass('spellbook-is-empty', this.content === null);
    this.readSize();
    this.relayout();
    for (const watcher of [...this.watchers]) watcher();
  }

  /** Place every card again, and draw everything that does not move when the view slides. */
  private relayout(): void {
    const els = this.els;
    if (!els || this.closed) return;
    // Whatever was being carried is put back: the cards are about to change under it.
    if (this.gestures?.carrying) this.gestures.cancel();
    this.drawnPart = null;
    const content = this.content;
    els.root.toggleClass('spellbook-is-empty', content === null);
    // Entities on the world lanes are something to show as well.
    const worldRows = content !== null && this.mode === 'date' && content.world.shown.some((lane) => lane.rows.length > 0);
    els.empty.toggleClass(HIDDEN, content !== null && (content.events.size > 0 || worldRows));
    this.worldButton?.toggleClass('is-active', content?.world.on === true);
    this.worldButton?.setAttr('aria-pressed', content?.world.on === true ? 'true' : 'false');
    els.empty.setText(content === null ? NO_PROJECT_MESSAGE : content.filteredOut > 0 ? NO_MATCHING_EVENTS : NO_EVENTS_HINT);
    this.drawAlerts();
    this.drawFilter();
    this.drawUndated();
    for (const [mode, button] of [['date', els.byDate], ['story', els.byStory]] as const) {
      button.toggleClass('is-active', this.mode === mode);
      button.setAttr('aria-pressed', this.mode === mode ? 'true' : 'false');
    }

    if (content === null || !(this.alongLength > 0)) {
      this.scene = null;
      this.forgetCards();
      this.drawLanes();
      els.range.setText('');
      return;
    }
    // The names of an invented calendar's months and eras are the writer's own text.
    els.range.setAttr('dir', content.calendar === null ? null : 'auto');
    this.rtl = els.root.ownerDocument.defaultView?.getComputedStyle(els.root).direction === 'rtl';
    // The lane that was on show is gone (hidden, or removed): the one shown instead may have its events elsewhere.
    if (this.vertical && this.laneKey !== null && laneOnShow(content, this.mode, this.laneKey)?.key !== this.laneKey) {
      this.seekLane = true;
    }
    const lay = (scale: TimeScale): Scene =>
      layoutScene(content, {
        mode: this.mode,
        vertical: this.vertical,
        scale,
        laneKey: this.laneKey,
        crossLength: this.crossLength,
      });
    // The world's history was asked for: the view goes to the world's own dates, on the first world lane on a phone.
    if (this.fitWorld && this.mode === 'date' && content.world.on) {
      this.fitWorld = false;
      // A world without a single date has nothing to go to: the view stays where it is.
      if (content.world.shown.length > 0) {
        this.crossScroll = 0;
        if (this.vertical) this.laneKey = content.world.shown[0]?.key ?? this.laneKey;
        this.scales.date = fitScale(content, 'date', this.vertical, this.alongLength, this.laneKey, true);
      }
    }
    // A view that was never set shows the events: all of them, or on a narrow pane those of the lane on show.
    let scale = (this.scales[this.mode] ??= fitScale(content, this.mode, this.vertical, this.alongLength, this.laneKey));
    let scene = lay(scale);
    if (this.seekLane) {
      this.seekLane = false;
      // Another lane came on show. It stays at the dates in view when it has
      // something there; otherwise the view goes to where its events are.
      if (this.vertical && !anyCardInView(scene, scale, this.alongLength)) {
        scale = this.scales[this.mode] = fitScale(content, this.mode, this.vertical, this.alongLength, this.laneKey);
        scene = lay(scale);
      }
    }
    this.scene = scene;
    if (this.vertical) this.laneKey = this.scene.lanes[0]?.lane.key ?? null;
    this.drawLanes();
    this.reposition();
  }

  /** The view slid: move the layers, redraw the axis, and draw the cards that came near. */
  private reposition(): void {
    const els = this.els;
    const scene = this.scene;
    const scale = this.scales[this.mode];
    if (!els || !scene || !scale || this.closed) return;
    const shift = dayToPosition(scale, scene.scale.originDay);
    if (Math.abs(shift) > REBASE_AT) {
      this.relayout();
      return;
    }
    this.crossScroll = Math.min(this.crossMax(), Math.max(0, this.crossScroll));
    const side = this.rtl ? -1 : 1;
    const cross = -this.crossScroll;
    els.cards.style.transform = this.vertical
      ? `translate3d(${px(side * cross)}, ${px(shift)}, 0)`
      : `translate3d(${px(side * shift)}, ${px(cross)}, 0)`;
    els.bands.style.transform = this.vertical ? `translate3d(${px(side * cross)}, 0, 0)` : `translate3d(0, ${px(cross)}, 0)`;
    els.names.style.transform = `translate3d(0, ${px(this.vertical ? 0 : cross)}, 0)`;
    els.range.setText(rangeText(this.mode, scale, this.alongLength, this.content?.calendar ?? null));
    this.drawAxis(scale);
    this.fill(shift);
    // The title of a long bar stays in view while its start is out of it.
    for (const card of this.cards.values()) {
      if (!card.placed.box.isSpan || !card.text) continue;
      const inset = Math.min(Math.max(0, card.size - MIN_CARD_WIDTH), Math.max(0, -shift - card.along));
      if (this.vertical) card.text.style.paddingBlockStart = px(inset);
      else card.text.style.paddingInlineStart = px(inset);
    }
  }

  /** How far the lanes can be scrolled across the time axis. */
  private crossMax(): number {
    if (!this.scene) return 0;
    const room = this.vertical ? 0 : Platform.isPhone ? PHONE_END_ROOM : END_ROOM;
    return Math.max(0, this.scene.crossSize + room - this.crossLength);
  }

  private drawAlerts(): void {
    const els = this.els;
    if (!els) return;
    const calendarProblem = this.content?.calendarProblem ?? null;
    const problems = [...(this.content?.laneList.problems ?? []), ...(calendarProblem === null ? [] : [calendarProblem])];
    els.alerts.empty();
    els.alerts.toggleClass(HIDDEN, problems.length === 0);
    for (const problem of problems) {
      els.alerts.createDiv({ cls: 'spellbook-timeline-alert', text: problem, attr: { dir: 'auto', role: 'status' } });
    }
  }

  /** The strip that says which entities the timeline is narrowed to. Drawn again only when that changed. */
  private drawFilter(): void {
    const els = this.els;
    if (!els) return;
    const content = this.content;
    const chosen = content === null ? [] : content.allEntities.filter((entity) => content.filter.includes(entity.key));
    const drawn = chosen.map((entity) => `${entity.key}\n${entity.name}`).join('|');
    els.filterButton.toggleClass('is-active', chosen.length > 0);
    els.filterButton.setAttr('aria-pressed', chosen.length > 0 ? 'true' : 'false');
    if (drawn === this.filterDrawn) return;
    this.filterDrawn = drawn;
    els.filter.empty();
    this.filterTaps.clear();
    els.filter.toggleClass(HIDDEN, chosen.length === 0);
    if (chosen.length === 0) return;
    els.filter.createSpan({ cls: 'spellbook-timeline-filter-label', text: `${FILTER_LABEL}:` });
    for (const entity of chosen) {
      // The name is the writer's own text: it takes the direction of what it says.
      els.filter.createSpan({ cls: 'spellbook-timeline-entity-chip', text: entity.name, attr: { dir: 'auto' } });
    }
    const all = els.filter.createEl('button', { cls: 'spellbook-timeline-filter-clear', text: SHOW_ALL_LABEL });
    this.filterTaps.set(all, () => {
      this.setFilter([]);
    });
  }

  /** Narrow the timeline to the events that name at least one of these entities; none shows every event. */
  private setFilter(keys: readonly string[]): void {
    this.filter = [...keys];
    this.refresh();
  }

  /** The "Only events with" button: the list of entities, with the ones the timeline is narrowed to ticked. */
  private askFilter(): void {
    const content = this.content;
    if (content === null) return;
    new EntityPickerModal(this.app, {
      heading: FILTER_LABEL,
      confirm: 'Show',
      all: content.allEntities,
      chosen: content.filter,
      submit: (keys) => {
        this.setFilter(keys);
        return null;
      },
    }).open();
  }

  /** The lanes' bands and names (wide), and the lane switcher (narrow). */
  private drawLanes(): void {
    const els = this.els;
    if (!els) return;
    const scene = this.scene;
    els.bands.empty();
    els.names.empty();
    els.switcher.empty();
    this.bandEls.clear();
    this.switcherTaps.clear();
    this.dropBand = null;
    els.switcher.toggleClass(HIDDEN, !scene || !scene.vertical);
    if (!scene) return;

    for (const lane of scene.lanes) {
      const band = els.bands.createDiv({ cls: 'spellbook-timeline-band' });
      this.colour(band, lane.lane.color);
      this.bandEls.set(lane.lane.key, band);
      if (scene.vertical) {
        band.style.inlineSize = px(lane.size);
        continue;
      }
      band.style.insetBlockStart = px(lane.start);
      band.style.blockSize = px(lane.size);
      const name = els.names.createDiv({ cls: 'spellbook-timeline-lane-name' });
      name.style.insetBlockStart = px(lane.start);
      name.style.blockSize = px(lane.size);
      this.laneLabel(name, lane.lane.name, lane.lane.kind === 'lane', lane.lane.color);
    }
    if (!scene.vertical) return;
    const current = scene.lanes[0]?.lane.key ?? null;
    // The world lanes follow the others, as they do on a wide pane.
    for (const lane of [...scene.shown, ...scene.world]) {
      const tab = els.switcher.createEl('button', {
        cls: 'spellbook-timeline-lane-tab',
        attr: { 'aria-pressed': lane.key === current ? 'true' : 'false' },
      });
      tab.toggleClass('is-active', lane.key === current);
      this.laneLabel(tab, lane.name, lane.kind === 'lane', lane.color);
      this.switcherTaps.set(tab, () => {
        if (lane.key === this.laneKey) return;
        this.laneKey = lane.key;
        this.crossScroll = 0;
        this.seekLane = true;
        this.relayout();
      });
    }
  }

  /** A lane's colour and name. Only a lane the writer named holds the writer's own text. */
  private laneLabel(parent: HTMLElement, name: string, ownText: boolean, color: LaneColor | null): void {
    this.colour(parent.createSpan({ cls: 'spellbook-timeline-swatch' }), color);
    const label = parent.createSpan({ cls: 'spellbook-timeline-lane-label', text: name });
    if (ownText) label.setAttr('dir', 'auto');
  }

  /** Give an element the class of one of the eight colours, and take away any other. */
  private colour(el: HTMLElement, color: LaneColor | null): void {
    for (const name of LANE_COLORS) el.toggleClass(`spellbook-color-${name}`, name === color);
  }

  private drawAxis(scale: TimeScale): void {
    const els = this.els;
    const content = this.content;
    if (!els || !content) return;
    const ticks = axisTicks(content, this.mode, scale, this.alongLength, this.vertical);
    ticks.forEach((tick, index) => {
      const el = (this.tickEls[index] ??= els.axis.createDiv({ cls: 'spellbook-timeline-tick' }));
      const line = (this.lineEls[index] ??= els.grid.createDiv({ cls: 'spellbook-timeline-gridline' }));
      el.setText(tick.label);
      el.setAttr('dir', tick.ownText ? 'auto' : null);
      // The two are set together, so an element used again for the other layout is put right.
      el.style.insetInlineStart = this.vertical ? '0px' : px(tick.position);
      el.style.insetBlockStart = this.vertical ? px(tick.position) : '0px';
      line.style.insetInlineStart = this.vertical ? '0px' : px(tick.position);
      line.style.insetBlockStart = this.vertical ? px(tick.position) : '0px';
    });
    for (const el of this.tickEls.splice(ticks.length)) el.remove();
    for (const el of this.lineEls.splice(ticks.length)) el.remove();
  }

  // -------------------------------------------------------------------- cards

  /** Make sure the cards near what can be seen are on the page. */
  private fill(shift: number): void {
    const scene = this.scene;
    if (!scene) return;
    const seen: SceneWindow = {
      alongFrom: -shift,
      alongTo: -shift + this.alongLength,
      crossFrom: this.crossScroll,
      crossTo: this.crossScroll + this.crossLength,
    };
    const drawn = this.drawnPart;
    if (
      drawn &&
      drawn.alongFrom <= seen.alongFrom &&
      drawn.alongTo >= seen.alongTo &&
      drawn.crossFrom <= seen.crossFrom &&
      drawn.crossTo >= seen.crossTo
    ) {
      return;
    }
    // Drawn a good way beyond what is seen, so a short slide needs no new cards.
    const alongMargin = Math.max(240, this.alongLength * 0.75);
    const crossMargin = Math.max(160, this.crossLength * 0.5);
    this.drawnPart = {
      alongFrom: seen.alongFrom - alongMargin,
      alongTo: seen.alongTo + alongMargin,
      crossFrom: seen.crossFrom - crossMargin,
      crossTo: seen.crossTo + crossMargin,
    };

    const wanted = boxesIn(scene, this.drawnPart);
    const keep = new Set<string>();
    const first: PlacedBox[] = [];
    const later: PlacedBox[] = [];
    for (const placed of wanted) {
      const { box } = placed;
      keep.add(box.key);
      const card = this.cards.get(box.key);
      if (card) {
        card.placed = placed;
        this.dress(card);
        continue;
      }
      const inView = box.along <= seen.alongTo && box.along + box.size >= seen.alongFrom;
      (inView ? first : later).push(placed);
    }
    for (const [key, card] of [...this.cards]) {
      if (keep.has(key)) continue;
      card.el.remove();
      this.cards.delete(key);
      this.cardOf.delete(card.el);
    }
    this.queue = [...first, ...later];
    this.build();
  }

  /** Make the next batch of cards; the rest follow, a batch per frame. */
  private build(): void {
    const els = this.els;
    if (!els || this.closed) return;
    for (const placed of this.queue.splice(0, CARDS_PER_FRAME)) {
      if (this.cards.has(placed.box.key)) continue;
      const el = els.cards.createDiv({ cls: 'spellbook-timeline-card', attr: { role: 'button', tabindex: '0' } });
      const card: Card = { el, placed, drawn: '', text: null, more: null, along: 0, size: 0, entities: null, width: '' };
      this.cards.set(placed.box.key, card);
      this.cardOf.set(el, card);
      this.dress(card);
    }
    this.fitChips();
    if (this.queue.length === 0 || this.stopBuild) return;
    this.stopBuild = this.host.clock.nextFrame(() => {
      this.stopBuild = null;
      this.build();
    });
  }

  private forgetCards(): void {
    this.stopBuild?.();
    this.stopBuild = null;
    this.toFit.clear();
    this.queue = [];
    for (const card of this.cards.values()) card.el.remove();
    this.cards.clear();
    this.cardOf.clear();
    this.drawnPart = null;
  }

  /** Give a card its contents (only when they changed) and its place. */
  private dress(card: Card): void {
    const scene = this.scene;
    if (!scene) return;
    const { box, lane } = card.placed;
    const event = box.event;
    const color = lane.lane.color;
    const dates = event?.start ? formatStoryDateRange(event.start, event.end) : '';
    const meta = event !== null && (scene.vertical || box.size >= META_FROM_WIDTH);
    const entities = event === null ? '' : (this.content?.entities.get(event.path) ?? []).map((entity) => entity.name).join('\n');
    // An entity of a world lane is drawn in its own way (worldCards.ts).
    const world = worldRowOf(this.content, box);
    const drawn =
      world !== null
        ? worldCardDrawn(world, color, scene.vertical)
        : event === null
          ? `cluster|${box.members.length}|${color ?? ''}`
          : [event.title, dates, event.tags.join(' '), color, box.isSpan, event.source, meta, event.problems.join(' '), entities].join('|');
    if (drawn !== card.drawn) {
      card.drawn = drawn;
      if (world === null) this.fillCard(card, dates, meta);
      else {
        this.colour(card.el, color);
        card.entities = null;
        const filled = fillWorldCard(card.el, world, scene.vertical);
        card.text = filled.text;
        card.more = filled.more;
      }
    }

    const cross = boxCross(scene, lane, box);
    let along = box.along;
    let size = box.size;
    const near = this.drawnPart;
    if (box.isSpan && near) {
      // A bar can be longer than a page can hold: only the part near the view is drawn.
      const from = Math.max(along, near.alongFrom - BAR_SLACK);
      size = Math.max(0, Math.min(along + size, near.alongTo + BAR_SLACK) - from);
      along = from;
    }
    card.along = along;
    card.size = size;
    const style = card.el.style;
    style.insetInlineStart = px(scene.vertical ? cross.start : along);
    style.insetBlockStart = px(scene.vertical ? along : cross.start);
    style.inlineSize = px(scene.vertical ? cross.size : size);
    style.blockSize = px(scene.vertical ? size : cross.size);
    card.width = style.inlineSize;
    // The bar and the points of an entity stand where their days are, also when a long bar was cut.
    if (world !== null) placeWorldCard(card.el, world, { pxPerDay: scene.scale.pxPerDay, cut: along - box.along, size });
    // How many chips fit depends on how wide the card is.
    if (card.entities !== null && card.entities.fitted !== card.width) this.toFit.add(card);
  }

  /**
   * Show on each card that changed as many whole chips as it has room for,
   * and count the rest in its "+N". A chip is never cut down to a letter or
   * two: one that does not fit whole is not shown. Everything is measured
   * first and changed after, so the page is laid out once for all the cards.
   */
  private fitChips(): void {
    if (this.toFit.size === 0) return;
    const waiting: Array<{ card: Card; entities: CardEntities }> = [];
    for (const card of this.toFit) {
      if (card.entities !== null && this.cards.get(card.placed.box.key) === card) waiting.push({ card, entities: card.entities });
    }
    this.toFit.clear();
    // Everything on show, the "+N" at its widest, so that it can be measured...
    for (const { entities } of waiting) {
      for (const chip of entities.chips) chip.removeClass('spellbook-is-hidden');
      entities.box.removeClass('spellbook-is-fitted');
      entities.more.setText(`+${entities.names.length}`);
      entities.more.removeClass('spellbook-is-hidden');
    }
    const measured = waiting.map(({ entities }) => ({
      room: entities.room.clientWidth,
      widths: entities.chips.map((chip) => chip.offsetWidth),
      more: entities.more.offsetWidth,
    }));
    // ...and only then changed.
    waiting.forEach(({ card, entities }, at) => {
      const { room, widths, more } = measured[at] as { room: number; widths: number[]; more: number };
      const uncounted = entities.names.length - entities.chips.length;
      // A card that is not laid out (its pane is in a tab behind another) cannot be measured: every chip stays.
      const known = room > 0 && more > 0 && widths.every((width) => width > 0);
      const shown = known ? chipsThatFit(widths, room, CHIP_GAP, more, uncounted) : entities.chips.length;
      entities.chips.forEach((chip, index) => chip.toggleClass('spellbook-is-hidden', index >= shown));
      entities.box.toggleClass('spellbook-is-fitted', known);
      const rest = entities.names.slice(shown);
      entities.more.setText(`+${rest.length}`);
      entities.more.toggleClass('spellbook-is-hidden', rest.length === 0);
      // Pointing at the "+N" says who the rest are.
      entities.more.setAttr('title', rest.length === 0 ? null : rest.join(', '));
      // What could not be measured is tried again the next time the cards are gone over.
      entities.fitted = known ? card.width : '';
    });
  }

  private fillCard(card: Card, dates: string, meta: boolean): void {
    const { el } = card;
    const { box, lane } = card.placed;
    const event = box.event;
    el.empty();
    card.text = null;
    card.more = null;
    card.entities = null;
    this.colour(el, lane.lane.color);
    el.toggleClass('spellbook-timeline-cluster', event === null);
    el.toggleClass('spellbook-is-span', box.isSpan);
    el.toggleClass('spellbook-is-scene', event?.source === 'scene');
    el.toggleClass('spellbook-has-meta', meta);
    el.toggleClass('spellbook-has-problem', event !== null && event.problems.length > 0);

    if (event === null) {
      const range = box.from && box.until ? formatStoryDateRange(box.from, box.until) : '';
      el.setAttr('aria-label', `${box.members.length} events, ${range}. Zoom in.`);
      el.createSpan({ cls: 'spellbook-timeline-cluster-count', text: String(box.members.length) });
      return;
    }
    el.setAttr('aria-label', null);
    const text = el.createDiv({ cls: 'spellbook-timeline-card-text' });
    // The title is the writer's own text: it alone takes the direction of what it says.
    text.createDiv({ cls: 'spellbook-timeline-card-title', text: event.title, attr: { dir: 'auto' } });
    if (meta) {
      const line = text.createDiv({ cls: 'spellbook-timeline-card-meta' });
      if (dates !== '') {
        const date = line.createSpan({ cls: 'spellbook-timeline-card-date', text: dates });
        // The names of an invented calendar's months and eras are the writer's own text.
        if (event.start?.calendar !== undefined) date.setAttr('dir', 'auto');
      }
      if (event.tags.length > 0) {
        const tags = event.tags.map((tag) => `#${tag}`).join(' ');
        line.createSpan({ cls: 'spellbook-timeline-card-tags', text: tags, attr: { dir: 'auto' } });
      }
      const entities = this.content?.entities.get(event.path) ?? [];
      if (entities.length > 0) {
        line.addClass('spellbook-has-entities');
        const room = line.createSpan({ cls: 'spellbook-timeline-card-entities' });
        // The chips stand in a box of their own, which lets none of them be seen in part.
        const box = room.createSpan({ cls: 'spellbook-timeline-card-chips' });
        const chips = entities.slice(0, CARD_ENTITIES).map((entity) => {
          const chip = box.createSpan({ cls: 'spellbook-timeline-entity-chip', text: entity.name, attr: { dir: 'auto' } });
          chip.toggleClass('spellbook-is-missing', entity.path === null);
          return chip;
        });
        // The "+N" counts the entities that are not shown: those beyond the
        // first few, and (once the card is measured) those there is no room for.
        const rest = entities.slice(CARD_ENTITIES).map((entity) => entity.name);
        const more = room.createSpan({ cls: 'spellbook-timeline-entity-more', text: `+${rest.length}` });
        more.toggleClass('spellbook-is-hidden', rest.length === 0);
        if (rest.length > 0) more.setAttr('title', rest.join(', '));
        card.entities = { room, box, chips, more, names: entities.map((entity) => entity.name), fitted: '' };
      }
    }
    card.text = text;
    card.more = el.createSpan({
      cls: 'spellbook-timeline-card-more',
      attr: { role: 'button', 'aria-label': MORE_LABEL, 'aria-haspopup': 'menu' },
    });
    showIcon(card.more, ...TIMELINE_ICONS.more);
  }

  /** The strip of events without a date. Drawn again only when what it shows changed. */
  private drawUndated(): void {
    const els = this.els;
    if (!els) return;
    const undated = this.content?.model.undated ?? [];
    const drawn = `${this.undatedOpen}|${undated.map((event) => `${event.path}:${event.problems.join(' ')}`).join('|')}`;
    if (drawn === this.undatedDrawn) return;
    this.undatedDrawn = drawn;
    els.undated.empty();
    this.undatedTaps.clear();
    els.undated.toggleClass(HIDDEN, undated.length === 0);
    els.undated.toggleClass('is-collapsed', !this.undatedOpen);
    if (undated.length === 0) return;

    const toggle = els.undated.createEl('button', {
      cls: 'spellbook-timeline-undated-toggle',
      attr: { 'aria-expanded': this.undatedOpen ? 'true' : 'false' },
    });
    showIcon(toggle.createSpan({ cls: 'spellbook-timeline-fold' }), ...TIMELINE_ICONS.fold);
    toggle.createSpan({ cls: 'spellbook-timeline-undated-label', text: UNDATED_LABEL });
    toggle.createSpan({ cls: 'spellbook-timeline-count', text: String(undated.length) });
    this.undatedTaps.set(toggle, () => {
      this.undatedOpen = !this.undatedOpen;
      this.drawUndated();
      // The strip takes room from the timeline, or gives it back.
      this.measure();
    });
    if (!this.undatedOpen) return;

    const list = els.undated.createDiv({ cls: 'spellbook-timeline-undated-list' });
    for (const event of undated.slice(0, UNDATED_SHOWN)) {
      const row = list.createDiv({ cls: 'spellbook-timeline-undated-row' });
      const main = row.createDiv({ cls: 'spellbook-timeline-undated-main' });
      const title = main.createEl('button', { cls: 'spellbook-timeline-undated-title', text: event.title, attr: { dir: 'auto' } });
      if (event.problems.length > 0) {
        const calendar = this.content?.calendar ?? null;
        const problems = event.problems.map((problem) => describeEventProblem(problem, calendar)).join(' ');
        main.createDiv({ cls: 'spellbook-timeline-undated-problem', text: problems });
      }
      const set = row.createEl('button', { cls: 'spellbook-timeline-set-date', text: SET_DATE_LABEL });
      this.undatedTaps.set(title, (tap) => {
        this.actions.open(event, Keymap.isModEvent(tap));
      });
      this.undatedTaps.set(set, () => {
        this.actions.askDates(event);
      });
    }
    if (undated.length > UNDATED_SHOWN) {
      list.createDiv({ cls: 'spellbook-timeline-undated-rest', text: `and ${undated.length - UNDATED_SHOWN} more` });
    }
  }

  // ----------------------------------------------------------- moving around

  /** A place in the window as a place in the visible area: along the time axis, and across it. */
  private local(point: GesturePoint): { readonly along: number; readonly cross: number } {
    const viewport = this.els?.viewport;
    if (!viewport) return { along: 0, cross: 0 };
    const box = viewport.getBoundingClientRect();
    const inline = this.rtl ? box.right - point.x : point.x - box.left;
    const block = point.y - box.top;
    return this.vertical ? { along: block, cross: inline } : { along: inline, cross: block };
  }

  /** Slide the view by a movement of the pointer. */
  private slide(dx: number, dy: number): void {
    const scale = this.scales[this.mode];
    if (!scale) return;
    const inline = this.rtl ? -dx : dx;
    this.scales[this.mode] = panBy(scale, this.vertical ? dy : inline);
    this.crossScroll -= this.vertical ? inline : dy;
    this.schedule(1);
  }

  /** Zoom about a place along the axis, so the date there stays where it is. */
  private zoomAt(factor: number, anchor: number): void {
    const scale = this.scales[this.mode];
    if (!scale) return;
    this.scales[this.mode] = zoomScale(this.mode, scale, factor, anchor);
    this.schedule(2);
  }

  /** A zoom button: about the middle of the view. */
  private zoomBy(factor: number): void {
    const scale = this.scales[this.mode];
    if (!scale) return;
    this.scales[this.mode] = zoomScale(this.mode, scale, factor, this.alongLength / 2);
    this.relayout();
  }

  private fit(): void {
    this.scales[this.mode] = null;
    this.crossScroll = 0;
    this.relayout();
  }

  private setMode(mode: TimeMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.crossScroll = 0;
    this.relayout();
  }

  private onKey(event: KeyboardEvent): void {
    const card = pathTo(event.target, this.els?.viewport ?? this.contentEl)
      .map((el) => this.cardOf.get(el))
      .find((found) => found !== undefined);
    if (card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const picked = card.placed.box.event;
      if (picked) this.openCard(card, Keymap.isModEvent(event));
      else this.openCluster(card);
      return;
    }
    const step = KEY_STEPS[event.key];
    if (step) {
      event.preventDefault();
      this.slide(step[0], step[1]);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.zoomBy(ZOOM_STEP);
    } else if (event.key === '-') {
      event.preventDefault();
      this.zoomBy(1 / ZOOM_STEP);
    }
  }

  // --------------------------------------------------------- taps and drags

  private hitAt(target: EventTarget | null): Hit | null {
    const viewport = this.els?.viewport;
    if (!viewport || !this.scene) return null;
    const path = pathTo(target, viewport);
    for (const el of path) {
      const card = this.cardOf.get(el);
      if (!card) continue;
      if (card.placed.box.event === null) return { kind: 'cluster', card };
      return { kind: 'card', card, more: card.more !== null && path.includes(card.more) };
    }
    return { kind: 'ground' };
  }

  /** A card can be carried along its lane to another date, and (on a wide pane) to another lane. */
  private canCarry(hit: Hit): boolean {
    if (hit.kind !== 'card' || hit.more) return false;
    if (hit.card.placed.box.event?.start == null) return false;
    return this.mode === 'date' || !this.vertical;
  }

  private onTap(hit: Hit, point: GesturePoint, event: PointerEvent): void {
    if (hit.kind === 'cluster') {
      this.openCluster(hit.card);
      return;
    }
    if (hit.kind === 'card') {
      const picked = hit.card.placed.box.event;
      if (!picked) return;
      if (hit.more) this.showMenu(hit.card, point);
      else this.openCard(hit.card, Keymap.isModEvent(event));
      return;
    }
    // An empty place in a lane: a new event there.
    const scene = this.scene;
    const scale = this.scales[this.mode];
    if (!scene || !scale) return;
    const at = this.local(point);
    // ...but not in a world lane: an entity is made in the World browser, and no event belongs there.
    if (scene.vertical ? scene.bands.length === 0 : worldLaneAt(scene, at.cross + this.crossScroll) !== null) return;
    const calendar = this.content?.calendar ?? null;
    const date = this.mode === 'story' ? null : dateAtPosition(scale, at.along, precisionForScale(scale, calendar), calendar);
    const lane = scene.vertical ? (scene.lanes[0]?.lane.key ?? null) : laneAt(scene.bands, at.cross + this.crossScroll);
    this.actions.askNewEvent(date, lane);
  }

  /** The "New event" button: an event at the date in the middle of the view. */
  private newEventInView(): void {
    const scene = this.scene;
    const scale = this.scales[this.mode];
    if (!scene || !scale) {
      this.actions.askNewEvent(null, null);
      return;
    }
    const calendar = this.content?.calendar ?? null;
    const date =
      this.mode === 'story' ? null : dateAtPosition(scale, this.alongLength / 2, precisionForScale(scale, calendar), calendar);
    // On a phone the lane on show may be a world lane, which no event can be in.
    const own = scene.vertical && scene.bands.length > 0 ? scene.lanes[0]?.lane : undefined;
    const lane = own ?? scene.shown.find((candidate) => candidate.kind === 'lane');
    this.actions.askNewEvent(date, lane?.key ?? null);
  }

  /** Tapping a cluster zooms into it. */
  private openCluster(card: Card): void {
    const scale = this.scales[this.mode];
    if (!scale) return;
    this.scales[this.mode] = zoomIntoCluster(scale, card.placed.box, this.alongLength);
    this.relayout();
  }

  /** A tap on a card (or Enter on it): an event's note, or the sheet of an entity of a world lane. */
  private openCard(card: Card, where: ReturnType<typeof Keymap.isModEvent>): void {
    const event = card.placed.box.event;
    if (!event) return;
    const world = worldRowOf(this.content, card.placed.box);
    // With the usual key held, the entity's note in a new tab, like any card's; and its note when nobody offers a sheet.
    if (world !== null && where === false && this.host.showEntity?.(event.path) === true) return;
    this.actions.open(event, where);
  }

  /** The switch "World": the world lanes on or off, on this device. */
  private toggleWorld(): void {
    const content = this.content;
    if (content === null) return;
    const on = !content.world.on;
    this.actions.setWorld(on);
    if (on && content.world.lanes.length === 0) new Notice(NO_WORLD_DATES, 8000);
  }

  /**
   * Show the world's history: the world lanes on, the scenes' lane off, by
   * date, fitted to the range of the world's dates.
   */
  showWorldHistory(): void {
    if (this.closed) return;
    this.mode = 'date';
    this.fitWorld = true;
    this.actions.showWorldHistory();
    if (this.content !== null && this.content.world.lanes.length === 0) new Notice(NO_WORLD_DATES, 8000);
    // Also when nothing had to be changed: the view goes to the world's dates.
    this.schedule(3);
  }

  private showMenu(card: Card, at: GesturePoint): void {
    const event = card.placed.box.event;
    if (!event) return;
    if (worldRowOf(this.content, card.placed.box) !== null) {
      worldMenu(this.actions, event, () => {
        this.openCard(card, false);
      }).showAtPosition(at);
      return;
    }
    const menu = eventMenu(this.actions, this.host.clock, event, card.placed.box.laneKey, at);
    if (event.problems.length > 0) {
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle('What is wrong with this event?').onClick(() => {
          const calendar = this.content?.calendar ?? null;
          new Notice(event.problems.map((problem) => describeEventProblem(problem, calendar)).join('\n'), 12000);
        });
      });
    }
    menu.showAtPosition(at);
  }

  private onContextMenu(event: MouseEvent): void {
    // The page's own menu never opens over the timeline. A finger that rests
    // on a card gets the card's menu when it lets go, so only a mouse (and
    // the keyboard's menu key) are answered here.
    event.preventDefault();
    if (this.gestures?.lastPressByTouch || this.gestures?.active) return;
    const hit = this.hitAt(event.target);
    if (hit?.kind !== 'card') return;
    let at = { x: event.clientX, y: event.clientY };
    if (!at.x && !at.y) {
      const box = hit.card.el.getBoundingClientRect();
      at = { x: box.left, y: box.bottom };
    }
    this.showMenu(hit.card, at);
  }

  /** What the engine makes of a press on a card that has moved from one place to another. */
  private outcomeOf(card: Card, from: GesturePoint, to: GesturePoint): DragOutcome {
    const event = card.placed.box.event;
    const scene = this.scene;
    const scale = this.scales[this.mode];
    if (!event || event.start === null || !scene || !scale) return { kind: 'tap' };
    const a = this.local(from);
    const b = this.local(to);
    // An entity stays in the lane of its type: only its date follows a drag.
    const fixed = scene.vertical || worldRowOf(this.content, card.placed.box) !== null;
    return resolveDrag({
      start: event.start,
      end: event.end,
      lane: card.placed.box.laneKey,
      // In story order a card's place says nothing about its date.
      along: this.mode === 'story' ? 0 : b.along - a.along,
      across: b.cross - a.cross,
      scale,
      bands: fixed ? undefined : scene.bands,
      pointerAcross: fixed ? undefined : b.cross + this.crossScroll,
    });
  }

  /** While a card is carried: it follows the pointer, and a label says what a drop here would do. */
  private showCarry(card: Card, from: GesturePoint, to: GesturePoint): void {
    const els = this.els;
    if (!els) return;
    const a = this.local(from);
    const b = this.local(to);
    const side = this.rtl ? -1 : 1;
    const along = b.along - a.along;
    const cross = b.cross - a.cross;
    card.el.style.transform = this.vertical
      ? `translate3d(${px(side * cross)}, ${px(along)}, 0)`
      : `translate3d(${px(side * along)}, ${px(cross)}, 0)`;

    const outcome = this.outcomeOf(card, from, to);
    const band = outcome.kind === 'drag' && outcome.laneChanged ? (this.bandEls.get(outcome.lane) ?? null) : null;
    if (band !== this.dropBand) {
      this.dropBand?.removeClass('spellbook-is-drop-target');
      band?.addClass('spellbook-is-drop-target');
      this.dropBand = band;
    }
    els.carried.empty();
    els.carried.toggleClass(HIDDEN, outcome.kind !== 'drag');
    if (outcome.kind !== 'drag') return;
    if (this.mode === 'date') {
      const date = els.carried.createSpan({
        cls: 'spellbook-timeline-carried-date',
        text: formatStoryDateRange(outcome.start, outcome.end),
      });
      if (outcome.start.calendar !== undefined) date.setAttr('dir', 'auto');
    }
    if (outcome.laneChanged && this.content) {
      const name = laneNameFor(outcome.lane, this.content.lanes);
      els.carried.createSpan({ cls: 'spellbook-timeline-carried-lane', text: name, attr: { dir: 'auto' } });
    }
    els.carried.style.insetInlineStart = px((this.vertical ? b.cross : b.along) + 14);
    els.carried.style.insetBlockStart = px((this.vertical ? b.along : b.cross) + 14);
  }

  private endCarry(card: Card): void {
    card.el.removeClass('spellbook-is-dragged');
    card.el.style.transform = '';
    this.dropBand?.removeClass('spellbook-is-drop-target');
    this.dropBand = null;
    this.els?.root.removeClass('spellbook-drag-active');
    this.els?.carried.addClass(HIDDEN);
  }

  private onDrop(card: Card, outcome: DragOutcome, at: GesturePoint, held: boolean): void {
    const event: TimelineEvent | null = card.placed.box.event;
    if (!event) return;
    if (outcome.kind === 'tap') {
      // A finger that rested on a card and let go without moving: its menu.
      if (held) this.showMenu(card, at);
      return;
    }
    if (!outcome.dateChanged && !outcome.laneChanged) return;
    this.actions.drop(event, card.placed.box.laneKey, outcome);
  }
}

/** Make the timeline view for a pane; what Obsidian's registerView is given. */
export function createTimelineView(leaf: WorkspaceLeaf, host: TimelineHost): TimelineView {
  return new TimelineView(leaf, host);
}
