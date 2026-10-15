import { PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import type { DevicePrefs } from './core/devicePrefs';
import type { LinkScope } from './core/links';
import type { ProjectStore } from './core/projectStore';
import type { RegisteredFeatures } from './features/registry';
import { parseLayoutChoice } from './core/layout';
import type { LayoutChoice } from './core/layout';
import { layoutChoice, setLayoutChoice } from './ui/layout';

/** What the settings tab needs from the plugin. */
export type SettingsHost = Plugin & {
  /** The project store, or null until Obsidian has finished starting up. */
  readonly store: ProjectStore | null;
  /** The screens that plugged themselves in, with their settings sections; null until Obsidian has finished starting up. */
  readonly features: Pick<RegisteredFeatures, 'settingsSections'> | null;
  /** What this device remembers (where the links to a renamed note are updated); null until Obsidian has finished starting up. */
  readonly prefs?: DevicePrefs | null;
};

export const LAYOUT_NAME_TEXT = 'Layout';
export const LAYOUT_DESC_TEXT =
  'How Spellbook\'s screens are laid out on this device. ' +
  '"Automatic" follows the device: the touch layout on phones and tablets, the desktop layout on computers. ' +
  '"Touch layout" gives big buttons and rows for a finger, for example on a touch-screen laptop or a small window. ' +
  '"Desktop layout" gives the full desktop screens, for example on an iPad with a keyboard and trackpad. ' +
  'What the device itself can or cannot do stays as it is: printing is offered on computers only, a phone or tablet keeps the word figures in the inspector, and a phone keeps its sliding sidebars. ' +
  'Open screens change at once. This choice is kept on this device only.';
export const LAYOUT_OPTIONS: Readonly<Record<LayoutChoice, string>> = {
  auto: 'Automatic',
  touch: 'Touch layout',
  desktop: 'Desktop layout',
};

export const LINKS_HEADING_TEXT = 'Renaming';
export const LINK_SCOPE_NAME_TEXT = 'When a note is renamed, update links in';
export const LINK_SCOPE_DESC_TEXT =
  'Spellbook renames scenes, boards and World notes itself and points the links to them at the new name, so Obsidian never stops to ask. ' +
  'With "This project only", notes outside the project folder keep links to the old name, and Spellbook tells you how many. ' +
  'This choice is kept on this device only.';
export const LINK_SCOPE_OPTIONS: Readonly<Record<LinkScope, string>> = {
  project: 'This project only',
  vault: 'The whole vault',
};

/**
 * Settings tab. It shows which build is installed, the layout chosen for this
 * device (see src/ui/layout.ts), and the Spellbook projects
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
    this.renderLayout(containerEl);

    new Setting(containerEl).setName('Projects in this vault').setHeading();
    this.renderProjects(containerEl);
    this.renderLinks(containerEl);
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

  /** Touch or desktop layout on this device. Kept by src/ui/layout.ts, which is there from the start. */
  private renderLayout(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(LAYOUT_NAME_TEXT)
      .setDesc(LAYOUT_DESC_TEXT)
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({ ...LAYOUT_OPTIONS })
          .setValue(layoutChoice())
          .onChange((value) => {
            setLayoutChoice(parseLayoutChoice(value));
          });
      });
  }

  /** Where the links to a note that Spellbook renames are brought up to date. */
  private renderLinks(containerEl: HTMLElement): void {
    const prefs = this.plugin.prefs;
    if (!prefs) return;
    new Setting(containerEl).setName(LINKS_HEADING_TEXT).setHeading();
    new Setting(containerEl)
      .setName(LINK_SCOPE_NAME_TEXT)
      .setDesc(LINK_SCOPE_DESC_TEXT)
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({ ...LINK_SCOPE_OPTIONS })
          .setValue(prefs.getLinkScope())
          .onChange((value) => {
            prefs.setLinkScope(value === 'vault' ? 'vault' : 'project');
          });
      });
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
