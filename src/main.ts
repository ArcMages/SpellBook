import { Plugin } from 'obsidian';
import { ProjectStore } from './core/projectStore';
import { ObsidianVault } from './obsidian/obsidianVault';
import { localToday, setTimer } from './obsidian/systemClock';
import { SpellbookSettingTab } from './settings';

/**
 * Spellbook, a novel writer.
 *
 * Plugin entry point. It registers the settings tab and starts the project
 * store, which finds the Spellbook projects in the vault. Views and commands
 * are added in later phases; until then nothing here changes any note.
 */
export default class SpellbookPlugin extends Plugin {
  /** The projects in this vault and the one that is open. Views read from here. */
  store!: ProjectStore;

  override onload(): void {
    this.addSettingTab(new SpellbookSettingTab(this.app, this));

    const vault = new ObsidianVault(this.app);
    this.store = new ProjectStore({
      vault,
      today: localToday,
      setTimer,
      random: Math.random,
    });
    this.store.start();
    vault.start();
    this.register(() => {
      this.store.dispose();
      vault.stop();
    });
  }

  override onunload(): void {
    // Nothing to release by hand: everything registered through the Plugin
    // API (the settings tab, the store's clean-up, and later views, commands
    // and events) is removed by Obsidian when the plugin unloads.
  }
}
