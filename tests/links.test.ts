// Links in a note's text, and pointing them at a renamed note (src/core/links.ts).

import { describe, expect, it } from 'vitest';
import { linkPlaces, renamedLinkPath, retargetLinks, retargetLinksInValue } from '../src/core/links';

const toVoss = (path: string): string | null => (path === 'Mara' || path === 'Mara.md' || path === 'World/Mara' ? renamedLinkPath(path, 'Mara Voss') : null);

describe('linkPlaces', () => {
  it('finds the part of each link that names its note', () => {
    const text = 'A [[Mara]] b [[World/Mara|the keeper]] c ![[Mara#Youth]] d [[Mara^block]] e [x](Mara.md) f [y](<My Note.md#Top>)';
    const places = linkPlaces(text);
    expect(places.map((place) => text.slice(place.from, place.to))).toEqual(['Mara', 'World/Mara', 'Mara', 'Mara', 'Mara.md', 'My Note.md']);
    expect(places.map((place) => place.path)).toEqual(['Mara', 'World/Mara', 'Mara', 'Mara', 'Mara.md', 'My Note.md']);
    expect(places.map((place) => place.kind)).toEqual(['wiki', 'wiki', 'wiki', 'wiki', 'markdown', 'markdown']);
  });

  it('reads a markdown link\'s address as the vault does, and leaves out web addresses and links within the note', () => {
    expect(linkPlaces('[a](Mara%20Voss.md "title")').map((place) => place.path)).toEqual(['Mara Voss.md']);
    expect(linkPlaces('[a](https://example.com) [b](#Top) [c](mailto:x@y.z)')).toEqual([]);
  });

  it('skips links in code, and an escaped bar in a table', () => {
    expect(linkPlaces('`[[Mara]]` and\n```\n[[Mara]]\n```\n')).toEqual([]);
    const text = '| [[Mara\\|her]] |';
    expect(linkPlaces(text).map((place) => text.slice(place.from, place.to))).toEqual(['Mara']);
  });

  it('finds Hebrew names too', () => {
    expect(linkPlaces('ראו [[מארה|אותה]].').map((place) => place.path)).toEqual(['מארה']);
  });
});

describe('renamedLinkPath', () => {
  it('changes the last part only, and keeps a ".md" ending', () => {
    expect(renamedLinkPath('Mara', 'Mara Voss')).toBe('Mara Voss');
    expect(renamedLinkPath('World/Characters/Mara', 'Mara Voss')).toBe('World/Characters/Mara Voss');
    expect(renamedLinkPath('Mara.md', 'Mara Voss')).toBe('Mara Voss.md');
  });
});

describe('retargetLinks', () => {
  it('changes only the part that names the note, and leaves everything else as written', () => {
    const text = 'See [[Mara]], [[World/Mara|her]], ![[Mara#Youth]], [[Saltwick]], `[[Mara]]` and [the keeper](Mara.md).';
    expect(retargetLinks(text, toVoss)).toEqual({
      text: 'See [[Mara Voss]], [[World/Mara Voss|her]], ![[Mara Voss#Youth]], [[Saltwick]], `[[Mara]]` and [the keeper](Mara%20Voss.md).',
      count: 4,
    });
  });

  it('gives the text back untouched when no link is to change', () => {
    const text = 'Mara walks. [[Saltwick]]';
    expect(retargetLinks(text, toVoss)).toEqual({ text, count: 0 });
  });

  it('writes spaces as they are between "<" and ">"', () => {
    expect(retargetLinks('[a](<Mara.md>)', toVoss).text).toBe('[a](<Mara Voss.md>)');
  });
});

describe('retargetLinksInValue', () => {
  it('changes links in strings, lists and nested values of a property, and leaves the rest alone', () => {
    const value = { a: ['[[Mara]]', 3, '[[Saltwick]]'], b: { c: 'with [[Mara|her]]' }, d: true };
    expect(retargetLinksInValue(value, toVoss)).toEqual({
      value: { a: ['[[Mara Voss]]', 3, '[[Saltwick]]'], b: { c: 'with [[Mara Voss|her]]' }, d: true },
      count: 2,
    });
    const untouched = ['[[Saltwick]]'];
    expect(retargetLinksInValue(untouched, toVoss).value).toBe(untouched);
  });
});
