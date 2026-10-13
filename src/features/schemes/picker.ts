// The window behind "Choose colour scheme": the list of schemes, each with a
// small picture of itself, to pick one from. It is Obsidian's own kind of
// list, the one the quick switcher uses, so it works the same with a
// keyboard, a mouse and a finger, and can be narrowed by typing.

import { FuzzySuggestModal } from 'obsidian';
import type { App, FuzzyMatch } from 'obsidian';
import type { ColourScheme } from '../../core/schemes';
import { SCHEME_CHOICES, drawSwatch } from './parts';
import type { SchemeChoice } from './parts';

export const PICKER_PLACEHOLDER = 'Choose a colour scheme';
export const PICKER_EMPTY_TEXT = 'No colour scheme with that name.';
/** What is written next to the scheme that is in use. */
export const IN_USE_TEXT = 'In use';

export interface SchemePickerOptions {
  /** The scheme in use when the window opens, or null for "None". */
  readonly current: ColourScheme | null;
  /** Called with the scheme that was picked (null for "None"). */
  readonly choose: (scheme: ColourScheme | null) => void;
  /** Called when the window has closed, picked from or not. */
  readonly closed?: () => void;
}

export class SchemePickerModal extends FuzzySuggestModal<SchemeChoice> {
  private readonly options: SchemePickerOptions;

  constructor(app: App, options: SchemePickerOptions) {
    super(app);
    this.options = options;
    this.setPlaceholder(PICKER_PLACEHOLDER);
    this.emptyStateText = PICKER_EMPTY_TEXT;
    this.modalEl.addClass('spellbook-scheme-picker');
  }

  override getItems(): SchemeChoice[] {
    return [...SCHEME_CHOICES];
  }

  override getItemText(choice: SchemeChoice): string {
    return choice.name;
  }

  override renderSuggestion(match: FuzzyMatch<SchemeChoice>, el: HTMLElement): void {
    const choice = match.item;
    el.addClass('spellbook-scheme-option');
    drawSwatch(el, choice.scheme);
    const words = el.createDiv({ cls: 'spellbook-scheme-option-words' });
    words.createDiv({ cls: 'spellbook-scheme-option-name', text: choice.name });
    words.createDiv({ cls: 'spellbook-scheme-option-note', text: choice.description });
    if ((choice.scheme?.id ?? null) === (this.options.current?.id ?? null)) {
      el.addClass('spellbook-scheme-option-current');
      el.createSpan({ cls: 'spellbook-scheme-option-mark', text: IN_USE_TEXT });
    }
  }

  override onChooseItem(choice: SchemeChoice): void {
    this.options.choose(choice.scheme);
  }

  override onClose(): void {
    super.onClose();
    this.options.closed?.();
  }
}
