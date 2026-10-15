// The plot grid: which scene carries which plotline, as a table.
//
//   header   the project's name and its number of scenes
//   bar      what the columns are (timeline lanes, labels, characters,
//            places or chosen entities), "Choose" for the chosen ones, and
//            whether each scene's synopsis shows on a second line
//   table    a row per scene in binder order, under rows for the folders
//            (which fold); a column per plotline, headed by its name, its
//            count of scenes and a thin bar of where in the book they are
//
// A filled cell shows a dot in the column's colour with a tick in it (so the
// colour is never all there is to see). A tap on a cell puts the scene in the
// column or takes it out: the host writes that one property of that scene.
// A long stretch of scenes a column is missing from is shaded quietly, and so
// (unless the setting turns it off) are the scenes before its first scene and
// after its last, so that the span where it is in the story stands out.
//
// The scene names stay at the start while the plot columns scroll sideways;
// on a narrow pane (measured, not guessed from the device) the cells are at
// least as big as a fingertip and the columns snap into place as they scroll.
// Nothing depends on hovering: the synopsis that shows as a tooltip on a
// computer can be put on a second line with a tap.

import { ItemView, Keymap, Menu, Notice, Platform } from 'obsidian';
import { followLayout, isPhoneLayout } from '../../ui/layout';
import type { WorkspaceLeaf } from 'obsidian';
import { CARD_COLORS } from '../../core/cards';
import type { CardColor } from '../../core/cards';
import { paneWidthFor } from '../../core/outliner';
import { COLUMN_KINDS, COLUMN_KIND_NAMES } from '../../core/plotgrid';
import type { ColumnKind, GridColumn, GridFolderRow, GridSceneRow, PlotGrid } from '../../core/plotgrid';
import { FOLD_ICON, showIcon } from '../../ui/icons';
import { MISSING_LABEL } from '../../ui/missingNote';
import { safely } from '../../ui/safely';
import type { PlotGridHost } from './host';
import { PROBLEM_NOTICE_MS } from './host';
import { openEntityPicker } from './pickerModal';

export const PLOT_GRID_VIEW_TYPE = 'spellbook-plotgrid';
export const PLOT_GRID_VIEW_NAME = 'Plot grid';
export const PLOT_GRID_ICON = 'layout-grid';

export const NO_PROJECT_TEXT = 'No Spellbook project is open.';
export const STARTING_TEXT = 'Spellbook is still starting...';
export const READ_ONLY_TEXT = 'This project is read-only.';
export const NO_SCENES_TEXT = 'No scenes here yet.';
export const CHOOSE_TEXT = 'Choose';
export const SYNOPSIS_TEXT = 'Synopsis line';

/** What the grid says when a kind of column has none. */
export const NO_COLUMNS_TEXT: Readonly<Record<ColumnKind, string>> = {
  lanes: 'No timeline lanes yet. Add lanes on the timeline, then put scenes in them here.',
  labels: 'No labels yet. Add labels in the inspector, then give scenes their labels here.',
  characters: 'No characters in the World yet.',
  places: 'No places in the World yet.',
  chosen: `No entities chosen yet. Tap "${CHOOSE_TEXT}" to pick the ones to follow.`,
};

/** On a cell whose scene is in the column. */
export const FILLED_CLASS = 'spellbook-plotgrid-filled';
/** On a cell in a long stretch the column is missing from. */
export const GAP_CLASS = 'spellbook-plotgrid-gap';
/** On a cell before the column's first scene or after its last: outside the stretch it is in the story. */
export const OUTSIDE_CLASS = 'spellbook-plotgrid-outside';
/** On a cell whose change is being saved. */
export const BUSY_CLASS = 'spellbook-plotgrid-busy';

const TICK_ICON = ['check'];

interface Elements {
  readonly root: HTMLElement;
  readonly heading: HTMLElement;
  readonly summary: HTMLElement;
  readonly kindButton: HTMLElement;
  readonly chooseButton: HTMLElement;
  readonly synopsisButton: HTMLElement;
  readonly message: HTMLElement;
  readonly scroll: HTMLElement;
  readonly head: HTMLElement;
  readonly body: HTMLElement;
}

/** What a tap or a key on something in the table does. */
type Action =
  | { readonly type: 'cell'; readonly path: string; readonly column: string; readonly on: boolean }
  | { readonly type: 'open'; readonly path: string }
  | { readonly type: 'fold'; readonly id: string };

function colorClass(color: CardColor): string {
  return `spellbook-plotgrid-color-${color}`;
}

function setColor(el: HTMLElement, color: CardColor | null): void {
  for (const other of CARD_COLORS) el.toggleClass(colorClass(other), other === color);
  el.toggleClass('spellbook-plotgrid-no-color', color === null);
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 10000) / 100}%`;
}

function scenesText(count: number): string {
  return count === 1 ? '1 scene' : `${count} scenes`;
}

function textButton(parent: HTMLElement, cls: string, text: string, press: (button: HTMLElement) => unknown): HTMLElement {
  const button = parent.createEl('button', { cls, text, attr: { type: 'button' } });
  button.addEventListener('click', () => {
    safely(text, () => press(button));
  });
  return button;
}

export class PlotGridView extends ItemView {
  private readonly host: PlotGridHost;
  private els: Elements | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  private observer: ResizeObserver | null = null;
  private narrow = false;
  /** What each element of the table that can be tapped does. */
  private actions = new Map<HTMLElement, Action>();
  /** The cells whose change is being saved, as "path\ncolumn": a second tap waits for the first. */
  private readonly pending = new Set<string>();

  constructor(leaf: WorkspaceLeaf, host: PlotGridHost) {
    super(leaf);
    this.host = host;
    // Opening a scene from a row must not replace the grid in its own tab.
    this.navigation = false;
  }

  override getViewType(): string {
    return PLOT_GRID_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return PLOT_GRID_VIEW_NAME;
  }

  override getIcon(): string {
    return PLOT_GRID_ICON;
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-plotgrid-pane');

    const root = pane.createDiv({ cls: 'spellbook-plotgrid' });
    followLayout(this, root);
    root.toggleClass('spellbook-is-phone', Platform.isPhone);
    // Until the pane has been measured, the phone layout is taken to be narrow.
    this.narrow = isPhoneLayout(root.win);
    root.toggleClass('spellbook-is-narrow', this.narrow);

    const header = root.createDiv({ cls: 'spellbook-plotgrid-header' });
    const heading = header.createDiv({ cls: 'spellbook-plotgrid-heading', attr: { dir: 'auto' } });
    const summary = header.createDiv({ cls: 'spellbook-plotgrid-summary' });

    const bar = root.createDiv({ cls: 'spellbook-plotgrid-bar-row' });
    const kindButton = textButton(bar, 'spellbook-plotgrid-kind', 'Columns', (button) => {
      this.showKindMenu(button);
    });
    kindButton.setAttr('aria-haspopup', 'menu');
    const chooseButton = textButton(bar, 'spellbook-plotgrid-choose', CHOOSE_TEXT, () => {
      openEntityPicker(this.app, this.host);
    });
    const synopsisButton = textButton(bar, 'spellbook-plotgrid-synopsis-toggle', SYNOPSIS_TEXT, () => {
      this.host.setSynopsisLine(!this.host.prefs.synopsisLine);
    });

    const message = root.createDiv({ cls: 'spellbook-plotgrid-message' });
    const scroll = root.createDiv({ cls: 'spellbook-plotgrid-scroll' });
    const table = scroll.createEl('table', { cls: 'spellbook-plotgrid-table' });
    const head = table.createEl('thead').createEl('tr', { cls: 'spellbook-plotgrid-head-row' });
    const body = table.createEl('tbody');
    this.els = { root, heading, summary, kindButton, chooseButton, synopsisButton, message, scroll, head, body };

    // One listener each for the whole table.
    body.addEventListener('click', (event) => {
      safely('Plot grid', () => {
        this.onPress(event, Keymap.isModEvent(event));
      });
    });
    body.addEventListener('auxclick', (event) => {
      // The middle button (the wheel) opens a scene in a new tab, as elsewhere in Obsidian.
      if (event.button !== 1) return;
      const action = this.actionAt(event.target);
      if (action?.type !== 'open') return;
      event.preventDefault();
      void this.host.openScene(action.path, 'tab');
    });
    body.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (this.actionAt(event.target) === null) return;
      event.preventDefault();
      this.onPress(event, false);
    });

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        this.measure();
      });
      this.observer.observe(pane);
    }
    this.stops.push(
      this.host.onChange(() => {
        this.render();
      }),
    );
    this.measure();
    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.observer?.disconnect();
    this.observer = null;
    this.actions = new Map();
    this.pending.clear();
    this.els = null;
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-plotgrid-pane');
  }

  override onResize(): void {
    this.measure();
  }

  /** Go by the pane's own width, with a margin either way so that it does not flicker at the edge. */
  private measure(): void {
    const els = this.els;
    if (!els) return;
    const narrow = paneWidthFor(this.contentEl.clientWidth, this.narrow ? 'narrow' : 'wide') === 'narrow';
    if (narrow === this.narrow) return;
    this.narrow = narrow;
    els.root.toggleClass('spellbook-is-narrow', narrow);
  }

  // ------------------------------------------------------------------ drawing

  private render(): void {
    const els = this.els;
    if (!els || this.closed) return;
    const project = this.host.ready ? this.host.project : null;
    const prefs = this.host.prefs;
    const kind = prefs.kind;
    els.kindButton.setText(`Columns: ${COLUMN_KIND_NAMES[kind]}`);
    els.chooseButton.toggleClass('spellbook-plotgrid-off', kind !== 'chosen');
    els.synopsisButton.toggleClass('is-active', prefs.synopsisLine);
    els.synopsisButton.setAttr('aria-pressed', prefs.synopsisLine ? 'true' : 'false');

    this.actions = new Map();
    els.head.empty();
    els.body.empty();
    const grid = project ? this.host.grid() : null;
    if (!project || !grid) {
      els.heading.setText('');
      els.summary.setText('');
      this.say(this.host.ready ? NO_PROJECT_TEXT : STARTING_TEXT);
      return;
    }
    els.heading.setText(project.title);
    els.summary.setText(project.readOnly ? `${scenesText(grid.sceneCount)}. ${READ_ONLY_TEXT}` : scenesText(grid.sceneCount));
    if (grid.columns.length === 0) {
      this.say(NO_COLUMNS_TEXT[kind]);
      return;
    }
    if (grid.sceneCount === 0) {
      this.say(NO_SCENES_TEXT);
      return;
    }
    this.say(null);
    this.drawHead(els.head, grid, grid.heading ?? 'Scene');
    for (const row of grid.rows) {
      if (row.kind === 'folder') this.drawFolder(els.body, row, grid);
      else this.drawScene(els.body, row, grid, project.readOnly, prefs.synopsisLine);
    }
  }

  /** Show a message instead of the table; null shows the table. */
  private say(text: string | null): void {
    const els = this.els;
    if (!els) return;
    els.message.setText(text ?? '');
    els.message.toggleClass('spellbook-plotgrid-off', text === null);
    els.scroll.toggleClass('spellbook-plotgrid-off', text !== null);
  }

  private drawHead(tr: HTMLElement, grid: PlotGrid, heading: string): void {
    tr.createEl('th', { cls: 'spellbook-plotgrid-corner', text: heading, attr: { scope: 'col' } });
    for (const column of grid.columns) this.drawColumnHead(tr, column, grid.sceneCount);
  }

  private drawColumnHead(tr: HTMLElement, column: GridColumn, sceneCount: number): void {
    const th = tr.createEl('th', { cls: 'spellbook-plotgrid-head', attr: { scope: 'col' } });
    const top = th.createDiv({ cls: 'spellbook-plotgrid-head-top' });
    const dot = top.createSpan({ cls: 'spellbook-plotgrid-head-dot' });
    setColor(dot, column.color);
    if (column.icon !== null) showIcon(dot, column.icon);
    // The writer's own text: it takes its own direction.
    top.createSpan({ cls: 'spellbook-plotgrid-head-name', text: column.name, attr: { dir: 'auto', title: column.name } });
    if (!column.listed) th.addClass('spellbook-plotgrid-unlisted');
    th.createDiv({
      cls: 'spellbook-plotgrid-head-count',
      text: String(column.count),
      attr: { 'aria-label': `${column.name}: ${column.count} of ${scenesText(sceneCount)}` },
    });
    // Where in the book its scenes are, and the long stretches without it.
    const bar = th.createDiv({ cls: 'spellbook-plotgrid-coverage', attr: { 'aria-hidden': 'true' } });
    setColor(bar, column.color);
    for (const segment of column.segments) {
      const piece = bar.createDiv({ cls: 'spellbook-plotgrid-coverage-run' });
      piece.style.insetInlineStart = percent(segment.start);
      piece.style.inlineSize = percent(segment.end - segment.start);
    }
    for (const gap of column.gaps) {
      const piece = bar.createDiv({ cls: 'spellbook-plotgrid-coverage-gap' });
      piece.style.insetInlineStart = percent(gap.from / sceneCount);
      piece.style.inlineSize = percent((gap.to - gap.from + 1) / sceneCount);
    }
  }

  private drawFolder(body: HTMLElement, row: GridFolderRow, grid: PlotGrid): void {
    const tr = body.createEl('tr', { cls: 'spellbook-plotgrid-row spellbook-plotgrid-folder' });
    const th = tr.createEl('th', { cls: 'spellbook-plotgrid-name', attr: { scope: 'row' } });
    const inner = th.createDiv({ cls: 'spellbook-plotgrid-name-inner' });
    inner.style.paddingInlineStart = row.depth <= 0 ? '' : `calc(${row.depth} * var(--spellbook-plotgrid-indent))`;
    const fold = inner.createDiv({
      cls: 'spellbook-plotgrid-fold',
      attr: {
        role: 'button',
        tabindex: 0,
        'aria-expanded': row.folded ? 'false' : 'true',
        'aria-label': row.folded ? `Unfold ${row.name}` : `Fold ${row.name}`,
      },
    });
    fold.toggleClass('is-collapsed', row.folded);
    showIcon(fold, ...FOLD_ICON);
    this.actions.set(fold, { type: 'fold', id: row.id });
    const name = inner.createSpan({ cls: 'spellbook-plotgrid-folder-name', text: row.name, attr: { dir: 'auto' } });
    this.actions.set(name, { type: 'fold', id: row.id });
    inner.createSpan({ cls: 'spellbook-plotgrid-folder-scenes', text: String(row.sceneCount), attr: { 'aria-label': scenesText(row.sceneCount) } });
    grid.columns.forEach((column, at) => {
      const count = row.counts[at] ?? 0;
      const td = tr.createEl('td', { cls: 'spellbook-plotgrid-cell spellbook-plotgrid-folder-cell' });
      if (count > 0) td.createSpan({ cls: 'spellbook-plotgrid-folder-count', text: String(count), attr: { 'aria-label': `${column.name}: ${scenesText(count)}` } });
    });
  }

  private drawScene(body: HTMLElement, row: GridSceneRow, grid: PlotGrid, readOnly: boolean, synopsisLine: boolean): void {
    const tr = body.createEl('tr', { cls: 'spellbook-plotgrid-row spellbook-plotgrid-scene' });
    tr.toggleClass('spellbook-plotgrid-missing', row.missing);
    const th = tr.createEl('th', { cls: 'spellbook-plotgrid-name', attr: { scope: 'row' } });
    const inner = th.createDiv({ cls: 'spellbook-plotgrid-name-inner' });
    inner.style.paddingInlineStart = row.depth <= 0 ? '' : `calc(${row.depth} * var(--spellbook-plotgrid-indent))`;
    const text = inner.createDiv({ cls: 'spellbook-plotgrid-name-text' });
    const synopsis = row.missing ? '' : this.host.synopsis(row.path);
    const title = text.createSpan({
      cls: 'spellbook-plotgrid-title',
      text: row.title,
      attr: { dir: 'auto', role: 'link', tabindex: 0 },
    });
    // On a computer the synopsis shows when the pointer rests on the name; the button above the table puts it on a line of its own.
    if (synopsis !== '') title.setAttr('title', synopsis);
    this.actions.set(title, { type: 'open', path: row.path });
    if (row.missing) text.createSpan({ cls: 'spellbook-plotgrid-missing-label', text: MISSING_LABEL });
    if (synopsisLine && synopsis !== '') {
      text.createDiv({ cls: 'spellbook-plotgrid-synopsis', text: synopsis, attr: { dir: 'auto' } });
    }

    const locked = readOnly || row.missing;
    grid.columns.forEach((column, at) => {
      const on = row.cells[at] === true;
      const td = tr.createEl('td', { cls: 'spellbook-plotgrid-cell' });
      td.toggleClass(GAP_CLASS, row.gaps[at] === true);
      td.toggleClass(OUTSIDE_CLASS, row.outside[at] === true);
      const mark = td.createDiv({
        cls: 'spellbook-plotgrid-mark',
        attr: {
          role: 'button',
          tabindex: locked ? -1 : 0,
          'aria-pressed': on ? 'true' : 'false',
          'aria-label': `${column.name}: ${row.title}`,
        },
      });
      if (locked) mark.setAttr('aria-disabled', 'true');
      mark.toggleClass(FILLED_CLASS, on);
      mark.toggleClass(BUSY_CLASS, this.pending.has(`${row.path}\n${column.key}`));
      if (on) {
        const dot = mark.createSpan({ cls: 'spellbook-plotgrid-dot' });
        setColor(dot, column.color);
        showIcon(dot, ...TICK_ICON);
      }
      if (!locked) this.actions.set(mark, { type: 'cell', path: row.path, column: column.key, on: !on });
    });
  }

  // ------------------------------------------------------------------ actions

  /** What the element under a tap does: the element itself or the nearest one around it that does something. */
  private actionAt(target: EventTarget | null): Action | null {
    const stop = this.els?.body ?? null;
    for (let element = target as HTMLElement | null; element && element !== stop; element = element.parentElement) {
      const action = this.actions.get(element);
      if (action) return action;
    }
    return null;
  }

  private onPress(event: Event, where: ReturnType<typeof Keymap.isModEvent>): void {
    const action = this.actionAt(event.target);
    if (!action) return;
    switch (action.type) {
      case 'open':
        void this.host.openScene(action.path, where);
        return;
      case 'fold':
        this.host.toggleFold(action.id);
        return;
      case 'cell':
        void this.setCell(action.path, action.column, action.on, event.target as HTMLElement | null);
        return;
    }
  }

  private async setCell(path: string, column: string, on: boolean, target: HTMLElement | null): Promise<void> {
    const key = `${path}\n${column}`;
    if (this.pending.has(key)) return;
    this.pending.add(key);
    // Shows at once that the tap was taken; the grid is drawn anew once the change is saved.
    for (let element = target; element; element = element.parentElement) {
      if (this.actions.has(element)) {
        element.addClass(BUSY_CLASS);
        break;
      }
    }
    let message: string | null;
    try {
      message = await this.host.setCell(path, column, on);
    } catch (error) {
      console.error('Spellbook: a change could not be saved', error);
      message = error instanceof Error ? error.message : String(error);
    } finally {
      this.pending.delete(key);
    }
    if (message !== null) new Notice(message, PROBLEM_NOTICE_MS);
    this.render();
  }

  private showKindMenu(anchor: HTMLElement): void {
    const menu = new Menu();
    const now = this.host.prefs.kind;
    for (const kind of COLUMN_KINDS) {
      menu.addItem((item) => {
        item
          .setTitle(COLUMN_KIND_NAMES[kind])
          .setChecked(kind === now)
          .onClick(() => {
            this.host.setKind(kind);
            if (kind === 'chosen' && this.host.chosen.length === 0 && this.host.pickableEntities().length > 0) {
              openEntityPicker(this.app, this.host);
            }
          });
      });
    }
    const box = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: box.left, y: box.bottom, width: box.width });
  }
}

export function createPlotGridView(leaf: WorkspaceLeaf, host: PlotGridHost): PlotGridView {
  return new PlotGridView(leaf, host);
}
