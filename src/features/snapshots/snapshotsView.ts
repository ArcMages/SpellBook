// The snapshots of one scene: the list, one snapshot to read, and two
// versions compared.
//
//   header   the name of the pane, the scene's title and "Take snapshot"
//   status   a line that is read out when it changes
//   list     the scene's snapshots, newest first: name, date, words, and how
//            many words differ from the scene as it is now; each with View,
//            Compare, Restore and Delete
//   view     one snapshot's text
//   compare  the older version against the newer one, paragraph by
//            paragraph: side by side on a wide pane, in one column on a
//            narrow one (the pane is measured; the kind of device is not
//            asked). What was added is underlined and carries a plus, what
//            was removed is struck through and carries a minus: never
//            colour alone.
//
// The pane belongs to the scene it was opened for. It follows that scene
// when it is renamed; to see another scene's snapshots, run "Snapshots of
// this scene" there.
//
// Everything it shows comes from the keeper (keeper.ts), and everything it
// changes goes through it. Touch first: every action is a button, nothing
// depends on hovering or on dragging.

import { ItemView, Menu, Notice, Platform } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { formatCount } from '../../core/binderModel';
import { pathKey } from '../../core/paths';
import { diffTexts, foldUnchanged, isNarrowPane, shownDate, shownName, sideOf } from '../../core/snapshots';
import type { DiffBlock, DiffPiece, SnapshotInfo, SnapshotText, TextDiff } from '../../core/snapshots';
import { ConfirmModal } from '../../ui/confirmModal';
import { iconName } from '../../ui/icons';
import { ownTextTitle } from '../../ui/ownText';
import { safely } from '../../ui/safely';
import { TextPromptModal } from '../../ui/textPromptModal';
import type { FeatureClock } from '../registry';
import { SnapshotKeeper } from './keeper';
import type { KeeperChange, SceneAt } from './keeper';
import { RestoreModal } from './restoreModal';

export const SNAPSHOTS_VIEW_TYPE = 'spellbook-snapshots';
export const SNAPSHOTS_VIEW_NAME = 'Snapshots';
/** The pane's icon, by every name Obsidian has had for it. */
export const SNAPSHOTS_ICONS = ['history', 'camera', 'clock'] as const;

export function snapshotsIcon(): string {
  return iconName(...SNAPSHOTS_ICONS) ?? 'history';
}

export const TAKE_TEXT = 'Take snapshot';
export const TAKE_TITLE = 'Take snapshot';
export const TAKE_LABEL = 'A name for the snapshot (you can leave it empty)';
export const TAKE_PLACEHOLDER = 'For example: before the rewrite';
export const TAKEN_TEXT = 'Snapshot taken.';
export const VIEW_TEXT = 'View';
export const COMPARE_TEXT = 'Compare';
export const RESTORE_BUTTON_TEXT = 'Restore';
export const DELETE_TEXT = 'Delete';
export const BACK_TEXT = 'Back to the list';
export const AGAINST_LABEL = 'Compare with';
export const CURRENT_TEXT = 'The scene as it is now';
export const NO_SCENE_PANE_TEXT = 'Open a scene and run "Snapshots of this scene" to see its saved versions here.';
export const SCENE_GONE_PANE_TEXT = 'This scene is no longer in the project.';
export const EMPTY_TEXT = 'This scene has no snapshots yet. "Take snapshot" saves the scene as it is now, so that you can revise without fear.';
export const SAME_AS_NOW_TEXT = 'Same as the scene now';
export const NO_DIFFERENCE_TEXT = 'The two versions read the same.';
export const UNREADABLE_TEXT = 'This snapshot could not be read. It may still be syncing.';
export const LEGEND_TEXT = 'Added text is underlined and marked +. Removed text is struck through and marked −.';
export const AUTOMATIC_BADGE = 'Automatic';
export const RESTORED_TEXT = 'Restored. The text from before was saved as a snapshot ("Before restore").';

/** How long after a save the list waits before it counts the differences again, in milliseconds. */
export const RECOUNT_DELAY_MS = 1200;
const NOTICE_MS = 5000;
const PROBLEM_NOTICE_MS = 10000;

/** "+12 -3 words against the scene now", with a real minus sign. */
export function describeChange(diff: Pick<TextDiff, 'added' | 'removed'>): string {
  if (diff.added === 0 && diff.removed === 0) return SAME_AS_NOW_TEXT;
  return `The scene now: +${formatCount(diff.added)} −${formatCount(diff.removed)} words`;
}

/** "1 word", "1,234 words". */
export function describeWords(words: number): string {
  return `${formatCount(words)} ${words === 1 ? 'word' : 'words'}`;
}

/** What the list calls a snapshot: its name, or its date when it has none. */
export function titleOf(info: SnapshotInfo): string {
  return shownName(info);
}

type Mode =
  | { readonly kind: 'list' }
  | { readonly kind: 'view'; readonly path: string }
  /** `other` null: against the scene as it is now. */
  | { readonly kind: 'compare'; readonly path: string; readonly other: string | null };

interface Elements {
  readonly root: HTMLElement;
  readonly scene: HTMLElement;
  readonly takeButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly body: HTMLElement;
}

export class SnapshotsView extends ItemView {
  private readonly keeper: SnapshotKeeper;
  private readonly clock: FeatureClock;
  private els: Elements | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  private observer: ResizeObserver | null = null;
  private narrow = false;

  /** The scene the pane is about: its path inside the project. */
  private scenePath: string | null = null;
  private mode: Mode = { kind: 'list' };
  /** The texts of snapshots read so far, by path. A snapshot never changes once written. */
  private readonly texts = new Map<string, SnapshotText | null>();
  /** How each snapshot differs from the scene as it is now, by path. */
  private readonly changes = new Map<string, Pick<TextDiff, 'added' | 'removed'>>();
  /** Goes up whenever what is being worked out is no longer wanted. */
  private request = 0;
  private cancelRecount: (() => void) | null = null;
  /** The comparison on show, and which of its folded stretches were opened. */
  private compared: { before: string; after: string; diff: TextDiff } | null = null;
  private readonly unfolded = new Set<number>();
  private busy = false;
  /** True when the scene was saved since the differences were last counted. */
  private sceneChanged = false;

  constructor(leaf: WorkspaceLeaf, keeper: SnapshotKeeper, clock: FeatureClock) {
    super(leaf);
    this.keeper = keeper;
    this.clock = clock;
    this.navigation = false;
  }

  override getViewType(): string {
    return SNAPSHOTS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return SNAPSHOTS_VIEW_NAME;
  }

  override getIcon(): string {
    return snapshotsIcon();
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-snapshots-pane');

    const root = pane.createDiv({ cls: 'spellbook-snapshots' });
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    root.toggleClass('spellbook-is-phone', Platform.isPhone);
    // Until the pane has been measured, a phone is taken to be narrow.
    this.narrow = Platform.isPhone;
    root.toggleClass('spellbook-is-narrow', this.narrow);

    const header = root.createDiv({ cls: 'spellbook-snapshots-header' });
    const names = header.createDiv({ cls: 'spellbook-snapshots-names' });
    names.createDiv({ cls: 'spellbook-snapshots-heading', text: SNAPSHOTS_VIEW_NAME });
    const scene = names.createDiv({ cls: 'spellbook-snapshots-scene', attr: { dir: 'auto' } });
    const takeButton = header.createEl('button', { cls: 'spellbook-snapshots-take mod-cta', text: TAKE_TEXT, attr: { type: 'button' } });
    takeButton.addEventListener('click', () => {
      safely(TAKE_TEXT, () => {
        this.askToTake();
      });
    });
    const status = root.createDiv({ cls: 'spellbook-snapshots-status', attr: { 'aria-live': 'polite' } });
    const body = root.createDiv({ cls: 'spellbook-snapshots-body' });
    this.els = { root, scene, takeButton, status, body };

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        this.measure();
      });
      this.observer.observe(pane);
    }
    this.stops.push(
      this.keeper.onChange((change) => {
        this.onKeeperChange(change);
      }),
    );
    this.measure();
    // A pane that Obsidian opened by itself (the layout of last time) shows the scene in front, if there is one.
    if (this.scenePath === null) this.scenePath = this.keeper.openScene()?.path ?? null;
    this.render();
    this.recount(0);
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    this.request++;
    this.cancelRecount?.();
    this.cancelRecount = null;
    for (const stop of this.stops.splice(0)) stop();
    this.observer?.disconnect();
    this.observer = null;
    this.texts.clear();
    this.changes.clear();
    this.compared = null;
    this.unfolded.clear();
    this.mode = { kind: 'list' };
    this.els = null;
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-snapshots-pane');
  }

  override onResize(): void {
    this.measure();
  }

  private measure(): void {
    const els = this.els;
    if (!els) return;
    const narrow = isNarrowPane(this.contentEl.clientWidth, this.narrow);
    if (narrow === this.narrow) return;
    this.narrow = narrow;
    els.root.toggleClass('spellbook-is-narrow', narrow);
    // One column and two are built differently.
    if (this.mode.kind === 'compare') this.render();
  }

  /** Make the pane about a scene (a path inside the project), and show its list. */
  showScene(scenePath: string): void {
    if (this.scenePath === null || pathKey(this.scenePath) !== pathKey(scenePath)) {
      this.changes.clear();
      this.texts.clear();
    }
    this.scenePath = scenePath;
    this.mode = { kind: 'list' };
    this.compared = null;
    this.say('');
    this.render();
    this.recount(0);
  }

  /** The scene the pane is about, for those who ask. */
  get shownScene(): string | null {
    return this.scenePath;
  }

  // ------------------------------------------------------ following changes

  private onKeeperChange(change: KeeperChange): void {
    if (this.closed) return;
    switch (change.type) {
      case 'renamed':
        if (this.scenePath !== null && pathKey(change.from) === pathKey(this.scenePath)) {
          this.scenePath = change.to;
          this.render();
        }
        return;
      case 'project':
        this.render();
        return;
      case 'snapshots':
        if (this.mode.kind === 'list') this.render();
        this.recount(0);
        return;
      case 'text': {
        const scene = this.scenePath === null ? null : this.keeper.sceneAt(change.vaultPath);
        if (!scene || this.scenePath === null || pathKey(scene.path) !== pathKey(this.scenePath)) return;
        // Not while it is being typed in: a moment after the last save.
        this.sceneChanged = true;
        this.recount(RECOUNT_DELAY_MS);
        return;
      }
      default:
        return;
    }
  }

  private scene(): SceneAt | null {
    return this.scenePath === null ? null : this.keeper.scene(this.scenePath);
  }

  private say(text: string): void {
    this.els?.status.setText(text);
  }

  /** A snapshot's text, read once. */
  private async textOf(path: string): Promise<SnapshotText | null> {
    const known = this.texts.get(path);
    if (known) return known;
    const text = await this.keeper.read(path);
    if (text !== null) this.texts.set(path, text);
    return text;
  }

  /** Let Obsidian draw and answer taps before going on. */
  private pause(): Promise<void> {
    return new Promise((resolve) => {
      this.clock.setTimer(resolve, 0);
    });
  }

  /**
   * Count again how each snapshot differs from the scene as it is now: one
   * snapshot at a time, with a pause between two, so that a long list never
   * holds up the screen.
   */
  private recount(delay: number): void {
    this.cancelRecount?.();
    this.cancelRecount = null;
    const request = ++this.request;
    const run = (): void => {
      this.cancelRecount = null;
      void this.count(request).catch((error: unknown) => {
        console.error('Spellbook: the snapshots could not be compared with the scene', error);
      });
    };
    if (delay > 0) this.cancelRecount = this.clock.setTimer(run, delay);
    else run();
  }

  private async count(request: number): Promise<void> {
    const scene = this.scene();
    if (this.closed || !scene) return;
    const current = await this.keeper.sceneText(scene.path);
    if (current === null || request !== this.request) return;
    const now = SnapshotKeeper.bodyOf(current);
    if (this.sceneChanged) {
      this.sceneChanged = false;
      // A comparison with the scene as it is now is made again with the newer text.
      if (this.mode.kind === 'compare' && this.mode.other === null && this.compared !== null && this.compared.after !== now) {
        this.compared = null;
        this.unfolded.clear();
        this.render();
      }
    }
    const live = new Set<string>();
    for (const info of this.keeper.list(scene.path)) {
      live.add(info.path);
      const text = await this.textOf(info.path);
      if (request !== this.request || this.closed) return;
      if (text === null) continue;
      const diff = diffTexts(text.body, now);
      this.changes.set(info.path, { added: diff.added, removed: diff.removed });
      this.showChange(info.path);
      await this.pause();
      if (request !== this.request || this.closed) return;
    }
    for (const path of [...this.changes.keys()]) if (!live.has(path)) this.changes.delete(path);
  }

  /** Fill in one row's "how it differs" without drawing the list again. */
  private showChange(path: string): void {
    const change = this.changes.get(path);
    if (!change || this.mode.kind !== 'list') return;
    for (const row of this.rowChanges) {
      if (row.path === path) row.el.setText(describeChange(change));
    }
  }

  private rowChanges: Array<{ path: string; el: HTMLElement }> = [];

  // --------------------------------------------------------------- drawing

  private render(): void {
    const els = this.els;
    if (!els || this.closed) return;
    const scene = this.scene();
    els.scene.setText(scene?.title ?? '');
    els.takeButton.disabled = scene === null || this.busy;
    els.body.empty();
    this.rowChanges = [];

    if (this.scenePath === null) {
      this.message(els.body, NO_SCENE_PANE_TEXT);
      return;
    }
    if (!scene) {
      this.message(els.body, SCENE_GONE_PANE_TEXT);
      return;
    }
    const list = this.keeper.list(scene.path);
    const mode = this.mode;
    if (mode.kind !== 'list' && !list.some((info) => info.path === mode.path)) {
      // The snapshot on show was removed (here or on another device).
      this.mode = { kind: 'list' };
      this.compared = null;
    }
    switch (this.mode.kind) {
      case 'list':
        this.renderList(els.body, list);
        return;
      case 'view':
        this.renderView(els.body, list, this.mode.path);
        return;
      case 'compare':
        this.renderCompare(els.body, list, this.mode.path, this.mode.other);
        return;
    }
  }

  private message(into: HTMLElement, text: string): void {
    into.createDiv({ cls: 'spellbook-snapshots-message', text });
  }

  private button(into: HTMLElement, text: string, cls: string, action: () => unknown): HTMLButtonElement {
    const button = into.createEl('button', { cls: `spellbook-snapshots-button ${cls}`, text, attr: { type: 'button' } });
    button.disabled = this.busy;
    button.addEventListener('click', () => {
      if (this.busy) return;
      safely(text, action);
    });
    return button;
  }

  /** A snapshot's name and date, as the writer's own text. */
  private nameLine(into: HTMLElement, info: SnapshotInfo): void {
    const line = into.createDiv({ cls: 'spellbook-snapshots-name-line' });
    line.createSpan({ cls: 'spellbook-snapshots-name', text: titleOf(info), attr: { dir: 'auto' } });
    if (info.automatic && info.name !== '') line.createSpan({ cls: 'spellbook-snapshots-badge', text: AUTOMATIC_BADGE });
  }

  private renderList(into: HTMLElement, list: readonly SnapshotInfo[]): void {
    if (list.length === 0) {
      this.message(into, EMPTY_TEXT);
      return;
    }
    const rows = into.createEl('ul', { cls: 'spellbook-snapshots-list' });
    for (const info of list) {
      const row = rows.createEl('li', { cls: 'spellbook-snapshots-row' });
      row.toggleClass('is-automatic', info.automatic);
      const main = row.createDiv({ cls: 'spellbook-snapshots-row-main' });
      this.nameLine(main, info);
      const meta = main.createDiv({ cls: 'spellbook-snapshots-meta' });
      const date = shownDate(info.taken);
      if (date !== '') meta.createSpan({ cls: 'spellbook-snapshots-date', text: date });
      if (info.words !== null) meta.createSpan({ cls: 'spellbook-snapshots-words', text: describeWords(info.words) });
      const change = this.changes.get(info.path);
      const changeEl = meta.createSpan({ cls: 'spellbook-snapshots-change', text: change ? describeChange(change) : '' });
      this.rowChanges.push({ path: info.path, el: changeEl });

      const actions = row.createDiv({ cls: 'spellbook-snapshots-actions' });
      this.button(actions, VIEW_TEXT, 'spellbook-snapshots-view', () => {
        this.go({ kind: 'view', path: info.path });
      });
      this.button(actions, COMPARE_TEXT, 'spellbook-snapshots-compare', () => {
        this.go({ kind: 'compare', path: info.path, other: null });
      });
      this.button(actions, RESTORE_BUTTON_TEXT, 'spellbook-snapshots-restore-button', () => {
        this.askToRestore(info);
      });
      this.button(actions, DELETE_TEXT, 'spellbook-snapshots-delete', () => {
        this.askToDelete(info);
      });
    }
  }

  private go(mode: Mode): void {
    this.mode = mode;
    this.compared = null;
    this.unfolded.clear();
    this.say('');
    this.render();
    const body = this.els?.body;
    if (body) body.scrollTop = 0;
  }

  /** The bar above a snapshot that is being read or compared. */
  private bar(into: HTMLElement): HTMLElement {
    const bar = into.createDiv({ cls: 'spellbook-snapshots-bar' });
    this.button(bar, BACK_TEXT, 'spellbook-snapshots-back', () => {
      this.go({ kind: 'list' });
    });
    return bar;
  }

  private renderView(into: HTMLElement, list: readonly SnapshotInfo[], path: string): void {
    const info = list.find((candidate) => candidate.path === path);
    if (!info) return;
    const bar = this.bar(into);
    this.button(bar, COMPARE_TEXT, 'spellbook-snapshots-compare', () => {
      this.go({ kind: 'compare', path, other: null });
    });
    this.button(bar, RESTORE_BUTTON_TEXT, 'spellbook-snapshots-restore-button', () => {
      this.askToRestore(info);
    });
    const head = into.createDiv({ cls: 'spellbook-snapshots-shown' });
    this.nameLine(head, info);
    head.createDiv({ cls: 'spellbook-snapshots-meta', text: [shownDate(info.taken), info.words === null ? '' : describeWords(info.words)].filter((part) => part !== '').join(' · ') });
    const text = into.createDiv({ cls: 'spellbook-snapshots-text' });
    const known = this.texts.get(path);
    if (known) {
      this.paragraphs(text, known.body);
      return;
    }
    const request = this.request;
    void this.textOf(path).then((read) => {
      if (this.closed || this.mode.kind !== 'view' || this.mode.path !== path || request !== this.request) return;
      text.empty();
      if (read === null) this.message(text, UNREADABLE_TEXT);
      else this.paragraphs(text, read.body);
    });
  }

  /** A text as it was written: one element for each line, each with a direction of its own. */
  private paragraphs(into: HTMLElement, body: string): void {
    for (const line of body.split('\n')) {
      if (line.trim() === '') continue;
      into.createEl('p', { cls: 'spellbook-snapshots-para', text: line, attr: { dir: 'auto' } });
    }
  }

  private renderCompare(into: HTMLElement, list: readonly SnapshotInfo[], path: string, other: string | null): void {
    const info = list.find((candidate) => candidate.path === path);
    if (!info) return;
    const against = other === null ? null : (list.find((candidate) => candidate.path === other) ?? null);
    // The older version stands first.
    const snapshotFirst = against === null || info.takenAt <= against.takenAt;
    const first = snapshotFirst ? info : (against as SnapshotInfo);
    const second = snapshotFirst ? against : info;
    const label = (which: SnapshotInfo | null): string =>
      which === null ? CURRENT_TEXT : [titleOf(which), shownDate(which.taken)].filter((part) => part !== '').join(', ');

    const bar = this.bar(into);
    const pick = bar.createEl('button', {
      cls: 'spellbook-snapshots-button spellbook-snapshots-against',
      attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-label': AGAINST_LABEL },
    });
    pick.createSpan({ text: `${AGAINST_LABEL}: ` });
    pick.createSpan({ text: label(against), attr: { dir: 'auto' } });
    pick.addEventListener('click', () => {
      safely(AGAINST_LABEL, () => {
        this.showAgainstMenu(pick, list, path, against?.path ?? null);
      });
    });
    this.button(bar, RESTORE_BUTTON_TEXT, 'spellbook-snapshots-restore-button', () => {
      this.askToRestore(info);
    });

    const summary = into.createDiv({ cls: 'spellbook-snapshots-summary' });
    into.createDiv({ cls: 'spellbook-snapshots-legend', text: LEGEND_TEXT });
    const sheet = into.createDiv({ cls: 'spellbook-snapshots-diff' });
    sheet.toggleClass('is-two-columns', !this.narrow);
    const heads = sheet.createDiv({ cls: 'spellbook-snapshots-pair spellbook-snapshots-heads' });
    heads.createDiv({ cls: 'spellbook-snapshots-side-head', text: label(first), attr: { dir: 'auto' } });
    heads.createDiv({ cls: 'spellbook-snapshots-side-head', text: label(second), attr: { dir: 'auto' } });

    const draw = (compared: { diff: TextDiff }): void => {
      const { diff } = compared;
      summary.setText(
        diff.added === 0 && diff.removed === 0 ? NO_DIFFERENCE_TEXT : `+${formatCount(diff.added)} words added, −${formatCount(diff.removed)} words removed`,
      );
      this.renderDiff(sheet, diff);
    };
    if (this.compared) {
      draw(this.compared);
      return;
    }
    const request = this.request;
    const scene = this.scene();
    void (async (): Promise<void> => {
      const before = await this.textOf(first.path);
      const after = second === null ? (scene ? await this.keeper.sceneText(scene.path) : null) : ((await this.textOf(second.path))?.body ?? null);
      const still = !this.closed && this.mode.kind === 'compare' && this.mode.path === path && this.mode.other === other && request === this.request;
      if (!still) return;
      if (before === null || after === null) {
        this.message(sheet, UNREADABLE_TEXT);
        return;
      }
      const afterBody = second === null ? SnapshotKeeper.bodyOf(after) : after;
      this.compared = { before: before.body, after: afterBody, diff: diffTexts(before.body, afterBody) };
      draw(this.compared);
    })().catch((error: unknown) => {
      console.error('Spellbook: two versions could not be compared', error);
    });
  }

  private showAgainstMenu(anchor: HTMLElement, list: readonly SnapshotInfo[], path: string, chosen: string | null): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle(CURRENT_TEXT)
        .setChecked(chosen === null)
        .onClick(() => {
          this.go({ kind: 'compare', path, other: null });
        });
    });
    menu.addSeparator();
    for (const info of list) {
      if (info.path === path) continue;
      menu.addItem((item) => {
        item
          .setTitle(ownTextTitle([titleOf(info), shownDate(info.taken)].filter((part) => part !== '').join(', ')))
          .setChecked(chosen === info.path)
          .onClick(() => {
            this.go({ kind: 'compare', path, other: info.path });
          });
      });
    }
    const box = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: box.left, y: box.bottom, width: box.width });
  }

  /** The pieces of a paragraph: what stayed as plain text, what came as <ins>, what went as <del>. */
  private pieces(into: HTMLElement, pieces: readonly DiffPiece[]): void {
    for (const piece of pieces) {
      if (piece.kind === 'same') into.createSpan({ text: piece.text });
      else if (piece.kind === 'added') into.createEl('ins', { cls: 'spellbook-snapshots-added', text: piece.text });
      else into.createEl('del', { cls: 'spellbook-snapshots-removed', text: piece.text });
    }
  }

  /** One paragraph of one side, with the sign that says what became of it. */
  private cell(into: HTMLElement, block: DiffBlock, pieces: readonly DiffPiece[]): void {
    const cell = into.createDiv({ cls: `spellbook-snapshots-cell is-${block.kind}` });
    if (pieces.length === 0) {
      cell.addClass('is-empty');
      return;
    }
    const sign = block.kind === 'added' ? '+' : block.kind === 'removed' ? '−' : block.kind === 'changed' ? '~' : '';
    const said = block.kind === 'added' ? 'Added paragraph' : block.kind === 'removed' ? 'Removed paragraph' : block.kind === 'changed' ? 'Changed paragraph' : null;
    const mark = cell.createSpan({ cls: 'spellbook-snapshots-sign', text: sign });
    if (said !== null) mark.setAttr('aria-label', said);
    const text = cell.createEl('p', { cls: 'spellbook-snapshots-para', attr: { dir: 'auto' } });
    this.pieces(text, pieces);
  }

  private renderDiff(sheet: HTMLElement, diff: TextDiff): void {
    const rows = foldUnchanged(diff.blocks);
    rows.forEach((row, at) => {
      const blocks = row.kind === 'block' ? [row.block] : this.unfolded.has(at) ? row.blocks : null;
      if (blocks === null && row.kind === 'fold') {
        const count = row.blocks.length;
        const fold = sheet.createDiv({ cls: 'spellbook-snapshots-fold' });
        this.button(fold, `Show ${formatCount(count)} unchanged paragraphs`, 'spellbook-snapshots-unfold', () => {
          this.unfolded.add(at);
          this.render();
        });
        return;
      }
      for (const block of blocks ?? []) {
        const pair = sheet.createDiv({ cls: 'spellbook-snapshots-pair' });
        if (this.narrow) {
          // One column: the paragraph once, with what went and what came in their places.
          const all: readonly DiffPiece[] = block.kind === 'changed' ? block.pieces : [{ kind: block.kind, text: block.text }];
          this.cell(pair, block, all);
        } else {
          this.cell(pair, block, sideOf(block, 'before'));
          this.cell(pair, block, sideOf(block, 'after'));
        }
      }
    });
  }

  // --------------------------------------------------------------- actions

  private async working<T>(job: () => Promise<T>): Promise<T> {
    this.busy = true;
    this.render();
    try {
      return await job();
    } finally {
      this.busy = false;
      if (!this.closed) this.render();
    }
  }

  /** Ask for a name (it may be left empty) and take a snapshot of the pane's scene. */
  askToTake(): void {
    const scene = this.scene();
    if (!scene) return;
    new TextPromptModal(this.app, {
      title: TAKE_TITLE,
      label: TAKE_LABEL,
      placeholder: TAKE_PLACEHOLDER,
      confirm: TAKE_TEXT,
      submit: async (value) => {
        const taken = await this.keeper.take(scene.path, { name: value });
        if (!taken.ok) return taken.message;
        this.say(TAKEN_TEXT);
        new Notice(TAKEN_TEXT, NOTICE_MS);
        return null;
      },
    }).open();
  }

  private askToRestore(info: SnapshotInfo): void {
    const scene = this.scene();
    if (!scene) return;
    new RestoreModal(this.app, {
      sceneTitle: scene.title,
      snapshotName: [titleOf(info), shownDate(info.taken)].filter((part) => part !== '').join(', '),
      onConfirm: (withProperties) => {
        void this.working(async () => {
          const restored = await this.keeper.restore(scene.path, info.path, withProperties);
          if (!restored.ok) {
            this.say(restored.message);
            new Notice(restored.message, PROBLEM_NOTICE_MS);
            return;
          }
          this.mode = { kind: 'list' };
          this.compared = null;
          this.say(RESTORED_TEXT);
          new Notice(RESTORED_TEXT, NOTICE_MS);
        }).catch((error: unknown) => {
          console.error('Spellbook: a snapshot could not be restored', error);
          new Notice(`The snapshot could not be restored: ${error instanceof Error ? error.message : String(error)}`, PROBLEM_NOTICE_MS);
        });
      },
    }).open();
  }

  private askToDelete(info: SnapshotInfo): void {
    new ConfirmModal(this.app, {
      title: `Delete the snapshot "${titleOf(info)}"?`,
      message: "The snapshot is moved to the trash (Obsidian's, or the system's, as your settings say). The scene itself is not touched.",
      confirm: DELETE_TEXT,
      onConfirm: () => {
        void this.working(async () => {
          const removed = await this.keeper.remove(info.path);
          if (removed.ok) return;
          this.say(removed.message);
          new Notice(removed.message, PROBLEM_NOTICE_MS);
        }).catch((error: unknown) => {
          console.error('Spellbook: a snapshot could not be deleted', error);
        });
      },
    }).open();
  }
}

export function createSnapshotsView(leaf: WorkspaceLeaf, keeper: SnapshotKeeper, clock: FeatureClock): SnapshotsView {
  return new SnapshotsView(leaf, keeper, clock);
}
