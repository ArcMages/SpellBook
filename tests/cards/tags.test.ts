// Statuses and labels: reading the two lists from the project index, changing
// them, and following a rename into the scenes.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUSES,
  TAG_INDEX_KEYS,
  addTag,
  applyFrontmatterPatch,
  defaultStatusName,
  findTag,
  moveTag,
  parseTagList,
  readTagLists,
  recolourTag,
  removeTag,
  renameTag,
  renameTagInScene,
  sameTagName,
  scenesUsingTag,
  unlistedTags,
} from '../../src/core/cards';
import type { SceneProperties, TagEditResult, TagList } from '../../src/core/cards';
import { SCENE_STATUSES } from '../../src/core/scene';
import type { Frontmatter } from '../../src/core/types';
import { HEBREW, clone, deepFreeze } from './helpers';

/** The names of a list, in order. */
function names(list: TagList): string[] {
  return list.tags.map((tag) => tag.name);
}

/** The result of a change that must have been accepted. */
function accepted(result: TagEditResult): Extract<TagEditResult, { ok: true }> {
  if (!result.ok) throw new Error(`refused (${result.reason}): ${result.message}`);
  return result;
}

/** The reason a change was refused; fails when it was accepted. */
function refusal(result: TagEditResult): string {
  if (result.ok) throw new Error('expected a refusal');
  expect(result.message.length).toBeGreaterThan(0);
  return result.reason;
}

const STORED_STATUSES = [
  { name: 'To do', color: 'red' },
  { name: 'First draft', color: 'orange' },
  { name: HEBREW.final, color: 'green' },
];

const STORED_LABELS = [
  { name: 'Anna', color: 'purple' },
  { name: HEBREW.daniel, color: 'cyan' },
  { name: 'Subplot' },
];

function statuses(): TagList {
  return parseTagList('status', deepFreeze(clone(STORED_STATUSES)));
}

function labels(): TagList {
  return parseTagList('label', deepFreeze(clone(STORED_LABELS)));
}

function scene(name: string, frontmatter: Frontmatter | null): SceneProperties {
  return { path: `Manuscript/${name}.md`, frontmatter };
}

// ------------------------------------------------------------------- reading

describe('parseTagList', () => {
  it('reads names and colours in the order they are stored', () => {
    const list = statuses();
    expect(list.tags).toEqual([
      { name: 'To do', color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: HEBREW.final, color: 'green' },
    ]);
    expect(list.kind).toBe('status');
    expect(list.fromDefaults).toBe(false);
    expect(list.unreadable).toBe(false);
    expect(list.problems).toEqual([]);
  });

  it('reads Hebrew names unchanged', () => {
    const list = parseTagList('label', [{ name: HEBREW.anna, color: 'pink' }, { name: HEBREW.firstDraft }]);
    expect(names(list)).toEqual([HEBREW.anna, HEBREW.firstDraft]);
  });

  it('keeps pointed Hebrew names code for code, through reading and every change', () => {
    expect(HEBREW.untidy.normalize('NFC')).not.toBe(HEBREW.untidy);
    const list = parseTagList('label', [{ name: HEBREW.untidy, color: 'blue' }, { name: 'Anna' }]);
    expect(list.tags[0]?.name).toBe(HEBREW.untidy);
    // It is still found by the same name stored the other way.
    expect(findTag(list, HEBREW.untidy.normalize('NFC'))?.name).toBe(HEBREW.untidy);

    const added = accepted(addTag(parseTagList('label', []), HEBREW.untidy));
    expect(added.value).toEqual([{ name: HEBREW.untidy }]);
    expect(added.list.tags[0]?.name).toBe(HEBREW.untidy);

    const renamed = accepted(renameTag(list, 'Anna', `  ${HEBREW.untidy}2 `, [{ path: 'a.md', frontmatter: { label: 'Anna' } }]));
    expect(renamed.value[1]).toEqual({ name: `${HEBREW.untidy}2` });
    expect(renamed.scenePatches[0]?.patch.set).toEqual({ label: `${HEBREW.untidy}2` });

    const moved = accepted(moveTag(list, 'Anna', 0));
    expect(moved.list.tags[1]?.name).toBe(HEBREW.untidy);
    expect(unlistedTags(parseTagList('label', []), [{ path: 'a.md', frontmatter: { label: HEBREW.untidy } }])[0]?.name).toBe(HEBREW.untidy);
  });

  describe('when the index has no list', () => {
    it('gives the four built-in statuses, each with a colour', () => {
      const list = parseTagList('status', undefined);
      expect(names(list)).toEqual([...SCENE_STATUSES]);
      expect(names(list)).toEqual(['To do', 'First draft', 'Revised', 'Final']);
      expect(list.tags.map((tag) => tag.color)).toEqual(['red', 'orange', 'blue', 'green']);
      expect(list.tags).toEqual(DEFAULT_STATUSES);
      expect(list.fromDefaults).toBe(true);
      expect(list.unreadable).toBe(false);
      expect(list.problems).toEqual([]);
    });

    it('gives no labels', () => {
      const list = parseTagList('label', undefined);
      expect(list.tags).toEqual([]);
      expect(list.fromDefaults).toBe(true);
    });

    it('takes an empty property for no list too', () => {
      expect(names(parseTagList('status', null))).toEqual([...SCENE_STATUSES]);
      expect(parseTagList('status', null).fromDefaults).toBe(true);
    });
  });

  it('takes an empty list as the writer wanting none, not as the built-in statuses', () => {
    const list = parseTagList('status', []);
    expect(list.tags).toEqual([]);
    expect(list.fromDefaults).toBe(false);
  });

  it('reads a bare name as a status or label without a colour', () => {
    const list = parseTagList('label', ['Anna', HEBREW.daniel, 1984]);
    expect(list.tags).toEqual([
      { name: 'Anna', color: null },
      { name: HEBREW.daniel, color: null },
      { name: '1984', color: null },
    ]);
    expect(list.problems).toEqual([]);
  });

  it('reads a colour whatever its capitals, and any other colour as none', () => {
    const list = parseTagList('label', [
      { name: 'A', color: 'Purple' },
      { name: 'B', color: 'teal' },
      { name: 'C', color: 5 },
      { name: 'D', color: null },
      { name: 'E' },
    ]);
    expect(list.tags.map((tag) => tag.color)).toEqual(['purple', null, null, null, null]);
    expect(list.problems).toEqual([]);
  });

  it('tidies the spacing of a name it shows', () => {
    const list = parseTagList('status', [{ name: '  First   draft ' }]);
    expect(names(list)).toEqual(['First draft']);
  });

  it('keeps the entries it does not understand, shows the rest, and says what it skipped', () => {
    const stored = [{ name: 'To do', color: 'red' }, 42.5, { color: 'blue' }, null, ['x'], { name: '' }, true, { name: 'Final' }];
    const list = parseTagList('status', stored);
    expect(names(list)).toEqual(['To do', '42.5', 'Final']);
    expect(list.entries.map((entry) => entry.raw)).toEqual(stored);
    expect(list.problems).toEqual([
      'Entry 3 of "statuses" in the project index has no name. It is left as it is.',
      'Entry 4 of "statuses" in the project index is not a status (it is empty). It is left as it is.',
      'Entry 5 of "statuses" in the project index is not a status (it is a list). It is left as it is.',
      'Entry 6 of "statuses" in the project index has no name. It is left as it is.',
      'Entry 7 of "statuses" in the project index is not a status (it is true). It is left as it is.',
    ]);
  });

  it('uses the first of two entries with the same name, whatever their capitals', () => {
    const list = parseTagList('label', [
      { name: 'Anna', color: 'purple' },
      { name: 'ANNA', color: 'red' },
      { name: HEBREW.anna, color: 'blue' },
      { name: ` ${HEBREW.anna} `, color: 'pink' },
    ]);
    expect(list.tags).toEqual([
      { name: 'Anna', color: 'purple' },
      { name: HEBREW.anna, color: 'blue' },
    ]);
    expect(list.entries).toHaveLength(4);
    expect(list.problems).toEqual([
      '"ANNA" is listed more than once in "labels" in the project index. Only the first one is used.',
      `"${HEBREW.anna}" is listed more than once in "labels" in the project index. Only the first one is used.`,
    ]);
  });

  it('does not throw on a value that is not a list: it shows the built-in list and locks it', () => {
    for (const odd of ['To do, Done', 7, true, { 'To do': 'red' }]) {
      const list = parseTagList('status', odd);
      expect(names(list), String(odd)).toEqual([...SCENE_STATUSES]);
      expect(list.unreadable).toBe(true);
      expect(list.problems).toHaveLength(1);
      expect(list.problems[0]).toContain('"statuses"');
    }
    const lockedLabels = parseTagList('label', 'Anna');
    expect(lockedLabels.tags).toEqual([]);
    expect(lockedLabels.unreadable).toBe(true);
    expect(lockedLabels.problems[0]).toContain('"labels"');
  });

  it('never changes what it was given', () => {
    const stored = deepFreeze([{ name: 'A', color: 'red', note: { deep: [1] } }, 'B', null, { name: 'a' }]);
    expect(() => parseTagList('label', stored)).not.toThrow();
  });
});

describe('readTagLists', () => {
  it('reads both lists from the properties of the project index', () => {
    const lists = readTagLists({
      spellbook: 'project',
      version: 1,
      binder: [],
      statuses: STORED_STATUSES,
      labels: STORED_LABELS,
      timelines: [{ name: 'Main' }],
    });
    expect(names(lists.statuses)).toEqual(['To do', 'First draft', HEBREW.final]);
    expect(names(lists.labels)).toEqual(['Anna', HEBREW.daniel, 'Subplot']);
    expect(lists.statuses.kind).toBe('status');
    expect(lists.labels.kind).toBe('label');
  });

  it('gives the built-in statuses and no labels for an index that has neither', () => {
    for (const index of [{ spellbook: 'project' }, {}, null, undefined]) {
      const lists = readTagLists(index);
      expect(names(lists.statuses)).toEqual([...SCENE_STATUSES]);
      expect(lists.labels.tags).toEqual([]);
    }
  });

  it('names the index keys', () => {
    expect(TAG_INDEX_KEYS).toEqual({ status: 'statuses', label: 'labels' });
  });
});

describe('findTag', () => {
  it('finds a status or label by its name', () => {
    expect(findTag(statuses(), 'First draft')).toEqual({ name: 'First draft', color: 'orange' });
    expect(findTag(labels(), HEBREW.daniel)).toEqual({ name: HEBREW.daniel, color: 'cyan' });
  });

  it('does not mind capitals or extra spaces', () => {
    const list = statuses();
    expect(findTag(list, 'first DRAFT')?.name).toBe('First draft');
    expect(findTag(list, '  First   draft ')?.name).toBe('First draft');
    expect(findTag(list, ` ${HEBREW.final} `)?.name).toBe(HEBREW.final);
  });

  it('finds a Hebrew name with vowel points however the points are stored', () => {
    // The same pointed letter can be stored as one code or as a letter and a mark.
    const composed = '\u{FB2A}\u{5DC}\u{5D5}\u{5DD}'; // shin with its dot as one character
    const decomposed = '\u{5E9}\u{5C1}\u{5DC}\u{5D5}\u{5DD}'; // shin, then the dot
    expect(composed).not.toBe(decomposed);
    const list = parseTagList('label', [{ name: decomposed, color: 'blue' }]);
    expect(findTag(list, composed)?.color).toBe('blue');
    expect(sameTagName(composed, decomposed)).toBe(true);
  });

  it('gives null for a name the list does not have, or for no name', () => {
    const list = statuses();
    expect(findTag(list, 'Abandoned')).toBeNull();
    expect(findTag(list, '')).toBeNull();
    expect(findTag(list, null)).toBeNull();
    expect(findTag(list, undefined)).toBeNull();
    expect(findTag(list, 'First drafts')).toBeNull();
  });
});

describe('sameTagName', () => {
  it('compares without regard to capitals and extra spaces, in English and in Hebrew', () => {
    expect(sameTagName('To do', 'TO DO')).toBe(true);
    expect(sameTagName('To do', ' to  do ')).toBe(true);
    expect(sameTagName(HEBREW.firstDraft, `${HEBREW.firstDraft} `)).toBe(true);
    expect(sameTagName('To do', 'Todo')).toBe(false);
    expect(sameTagName(HEBREW.anna, HEBREW.daniel)).toBe(false);
  });
});

describe('defaultStatusName', () => {
  it('is the first status of the list', () => {
    expect(defaultStatusName(parseTagList('status', undefined))).toBe('To do');
    expect(defaultStatusName(parseTagList('status', [{ name: HEBREW.toDo }, { name: 'Done' }]))).toBe(HEBREW.toDo);
  });

  it('is null when the project has no statuses', () => {
    expect(defaultStatusName(parseTagList('status', []))).toBeNull();
  });
});

// -------------------------------------------------------------------- adding

describe('addTag', () => {
  it('adds a status at the end and returns the whole value to store', () => {
    const result = accepted(addTag(statuses(), 'Abandoned', 'pink'));
    expect(result.key).toBe('statuses');
    expect(result.value).toEqual([...STORED_STATUSES, { name: 'Abandoned', color: 'pink' }]);
    expect(names(result.list)).toEqual(['To do', 'First draft', HEBREW.final, 'Abandoned']);
    expect(result.scenePatches).toEqual([]);
  });

  it('adds a label without a colour when none is chosen', () => {
    const result = accepted(addTag(labels(), 'Flashback'));
    expect(result.key).toBe('labels');
    expect(result.value[result.value.length - 1]).toEqual({ name: 'Flashback' });
    expect(findTag(result.list, 'Flashback')).toEqual({ name: 'Flashback', color: null });
  });

  it('adds a Hebrew name unchanged', () => {
    const result = accepted(addTag(labels(), HEBREW.anna, 'blue'));
    expect(result.value[result.value.length - 1]).toEqual({ name: HEBREW.anna, color: 'blue' });
    expect(names(result.list)).toContain(HEBREW.anna);
  });

  it('tidies the spaces around and inside the new name', () => {
    const result = accepted(addTag(labels(), `  Second \n  draft  `));
    expect(names(result.list)).toContain('Second draft');
  });

  it('refuses a name another one already has, whatever the capitals', () => {
    expect(refusal(addTag(statuses(), 'to DO'))).toBe('duplicate');
    expect(refusal(addTag(statuses(), ' First  draft '))).toBe('duplicate');
    expect(refusal(addTag(labels(), HEBREW.daniel))).toBe('duplicate');
    expect(refusal(addTag(labels(), ` ${HEBREW.daniel} `))).toBe('duplicate');
  });

  it('refuses an empty name', () => {
    expect(refusal(addTag(statuses(), ''))).toBe('empty-name');
    expect(refusal(addTag(statuses(), '  \n\t '))).toBe('empty-name');
    expect(refusal(addTag(statuses(), undefined as never))).toBe('empty-name');
  });

  it('refuses a colour that is not one of the eight', () => {
    expect(refusal(addTag(statuses(), 'Abandoned', 'teal' as never))).toBe('invalid-color');
    expect(refusal(addTag(statuses(), 'Abandoned', 'Red' as never))).toBe('invalid-color');
  });

  it('writes the built-in statuses out in full the first time one is added to them', () => {
    const result = accepted(addTag(parseTagList('status', undefined), 'Abandoned'));
    expect(result.value).toEqual([
      { name: 'To do', color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: 'Revised', color: 'blue' },
      { name: 'Final', color: 'green' },
      { name: 'Abandoned' },
    ]);
    expect(result.list.fromDefaults).toBe(false);
  });

  it('starts the list of labels with the first label', () => {
    const result = accepted(addTag(parseTagList('label', undefined), HEBREW.anna, 'purple'));
    expect(result.value).toEqual([{ name: HEBREW.anna, color: 'purple' }]);
  });

  it('leaves every stored entry exactly as it was, understood or not', () => {
    const stored = deepFreeze([{ name: 'A', color: 'teal', icon: 'star' }, 'B', 17, null, { color: 'red' }, { name: 'a' }]);
    const result = accepted(addTag(parseTagList('label', stored), 'C', 'green'));
    expect(result.value.slice(0, stored.length)).toEqual(stored);
    stored.forEach((entry, position) => expect(result.value[position], `entry ${position + 1}`).toBe(entry));
    expect(result.value[stored.length]).toEqual({ name: 'C', color: 'green' });
  });
});

// ------------------------------------------------------------------ renaming

describe('renameTag', () => {
  const scenes = (): SceneProperties[] => [
    scene('One', { status: 'First draft', label: 'Anna', synopsis: 'x' }),
    scene('Two', { status: 'To do', label: HEBREW.daniel }),
    scene('Three', { status: 'first DRAFT', label: 'Anna' }),
    scene('Four', { status: '  First   draft ', label: '' }),
    scene('Five', { label: 'Anna' }),
    scene('Six', null),
    scene('Seven', { status: ['First draft'] }),
    scene('Eight', { status: 'First drafts' }),
  ];

  it('gives the status its new name in the stored value', () => {
    const result = accepted(renameTag(statuses(), 'First draft', 'Rough'));
    expect(result.key).toBe('statuses');
    expect(result.value).toEqual([
      { name: 'To do', color: 'red' },
      { name: 'Rough', color: 'orange' },
      { name: HEBREW.final, color: 'green' },
    ]);
    expect(names(result.list)).toEqual(['To do', 'Rough', HEBREW.final]);
  });

  it('returns a patch for every scene that uses the old name, and for no other', () => {
    const result = accepted(renameTag(statuses(), 'First draft', 'Rough', deepFreeze(scenes())));
    expect(result.scenePatches).toEqual([
      { path: 'Manuscript/One.md', patch: { set: { status: 'Rough' }, remove: [] } },
      { path: 'Manuscript/Three.md', patch: { set: { status: 'Rough' }, remove: [] } },
      { path: 'Manuscript/Four.md', patch: { set: { status: 'Rough' }, remove: [] } },
    ]);
  });

  it('renames a label in the scenes that carry it, and leaves their status alone', () => {
    const result = accepted(renameTag(labels(), 'Anna', HEBREW.anna, scenes()));
    expect(result.scenePatches.map((entry) => entry.path)).toEqual([
      'Manuscript/One.md',
      'Manuscript/Three.md',
      'Manuscript/Five.md',
    ]);
    for (const entry of result.scenePatches) expect(entry.patch).toEqual({ set: { label: HEBREW.anna }, remove: [] });
  });

  it('renames from and to Hebrew', () => {
    const hebrewScenes = [
      scene(HEBREW.opening, { status: HEBREW.final, label: HEBREW.daniel }),
      scene(HEBREW.letter, { status: 'To do', label: HEBREW.daniel }),
    ];
    const status = accepted(renameTag(statuses(), HEBREW.final, HEBREW.firstDraft, hebrewScenes));
    expect(names(status.list)).toEqual(['To do', 'First draft', HEBREW.firstDraft]);
    expect(status.scenePatches).toEqual([
      { path: `Manuscript/${HEBREW.opening}.md`, patch: { set: { status: HEBREW.firstDraft }, remove: [] } },
    ]);
    const label = accepted(renameTag(labels(), HEBREW.daniel, 'Daniel', hebrewScenes));
    expect(label.scenePatches.map((entry) => entry.path)).toEqual([
      `Manuscript/${HEBREW.opening}.md`,
      `Manuscript/${HEBREW.letter}.md`,
    ]);
  });

  it('finds the status to rename whatever the capitals', () => {
    const result = accepted(renameTag(statuses(), 'FIRST draft', 'Rough'));
    expect(names(result.list)).toEqual(['To do', 'Rough', HEBREW.final]);
  });

  it('allows a change of capitals only, and brings the scenes into line', () => {
    const result = accepted(renameTag(statuses(), 'First draft', 'First Draft', scenes()));
    expect(names(result.list)).toEqual(['To do', 'First Draft', HEBREW.final]);
    expect(result.scenePatches.map((entry) => entry.path)).toEqual([
      'Manuscript/One.md',
      'Manuscript/Three.md',
      'Manuscript/Four.md',
    ]);
  });

  it('leaves out a scene that already spells the new name exactly', () => {
    const result = accepted(
      renameTag(statuses(), 'First draft', 'FIRST DRAFT', [scene('A', { status: 'FIRST DRAFT' }), scene('B', { status: 'first draft' })]),
    );
    expect(result.scenePatches.map((entry) => entry.path)).toEqual(['Manuscript/B.md']);
  });

  it('refuses a name another status already has', () => {
    expect(refusal(renameTag(statuses(), 'First draft', 'to do'))).toBe('duplicate');
    expect(refusal(renameTag(statuses(), 'First draft', ` ${HEBREW.final} `))).toBe('duplicate');
  });

  it('refuses an empty name, the same name, and a status that is not there', () => {
    expect(refusal(renameTag(statuses(), 'First draft', '   '))).toBe('empty-name');
    expect(refusal(renameTag(statuses(), 'First draft', 'First draft'))).toBe('unchanged');
    expect(refusal(renameTag(statuses(), 'First draft', '  First   draft '))).toBe('unchanged');
    expect(refusal(renameTag(statuses(), 'Abandoned', 'Dropped'))).toBe('not-found');
  });

  it('keeps the colour and every other key of the renamed entry, and touches no other entry', () => {
    const stored = deepFreeze([
      { name: 'A', color: 'teal', icon: 'star', notes: { deep: [1, 2] } },
      { name: 'B', color: 'red' },
      null,
    ]);
    const result = accepted(renameTag(parseTagList('label', stored), 'A', HEBREW.anna));
    expect(result.value).toEqual([
      { name: HEBREW.anna, color: 'teal', icon: 'star', notes: { deep: [1, 2] } },
      { name: 'B', color: 'red' },
      null,
    ]);
    expect(Object.keys(result.value[0] as object)).toEqual(['name', 'color', 'icon', 'notes']);
    expect(result.value[1]).toBe(stored[1]);
  });

  it('keeps a bare name bare', () => {
    const result = accepted(renameTag(parseTagList('label', ['Anna', 'Ben']), 'Anna', HEBREW.anna));
    expect(result.value).toEqual([HEBREW.anna, 'Ben']);
  });

  it('renames a repeat of the name too, so it cannot come back as a separate label', () => {
    const list = parseTagList('label', [{ name: 'Anna', color: 'purple' }, { name: 'anna', color: 'red' }, { name: 'Ben' }]);
    const result = accepted(renameTag(list, 'Anna', 'Hannah'));
    expect(result.value).toEqual([{ name: 'Hannah', color: 'purple' }, { name: 'Hannah', color: 'red' }, { name: 'Ben' }]);
    expect(result.list.tags).toEqual([
      { name: 'Hannah', color: 'purple' },
      { name: 'Ben', color: null },
    ]);
  });

  it('writes the built-in statuses out in full when one of them is renamed', () => {
    const result = accepted(renameTag(parseTagList('status', undefined), 'To do', HEBREW.toDo, [scene('A', { status: 'To do' })]));
    expect(result.value).toEqual([
      { name: HEBREW.toDo, color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: 'Revised', color: 'blue' },
      { name: 'Final', color: 'green' },
    ]);
    expect(result.scenePatches).toEqual([{ path: 'Manuscript/A.md', patch: { set: { status: HEBREW.toDo }, remove: [] } }]);
  });

  it('gives patches that change only the one property when applied', () => {
    const before = { synopsis: HEBREW.synopsis, status: 'First draft', label: 'Anna', target: 900, mine: [1, 2] };
    const frontmatter: Frontmatter = clone(before);
    const result = accepted(renameTag(statuses(), 'First draft', 'Rough', [{ path: 'a.md', frontmatter }]));
    const patch = result.scenePatches[0]?.patch;
    if (!patch) throw new Error('expected a patch');
    expect(applyFrontmatterPatch(frontmatter, patch)).toBe(true);
    expect(frontmatter).toEqual({ ...before, status: 'Rough' });
    expect(Object.keys(frontmatter)).toEqual(Object.keys(before));
  });
});

describe('renameTagInScene', () => {
  it('sets the new name on a scene that uses the old one', () => {
    expect(renameTagInScene('status', { status: 'first draft' }, 'First draft', 'Rough')).toEqual({ set: { status: 'Rough' }, remove: [] });
    expect(renameTagInScene('label', { label: HEBREW.daniel }, HEBREW.daniel, 'Daniel')).toEqual({ set: { label: 'Daniel' }, remove: [] });
  });

  it('changes nothing on a scene that does not use it', () => {
    const empty = { set: {}, remove: [] };
    expect(renameTagInScene('status', { status: 'To do' }, 'First draft', 'Rough')).toEqual(empty);
    expect(renameTagInScene('status', { label: 'First draft' }, 'First draft', 'Rough')).toEqual(empty);
    expect(renameTagInScene('status', {}, 'First draft', 'Rough')).toEqual(empty);
    expect(renameTagInScene('status', null, 'First draft', 'Rough')).toEqual(empty);
    expect(renameTagInScene('status', undefined, 'First draft', 'Rough')).toEqual(empty);
    expect(renameTagInScene('status', { status: 'Rough' }, 'First draft', 'Rough')).toEqual(empty);
  });

  it('never blanks a status because the new name was empty', () => {
    expect(renameTagInScene('status', { status: 'First draft' }, 'First draft', '  ')).toEqual({ set: {}, remove: [] });
  });

  it('lets a scene that changed on another device keep its newer status', () => {
    // The rename was worked out while the scene said "First draft"; by the
    // time of writing, another device had set it to "Final".
    const onDisk: Frontmatter = { status: 'Final', label: 'Anna' };
    const patch = renameTagInScene('status', onDisk, 'First draft', 'Rough');
    expect(applyFrontmatterPatch(onDisk, patch)).toBe(false);
    expect(onDisk).toEqual({ status: 'Final', label: 'Anna' });
  });
});

// --------------------------------------------------------------- recolouring

describe('recolourTag', () => {
  it('gives a status another colour', () => {
    const result = accepted(recolourTag(statuses(), 'To do', 'yellow'));
    expect(result.value).toEqual([
      { name: 'To do', color: 'yellow' },
      { name: 'First draft', color: 'orange' },
      { name: HEBREW.final, color: 'green' },
    ]);
    expect(findTag(result.list, 'To do')?.color).toBe('yellow');
    expect(result.scenePatches).toEqual([]);
  });

  it('colours a Hebrew label, found whatever the spaces around its name', () => {
    const result = accepted(recolourTag(labels(), ` ${HEBREW.daniel} `, 'pink'));
    expect(findTag(result.list, HEBREW.daniel)).toEqual({ name: HEBREW.daniel, color: 'pink' });
  });

  it('takes the colour away, leaving the entry without a colour key', () => {
    const result = accepted(recolourTag(labels(), 'Anna', null));
    expect(result.value[0]).toEqual({ name: 'Anna' });
    expect(findTag(result.list, 'Anna')?.color).toBeNull();
  });

  it('gives a colour to an entry that had none', () => {
    const result = accepted(recolourTag(labels(), 'Subplot', 'blue'));
    expect(result.value[2]).toEqual({ name: 'Subplot', color: 'blue' });
  });

  it('gives a bare name the longer form so that it can carry a colour', () => {
    const result = accepted(recolourTag(parseTagList('label', [HEBREW.anna, 'Ben']), HEBREW.anna, 'green'));
    expect(result.value).toEqual([{ name: HEBREW.anna, color: 'green' }, 'Ben']);
  });

  it('refuses a colour that is not one of the eight, and the colour it already has', () => {
    expect(refusal(recolourTag(statuses(), 'To do', 'teal' as never))).toBe('invalid-color');
    expect(refusal(recolourTag(statuses(), 'To do', 'red'))).toBe('unchanged');
    expect(refusal(recolourTag(labels(), 'Subplot', null))).toBe('unchanged');
    expect(refusal(recolourTag(statuses(), 'Abandoned', 'red'))).toBe('not-found');
  });

  it('writes the built-in statuses out in full when one of them is recoloured', () => {
    const result = accepted(recolourTag(parseTagList('status', undefined), 'Revised', 'purple'));
    expect(result.value).toEqual([
      { name: 'To do', color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: 'Revised', color: 'purple' },
      { name: 'Final', color: 'green' },
    ]);
    expect(result.list.fromDefaults).toBe(false);
    // The built-in list itself is not changed by this: it is the same next time.
    expect(parseTagList('status', undefined).tags.map((tag) => tag.color)).toEqual(['red', 'orange', 'blue', 'green']);
  });

  it('keeps a colour it does not know until the writer picks another', () => {
    const stored = deepFreeze([{ name: 'A', color: 'teal', icon: 'star' }, { name: 'B', color: 'red' }]);
    const list = parseTagList('label', stored);
    expect(findTag(list, 'A')?.color).toBeNull();
    // Choosing "no colour" for something already shown without one changes nothing...
    expect(refusal(recolourTag(list, 'A', null))).toBe('unchanged');
    // ...and recolouring another entry leaves the unknown colour where it is.
    const other = accepted(recolourTag(list, 'B', 'blue'));
    expect(other.value[0]).toBe(stored[0]);
    // Picking a real colour replaces it, and keeps the entry's other keys.
    const picked = accepted(recolourTag(list, 'A', 'green'));
    expect(picked.value[0]).toEqual({ name: 'A', color: 'green', icon: 'star' });
  });
});

// ---------------------------------------------------------------- reordering

describe('moveTag', () => {
  it('moves a status to another place', () => {
    expect(names(accepted(moveTag(statuses(), HEBREW.final, 0)).list)).toEqual([HEBREW.final, 'To do', 'First draft']);
    expect(names(accepted(moveTag(statuses(), 'To do', 2)).list)).toEqual(['First draft', HEBREW.final, 'To do']);
    expect(names(accepted(moveTag(statuses(), 'To do', 1)).list)).toEqual(['First draft', 'To do', HEBREW.final]);
  });

  it('returns the stored value in the new order, entries unchanged', () => {
    const result = accepted(moveTag(statuses(), HEBREW.final, 0));
    expect(result.value).toEqual([STORED_STATUSES[2], STORED_STATUSES[0], STORED_STATUSES[1]]);
    expect(result.key).toBe('statuses');
    expect(result.scenePatches).toEqual([]);
  });

  it('takes a place past the end as last, and one before the start as first', () => {
    expect(names(accepted(moveTag(statuses(), 'To do', 99)).list)).toEqual(['First draft', HEBREW.final, 'To do']);
    expect(names(accepted(moveTag(statuses(), 'To do', Number.POSITIVE_INFINITY)).list)).toEqual(['First draft', HEBREW.final, 'To do']);
    expect(names(accepted(moveTag(statuses(), HEBREW.final, -4)).list)).toEqual([HEBREW.final, 'To do', 'First draft']);
  });

  it('refuses a move to where it already is, and a status that is not there', () => {
    expect(refusal(moveTag(statuses(), 'First draft', 1))).toBe('unchanged');
    expect(refusal(moveTag(statuses(), HEBREW.final, 99))).toBe('unchanged');
    expect(refusal(moveTag(statuses(), 'Abandoned', 0))).toBe('not-found');
  });

  it('writes the built-in statuses out in their new order when one of them is moved', () => {
    const result = accepted(moveTag(parseTagList('status', undefined), 'Final', 0));
    expect(result.value).toEqual([
      { name: 'Final', color: 'green' },
      { name: 'To do', color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: 'Revised', color: 'blue' },
    ]);
    expect(names(parseTagList('status', undefined))).toEqual(['To do', 'First draft', 'Revised', 'Final']);
  });

  it('can reach every order, one move at a time, and always matches what a re-read gives', () => {
    const start = ['A', 'B', 'C', 'D'];
    for (let from = 0; from < start.length; from++) {
      for (let to = 0; to < start.length; to++) {
        const list = parseTagList('label', start.map((name) => ({ name })));
        const result = moveTag(list, start[from] as string, to);
        const expected = start.filter((_, index) => index !== from);
        expected.splice(to, 0, start[from] as string);
        if (from === to) expect(refusal(result)).toBe('unchanged');
        else expect(names(accepted(result).list), `${from} to ${to}`).toEqual(expected);
      }
    }
  });

  it('drops nothing: entries it does not understand travel with the one in front of them', () => {
    const stored = deepFreeze([null, { name: 'A' }, { name: 'a', color: 'red' }, { name: 'B' }, 42.5, ['x'], { name: 'C' }]);
    const list = parseTagList('label', stored);
    expect(names(list)).toEqual(['A', 'B', '42.5', 'C']);
    const result = accepted(moveTag(list, 'A', 3));
    expect(names(result.list)).toEqual(['B', '42.5', 'C', 'A']);
    expect(result.value).toEqual([null, { name: 'B' }, 42.5, ['x'], { name: 'C' }, { name: 'A' }, { name: 'a', color: 'red' }]);
    expect(result.value).toHaveLength(stored.length);
    for (const entry of stored) expect(result.value).toContain(entry);
  });

  it('never lets a repeat overtake the entry it repeats', () => {
    const list = parseTagList('label', [{ name: 'A', color: 'purple' }, { name: 'a', color: 'red' }, { name: 'B' }]);
    const result = accepted(moveTag(list, 'B', 0));
    expect(result.list.tags).toEqual([
      { name: 'B', color: null },
      { name: 'A', color: 'purple' },
    ]);
  });
});

// ------------------------------------------------------------------ removing

describe('removeTag', () => {
  it('takes a status off the list', () => {
    const result = accepted(removeTag(statuses(), 'first draft'));
    expect(result.value).toEqual([STORED_STATUSES[0], STORED_STATUSES[2]]);
    expect(names(result.list)).toEqual(['To do', HEBREW.final]);
    expect(result.key).toBe('statuses');
  });

  it('takes a Hebrew label off the list', () => {
    expect(names(accepted(removeTag(labels(), HEBREW.daniel)).list)).toEqual(['Anna', 'Subplot']);
  });

  it('asks for no change to any scene: scenes keep the name', () => {
    expect(accepted(removeTag(statuses(), 'To do')).scenePatches).toEqual([]);
  });

  it('can empty the list, which is then stored as an empty list and not as the built-in one', () => {
    let list = parseTagList('label', [{ name: 'A' }]);
    const result = accepted(removeTag(list, 'A'));
    expect(result.value).toEqual([]);
    list = result.list;
    expect(list.tags).toEqual([]);
    expect(list.fromDefaults).toBe(false);
  });

  it('removes one of the built-in statuses by writing out the other three', () => {
    const result = accepted(removeTag(parseTagList('status', undefined), 'Revised'));
    expect(result.value).toEqual([
      { name: 'To do', color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: 'Final', color: 'green' },
    ]);
  });

  it('removes repeats of the name too, and keeps everything else', () => {
    const stored = deepFreeze([{ name: 'A', color: 'purple' }, null, { name: 'a', color: 'red' }, { name: 'B', icon: 'x' }, 7.5]);
    const result = accepted(removeTag(parseTagList('label', stored), 'A'));
    expect(result.value).toEqual([null, { name: 'B', icon: 'x' }, 7.5]);
    expect(names(result.list)).toEqual(['B', '7.5']);
  });

  it('refuses a status that is not there', () => {
    expect(refusal(removeTag(statuses(), 'Abandoned'))).toBe('not-found');
  });
});

// ------------------------------------------------------------ all the changes

describe('every change to a list', () => {
  const changes: Array<[string, (list: TagList) => TagEditResult]> = [
    ['add', (list) => addTag(list, 'New one', 'pink')],
    ['rename', (list) => renameTag(list, 'B', HEBREW.anna, [{ path: 'x.md', frontmatter: { label: 'b' } }])],
    ['recolour', (list) => recolourTag(list, 'B', 'cyan')],
    ['move', (list) => moveTag(list, 'C', 0)],
    ['remove', (list) => removeTag(list, 'B')],
  ];
  const stored = (): unknown[] => [{ name: 'A', color: 'teal', icon: 'star' }, 'B', null, { name: 'b' }, { name: 'C', color: 'red' }, [1]];

  for (const [what, change] of changes) {
    it(`${what}: the list it returns is what reading the stored value gives`, () => {
      const result = accepted(change(parseTagList('label', stored())));
      expect(result.list).toEqual(parseTagList('label', clone(result.value)));
    });

    it(`${what}: is refused, with nothing to store, when the index holds something that is not a list`, () => {
      const locked = parseTagList('label', 'A, B, C');
      const result = change(locked);
      expect(refusal(result)).toBe('unreadable');
      expect(result).not.toHaveProperty('value');
    });

    it(`${what}: never changes the list or the stored value it was given`, () => {
      const frozen = deepFreeze(stored());
      const list = deepFreeze(parseTagList('label', frozen));
      expect(() => change(list)).not.toThrow();
      expect(frozen).toEqual(stored());
    });

    it(`${what}: keeps every entry it was not asked to change`, () => {
      const before = stored();
      const result = accepted(change(parseTagList('label', before)));
      // The entries nobody asked about: the unknown colour and key, the empty slot, the list.
      expect(result.value).toContainEqual({ name: 'A', color: 'teal', icon: 'star' });
      expect(result.value).toContainEqual(null);
      expect(result.value).toContainEqual([1]);
    });
  }
});

// -------------------------------------------------------------- across scenes

describe('unlistedTags', () => {
  it('reports the statuses that scenes use but the list does not have, in order of first use', () => {
    const scenes = [
      scene('One', { status: 'To do' }),
      scene('Two', { status: 'Abandoned' }),
      scene('Three', { status: HEBREW.toDo }),
      scene('Four', { status: 'abandoned' }),
      scene('Five', { status: ' first  draft ' }),
      scene('Six', { status: HEBREW.toDo }),
    ];
    expect(unlistedTags(statuses(), deepFreeze(scenes))).toEqual([
      { name: 'Abandoned', paths: ['Manuscript/Two.md', 'Manuscript/Four.md'] },
      { name: HEBREW.toDo, paths: ['Manuscript/Three.md', 'Manuscript/Six.md'] },
    ]);
  });

  it('reports unlisted labels from the label property, not from the status', () => {
    const scenes = [scene('One', { status: 'Ghost', label: 'Anna' }), scene('Two', { status: 'To do', label: 'Ghost' })];
    expect(unlistedTags(labels(), scenes)).toEqual([{ name: 'Ghost', paths: ['Manuscript/Two.md'] }]);
  });

  it('reports nothing for scenes without a status, or with one it cannot read', () => {
    const scenes = [scene('One', {}), scene('Two', { status: '' }), scene('Three', { status: null }), scene('Four', null), scene('Five', { status: ['x'] })];
    expect(unlistedTags(statuses(), scenes)).toEqual([]);
    expect(unlistedTags(statuses(), [])).toEqual([]);
  });

  it('reports every status in use when the project has removed them all', () => {
    const scenes = [scene('One', { status: 'To do' }), scene('Two', { status: 'Final' })];
    expect(unlistedTags(parseTagList('status', []), scenes).map((entry) => entry.name)).toEqual(['To do', 'Final']);
  });

  it('offers names that addTag then accepts', () => {
    const scenes = [scene('One', { label: HEBREW.anna }), scene('Two', { label: 'Narrator' })];
    let list = labels();
    for (const missing of unlistedTags(list, scenes)) list = accepted(addTag(list, missing.name)).list;
    expect(unlistedTags(list, scenes)).toEqual([]);
    expect(names(list)).toEqual(['Anna', HEBREW.daniel, 'Subplot', HEBREW.anna, 'Narrator']);
  });
});

describe('scenesUsingTag', () => {
  it('lists the scenes that use a status or label, whatever the capitals', () => {
    const scenes = [
      scene('One', { status: 'To do', label: HEBREW.anna }),
      scene('Two', { status: 'to DO', label: 'Anna' }),
      scene('Three', { status: 'Final', label: ` ${HEBREW.anna}` }),
      scene('Four', null),
    ];
    expect(scenesUsingTag('status', 'To do', scenes)).toEqual(['Manuscript/One.md', 'Manuscript/Two.md']);
    expect(scenesUsingTag('label', HEBREW.anna, scenes)).toEqual(['Manuscript/One.md', 'Manuscript/Three.md']);
    expect(scenesUsingTag('label', 'Nobody', scenes)).toEqual([]);
  });
});
