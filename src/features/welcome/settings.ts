// The "Welcome and help" part of the plugin's settings tab.

import { Setting } from 'obsidian';
import type { SettingsSection } from '../registry';
import type { WelcomePrefs } from './prefs';
import { SETTINGS_TITLE, SHOW_WELCOME_BUTTON, SHOW_WELCOME_DESC, SHOW_WELCOME_NAME, WHATS_NEW_DESC, WHATS_NEW_NAME } from './texts';

export function welcomeSettings(prefs: WelcomePrefs, openWelcome: () => void): SettingsSection {
  return {
    id: 'welcome',
    title: SETTINGS_TITLE,
    render(containerEl: HTMLElement): void {
      new Setting(containerEl)
        .setName(SHOW_WELCOME_NAME)
        .setDesc(SHOW_WELCOME_DESC)
        .addButton((button) => {
          button.setButtonText(SHOW_WELCOME_BUTTON).onClick(() => {
            openWelcome();
          });
        });
      new Setting(containerEl)
        .setName(WHATS_NEW_NAME)
        .setDesc(WHATS_NEW_DESC)
        .addToggle((toggle) => {
          toggle.setValue(prefs.whatsNewOn).onChange((on) => {
            prefs.whatsNewOn = on;
          });
        });
    },
  };
}
