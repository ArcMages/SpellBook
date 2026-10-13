// The inspector: what it shows for the open scene, and the patch an edit becomes.

import { describe, expect, it } from 'vitest';
import {
  MAX_TARGET,
  applyFrontmatterPatch,
  buildInspector,
  inspectorPatch,
  isEmptyPatch,
  parseTargetInput,
  readTagLists,
} from '../../src/core/cards';
import type { FrontmatterPatch, InspectorEdits, InspectorResult } from '../../src/core/cards';
import type { Frontmatter } from '../../src/core/types';
import { HEBREW, clone, deepFreeze, sampleLists } from './helpers';

const lists = sampleLists();

/** A scene as it might be on disk, with keys this engine knows nothing about. */
function scene(): Frontmatter {
  return {
    synopsis: 'Anna finds the letter.',
    status: 'First draft',
    label: 'Anna',
    target: 1500,
    compile: true,
    order: 3.5,
    created: '2026-10-01',
    edited: '2026-10-12',
    aliases: ['The Letter'],
    tags: ['draft', HEBREW.letter],
    'pov-notes': { who: HEBREW.anna, deep: [1, 2, 3] },
  };
}

/** The patch of edits that must have been accepted. */
function patchOf(result: InspectorResult): FrontmatterPatch {
  if (!result.ok) throw new Error(`not accepted: ${result.errors.map((error) => error.message).join(' ')}`);
  return result.patch;
}

/** The fields whose edits were not accepted. */
function refusedFields(result: InspectorResult): string[] {
  if (result.ok) throw new Error('expected the edits to be refused');
  for (const error of result.errors) expect(error.message.length).toBeGreaterThan(0);
  return result.errors.map((error) => error.field);
}

const NOTHING: FrontmatterPatch = { set: {}, remove: [] };

describe('buildInspector', () => {
  it('shows the editable fields and the two dates of the open scene', () => {
    const model = buildInspector({ path: 'Manuscript/The Letter.md', frontmatter: scene() }, lists);
    expect(model).toEqual({
      path: 'Manuscript/The Letter.md',
      title: 'The Letter',
      synopsis: 'Anna finds the letter.',
      status: 'First draft',
      statusOptions: [
        { name: 'To do', color: 'red', listed: true, selected: false },
        { name: 'First draft', color: 'orange', listed: true, selected: true },
        { name: HEBREW.final, color: 'green', listed: true, selected: false },
      ],
      label: 'Anna',
      labelOptions: [
        { name: 'Anna', color: 'purple', listed: true, selected: true },
        { name: HEBREW.daniel, color: 'cyan', listed: true, selected: false },
      ],
      target: 1500,
      compile: true,
      created: '2026-10-01',
      createdText: '1 Oct 2026',
      edited: '2026-10-12',
      editedText: '12 Oct 2026',
      problems: [],
    });
  });

  it('shows a Hebrew scene unchanged', () => {
    const model = buildInspector(
      { path: `Manuscript/${HEBREW.opening}.md`, frontmatter: { synopsis: HEBREW.synopsis, status: HEBREW.final, label: HEBREW.daniel } },
      lists,
    );
    expect(model.title).toBe(HEBREW.opening);
    expect(model.synopsis).toBe(HEBREW.synopsis);
    expect(model.status).toBe(HEBREW.final);
    expect(model.label).toBe(HEBREW.daniel);
    expect(model.statusOptions.filter((option) => option.selected).map((option) => option.name)).toEqual([HEBREW.final]);
    expect(model.labelOptions.filter((option) => option.selected).map((option) => option.name)).toEqual([HEBREW.daniel]);
  });

  it('selects the listed status even when the scene spells it with other capitals', () => {
    const model = buildInspector({ path: 'a.md', frontmatter: { status: 'first DRAFT', label: ' anna ' } }, lists);
    expect(model.status).toBe('First draft');
    expect(model.label).toBe('Anna');
    expect(model.statusOptions.map((option) => option.selected)).toEqual([false, true, false]);
  });

  it('adds the scene\'s own status or label to the choices when the list lacks it, without a colour', () => {
    const model = buildInspector({ path: 'a.md', frontmatter: { status: 'Abandoned', label: HEBREW.anna } }, lists);
    expect(model.status).toBe('Abandoned');
    expect(model.statusOptions).toHaveLength(4);
    expect(model.statusOptions[3]).toEqual({ name: 'Abandoned', color: null, listed: false, selected: true });
    expect(model.statusOptions.filter((option) => option.selected)).toHaveLength(1);
    expect(model.labelOptions[2]).toEqual({ name: HEBREW.anna, color: null, listed: false, selected: true });
  });

  it('selects nothing when the scene has no status or label', () => {
    const model = buildInspector({ path: 'a.md', frontmatter: { status: '', label: null } }, lists);
    expect(model.status).toBeNull();
    expect(model.label).toBeNull();
    expect(model.statusOptions.some((option) => option.selected)).toBe(false);
    expect(model.labelOptions.some((option) => option.selected)).toBe(false);
  });

  it('shows the usual values for a scene without properties', () => {
    for (const frontmatter of [null, undefined, {}]) {
      const model = buildInspector({ path: 'Manuscript/New.md', frontmatter }, lists);
      expect(model).toMatchObject({
        title: 'New',
        synopsis: '',
        status: null,
        label: null,
        target: null,
        compile: true,
        created: null,
        createdText: '',
        edited: null,
        editedText: '',
        problems: [],
      });
    }
  });

  it('offers the built-in statuses in a project that has not chosen its own', () => {
    const model = buildInspector({ path: 'a.md', frontmatter: { status: 'Revised' } }, readTagLists({}));
    expect(model.statusOptions.map((option) => option.name)).toEqual(['To do', 'First draft', 'Revised', 'Final']);
    expect(model.statusOptions.map((option) => option.selected)).toEqual([false, false, true, false]);
    expect(model.labelOptions).toEqual([]);
  });

  it('shows a date and time as its date, and leaves out a date it cannot read', () => {
    const model = buildInspector({ path: 'a.md', frontmatter: { created: '2026-03-09T22:15:00', edited: 'last week' } }, lists);
    expect(model.created).toBe('2026-03-09');
    expect(model.createdText).toBe('9 Mar 2026');
    expect(model.edited).toBeNull();
    expect(model.editedText).toBe('');
    expect(model.problems).toHaveLength(1);
    expect(model.problems[0]).toContain('"edited"');
  });

  it('reports the properties it could not understand, and never throws on them', () => {
    const odd = deepFreeze({ synopsis: ['a'], status: { x: 1 }, label: [HEBREW.anna], target: 'many', compile: 'perhaps', created: 5, edited: [] });
    const model = buildInspector({ path: 'a.md', frontmatter: odd }, lists);
    expect(model.problems).toHaveLength(7);
    expect(model).toMatchObject({ synopsis: '', status: null, label: null, target: null, compile: true, created: null, edited: null });
  });
});

describe('inspectorPatch: only what really changed', () => {
  it('is empty when nothing is edited', () => {
    const result = inspectorPatch(scene(), {});
    expect(result).toEqual({ ok: true, patch: NOTHING, changed: [] });
    expect(isEmptyPatch(patchOf(result))).toBe(true);
  });

  it('is empty when every field is set to what the scene already says', () => {
    const same: InspectorEdits = { synopsis: 'Anna finds the letter.', status: 'First draft', label: 'Anna', target: 1500, compile: true };
    expect(inspectorPatch(scene(), same, lists)).toEqual({ ok: true, patch: NOTHING, changed: [] });
    expect(inspectorPatch(scene(), { ...same, target: '1,500' })).toEqual({ ok: true, patch: NOTHING, changed: [] });
  });

  it('is empty when the inspector hands back exactly what it showed', () => {
    const cases: Frontmatter[] = [
      scene(),
      {},
      { synopsis: null, status: '', label: null, target: null, compile: null },
      { status: 'first DRAFT', label: ' anna ', target: '1500', compile: 'no' },
      { status: 'Abandoned', label: HEBREW.anna, synopsis: `${HEBREW.synopsis}\n` },
      { synopsis: ['a'], status: { x: 1 }, label: [1], target: 'many', compile: 'perhaps' },
      { synopsis: 1984, status: 2, label: 7, target: 0 },
    ];
    for (const frontmatter of cases) {
      const shown = buildInspector({ path: 'a.md', frontmatter }, lists);
      const back: InspectorEdits = { synopsis: shown.synopsis, status: shown.status, label: shown.label, target: shown.target, compile: shown.compile };
      expect(inspectorPatch(frontmatter, back, lists), JSON.stringify(frontmatter)).toEqual({ ok: true, patch: NOTHING, changed: [] });
    }
  });

  it('holds only the one key that changed', () => {
    expect(inspectorPatch(scene(), { synopsis: 'She burns it.' })).toEqual({
      ok: true,
      patch: { set: { synopsis: 'She burns it.' }, remove: [] },
      changed: ['synopsis'],
    });
    expect(inspectorPatch(scene(), { status: 'To do' })).toEqual({ ok: true, patch: { set: { status: 'To do' }, remove: [] }, changed: ['status'] });
    expect(inspectorPatch(scene(), { label: HEBREW.daniel })).toEqual({ ok: true, patch: { set: { label: HEBREW.daniel }, remove: [] }, changed: ['label'] });
    expect(inspectorPatch(scene(), { target: 2000 })).toEqual({ ok: true, patch: { set: { target: 2000 }, remove: [] }, changed: ['target'] });
    expect(inspectorPatch(scene(), { compile: false })).toEqual({ ok: true, patch: { set: { compile: false }, remove: [] }, changed: ['compile'] });
  });

  it('leaves out the fields that did not change when several are sent together', () => {
    const result = inspectorPatch(scene(), { synopsis: 'Anna finds the letter.', status: HEBREW.final, label: 'Anna', target: 1500, compile: false }, lists);
    expect(result).toEqual({
      ok: true,
      patch: { set: { status: HEBREW.final, compile: false }, remove: [] },
      changed: ['status', 'compile'],
    });
  });

  it('never touches created, edited or any key it does not know, whatever is sent', () => {
    const sneaky = { synopsis: 'New.', created: '1999-01-01', edited: '1999-01-02', order: 99, aliases: [], binder: [], title: 'x' } as InspectorEdits;
    const patch = patchOf(inspectorPatch(scene(), sneaky));
    expect(patch).toEqual({ set: { synopsis: 'New.' }, remove: [] });

    const frontmatter = scene();
    expect(applyFrontmatterPatch(frontmatter, patch)).toBe(true);
    expect(frontmatter).toEqual({ ...scene(), synopsis: 'New.' });
    expect(Object.keys(frontmatter)).toEqual(Object.keys(scene()));
  });

  it('only ever names the five editable keys', () => {
    const everything: InspectorEdits = { synopsis: HEBREW.synopsis, status: 'To do', label: HEBREW.daniel, target: null, compile: false };
    const patch = patchOf(inspectorPatch(scene(), everything, lists));
    expect(Object.keys(patch.set).sort()).toEqual(['compile', 'label', 'status', 'synopsis']);
    expect(patch.remove).toEqual(['target']);
  });

  it('never changes the properties it is given', () => {
    const frozen = deepFreeze(scene());
    expect(() => inspectorPatch(frozen, { synopsis: 'x', status: null, label: 'Ben', target: '', compile: false }, lists)).not.toThrow();
    expect(frozen).toEqual(scene());
  });
});

describe('inspectorPatch: synopsis', () => {
  it('stores the text exactly as typed, in Hebrew as in English', () => {
    const typed = `  ${HEBREW.synopsis}\n\n${HEBREW.anna}  and  Daniel (1984)  `;
    expect(patchOf(inspectorPatch(scene(), { synopsis: typed })).set).toEqual({ synopsis: typed });
  });

  it('passes pointed Hebrew through code for code, in what it shows and in what it stores', () => {
    expect(HEBREW.untidy.normalize('NFC')).not.toBe(HEBREW.untidy);
    const shown = buildInspector({ path: 'a.md', frontmatter: { synopsis: HEBREW.untidy, status: HEBREW.untidy, label: HEBREW.untidy } }, lists);
    expect(shown.synopsis).toBe(HEBREW.untidy);
    expect(shown.status).toBe(HEBREW.untidy);
    expect(shown.labelOptions[shown.labelOptions.length - 1]?.name).toBe(HEBREW.untidy);
    const patch = patchOf(inspectorPatch(scene(), { synopsis: HEBREW.untidy, status: HEBREW.untidy, label: ` ${HEBREW.untidy} ` }, lists));
    expect(patch.set).toEqual({ synopsis: HEBREW.untidy, status: HEBREW.untidy, label: HEBREW.untidy });
  });

  it('treats a change in spacing as a change', () => {
    expect(patchOf(inspectorPatch({ synopsis: 'One.' }, { synopsis: 'One. ' })).set).toEqual({ synopsis: 'One. ' });
  });

  it('stores an emptied synopsis as empty text, keeping the key', () => {
    expect(patchOf(inspectorPatch(scene(), { synopsis: '' }))).toEqual({ set: { synopsis: '' }, remove: [] });
  });

  it('does not add an empty synopsis to a scene that has none', () => {
    expect(patchOf(inspectorPatch({}, { synopsis: '' }))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch(null, { synopsis: '' }))).toEqual(NOTHING);
  });

  it('adds the key to a scene that has no properties yet', () => {
    expect(patchOf(inspectorPatch(null, { synopsis: HEBREW.synopsis }))).toEqual({ set: { synopsis: HEBREW.synopsis }, remove: [] });
    expect(patchOf(inspectorPatch(undefined, { synopsis: 'New.' }))).toEqual({ set: { synopsis: 'New.' }, remove: [] });
  });

  it('refuses a synopsis that is not text', () => {
    expect(refusedFields(inspectorPatch(scene(), { synopsis: 5 as never }))).toEqual(['synopsis']);
    expect(refusedFields(inspectorPatch(scene(), { synopsis: null as never }))).toEqual(['synopsis']);
  });
});

describe('inspectorPatch: status and label', () => {
  it('sets a status or label by name', () => {
    expect(patchOf(inspectorPatch(scene(), { status: HEBREW.final }, lists)).set).toEqual({ status: HEBREW.final });
    expect(patchOf(inspectorPatch(scene(), { label: HEBREW.daniel }, lists)).set).toEqual({ label: HEBREW.daniel });
  });

  it('stores a listed name the way the list spells it', () => {
    expect(patchOf(inspectorPatch(scene(), { status: ' to DO ' }, lists)).set).toEqual({ status: 'To do' });
    expect(patchOf(inspectorPatch(scene(), { label: ` ${HEBREW.daniel}  ` }, lists)).set).toEqual({ label: HEBREW.daniel });
  });

  it('accepts a name that is not in the list, with tidy spacing', () => {
    expect(patchOf(inspectorPatch(scene(), { status: '  Second   draft ' }, lists)).set).toEqual({ status: 'Second draft' });
    expect(patchOf(inspectorPatch(scene(), { label: HEBREW.anna })).set).toEqual({ label: HEBREW.anna });
  });

  it('does not count a difference in capitals alone as a change', () => {
    expect(patchOf(inspectorPatch({ status: 'first draft' }, { status: 'First draft' }, lists))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch({ status: 'first draft' }, { status: 'FIRST DRAFT' }))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch({ label: ` ${HEBREW.daniel} ` }, { label: HEBREW.daniel }, lists))).toEqual(NOTHING);
  });

  it('stores a cleared status or label as empty text', () => {
    expect(patchOf(inspectorPatch(scene(), { status: null }))).toEqual({ set: { status: '' }, remove: [] });
    expect(patchOf(inspectorPatch(scene(), { label: '' }))).toEqual({ set: { label: '' }, remove: [] });
    expect(patchOf(inspectorPatch(scene(), { label: '   ' }))).toEqual({ set: { label: '' }, remove: [] });
  });

  it('does not add an empty status or label to a scene that has none', () => {
    expect(patchOf(inspectorPatch({}, { status: null, label: '' }))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch({ status: '', label: null }, { status: '', label: null }))).toEqual(NOTHING);
  });

  it('replaces a value it could not read when the writer picks a real one', () => {
    expect(patchOf(inspectorPatch({ status: ['a', 'b'] }, { status: 'To do' }, lists))).toEqual({ set: { status: 'To do' }, remove: [] });
    // ...but leaves it alone when the writer picks "none", which is what was shown.
    expect(patchOf(inspectorPatch({ status: ['a', 'b'] }, { status: null }, lists))).toEqual(NOTHING);
  });

  it('refuses a status or label that is not a name', () => {
    expect(refusedFields(inspectorPatch(scene(), { status: 3 as never }))).toEqual(['status']);
    expect(refusedFields(inspectorPatch(scene(), { label: ['Anna'] as never }))).toEqual(['label']);
  });
});

describe('inspectorPatch: target', () => {
  it('sets a whole number of words', () => {
    expect(patchOf(inspectorPatch(scene(), { target: 2000 }))).toEqual({ set: { target: 2000 }, remove: [] });
    expect(patchOf(inspectorPatch({}, { target: 1 }))).toEqual({ set: { target: 1 }, remove: [] });
    expect(patchOf(inspectorPatch({}, { target: MAX_TARGET }))).toEqual({ set: { target: MAX_TARGET }, remove: [] });
  });

  it('reads a target typed into the box', () => {
    expect(patchOf(inspectorPatch(scene(), { target: '2000' })).set).toEqual({ target: 2000 });
    expect(patchOf(inspectorPatch(scene(), { target: ' 2,000 ' })).set).toEqual({ target: 2000 });
  });

  it('stores the target as a number even where the scene had it as text', () => {
    expect(patchOf(inspectorPatch({ target: '1500' }, { target: '1500' }))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch({ target: '1500' }, { target: '1600' }))).toEqual({ set: { target: 1600 }, remove: [] });
  });

  it('removes the key when the target is emptied', () => {
    for (const emptied of [null, '', '   ', 0, '0']) {
      const result = inspectorPatch(scene(), { target: emptied });
      expect(result, String(emptied)).toEqual({ ok: true, patch: { set: {}, remove: ['target'] }, changed: ['target'] });
    }
    const frontmatter = scene();
    applyFrontmatterPatch(frontmatter, patchOf(inspectorPatch(frontmatter, { target: '' })));
    expect('target' in frontmatter).toBe(false);
    expect(Object.keys(frontmatter)).toEqual(Object.keys(scene()).filter((key) => key !== 'target'));
  });

  it('has nothing to remove when the scene has no target', () => {
    expect(patchOf(inspectorPatch({ synopsis: 'x' }, { target: null }))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch({ target: null }, { target: '' }))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch(null, { target: 0 }))).toEqual(NOTHING);
  });

  it('leaves a target it could not read alone unless a real one is typed', () => {
    expect(patchOf(inspectorPatch({ target: 'soon' }, { target: '' }))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch({ target: 'soon' }, { target: 800 }))).toEqual({ set: { target: 800 }, remove: [] });
  });

  it('refuses a target that is not a whole number of words, and says why', () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 'lots', '1.5', '-200', '12 words', HEBREW.anna, true, [1500]]) {
      const result = inspectorPatch(scene(), { target: bad as never });
      expect(refusedFields(result), String(bad)).toEqual(['target']);
      if (!result.ok) expect(result.errors[0]?.message).toBe('A target is a whole number of words.');
    }
  });

  it('refuses a target above the largest allowed, naming the limit', () => {
    for (const tooBig of [MAX_TARGET + 1, String(MAX_TARGET + 1), '99,999,999,999']) {
      const result = inspectorPatch(scene(), { target: tooBig });
      expect(refusedFields(result), String(tooBig)).toEqual(['target']);
      if (!result.ok) expect(result.errors[0]?.message).toBe('A target can be at most 10,000,000 words.');
    }
  });
});

describe('inspectorPatch: compile', () => {
  it('sets yes or no only when it differs from the scene', () => {
    expect(patchOf(inspectorPatch({ compile: true }, { compile: false }))).toEqual({ set: { compile: false }, remove: [] });
    expect(patchOf(inspectorPatch({ compile: false }, { compile: true }))).toEqual({ set: { compile: true }, remove: [] });
    expect(patchOf(inspectorPatch({ compile: false }, { compile: false }))).toEqual(NOTHING);
  });

  it('knows a scene without the key is compiled, so "yes" adds nothing', () => {
    expect(patchOf(inspectorPatch({}, { compile: true }))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch({}, { compile: false }))).toEqual({ set: { compile: false }, remove: [] });
    expect(patchOf(inspectorPatch(null, { compile: false }))).toEqual({ set: { compile: false }, remove: [] });
  });

  it('leaves "no" written as a word alone when the answer is still no', () => {
    expect(patchOf(inspectorPatch({ compile: 'no' }, { compile: false }))).toEqual(NOTHING);
    expect(patchOf(inspectorPatch({ compile: 'no' }, { compile: true }))).toEqual({ set: { compile: true }, remove: [] });
  });

  it('refuses anything but yes or no', () => {
    expect(refusedFields(inspectorPatch(scene(), { compile: 'yes' as never }))).toEqual(['compile']);
    expect(refusedFields(inspectorPatch(scene(), { compile: null as never }))).toEqual(['compile']);
  });
});

describe('inspectorPatch: edits that are not acceptable', () => {
  it('gives no patch at all when any edit is refused, and lists every refusal', () => {
    const result = inspectorPatch(scene(), { synopsis: 'A perfectly good synopsis.', status: 9 as never, target: 'lots', compile: 'no' as never });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('patch');
    expect(refusedFields(result)).toEqual(['status', 'target', 'compile']);
  });
});

describe('inspectorPatch: against the file as it is at the moment of writing', () => {
  it('does not undo a change made on another device to a field the writer did not touch', () => {
    // The inspector showed status "First draft"; meanwhile another device set it to the Hebrew "Final".
    const onDisk: Frontmatter = { ...scene(), status: HEBREW.final, target: 1800 };
    const patch = patchOf(inspectorPatch(onDisk, { synopsis: 'She burns it.' }, lists));
    applyFrontmatterPatch(onDisk, patch);
    expect(onDisk['status']).toBe(HEBREW.final);
    expect(onDisk['target']).toBe(1800);
    expect(onDisk['synopsis']).toBe('She burns it.');
  });

  it('writes nothing when the file already says what the writer asked for', () => {
    const onDisk: Frontmatter = { ...scene(), status: 'To do' };
    const patch = patchOf(inspectorPatch(onDisk, { status: 'To do' }, lists));
    expect(applyFrontmatterPatch(onDisk, patch)).toBe(false);
  });

  it('round-trips: after applying the patch, the inspector shows what was asked for', () => {
    const edits: InspectorEdits = { synopsis: HEBREW.synopsis, status: HEBREW.final, label: null, target: '2,500', compile: false };
    const frontmatter = clone(scene());
    applyFrontmatterPatch(frontmatter, patchOf(inspectorPatch(frontmatter, edits, lists)));
    const shown = buildInspector({ path: 'a.md', frontmatter }, lists);
    expect(shown).toMatchObject({ synopsis: HEBREW.synopsis, status: HEBREW.final, label: null, target: 2500, compile: false });
    // And asking for the same again changes nothing.
    expect(patchOf(inspectorPatch(frontmatter, edits, lists))).toEqual(NOTHING);
  });
});

describe('parseTargetInput', () => {
  it('reads whole numbers, as numbers or as typed text', () => {
    expect(parseTargetInput(1500)).toEqual({ ok: true, target: 1500 });
    expect(parseTargetInput('1500')).toEqual({ ok: true, target: 1500 });
    expect(parseTargetInput(' 1,500 ')).toEqual({ ok: true, target: 1500 });
    expect(parseTargetInput(MAX_TARGET)).toEqual({ ok: true, target: MAX_TARGET });
  });

  it('reads an empty box or a zero as no target', () => {
    for (const none of [null, undefined, '', '  ', 0, '0']) {
      expect(parseTargetInput(none), String(none)).toEqual({ ok: true, target: null });
    }
  });

  it('explains what is wrong with anything else', () => {
    expect(parseTargetInput('a lot')).toEqual({ ok: false, message: 'A target is a whole number of words.' });
    expect(parseTargetInput(12.5)).toEqual({ ok: false, message: 'A target is a whole number of words.' });
    expect(parseTargetInput(-1)).toEqual({ ok: false, message: 'A target is a whole number of words.' });
    expect(parseTargetInput(MAX_TARGET + 1)).toEqual({ ok: false, message: 'A target can be at most 10,000,000 words.' });
    expect(parseTargetInput('10,000,001')).toEqual({ ok: false, message: 'A target can be at most 10,000,000 words.' });
  });
});
