import { Plugin } from 'obsidian';
import { SpellbookSettingTab } from './settings';

/**
 * Spellbook, a novel writer.
 *
 * Plugin entry point. For now it only registers the settings tab; views and
 * commands are added in later phases.
 */
export default class SpellbookPlugin extends Plugin {
  override onload(): void {
    this.addSettingTab(new SpellbookSettingTab(this.app, this));
  }

  override onunload(): void {
    // Nothing to release by hand: everything registered through the Plugin
    // API (the settings tab, and later views, commands and events) is removed
    // by Obsidian when the plugin unloads.
  }
}
