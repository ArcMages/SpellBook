import { PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin } from 'obsidian';

/**
 * Settings tab stub. It has no options yet: it shows the plugin name and
 * version so the owner can confirm which build is installed.
 *
 * It renders through display(), which every supported Obsidian version calls
 * (the declarative settings API only exists from 1.13.0).
 */
export class SpellbookSettingTab extends PluginSettingTab {
  private readonly plugin: Plugin;

  constructor(app: App, plugin: Plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const { name, version } = this.plugin.manifest;
    new Setting(containerEl).setName(name).setDesc(`Version ${version}`);
  }
}
