// Builds the sample project: a made-up novel of about fifty scenes, so that
// every view of the plugin has something realistic to show.
//
// The result is a plain description (a ProjectSeed); the project store turns
// it into notes. Building it is deterministic: the same date in gives exactly
// the same project out, on every device. Nothing here reads the clock, uses
// Math.random or depends on the device's language settings.

import { TAG_INDEX_KEYS } from './cards';
import { addDays } from './dates';
import { MARKS_KEY } from './planner';
import { TARGETS_KEY } from './progress';
import type { BinderSeed, EventSeed, NoteSeed, ProjectSeed, SceneSeed } from './projectSeed';
import {
  ACTION_SENTENCES,
  DIALOGUE_LINES,
  REFLECTION_SENTENCES,
  ROUGH_NOTES_COMMENT,
  SAMPLE_CHARACTERS,
  SAMPLE_CLOSING,
  SAMPLE_EVENTS,
  SAMPLE_LABEL_COLORS,
  SAMPLE_MARKS,
  SAMPLE_OPENING,
  SAMPLE_PARTS,
  SAMPLE_RESEARCH,
  SAMPLE_SCENE_DATES,
  SAMPLE_SCENE_TARGETS,
  SAMPLE_STATUS_COLORS,
  SAMPLE_TARGETS,
  SAMPLE_TIMELINES,
  SAMPLE_TODOS,
  SAMPLE_UNFILED,
  SETTING_SENTENCES,
  SHARED_SENTENCES,
} from './sampleText';
import type { SampleEvent, SampleScene } from './sampleText';
import { SCENE_STATUSES } from './scene';
import { EVENT_MARKER_KEY, EVENT_MARKER_VALUE } from './timeline';
import { countWords } from './wordCount';

/** The name of the sample project; a second one becomes "Sample Novel 2". */
export const SAMPLE_PROJECT_NAME = 'Sample Novel';

/** The mark the Tasks plugin puts in front of a due date (a calendar emoji). */
export const DUE_DATE_MARK = '\u{1F4C5}';

type Pool = 'setting' | 'action' | 'shared' | 'reflection' | 'dialogue';

const POOLS: Readonly<Record<Pool, readonly string[]>> = {
  setting: SETTING_SENTENCES,
  action: ACTION_SENTENCES,
  shared: SHARED_SENTENCES,
  reflection: REFLECTION_SENTENCES,
  dialogue: DIALOGUE_LINES,
};

/** When a pool runs dry, sentences are taken from the others in this order. */
const POOL_ORDER: readonly Pool[] = ['setting', 'action', 'shared', 'reflection', 'dialogue'];

/** The shapes a paragraph of narration can take. */
const PARAGRAPH_SHAPES: ReadonlyArray<readonly Pool[]> = [
  ['setting', 'setting', 'action', 'reflection'],
  ['action', 'setting', 'shared', 'setting'],
  ['setting', 'action', 'shared', 'reflection', 'setting'],
  ['shared', 'action', 'setting'],
  ['setting', 'reflection', 'action'],
  ['action', 'shared', 'setting', 'setting', 'reflection'],
];

/** How often a stretch of dialogue follows a paragraph (0 to 1). */
const DIALOGUE_CHANCE = 0.3;

/**
 * A small repeatable random source (the "mulberry32" recipe): the same seed
 * always gives the same run of numbers from 0 up to, not including, 1.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndex(length: number, random: () => number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickIndex(i + 1, random);
    const held = out[i] as T;
    out[i] = out[j] as T;
    out[j] = held;
  }
  return out;
}

/** Words as the generator counts them: runs of characters between spaces. */
function roughWordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/**
 * Write a scene of about `words` words for one character, out of the sentence
 * bank. No sentence is used twice in a scene unless the whole bank has been
 * used up. The text is a little longer than asked, never shorter.
 */
export function composeScene(character: number, words: number, seed: number): string {
  const random = seededRandom(seed);
  const pov = SAMPLE_CHARACTERS[character % SAMPLE_CHARACTERS.length] as string;
  const others = SAMPLE_CHARACTERS.filter((name) => name !== pov);

  const fresh = (): Record<Pool, string[]> => ({
    setting: shuffled(POOLS.setting, random),
    action: shuffled(POOLS.action, random),
    shared: shuffled(POOLS.shared, random),
    reflection: shuffled(POOLS.reflection, random),
    dialogue: shuffled(POOLS.dialogue, random),
  });
  let unused = fresh();

  const draw = (wanted: Pool): string => {
    for (let round = 0; round < 2; round++) {
      for (const pool of [wanted, ...POOL_ORDER]) {
        const sentence = unused[pool].pop();
        if (sentence !== undefined) return sentence;
      }
      unused = fresh(); // every sentence has been used once: start again
    }
    return '';
  };

  const written = (wanted: Pool): string => {
    const other = others[pickIndex(others.length, random)] as string;
    return draw(wanted).split('{pov}').join(pov).split('{other}').join(other);
  };

  const paragraphs: string[] = [];
  let count = 0;
  const target = Math.max(1, Math.floor(words));
  while (count < target) {
    const shape = PARAGRAPH_SHAPES[pickIndex(PARAGRAPH_SHAPES.length, random)] as readonly Pool[];
    const sentences: string[] = [];
    for (const pool of shape) {
      const sentence = written(pool);
      sentences.push(sentence);
      count += roughWordCount(sentence);
      if (count >= target) break;
    }
    paragraphs.push(sentences.join(' '));

    if (count < target && random() < DIALOGUE_CHANCE) {
      const lines = 1 + pickIndex(3, random);
      for (let line = 0; line < lines && count < target; line++) {
        const spoken = written('dialogue');
        paragraphs.push(spoken);
        count += roughWordCount(spoken);
      }
    }
  }
  return `${paragraphs.join('\n\n')}\n`;
}

function sceneSeed(scene: SampleScene, position: number): SceneSeed {
  const status = SCENE_STATUSES[scene.status] as string;
  // Each scene gets its own run of random numbers, so changing one scene's
  // length never changes the text of another.
  const text = scene.text === undefined ? composeScene(scene.who, scene.words, 0x5eed + position * 7919) : `${scene.text}\n`;
  const body = scene.status === 0 ? `${ROUGH_NOTES_COMMENT}\n\n${text}` : text;
  const seed: SceneSeed = {
    title: scene.title,
    body,
    synopsis: scene.synopsis,
    status,
    label: SAMPLE_CHARACTERS[scene.who] as string,
  };
  // About a third of the scenes have a word target, so that the outliner's Target column has something to show.
  const wanted = Object.prototype.hasOwnProperty.call(SAMPLE_SCENE_TARGETS, scene.title) ? SAMPLE_SCENE_TARGETS[scene.title] : undefined;
  // A target that is "reached" is the scene's own length, counted the way the plugin counts a note.
  const target = wanted === 'reached' ? countWords(body) : wanted;
  // A few scenes have a date in the story, so that the timeline's Manuscript lane has something to show.
  const date = Object.prototype.hasOwnProperty.call(SAMPLE_SCENE_DATES, scene.title) ? SAMPLE_SCENE_DATES[scene.title] : undefined;
  return {
    ...seed,
    ...(target === undefined ? {} : { target }),
    ...(date === undefined ? {} : { date }),
  };
}

/** The key of the project index that lists the timelines (the lanes of the timeline screen). */
export const SAMPLE_TIMELINES_KEY = 'timelines';

/** An event's note: the properties the timeline reads, in the order the timeline itself writes them. */
function eventSeed(event: SampleEvent): EventSeed {
  const frontmatter: Record<string, unknown> = {
    [EVENT_MARKER_KEY]: EVENT_MARKER_VALUE,
    date: event.date,
  };
  if (event.end !== undefined) frontmatter['end'] = event.end;
  frontmatter['timelines'] = event.timelines.map((index) => (SAMPLE_TIMELINES[index] as { name: string }).name);
  // A scene is named the way a link to its note is written.
  if (event.scenes !== undefined) frontmatter['scenes'] = event.scenes.map((title) => `[[${title}]]`);
  if (event.tags !== undefined) frontmatter['tags'] = [...event.tags];
  return { title: event.title, frontmatter, body: `${event.body}\n` };
}

/**
 * What the screens besides the binder keep in the project index: the
 * statuses and the labels with their colours, the timelines, two marks on the
 * calendar a few days from today, and the targets, with a deadline some
 * months from today.
 */
function indexData(today: string): Record<string, unknown> {
  const marks: Record<string, { color: string; label: string }> = {};
  for (const mark of SAMPLE_MARKS) marks[addDays(today, mark.inDays)] = { color: mark.color, label: mark.label };
  return {
    [TAG_INDEX_KEYS.status]: SCENE_STATUSES.map((name, index) => ({ name, color: SAMPLE_STATUS_COLORS[index] as string })),
    [TAG_INDEX_KEYS.label]: SAMPLE_CHARACTERS.map((name, index) => ({ name, color: SAMPLE_LABEL_COLORS[index] as string })),
    [SAMPLE_TIMELINES_KEY]: SAMPLE_TIMELINES.map((timeline) => ({ name: timeline.name, color: timeline.color })),
    [MARKS_KEY]: marks,
    [TARGETS_KEY]: {
      project: SAMPLE_TARGETS.project,
      daily: SAMPLE_TARGETS.daily,
      deadline: addDays(today, SAMPLE_TARGETS.deadlineInDays),
    },
  };
}

function todoText(today: string): string {
  const lines = SAMPLE_TODOS.map((todo) => {
    const due = todo.dueInDays === undefined ? '' : ` ${DUE_DATE_MARK} ${addDays(today, todo.dueInDays)}`;
    return `- [${todo.done ? 'x' : ' '}] ${todo.text}${due}`;
  });
  return `${lines.join('\n')}\n`;
}

/**
 * The sample project: two scenes at the top level (a prologue and an
 * epilogue) around five binder folders of scenes, a note left out of the
 * binder on purpose, two research notes and three to-dos; and, so that every
 * screen has something to show, statuses and labels with colours, three
 * timelines with ten events, four scenes with a date in the story, eighteen
 * scenes with a word target (some short of it, some exactly at it, some past
 * it), two marks on the calendar and the writing targets.
 *
 * It has no writing history: no word log is made up.
 *
 * Only four things follow the calendar: the two to-dos' due dates, the two
 * marks and the deadline. Everything else is the same whenever it is made.
 *
 * @param today today's date as YYYY-MM-DD; the to-dos, the marks and the deadline are counted from it
 */
export function sampleProject(today: string): ProjectSeed {
  let position = 0;
  const next = (scene: SampleScene): SceneSeed => sceneSeed(scene, position++);

  const binder: BinderSeed[] = [next(SAMPLE_OPENING)];
  for (const part of SAMPLE_PARTS) {
    binder.push({ folder: part.folder, children: part.scenes.map(next) });
  }
  binder.push(next(SAMPLE_CLOSING));

  const unfiled: NoteSeed[] = [{ title: SAMPLE_UNFILED.title, body: `${SAMPLE_UNFILED.body}\n` }];
  const research: NoteSeed[] = SAMPLE_RESEARCH.map((note) => ({ title: note.title, body: `${note.body}\n` }));
  return {
    binder,
    unfiled,
    research,
    todo: todoText(today),
    events: SAMPLE_EVENTS.map(eventSeed),
    data: indexData(today),
  };
}
