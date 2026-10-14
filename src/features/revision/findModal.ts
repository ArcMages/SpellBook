// "Find and replace": look for words in all the scenes of the manuscript, or
// in one binder folder, and replace the places the writer ticks.
//
//   Find, Replace with   two boxes, in any language
//   Match case, Whole words, Wildcards
//   Look in              all scenes, or one folder of the binder
//   the places found     by scene, each with its line and a tick (all ticked,
//                        but for Hebrew words with a letter joined to their
//                        front, found with Whole words: those start unticked)
//
// Without Match case, each replacement takes the capitals of the words it
// replaces: "Gulls" -> "Seabirds", "GULLS" -> "SEABIRDS" (see withCaseOf).
//   Replace              asks first, with the number of changes and scenes
//
// Nothing is changed until the writer confirms. Then each scene is saved as
// a snapshot ("Before replace: ...") before its words are changed, and a
// scene that was changed since the search is left alone (see
// RevisionKeeper.replace). The properties of a scene are never searched and
// never changed.

import { Modal, Notice, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { withCaseOf } from '../../core/revision/index';
import type { NameOccurrence, SearchOptions } from '../../core/revision/index';
import { ConfirmModal } from '../../ui/confirmModal';
import { isInputMethodKey } from '../../ui/keys';
import type { RevisionKeeper } from './keeper';
import { JOINED_TEXT, TickedResults, changesText } from './results';
import { reportText } from './reports';

export const FIND_TITLE = 'Find and replace';
export const FIND_LABEL = 'Find';
export const REPLACE_LABEL = 'Replace with';
export const SEARCH_TEXT = 'Search';
export const REPLACE_TEXT = 'Replace';
export const ALL_SCENES_TEXT = 'All scenes';
export const NOTHING_FOUND_TEXT = 'Nothing was found.';
export const SEARCHING_TEXT = 'Searching…';
export const WILDCARDS_HELP = '? stands for one character, * for any characters on the line; at the start or end, for the rest of the word.';

/** The name of the snapshot taken of each scene before a replace. */
export function replaceSnapshotName(find: string, replace: string): string {
  return `Before replace: ${find} → ${replace === '' ? '(nothing)' : replace}`;
}

export class FindReplaceModal extends Modal {
  private readonly keeper: RevisionKeeper;
  /** The words the Find box starts with (the words selected in the editor, say). */
  private readonly start: string;
  private options: SearchOptions = { matchCase: false, wholeWords: false, wildcards: false };
  private folder: string | null = null;
  private findBox: HTMLInputElement | null = null;
  private replaceBox: HTMLInputElement | null = null;
  private status: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private replaceButton: ButtonComponent | null = null;
  /** What was found, and the words that were looked for. */
  private results: { find: string; matchCase: boolean; ticked: TickedResults<NameOccurrence> } | null = null;
  private searchCount = 0;
  private busy = false;
  private closed = false;

  constructor(app: App, keeper: RevisionKeeper, start = '') {
    super(app);
    this.keeper = keeper;
    this.start = start;
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(FIND_TITLE);
    this.modalEl.addClass('spellbook-revision-find-modal');
    const root = contentEl.createDiv({ cls: 'spellbook-revision-find' });

    const boxes = root.createDiv({ cls: 'spellbook-revision-find-boxes' });
    this.findBox = this.box(boxes, FIND_LABEL, this.start);
    this.replaceBox = this.box(boxes, REPLACE_LABEL, '');
    this.findBox.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      void this.search();
    });
    this.findBox.addEventListener('input', () => {
      // What was found was for other words.
      this.forget();
    });

    const options = root.createDiv({ cls: 'spellbook-revision-find-options' });
    const toggle = (name: string, key: keyof SearchOptions, description?: string): void => {
      const setting = new Setting(options).setName(name).addToggle((component) => {
        component.setValue(this.options[key]).onChange((value) => {
          this.options = { ...this.options, [key]: value };
          if (this.results) void this.search();
        });
      });
      if (description !== undefined) setting.setDesc(description);
    };
    toggle('Match case', 'matchCase');
    toggle('Whole words', 'wholeWords');
    toggle('Wildcards', 'wildcards', WILDCARDS_HELP);
    new Setting(options).setName('Look in').addDropdown((dropdown) => {
      dropdown.selectEl.createEl('option', { value: '', text: ALL_SCENES_TEXT });
      for (const folder of this.keeper.folders()) {
        dropdown.selectEl.createEl('option', { value: folder.id, text: `${'— '.repeat(folder.depth)}${folder.name}`, attr: { dir: 'auto' } });
      }
      dropdown.setValue('').onChange((value) => {
        this.folder = value === '' ? null : value;
        if (this.results) void this.search();
      });
    });

    new Setting(root).addButton((button) => {
      button
        .setButtonText(SEARCH_TEXT)
        .setCta()
        .onClick(() => {
          void this.search();
        });
    });
    this.status = root.createDiv({ cls: 'spellbook-revision-find-status', attr: { 'aria-live': 'polite' } });
    this.list = root.createDiv({ cls: 'spellbook-revision-results' });
    new Setting(root.createDiv({ cls: 'spellbook-revision-find-actions' })).addButton((button) => {
      this.replaceButton = button;
      button
        .setButtonText(REPLACE_TEXT)
        .setWarning()
        .setDisabled(true)
        .onClick(() => {
          this.askToReplace();
        });
    });
    this.findBox.focus();
    if (this.start !== '') void this.search();
  }

  override onClose(): void {
    this.closed = true;
    this.searchCount++;
    this.contentEl.empty();
    this.findBox = null;
    this.replaceBox = null;
    this.status = null;
    this.list = null;
    this.replaceButton = null;
    this.results = null;
  }

  private box(into: HTMLElement, label: string, value: string): HTMLInputElement {
    const field = into.createEl('label', { cls: 'spellbook-revision-find-field' });
    field.createSpan({ cls: 'spellbook-revision-find-label', text: label });
    const input = field.createEl('input', { cls: 'spellbook-revision-find-input', attr: { type: 'text', dir: 'auto', 'aria-label': label, enterkeyhint: 'search' } });
    input.value = value;
    return input;
  }

  private say(text: string): void {
    this.status?.setText(text);
  }

  private forget(): void {
    this.results = null;
    this.list?.empty();
    this.say('');
    this.showButton();
  }

  private showButton(): void {
    const ticked = this.results?.ticked.ticked;
    this.replaceButton?.setDisabled(this.busy || !ticked || ticked.changes === 0);
    this.replaceButton?.setButtonText(ticked && ticked.changes > 0 ? `${REPLACE_TEXT} ${changesText(ticked.changes, ticked.scenes)}` : REPLACE_TEXT);
  }

  /** Look for the words, and show what was found. */
  async search(): Promise<void> {
    const find = this.findBox?.value ?? '';
    const asked = ++this.searchCount;
    if (find === '') {
      this.forget();
      return;
    }
    this.say(SEARCHING_TEXT);
    const found = await this.keeper.search(find, this.options, this.folder);
    if (this.closed || asked !== this.searchCount) return;
    const ticked = new TickedResults(found, (match) => !match.joined);
    ticked.onChange(() => {
      this.showButton();
    });
    this.results = { find, matchCase: this.options.matchCase, ticked };
    if (this.list) ticked.draw(this.list, (match) => (match.joined ? JOINED_TEXT : null));
    const { places, scenes } = ticked.found;
    this.say(places === 0 ? NOTHING_FOUND_TEXT : `Found ${places} ${places === 1 ? 'time' : 'times'} in ${scenes} ${scenes === 1 ? 'scene' : 'scenes'}.`);
    this.showButton();
  }

  private askToReplace(): void {
    const results = this.results;
    if (!results || this.busy) return;
    const replace = this.replaceBox?.value ?? '';
    const { changes, scenes } = results.ticked.ticked;
    if (changes === 0) return;
    new ConfirmModal(this.app, {
      title: `Replace ${changesText(changes, scenes)}?`,
      message:
        `"${results.find}" will be replaced by ${replace === '' ? 'nothing' : `"${replace}"`} in ${changesText(changes, scenes)}. ` +
        (results.matchCase ? '' : 'Each replacement takes the capitals of the words it replaces. ') +
        'Each scene is saved as a snapshot first, so that it can be restored. A scene that was changed since the search is left as it is.',
      confirm: REPLACE_TEXT,
      onConfirm: () => {
        void this.replace(results.find, replace, results.matchCase, results.ticked);
      },
    }).open();
  }

  private async replace(find: string, replace: string, matchCase: boolean, ticked: TickedResults<NameOccurrence>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.showButton();
    this.say('Replacing…');
    try {
      // Without Match case, each place keeps the capitals it had.
      const plans = ticked.plans(matchCase ? replace : (match) => withCaseOf(match.text, replace));
      const report = await this.keeper.replace(plans, replaceSnapshotName(find, replace));
      const text = reportText(report);
      new Notice(text, 8000);
      if (this.closed) return;
      this.busy = false;
      await this.search();
      this.say(text);
    } finally {
      this.busy = false;
      this.showButton();
    }
  }
}
