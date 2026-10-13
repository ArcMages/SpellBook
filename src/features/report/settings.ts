// The setting of the writing report: how many words go on a page. It is kept
// on this device only, like the other choices of the plugin's screens.
//
// The writer sets it in the report itself, under the number of pages, or in
// the plugin's settings tab, where the same setting is a row of its own
// (reportSettings).

import { Setting } from 'obsidian';
import type { DeviceStorage } from '../../core/devicePrefs';
import { DEFAULT_WORDS_PER_PAGE, MAX_WORDS_PER_PAGE, MIN_WORDS_PER_PAGE, parseWordsPerPage, readWordsPerPage } from '../../core/report';
import type { SettingsSection } from '../registry';

/** Where the words on a page are kept in the device's own storage. */
export const WORDS_PER_PAGE_KEY = 'spellbook-report-words-per-page';

export const WORDS_PER_PAGE_NAME = 'Words on a page';

/** The choices of the writing report that belong to this device. */
export class ReportPrefs {
  private readonly storage: DeviceStorage;
  /** Null until it has been read from the storage. */
  private perPage: number | null = null;
  private readonly listening = new Set<() => void>();

  constructor(storage: DeviceStorage) {
    this.storage = storage;
  }

  /** How many words go on a page. 250 unless the writer chose otherwise. */
  get wordsPerPage(): number {
    if (this.perPage === null) {
      try {
        this.perPage = readWordsPerPage(this.storage.load(WORDS_PER_PAGE_KEY));
      } catch (error) {
        console.error('Spellbook: the settings of this device could not be read', error);
        this.perPage = DEFAULT_WORDS_PER_PAGE;
      }
    }
    return this.perPage;
  }

  /** A number out of bounds, or no number at all, puts the 250 back. */
  set wordsPerPage(value: number) {
    const wanted = readWordsPerPage(value);
    if (this.wordsPerPage === wanted) return;
    this.perPage = wanted;
    try {
      // Nothing is stored for the default.
      this.storage.save(WORDS_PER_PAGE_KEY, wanted === DEFAULT_WORDS_PER_PAGE ? null : String(wanted));
    } catch (error) {
      // The choice then lasts until Obsidian closes.
      console.error('Spellbook: the setting could not be saved on this device', error);
    }
    for (const listener of [...this.listening]) listener();
  }

  /** Be told when a choice changes. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    this.listening.add(listener);
    return () => {
      this.listening.delete(listener);
    };
  }

  /** The plugin is being switched off: nobody is told anything any more. */
  release(): void {
    this.listening.clear();
  }
}

/** The "Writing report" part of the plugin's settings tab. */
export function reportSettings(prefs: ReportPrefs): SettingsSection {
  return {
    id: 'report',
    title: 'Writing report',
    render(containerEl: HTMLElement): void {
      new Setting(containerEl)
        .setName(WORDS_PER_PAGE_NAME)
        .setDesc(
          `What the writing report takes as one page. ${DEFAULT_WORDS_PER_PAGE} is the usual figure for a manuscript; ` +
            `any whole number from ${MIN_WORDS_PER_PAGE} to ${MAX_WORDS_PER_PAGE} will do. This choice is kept on this device only.`,
        )
        .addText((text) => {
          text.inputEl.setAttr('inputmode', 'numeric');
          text
            .setPlaceholder(String(DEFAULT_WORDS_PER_PAGE))
            .setValue(String(prefs.wordsPerPage))
            .onChange((value) => {
              // While a number is being typed it may be out of bounds for a moment: it is taken once it is not.
              const wanted = parseWordsPerPage(value);
              if (wanted !== null) prefs.wordsPerPage = wanted;
            });
        });
    },
  };
}
