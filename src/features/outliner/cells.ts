// What stands in each cell of the outliner.
//
// A cell is drawn from the row the engine worked out (src/core/outliner) and
// nothing else. The writer's own text (titles, names, synopses, tags, the
// values of properties) always goes in as text, in an element that takes the
// direction of the text itself; numbers and the app's own words do not, so
// that number columns stay in line.

import { describeCount, formatCount } from '../../core/binderModel';
import { formatDisplayDate } from '../../core/cards';
import {
  TARGET_BANDS,
  formatPercent,
  formatReadTime,
  formatTasks,
  isBuiltInColumn,
  propertyKeyOf,
  propertyText,
  readProperty,
  targetCell,
} from '../../core/outliner';
import type { ColumnId, FolderRow, ManuscriptRow, SceneRow, Sums, TargetCell } from '../../core/outliner';
import { MANUSCRIPT_FOLDER } from '../../core/projectLayout';
import { FOLD_ICON, ROW_MORE_ICON } from '../../ui/icons';
import { MISSING_LABEL } from '../../ui/missingNote';
import { DOT_CLASS, MORE_LABEL, NO_DRAG_CLASS, iconButton, setColor } from './parts';

/** On every cell of the table, header cells included. */
export const CELL_CLASS = 'spellbook-outliner-cell';
/** On a cell that a tap edits. */
export const EDITABLE_CLASS = 'spellbook-outliner-editable';
/** On the title of a scene: what a tap opens. */
export const TITLE_CLASS = 'spellbook-outliner-title';
/** On the tick box of the Compile column. */
export const COMPILE_CLASS = 'spellbook-outliner-compile';

export const TOTAL_NAME = 'Total';

/** The row at the foot of the table. */
export interface TotalRow {
  readonly kind: 'total';
  readonly key: 'total';
  readonly sums: Sums;
}

/** A row that stands for more than one scene. */
export type SumRow = FolderRow | ManuscriptRow | TotalRow;

/** The class that marks a column's cells, so that the stylesheet can size and align them. */
export function columnClass(id: ColumnId): string {
  return isBuiltInColumn(id) ? `spellbook-outliner-col-${id}` : 'spellbook-outliner-col-property';
}

/** A number of scenes in words: "1 scene", "12 scenes". */
export function describeScenes(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'scene' : 'scenes'}`;
}

/** What the buttons inside a row do. */
export interface RowActions {
  /** The "more" button of a row was pressed. */
  more(key: string, button: HTMLElement): void;
  /** The arrow in front of a folder's name was pressed. */
  fold(id: string): void;
  /** The tick box of the Compile column was changed. */
  compile(path: string, box: HTMLInputElement): void;
}

/** How a row is drawn. */
export interface DrawOptions {
  /** True when the table is a flat list (sorted by a column): rows are not set in. */
  readonly flat: boolean;
  /** True when the scenes can be changed: the project is not read-only. */
  readonly editable: boolean;
}

function indent(inner: HTMLElement, depth: number, flat: boolean): void {
  // One step for each level of the binder, as the stylesheet measures a step.
  inner.style.paddingInlineStart = flat || depth <= 0 ? '' : `calc(${depth} * var(--spellbook-outliner-indent))`;
}

/** The Target cell: the percentage, with a bar behind it that is filled that far and coloured by its band. */
function drawTarget(cell: HTMLElement, target: TargetCell | null, sum: boolean): void {
  if (target === null) return;
  const box = cell.createDiv({ cls: 'spellbook-outliner-target' });
  for (const band of TARGET_BANDS) box.toggleClass(`spellbook-outliner-band-${band}`, band === target.band);
  const bar = box.createDiv({ cls: 'spellbook-outliner-bar', attr: { 'aria-hidden': 'true' } });
  bar.style.width = `${target.fill}%`;
  box.createSpan({ cls: 'spellbook-outliner-percent', text: formatPercent(target) });
  // A row of sums says what the percentage is of: the targets of its scenes, added up.
  if (sum) box.createSpan({ cls: 'spellbook-outliner-of', text: `of ${formatCount(target.target)}` });
  const written = target.words === null ? '' : `${formatCount(target.words)} of `;
  box.setAttr('aria-label', `${written}${describeCount(target.target)}`);
}

function setEditable(cell: HTMLElement, label: string): void {
  cell.addClass(EDITABLE_CLASS);
  cell.setAttr('tabindex', 0);
  cell.setAttr('role', 'button');
  cell.setAttr('aria-label', label);
}

function clearCell(cell: HTMLElement): void {
  cell.empty();
  cell.removeClass(EDITABLE_CLASS);
  for (const name of ['tabindex', 'role', 'aria-label']) cell.setAttr(name, null);
}

/** Draw one cell of a scene's row. */
export function drawSceneCell(
  cell: HTMLElement,
  column: ColumnId,
  row: SceneRow,
  options: DrawOptions,
  actions: RowActions,
): void {
  clearCell(cell);
  const canEdit = options.editable && !row.missing;
  const property = propertyKeyOf(column);
  if (property !== null) {
    const text = propertyText(readProperty(row.frontmatter, property));
    if (text !== '') cell.createDiv({ cls: 'spellbook-outliner-text', text, attr: { dir: 'auto' } });
    return;
  }
  switch (column) {
    case 'number':
      cell.setText(String(row.number));
      return;
    case 'name': {
      const inner = cell.createDiv({ cls: 'spellbook-outliner-name' });
      indent(inner, row.depth, options.flat);
      const title = inner.createSpan({ cls: TITLE_CLASS, text: row.title, attr: { dir: 'auto', role: 'link', tabindex: 0 } });
      if (row.missing) {
        title.setAttr('aria-disabled', 'true');
        inner.createSpan({ cls: 'spellbook-outliner-missing', text: MISSING_LABEL });
      }
      iconButton(inner, 'spellbook-outliner-more', MORE_LABEL, ROW_MORE_ICON, (button) => {
        actions.more(row.key, button);
      }).setAttr('aria-haspopup', 'menu');
      return;
    }
    case 'status': {
      if (row.status) {
        const pill = cell.createSpan({ cls: 'spellbook-outliner-status', text: row.status.name, attr: { dir: 'auto' } });
        setColor(pill, row.status.color);
      }
      if (canEdit) setEditable(cell, `Status: ${row.status?.name ?? 'none'}. Change`);
      return;
    }
    case 'label': {
      if (row.label) {
        const label = cell.createSpan({ cls: 'spellbook-outliner-label' });
        setColor(label.createSpan({ cls: DOT_CLASS }), row.label.color);
        label.createSpan({ cls: 'spellbook-outliner-label-name', text: row.label.name, attr: { dir: 'auto' } });
      }
      if (canEdit) setEditable(cell, `Label: ${row.label?.name ?? 'none'}. Change`);
      return;
    }
    case 'target':
      drawTarget(cell, targetCell(row.words, row.target), false);
      if (canEdit) setEditable(cell, row.target === null ? 'Set a word target' : 'Change the word target');
      return;
    case 'words':
      if (typeof row.words === 'number') cell.setText(formatCount(row.words));
      return;
    case 'synopsis':
      if (row.synopsis !== '') {
        cell.createDiv({ cls: 'spellbook-outliner-text', text: row.synopsis, attr: { dir: 'auto' } });
      }
      if (canEdit) setEditable(cell, 'Edit the synopsis');
      return;
    case 'tags': {
      if (row.tags.length === 0) return;
      const list = cell.createDiv({ cls: 'spellbook-outliner-tags' });
      for (const tag of row.tags) list.createSpan({ cls: 'spellbook-outliner-tag', text: `#${tag}`, attr: { dir: 'auto' } });
      return;
    }
    case 'tasks':
      cell.setText(formatTasks(row.tasks));
      return;
    case 'readTime':
      cell.setText(formatReadTime(row.words));
      return;
    case 'compile': {
      if (row.missing) return;
      const box = cell.createEl('input', {
        cls: `${COMPILE_CLASS} ${NO_DRAG_CLASS}`,
        attr: { type: 'checkbox', 'aria-label': 'Include in compile' },
      });
      box.checked = row.compile;
      box.disabled = !options.editable;
      box.addEventListener('change', () => {
        actions.compile(row.path, box);
      });
      return;
    }
    case 'created':
      cell.setText(formatDisplayDate(row.created));
      return;
    case 'edited':
      cell.setText(formatDisplayDate(row.edited));
      return;
    default:
      return;
  }
}

/** Draw one cell of a row that stands for more than one scene: a folder, the manuscript, or the Total row. */
export function drawSumCell(
  cell: HTMLElement,
  column: ColumnId,
  row: SumRow,
  options: DrawOptions,
  actions: RowActions,
): void {
  clearCell(cell);
  const { sums } = row;
  switch (column) {
    case 'name': {
      const inner = cell.createDiv({ cls: 'spellbook-outliner-name' });
      if (row.kind === 'folder') {
        indent(inner, row.depth, options.flat);
        const fold = iconButton(inner, 'spellbook-outliner-fold', row.collapsed ? 'Expand' : 'Collapse', FOLD_ICON, () => {
          actions.fold(row.id);
        });
        fold.setAttr('aria-expanded', row.collapsed ? 'false' : 'true');
        // A folder's name is the writer's own text.
        inner.createSpan({ cls: 'spellbook-outliner-folder-name', text: row.name, attr: { dir: 'auto' } });
      } else {
        inner.createSpan({
          cls: 'spellbook-outliner-folder-name',
          text: row.kind === 'total' ? TOTAL_NAME : MANUSCRIPT_FOLDER,
        });
      }
      inner.createSpan({ cls: 'spellbook-outliner-count', text: describeScenes(sums.scenes) });
      if (row.kind === 'folder') {
        iconButton(inner, 'spellbook-outliner-more', MORE_LABEL, ROW_MORE_ICON, (button) => {
          actions.more(row.key, button);
        }).setAttr('aria-haspopup', 'menu');
      }
      return;
    }
    case 'target':
      // Measured against the words of the scenes that have a target of their own.
      drawTarget(cell, targetCell(sums.targetWords, sums.target), true);
      return;
    case 'words':
      // Not known while a scene is still being counted: a half-made sum is never shown as the total.
      if (sums.words !== null) cell.setText(formatCount(sums.words));
      return;
    case 'tasks':
      cell.setText(formatTasks(sums.tasks));
      return;
    case 'readTime':
      cell.setText(formatReadTime(sums.words));
      return;
    default:
      return;
  }
}
