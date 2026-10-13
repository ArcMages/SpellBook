import { PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import type { ProjectStore } from './core/projectStore';
import type { RegisteredFeatures } from './features/registry';

/** What the settings tab needs from the plugin. */
export type SettingsHost = Plugin & {
  /** The project store, or null until Obsidian has finished starting up. */
  readonly store: ProjectStore | null;
  /** The screens that plugged themselves in, with their settings sections; null until Obsidian has finished starting up. */
  readonly features: Pick<RegisteredFeatures, 'settingsSections'> | null;
};

/**
 * Settings tab. It shows which build is installed and the Spellbook projects
 * found in this vault, followed by one section for every feature that added
 * one (see addSettingsSection in src/features/registry.ts). The list of
 * projects follows the vault while the tab is open.
 *
 * It renders through display(), which every supported Obsidian version calls
 * (the declarative settings API only exists from 1.13.0).
 */
export class SpellbookSettingTab extends PluginSettingTab {
  private readonly plugin: SettingsHost;
  private stopWatching: (() => void) | null = null;
  /** What the sections that are on show asked to have called when they are taken away. */
  private sectionCleanups: Array<() => void> = [];

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
    this.closeSections();
    super.hide();
  }

  private render(): void {
    const { containerEl } = this;
    this.closeSections();
    containerEl.empty();

    const { name, version } = this.plugin.manifest;
    new Setting(containerEl).setName(name).setDesc(`Version ${version}`);

    new Setting(containerEl).setName('Projects in this vault').setHeading();
    this.renderProjects(containerEl);
    this.renderSections(containerEl);
  }

  private renderProjects(containerEl: HTMLElement): void {
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

  /** One heading and one place of its own for every section a feature added. */
  private renderSections(containerEl: HTMLElement): void {
    for (const section of this.plugin.features?.settingsSections ?? []) {
      new Setting(containerEl).setName(section.title).setHeading();
      const place = containerEl.createDiv({ cls: `spellbook-settings-section spellbook-settings-${section.id}` });
      try {
        const cleanup = section.render(place);
        if (typeof cleanup === 'function') this.sectionCleanups.push(cleanup);
      } catch (error) {
        // One section that fails must not take the rest of the settings with it.
        console.error(`Spellbook: the settings of "${section.id}" could not be shown`, error);
        place.empty();
        new Setting(place).setDesc('These settings could not be shown.');
      }
    }
  }

  private closeSections(): void {
    for (const cleanup of this.sectionCleanups.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        console.error('Spellbook: a settings section could not be closed cleanly', error);
      }
    }
  }
}
