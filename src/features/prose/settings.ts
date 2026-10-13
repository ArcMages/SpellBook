// The "Prose checks" part of the settings tab: the same switches as the
// commands, the two thresholds, and the writer's own filler words. All of it
// is kept on this device only.

import { Setting } from 'obsidian';
import {
  LONG_SENTENCE,
  PROSE_CHECKS,
  REPEAT_DISTANCE,
  clampWhole,
  fillerWords,
  withCheck,
  withMaster,
} from '../../core/prose/index';
import type { ProseCheck } from '../../core/prose/index';
import type { SettingsSection } from '../registry';
import type { ProseChoices } from './choices';

/** What each check is called, in the settings and in the notices. */
export const CHECK_NAMES: Record<ProseCheck, string> = {
  nouns: 'Colour nouns',
  verbs: 'Colour verbs',
  adjectives: 'Colour adjectives',
  adverbs: 'Colour adverbs',
  filler: 'Filler words',
  passive: 'Passive voice',
  repeated: 'Repeated words',
  'overused-adverbs': 'Overused adverbs',
  rhythm: 'Sentence rhythm',
};

const ENGLISH_ONLY = 'English only.';

export const CHECK_NOTES: Record<ProseCheck, string> = {
  nouns: `Names of things and people. ${ENGLISH_ONLY} A best guess from word lists and endings: right for most words, not all.`,
  verbs: `Doing words, with "was", "had" and "could". ${ENGLISH_ONLY}`,
  adjectives: `Describing words. ${ENGLISH_ONLY}`,
  adverbs: `Words like "slowly", "never", "again". ${ENGLISH_ONLY}`,
  filler: 'Words that often carry no weight, such as "very" and "just". English and Hebrew; add your own below.',
  passive: `"The door was opened" rather than "she opened the door". ${ENGLISH_ONLY}`,
  repeated: 'The same word used again close by. English and Hebrew; in Hebrew a word counts as the same with or without the letters attached to its front.',
  'overused-adverbs': `Three or more "-ly" adverbs close together. ${ENGLISH_ONLY}`,
  rhythm: 'Very long sentences, and four or more sentences in a row of nearly the same length. English and Hebrew.',
};

export const MASTER_NAME = 'Prose checks';
export const DISTANCE_NAME = 'Repeated words: how close';
export const LONG_NAME = 'Sentence rhythm: a long sentence';
export const FILLERS_ENGLISH_NAME = 'Your own filler words (English)';
export const FILLERS_HEBREW_NAME = 'Your own filler words (Hebrew)';

/** The "Prose checks" part of the plugin's settings tab. */
export function proseSettings(choices: ProseChoices): SettingsSection {
  return {
    id: 'prose',
    title: 'Prose checks',
    render(containerEl: HTMLElement): void {
      const draw = (): void => {
        containerEl.empty();
        const prefs = choices.prefs;

        new Setting(containerEl)
          .setName(MASTER_NAME)
          .setDesc(
            'Marks in the editor that point at things worth a second look. They only change how the text looks, never the text itself, ' +
              'and they show in notes that belong to a Spellbook project. Point at a mark, or tap it, to see what it is. ' +
              'These choices are kept on this device only.',
          )
          .addToggle((toggle) => {
            toggle.setValue(prefs.on).onChange((value) => {
              choices.set(withMaster(choices.prefs, value));
              draw();
            });
          });

        for (const check of PROSE_CHECKS) {
          new Setting(containerEl)
            .setName(CHECK_NAMES[check])
            .setDesc(CHECK_NOTES[check])
            .addToggle((toggle) => {
              toggle.setValue(prefs.checks.includes(check)).onChange((value) => {
                choices.set(withCheck(choices.prefs, check, value));
                draw();
              });
            });
        }

        new Setting(containerEl)
          .setName(DISTANCE_NAME)
          .setDesc(`A word used again within this many words is marked (${REPEAT_DISTANCE.min} to ${REPEAT_DISTANCE.max}).`)
          .addText((text) => {
            text.setValue(String(prefs.distance)).onChange((value) => {
              const now = choices.prefs;
              choices.set({ ...now, distance: clampWhole(value, REPEAT_DISTANCE, now.distance) });
            });
            text.inputEl.setAttr('inputmode', 'numeric');
          });

        new Setting(containerEl)
          .setName(LONG_NAME)
          .setDesc(`A sentence of this many words or more is marked as long (${LONG_SENTENCE.min} to ${LONG_SENTENCE.max}).`)
          .addText((text) => {
            text.setValue(String(prefs.longSentence)).onChange((value) => {
              const now = choices.prefs;
              choices.set({ ...now, longSentence: clampWhole(value, LONG_SENTENCE, now.longSentence) });
            });
            text.inputEl.setAttr('inputmode', 'numeric');
          });

        new Setting(containerEl)
          .setName(FILLERS_ENGLISH_NAME)
          .setDesc('Words or short phrases, with commas between them. They are marked along with the built-in ones.')
          .addText((text) => {
            text
              .setPlaceholder('nevertheless, at any rate')
              .setValue(prefs.fillersEnglish.join(', '))
              .onChange((value) => {
                choices.set({ ...choices.prefs, fillersEnglish: fillerWords(value) });
              });
            text.inputEl.setAttr('dir', 'auto');
          });

        new Setting(containerEl)
          .setName(FILLERS_HEBREW_NAME)
          .setDesc('Hebrew words or short phrases, with commas between them.')
          .addText((text) => {
            text.setValue(prefs.fillersHebrew.join(', ')).onChange((value) => {
              choices.set({ ...choices.prefs, fillersHebrew: fillerWords(value) });
            });
            text.inputEl.setAttr('dir', 'auto');
          });
      };
      draw();
    },
  };
}
