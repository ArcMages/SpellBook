import { describe, expect, it } from 'vitest';
import { DEFAULT_NARRATIVE_SPACING, narrativeOrder } from '../../src/core/timeline';
import type { NarrativeItem } from '../../src/core/timeline';
import { HEBREW, POINTED_AS_STORED, POINTED_AS_TYPED, deepFreeze, event, sceneEvent } from './helpers';

const manuscript = [
  'Manuscript/Opening.md',
  'Manuscript/The Letter.md',
  `Manuscript/${HEBREW.opening}.md`,
  'Manuscript/Ending.md',
];

const titles = (items: readonly NarrativeItem[]): string[] => items.map((item) => item.event.title);

describe('narrativeOrder', () => {
  it('orders events by the place of the scene they link, not by their date', () => {
    const events = [
      event('Told last', { date: 1900, scenes: ['[[Ending]]'] }),
      event('Told first', { date: 1950, scenes: ['[[Opening]]'] }),
      event('Told second', { date: 1925, scenes: ['[[The Letter]]'] }),
    ];
    const order = narrativeOrder(events, manuscript);
    expect(titles(order)).toEqual(['Told first', 'Told second', 'Told last']);
    expect(order.map((item) => item.sceneIndex)).toEqual([0, 1, 3]);
    expect(order.map((item) => item.scene)).toEqual(['Manuscript/Opening.md', 'Manuscript/The Letter.md', 'Manuscript/Ending.md']);
  });

  it('uses the earliest scene of the manuscript among several links, however they are listed', () => {
    const events = [
      event('Flashback', { date: 1900, scenes: ['[[Ending]]', '[[The Letter]]'] }),
      event('Start', { date: 1950, scenes: ['[[Opening]]', '[[Ending]]'] }),
    ];
    const order = narrativeOrder(events, manuscript);
    expect(titles(order)).toEqual(['Start', 'Flashback']);
    expect(order[1]).toMatchObject({ sceneIndex: 1, scene: 'Manuscript/The Letter.md' });
  });

  it('puts events that link no scene after the others, by date, the undated last', () => {
    const events = [
      event('Loose late', { date: 1990 }),
      event('Undated loose', {}),
      event('Linked', { date: 2000, scenes: ['[[Ending]]'] }),
      event('Loose early', { date: '1066-10-14' }),
      event('Broken link', { date: 1500, scenes: ['[[No such scene]]'] }),
      event('Undated loose 2', { date: 'soon' }),
    ];
    const order = narrativeOrder(events, manuscript);
    expect(titles(order)).toEqual(['Linked', 'Loose early', 'Broken link', 'Loose late', 'Undated loose', 'Undated loose 2']);
    expect(order.slice(1).every((item) => item.sceneIndex === null && item.scene === null)).toBe(true);
  });

  it('orders events at the same scene by date, the undated last, then as they came', () => {
    const events = [
      event('c', { scenes: ['[[Opening]]'] }),
      event('b', { date: 1950, scenes: ['[[Opening]]'] }),
      event('a', { date: 1900, scenes: ['[[Opening]]'] }),
      event('b2', { date: 1950, scenes: ['[[Opening]]'] }),
    ];
    expect(titles(narrativeOrder(events, manuscript))).toEqual(['a', 'b', 'b2', 'c']);
  });

  it('puts a dated scene at its own place in the manuscript', () => {
    const events = [
      event('About the ending', { date: 1900, scenes: ['[[Ending]]'] }),
      sceneEvent('The Letter', { date: 1999 }),
      sceneEvent('Opening', { date: 2001 }),
      sceneEvent('Not in the binder', { date: 1800 }),
    ];
    const order = narrativeOrder(events, manuscript);
    expect(titles(order)).toEqual(['Opening', 'The Letter', 'About the ending', 'Not in the binder']);
    expect(order[0]).toMatchObject({ sceneIndex: 0, scene: 'Manuscript/Opening.md' });
    expect(order[3]).toMatchObject({ sceneIndex: null, scene: null });
  });

  it('spaces the events evenly', () => {
    const events = [1, 2, 3, 4].map((index) => event(`E${index}`, { date: 1900 + index }));
    expect(narrativeOrder(events, manuscript).map((item) => item.position)).toEqual([
      0,
      DEFAULT_NARRATIVE_SPACING,
      2 * DEFAULT_NARRATIVE_SPACING,
      3 * DEFAULT_NARRATIVE_SPACING,
    ]);
    expect(narrativeOrder(events, manuscript, { spacing: 100, offset: 24 }).map((item) => item.position)).toEqual([24, 124, 224, 324]);
    expect(narrativeOrder(events, manuscript, { spacing: Number.NaN }).map((item) => item.position)[1]).toBe(DEFAULT_NARRATIVE_SPACING);
  });

  it('follows links to Hebrew scenes, whichever way their letters are stored', () => {
    const scenes = ['Manuscript/First.md', `Manuscript/${POINTED_AS_STORED}.md`, `Manuscript/${HEBREW.opening}.md`];
    const events = [
      event(HEBREW.battle, { date: 1900, scenes: [`[[${HEBREW.opening}]]`] }),
      event(HEBREW.mixed, { date: 1950, scenes: [`[[${POINTED_AS_TYPED}]]`] }),
      sceneEvent(POINTED_AS_TYPED, { date: 2000 }), // the scene itself, its path stored the other way
    ];
    const order = narrativeOrder(events, scenes);
    expect(titles(order)).toEqual([HEBREW.mixed, POINTED_AS_TYPED, HEBREW.battle]);
    expect(order.map((item) => item.sceneIndex)).toEqual([1, 1, 2]);
    expect(order[0]?.event.title).toBe(HEBREW.mixed); // titles come through untouched
  });

  it('uses the link resolver it is given', () => {
    const events = [
      event('A', { date: 1900, scenes: ['[[Alias for the ending]]'] }),
      event('B', { date: 1950, scenes: ['[[The Letter]]'] }),
    ];
    const asked: string[] = [];
    const order = narrativeOrder(events, manuscript, {
      resolveLink: (link) => {
        asked.push(link);
        return link === 'Alias for the ending' ? 'Manuscript/Ending.md' : null;
      },
    });
    expect(asked).toEqual(['Alias for the ending', 'The Letter']);
    expect(titles(order)).toEqual(['A', 'B']); // B's link was not resolved, so it follows by date
    expect(order.map((item) => item.sceneIndex)).toEqual([3, null]);
  });

  it('copes with nothing, with no manuscript, and with a scene listed twice', () => {
    expect(narrativeOrder([], manuscript)).toEqual([]);
    const events = [event('B', { date: 1950, scenes: ['[[Opening]]'] }), event('A', { date: 1900 })];
    expect(titles(narrativeOrder(events, []))).toEqual(['A', 'B']);
    const twice = ['Manuscript/Ending.md', 'Manuscript/Opening.md', 'Manuscript/Ending.md'];
    expect(narrativeOrder([event('E', { scenes: ['[[Ending]]'] })], twice)[0]?.sceneIndex).toBe(0);
  });

  it('does not change what it is given', () => {
    const events = deepFreeze([event('B', { date: 1950, scenes: ['[[Ending]]'] }), event('A', { date: 1900, scenes: ['[[Opening]]'] })]);
    const frozenManuscript = deepFreeze([...manuscript]);
    expect(titles(narrativeOrder(events, frozenManuscript))).toEqual(['A', 'B']);
    expect(events.map((item) => item.title)).toEqual(['B', 'A']);
  });
});
