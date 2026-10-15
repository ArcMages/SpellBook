// The binder: the open project as a tree in the sidebar.
//
//   header   the project's name (a button that lists the projects when the
//            vault has more than one), and the toolbar: New scene, New folder
//            and a "more" menu
//   alerts   a notice that stays in view, for a conflicting copy of the
//            project's index
//   tree     Manuscript (the binder's scenes and folders), then Unfiled
//            (manuscript notes the binder does not list), then Research
//
// Everything it shows comes from the project store; it draws itself again
// whenever the store says something changed, keeping the scroll position,
// what was folded shut and where the keyboard was. Rows that are still
// wanted are used again as they are, so a change of order moves the rows and
// builds nothing. The panel itself changes nothing in the vault: its buttons,
// menus and drops hand over to the binder's actions
// (src/views/binderActions.ts), which go through the store.
//
// Every row that stands for something has a "more" button that opens its
// menu; a right-click opens the same menu. One row is the selected row: the
// one last tapped, opened or acted on (src/core/binderSelection.ts).
//
// Scenes and folders can be dragged to another place in the binder, and
// unfiled notes can be dragged into it (src/ui/dragDrop.ts does the
// dragging, src/core/dropTarget.ts works out the place).
//
// With the keyboard: Up and Down go from row to row, Left and Right fold and
// unfold (and step out of and into a folder), Enter opens. Only one row at a
// time is a stop for the Tab key, so a long binder is one stop, not hundreds.
//
// Text in any language: a title that is the writer's own text chooses its own
// direction, and only the title does. A Hebrew title reads right to left and
// sits against the word counts; the counts themselves stay in one column at
// the end of every row, whatever the language of the title next to them.
// Indents, fold arrows and "more" buttons follow the direction of Obsidian
// itself.

import { ItemView, Keymap, Menu, Notice, Platform } from 'obsidian';
import { followLayout } from '../ui/layout';
import { followWordCounts } from '../ui/wordFigures';
import type { PaneType, UserEvent, WorkspaceLeaf } from 'obsidian';
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
import { canDrop, placementKey, resolveDrop } from '../core/dropTarget';
import type { DropBounds, DropRow, DropSpot, ScreenPoint } from '../core/dropTarget';
import { baseName, noteTitle, relativeTo } from '../core/paths';
import type { ProjectSession } from '../core/projectSession';
import type { ProjectStore } from '../core/projectStore';
import type { NodeRef, ProjectSnapshot, ProjectSummary, TreeNode } from '../core/types';
import type { WordCountCache } from '../core/wordCountCache';
import { DragDrop } from '../ui/dragDrop';
import type { DragClock, DropHint, Picked } from '../ui/dragDrop';
import {
  ACTION_ICONS,
  BINDER_ICON,
  FOLD_ICON,
  ROW_MORE_ICON,
  SWITCH_ICON,
  TOOLBAR_MORE_ICON,
  WARNING_ICON,
  CHAPTER_ICON,
  iconName,
  showIcon,
} from '../ui/icons';
import { ownTextTitle } from '../ui/ownText';
import { safely } from '../ui/safely';
import { MISSING_LABEL } from './binderActions';
import { kindWord } from '../core/noteKind';

/** The binder's toolbar menu item that says what the project usually writes in. */
export function writesInMenuTitle(kind: 'scene' | 'chapter'): string {
  return kind === 'chapter' ? 'I usually write in chapters' : 'I usually write in scenes';
}

/** What the small mark of a chapter note says to a screen reader (and on hover). */
export const CHAPTER_MARK_LABEL = 'Chapter';
import type { BinderActions } from './binderActions';
import { folderMenu, missingMenu, researchMenu, sceneMenu, unfiledMenu } from './binderMenus';
import type { MenuContext } from './binderMenus';
import { PROBLEM_NOTICE_MS } from '../ui/notices';

export { MISSING_LABEL } from './binderActions';

export const BINDER_VIEW_TYPE = 'spellbook-binder';
export const BINDER_VIEW_NAME = 'Binder';

/** The name under which the binder asks for word counts (see WordCountCache.track). */
const WORD_COUNT_ASKER = 'binder';

/** What the "more" button of a row, and of the toolbar, is called (read out, and shown as a tooltip). */
export const MORE_LABEL = 'More options';

/** What the panel says when a conflicting copy of the project's index is found: for one copy, and for several. */
export const CONFLICT_MESSAGE = "A conflicting copy of this project's structure was found.";
export const CONFLICTS_MESSAGE = "Conflicting copies of this project's structure were found.";

/** The parts of the plugin the binder works with. They exist once Obsidian has finished starting up. */
export interface BinderServices {
  readonly store: ProjectStore;
  readonly session: ProjectSession;
  readonly wordCounts: WordCountCache;
  readonly prefs: DevicePrefs;
  readonly selection: BinderSelection;
  /** The timers that dragging runs on. */
  readonly clock: DragClock;
  /**
   * The conflicting copies the writer has waved away, by their vault paths.
   * Kept until Obsidian closes; never saved.
   */
  readonly dismissedCopies: Set<string>;
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
  readonly alerts: HTMLElement;
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
  /**
   * The project and the name its state is remembered under. The project's
   * path changes when its index note or its folder is renamed.
   */
  indexPath: string;
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

/** What a drag picks up. */
type Dragged =
  /** A scene or a folder of the binder. */
  | { readonly kind: 'node'; readonly ref: NodeRef; readonly title: string }
  /** A manuscript note the binder does not list. `path` is relative to the project folder. */
  | { readonly kind: 'unfiled'; readonly path: string; readonly title: string };

/** Where a row of the binder is in it: what a drop next to it refers to. */
interface TreePlace {
  readonly ref: NodeRef;
  /** The id of the folder the row sits in; null for the top level. */
  readonly parentId: string | null;
}

interface RowOptions {
  /**
   * A name for the row that stays the same from one drawing to the next:
   * what kind of row it is and what it stands for ("scene:<path>").
   */
  readonly id: string;
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
  /** What a tap on the row (or Enter) does, after any folding and selecting. */
  readonly tap?: (event: UserEvent) => void;
  /** What a click with the middle button (the wheel) does. */
  readonly middle?: () => void;
  /** Called once, when the row is built: for what only this kind of row has. */
  readonly dress?: (row: Row) => void;
  /** Set for a row that can be dragged: what a drag picks up. */
  readonly drag?: Dragged;
  /** Set for a row of the binder (a scene, a folder or a missing entry): where it is in it. */
  readonly place?: TreePlace;
}

/** A row as it was built. It is kept and used again for as long as the list shows it. */
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
  /** The row's "more" button, if it has one. */
  readonly more: HTMLElement | null;
  /** What a tap on the row does, and Enter while the keyboard is on it. */
  readonly activate: (event: UserEvent) => void;
}

/** A row in the list as it is drawn now: what the keyboard and a drag need to know about it. */
interface ShownRow {
  readonly id: string;
  /** Its place in the list, counted from the top (rows inside something folded shut are counted too). */
  readonly position: number;
  readonly row: Row;
  /** What the row sits in, from the outside in: its section, then the folders. */
  readonly around: readonly Fold[];
  readonly select: NodeRef | null;
  readonly drag: Dragged | null;
  readonly place: TreePlace | null;
}

/** Where the rows of the binder are while something is dragged over them. */
interface DropLayout {
  /** The rows that can be seen, top to bottom; heights are counted from the top of the list's contents. */
  readonly rows: readonly DropRow[];
  /** For each of those rows: the row itself, and where it starts and how wide it is in the window. */
  readonly places: ReadonlyArray<{ readonly row: ShownRow; readonly x: number; readonly width: number }>;
  readonly bounds: DropBounds;
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
  /** The same for the row of the note being worked on: it changed while the panel was hidden. */
  private activeScrollPending = false;

  /** The rows of the last drawing, by their names, to be used again in the next. */
  private built = new Map<string, Row>();
  /** While drawing: the rows of the drawing before that have not been used again yet. */
  private spare = new Map<string, Row>();
  /** Every row in the list, top to bottom. */
  private shown: ShownRow[] = [];
  private shownBySelf = new Map<HTMLElement, ShownRow>();
  private shownById = new Map<string, ShownRow>();
  /** The Manuscript section's own row, while a project that can be changed is on show. */
  private manuscript: Row | null = null;
  /** The one row the Tab key stops at: where the keyboard is, or was last. */
  private cursor: ShownRow | null = null;
  /** The name of that row, to find it again after the list was drawn anew. */
  private cursorId: string | null = null;
  /** What the alerts above the list were last drawn for. */
  private alertsFor = '';

  private drag: DragDrop<Dragged> | null = null;
  /** Where the rows are, while something is dragged. */
  private dropLayout: DropLayout | null = null;
  /** The last place a drop was checked for, and whether it would change anything. */
  private dropCheck: { readonly key: string; readonly ok: boolean } | null = null;

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
    this.activeScrollPending = false;
    this.alertsFor = '';
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-binder-pane');

    const root = pane.createDiv({ cls: 'spellbook-binder' });
    // Touch needs taller rows. The touch layout (src/ui/layout.ts) decides;
    // the stylesheet also covers touch screens on desktop.
    followLayout(this, root);
    // Word counts can be switched off on this device: the stylesheet then hides them.
    followWordCounts(this, root);
    // On a phone, Obsidian's own bar floats over the bottom of the drawer:
    // the stylesheet leaves room for it under the last row.
    root.toggleClass('spellbook-is-phone', Platform.isPhone);
    const header = root.createDiv({ cls: 'spellbook-binder-header' });
    const heading = header.createDiv({ cls: 'spellbook-binder-heading' });
    // The toolbar is laid out by the plugin's own stylesheet alone. It does
    // not borrow the class of Obsidian's own rows of buttons, so that no rule
    // Obsidian has for those rows (on phones, say) can move or hide this one.
    const toolbar = header.createDiv({ cls: 'spellbook-binder-toolbar' });
    const alerts = root.createDiv({ cls: 'spellbook-binder-alerts' });
    const scroll = root.createDiv({ cls: 'spellbook-binder-scroll' });
    const body = scroll.createDiv({ cls: 'spellbook-binder-body' });
    this.els = { root, heading, toolbar, alerts, scroll, body };

    // The keyboard: one listener for all the rows.
    body.addEventListener('keydown', (event) => {
      this.onKey(event);
    });
    // Wherever the keyboard goes in the list (with Tab, or by a click), that
    // row becomes the one the Tab key comes back to.
    body.addEventListener('focusin', (event) => {
      const found = this.rowAt(event.target);
      if (found) this.setCursor(found.shown);
    });

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
    // Ends a drag that is on, and takes its ghost and its listeners away.
    this.drag?.destroy();
    this.drag = null;
    // The binder is no longer looking at word counts. (Other screens may be: theirs are kept.)
    this.services?.wordCounts.release(WORD_COUNT_ASKER);
    this.services = null;
    this.forgetRows();
    this.built = new Map();
    this.spare = new Map();
    this.cursorId = null;
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
    const els = this.els;
    if (this.closed || this.services || !services || !els) return;
    this.services = services;
    // Only what is asked for from now on is scrolled to.
    this.revealed = services.selection.revealCount;
    this.drag = new DragDrop<Dragged>({
      container: els.scroll,
      scroller: els.scroll,
      clock: services.clock,
      pick: (target) => this.pickUp(target),
      ghost: (ghost, picked) => {
        ghost.createDiv({ cls: 'spellbook-drag-ghost-title', text: picked.data.title, attr: { dir: 'auto' } });
      },
      start: () => {
        this.dropCheck = null;
        this.measureForDrop();
      },
      hover: (picked, point) => this.hintAt(picked.data, point),
      drop: (picked, point) => {
        this.dropAt(picked.data, point);
      },
      end: () => {
        this.dropLayout = null;
        this.dropCheck = null;
      },
    });
    this.stops.push(
      // Both kinds of change matter: the open project is the tree, and the
      // list of projects decides whether the header offers a choice.
      services.store.onChange((change) => {
        if (change.type === 'project' && change.movedFrom !== undefined) this.projectMoved(change.movedFrom);
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
    // The panel may have been hidden when a row was to be scrolled to: the
    // row of the note being worked on first, then the selected row, which is
    // the one that must end up in view when they are not the same.
    if (this.activeScrollPending) this.revealActive();
    if (this.scrollPending) this.showSelection();
  }

  /**
   * The project on show is at another path now: its index note or its folder
   * was renamed or moved. It is still the same project, so the list keeps its
   * place, what is folded shut and its selected row; they are only known
   * under the new path from here on. (What this device remembers as folded
   * is moved over by the project session.)
   */
  private projectMoved(from: string): void {
    const to = this.services?.store.project?.indexPath ?? null;
    if (to === null || this.shownProject !== from) return;
    this.shownProject = to;
    for (const shown of this.shown) {
      if (shown.row.fold) shown.row.fold.indexPath = to;
    }
    this.services?.selection.moveProject(from, to);
  }

  // ------------------------------------------------------------------ drawing

  private render(): void {
    const els = this.els;
    if (!els || this.closed) return;
    // The rows are about to change places: a drag over them has lost its footing.
    this.drag?.cancel();
    const services = this.services;
    const project = services?.store.project ?? null;
    const sameProject = project !== null && project.indexPath === this.shownProject;
    // Keep the place in the list, unless this is another project.
    const scrollTop = sameProject ? els.scroll.scrollTop : 0;
    // Taking a row out of the list takes the keyboard away from it: remember where it was.
    const keyboardAt = this.keyboardPlace(els);
    this.shownProject = project?.indexPath ?? null;

    this.renderHeader(els.heading, services, project);
    this.renderToolbar(els.toolbar, services, project);
    this.renderAlerts(els.alerts, services, project);

    // The rows of the last drawing are used again where the list still has
    // them. They come back without the marks they carried.
    this.clearMarks();
    this.spare = sameProject ? this.built : new Map();
    this.built = new Map();
    els.body.empty();
    this.forgetRows();
    if (!services) {
      this.say(els.body, 'Spellbook is still starting...');
    } else if (!project) {
      this.renderNoProject(els.body, services);
    } else {
      this.renderProject(els.body, services, project);
    }
    this.spare = new Map();
    els.scroll.scrollTop = scrollTop;

    this.activePath = this.app.workspace.getActiveFile()?.path ?? null;
    this.markActive(!sameProject);
    this.showSelection();
    this.placeCursor(keyboardAt);
    this.trackCounts(services, project);
  }

  /** Take the marks of the active note, the selected row and the Tab stop off the rows that carry them. */
  private clearMarks(): void {
    for (const el of this.marked) el.removeClass('is-active', 'spellbook-has-active');
    this.marked = [];
    this.selectedRow?.removeClass('spellbook-is-selected');
    this.selectedRow = null;
    if (this.cursor) this.setTabStop(this.cursor, false);
    this.cursor = null;
  }

  private forgetRows(): void {
    this.noteRows = new Map();
    this.rows = new Map();
    this.folderCounts = new Map();
    this.manuscriptCount = null;
    this.marked = [];
    this.selectedRow = null;
    this.shown = [];
    this.shownBySelf = new Map();
    this.shownById = new Map();
    this.manuscript = null;
    this.cursor = null;
    this.dropLayout = null;
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
          // A project's title and its folder are the writer's own text.
          .setTitle(ownTextTitle(projectLabel(project, projects)))
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
      this.addButton(toolbar, 'spellbook-toolbar-button', `New ${kindWord(project.writesIn ?? 'scene')}`, ACTION_ICONS.newScene, () => {
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
      if (!project.readOnly) {
        // What "New ..." makes, and the kind new notes get.
        const usual = project.writesIn ?? 'scene';
        for (const kind of ['scene', 'chapter'] as const) {
          menu.addItem((item) => {
            const title = writesInMenuTitle(kind);
            item
              .setTitle(title)
              .setIcon(iconName(...(kind === 'chapter' ? ACTION_ICONS.treatAsChapter : ACTION_ICONS.newScene)))
              .setChecked(usual === kind)
              .onClick(() => {
                safely(title, () => this.host.actions.setWritesIn(project.indexPath, kind));
              });
          });
        }
        menu.addSeparator();
      }
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

  // ------------------------------------------------------------------- alerts

  /**
   * What stays in view above the list: a notice for each conflicting copy of
   * the project's index that the writer has not waved away, with a button to
   * merge it and one to hide the notice until Obsidian is next started.
   */
  private renderAlerts(alerts: HTMLElement, services: BinderServices | null, project: ProjectSnapshot | null): void {
    const copies =
      services && project ? project.conflicts.filter((path) => !services.dismissedCopies.has(path)) : [];
    // Drawn anew only when it says something else, so that a screen reader
    // does not read the same notice out again with every change of the list.
    const drawnFor = project && copies.length > 0 ? JSON.stringify([project.indexPath, project.readOnly, copies]) : '';
    if (drawnFor === this.alertsFor) return;
    this.alertsFor = drawnFor;
    alerts.empty();
    if (!services || !project || copies.length === 0) return;

    const banner = alerts.createDiv({
      cls: 'spellbook-binder-banner spellbook-conflict-banner',
      attr: { role: 'alert' },
    });
    showIcon(banner.createDiv({ cls: 'spellbook-binder-banner-icon' }), ...WARNING_ICON);
    const text = banner.createDiv({ cls: 'spellbook-binder-banner-text' });
    text.createDiv({
      cls: 'spellbook-binder-banner-title',
      text: copies.length === 1 ? CONFLICT_MESSAGE : CONFLICTS_MESSAGE,
    });
    for (const copy of copies) {
      // The copy's name starts with the project's, which is the writer's own text.
      text.createDiv({ cls: 'spellbook-binder-banner-file', text: baseName(copy), attr: { dir: 'auto' } });
    }
    // A project whose own index cannot be understood is never written, so there is nothing to merge into.
    if (!project.readOnly) {
      text.createDiv({
        cls: 'spellbook-binder-banner-hint',
        text:
          'Merge adds the scenes that only the copy lists to the end of the manuscript, ' +
          'then moves the copy to the trash. Nothing is removed or put in another order.',
      });
    }
    const buttons = text.createDiv({ cls: 'spellbook-binder-banner-buttons' });
    if (!project.readOnly) {
      const merge = buttons.createEl('button', {
        cls: 'mod-cta spellbook-banner-button',
        text: 'Merge',
        attr: { type: 'button' },
      });
      merge.addEventListener('click', () => {
        safely('Merge', () => this.host.actions.mergeCopies(project.indexPath, copies));
      });
    }
    const dismiss = buttons.createEl('button', {
      cls: 'spellbook-banner-button',
      text: 'Dismiss',
      attr: { type: 'button' },
    });
    dismiss.addEventListener('click', () => {
      for (const copy of copies) services.dismissedCopies.add(copy);
      this.renderAlerts(alerts, this.services, this.services?.store.project ?? null);
    });
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
        id: 'section:manuscript',
        itemCls: 'spellbook-section',
        selfCls: 'spellbook-section-self',
        titleCls: 'spellbook-section-title',
        title: 'Manuscript',
        ownText: false,
        counted: true,
        fold: { indexPath, key: foldKey.section('manuscript') },
      });
      this.manuscript = manuscript;
      this.manuscriptCount = manuscript.count;
      if (project.tree.length === 0) {
        this.say(manuscript.children ?? body, `No ${kindWord(project.writesIn ?? 'scene', 2)} yet.`, 'spellbook-binder-message spellbook-binder-hint');
      }
      this.addBinderNodes(manuscript.children ?? body, project.tree, foldsOf(manuscript), services, indexPath, null);
    }

    if (project.unfiled.length > 0) {
      const unfiled = this.addRow(body, {
        id: 'section:unfiled',
        itemCls: 'spellbook-section',
        selfCls: 'spellbook-section-self',
        titleCls: 'spellbook-section-title',
        title: 'Unfiled',
        ownText: false,
        counted: false,
        fold: { indexPath, key: foldKey.section('unfiled') },
      });
      for (const path of project.unfiled) {
        const title = noteTitle(path);
        this.addNoteRow(unfiled.children ?? body, foldsOf(unfiled), services, {
          id: `unfiled:${path}`,
          path,
          title,
          counted: true,
          menu: (context) => unfiledMenu(context, path),
          drag: { kind: 'unfiled', path, title },
        });
      }
    }

    const research = this.addRow(body, {
      id: 'section:research',
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
    parentId: string | null,
  ): void {
    for (const node of nodes) {
      if (node.kind === 'scene') {
        const path = node.path;
        const place: TreePlace = { ref: sceneRef(path), parentId };
        if (node.missing) {
          this.addMissingRow(parent, path, node.title, around, place);
        } else {
          this.addNoteRow(parent, around, services, {
            id: `scene:${path}`,
            path,
            title: node.title,
            counted: true,
            menu: (context) => sceneMenu(context, path),
            drag: { kind: 'node', ref: sceneRef(path), title: node.title },
            place,
            chapter: node.chapter === true,
          });
        }
        continue;
      }
      const id = node.id;
      const row = this.addRow(
        parent,
        {
          id: `folder:${id}`,
          itemCls: 'nav-folder spellbook-folder',
          selfCls: 'nav-folder-title',
          titleCls: 'nav-folder-title-content',
          title: node.name,
          ownText: true,
          counted: true,
          fold: { indexPath, key: foldKey.folder(id) },
          select: folderRef(id),
          menu: (context) => folderMenu(context, id),
          drag: { kind: 'node', ref: folderRef(id), title: node.name },
          place: { ref: folderRef(id), parentId },
        },
        around,
      );
      if (row.count) this.folderCounts.set(id, row.count);
      this.addBinderNodes(row.children ?? parent, node.children, [...around, ...foldsOf(row)], services, indexPath, id);
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
        this.addNoteRow(parent, around, services, {
          id: `research:${path}`,
          path,
          title: node.title,
          counted: false,
          menu: (context) => researchMenu(context, path),
        });
        continue;
      }
      const row = this.addRow(
        parent,
        {
          id: `research-folder:${node.path}`,
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
    around: readonly Fold[],
    services: BinderServices,
    note: {
      readonly id: string;
      /** The note's path relative to the project folder. */
      readonly path: string;
      readonly title: string;
      readonly counted: boolean;
      readonly menu: (context: MenuContext) => Menu;
      readonly drag?: Dragged;
      readonly place?: TreePlace;
      /** True for a note that is a whole chapter: it gets a small mark. */
      readonly chapter?: boolean;
    },
  ): void {
    const path = note.path;
    const row = this.addRow(
      parent,
      {
        id: note.id,
        itemCls: 'nav-file spellbook-note',
        selfCls: 'nav-file-title is-clickable',
        titleCls: 'nav-file-title-content',
        title: note.title,
        ownText: true,
        counted: note.counted,
        select: sceneRef(path),
        menu: note.menu,
        tap: (event) => {
          this.openNote(path, Keymap.isModEvent(event));
        },
        // A click with the middle button (the wheel) opens a new tab, as elsewhere in Obsidian.
        middle: () => {
          this.openNote(path, 'tab');
        },
        drag: note.drag,
        place: note.place,
      },
      around,
    );
    this.markChapter(row, note.chapter === true);

    const vaultPath = services.store.vaultPathOf(path);
    if (vaultPath === null) return;
    if (row.count) this.showCount(row.count, services.wordCounts.get(vaultPath));
    const rows = this.noteRows.get(vaultPath) ?? [];
    rows.push({ self: row.self, count: row.count, around });
    this.noteRows.set(vaultPath, rows);
  }

  /**
   * Show (or take away) the small mark of a note that is a whole chapter, in
   * the space at the start of its row. Rows are used again from one drawing
   * to the next, so this is set every time.
   */
  private markChapter(row: Row, chapter: boolean): void {
    if (row.self.hasClass('spellbook-is-chapter') === chapter) return;
    row.self.toggleClass('spellbook-is-chapter', chapter);
    row.slot.toggleClass('spellbook-chapter-mark', chapter);
    row.slot.empty();
    row.slot.setAttr('aria-label', chapter ? CHAPTER_MARK_LABEL : null);
    if (chapter) showIcon(row.slot, ...CHAPTER_ICON);
  }

  /** A row for a binder entry whose note is not in the vault: greyed, with a warning. */
  private addMissingRow(
    parent: HTMLElement,
    path: string,
    title: string,
    around: readonly Fold[],
    place: TreePlace,
  ): void {
    this.addRow(
      parent,
      {
        id: `missing:${path}`,
        itemCls: 'nav-file spellbook-note spellbook-is-missing',
        selfCls: 'nav-file-title',
        titleCls: 'nav-file-title-content',
        title,
        ownText: true,
        counted: false,
        select: sceneRef(path),
        menu: (context) => missingMenu(context, path),
        // There is nothing to open, but a tap should not go unanswered.
        tap: () => {
          new Notice(`"${title}": ${MISSING_LABEL}.`);
        },
        dress: (row) => {
          row.self.setAttr('aria-disabled', 'true');
          row.slot.addClass('spellbook-missing-icon');
          row.slot.setAttr('aria-label', MISSING_LABEL);
          showIcon(row.slot, ...WARNING_ICON);
          row.main.createDiv({ cls: 'spellbook-row-note', text: MISSING_LABEL });
        },
        // It cannot be dragged, but other rows can be dropped next to it.
        place,
      },
      around,
    );
  }

  /**
   * Put a row into the list: the one the last drawing built for the same
   * thing when there is one, a new one otherwise.
   *
   * @param around what the row sits in, from the outside in: its section, then the folders
   */
  private addRow(parent: HTMLElement, options: RowOptions, around: readonly Fold[] = []): Row {
    // The title is part of the name: a folder that was renamed gets a new row.
    const name = `${options.id}\n${options.title}`;
    let row = this.spare.get(name);
    if (row) {
      this.spare.delete(name);
      // What was nested in it is put back, or not, by whoever asked for this row.
      row.children?.empty();
      parent.appendChild(row.item);
    } else {
      row = this.buildRow(parent, options);
    }
    if (!this.built.has(name)) this.built.set(name, row);

    const select = options.select ?? null;
    // Should a note have two rows (a research note that the binder also
    // lists), the first one drawn, the binder's, is the one that is selected.
    if (select && !this.rows.has(rowKey(select))) this.rows.set(rowKey(select), { self: row.self, around });
    if (row.fold) this.showFold(row.fold, this.services?.prefs.isCollapsed(row.fold.indexPath, row.fold.key) === true);

    const shown: ShownRow = {
      id: options.id,
      position: this.shown.length,
      row,
      around,
      select,
      drag: options.drag ?? null,
      place: options.place ?? null,
    };
    this.shown.push(shown);
    this.shownBySelf.set(row.self, shown);
    if (!this.shownById.has(options.id)) this.shownById.set(options.id, shown);
    return row;
  }

  /**
   * Build one row with Obsidian's own tree classes (so that themes apply)
   * next to the plugin's (which the stylesheet lays the row out with).
   */
  private buildRow(parent: HTMLElement, options: RowOptions): Row {
    const item = parent.createDiv({ cls: `tree-item spellbook-row ${options.itemCls}` });
    const self = item.createDiv({
      cls: `tree-item-self spellbook-row-self ${options.selfCls}`,
      // The keyboard can be put on a row, but only one row at a time is a
      // stop for the Tab key (see setCursor).
      attr: { tabindex: -1 },
    });
    const slot = self.createDiv({ cls: 'spellbook-row-slot' });
    const main = self.createDiv({ cls: 'spellbook-row-main' });
    const body = main.createDiv({ cls: 'spellbook-row-body' });
    const title = body.createDiv({
      cls: `tree-item-inner spellbook-title ${options.titleCls}`,
      text: options.title,
    });
    // Only the title takes the direction of its own text. The row around it
    // keeps the direction of the app, so every count stays in one column at
    // the end of the row: see the top of this file.
    if (options.ownText) title.setAttr('dir', 'auto');

    let count: CountSpot | null = null;
    if (options.counted) {
      // Numbers read left to right in every language.
      const outer = body.createDiv({ cls: 'tree-item-flair-outer spellbook-count-outer', attr: { dir: 'ltr' } });
      count = { el: outer.createSpan({ cls: 'tree-item-flair spellbook-count' }), shown: '' };
    }

    const select = options.select;
    let children: HTMLElement | null = null;
    let fold: Fold | null = null;
    if (options.fold) {
      fold = { item, self, slot, indexPath: options.fold.indexPath, key: options.fold.key };
      self.addClass('mod-collapsible', 'is-clickable');
      slot.addClass('tree-item-icon', 'collapse-icon', 'spellbook-fold-icon');
      showIcon(slot, ...FOLD_ICON);
      children = item.createDiv({ cls: 'tree-item-children spellbook-children' });
    }

    const made = fold;
    const activate = (event: UserEvent): void => {
      if (made) {
        const prefs = this.services?.prefs;
        if (!prefs) return;
        this.setFold(made, !prefs.isCollapsed(made.indexPath, made.key));
      }
      if (select) this.select(select);
      options.tap?.(event);
    };
    if (made || select || options.tap) {
      self.addEventListener('click', (event) => {
        activate(event);
      });
    }
    const middle = options.middle;
    if (middle) {
      self.addEventListener('auxclick', (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        middle();
      });
    }

    const menu = options.menu;
    let more: HTMLElement | null = null;
    if (menu) {
      // The "more" button comes last in the row, so it sits at the far end
      // from the fold arrow, whichever way Obsidian itself reads.
      const button = this.addButton(self, 'spellbook-row-more', MORE_LABEL, ROW_MORE_ICON, () => {
        const shown = this.menuFor(menu, select);
        if (shown) this.showMenuAt(shown, button);
      });
      button.setAttr('aria-haspopup', 'menu');
      // Reached with Tab from its own row, while the keyboard is on that row.
      button.setAttr('tabindex', -1);
      more = button;
      // A right-click opens the same menu.
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

    const row: Row = { item, self, slot, body, main, title, count, children, fold, more, activate };
    options.dress?.(row);
    return row;
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

  // ------------------------------------------------------------------ folding

  private showFold(fold: Fold, collapsed: boolean): void {
    fold.item.toggleClass('is-collapsed', collapsed);
    fold.slot.toggleClass('is-collapsed', collapsed);
    fold.self.setAttr('aria-expanded', collapsed ? 'false' : 'true');
  }

  private isFolded(fold: Fold): boolean {
    return fold.item.hasClass('is-collapsed');
  }

  /** Fold something shut or open it, and remember that on this device. Nothing is drawn again. */
  private setFold(fold: Fold, collapsed: boolean): void {
    const prefs = this.services?.prefs;
    if (!prefs) return;
    prefs.setCollapsed(fold.indexPath, fold.key, collapsed);
    this.showFold(fold, collapsed);
    // A row that is folded away cannot be where the Tab key stops.
    if (collapsed && this.cursor?.around.includes(fold)) {
      const own = this.shownBySelf.get(fold.self);
      if (own) this.setCursor(own);
    }
  }

  /** True for a row inside something that is folded shut. */
  private isHidden(shown: ShownRow): boolean {
    return shown.around.some((fold) => this.isFolded(fold));
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
    services.wordCounts.track(WORD_COUNT_ASKER, wanted);
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
    if (reveal) this.revealActive();
  }

  /**
   * Scroll to the row of the note being worked on. When the panel is hidden
   * (its sidebar is closed, or another tab is in front of it) nothing can be
   * measured: the scrolling is then done as soon as the panel can be.
   */
  private revealActive(): void {
    const first = this.activePath === null ? undefined : this.noteRows.get(this.activePath)?.[0];
    this.activeScrollPending = first !== undefined && !this.scrollTo(first.self) && this.listHidden();
  }

  /** True when the list has no height at all: the panel is not on the screen. */
  private listHidden(): boolean {
    const scroll = this.els?.scroll;
    return !scroll || !(scroll.getBoundingClientRect().height > 0);
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
    // The selected row is where the Tab key comes into the list.
    const shown = this.shownBySelf.get(row.self);
    if (shown) this.setCursor(shown);
  }

  // ----------------------------------------------------------------- keyboard

  /**
   * The row an element belongs to: the row itself, or the row around it.
   * `onButton` tells whether the element is the row's "more" button (or
   * something in it).
   */
  private rowAt(target: EventTarget | null): { shown: ShownRow; onButton: boolean } | null {
    const stop = this.els?.body ?? null;
    for (let at = target as HTMLElement | null; at && at !== stop; at = at.parentElement) {
      const shown = this.shownBySelf.get(at);
      if (shown) return { shown, onButton: shown.row.more?.contains(target as Node) === true };
    }
    return null;
  }

  private setTabStop(shown: ShownRow, on: boolean): void {
    shown.row.self.setAttr('tabindex', on ? 0 : -1);
    shown.row.more?.setAttr('tabindex', on ? 0 : -1);
  }

  /**
   * Make a row the one the Tab key stops at (together with its "more"
   * button). A row inside something folded shut cannot be reached, so the
   * folder that hides it stands in for it.
   */
  private setCursor(wanted: ShownRow): void {
    let shown = wanted;
    for (const fold of wanted.around) {
      if (!this.isFolded(fold)) continue;
      shown = this.shownBySelf.get(fold.self) ?? wanted;
      break;
    }
    if (this.cursor === shown) return;
    if (this.cursor) this.setTabStop(this.cursor, false);
    this.cursor = shown;
    this.cursorId = shown.id;
    this.setTabStop(shown, true);
  }

  /** Where the keyboard is in the list, if it is in it: the row, and whether it is on the row's button. */
  private keyboardPlace(els: Elements): { id: string; onButton: boolean } | null {
    const active = els.body.ownerDocument.activeElement;
    if (!active || !els.body.contains(active)) return null;
    const found = this.rowAt(active);
    return found ? { id: found.shown.id, onButton: found.onButton } : null;
  }

  /**
   * After a drawing: give the Tab key a row to stop at, and put the keyboard
   * back on the row it was on before the list was taken apart.
   */
  private placeCursor(keyboardAt: { id: string; onButton: boolean } | null): void {
    if (!this.cursor) {
      const again = this.cursorId === null ? undefined : this.shownById.get(this.cursorId);
      const first = again ?? this.shown[0];
      if (first) this.setCursor(first);
    }
    if (!keyboardAt) return;
    const back = this.shownById.get(keyboardAt.id);
    if (!back || this.isHidden(back)) return;
    const element = keyboardAt.onButton ? (back.row.more ?? back.row.self) : back.row.self;
    // Without scrolling: the list is put back where it was by the drawing itself.
    element.focus({ preventScroll: true });
  }

  /** Put the keyboard on a row: it becomes the selected row and is scrolled into view. */
  private focusRow(shown: ShownRow): void {
    this.setCursor(shown);
    shown.row.self.focus({ preventScroll: true });
    this.scrollTo(shown.row.self);
    if (shown.select) this.select(shown.select);
  }

  /** True when Obsidian itself reads from right to left, so that "forward" is the Left key. */
  private readsRightToLeft(): boolean {
    const root = this.els?.root;
    if (!root) return false;
    return root.ownerDocument.defaultView?.getComputedStyle(root).direction === 'rtl';
  }

  /**
   * A key was pressed while the keyboard was in the list. Up and Down go to
   * the next row that can be seen; the arrow that points "forward" unfolds a
   * row or steps into it, the one that points "back" folds it or steps out
   * to the folder around it; Enter does what a tap does (with Cmd or Ctrl: a
   * scene opens in a new tab).
   */
  private onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.shiftKey) return;
    const found = this.rowAt(event.target);
    if (!found) return;
    const { shown, onButton } = found;
    const mod = event.ctrlKey || event.metaKey;

    if (event.key === 'Enter') {
      // On the "more" button, Enter is the button's.
      if (onButton) return;
      event.preventDefault();
      shown.row.activate(event);
      return;
    }
    if (mod) return;
    switch (event.key) {
      case 'ArrowDown':
        this.stepFrom(shown, 1);
        break;
      case 'ArrowUp':
        this.stepFrom(shown, -1);
        break;
      case 'ArrowRight':
      case 'ArrowLeft': {
        const forward = (event.key === 'ArrowRight') !== this.readsRightToLeft();
        if (forward) this.unfoldOrStepIn(shown);
        else this.foldOrStepOut(shown);
        break;
      }
      default:
        return;
    }
    // The arrows move within the list; they must not also scroll it.
    event.preventDefault();
  }

  /** Go to the next row above or below that is not folded away. */
  private stepFrom(from: ShownRow, step: 1 | -1): void {
    for (let at = from.position + step; at >= 0 && at < this.shown.length; at += step) {
      const next = this.shown[at];
      if (!next || this.isHidden(next)) continue;
      this.focusRow(next);
      return;
    }
  }

  private unfoldOrStepIn(shown: ShownRow): void {
    const fold = shown.row.fold;
    if (!fold) return;
    if (this.isFolded(fold)) {
      this.setFold(fold, false);
      return;
    }
    const next = this.shown[shown.position + 1];
    if (next?.around.includes(fold)) this.focusRow(next);
  }

  private foldOrStepOut(shown: ShownRow): void {
    const fold = shown.row.fold;
    if (fold && !this.isFolded(fold)) {
      this.setFold(fold, true);
      return;
    }
    const around = shown.around[shown.around.length - 1];
    const parent = around ? this.shownBySelf.get(around.self) : undefined;
    if (parent) this.focusRow(parent);
  }

  // ----------------------------------------------------------------- dragging

  /** What a press on something in the list would pick up, if anything. */
  private pickUp(target: EventTarget | null): Picked<Dragged> | null {
    const project = this.services?.store.project;
    // Nothing can be moved in a project that cannot be changed.
    if (!project || project.readOnly || project.indexPath !== this.shownProject) return null;
    const found = this.rowAt(target);
    // A press on the "more" button is for the button.
    if (!found || found.onButton || !found.shown.drag) return null;
    return { el: found.shown.row.self, data: found.shown.drag };
  }

  /**
   * Measure where the rows of the binder are, once for a whole drag. Heights
   * are kept as they are within the list's contents, so they stay right
   * while the list scrolls; they are only measured again when a folder
   * opens under the pointer.
   */
  private measureForDrop(): void {
    const els = this.els;
    const manuscript = this.manuscript;
    this.dropLayout = null;
    if (!els || !manuscript) return;
    const box = els.scroll.getBoundingClientRect();
    // What to add to a height in the window to get the height in the list's contents.
    const scrolled = els.scroll.scrollTop - box.top;
    const rows: DropRow[] = [];
    const places: Array<{ row: ShownRow; x: number; width: number }> = [];
    let bottom = Number.NEGATIVE_INFINITY;
    for (const shown of this.shown) {
      if (!shown.place || this.isHidden(shown)) continue;
      const at = shown.row.self.getBoundingClientRect();
      if (!(at.height > 0)) continue;
      rows.push({
        ref: shown.place.ref,
        parentId: shown.place.parentId,
        top: at.top + scrolled,
        bottom: at.bottom + scrolled,
      });
      places.push({ row: shown, x: at.left, width: at.width });
      bottom = Math.max(bottom, at.bottom);
    }
    const head = manuscript.self.getBoundingClientRect();
    const whole = manuscript.item.getBoundingClientRect();
    // The panel is hidden: there is nothing to drop on.
    if (!(head.height > 0)) return;
    this.dropLayout = {
      rows,
      places,
      bounds: {
        top: head.top + scrolled,
        // A little below the last row still counts, as "the end of the manuscript".
        bottom: Math.max(bottom, whole.bottom, head.bottom) + scrolled + head.height / 2,
      },
    };
  }

  /**
   * Where a drop at a place on the screen would land, if it would change
   * anything. Also gives the edges of what can be seen of the list, and what
   * to add to a height in the window to get the height in the list's contents.
   */
  private spotAt(
    dragged: Dragged,
    point: ScreenPoint,
  ): { spot: DropSpot; top: number; bottom: number; scrolled: number } | null {
    const els = this.els;
    const layout = this.dropLayout;
    const project = this.services?.store.project;
    if (!els || !layout || !project || project.readOnly || project.indexPath !== this.shownProject) return null;
    const box = els.scroll.getBoundingClientRect();
    // Beside the list, or above or below what can be seen of it, is nowhere.
    if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) return null;
    const scrolled = els.scroll.scrollTop - box.top;
    const spot = resolveDrop(layout.rows, point.y + scrolled, layout.bounds);
    if (!spot) return null;
    if (dragged.kind === 'node') {
      // Asked again and again while the pointer rests on one place: remember the answer.
      const key = placementKey(spot.placement);
      if (this.dropCheck?.key !== key) {
        this.dropCheck = { key, ok: canDrop(project.tree, dragged.ref, spot.placement) };
      }
      if (!this.dropCheck.ok) return null;
    }
    return { spot, top: box.top, bottom: box.bottom, scrolled };
  }

  /** What to show for the place the pointer is at while something is dragged. */
  private hintAt(dragged: Dragged, point: ScreenPoint): DropHint | null {
    const layout = this.dropLayout;
    const manuscript = this.manuscript;
    const found = this.spotAt(dragged, point);
    if (!found || !layout || !manuscript) return null;
    const { spot } = found;
    const mark = spot.mark;

    let line: DropHint['line'] = null;
    let into: HTMLElement | null = null;
    if (mark.kind === 'line') {
      const like = layout.places[mark.alignWith];
      // Kept within what can be seen of the list: the edge of a row that is half out of view is not.
      const y = Math.max(found.top, Math.min(found.bottom, mark.y - found.scrolled));
      if (like) line = { x: like.x, y, width: like.width };
    } else if (mark.kind === 'into') {
      into = layout.places[mark.row]?.row.row.self ?? null;
    } else {
      into = manuscript.self;
    }

    // Something folded shut under the pointer opens when the pointer stays on it.
    const under = spot.over >= 0 ? layout.places[spot.over]?.row.row.fold : mark.kind === 'tree' ? manuscript.fold : null;
    const spring =
      under && this.isFolded(under)
        ? {
            key: under.key,
            open: (): void => {
              this.setFold(under, false);
              this.measureForDrop();
            },
          }
        : null;
    return { line, into, spring };
  }

  /** Something was dropped: hand it to the one action that fits. */
  private dropAt(dragged: Dragged, point: ScreenPoint): void {
    const found = this.spotAt(dragged, point);
    const at = this.shownProject;
    if (!found || at === null) return;
    const placement = found.spot.placement;
    safely('Moving', () =>
      dragged.kind === 'unfiled'
        ? this.host.actions.fileUnfiledAt(at, dragged.path, placement)
        : this.host.actions.moveTo(at, dragged.ref, placement),
    );
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
