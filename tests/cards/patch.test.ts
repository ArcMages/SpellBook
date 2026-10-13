// Patches: a change to a note's properties written down as plain data.

import { describe, expect, it } from 'vitest';
import { applyFrontmatterPatch, isEmptyPatch } from '../../src/core/cards';
import type { FrontmatterPatch } from '../../src/core/cards';
import type { Frontmatter } from '../../src/core/types';
import { HEBREW, deepFreeze } from './helpers';

function scene(): Frontmatter {
  return {
    synopsis: HEBREW.synopsis,
    status: 'To do',
    label: HEBREW.anna,
    target: 1500,
    compile: true,
    order: 3,
    created: '2026-10-01',
    aliases: ['one', 'two'],
    'my-own-key': { nested: [1, 2, 3] },
  };
}

describe('isEmptyPatch', () => {
  it('tells a patch that changes nothing from one that does', () => {
    expect(isEmptyPatch({ set: {}, remove: [] })).toBe(true);
    expect(isEmptyPatch({ set: { status: 'Final' }, remove: [] })).toBe(false);
    expect(isEmptyPatch({ set: {}, remove: ['target'] })).toBe(false);
  });
});

describe('applyFrontmatterPatch', () => {
  it('sets and removes the named keys and reports that something changed', () => {
    const frontmatter = scene();
    const patch: FrontmatterPatch = deepFreeze({ set: { status: HEBREW.final, compile: false }, remove: ['target'] });
    expect(applyFrontmatterPatch(frontmatter, patch)).toBe(true);
    expect(frontmatter['status']).toBe(HEBREW.final);
    expect(frontmatter['compile']).toBe(false);
    expect('target' in frontmatter).toBe(false);
  });

  it('touches no other key, known or not', () => {
    const before = scene();
    const frontmatter = scene();
    applyFrontmatterPatch(frontmatter, { set: { status: 'Final' }, remove: ['target'] });
    for (const key of Object.keys(before)) {
      if (key === 'status' || key === 'target') continue;
      expect(frontmatter[key], key).toEqual(before[key]);
    }
  });

  it('keeps a changed key in its place and puts a new key at the end', () => {
    const frontmatter = scene();
    applyFrontmatterPatch(frontmatter, { set: { status: 'Final', edited: '2026-10-13' }, remove: [] });
    expect(Object.keys(frontmatter)).toEqual([...Object.keys(scene()), 'edited']);
  });

  it('reports no change when the properties already are that way', () => {
    const frontmatter = scene();
    const same: FrontmatterPatch = { set: { status: 'To do', label: HEBREW.anna, target: 1500 }, remove: ['edited'] };
    expect(applyFrontmatterPatch(frontmatter, same)).toBe(false);
    expect(frontmatter).toEqual(scene());
    expect(applyFrontmatterPatch(frontmatter, { set: {}, remove: [] })).toBe(false);
  });

  it('sets a key that is absent even to an empty value', () => {
    const frontmatter: Frontmatter = {};
    expect(applyFrontmatterPatch(frontmatter, { set: { label: '' }, remove: [] })).toBe(true);
    expect(frontmatter).toEqual({ label: '' });
  });

  it('stores Hebrew text exactly as given', () => {
    const frontmatter: Frontmatter = {};
    const text = `  ${HEBREW.synopsis}\n${HEBREW.letter}  `;
    applyFrontmatterPatch(frontmatter, { set: { synopsis: text }, remove: [] });
    expect(frontmatter['synopsis']).toBe(text);
  });
});
