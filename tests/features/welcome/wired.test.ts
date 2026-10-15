// The welcome as the writer meets it: when the welcome page opens by itself
// and when it does not, the "What is new" note, the commands, the Help pane,
// the settings and the tour. The real feature runs on a vault in memory with
// the stand-in app.

import type { Plugin as ObsidianPlugin } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { COMMANDS_SERVICE, LONGEST_WAIT_MS, quietBeforeDeciding } from '../../../src/core/welcome/index';
import type { CommandsService } from '../../../src/core/welcome/index';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import {
  COPIED_TEXT,
  GUIDE_ADDRESS,
  HELP_VIEW_TYPE,
  LAST_VERSION_KEY,
  NOT_COPIED_TEXT,
  STILL_STARTING_TEXT,
  TOUR_STOPS,
  Tour,
  WELCOME_COMMANDS,
  pageScreen,
  WELCOME_SEEN_KEY,
  WELCOME_VIEW_TYPE,
  WHATS_NEW_KEY,
  WhatsNewModal,
  welcomeFeature,
} from '../../../src/features/welcome/index';
import type { TourScreen } from '../../../src/features/welcome/index';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { FakeLeaf } from '../../fakeObsidianApp';
import { MemoryVault } from '../../memoryVault';
import { FakeElement, Modal as StubModal, fakeDocument, fakeWindow, Notice as StubNotice, Platform, Plugin as StubPlugin, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import { setLayoutChoice, stopLayout } from '../../../src/ui/layout';
import type { StubCommand } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, TODAY, makeStore } from '../../storeHarness';

beforeEach(() => {
  StubModal.opened.length = 0;
  StubNotice.shown.length = 0;
});

afterEach(() => {
  stopLayout();
  vi.unstubAllGlobals();
  resetPlatform();
  resetFakeDocument();
  vi.restoreAllMocks();
});

interface Stage {
  vault: MemoryVault;
  fake: FakeObsidian;
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  features: RegisteredFeatures;
  advance(ms: number): void;
  /** The commands the stand-in service ran, by id. */
  ran: string[];
  command(id: string): StubCommand;
  switchOff(): void;
}

const SEEN = { [WELCOME_SEEN_KEY]: 'yes' };

/** A vault with one project in it. */
function projectVault(): MemoryVault {
  const vault = new MemoryVault();
  vault.seed('Novel/Novel.md', { frontmatter: { spellbook: 'project', version: 1, title: 'My Novel', binder: [] }, body: INDEX_BODY });
  vault.seedFolder('Novel/Manuscript');
  return vault;
}

/** The feature, registered the way the plugin registers it. */
async function wire(options: { vault?: MemoryVault; stored?: Record<string, string>; version?: string | null; withCommands?: boolean } = {}): Promise<Stage> {
  const vault = options.vault ?? new MemoryVault();
  const { store, timers } = makeStore(vault);
  await store.idle();
  const storage = new MemoryDeviceStorage();
  for (const [key, value] of Object.entries(options.stored ?? {})) storage.save(key, value);
  storage.saves.length = 0;
  const fake = new FakeObsidian();
  const version = options.version === undefined ? '1.1.0' : options.version;
  const plugin = new StubPlugin(fake.app, version === null ? { id: 'spellbook-novel-writer' } : { id: 'spellbook-novel-writer', name: 'Spellbook', version });
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const features = registerFeatures([welcomeFeature], {
    plugin: plugin as unknown as ObsidianPlugin,
    app: fake.app,
    store,
    vault,
    storage,
    deviceId: () => 'testdevice',
    clock: { today: () => TODAY, now: () => 1_000, setTimer: timers.set, nextFrame: (callback) => timers.set(() => callback(16), 16) },
    wordCounts,
    openNote: async () => true,
  });
  const ran: string[] = [];
  if (options.withCommands !== false) {
    const service: CommandsService = {
      list: () => [
        { id: 'create-project', name: 'Create project' },
        { id: 'open-binder', name: 'Open binder' },
        { id: 'help', name: 'Help' },
        { id: 'made-up', name: 'Made up' },
      ],
      run: (id) => {
        ran.push(id);
        return true;
      },
    };
    features.services.provide(COMMANDS_SERVICE, service);
  }
  return {
    vault,
    fake,
    plugin,
    storage,
    features,
    advance: (ms) => {
      timers.advance(ms);
    },
    ran,
    command: (id) => {
      const found = plugin.commands.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`no command "${id}"`);
      return found;
    },
    switchOff: () => {
      features.release();
      plugin.unload();
      wordCounts.dispose();
      store.dispose();
    },
  };
}

/** Let the panes that were asked for open. */
async function opened(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const panesOf = (stage: Stage, type: string): FakeLeaf[] => stage.fake.workspace.getLeavesOfType(type);
const QUIET = quietBeforeDeciding(false);

describe('the first run', () => {
  it('opens the welcome page once the vault is quiet, on a device with no project, and remembers it', async () => {
    const stage = await wire();
    stage.advance(QUIET - 1);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toEqual([]); // not before the vault has settled
    expect(stage.storage.saves).toEqual([]);

    stage.advance(1);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toHaveLength(1);
    expect(stage.storage.load(WELCOME_SEEN_KEY)).toBe('yes');
    expect(stage.storage.load(LAST_VERSION_KEY)).toBe('1.1.0');
    expect(StubModal.opened).toEqual([]); // no "What is new" on a first run
    expect(stage.vault.writes).toEqual([]); // nothing in the vault

    // Only once.
    stage.switchOff();
    const again = await wire({ stored: { [WELCOME_SEEN_KEY]: String(stage.storage.load(WELCOME_SEEN_KEY)), [LAST_VERSION_KEY]: '1.1.0' } });
    again.advance(LONGEST_WAIT_MS);
    await opened();
    expect(panesOf(again, WELCOME_VIEW_TYPE)).toEqual([]);
  });

  it('waits while the vault is still being read, up to a limit', async () => {
    const stage = await wire();
    for (let step = 0; step < 5; step++) {
      stage.advance(QUIET - 100);
      stage.vault.external.create(`Note ${step}.md`, { body: 'x' }); // the vault reports another file
    }
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toEqual([]);
    stage.advance(QUIET);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toHaveLength(1);
  });

  it('waits longer on a phone or tablet', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    const stage = await wire();
    stage.advance(QUIET);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toEqual([]);
    stage.advance(quietBeforeDeciding(true) - QUIET);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toHaveLength(1);
    // On a phone the drawers slide away so that the page can be seen.
    expect(stage.fake.workspace.leftSplit.collapsed).toBe(true);
  });

  it('waits as long on a phone with the desktop layout: how slow the device starts is not a matter of layout', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    setLayoutChoice('desktop');
    const stage = await wire();
    stage.advance(QUIET);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toEqual([]);
    stage.advance(quietBeforeDeciding(true) - QUIET);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toHaveLength(1);
    const pane = (panesOf(stage, WELCOME_VIEW_TYPE)[0]?.view as unknown as { contentEl: FakeElement }).contentEl;
    const root = pane.hasClass('spellbook-welcome') ? pane : pane.withClass('spellbook-welcome')[0];
    expect(root?.hasClass('spellbook-is-mobile')).toBe(false);
    expect(root?.hasClass('spellbook-is-phone')).toBe(true);
  });

  it('never opens on a device whose vault already holds a project, and remembers that', async () => {
    const stage = await wire({ vault: projectVault() });
    stage.advance(LONGEST_WAIT_MS);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toEqual([]);
    expect(stage.storage.load(WELCOME_SEEN_KEY)).toBe('yes');
  });

  it('never opens when the vault has a project whose properties are not read yet', async () => {
    const vault = new MemoryVault();
    vault.seed('Novel/Novel.md', { body: 'not indexed yet' });
    vault.seedFolder('Novel/Manuscript');
    const stage = await wire({ vault });
    stage.advance(LONGEST_WAIT_MS);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toEqual([]);
  });

  it('decides nothing after the plugin is switched off', async () => {
    const stage = await wire();
    stage.switchOff();
    stage.advance(LONGEST_WAIT_MS);
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toEqual([]);
    expect(stage.storage.saves).toEqual([]);
  });
});

describe('what is new', () => {
  it('shows once after an update', async () => {
    const stage = await wire({ vault: projectVault(), stored: { ...SEEN, [LAST_VERSION_KEY]: '0.8.0' }, version: '0.9.0' });
    stage.advance(QUIET);
    await opened();
    expect(StubModal.opened).toHaveLength(1);
    const modal = StubModal.opened[0] as unknown as WhatsNewModal & { titleEl: FakeElement; contentEl: FakeElement };
    expect(modal).toBeInstanceOf(WhatsNewModal);
    expect(modal.titleEl.text).toBe('What is new in 0.9.0');
    expect(modal.contentEl.fullText).toContain('The first tester release.');
    expect(modal.contentEl.fullText).toContain('Organise: binder, corkboard, outliner, inspector.');
    expect(stage.storage.load(LAST_VERSION_KEY)).toBe('0.9.0');
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toEqual([]);
  });

  it('not again for the same version, nor when it is turned off', async () => {
    const same = await wire({ stored: { ...SEEN, [LAST_VERSION_KEY]: '0.9.0' }, version: '0.9.0' });
    same.advance(LONGEST_WAIT_MS);
    const off = await wire({ stored: { ...SEEN, [LAST_VERSION_KEY]: '0.8.0', [WHATS_NEW_KEY]: 'off' }, version: '0.9.0' });
    off.advance(LONGEST_WAIT_MS);
    await opened();
    expect(StubModal.opened).toEqual([]);
    expect(off.storage.load(LAST_VERSION_KEY)).toBe('0.9.0');
  });

  it('the command shows the notes of this version at any time', async () => {
    const stage = await wire({ stored: SEEN, version: '0.9.0' });
    stage.command(WELCOME_COMMANDS.whatsNew.id).callback?.();
    expect((StubModal.opened[0] as unknown as { titleEl: FakeElement }).titleEl.text).toBe('What is new in 0.9.0');
  });

  it('closes with the plugin', async () => {
    const stage = await wire({ stored: SEEN, version: '0.9.0' });
    stage.command(WELCOME_COMMANDS.whatsNew.id).callback?.();
    stage.switchOff();
    expect((StubModal.opened[0] as unknown as { isOpen: boolean }).isOpen).toBe(false);
  });
});

describe('the welcome page', () => {
  async function page(withCommands = true): Promise<{ stage: Stage; root: FakeElement }> {
    const stage = await wire({ stored: SEEN, withCommands });
    stage.command(WELCOME_COMMANDS.openWelcome.id).callback?.();
    await opened();
    const leaf = panesOf(stage, WELCOME_VIEW_TYPE)[0];
    const root = (leaf?.view as unknown as { contentEl: FakeElement } | undefined)?.contentEl;
    if (!root) throw new Error('no welcome page');
    return { stage, root };
  }
  const buttonOf = (root: FakeElement, attr: string, value: string): FakeElement => {
    const found = root.all().find((element) => element.tag === 'button' && element.attrs[attr] === value);
    if (!found) throw new Error(`no button ${attr}=${value}`);
    return found;
  };

  it('says what Spellbook is, offers three ways to begin and says where things are', async () => {
    const { root } = await page();
    const text = root.fullText;
    expect(text).toContain('Welcome to Spellbook');
    for (const words of ['Try the sample novel', 'Start my own project', 'Read the tutorial', 'Show me around', 'Where things are', 'Spellbook: Open binder']) {
      expect(text).toContain(words);
    }
  });

  it('runs the plugin\'s own commands from its choices', async () => {
    const { stage, root } = await page();
    buttonOf(root, 'data-choice', 'sample').fire('click');
    buttonOf(root, 'data-choice', 'create').fire('click');
    expect(stage.ran).toEqual(['create-sample-project', 'create-project']);
    buttonOf(root, 'data-choice', 'tutorial').fire('click');
    await opened();
    expect(panesOf(stage, HELP_VIEW_TYPE)).toHaveLength(1);
  });

  it('says so when the plugin is still starting', async () => {
    const { root } = await page(false);
    buttonOf(root, 'data-choice', 'sample').fire('click');
    expect(StubNotice.shown.map((notice) => notice.message)).toEqual([STILL_STARTING_TEXT]);
  });

  it('opens one page, however often it is asked for', async () => {
    const { stage } = await page();
    stage.command(WELCOME_COMMANDS.openWelcome.id).callback?.();
    stage.command(WELCOME_COMMANDS.openWelcome.id).callback?.();
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toHaveLength(1);
  });
});

describe('the Help pane', () => {
  async function help(): Promise<{ stage: Stage; root: FakeElement }> {
    const stage = await wire({ stored: SEEN });
    stage.command(WELCOME_COMMANDS.help.id).callback?.();
    await opened();
    const root = (panesOf(stage, HELP_VIEW_TYPE)[0]?.view as unknown as { contentEl: FakeElement } | undefined)?.contentEl;
    if (!root) throw new Error('no help pane');
    return { stage, root };
  }

  it('is opened with the command "Help"', () => {
    expect(WELCOME_COMMANDS.help).toEqual({ id: 'help', name: 'Help' });
  });

  it('lists every registered command with what the guide says it does', async () => {
    const { root } = await help();
    const rows = root.withClass('spellbook-help-command').map((row) => row.fullText);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('Spellbook: Create project');
    expect(rows[0]).toContain('Asks for a name and a location and makes a new project.');
    expect(rows[3]).toBe('Spellbook: Made up'); // a command the guide does not describe: its name alone
  });

  it('lists the tutorial\'s steps in short', async () => {
    const { root } = await help();
    const steps = root.withClass('spellbook-help-step');
    expect(steps.length).toBeGreaterThanOrEqual(10);
    expect(steps[2]?.fullText).toContain('Create your own project');
    expect(steps[2]?.fullText).toContain('Create project');
  });

  it('shows the guide\'s address as text to copy, and opens nothing', async () => {
    const { root } = await help();
    const fields = root.withClass('spellbook-help-address-text');
    expect(fields[0]?.value).toBe(GUIDE_ADDRESS);
    expect(fields[0]?.attrs['readonly']).toBe('true');
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    root.withClass('spellbook-help-copy')[0]?.fire('click');
    await opened();
    expect(writeText).toHaveBeenCalledWith(GUIDE_ADDRESS);
    expect(root.withClass('spellbook-help-copy-status')[0]?.text).toBe(COPIED_TEXT);

    vi.stubGlobal('navigator', {}); // no clipboard
    root.withClass('spellbook-help-copy')[0]?.fire('click');
    await opened();
    expect(root.withClass('spellbook-help-copy-status')[0]?.text).toBe(NOT_COPIED_TEXT);
    vi.unstubAllGlobals();
  });
});

describe('the settings', () => {
  it('can show the welcome page again, and turn "What is new" off and on', async () => {
    const stage = await wire({ stored: SEEN });
    const section = stage.features.settingsSections.find((candidate) => candidate.id === 'welcome');
    expect(section?.title).toBe('Welcome and help');
    const place = new FakeElement();
    section?.render(place as unknown as HTMLElement);
    expect(place.settings.map((row) => row.nameEl.text)).toEqual(['Show the welcome page again', 'Show what is new after updates']);

    const show = place.settings[0]?.components[0] as { click(): void } | undefined;
    show?.click();
    await opened();
    expect(panesOf(stage, WELCOME_VIEW_TYPE)).toHaveLength(1);

    const toggle = place.settings[1]?.toggles[0];
    expect(toggle?.getValue()).toBe(true); // on by default
    toggle?.flip();
    expect(stage.storage.load(WHATS_NEW_KEY)).toBe('off');
    toggle?.flip();
    expect(stage.storage.load(WHATS_NEW_KEY)).toBeNull();
  });
});

describe('the tour', () => {
  /** A page with some of the parts the tour points at. */
  function screen(parts: Record<string, Partial<FakeElement['rect']>>, isPhone = false): TourScreen & { layer: FakeElement; listeners: Map<string, (event: Event) => void> } {
    const layer = new FakeElement('body');
    const listeners = new Map<string, (event: Event) => void>();
    const elements = new Map<string, FakeElement>();
    for (const [selector, rect] of Object.entries(parts)) {
      const element = new FakeElement();
      element.rect = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, ...rect };
      elements.set(selector, element);
    }
    return {
      find: (selectors) => {
        for (const selector of selectors) {
          const element = elements.get(selector);
          if (element && element.rect.width > 0) return element as unknown as HTMLElement;
        }
        return null;
      },
      viewport: () => ({ width: 1200, height: 800 }),
      layer: layer as unknown as HTMLElement & FakeElement,
      listen: (type, handler) => {
        listeners.set(type, handler);
        return () => {
          listeners.delete(type);
        };
      },
      isPhone,
      isMobile: isPhone,
      listeners,
    } as TourScreen & { layer: FakeElement; listeners: Map<string, (event: Event) => void> };
  }
  const BINDER = TOUR_STOPS[0]?.selectors[0] ?? '';
  const BAR = '.spellbook-status';
  const LINE = TOUR_STOPS.find((stop) => stop.id === 'inspector-line')?.selectors[0] ?? '';

  it('goes through what is on the screen, passing over the rest, with Back, Next and Done', () => {
    const page = screen({ [BINDER]: { top: 0, left: 0, width: 300, height: 800 }, [BAR]: { top: 780, left: 600, width: 300, height: 20 } });
    const tour = new Tour(page, TOUR_STOPS);
    expect(tour.start()).toBe(true);
    expect(tour.current).toBe('binder');
    const bubble = (): FakeElement => page.layer.withClass('spellbook-tour-bubble')[0] as FakeElement;
    expect(bubble().fullText).toContain('1 of 3'); // binder, bottom bar, commands
    expect(bubble().style['left']).toBe('312px'); // beside the binder
    const ring = page.layer.withClass('spellbook-tour-ring')[0];
    expect(ring?.style['width']).toBe('308px');
    expect(bubble().withClass('spellbook-tour-back')[0]?.disabled).toBe(true);

    bubble().withClass('spellbook-tour-next')[0]?.fire('click');
    expect(tour.current).toBe('bottom-bar'); // the inspector is not open: passed over
    expect(bubble().style['top']).toBe(`${780 - 12 - 0}px`); // above the bar (the stand-in bubble has no height)

    bubble().withClass('spellbook-tour-next')[0]?.fire('click');
    expect(tour.current).toBe('commands');
    expect(ring?.hasClass('spellbook-is-hidden')).toBe(true); // nothing to ring: a bubble in the middle
    expect(bubble().withClass('spellbook-tour-next')).toEqual([]); // the last stop: Done only

    bubble().withClass('spellbook-tour-back')[0]?.fire('click');
    expect(tour.current).toBe('bottom-bar');

    bubble().withClass('spellbook-tour-done')[0]?.fire('click');
    expect(tour.current).toBeNull();
    expect(page.layer.children).toEqual([]); // removed completely
    expect(page.listeners.size).toBe(0);
  });

  /** A phone's page with sidebar drawers the tour can slide out; a part in a drawer is on screen only while its drawer is out. */
  function phone(panes: Partial<Record<'left' | 'right', string>>, drawerParts: Record<string, 'left' | 'right'>, parts: Record<string, Partial<FakeElement['rect']>> = {}) {
    const base = screen(parts, true);
    const drawers = { left: false, right: false };
    const opened: string[] = [];
    const timers: Array<{ handler: () => void; cancelled: boolean }> = [];
    const page = Object.assign(base, {
      find: (selectors: readonly string[]) => {
        for (const selector of selectors) {
          const side = drawerParts[selector];
          if (side && drawers[side]) {
            const element = new FakeElement();
            element.rect = { top: 0, left: side === 'left' ? 0 : 90, bottom: 800, right: 390, width: 300, height: 800 };
            return element as unknown as HTMLElement;
          }
        }
        return null;
      },
      openSidebar: (where: { view: string; side: 'left' | 'right' }) => {
        const side = Object.entries(panes).find(([, view]) => view === where.view)?.[0] as 'left' | 'right' | undefined;
        drawers.left = side === 'left';
        drawers.right = side === 'right';
        if (side) opened.push(side);
        return side !== undefined;
      },
      closeSidebars: () => {
        drawers.left = false;
        drawers.right = false;
        opened.push('closed');
      },
      later: (handler: () => void) => {
        const timer = { handler, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      drawers,
      opened,
      settle: () => {
        for (const timer of timers.splice(0)) if (!timer.cancelled) timer.handler();
      },
    });
    return page;
  }
  const INSPECTOR = TOUR_STOPS.find((stop) => stop.id === 'inspector')?.selectors[0] ?? '';

  it('on a phone slides out the drawer of each sidebar stop in turn, shows the word figures, and slides them away at the end', () => {
    const page = phone(
      { left: 'spellbook-binder', right: 'spellbook-inspector' },
      { [BINDER]: 'left', [INSPECTOR]: 'right', [LINE]: 'right' },
      { [BAR]: { top: 780, left: 0, width: 300, height: 20 } },
    );
    const tour = new Tour(page, TOUR_STOPS);
    tour.start();
    const bubble = (): FakeElement => page.layer.withClass('spellbook-tour-bubble')[0] as FakeElement;
    const ring = (): FakeElement => page.layer.withClass('spellbook-tour-ring')[0] as FakeElement;
    expect(tour.current).toBe('binder');
    expect(page.drawers).toEqual({ left: true, right: false });
    expect(bubble().fullText).toContain('1 of 4'); // binder, inspector, word figures, commands; never the bottom bar
    expect(bubble().fullText).toContain('left sidebar');
    page.settle();
    expect(ring().hasClass('spellbook-is-hidden')).toBe(false); // ringed once the drawer is out

    tour.next();
    expect(tour.current).toBe('inspector');
    expect(page.drawers).toEqual({ left: false, right: true });
    tour.next();
    expect(tour.current).toBe('inspector-line');
    expect(page.drawers.right).toBe(true);
    page.settle();
    expect(ring().hasClass('spellbook-is-hidden')).toBe(false);
    tour.next();
    expect(tour.current).toBe('commands');
    expect(page.drawers).toEqual({ left: false, right: false }); // slid away for the last card
    expect(bubble().hasClass('spellbook-is-mobile')).toBe(true);

    tour.back();
    expect(page.drawers.right).toBe(true);
    tour.end();
    expect(page.drawers).toEqual({ left: false, right: false });
    expect(page.layer.children).toEqual([]);
  });

  it('on a phone without the panes open shows the sidebar stops as cards saying where to find them', () => {
    const page = phone({}, {});
    const tour = new Tour(page, TOUR_STOPS);
    tour.start();
    const bubble = (): FakeElement => page.layer.withClass('spellbook-tour-bubble')[0] as FakeElement;
    const ring = (): FakeElement => page.layer.withClass('spellbook-tour-ring')[0] as FakeElement;
    expect(tour.current).toBe('binder');
    page.settle();
    expect(ring().hasClass('spellbook-is-hidden')).toBe(true); // a card in the middle
    expect(bubble().fullText).toContain('swipe in from the left edge');
    tour.next();
    expect(bubble().fullText).toContain('swipe in from the right edge');
    tour.next();
    expect(tour.current).toBe('inspector-line');
    tour.next();
    expect(tour.current).toBe('commands');
    tour.end();
    expect(page.opened).not.toContain('left');
  });

  it('on a desktop the stops keep their desktop words and no drawer is touched', () => {
    const page = phone({ left: 'spellbook-binder' }, { [BINDER]: 'left' });
    Object.assign(page, { isPhone: false, isMobile: false });
    const tour = new Tour(page, TOUR_STOPS);
    tour.start();
    expect(tour.current).toBe('commands'); // nothing on the desktop page: no sidebar stop is forced in
    expect(page.layer.withClass('spellbook-tour-bubble')[0]?.fullText).not.toContain('sidebar');
    tour.end();
    expect(page.opened).toEqual([]);
  });

  it("the page's drawers: slides out the sidebar that holds the pane and the other away, or both away when the pane is not open", () => {
    const fake = new FakeObsidian();
    const { workspace } = fake;
    const doc = { defaultView: null, documentElement: { clientWidth: 390, clientHeight: 800 }, body: new FakeElement('body') } as unknown as Document;
    const page = pageScreen(doc, true, true, workspace as never);
    const binder = workspace.addLeaf(workspace.leftSplit);
    binder.type = 'spellbook-binder';
    workspace.rightSplit.expand();
    expect(page.openSidebar?.({ view: 'spellbook-binder', side: 'left' })).toBe(true);
    expect(workspace.leftSplit.collapsed).toBe(false);
    expect(workspace.rightSplit.collapsed).toBe(true);
    expect(workspace.revealed).toContain(binder);
    expect(page.openSidebar?.({ view: 'spellbook-inspector', side: 'right' })).toBe(false);
    expect(workspace.leftSplit.collapsed).toBe(true);
    expect(workspace.rightSplit.collapsed).toBe(true);
  });

  it('ends with Escape, and ends at once when nothing can be shown', () => {
    const page = screen({});
    const tour = new Tour(page, TOUR_STOPS);
    tour.start();
    page.listeners.get('keydown')?.({ key: 'Escape' } as unknown as Event);
    expect(tour.isRunning).toBe(false);
    expect(page.layer.children).toEqual([]);

    const ended = vi.fn();
    const empty = new Tour(screen({}), TOUR_STOPS.filter((stop) => stop.selectors.length > 0), ended);
    expect(empty.start()).toBe(false);
    expect(ended).toHaveBeenCalledOnce();
  });

  it('the tour\'s buttons follow the "Layout" setting; its phone stops follow the device', async () => {
    // A page with nothing to point at but the stops that need nothing.
    const page = {
      defaultView: fakeWindow,
      body: fakeDocument.body,
      documentElement: { clientWidth: 1200, clientHeight: 800 },
      querySelectorAll: () => [],
    };
    vi.stubGlobal('activeDocument', page);
    const bubble = (): FakeElement | undefined => fakeDocument.body.withClass('spellbook-tour-bubble')[0];
    const stage = await wire({ stored: SEEN });

    setLayoutChoice('touch'); // a touch-screen laptop
    stage.command(WELCOME_COMMANDS.tour.id).callback?.();
    stage.advance(1000);
    expect(bubble()?.hasClass('spellbook-is-mobile')).toBe(true);
    expect(bubble()?.fullText).not.toContain('left sidebar'); // not a phone: no drawers to explain

    setLayoutChoice('auto');
    stage.command(WELCOME_COMMANDS.tour.id).callback?.();
    stage.advance(1000);
    expect(fakeDocument.body.withClass('spellbook-tour-bubble')).toHaveLength(1);
    expect(bubble()?.hasClass('spellbook-is-mobile')).toBe(false);
    stage.switchOff();
  });

  it('the command opens the binder and the inspector first, on a phone too (in the drawers the tour slides out)', async () => {
    const stage = await wire({ stored: SEEN });
    stage.command(WELCOME_COMMANDS.tour.id).callback?.();
    expect(stage.ran).toEqual(['open-binder', 'open-inspector']);
    stage.advance(1000); // without a page (as in these tests) the tour does not start, and nothing fails
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    stage.command(WELCOME_COMMANDS.tour.id).callback?.();
    expect(stage.ran).toEqual(['open-binder', 'open-inspector', 'open-binder', 'open-inspector']);
    stage.advance(1000);
    stage.switchOff();
  });
});
