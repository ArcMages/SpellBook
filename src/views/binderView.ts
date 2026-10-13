// The binder: the open project as a tree in the sidebar.
//
//   header   the project's name (a button that lists the projects when the
//            vault has more than one), and room for toolbar buttons
//   tree     Manuscript (the binder's scenes and folders), then Unfiled
//            (manuscript notes the binder does not list), then Research
//
// This panel only shows things and opens notes: it changes nothing in the
// vault. Everything it shows comes from the project store; it draws itself
// again whenever the store says something changed, keeping the scroll
// position and what was folded shut.
//
// Text in any language: every row whose title is the writer's own text lets
// that text choose its direction, so a Hebrew title sits at the right end of
// its row with its word count at the left end, and an English one the other
// way round. Indents and fold arrows follow the direction of Obsidian itself.

import { ItemView, Keymap, Menu, Notice, Platform } from 'obsidian';
import type { PaneType, WorkspaceLeaf } from 'obsidian';
import {
  binderTotals,
  describeCount,
  foldKey,
  formatCount,
  isNarrowPane,
  researchTree,
  scenesWithNotes,
} from '../core/binderModel';
import type { ResearchNode } from '../core/binderModel';
import type { DevicePrefs } from '../core/devicePrefs';
import { noteTitle } from '../core/paths';
import type { ProjectSession } from '../core/projectSession';
import type { ProjectStore } from '../core/projectStore';
import type { ProjectSnapshot, ProjectSummary, TreeNode } from '../core/types';
import type { WordCountCache } from '../core/wordCountCache';
import { BINDER_ICON, FOLD_ICON, SWITCH_ICON, WARNING_ICON, showIcon } from '../ui/icons';

export const BINDER_VIEW_TYPE = 'spellbook-binder';
export const BINDER_VIEW_NAME = 'Binder';

/** Shown on a binder entry whose note is not in the vault. */
export const MISSING_LABEL = 'File not found (it may still be syncing)';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

/** The parts of the plugin the binder works with. They exist once Obsidian has finished starting up. */
export interface BinderServices {
  readonly store: ProjectStore;
  readonly session: ProjectSession;
  readonly wordCounts: WordCountCache;
  readonly prefs: DevicePrefs;
}

/** What the binder needs from the plugin. */
export interface BinderHost {
  /** Null until Obsidian has finished starting up, and again after the plugin is switched off. */
  readonly services: BinderServices | null;
  /** Call `callback` once the services exist (straight away when they already do). */
  whenStarted(callback: () => void): void;
  /** Show the window that asks for a new project's name. */
  askForNewProject(): void;
  /**
   * Show the note at a vault path. `where` says where: false for the tab the
   * writer was last working in, 'tab' for a new one, and so on.
   * Resolves with false when the note could not be shown.
   */
  openNote(path: string, where: PaneType | boolean): Promise<boolean>;
}

interface Elements {
  readonly root: HTMLElement;
  readonly heading: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly scroll: HTMLElement;
  readonly body: HTMLElement;
}

/** A place where a word count is shown, and what it shows now. */
interface CountSpot {
  readonly el: HTMLElement;
  shown: string;
}

/** A row that stands for a note. */
interface NoteRow {
  readonly self: HTMLElement;
  readonly count: CountSpot | null;
  /** The rows of the folders this one sits in. */
  readonly trail: readonly HTMLElement[];
}

interface RowOptions {
  /** Classes for the whole item (the row together with what is nested under it). */
  readonly itemCls: string;
  /** Classes for the row itself. */
  readonly selfCls: string;
  /** Classes for the title. */
  readonly titleCls: string;
  readonly title: string;
  /** True when the title is the writer's own text, which may be in any language. */
  readonly ownText: boolean;
  /** True when the row shows a word count. */
  readonly counted: boolean;
  /** Set for a row that can be folded shut: the name its state is remembered under. */
  readonly fold?: { readonly indexPath: string; readonly key: string };
}

interface Row {
  readonly item: HTMLElement;
  readonly self: HTMLElement;
  /** The space at the start of the row, for a fold arrow or a warning sign. */
  readonly slot: HTMLElement;
  /** Holds the title and the count; takes the direction of the title's text. */
  readonly body: HTMLElement;
  /** Holds `body` and, under it, a second line when the row has something to say. */
  readonly main: HTMLElement;
  readonly title: HTMLElement;
  readonly count: CountSpot | null;
  /** Where nested rows go; null for a row that cannot be folded. */
  readonly children: HTMLElement | null;
}

export class BinderView extends ItemView {
  private readonly host: BinderHost;
  private services: BinderServices | null = null;
  private els: Elements | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  /** The timer of a drawing that is about to happen, if any. */
  private renderTimer: number | null = null;
  private observer: ResizeObserver | null = null;
  private narrow = false;

  /** The index path of the project the tree was last drawn for. */
  private shownProject: string | null = null;
  /** The vault path of the note being worked on in the main area. */
  private activePath: string | null = null;
  /** The rows that stand for notes, by the note's vault path. */
  private noteRows = new Map<string, NoteRow[]>();
  private folderCounts = new Map<string, CountSpot>();
  private manuscriptCount: CountSpot | null = null;
  /** The elements that carry a mark for the active note at the moment. */
  private marked: HTMLElement[] = [];

  constructor(leaf: WorkspaceLeaf, host: BinderHost) {
    super(leaf);
    this.host = host;
    this.navigation = false;
  }

  override getViewType(): string {
    return BINDER_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return BINDER_VIEW_NAME;
  }

  override getIcon(): string {
    return BINDER_ICON;
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    this.narrow = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-binder-pane');

    const root = pane.createDiv({ cls: 'spellbook-binder' });
    // Touch needs taller rows. Platform.isMobile covers phones and tablets;
    // the stylesheet also covers touch screens on desktop.
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    const header = root.createDiv({ cls: 'spellbook-binder-header' });
    const heading = header.createDiv({ cls: 'spellbook-binder-heading' });
    // Empty for now: the buttons for adding scenes and folders go here.
    const toolbar = header.createDiv({ cls: 'spellbook-binder-toolbar nav-buttons-container' });
    const scroll = root.createDiv({ cls: 'spellbook-binder-scroll' });
    const body = scroll.createDiv({ cls: 'spellbook-binder-body' });
    this.els = { root, heading, toolbar, scroll, body };

    // The layout for a narrow pane goes by the pane's measured width, never
    // by the kind of device.
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        this.measure();
      });
      this.observer.observe(pane);
    }
    this.measure();

    // When Obsidian starts, it opens its panes before the plugin's services
    // exist: say so for now, and fill the pane in when they do.
    this.host.whenStarted(() => {
      this.attach();
    });
    if (!this.services) this.render();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = null;
    this.observer?.disconnect();
    this.observer = null;
    // Nobody is looking at word counts any more.
    this.services?.wordCounts.track([]);
    this.services = null;
    this.forgetRows();
    this.els = null;
    this.shownProject = null;
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-binder-pane');
  }

  override onResize(): void {
    this.measure();
  }

  /** Start following the store. Runs once, when the plugin's services exist. */
  private attach(): void {
    const services = this.host.services;
    if (this.closed || this.services || !services) return;
    this.services = services;
    this.stops.push(
      // Both kinds of change matter: the open project is the tree, and the
      // list of projects decides whether the header offers a choice.
      services.store.onChange(() => {
        this.scheduleRender();
      }),
      services.session.onProblem(() => {
        this.scheduleRender();
      }),
      services.wordCounts.onChange((paths) => {
        this.onCounts(paths);
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        // With no file in front (a graph, say), Obsidian still knows the note
        // that was worked on last; that is the one the list keeps showing.
        this.setActive((file ?? this.app.workspace.getActiveFile())?.path ?? null);
      }),
    );
    this.render();
  }

  /**
   * Draw again in a moment. The store often reports several changes in a row
   * (a note arrives, the list of projects changes, then the open project):
   * they are all drawn in one go.
   */
  private scheduleRender(): void {
    if (this.renderTimer !== null || this.closed) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 0);
  }

  private measure(): void {
    const els = this.els;
    if (!els) return;
    const narrow = isNarrowPane(this.contentEl.clientWidth, this.narrow);
    if (narrow === this.narrow) return;
    this.narrow = narrow;
    els.root.toggleClass('spellbook-is-narrow', narrow);
  }

  // ------------------------------------------------------------------ drawing

  private render(): void {
    const els = this.els;
    if (!els || this.closed) return;
    const services = this.services;
    const project = services?.store.project ?? null;
    const sameProject = project !== null && project.indexPath === this.shownProject;
    // Keep the place in the list, unless this is another project.
    const scrollTop = sameProject ? els.scroll.scrollTop : 0;
    this.shownProject = project?.indexPath ?? null;

    this.renderHeader(els.heading, services, project);

    els.body.empty();
    this.forgetRows();
    if (!services) {
      this.say(els.body, 'Spellbook is still starting...');
    } else if (!project) {
      this.renderNoProject(els.body, services);
    } else {
      this.renderProject(els.body, services, project);
    }
    els.scroll.scrollTop = scrollTop;

    this.activePath = this.app.workspace.getActiveFile()?.path ?? null;
    this.markActive(!sameProject);
    this.trackCounts(services, project);
  }

  private forgetRows(): void {
    this.noteRows = new Map();
    this.folderCounts = new Map();
    this.manuscriptCount = null;
    this.marked = [];
  }

  private say(parent: HTMLElement, text: string, cls = 'spellbook-binder-message'): HTMLElement {
    return parent.createDiv({ cls, text });
  }

  // ------------------------------------------------------------------- header

  private renderHeader(heading: HTMLElement, services: BinderServices | null, project: ProjectSnapshot | null): void {
    heading.empty();
    const projects = services?.store.listProjects() ?? [];
    if (project === null) {
      if (projects.length > 0) this.addSwitch(heading, 'Choose a project', false);
      else heading.createDiv({ cls: 'spellbook-project-name', text: BINDER_VIEW_NAME });
      return;
    }
    const hasOthers = projects.some((other) => other.indexPath !== project.indexPath);
    if (hasOthers) {
      this.addSwitch(heading, project.title, true);
    } else {
      heading.createDiv({ cls: 'spellbook-project-name', text: project.title, attr: { dir: 'auto' } });
    }
  }

  /** The project's name as a button that lists the projects of the vault. */
  private addSwitch(heading: HTMLElement, label: string, ownText: boolean): void {
    const button = heading.createEl('button', {
      cls: 'spellbook-project-switch',
      attr: {
        type: 'button',
        // Read out by screen readers, and shown by Obsidian as a tooltip: the
        // whole name, which the button itself may have had to cut short.
        'aria-label': ownText ? `${label} (switch project)` : label,
        'aria-haspopup': 'menu',
      },
    });
    const name = button.createSpan({ cls: 'spellbook-project-name', text: label });
    if (ownText) name.setAttr('dir', 'auto');
    showIcon(button.createSpan({ cls: 'spellbook-project-switch-icon' }), ...SWITCH_ICON);
    button.addEventListener('click', () => {
      this.showProjectMenu(button);
    });
  }

  private showProjectMenu(anchor: HTMLElement): void {
    const services = this.services;
    if (!services) return;
    const projects = services.store.listProjects();
    const open = services.store.project?.indexPath ?? null;
    const menu = new Menu();
    for (const project of projects) {
      menu.addItem((item) => {
        item
          .setTitle(projectLabel(project, projects))
          .setChecked(project.indexPath === open)
          .onClick(() => {
            void this.chooseProject(project.indexPath);
          });
      });
    }
    const box = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: box.left, y: box.bottom, width: box.width });
  }

  private async chooseProject(indexPath: string): Promise<void> {
    const services = this.services;
    if (!services || services.store.project?.indexPath === indexPath) return;
    const result = await services.session.choose(indexPath);
    if (result.status !== 'done') new Notice(result.message, PROBLEM_NOTICE_MS);
  }

  // --------------------------------------------------------------- no project

  private renderNoProject(body: HTMLElement, services: BinderServices): void {
    if (services.store.listProjects().length > 0) {
      const problem = services.session.problem;
      if (problem === null) {
        this.say(body, 'Opening the project...');
      } else {
        this.say(body, 'The project could not be opened.');
        this.say(body, problem).setAttr('dir', 'auto');
      }
      return;
    }

    const empty = body.createDiv({ cls: 'spellbook-binder-empty' });
    this.say(
      empty,
      'There is no Spellbook project in this vault yet. A project is a folder that holds a novel: ' +
        'its scenes, its research and its notes.',
    );
    const create = empty.createEl('button', {
      cls: 'mod-cta spellbook-binder-create',
      text: 'Create project',
      attr: { type: 'button' },
    });
    create.addEventListener('click', () => {
      this.host.askForNewProject();
    });
    this.say(
      empty,
      'To try things on a ready-made novel instead, run "Spellbook: Create sample project" from the command palette.',
      'spellbook-binder-message spellbook-binder-hint',
    );
  }

  // ------------------------------------------------------------- open project

  private renderProject(body: HTMLElement, services: BinderServices, project: ProjectSnapshot): void {
    const { store, wordCounts } = services;
    const indexPath = project.indexPath;

    if (project.readOnly) this.renderReadOnly(body, project);
    for (const note of project.notes) {
      this.say(body, note, 'spellbook-binder-message spellbook-binder-note').setAttr('dir', 'auto');
    }

    if (!project.readOnly) {
      const manuscript = this.addRow(body, {
        itemCls: 'spellbook-section',
        selfCls: 'spellbook-section-self',
        titleCls: 'spellbook-section-title',
        title: 'Manuscript',
        ownText: false,
        counted: true,
        fold: { indexPath, key: foldKey.section('manuscript') },
      });
      this.manuscriptCount = manuscript.count;
      if (project.tree.length === 0) {
        this.say(manuscript.children ?? body, 'No scenes yet.', 'spellbook-binder-message spellbook-binder-hint');
      }
      this.addBinderNodes(manuscript.children ?? body, project.tree, [], services, indexPath);
    }

    if (project.unfiled.length > 0) {
      const unfiled = this.addRow(body, {
        itemCls: 'spellbook-section',
        selfCls: 'spellbook-section-self',
        titleCls: 'spellbook-section-title',
        title: 'Unfiled',
        ownText: false,
        counted: false,
        fold: { indexPath, key: foldKey.section('unfiled') },
      });
      for (const path of project.unfiled) {
        this.addNoteRow(unfiled.children ?? body, path, noteTitle(path), true, [], services);
      }
    }

    const research = this.addRow(body, {
      itemCls: 'spellbook-section',
      selfCls: 'spellbook-section-self',
      titleCls: 'spellbook-section-title',
      title: 'Research',
      ownText: false,
      counted: false,
      fold: { indexPath, key: foldKey.section('research') },
    });
    if (project.research.length === 0) {
      this.say(research.children ?? body, 'No research notes yet.', 'spellbook-binder-message spellbook-binder-hint');
    }
    this.addResearchNodes(research.children ?? body, researchTree(project.research), [], services, indexPath);

    const totals = binderTotals(project.tree, (path) => {
      const vaultPath = store.vaultPathOf(path);
      return vaultPath === null ? null : wordCounts.get(vaultPath);
    });
    this.showTotals(totals.folders, totals.manuscript);
  }

  /** The project's index could not be understood: say so, with the file to look at. */
  private renderReadOnly(body: HTMLElement, project: ProjectSnapshot): void {
    const banner = body.createDiv({ cls: 'spellbook-binder-banner', attr: { role: 'alert' } });
    showIcon(banner.createDiv({ cls: 'spellbook-binder-banner-icon' }), ...WARNING_ICON);
    const text = banner.createDiv({ cls: 'spellbook-binder-banner-text' });
    text.createDiv({ cls: 'spellbook-binder-banner-title', text: 'This project is read-only' });
    text.createDiv({
      cls: 'spellbook-binder-banner-reason',
      text: project.error ?? 'Its index note could not be understood.',
      attr: { dir: 'auto' },
    });
    const file = text.createDiv({ cls: 'spellbook-binder-banner-file' });
    file.createSpan({ text: 'Index note: ' });
    file.createSpan({ cls: 'spellbook-binder-banner-path', text: project.indexPath, attr: { dir: 'auto' } });
  }

  private addBinderNodes(
    parent: HTMLElement,
    nodes: readonly TreeNode[],
    trail: readonly HTMLElement[],
    services: BinderServices,
    indexPath: string,
  ): void {
    for (const node of nodes) {
      if (node.kind === 'scene') {
        if (node.missing) this.addMissingRow(parent, node.title);
        else this.addNoteRow(parent, node.path, node.title, true, trail, services);
        continue;
      }
      const row = this.addRow(parent, {
        itemCls: 'nav-folder spellbook-folder',
        selfCls: 'nav-folder-title',
        titleCls: 'nav-folder-title-content',
        title: node.name,
        ownText: true,
        counted: true,
        fold: { indexPath, key: foldKey.folder(node.id) },
      });
      if (row.count) this.folderCounts.set(node.id, row.count);
      this.addBinderNodes(row.children ?? parent, node.children, [...trail, row.self], services, indexPath);
    }
  }

  private addResearchNodes(
    parent: HTMLElement,
    nodes: readonly ResearchNode[],
    trail: readonly HTMLElement[],
    services: BinderServices,
    indexPath: string,
  ): void {
    for (const node of nodes) {
      if (node.kind === 'note') {
        this.addNoteRow(parent, node.path, node.title, false, trail, services);
        continue;
      }
      const row = this.addRow(parent, {
        itemCls: 'nav-folder spellbook-folder',
        selfCls: 'nav-folder-title',
        titleCls: 'nav-folder-title-content',
        title: node.name,
        ownText: true,
        counted: false,
        fold: { indexPath, key: foldKey.research(node.path) },
      });
      this.addResearchNodes(row.children ?? parent, node.children, [...trail, row.self], services, indexPath);
    }
  }

  /** A row for a note that exists: tapping it opens the note. */
  private addNoteRow(
    parent: HTMLElement,
    path: string,
    title: string,
    counted: boolean,
    trail: readonly HTMLElement[],
    services: BinderServices,
  ): void {
    const row = this.addRow(parent, {
      itemCls: 'nav-file spellbook-note',
      selfCls: 'nav-file-title is-clickable',
      titleCls: 'nav-file-title-content',
      title,
      ownText: true,
      counted,
    });
    row.self.addEventListener('click', (event) => {
      void this.openNote(path, Keymap.isModEvent(event));
    });
    // A click with the middle button (the wheel) opens a new tab, as elsewhere in Obsidian.
    row.self.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      void this.openNote(path, 'tab');
    });

    const vaultPath = services.store.vaultPathOf(path);
    if (vaultPath === null) return;
    if (row.count) this.showCount(row.count, services.wordCounts.get(vaultPath));
    const rows = this.noteRows.get(vaultPath) ?? [];
    rows.push({ self: row.self, count: row.count, trail });
    this.noteRows.set(vaultPath, rows);
  }

  /** A row for a binder entry whose note is not in the vault: greyed, with a warning. */
  private addMissingRow(parent: HTMLElement, title: string): void {
    const row = this.addRow(parent, {
      itemCls: 'nav-file spellbook-note spellbook-is-missing',
      selfCls: 'nav-file-title',
      titleCls: 'nav-file-title-content',
      title,
      ownText: true,
      counted: false,
    });
    row.self.setAttr('aria-disabled', 'true');
    row.slot.addClass('spellbook-missing-icon');
    row.slot.setAttr('aria-label', MISSING_LABEL);
    showIcon(row.slot, ...WARNING_ICON);
    row.main.createDiv({ cls: 'spellbook-row-note', text: MISSING_LABEL });
    // There is nothing to open, but a tap should not go unanswered.
    row.self.addEventListener('click', () => {
      new Notice(`"${title}": ${MISSING_LABEL}.`);
    });
  }

  /**
   * Build one row with Obsidian's own tree classes (so that themes apply)
   * next to the plugin's (which the stylesheet lays the row out with).
   */
  private addRow(parent: HTMLElement, options: RowOptions): Row {
    const item = parent.createDiv({ cls: `tree-item spellbook-row ${options.itemCls}` });
    const self = item.createDiv({ cls: `tree-item-self spellbook-row-self ${options.selfCls}` });
    const slot = self.createDiv({ cls: 'spellbook-row-slot' });
    const main = self.createDiv({ cls: 'spellbook-row-main' });
    const body = main.createDiv({ cls: 'spellbook-row-body' });
    // The direction of the row follows the title's own text: see the top of this file.
    if (options.ownText) body.setAttr('dir', 'auto');
    const title = body.createDiv({
      cls: `tree-item-inner spellbook-title ${options.titleCls}`,
      text: options.title,
    });

    let count: CountSpot | null = null;
    if (options.counted) {
      // Numbers read left to right in every language; marking them so also
      // keeps them out of the way when the row works out its direction.
      const outer = body.createDiv({ cls: 'tree-item-flair-outer spellbook-count-outer', attr: { dir: 'ltr' } });
      count = { el: outer.createSpan({ cls: 'tree-item-flair spellbook-count' }), shown: '' };
    }

    let children: HTMLElement | null = null;
    const fold = options.fold;
    if (fold) {
      self.addClass('mod-collapsible', 'is-clickable');
      slot.addClass('tree-item-icon', 'collapse-icon', 'spellbook-fold-icon');
      showIcon(slot, ...FOLD_ICON);
      children = item.createDiv({ cls: 'tree-item-children spellbook-children' });
      const collapsed = this.services?.prefs.isCollapsed(fold.indexPath, fold.key) === true;
      this.showFold(item, self, slot, collapsed);
      self.addEventListener('click', () => {
        const prefs = this.services?.prefs;
        if (!prefs) return;
        const next = !prefs.isCollapsed(fold.indexPath, fold.key);
        prefs.setCollapsed(fold.indexPath, fold.key, next);
        this.showFold(item, self, slot, next);
      });
    }
    return { item, self, slot, body, main, title, count, children };
  }

  private showFold(item: HTMLElement, self: HTMLElement, slot: HTMLElement, collapsed: boolean): void {
    item.toggleClass('is-collapsed', collapsed);
    slot.toggleClass('is-collapsed', collapsed);
    self.setAttr('aria-expanded', collapsed ? 'false' : 'true');
  }

  // --------------------------------------------------------------- word counts

  /** Ask for the counts of the notes on show, top to bottom. */
  private trackCounts(services: BinderServices | null, project: ProjectSnapshot | null): void {
    if (!services) return;
    const wanted: string[] = [];
    if (project) {
      for (const path of [...scenesWithNotes(project.tree), ...project.unfiled]) {
        const vaultPath = services.store.vaultPathOf(path);
        if (vaultPath !== null) wanted.push(vaultPath);
      }
    }
    services.wordCounts.track(wanted);
  }

  /** Some notes were counted: bring just their rows, and the sums above them, up to date. */
  private onCounts(paths: readonly string[]): void {
    const services = this.services;
    const project = services?.store.project;
    if (this.closed || !services || !project) return;
    for (const path of paths) {
      for (const row of this.noteRows.get(path) ?? []) {
        if (row.count) this.showCount(row.count, services.wordCounts.get(path));
      }
    }
    if (project.readOnly) return;
    const totals = binderTotals(project.tree, (path) => {
      const vaultPath = services.store.vaultPathOf(path);
      return vaultPath === null ? null : services.wordCounts.get(vaultPath);
    });
    this.showTotals(totals.folders, totals.manuscript);
  }

  private showTotals(folders: ReadonlyMap<string, number | null>, manuscript: number | null): void {
    for (const [id, spot] of this.folderCounts) this.showCount(spot, folders.get(id));
    if (this.manuscriptCount) this.showCount(this.manuscriptCount, manuscript);
  }

  /** Show a count, or nothing while it is not known. Touches the screen only when the text changes. */
  private showCount(spot: CountSpot, words: number | null | undefined): void {
    const known = typeof words === 'number';
    const text = known ? formatCount(words) : '';
    if (spot.shown === text) return;
    spot.shown = text;
    spot.el.setText(text);
    spot.el.setAttr('aria-label', known ? describeCount(words) : null);
  }

  // -------------------------------------------------------------- active note

  private setActive(path: string | null): void {
    if (this.closed || path === this.activePath) return;
    this.activePath = path;
    this.markActive(true);
  }

  /**
   * Highlight the row of the note being worked on, and mark the folders it
   * sits in (the stylesheet shows that mark on a folder that is folded shut).
   *
   * @param reveal scroll the row into view
   */
  private markActive(reveal: boolean): void {
    for (const el of this.marked) el.removeClass('is-active', 'spellbook-has-active');
    this.marked = [];
    const rows = this.activePath === null ? [] : (this.noteRows.get(this.activePath) ?? []);
    for (const row of rows) {
      row.self.addClass('is-active');
      this.marked.push(row.self);
      for (const folder of row.trail) {
        folder.addClass('spellbook-has-active');
        this.marked.push(folder);
      }
    }
    const first = rows[0];
    if (reveal && first) this.reveal(first.self);
  }

  /**
   * Scroll the list, and only the list, so that a row can be seen. (The
   * browser's own "scroll into view" may also shift whatever the list sits
   * in, such as a phone's side drawer.)
   */
  private reveal(row: HTMLElement): void {
    const scroll = this.els?.scroll;
    if (!scroll) return;
    const box = scroll.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    // No height: the row is inside something folded shut, or the pane is hidden.
    if (!(at.height > 0) || !(box.height > 0)) return;
    if (at.top < box.top) scroll.scrollTop -= box.top - at.top;
    else if (at.bottom > box.bottom) scroll.scrollTop += at.bottom - box.bottom;
  }

  // ------------------------------------------------------------- opening notes

  private async openNote(path: string, where: PaneType | boolean): Promise<void> {
    const services = this.services;
    if (!services) return;
    const title = noteTitle(path);
    const vaultPath = services.store.vaultPathOf(path);
    if (vaultPath === null) {
      new Notice(`"${title}": ${MISSING_LABEL}.`);
      return;
    }
    let shown = false;
    try {
      shown = await this.host.openNote(vaultPath, where);
    } catch {
      shown = false;
    }
    if (!shown) {
      new Notice(`"${title}" could not be opened.`);
      return;
    }
    this.hideDrawerOnPhone();
  }

  /**
   * On a phone the sidebar is a drawer that covers the note. Once a note has
   * been opened from it, slide the drawer away so the note can be seen.
   */
  private hideDrawerOnPhone(): void {
    if (this.closed || !Platform.isPhone) return;
    const { workspace } = this.app;
    const home = this.leaf.getRoot();
    // On a phone a pane can sit directly in its drawer, so look at both.
    if (home === workspace.rightSplit || this.leaf.parent === workspace.rightSplit) workspace.rightSplit.collapse();
    else if (home !== workspace.rootSplit) workspace.leftSplit.collapse();
  }
}

/** A project's name in the list of projects; two with the same title also show their folders. */
function projectLabel(project: ProjectSummary, all: readonly ProjectSummary[]): string {
  const shared = all.some((other) => other.indexPath !== project.indexPath && other.title === project.title);
  if (!shared) return project.title;
  return `${project.title} (${project.folder === '' ? 'top of the vault' : project.folder})`;
}
