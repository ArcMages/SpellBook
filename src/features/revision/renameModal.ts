// "Rename everywhere": give an entity of the World a new name, and change its
// old name in the manuscript too.
//
// The window shows what will change before anything does:
//   - the entity's note gets the new name (through Obsidian's rename, so the
//     links to it follow);
//   - its old name can be kept as one of its other names (ticked at first);
//   - the places in the manuscript's text where the old name stands, by
//     scene, each with a tick. Places where Hebrew letters are joined to the
//     front of the name start unticked.
// Then it asks once more, with the number of changes and scenes. Each scene
// is saved as a snapshot before its words are changed, as with "Find and
// replace".

import { Modal, Notice, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { newNameProblem } from '../../core/revision/index';
import type { NameOccurrence } from '../../core/revision/index';
import { ConfirmModal } from '../../ui/confirmModal';
import { isInputMethodKey } from '../../ui/keys';
import type { RevisionKeeper } from './keeper';
import { reportText } from './reports';
import { TickedResults, changesText } from './results';

export const RENAME_TEXT = 'Rename';
export const KEEP_OLD_TEXT = 'Keep the old name as another name';
export const KEEP_OLD_DESC = 'Added to the entity\'s other names (aliases), so that "Find mentions" and links by the old name still find it.';
export const JOINED_TEXT = 'joined letter';
export const NO_PLACES_TEXT = 'The old name does not stand anywhere in the text of the manuscript.';

export class RenameEverywhereModal extends Modal {
  private readonly keeper: RevisionKeeper;
  private readonly entityPath: string;
  private keepOld = true;
  private nameBox: HTMLInputElement | null = null;
  private message: HTMLElement | null = null;
  private noteLine: HTMLElement | null = null;
  private aliasLine: HTMLElement | null = null;
  private placesLine: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private button: ButtonComponent | null = null;
  private results: TickedResults<NameOccurrence> | null = null;
  private busy = false;
  private closed = false;

  constructor(app: App, keeper: RevisionKeeper, entityPath: string) {
    super(app);
    this.keeper = keeper;
    this.entityPath = entityPath;
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.closed = false;
    contentEl.empty();
    this.modalEl.addClass('spellbook-revision-rename-modal');
    const entity = this.keeper.entity(this.entityPath);
    if (!entity) {
      this.titleEl.setText('Rename everywhere');
      contentEl.createDiv({ text: 'That entity is no longer in the project.' });
      return;
    }
    this.titleEl.setText(`Rename "${entity.name}" everywhere`);
    this.titleEl.setAttr('dir', 'auto');
    const root = contentEl.createDiv({ cls: 'spellbook-revision-rename' });
    const field = root.createEl('label', { cls: 'spellbook-revision-find-field' });
    field.createSpan({ cls: 'spellbook-revision-find-label', text: 'New name' });
    const box = field.createEl('input', { cls: 'spellbook-revision-find-input', attr: { type: 'text', dir: 'auto', 'aria-label': 'New name', enterkeyhint: 'done' } });
    box.value = entity.name;
    box.addEventListener('input', () => {
      this.showChanges();
    });
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      this.askToRename();
    });
    this.nameBox = box;
    this.message = root.createDiv({ cls: 'spellbook-prompt-message', attr: { role: 'alert', dir: 'auto' } });
    new Setting(root)
      .setName(KEEP_OLD_TEXT)
      .setDesc(KEEP_OLD_DESC)
      .addToggle((toggle) => {
        toggle.setValue(this.keepOld).onChange((value) => {
          this.keepOld = value;
          this.showChanges();
        });
      });

    const changes = root.createDiv({ cls: 'spellbook-revision-rename-changes' });
    changes.createDiv({ cls: 'spellbook-revision-rename-heading', text: 'What will change' });
    this.noteLine = changes.createDiv({ cls: 'spellbook-revision-rename-line', attr: { dir: 'auto' } });
    this.aliasLine = changes.createDiv({ cls: 'spellbook-revision-rename-line', attr: { dir: 'auto' } });
    this.placesLine = changes.createDiv({ cls: 'spellbook-revision-rename-line', attr: { 'aria-live': 'polite' } });
    this.placesLine.setText('Looking for the old name in the manuscript…');
    this.list = root.createDiv({ cls: 'spellbook-revision-results' });
    new Setting(root.createDiv({ cls: 'spellbook-revision-find-actions' })).addButton((button) => {
      this.button = button;
      button
        .setButtonText(RENAME_TEXT)
        .setWarning()
        .onClick(() => {
          this.askToRename();
        });
    });
    this.showChanges();
    box.focus();
    box.select();
    void this.findPlaces(entity.name);
  }

  override onClose(): void {
    this.closed = true;
    this.contentEl.empty();
    this.nameBox = null;
    this.message = null;
    this.noteLine = null;
    this.aliasLine = null;
    this.placesLine = null;
    this.list = null;
    this.button = null;
  }

  private async findPlaces(name: string): Promise<void> {
    const found = await this.keeper.findName(name);
    if (this.closed) return;
    const results = new TickedResults(found, (match) => !match.joined);
    results.onChange(() => {
      this.showChanges();
    });
    this.results = results;
    if (this.list) results.draw(this.list, (match) => (match.joined ? JOINED_TEXT : null));
    this.showChanges();
  }

  /** The new name as typed, and why it will not do (or null). */
  private wanted(): { readonly name: string; readonly problem: string | null } {
    const entity = this.keeper.entity(this.entityPath);
    const name = (this.nameBox?.value ?? '').trim();
    if (!entity) return { name, problem: 'That entity is no longer in the project.' };
    return { name, problem: newNameProblem(entity.name, name) };
  }

  /** Bring the lines that say what will change up to date. */
  private showChanges(): void {
    const entity = this.keeper.entity(this.entityPath);
    if (!entity) return;
    const { name, problem } = this.wanted();
    const shownName = problem === null ? name : '…';
    this.message?.setText(problem !== null && name !== '' && name !== entity.name ? problem : '');
    this.noteLine?.setText(`The note "${entity.name}" becomes "${shownName}". Links to it follow.`);
    const hasOld = entity.aliases.includes(entity.name);
    this.aliasLine?.setText(this.keepOld && !hasOld ? `"${entity.name}" is added to its other names.` : 'Its other names stay as they are.');
    if (this.results) {
      const { places } = this.results.found;
      const { changes, scenes } = this.results.ticked;
      this.placesLine?.setText(places === 0 ? NO_PLACES_TEXT : `In the manuscript: ${changesText(changes, scenes)} ticked, of ${places} ${places === 1 ? 'place' : 'places'} found.`);
    }
    this.button?.setDisabled(this.busy || problem !== null || this.results === null);
  }

  private askToRename(): void {
    const entity = this.keeper.entity(this.entityPath);
    const results = this.results;
    const { name, problem } = this.wanted();
    if (!entity || !results || problem !== null || this.busy) {
      if (problem !== null) this.message?.setText(problem);
      return;
    }
    const { changes, scenes } = results.ticked;
    new ConfirmModal(this.app, {
      title: `Rename "${entity.name}" to "${name}"?`,
      message:
        `The note will be renamed${this.keepOld ? ', and the old name kept as another name' : ''}. ` +
        (changes > 0
          ? `In the manuscript, ${changesText(changes, scenes)} will be made; each scene is saved as a snapshot first, so that it can be restored.`
          : 'The text of the manuscript is not changed.'),
      confirm: RENAME_TEXT,
      onConfirm: () => {
        void this.runRename(name, results);
      },
    }).open();
  }

  private async runRename(name: string, results: TickedResults<NameOccurrence>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.showChanges();
    try {
      const report = await this.keeper.renameEverywhere(this.entityPath, name, this.keepOld, results.plans(name));
      if (typeof report === 'string') {
        new Notice(report, 10000);
        if (!this.closed) this.message?.setText(report);
        return;
      }
      const lines = [`Renamed to "${name}".`];
      if (report.replaced.changes > 0 || report.replaced.problems.length > 0) lines.push(reportText(report.replaced));
      if (report.aliasProblem !== null) lines.push(report.aliasProblem);
      new Notice(lines.join('\n'), 8000);
      this.close();
    } finally {
      this.busy = false;
      if (!this.closed) this.showChanges();
    }
  }
}
