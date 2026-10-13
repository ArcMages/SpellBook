// The sample novel: first as a plain description (what sampleProject() says
// should be created), then created for real in the memory vault.

import { describe, expect, it } from 'vitest';
import { TAG_INDEX_KEYS, readTagLists } from '../src/core/cards';
import { createSampleProject } from '../src/core/newProject';
import { TARGET_BANDS, formatPercent, targetCell } from '../src/core/outliner';
import { MARKS_KEY, parseMarks } from '../src/core/planner';
import { TARGETS_KEY, parseTargets } from '../src/core/progress';
import { isFolderSeed } from '../src/core/projectSeed';
import type { BinderSeed, FolderSeed, SceneSeed } from '../src/core/projectSeed';
import {
  composeScene,
  DUE_DATE_MARK,
  SAMPLE_PROJECT_NAME,
  SAMPLE_TIMELINES_KEY,
  sampleProject,
  seededRandom,
} from '../src/core/sampleProject';
import {
  ACTION_SENTENCES,
  DIALOGUE_LINES,
  REFLECTION_SENTENCES,
  SAMPLE_CHARACTERS,
  SAMPLE_ENTITIES,
  SAMPLE_EVENTS,
  SAMPLE_SCENE_ENTITIES,
  SAMPLE_SCENE_TARGETS,
  SETTING_SENTENCES,
  SHARED_SENTENCES,
} from '../src/core/sampleText';
import { SCENE_STATUSES } from '../src/core/scene';
import { displayLanes, eventLaneKeys, readLanes, readTimeline, storyDateToDayNumber } from '../src/core/timeline';
import { TIMELINES_KEY } from '../src/features/timeline/timelineWiring';
import { countWords } from '../src/core/wordCount';
import {
  BUILT_IN_TYPES,
  buildRelations,
  buildWorldLinks,
  entityFields,
  findType,
  newEntityBody,
  newEntityFrontmatter,
  parseLink,
  parseRelation,
  readEntities,
  readEntityLinks,
  readEntityTypes,
  readRelationEntries,
  resolveImage,
} from '../src/core/world';
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

  it('is the same every time, and only the to-do dates, the day marks and the deadline follow the calendar', () => {
    expect(sampleProject(TODAY)).toEqual(seed);
    expect(JSON.stringify(sampleProject(TODAY))).toBe(JSON.stringify(seed));

    const later = sampleProject('2027-02-27');
    expect(later.binder).toEqual(seed.binder);
    expect(later.research).toEqual(seed.research);
    expect(later.unfiled).toEqual(seed.unfiled);
    expect(later.events).toEqual(seed.events);
    expect(later.todo).not.toBe(seed.todo);
    expect(later.todo).toContain(`${DUE_DATE_MARK} 2027-03-02`);
    expect(later.todo).toContain(`${DUE_DATE_MARK} 2027-03-09`);

    // Of what goes into the index, only the marks' days and the deadline moved.
    const { marks, targets, ...fixed } = seed.data ?? {};
    const { marks: laterMarks, targets: laterTargets, ...laterFixed } = later.data ?? {};
    expect(laterFixed).toEqual(fixed);
    expect(Object.keys(fixed)).toEqual(['statuses', 'labels', 'timelines']);
    expect(Object.values(laterMarks as object)).toEqual(Object.values(marks as object));
    expect(Object.keys(laterMarks as object)).toEqual(['2027-03-01', '2027-03-05']);
    expect(laterTargets).toEqual({ ...(targets as object), deadline: '2027-07-27' });
  });

  it('is plain data: text and lists only', () => {
    expect(JSON.parse(JSON.stringify(seed))).toEqual(seed);
  });
});

describe('the sample project, for the screens besides the binder', () => {
  const data = seed.data ?? {};
  const events = seed.events ?? [];
  const eventNotes = events.map((event) => ({ path: `Sample Novel/Timeline/${event.title}.md`, frontmatter: event.frontmatter }));
  const sceneNotes = allScenes.map((scene) => ({
    path: `Sample Novel/Manuscript/${scene.title}.md`,
    frontmatter: scene.date === undefined ? {} : { date: scene.date },
  }));

  it('keeps five things in the index, under the names the screens read them by', () => {
    expect(Object.keys(data)).toEqual(['statuses', 'labels', 'timelines', 'marks', 'targets']);
    expect([TAG_INDEX_KEYS.status, TAG_INDEX_KEYS.label, TIMELINES_KEY, MARKS_KEY, TARGETS_KEY]).toEqual(Object.keys(data));
    expect(SAMPLE_TIMELINES_KEY).toBe(TIMELINES_KEY);
  });

  it('gives each of the four statuses a colour, and each of the three characters\' labels', () => {
    expect(data['statuses']).toEqual([
      { name: 'To do', color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: 'Revised', color: 'blue' },
      { name: 'Final', color: 'green' },
    ]);
    expect(data['labels']).toEqual([
      { name: 'Mara', color: 'purple' },
      { name: 'Tobias', color: 'cyan' },
      { name: 'Noa', color: 'pink' },
    ]);
    // The corkboard reads them without a complaint, and finds every scene's status and label among them.
    const lists = readTagLists(data);
    for (const list of [lists.statuses, lists.labels]) {
      expect(list.problems).toEqual([]);
      expect(list.fromDefaults).toBe(false);
      expect(list.unreadable).toBe(false);
      expect(list.tags.every((tag) => tag.color !== null)).toBe(true);
    }
    expect(lists.statuses.tags.map((tag) => tag.name)).toEqual([...SCENE_STATUSES]);
    expect(lists.labels.tags.map((tag) => tag.name)).toEqual([...SAMPLE_CHARACTERS]);
    expect(new Set(lists.labels.tags.map((tag) => tag.color)).size).toBe(3);
    expect(new Set(lists.statuses.tags.map((tag) => tag.color)).size).toBe(4);
  });

  it('has three timelines, each with a colour of its own', () => {
    expect(data['timelines']).toEqual([
      { name: 'Main plot', color: 'purple' },
      { name: "Mara's survey", color: 'cyan' },
      { name: 'Backstory', color: 'orange' },
    ]);
    const lanes = readLanes(data['timelines']);
    expect(lanes.problems).toEqual([]);
    expect(lanes.readable).toBe(true);
    expect(lanes.lanes.map((lane) => [lane.name, lane.color])).toEqual([
      ['Main plot', 'purple'],
      ["Mara's survey", 'cyan'],
      ['Backstory', 'orange'],
    ]);
  });

  it('has ten events, exactly these, each a note of its own with the properties the timeline reads', () => {
    expect(events.map((event) => [event.title, event.frontmatter['date'], event.frontmatter['end'], event.frontmatter['timelines']])).toEqual([
      ['The lighthouse is closed', '1922-11', undefined, ['Backstory']],
      ['The old chart is last corrected', '1923-02-10', undefined, ['Backstory']],
      ['The winter storm', '1923-10-12', undefined, ['Main plot']],
      ['Mara arrives in Saltwick', '1923-10-14', undefined, ['Main plot', "Mara's survey"]],
      ['The survey of the bay', '1923-10-20', '1923-12-01', ["Mara's survey"]],
      ['נועה מוצאת את המפה הישנה', '1923-11-05', undefined, ['Main plot']],
      ['The lowest tide of the month', '1923-11-08', undefined, ["Mara's survey"]],
      ['The missing boat is found', '1923-11-19', undefined, ['Main plot']],
      ['The second storm', '1923-12-03', undefined, ['Main plot']],
      ['The new chart is published', '1924-03', undefined, ["Mara's survey"]],
    ]);
    expect(new Set(events.map((event) => event.title)).size).toBe(10);
    for (const event of events) {
      const keys = Object.keys(event.frontmatter);
      expect(keys.slice(0, 2), event.title).toEqual(['spellbook', 'date']);
      expect(keys.filter((key) => !['spellbook', 'date', 'end', 'timelines', 'scenes', 'tags', 'entities'].includes(key)), event.title).toEqual([]);
      expect(event.frontmatter['spellbook']).toBe('event');
      expect((event.body ?? '').trim().length, event.title).toBeGreaterThan(10);
      expect((event.body ?? '').endsWith('\n')).toBe(true);
    }
    expect(SAMPLE_EVENTS).toHaveLength(10);
  });

  it('has one event that lasts six weeks, one in two timelines and one with a Hebrew title', () => {
    const model = readTimeline(eventNotes, []);
    expect(model.undated).toEqual([]);
    expect(model.dated).toHaveLength(10);
    // The timeline reads every one of them without a complaint.
    expect(model.dated.flatMap((event) => event.problems)).toEqual([]);

    const spans = model.dated.filter((event) => event.end !== null);
    expect(spans.map((event) => event.title)).toEqual(['The survey of the bay']);
    const [survey] = spans;
    if (!survey?.start || !survey.end) throw new Error('the survey has no dates');
    expect(storyDateToDayNumber(survey.end) - storyDateToDayNumber(survey.start)).toBe(42); // six weeks to the day

    const shared = model.dated.filter((event) => event.timelines.length > 1);
    expect(shared.map((event) => [event.title, event.timelines])).toEqual([
      ['Mara arrives in Saltwick', ['Main plot', "Mara's survey"]],
    ]);

    const hebrew = model.dated.filter((event) => HEBREW_LETTER.test(event.title));
    expect(hebrew.map((event) => event.title)).toEqual(['נועה מוצאת את המפה הישנה']);
    expect(LATIN_LETTER.test(hebrew[0]?.title ?? 'x')).toBe(false);
    expect(hebrew[0]?.tags).toEqual(['ארכיון']);
    expect(HEBREW_LETTER.test(events.find((event) => event.title === hebrew[0]?.title)?.body ?? '')).toBe(true);
  });

  it('puts every event in a timeline the project lists, and links only scenes that exist', () => {
    const lanes = readLanes(data['timelines']).lanes;
    const model = readTimeline(eventNotes, []);
    const shown = displayLanes(lanes, model.dated);
    // Three lanes of the project's own; nothing fell into "Other".
    expect(shown.map((lane) => lane.name)).toEqual(['Manuscript', 'Main plot', "Mara's survey", 'Backstory']);
    const perLane = new Map<string, number>();
    for (const event of model.dated) {
      for (const key of eventLaneKeys(event, lanes)) perLane.set(key, (perLane.get(key) ?? 0) + 1);
    }
    expect([...perLane]).toEqual([
      ['backstory', 2],
      ['main plot', 5],
      ["mara's survey", 4],
    ]);
    const titles = new Set(allScenes.map((scene) => scene.title));
    const linked = model.dated.flatMap((event) => event.scenes);
    expect(linked.length).toBeGreaterThan(8);
    for (const link of linked) expect(titles.has(link), link).toBe(true);
  });

  it('gives four scenes a date in the story, so the Manuscript lane has something to show', () => {
    expect(allScenes.filter((scene) => scene.date !== undefined).map((scene) => [scene.title, scene.date])).toEqual([
      ['Prologue', '1923-10-12'],
      ['The Last Ferry', '1923-10-14'],
      ['Low Water', '1923-11-08'],
      ['הלילה שלפני הסערה', '1923-12-02'],
    ]);
    const model = readTimeline(eventNotes, sceneNotes);
    const scenes = model.dated.filter((event) => event.source === 'scene');
    expect(scenes.map((event) => event.title)).toEqual(['Prologue', 'The Last Ferry', 'Low Water', 'הלילה שלפני הסערה']);
    expect(scenes.flatMap((event) => event.problems)).toEqual([]);
    // Everything together sits within a year and a half, so "Fit" shows cards, not dots.
    const all = model.dated.map((event) => (event.start ? storyDateToDayNumber(event.start) : 0));
    expect(Math.max(...all) - Math.min(...all)).toBeLessThan(550);
  });

  it('gives eighteen scenes a word target, so the Target column has every kind of row to show', () => {
    const targeted = allScenes.filter((scene) => scene.target !== undefined);
    // Each with its target, the words it has (as the plugin counts them), and what the outliner makes of the two.
    const shown = targeted.map((scene) => {
      const cell = targetCell(wordsOf(scene), scene.target);
      return [scene.title, scene.target, wordsOf(scene), formatPercent(cell), cell?.band];
    });
    expect(shown).toEqual([
      ['Prologue', 300, 347, '115%', 'done'],
      ['The Last Ferry', 1000, 1188, '118%', 'done'],
      ['What the Harbour Master Wants', 878, 878, '100%', 'done'],
      ['First Soundings', 1200, 1051, '87%', 'near'],
      ['Lamp in the Empty House', 554, 554, '100%', 'done'],
      ['Low Water', 1400, 1210, '86%', 'near'],
      ['מכתב לאחותי', 159, 159, '100%', 'done'],
      ['The Village on the Old Map', 900, 995, '110%', 'done'],
      ['An Argument About North', 1000, 577, '57%', 'mid'],
      ['Triangles', 800, 303, '37%', 'low'],
      ['The Drowned Lane', 1109, 1109, '100%', 'done'],
      ['Mending Nets', 900, 530, '58%', 'mid'],
      ['The Missing Boat', 800, 957, '119%', 'done'],
      ['הלילה שלפני הסערה', 250, 143, '57%', 'mid'],
      ['What the Keeper Wrote', 1300, 1160, '89%', 'near'],
      ['Adrift', 900, 193, '21%', 'low'],
      ['Starting Over', 600, 509, '84%', 'near'],
      ['The Honest Chart', 1000, 224, '22%', 'low'],
    ]);
    // About a third of the scenes, and every name in the list of targets is a scene.
    expect(allScenes).toHaveLength(52);
    expect(targeted).toHaveLength(18);
    expect(Object.keys(SAMPLE_SCENE_TARGETS).sort()).toEqual(targeted.map((scene) => scene.title).sort());
    // Four have more words than their target, four exactly as many, ten fewer.
    const aimOf = (scene: SceneSeed): number => scene.target ?? 0;
    expect(targeted.filter((scene) => wordsOf(scene) > aimOf(scene))).toHaveLength(4);
    expect(targeted.filter((scene) => wordsOf(scene) === aimOf(scene)).map((scene) => scene.title)).toEqual(
      Object.keys(SAMPLE_SCENE_TARGETS).filter((title) => SAMPLE_SCENE_TARGETS[title] === 'reached'),
    );
    expect(targeted.filter((scene) => wordsOf(scene) === aimOf(scene))).toHaveLength(4);
    expect(targeted.filter((scene) => wordsOf(scene) < aimOf(scene))).toHaveLength(10);
    // Every band of the Target column is on show, and both languages.
    expect(new Set(shown.map((row) => row[4]))).toEqual(new Set(TARGET_BANDS));
    expect(targeted.filter((scene) => HEBREW_LETTER.test(scene.title))).toHaveLength(2);
    // A target is a whole number of words; a scene without one has no such entry at all.
    for (const scene of targeted) expect(Number.isInteger(scene.target) && aimOf(scene) > 0, scene.title).toBe(true);
    for (const scene of allScenes) expect('target' in scene, scene.title).toBe(scene.target !== undefined);
  });

  it('marks two days on the calendar, a few days after the day it is made', () => {
    expect(data['marks']).toEqual({
      '2026-10-15': { color: 'blue', label: 'Writing group' },
      '2026-10-19': { color: 'green', label: 'Day off' },
    });
    const parsed = parseMarks(data['marks']);
    expect(parsed.notes).toEqual([]);
    expect([...parsed.marks]).toEqual([
      ['2026-10-15', { color: 'blue', label: 'Writing group' }],
      ['2026-10-19', { color: 'green', label: 'Day off' }],
    ]);
    // Across the end of a month and of a year, they are still two and six days on.
    expect(Object.keys((sampleProject('2026-12-28').data ?? {})['marks'] as object)).toEqual(['2026-12-30', '2027-01-03']);
  });

  it('sets the targets: 80,000 words in all, 1,000 a day, and a deadline some months ahead', () => {
    expect(data['targets']).toEqual({ project: 80000, daily: 1000, deadline: '2027-03-12' });
    const parsed = parseTargets(data['targets']);
    expect(parsed.problems).toEqual([]);
    expect(parsed.targets).toEqual({ project: 80000, daily: 1000, deadline: '2027-03-12' });
    // 150 days: about five months, whenever the sample is made.
    expect(((sampleProject('2027-02-27').data ?? {})['targets'] as { deadline: string }).deadline).toBe('2027-07-27');
  });

  it('invents no writing history: nothing in it is a word log', () => {
    expect(Object.keys(seed).sort()).toEqual(['binder', 'data', 'events', 'research', 'todo', 'unfiled', 'world']);
    expect(JSON.stringify(seed)).not.toMatch(/Stats\//);
  });
});

describe('the sample project, its world', () => {
  const world = seed.world ?? [];
  const events = seed.events ?? [];
  const names = world.map((entity) => entity.title);
  /** The names a list of links leads to, as they are written. */
  const linked = (frontmatter: Readonly<Record<string, unknown>>): string[] =>
    readEntityLinks(frontmatter).map((link) => parseLink(link)?.target ?? `not a link: ${link}`);

  it('has eighteen entities, exactly these, each in the folder of its type, and at least one of every type', () => {
    expect(world.map((entity) => `${entity.folder}/${entity.title}`)).toEqual([
      'Characters/Mara',
      'Characters/Tobias',
      'Characters/Noa',
      'Characters/The Harbour Master',
      'Characters/The Keeper',
      'Characters/תמר',
      'Places/Saltwick',
      'Places/The Archive',
      'Places/The Old Lighthouse',
      'Places/The Drowned Village',
      'Factions/The Harbour Office',
      'Items/The Old Chart',
      'Items/The Logbook',
      'Lore/The Legend of the Drowned Village',
      'Lore/The Bell in the Fog',
      'Lore/הים מחזיר',
      'Creatures/The Tide Hound',
      'Cultures/The Bay Fishers',
    ]);
    expect(SAMPLE_ENTITIES).toHaveLength(18);
    for (const type of BUILT_IN_TYPES) expect(world.some((entity) => entity.folder === type.folder), type.name).toBe(true);
    // The three the scenes are told by are among them, under the names of their labels.
    for (const character of SAMPLE_CHARACTERS) expect(names).toContain(character);
  });

  it('writes each note the way "New character" and the like would: type, the type\'s fields in order, aliases, then its relations; then the headings', () => {
    for (const entity of world) {
      const type = findType(BUILT_IN_TYPES, String(entity.frontmatter['type']));
      if (!type) throw new Error(`${entity.title} has no type the project knows`);
      expect(entity.folder, entity.title).toBe(type.folder);
      // What the sheet's "Related" adds comes last, and only for an entity that has relations. No sample entity has a picture.
      const related = entity.frontmatter['related'] === undefined ? [] : ['related'];
      expect(Object.keys(entity.frontmatter), entity.title).toEqual([...Object.keys(newEntityFrontmatter(type)), ...related]);
      expect(entity.frontmatter, entity.title).not.toHaveProperty('image');
      expect(Array.isArray(entity.frontmatter['aliases']), entity.title).toBe(true);
      expect(String(entity.frontmatter['summary']).length, entity.title).toBeGreaterThan(20);
      // The headings of a new note, all of them, with a line of text under the first.
      const body = entity.body ?? '';
      const headings = newEntityBody(type).split('\n\n').filter((line) => line !== '');
      expect(body.split('\n\n').filter((line) => line.startsWith('## ')), entity.title).toEqual(headings);
      expect(body.split('\n\n')[1]?.length, entity.title).toBeGreaterThan(20);
      expect(body.endsWith('\n\n'), entity.title).toBe(true);
    }
    // No type of the sample's own, and no calendar of its own either: the built-in types and the ordinary calendar.
    expect(Object.keys(data())).not.toContain('entityTypes');
    expect(JSON.stringify(data()).toLowerCase()).not.toContain('calendar');
  });

  it('fills in only properties the type has, so nothing of an entity is left unwritten', () => {
    for (const entity of SAMPLE_ENTITIES) {
      const type = findType(BUILT_IN_TYPES, entity.type);
      for (const field of Object.keys(entity.fields)) expect(type?.fields, `${entity.name}: ${field}`).toContain(field);
    }
    const mara = world.find((entity) => entity.title === 'Mara');
    expect(mara?.frontmatter).toEqual({
      type: 'character',
      role: 'Protagonist',
      age: 34,
      occupation: 'Chart maker',
      appearance: 'Ink on her cuffs; never without a notebook.',
      personality: 'Exact and impatient, and kinder than she lets on.',
      voice: 'Short sentences and numbers. Says "roughly" when she means that she has not measured it yet.',
      goal: 'To draw the bay as it really is.',
      arc: 'Learns that an honest chart has to show what a town would rather forget.',
      summary: 'Sent to Saltwick to redraw the sea chart after the storm. Careful, impatient, new to the town.',
      aliases: [],
      related: ['[[The Harbour Master|hired by]]', '[[Tobias|surveys the bay with]]'],
    });
  });

  it('fills the new fields of every character and every place that is in the story', () => {
    const filled = (title: string, fields: readonly string[]): void => {
      const frontmatter = world.find((entity) => entity.title === title)?.frontmatter ?? {};
      for (const field of fields) expect(String(frontmatter[field] ?? '').length, `${title}: ${field}`).toBeGreaterThan(5);
    };
    for (const title of ['Mara', 'Tobias', 'Noa', 'The Harbour Master']) filled(title, ['occupation', 'personality', 'voice', 'arc']);
    filled('The Keeper', ['occupation', 'personality', 'voice']);
    filled('תמר', ['personality', 'voice']);
    for (const place of world.filter((entity) => entity.folder === 'Places')) filled(place.title, ['atmosphere', 'landmarks']);
    for (const lore of world.filter((entity) => entity.folder === 'Lore')) {
      for (const field of ['kind', 'period', 'told-by']) expect(String(lore.frontmatter[field]).length, `${lore.title}: ${field}`).toBeGreaterThan(3);
      // A tale is told whole: there is text under every heading, not only the first.
      const pieces = (lore.body ?? '').split('\n\n');
      expect(pieces.filter((piece) => piece !== '' && !piece.startsWith('## ')), lore.title).toHaveLength(3);
    }
  });

  it('relates the entities to each other with links that all lead to an entity of the sample, each with a label', () => {
    const relations = new Map(world.map((entity) => [entity.title, readRelationEntries(entity.frontmatter).map((entry) => ({ entry, written: parseRelation(entry) }))]));
    let count = 0;
    for (const [from, entries] of relations) {
      for (const { entry, written } of entries) {
        count++;
        // One ordinary link and nothing else, so that Obsidian's own graph, backlinks and renaming know it.
        expect(entry, from).toMatch(/^\[\[[^\]|#]+\|[^\]|]+\]\]$/);
        expect(names, `${from}: ${entry}`).toContain(written?.target);
        expect(written?.target, from).not.toBe(from);
        expect(written?.label, `${from}: ${entry}`).not.toBe('');
      }
      expect(new Set(entries.map(({ written }) => written?.target)).size, from).toBe(entries.length);
    }
    expect(count).toBeGreaterThanOrEqual(18);
    const of = (name: string): string[] => (relations.get(name) ?? []).map(({ entry }) => entry);
    expect(of('Noa')).toEqual(['[[תמר|sister]]', '[[The Archive|keeps]]']);
    expect(of('The Keeper')).toEqual(['[[The Old Lighthouse|kept it for thirty years]]', '[[The Logbook|wrote]]']);
    expect(of('The Harbour Master')).toEqual(['[[The Harbour Office|runs]]']);
    // Who tells which tale.
    expect(of('The Legend of the Drowned Village')).toContain('[[The Bay Fishers|told by]]');
    expect(of('The Bell in the Fog')).toContain('[[Tobias|told by]]');
    expect(of('הים מחזיר').map((entry) => parseRelation(entry)?.target)).toEqual(['The Keeper', 'The Logbook']);
    // A relation is written on one side only: the other side shows it as "mentioned by".
    for (const [from, entries] of relations) {
      for (const { written } of entries) {
        const back = (relations.get(written?.target ?? '') ?? []).map((other) => other.written?.target);
        expect(back, `${from} and ${written?.target ?? ''}`).not.toContain(from);
      }
    }
    expect(of('תמר')).toEqual([]);
  });

  it('links the lore, the creature and the people to the scenes and the events where they matter', () => {
    const scenesOf = (name: string): string[] => allScenes.filter((scene) => (scene.entities ?? []).includes(`[[${name}]]`)).map((scene) => scene.title);
    const eventsOf = (name: string): string[] => events.filter((event) => linked(event.frontmatter).includes(name)).map((event) => event.title);
    expect(scenesOf('The Legend of the Drowned Village')).toEqual(['The Village on the Old Map', 'Mending Nets', 'Epilogue']);
    expect(eventsOf('The Legend of the Drowned Village')).toEqual(['נועה מוצאת את המפה הישנה', 'The new chart is published']);
    expect(scenesOf('The Bell in the Fog')).toEqual(['Fog on the Crossing', 'The Bell Stops']);
    expect(eventsOf('The Bell in the Fog')).toEqual(['The second storm']);
    expect(scenesOf('הים מחזיר')).toEqual(['הלילה שלפני הסערה', 'What the Keeper Wrote']);
    expect(scenesOf('The Tide Hound')).toEqual(['Low Water', 'Between Two Bars']);
    expect(scenesOf('The Bay Fishers')).toEqual(['Names of the Rocks', 'Mending Nets']);
  });

  it('has a character and a piece of lore with a Hebrew name, a Hebrew summary and Hebrew text', () => {
    const hebrew = world.filter((entity) => HEBREW_LETTER.test(entity.title));
    expect(hebrew.map((entity) => entity.title)).toEqual(['תמר', 'הים מחזיר']);
    const [tamar, saying] = hebrew;
    expect(saying?.folder).toBe('Lore');
    const told = (saying?.body ?? '').split('\n\n').filter((piece) => piece !== '' && !piece.startsWith('## '));
    for (const text of [saying?.frontmatter['summary'], saying?.frontmatter['kind'], saying?.frontmatter['period'], saying?.frontmatter['told-by'], ...told]) {
      expect(HEBREW_LETTER.test(String(text))).toBe(true);
      expect(LATIN_LETTER.test(String(text))).toBe(false);
    }
    // Its labels are Hebrew too; the links lead to notes with English names.
    for (const entry of readRelationEntries(saying?.frontmatter ?? {})) expect(HEBREW_LETTER.test(parseRelation(entry)?.label ?? '')).toBe(true);
    expect(tamar?.folder).toBe('Characters');
    expect(tamar?.frontmatter['type']).toBe('character');
    for (const text of [tamar?.frontmatter['summary'], tamar?.frontmatter['role'], (tamar?.body ?? '').split('\n\n')[1]]) {
      expect(HEBREW_LETTER.test(String(text))).toBe(true);
      expect(LATIN_LETTER.test(String(text))).toBe(false);
    }
    expect(tamar?.frontmatter['aliases']).toEqual(['אחותי']);
    // Noa goes by her Hebrew name too, which is how the Hebrew scenes and the Hebrew event call her.
    expect(world.find((entity) => entity.title === 'Noa')?.frontmatter['aliases']).toEqual(['נועה']);
    // And the letter to her sister lists the sister.
    expect(allScenes.find((scene) => scene.title === 'מכתב לאחותי')?.entities).toContain('[[תמר]]');
  });

  it('gives every entity a name no other note of the sample has, so that a link by name leads to it', () => {
    const others = [
      ...allScenes.map((scene) => scene.title),
      ...(seed.unfiled ?? []).map((note) => note.title),
      ...(seed.research ?? []).map((note) => note.title),
      ...events.map((event) => event.title),
      SAMPLE_PROJECT_NAME,
      'To-do',
    ];
    const taken = new Set(others.map((title) => title.toLowerCase()));
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    for (const name of names) expect(taken.has(name.toLowerCase()), name).toBe(false);
  });

  it('gives most scenes a list of entities, as links, and every link leads to an entity of the sample', () => {
    const titles = new Set(allScenes.map((scene) => scene.title));
    for (const title of Object.keys(SAMPLE_SCENE_ENTITIES)) expect(titles.has(title), title).toBe(true);

    const listing = allScenes.filter((scene) => scene.entities !== undefined);
    expect(listing).toHaveLength(Object.keys(SAMPLE_SCENE_ENTITIES).length);
    expect(listing.length).toBeGreaterThan(allScenes.length * 0.8);
    expect(listing.length).toBeLessThan(allScenes.length); // a few list none
    for (const scene of listing) {
      const links = scene.entities ?? [];
      expect(links.length, scene.title).toBeGreaterThan(0);
      expect(new Set(links).size, scene.title).toBe(links.length);
      for (const link of links) {
        expect(link, scene.title).toMatch(/^\[\[[^\]|#]+\]\]$/);
        expect(names, `${scene.title}: ${link}`).toContain(parseLink(link)?.target);
      }
    }
    expect(allScenes.find((scene) => scene.title === 'The Last Ferry')?.entities).toEqual(['[[Mara]]', '[[Tobias]]', '[[Saltwick]]']);
    // A scene that names one of the three in its synopsis lists that character.
    for (const scene of allScenes) {
      for (const character of SAMPLE_CHARACTERS) {
        if ((scene.synopsis ?? '').includes(character)) expect(scene.entities, `${scene.title}: ${character}`).toContain(`[[${character}]]`);
      }
    }
  });

  it('gives the events their entities too, last among their properties, and every link leads to an entity of the sample', () => {
    const listing = events.filter((event) => event.frontmatter['entities'] !== undefined);
    expect(listing).toHaveLength(9);
    for (const event of listing) {
      const keys = Object.keys(event.frontmatter);
      expect(keys[keys.length - 1], event.title).toBe('entities');
      const targets = linked(event.frontmatter);
      expect(targets.length, event.title).toBeGreaterThan(0);
      for (const target of targets) expect(names, `${event.title}: ${target}`).toContain(target);
    }
    expect(events.find((event) => event.title === 'Mara arrives in Saltwick')?.frontmatter['entities']).toEqual([
      '[[Mara]]',
      '[[Tobias]]',
      '[[Saltwick]]',
    ]);
  });

  it('leaves no entity out: each is in at least one scene or event', () => {
    const used = new Set([
      ...allScenes.flatMap((scene) => (scene.entities ?? []).map((link) => parseLink(link)?.target)),
      ...events.flatMap((event) => linked(event.frontmatter)),
    ]);
    for (const name of names) expect(used.has(name), name).toBe(true);
  });

  /** What the sample keeps in the index. */
  function data(): Readonly<Record<string, unknown>> {
    return seed.data ?? {};
  }
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
    expect(created.filter((path) => path.startsWith('Sample Novel/Timeline/'))).toEqual(
      SAMPLE_EVENTS.map((event) => `Sample Novel/Timeline/${event.title}.md`).sort(),
    );
    expect(created.filter((path) => path.startsWith('Sample Novel/World/'))).toEqual(
      SAMPLE_ENTITIES.map((entity) => `Sample Novel/World/${findType(BUILT_IN_TYPES, entity.type)?.folder ?? ''}/${entity.name}.md`).sort(),
    );
    expect(created).toHaveLength(53 + 2 + 2 + 10 + 18);
    for (const sub of ['Manuscript', 'Timeline', 'Research', 'Stats', 'World', ...BUILT_IN_TYPES.map((type) => `World/${type.folder}`)]) {
      expect(vault.hasFolder(`Sample Novel/${sub}`), sub).toBe(true);
    }
    // No writing history is made up: the Stats folder is there and it is empty.
    expect(vault.paths().filter((path) => path.startsWith('Sample Novel/Stats/'))).toEqual([]);

    // only creations, plus the one write that lists the scenes (and the screens' data) in the new index
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
    // The index's own four properties first, then what the other screens keep there.
    expect(Object.keys(index)).toEqual(['spellbook', 'version', 'title', 'binder', 'statuses', 'labels', 'timelines', 'marks', 'targets']);
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
      const described = allScenes[index] as SceneSeed;
      // The standard six; a scene that has a word target has that after its label, one that has a date
      // in the story has that after them, and one that lists entities has those last. No other scene has any of the three.
      const standard =
        described.target === undefined
          ? ['synopsis', 'status', 'label', 'compile', 'order', 'created']
          : ['synopsis', 'status', 'label', 'target', 'compile', 'order', 'created'];
      expect(Object.keys(frontmatter), path).toEqual([
        ...standard,
        ...(described.date === undefined ? [] : ['date']),
        ...(described.entities === undefined ? [] : ['entities']),
      ]);
      expect(frontmatter['entities'], path).toEqual(described.entities);
      expect(frontmatter['target'], path).toBe(described.target);
      expect(frontmatter['date'], path).toBe(described.date);
      expect(frontmatter['order'], path).toBe(1024 * (index + 1));
      expect(frontmatter['compile'], path).toBe(true);
      expect(frontmatter['created'], path).toBe(TODAY);
      expect(SCENE_STATUSES, path).toContain(frontmatter['status']);
      expect(SAMPLE_CHARACTERS, path).toContain(frontmatter['label']);
      expect(String(frontmatter['synopsis']).length, path).toBeGreaterThan(20);
      // the note holds exactly the text that was described, and its title is its file name
      expect(relative, path).toBe(`Manuscript/${described.title}.md`);
      expect(vault.bodyOf(path), path).toBe(described.body);
      expect(frontmatter['synopsis'], path).toBe(described.synopsis);
    });
  });

  it('writes the ten events as notes in Timeline, and the screens\' data into the index, exactly as described', async () => {
    const { store, vault } = await create();
    for (const event of seed.events ?? []) {
      const path = `Sample Novel/Timeline/${event.title}.md`;
      expect(vault.frontmatterOf(path), path).toEqual(event.frontmatter);
      expect(Object.keys(vault.frontmatterOf(path) ?? {}), path).toEqual(Object.keys(event.frontmatter));
      expect(vault.bodyOf(path), path).toBe(event.body);
    }
    expect(store.timelineNotes().map((note) => note.path).sort()).toEqual(
      SAMPLE_EVENTS.map((event) => `Timeline/${event.title}.md`).sort(),
    );
    // No event is a scene: none is in the binder, and none shows as Unfiled.
    expect(project(store).unfiled).toEqual(['Manuscript/The Night Market.md']);

    const index = vault.frontmatterOf('Sample Novel/Sample Novel.md') ?? {};
    for (const [key, value] of Object.entries(seed.data ?? {})) {
      expect(index[key], key).toEqual(value);
      // ...and the open project hands the same to the screens.
      expect(store.projectData(key), key).toEqual(value);
    }
    expect(parseTargets(store.projectData(TARGETS_KEY)).targets).toEqual({ project: 80000, daily: 1000, deadline: '2027-03-12' });
    expect(readLanes(store.projectData(TIMELINES_KEY)).lanes).toHaveLength(3);
    expect(parseMarks(store.projectData(MARKS_KEY)).marks.size).toBe(2);
    expect(readTagLists(index).labels.tags.map((tag) => [tag.name, tag.color])).toEqual([
      ['Mara', 'purple'],
      ['Tobias', 'cyan'],
      ['Noa', 'pink'],
    ]);
  });

  it('writes the eighteen notes of the world exactly as described, and every link of a scene or an event leads to one', async () => {
    const { store, vault, made } = await create();
    for (const entity of seed.world ?? []) {
      const path = `Sample Novel/World/${entity.folder}/${entity.title}.md`;
      expect(vault.frontmatterOf(path), path).toEqual(entity.frontmatter);
      expect(Object.keys(vault.frontmatterOf(path) ?? {}), path).toEqual(Object.keys(entity.frontmatter));
      expect(vault.bodyOf(path), path).toBe(entity.body);
    }

    // A link by name leads where the vault takes it: to the one note of that name, when there is exactly one.
    const resolveByName = (target: string): string | null => {
      const found = vault.paths().filter((path) => path.toLowerCase().endsWith(`/${target.toLowerCase()}.md`));
      return found.length === 1 ? (found[0] as string) : null;
    };

    // The store lists them as the world's notes, and they read as entities of the built-in types.
    const types = readEntityTypes(store.projectData('entityTypes'));
    const entities = readEntities(store.worldNotes(), types);
    expect(entities).toHaveLength(18);
    expect(entities.every((entity) => entity.typeId !== null && entity.summary !== '')).toBe(true);
    const count = (typeId: string): number => entities.filter((entity) => entity.typeId === typeId).length;
    expect(BUILT_IN_TYPES.map((type) => count(type.id))).toEqual([6, 4, 1, 2, 3, 1, 1]);
    const tamar = entities.find((entity) => entity.name === 'תמר');
    expect(tamar).toMatchObject({ path: 'World/Characters/תמר.md', typeId: 'character', aliases: ['אחותי'] });
    expect(tamar?.summary).toMatch(HEBREW_LETTER);
    expect(entityFields(tamar ?? (entities[0] as (typeof entities)[number]), findType(types, 'character'))).toEqual([
      { name: 'role', value: 'אחותה של נועה' },
      { name: 'personality', value: 'סקרנית וחמה, ודואגת יותר ממה שהיא מודה.' },
      { name: 'voice', value: 'נשמעת רק דרך מה שנועה עונה לה במכתבים.' },
    ]);

    // The relations, as the vault holds them: every one leads to an entity, and both sides see it.
    const relations = buildRelations({ entities, entityVaultPath: (path) => `Sample Novel/${path}`, resolve: (target) => resolveByName(target) });
    for (const entity of entities) {
      for (const relation of relations.of(entity.path)) expect(relation.entity, `${entity.name}: ${relation.raw}`).not.toBeNull();
    }
    expect(relations.of('World/Characters/Noa.md').map((relation) => [relation.name, relation.label])).toEqual([
      ['תמר', 'sister'],
      ['The Archive', 'keeps'],
    ]);
    expect(relations.mentionedBy('World/Characters/תמר.md').map((relation) => [relation.entity.name, relation.label])).toEqual([['Noa', 'sister']]);
    expect(relations.mentionedBy('World/Places/The Old Lighthouse.md').map((relation) => relation.entity.name)).toEqual(['The Keeper']);
    expect(relations.mentionedBy('World/Factions/The Harbour Office.md').map((relation) => relation.entity.name)).toEqual(['The Harbour Master', 'The Old Chart']);
    // No sample entity has a picture, and none is missed: the sheet shows the type's icon.
    for (const entity of entities) expect(resolveImage(entity.frontmatter, `Sample Novel/${entity.path}`, resolveByName), entity.name).toBeNull();
    // None of them is a scene: the binder and Unfiled are as they were.
    expect(project(store).unfiled).toEqual(['Manuscript/The Night Market.md']);
    expect(JSON.stringify(binderOnDisk(vault, 'Sample Novel/Sample Novel.md'))).not.toContain('World/');

    const resolve = resolveByName;
    const scenePaths = made.project.scenes;
    const links = buildWorldLinks({
      entities,
      entityVaultPath: (path) => `Sample Novel/${path}`,
      scenes: scenePaths.map((path) => ({
        path,
        vaultPath: `Sample Novel/${path}`,
        title: path,
        frontmatter: vault.frontmatterOf(`Sample Novel/${path}`),
      })),
      events: store.timelineNotes().map((note) => ({
        path: note.path,
        vaultPath: `Sample Novel/${note.path}`,
        title: note.path,
        frontmatter: note.frontmatter,
      })),
      resolve,
    });
    let sceneLinks = 0;
    for (const path of scenePaths) {
      for (const link of links.linksOf(path)) {
        expect(link.entity, `${path}: ${link.raw}`).not.toBeNull();
        sceneLinks++;
      }
    }
    let eventLinks = 0;
    for (const note of store.timelineNotes()) {
      for (const link of links.linksOf(note.path)) {
        expect(link.entity, `${note.path}: ${link.raw}`).not.toBeNull();
        eventLinks++;
      }
    }
    expect(sceneLinks).toBe(Object.values(SAMPLE_SCENE_ENTITIES).reduce((sum, list) => sum + list.length, 0));
    expect(eventLinks).toBe(SAMPLE_EVENTS.reduce((sum, event) => sum + (event.entities?.length ?? 0), 0));
    // Both ways round: every entity is in a scene or an event, and Mara in a good many scenes.
    for (const entity of entities) {
      expect(links.scenesOf(entity.path).length + links.eventsOf(entity.path).length, entity.name).toBeGreaterThan(0);
    }
    expect(links.scenesOf('World/Characters/Mara.md').length).toBeGreaterThan(15);
    expect(links.eventsOf('World/Characters/Mara.md').map((event) => event.path)).toHaveLength(3);
    expect(links.scenesOf('World/Characters/תמר.md').map((scene) => scene.path)).toEqual(['Manuscript/מכתב לאחותי.md']);
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
    expect(vault.paths().filter((path) => path.startsWith('Sample Novel 2/'))).toHaveLength(85);
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
