// The Revision pane: the revision notes of the whole manuscript, by scene in
// binder order.
//
//   header   the name of the pane, and "Find and replace"
//   filters  Open / Done / All, and which part of the binder
//   status   how many notes are shown; read out when it changes
//   list     each scene with notes: its title (a tap shows the scene), then
//            its notes: the passage quoted (a tap shows it in the scene,
//            selected), the note, the day it was made, a tick for "done",
//            Edit and Delete. A note whose passage is no longer in the scene
//            says "Passage changed".
//
// Everything it shows comes from the keeper, and everything it changes goes
// through it. Touch first: every action is a button or a tick, nothing
// depends on hovering or on dragging.

import { ItemView, Notice, Platform } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { formatCount } from '../../core/binderModel';
import { pathKey } from '../../core/paths';
import type { PlacedNote } from '../../core/revision/index';
import { ConfirmModal } from '../../ui/confirmModal';
import { iconName } from '../../ui/icons';
import { safely } from '../../ui/safely';
import type { FeatureClock } from '../registry';
import { RevisionKeeper } from './keeper';
import type { RevisionChange, SceneNotes } from './keeper';
import { NoteModal } from './noteModal';

export const REVISION_VIEW_TYPE = 'spellbook-revision';
export const REVISION_VIEW_NAME = 'Revision';
export const REVISION_ICONS = ['message-square-text', 'message-square', 'pencil'] as const;

export function revisionIcon(): string {
  return iconName(...REVISION_ICONS) ?? 'pencil';
}

export type NoteFilter = 'open' | 'done' | 'all';

export const FILTER_NAMES: Record<NoteFilter, string> = { open: 'Open', done: 'Done', all: 'All' };
export const PASSAGE_CHANGED_TEXT = 'Passage changed';
export const EDIT_TEXT = 'Edit';
export const DELETE_TEXT = 'Delete';
export const DONE_TEXT = 'Done';
export const FIND_BUTTON_TEXT = 'Find and replace';
export const ALL_FOLDERS_TEXT = 'Whole manuscript';
export const NO_PROJECT_PANE_TEXT = 'Open a Spellbook project to see its revision notes.';
export const EMPTY_TEXT = 'No revision notes yet. Select some words in a scene and run "Add revision note" (also in the editor\'s right-click menu).';

/** How long after a scene was saved its passages are looked for again, in milliseconds. */
const RECHECK_MS = 800;
const PROBLEM_NOTICE_MS = 10000;

/** "3 open notes in 2 scenes". */
export function countText(notes: number, scenes: number, filter: NoteFilter): string {
  const kind = filter === 'all' ? '' : `${filter} `;
  return `${formatCount(notes)} ${kind}${notes === 1 ? 'note' : 'notes'} in ${formatCount(scenes)} ${scenes === 1 ? 'scene' : 'scenes'}`;
}

/** The notes of each scene that pass a filter; scenes left with none are left out. */
export function filtered(all: readonly SceneNotes[], filter: NoteFilter, scenes: ReadonlySet<string> | null): SceneNotes[] {
  const shown: SceneNotes[] = [];
  for (const entry of all) {
    if (scenes !== null && !scenes.has(pathKey(entry.scene.path))) continue;
    const notes = entry.notes.filter((note) => filter === 'all' || (filter === 'done') === note.done);
    if (notes.length > 0) shown.push({ scene: entry.scene, notes });
  }
  return shown;
}

/** What the pane needs beyond the keeper: the windows it opens. */
export interface RevisionPaneActions {
  openFind(): void;
}

export class RevisionView extends ItemView {
  private readonly keeper: RevisionKeeper;
  private readonly clock: FeatureClock;
  private readonly actions: RevisionPaneActions;
  private filter: NoteFilter = 'open';
  private folder: string | null = null;
  private root: HTMLElement | null = null;
  private filters: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private stops: Array<() => void> = [];
  private closed = true;
  /** For each scene (by path key), the notes whose passage is no longer in its text, by their place in the list. */
  private readonly changed = new Map<string, Set<number>>();
  private cancelRecheck: (() => void) | null = null;
  private checking = 0;

  constructor(leaf: WorkspaceLeaf, keeper: RevisionKeeper, clock: FeatureClock, actions: RevisionPaneActions) {
    super(leaf);
    this.keeper = keeper;
    this.clock = clock;
    this.actions = actions;
    this.navigation = false;
  }

  override getViewType(): string {
    return REVISION_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return REVISION_VIEW_NAME;
  }

  override getIcon(): string {
    return revisionIcon();
  }

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-revision-pane');
    const root = pane.createDiv({ cls: 'spellbook-revision' });
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    root.toggleClass('spellbook-is-phone', Platform.isPhone);
    const header = root.createDiv({ cls: 'spellbook-revision-header' });
    header.createDiv({ cls: 'spellbook-revision-heading', text: REVISION_VIEW_NAME });
    const find = header.createEl('button', { cls: 'spellbook-revision-button', text: FIND_BUTTON_TEXT, attr: { type: 'button' } });
    find.addEventListener('click', () => {
      safely(FIND_BUTTON_TEXT, () => this.actions.openFind());
    });
    this.filters = root.createDiv({ cls: 'spellbook-revision-filters' });
    this.status = root.createDiv({ cls: 'spellbook-revision-status', attr: { 'aria-live': 'polite' } });
    this.list = root.createDiv({ cls: 'spellbook-revision-list' });
    this.root = root;
    this.stops.push(
      this.keeper.onChange((change) => {
        this.onKeeperChange(change);
      }),
    );
    this.render();
    void this.recheck();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.cancelRecheck?.();
    this.cancelRecheck = null;
    this.contentEl.empty();
    this.root = null;
    this.filters = null;
    this.status = null;
    this.list = null;
  }

  private onKeeperChange(change: RevisionChange): void {
    if (this.closed) return;
    if (change.type === 'project') {
      this.changed.clear();
      this.folder = null;
    }
    this.render();
    // The passages are looked for again a moment after the text or the notes changed.
    this.cancelRecheck?.();
    this.cancelRecheck = this.clock.setTimer(() => {
      this.cancelRecheck = null;
      void this.recheck();
    }, RECHECK_MS);
  }

  /** Look for every note's passage in its scene's text, and show which are gone. */
  async recheck(): Promise<void> {
    const asked = ++this.checking;
    const fresh = new Map<string, Set<number>>();
    for (const entry of this.keeper.allNotes()) {
      const text = await this.keeper.sceneText(entry.scene.path, false);
      if (this.closed || asked !== this.checking) return;
      if (text !== null) fresh.set(pathKey(entry.scene.path), RevisionKeeper.changedPassages(text, entry.notes));
    }
    const before = JSON.stringify([...this.changed].map(([key, set]) => [key, [...set]]));
    this.changed.clear();
    for (const [key, set] of fresh) this.changed.set(key, set);
    if (JSON.stringify([...this.changed].map(([key, set]) => [key, [...set]])) !== before) this.render();
  }

  /** Draw the pane afresh. */
  render(): void {
    const { filters, status, list } = this;
    if (this.closed || !filters || !status || !list) return;
    filters.empty();
    list.empty();
    if (!this.keeper.hasProject) {
      status.setText('');
      list.createDiv({ cls: 'spellbook-revision-empty', text: NO_PROJECT_PANE_TEXT });
      return;
    }
    this.drawFilters(filters);
    const all = this.keeper.allNotes();
    const inFolder = this.folder === null ? null : new Set(this.keeper.scenesIn(this.folder).map((scene) => pathKey(scene.path)));
    const shown = filtered(all, this.filter, inFolder);
    const total = shown.reduce((sum, entry) => sum + entry.notes.length, 0);
    status.setText(countText(total, shown.length, this.filter));
    if (all.length === 0) {
      list.createDiv({ cls: 'spellbook-revision-empty', text: EMPTY_TEXT });
      return;
    }
    for (const entry of shown) this.drawScene(list, entry);
  }

  private drawFilters(into: HTMLElement): void {
    const group = into.createDiv({ cls: 'spellbook-revision-segments', attr: { role: 'group', 'aria-label': 'Show' } });
    for (const filter of ['open', 'done', 'all'] as const) {
      const button = group.createEl('button', { cls: 'spellbook-revision-segment', text: FILTER_NAMES[filter], attr: { type: 'button' } });
      button.toggleClass('is-active', filter === this.filter);
      button.setAttr('aria-pressed', filter === this.filter ? 'true' : 'false');
      button.addEventListener('click', () => {
        this.filter = filter;
        this.render();
      });
    }
    const folders = this.keeper.folders();
    if (folders.length === 0) return;
    const select = into.createEl('select', { cls: 'dropdown spellbook-revision-folder', attr: { 'aria-label': 'Part of the manuscript' } });
    select.createEl('option', { value: '', text: ALL_FOLDERS_TEXT });
    for (const folder of folders) {
      select.createEl('option', { value: folder.id, text: `${'— '.repeat(folder.depth)}${folder.name}`, attr: { dir: 'auto' } });
    }
    if (this.folder !== null && !folders.some((folder) => folder.id === this.folder)) this.folder = null;
    select.value = this.folder ?? '';
    select.addEventListener('change', () => {
      this.folder = select.value === '' ? null : select.value;
      this.render();
    });
  }

  private drawScene(into: HTMLElement, entry: SceneNotes): void {
    const block = into.createDiv({ cls: 'spellbook-revision-scene' });
    const title = block.createEl('button', {
      cls: 'spellbook-revision-scene-title',
      text: entry.scene.title,
      attr: { type: 'button', dir: 'auto', 'aria-label': `Show ${entry.scene.title}` },
    });
    title.addEventListener('click', () => {
      void this.jump(entry.scene.path, null);
    });
    const changed = this.changed.get(pathKey(entry.scene.path));
    for (const note of entry.notes) this.drawNote(block, entry.scene.path, note, changed?.has(note.index) === true);
  }

  private drawNote(into: HTMLElement, scenePath: string, note: PlacedNote, gone: boolean): void {
    const card = into.createDiv({ cls: 'spellbook-revision-note' });
    card.toggleClass('is-done', note.done);
    const quote = card.createEl('button', { cls: 'spellbook-revision-passage', attr: { type: 'button', dir: 'auto', 'aria-label': 'Show the passage' } });
    quote.setText(note.passage.length > 200 ? `${note.passage.slice(0, 200).trimEnd()}…` : note.passage);
    quote.addEventListener('click', () => {
      void this.jump(scenePath, gone ? null : note.passage);
    });
    if (gone) card.createDiv({ cls: 'spellbook-revision-changed', text: PASSAGE_CHANGED_TEXT });
    if (note.note.trim() !== '') card.createDiv({ cls: 'spellbook-revision-text', text: note.note, attr: { dir: 'auto' } });
    const foot = card.createDiv({ cls: 'spellbook-revision-foot' });
    const done = foot.createEl('label', { cls: 'spellbook-revision-done' });
    const tick = done.createEl('input', { attr: { type: 'checkbox' } });
    tick.checked = note.done;
    done.createSpan({ text: DONE_TEXT });
    tick.addEventListener('change', () => {
      void this.settle(this.keeper.changeNote(scenePath, note, { done: tick.checked }));
    });
    if (note.created !== '') foot.createSpan({ cls: 'spellbook-revision-date', text: note.created });
    const edit = foot.createEl('button', { cls: 'spellbook-revision-button', text: EDIT_TEXT, attr: { type: 'button' } });
    edit.addEventListener('click', () => {
      new NoteModal(this.app, {
        title: 'Edit revision note',
        passage: note.passage,
        value: note.note,
        confirm: 'Save',
        submit: (words) => this.keeper.changeNote(scenePath, note, { note: words.trim() }),
      }).open();
    });
    const remove = foot.createEl('button', { cls: 'spellbook-revision-button mod-warning', text: DELETE_TEXT, attr: { type: 'button' } });
    remove.addEventListener('click', () => {
      new ConfirmModal(this.app, {
        title: 'Delete this revision note?',
        message: 'The note is taken out of the scene\'s properties. The scene\'s text is not changed.',
        confirm: DELETE_TEXT,
        onConfirm: () => {
          void this.settle(this.keeper.removeNote(scenePath, note));
        },
      }).open();
    });
  }

  private async settle(work: Promise<string | null>): Promise<void> {
    const problem = await work;
    if (problem !== null) new Notice(problem, PROBLEM_NOTICE_MS);
    this.render();
  }

  private async jump(scenePath: string, passage: string | null): Promise<void> {
    const shown = await this.keeper.jumpTo(scenePath, passage);
    if (!shown) {
      new Notice('That scene could not be shown.', PROBLEM_NOTICE_MS);
      return;
    }
    // On a phone the drawers lie over the scene: slide them away.
    if (Platform.isPhone) this.app.workspace.rightSplit.collapse();
  }
}

/** Make a Revision pane. What Obsidian's `registerView` is given for REVISION_VIEW_TYPE. */
export function createRevisionView(leaf: WorkspaceLeaf, keeper: RevisionKeeper, clock: FeatureClock, actions: RevisionPaneActions): RevisionView {
  return new RevisionView(leaf, keeper, clock, actions);
}
