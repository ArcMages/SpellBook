// The list of places found, by scene, each with a tick: what "Find and
// replace" and "Rename everywhere" show before anything is changed.
//
// Every place shows its line around it, with the words found marked. The
// tick of a scene ticks or unticks all its places at once. Only the ticked
// places are ever changed.

import { describeKinds } from '../../core/noteKind';
import { formatCount } from '../../core/binderModel';
import { directionOf } from '../../core/export/direction';
import { contextOf } from '../../core/revision/index';
import type { BodyEdit, TextMatch } from '../../core/revision/index';
import type { SceneMatches, ScenePlan } from './keeper';

/** The word shown after a place where Hebrew letters are joined to the front of the words found. */
export const JOINED_TEXT = 'joined letter';

/** The most places drawn in the list; the others are counted and can still be ticked as a scene. */
export const MOST_DRAWN = 600;

/** "2 scenes"; with chapter notes among them, "1 chapter and 1 scene". */
export function notesText(scenes: number, chapters = 0): string {
  return chapters > 0 ? describeKinds(chapters, scenes - chapters) : `${formatCount(scenes)} ${scenes === 1 ? 'scene' : 'scenes'}`;
}

/** "3 changes in 2 scenes", or "3 changes in 1 chapter and 1 scene". */
export function changesText(changes: number, scenes: number, chapters = 0): string {
  return `${formatCount(changes)} ${changes === 1 ? 'change' : 'changes'} in ${notesText(scenes, chapters)}`;
}

/** The places found, and which are ticked. */
export class TickedResults<M extends TextMatch = TextMatch> {
  readonly groups: ReadonlyArray<SceneMatches<M>>;
  private readonly ticks: boolean[][];
  private onTicked: (() => void) | null = null;

  /**
   * @param ticked whether a place starts out ticked (default: all are)
   */
  private readonly isChapter: (path: string) => boolean;

  /**
   * @param ticked    whether a place starts out ticked (default: all are)
   * @param isChapter whether a note is a whole chapter, for the counts (default: none is)
   */
  constructor(groups: ReadonlyArray<SceneMatches<M>>, ticked: (match: M) => boolean = () => true, isChapter: (path: string) => boolean = () => false) {
    this.groups = groups;
    this.isChapter = isChapter;
    this.ticks = groups.map((group) => group.matches.map((match) => ticked(match)));
  }

  /** Be told when a tick changes. */
  onChange(listener: () => void): void {
    this.onTicked = listener;
  }

  isTicked(group: number, match: number): boolean {
    return this.ticks[group]?.[match] === true;
  }

  setTicked(group: number, match: number, on: boolean): void {
    const row = this.ticks[group];
    if (!row || match < 0 || match >= row.length) return;
    row[match] = on;
  }

  /** Tick or untick every place of a scene. */
  setScene(group: number, on: boolean): void {
    const row = this.ticks[group];
    if (row) row.fill(on);
  }

  /** How many places were found, and in how many scenes. */
  get found(): { readonly places: number; readonly scenes: number; readonly chapters?: number } {
    const places = this.groups.reduce((sum, group) => sum + group.matches.length, 0);
    const chapters = this.groups.filter((group) => this.isChapter(group.scene.path)).length;
    return chapters > 0 ? { places, scenes: this.groups.length, chapters } : { places, scenes: this.groups.length };
  }

  /** How many places are ticked, and in how many scenes. */
  get ticked(): { readonly changes: number; readonly scenes: number; readonly chapters?: number } {
    let changes = 0;
    let scenes = 0;
    let chapters = 0;
    this.ticks.forEach((row, at) => {
      const count = row.filter(Boolean).length;
      changes += count;
      if (count === 0) return;
      scenes++;
      const path = this.groups[at]?.scene.path;
      if (path !== undefined && this.isChapter(path)) chapters++;
    });
    return chapters > 0 ? { changes, scenes, chapters } : { changes, scenes };
  }

  /** The changes to make: one plan for each scene with a ticked place, each place's words replaced by `insert`. */
  plans(insert: string | ((match: M) => string)): ScenePlan[] {
    const plans: ScenePlan[] = [];
    this.groups.forEach((group, at) => {
      const edits: BodyEdit[] = [];
      group.matches.forEach((match, index) => {
        if (!this.isTicked(at, index)) return;
        edits.push({ from: match.from, to: match.to, expect: match.text, insert: typeof insert === 'string' ? insert : insert(match) });
      });
      if (edits.length > 0) plans.push({ scene: group.scene, body: group.body, edits });
    });
    return plans;
  }

  /**
   * Draw the list into an empty element.
   *
   * @param note a short word shown after a place, or null (for example "joined letter")
   */
  draw(into: HTMLElement, note: (match: M) => string | null = () => null): void {
    into.empty();
    let drawn = 0;
    this.groups.forEach((group, at) => {
      const scene = into.createDiv({ cls: 'spellbook-revision-result-scene' });
      // A row takes the direction of its own words, so that in a right-to-left
      // scene the tick stands at their start, on the right, beside them. The
      // browser's own "auto" cannot see words inside parts that have a
      // direction of their own, so the row is told outright.
      const head = scene.createEl('label', { cls: 'spellbook-revision-result-head', attr: { dir: directionOf(group.scene.title) ?? 'auto' } });
      const all = head.createEl('input', { attr: { type: 'checkbox', 'aria-label': `All places in ${group.scene.title}` } });
      head.createSpan({ cls: 'spellbook-revision-result-title', text: group.scene.title, attr: { dir: 'auto' } });
      const count = head.createSpan({ cls: 'spellbook-revision-result-count', attr: { dir: 'ltr' } });
      const boxes: HTMLInputElement[] = [];
      const showScene = (): void => {
        const row = this.ticks[at] ?? [];
        const on = row.filter(Boolean).length;
        all.checked = on === row.length && row.length > 0;
        all.indeterminate = on > 0 && on < row.length;
        count.setText(`${formatCount(on)} of ${formatCount(row.length)}`);
        boxes.forEach((box, index) => {
          box.checked = row[index] === true;
        });
      };
      all.addEventListener('change', () => {
        this.setScene(at, all.checked);
        showScene();
        this.onTicked?.();
      });
      const list = scene.createDiv({ cls: 'spellbook-revision-result-list' });
      group.matches.forEach((match, index) => {
        if (drawn >= MOST_DRAWN) return;
        drawn++;
        const context = contextOf(group.body, match.from, match.to);
        const row = list.createEl('label', { cls: 'spellbook-revision-result', attr: { dir: directionOf(`${context.before}${context.match}${context.after}`) ?? 'auto' } });
        const box = row.createEl('input', { attr: { type: 'checkbox' } });
        boxes.push(box);
        box.addEventListener('change', () => {
          this.setTicked(at, index, box.checked);
          showScene();
          this.onTicked?.();
        });
        const line = row.createSpan({ cls: 'spellbook-revision-result-line', attr: { dir: 'auto' } });
        line.createSpan({ text: `${context.cutBefore ? '…' : ''}${context.before}` });
        line.createEl('mark', { cls: 'spellbook-revision-result-match', text: context.match });
        line.createSpan({ text: `${context.after}${context.cutAfter ? '…' : ''}` });
        const extra = note(match);
        if (extra !== null) row.createSpan({ cls: 'spellbook-revision-result-note', text: extra });
      });
      showScene();
    });
    const { places } = this.found;
    if (drawn < places) {
      into.createDiv({ cls: 'spellbook-revision-result-more', text: `${formatCount(places - drawn)} more places are not shown. A scene's tick includes them.` });
    }
  }
}
