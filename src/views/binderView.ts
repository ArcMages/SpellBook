// The binder: the open project as a tree in the sidebar.
//
//   header   the project's name (a button that lists the projects when the
//            vault has more than one), and the toolbar: New scene, New folder
//            and a "more" menu
//   tree     Manuscript (the binder's scenes and folders), then Unfiled
//            (manuscript notes the binder does not list), then Research
//
// Everything it shows comes from the project store; it draws itself again
// whenever the store says something changed, keeping the scroll position and
// what was folded shut. The panel itself changes nothing in the vault: its
// buttons and menus hand over to the binder's actions
// (src/views/binderActions.ts), which go through the store.
//
// Every row that stands for something has a "more" button that opens its
// menu; a right-click opens the same menu. One row is the selected row: the
// one last tapped, opened or acted on (src/core/binderSelection.ts).
//
// Text in any language: every row whose title is the writer's own text lets
// that text choose its direction, so a Hebrew title sits at the right end of
// its row with its word count at the left end, and an English one the other
// way round. Indents, fold arrows and "more" buttons follow the direction of
// Obsidian itself.

import { ItemView, Keymap, Menu, Notice, Platform } from 'obsidian';
import type { PaneType, WorkspaceLeaf } from 'obsidian';
import {
  binderTotals,
  describeCount,
  foldKey,
  folderFoldKeys,
  formatCount,
  isNarrowPane,
  researchTree,
  rowKey,
  scenesWithNotes,
} from '../core/binderModel';
import type { ResearchNode } from '../core/binderModel';
import type { BinderSelection } from '../core/binderSelection';
import { folderRef, sceneRef } from '../core/binderTree';
import type { DevicePrefs } from '../core/devicePrefs';
import { noteTitle, relativeTo } from '../core/paths';
import type { ProjectSession } from '../core/projectSession';
import type { ProjectStore } from '../core/projectStore';
import type { NodeRef, ProjectSnapshot, ProjectSummary, TreeNode } from '../core/types';
import type { WordCountCache } from '../core/wordCountCache';
import {
  ACTION_ICONS,
  BINDER_ICON,
  FOLD_ICON,
  ROW_MORE_ICON,
  SWITCH_ICON,
  TOOLBAR_MORE_ICON,
  WARNING_ICON,
  iconName,
  showIcon,
} from '../ui/icons';
import { safely } from '../ui/safely';
import { MISSING_LABEL } from './binderActions';
import type { BinderActions } from './binderActions';
import { folderMenu, missingMenu, researchMenu, sceneMenu, unfiledMenu } from './binderMenus';
import type { MenuContext } from './binderMenus';

export { MISSING_LABEL } from './binderActions';

export const BINDER_VIEW_TYPE = 'spellbook-binder';
export const BINDER_VIEW_NAME = 'Binder';

/** What the "more" button of a row, and of the toolbar, is called (read out, and shown as a tooltip). */
export const MORE_LABEL = 'More options';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

/** The parts of the plugin the binder works with. They exist once Obsidian has finished starting up. */
export interface BinderServices {
  readonly store: ProjectStore;
  readonly session: ProjectSession;
  readonly wordCounts: WordCountCache;
  readonly prefs: DevicePrefs;
  readonly selection: BinderSelection;
}

/** What the binder needs from the plugin. */
export interface BinderHost {
  /** Null until Obsidian has finished starting up, and again after the plugin is switched off. */
  readonly services: BinderServices | null;
  /** What the binder's buttons and menus do. */
  readonly actions: BinderActions;
  /** Call `callback` once the services exist (straight away when they already do). */
  whenStarted(callback: () => void): void;
  /** Show the window that asks for a new project's name. */
  askForNewProject(): void;
  /** Create the sample novel and open it. Resolves with whether it was created. */
  createSampleProject(): Promise<boolean>;
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

/** Something that can be folded shut: a section or a folder. */
interface Fold {
  readonly item: HTMLElement;
  readonly self: HTMLElement;
  readonly slot: HTMLElement;
  /** The project and the name its state is remembered under. */
  readonly indexPath: string;
  readonly key: string;
}

/** A row that stands for a note. */
interface NoteRow {
  readonly self: HTMLElement;
  readonly count: CountSpot | null;
  /** What the row sits in, from the outside in: its section, then the folders. */
  readonly around: readonly Fold[];
}

/** A row that can be the selected row. */
interface Selectable {
  readonly self: HTMLElement;
  readonly around: readonly Fold[];
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
  /** Set for a row that can be the selected row: what it stands for. */
  readonly select?: NodeRef;
  /** Set for a row with a "more" button: makes its menu, for the project as it is at that moment. */
  readonly menu?: (context: MenuContext) => Menu;
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
  /** How the row is folded and unfolded; null for a row that cannot be. */
  readonly fold: Fold | null;
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
  /** The rows that can be selected, by what they stand for (see rowKey). */
  private rows = new Map<string, Selectable>();
  private folderCounts = new Map<string, CountSpot>();
  private manuscriptCount: CountSpot | null = null;
  /** The elements that carry a mark for the active note at the moment. */
  private marked: HTMLElement[] = [];
  /** The row that carries the mark of the selected row at the moment. */
  private selectedRow: HTMLElement | null = null;
  /** The last request to bring the selected row into view that was dealt with. */
  private revealed = 0;
  /** True while the selected row still has to be scrolled to, because the panel could not be measured. */
  private scrollPending = false;

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
    this.scrollPending = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-binder-pane');

    const root = pane.createDiv({ cls: 'spellbook-binder' });
    // Touch needs taller rows. Platform.isMobile covers phones and tablets;
    // the stylesheet also covers touch screens on desktop.
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    const header = root.createDiv({ cls: 'spellbook-binder-header' });
    const heading = header.createDiv({ cls: 'spellbook-binder-heading' });
    // The toolbar is laid out by the plugin's own stylesheet alone. It does
    // not borrow the class of Obsidian's own rows of buttons, so that no rule
    // Obsidian has for those rows (on phones, say) can move or hide this one.
    const toolbar = header.createDiv({ cls: 'spellbook-binder-toolbar' });
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
    // Only what is asked for from now on is scrolled to.
    this.revealed = services.selection.revealCount;
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
      services.selection.onChange(() => {
        this.onSelection();
      }),
      this.host.actions.onNoteOpened(() => {
        this.hideDrawerOnPhone();
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
    if (narrow !== this.narrow) {
      this.narrow = narrow;
      els.root.toggleClass('spellbook-is-narrow', narrow);
    }
    // The panel may have been hidden when a row was to be scrolled to.
    if (this.scrollPending) this.showSelection();
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
    this.renderToolbar(els.toolbar, services, project);

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
    this.showSelection();
    this.trackCounts(services, project);
  }

  private forgetRows(): void {
    this.noteRows = new Map();
    this.rows = new Map();
    this.folderCounts = new Map();
    this.manuscriptCount = null;
    this.marked = [];
    this.selectedRow = null;
  }

  private say(parent: HTMLElement, text: string, cls = 'spellbook-binder-message'): HTMLElement {
    return parent.createDiv({ cls, text });
  }

  /**
   * A small button that shows an icon. It is built the way Obsidian builds
   * its own (so that themes style it), and can be reached and pressed from
   * the keyboard as well.
   */
  private addButton(
    parent: HTMLElement,
    cls: string,
    label: string,
    icons: readonly string[],
    press: () => unknown,
  ): HTMLElement {
    const button = parent.createDiv({
      cls: `clickable-icon ${cls}`,
      // The label is read out by screen readers, and shown by Obsidian as a tooltip.
      attr: { role: 'button', tabindex: 0, 'aria-label': label },
    });
    showIcon(button, ...icons);
    button.addEventListener('click', (event) => {
      // A button inside a row: the row must not take the tap for itself.
      event.stopPropagation();
      safely(label, press);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      safely(label, press);
    });
    return button;
  }

  /** Show a menu under the button (or other element) it belongs to. */
  private showMenuAt(menu: Menu, anchor: HTMLElement): void {
    const box = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: box.left, y: box.bottom, width: box.width });
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
    this.showMenuAt(menu, anchor);
  }

  private async chooseProject(indexPath: string): Promise<void> {
    const services = this.services;
    if (!services || services.store.project?.indexPath === indexPath) return;
    const result = await services.session.choose(indexPath);
    if (result.status !== 'done') new Notice(result.message, PROBLEM_NOTICE_MS);
  }

  // ------------------------------------------------------------------ toolbar

  /**
   * The buttons next to the project's name: New scene and New folder while a
   * project is open that can be changed, and a menu with the rest.
   */
  private renderToolbar(toolbar: HTMLElement, services: BinderServices | null, project: ProjectSnapshot | null): void {
    toolbar.empty();
    if (!services) return;
    if (project && !project.readOnly) {
      this.addButton(toolbar, 'spellbook-toolbar-button', 'New scene', ACTION_ICONS.newScene, () => {
        this.newFromToolbar('scene');
      });
      this.addButton(toolbar, 'spellbook-toolbar-button', 'New folder', ACTION_ICONS.newFolder, () => {
        this.newFromToolbar('folder');
      });
    }
    const more = this.addButton(toolbar, 'spellbook-toolbar-button', MORE_LABEL, TOOLBAR_MORE_ICON, () => {
      this.showToolbarMenu(more);
    });
    more.setAttr('aria-haspopup', 'menu');
  }

  /**
   * "New scene" or "New folder" from the toolbar. A new scene goes below the
   * selected row, or inside it when that is a folder; a new folder goes below
   * the selected row. With nothing selected, the note being worked on stands
   * in; failing that, the new thing goes to the end of the binder.
   */
  private newFromToolbar(kind: 'scene' | 'folder'): void {
    const services = this.services;
    const project = services?.store.project;
    if (!services || !project) return;
    const chosen = services.selection.currentIn(project.indexPath) ?? this.activeRef(project);
    if (kind === 'scene') this.host.actions.newSceneNear(project.indexPath, chosen);
    else this.host.actions.newFolderNear(project.indexPath, chosen);
  }

  private showToolbarMenu(anchor: HTMLElement): void {
    const project = this.services?.store.project ?? null;
    const menu = new Menu();
    const add = (title: string, icons: readonly string[], run: () => unknown): void => {
      menu.addItem((item) => {
        item
          .setTitle(title)
          .setIcon(iconName(...icons))
          .onClick(() => {
            safely(title, run);
          });
      });
    };
    if (project) {
      add('Collapse all', ACTION_ICONS.collapseAll, () => {
        this.foldAll(true);
      });
      add('Expand all', ACTION_ICONS.expandAll, () => {
        this.foldAll(false);
      });
      menu.addSeparator();
    }
    add('Create project', ACTION_ICONS.createProject, () => {
      this.host.askForNewProject();
    });
    add('Create sample project', ACTION_ICONS.sampleProject, () => this.host.createSampleProject());
    this.showMenuAt(menu, anchor);
  }

  /**
   * "Collapse all" folds every folder shut (the binder's and Research's) and
   * leaves the three sections as they are; "Expand all" opens everything.
   * Remembered on this device like any other folding.
   */
  private foldAll(collapsed: boolean): void {
    const services = this.services;
    const project = services?.store.project;
    if (!services || !project) return;
    const at = project.indexPath;
    const sections = [foldKey.section('manuscript'), foldKey.section('unfiled'), foldKey.section('research')];
    const folded = collapsed
      ? [
          ...sections.filter((key) => services.prefs.isCollapsed(at, key)),
          ...folderFoldKeys(project.tree, project.research),
        ]
      : [];
    services.prefs.setCollapsedItems(at, folded);
    this.render();
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
      'To try things on a ready-made novel instead, choose "Create sample project" from the menu at the top ' +
        'of this panel, or run "Spellbook: Create sample project" from the command palette.',
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
      this.addBinderNodes(manuscript.children ?? body, project.tree, foldsOf(manuscript), services, indexPath);
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
        this.addNoteRow(unfiled.children ?? body, path, noteTitle(path), true, foldsOf(unfiled), services, (context) =>
          unfiledMenu(context, path),
        );
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
    this.addResearchNodes(
      research.children ?? body,
      researchTree(project.research),
      foldsOf(research),
      services,
      indexPath,
    );

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
    around: readonly Fold[],
    services: BinderServices,
    indexPath: string,
  ): void {
    for (const node of nodes) {
      if (node.kind === 'scene') {
        const path = node.path;
        if (node.missing) {
          this.addMissingRow(parent, path, node.title, around);
        } else {
          this.addNoteRow(parent, path, node.title, true, around, services, (context) => sceneMenu(context, path));
        }
        continue;
      }
      const id = node.id;
      const row = this.addRow(
        parent,
        {
          itemCls: 'nav-folder spellbook-folder',
          selfCls: 'nav-folder-title',
          titleCls: 'nav-folder-title-content',
          title: node.name,
          ownText: true,
          counted: true,
          fold: { indexPath, key: foldKey.folder(id) },
          select: folderRef(id),
          menu: (context) => folderMenu(context, id),
        },
        around,
      );
      if (row.count) this.folderCounts.set(id, row.count);
      this.addBinderNodes(row.children ?? parent, node.children, [...around, ...foldsOf(row)], services, indexPath);
    }
  }

  private addResearchNodes(
    parent: HTMLElement,
    nodes: readonly ResearchNode[],
    around: readonly Fold[],
    services: BinderServices,
    indexPath: string,
  ): void {
    for (const node of nodes) {
      if (node.kind === 'note') {
        const path = node.path;
        this.addNoteRow(parent, path, node.title, false, around, services, (context) => researchMenu(context, path));
        continue;
      }
      const row = this.addRow(
        parent,
        {
          itemCls: 'nav-folder spellbook-folder',
          selfCls: 'nav-folder-title',
          titleCls: 'nav-folder-title-content',
          title: node.name,
          ownText: true,
          counted: false,
          fold: { indexPath, key: foldKey.research(node.path) },
        },
        around,
      );
      this.addResearchNodes(row.children ?? parent, node.children, [...around, ...foldsOf(row)], services, indexPath);
    }
  }

  /** A row for a note that exists: tapping it opens the note. */
  private addNoteRow(
    parent: HTMLElement,
    path: string,
    title: string,
    counted: boolean,
    around: readonly Fold[],
    services: BinderServices,
    menu: (context: MenuContext) => Menu,
  ): void {
    const ref = sceneRef(path);
    const row = this.addRow(
      parent,
      {
        itemCls: 'nav-file spellbook-note',
        selfCls: 'nav-file-title is-clickable',
        titleCls: 'nav-file-title-content',
        title,
        ownText: true,
        counted,
        select: ref,
        menu,
      },
      around,
    );
    row.self.addEventListener('click', (event) => {
      this.select(ref);
      this.openNote(path, Keymap.isModEvent(event));
    });
    // A click with the middle button (the wheel) opens a new tab, as elsewhere in Obsidian.
    row.self.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      this.openNote(path, 'tab');
    });

    const vaultPath = services.store.vaultPathOf(path);
    if (vaultPath === null) return;
    if (row.count) this.showCount(row.count, services.wordCounts.get(vaultPath));
    const rows = this.noteRows.get(vaultPath) ?? [];
    rows.push({ self: row.self, count: row.count, around });
    this.noteRows.set(vaultPath, rows);
  }

  /** A row for a binder entry whose note is not in the vault: greyed, with a warning. */
  private addMissingRow(parent: HTMLElement, path: string, title: string, around: readonly Fold[]): void {
    const ref = sceneRef(path);
    const row = this.addRow(
      parent,
      {
        itemCls: 'nav-file spellbook-note spellbook-is-missing',
        selfCls: 'nav-file-title',
        titleCls: 'nav-file-title-content',
        title,
        ownText: true,
        counted: false,
        select: ref,
        menu: (context) => missingMenu(context, path),
      },
      around,
    );
    row.self.setAttr('aria-disabled', 'true');
    row.slot.addClass('spellbook-missing-icon');
    row.slot.setAttr('aria-label', MISSING_LABEL);
    showIcon(row.slot, ...WARNING_ICON);
    row.main.createDiv({ cls: 'spellbook-row-note', text: MISSING_LABEL });
    // There is nothing to open, but a tap should not go unanswered.
    row.self.addEventListener('click', () => {
      this.select(ref);
      new Notice(`"${title}": ${MISSING_LABEL}.`);
    });
  }

  /**
   * Build one row with Obsidian's own tree classes (so that themes apply)
   * next to the plugin's (which the stylesheet lays the row out with).
   *
   * @param around what the row sits in, from the outside in: its section, then the folders
   */
  private addRow(parent: HTMLElement, options: RowOptions, around: readonly Fold[] = []): Row {
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

    const select = options.select;
    // Should a note have two rows (a research note that the binder also
    // lists), the first one drawn, the binder's, is the one that is selected.
    if (select && !this.rows.has(rowKey(select))) this.rows.set(rowKey(select), { self, around });

    let children: HTMLElement | null = null;
    let fold: Fold | null = null;
    if (options.fold) {
      const made: Fold = { item, self, slot, indexPath: options.fold.indexPath, key: options.fold.key };
      fold = made;
      self.addClass('mod-collapsible', 'is-clickable');
      slot.addClass('tree-item-icon', 'collapse-icon', 'spellbook-fold-icon');
      showIcon(slot, ...FOLD_ICON);
      children = item.createDiv({ cls: 'tree-item-children spellbook-children' });
      this.showFold(made, this.services?.prefs.isCollapsed(made.indexPath, made.key) === true);
      self.addEventListener('click', () => {
        const prefs = this.services?.prefs;
        if (!prefs) return;
        const next = !prefs.isCollapsed(made.indexPath, made.key);
        prefs.setCollapsed(made.indexPath, made.key, next);
        this.showFold(made, next);
        if (select) this.select(select);
      });
    }

    const menu = options.menu;
    if (menu) {
      // The "more" button comes last in the row, so it sits at the far end
      // from the fold arrow, whichever way Obsidian itself reads.
      const more = this.addButton(self, 'spellbook-row-more', MORE_LABEL, ROW_MORE_ICON, () => {
        const made = this.menuFor(menu, select);
        if (made) this.showMenuAt(made, more);
      });
      more.setAttr('aria-haspopup', 'menu');
      // A right-click (or, where the device sends one, a long press) opens the same menu.
      self.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        safely(MORE_LABEL, () => {
          this.menuFor(menu, select)?.showAtMouseEvent(event);
        });
      });
    } else if (count) {
      // A row with a count but no button (the Manuscript section) leaves the
      // button's room empty, so that its count lines up with those below it.
      self.createDiv({ cls: 'spellbook-row-more-space' });
    }
    return { item, self, slot, body, main, title, count, children, fold };
  }

  /**
   * Make a row's menu for the project as it is right now, and select the row
   * it belongs to. Null when the project the row was drawn for is no longer
   * the open one.
   */
  private menuFor(menu: (context: MenuContext) => Menu, select: NodeRef | undefined): Menu | null {
    const project = this.services?.store.project;
    if (!project || project.indexPath !== this.shownProject) return null;
    if (select) this.select(select);
    return menu({ actions: this.host.actions, project });
  }

  private showFold(fold: Fold, collapsed: boolean): void {
    fold.item.toggleClass('is-collapsed', collapsed);
    fold.slot.toggleClass('is-collapsed', collapsed);
    fold.self.setAttr('aria-expanded', collapsed ? 'false' : 'true');
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
    // The note the writer moved to is the row they are working with now.
    const project = this.services?.store.project;
    const ref = project ? this.activeRef(project) : null;
    if (ref && this.rows.has(rowKey(ref))) this.select(ref);
  }

  /** The note being worked on, as a row of `project`; null when it is not one of the project's notes. */
  private activeRef(project: ProjectSnapshot): NodeRef | null {
    if (this.activePath === null) return null;
    const path = relativeTo(project.folder, this.activePath);
    return path === null ? null : sceneRef(path);
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
      // The first thing around a row is its section, which is not marked.
      for (const folder of row.around.slice(1)) {
        folder.self.addClass('spellbook-has-active');
        this.marked.push(folder.self);
      }
    }
    const first = rows[0];
    if (reveal && first) this.scrollTo(first.self);
  }

  /**
   * Scroll the list, and only the list, so that a row can be seen. (The
   * browser's own "scroll into view" may also shift whatever the list sits
   * in, such as a phone's side drawer.)
   *
   * @returns false when it could not be done, because the row or the list
   *   has no height: the row is inside something folded shut, or the panel
   *   is hidden
   */
  private scrollTo(row: HTMLElement): boolean {
    const scroll = this.els?.scroll;
    if (!scroll) return false;
    const box = scroll.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (!(at.height > 0) || !(box.height > 0)) return false;
    if (at.top < box.top) scroll.scrollTop -= box.top - at.top;
    else if (at.bottom > box.bottom) scroll.scrollTop += at.bottom - box.bottom;
    return true;
  }

  // ------------------------------------------------------------- selected row

  /** Make a row of the project on show the selected one. */
  private select(ref: NodeRef): void {
    if (this.shownProject !== null) this.services?.selection.select(this.shownProject, ref);
  }

  private onSelection(): void {
    if (this.closed) return;
    // A drawing that is about to happen shows the selection itself, with
    // every row in its new place.
    if (this.renderTimer !== null) return;
    this.showSelection();
  }

  /**
   * Mark the selected row. When it was asked to be brought into view, unfold
   * what it sits in and scroll to it. A row that is not drawn yet is dealt
   * with by the next drawing; a list that cannot be measured yet (the panel
   * is hidden) is scrolled when it can be.
   */
  private showSelection(): void {
    const services = this.services;
    this.selectedRow?.removeClass('spellbook-is-selected');
    this.selectedRow = null;
    if (!services || this.shownProject === null) return;
    const ref = services.selection.currentIn(this.shownProject);
    const row = ref === null ? undefined : this.rows.get(rowKey(ref));
    if (!row) return;
    row.self.addClass('spellbook-is-selected');
    this.selectedRow = row.self;

    const wanted = services.selection.revealCount;
    if (wanted !== this.revealed) {
      this.revealed = wanted;
      for (const fold of row.around) {
        if (!services.prefs.isCollapsed(fold.indexPath, fold.key)) continue;
        services.prefs.setCollapsed(fold.indexPath, fold.key, false);
        this.showFold(fold, false);
      }
      this.scrollPending = !this.scrollTo(row.self);
    } else if (this.scrollPending) {
      this.scrollPending = !this.scrollTo(row.self);
    }
  }

  // ------------------------------------------------------------- opening notes

  private openNote(path: string, where: PaneType | boolean): void {
    if (this.shownProject === null) return;
    void this.host.actions.openNote(this.shownProject, path, where);
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

/** A row's own fold as a list: what to add to "around" for the rows nested in it. */
function foldsOf(row: Row): Fold[] {
  return row.fold ? [row.fold] : [];
}

/** A project's name in the list of projects; two with the same title also show their folders. */
function projectLabel(project: ProjectSummary, all: readonly ProjectSummary[]): string {
  const shared = all.some((other) => other.indexPath !== project.indexPath && other.title === project.title);
  if (!shared) return project.title;
  return `${project.title} (${project.folder === '' ? 'top of the vault' : project.folder})`;
}
