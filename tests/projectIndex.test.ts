import { describe, expect, it } from 'vitest';
import { flattenScenes, folderIds } from '../src/core/binderTree';
import {
  isProjectIndex,
  newIndexFrontmatter,
  parseProjectIndex,
  serialiseBinder,
  writeBinder,
} from '../src/core/projectIndex';
import type { Binder, Frontmatter } from '../src/core/types';

/** The example from the design notes. */
function example(): Frontmatter {
  return {
    spellbook: 'project',
    version: 1,
    title: 'My Novel',
    binder: [
      'Manuscript/Opening.md',
      {
        folder: 'Part one',
        id: 'f-k3x9q2',
        children: ['Manuscript/The Letter.md', 'Manuscript/Night Train.md'],
      },
    ],
  };
}

function parsedBinder(frontmatter: Frontmatter): Binder {
  const parsed = parseProjectIndex(frontmatter);
  if (!parsed.ok) throw new Error(`expected a readable index, got: ${parsed.error}`);
  return parsed.binder;
}

function errorOf(frontmatter: Frontmatter): string {
  const parsed = parseProjectIndex(frontmatter);
  if (parsed.ok) throw new Error('expected an unreadable index');
  return parsed.error;
}

describe('isProjectIndex', () => {
  it('recognises the marker and nothing else', () => {
    expect(isProjectIndex({ spellbook: 'project' })).toBe(true);
    expect(isProjectIndex({ spellbook: 'Project' })).toBe(false);
    expect(isProjectIndex({ spellbook: true })).toBe(false);
    expect(isProjectIndex({ title: 'x' })).toBe(false);
    expect(isProjectIndex(null)).toBe(false);
    expect(isProjectIndex(undefined)).toBe(false);
    expect(isProjectIndex(['spellbook', 'project'])).toBe(false);
  });
});

describe('parseProjectIndex', () => {
  it('reads the documented layout', () => {
    const parsed = parseProjectIndex(example());
    expect(parsed).toEqual({
      ok: true,
      title: 'My Novel',
      notes: [],
      binder: [
        { kind: 'scene', path: 'Manuscript/Opening.md' },
        {
          kind: 'folder',
          id: 'f-k3x9q2',
          name: 'Part one',
          children: [
            { kind: 'scene', path: 'Manuscript/The Letter.md' },
            { kind: 'scene', path: 'Manuscript/Night Train.md' },
          ],
        },
      ],
    });
  });

  it('treats a missing or empty binder as an empty one', () => {
    expect(parsedBinder({ spellbook: 'project' })).toEqual([]);
    expect(parsedBinder({ spellbook: 'project', binder: null })).toEqual([]);
    expect(parsedBinder({ spellbook: 'project', binder: [] })).toEqual([]);
  });

  it('has no title when the property is missing, empty or not text', () => {
    expect(parseProjectIndex({ spellbook: 'project' }).title).toBeNull();
    expect(parseProjectIndex({ spellbook: 'project', title: '  ' }).title).toBeNull();
    expect(parseProjectIndex({ spellbook: 'project', title: 42 }).title).toBeNull();
    expect(parseProjectIndex({ spellbook: 'project', title: 'הרומן שלי' }).title).toBe('הרומן שלי');
  });

  it('accepts a folder without children and nested folders', () => {
    const binder = parsedBinder({
      spellbook: 'project',
      binder: [
        { folder: 'Empty', id: 'f-1' },
        { folder: 'Outer', id: 'f-2', children: [{ folder: 'Inner', id: 'f-3', children: null }] },
      ],
    });
    expect(folderIds(binder)).toEqual(['f-1', 'f-2', 'f-3']);
    expect(flattenScenes(binder)).toEqual([]);
  });

  it('tidies hand-written paths without changing which note they mean', () => {
    const binder = parsedBinder({
      spellbook: 'project',
      binder: ['./Manuscript//Opening.md', 'Manuscript/./Two.md'],
    });
    expect(flattenScenes(binder)).toEqual(['Manuscript/Opening.md', 'Manuscript/Two.md']);
  });

  describe('unreadable binders', () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ['binder is text', 'Manuscript/Opening.md', /the binder should be a list/],
      ['binder is a number', 7, /the binder should be a list/],
      ['binder is a map', { folder: 'x' }, /the binder should be a list/],
      ['an entry is a number', ['a.md', 1984], /Entry 2 of the binder/],
      ['an entry is true', [true], /Entry 1 of the binder/],
      ['an entry is empty', ['a.md', null], /Entry 2 of the binder.*empty entry/],
      ['an entry is a list', [['a.md']], /Entry 1 of the binder.*a list/],
      ['a map without a folder name', [{ id: 'f-1', children: [] }], /"folder" name/],
      ['a folder name that is a number', [{ folder: 1984, id: 'f-1' }], /"folder" name is the number 1984/],
      ['a folder id that is a number', [{ folder: 'A', id: 12 }], /has an id that is not text/],
      ['a folder id that is empty', [{ folder: 'A', id: '  ' }], /has an id that is not text/],
      ['children that are text', [{ folder: 'A', id: 'f-1', children: 'a.md' }], /the folder "A" should be a list/],
      [
        'a bad entry deep inside',
        [{ folder: 'A', id: 'f-1', children: [{ folder: 'B', id: 'f-2', children: ['ok.md', 5] }] }],
        /Entry 2 of the folder "B"/,
      ],
      ['an empty path', [''], /not a path inside the project folder/],
      ['a path that climbs out of the project', ['../Other/secret.md'], /not a path inside the project folder/],
      ['a path that climbs out half-way', ['Manuscript/../../x.md'], /not a path inside the project folder/],
      ['an absolute path', ['/Manuscript/a.md'], /not a path inside the project folder/],
      ['a path with a backslash', ['Manuscript\\a.md'], /not a path inside the project folder/],
    ];
    for (const [name, binder, message] of cases) {
      it(`reports ${name}`, () => {
        const parsed = parseProjectIndex({ spellbook: 'project', title: 'T', binder });
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.error).toMatch(message);
        expect(parsed.title).toBe('T'); // the title is still usable for showing the error
      });
    }
  });

  it('refuses an index written by a newer version of the plugin', () => {
    expect(errorOf({ spellbook: 'project', version: 2, binder: [] })).toMatch(/newer version of Spellbook/);
    expect(errorOf({ spellbook: 'project', version: 'one', binder: [] })).toMatch(/"version" property/);
    expect(errorOf({ spellbook: 'project', version: 1.5, binder: [] })).toMatch(/"version" property/);
    // no version at all is read as the first layout
    expect(parseProjectIndex({ spellbook: 'project', binder: [] }).ok).toBe(true);
  });

  describe('duplicates', () => {
    it('keeps the first occurrence of a repeated scene and says so', () => {
      const parsed = parseProjectIndex({
        spellbook: 'project',
        binder: ['a.md', { folder: 'F', id: 'f-1', children: ['b.md', 'a.md'] }, 'b.md', 'c.md'],
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(flattenScenes(parsed.binder)).toEqual(['a.md', 'b.md', 'c.md']);
      expect(parsed.notes).toHaveLength(2);
      expect(parsed.notes[0]).toMatch(/"a\.md" was listed more than once/);
    });

    it('counts differently written paths to the same note as a repeat', () => {
      const binder = parsedBinder({ spellbook: 'project', binder: ['Manuscript/a.md', './Manuscript//a.md'] });
      expect(flattenScenes(binder)).toEqual(['Manuscript/a.md']);
    });

    it('gives the second of two folders with the same id a new one', () => {
      const parsed = parseProjectIndex({
        spellbook: 'project',
        binder: [
          { folder: 'One', id: 'f-same' },
          { folder: 'Two', id: 'f-same' },
          { folder: 'Three', id: 'f-same-2' },
        ],
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const ids = folderIds(parsed.binder);
      expect(new Set(ids).size).toBe(3);
      expect(ids[0]).toBe('f-same');
      expect(ids[2]).toBe('f-same-2'); // an id that is written out is never taken away
      expect(parsed.notes.join(' ')).toMatch(/shared the id "f-same"/);
    });
  });

  describe('folders written by hand without an id', () => {
    const handWritten = (): Frontmatter => ({
      spellbook: 'project',
      binder: [{ folder: 'Part one', children: ['a.md'] }, { folder: 'Part two' }, { folder: 'Part one' }],
    });

    it('gives each one an id', () => {
      const ids = folderIds(parsedBinder(handWritten()));
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(id).toMatch(/^f-[a-z0-9-]+$/);
    });

    it('gives the same ids every time, so an id seen on screen still works when saving', () => {
      expect(folderIds(parsedBinder(handWritten()))).toEqual(folderIds(parsedBinder(handWritten())));
    });

    it('never reuses an id that another folder has written out', () => {
      const first = folderIds(parsedBinder({ spellbook: 'project', binder: [{ folder: 'Part one' }] }))[0] as string;
      const ids = folderIds(
        parsedBinder({ spellbook: 'project', binder: [{ folder: 'Part one' }, { folder: 'Other', id: first }] }),
      );
      expect(ids[1]).toBe(first);
      expect(ids[0]).not.toBe(first);
    });
  });
});

describe('serialising', () => {
  it('writes exactly the documented layout', () => {
    expect(serialiseBinder(parsedBinder(example()))).toEqual(example()['binder']);
  });

  it('writes a scene as a plain string and a folder as folder, id, children in that order', () => {
    const out = serialiseBinder([
      { kind: 'scene', path: 'Manuscript/a.md' },
      { kind: 'folder', id: 'f-1', name: 'F', children: [] },
    ]);
    expect(out[0]).toBe('Manuscript/a.md');
    expect(Object.keys(out[1] as object)).toEqual(['folder', 'id', 'children']);
    expect(out[1]).toEqual({ folder: 'F', id: 'f-1', children: [] });
  });

  it('round-trips a binder through parse and serialise without loss', () => {
    const raw = [
      'Manuscript/פתיחה.md',
      {
        folder: 'חלק ראשון',
        id: 'f-aaa111',
        children: ['Manuscript/a.md', { folder: 'Inner: with colon', id: 'f-bbb222', children: [] }],
      },
      'Manuscript/夜行列車.md',
    ];
    const once = serialiseBinder(parsedBinder({ spellbook: 'project', binder: raw }));
    expect(once).toEqual(raw);
    const twice = serialiseBinder(parsedBinder({ spellbook: 'project', binder: once }));
    expect(twice).toEqual(once);
  });

  it('keeps unknown keys on a folder', () => {
    const raw = [{ folder: 'F', id: 'f-1', children: ['a.md'], colour: 'red', collapsed: true, nested: { x: [1, 2] } }];
    const out = serialiseBinder(parsedBinder({ spellbook: 'project', binder: raw }));
    expect(out).toEqual(raw);
  });
});

describe('writeBinder', () => {
  it('replaces only the binder and leaves every other key, known or not, exactly as it was', () => {
    const frontmatter: Frontmatter = {
      aliases: ['MN'],
      spellbook: 'project',
      version: 1,
      title: 'My Novel',
      targets: { draft: 80000, deadline: '2027-01-01' },
      binder: ['Manuscript/Opening.md'],
      timelines: [{ name: 'Main', colour: 'blue' }],
      tags: ['novel'],
      'custom key': null,
    };
    const before = structuredClone(frontmatter);
    const binder = parsedBinder(frontmatter);
    writeBinder(frontmatter, [...binder, { kind: 'scene', path: 'Manuscript/Two.md' }]);

    expect(frontmatter['binder']).toEqual(['Manuscript/Opening.md', 'Manuscript/Two.md']);
    expect(Object.keys(frontmatter)).toEqual(Object.keys(before)); // same keys, same order
    for (const key of Object.keys(before)) {
      if (key !== 'binder') expect(frontmatter[key]).toEqual(before[key]);
    }
  });

  it('adds a binder to an index that had none, without touching the rest', () => {
    const frontmatter: Frontmatter = { spellbook: 'project', mood: 'grim' };
    writeBinder(frontmatter, [{ kind: 'scene', path: 'a.md' }]);
    expect(frontmatter).toEqual({ spellbook: 'project', mood: 'grim', binder: ['a.md'] });
  });
});

describe('newIndexFrontmatter', () => {
  it('is a valid, empty project index', () => {
    const frontmatter = newIndexFrontmatter('My Novel');
    expect(frontmatter).toEqual({ spellbook: 'project', version: 1, title: 'My Novel', binder: [] });
    expect(Object.keys(frontmatter)).toEqual(['spellbook', 'version', 'title', 'binder']);
    expect(isProjectIndex(frontmatter)).toBe(true);
    expect(parseProjectIndex(frontmatter)).toEqual({ ok: true, title: 'My Novel', binder: [], notes: [] });
  });
});
