// The "Writing modes" part of the plugin's settings tab: what the writer can
// tune about the four modes. Every choice is kept on this device only, and
// the modes that are on follow it at once.

import { Setting } from 'obsidian';
import { ANCHOR_PERCENTS, BAND_PERCENTS, BAND_SHADES } from '../../core/modes/index';
import type { BandShade, ModeSettings } from '../../core/modes/index';
import type { SettingsSection } from '../registry';

export const MODES_SECTION_TITLE = 'Writing modes';

export const MODES_INTRO_TEXT =
  'Zen, Letter box, Typewriter and Hemingway are switched on and off with their commands ' +
  '(for example "Toggle Zen mode"). They work in any note. What is on, and the choices below, are kept on this device only.';

const SHADE_NAMES: Record<BandShade, string> = {
  hidden: 'Hidden',
  faint: 'Barely visible',
  dimmed: 'Dimmed',
};

/** How a resting place reads in the list. */
export function anchorName(percent: number): string {
  if (percent === 50) return 'In the middle';
  return percent < 50 ? `${percent}% from the top` : `${100 - percent}% from the bottom`;
}

/** What the section needs of the modes. */
export interface TunedModes {
  readonly settings: ModeSettings;
  tune(change: Partial<ModeSettings>): void;
}

/** A row with a list to choose from. */
function choiceRow(
  containerEl: HTMLElement,
  name: string,
  description: string,
  choices: ReadonlyArray<readonly [value: string, text: string]>,
  chosen: string,
  onChoose: (value: string) => void,
): void {
  new Setting(containerEl)
    .setName(name)
    .setDesc(description)
    .addDropdown((dropdown) => {
      for (const [value, text] of choices) dropdown.selectEl.createEl('option', { value, text });
      dropdown.setValue(chosen).onChange(onChoose);
    });
}

function switchRow(containerEl: HTMLElement, name: string, description: string, on: boolean, onSwitch: (on: boolean) => void): void {
  new Setting(containerEl)
    .setName(name)
    .setDesc(description)
    .addToggle((toggle) => {
      toggle.setValue(on).onChange(onSwitch);
    });
}

export function modesSettings(modes: TunedModes): SettingsSection {
  return {
    id: 'modes',
    title: MODES_SECTION_TITLE,
    render(containerEl: HTMLElement): void {
      const { settings } = modes;
      containerEl.createEl('p', { cls: 'setting-item-description', text: MODES_INTRO_TEXT });

      choiceRow(
        containerEl,
        'Letter box: height of the band',
        'How much of the page stays lit, as a share of its height. The rest is covered above and below.',
        BAND_PERCENTS.map((percent) => [String(percent), `${percent}%`] as const),
        String(settings.bandPercent),
        (value) => {
          modes.tune({ bandPercent: Number(value) });
        },
      );
      choiceRow(
        containerEl,
        'Letter box: text outside the band',
        'Whether the lines above and below the band can still be made out.',
        BAND_SHADES.map((shade) => [shade, SHADE_NAMES[shade]] as const),
        settings.bandShade,
        (value) => {
          const shade = BAND_SHADES.find((candidate) => candidate === value);
          if (shade) modes.tune({ bandShade: shade });
        },
      );
      choiceRow(
        containerEl,
        'Typewriter: where the line rests',
        'The height at which the line you are writing stays. With an on-screen keyboard, a place above the middle is easier on the eye.',
        ANCHOR_PERCENTS.map((percent) => [String(percent), anchorName(percent)] as const),
        String(settings.anchorPercent),
        (value) => {
          modes.tune({ anchorPercent: Number(value) });
        },
      );
      switchRow(containerEl, 'Zen: hide properties', 'Hide the properties at the top of a note while Zen is on.', settings.zenHideProperties, (on) => {
        modes.tune({ zenHideProperties: on });
      });
      switchRow(containerEl, 'Zen: hide the title', 'Hide the title above the text of a note while Zen is on.', settings.zenHideTitle, (on) => {
        modes.tune({ zenHideTitle: on });
      });
      switchRow(
        containerEl,
        'Zen: leave with Escape',
        'The Escape key leaves Zen. Switch this off if you use Escape for something else while writing.',
        settings.zenEscape,
        (on) => {
          modes.tune({ zenEscape: on });
        },
      );
    },
  };
}
