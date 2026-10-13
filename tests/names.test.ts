import { describe, expect, it } from 'vitest';
import { DEFAULT_NAME, MAX_NAME_BYTES, newFolderId, sameName, sanitiseFileName, tidyDisplayName, uniqueName } from '../src/core/names';
import { comparePaths } from '../src/core/paths';

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;
const char = (codePoint: number): string => String.fromCodePoint(codePoint);

describe('sanitiseFileName', () => {
  it('leaves an ordinary title alone', () => {
    expect(sanitiseFileName('The Letter')).toBe('The Letter');
    expect(sanitiseFileName("Don't Look Back (draft 2), really!")).toBe("Don't Look Back (draft 2), really!");
  });

  it('takes out every character Obsidian or iOS rejects', () => {
    const forbidden = ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']'];
    for (const bad of forbidden) {
      const cleaned = sanitiseFileName(`Night${bad}Train`);
      expect(cleaned, `character ${bad}`).toBe('Night Train');
    }
    const all = sanitiseFileName(`a${forbidden.join('')}b`);
    expect(all).toBe('a b');
    for (const bad of forbidden) expect(all).not.toContain(bad);
  });

  it('cleans realistic titles', () => {
    expect(sanitiseFileName('Chapter 1: The Letter')).toBe('Chapter 1 The Letter');
    expect(sanitiseFileName('Who? What? Why?')).toBe('Who What Why');
    expect(sanitiseFileName('Either/Or')).toBe('Either Or');
    expect(sanitiseFileName('[[Draft]] #3 ^note')).toBe('Draft 3 note');
    expect(sanitiseFileName('C:\\Users\\me')).toBe('C Users me');
  });

  it('trims, and squeezes runs of spaces, tabs and line breaks into one space', () => {
    expect(sanitiseFileName('   The   Letter  ')).toBe('The Letter');
    expect(sanitiseFileName('Line one\nLine two\tend')).toBe('Line one Line two end');
    expect(sanitiseFileName(`non${char(0x00a0)}breaking${char(0x202f)}spaces${char(0x3000)}here`)).toBe(
      'non breaking spaces here',
    );
  });

  it('never returns an empty name', () => {
    for (const empty of ['', '   ', '???', '/', '...', '. .', '#[]^', '\n\t']) {
      expect(sanitiseFileName(empty), JSON.stringify(empty)).toBe(DEFAULT_NAME);
    }
    expect(sanitiseFileName('', 'Untitled scene')).toBe('Untitled scene');
  });

  it('never starts with a dot and never ends with a dot or a space', () => {
    expect(sanitiseFileName('.hidden')).toBe('hidden');
    expect(sanitiseFileName('...and then')).toBe('and then');
    expect(sanitiseFileName('The End...')).toBe('The End');
    expect(sanitiseFileName('The End. ')).toBe('The End');
    expect(sanitiseFileName('v1.2 final')).toBe('v1.2 final'); // dots inside are fine
  });

  it('keeps Hebrew, Arabic, Chinese, Japanese and accented titles as typed', () => {
    for (const title of ['מכתב ראשון', 'الرسالة الأولى', '夜行列車', '夜の手紙', 'Señor Zoë à Paris', 'Ünïcödé']) {
      expect(sanitiseFileName(title)).toBe(title.normalize('NFC'));
    }
  });

  it('cleans a right-to-left title with forbidden characters', () => {
    expect(sanitiseFileName('פרק 1: המכתב?')).toBe('פרק 1 המכתב');
  });

  it('stores accented and pointed letters in one standard form', () => {
    const decomposed = 'Cafe' + char(0x0301); // e followed by a combining accent
    expect(sanitiseFileName(decomposed)).toBe('Caf' + char(0x00e9));
    const pointed = 'בְּרֵאשִׁית';
    expect(sanitiseFileName(pointed.normalize('NFD'))).toBe(pointed.normalize('NFC'));
  });

  it('removes invisible direction marks and control characters', () => {
    const marks = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
    for (const mark of marks) {
      expect(sanitiseFileName(`שלום${char(mark)} עולם`), `U+${mark.toString(16)}`).toBe('שלום עולם');
    }
    expect(sanitiseFileName(`a${char(0)}b${char(7)}c${char(0x7f)}d`)).toBe('abcd');
  });

  it('shortens a very long title without cutting a character in half', () => {
    const latin = sanitiseFileName('x'.repeat(1000));
    expect(utf8Bytes(latin)).toBe(MAX_NAME_BYTES);

    const hebrew = sanitiseFileName('ש'.repeat(1000));
    expect(utf8Bytes(hebrew)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect(hebrew).toBe('ש'.repeat(MAX_NAME_BYTES / 2));

    const cjk = sanitiseFileName('夜'.repeat(1000));
    expect(utf8Bytes(cjk)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect([...cjk].every((c) => c === '夜')).toBe(true);

    const emoji = sanitiseFileName('📖'.repeat(1000));
    expect(utf8Bytes(emoji)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect([...emoji].every((c) => c === '📖')).toBe(true); // no broken half of an emoji
    expect([...emoji]).toHaveLength(MAX_NAME_BYTES / 4);
  });

  it('does not leave a trailing space where a long title was cut', () => {
    const title = `${'x'.repeat(MAX_NAME_BYTES - 1)} tail`;
    const cleaned = sanitiseFileName(title);
    expect(cleaned).toBe('x'.repeat(MAX_NAME_BYTES - 1));
  });
});

describe('uniqueName', () => {
  it('returns the name itself when it is free', () => {
    expect(uniqueName('Opening', () => false)).toBe('Opening');
  });

  it('adds " 2", then " 3", and so on', () => {
    const taken = new Set(['Opening']);
    expect(uniqueName('Opening', (name) => taken.has(name))).toBe('Opening 2');
    taken.add('Opening 2');
    expect(uniqueName('Opening', (name) => taken.has(name))).toBe('Opening 3');
    taken.add('Opening 3').add('Opening 4');
    expect(uniqueName('Opening', (name) => taken.has(name))).toBe('Opening 5');
  });

  it('works for names in any language', () => {
    const taken = new Set(['מכתב']);
    expect(uniqueName('מכתב', (name) => taken.has(name))).toBe('מכתב 2');
  });
});

describe('tidyDisplayName', () => {
  it('trims and squeezes spaces and line breaks, and keeps everything else', () => {
    expect(tidyDisplayName('  Part   one \n')).toBe('Part one');
    expect(tidyDisplayName('Who: Me?')).toBe('Who: Me?');
    expect(tidyDisplayName('חלק\tראשון')).toBe('חלק ראשון');
    expect(tidyDisplayName(' \n ')).toBe('');
  });
});

describe('comparePaths', () => {
  it('puts what is inside a folder straight after it', () => {
    const folders = ['writing notes', 'Writing/Drafts/Old', 'Archive', 'Writing', 'Writing/Drafts', 'Zebra', 'Archive/2024'];
    expect([...folders].sort(comparePaths)).toEqual([
      'Archive',
      'Archive/2024',
      'Writing',
      'Writing/Drafts',
      'Writing/Drafts/Old',
      'writing notes',
      'Zebra',
    ]);
  });

  it('is a proper order: equal only for the same path, and the same either way round', () => {
    expect(comparePaths('A/B', 'A/B')).toBe(0);
    expect(comparePaths('A', 'A/B')).toBeLessThan(0);
    expect(comparePaths('A/B', 'A')).toBeGreaterThan(0);
    expect(Math.sign(comparePaths('alpha', 'Beta'))).toBe(-Math.sign(comparePaths('Beta', 'alpha')));
    expect(comparePaths('Letter', 'letter')).not.toBe(0);
    expect(Math.sign(comparePaths('Letter', 'letter'))).toBe(-Math.sign(comparePaths('letter', 'Letter')));
  });

  it('sorts names in other alphabets too', () => {
    expect(['ספר ב', 'ספר א'].sort(comparePaths)).toEqual(['ספר א', 'ספר ב']);
  });
});

describe('sameName', () => {
  it('ignores capitals and Unicode spelling, as phones and Macs do', () => {
    expect(sameName('Letter.md', 'letter.md')).toBe(true);
    expect(sameName('Caf' + char(0x00e9), 'CAFE' + char(0x0301))).toBe(true);
    expect(sameName('Letter', 'Letter 2')).toBe(false);
  });
});

describe('newFolderId', () => {
  it('looks like f- followed by six lower-case letters or digits', () => {
    let n = 0;
    const random = (): number => ((n += 0.137) % 1);
    for (let i = 0; i < 50; i++) expect(newFolderId(random, new Set())).toMatch(/^f-[a-z0-9]{6}$/);
  });

  it('never returns an id that is already taken', () => {
    const sequence = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let at = 0;
    const random = (): number => sequence[at++ % sequence.length] as number;
    // the first attempt gives "f-aaaaaa", which is taken
    expect(newFolderId(random, new Set(['f-aaaaaa']))).toBe('f-ssssss');
  });

  it('still ends when the random source is stuck', () => {
    const id = newFolderId(() => 0, new Set(['f-aaaaaa']));
    expect(id).not.toBe('f-aaaaaa');
    expect(id.startsWith('f-aaaaaa')).toBe(true);
  });

  it('copes with a random source that returns 1 or nonsense', () => {
    expect(newFolderId(() => 1, new Set())).toBe('f-999999');
    expect(newFolderId(() => -1, new Set())).toBe('f-aaaaaa');
  });
});
