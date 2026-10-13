// Shared pieces for the tests of the cards engine.

import { readTagLists } from '../../src/core/cards';
import type { CardLists } from '../../src/core/cards';
import type { Binder, BinderNode, TreeNode } from '../../src/core/types';

/** Freeze a value all the way down, so a test fails if a function changes what it was given. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

/** A copy that shares nothing with the original. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Hebrew used across the tests. Written once here so every file tests the same words.
export const HEBREW = {
  /** "Anna" */
  anna: 'אנה',
  /** "Daniel" */
  daniel: 'דניאל',
  /** "First draft" */
  firstDraft: 'טיוטה ראשונה',
  /** "Final" */
  final: 'סופי',
  /** "To do" */
  toDo: 'לעשות',
  /** "Chapter one" */
  chapterOne: 'פרק ראשון',
  /** "Part two" */
  partTwo: 'חלק שני',
  /** "Opening" */
  opening: 'פתיחה',
  /** "The letter" */
  letter: 'המכתב',
  /**
   * Pointed Hebrew ("house", "peace") stored in a form that Unicode tidying
   * would rewrite: a dagesh typed before its vowel, and a shin with its dot as
   * a single code. Text that is only passed through must come out with
   * exactly these codes, in exactly this order.
   */
  untidy: '\u{5D1}\u{5BC}\u{5B7}\u{5D9}\u{5B4}\u{5EA} \u{FB2A}\u{5DC}\u{5D5}\u{5DD}',
  /** A synopsis: "Anna finds the letter in the drawer and decides not to open it." */
  synopsis: 'אנה מוצאת את המכתב במגירה ומחליטה לא לפתוח אותו.',
  /** Prose of 290 characters, with commas and full stops: well past the length of a preview. */
  prose:
    'הגשם ירד כל הלילה על העיר הישנה, והרחובות התמלאו מים עד שלא נותר מקום יבש אחד. ' +
    'אנה עמדה ליד החלון והביטה החוצה אל האורות המטושטשים של הנמל. ' +
    'היא חשבה על המכתב שהגיע בבוקר, על הכתב המוכר שעל המעטפה, ועל כל מה שלא נאמר ביניהם במשך השנים. ' +
    'מאחוריה תקתק השעון הישן, ומישהו דפק על הדלת שלוש פעמים.',
} as const;

/** English prose, a little over 300 characters. */
export const ENGLISH_PROSE =
  'The rain fell all night on the old town, and the streets filled with water until not one dry place was left. ' +
  'Anna stood by the window and looked out at the blurred lights of the harbour. ' +
  'She thought about the letter that had come that morning, and about everything left unsaid between them. ' +
  'Behind her the old clock ticked, and someone knocked on the door three times.';

/** The lists of a project that names its own statuses and labels, one of each in Hebrew. */
export function sampleLists(): CardLists {
  return readTagLists({
    statuses: [
      { name: 'To do', color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: HEBREW.final, color: 'green' },
    ],
    labels: [
      { name: 'Anna', color: 'purple' },
      { name: HEBREW.daniel, color: 'cyan' },
    ],
  });
}

/** A scene node of a binder: "Opening" is Manuscript/Opening.md. */
export function sceneNode(name: string): BinderNode {
  return { kind: 'scene', path: `Manuscript/${name}.md` };
}

/** A folder node of a binder; its id is "f-" and its name. */
export function folderNode(name: string, children: BinderNode[]): BinderNode {
  return { kind: 'folder', id: `f-${name}`, name, children };
}

/** The tree the views are given for a binder, with the named scenes marked as missing. */
export function treeOf(binder: Binder, missing: readonly string[] = []): TreeNode[] {
  return binder.map((node): TreeNode => {
    if (node.kind === 'folder') {
      return { kind: 'folder', id: node.id, name: node.name, children: treeOf(node.children, missing) };
    }
    const title = node.path.slice(node.path.lastIndexOf('/') + 1, -3);
    return { kind: 'scene', path: node.path, title, missing: missing.includes(title) };
  });
}
