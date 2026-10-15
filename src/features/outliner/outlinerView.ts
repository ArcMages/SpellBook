// The outliner: the manuscript as a table.
//
//   header   the project's name, its words and its number of scenes
//   bar      a box that filters by title and synopsis, the menus that show
//            only chosen statuses and labels, and the Columns menu
//   chips    what is on at the moment: "Sorted by ... (clear)", "3 of 40
//            scenes shown (clear)"
//   table    one row per scene, in binder order under their folders; a first
//            row for the whole manuscript and a Total row at the foot
//
// Everything it shows comes from its host (host.ts) and everything it changes
// is asked of the host: the table itself reads and writes nothing. What the
// rows are, their sums, their order and what passes the filter are all worked
// out by the outliner engine (src/core/outliner).
//
// A large book: the rows are kept and used again from one drawing to the
// next. A change to one scene draws that one row (and the rows of sums above
// it); a change of order moves rows and builds nothing.
//
// Editing in place: a tap on a Target or a Synopsis cell puts a field in the
// cell. While a field is open the table is not drawn again, whatever arrives
// in the meantime; what arrived is taken in when the field closes.
//
// Touch first: every row has a visible "more" button with a menu, a long
// press picks a row up (src/ui/dragDrop.ts), and whatever dragging does the
// menu does too ("Move up", "Move down"). Nothing depends on hovering.
//
// The short list of columns for a narrow pane goes by the pane's measured
// width, never by the kind of device.

import { ItemView, Keymap, Menu, Notice, Platform } from 'obsidian';
import { followLayout, isPhoneLayout } from '../../ui/layout';
import { followWordCounts, showsWordCounts } from '../../ui/wordFigures';
import type { MenuPositionDef, PaneType, UserEvent, WorkspaceLeaf } from 'obsidian';
import { describeCount } from '../../core/binderModel';
import { buildInspector } from '../../core/cards';
import type { CardColor, InspectorEdits, TagKind } from '../../core/cards';
import { canDrop, resolveDrop } from '../../core/dropTarget';
import type { DropBounds, DropRow, DropSpot, ScreenPoint } from '../../core/dropTarget';
import {
  MANUSCRIPT_ROW_KEY,
  NO_FILTER,
  addPropertyColumn,
  buildOutline,
  canMoveColumn,
  columnTitle,
  defaultLayout,
  folderRowKey,
  hasFilterTag,
  isFilterOn,
  isOwnTextTitle,
  isWordColumn,
  moveColumn,
  nextSort,
  otherPropertyKeys,
  paneWidthFor,
  propertyKeysIn,
  rowRef,
  sameLayout,
  sameSums,
  setColumnShown,
  shownColumns,
  stepMove,
  tagFilterKey,
  toggleFilterTag,
} from '../../core/outliner';
import type {
  ColumnId,
  ColumnLayout,
  FolderRow,
  Outline,
  OutlineFilter,
  OutlineRow,
  OutlineSort,
  SceneRow,
} from '../../core/outliner';
import type { NodeRef, TreeNode } from '../../core/types';
import { DragDrop } from '../../ui/dragDrop';
import type { DropHint, Picked } from '../../ui/dragDrop';
import { ACTION_ICONS, iconName, showIcon } from '../../ui/icons';
import { isInputMethodKey } from '../../ui/keys';
import { MISSING_LABEL } from '../../ui/missingNote';
import { ownTextTitle } from '../../ui/ownText';
import { safely } from '../../ui/safely';
import { CELL_CLASS, columnClass, describeScenes, drawSceneCell, drawSumCell } from './cells';
import type { DrawOptions, RowActions, TotalRow } from './cells';
import type { OutlinerChange, OutlinerHost, OutlinerProject } from './host';
import { NO_DRAG_CLASS, placeUnder, setShown, settle, tagTitle, textButton } from './parts';

export const OUTLINER_VIEW_TYPE = 'spellbook-outliner';
export const OUTLINER_VIEW_NAME = 'Outliner';
export const OUTLINER_ICON = 'table';

/** How long after the last key in the filter box the table is filtered, in milliseconds. */
export const SEARCH_DELAY_MS = 150;

export const EMPTY_TEXT = 'No scenes here yet.';
export const NO_MATCH_TEXT = 'No scene passes the filter.';
export const NO_PROJECT_TEXT = 'No Spellbook project is open.';
export const STARTING_TEXT = 'Spellbook is still starting...';
export const READ_ONLY_TEXT = 'This project is read-only.';
export const COUNTING_TEXT = 'Counting words...';
export const SEARCH_PLACEHOLDER = 'Filter by title or synopsis';

/** On the cell that holds an open field. */
export const EDITING_CLASS = 'spellbook-is-editing';
/** On the row that is being dragged. */
export const DRAGGING_CLASS = 'spellbook-outliner-dragging';

/** How far below the last row a drop still counts (as "at the end"), in pixels. */
const ROOM_BELOW_ROWS = 160;

const TOTAL_KEY = 'total';

interface Elements {
  readonly root: HTMLElement;
  readonly heading: HTMLElement;
  readonly summary: HTMLElement;
  readonly search: HTMLInputElement;
  readonly statusButton: HTMLElement;
  readonly labelButton: HTMLElement;
  readonly columnsButton: HTMLElement;
  readonly chips: HTMLElement;
  readonly message: HTMLElement;
  readonly scroll: HTMLElement;
  readonly table: HTMLElement;
  readonly head: HTMLElement;
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
}

/** A row of the table, kept for as long as the table shows it. */
interface RowRecord {
  readonly key: string;
  readonly tr: HTMLElement;
  /** What the row stands for now. */
  row: OutlineRow | TotalRow;
  /** Its cells, by column; made anew when the columns change. */
  cells: Map<ColumnId, HTMLElement>;
  /** What it last drew, to tell whether it has to be drawn again. */
  drawn: { readonly row: OutlineRow | TotalRow; readonly columns: number; readonly flat: boolean; readonly editable: boolean } | null;
}

/** A field that is open in a cell. */
interface OpenField {
  readonly column: 'target' | 'synopsis';
  readonly path: string;
  readonly cell: HTMLElement;
  readonly input: HTMLInputElement | HTMLTextAreaElement;
  /** What the field held when it opened: only something else is saved. */
  readonly initial: string;
  closing: boolean;
}

/** What a drag picks up: a row, as the binder node it stands for. */
interface Dragged {
  readonly ref: NodeRef;
  readonly title: string;
  readonly tr: HTMLElement;
}

/** Where the rows are, while one is dragged. */
interface Measured {
  readonly rows: DropRow[];
  readonly records: RowRecord[];
  readonly bounds: DropBounds;
}

function folderIds(nodes: readonly TreeNode[], into: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    if (node.kind !== 'folder') continue;
    into.add(node.id);
    folderIds(node.children, into);
  }
  return into;
}

/** A column's name in a menu. (The first column's header is just "#".) */
function menuTitle(column: ColumnId): string | DocumentFragment {
  if (column === 'number') return 'Row number (#)';
  return isOwnTextTitle(column) ? ownTextTitle(columnTitle(column)) : columnTitle(column);
}

export class OutlinerView extends ItemView {
  private readonly host: OutlinerHost;
  private els: Elements | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  private observer: ResizeObserver | null = null;

  /** The project the table was last drawn for. */
  private project: OutlinerProject | null = null;
  private projectId: string | null = null;
  private outline: Outline | null = null;

  /** How the table is left for this project: remembered on this device. */
  private sortBy: OutlineSort | null = null;
  private filter: OutlineFilter = NO_FILTER;
  private folded = new Set<string>();

  /** True when the pane is narrow (a phone, or a slim pane): it has its own, short list of columns. */
  private narrow = false;
  private columnLayout: ColumnLayout = defaultLayout('wide');
  /** The columns on show, in order. */
  private columnIds: ColumnId[] = [];
  /** Goes up whenever the columns on show change. */
  private columnsVersion = 0;
  private headDrawn = '';
  private chipsDrawn = '';

  private records = new Map<string, RowRecord>();
  /** The rows as they stand in the table, top to bottom. */
  private order: RowRecord[] = [];
  private totalRecord: RowRecord | null = null;
  /** What each cell belongs to. */
  private cellOwners = new Map<HTMLElement, { readonly record: RowRecord; readonly column: ColumnId }>();

  private refreshStop: (() => void) | null = null;
  private searchStop: (() => void) | null = null;
  /** The field that is open in a cell, if any. */
  private editing: OpenField | null = null;
  /** True when something changed while a field was open: the table is drawn when the field closes. */
  private owed = false;

  private drag: DragDrop<Dragged> | null = null;
  private measured: Measured | null = null;

  private readonly rowActions: RowActions = {
    more: (key, button) => {
      this.showRowMenu(key, placeUnder(button));
    },
    fold: (id) => {
      this.toggleFold(id);
    },
    compile: (path, box) => {
      this.setCompile(path, box);
    },
  };

  constructor(leaf: WorkspaceLeaf, host: OutlinerHost) {
    super(leaf);
    this.host = host;
    // Opening a scene from a row must not replace the table in its own tab.
    this.navigation = false;
  }

  override getViewType(): string {
    return OUTLINER_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return OUTLINER_VIEW_NAME;
  }

  override getIcon(): string {
    return OUTLINER_ICON;
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    this.headDrawn = '';
    this.chipsDrawn = '';
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-outliner-pane');

    const root = pane.createDiv({ cls: 'spellbook-outliner' });
    // Touch needs larger rows. The touch layout (src/ui/layout.ts) decides;
    // the stylesheet also covers touch screens on desktop.
    followLayout(this, root);
    // Word counts can be switched off on this device: the table is drawn again without them.
    followWordCounts(this, root, () => {
      this.render();
    });
    // On a phone, Obsidian's own bar floats over the bottom of the pane: the
    // stylesheet keeps the table clear of it.
    root.toggleClass('spellbook-is-phone', Platform.isPhone);
    // On a computer Obsidian's bottom bar lies over the foot of the pane.
    root.toggleClass('spellbook-has-status-bar', !Platform.isMobile);
    // Until the pane has been measured, the phone layout is taken to be narrow.
    this.narrow = isPhoneLayout(root.win);
    root.toggleClass('spellbook-is-narrow', this.narrow);

    const header = root.createDiv({ cls: 'spellbook-outliner-header' });
    const heading = header.createDiv({ cls: 'spellbook-outliner-heading', attr: { dir: 'auto' } });
    const summary = header.createDiv({ cls: 'spellbook-outliner-summary' });

    const bar = root.createDiv({ cls: 'spellbook-outliner-bar-row' });
    const search = bar.createEl('input', {
      cls: 'spellbook-outliner-search',
      // What is typed here is the writer's own text.
      attr: { type: 'search', dir: 'auto', placeholder: SEARCH_PLACEHOLDER, 'aria-label': SEARCH_PLACEHOLDER },
    });
    search.addEventListener('input', () => {
      this.searchSoon();
    });
    const statusButton = textButton(bar, 'spellbook-outliner-filter', 'Status', (button) => {
      this.showFilterMenu('status', placeUnder(button));
    });
    const labelButton = textButton(bar, 'spellbook-outliner-filter', 'Label', (button) => {
      this.showFilterMenu('label', placeUnder(button));
    });
    const columnsButton = textButton(bar, 'spellbook-outliner-columns', 'Columns', (button) => {
      this.showColumnsMenu(placeUnder(button));
    });
    for (const button of [statusButton, labelButton, columnsButton]) button.setAttr('aria-haspopup', 'menu');

    const chips = root.createDiv({ cls: 'spellbook-outliner-chips' });
    const message = root.createDiv({ cls: 'spellbook-outliner-message' });
    const scroll = root.createDiv({ cls: 'spellbook-outliner-scroll' });
    const table = scroll.createEl('table', { cls: 'spellbook-outliner-table' });
    const head = table.createEl('thead').createEl('tr', { cls: 'spellbook-outliner-head-row' });
    const body = table.createEl('tbody');
    const foot = table.createEl('tfoot');
    this.els = {
      root,
      heading,
      summary,
      search,
      statusButton,
      labelButton,
      columnsButton,
      chips,
      message,
      scroll,
      table,
      head,
      body,
      foot,
    };

    // One listener each for all the rows.
    body.addEventListener('click', (event) => {
      safely('Outliner', () => {
        this.onRowClick(event);
      });
    });
    // A click with the middle button (the wheel) opens a new tab, as elsewhere in Obsidian.
    body.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      const found = this.cellAt(event.target);
      const row = found?.record.row;
      if (!found || found.column !== 'name' || row?.kind !== 'scene' || row.missing) return;
      event.preventDefault();
      this.openScene(row.path, 'tab');
    });
    body.addEventListener('keydown', (event) => {
      this.onRowKey(event);
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
      start: (picked) => {
        picked.data.tr.addClass(DRAGGING_CLASS);
        this.measureForDrop();
      },
      hover: (picked, point) => this.hintAt(picked.data, point),
      drop: (picked, point) => {
        this.dropRow(picked.data, point);
      },
      end: (picked) => {
        picked.data.tr.removeClass(DRAGGING_CLASS);
        this.measured = null;
      },
    });

    this.stops.push(
      this.host.onChange((change) => {
        this.onHostChange(change);
      }),
    );
    this.measure();
    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.refreshStop?.();
    this.refreshStop = null;
    this.searchStop?.();
    this.searchStop = null;
    this.observer?.disconnect();
    this.observer = null;
    // Ends a drag that is on, and takes its ghost and its listeners away.
    this.drag?.destroy();
    this.drag = null;
    // A field that is still open is closed without saving: there is nobody left to tell if it fails.
    if (this.editing) this.editing.closing = true;
    this.editing = null;
    this.owed = false;
    // Nobody is looking at the scenes' to-do lines any more.
    this.host.wantTasks(this, false);
    this.forgetRows();
    this.outline = null;
    this.project = null;
    this.els = null;
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-outliner-pane');
  }

  override onResize(): void {
    this.measure();
  }

  private forgetRows(): void {
    this.records = new Map();
    this.order = [];
    this.totalRecord = null;
    this.cellOwners = new Map();
    this.measured = null;
  }

  // ----------------------------------------------------- following the host

  private onHostChange(change: OutlinerChange): void {
    if (this.closed) return;
    // Whatever changed, the table is worked out again and only the rows that differ are drawn.
    if (change.type === 'project' || change.type === 'scenes' || change.type === 'columns') this.refreshSoon();
  }

  /** Draw again in a moment. Changes that come in a row are all taken in at once. */
  private refreshSoon(): void {
    if (this.refreshStop !== null || this.closed) return;
    this.refreshStop = this.host.clock.setTimer(() => {
      this.refreshStop = null;
      this.render();
    }, 0);
  }

  /** Go by the pane's measured width: a narrow pane gets its own, short list of columns. */
  private measure(): void {
    const els = this.els;
    if (!els) return;
    const narrow = paneWidthFor(this.contentEl.clientWidth, this.narrow ? 'narrow' : 'wide') === 'narrow';
    if (narrow === this.narrow) return;
    this.narrow = narrow;
    els.root.toggleClass('spellbook-is-narrow', narrow);
    this.render();
  }

  // ------------------------------------------------------------------ drawing

  /** True when rows can be put in another order by hand: nothing sorted, nothing filtered, and a project that can be changed. */
  private canReorder(): boolean {
    const project = this.project;
    return project !== null && !project.readOnly && this.sortBy === null && !isFilterOn(this.filter);
  }

  /**
   * Bring the table up to date. While a field is open in a cell, nothing is
   * drawn: what changed is taken in when the field closes.
   */
  private render(): void {
    const els = this.els;
    if (!els || this.closed) return;
    if (this.editing) {
      this.owed = true;
      return;
    }
    this.owed = false;

    const project = this.host.ready ? this.host.project : null;
    if (project && project.id !== this.projectId) {
      // Another project (or the same one at another path): how it was left on this device.
      const choice = this.host.viewChoice(project.id);
      this.sortBy = choice.sort;
      this.filter = choice.filter;
      this.folded = new Set(choice.collapsed);
      this.projectId = project.id;
      this.searchStop?.();
      this.searchStop = null;
      els.search.value = this.filter.text;
      els.scroll.scrollTop = 0;
    }
    this.project = project;

    if (!project) {
      this.drag?.cancel();
      for (const record of this.order) record.tr.remove();
      this.totalRecord?.tr.remove();
      this.forgetRows();
      this.outline = null;
      this.host.wantTasks(this, false);
      els.heading.setText('');
      els.summary.setText('');
      this.drawChips(els, null);
      els.message.setText(this.host.ready ? NO_PROJECT_TEXT : STARTING_TEXT);
      setShown(els.message, true);
      setShown(els.scroll, false);
      this.showFilterButtons(els);
      els.search.disabled = true;
      return;
    }

    this.takeColumns();
    const outline = buildOutline({
      tree: project.tree,
      sceneOf: (path) => this.host.facts(path),
      lists: project.lists,
      filter: this.filter,
      sort: this.sortBy,
      collapsed: this.folded,
      previous: this.outline,
    });
    this.outline = outline;

    const options: DrawOptions = { flat: outline.flat, editable: !project.readOnly };
    this.drawHead(els);
    this.placeRows(els, project, outline, options);
    this.drawTotal(els, outline, options);

    els.heading.setText(project.title);
    const scenes = describeScenes(outline.whole.scenes);
    if (!showsWordCounts()) els.summary.setText(scenes);
    else {
      const words = outline.whole.words === null ? COUNTING_TEXT : describeCount(outline.whole.words);
      els.summary.setText(`${words} · ${scenes}`);
    }
    this.drawChips(els, outline);
    const text = outline.whole.scenes === 0 ? EMPTY_TEXT : outline.total.scenes === 0 ? NO_MATCH_TEXT : '';
    els.message.setText(text);
    setShown(els.message, text !== '');
    setShown(els.scroll, true);
    this.showFilterButtons(els);
    els.search.disabled = false;
    els.table.toggleClass('spellbook-is-flat', outline.flat);
    els.root.toggleClass('spellbook-is-reorderable', this.canReorder());
    // The rows may have moved under a row that is being dragged.
    if (this.drag?.active) this.measureForDrop();
  }

  /** Take the columns this device shows in a pane of this width. */
  private takeColumns(): void {
    const prefs = this.host.columns;
    this.columnLayout = this.narrow ? prefs.narrow : prefs.wide;
    // With word counts switched off on this device, the columns of words
    // (Words, Target and Read time) are left out; the writer's choice of
    // columns is kept for when they are switched on again.
    const chosen = shownColumns(this.columnLayout);
    const ids = showsWordCounts() ? chosen : chosen.filter((id) => !isWordColumn(id));
    if (ids.join('\n') !== this.columnIds.join('\n')) {
      this.columnIds = ids;
      this.columnsVersion++;
    }
    // The scenes' texts are only read while the Tasks column is on show.
    this.host.wantTasks(this, ids.includes('tasks'));
  }

  private drawHead(els: Elements): void {
    const drawn = JSON.stringify([this.columnIds, this.sortBy]);
    if (drawn === this.headDrawn) return;
    this.headDrawn = drawn;
    els.head.empty();
    for (const column of this.columnIds) {
      const direction = this.sortBy?.column === column ? this.sortBy.direction : null;
      const th = els.head.createEl('th', {
        cls: `${CELL_CLASS} spellbook-outliner-head ${columnClass(column)}`,
        attr: { scope: 'col', 'aria-sort': direction === null ? 'none' : direction === 'asc' ? 'ascending' : 'descending' },
      });
      const button = th.createDiv({ cls: 'spellbook-outliner-head-button', attr: { role: 'button', tabindex: 0 } });
      const title = button.createSpan({ cls: 'spellbook-outliner-head-title', text: columnTitle(column) });
      // The header of a property column is the writer's own text.
      if (isOwnTextTitle(column)) title.setAttr('dir', 'auto');
      if (direction !== null) {
        const mark = button.createSpan({ cls: 'spellbook-outliner-sort-mark', attr: { 'aria-hidden': 'true' } });
        showIcon(mark, ...(direction === 'asc' ? ACTION_ICONS.moveUp : ACTION_ICONS.moveDown));
      }
      const sort = (): void => {
        safely('Sort', () => {
          this.setSort(nextSort(this.sortBy, column));
        });
      };
      button.addEventListener('click', sort);
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        sort();
      });
      // A right-click on a header: what the Columns menu does for this one column.
      th.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        safely('Columns', () => {
          this.showHeadMenu(column, { x: event.clientX, y: event.clientY });
        });
      });
    }
  }

  /**
   * Put the rows in order: a row that is still wanted is used again, a new one
   * is made, and one that is no longer wanted goes. Each is drawn only when
   * what it stands for has changed.
   */
  private placeRows(els: Elements, project: OutlinerProject, outline: Outline, options: DrawOptions): void {
    const wanted: RowRecord[] = [];
    const next = new Map<string, RowRecord>();
    for (const row of outline.rows) {
      if (next.has(row.key)) continue;
      const record = this.records.get(row.key) ?? this.makeRecord(els.body, row);
      next.set(row.key, record);
      wanted.push(record);
      this.drawRow(record, row, options);
    }
    for (const record of this.order) {
      if (!next.has(record.key)) record.tr.remove();
    }
    const kept = this.order.filter((record) => next.has(record.key));
    let first = 0;
    while (first < kept.length && first < wanted.length && kept[first] === wanted[first]) first++;
    // From the first row that is out of place on, every row is put at the end
    // in turn, which leaves them all in order.
    for (let at = first; at < wanted.length; at++) {
      const record = wanted[at];
      if (record) els.body.appendChild(record.tr);
    }
    this.order = wanted;

    // A row that is off show for now (filtered out, inside a folded folder, or
    // a folder's row while the table is sorted) is kept for when it comes
    // back. A row whose scene or folder has left the binder is let go of.
    const there = new Set<string>([MANUSCRIPT_ROW_KEY]);
    for (const scene of outline.scenes) there.add(scene.key);
    for (const id of folderIds(project.tree)) there.add(folderRowKey(id));
    for (const [key, record] of this.records) {
      if (next.has(key)) continue;
      if (there.has(key)) next.set(key, record);
      else for (const cell of record.cells.values()) this.cellOwners.delete(cell);
    }
    this.records = next;
  }

  private makeRecord(parent: HTMLElement, row: OutlineRow | TotalRow): RowRecord {
    const tr = parent.createEl('tr', { cls: 'spellbook-outliner-row' });
    return { key: row.key, tr, row, cells: new Map(), drawn: null };
  }

  /** Whether a row has to be drawn again to show what it now stands for. */
  private isStale(record: RowRecord, row: OutlineRow | TotalRow, options: DrawOptions): boolean {
    const drawn = record.drawn;
    if (!drawn || drawn.columns !== this.columnsVersion || drawn.flat !== options.flat || drawn.editable !== options.editable) {
      return true;
    }
    const last = drawn.row;
    // The engine hands out the very same row for a scene that has not changed.
    if (last === row) return false;
    if (row.kind === 'scene' || last.kind === 'scene' || last.kind !== row.kind) return true;
    if (row.kind === 'folder' && last.kind === 'folder') {
      if (row.name !== last.name || row.depth !== last.depth || row.collapsed !== last.collapsed) return true;
    }
    return !sameSums(row.sums, last.sums);
  }

  private drawRow(record: RowRecord, row: OutlineRow | TotalRow, options: DrawOptions): void {
    record.row = row;
    if (!this.isStale(record, row, options)) return;
    if (record.drawn?.columns !== this.columnsVersion) {
      // Other columns: other cells.
      for (const cell of record.cells.values()) this.cellOwners.delete(cell);
      record.tr.empty();
      record.cells = new Map();
      for (const column of this.columnIds) {
        const cell = record.tr.createEl('td', { cls: `${CELL_CLASS} ${columnClass(column)}` });
        record.cells.set(column, cell);
        this.cellOwners.set(cell, { record, column });
      }
    }
    const { tr } = record;
    tr.toggleClass('spellbook-outliner-scene', row.kind === 'scene');
    tr.toggleClass('spellbook-outliner-folder', row.kind === 'folder');
    tr.toggleClass('spellbook-outliner-manuscript', row.kind === 'manuscript');
    tr.toggleClass('spellbook-outliner-total', row.kind === 'total');
    // An entry whose note is missing is greyed, as in the binder.
    tr.toggleClass('spellbook-is-missing', row.kind === 'scene' && row.missing);
    for (const [column, cell] of record.cells) {
      if (row.kind === 'scene') drawSceneCell(cell, column, row, options, this.rowActions);
      else drawSumCell(cell, column, row, options, this.rowActions);
    }
    record.drawn = { row, columns: this.columnsVersion, flat: options.flat, editable: options.editable };
  }

  /** The Total row, at the foot of the table: the sums of the scenes on show. */
  private drawTotal(els: Elements, outline: Outline, options: DrawOptions): void {
    const row: TotalRow = { kind: 'total', key: TOTAL_KEY, sums: outline.total };
    this.totalRecord ??= this.makeRecord(els.foot, row);
    this.drawRow(this.totalRecord, row, options);
  }

  /** What is on at the moment: the sort and the filter, each with a way to switch it off. */
  private drawChips(els: Elements, outline: Outline | null): void {
    const sort = outline ? this.sortBy : null;
    const filtered = outline?.filtered === true ? `${outline.total.scenes} of ${outline.whole.scenes} scenes shown` : '';
    const drawn = JSON.stringify([sort, filtered]);
    if (drawn === this.chipsDrawn) return;
    this.chipsDrawn = drawn;
    els.chips.empty();
    if (sort) {
      const chip = els.chips.createEl('button', {
        cls: 'spellbook-outliner-chip',
        attr: { type: 'button', 'aria-label': 'Clear the sort' },
      });
      chip.createSpan({ text: 'Sorted by ' });
      const name = chip.createSpan({ cls: 'spellbook-outliner-chip-name', text: columnTitle(sort.column) });
      if (isOwnTextTitle(sort.column)) name.setAttr('dir', 'auto');
      chip.createSpan({ text: `, ${sort.direction === 'desc' ? 'descending' : 'ascending'} (clear)` });
      chip.addEventListener('click', () => {
        safely('Clear the sort', () => {
          this.setSort(null);
        });
      });
    }
    if (filtered !== '') {
      const chip = els.chips.createEl('button', {
        cls: 'spellbook-outliner-chip',
        text: `${filtered} (clear)`,
        attr: { type: 'button', 'aria-label': 'Clear the filter' },
      });
      chip.addEventListener('click', () => {
        safely('Clear the filter', () => {
          this.setFilter(NO_FILTER);
        });
      });
    }
    setShown(els.chips, sort !== null || filtered !== '');
  }

  /** The two filter buttons say how many statuses and labels are chosen. */
  private showFilterButtons(els: Elements): void {
    const show = (button: HTMLElement, name: string, chosen: number): void => {
      button.setText(chosen === 0 ? name : `${name} (${chosen})`);
      button.toggleClass('spellbook-is-active', chosen > 0);
    };
    show(els.statusButton, 'Status', this.filter.statuses.length);
    show(els.labelButton, 'Label', this.filter.labels.length);
  }

  // --------------------------------------------- sort, filter, folded folders

  /** Remember on this device how the table is left for this project. */
  private keepChoice(): void {
    const project = this.project;
    if (!project) return;
    // Folders that are no longer in the binder are not kept.
    const there = folderIds(project.tree);
    this.host.setViewChoice(project.id, {
      sort: this.sortBy,
      filter: this.filter,
      collapsed: [...this.folded].filter((id) => there.has(id)),
    });
  }

  private setSort(sort: OutlineSort | null): void {
    this.sortBy = sort;
    this.keepChoice();
    this.render();
  }

  private setFilter(filter: OutlineFilter): void {
    this.filter = isFilterOn(filter) ? filter : NO_FILTER;
    const els = this.els;
    // The box follows the filter, unless the writer is typing in it right now.
    if (els && els.search.value.trim() !== this.filter.text.trim()) els.search.value = this.filter.text;
    this.keepChoice();
    this.render();
  }

  /** Filter by what was typed, once the typing has stopped for a moment. */
  private searchSoon(): void {
    this.searchStop?.();
    this.searchStop = this.host.clock.setTimer(() => {
      this.searchStop = null;
      const els = this.els;
      if (!els || this.closed || !this.project) return;
      const text = els.search.value;
      if (text.trim() === this.filter.text.trim()) return;
      this.filter = { ...this.filter, text };
      if (!isFilterOn(this.filter)) this.filter = NO_FILTER;
      this.keepChoice();
      this.render();
    }, SEARCH_DELAY_MS);
  }

  private toggleFold(id: string): void {
    if (!this.folded.delete(id)) this.folded.add(id);
    this.keepChoice();
    this.render();
  }

  // ------------------------------------------------------------ tapping rows

  /** The cell an element is in (or is), with the row and the column it belongs to. */
  private cellAt(target: EventTarget | null): { record: RowRecord; column: ColumnId; cell: HTMLElement } | null {
    const stop = this.els?.table ?? null;
    for (let at = target as HTMLElement | null; at && at !== stop; at = at.parentElement) {
      const owner = this.cellOwners.get(at);
      if (owner) return { ...owner, cell: at };
    }
    return null;
  }

  private onRowClick(event: MouseEvent): void {
    // A tap in the open field is the field's own.
    if (this.editing) return;
    const found = this.cellAt(event.target);
    if (found) this.activateCell(found.record, found.column, found.cell, event);
  }

  /** Enter on a cell does what a tap does (with Cmd or Ctrl: a scene opens in a new tab). */
  private onRowKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || this.editing || event.key !== 'Enter' || isInputMethodKey(event)) return;
    const found = this.cellAt(event.target);
    if (!found) return;
    // On a button or a tick box inside the cell, the key is theirs.
    const target = event.target as HTMLElement | null;
    if (target !== found.cell && target?.getAttr('role') !== 'link') return;
    event.preventDefault();
    safely('Outliner', () => {
      this.activateCell(found.record, found.column, found.cell, event);
    });
  }

  /** What a tap on a cell does. */
  private activateCell(record: RowRecord, column: ColumnId, cell: HTMLElement, event: UserEvent): void {
    const row = record.row;
    if (row.kind === 'folder') {
      // A tap on a folder's name folds it shut, or opens it.
      if (column === 'name') this.toggleFold(row.id);
      return;
    }
    if (row.kind !== 'scene') return;
    switch (column) {
      case 'name':
        if (row.missing) {
          // There is nothing to open, but a tap should not go unanswered.
          new Notice(`"${row.title}": ${MISSING_LABEL}.`);
          return;
        }
        this.openScene(row.path, Keymap.isModEvent(event));
        return;
      case 'status':
      case 'label':
        if (this.mayEdit(row)) this.showTagMenu(column, row, placeUnder(cell));
        return;
      case 'target':
      case 'synopsis':
        if (this.mayEdit(row)) this.openField(column, row, cell);
        return;
      default:
        return;
    }
  }

  /** Whether a scene can be changed; when not, the writer is told why. */
  private mayEdit(row: SceneRow): boolean {
    if (row.missing) {
      new Notice(`"${row.title}": ${MISSING_LABEL}.`);
      return false;
    }
    if (this.project?.readOnly !== false) {
      new Notice(READ_ONLY_TEXT);
      return false;
    }
    return true;
  }

  /** (Not `open`: that is the name of Obsidian's own way of opening a view.) */
  private openScene(path: string, where: PaneType | boolean): void {
    safely('Open', () => this.host.openScene(path, where));
  }

  // ------------------------------------------------------- editing in place

  private patchScene(what: string, path: string, edits: InspectorEdits): void {
    safely(what, () => settle(this.host.patchScene(path, edits)));
  }

  private setCompile(path: string, box: HTMLInputElement): void {
    const wanted = box.checked;
    safely('Compile', async () => {
      // When it could not be saved, the box goes back to what the scene says.
      if (!(await settle(this.host.patchScene(path, { compile: wanted })))) box.checked = !wanted;
    });
  }

  /**
   * Put a field into a cell: a number for the target, the text for the
   * synopsis. Enter saves, Escape leaves things as they were, and so does
   * closing the field without having changed anything. Tapping elsewhere saves.
   */
  private openField(column: 'target' | 'synopsis', row: SceneRow, cell: HTMLElement): void {
    if (this.editing) return;
    let input: HTMLInputElement | HTMLTextAreaElement;
    let initial: string;
    if (column === 'target') {
      initial = row.target === null ? '' : String(row.target);
      input = cell.createEl('input', {
        cls: `spellbook-outliner-input ${NO_DRAG_CLASS}`,
        attr: { type: 'number', min: 0, step: 1, inputmode: 'numeric', 'aria-label': 'Word target' },
      });
    } else {
      initial = row.synopsis;
      // A synopsis may have several lines: a box that keeps them, and takes the direction of what is written.
      input = cell.createEl('textarea', {
        cls: `spellbook-outliner-input ${NO_DRAG_CLASS}`,
        attr: { rows: 2, dir: 'auto', 'aria-label': 'Synopsis' },
      });
    }
    input.value = initial;
    cell.addClass(EDITING_CLASS);
    this.editing = { column, path: row.path, cell, input, initial, closing: false };
    // (Listened to as a plain element: the two kinds of field hear the same events.)
    const listened: HTMLElement = input;
    listened.addEventListener('keydown', (key) => {
      if (key.key === 'Escape') {
        key.preventDefault();
        key.stopPropagation();
        this.closeField(false, true);
        return;
      }
      // In the synopsis, Shift+Enter starts a new line.
      if (key.key !== 'Enter' || isInputMethodKey(key) || (column === 'synopsis' && key.shiftKey)) return;
      key.preventDefault();
      key.stopPropagation();
      this.closeField(true, true);
    });
    listened.addEventListener('blur', () => {
      this.closeField(true, false);
    });
    input.focus();
    input.select();
  }

  /**
   * Close the open field.
   *
   * @param save    save what it holds, when that is not what it held when it opened
   * @param refocus hand the keyboard back to the cell (after Enter or Escape)
   */
  private closeField(save: boolean, refocus: boolean): void {
    const field = this.editing;
    if (!field || field.closing) return;
    field.closing = true;
    const value = field.input.value;
    this.editing = null;
    field.cell.removeClass(EDITING_CLASS);
    field.input.remove();
    if (refocus) field.cell.focus({ preventScroll: true });
    if (save && value !== field.initial) {
      if (field.column === 'target') this.patchScene('Target', field.path, { target: value });
      else this.patchScene('Synopsis', field.path, { synopsis: value });
    }
    // What changed while the field was open is taken in now.
    if (this.owed) this.refreshSoon();
  }

  // -------------------------------------------------------------------- menus

  private addMenuItem(
    menu: Menu,
    title: string | DocumentFragment,
    what: string,
    run: () => unknown,
    options: { icons?: readonly string[]; off?: boolean; checked?: boolean } = {},
  ): void {
    menu.addItem((item) => {
      item
        .setTitle(title)
        .setDisabled(options.off === true)
        .onClick(() => {
          safely(what, run);
        });
      if (options.icons) item.setIcon(iconName(...options.icons));
      if (options.checked !== undefined) item.setChecked(options.checked);
    });
  }

  /** The menu of a row, for the table as it is at this moment. */
  private showRowMenu(key: string, at: MenuPositionDef): void {
    const project = this.project;
    const row = this.records.get(key)?.row;
    if (!project || !row || (row.kind !== 'scene' && row.kind !== 'folder')) return;
    const menu = new Menu();
    if (row.kind === 'scene') {
      this.addMenuItem(menu, 'Open', 'Open', () => this.host.openScene(row.path, false), {
        icons: ACTION_ICONS.open,
        off: row.missing,
      });
      this.addMenuItem(menu, 'Open in new tab', 'Open in new tab', () => this.host.openScene(row.path, 'tab'), {
        icons: ACTION_ICONS.openInNewTab,
        off: row.missing,
      });
    } else {
      const title = row.collapsed ? 'Expand' : 'Collapse';
      this.addMenuItem(menu, title, title, () => {
        this.toggleFold(row.id);
      });
    }
    menu.addSeparator();
    // What dragging does, without dragging. Like dragging, only in manuscript order.
    const free = this.canReorder();
    this.addMenuItem(menu, 'Move up', 'Move up', () => this.stepRow(row, 'up'), {
      icons: ACTION_ICONS.moveUp,
      off: !free || stepMove(project.tree, project.lists, row, 'up') === null,
    });
    this.addMenuItem(menu, 'Move down', 'Move down', () => this.stepRow(row, 'down'), {
      icons: ACTION_ICONS.moveDown,
      off: !free || stepMove(project.tree, project.lists, row, 'down') === null,
    });
    menu.showAtPosition(at);
  }

  /** Move a row one place, going by the binder as it is now. */
  private stepRow(row: SceneRow | FolderRow, direction: 'up' | 'down'): Promise<boolean> | null {
    const project = this.project;
    if (!project || !this.canReorder()) return null;
    const move = stepMove(project.tree, project.lists, row, direction);
    return move ? settle(this.host.moveNode(move.ref, move.placement)) : null;
  }

  /**
   * The list to choose a scene's status or label from: the project's own,
   * then the scene's own when the list does not have it, then "none". The one
   * the scene has is ticked.
   */
  private showTagMenu(kind: TagKind, row: SceneRow, at: MenuPositionDef): void {
    const project = this.project;
    if (!project) return;
    const model = buildInspector({ path: row.path, frontmatter: row.frontmatter }, project.lists);
    const options = kind === 'status' ? model.statusOptions : model.labelOptions;
    const current = kind === 'status' ? model.status : model.label;
    const what = kind === 'status' ? 'Set status' : 'Set label';
    const choose = (name: string | null): void => {
      this.patchScene(what, row.path, kind === 'status' ? { status: name } : { label: name });
    };
    const menu = new Menu();
    for (const option of options) {
      this.addMenuItem(
        menu,
        tagTitle(option.name, option.color),
        what,
        () => {
          choose(option.name);
        },
        { checked: option.selected },
      );
    }
    if (options.length > 0) menu.addSeparator();
    this.addMenuItem(
      menu,
      kind === 'status' ? 'No status' : 'No label',
      what,
      () => {
        choose(null);
      },
      { checked: current === null },
    );
    menu.showAtPosition(at);
  }

  /** The menu that shows only the scenes with chosen statuses, or labels. Each name can be ticked and unticked. */
  private showFilterMenu(kind: TagKind, at: MenuPositionDef): void {
    const project = this.project;
    if (!project) return;
    const list = kind === 'status' ? project.lists.statuses : project.lists.labels;
    const chosen = kind === 'status' ? this.filter.statuses : this.filter.labels;
    const what = kind === 'status' ? 'Filter by status' : 'Filter by label';
    const set = (names: readonly string[]): void => {
      this.setFilter(kind === 'status' ? { ...this.filter, statuses: names } : { ...this.filter, labels: names });
    };
    // The project's list, then the names scenes use that the list lacks.
    const names: Array<{ name: string; color: CardColor | null }> = list.tags.map((tag) => ({ name: tag.name, color: tag.color }));
    const seen = new Set(names.map((entry) => tagFilterKey(entry.name)));
    for (const scene of this.outline?.scenes ?? []) {
      const tag = kind === 'status' ? scene.status : scene.label;
      if (!tag || seen.has(tagFilterKey(tag.name))) continue;
      seen.add(tagFilterKey(tag.name));
      names.push({ name: tag.name, color: tag.color });
    }
    const menu = new Menu();
    for (const entry of names) {
      this.addMenuItem(
        menu,
        tagTitle(entry.name, entry.color),
        what,
        () => {
          set(toggleFilterTag(chosen, entry.name));
        },
        { checked: hasFilterTag(chosen, entry.name) },
      );
    }
    if (names.length > 0) menu.addSeparator();
    this.addMenuItem(
      menu,
      kind === 'status' ? 'No status' : 'No label',
      what,
      () => {
        set(toggleFilterTag(chosen, null));
      },
      { checked: hasFilterTag(chosen, null) },
    );
    menu.addSeparator();
    this.addMenuItem(
      menu,
      'Show all',
      what,
      () => {
        set([]);
      },
      { off: chosen.length === 0 },
    );
    menu.showAtPosition(at);
  }

  // ------------------------------------------------------------------ columns

  /** Change the columns of panes of this width, on this device. */
  private changeLayout(next: ColumnLayout): void {
    const prefs = this.host.columns;
    // The host tells every open outliner, this one included.
    this.host.setColumns(this.narrow ? { ...prefs, narrow: next } : { ...prefs, wide: next });
  }

  /** The Columns menu: every column with a tick to show or hide it, and what else can be done with columns. */
  private showColumnsMenu(at: MenuPositionDef): void {
    const layout = this.columnLayout;
    const menu = new Menu();
    for (const column of layout) {
      this.addMenuItem(
        menu,
        menuTitle(column.id),
        'Columns',
        () => {
          this.changeLayout(setColumnShown(layout, column.id, !column.shown));
        },
        // The Name column is what the rows are known by: it stays.
        { checked: column.shown, off: column.id === 'name' },
      );
    }
    menu.addSeparator();
    this.addMenuItem(
      menu,
      'Add property column',
      'Add property column',
      () => {
        this.showPropertyMenu(at);
      },
      { off: this.freeProperties().length === 0 },
    );
    this.addMenuItem(menu, 'Reorder columns', 'Reorder columns', () => {
      this.showReorderMenu(at);
    });
    const usual = defaultLayout(this.narrow ? 'narrow' : 'wide');
    this.addMenuItem(
      menu,
      'Reset columns',
      'Reset columns',
      () => {
        this.changeLayout(usual);
      },
      { off: sameLayout(layout, usual) },
    );
    menu.showAtPosition(at);
  }

  /** The other properties found in the scenes that have no column yet. */
  private freeProperties(): string[] {
    const taken = new Set(propertyKeysIn(this.columnLayout));
    return otherPropertyKeys(this.host.sceneProperties()).filter((key) => !taken.has(key));
  }

  private showPropertyMenu(at: MenuPositionDef): void {
    const menu = new Menu();
    for (const key of this.freeProperties()) {
      // A property's name is the writer's own text.
      this.addMenuItem(menu, ownTextTitle(key), 'Add property column', () => {
        this.changeLayout(addPropertyColumn(this.columnLayout, key));
      });
    }
    menu.showAtPosition(at);
  }

  /** Choose a column to move; then which way. (For a touch screen: what a right-click on a header offers with a mouse.) */
  private showReorderMenu(at: MenuPositionDef): void {
    const menu = new Menu();
    for (const column of shownColumns(this.columnLayout)) {
      this.addMenuItem(menu, menuTitle(column), 'Reorder columns', () => {
        const next = new Menu();
        this.addMoveItems(next, column);
        next.showAtPosition(at);
      });
    }
    menu.showAtPosition(at);
  }

  private addMoveItems(menu: Menu, column: ColumnId): void {
    const layout = this.columnLayout;
    this.addMenuItem(
      menu,
      'Move earlier',
      'Move earlier',
      () => {
        this.changeLayout(moveColumn(layout, column, -1));
      },
      { icons: ACTION_ICONS.moveUp, off: !canMoveColumn(layout, column, -1) },
    );
    this.addMenuItem(
      menu,
      'Move later',
      'Move later',
      () => {
        this.changeLayout(moveColumn(layout, column, 1));
      },
      { icons: ACTION_ICONS.moveDown, off: !canMoveColumn(layout, column, 1) },
    );
  }

  /** The menu of one column's header. */
  private showHeadMenu(column: ColumnId, at: MenuPositionDef): void {
    const menu = new Menu();
    const sorted = this.sortBy?.column === column ? this.sortBy.direction : null;
    this.addMenuItem(
      menu,
      'Sort ascending',
      'Sort',
      () => {
        this.setSort({ column, direction: 'asc' });
      },
      { checked: sorted === 'asc' },
    );
    this.addMenuItem(
      menu,
      'Sort descending',
      'Sort',
      () => {
        this.setSort({ column, direction: 'desc' });
      },
      { checked: sorted === 'desc' },
    );
    this.addMenuItem(
      menu,
      'Clear sort',
      'Sort',
      () => {
        this.setSort(null);
      },
      { off: this.sortBy === null },
    );
    menu.addSeparator();
    this.addMoveItems(menu, column);
    this.addMenuItem(
      menu,
      'Hide column',
      'Hide column',
      () => {
        this.changeLayout(setColumnShown(this.columnLayout, column, false));
      },
      { off: column === 'name' },
    );
    menu.showAtPosition(at);
  }

  // ----------------------------------------------------------------- dragging

  /** What a press on something in the table would pick up, if anything. */
  private pickUp(target: EventTarget | null): Picked<Dragged> | null {
    // Rows are moved by hand only in manuscript order, and never while a field is open.
    if (!this.canReorder() || this.editing) return null;
    const found = this.cellAt(target);
    if (!found) return null;
    const { record } = found;
    // A press on a button, a tick box or a field is for them.
    for (let at = target as HTMLElement | null; at && at !== record.tr; at = at.parentElement) {
      if (at.hasClass(NO_DRAG_CLASS)) return null;
    }
    const row = record.row;
    if (row.kind !== 'scene' && row.kind !== 'folder') return null;
    // As in the binder: an entry whose note is missing is moved from its menu, not by dragging.
    if (row.kind === 'scene' && row.missing) return null;
    const ref = rowRef(row);
    if (!ref) return null;
    // The ghost takes the size of the name, not of the whole (wide) row.
    const el = record.cells.get('name') ?? found.cell;
    return { el, data: { ref, title: row.kind === 'scene' ? row.title : row.name, tr: record.tr } };
  }

  /**
   * Measure where the rows are, for a drag. Heights are kept as they are
   * within the table's own scrolling, so they stay right while it scrolls.
   */
  private measureForDrop(): void {
    const els = this.els;
    this.measured = null;
    if (!els) return;
    const box = els.scroll.getBoundingClientRect();
    // The table is hidden: there is nothing to drop on.
    if (!(box.height > 0)) return;
    const scrolled = els.scroll.scrollTop - box.top;
    const rows: DropRow[] = [];
    const records: RowRecord[] = [];
    for (const record of this.order) {
      const row = record.row;
      if (row.kind !== 'scene' && row.kind !== 'folder') continue;
      const ref = rowRef(row);
      if (!ref) continue;
      const at = record.tr.getBoundingClientRect();
      rows.push({ ref, parentId: row.parentId, top: at.top + scrolled, bottom: at.bottom + scrolled });
      records.push(record);
    }
    const last = rows[rows.length - 1];
    this.measured = { rows, records, bounds: { top: 0, bottom: (last?.bottom ?? 0) + ROOM_BELOW_ROWS } };
  }

  /** Where a drop at a place on the screen would put the dragged row; null when it would change nothing. */
  private spotAt(dragged: Dragged, point: ScreenPoint): DropSpot | null {
    const els = this.els;
    const project = this.project;
    const measured = this.measured;
    if (!els || !project || !measured || !this.canReorder()) return null;
    const box = els.scroll.getBoundingClientRect();
    // Beside the table, or above or below what can be seen of it, is nowhere.
    if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) return null;
    const spot = resolveDrop(measured.rows, point.y + els.scroll.scrollTop - box.top, measured.bounds);
    return spot && canDrop(project.tree, dragged.ref, spot.placement) ? spot : null;
  }

  /** What to show for the place the pointer is at while a row is dragged. */
  private hintAt(dragged: Dragged, point: ScreenPoint): DropHint | null {
    const els = this.els;
    const measured = this.measured;
    const spot = this.spotAt(dragged, point);
    if (!els || !measured || !spot) return null;
    const box = els.scroll.getBoundingClientRect();
    const over = measured.records[spot.over]?.row;
    // A folder that is folded shut opens when the pointer rests on it.
    const spring =
      over?.kind === 'folder' && over.collapsed
        ? {
            key: over.key,
            open: (): void => {
              if (this.folded.delete(over.id)) {
                this.keepChoice();
                this.render();
              }
            },
          }
        : null;
    if (spot.mark.kind === 'line') {
      // Across the part of the table that can be seen.
      return { line: { x: box.left, y: spot.mark.y - els.scroll.scrollTop + box.top, width: box.width }, spring };
    }
    const into = spot.mark.kind === 'into' ? (measured.records[spot.mark.row]?.tr ?? null) : els.table;
    return { into, spring };
  }

  /** A row was dropped: ask the host for the move. */
  private dropRow(dragged: Dragged, point: ScreenPoint): void {
    const spot = this.spotAt(dragged, point);
    if (spot) safely('Moving', () => settle(this.host.moveNode(dragged.ref, spot.placement)));
  }
}

/** Make an outliner for a pane. What Obsidian's `registerView` is given for OUTLINER_VIEW_TYPE. */
export function createOutlinerView(leaf: WorkspaceLeaf, host: OutlinerHost): OutlinerView {
  return new OutlinerView(leaf, host);
}
