import { PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import type { ProjectStore } from './core/projectStore';

/** What the settings tab needs from the plugin. */
export type SettingsHost = Plugin & {
  /** The project store, or null until Obsidian has finished starting up. */
  readonly store: ProjectStore | null;
};

/**
 * Settings tab. It has no options yet: it shows which build is installed and
 * the Spellbook projects found in this vault. The list follows the vault while
 * the tab is open.
 *
 * It renders through display(), which every supported Obsidian version calls
 * (the declarative settings API only exists from 1.13.0).
 */
export class SpellbookSettingTab extends PluginSettingTab {
  private readonly plugin: SettingsHost;
  private stopWatching: (() => void) | null = null;

  constructor(app: App, plugin: SettingsHost) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    this.stopWatching?.();
    this.stopWatching =
      this.plugin.store?.onChange((change) => {
        if (change.type === 'projects') this.render();
      }) ?? null;
    this.render();
  }

  override hide(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    super.hide();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();

    const { name, version } = this.plugin.manifest;
    new Setting(containerEl).setName(name).setDesc(`Version ${version}`);

    new Setting(containerEl).setName('Projects in this vault').setHeading();
    const store = this.plugin.store;
    if (!store) {
      new Setting(containerEl).setDesc('Spellbook is still starting. Close and reopen the settings in a moment.');
      return;
    }
    const projects = store.listProjects();
    if (projects.length === 0) {
      new Setting(containerEl).setDesc(
        'No projects yet. Open the command palette and run "Spellbook: Create project", ' +
          'or "Spellbook: Create sample project" to get a ready-made novel to try things on.',
      );
      return;
    }
    for (const project of projects) {
      const row = new Setting(containerEl)
        .setName(project.title)
        .setDesc(project.folder === '' ? 'At the top of the vault' : project.folder);
      // Titles and folder names are the writer's own text, in any language.
      row.nameEl.setAttr('dir', 'auto');
      row.descEl.setAttr('dir', 'auto');
    }
  }
}
