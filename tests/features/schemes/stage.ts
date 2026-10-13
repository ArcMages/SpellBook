// A stage for testing the colour schemes as they are plugged into the
// plugin: the real feature, registered through the registry, with the shared
// stand-in plugin, app and page (tests/obsidianStub.ts,
// tests/fakeObsidianApp.ts) and timers under the test's control.
//
// The shared stand-in for an element keeps its styles as a plain list of
// names and values. A scheme sets CSS variables, which a browser only takes
// through setProperty and its kin; the stage gives the stand-in body those
// three, kept out of sight so that the list still holds nothing but what was
// set. `undressBody()` puts the body back as the other tests expect it.

import type { Plugin as ObsidianPlugin } from 'obsidian';
import type { ColourScheme } from '../../../src/core/schemes';
import { schemesFeature } from '../../../src/features/schemes/index';
import { SchemePickerModal } from '../../../src/features/schemes/picker';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { ManualTimers } from '../../memoryVault';
import { Modal as StubModal, Notice as StubNotice, Plugin as StubPlugin, fakeDocument } from '../../obsidianStub';
import type { ButtonComponent, FakeElement, StubCommand } from '../../obsidianStub';
import { MemoryDeviceStorage, TODAY, makeStore } from '../../storeHarness';

const STYLE_METHODS = ['setProperty', 'removeProperty', 'getPropertyValue'] as const;

/** How often the body's variables were written, taken away and read, since the last `forgetWrites()`. */
export const writes = { set: 0, removed: 0, read: 0 };

export function forgetWrites(): void {
  writes.set = 0;
  writes.removed = 0;
  writes.read = 0;
}

/** The stand-in body, able to take CSS variables the way a browser's does. */
export function dressableBody(): FakeElement {
  const body = fakeDocument.body;
  const style = body.style;
  const methods: Record<(typeof STYLE_METHODS)[number], (...args: string[]) => unknown> = {
    setProperty: (name = '', value = '') => {
      writes.set++;
      style[name] = value;
    },
    removeProperty: (name = '') => {
      writes.removed++;
      const before = style[name] ?? '';
      delete style[name];
      return before;
    },
    getPropertyValue: (name = '') => {
      writes.read++;
      return style[name] ?? '';
    },
  };
  for (const name of STYLE_METHODS) {
    Object.defineProperty(style, name, { value: methods[name], enumerable: false, configurable: true, writable: true });
  }
  return body;
}

/** Put the stand-in body back: no variables, no classes, and no more than the shared stand-in has. */
export function undressBody(): void {
  const body = fakeDocument.body;
  const style = body.style as Record<string, unknown>;
  for (const name of Object.keys(style)) delete style[name];
  for (const name of STYLE_METHODS) delete style[name];
  body.classes.clear();
  StubModal.opened.length = 0;
  StubNotice.shown.length = 0;
  forgetWrites();
}

/** The variables set on the body itself, by name. */
export function variablesOn(body: FakeElement): Record<string, string> {
  return { ...body.style };
}

/** The plugin's own classes on the body, in alphabetical order. */
export function schemeClassesOn(body: FakeElement): string[] {
  return [...body.classes].filter((name) => name.startsWith('spellbook-')).sort();
}

export interface Wired {
  body: FakeElement;
  fake: FakeObsidian;
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  timers: ManualTimers;
  features: RegisteredFeatures;
  /** How often the device's id was asked for. */
  idsMade: () => number;
  command(id: string): StubCommand;
  /** Run "Choose colour scheme" and hand back the window it opened. */
  openPicker(): SchemePickerModal & StubPicker;
  /** Draw the feature's part of the settings into a place of its own. */
  openSettings(): { place: FakeElement; close: () => void };
  /** What Obsidian does when the plugin is switched off. */
  switchOff(): void;
}

/** What the stand-in list window offers the tests, next to what the real one has. */
export interface StubPicker {
  shownFor(query?: string): FakeElement[];
  pick(text: string): void;
  close(): void;
  isOpen: boolean;
  modalEl: FakeElement;
  inputEl: FakeElement;
}

/** The feature, registered the way the plugin registers it, on a device that remembers what `storage` holds. */
export function wire(storage: MemoryDeviceStorage = new MemoryDeviceStorage()): Wired {
  const body = dressableBody();
  const { store, vault, timers } = makeStore();
  const fake = new FakeObsidian();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  let ids = 0;
  // The colour schemes alone, so that what these tests count is their own;
  // the whole list is registered in tests/features.test.ts.
  const features = registerFeatures([schemesFeature], {
    plugin: plugin as unknown as ObsidianPlugin,
    app: fake.app,
    store,
    vault,
    storage,
    deviceId: () => {
      ids++;
      return 'testdevice';
    },
    clock: {
      today: () => TODAY,
      now: () => 1_000,
      setTimer: timers.set,
      nextFrame: (callback) => timers.set(() => callback(16), 16),
    },
    wordCounts: undefined as never, // the colour schemes count no words
    openNote: async () => false,
  });

  const command = (id: string): StubCommand => {
    const found = plugin.commands.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no command "${id}"`);
    return found;
  };
  return {
    body,
    fake,
    plugin,
    storage,
    timers,
    features,
    idsMade: () => ids,
    command,
    openPicker: () => {
      const before = StubModal.opened.length;
      command('choose-colour-scheme').callback?.();
      const opened = StubModal.opened[before];
      if (!(opened instanceof SchemePickerModal)) throw new Error('"Choose colour scheme" opened no picker');
      return opened as unknown as SchemePickerModal & StubPicker;
    },
    openSettings: () => {
      const section = features.settingsSections.find((candidate) => candidate.id === 'schemes');
      if (!section) throw new Error('no settings section');
      const place = fake.workspace.containerEl.createDiv();
      const cleanup = section.render(place as never);
      return { place, close: () => (typeof cleanup === 'function' ? cleanup() : undefined) };
    },
    switchOff: () => {
      // As in src/main.ts: the features are let go of first, then Obsidian
      // takes away what was registered through the plugin.
      features.release();
      plugin.unload();
      store.dispose();
    },
  };
}

/** The button of a scheme's row in the settings. */
export function buttonOf(place: FakeElement, name: string): ButtonComponent {
  const row = place.settings.find((candidate) => candidate.nameEl.text === name);
  const button = row?.components[0] as ButtonComponent | undefined;
  if (!button) throw new Error(`no row "${name}" with a button`);
  return button;
}

/** What a small picture of a scheme was painted with. */
export function swatchColours(swatch: FakeElement): Record<string, string | undefined> {
  const part = (cls: string): FakeElement | undefined => swatch.withClass(cls)[0];
  return {
    page: swatch.style['backgroundColor'],
    border: swatch.style['borderColor'],
    panel: part('spellbook-scheme-swatch-strip')?.style['backgroundColor'],
    ink: part('spellbook-scheme-swatch-letters')?.style['color'],
    accent: part('spellbook-scheme-swatch-dot')?.style['backgroundColor'],
  };
}

/** The same, as the scheme itself says it. */
export function coloursOf(scheme: ColourScheme): Record<string, string> {
  return { page: scheme.page, border: scheme.border, panel: scheme.panel, ink: scheme.ink, accent: scheme.accent };
}
