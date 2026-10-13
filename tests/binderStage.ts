// A stage for testing the binder panel: a vault in memory, timers under the
// test's control, a stand-in for the plugin, and the panel itself, opened the
// way Obsidian opens it. Also: the small windows the binder's actions open,
// as a test can read and answer them.

import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { BinderSelection } from '../src/core/binderSelection';
import { DevicePrefs } from '../src/core/devicePrefs';
import { ProjectSession } from '../src/core/projectSession';
import { ProjectStore } from '../src/core/projectStore';
import { WordCountCache } from '../src/core/wordCountCache';
import { ConfirmModal } from '../src/ui/confirmModal';
import type { DragClock } from '../src/ui/dragDrop';
import { FolderPickerModal } from '../src/ui/folderPickerModal';
import { TextPromptModal } from '../src/ui/textPromptModal';
import { BinderActions } from '../src/views/binderActions';
import type { ActionsHost } from '../src/views/binderActions';
import { BinderView } from '../src/views/binderView';
import type { BinderHost, BinderServices } from '../src/views/binderView';
import { moreOf, press, tap, toolbarButton } from './binderScreen';
import { FakeObsidian } from './fakeObsidianApp';
import type { FakeLeaf } from './fakeObsidianApp';
import { ManualTimers, MemoryVault } from './memoryVault';
import { Menu as StubMenu, Modal as StubModal, Notice as StubNotice, resetFakeDocument } from './obsidianStub';
import type {
  ButtonComponent,
  FakeElement,
  FuzzySuggestModal as StubPicker,
  ItemView as StubItemView,
} from './obsidianStub';
import { MemoryDeviceStorage, TODAY, fixedRandom, quiet, seedProject, tick } from './storeHarness';

/** The plugin, as far as the binder and its actions know it. */
export class Host implements BinderHost, ActionsHost {
  services: BinderServices | null = null;
  readonly actions: BinderActions = new BinderActions(this);
  /** What the other screens offer the binder, by name; null for a plugin with no other screens. */
  features: ActionsHost['features'] = null;
  /** How often the "Create project" window was asked for. */
  asked = 0;
  /** How often the sample project was asked for. */
  samples = 0;
  /** Every note that was asked to be shown. */
  readonly opened: Array<{ path: string; where: unknown }> = [];
  /** Set to false to make opening a note fail. */
  canOpen = true;
  private waiting: Array<() => void> = [];

  constructor(private readonly fake: FakeObsidian) {}

  get app(): App {
    return this.fake.app;
  }

  whenStarted(callback: () => void): void {
    if (this.services) callback();
    else this.waiting.push(callback);
  }

  /** Obsidian has finished starting up: the services exist from now on. */
  start(services: BinderServices): void {
    this.services = services;
    for (const callback of this.waiting.splice(0)) callback();
  }

  askForNewProject(): void {
    this.asked++;
  }

  async createSampleProject(): Promise<boolean> {
    this.samples++;
    return true;
  }

  async openNote(path: string, where: unknown): Promise<boolean> {
    this.opened.push({ path, where });
    if (!this.canOpen) return false;
    this.fake.workspace.setActiveFile(fileAt(path));
    return true;
  }
}

export function fileAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

export interface Stage {
  vault: MemoryVault;
  timers: ManualTimers;
  storage: MemoryDeviceStorage;
  services: BinderServices;
  store: ProjectStore;
  fake: FakeObsidian;
  host: Host;
  leaf: FakeLeaf;
  view: BinderView;
  /** The view, seen as the stand-in it is built on (open, close). */
  shell: StubItemView;
  /** Obsidian's pane element, which the binder fills. */
  pane: FakeElement;
}

/** How long one frame of the test's own clock lasts, in milliseconds. */
export const FRAME_MS = 16;

export interface StageOptions {
  storage?: MemoryDeviceStorage;
  /** Where the binder's pane is. Default: the left sidebar. */
  split?: 'left' | 'right' | 'root';
  /** False: Obsidian is still starting, the services do not exist yet. */
  started?: boolean;
  /** False: nothing opens a project by itself. */
  session?: boolean;
  /** The vault path of a note that is already being worked on when the binder opens. */
  active?: string;
  /** False: do not wait for the words to be counted; only for the store to come to rest. */
  counted?: boolean;
}

export async function stage(vault: MemoryVault = new MemoryVault(), options: StageOptions = {}): Promise<Stage> {
  const timers = new ManualTimers();
  const storage = options.storage ?? new MemoryDeviceStorage();
  const store = new ProjectStore({ vault, today: () => TODAY, setTimer: timers.set, random: fixedRandom() });
  const prefs = new DevicePrefs(storage);
  const session = new ProjectSession(store, prefs);
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const selection = new BinderSelection();
  // Dragging runs on the test's own timers: a frame is one sixtieth of a second.
  let frameTime = 0;
  const clock: DragClock = {
    setTimer: timers.set,
    nextFrame: (callback) =>
      timers.set(() => {
        frameTime += FRAME_MS;
        callback(frameTime);
      }, FRAME_MS),
  };
  const services: BinderServices = {
    store,
    session,
    wordCounts,
    prefs,
    selection,
    clock,
    dismissedCopies: new Set(),
  };

  const fake = new FakeObsidian();
  if (options.active !== undefined) fake.workspace.setActiveFile(fileAt(options.active));
  const host = new Host(fake);
  const split = { left: fake.workspace.leftSplit, right: fake.workspace.rightSplit, root: fake.workspace.rootSplit }[
    options.split ?? 'left'
  ];
  const leaf = fake.workspace.addLeaf(split);
  const view = new BinderView(leaf as never, host);
  const shell = view as unknown as StubItemView;
  const pane = view.contentEl as unknown as FakeElement;
  const made: Stage = { vault, timers, storage, services, store, fake, host, leaf, view, shell, pane };

  store.start();
  wordCounts.start();
  if (options.session !== false) session.start();
  if (options.started !== false) host.start(services);
  await shell.open();
  if (options.counted === false) await quiet(store);
  else await rest(made);
  return made;
}

/** Let everything come to rest: the store, the drawing, and the counting of words. */
export async function rest({ store, services, timers }: Pick<Stage, 'store' | 'services' | 'timers'>): Promise<void> {
  await quiet(store);
  let counted = false;
  void services.wordCounts.idle().then(() => {
    counted = true;
  });
  for (let turn = 0; turn < 5000 && !counted; turn++) {
    await tick();
    timers.advance(0); // lets the counting go on after each of its pauses
  }
  if (!counted) throw new Error('the word counts never finished');
  await tick();
}

/** A small novel: a scene, a folder with a folder in it, a missing entry, a loose note and some research. */
export function novel(vault: MemoryVault = new MemoryVault()): MemoryVault {
  seedProject(vault, {
    binder: [
      'Manuscript/Opening.md',
      {
        folder: 'Part one',
        id: 'f-one',
        children: [
          'Manuscript/The Letter.md',
          { folder: 'חלק פנימי', id: 'f-inner', children: ['Manuscript/מכתב לאחותי.md'] },
        ],
      },
      'Manuscript/Ghost.md',
    ],
  });
  vault.seed('Novel/Manuscript/Opening.md', { frontmatter: { order: 1024 }, body: 'One two three.' });
  vault.seed('Novel/Manuscript/The Letter.md', { frontmatter: { order: 2048 }, body: 'Dear sister, I write.' });
  vault.seed('Novel/Manuscript/מכתב לאחותי.md', { frontmatter: { order: 3072 }, body: 'אחותי היקרה, אני כותבת.' });
  vault.seed('Novel/Manuscript/Loose.md', { body: 'Two words' });
  vault.seed('Novel/Research/Trains.md', { body: 'Timetables of the night trains.' });
  vault.seed('Novel/Research/Maps/City.md');
  return vault;
}

export const INDEX = 'Novel/Novel.md';
export const OPENING = 'Novel/Manuscript/Opening.md';
export const LETTER = 'Novel/Manuscript/The Letter.md';
export const HEBREW = 'Novel/Manuscript/מכתב לאחותי.md';

export const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

/** Forget the notices, menus and windows of earlier tests, and where the keyboard was. Call it before each test. */
export function clearScreen(): void {
  StubNotice.shown.length = 0;
  StubMenu.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
}

// ------------------------------------------------------------------- menus

/** The menu that was shown last, or a failed test. */
export function lastMenu(): StubMenu {
  const menu = StubMenu.shown[StubMenu.shown.length - 1];
  if (!menu) throw new Error('no menu was shown');
  return menu;
}

/** Tap the "more" button of the row with this title and give the menu that opens. */
export function menuOf(pane: FakeElement, title: string): StubMenu {
  const button = moreOf(pane, title);
  if (!button) throw new Error(`the row "${title}" has no "more" button`);
  const before = StubMenu.shown.length;
  tap(button);
  if (StubMenu.shown.length !== before + 1) throw new Error(`tapping "more" on "${title}" showed no menu`);
  return lastMenu();
}

/** Tap the toolbar's "more" button and give the menu that opens. */
export function toolbarMenu(pane: FakeElement): StubMenu {
  const before = StubMenu.shown.length;
  tap(toolbarButton(pane, 'More options'));
  if (StubMenu.shown.length !== before + 1) throw new Error('tapping the toolbar\'s "more" showed no menu');
  return lastMenu();
}

// ----------------------------------------------------------------- windows

/** The window that was opened last, if it is still open. */
function openWindow(): StubModal | undefined {
  const modal = StubModal.opened[StubModal.opened.length - 1];
  return modal?.isOpen ? modal : undefined;
}

/** How many windows are open right now. */
export function openWindows(): number {
  return StubModal.opened.filter((modal) => modal.isOpen).length;
}

export interface Prompt {
  modal: StubModal;
  title: string;
  input: FakeElement;
  /** The message under the field ("" when there is none). */
  message: () => string;
  cancel: ButtonComponent;
  confirm: ButtonComponent;
  /** Put text into the field, as if typed. */
  type: (text: string) => void;
  /** Press Enter in the field. */
  enter: (event?: Record<string, unknown>) => void;
  /** Type a name and press Enter, then let the store and the panel come to rest. */
  answer: (text: string) => Promise<void>;
}

/** The window that asks for a name, which must be open. */
export function prompt(s: Pick<Stage, 'store' | 'services' | 'timers'>): Prompt {
  const modal = openWindow();
  if (!(modal instanceof (TextPromptModal as unknown as typeof StubModal))) {
    throw new Error('no window asking for a name is open');
  }
  const input = modal.contentEl.withClass('spellbook-prompt-input')[0] as FakeElement;
  const buttons = modal.contentEl.settings[0]?.components as ButtonComponent[];
  const type = (text: string): void => {
    input.value = text;
    input.dispatch('input', {});
  };
  const enter = (event: Record<string, unknown> = {}): void => {
    press(input, 'Enter', event);
  };
  return {
    modal,
    title: modal.titleEl.text,
    input,
    message: () => modal.contentEl.withClass('spellbook-prompt-message')[0]?.text ?? '',
    cancel: buttons[0] as ButtonComponent,
    confirm: buttons[1] as ButtonComponent,
    type,
    enter,
    answer: async (text) => {
      type(text);
      enter();
      await rest(s);
    },
  };
}

export interface Question {
  modal: StubModal;
  title: string;
  message: string;
  cancel: ButtonComponent;
  confirm: ButtonComponent;
}

/** The window that asks "are you sure?", which must be open. */
export function question(): Question {
  const modal = openWindow();
  if (!(modal instanceof (ConfirmModal as unknown as typeof StubModal))) {
    throw new Error('no window asking for confirmation is open');
  }
  const buttons = modal.contentEl.settings[0]?.components as ButtonComponent[];
  return {
    modal,
    title: modal.titleEl.text,
    message: modal.contentEl.withClass('spellbook-confirm-message')[0]?.text ?? '',
    cancel: buttons[0] as ButtonComponent,
    confirm: buttons[1] as ButtonComponent,
  };
}

/** The list of folders to move something to, which must be open. */
export function picker(): StubPicker<{ parentId: string | null; label: string }> {
  const modal = openWindow();
  if (!(modal instanceof (FolderPickerModal as unknown as typeof StubModal))) {
    throw new Error('no list of folders is open');
  }
  return modal as unknown as StubPicker<{ parentId: string | null; label: string }>;
}
