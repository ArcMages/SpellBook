// The window behind "Move to folder": a list of the binder's folders (and
// "Top level") to pick one from, which can be narrowed by typing. It is
// Obsidian's own kind of list, the one the quick switcher uses, so it works
// the same with a keyboard, a mouse and a finger.

import { FuzzySuggestModal } from 'obsidian';
import type { App, FuzzyMatch } from 'obsidian';
import type { FolderChoice } from '../core/binderModel';

export class FolderPickerModal extends FuzzySuggestModal<FolderChoice> {
  private readonly choices: readonly FolderChoice[];
  private readonly choose: (choice: FolderChoice) => void;

  /**
   * @param title   what is being moved, shown in the empty text field
   * @param choices the places it can go, in the order to show them
   * @param choose  called with the place that was picked
   */
  constructor(app: App, title: string, choices: readonly FolderChoice[], choose: (choice: FolderChoice) => void) {
    super(app);
    this.choices = choices;
    this.choose = choose;
    this.setPlaceholder(title);
    this.emptyStateText = 'No folder with that name.';
    this.modalEl.addClass('spellbook-folder-picker');
    // Folder names may be in any language.
    this.inputEl.setAttr('dir', 'auto');
  }

  override getItems(): FolderChoice[] {
    return [...this.choices];
  }

  override getItemText(choice: FolderChoice): string {
    return choice.label;
  }

  override renderSuggestion(match: FuzzyMatch<FolderChoice>, el: HTMLElement): void {
    super.renderSuggestion(match, el);
    // A folder's name is the writer's own text: let it pick its direction.
    el.setAttr('dir', 'auto');
  }

  override onChooseItem(choice: FolderChoice): void {
    this.choose(choice);
  }
}
