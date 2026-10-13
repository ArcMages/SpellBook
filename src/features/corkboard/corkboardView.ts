// The corkboard: the scenes of one part of the binder as index cards.
//
//   header   the trail from the manuscript to the folder on show (each step
//            can be tapped), a line that sums the board up, the card size,
//            and a "more" menu
//   board    the cards, in binder order, in as many columns as fit
//
// The board shows the whole manuscript, or one binder folder: its "scope". A
// scene is a scene card; a folder is one card that stands for everything in
// it, and tapping it makes that folder the scope.
//
// Everything it shows comes from the host (src/features/corkboard/host.ts),
// and everything it changes is asked of the host: the board itself reads and
// writes nothing. What a card says, the order of the cards, the number of
// columns and what a move means are all worked out by the cards engine
// (src/core/cards).
//
// A large book: the cards are kept and used again from one drawing to the
// next, so a change of order moves them and builds nothing, and a change to
// one scene draws that one card. What has to be worked out or built is done a
// handful of cards at a time, so that a board of hundreds of scenes shows its
// first cards at once.
//
// Touch first: every card has a visible "more" button with a menu, a long
// press picks a card up (src/ui/dragDrop.ts), and whatever dragging does the
// menu does too ("Move earlier", "Move later"). Nothing depends on hovering.
//
// With the keyboard: the arrow keys go from card to card, Enter opens. Only
// one card at a time is a stop for the Tab key.
//
// The number of columns goes by the board's measured width, never by the kind
// of device.

import { ItemView, Keymap, Menu, Notice, Platform } from 'obsidian';
import type { MenuPositionDef, PaneType, UserEvent, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { describeCount } from '../../core/binderModel';
import {
  CARD_SIZES,
  MANUSCRIPT_SCOPE,
  buildBoard,
  buildInspector,
  buildSceneCard,
  cardRef,
  dropAt,
  dropInto,
  folderScope,
  gridLayout,
  inspectorPatch,
  isEmptyPatch,
  moveEarlier,
  moveLater,
  readCardSize,
  sameScope,
} from '../../core/cards';
import type {
  Board,
  BoardCard,
  BoardScope,
  CardLists,
  CardMove,
  CardSize,
  InspectorEdits,
  SceneCard,
  SceneData,
  TagKind,
} from '../../core/cards';
import type { ScreenPoint } from '../../core/dropTarget';
import type { NodeRef } from '../../core/types';
import { DragDrop } from '../../ui/dragDrop';
import type { DropHint, Picked } from '../../ui/dragDrop';
import { ACTION_ICONS, TOOLBAR_MORE_ICON, iconName } from '../../ui/icons';
import { isInputMethodKey } from '../../ui/keys';
import { MISSING_LABEL } from '../../ui/missingNote';
import { safely } from '../../ui/safely';
import { CARD_CLASS, buildFolderParts, buildSceneParts, describeScenes, drawFolder, drawScene } from './cardElements';
import type { CardParts } from './cardElements';
import { cardAt, gapAt } from './dropGap';
import type { CardBox } from './dropGap';
import type { CardsChange, CardsProject, CorkboardHost } from './host';
import { MORE_LABEL, iconButton, placeUnder, setShown, settle, tagTitle } from './parts';
import { SynopsisModal } from './synopsisModal';
import { openTagLists } from './tagListsModal';

export const CORKBOARD_VIEW_TYPE = 'spellbook-corkboard';
export const CORKBOARD_VIEW_NAME = 'Corkboard';
export const CORKBOARD_ICON = 'layout-grid';

/** How many cards are worked out and drawn in one go; the rest follow a moment later. */
export const FILL_CHUNK = 40;

/** The card sizes as the size control names them. */
export const SIZE_NAMES: Readonly<Record<CardSize, string>> = { small: 'Small', medium: 'Medium', large: 'Large' };

/** What the board says when its scope holds nothing. */
export const EMPTY_BOARD_TEXT = 'No scenes here yet.';
export const NO_PROJECT_TEXT = 'No Spellbook project is open.';
export const STARTING_TEXT = 'Spellbook is still starting...';

/** On the card a dragged card would be put in front of, and on the last card when it would go to the end. */
export const DROP_BEFORE_CLASS = 'spellbook-drop-before';
export const DROP_AFTER_CLASS = 'spellbook-drop-after';
/** On a folder's card while a scene is held over it: a drop would put the scene into that folder. */
export const DROP_INTO_CLASS = 'spellbook-drop-into';
/** On the card of the scene that is open in the editor. */
export const ACTIVE_CLASS = 'spellbook-is-active';

const STATUS_ICON = ['circle-dot', 'circle'] as const;
const LABEL_ICON = ['tag'] as const;
const LISTS_ICON = ['tags', 'tag'] as const;

interface Elements {
  readonly root: HTMLElement;
  readonly trail: HTMLElement;
  readonly summary: HTMLElement;
  readonly size: HTMLSelectElement;
  readonly scroll: HTMLElement;
  readonly message: HTMLElement;
  readonly grid: HTMLElement;
}

/** A card on the board, kept for as long as the board shows it. */
interface CardRecord {
  /** What it stands for: "scene:<path>" or "folder:<id>". */
  readonly key: string;
  readonly el: HTMLElement;
  /** The card as the board lists it. A scene's is made without its text: see `model`. */
  card: BoardCard;
  /** The inside of the card; null until it is first drawn. */
  parts: CardParts | null;
  /** What the card last drew, to tell whether it has to be drawn again. */
  drawn: string;
  /** What a scene's card was last worked out from; null when it has to be worked out anew. */
  from: {
    readonly frontmatter: unknown;
    readonly text: unknown;
    readonly words: unknown;
    readonly missing: boolean;
    readonly lists: CardLists;
  } | null;
  /** A scene's card as the engine last worked it out, with its synopsis. */
  model: SceneCard | null;
  /** True while it waits to be drawn. */
  queued: boolean;
}

/** What a drag picks up: a card, as the binder node it stands for. */
interface Dragged {
  readonly ref: NodeRef;
  readonly title: string;
}

function keyOf(card: BoardCard): string {
  return card.kind === 'scene' ? sceneKey(card.path) : `folder:${card.id}`;
}

function sceneKey(path: string): string {
  return `scene:${path}`;
}

/** Read the scope a board was showing from what Obsidian remembered of it. Null when it says nothing usable. */
function readScope(state: unknown): BoardScope | null {
  if (typeof state !== 'object' || state === null) return null;
  const scope: unknown = (state as { scope?: unknown }).scope;
  if (typeof scope !== 'object' || scope === null) return null;
  const { kind, id } = scope as { kind?: unknown; id?: unknown };
  if (kind === 'manuscript') return MANUSCRIPT_SCOPE;
  if (kind === 'folder' && typeof id === 'string' && id !== '') return folderScope(id);
  return null;
}

export class CorkboardView extends ItemView {
  private readonly host: CorkboardHost;
  private els: Elements | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  private observer: ResizeObserver | null = null;

  /** Which part of the binder is on show. (Not `scope`: that is Obsidian's name for a view's keyboard shortcuts.) */
  private boardScope: BoardScope = MANUSCRIPT_SCOPE;
  /** The project the board was last drawn for. */
  private project: CardsProject | null = null;
  /** The last project that was on show, by its id. */
  private projectId: string | null = null;
  private board: Board | null = null;

  private records = new Map<string, CardRecord>();
  private byEl = new Map<HTMLElement, CardRecord>();
  /** The cards as they stand on the board, first to last. */
  private order: CardRecord[] = [];
  /** The cards that wait to be worked out and drawn. */
  private queue: CardRecord[] = [];
  private fillStop: (() => void) | null = null;

  /** What the host said has changed, until the next drawing takes it in. */
  private pendingAll = false;
  private pendingPaths = new Set<string>();
  private refreshStop: (() => void) | null = null;

  private cardSize: CardSize;
  /** How many cards stand side by side; 0 until the board was measured. */
  private columns = 0;
  private gap = -1;
  /** What the trail above the board was last drawn for. */
  private trailDrawn = '';
  /** The scenes the host was last told the board shows. */
  private watched = '';

  /** The card that carries the mark of the scene open in the editor. */
  private activeEl: HTMLElement | null = null;
  /** The one card the Tab key stops at. */
  private cursor: CardRecord | null = null;

  private drag: DragDrop<Dragged> | null = null;
  /** Where the cards are, while one is dragged. */
  private boxes: CardBox[] | null = null;
  /** The card that shows where a drop would go, and how. */
  private marker: { readonly el: HTMLElement; readonly cls: string } | null = null;
  /** The folder card that carries the mark for "a drop here goes into this folder", if any. */
  private intoEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, host: CorkboardHost) {
    super(leaf);
    this.host = host;
    // Opening a scene from a card must not replace the board in its own tab.
    this.navigation = false;
    this.cardSize = readCardSize(host.cardSize);
  }

  override getViewType(): string {
    return CORKBOARD_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return CORKBOARD_VIEW_NAME;
  }

  override getIcon(): string {
    return CORKBOARD_ICON;
  }

  // -------------------------------------------- what Obsidian remembers of it

  /** The scope is kept with the workspace, so the board comes back on the folder it was showing. */
  override getState(): Record<string, unknown> {
    return { ...super.getState(), scope: { ...this.boardScope } };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const scope = readScope(state);
    if (scope && !sameScope(scope, this.boardScope)) {
      this.boardScope = scope;
      if (!this.closed) this.render();
    }
    await super.setState(state, result);
  }

  /** The part of the binder on show. */
  get shownScope(): BoardScope {
    return this.boardScope;
  }

  /** Show another part of the binder: the whole manuscript, or one folder. */
  showScope(scope: BoardScope): void {
    if (sameScope(scope, this.boardScope)) return;
    const els = this.els;
    // The card or the step the keyboard is on is about to go.
    const active = els?.root.ownerDocument.activeElement ?? null;
    const hadKeyboard = els !== null && active !== null && els.root.contains(active);
    this.boardScope = scope;
    if (els) els.scroll.scrollTop = 0;
    this.render();
    if (hadKeyboard) this.cursor?.el.focus({ preventScroll: true });
    this.app.workspace.requestSaveLayout();
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    this.columns = 0;
    this.gap = -1;
    this.trailDrawn = '';
    this.watched = '';
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-board-pane');

    const root = pane.createDiv({ cls: 'spellbook-board' });
    // Touch needs larger buttons. Platform.isMobile covers phones and tablets;
    // the stylesheet also covers touch screens on desktop.
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    // On a phone, Obsidian's own bar floats over the bottom of the pane: the
    // stylesheet leaves room for it under the last card.
    root.toggleClass('spellbook-is-phone', Platform.isPhone);

    const header = root.createDiv({ cls: 'spellbook-board-header' });
    const trail = header.createEl('nav', { cls: 'spellbook-board-trail', attr: { 'aria-label': 'Folder on show' } });
    const tools = header.createDiv({ cls: 'spellbook-board-tools' });
    const summary = tools.createDiv({ cls: 'spellbook-board-summary' });
    const size = tools.createEl('select', {
      cls: 'dropdown spellbook-board-size',
      attr: { 'aria-label': 'Card size' },
    });
    for (const option of CARD_SIZES) size.createEl('option', { value: option, text: SIZE_NAMES[option] });
    size.addEventListener('change', () => {
      safely('Card size', () => {
        this.chooseSize(size.value);
      });
    });
    const more = iconButton(tools, 'spellbook-board-more', MORE_LABEL, TOOLBAR_MORE_ICON, (button) => {
      this.showBoardMenu(placeUnder(button));
    });
    more.setAttr('aria-haspopup', 'menu');

    const scroll = root.createDiv({ cls: 'spellbook-board-scroll' });
    const message = scroll.createDiv({ cls: 'spellbook-board-message' });
    const grid = scroll.createDiv({ cls: 'spellbook-board-grid', attr: { role: 'list' } });
    this.els = { root, trail, summary, size, scroll, message, grid };

    // The keyboard: one listener for all the cards.
    grid.addEventListener('keydown', (event) => {
      this.onKey(event);
    });
    // Wherever the keyboard goes on the board (with Tab, or by a click), that
    // card becomes the one the Tab key comes back to.
    grid.addEventListener('focusin', (event) => {
      const found = this.recordAt(event.target);
      if (found) this.setCursor(found.record);
    });

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        this.measure();
      });
      this.observer.observe(pane);
    }

    this.drag = new DragDrop<Dragged>({
      container: scroll,
      scroller: scroll,
      clock: this.host.clock,
      pick: (target) => this.pickUp(target),
      ghost: (ghost, picked) => {
        ghost.createDiv({ cls: 'spellbook-drag-ghost-title', text: picked.data.title, attr: { dir: 'auto' } });
      },
      start: () => {
        this.measureForDrop();
      },
      hover: (picked, point) => this.hintAt(picked.data, point),
      drop: (picked, point) => {
        this.dropCard(picked.data, point);
      },
      end: () => {
        this.showGap(null);
        this.showInto(null);
        this.boxes = null;
      },
    });

    this.stops.push(
      this.host.onChange((change) => {
        this.onHostChange(change);
      }),
    );
    this.applySize();
    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.refreshStop?.();
    this.refreshStop = null;
    this.fillStop?.();
    this.fillStop = null;
    this.observer?.disconnect();
    this.observer = null;
    // Ends a drag that is on, and takes its ghost and its listeners away.
    this.drag?.destroy();
    this.drag = null;
    // Nobody is looking at these scenes any more.
    if (this.watched !== '') this.host.watchScenes(this, []);
    this.watched = '';
    this.forgetCards();
    this.pendingAll = false;
    this.pendingPaths = new Set();
    this.board = null;
    this.project = null;
    this.els = null;
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-board-pane');
  }

  override onResize(): void {
    this.measure();
  }

  private forgetCards(): void {
    this.records = new Map();
    this.byEl = new Map();
    this.order = [];
    this.queue = [];
    this.activeEl = null;
    this.cursor = null;
    this.marker = null;
    this.intoEl = null;
    this.boxes = null;
  }

  // ----------------------------------------------------- following the host

  private onHostChange(change: CardsChange): void {
    if (this.closed) return;
    switch (change.type) {
      case 'project':
        this.pendingAll = true;
        this.scheduleRefresh();
        break;
      case 'scenes':
        for (const path of change.paths) this.pendingPaths.add(path);
        this.scheduleRefresh();
        break;
      case 'active':
        this.markActive(true);
        break;
      case 'cardSize':
        this.applySize();
        break;
    }
  }

  /**
   * Draw again in a moment. The host often reports several changes in a row
   * (a list was stored, then every scene that used the old name): they are
   * all taken in at once.
   */
  private scheduleRefresh(): void {
    if (this.refreshStop !== null || this.closed) return;
    this.refreshStop = this.host.clock.setTimer(() => {
      this.refreshStop = null;
      const paths = this.pendingAll ? null : this.pendingPaths;
      this.pendingAll = false;
      this.pendingPaths = new Set();
      this.render(paths);
    }, 0);
  }

  // ------------------------------------------------------------------ drawing

  /**
   * Bring the board up to date.
   *
   * @param changed the scenes that changed, when that is all that happened;
   *                null when anything may have
   */
  private render(changed: ReadonlySet<string> | null = null): void {
    const els = this.els;
    if (!els || this.closed) return;
    const project = this.host.ready ? this.host.project : null;
    if (project && this.projectId !== null && project.id !== this.projectId) {
      // Another project: its folders are not this board's.
      this.boardScope = MANUSCRIPT_SCOPE;
      els.scroll.scrollTop = 0;
    }
    if (project) this.projectId = project.id;
    this.project = project;

    if (!project) {
      this.drag?.cancel();
      this.board = null;
      for (const record of this.order) record.el.remove();
      this.forgetCards();
      this.showHeader(els, null);
      els.message.setText(this.host.ready ? NO_PROJECT_TEXT : STARTING_TEXT);
      setShown(els.message, true);
      setShown(els.grid, false);
      this.tellWatched(null);
      return;
    }

    // The engine asks about a scene more than once (for the sums, and for its card): the host is asked once.
    const known = new Map<string, SceneData | null | undefined>();
    const board = buildBoard({
      tree: project.tree,
      scope: this.boardScope,
      // Without the scenes' text: the order of the cards and the sums need
      // none of it. Each scene's own card is worked out when it is drawn.
      sceneOf: (path) => {
        if (!known.has(path)) known.set(path, this.lightData(path));
        return known.get(path);
      },
      lists: project.lists,
    });
    // The folder that was on show is not in the binder any more: the manuscript takes its place.
    this.boardScope = board.scope;
    this.board = board;

    const sameOrder = this.placeCards(els, board);
    // The cards have changed places: a drag over them has lost its footing.
    if (!sameOrder) this.drag?.cancel();
    this.showHeader(els, board);
    els.message.setText(board.cards.length === 0 ? EMPTY_BOARD_TEXT : '');
    setShown(els.message, board.cards.length === 0);
    setShown(els.grid, true);

    if (changed === null || !sameOrder) {
      for (const record of this.order) this.enqueue(record, false);
    } else {
      for (const path of changed) {
        const record = this.records.get(sceneKey(path));
        if (record) this.enqueue(record, true);
      }
      // A folder's sums may have changed with a scene inside it.
      for (const record of this.order) if (record.card.kind === 'folder') this.enqueue(record, false);
    }
    this.fillCards();

    this.markActive(false);
    this.placeCursor();
    this.measure();
    this.tellWatched(board);
    // The cards may have grown or shrunk under a card that is being dragged.
    if (this.drag?.active) this.measureForDrop();
  }

  private lightData(path: string): SceneData | null | undefined {
    const data = this.host.sceneData(path);
    return data ? { frontmatter: data.frontmatter, words: data.words } : data;
  }

  /**
   * Put the board's cards in order: a card that is still wanted is used again
   * as it is, a new one starts as an empty shell (filled in by `fillCards`),
   * and one that is no longer wanted goes.
   *
   * @returns true when the same cards stand in the same order as before
   */
  private placeCards(els: Elements, board: Board): boolean {
    const wanted: CardRecord[] = [];
    const next = new Map<string, CardRecord>();
    for (const card of board.cards) {
      const key = keyOf(card);
      // (A binder never lists a scene twice; should it, the first card stands for both.)
      if (next.has(key)) continue;
      let record = this.records.get(key);
      if (record) record.card = card;
      else record = this.makeShell(els.grid, key, card);
      next.set(key, record);
      wanted.push(record);
    }
    for (const record of this.order) {
      if (next.has(record.key)) continue;
      this.byEl.delete(record.el);
      record.el.remove();
      if (this.cursor === record) this.cursor = null;
      if (this.activeEl === record.el) this.activeEl = null;
      if (this.marker?.el === record.el) this.marker = null;
      if (this.intoEl === record.el) this.intoEl = null;
    }
    const kept = this.order.filter((record) => next.has(record.key));
    let first = 0;
    while (first < kept.length && first < wanted.length && kept[first] === wanted[first]) first++;
    const same = first === wanted.length && this.order.length === wanted.length;
    // From the first card that is out of place on, every card is put at the
    // end in turn, which leaves them all in order.
    for (let at = first; at < wanted.length; at++) {
      const record = wanted[at];
      if (record) els.grid.appendChild(record.el);
    }
    this.records = next;
    this.order = wanted;
    return same;
  }

  /** A card with nothing in it yet, in its place on the board, already answering to taps. */
  private makeShell(grid: HTMLElement, key: string, card: BoardCard): CardRecord {
    const el = grid.createDiv({ cls: CARD_CLASS, attr: { role: 'listitem', tabindex: -1 } });
    const record: CardRecord = { key, el, card, parts: null, drawn: '', from: null, model: null, queued: false };
    this.byEl.set(el, record);
    el.addEventListener('click', (event) => {
      safely('Open', () => {
        this.activateCard(record, event);
      });
    });
    // A click with the middle button (the wheel) opens a new tab, as elsewhere in Obsidian.
    el.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      const now = record.card;
      if (now.kind !== 'scene' || now.missing) return;
      event.preventDefault();
      this.openScene(now.path, 'tab');
    });
    // A right-click opens the same menu as the "more" button.
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      safely(MORE_LABEL, () => {
        this.showCardMenu(record, { x: event.clientX, y: event.clientY });
      });
    });
    return record;
  }

  private enqueue(record: CardRecord, anew: boolean): void {
    if (anew) record.from = null;
    if (record.queued) return;
    record.queued = true;
    this.queue.push(record);
  }

  /**
   * Work out and draw the cards that wait, a handful at a time: the first
   * handful now, the rest a moment later, so that a long board never holds
   * the screen up.
   */
  private fillCards(): void {
    this.fillStop?.();
    this.fillStop = null;
    const project = this.project;
    if (!project || this.closed) {
      for (const record of this.queue) record.queued = false;
      this.queue = [];
      return;
    }
    let budget = FILL_CHUNK;
    let at = 0;
    for (; at < this.queue.length && budget > 0; at++) {
      const record = this.queue[at];
      if (!record) continue;
      record.queued = false;
      // A card that left the board while it waited.
      if (this.records.get(record.key) !== record) continue;
      if (this.drawCard(record, project)) budget--;
    }
    this.queue = this.queue.slice(at);
    if (this.queue.length === 0) return;
    this.fillStop = this.host.clock.setTimer(() => {
      this.fillStop = null;
      this.fillCards();
      if (this.drag?.active) this.measureForDrop();
    }, 0);
  }

  /**
   * Bring one card up to date.
   *
   * @returns false when there was nothing to do, which costs next to nothing
   */
  private drawCard(record: CardRecord, project: CardsProject): boolean {
    const card = record.card;
    const menu = (button: HTMLElement): void => {
      this.showCardMenu(record, placeUnder(button));
    };
    if (card.kind === 'folder') {
      const drawn = JSON.stringify(card);
      if (record.parts && record.drawn === drawn) return false;
      const parts = record.parts?.kind === 'folder' ? record.parts : buildFolderParts(record.el, menu);
      this.adopt(record, parts);
      drawFolder(parts, card);
      record.drawn = drawn;
      return true;
    }

    const data = this.host.sceneData(card.path) ?? {};
    const from = record.from;
    if (
      record.parts &&
      from &&
      from.frontmatter === data.frontmatter &&
      from.text === data.text &&
      from.words === data.words &&
      from.missing === card.missing &&
      from.lists === project.lists
    ) {
      return false;
    }
    const model = buildSceneCard(
      { path: card.path, frontmatter: data.frontmatter, text: data.text, words: data.words, missing: card.missing },
      project.lists,
    );
    record.from = {
      frontmatter: data.frontmatter,
      text: data.text,
      words: data.words,
      missing: card.missing,
      lists: project.lists,
    };
    record.model = model;
    const drawn = JSON.stringify(model);
    if (record.parts && record.drawn === drawn) return true;
    const parts = record.parts?.kind === 'scene' ? record.parts : buildSceneParts(record.el, menu);
    this.adopt(record, parts);
    drawScene(record.el, parts, model);
    record.drawn = drawn;
    return true;
  }

  /** A card's inside was just built: its "more" button is a Tab stop when the card is. */
  private adopt(record: CardRecord, parts: CardParts): void {
    if (record.parts === parts) return;
    record.parts = parts;
    parts.more.setAttr('tabindex', this.cursor === record ? 0 : -1);
  }

  /** Tell the host which scenes the board shows as cards, when that has changed. */
  private tellWatched(board: Board | null): void {
    const paths: string[] = [];
    for (const card of board?.cards ?? []) if (card.kind === 'scene' && !card.missing) paths.push(card.path);
    const key = paths.join('\n');
    if (key === this.watched) return;
    this.watched = key;
    this.host.watchScenes(this, paths);
  }

  // ------------------------------------------------------------------- header

  private showHeader(els: Elements, board: Board | null): void {
    const crumbs = board?.breadcrumb ?? [];
    // Drawn anew only when it leads somewhere else, so that the keyboard stays on the step it was on.
    const drawn = JSON.stringify(crumbs);
    if (drawn !== this.trailDrawn) {
      this.trailDrawn = drawn;
      els.trail.empty();
      crumbs.forEach((crumb, position) => {
        if (position > 0) {
          els.trail.createSpan({ cls: 'spellbook-crumb-divider', text: '/', attr: { 'aria-hidden': 'true' } });
        }
        const step = els.trail.createEl('button', {
          cls: 'spellbook-crumb',
          text: crumb.name,
          attr: { type: 'button' },
        });
        // The first step is the app's own word; the others are folder names, the writer's own text.
        if (position > 0) step.setAttr('dir', 'auto');
        if (crumb.current) {
          step.addClass('spellbook-is-current');
          step.setAttr('aria-current', 'page');
        }
        step.addEventListener('click', () => {
          safely(crumb.name, () => {
            this.showScope(crumb.scope);
          });
        });
      });
    }

    let summary = '';
    if (board) {
      summary = describeScenes(board.sceneCount);
      // The sum is not known while a scene is still being counted.
      if (board.words !== null) summary += `, ${describeCount(board.words)}`;
    }
    els.summary.setText(summary);
    els.size.disabled = board === null;
  }

  private showBoardMenu(at: MenuPositionDef): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle('Statuses and labels')
        .setIcon(iconName(...LISTS_ICON))
        .onClick(() => {
          safely('Statuses and labels', () => {
            openTagLists(this.app, this.host);
          });
        });
    });
    menu.showAtPosition(at);
  }

  // ---------------------------------------------------------------- card size

  private chooseSize(value: string): void {
    const size = readCardSize(value);
    if (size !== readCardSize(this.host.cardSize)) this.host.setCardSize(size);
    this.applySize();
  }

  /** Show the cards in the size remembered on this device. */
  private applySize(): void {
    const els = this.els;
    if (!els) return;
    const size = readCardSize(this.host.cardSize);
    this.cardSize = size;
    for (const other of CARD_SIZES) els.grid.toggleClass(`spellbook-size-${other}`, other === size);
    if (els.size.value !== size) els.size.value = size;
    // Cards of another size: another number of them fits side by side.
    this.columns = 0;
    this.measure();
  }

  /** Lay the cards out in as many columns as the board's measured width has room for. */
  private measure(): void {
    const els = this.els;
    if (!els) return;
    const width = els.grid.clientWidth;
    // A board that is hidden has no width: it keeps the columns it had.
    if (!(width > 0)) return;
    const layout = gridLayout(width, this.cardSize);
    if (layout.columns === this.columns && layout.gap === this.gap) return;
    this.columns = layout.columns;
    this.gap = layout.gap;
    els.grid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
    els.grid.style.gap = `${layout.gap}px`;
    els.root.toggleClass('spellbook-is-single', layout.columns === 1);
    if (this.drag?.active) this.measureForDrop();
  }

  // -------------------------------------------------------------- active note

  /**
   * Mark the card of the scene that is open in the editor.
   *
   * @param reveal scroll the card into view
   */
  private markActive(reveal: boolean): void {
    const path = this.host.activeScenePath;
    const el = (path === null ? undefined : this.records.get(sceneKey(path)))?.el ?? null;
    if (el !== this.activeEl) {
      this.activeEl?.removeClass(ACTIVE_CLASS);
      this.activeEl?.setAttr('aria-current', null);
      this.activeEl = el;
      el?.addClass(ACTIVE_CLASS);
      el?.setAttr('aria-current', 'true');
    }
    if (reveal && el) this.revealCard(el);
  }

  /**
   * Scroll the board, and only the board, so that a card can be seen. (The
   * browser's own "scroll into view" may also shift whatever the board sits in.)
   */
  private revealCard(el: HTMLElement): void {
    const scroll = this.els?.scroll;
    if (!scroll) return;
    const box = scroll.getBoundingClientRect();
    const at = el.getBoundingClientRect();
    if (!(at.height > 0) || !(box.height > 0)) return;
    if (at.top < box.top) scroll.scrollTop -= box.top - at.top;
    else if (at.bottom > box.bottom) scroll.scrollTop += at.bottom - box.bottom;
  }

  // ------------------------------------------------------------ tapping cards

  /** What a tap on a card does, and Enter while the keyboard is on it. */
  private activateCard(record: CardRecord, event: UserEvent): void {
    const card = record.card;
    if (card.kind === 'folder') {
      this.showScope(card.opens);
      return;
    }
    if (card.missing) {
      // There is nothing to open, but a tap should not go unanswered.
      new Notice(`"${card.title}": ${MISSING_LABEL}.`);
      return;
    }
    this.openScene(card.path, Keymap.isModEvent(event));
  }

  /** (Not `open`: that is the name of Obsidian's own way of opening a view.) */
  private openScene(path: string, where: PaneType | boolean): void {
    safely('Open', () => this.host.openScene(path, where));
  }

  // -------------------------------------------------------------------- menus

  /** The menu of a card, for the board as it is at this moment. */
  private showCardMenu(record: CardRecord, at: MenuPositionDef): void {
    const project = this.project;
    const board = this.board;
    if (!project || !board || this.records.get(record.key) !== record) return;
    const card = record.card;
    const ref = cardRef(card);
    const locked = project.readOnly;
    const menu = new Menu();
    const add = (title: string, icons: readonly string[], run: () => unknown, off = false): void => {
      menu.addItem((item) => {
        item
          .setTitle(title)
          .setIcon(iconName(...icons))
          .setDisabled(off)
          .onClick(() => {
            safely(title, run);
          });
      });
    };

    if (card.kind === 'folder') {
      add('Open', ACTION_ICONS.moveToFolder, () => {
        this.showScope(card.opens);
      });
    } else {
      add('Open', ACTION_ICONS.open, () => this.host.openScene(card.path, false), card.missing);
      add('Open in new tab', ACTION_ICONS.openInNewTab, () => this.host.openScene(card.path, 'tab'), card.missing);
    }
    menu.addSeparator();
    // What dragging does, without dragging.
    add('Move earlier', ACTION_ICONS.moveUp, () => this.stepCard(ref, 'earlier'), locked || moveEarlier(board, ref) === null);
    add('Move later', ACTION_ICONS.moveDown, () => this.stepCard(ref, 'later'), locked || moveLater(board, ref) === null);
    if (card.kind === 'scene') {
      const off = locked || card.missing;
      menu.addSeparator();
      add(
        'Set status',
        STATUS_ICON,
        () => {
          this.showTagMenu('status', card.path, at);
        },
        off,
      );
      add(
        'Set label',
        LABEL_ICON,
        () => {
          this.showTagMenu('label', card.path, at);
        },
        off,
      );
      add(
        'Edit synopsis',
        ACTION_ICONS.rename,
        () => {
          this.editSynopsis(card.path);
        },
        off,
      );
    }
    menu.showAtPosition(at);
  }

  /** Move a card one place, going by the board as it is now. */
  private stepCard(ref: NodeRef, direction: 'earlier' | 'later'): Promise<boolean> | null {
    const board = this.board;
    if (!board) return null;
    const move = direction === 'earlier' ? moveEarlier(board, ref) : moveLater(board, ref);
    return move ? this.moveCard(move) : null;
  }

  private moveCard(move: CardMove): Promise<boolean> {
    return settle(this.host.moveCard(move));
  }

  /**
   * The list to choose a scene's status or label from: the project's own,
   * then the scene's own when the list does not have it, then "none". The one
   * the scene has is ticked.
   */
  private showTagMenu(kind: TagKind, path: string, at: MenuPositionDef): void {
    const project = this.project;
    if (!project) return;
    const model = buildInspector({ path, frontmatter: this.host.sceneData(path)?.frontmatter }, project.lists);
    const options = kind === 'status' ? model.statusOptions : model.labelOptions;
    const current = kind === 'status' ? model.status : model.label;
    const what = kind === 'status' ? 'Set status' : 'Set label';
    const menu = new Menu();
    const choose = (name: string | null): void => {
      safely(what, () => settle(this.patchScene(path, kind === 'status' ? { status: name } : { label: name })));
    };
    for (const option of options) {
      menu.addItem((item) => {
        item
          .setTitle(tagTitle(option.name, option.color))
          .setChecked(option.selected)
          .onClick(() => {
            choose(option.name);
          });
      });
    }
    if (options.length > 0) menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(kind === 'status' ? 'No status' : 'No label')
        .setChecked(current === null)
        .onClick(() => {
          choose(null);
        });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Edit statuses and labels')
        .setIcon(iconName(...LISTS_ICON))
        .onClick(() => {
          safely('Statuses and labels', () => {
            openTagLists(this.app, this.host);
          });
        });
    });
    menu.showAtPosition(at);
  }

  private editSynopsis(path: string): void {
    const project = this.project;
    if (!project) return;
    const data = this.host.sceneData(path) ?? {};
    const model = buildInspector({ path, frontmatter: data.frontmatter }, project.lists);
    // What the card shows in place of a synopsis, if it was taken from the scene's text.
    const card = this.records.get(sceneKey(path))?.model;
    new SynopsisModal(this.app, {
      scene: model.title,
      value: model.synopsis,
      placeholder: card?.synopsisDerived === true ? card.synopsis : undefined,
      submit: (value) => this.patchScene(path, { synopsis: value }),
    }).open();
  }

  /**
   * Ask the host to change a scene's properties. The engine checks the edit
   * and names only the keys that really change.
   *
   * @returns null when it was done (or there was nothing to do), otherwise why not
   */
  private async patchScene(path: string, edits: InspectorEdits): Promise<string | null> {
    const project = this.host.ready ? this.host.project : null;
    if (!project) return NO_PROJECT_TEXT;
    if (project.readOnly) return 'This project is read-only.';
    const result = inspectorPatch(this.host.sceneData(path)?.frontmatter, edits, project.lists);
    if (!result.ok) return result.errors.map((error) => error.message).join(' ');
    if (isEmptyPatch(result.patch)) return null;
    return this.host.applyScenePatch(path, result.patch);
  }

  // ----------------------------------------------------------------- keyboard

  /** The card an element belongs to, and whether the element is the card's "more" button (or in it). */
  private recordAt(target: EventTarget | null): { record: CardRecord; onButton: boolean } | null {
    const stop = this.els?.grid ?? null;
    for (let at = target as HTMLElement | null; at && at !== stop; at = at.parentElement) {
      const record = this.byEl.get(at);
      if (record) return { record, onButton: record.parts?.more.contains(target as Node) === true };
    }
    return null;
  }

  private setTabStop(record: CardRecord, on: boolean): void {
    record.el.setAttr('tabindex', on ? 0 : -1);
    record.parts?.more.setAttr('tabindex', on ? 0 : -1);
  }

  /** Make a card the one the Tab key stops at (together with its "more" button). */
  private setCursor(record: CardRecord): void {
    if (this.cursor === record) return;
    if (this.cursor) this.setTabStop(this.cursor, false);
    this.cursor = record;
    this.setTabStop(record, true);
  }

  /** After a drawing: give the Tab key a card to stop at, if it has none. */
  private placeCursor(): void {
    if (this.cursor && this.records.get(this.cursor.key) === this.cursor) return;
    this.cursor = null;
    const path = this.host.activeScenePath;
    const first = (path === null ? undefined : this.records.get(sceneKey(path))) ?? this.order[0];
    if (first) this.setCursor(first);
  }

  /** True when Obsidian itself reads from right to left, so that a row of cards starts at the right. */
  private readsRightToLeft(): boolean {
    const root = this.els?.root;
    if (!root) return false;
    return root.ownerDocument.defaultView?.getComputedStyle(root).direction === 'rtl';
  }

  /**
   * A key was pressed while the keyboard was on the board. The arrows go to
   * the card beside, above or below; Home and End to the first and the last;
   * Enter does what a tap does (with Cmd or Ctrl: a scene opens in a new tab).
   */
  private onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.shiftKey) return;
    const found = this.recordAt(event.target);
    // On the "more" button, the keys are the button's.
    if (!found || found.onButton) return;
    const { record } = found;
    if (event.key === 'Enter') {
      if (isInputMethodKey(event)) return;
      event.preventDefault();
      safely('Open', () => {
        this.activateCard(record, event);
      });
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    const from = this.order.indexOf(record);
    const across = Math.max(1, this.columns);
    let to: number;
    switch (event.key) {
      case 'ArrowRight':
        to = from + (this.readsRightToLeft() ? -1 : 1);
        break;
      case 'ArrowLeft':
        to = from + (this.readsRightToLeft() ? 1 : -1);
        break;
      case 'ArrowDown':
        to = from + across;
        break;
      case 'ArrowUp':
        to = from - across;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = this.order.length - 1;
        break;
      default:
        return;
    }
    // The arrows move over the board; they must not also scroll it.
    event.preventDefault();
    const next = from < 0 ? undefined : this.order[to];
    if (!next || next === record) return;
    this.setCursor(next);
    next.el.focus({ preventScroll: true });
    this.revealCard(next.el);
  }

  // ----------------------------------------------------------------- dragging

  /** What a press on something on the board would pick up, if anything. */
  private pickUp(target: EventTarget | null): Picked<Dragged> | null {
    const project = this.project;
    // Nothing can be moved in a project that cannot be changed.
    if (!project || project.readOnly || !this.board) return null;
    const found = this.recordAt(target);
    // A press on the "more" button is for the button.
    if (!found || found.onButton) return null;
    const card = found.record.card;
    // As in the binder: an entry whose note is missing is moved from its menu, not by dragging.
    if (card.kind === 'scene' && card.missing) return null;
    return { el: found.record.el, data: { ref: cardRef(card), title: card.kind === 'scene' ? card.title : card.name } };
  }

  /**
   * Measure where the cards are, for a drag. Heights are kept as they are
   * within the board's contents, so they stay right while the board scrolls.
   */
  private measureForDrop(): void {
    const els = this.els;
    this.boxes = null;
    if (!els) return;
    const box = els.scroll.getBoundingClientRect();
    // The board is hidden: there is nothing to drop on.
    if (!(box.height > 0)) return;
    const scrolled = els.scroll.scrollTop - box.top;
    this.boxes = this.order.map((record) => {
      const at = record.el.getBoundingClientRect();
      return { top: at.top + scrolled, bottom: at.bottom + scrolled, left: at.left, right: at.right };
    });
  }

  /**
   * The move a drop at a place on the screen would make; null when it would
   * change nothing. It comes with where it lands: the gap between two cards
   * (`gap`), or the folder card a scene is dropped onto (`into`).
   */
  private dropFor(
    dragged: Dragged,
    point: ScreenPoint,
  ): { readonly gap: number | null; readonly into: HTMLElement | null; readonly move: CardMove } | null {
    const els = this.els;
    const board = this.board;
    const project = this.project;
    if (!els || !board || !this.boxes || !project || project.readOnly) return null;
    const box = els.scroll.getBoundingClientRect();
    // Beside the board, or above or below what can be seen of it, is nowhere.
    if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) return null;
    const y = point.y + els.scroll.scrollTop - box.top;

    // On the middle of a folder's card, a scene goes into that folder (at its
    // end): the same move the binder makes. The edges of the card still mean
    // the gap beside it, so a scene can be put before or after a folder too.
    const over = cardAt(this.boxes, point.x, y);
    const target = over === null ? undefined : this.order[over];
    if (target && target.card.kind === 'folder') {
      const move = dropInto(board, dragged.ref, cardRef(target.card));
      if (move) return { gap: null, into: target.el, move };
    }

    const gap = gapAt(this.boxes, point.x, y, this.readsRightToLeft());
    if (gap === null) return null;
    const move = dropAt(board, dragged.ref, gap);
    return move ? { gap, into: null, move } : null;
  }

  /** What to show for the place the pointer is at while a card is dragged. */
  private hintAt(dragged: Dragged, point: ScreenPoint): DropHint | null {
    const found = this.dropFor(dragged, point);
    this.showGap(found ? found.gap : null);
    this.showInto(found ? found.into : null);
    // The board marks the place itself, on the card next to it; the drag engine has nothing to draw.
    return found ? {} : null;
  }

  /** Mark the folder card a drop would put the scene into; null takes the mark away. */
  private showInto(el: HTMLElement | null): void {
    if (this.intoEl === el) return;
    this.intoEl?.removeClass(DROP_INTO_CLASS);
    this.intoEl = el;
    el?.addClass(DROP_INTO_CLASS);
  }

  /** Mark the gap a drop would go into: on the card after it, or on the last card for the end of the board. */
  private showGap(gap: number | null): void {
    let el: HTMLElement | null = null;
    let cls = DROP_BEFORE_CLASS;
    if (gap !== null) {
      const after = this.order[gap];
      if (after) {
        el = after.el;
      } else {
        el = this.order[this.order.length - 1]?.el ?? null;
        cls = DROP_AFTER_CLASS;
      }
    }
    if (this.marker && (this.marker.el !== el || this.marker.cls !== cls)) {
      this.marker.el.removeClass(this.marker.cls);
      this.marker = null;
    }
    if (el && !this.marker) {
      el.addClass(cls);
      this.marker = { el, cls };
    }
  }

  /** A card was dropped: ask the host for the move the engine works out. */
  private dropCard(dragged: Dragged, point: ScreenPoint): void {
    const found = this.dropFor(dragged, point);
    if (found) safely('Moving', () => this.moveCard(found.move));
  }
}

/** Make a corkboard for a pane. What Obsidian's `registerView` is given for CORKBOARD_VIEW_TYPE. */
export function createCorkboardView(leaf: WorkspaceLeaf, host: CorkboardHost): CorkboardView {
  return new CorkboardView(leaf, host);
}
