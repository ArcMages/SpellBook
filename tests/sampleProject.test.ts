// The sample novel: first as a plain description (what sampleProject() says
// should be created), then created for real in the memory vault.

import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/core/newProject';
import { isFolderSeed } from '../src/core/projectSeed';
import type { BinderSeed, FolderSeed, SceneSeed } from '../src/core/projectSeed';
import { composeScene, DUE_DATE_MARK, SAMPLE_PROJECT_NAME, sampleProject, seededRandom } from '../src/core/sampleProject';
import {
  ACTION_SENTENCES,
  DIALOGUE_LINES,
  REFLECTION_SENTENCES,
  SAMPLE_CHARACTERS,
  SETTING_SENTENCES,
  SHARED_SENTENCES,
} from '../src/core/sampleText';
import { SCENE_STATUSES } from '../src/core/scene';
import { countWords } from '../src/core/wordCount';
import { MemoryVault } from './memoryVault';
import { binderOnDisk, draw, makeStore, project, seedProject, settle, TODAY, valueOf } from './storeHarness';

const HEBREW_LETTER = /[א-ת]/;
const LATIN_LETTER = /[A-Za-z]/;

const seed = sampleProject(TODAY);

function scenesOf(items: readonly BinderSeed[]): SceneSeed[] {
  return items.flatMap((item) => (isFolderSeed(item) ? scenesOf(item.children) : [item]));
}

const allScenes = scenesOf(seed.binder);
const folders = seed.binder.filter(isFolderSeed);
const hebrewScenes = allScenes.filter((scene) => HEBREW_LETTER.test(scene.title));
const englishScenes = allScenes.filter((scene) => !HEBREW_LETTER.test(scene.title));
const wordsOf = (scene: SceneSeed): number => countWords(scene.body ?? '');

const BANK = [...SETTING_SENTENCES, ...ACTION_SENTENCES, ...SHARED_SENTENCES, ...DIALOGUE_LINES, ...REFLECTION_SENTENCES];

/** How often each sentence of the bank appears in a text, whichever names were filled in. */
function bankUse(body: string): number[] {
  const anyName = `(?:${SAMPLE_CHARACTERS.join('|')})`;
  return BANK.map((sentence) => {
    const pattern = sentence
      .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
      .replace(/\{pov\}|\{other\}/g, anyName);
    return body.match(new RegExp(pattern, 'g'))?.length ?? 0;
  });
}

describe('the sample project, as described', () => {
  it('is called "Sample Novel"', () => {
    expect(SAMPLE_PROJECT_NAME).toBe('Sample Novel');
  });

  it('has two scenes at the top level around five binder folders', () => {
    expect(seed.binder.map((item) => (isFolderSeed(item) ? `[${item.folder}]` : item.title))).toEqual([
      'Prologue',
      '[Part one - Arrival]',
      '[Part two - The Survey]',
      '[Part three - Low Tide]',
      '[Part four - The Storm]',
      '[Part five - The New Map]',
      'Epilogue',
    ]);
    expect(folders).toHaveLength(5);
    expect(seed.binder.filter((item) => !isFolderSeed(item))).toHaveLength(2);
  });

  it('has about fifty scenes in the folders, none of them nested deeper', () => {
    const inFolders = folders.flatMap((folder: FolderSeed) => folder.children);
    expect(inFolders.every((item) => !isFolderSeed(item))).toBe(true);
    expect(inFolders).toHaveLength(50);
    for (const folder of folders) expect(folder.children.length, folder.folder).toBeGreaterThanOrEqual(8);
    expect(allScenes).toHaveLength(52);
  });

  it('gives every scene its own title', () => {
    const titles = allScenes.map((scene) => scene.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
    for (const scene of allScenes) expect(scene.title.trim()).toBe(scene.title);
  });

  it('gives every scene a synopsis', () => {
    for (const scene of allScenes) {
      expect((scene.synopsis ?? '').length, scene.title).toBeGreaterThan(20);
      expect(scene.synopsis, scene.title).not.toMatch(/\n/);
    }
    expect(new Set(allScenes.map((scene) => scene.synopsis)).size).toBe(allScenes.length);
  });

  it('mixes all four status values', () => {
    const counts = new Map<string, number>();
    for (const scene of allScenes) counts.set(scene.status ?? '', (counts.get(scene.status ?? '') ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual([...SCENE_STATUSES].sort());
    expect(SCENE_STATUSES).toEqual(['To do', 'First draft', 'Revised', 'Final']);
    for (const status of SCENE_STATUSES) expect(counts.get(status), status).toBeGreaterThanOrEqual(8);
  });

  it('labels every scene with one of three character names', () => {
    expect(SAMPLE_CHARACTERS).toEqual(['Mara', 'Tobias', 'Noa']);
    const counts = new Map<string, number>();
    for (const scene of allScenes) counts.set(scene.label ?? '', (counts.get(scene.label ?? '') ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual([...SAMPLE_CHARACTERS].sort());
    for (const name of SAMPLE_CHARACTERS) expect(counts.get(name), name).toBeGreaterThanOrEqual(10);
  });

  it('varies the length of the scenes from about 100 to about 1200 words', () => {
    const counts = allScenes.map(wordsOf);
    for (const [index, count] of counts.entries()) {
      expect(count, allScenes[index]?.title).toBeGreaterThanOrEqual(100);
      expect(count, allScenes[index]?.title).toBeLessThanOrEqual(1250);
    }
    expect(Math.min(...counts)).toBeLessThan(130);
    expect(Math.max(...counts)).toBeGreaterThan(1150);
    expect(counts.filter((count) => count < 300).length).toBeGreaterThanOrEqual(10);
    expect(counts.filter((count) => count >= 300 && count < 800).length).toBeGreaterThanOrEqual(10);
    expect(counts.filter((count) => count >= 800).length).toBeGreaterThanOrEqual(10);
    // no two neighbours of the same length: the list should look uneven
    expect(new Set(counts).size).toBeGreaterThan(45);
    const total = counts.reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThan(20000);
    expect(total).toBeLessThan(40000);
  });

  it('has two scenes with a Hebrew title, Hebrew synopsis and Hebrew text', () => {
    expect(hebrewScenes.map((scene) => scene.title)).toEqual(['מכתב לאחותי', 'הלילה שלפני הסערה']);
    for (const scene of hebrewScenes) {
      expect(scene.title, scene.title).not.toMatch(LATIN_LETTER);
      expect(scene.synopsis, scene.title).toMatch(HEBREW_LETTER);
      expect(scene.synopsis, scene.title).not.toMatch(LATIN_LETTER);
      const body = scene.body ?? '';
      expect(body, scene.title).not.toMatch(LATIN_LETTER);
      const letters = [...body].filter((character) => /\p{L}/u.test(character));
      expect(letters.length).toBeGreaterThan(400);
      expect(letters.every((character) => HEBREW_LETTER.test(character))).toBe(true);
      expect(wordsOf(scene), scene.title).toBeGreaterThanOrEqual(100);
      // paragraphs, not one block
      expect(body.split('\n\n').length).toBeGreaterThanOrEqual(4);
    }
  });

  it('writes the English scenes about their own character, with nothing left to fill in', () => {
    for (const scene of englishScenes) {
      const body = scene.body ?? '';
      expect(body, scene.title).not.toMatch(/[{}]/);
      expect(body, scene.title).not.toMatch(/undefined|null|\[object/);
      expect(body, scene.title).toContain(scene.label as string);
      expect(body.endsWith('\n'), scene.title).toBe(true);
      expect(body, scene.title).not.toMatch(/\n{3,}/);
      expect(body, scene.title).not.toMatch(/ {2,}/);
      // a character never talks to or about themselves as "the other"
      expect(body, scene.title).not.toMatch(new RegExp(`${scene.label} and ${scene.label}\\b`));
      expect(body, scene.title).not.toMatch(new RegExp(`${scene.label} passed the rope to ${scene.label}\\b`));
    }
  });

  it('fills in the names sensibly: the scene\'s own character, and somebody else as the other', () => {
    const anyName = `(${SAMPLE_CHARACTERS.join('|')})`;
    const escape = (text: string): string => text.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    let checked = 0;
    for (const scene of englishScenes) {
      for (const sentence of BANK) {
        const pieces = sentence.split(/(\{pov\}|\{other\})/);
        const slots = pieces.filter((piece) => piece === '{pov}' || piece === '{other}');
        if (slots.length === 0) continue;
        const pattern = pieces.map((piece) => (piece === '{pov}' || piece === '{other}' ? anyName : escape(piece))).join('');
        const found = new RegExp(pattern).exec(scene.body ?? '');
        if (!found) continue;
        const others = new Set<string>();
        slots.forEach((slot, index) => {
          const name = found[index + 1] as string;
          if (slot === '{pov}') expect(name, `${scene.title}: ${sentence}`).toBe(scene.label);
          else {
            expect(name, `${scene.title}: ${sentence}`).not.toBe(scene.label);
            others.add(name);
          }
        });
        expect(others.size, `${scene.title}: ${sentence}`).toBeLessThanOrEqual(1); // one "other" per sentence
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('does not start every scene the same way', () => {
    const openings = englishScenes.map((scene) => (scene.body ?? '').replace(/^%%[^\n]*\n\n/, '').split('\n\n')[0]);
    expect(new Set(openings).size).toBeGreaterThanOrEqual(englishScenes.length - 2);
    // both of the other two characters turn up across the book, not always the same one
    for (const name of SAMPLE_CHARACTERS) {
      const elsewhere = englishScenes.filter((scene) => scene.label !== name && (scene.body ?? '').includes(name));
      expect(elsewhere.length, name).toBeGreaterThan(15);
    }
  });

  it('never uses a sentence twice in one scene', () => {
    for (const scene of englishScenes) {
      const use = bankUse(scene.body ?? '');
      expect(use.filter((times) => times > 0).length, scene.title).toBeGreaterThan(4);
      const repeated = BANK.filter((_, index) => (use[index] as number) > 1);
      expect(repeated, scene.title).toEqual([]);
    }
  });

  it('writes the English scenes out of the sentence bank and nothing else', () => {
    for (const scene of englishScenes) {
      let rest = scene.body ?? '';
      const anyName = `(?:${SAMPLE_CHARACTERS.join('|')})`;
      for (const sentence of BANK) {
        const pattern = sentence.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{pov\}|\{other\}/g, anyName);
        rest = rest.replace(new RegExp(pattern, 'g'), '');
      }
      expect(rest.replace(/%%[^%]*%%/, '').trim(), scene.title).toBe('');
    }
  });

  it('marks the scenes still to do with a comment that is not counted as words', () => {
    const toDo = allScenes.filter((scene) => scene.status === 'To do');
    expect(toDo.length).toBeGreaterThan(5);
    for (const scene of toDo) {
      const body = scene.body ?? '';
      expect(body.startsWith('%% '), scene.title).toBe(true);
      const withoutComment = body.slice(body.indexOf('%%', 2) + 2);
      expect(wordsOf(scene), scene.title).toBe(countWords(withoutComment));
      expect(wordsOf(scene), scene.title).toBeLessThan(400);
    }
    for (const scene of allScenes.filter((candidate) => candidate.status !== 'To do')) {
      expect(scene.body, scene.title).not.toContain('%%');
    }
  });

  it('has three to-do lines, two of them due a few days from today, in the Tasks plugin format', () => {
    const lines = (seed.todo ?? '').trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toMatch(/^- \[[ x]\] \S/);
    expect(lines[0]).toBe(`- [ ] Rewrite "Fog on the Crossing" from Tobias's side ${DUE_DATE_MARK} 2026-10-16`);
    expect(lines[1]).toBe(`- [ ] Check the tide times in "Low Water" against the research note ${DUE_DATE_MARK} 2026-10-23`);
    expect(lines[2]).toBe('- [x] Choose a name for the ferry');
    expect(DUE_DATE_MARK.codePointAt(0)).toBe(0x1f4c5);
    expect((seed.todo ?? '').endsWith('\n')).toBe(true);
    // the to-dos name scenes that exist
    expect(allScenes.map((scene) => scene.title)).toEqual(expect.arrayContaining(['Fog on the Crossing', 'Low Water']));
  });

  it('has two research notes and one note that is left out of the binder', () => {
    expect((seed.research ?? []).map((note) => note.title)).toEqual(['Tides and the bay', 'People of Saltwick']);
    for (const note of seed.research ?? []) expect(countWords(note.body), note.title).toBeGreaterThan(30);
    expect((seed.unfiled ?? []).map((note) => note.title)).toEqual(['The Night Market']);
    expect(allScenes.map((scene) => scene.title)).not.toContain('The Night Market');
    expect(countWords(seed.unfiled?.[0]?.body ?? '')).toBeGreaterThan(30);
  });

  it('is the same every time, and only the to-do dates follow the calendar', () => {
    expect(sampleProject(TODAY)).toEqual(seed);
    expect(JSON.stringify(sampleProject(TODAY))).toBe(JSON.stringify(seed));

    const later = sampleProject('2027-02-27');
    expect(later.binder).toEqual(seed.binder);
    expect(later.research).toEqual(seed.research);
    expect(later.unfiled).toEqual(seed.unfiled);
    expect(later.todo).not.toBe(seed.todo);
    expect(later.todo).toContain(`${DUE_DATE_MARK} 2027-03-02`);
    expect(later.todo).toContain(`${DUE_DATE_MARK} 2027-03-09`);
  });

  it('is plain data: text and lists only', () => {
    expect(JSON.parse(JSON.stringify(seed))).toEqual(seed);
  });
});

describe('the sentence bank', () => {
  const bank = BANK;

  it('has no sentence twice, and enough words for the longest scene without repeating', () => {
    expect(new Set(bank).size).toBe(bank.length);
    const words = bank.reduce((sum, sentence) => sum + sentence.split(' ').length, 0);
    expect(words).toBeGreaterThan(1400);
  });

  it('uses only the two placeholders, and never "he" or "she" for a character it does not know', () => {
    for (const sentence of bank) {
      expect(sentence.replace(/\{pov\}|\{other\}/g, ''), sentence).not.toMatch(/[{}]/);
      expect(sentence, sentence).not.toMatch(/\b(he|she|his|her|hers|him|himself|herself)\b/i);
      expect(sentence.trim(), sentence).toBe(sentence);
      expect(sentence, sentence).toMatch(/[.?!]"?$/);
    }
    for (const sentence of ACTION_SENTENCES) expect(sentence, sentence).toContain('{pov}');
    for (const sentence of [...SETTING_SENTENCES, ...REFLECTION_SENTENCES]) expect(sentence, sentence).not.toMatch(/[{}]/);
    for (const line of DIALOGUE_LINES) expect(line.startsWith('"'), line).toBe(true);
  });
});

describe('composeScene', () => {
  it('writes at least as many words as asked, and not many more', () => {
    for (const words of [1, 50, 100, 333, 800, 1200]) {
      for (const character of [0, 1, 2]) {
        const body = composeScene(character, words, 99 + words);
        const written = body.trim().split(/\s+/).length;
        expect(written, `${words} words`).toBeGreaterThanOrEqual(words);
        expect(written, `${words} words`).toBeLessThanOrEqual(words + 35);
      }
    }
  });

  it('gives the same text for the same seed and a different one for another', () => {
    expect(composeScene(0, 400, 12345)).toBe(composeScene(0, 400, 12345));
    expect(composeScene(0, 400, 12345)).not.toBe(composeScene(0, 400, 12346));
    expect(composeScene(0, 400, 12345)).not.toBe(composeScene(1, 400, 12345));
  });

  it('keeps going, reusing sentences, when asked for more than the whole bank', () => {
    const body = composeScene(2, 6000, 5);
    expect(body.trim().split(/\s+/).length).toBeGreaterThanOrEqual(6000);
    expect(body).not.toMatch(/[{}]/);
    expect(body).not.toMatch(/\n{3,}/);
  });

  it('survives odd requests', () => {
    expect(composeScene(0, 0, 1).trim().length).toBeGreaterThan(0);
    expect(composeScene(0, -5, 1).trim().length).toBeGreaterThan(0);
    expect(composeScene(7, 20, 1)).toContain('Tobias'); // 7 wraps round to the second character
  });
});

describe('seededRandom', () => {
  it('repeats exactly for the same seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const run = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(run);
    expect(new Set(run).size).toBe(50);
  });

  it('stays from 0 up to, but not including, 1, and is spread out', () => {
    const random = seededRandom(1);
    const values = Array.from({ length: 5000 }, () => random());
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });
});

describe('the sample project, created in a vault', () => {
  async function create(vault: MemoryVault = new MemoryVault()) {
    const harness = makeStore(vault);
    const made = valueOf(await createSampleProject(harness.store, TODAY));
    return { ...harness, made };
  }

  it('creates "Sample Novel", opens it, and points at its first scene', async () => {
    const { store, made } = await create();

    expect(made.project).toMatchObject({ indexPath: 'Sample Novel/Sample Novel.md', folder: 'Sample Novel', title: 'Sample Novel' });
    expect(made.project.scenes).toHaveLength(52);
    expect(made.firstScene).toBe('Sample Novel/Manuscript/Prologue.md');

    const open = project(store);
    expect(open).toMatchObject({ indexPath: 'Sample Novel/Sample Novel.md', title: 'Sample Novel', readOnly: false, error: null, notes: [] });
    expect(open.tree.map((node) => (node.kind === 'folder' ? `[${node.name}] ${node.children.length}` : node.title))).toEqual([
      'Prologue',
      '[Part one - Arrival] 9',
      '[Part two - The Survey] 11',
      '[Part three - Low Tide] 10',
      '[Part four - The Storm] 11',
      '[Part five - The New Map] 9',
      'Epilogue',
    ]);
    expect(draw(open.tree)).not.toContain('?'); // no scene is Missing
    expect(open.missing).toEqual([]);
  });

  it('shows the note that was left out of the binder as Unfiled', async () => {
    const { store, vault } = await create();
    expect(project(store).unfiled).toEqual(['Manuscript/The Night Market.md']);
    expect(vault.frontmatterOf('Sample Novel/Manuscript/The Night Market.md')).toBeNull();
    expect(JSON.stringify(binderOnDisk(vault, 'Sample Novel/Sample Novel.md'))).not.toContain('Night Market');
  });

  it('creates exactly the project structure, all inside its own folder', async () => {
    const vault = new MemoryVault().seed('Welcome.md', { body: 'hello' });
    seedProject(vault, { folder: 'Other', scenes: { A: 1024 } });
    const before = vault.paths();
    const { made } = await create(vault);

    const created = vault.paths().filter((path) => !before.includes(path));
    expect(created.every((path) => path.startsWith('Sample Novel/'))).toBe(true);
    expect(created.filter((path) => path.startsWith('Sample Novel/Manuscript/'))).toHaveLength(53);
    expect(created.filter((path) => path.startsWith('Sample Novel/Research/'))).toEqual([
      'Sample Novel/Research/People of Saltwick.md',
      'Sample Novel/Research/Tides and the bay.md',
    ]);
    expect(created).toContain('Sample Novel/Sample Novel.md');
    expect(created).toContain('Sample Novel/To-do.md');
    expect(created).toHaveLength(53 + 2 + 2);
    for (const sub of ['Manuscript', 'Timeline', 'Research', 'Stats']) expect(vault.hasFolder(`Sample Novel/${sub}`), sub).toBe(true);
    expect(vault.paths().filter((path) => path.startsWith('Sample Novel/Timeline/') || path.startsWith('Sample Novel/Stats/'))).toEqual([]);

    // only creations, plus the one write that lists the scenes in the new index
    expect(vault.writes.filter((write) => write.op !== 'createFile' && write.op !== 'createFolder')).toEqual([
      { op: 'updateFrontmatter', path: 'Sample Novel/Sample Novel.md' },
    ]);
    expect(vault.writes.every((write) => write.path.startsWith('Sample Novel'))).toBe(true);
    expect(vault.trashed).toEqual([]);
    expect(vault.bodyOf('Welcome.md')).toBe('hello');
    expect(vault.bodyOf('Other/Manuscript/A.md')).toContain('dark and stormy');
    expect(made.project.scenes.every((path) => path.startsWith('Manuscript/'))).toBe(true);
  });

  it('writes the index as the design says: scene paths as text, folders with a name, an id and children', async () => {
    const { vault, made } = await create();
    const index = vault.frontmatterOf('Sample Novel/Sample Novel.md') ?? {};
    expect(Object.keys(index)).toEqual(['spellbook', 'version', 'title', 'binder']);
    expect(index).toMatchObject({ spellbook: 'project', version: 1, title: 'Sample Novel' });
    expect(vault.bodyOf('Sample Novel/Sample Novel.md')).toBe('');

    const binder = index['binder'] as Array<string | { folder: string; id: string; children: string[] }>;
    expect(binder).toHaveLength(7);
    expect(binder[0]).toBe('Manuscript/Prologue.md');
    expect(binder[6]).toBe('Manuscript/Epilogue.md');
    const parts = binder.slice(1, 6) as Array<{ folder: string; id: string; children: string[] }>;
    const ids = parts.map((part) => part.id);
    for (const part of parts) {
      expect(Object.keys(part)).toEqual(['folder', 'id', 'children']);
      expect(part.id).toMatch(/^f-[a-z0-9]{6}$/);
      expect(part.children.every((child) => typeof child === 'string' && /^Manuscript\/[^/]+\.md$/.test(child))).toBe(true);
    }
    expect(new Set(ids).size).toBe(5);
    expect(parts[1]?.children).toContain('Manuscript/מכתב לאחותי.md');
    expect(parts[3]?.children).toContain('Manuscript/הלילה שלפני הסערה.md');

    const listed = [binder[0] as string, ...parts.flatMap((part) => part.children), binder[6] as string];
    expect(listed).toEqual(made.project.scenes);
    expect(new Set(listed).size).toBe(52);
  });

  it('gives every scene the standard properties, with order keys 1024 apart in manuscript order', async () => {
    const { vault, made } = await create();
    made.project.scenes.forEach((relative, index) => {
      const path = `Sample Novel/${relative}`;
      const frontmatter = vault.frontmatterOf(path) ?? {};
      expect(Object.keys(frontmatter), path).toEqual(['synopsis', 'status', 'label', 'compile', 'order', 'created']);
      expect(frontmatter['order'], path).toBe(1024 * (index + 1));
      expect(frontmatter['compile'], path).toBe(true);
      expect(frontmatter['created'], path).toBe(TODAY);
      expect(SCENE_STATUSES, path).toContain(frontmatter['status']);
      expect(SAMPLE_CHARACTERS, path).toContain(frontmatter['label']);
      expect(String(frontmatter['synopsis']).length, path).toBeGreaterThan(20);
      // the note holds exactly the text that was described, and its title is its file name
      const described = allScenes[index] as SceneSeed;
      expect(relative, path).toBe(`Manuscript/${described.title}.md`);
      expect(vault.bodyOf(path), path).toBe(described.body);
      expect(frontmatter['synopsis'], path).toBe(described.synopsis);
    });
  });

  it('counts the same words in the notes as were described, properties not included', async () => {
    const { vault, made } = await create();
    let total = 0;
    for (const [index, relative] of made.project.scenes.entries()) {
      const words = countWords(await vault.readText(`Sample Novel/${relative}`));
      expect(words, relative).toBe(wordsOf(allScenes[index] as SceneSeed));
      total += words;
    }
    expect(total).toBeGreaterThan(20000);
  });

  it('writes the to-do note and the research notes as plain notes', async () => {
    const { vault } = await create();
    expect(vault.bodyOf('Sample Novel/To-do.md')).toBe(seed.todo);
    expect(vault.frontmatterOf('Sample Novel/To-do.md')).toBeNull();
    expect(vault.bodyOf('Sample Novel/Research/Tides and the bay.md')).toMatch(/^# Tides and the bay\n/);
    expect(vault.frontmatterOf('Sample Novel/Research/People of Saltwick.md')).toBeNull();
    for (const name of SAMPLE_CHARACTERS) expect(vault.bodyOf('Sample Novel/Research/People of Saltwick.md')).toContain(`**${name}**`);
  });

  it('creates "Sample Novel 2", then "Sample Novel 3", without touching the earlier ones', async () => {
    const { store, vault, made } = await create();
    const firstPaths = vault.paths();
    const firstWrites = vault.writes.length;

    const second = valueOf(await createSampleProject(store, TODAY));
    const third = valueOf(await createSampleProject(store, TODAY));

    expect(second.project).toMatchObject({ folder: 'Sample Novel 2', title: 'Sample Novel 2', indexPath: 'Sample Novel 2/Sample Novel 2.md' });
    expect(second.firstScene).toBe('Sample Novel 2/Manuscript/Prologue.md');
    expect(third.project).toMatchObject({ folder: 'Sample Novel 3', title: 'Sample Novel 3' });
    expect(vault.frontmatterOf('Sample Novel 2/Sample Novel 2.md')?.['title']).toBe('Sample Novel 2');
    expect(store.listProjects().map((p) => p.title)).toEqual(['Sample Novel', 'Sample Novel 2', 'Sample Novel 3']);
    expect(project(store).title).toBe('Sample Novel 3'); // the newest one is open

    expect(vault.writes.slice(firstWrites).some((write) => write.path.startsWith('Sample Novel/') || write.path === 'Sample Novel')).toBe(false);
    for (const path of firstPaths) expect(vault.has(path), path).toBe(true);
    expect(vault.bodyOf(`Sample Novel 2/${made.project.scenes[1]}`)).toBe(vault.bodyOf(`Sample Novel/${made.project.scenes[1]}`));
    expect(vault.paths().filter((path) => path.startsWith('Sample Novel 2/'))).toHaveLength(57);
  });

  it('can be created inside another folder', async () => {
    const vault = new MemoryVault().seedFolder('Writing');
    const { store } = makeStore(vault);
    const made = valueOf(await createSampleProject(store, TODAY, 'Writing'));
    expect(made.firstScene).toBe('Writing/Sample Novel/Manuscript/Prologue.md');
    expect(project(store).folder).toBe('Writing/Sample Novel');
    expect(project(store).unfiled).toEqual(['Manuscript/The Night Market.md']);
  });

  it('comes out the same in two different vaults', async () => {
    const one = await create();
    const two = await create();
    expect(two.vault.paths()).toEqual(one.vault.paths());
    for (const path of one.vault.paths()) {
      expect(two.vault.bodyOf(path), path).toBe(one.vault.bodyOf(path));
      expect(two.vault.frontmatterOf(path), path).toEqual(one.vault.frontmatterOf(path));
    }
  });

  it('needs no tidying afterwards: moving one scene rewrites one scene note', async () => {
    const { store, vault, timers } = await create();
    timers.advance(10000);
    await settle(store);
    expect(vault.writes.filter((write) => write.op === 'updateFrontmatter')).toHaveLength(1); // only the index, at creation
    vault.clearWrites();

    const moved = await store.moveNode(
      { kind: 'scene', path: 'Manuscript/Epilogue.md' },
      { at: 'after', sibling: { kind: 'scene', path: 'Manuscript/Prologue.md' } },
    );
    expect(moved.status).toBe('done');
    timers.advance(10000);
    await settle(store);

    expect(vault.writes.map((write) => `${write.op} ${write.path}`)).toEqual([
      'updateFrontmatter Sample Novel/Sample Novel.md',
      'updateFrontmatter Sample Novel/Manuscript/Epilogue.md',
    ]);
    expect(vault.frontmatterOf('Sample Novel/Manuscript/Epilogue.md')?.['order']).toBe(1536);
  });

  it('reports a failure part-way honestly, opens nothing and deletes nothing', async () => {
    const { store, vault } = makeStore();
    vault.failNext('createFile', 'Sample Novel/Manuscript/Low Water.md');

    const result = await createSampleProject(store, TODAY);

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.message).toMatch(/only partly created/);
    expect(result.message).toMatch(/Low Water/);
    expect(store.project).toBeNull();
    expect(vault.trashed).toEqual([]);
    expect(vault.has('Sample Novel/Manuscript/Prologue.md')).toBe(true);
    // a second try does not collide with the half-made folder
    const retry = valueOf(await createSampleProject(store, TODAY));
    expect(retry.project.folder).toBe('Sample Novel 2');
  });
});
