// What the writing progress uses of Obsidian that the shared stand-in
// (tests/obsidianStub.ts) does not have: the switch of a settings row, and the
// field through which an editor says which note it shows.
//
// The shared stand-in is left as it is. A test of this feature lays these on
// top of it for itself:
//
//   vi.mock('obsidian', async (importOriginal) => {
//     const { withProgressExtras } = await import('./obsidianExtras');
//     return withProgressExtras(await importOriginal());
//   });
//
// Nothing here may import the stand-in itself: this file is loaded while the
// stand-in is being replaced.

import { StateField } from '@codemirror/state';

type Stub = typeof import('../../obsidianStub');

/** What a stand-in editor knows about the note it shows. */
export interface FakeEditorInfo {
  file: { path: string } | null;
}

/** The switch of a settings row. `flip()` is what the writer does. */
export interface FakeToggle {
  setValue(value: boolean): FakeToggle;
  getValue(): boolean;
  onChange(callback: (value: boolean) => unknown): FakeToggle;
  flip(): void;
}

/** A settings row that can also hold a switch. */
export interface SettingWithToggles {
  readonly toggles: FakeToggle[];
}

export function withProgressExtras(stub: Stub): Record<string, unknown> {
  class ToggleComponent implements FakeToggle {
    readonly toggleEl = new stub.FakeElement('div');
    private value = false;
    private changed: ((value: boolean) => unknown) | null = null;

    setValue(value: boolean): this {
      this.value = value;
      return this;
    }

    getValue(): boolean {
      return this.value;
    }

    onChange(callback: (value: boolean) => unknown): this {
      this.changed = callback;
      return this;
    }

    flip(): void {
      this.value = !this.value;
      this.changed?.(this.value);
    }
  }

  class Setting extends stub.Setting implements SettingWithToggles {
    readonly toggles: FakeToggle[] = [];

    addToggle(callback: (component: FakeToggle) => unknown): this {
      const component = new ToggleComponent();
      this.toggles.push(component);
      callback(component);
      return this;
    }
  }

  // As in Obsidian: every markdown editor carries this field, and it says which note the editor shows.
  const editorInfoField = StateField.define<FakeEditorInfo>({
    create: () => ({ file: null }),
    update: (value) => value,
  });

  return { ...stub, Setting, ToggleComponent, editorInfoField };
}
