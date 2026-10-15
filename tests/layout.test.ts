// The "Layout" setting: touch or desktop layout on this device, and the one
// place that answers which layout the screens use (src/ui/layout.ts).

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STYLE_FILES } from '../scripts/styles.mjs';
import { LAYOUT_KEY, PHONE_NARROW_BELOW, parseLayoutChoice, resolveLayout } from '../src/core/layout';
import type { DeviceStorage } from '../src/core/devicePrefs';
import {
  DESKTOP_LAYOUT_CLASS,
  TOUCH_LAYOUT_CLASS,
  applyLayoutClasses,
  followLayout,
  isPhoneLayout,
  isTouchLayout,
  layoutChoice,
  onLayoutChange,
  setLayoutChoice,
  startLayout,
  stopLayout,
} from '../src/ui/layout';
import { FakeElement, Platform as StubPlatform, resetPlatform } from './obsidianStub';

afterEach(() => {
  stopLayout();
  resetPlatform();
  vi.restoreAllMocks();
});

const PHONE = { isMobile: true, isPhone: true };
const TABLET = { isMobile: true, isPhone: false };
const COMPUTER = { isMobile: false, isPhone: false };

class MemoryStorage implements DeviceStorage {
  readonly values = new Map<string, string>();
  load(key: string): unknown {
    return this.values.get(key) ?? null;
  }
  save(key: string, value: string | null): void {
    if (value === null) this.values.delete(key);
    else this.values.set(key, value);
  }
}

const windowOf = (innerWidth: number): Window => ({ innerWidth }) as unknown as Window;
const asElement = (element: FakeElement): HTMLElement => element as unknown as HTMLElement;

describe('which layout a choice gives on a device', () => {
  it('"Automatic" is what the device is', () => {
    expect(resolveLayout('auto', PHONE, 0)).toEqual({ touch: true, phone: true });
    expect(resolveLayout('auto', TABLET, 0)).toEqual({ touch: true, phone: false });
    expect(resolveLayout('auto', COMPUTER, 0)).toEqual({ touch: false, phone: false });
    // The window's width plays no part: Obsidian has decided already.
    expect(resolveLayout('auto', COMPUTER, 320)).toEqual({ touch: false, phone: false });
  });

  it('"Desktop layout" gives the desktop screens everywhere', () => {
    for (const device of [PHONE, TABLET, COMPUTER]) expect(resolveLayout('desktop', device, 320)).toEqual({ touch: false, phone: false });
  });

  it('"Touch layout" gives big targets everywhere; a tablet or computer keeps its own size unless its window is phone-narrow', () => {
    expect(resolveLayout('touch', PHONE, 0)).toEqual({ touch: true, phone: true });
    expect(resolveLayout('touch', PHONE, 1024)).toEqual({ touch: true, phone: true }); // a phone stays a phone
    expect(resolveLayout('touch', TABLET, 1024)).toEqual({ touch: true, phone: false });
    expect(resolveLayout('touch', COMPUTER, 1440)).toEqual({ touch: true, phone: false });
    expect(resolveLayout('touch', TABLET, PHONE_NARROW_BELOW - 1)).toEqual({ touch: true, phone: true });
    expect(resolveLayout('touch', COMPUTER, PHONE_NARROW_BELOW)).toEqual({ touch: true, phone: false });
    expect(resolveLayout('touch', COMPUTER, 0)).toEqual({ touch: true, phone: false }); // no window to measure
  });

  it('reads anything unknown as "Automatic"', () => {
    expect(parseLayoutChoice('touch')).toBe('touch');
    expect(parseLayoutChoice('desktop')).toBe('desktop');
    for (const odd of ['auto', 'Touch', '', null, undefined, 3, {}]) expect(parseLayoutChoice(odd)).toBe('auto');
  });
});

describe('the layout module', () => {
  it('is "Automatic" until the writer chooses, and follows Obsidian then', () => {
    expect(layoutChoice()).toBe('auto');
    expect(isTouchLayout()).toBe(false);
    Object.assign(StubPlatform, { isDesktop: false, isMobile: true, isPhone: true });
    expect(isTouchLayout()).toBe(true);
    expect(isPhoneLayout()).toBe(true);
  });

  it('reads the choice kept on this device, and keeps a new one there', () => {
    const storage = new MemoryStorage();
    storage.values.set(LAYOUT_KEY, 'desktop');
    startLayout(storage);
    expect(layoutChoice()).toBe('desktop');

    setLayoutChoice('touch');
    expect(storage.values.get(LAYOUT_KEY)).toBe('touch');
    setLayoutChoice('auto');
    expect(storage.values.has(LAYOUT_KEY)).toBe(false); // nothing is stored while it is as it comes
  });

  it('survives a storage that fails, and a value it does not know', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    startLayout({
      load: () => {
        throw new Error('no storage');
      },
      save: () => {
        throw new Error('no storage');
      },
    });
    expect(layoutChoice()).toBe('auto');
    setLayoutChoice('touch'); // not kept, but in force until Obsidian closes
    expect(isTouchLayout()).toBe(true);
    expect(error).toHaveBeenCalledTimes(2);

    const storage = new MemoryStorage();
    storage.values.set(LAYOUT_KEY, 'sideways');
    startLayout(storage);
    expect(layoutChoice()).toBe('auto');
  });

  it('tells whoever listens when the choice changes, and only then', () => {
    const heard: string[] = [];
    const stop = onLayoutChange(() => heard.push(layoutChoice()));
    setLayoutChoice('touch');
    setLayoutChoice('touch');
    setLayoutChoice('desktop');
    stop();
    setLayoutChoice('auto');
    expect(heard).toEqual(['touch', 'desktop']);
  });

  it('keeps telling the others when one listener fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const heard: string[] = [];
    onLayoutChange(() => {
      throw new Error('broken screen');
    });
    onLayoutChange(() => heard.push('second'));
    setLayoutChoice('touch');
    expect(heard).toEqual(['second']);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('forgets the choice and the listeners when the plugin unloads', () => {
    const heard: string[] = [];
    startLayout(new MemoryStorage());
    onLayoutChange(() => heard.push('heard'));
    setLayoutChoice('desktop');
    stopLayout();
    expect(layoutChoice()).toBe('auto');
    setLayoutChoice('touch');
    expect(heard).toEqual(['heard']);
  });

  it('measures the window only for "Touch layout" off a phone', () => {
    Object.assign(StubPlatform, { isDesktop: false, isMobile: true, isPhone: false }); // a tablet
    setLayoutChoice('touch');
    expect(isPhoneLayout(windowOf(1024))).toBe(false);
    expect(isPhoneLayout(windowOf(400))).toBe(true);
    setLayoutChoice('auto');
    expect(isPhoneLayout(windowOf(400))).toBe(false); // Obsidian says tablet: tablet it is
  });

  it('puts the classes on a screen and keeps them in step while the screen lives', () => {
    const root = new FakeElement();
    const cleanups: Array<() => unknown> = [];
    const redrawn: string[] = [];
    followLayout({ register: (callback) => cleanups.push(callback) }, asElement(root), () => redrawn.push(layoutChoice()));
    expect(root.hasClass(TOUCH_LAYOUT_CLASS)).toBe(false);
    expect(root.hasClass(DESKTOP_LAYOUT_CLASS)).toBe(false);

    setLayoutChoice('touch');
    expect(root.hasClass(TOUCH_LAYOUT_CLASS)).toBe(true);
    setLayoutChoice('desktop');
    expect(root.hasClass(TOUCH_LAYOUT_CLASS)).toBe(false);
    expect(root.hasClass(DESKTOP_LAYOUT_CLASS)).toBe(true);
    expect(redrawn).toEqual(['touch', 'desktop']);

    for (const cleanup of cleanups) cleanup(); // the screen closes
    setLayoutChoice('touch');
    expect(root.hasClass(TOUCH_LAYOUT_CLASS)).toBe(false);
  });

  it('gives a window the classes as the layout is when it opens', () => {
    Object.assign(StubPlatform, { isDesktop: false, isMobile: true, isPhone: false });
    const modal = new FakeElement();
    applyLayoutClasses(asElement(modal));
    expect(modal.hasClass(TOUCH_LAYOUT_CLASS)).toBe(true);
    setLayoutChoice('desktop');
    applyLayoutClasses(asElement(modal));
    expect(modal.hasClass(TOUCH_LAYOUT_CLASS)).toBe(false);
    expect(modal.hasClass(DESKTOP_LAYOUT_CLASS)).toBe(true);
  });
});

// ------------------------------------------------------------- source rules

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const srcDir = path.join(repoRoot, 'src');

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Source text with comments removed, so a rule can be explained in a comment without breaking it. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

const relative = (file: string): string => path.relative(srcDir, file).split(path.sep).join('/');

/**
 * The checks of Obsidian's Platform that stay, because they are about what
 * the device can do (or what Obsidian itself does on it), not about the
 * layout. The number is how many each file makes. A new check about layout
 * goes through src/ui/layout.ts instead; a new one about capability is
 * added here, with its reason.
 */
const CAPABILITY_CHECKS: Readonly<Record<string, { count: number; why: string }>> = {
  'ui/layout.ts': { count: 2, why: 'the one place that puts the setting together with the device' },
  'features/export/exportModal.ts': { count: 1, why: 'printing is offered where the device can print' },
  'features/progress/writingProgress.ts': { count: 1, why: 'a phone has no bottom bar' },
  'features/progress/targetsModal.ts': { count: 1, why: 'the on-screen keyboard would cover the form' },
  'features/corkboard/summaryLine.ts': { count: 1, why: 'no bottom bar for plugins on mobile: the inspector shows the figures' },
  'features/outliner/outlinerView.ts': { count: 2, why: "the phone's floating bar, and room for the bottom bar" },
  'features/timeline/timelineView.ts': { count: 2, why: "the phone's floating bar, and room for it at the end" },
  'features/modes/index.ts': { count: 2, why: 'the editor and the exit button where there is no Escape key' },
  'features/prose/index.ts': { count: 1, why: 'the editor: marks kept still while typing on a touch device' },
  'features/revision/index.ts': { count: 1, why: 'the editor: marks kept still while typing on a touch device' },
  'features/revision/revisionView.ts': { count: 2, why: "the phone's floating bar and its sliding sidebars" },
  'features/welcome/index.ts': { count: 2, why: "the phone's sliding sidebars in the tour, and how slow a device starts" },
  'features/welcome/panes.ts': { count: 1, why: "the phone's sliding sidebars" },
  'features/welcome/welcomeView.ts': { count: 1, why: "the phone's floating bar" },
  'features/welcome/helpView.ts': { count: 1, why: "the phone's floating bar" },
  'features/corkboard/panes.ts': { count: 1, why: "the phone's sliding sidebars" },
  'features/corkboard/corkboardView.ts': { count: 1, why: "the phone's floating bar" },
  'features/corkboard/inspectorView.ts': { count: 1, why: "the phone's floating bar" },
  'features/boards/actions.ts': { count: 1, why: "the phone's sliding sidebars" },
  'features/boards/boardsView.ts': { count: 1, why: "the phone's floating bar" },
  'features/snapshots/index.ts': { count: 1, why: "the phone's sliding sidebars" },
  'features/snapshots/snapshotsView.ts': { count: 1, why: "the phone's floating bar" },
  'features/planner/plannerView.ts': { count: 1, why: "the phone's floating bar" },
  'features/world/index.ts': { count: 1, why: "the phone's sliding sidebars" },
  'features/world/worldView.ts': { count: 1, why: "the phone's floating bar" },
  'features/plotgrid/index.ts': { count: 1, why: "the phone's sliding sidebars" },
  'features/plotgrid/plotGridView.ts': { count: 1, why: "the phone's floating bar" },
  'features/scrivenings/index.ts': { count: 1, why: "the phone's sliding sidebars" },
  'features/scrivenings/scriveningsView.ts': { count: 1, why: "the phone's floating bar" },
  'features/report/index.ts': { count: 1, why: "the phone's sliding sidebars" },
  'features/report/reportView.ts': { count: 1, why: "the phone's floating bar" },
  'features/outliner/index.ts': { count: 1, why: "the phone's sliding sidebars" },
  'views/binderView.ts': { count: 2, why: "the phone's floating bar and its sliding sidebars" },
};

describe('the source: layout is decided in one place', () => {
  const files = listFiles(srcDir);

  it('asks Obsidian what kind of device it is only for what the device can do', () => {
    const found: Record<string, number> = {};
    for (const file of files) {
      const count = (codeOf(file).match(/\bPlatform\s*\.\s*is(Mobile|Phone|Tablet)\b/g) ?? []).length;
      if (count > 0) found[relative(file)] = count;
    }
    const expected = Object.fromEntries(Object.entries(CAPABILITY_CHECKS).map(([file, { count }]) => [file, count]));
    expect(found).toEqual(expected);
  });

  it('puts the touch-layout class on a screen only through the layout module', () => {
    for (const file of files) {
      const name = relative(file);
      const code = codeOf(file);
      // The tour is handed whether the touch layout is on, by welcome/index.ts, from the layout module.
      if (name === 'ui/layout.ts' || name === 'features/welcome/tour.ts') continue;
      // The writing modes' exit button is there where the device has no Escape key: a capability (modes/index.ts).
      if (name === 'features/modes/chrome.ts') continue;
      expect(/['"]spellbook-is-mobile['"]/.test(code), name).toBe(false);
      expect(/['"]spellbook-is-desktop-layout['"]/.test(code), name).toBe(false);
    }
    expect(codeOf(path.join(srcDir, 'features/welcome/index.ts'))).toMatch(/pageScreen\(activeDocument, Platform\.isPhone, isTouchLayout\(\)/);
  });

  it('keeps the decision itself free of Obsidian, so it is tested on its own', () => {
    const code = codeOf(path.join(srcDir, 'core/layout.ts'));
    expect(/\bfrom\s+['"]/.test(code)).toBe(false);
  });

  it('lets the touch-screen sizing of the stylesheet step aside for the desktop layout', () => {
    let guarded = 0;
    for (const name of STYLE_FILES) {
      const css = readFileSync(path.join(srcDir, 'styles', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const block of css.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/g)) {
        const body = block[1] ?? '';
        for (const head of body.matchAll(/([^{}]+)\{/g)) {
          for (const selector of (head[1] ?? '').split(',').map((part) => part.trim())) {
            expect(selector, `${name}: ${selector}`).toMatch(/^\.spellbook-[\w-]+:not\(:where\(\.spellbook-is-desktop-layout\)\) /);
            guarded += 1;
          }
        }
      }
    }
    expect(guarded).toBeGreaterThan(80);
  });
});
