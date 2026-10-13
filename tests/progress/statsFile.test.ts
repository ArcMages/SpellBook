import { describe, expect, it } from 'vitest';
import {
  NO_WORDS,
  STATS_FOLDER,
  applyDayChange,
  isDeviceId,
  newDeviceId,
  newStatsFile,
  parseStatsFile,
  parseStatsFileName,
  serialiseStatsFile,
  statsFileName,
  statsFilePath,
  updateStatsText,
} from '../../src/core/progress';
import type { StatsFile, StatsIdentity } from '../../src/core/progress';
import { PROJECT_FOLDERS } from '../../src/core/projectLayout';
import { fixedRandom } from '../storeHarness';

const HEADER = '| Date | Manuscript added | Manuscript deleted | Other added | Other deleted |';
const RULE = '| --- | ---: | ---: | ---: | ---: |';

const PHONE: StatsIdentity = { device: 'k3x9q2ab', deviceName: "Dana's iPhone", month: '2026-10' };
const HEBREW_PHONE: StatsIdentity = { device: 'p7m2w0zz', deviceName: 'האייפון של דנה', month: '2026-10' };

/** A tidy file, exactly as the plugin writes it. */
function tidy(identity: StatsIdentity, rows: string[]): string {
  return [
    '---',
    'spellbook: stats',
    `device: "${identity.device}"`,
    `deviceName: "${identity.deviceName}"`,
    `month: "${identity.month}"`,
    '---',
    '',
    HEADER,
    RULE,
    ...rows,
    '',
  ].join('\n');
}

const day = (date: string, a: number, b = 0, c = 0, d = 0) => ({
  date,
  manuscriptAdded: a,
  manuscriptDeleted: b,
  otherAdded: c,
  otherDeleted: d,
});

describe('file names', () => {
  it('builds "<YYYY-MM> <device>.md"', () => {
    expect(statsFileName('2026-10', 'k3x9q2ab')).toBe('2026-10 k3x9q2ab.md');
    expect(statsFileName('2026-01', 'Desk-Mac_2')).toBe('2026-01 Desk-Mac_2.md');
  });

  it('refuses a month or a device id that is not valid', () => {
    expect(statsFileName('2026-13', 'k3x9q2ab')).toBeNull();
    expect(statsFileName('2026-10-13', 'k3x9q2ab')).toBeNull();
    expect(statsFileName('2026-10', '')).toBeNull();
    expect(statsFileName('2026-10', 'two words')).toBeNull();
    expect(statsFileName('2026-10', 'a/b')).toBeNull();
    expect(statsFileName('2026-10', '../x')).toBeNull();
  });

  it('reads a name, or a whole path, back', () => {
    expect(parseStatsFileName('2026-10 k3x9q2ab.md')).toEqual({ month: '2026-10', device: 'k3x9q2ab' });
    expect(parseStatsFileName('Novel/Stats/2026-10 k3x9q2ab.md')).toEqual({ month: '2026-10', device: 'k3x9q2ab' });
    expect(parseStatsFileName('הרומן שלי/Stats/2026-02 Desk-Mac_2.MD')).toEqual({ month: '2026-02', device: 'Desk-Mac_2' });
  });

  it('goes there and back again', () => {
    for (const month of ['2026-10', '1999-01', '2030-12']) {
      for (const device of ['a', 'k3x9q2ab', 'A-b_C9', 'x'.repeat(64)]) {
        const name = statsFileName(month, device);
        expect(name).not.toBeNull();
        expect(parseStatsFileName(name as string)).toEqual({ month, device });
      }
    }
  });

  it('does not take other files for a log, least of all the copies a sync conflict leaves', () => {
    for (const name of [
      '2026-10 k3x9q2ab 2.md',
      '2026-10 k3x9q2ab (conflicted copy).md',
      '2026-10 k3x9q2ab.txt',
      '2026-10.md',
      '2026-10 .md',
      '2026-13 k3x9q2ab.md',
      '2026-10  k3x9q2ab.md',
      '2026-10_k3x9q2ab.md',
      'Notes.md',
      '',
    ]) {
      expect(parseStatsFileName(name), name).toBeNull();
    }
  });

  it('gives the path of the file that holds a day, in any project folder', () => {
    expect(statsFilePath('Novel', '2026-10-13', 'k3x9q2ab')).toBe('Novel/Stats/2026-10 k3x9q2ab.md');
    expect(statsFilePath('כתיבה/הרומן שלי', '2026-02-28', 'k3x9q2ab')).toBe('כתיבה/הרומן שלי/Stats/2026-02 k3x9q2ab.md');
    expect(statsFilePath('', '2026-10-13', 'k3x9q2ab')).toBe('Stats/2026-10 k3x9q2ab.md');
    expect(statsFilePath('Novel', '2026-02-30', 'k3x9q2ab')).toBeNull();
    expect(statsFilePath('Novel', '2026-10-13', 'bad id')).toBeNull();
  });

  it('uses the Stats folder every project is created with', () => {
    expect(PROJECT_FOLDERS).toContain(STATS_FOLDER);
  });
});

describe('device ids', () => {
  it('accepts letters, digits, "-" and "_"', () => {
    for (const id of ['a', 'k3x9q2ab', 'Desk-Mac_2', '0', 'x'.repeat(64)]) expect(isDeviceId(id), id).toBe(true);
    for (const id of ['', ' ', 'a b', '-a', '_a', 'a.b', 'a/b', 'מכשיר', 'x'.repeat(65), 'a\n']) {
      expect(isDeviceId(id), JSON.stringify(id)).toBe(false);
    }
  });

  it('makes ids of eight letters and digits from the random source it is given', () => {
    const random = fixedRandom(42);
    const first = newDeviceId(random);
    const second = newDeviceId(random);
    expect(first).toMatch(/^[a-z0-9]{8}$/);
    expect(second).toMatch(/^[a-z0-9]{8}$/);
    expect(second).not.toBe(first);
    expect(newDeviceId(fixedRandom(42))).toBe(first); // the same source gives the same id
    expect(isDeviceId(first)).toBe(true);
  });

  it('copes with a random source that misbehaves', () => {
    for (const bad of [() => 1, () => -1, () => Number.NaN, () => 99]) {
      expect(isDeviceId(newDeviceId(bad))).toBe(true);
    }
  });
});

describe('parseStatsFile', () => {
  it('reads a tidy file', () => {
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-12 | 800 | 20 | 0 | 0 |', '| 2026-10-13 | 1200 | 30 | 45 | 5 |']));
    expect(file.device).toBe('k3x9q2ab');
    expect(file.deviceName).toBe("Dana's iPhone");
    expect(file.month).toBe('2026-10');
    expect(file.days).toEqual([day('2026-10-12', 800, 20), day('2026-10-13', 1200, 30, 45, 5)]);
    expect(file.problems).toEqual([]);
  });

  it('reads a Hebrew device name exactly as it was written', () => {
    const file = parseStatsFile(tidy(HEBREW_PHONE, ['| 2026-10-13 | 5 | 0 | 0 | 0 |']));
    expect(file.deviceName).toBe('האייפון של דנה');
    expect(file.problems).toEqual([]);
  });

  it('reads properties however they were quoted', () => {
    const read = (line: string): string =>
      parseStatsFile(['---', 'spellbook: stats', 'device: k3x9q2ab', line, 'month: 2026-10', '---', ''].join('\n')).deviceName;
    expect(read('deviceName: Dana iPhone')).toBe('Dana iPhone');
    expect(read('deviceName:   Dana iPhone   ')).toBe('Dana iPhone');
    expect(read('deviceName: Dana iPhone # the old one')).toBe('Dana iPhone');
    expect(read("deviceName: 'Dana''s iPhone'")).toBe("Dana's iPhone");
    expect(read('deviceName: "Dana\'s \\"big\\" iPhone"')).toBe('Dana\'s "big" iPhone');
    expect(read('deviceName: "back\\\\slash: and # hash"')).toBe('back\\slash: and # hash');
    expect(read('deviceName: "\\u05d3\\u05e0\\u05d4"')).toBe('דנה');
    expect(read('deviceName: האייפון של דנה')).toBe('האייפון של דנה');
    expect(read("deviceName: 'המחשב של \"דנה\"'")).toBe('המחשב של "דנה"');
    expect(read('deviceName: "never closed')).toBe('never closed');
    expect(read('deviceName:')).toBe('');
    expect(read('deviceName: ~')).toBe('');
  });

  it('reads the device and month from plain, unquoted properties too', () => {
    const file = parseStatsFile(['---', 'spellbook: stats', 'device: k3x9q2ab', 'month: 2026-10', '---', HEADER, RULE, '| 2026-10-13 | 5 | 0 | 0 | 0 |'].join('\n'));
    expect([file.device, file.month]).toEqual(['k3x9q2ab', '2026-10']);
    expect(file.days).toEqual([day('2026-10-13', 5)]);
  });

  it('keeps a row it cannot read, word for word, and reports it with its line', () => {
    const rows = [
      '| 2026-10-10 | 100 | 0 | 0 | 0 |',
      '| 2026-10-11 | lots | 0 | 0 | 0 |',
      '| 2026-10-12 | -5 | 0 | 0 | 0 |',
      '| 2026-10-13 | 1.5 | 0 | 0 | 0 |',
      '| 2026-02-30 | 5 | 0 | 0 | 0 |',
      '| 13/10/2026 | 5 | 0 | 0 | 0 |',
      '| 2026-10-14 | 5 | 0 |',
      '|',
      '|   יום שלישי | הרבה מילים | 0 | 0 | 0 |',
      '| 2026-10-15 | 7 | 0 | 0 | 0 |',
    ];
    const file = parseStatsFile(tidy(PHONE, rows));
    expect(file.days).toEqual([day('2026-10-10', 100), day('2026-10-15', 7)]);
    expect(file.kept.rows).toEqual(rows.slice(1, 9));
    const unreadable = file.problems.filter((problem) => problem.kind === 'unreadable-row');
    expect(unreadable.map((problem) => problem.text)).toEqual(rows.slice(1, 9));
    // Line 10 of the file is the first row of the table (6 lines of properties, a blank, the heading, the rule).
    expect(unreadable.map((problem) => problem.line)).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    for (const problem of unreadable) expect(problem.message).toMatch(/could not be read/);
  });

  it('reads numbers written with thousands commas, and an empty cell as nothing', () => {
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-13 | 1,200 | | 12,345,678 |  |', '|2026-10-14|5|0|0|0|', '  | 2026-10-15 | 6 | 0 | 0 | 0']));
    expect(file.days).toEqual([day('2026-10-13', 1200, 0, 12345678, 0), day('2026-10-14', 5), day('2026-10-15', 6)]);
    expect(file.problems).toEqual([]);
  });

  it('does not take a comma in the wrong place for a number', () => {
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-13 | 12,00 | 0 | 0 | 0 |', '| 2026-10-14 | 1,2345 | 0 | 0 | 0 |']));
    expect(file.days).toEqual([]);
    expect(file.kept.rows).toHaveLength(2);
  });

  it('sorts the days by date whatever order the rows are in', () => {
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-13 | 3 | 0 | 0 | 0 |', '| 2026-10-02 | 1 | 0 | 0 | 0 |', '| 2026-10-09 | 2 | 0 | 0 | 0 |']));
    expect(file.days.map((entry) => entry.date)).toEqual(['2026-10-02', '2026-10-09', '2026-10-13']);
  });

  it('reads two rows for one day as one, with the larger of each number', () => {
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-13 | 300 | 40 | 0 | 9 |', '| 2026-10-13 | 250 | 60 | 7 | 0 |']));
    expect(file.days).toEqual([day('2026-10-13', 300, 60, 7, 9)]);
    expect(file.problems.map((problem) => [problem.kind, problem.line])).toEqual([['duplicate-date', 11]]);
  });

  it('counts a row of another month, and says so', () => {
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-13 | 5 | 0 | 0 | 0 |', '| 2026-11-01 | 9 | 0 | 0 | 0 |']));
    expect(file.days).toEqual([day('2026-10-13', 5), day('2026-11-01', 9)]);
    expect(file.problems.map((problem) => [problem.kind, problem.line, problem.text])).toEqual([
      ['other-month', 11, '| 2026-11-01 | 9 | 0 | 0 | 0 |'],
    ]);
  });

  it('keeps the text above and below the table, in Hebrew or English', () => {
    const text = [
      '---',
      'spellbook: stats',
      'device: "k3x9q2ab"',
      'deviceName: "Dana"',
      'month: "2026-10"',
      '---',
      '',
      'הערה: החודש הזה הייתי בחופשה.',
      '',
      'Second paragraph, with  two spaces and a | bar in the middle.',
      '',
      HEADER,
      RULE,
      '| 2026-10-13 | 5 | 0 | 0 | 0 |',
      '',
      '> מה שנכתב כאן נשמר בדיוק כמו שהוא.',
      '',
      '  - an indented line',
    ].join('\n');
    const file = parseStatsFile(text);
    expect(file.kept.before).toEqual(['הערה: החודש הזה הייתי בחופשה.', '', 'Second paragraph, with  two spaces and a | bar in the middle.']);
    expect(file.kept.after).toEqual(['> מה שנכתב כאן נשמר בדיוק כמו שהוא.', '', '  - an indented line']);
    expect(file.days).toEqual([day('2026-10-13', 5)]);
    expect(serialiseStatsFile(file)).toBe(`${text}\n`);
  });

  it('keeps properties it does not know, and cells of columns it does not know', () => {
    const text = [
      '---',
      'spellbook: stats',
      'tags: [log, יומן]',
      'device: "k3x9q2ab"',
      'deviceName: "Dana"',
      'aliases:',
      '  - October',
      '  - אוקטובר',
      'month: "2026-10"',
      'version: 2',
      '---',
      '',
      `${HEADER} Minutes | מצב רוח |`,
      `${RULE} --- | --- |`,
      '| 2026-10-12 | 800 | 20 | 0 | 0 | 45 | טוב מאוד |',
      '| 2026-10-13 | 1200 | 30 | 45 | 5 | 90 |  עייפה  |',
      '',
    ].join('\n');
    const file = parseStatsFile(text);
    expect(file.problems).toEqual([]);
    expect(file.kept.headerExtra).toEqual([' Minutes ', ' מצב רוח ']);
    expect(file.days[0]?.extraCells).toEqual([' 45 ', ' טוב מאוד ']);
    expect(file.days[1]?.extraCells).toEqual([' 90 ', '  עייפה  ']);
    expect(file.days[1]?.manuscriptAdded).toBe(1200);
    expect(serialiseStatsFile(file)).toBe(text);
  });

  it('says when the note is marked as something else', () => {
    const file = parseStatsFile(['---', 'spellbook: project', 'title: My Novel', '---', '', 'Some text.'].join('\n'));
    expect(file.problems.map((problem) => problem.kind)).toEqual(['not-stats']);
    expect(file.problems[0]?.line).toBe(2);
    expect(file.problems[0]?.text).toBe('spellbook: project');
    expect(file.kept.before).toEqual(['Some text.']);
  });

  it('falls back on the file name when the properties do not say which device and month', () => {
    const body = [HEADER, RULE, '| 2026-10-13 | 5 | 0 | 0 | 0 |'].join('\n');
    const bare = parseStatsFile(body, 'Novel/Stats/2026-10 k3x9q2ab.md');
    expect([bare.device, bare.month, bare.deviceName]).toEqual(['k3x9q2ab', '2026-10', '']);
    expect(bare.problems.map((problem) => problem.kind)).toEqual(['properties']);
    expect(bare.days).toEqual([day('2026-10-13', 5)]);

    const unnamed = parseStatsFile(body);
    expect([unnamed.device, unnamed.month]).toEqual(['', '']);

    // What the properties say wins over the name.
    const both = parseStatsFile(tidy(PHONE, []), 'Novel/Stats/2026-09 otherdev.md');
    expect([both.device, both.month]).toEqual(['k3x9q2ab', '2026-10']);
  });

  it('reports a month that is not written as YYYY-MM, and keeps it', () => {
    const file = parseStatsFile(['---', 'spellbook: stats', 'device: k3x9q2ab', 'month: October 2026', '---', ''].join('\n'));
    expect(file.month).toBe('October 2026');
    expect(file.problems.map((problem) => [problem.kind, problem.line])).toEqual([['properties', 4]]);
  });

  it('reads a file with Windows line endings, and one that begins with a byte-order mark', () => {
    const windows = tidy(PHONE, ['| 2026-10-13 | 5 | 0 | 0 | 0 |']).replace(/\n/g, '\r\n');
    const file = parseStatsFile(windows);
    expect(file.days).toEqual([day('2026-10-13', 5)]);
    expect(file.deviceName).toBe("Dana's iPhone");
    expect(file.kept.lineEnd).toBe('\r\n');
    expect(serialiseStatsFile(file)).toBe(windows);

    const marked = parseStatsFile(`${String.fromCharCode(0xfeff)}${tidy(PHONE, ['| 2026-10-13 | 5 | 0 | 0 | 0 |'])}`);
    expect(marked.device).toBe('k3x9q2ab');
    expect(marked.days).toEqual([day('2026-10-13', 5)]);
  });

  it('treats a properties block that is never closed as ordinary text', () => {
    const text = ['---', 'spellbook: stats', 'device: k3x9q2ab', '', HEADER, RULE, '| 2026-10-13 | 5 | 0 | 0 | 0 |'].join('\n');
    const file = parseStatsFile(text);
    expect(file.kept.properties).toBeNull();
    expect(file.device).toBe('');
    expect(file.kept.before).toEqual(['---', 'spellbook: stats', 'device: k3x9q2ab']);
    expect(file.days).toEqual([day('2026-10-13', 5)]);
  });

  it('keeps a table of the writer\'s own whole: its heading, its rule and its rows', () => {
    const own = ['| Date | Mood |', '| --- | --- |', '| 2026-10-13 | טוב |'];
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-13 | 5 | 0 | 0 | 0 |', ...own]));
    expect(file.days).toEqual([day('2026-10-13', 5)]);
    expect(file.kept.rows).toEqual(own);
    expect(serialiseStatsFile(file)).toBe(tidy(PHONE, ['| 2026-10-13 | 5 | 0 | 0 | 0 |', ...own]));
  });

  it('reads the rows of a table that was split in two, and of one without its heading', () => {
    const split = tidy(PHONE, ['| 2026-10-12 | 1 | 0 | 0 | 0 |', '', HEADER, RULE, '| 2026-10-13 | 2 | 0 | 0 | 0 |']);
    expect(parseStatsFile(split).days).toEqual([day('2026-10-12', 1), day('2026-10-13', 2)]);
    const headless = ['| 2026-10-12 | 1 | 0 | 0 | 0 |', '| 2026-10-13 | 2 | 0 | 0 | 0 |'].join('\n');
    expect(parseStatsFile(headless).days).toEqual([day('2026-10-12', 1), day('2026-10-13', 2)]);
  });

  it('reads an empty file, and never throws on nonsense', () => {
    expect(parseStatsFile('').days).toEqual([]);
    expect(parseStatsFile('\n\n\n').days).toEqual([]);
    expect(parseStatsFile('---').kept.before).toEqual(['---']);
    expect(parseStatsFile('---\n---').kept.properties).toEqual([]);

    const pieces = ['|', '---', '\n', ' ', '2026-10-13', '12', '\\', '"', "'", ':', 'device', 'spellbook', 'stats', 'Date', '-', '\r', 'א', '#', ',', '\t'];
    const random = fixedRandom(99);
    for (let round = 0; round < 500; round++) {
      let text = '';
      const length = Math.floor(random() * 60);
      for (let i = 0; i < length; i++) text += pieces[Math.floor(random() * pieces.length)];
      const file = parseStatsFile(text);
      // Whatever it was, writing it and reading it again changes nothing more.
      const written = serialiseStatsFile(file);
      expect(serialiseStatsFile(parseStatsFile(written)), JSON.stringify(text)).toBe(written);
    }
  });
});

describe('nothing is lost between reading and writing', () => {
  const prose = ['A line of prose.', 'שורה בעברית עם | קו באמצע.', '> a quotation', '   indented, with trailing spaces   ', '# A heading'];
  const unreadable = ['| not a row |', '| 2026-10-04 | many | 0 | 0 | 0 |', '| Date | Mood |', '| יום | מילים | 0 | 0 | 0 |', '| 2026-10-05 | 5 |'];
  const readable = [
    '| 2026-10-01 | 5 | 0 | 0 | 0 |',
    '| 2026-10-02 | 7 | 1 | 2 | 3 |',
    '| 2026-10-02 | 9 | 0 | 0 | 0 |',
    '| 2026-10-03 | 1 | 0 | 0 | 0 | extra |',
    '|2026-10-06|1,000|0|0|0|',
  ];
  const layout = ['', '', HEADER, RULE, '|---|---|'];
  const pool = [...prose, ...unreadable, ...readable, ...layout];

  it('keeps every line it did not understand and every day it did, in a thousand shuffled files', () => {
    const random = fixedRandom(2026);
    for (let round = 0; round < 1000; round++) {
      const picked: string[] = [];
      const length = Math.floor(random() * 16);
      for (let i = 0; i < length; i++) picked.push(pool[Math.floor(random() * pool.length)] as string);
      const withProperties = random() < 0.7;
      const text = [...(withProperties ? ['---', 'spellbook: stats', 'device: k3x9q2ab', 'month: 2026-10', 'mood: טוב', '---'] : []), ...picked].join('\n');

      const file = parseStatsFile(text);
      const written = serialiseStatsFile(file);
      const lines = written.split('\n');
      const where = JSON.stringify(text);
      for (const line of picked) {
        if (prose.includes(line) || unreadable.includes(line)) expect(lines, where).toContain(line);
        if (readable.includes(line)) {
          const date = line.replace(/\|/g, ' ').trim().slice(0, 10);
          expect(file.days.map((entry) => entry.date), where).toContain(date);
        }
      }
      if (picked.includes('| 2026-10-03 | 1 | 0 | 0 | 0 | extra |')) expect(written, where).toContain(' extra |');
      if (withProperties) expect(lines, where).toContain('mood: טוב');
      // Reading what was written gives the same days, and writing it again changes nothing.
      const again = parseStatsFile(written);
      expect(again.days, where).toEqual(file.days);
      expect(serialiseStatsFile(again), where).toBe(written);
    }
  });
});

describe('serialiseStatsFile', () => {
  it('writes a new file with its properties, the heading and the rows', () => {
    let file: StatsFile = newStatsFile(PHONE);
    file = applyDayChange(file, '2026-10-13', { manuscriptAdded: 1200, manuscriptDeleted: 30, otherAdded: 45 });
    file = applyDayChange(file, '2026-10-12', { manuscriptAdded: 800 });
    expect(serialiseStatsFile(file)).toBe(tidy(PHONE, ['| 2026-10-12 | 800 | 0 | 0 | 0 |', '| 2026-10-13 | 1200 | 30 | 45 | 0 |']));
  });

  it('writes the exact heading the format asks for', () => {
    const lines = serialiseStatsFile(newStatsFile(PHONE)).split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('spellbook: stats');
    expect(lines[5]).toBe('---');
    expect(lines[7]).toBe('| Date | Manuscript added | Manuscript deleted | Other added | Other deleted |');
  });

  it('gives back a tidy file character for character', () => {
    for (const identity of [PHONE, HEBREW_PHONE]) {
      const text = tidy(identity, ['| 2026-10-01 | 5 | 0 | 0 | 0 |', '| 2026-10-13 | 1200 | 30 | 45 | 5 |']);
      expect(serialiseStatsFile(parseStatsFile(text))).toBe(text);
    }
  });

  it('writes any device name so that it reads back the same', () => {
    const names = [
      'האייפון של דנה',
      'Dana\'s "big" iPad',
      'back\\slash',
      'colon: hash # and - dash',
      ' spaces at both ends ',
      'tab\there',
      'line\nbreak',
      '"',
      "'",
      '',
      'emoji 📱 and niqqud שָׁלוֹם',
      '123',
      'true',
      'null',
    ];
    for (const deviceName of names) {
      const written = serialiseStatsFile(newStatsFile({ ...PHONE, deviceName }));
      expect(parseStatsFile(written).deviceName, JSON.stringify(deviceName)).toBe(deviceName);
      expect(parseStatsFile(written).device).toBe(PHONE.device);
      expect(parseStatsFile(written).month).toBe(PHONE.month);
    }
  });

  it('sorts rows by date and puts the rows it could not read after them', () => {
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-13 | 3 | 0 | 0 | 0 |', '| oops | 1 |', '| 2026-10-02 | 1 | 0 | 0 | 0 |']));
    expect(serialiseStatsFile(file)).toBe(tidy(PHONE, ['| 2026-10-02 | 1 | 0 | 0 | 0 |', '| 2026-10-13 | 3 | 0 | 0 | 0 |', '| oops | 1 |']));
  });

  it('does not store a day on which nothing happened', () => {
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-12 | 0 | 0 | 0 | 0 |', '| 2026-10-13 | 0 | 0 | 0 | 1 |']));
    expect(serialiseStatsFile(file)).toBe(tidy(PHONE, ['| 2026-10-13 | 0 | 0 | 0 | 1 |']));
  });

  it('adds a properties block to a file that has none, and loses nothing doing so', () => {
    const bare = ['A note to self.', '', HEADER, RULE, '| 2026-10-13 | 5 | 0 | 0 | 0 |'].join('\n');
    const written = serialiseStatsFile(parseStatsFile(bare, '2026-10 k3x9q2ab.md'));
    expect(written).toBe(
      ['---', 'spellbook: stats', 'device: "k3x9q2ab"', 'month: "2026-10"', '---', '', 'A note to self.', '', HEADER, RULE, '| 2026-10-13 | 5 | 0 | 0 | 0 |', ''].join('\n'),
    );
  });

  it('leaves property lines that already say the right thing exactly as they were typed', () => {
    const text = ['---', 'month: 2026-10   # this month', "deviceName: 'Dana'", 'device: k3x9q2ab', 'spellbook: stats', '---', '', HEADER, RULE, ''].join('\n');
    expect(serialiseStatsFile(parseStatsFile(text))).toBe(text);
  });

  it('never claims a note that is marked as something else', () => {
    const text = ['---', 'spellbook: project', 'title: My Novel', '---', ''].join('\n');
    expect(serialiseStatsFile(parseStatsFile(text))).toContain('spellbook: project');
    expect(serialiseStatsFile(parseStatsFile(text))).not.toContain('spellbook: stats');
  });

  it('settles after one write: writing what was read changes nothing more', () => {
    const messy = [
      '---',
      'device: k3x9q2ab',
      '---',
      '',
      '',
      'Above.',
      '',
      '',
      '| 2026-10-13 | 3 | 0 | 0 | 0 |',
      'Between the rows.',
      '',
      '| bad row |',
      '| 2026-10-02 | 1 | 0 | 0 | 0 | extra |',
      '',
      '',
      'Below.',
      '',
      '',
    ].join('\n');
    const once = serialiseStatsFile(parseStatsFile(messy));
    const twice = serialiseStatsFile(parseStatsFile(once));
    expect(twice).toBe(once);
    for (const kept of ['Above.', 'Between the rows.', '| bad row |', 'Below.', ' extra |']) expect(once).toContain(kept);
    expect(parseStatsFile(once).days.map((entry) => entry.date)).toEqual(['2026-10-02', '2026-10-13']);
  });
});

describe('applyDayChange', () => {
  const start = parseStatsFile(tidy(PHONE, ['| 2026-10-12 | 800 | 20 | 0 | 0 |']));

  it('adds to a day that is there, and makes a day that is not', () => {
    const next = applyDayChange(start, '2026-10-12', { manuscriptAdded: 50, otherDeleted: 3 });
    expect(next.days).toEqual([day('2026-10-12', 850, 20, 0, 3)]);
    const more = applyDayChange(next, '2026-10-05', { otherAdded: 7 });
    expect(more.days).toEqual([day('2026-10-05', 0, 0, 7), day('2026-10-12', 850, 20, 0, 3)]);
  });

  it('never changes the file it was given', () => {
    applyDayChange(start, '2026-10-12', { manuscriptAdded: 50 });
    expect(start.days).toEqual([day('2026-10-12', 800, 20)]);
  });

  it('takes away with negative numbers, never below zero', () => {
    expect(applyDayChange(start, '2026-10-12', { manuscriptAdded: -300 }).days).toEqual([day('2026-10-12', 500, 20)]);
    expect(applyDayChange(start, '2026-10-12', { manuscriptAdded: -5000, manuscriptDeleted: -5 }).days).toEqual([day('2026-10-12', 0, 15)]);
  });

  it('removes a day that ends up with nothing', () => {
    expect(applyDayChange(start, '2026-10-12', { manuscriptAdded: -800, manuscriptDeleted: -20 }).days).toEqual([]);
  });

  it('gives back the very same object when nothing changes', () => {
    expect(applyDayChange(start, '2026-10-12', {})).toBe(start);
    expect(applyDayChange(start, '2026-10-12', { manuscriptAdded: 0 })).toBe(start);
    expect(applyDayChange(start, '2026-10-12', { otherAdded: -9 })).toBe(start); // already zero
    expect(applyDayChange(start, '2026-10-20', { manuscriptAdded: -9 })).toBe(start); // no such day, nothing to take
    expect(applyDayChange(start, '2026-02-30', { manuscriptAdded: 9 })).toBe(start);
    expect(applyDayChange(start, 'today', { manuscriptAdded: 9 })).toBe(start);
    expect(applyDayChange(start, '2026-10-12', { manuscriptAdded: Number.NaN })).toBe(start);
  });

  it('drops the fraction of a number', () => {
    expect(applyDayChange(start, '2026-10-12', { manuscriptAdded: 2.9 }).days).toEqual([day('2026-10-12', 802, 20)]);
  });

  it('touches only the day it was asked to change', () => {
    const file = parseStatsFile(
      tidy(PHONE, ['| 2026-10-11 | 1 | 2 | 3 | 4 | note א |', '| 2026-10-12 | 800 | 20 | 0 | 0 | 45 |', '| what is this |']),
    );
    const next = applyDayChange(file, '2026-10-12', { manuscriptAdded: 1 });
    expect(next.days[0]).toBe(file.days[0]);
    expect(next.days[1]).toEqual({ ...day('2026-10-12', 801, 20), extraCells: [' 45 '] });
    expect(next.kept).toBe(file.kept);
    expect(serialiseStatsFile(next)).toBe(
      tidy(PHONE, ['| 2026-10-11 | 1 | 2 | 3 | 4 | note א |', '| 2026-10-12 | 801 | 20 | 0 | 0 | 45 |', '| what is this |']),
    );
  });

  it('keeps a day that holds cells of an unknown column, even at zero', () => {
    const file = parseStatsFile(tidy(PHONE, ['| 2026-10-12 | 5 | 0 | 0 | 0 | 45 |']));
    const next = applyDayChange(file, '2026-10-12', { manuscriptAdded: -5 });
    expect(next.days).toEqual([{ ...NO_WORDS, date: '2026-10-12', extraCells: [' 45 '] }]);
    expect(serialiseStatsFile(next)).toContain('| 2026-10-12 | 0 | 0 | 0 | 0 | 45 |');
  });
});

describe('updateStatsText', () => {
  it('makes the text of a new file when there is none yet', () => {
    const update = updateStatsText(null, HEBREW_PHONE, [{ date: '2026-10-13', counts: { manuscriptAdded: 120, otherAdded: 4 } }]);
    expect(update.status).toBe('write');
    if (update.status !== 'write') return;
    expect(update.text).toBe(tidy(HEBREW_PHONE, ['| 2026-10-13 | 120 | 0 | 4 | 0 |']));
    expect(update.file.days).toEqual([day('2026-10-13', 120, 0, 4, 0)]);
  });

  it('adds to the file as it is on disk now', () => {
    const disk = tidy(PHONE, ['| 2026-10-12 | 800 | 20 | 0 | 0 |', '| 2026-10-13 | 100 | 0 | 0 | 0 |']);
    const update = updateStatsText(disk, PHONE, [
      { date: '2026-10-13', counts: { manuscriptAdded: 25, manuscriptDeleted: 5 } },
      { date: '2026-10-14', counts: { otherAdded: 9 } },
    ]);
    expect(update.status).toBe('write');
    if (update.status !== 'write') return;
    expect(update.text).toBe(tidy(PHONE, ['| 2026-10-12 | 800 | 20 | 0 | 0 |', '| 2026-10-13 | 125 | 5 | 0 | 0 |', '| 2026-10-14 | 0 | 0 | 9 | 0 |']));
  });

  it('takes back what an undo took back, from a row that was already saved', () => {
    const disk = tidy(PHONE, ['| 2026-10-13 | 100 | 0 | 0 | 0 |']);
    const update = updateStatsText(disk, PHONE, [{ date: '2026-10-13', counts: { manuscriptAdded: -30 } }]);
    expect(update.status === 'write' && update.text).toBe(tidy(PHONE, ['| 2026-10-13 | 70 | 0 | 0 | 0 |']));
  });

  it('leaves the file alone when nothing changes, however untidy it is', () => {
    const untidy = ['---', 'device: k3x9q2ab', '---', '|2026-10-13|5|0|0|0|', '', 'trailing words'].join('\n');
    expect(updateStatsText(untidy, PHONE, [])).toEqual({ status: 'unchanged' });
    expect(updateStatsText(untidy, PHONE, [{ date: '2026-10-13', counts: {} }])).toEqual({ status: 'unchanged' });
    expect(updateStatsText(untidy, PHONE, [{ date: '2026-10-13', counts: { otherAdded: -4 } }])).toEqual({ status: 'unchanged' });
    // And no file is made just to hold an empty table.
    expect(updateStatsText(null, PHONE, [])).toEqual({ status: 'unchanged' });
    expect(updateStatsText(null, PHONE, [{ date: '2026-10-13', counts: { manuscriptAdded: -4 } }])).toEqual({ status: 'unchanged' });
  });

  it('keeps everything it did not understand while adding to a day', () => {
    const disk = [
      '---',
      'spellbook: stats',
      'device: k3x9q2ab',
      'deviceName: Dana',
      'month: 2026-10',
      'mood: טוב',
      '---',
      '',
      'שורה שכתבתי בעצמי.',
      '',
      `${HEADER} Minutes |`,
      `${RULE} --- |`,
      '| 2026-10-13 | 5 | 0 | 0 | 0 | 45 |',
      '| nonsense | row |',
      '',
      'Footer.',
      '',
    ].join('\n');
    const update = updateStatsText(disk, { ...PHONE, deviceName: 'Dana' }, [{ date: '2026-10-13', counts: { manuscriptAdded: 1 } }]);
    expect(update.status).toBe('write');
    if (update.status !== 'write') return;
    expect(update.text).toBe(disk.replace('| 2026-10-13 | 5 |', '| 2026-10-13 | 6 |'));
  });

  it('brings the device name up to date when it saves, and only that line', () => {
    const disk = tidy(PHONE, ['| 2026-10-13 | 5 | 0 | 0 | 0 |']);
    const renamed = { ...PHONE, deviceName: 'הטלפון החדש' };
    const update = updateStatsText(disk, renamed, [{ date: '2026-10-13', counts: { manuscriptAdded: 1 } }]);
    expect(update.status === 'write' && update.text).toBe(tidy(renamed, ['| 2026-10-13 | 6 | 0 | 0 | 0 |']));
    // A device with no name to give keeps the name the file has.
    const nameless = updateStatsText(disk, { ...PHONE, deviceName: '' }, [{ date: '2026-10-13', counts: { manuscriptAdded: 1 } }]);
    expect(nameless.status === 'write' && nameless.text).toBe(tidy(PHONE, ['| 2026-10-13 | 6 | 0 | 0 | 0 |']));
  });

  it("refuses to write another device's file, another month's file, or a note that is not a log", () => {
    const change = [{ date: '2026-10-13', counts: { manuscriptAdded: 1 } }];
    const other = updateStatsText(tidy({ ...PHONE, device: 'otherdev' }, []), PHONE, change);
    expect(other.status).toBe('refused');
    expect(other.status === 'refused' && other.reason).toMatch(/another device/);

    const september = updateStatsText(tidy({ ...PHONE, month: '2026-09' }, []), PHONE, change);
    expect(september.status === 'refused' && september.reason).toMatch(/another month/);

    const index = updateStatsText(['---', 'spellbook: project', '---', ''].join('\n'), PHONE, change);
    expect(index.status === 'refused' && index.reason).toMatch(/something other than/);
  });

  it('refuses a day outside the month, and an identity that is not valid', () => {
    expect(updateStatsText(null, PHONE, [{ date: '2026-11-01', counts: { manuscriptAdded: 1 } }]).status).toBe('refused');
    expect(updateStatsText(null, PHONE, [{ date: 'yesterday', counts: { manuscriptAdded: 1 } }]).status).toBe('refused');
    expect(updateStatsText(null, { ...PHONE, device: 'bad id' }, []).status).toBe('refused');
    expect(updateStatsText(null, { ...PHONE, month: '2026-10-13' }, []).status).toBe('refused');
  });

  it('fills in the properties of a file that had lost them', () => {
    const disk = [HEADER, RULE, '| 2026-10-13 | 5 | 0 | 0 | 0 |', ''].join('\n');
    const update = updateStatsText(disk, PHONE, [{ date: '2026-10-13', counts: { manuscriptAdded: 1 } }]);
    expect(update.status === 'write' && update.text).toBe(tidy(PHONE, ['| 2026-10-13 | 6 | 0 | 0 | 0 |']));
  });
});
