// The "Colour scheme" part of the plugin's settings tab: one row for every
// scheme, with a small picture of it and a button that puts it on. The same
// choice as the command "Choose colour scheme", and kept in the same place.

import { Setting } from 'obsidian';
import type { SettingsSection } from '../registry';
import type { SchemeKeeper } from './keeper';
import { SCHEME_CHOICES, drawSwatch } from './parts';

export const SETTINGS_TITLE = 'Colour scheme';

/** What stands above the rows. */
export const SETTINGS_INTRO =
  "Colours to write in. A scheme recolours the editor and Spellbook's own screens, on top of whatever Obsidian theme you use; " +
  'your fonts stay as they are. A scheme keeps its own colours whether Obsidian is in light or dark mode, ' +
  'so pick a light one or a dark one as you like. "None" gives everything back to your Obsidian theme. ' +
  'The choice is kept on this device only, so a phone and a computer can each have their own.';

/** On the button of a scheme that is not in use. */
export const USE_TEXT = 'Use';
/** On the button of the scheme that is in use. */
export const USED_TEXT = 'In use';

/**
 * @param closed called when the rows are taken away (the settings close, or are drawn anew)
 */
export function schemesSettings(keeper: SchemeKeeper, closed: () => void = () => undefined): SettingsSection {
  return {
    id: 'schemes',
    title: SETTINGS_TITLE,
    render(containerEl: HTMLElement): () => void {
      const draw = (): void => {
        containerEl.empty();
        new Setting(containerEl).setDesc(SETTINGS_INTRO);
        const current = keeper.scheme?.id ?? null;
        for (const choice of SCHEME_CHOICES) {
          const inUse = (choice.scheme?.id ?? null) === current;
          const row = new Setting(containerEl).setName(choice.name).setDesc(choice.description);
          row.settingEl.addClass('spellbook-scheme-row');
          if (inUse) row.settingEl.addClass('spellbook-scheme-row-current');
          drawSwatch(row.controlEl, choice.scheme);
          row.addButton((button) => {
            button.setButtonText(inUse ? USED_TEXT : USE_TEXT).setDisabled(inUse);
            if (inUse) button.setCta();
            button.onClick(() => keeper.choose(choice.scheme));
          });
        }
      };
      draw();
      // Also when the scheme is changed from elsewhere (a hotkey) while the settings are open.
      const stop = keeper.onChange(draw);
      return () => {
        stop();
        closed();
      };
    },
  };
}
