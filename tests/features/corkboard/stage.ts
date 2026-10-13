// A stage for testing the corkboard, the inspector and the statuses-and-labels
// window: a fake host (the plugin, as far as these screens know it), timers
// under the test's control, the views opened the way Obsidian opens them, and
// ways to read and tap what they put on the stand-in screen
// (tests/obsidianStub.ts).

import type { App, WorkspaceLeaf } from 'obsidian';
import { applyFrontmatterPatch, readTagLists } from '../../../src/core/cards';
import type {
  CardMove,
  CardSize,
  FrontmatterPatch,
  SceneData,
  SceneProperties,
} from '../../../src/core/cards';
import type { Frontmatter, NodeRef, Placement, TreeNode } from '../../../src/core/types';
import { CorkboardView } from '../../../src/features/corkboard/corkboardView';
import type {
  CardsChange,
  CardsProject,
  CorkboardHost,
  InspectorHost,
  TagListChange,
} from '../../../src/features/corkboard/host';
import { InspectorView } from '../../../src/features/corkboard/inspectorView';
import type { DragClock } from '../../../src/ui/dragDrop';
import { ManualTimers } from '../../memoryVault';
import {
  ItemView as StubItemView,
  Menu as StubMenu,
  Modal as StubModal,
  Notice as StubNotice,
  resetFakeDocument,
} from '../../obsidianStub';
import type { ButtonComponent, FakeElement } from '../../obsidianStub';
import { tick } from '../../storeHarness';

// Obsidian remembers a view's state through getState and setState. The shared
// stand-in for ItemView has neither, so they are added here, for these tests
// only (every test file gets its own copy of the stand-in).
const viewBase = StubItemView.prototype as unknown as {
  getState?: () => Record<string, unknown>;
  setState?: (state: unknown, result: unknown) => Promise<void>;
};
viewBase.getState ??= () => ({});
viewBase.setState ??= async () => {};

/** How long one frame of the test's own clock lasts, in milliseconds. */
export const FRAME_MS = 16;

function matches(node: TreeNode, ref: NodeRef): boolean {
  return node.kind === 'scene' ? ref.kind === 'scene' && ref.path === node.path : ref.kind === 'folder' && ref.id === node.id;
}

function without(nodes: readonly TreeNode[], ref: NodeRef): { nodes: TreeNode[]; taken: TreeNode | null } {
  let taken: TreeNode | null = null;
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (matches(node, ref)) {
      taken = node;
    } else if (node.kind === 'folder') {
      const inner = without(node.children, ref);
      taken = inner.taken ?? taken;
      out.push({ ...node, children: inner.nodes });
    } else {
      out.push(node);
    }
  }
  return { nodes: out, taken };
}

function insert(nodes: readonly TreeNode[], node: TreeNode, placement: Placement, parentId: string | null): TreeNode[] {
  const out = nodes.map((child): TreeNode =>
    child.kind === 'folder' ? { ...child, children: insert(child.children, node, placement, child.id) } : child,
  );
  if (placement.at === 'start') return placement.parentId === parentId ? [node, ...out] : out;
  if (placement.at === 'end') return placement.parentId === parentId ? [...out, node] : out;
  const at = out.findIndex((child) => matches(child, placement.sibling));
  if (at >= 0) out.splice(placement.at === 'before' ? at : at + 1, 0, node);
  return out;
}

/** Move a node of a binder tree the way the project store's moveNode does. */
export function moveInTree(tree: readonly TreeNode[], move: CardMove): TreeNode[] {
  const { nodes, taken } = without(tree, move.ref);
  return taken ? insert(nodes, taken, move.placement, null) : [...tree];
}

function scenePaths(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === 'scene' ? [node.path] : scenePaths(node.children)));
}

/** The plugin, as far as the corkboard, the inspector and the statuses-and-labels window know it. */
export class FakeHost implements CorkboardHost, InspectorHost {
  ready = true;
  project: CardsProject | null = null;
  activeScenePath: string | null = null;
  cardSize: CardSize = 'medium';
  readonly timers = new ManualTimers();
  readonly clock: DragClock;
  /** What is known about each scene, by its path. */
  readonly scenes = new Map<string, SceneData>();
  /** The project index's properties, which hold the two lists. */
  index: Frontmatter = {};

  /** Everything that was asked of the host, in order. */
  readonly opened: Array<{ path: string; where: unknown }> = [];
  readonly moves: CardMove[] = [];
  readonly patches: Array<{ path: string; patch: FrontmatterPatch }> = [];
  readonly saved: TagListChange[] = [];
  readonly sizes: CardSize[] = [];
  readonly watched: string[][] = [];
  /** How often each scene's data was asked for. */
  readonly asked = new Map<string, number>();
  /** The element handed to mountSummary, and how often what it returned was called. */
  summarySlot: FakeElement | null = null;
  summaryUnmounts = 0;

  /** Set to make the host answer every request for a change with this sentence, and change nothing. */
  refusal: string | null = null;
  /** False: a change that is asked for is noted and answered, but not carried out. */
  obedient = true;

  private readonly listeners = new Set<(change: CardsChange) => void>();

  constructor() {
    let frameTime = 0;
    this.clock = {
      setTimer: this.timers.set,
      nextFrame: (callback) =>
        this.timers.set(() => {
          frameTime += FRAME_MS;
          callback(frameTime);
        }, FRAME_MS),
    };
  }

  // --- what a test does to the host

  get listenerCount(): number {
    return this.listeners.size;
  }

  emit(change: CardsChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  /** Open a project (or another one). */
  open(tree: readonly TreeNode[], index: Frontmatter = {}, options: { id?: string; readOnly?: boolean } = {}): void {
    this.index = index;
    this.project = {
      id: options.id ?? 'Novel/Novel.md',
      readOnly: options.readOnly ?? false,
      tree,
      lists: readTagLists(index),
    };
    this.emit({ type: 'project' });
  }

  setTree(tree: readonly TreeNode[]): void {
    if (!this.project) throw new Error('no project is open');
    this.project = { ...this.project, tree };
    this.emit({ type: 'project' });
  }

  /** Replace what is known about a scene, and say so. */
  setScene(path: string, data: SceneData): void {
    this.scenes.set(path, data);
    this.emit({ type: 'scenes', paths: [path] });
  }

  setActive(path: string | null): void {
    this.activeScenePath = path;
    this.emit({ type: 'active' });
  }

  frontmatterOf(path: string): Readonly<Frontmatter> | null {
    return this.scenes.get(path)?.frontmatter ?? null;
  }

  // --- what the screens ask of the host

  sceneData(path: string): SceneData | undefined {
    this.asked.set(path, (this.asked.get(path) ?? 0) + 1);
    return this.scenes.get(path);
  }

  sceneProperties(): SceneProperties[] {
    return scenePaths(this.project?.tree ?? []).map((path) => ({ path, frontmatter: this.frontmatterOf(path) }));
  }

  onChange(listener: (change: CardsChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private write(path: string, patch: FrontmatterPatch): void {
    const frontmatter: Frontmatter = { ...(this.frontmatterOf(path) ?? {}) };
    applyFrontmatterPatch(frontmatter, patch);
    this.scenes.set(path, { ...this.scenes.get(path), frontmatter });
  }

  async applyScenePatch(path: string, patch: FrontmatterPatch): Promise<string | null> {
    this.patches.push({ path, patch });
    if (this.refusal !== null) return this.refusal;
    if (!this.obedient) return null;
    this.write(path, patch);
    this.emit({ type: 'scenes', paths: [path] });
    return null;
  }

  async saveTagList(change: TagListChange): Promise<string | null> {
    this.saved.push(change);
    if (this.refusal !== null) return this.refusal;
    if (!this.obedient || !this.project) return null;
    this.index = { ...this.index, [change.key]: [...change.value] };
    this.project = { ...this.project, lists: readTagLists(this.index) };
    for (const { path, patch } of change.scenePatches) this.write(path, patch);
    this.emit({ type: 'project' });
    if (change.scenePatches.length > 0) {
      this.emit({ type: 'scenes', paths: change.scenePatches.map((entry) => entry.path) });
    }
    return null;
  }

  setCardSize(size: CardSize): void {
    this.cardSize = size;
    this.sizes.push(size);
    this.emit({ type: 'cardSize' });
  }

  openScene(path: string, where: unknown): void {
    this.opened.push({ path, where });
  }

  async moveCard(move: CardMove): Promise<string | null> {
    this.moves.push(move);
    if (this.refusal !== null) return this.refusal;
    if (!this.obedient || !this.project) return null;
    this.setTree(moveInTree(this.project.tree, move));
    return null;
  }

  watchScenes(_watcher: object, paths: readonly string[]): void {
    this.watched.push([...paths]);
  }

  mountSummary(slot: HTMLElement): () => void {
    this.summarySlot = slot as unknown as FakeElement;
    return () => {
      this.summaryUnmounts++;
    };
  }
}

/** Obsidian, as far as the views ask it: a place to say that the workspace's layout should be saved. */
export class FakeWorkbench {
  /** How often the views asked for the layout to be saved. */
  layoutSaves = 0;
  readonly app = {
    workspace: {
      requestSaveLayout: (): void => {
        this.layoutSaves++;
      },
    },
  } as unknown as App;

  get leaf(): WorkspaceLeaf {
    return { app: this.app } as unknown as WorkspaceLeaf;
  }
}

/**
 * Let everything come to rest: the host's answers arrive, and whatever the
 * views put off for a moment (a drawing, the rest of a long board) is done.
 * A save that waits for a pause in the typing is not hurried along.
 */
export async function rest(host: FakeHost): Promise<void> {
  for (let turn = 0; turn < 4; turn++) {
    await tick();
    host.timers.advance(0);
  }
}

export interface Board {
  host: FakeHost;
  bench: FakeWorkbench;
  view: CorkboardView;
  shell: StubItemView;
  pane: FakeElement;
}

/** Open a corkboard on a host, the way Obsidian opens a view. */
export async function openBoard(host: FakeHost, bench: FakeWorkbench = new FakeWorkbench()): Promise<Board> {
  const view = new CorkboardView(bench.leaf, host);
  const shell = view as unknown as StubItemView;
  const pane = view.contentEl as unknown as FakeElement;
  await shell.open();
  return { host, bench, view, shell, pane };
}

export interface Inspector {
  host: FakeHost;
  bench: FakeWorkbench;
  view: InspectorView;
  shell: StubItemView;
  pane: FakeElement;
}

/** Open an inspector on a host, the way Obsidian opens a view. */
export async function openInspector(host: FakeHost, bench: FakeWorkbench = new FakeWorkbench()): Promise<Inspector> {
  const view = new InspectorView(bench.leaf, host);
  const shell = view as unknown as StubItemView;
  const pane = view.contentEl as unknown as FakeElement;
  await shell.open();
  return { host, bench, view, shell, pane };
}

/** Forget the notices, menus and windows of earlier tests, and where the keyboard was. Call it before each test. */
export function clearScreen(): void {
  StubNotice.shown.length = 0;
  StubMenu.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
}

export const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

// ------------------------------------------------------------------ reading

/** The one element with this class inside `parent`, or a failed test. */
export function one(parent: FakeElement, cls: string): FakeElement {
  const found = parent.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** True when an element, and everything it sits in, is on show. */
export function isShown(element: FakeElement): boolean {
  for (let at: FakeElement | null = element; at; at = at.parent) {
    if (at.hasClass('spellbook-is-off')) return false;
  }
  return true;
}

/** What a reader sees of the first element with this class inside `parent`: its text, or "" when it is not on show. */
export function seen(parent: FakeElement, cls: string): string {
  const found = parent.withClass(cls)[0];
  return found && isShown(found) ? found.fullText : '';
}

/** The colour an element was given, by its name; null when it has none. */
export function colorOf(element: FakeElement | undefined): string | null {
  const found = [...(element?.classes ?? [])].find((cls) => cls.startsWith('spellbook-color-'));
  return found ? found.slice('spellbook-color-'.length) : null;
}

/** The cards on the board, first to last. */
export function cardsOf(pane: FakeElement): FakeElement[] {
  return one(pane, 'spellbook-board-grid').children.filter((child) => child.hasClass('spellbook-card'));
}

export function titleOf(card: FakeElement): string {
  return card.withClass('spellbook-card-title')[0]?.text ?? '';
}

/** The titles of the cards, in the order they stand on the board. */
export function titles(pane: FakeElement): string[] {
  return cardsOf(pane).map(titleOf);
}

/** The card with this title. */
export function cardOf(pane: FakeElement, title: string): FakeElement {
  const found = cardsOf(pane).filter((card) => titleOf(card) === title);
  if (found.length !== 1) throw new Error(`expected one card called "${title}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The steps of the trail above the board. */
export function crumbs(pane: FakeElement): FakeElement[] {
  return one(pane, 'spellbook-board-trail').withClass('spellbook-crumb');
}

// ------------------------------------------------------------------ tapping

/** What every event can be asked to do. */
const INERT = { stopPropagation: (): void => {}, preventDefault: (): void => {} };

/** As if the writer tapped (or clicked) an element. */
export function tap(element: FakeElement, event: Record<string, unknown> = {}): void {
  element.dispatch('click', { button: 0, target: element, ...INERT, ...event });
}

/** As if the writer pressed a key while the element had the keyboard, with the event travelling as in a browser. */
export function type(element: FakeElement, key: string, event: Record<string, unknown> = {}): void {
  element.fire('keydown', { key, ...event });
}

/** Put text into a field, as if typed. */
export function typeInto(field: FakeElement, text: string): void {
  field.value = text;
  field.dispatch('input', {});
}

/** Pick a value in a list of choices. */
export function choose(select: FakeElement, value: string): void {
  select.value = value;
  select.dispatch('change', {});
}

/** The menu that was shown last, or a failed test. */
export function lastMenu(): StubMenu {
  const menu = StubMenu.shown[StubMenu.shown.length - 1];
  if (!menu) throw new Error('no menu was shown');
  return menu;
}

/** Tap an element that opens a menu, and give the menu that opens. */
export function menuFrom(button: FakeElement): StubMenu {
  const before = StubMenu.shown.length;
  tap(button);
  if (StubMenu.shown.length !== before + 1) throw new Error('the tap showed no menu');
  return lastMenu();
}

/** Tap the "more" button of the card with this title and give the menu that opens. */
export function menuOf(pane: FakeElement, title: string): StubMenu {
  return menuFrom(one(cardOf(pane, title), 'spellbook-card-more'));
}

/** Pick an item of a menu and give the menu that this opens. */
export function submenu(menu: StubMenu, title: string): StubMenu {
  const before = StubMenu.shown.length;
  menu.item(title).click();
  if (StubMenu.shown.length !== before + 1) throw new Error(`"${title}" showed no menu`);
  return lastMenu();
}

/** The titles of a menu's items that are ticked. */
export function ticked(menu: StubMenu): string[] {
  return menu.items.filter((item) => item.checked === true).map((item) => item.title);
}

// ------------------------------------------------------------------ windows

/** The window that was opened last, which must still be open. */
export function openWindow(): StubModal {
  const modal = StubModal.opened[StubModal.opened.length - 1];
  if (!modal?.isOpen) throw new Error('no window is open');
  return modal;
}

/** How many windows are open right now. */
export function openWindows(): number {
  return StubModal.opened.filter((modal) => modal.isOpen).length;
}

/** The two buttons at the bottom of a window: the one that cancels and the one that goes ahead. */
export function windowButtons(modal: StubModal): { cancel: ButtonComponent; confirm: ButtonComponent } {
  const buttons = modal.contentEl.settings[0]?.components as ButtonComponent[] | undefined;
  if (!buttons || buttons.length !== 2) throw new Error('the window does not have two buttons');
  return { cancel: buttons[0] as ButtonComponent, confirm: buttons[1] as ButtonComponent };
}

/** Answer the window that asks for a name: type it and press Enter. */
export function answerPrompt(text: string): StubModal {
  const modal = openWindow();
  const input = one(modal.contentEl, 'spellbook-prompt-input');
  typeInto(input, text);
  input.dispatch('keydown', { key: 'Enter', ...INERT });
  return modal;
}

/** The message under the field of a window that asks for a name. */
export function promptMessage(modal: StubModal): string {
  return modal.contentEl.withClass('spellbook-prompt-message')[0]?.text ?? '';
}

// ------------------------------------------------------------------- a novel

export const OPENING = 'Manuscript/Opening.md';
export const LETTER = 'Manuscript/The Letter.md';
/** "A letter to my sister" */
export const HEBREW_SCENE = 'Manuscript/מכתב לאחותי.md';
export const GHOST = 'Manuscript/Ghost.md';
export const CLOSING = 'Manuscript/Closing.md';
/** "Inner part" */
export const INNER_NAME = 'חלק פנימי';
/** "Daniel" */
export const DANIEL = 'דניאל';
/** "Anna opens her sister's letter." */
export const HEBREW_SYNOPSIS = 'אנה פותחת את המכתב של אחותה.';

export const LETTER_TEXT = 'Dear sister, I write to you from the harbour, where the ships come in at night.';

function scene(path: string, missing = false): TreeNode {
  return { kind: 'scene', path, title: path.slice(path.lastIndexOf('/') + 1, -3), missing };
}

/** The binder of the small novel. */
export function novelTree(): TreeNode[] {
  return [
    scene(OPENING),
    {
      kind: 'folder',
      id: 'f-one',
      name: 'Part one',
      children: [scene(LETTER), { kind: 'folder', id: 'f-inner', name: INNER_NAME, children: [scene(HEBREW_SCENE)] }],
    },
    scene(GHOST, true),
    scene(CLOSING),
  ];
}

/** The lists of the small novel, as its index note holds them. */
export function novelIndex(): Frontmatter {
  return {
    statuses: [
      { name: 'To do', color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: 'Done', color: 'green' },
    ],
    labels: [
      { name: 'Anna', color: 'purple' },
      { name: DANIEL, color: 'cyan' },
    ],
  };
}

/**
 * A host with a small novel open: a scene with everything set, a folder with
 * a scene that has no synopsis and a folder inside it with a Hebrew scene, an
 * entry whose note is missing, and a scene with a status the list does not have.
 */
export function novelHost(): FakeHost {
  const host = new FakeHost();
  host.scenes.set(OPENING, {
    frontmatter: {
      synopsis: 'Anna arrives in the old town.',
      status: 'To do',
      label: 'Anna',
      target: 1000,
      compile: true,
      created: '2026-10-01',
      edited: '2026-10-13',
      order: 1024,
    },
    words: 250,
  });
  host.scenes.set(LETTER, { frontmatter: { status: 'First draft' }, text: LETTER_TEXT, words: 16 });
  host.scenes.set(HEBREW_SCENE, {
    frontmatter: { synopsis: HEBREW_SYNOPSIS, status: 'Done', label: DANIEL },
    words: 5,
  });
  host.scenes.set(CLOSING, { frontmatter: { status: 'Sent off', compile: false }, words: 40 });
  host.open(novelTree(), novelIndex());
  return host;
}
