// Icons: Obsidian has renamed some over the years, so each is asked for by
// every name it has had.

import { afterEach, describe, expect, it } from 'vitest';
import { BINDER_ICON, FOLD_ICON, SWITCH_ICON, WARNING_ICON, showIcon } from '../src/ui/icons';
import { FakeElement, unknownIcons } from './obsidianStub';

function shown(...ids: string[]): FakeElement {
  const element = new FakeElement();
  showIcon(element as unknown as HTMLElement, ...ids);
  return element;
}

afterEach(() => {
  unknownIcons.clear();
});

describe('showIcon', () => {
  it('uses the preferred name when Obsidian knows it', () => {
    const element = shown('newer-name-1', 'older-name-1');
    expect(element.icon).toBe('newer-name-1');
    expect(element.children).toHaveLength(1);
  });

  it('falls back to an older name on a version of Obsidian that does not know the new one', () => {
    unknownIcons.add('newer-name-2');
    expect(shown('newer-name-2', 'older-name-2').icon).toBe('older-name-2');
  });

  it('shows nothing, without failing, when Obsidian knows none of the names', () => {
    unknownIcons.add('newer-name-3');
    unknownIcons.add('older-name-3');
    const element = shown('newer-name-3', 'older-name-3');
    expect(element.icon).toBeNull();
    expect(element.children).toEqual([]);
  });

  it('does nothing without a name', () => {
    expect(shown().icon).toBeNull();
  });
});

describe('the icons the plugin uses', () => {
  it('are named, each with at least one name', () => {
    expect(BINDER_ICON).toMatch(/^[a-z-]+$/);
    for (const names of [FOLD_ICON, WARNING_ICON, SWITCH_ICON]) {
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(name).toMatch(/^[a-z-]+$/);
    }
    // The warning sign was renamed in Obsidian's icon set: both names are tried.
    expect(WARNING_ICON).toEqual(['triangle-alert', 'alert-triangle']);
  });
});
