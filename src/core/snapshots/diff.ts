// Comparing two versions of a scene: what was added and what was removed,
// paragraph by paragraph and, inside a paragraph that changed, word by word.
//
// It works in two steps. First the paragraphs of the two texts are lined up
// (a paragraph is a line of text; empty lines are left out). Paragraphs that
// are the same in both are "same". Between them, a paragraph of the old text
// is paired with the paragraph of the new text that is most of the same
// words, and the pair is compared word by word; what finds no partner is a
// paragraph that was removed or added whole.
//
// Lining up is done with Myers' method, which takes time in proportion to
// how much differs, not to the size of the texts: two versions of a long
// scene that differ in a few sentences are compared in a moment. Where two
// pieces have next to nothing in common the search is given up after a fixed
// amount of work, and the one is shown as removed and the other as added,
// so that even the worst case cannot hold up the screen.
//
// Words are told apart from spaces and punctuation by what kind of character
// they are made of, in any script: Hebrew is compared exactly as English is.

export type DiffKind = 'same' | 'added' | 'removed';

/** A run of text inside a paragraph that changed. */
export interface DiffPiece {
  readonly kind: DiffKind;
  readonly text: string;
}

/** One paragraph of the comparison. */
export type DiffBlock =
  | { readonly kind: 'same'; readonly text: string }
  | { readonly kind: 'added'; readonly text: string }
  | { readonly kind: 'removed'; readonly text: string }
  /** A paragraph that is in both texts, with words added and removed: the pieces in reading order. */
  | { readonly kind: 'changed'; readonly pieces: readonly DiffPiece[] };

/** Two texts compared. */
export interface TextDiff {
  readonly blocks: readonly DiffBlock[];
  /** How many words the new text has that the old one has not. */
  readonly added: number;
  /** How many words the old text has that the new one has not. */
  readonly removed: number;
}

/** How far apart two sequences may be before lining them up is given up. */
export const MAX_DIFF_DISTANCE = 1500;

/** How alike two paragraphs must be (0 to 1) to be shown as one paragraph that changed. */
export const PAIR_SIMILARITY = 0.4;

/** How many paragraphs ahead a partner for a changed paragraph is looked for. */
const PAIR_LOOKAHEAD = 4;

// ------------------------------------------------------------ lining up

/** One step of a comparison of two sequences: the place in the old one, in the new one, or in both. */
export interface SequenceStep {
  readonly kind: DiffKind;
  /** The place in the old sequence; -1 for something added. */
  readonly before: number;
  /** The place in the new sequence; -1 for something removed. */
  readonly after: number;
}

/**
 * Line up two sequences of strings. The steps come in reading order; where
 * the sequences differ, what was removed comes before what was added.
 *
 * @param limit how far apart the two may be before the search is given up
 *   (the part that differs is then all removed and all added)
 */
export function diffSequences(
  before: readonly string[],
  after: readonly string[],
  limit: number = MAX_DIFF_DISTANCE,
): SequenceStep[] {
  // Numbers compare faster than strings: every distinct string gets one.
  const ids = new Map<string, number>();
  const idOf = (text: string): number => {
    let id = ids.get(text);
    if (id === undefined) {
      id = ids.size;
      ids.set(text, id);
    }
    return id;
  };
  const a = Int32Array.from(before, idOf);
  const b = Int32Array.from(after, idOf);

  // What the two start and end with alike needs no search.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const steps: SequenceStep[] = [];
  for (let at = 0; at < start; at++) steps.push({ kind: 'same', before: at, after: at });
  const middle = middleSteps(a, start, endA, b, start, endB, limit);
  // Within a stretch that differs: first what went, then what came.
  let removed: SequenceStep[] = [];
  let added: SequenceStep[] = [];
  const flush = (): void => {
    for (const step of removed) steps.push(step);
    for (const step of added) steps.push(step);
    removed = [];
    added = [];
  };
  for (const step of middle) {
    if (step.kind === 'removed') removed.push(step);
    else if (step.kind === 'added') added.push(step);
    else {
      flush();
      steps.push(step);
    }
  }
  flush();
  for (let at = endA, other = endB; at < a.length; at++, other++) steps.push({ kind: 'same', before: at, after: other });
  return steps;
}

/** Myers' search over a[a0..a1) and b[b0..b1), which share neither a start nor an end. */
function middleSteps(
  a: Int32Array,
  a0: number,
  a1: number,
  b: Int32Array,
  b0: number,
  b1: number,
  limit: number,
): SequenceStep[] {
  const n = a1 - a0;
  const m = b1 - b0;
  const all = (): SequenceStep[] => {
    const steps: SequenceStep[] = [];
    for (let at = a0; at < a1; at++) steps.push({ kind: 'removed', before: at, after: -1 });
    for (let at = b0; at < b1; at++) steps.push({ kind: 'added', before: -1, after: at });
    return steps;
  };
  if (n === 0 || m === 0) return all();

  const most = Math.min(n + m, Math.max(1, Math.floor(limit)));
  const offset = most + 1;
  // furthest[k + offset]: how far along the old sequence the best path on diagonal k has come.
  const furthest = new Int32Array(2 * most + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= most && found < 0; d++) {
    trace.push(furthest.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (furthest[offset + k - 1] as number) < (furthest[offset + k + 1] as number));
      let x = down ? (furthest[offset + k + 1] as number) : (furthest[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      furthest[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return all();

  // Walk the path back from the end, one round of the search at a time.
  const back: SequenceStep[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const row = trace[d] as Int32Array;
    // row holds diagonals -d-1 .. d+1 of the round before this one.
    const at = (k: number): number => row[k + d + 1] as number;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    // Forwards, a round is one step down or across and then as far along
    // the diagonal as the two agree; backwards, the diagonal comes first.
    while (x > previousX && y > previousY) {
      x--;
      y--;
      back.push({ kind: 'same', before: a0 + x, after: b0 + y });
    }
    if (down) {
      y--;
      back.push({ kind: 'added', before: -1, after: b0 + y });
    } else {
      x--;
      back.push({ kind: 'removed', before: a0 + x, after: -1 });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    back.push({ kind: 'same', before: a0 + x, after: b0 + y });
  }
  return back.reverse();
}

// ---------------------------------------------------------------- words

/** A word, a number or a punctuation mark, with the space that stands before it. */
interface Token {
  /** The spaces before it; empty for the first of a paragraph and for marks that follow a word directly. */
  readonly lead: string;
  readonly text: string;
  readonly word: boolean;
}

// A word is a run of letters, digits and accent marks (Hebrew points
// included), which may be joined by one apostrophe, hyphen or underscore
// ("don't", "well-known"). The joiners include the curly apostrophe
// (U+2019), the Hebrew geresh and gershayim (U+05F3, U+05F4) and the Hebrew
// hyphen, the maqaf (U+05BE). Anything else that is not a space is a mark of
// its own.
const WORD_CHARACTER = '[\\p{L}\\p{N}\\p{M}]';
const JOINERS = `'_\\-${String.fromCharCode(0x2019, 0x05f3, 0x05f4, 0x05be)}`;
const TOKEN = new RegExp(`(\\s*)(${WORD_CHARACTER}+(?:[${JOINERS}]${WORD_CHARACTER}+)*|\\S)`, 'gu');
const STARTS_A_WORD = /^[\p{L}\p{N}]/u;

function tokensOf(paragraph: string): Token[] {
  const tokens: Token[] = [];
  for (const match of paragraph.matchAll(TOKEN)) {
    const text = match[2] ?? '';
    tokens.push({ lead: tokens.length === 0 ? '' : (match[1] ?? ''), text, word: STARTS_A_WORD.test(text) });
  }
  return tokens;
}

/** How many words a piece of text has, counted the way the comparison counts them. */
export function diffWordCount(text: string): number {
  let words = 0;
  for (const token of tokensOf(text)) if (token.word) words++;
  return words;
}

interface WordDiff {
  readonly pieces: DiffPiece[];
  readonly added: number;
  readonly removed: number;
  /** How many words the two have in common. */
  readonly shared: number;
}

function diffWords(before: readonly Token[], after: readonly Token[]): WordDiff {
  const steps = diffSequences(
    before.map((token) => token.text),
    after.map((token) => token.text),
  );
  const pieces: DiffPiece[] = [];
  let added = 0;
  let removed = 0;
  let shared = 0;
  let kind: DiffKind | null = null;
  let text = '';
  for (const step of steps) {
    const token = (step.kind === 'removed' ? before[step.before] : after[step.after]) as Token;
    if (token.word) {
      if (step.kind === 'same') shared++;
      else if (step.kind === 'added') added++;
      else removed++;
    }
    // The space before a word goes with the word. A word that both texts
    // have keeps its space when either of them has one there, so that each
    // side reads as it was written whatever came or went in front of it.
    const lead = step.kind === 'same' && token.lead === '' ? (before[step.before] as Token).lead : token.lead;
    if (step.kind === kind) {
      text += lead + token.text;
      continue;
    }
    if (kind !== null) pieces.push({ kind, text });
    kind = step.kind;
    text = lead + token.text;
  }
  if (kind !== null) pieces.push({ kind, text });
  return { pieces, added, removed, shared };
}

// ----------------------------------------------------------- paragraphs

/** The paragraphs of a text: its lines, without the empty ones and without spaces at their ends. */
export function paragraphsOf(text: string): string[] {
  const paragraphs: string[] = [];
  for (const line of text.split('\n')) {
    const tidy = line.trim();
    if (tidy !== '') paragraphs.push(tidy);
  }
  return paragraphs;
}

/**
 * Compare two texts: `before` is the older one. The blocks come in reading
 * order; what was removed comes before what took its place.
 */
export function diffTexts(before: string, after: string): TextDiff {
  const old = paragraphsOf(before);
  const now = paragraphsOf(after);
  const steps = diffSequences(old, now);
  const blocks: DiffBlock[] = [];
  let added = 0;
  let removed = 0;

  const settle = (gone: readonly string[], come: readonly string[]): void => {
    const goneTokens = gone.map(tokensOf);
    const comeTokens = come.map(tokensOf);
    let next = 0;
    for (let at = 0; at < gone.length; at++) {
      const mine = goneTokens[at] as Token[];
      const myWords = mine.filter((token) => token.word).length;
      let partner = -1;
      let best: WordDiff | null = null;
      for (let other = next; other < come.length && other < next + PAIR_LOOKAHEAD; other++) {
        const theirs = comeTokens[other] as Token[];
        const candidate = diffWords(mine, theirs);
        const words = myWords + theirs.filter((token) => token.word).length;
        const alike = words === 0 ? 0 : (2 * candidate.shared) / words;
        if (alike >= PAIR_SIMILARITY && (best === null || candidate.shared > best.shared)) {
          best = candidate;
          partner = other;
        }
      }
      if (best === null) {
        blocks.push({ kind: 'removed', text: gone[at] as string });
        removed += myWords;
        continue;
      }
      for (; next < partner; next++) {
        blocks.push({ kind: 'added', text: come[next] as string });
        added += (comeTokens[next] as Token[]).filter((token) => token.word).length;
      }
      blocks.push({ kind: 'changed', pieces: best.pieces });
      added += best.added;
      removed += best.removed;
      next = partner + 1;
    }
    for (; next < come.length; next++) {
      blocks.push({ kind: 'added', text: come[next] as string });
      added += (comeTokens[next] as Token[]).filter((token) => token.word).length;
    }
  };

  let gone: string[] = [];
  let come: string[] = [];
  for (const step of steps) {
    if (step.kind === 'removed') gone.push(old[step.before] as string);
    else if (step.kind === 'added') come.push(now[step.after] as string);
    else {
      if (gone.length > 0 || come.length > 0) settle(gone, come);
      gone = [];
      come = [];
      blocks.push({ kind: 'same', text: now[step.after] as string });
    }
  }
  if (gone.length > 0 || come.length > 0) settle(gone, come);
  return { blocks, added, removed };
}

// -------------------------------------------------------------- folding

/** A stretch of the comparison as it is shown: a paragraph, or a run of unchanged paragraphs folded away. */
export type DiffRow =
  | { readonly kind: 'block'; readonly block: DiffBlock }
  | { readonly kind: 'fold'; readonly blocks: readonly DiffBlock[] };

/**
 * Fold long runs of unchanged paragraphs away, so that what changed in a long
 * scene can be found. `context` unchanged paragraphs are kept on either side
 * of every change; a run is only folded when that hides at least two.
 */
export function foldUnchanged(blocks: readonly DiffBlock[], context = 1): DiffRow[] {
  const keep = Math.max(0, Math.floor(context));
  const rows: DiffRow[] = [];
  let at = 0;
  while (at < blocks.length) {
    const block = blocks[at] as DiffBlock;
    if (block.kind !== 'same') {
      rows.push({ kind: 'block', block });
      at++;
      continue;
    }
    let end = at;
    while (end < blocks.length && (blocks[end] as DiffBlock).kind === 'same') end++;
    // No context is owed to the start or the end of the text.
    const head = at === 0 ? 0 : keep;
    const tail = end === blocks.length ? 0 : keep;
    const hidden = end - at - head - tail;
    if (hidden < 2) {
      for (let each = at; each < end; each++) rows.push({ kind: 'block', block: blocks[each] as DiffBlock });
    } else {
      for (let each = at; each < at + head; each++) rows.push({ kind: 'block', block: blocks[each] as DiffBlock });
      rows.push({ kind: 'fold', blocks: blocks.slice(at + head, end - tail) });
      for (let each = end - tail; each < end; each++) rows.push({ kind: 'block', block: blocks[each] as DiffBlock });
    }
    at = end;
  }
  return rows;
}

/** What a paragraph looked like before (`side` "before") or looks like now ("after"): the pieces of that side only. */
export function sideOf(block: DiffBlock, side: 'before' | 'after'): readonly DiffPiece[] {
  const hidden: DiffKind = side === 'before' ? 'added' : 'removed';
  if (block.kind === 'changed') {
    const pieces = block.pieces.filter((piece) => piece.kind !== hidden);
    // A side does not begin with the space that stood after what is not on it.
    const first = pieces[0];
    if (first) pieces[0] = { kind: first.kind, text: first.text.replace(/^\s+/, '') };
    return pieces.filter((piece) => piece.text !== '');
  }
  return block.kind === hidden ? [] : [{ kind: block.kind, text: block.text }];
}
