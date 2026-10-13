// The writing report: the figures of a scene, a chapter or the whole
// manuscript.
//
//   header    the name of the pane, the scope button (the open scene, a
//             folder of the binder, the whole manuscript) and Refresh
//   status    "Reading scene 12 of 100...", with a bar, while scenes are
//             read; or a line that says the figures are out of date
//   figures   words, characters with and without spaces, sentences,
//             paragraphs, pages, reading time and the reading grade, each
//             with a line that says how it was worked out; under the pages,
//             the field that sets how many words go on a page
//   words     the most used words, with a switch to leave out common words
//
// Everything it shows comes from its host (host.ts) and is worked out by the
// report engine (src/core/report). The pane changes nothing in the vault.
//
// The figures are worked out when the writer asks: when the pane opens, when
// a scope is chosen and when Refresh is pressed. A scene that is saved in
// the meantime only makes the pane say that its figures are out of date.
//
// Touch first: every explanation is written out under its figure (nothing
// depends on hovering), and the scope is chosen from a menu. Whether the
// figures stand in one column or several goes by the pane's measured width,
// never by the kind of device.

import { ItemView, Menu, Platform } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { formatCount } from '../../core/binderModel';
import { WORDS_PER_MINUTE } from '../../core/outliner/readTime';
import {
  MAX_WORDS_PER_PAGE,
  MIN_WORDS_PER_PAGE,
  figuresOf,
  formatShare,
  isNarrowPane,
  mostUsedWords,
  parseWordsPerPage,
  sameScope,
} from '../../core/report';
import type { ReadingGrade, ReportScope, ScopeFolder, TextStats } from '../../core/report';
import { iconName } from '../../ui/icons';
import { safely } from '../../ui/safely';
import type { ReportChange, ReportHost, ReportOutcome } from './host';

export const REPORT_VIEW_TYPE = 'spellbook-report';
export const REPORT_VIEW_NAME = 'Writing report';
/** The pane's icon, by every name Obsidian has had for it. */
export const REPORT_ICONS = ['chart-column', 'bar-chart-3', 'bar-chart-2', 'bar-chart'] as const;

/** The icon this version of Obsidian knows. */
export function reportIcon(): string {
  return iconName(...REPORT_ICONS) ?? 'bar-chart';
}

export const SCOPE_SCENE_TEXT = 'The open scene';
export const SCOPE_MANUSCRIPT_TEXT = 'Whole manuscript';
export const SCOPE_LABEL = 'What the report is about';
export const REFRESH_TEXT = 'Refresh';

export const NO_PROJECT_TEXT = 'No Spellbook project is open.';
export const NO_SCENE_TEXT =
  'The note that is open is not a scene of this project. Open a scene and press Refresh, or choose a folder or the whole manuscript above.';
export const NO_FOLDER_TEXT = 'This folder is no longer in the binder. Choose another scope above.';
export const NO_SCENES_TEXT = 'There are no scenes here yet.';
export const STALE_TEXT = 'The text has changed since these figures were worked out. Press Refresh to read it again.';
export const OTHER_SCENE_TEXT = 'Another note is open now. Press Refresh for its figures.';
export const FAILED_TEXT = 'The report could not be worked out. Press Refresh to try again.';

export const WORDS_HEADING = 'Most used words';
export const COMMON_SWITCH_TEXT = 'Leave out common words';
export const COMMON_NOTE = 'Common words are the small words of English and Hebrew, such as "the", "and" and "of".';
export const NO_WORDS_TEXT = 'No words to list.';
export const SHOW_MORE_TEXT = 'Show more words';

export const GRADE_ENGLISH_NOTE =
  'Flesch-Kincaid grade level, a formula for English: the school year (in the United States) at which the text reads easily.';
export const GRADE_HEBREW_LABEL = 'Reading level (approximate)';
export const GRADE_HEBREW_NOTE =
  'Approximate. Hebrew has no standard reading-grade formula that works without a dictionary, and the English formula says nothing about Hebrew. ' +
  'This is the LIX index instead: the words in an average sentence plus the percentage of words longer than six letters. ' +
  'It is not a school year; use it to compare your own chapters with each other.';
export const GRADE_NONE_NOTE = 'A reading grade needs at least one sentence in English or in Hebrew.';
export const WORDS_PER_PAGE_LABEL = 'Words on a page';
export const PARAGRAPHS_NOTE = 'Every line of text is a paragraph. Headings are not counted.';

/** How many of the most used words are listed at first, and how many more each time more are asked for. */
export const WORDS_STEP = 25;

interface Elements {
  readonly root: HTMLElement;
  readonly scopeButton: HTMLElement;
  readonly refreshButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly body: HTMLElement;
}

/** The place for a menu that opens under something. */
function placeUnder(anchor: HTMLElement): { x: number; y: number; width: number } {
  const box = anchor.getBoundingClientRect();
  return { x: box.left, y: box.bottom, width: box.width };
}

/** "1 scene", "12 scenes". */
export function describeScenes(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'scene' : 'scenes'}`;
}

/** What the reading grade's tile says: its name, its figure and how it was worked out. */
export function gradeTexts(grade: ReadingGrade, stats: TextStats): { label: string; value: string; note: string } {
  // A text in two languages is judged by the one most of it is in: the tile says which.
  const mixed = stats.latinLetters > 0 && stats.hebrewLetters > 0;
  const judged = (language: string): string => (mixed ? ` Most of this text is in ${language}, so it is judged as ${language}.` : '');
  switch (grade.kind) {
    case 'english':
      return { label: 'Reading grade', value: `Grade ${grade.grade.toFixed(1)}`, note: GRADE_ENGLISH_NOTE + judged('English') };
    case 'hebrew':
      return {
        label: GRADE_HEBREW_LABEL,
        value: `LIX ${Math.round(grade.lix)}`,
        note: `${GRADE_HEBREW_NOTE} Here ${Math.round(grade.longWordShare * 100)}% of the words are long.${judged('Hebrew')}`,
      };
    case 'none':
      return { label: 'Reading grade', value: 'None', note: GRADE_NONE_NOTE };
  }
}

export class ReportView extends ItemView {
  private readonly host: ReportHost;
  private els: Elements | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  private observer: ResizeObserver | null = null;

  /** What the report is about. A pane starts with the scene that is open: one note to read. */
  private about: ReportScope = { kind: 'scene' };
  /** How the last request for figures ended; null before the first has. */
  private outcome: ReportOutcome | null = null;
  /** How far the reading has come, while scenes are being read. */
  private reading: { done: number; total: number } | null = null;
  private failed = false;
  /** Why the figures on show are out of date, if they are. */
  private stale: string | null = null;
  /** Goes up with every request for figures: an older one that is still reading stops. */
  private request = 0;

  private includeCommon = false;
  private wordsShown = WORDS_STEP;
  /** True when the pane is narrow (a phone, or a slim pane): one column. */
  private narrow = false;

  constructor(leaf: WorkspaceLeaf, host: ReportHost) {
    super(leaf);
    this.host = host;
    this.navigation = false;
  }

  override getViewType(): string {
    return REPORT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return REPORT_VIEW_NAME;
  }

  override getIcon(): string {
    return reportIcon();
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-report-pane');

    const root = pane.createDiv({ cls: 'spellbook-report' });
    // Touch needs larger buttons. Platform.isMobile covers phones and tablets.
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    // On a phone, Obsidian's own bar floats over the bottom of the pane: the
    // stylesheet keeps the last lines clear of it.
    root.toggleClass('spellbook-is-phone', Platform.isPhone);
    // Until the pane has been measured, a phone is taken to be narrow.
    this.narrow = Platform.isPhone;
    root.toggleClass('spellbook-is-narrow', this.narrow);

    const header = root.createDiv({ cls: 'spellbook-report-header' });
    header.createDiv({ cls: 'spellbook-report-heading', text: REPORT_VIEW_NAME });
    const bar = header.createDiv({ cls: 'spellbook-report-bar' });
    const scopeButton = bar.createEl('button', {
      cls: 'spellbook-report-scope',
      attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-label': SCOPE_LABEL },
    });
    scopeButton.addEventListener('click', () => {
      safely(SCOPE_LABEL, () => {
        this.showScopeMenu(scopeButton);
      });
    });
    const refreshButton = bar.createEl('button', { cls: 'spellbook-report-refresh mod-cta', text: REFRESH_TEXT, attr: { type: 'button' } });
    refreshButton.addEventListener('click', () => {
      safely(REFRESH_TEXT, () => {
        this.refresh();
      });
    });
    // What is read out when it changes: how far the reading is, and that the figures are out of date.
    const status = root.createDiv({ cls: 'spellbook-report-status', attr: { 'aria-live': 'polite' } });
    const body = root.createDiv({ cls: 'spellbook-report-body' });
    this.els = { root, scopeButton, refreshButton, status, body };

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        this.measure();
      });
      this.observer.observe(pane);
    }
    this.stops.push(
      this.host.onChange((change) => {
        this.onHostChange(change);
      }),
    );
    this.measure();
    this.render();
    this.refresh();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    // Whatever is still being read is no longer wanted.
    this.request++;
    for (const stop of this.stops.splice(0)) stop();
    this.observer?.disconnect();
    this.observer = null;
    this.outcome = null;
    this.reading = null;
    this.stale = null;
    this.failed = false;
    this.els = null;
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-report-pane');
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
  }

  // ----------------------------------------------------- following the host

  private onHostChange(change: ReportChange): void {
    if (this.closed) return;
    const shown = this.outcome?.kind === 'done' ? this.outcome : null;
    switch (change.type) {
      case 'settings':
        this.render();
        return;
      case 'note':
        if (shown?.notes.has(change.vaultPath) === true && this.stale === null) {
          this.stale = STALE_TEXT;
          this.render();
        }
        return;
      case 'front':
        if (this.about.kind !== 'scene') return;
        // Nothing on show yet: the note that was just opened may be a scene.
        if (!shown) {
          if (this.reading === null) this.refresh();
          return;
        }
        if (shown.subject.kind === 'scene' && this.host.openScene() !== shown.subject.path && this.stale === null) {
          this.stale = OTHER_SCENE_TEXT;
          this.render();
        }
        return;
      case 'project':
        // A project was opened where there was none, or the plugin was switched off: look again.
        if (!shown && this.reading === null) {
          this.refresh();
          return;
        }
        if (!this.host.ready || this.host.projectTitle === null) {
          // The project was closed, or the plugin switched off: there is nothing to report on.
          this.request++;
          this.reading = null;
          this.outcome = { kind: 'no-project' };
          this.stale = null;
        } else if (shown && this.stale === null && shown.subject.kind !== 'scene' && !this.sameNotes(shown.notes)) {
          // Scenes came into the scope or left it (or the project is another one).
          this.stale = STALE_TEXT;
        }
        // The name of the folder on the scope button may have changed.
        this.render();
        return;
    }
  }

  /** Whether the scope still stands for exactly the notes the figures on show were worked out from. */
  private sameNotes(read: ReadonlySet<string>): boolean {
    const now = this.host.notesOf(this.about);
    if (now === null) return false;
    // Scenes that could not be read are in neither: only what was read is compared.
    return now.filter((path) => !read.has(path)).length === 0 && new Set(now).size >= read.size;
  }

  // -------------------------------------------------------------- the reading

  /** Work the figures out again, for the scope that is chosen. */
  private refresh(): void {
    if (this.closed) return;
    const request = ++this.request;
    const scope = this.about;
    this.failed = false;
    this.reading = { done: 0, total: 0 };
    this.render();
    const wanted = (): boolean => !this.closed && request === this.request;
    void this.host
      .measure(
        scope,
        (done, total) => {
          if (!wanted()) return;
          this.reading = { done, total };
          this.renderStatus();
        },
        wanted,
      )
      .then(
        (outcome) => {
          if (!wanted()) return;
          this.reading = null;
          // Stopped by the plugin being switched off: there is nothing to show.
          this.outcome = outcome ?? { kind: 'no-project' };
          this.stale = null;
          this.wordsShown = WORDS_STEP;
          this.render();
        },
        (error: unknown) => {
          console.error('Spellbook: the writing report could not be worked out', error);
          if (!wanted()) return;
          this.reading = null;
          this.failed = true;
          this.render();
        },
      );
  }

  private choose(scope: ReportScope): void {
    if (sameScope(scope, this.about) && this.reading !== null) return;
    this.about = scope;
    // Choosing a scope is asking for its figures.
    this.refresh();
  }

  // ------------------------------------------------------------------- menus

  private scopeText(folders: readonly ScopeFolder[]): string {
    const scope = this.about;
    if (scope.kind === 'scene') return SCOPE_SCENE_TEXT;
    if (scope.kind === 'manuscript') return SCOPE_MANUSCRIPT_TEXT;
    return folders.find((folder) => folder.id === scope.id)?.name ?? 'Folder';
  }

  private showScopeMenu(button: HTMLElement): void {
    const scope = this.about;
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle(SCOPE_SCENE_TEXT)
        .setChecked(scope.kind === 'scene')
        .onClick(() => {
          this.choose({ kind: 'scene' });
        });
    });
    menu.addItem((item) => {
      item
        .setTitle(SCOPE_MANUSCRIPT_TEXT)
        .setChecked(scope.kind === 'manuscript')
        .onClick(() => {
          this.choose({ kind: 'manuscript' });
        });
    });
    const folders = this.host.folders();
    if (folders.length > 0) menu.addSeparator();
    for (const folder of folders) {
      menu.addItem((item) => {
        // A folder's name is the writer's own text; a folder inside another is set in.
        const title = createFragment();
        title.createSpan({
          cls: `spellbook-report-menu-name spellbook-report-menu-depth-${Math.min(folder.depth, 3)}`,
          text: folder.name,
          attr: { dir: 'auto' },
        });
        item
          .setTitle(title)
          .setChecked(scope.kind === 'folder' && scope.id === folder.id)
          .onClick(() => {
            this.choose({ kind: 'folder', id: folder.id });
          });
      });
    }
    menu.showAtPosition(placeUnder(button));
  }

  // ------------------------------------------------------------------ drawing

  private render(): void {
    const els = this.els;
    if (!els) return;
    const folders = this.host.folders();
    // The name of a folder is the writer's own text.
    els.scopeButton.setText(this.scopeText(folders));
    els.scopeButton.setAttr('dir', this.about.kind === 'folder' ? 'auto' : null);
    els.refreshButton.disabled = !this.host.ready;
    this.renderStatus();

    const body = els.body;
    body.empty();
    const outcome = this.outcome;
    if (this.failed) {
      body.createDiv({ cls: 'spellbook-report-message', text: FAILED_TEXT });
      return;
    }
    if (!outcome) return;
    switch (outcome.kind) {
      case 'no-project':
        body.createDiv({ cls: 'spellbook-report-message', text: NO_PROJECT_TEXT });
        return;
      case 'no-scene':
        body.createDiv({ cls: 'spellbook-report-message', text: NO_SCENE_TEXT });
        return;
      case 'no-folder':
        body.createDiv({ cls: 'spellbook-report-message', text: NO_FOLDER_TEXT });
        return;
      case 'done':
        this.renderReport(body, outcome);
        return;
    }
  }

  /** How far the reading is, or that the figures are out of date. */
  private renderStatus(): void {
    const els = this.els;
    if (!els) return;
    const status = els.status;
    status.empty();
    const reading = this.reading;
    els.root.toggleClass('spellbook-report-is-reading', reading !== null);
    if (reading !== null) {
      const text = reading.total > 0 ? `Reading scene ${formatCount(reading.done + 1)} of ${formatCount(reading.total)}...` : 'Reading...';
      status.createDiv({ cls: 'spellbook-report-progress-text', text });
      const percent = reading.total > 0 ? Math.round((reading.done * 100) / reading.total) : 0;
      const track = status.createDiv({
        cls: 'spellbook-report-progress',
        attr: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-label': 'Reading the scenes' },
      });
      // How far the bar is filled is worked out, so it is set here and not in the stylesheet.
      track.createDiv({ cls: 'spellbook-report-progress-fill' }).style.width = `${percent}%`;
      return;
    }
    if (this.stale !== null) status.createDiv({ cls: 'spellbook-report-stale', text: this.stale });
  }

  private renderReport(body: HTMLElement, outcome: ReportOutcome & { kind: 'done' }): void {
    const { subject, stats } = outcome;
    // What the figures are about. Titles and names are the writer's own text.
    const about = body.createDiv({ cls: 'spellbook-report-subject' });
    about.createSpan({ cls: 'spellbook-report-subject-kind', text: subject.kind === 'scene' ? 'Scene' : subject.kind === 'folder' ? 'Folder' : 'Manuscript' });
    about.createSpan({ cls: 'spellbook-report-subject-title', text: subject.title, attr: { dir: 'auto' } });
    if (subject.kind !== 'scene') about.createSpan({ cls: 'spellbook-report-subject-scenes', text: describeScenes(outcome.scenes) });

    if (outcome.unread.length > 0) {
      const unread = body.createDiv({ cls: 'spellbook-report-unread' });
      const count = outcome.unread.length;
      unread.createSpan({
        text: `${describeScenes(count)} could not be read and ${count === 1 ? 'is' : 'are'} not in these figures:`,
      });
      for (const title of outcome.unread) unread.createSpan({ cls: 'spellbook-report-unread-title', text: title, attr: { dir: 'auto' } });
    }
    if (outcome.scenes === 0 && outcome.unread.length === 0) {
      body.createDiv({ cls: 'spellbook-report-message', text: NO_SCENES_TEXT });
      return;
    }

    const wordsPerPage = this.host.wordsPerPage;
    const figures = figuresOf(stats, wordsPerPage);
    const grid = body.createDiv({ cls: 'spellbook-report-figures' });
    const tile = (id: string, label: string, value: string, note: string): HTMLElement => {
      const el = grid.createDiv({ cls: `spellbook-report-tile spellbook-report-tile-${id}` });
      el.createDiv({ cls: 'spellbook-report-tile-label', text: label });
      el.createDiv({ cls: 'spellbook-report-tile-value', text: value });
      if (note !== '') el.createDiv({ cls: 'spellbook-report-tile-note', text: note });
      return el;
    };
    tile('words', 'Words', formatCount(figures.words), 'Counted as in the binder.');
    tile('characters', 'Characters', formatCount(figures.characters), 'With the spaces between words.');
    tile('characters-no-spaces', 'Characters without spaces', formatCount(figures.charactersNoSpaces), '');
    tile(
      'sentences',
      'Sentences',
      formatCount(figures.sentences),
      figures.wordsPerSentence === null ? '' : `${figures.wordsPerSentence.toFixed(1)} words in an average sentence.`,
    );
    tile('paragraphs', 'Paragraphs', formatCount(figures.paragraphs), PARAGRAPHS_NOTE);
    const pages = tile('pages', 'Pages', formatCount(figures.pages), 'A page that was begun counts as a page.');
    this.renderWordsPerPage(pages, wordsPerPage);
    tile('read-time', 'Reading time', figures.readTime, `At ${WORDS_PER_MINUTE} words a minute, as in the outliner.`);
    const grade = gradeTexts(figures.grade, stats);
    tile('grade', grade.label, grade.value, grade.note);

    this.renderWords(body.createDiv({ cls: 'spellbook-report-words' }), stats, null);
  }

  /** The field that sets how many words go on a page. It is taken when the writer leaves it or presses Enter, not at every key. */
  private renderWordsPerPage(tile: HTMLElement, wordsPerPage: number): void {
    const label = tile.createEl('label', { cls: 'spellbook-report-per-page' });
    label.createSpan({ text: WORDS_PER_PAGE_LABEL });
    const field = label.createEl('input', {
      cls: 'spellbook-report-per-page-field',
      attr: { type: 'number', inputmode: 'numeric', min: MIN_WORDS_PER_PAGE, max: MAX_WORDS_PER_PAGE, step: 1 },
    });
    field.value = String(wordsPerPage);
    field.addEventListener('change', () => {
      const wanted = parseWordsPerPage(field.value);
      // Not a number that can be a page: the field shows again what is in use.
      if (wanted === null || wanted === this.host.wordsPerPage) field.value = String(this.host.wordsPerPage);
      else this.host.setWordsPerPage(wanted);
    });
  }

  /**
   * The most used words, with the switch that leaves the common ones out.
   * Only this part is drawn again when the switch is flipped or more words
   * are asked for, and the keyboard stays on what was pressed.
   *
   * @param focus what gets the keyboard once it is drawn
   */
  private renderWords(section: HTMLElement, stats: TextStats, focus: 'switch' | 'more' | null): void {
    section.empty();
    section.createDiv({ cls: 'spellbook-report-words-heading', text: WORDS_HEADING });
    const label = section.createEl('label', { cls: 'spellbook-report-common' });
    const box = label.createEl('input', { cls: 'spellbook-report-common-box', attr: { type: 'checkbox' } });
    box.checked = !this.includeCommon;
    label.createSpan({ text: COMMON_SWITCH_TEXT });
    box.addEventListener('change', () => {
      this.includeCommon = !box.checked;
      this.wordsShown = WORDS_STEP;
      this.renderWords(section, stats, 'switch');
    });
    if (focus !== null) box.focus();
    section.createDiv({ cls: 'spellbook-report-common-note', text: COMMON_NOTE });

    const uses = mostUsedWords(stats.frequency, { includeCommon: this.includeCommon });
    if (uses.length === 0) {
      section.createDiv({ cls: 'spellbook-report-message', text: NO_WORDS_TEXT });
      return;
    }
    const table = section.createEl('table', { cls: 'spellbook-report-word-table' });
    const head = table.createEl('thead').createEl('tr');
    head.createEl('th', { cls: 'spellbook-report-word-head', text: 'Word', attr: { scope: 'col' } });
    head.createEl('th', { cls: 'spellbook-report-word-head spellbook-report-word-number', text: 'Times', attr: { scope: 'col' } });
    head.createEl('th', { cls: 'spellbook-report-word-head spellbook-report-word-number', text: 'Share', attr: { scope: 'col' } });
    const rows = table.createEl('tbody');
    for (const use of uses.slice(0, this.wordsShown)) {
      const row = rows.createEl('tr', { cls: 'spellbook-report-word-row' });
      row.createEl('td', { cls: 'spellbook-report-word', text: use.word, attr: { dir: 'auto' } });
      row.createEl('td', { cls: 'spellbook-report-word-count spellbook-report-word-number', text: formatCount(use.count) });
      row.createEl('td', { cls: 'spellbook-report-word-share spellbook-report-word-number', text: formatShare(use.share) });
    }
    const left = uses.length - this.wordsShown;
    if (left <= 0) return;
    const more = section.createEl('button', {
      cls: 'spellbook-report-more',
      text: `${SHOW_MORE_TEXT} (${formatCount(left)} left)`,
      attr: { type: 'button' },
    });
    more.addEventListener('click', () => {
      safely(SHOW_MORE_TEXT, () => {
        this.wordsShown += WORDS_STEP;
        this.renderWords(section, stats, 'more');
      });
    });
    if (focus === 'more') more.focus();
  }
}

export function createReportView(leaf: WorkspaceLeaf, host: ReportHost): ReportView {
  return new ReportView(leaf, host);
}
