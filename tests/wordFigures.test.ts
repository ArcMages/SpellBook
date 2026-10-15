// The "Show word counts" setting: whether the everyday screens show word
// counts on this device (src/ui/wordFigures.ts), and the stylesheet rules
// that hide the counts the screens draw piece by piece.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceStorage } from '../src/core/devicePrefs';
import { isWordColumn } from '../src/core/outliner';
import {
  HIDES_WORD_COUNTS_CLASS,
  SHOW_WORDS_KEY,
  applyWordCountsClass,
  followWordCounts,
  onWordCountsChange,
  parseShowWords,
  setShowWordCounts,
  showsWordCounts,
  startWordFigures,
  stopWordFigures,
} from '../src/ui/wordFigures';
import { FakeElement } from './obsidianStub';

afterEach(() => {
  stopWordFigures();
  vi.restoreAllMocks();
});

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

const asElement = (element: FakeElement): HTMLElement => element as unknown as HTMLElement;

describe('the word count setting', () => {
  it('shows the counts until the writer switches them off', () => {
    expect(showsWordCounts()).toBe(true);
    startWordFigures(new MemoryStorage());
    expect(showsWordCounts()).toBe(true);
  });

  it('reads only "off" as off', () => {
    expect(parseShowWords('off')).toBe(false);
    for (const odd of [null, undefined, 'on', 'Off', '', 0, false, {}]) expect(parseShowWords(odd)).toBe(true);
  });

  it('keeps the choice on this device, storing nothing while the counts are shown', () => {
    const storage = new MemoryStorage();
    startWordFigures(storage);
    setShowWordCounts(false);
    expect(storage.values.get(SHOW_WORDS_KEY)).toBe('off');
    expect(showsWordCounts()).toBe(false);
    setShowWordCounts(true);
    expect(storage.values.has(SHOW_WORDS_KEY)).toBe(false);

    storage.values.set(SHOW_WORDS_KEY, 'off');
    startWordFigures(storage); // the next start
    expect(showsWordCounts()).toBe(false);
    stopWordFigures(); // let go of on unload
    expect(showsWordCounts()).toBe(true);
  });

  it('tells the open screens when it changes, and only then', () => {
    let told = 0;
    const stop = onWordCountsChange(() => told++);
    setShowWordCounts(true); // as it was
    expect(told).toBe(0);
    setShowWordCounts(false);
    setShowWordCounts(false);
    expect(told).toBe(1);
    stop();
    setShowWordCounts(true);
    expect(told).toBe(1);
  });

  it('survives a storage that fails, and a screen that fails to follow', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    startWordFigures({
      load: () => {
        throw new Error('no storage');
      },
      save: () => {
        throw new Error('no storage');
      },
    });
    expect(showsWordCounts()).toBe(true);
    let after = 0;
    onWordCountsChange(() => {
      throw new Error('a broken screen');
    });
    onWordCountsChange(() => after++);
    setShowWordCounts(false); // not kept, but in force until Obsidian closes
    expect(showsWordCounts()).toBe(false);
    expect(after).toBe(1); // the next screen is still told
    expect(error).toHaveBeenCalledTimes(3);
  });

  it('puts its class on a screen, and keeps it in step for as long as the screen lives', () => {
    const root = new FakeElement('div');
    const callbacks: Array<() => unknown> = [];
    let redrawn = 0;
    followWordCounts({ register: (callback) => void callbacks.push(callback) }, asElement(root), () => redrawn++);
    expect(root.hasClass(HIDES_WORD_COUNTS_CLASS)).toBe(false);
    setShowWordCounts(false);
    expect(root.hasClass(HIDES_WORD_COUNTS_CLASS)).toBe(true);
    expect(redrawn).toBe(1);
    // The screen closes: it no longer follows.
    for (const callback of callbacks) callback();
    setShowWordCounts(true);
    expect(root.hasClass(HIDES_WORD_COUNTS_CLASS)).toBe(true);
    expect(redrawn).toBe(1);
    applyWordCountsClass(asElement(root));
    expect(root.hasClass(HIDES_WORD_COUNTS_CLASS)).toBe(false);
  });

  it('knows the outliner\'s columns of words', () => {
    expect(['words', 'target', 'readTime'].every((id) => isWordColumn(id as never))).toBe(true);
    expect(['number', 'name', 'tasks', 'synopsis', 'created', 'prop:words'].some((id) => isWordColumn(id as never))).toBe(false);
  });
});

describe('the stylesheet', () => {
  const stylesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/styles');
  const css = (name: string): string => readFileSync(path.join(stylesDir, name), 'utf8');
  /** The body of the rule whose selectors include every one given. */
  function ruleFor(file: string, ...selectors: string[]): string {
    const rules = [...css(file).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const found = rules.find(([, head]) => {
      const listed = (head ?? '').split(',').map((selector) => selector.trim());
      return selectors.every((selector) => listed.includes(selector));
    });
    if (!found) throw new Error(`${file} has no rule for ${selectors.join(', ')}`);
    return found[2] ?? '';
  }

  it('hides the counts that the screens draw piece by piece, while the class is on', () => {
    const hides = `.${HIDES_WORD_COUNTS_CLASS}`;
    expect(ruleFor('binder.css', `.spellbook-binder${hides} .spellbook-count-outer`)).toMatch(/display:\s*none/);
    expect(ruleFor('corkboard.css', `.spellbook-board${hides} .spellbook-card-words`, `.spellbook-board${hides} .spellbook-card-target`)).toMatch(
      /display:\s*none/,
    );
    expect(ruleFor('scrivenings.css', `.spellbook-scrivenings${hides} .spellbook-scrivenings-count`)).toMatch(/display:\s*none/);
  });
});
