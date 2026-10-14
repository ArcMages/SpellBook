// The idea boards engine: reading a Canvas file, writing a new one, turning
// text cards into file cards, and the cards' ids.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_BOARD_TEXT,
  boardId,
  boardProblems,
  countCards,
  readBoard,
  swapCards,
  textCards,
  writeBoard,
} from '../../../src/core/boards';
import type { NewBoard } from '../../../src/core/boards';

/** A board as Obsidian's Canvas writes one, with a key and a card of a kind this version does not know. */
const WRITTEN = [
  '{',
  '\t"nodes":[',
  '\t\t{"id":"g1","type":"group","x":-40,"y":-40,"width":800,"height":400,"label":"Act one"},',
  '\t\t{"id":"t1","type":"text","text":"# The storm\\nMara loses the boat.","x":0,"y":0,"width":250,"height":60,"color":"1"},',
  '\t\t{"id":"t2","type":"text","text":"סערה בנמל\\nמארה מאבדת את הסירה","x":300,"y":0,"width":250,"height":60},',
  '\t\t{"id":"f1","type":"file","file":"Novel/Manuscript/Opening.md","x":0,"y":200,"width":400,"height":400},',
  '\t\t{"id":"l1","type":"link","url":"https://example.org","x":600,"y":200,"width":400,"height":400},',
  '\t\t{"id":"z1","type":"sticker","x":0,"y":700,"width":10,"height":10,"shine":true}',
  '\t],',
  '\t"edges":[',
  '\t\t{"id":"e1","fromNode":"t1","fromSide":"right","toNode":"t2","toSide":"left","label":"then"},',
  '\t\t{"id":"e2","fromNode":"f1","toNode":"t1"}',
  '\t],',
  '\t"metadata":{"version":"1.0-1.0"}',
  '}',
].join('\n');

describe('reading a board', () => {
  it('reads every card and edge, whatever the kind of card, and the text of text cards', () => {
    const board = readBoard(WRITTEN);
    expect(board?.cards.map((card) => [card.id, card.type])).toEqual([
      ['g1', 'group'],
      ['t1', 'text'],
      ['t2', 'text'],
      ['f1', 'file'],
      ['l1', 'link'],
      ['z1', 'sticker'],
    ]);
    expect(board?.cards[1]?.text).toBe('# The storm\nMara loses the boat.');
    expect(board?.cards[3]?.file).toBe('Novel/Manuscript/Opening.md');
    expect(board?.edges).toEqual([
      { id: 'e1', fromNode: 't1', toNode: 't2', label: 'then' },
      { id: 'e2', fromNode: 'f1', toNode: 't1', label: '' },
    ]);
  });

  it('counts every card but the group boxes', () => {
    const board = readBoard(WRITTEN);
    expect(board && countCards(board)).toBe(5);
    expect(countCards(readBoard(EMPTY_BOARD_TEXT) ?? { cards: [], edges: [] })).toBe(0);
  });

  it('lists the text cards that hold words, top to bottom and then along the row', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'c', type: 'text', text: 'third', x: 0, y: 100, width: 10, height: 10 },
        { id: 'b', type: 'text', text: 'second', x: 50, y: 0, width: 10, height: 10 },
        { id: 'a', type: 'text', text: 'first', x: 0, y: 0, width: 10, height: 10 },
        { id: 'e', type: 'text', text: '   \n ', x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [],
    });
    const board = readBoard(text);
    expect(board && textCards(board).map((card) => card.text)).toEqual(['first', 'second', 'third']);
  });

  it('takes an empty file, and an empty object, for an empty board', () => {
    expect(readBoard('')).toEqual({ cards: [], edges: [] });
    expect(readBoard('{}')).toEqual({ cards: [], edges: [] });
    expect(readBoard(EMPTY_BOARD_TEXT)).toEqual({ cards: [], edges: [] });
  });

  it('is no board when the text is not a JSON object', () => {
    expect(readBoard('not json')).toBeNull();
    expect(readBoard('[1, 2]')).toBeNull();
    expect(readBoard('"text"')).toBeNull();
  });

  it('skips what cannot be read, and keeps the rest', () => {
    const text = JSON.stringify({
      nodes: [null, 'x', { id: 'a', type: 'text', text: 'ok', x: 0, y: 0, width: 1, height: 1 }, { id: 'b', type: 'text', x: 'left' }, { type: 'text' }],
      edges: [{ id: 'e', fromNode: 'a' }, 7],
    });
    expect(readBoard(text)?.cards.map((card) => card.id)).toEqual(['a']);
    expect(readBoard(text)?.edges).toEqual([]);
  });
});

describe('turning text cards into file cards', () => {
  it('keeps the place, the size and the colour, and every edge with it, under a new id', () => {
    const swap = swapCards(WRITTEN, [{ id: 't1', file: 'Novel/Manuscript/The storm.md' }]);
    expect(swap.swapped).toEqual(['t1']);
    expect(swap.missing).toEqual([]);
    const after = JSON.parse(swap.text ?? '') as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>>; metadata: unknown };
    const id = swap.ids.get('t1') ?? '';
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(after.nodes[1]).toEqual({ id, type: 'file', x: 0, y: 0, width: 250, height: 60, color: '1', file: 'Novel/Manuscript/The storm.md' });
    // The edges that joined the text card join the file card; everything else is as it was.
    const before = JSON.parse(WRITTEN) as { nodes: unknown[]; edges: Array<Record<string, unknown>>; metadata: unknown };
    expect(after.edges).toEqual([
      { ...before.edges[0], fromNode: id },
      { ...before.edges[1], toNode: id },
    ]);
    expect(after.nodes.filter((_, index) => index !== 1)).toEqual(before.nodes.filter((_, index) => index !== 1));
    expect(after.metadata).toEqual(before.metadata);
  });

  it('gives the file card an id no card or edge of the board has, so that an open Canvas draws it anew', () => {
    // Canvas follows a changed file card by card, by id: a text card it shows under the
    // same id stays a text card on screen, and its next save undoes the swap.
    const swap = swapCards(WRITTEN, [
      { id: 't1', file: 'Novel/Manuscript/The storm.md' },
      { id: 't2', file: 'Novel/World/Places/נמל.md' },
    ]);
    const after = JSON.parse(swap.text ?? '') as { nodes: Array<{ id: string }>; edges: Array<{ id: string; fromNode: string; toNode: string }> };
    const all = [...after.nodes.map((node) => node.id), ...after.edges.map((edge) => edge.id)];
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('t1');
    expect(all).not.toContain('t2');
    expect(after.edges[0]).toMatchObject({ fromNode: swap.ids.get('t1'), toNode: swap.ids.get('t2') });
  });

  it('writes the file the way Canvas does: one card or edge to a line', () => {
    const swap = swapCards(WRITTEN, [{ id: 't2', file: 'Novel/World/Places/נמל.md' }]);
    const lines = (swap.text ?? '').split('\n');
    expect(lines[0]).toBe('{');
    expect(lines[1]).toBe('\t"nodes":[');
    expect(lines).toContain(`\t\t{"id":"${swap.ids.get('t2') ?? ''}","type":"file","x":300,"y":0,"width":250,"height":60,"file":"Novel/World/Places/נמל.md"},`);
    expect(lines).toContain('\t"metadata":{"version":"1.0-1.0"}');
    expect(swap.text?.endsWith('}\n')).toBe(true);
  });

  it('leaves a card alone that is gone, or is no text card, and says so', () => {
    const swap = swapCards(WRITTEN, [
      { id: 'f1', file: 'x.md' },
      { id: 'gone', file: 'y.md' },
    ]);
    expect(swap).toEqual({ text: null, swapped: [], ids: new Map(), missing: ['f1', 'gone'] });
    expect(swapCards('not json', [{ id: 't1', file: 'x.md' }]).text).toBeNull();
  });

  it('puts a card on whole numbers when Canvas left it between two', () => {
    const text = JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'x', x: 10.6, y: -3.2, width: 250.4, height: 60 }], edges: [] });
    const after = JSON.parse(swapCards(text, [{ id: 'a', file: 'A.md' }]).text ?? '') as { nodes: Array<Record<string, unknown>> };
    expect(after.nodes[0]).toMatchObject({ x: 11, y: -3, width: 250, height: 60 });
  });
});

describe('writing a new board', () => {
  const board: NewBoard = {
    nodes: [
      { id: 'a', type: 'file', file: 'Novel/World/Characters/Mara.md', x: 0, y: 0, width: 280, height: 120, color: '5' },
      { id: 'b', type: 'text', text: 'Hello', x: 400, y: 0, width: 280, height: 120 },
      { id: 'g', type: 'group', label: 'Scenes', x: -40, y: -40, width: 800, height: 300 },
    ],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'knows' }],
  };

  it('writes valid JSON Canvas that reads back as it was made', () => {
    const text = writeBoard(board);
    expect(JSON.parse(text)).toEqual({ nodes: board.nodes, edges: board.edges });
    expect(readBoard(text)?.cards.map((card) => card.id)).toEqual(['a', 'b', 'g']);
  });

  it('refuses to write a board with an id used twice, a place off whole numbers, or an edge to nowhere', () => {
    expect(boardProblems(board)).toEqual([]);
    const twice: NewBoard = { nodes: board.nodes, edges: [{ id: 'a', fromNode: 'a', toNode: 'b' }] };
    expect(boardProblems(twice)).toHaveLength(1);
    expect(() => writeBoard(twice)).toThrow(/not valid/);
    const half: NewBoard = { nodes: [{ id: 'a', type: 'text', text: '', x: 0.5, y: 0, width: 10, height: 10 }], edges: [] };
    expect(() => writeBoard(half)).toThrow(/whole numbers/);
    const nowhere: NewBoard = { nodes: [board.nodes[0] as NewBoard['nodes'][number]], edges: [{ id: 'e', fromNode: 'a', toNode: 'x' }] };
    expect(() => writeBoard(nowhere)).toThrow(/does not join/);
  });

  it('an empty board is valid', () => {
    expect(writeBoard({ nodes: [], edges: [] })).toBe(EMPTY_BOARD_TEXT);
  });
});

describe('ids', () => {
  it('are sixteen hexadecimal digits, the same for the same seed, and never one that is taken', () => {
    const taken = new Set<string>();
    const first = boardId('scene:Novel/Manuscript/A.md', taken);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(boardId('scene:Novel/Manuscript/A.md', new Set())).toBe(first);
    const second = boardId('scene:Novel/Manuscript/A.md', taken);
    expect(second).not.toBe(first);
    expect(taken).toEqual(new Set([first, second]));
    // Many seeds, no clash.
    const many = new Set<string>();
    for (let i = 0; i < 2000; i++) boardId(`card ${i}`, many);
    expect(many.size).toBe(2000);
  });
});
