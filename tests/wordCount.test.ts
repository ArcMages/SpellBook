import { describe, expect, it } from 'vitest';
import {
  countWords,
  countWordsByPattern,
  countableText,
  defaultSegmenter,
  stripComments,
  stripFrontmatter,
} from '../src/core/wordCount';
import type { WordSegmenter } from '../src/core/wordCount';

describe('countWords', () => {
  it('uses the built-in word segmenter in this environment', () => {
    // If this fails, the tests below would silently test the fallback instead.
    expect(defaultSegmenter()).not.toBeNull();
  });

  it('counts English words', () => {
    expect(countWords('The quick brown fox jumps over the lazy dog.')).toBe(9);
    expect(countWords('One')).toBe(1);
    expect(countWords("Don't stop. It's Anna's turn.")).toBe(5);
  });

  it('counts nothing for empty text, spaces and punctuation', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\n\t ')).toBe(0);
    expect(countWords('... — !!! ?')).toBe(0);
    expect(countWords('***')).toBe(0);
  });

  it('does not count markdown marks as words', () => {
    // Chapter one / Bold and italic text / a list item
    expect(countWords('# Chapter one\n\n**Bold** and _italic_ text.\n\n- a list item')).toBe(9);
  });

  it('counts numbers as words', () => {
    expect(countWords('She was 27 in 1999, and owed 3.14 dollars.')).toBe(9);
  });

  it('counts Hebrew words', () => {
    expect(countWords('שלום עולם, מה שלומך?')).toBe(4);
    expect(countWords('היא כתבה מכתב ארוך מאוד.')).toBe(5);
  });

  it('counts Hebrew words written with vowel points as one word each', () => {
    expect(countWords('בְּרֵאשִׁית בָּרָא אֱלֹהִים')).toBe(3);
  });

  it('counts Arabic words', () => {
    expect(countWords('كتبت رسالة طويلة جدا.')).toBe(4);
  });

  it('counts mixed right-to-left and left-to-right text', () => {
    expect(countWords('היא אמרה hello ואז goodbye לכולם.')).toBe(6);
  });

  it('counts Chinese words although they are written without spaces', () => {
    expect(countWords('我喜欢写小说。')).toBe(4); // 我 / 喜欢 / 写 / 小说
  });

  it('counts Japanese words although they are written without spaces', () => {
    expect(countWords('今日は良い天気ですね。')).toBe(6); // 今日 / は / 良い / 天気 / です / ね
  });

  it('counts Korean words', () => {
    expect(countWords('한국어 문장입니다.')).toBe(2);
  });

  describe('frontmatter', () => {
    it('ignores the properties block at the top', () => {
      const note = '---\nsynopsis: Anna finds the letter under the floor\nstatus: To do\norder: 1024\n---\nOne two three.';
      expect(countWords(note)).toBe(3);
    });

    it('counts a note that is only properties as zero words', () => {
      expect(countWords('---\ntitle: Nothing here\n---')).toBe(0);
      expect(countWords('---\ntitle: Nothing here\n---\n')).toBe(0);
      expect(countWords('---\n---\n')).toBe(0);
    });

    it('handles Windows line endings and a byte-order mark', () => {
      expect(countWords('---\r\nstatus: To do\r\n---\r\nOne two three.')).toBe(3);
      expect(countWords(String.fromCharCode(0xfeff) + '---\nstatus: To do\n---\nOne two.')).toBe(2);
    });

    it('only treats a block at the very top as properties', () => {
      // A horizontal rule later in the text is part of the writing.
      expect(countWords('One two.\n\n---\n\nthree four five\n\n---\n\nsix.')).toBe(6);
      expect(countWords('\n---\nnot: properties\n---\nbody')).toBe(3);
    });

    it('counts everything when the block is never closed', () => {
      expect(countWords('---\nJust a rule, then four words.')).toBe(6);
    });

    it('does not mistake a longer dash line for the end of the block', () => {
      expect(countWords('---\nnote: a\n----\nstill: properties\n---\nbody words')).toBe(2);
    });
  });

  describe('comments', () => {
    it('ignores a comment inside a line', () => {
      expect(countWords('One %%this is hidden%% two.')).toBe(2);
    });

    it('ignores a comment that spans lines', () => {
      expect(countWords('One.\n\n%%\nA note to self:\nfix this later.\n%%\n\nTwo three.')).toBe(3);
    });

    it('ignores several comments', () => {
      expect(countWords('%%a b%% one %%c d e%% two %%f%%')).toBe(2);
    });

    it('keeps words on both sides of a comment apart', () => {
      expect(countWords('before%%hidden%%after')).toBe(2);
    });

    it('counts the text when a %% has no partner', () => {
      expect(countWords('I am 100%% sure of it.')).toBe(6);
    });

    it('ignores comments and properties together', () => {
      const note = '---\nsynopsis: five words that never count\n---\n%%plan: rewrite%%\nשלום עולם %%הערה נסתרת%% שוב.';
      expect(countWords(note)).toBe(3);
    });
  });

  it('uses a segmenter that is handed in, counting only word-like parts', () => {
    const fake: WordSegmenter = {
      segment: (text) =>
        text.split('|').map((segment) => ({ segment, isWordLike: segment !== '' && segment !== 'skip' })),
    };
    expect(countWords('a|skip|b||c', fake)).toBe(3);
    expect(countWords('---\nx: 1\n---\na|skip', fake)).toBe(1);
  });
});

describe('fallback counting (no Intl.Segmenter)', () => {
  it('counts English words, keeping contractions and hyphenated words whole', () => {
    expect(countWords('The quick brown fox.', null)).toBe(4);
    expect(countWords("Don't stop the well-known e-mail.", null)).toBe(5);
    expect(countWordsByPattern('3.14 and 1000')).toBe(3);
  });

  it('counts Hebrew and Arabic words', () => {
    expect(countWords('שלום עולם, מה שלומך?', null)).toBe(4);
    expect(countWords('בְּרֵאשִׁית בָּרָא אֱלֹהִים', null)).toBe(3);
    expect(countWords('كتبت رسالة طويلة جدا.', null)).toBe(4);
  });

  it('counts each Chinese or Japanese character as a word', () => {
    expect(countWords('我喜欢写小说。', null)).toBe(6);
    expect(countWords('夜の手紙', null)).toBe(4);
    expect(countWords('I read 小说 daily', null)).toBe(5);
    expect(countWords('abc小说def', null)).toBe(4);
  });

  it('ignores properties and comments too', () => {
    expect(countWords('---\na: b c d\n---\nOne %%hidden%% two.', null)).toBe(2);
  });

  it('counts nothing for empty text and punctuation', () => {
    expect(countWords('', null)).toBe(0);
    expect(countWords('... !!! ---', null)).toBe(0);
  });
});

describe('the helpers', () => {
  it('stripFrontmatter returns exactly the text after the block', () => {
    expect(stripFrontmatter('---\na: 1\n---\nBody\ntext')).toBe('Body\ntext');
    expect(stripFrontmatter('No block here')).toBe('No block here');
    expect(stripFrontmatter('---\nnever closed')).toBe('---\nnever closed');
    expect(stripFrontmatter('--- \na: 1\n---  \nBody')).toBe('Body');
    expect(stripFrontmatter('----\na: 1\n----\nBody')).toBe('----\na: 1\n----\nBody');
  });

  it('stripComments removes complete comments only', () => {
    expect(stripComments('a %%b%% c')).toBe('a   c');
    expect(stripComments('a %%b')).toBe('a %%b');
    expect(stripComments('a %%b\nc%% d %%e%%')).toBe('a   d  ');
  });

  it('countableText applies both', () => {
    expect(countableText('---\na: 1\n---\nx %%y%% z')).toBe('x   z');
  });
});
