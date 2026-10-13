// What the writing progress uses of Obsidian beyond the basics: the switch of
// a settings row, and the field through which an editor says which note it
// shows. Both live in the shared stand-in now (tests/obsidianStub.ts); this
// file only keeps the names the tests of this feature use for them.
//
// The tests still write
//
//   vi.mock('obsidian', async (importOriginal) => {
//     const { withProgressExtras } = await import('./obsidianExtras');
//     return withProgressExtras(await importOriginal());
//   });
//
// which now hands the shared stand-in on as it is.
//
// Nothing here may import the stand-in itself (only its types): this file is
// loaded while the stand-in is being replaced.

type Stub = typeof import('../../obsidianStub');

/** What a stand-in editor knows about the note it shows. */
export type FakeEditorInfo = import('../../obsidianStub').StubEditorInfo;

/** The switch of a settings row. `flip()` is what the writer does. */
export type FakeToggle = import('../../obsidianStub').ToggleComponent;

/** A settings row that can also hold a switch. */
export interface SettingWithToggles {
  readonly toggles: FakeToggle[];
}

export function withProgressExtras(stub: Stub): Record<string, unknown> {
  return { ...stub };
}
