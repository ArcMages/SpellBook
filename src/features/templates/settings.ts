// The "Templates" section of the settings: the templates found, each with a
// button that opens its note and one that moves it to the trash (after
// asking). Templates of the open project come first (for scenes, then for
// each type of the World), then the project templates of the vault.

import { Notice, Setting } from 'obsidian';
import { noteTitle } from '../../core/paths';
import { LIBRARY_FOLDER, SCENE_TEMPLATES_FOLDER, WORLD_TEMPLATES_FOLDER, allWorldTemplates, isProjectTemplate, sceneTemplates } from '../../core/templates';
import type { IntentResult } from '../../core/types';
import { ConfirmModal } from '../../ui/confirmModal';
import type { FeatureContext, SettingsSection } from '../registry';
import { PROBLEM_NOTICE_MS } from '../../ui/notices';

export const TEMPLATES_SECTION_ID = 'templates';
export const TEMPLATES_SECTION_TITLE = 'Templates';

export const NO_PROJECT_TEMPLATES_TEXT =
  `This project has no templates yet. Put notes in "${SCENE_TEMPLATES_FOLDER}" or "${WORLD_TEMPLATES_FOLDER}/<type folder>", ` +
  'or run "Save scene as template" or "Save as World template" on an open note.';
export const NO_OPEN_PROJECT_TEXT = 'Open a project to see its templates.';
export const NO_LIBRARY_TEXT = `No project templates yet. Run "Save project as template" to save the shape of the open project in the "${LIBRARY_FOLDER}" folder.`;
export const COULD_NOT_OPEN_TEXT = 'The template could not be opened.';

/** One template, as a row of the section shows it. */
interface Row {
  readonly name: string;
  readonly kind: string;
  /** Vault path, to open it. */
  readonly vaultPath: string | null;
  remove(): Promise<IntentResult>;
}

export function templatesSettings(context: FeatureContext): SettingsSection {
  return {
    id: TEMPLATES_SECTION_ID,
    title: TEMPLATES_SECTION_TITLE,
    render(containerEl: HTMLElement): () => void {
      const draw = (): void => {
        containerEl.empty();
        const { store } = context;
        const project = store.project;

        new Setting(containerEl).setName('In this project').setDesc(project ? '' : NO_OPEN_PROJECT_TEXT);
        if (project) {
          const notes = store.templateNotes();
          const rows: Row[] = [
            ...sceneTemplates(notes).map((entry) => ({
              name: entry.name,
              kind: 'For new scenes',
              vaultPath: store.vaultPathOf(entry.path),
              remove: () => store.trashTemplateNote(entry.path, project.indexPath),
            })),
            ...allWorldTemplates(notes).map((entry) => ({
              name: entry.name,
              kind: `For new entries of the World in "${entry.folder}"`,
              vaultPath: store.vaultPathOf(entry.path),
              remove: () => store.trashTemplateNote(entry.path, project.indexPath),
            })),
          ];
          if (rows.length === 0) new Setting(containerEl).setDesc(NO_PROJECT_TEMPLATES_TEXT);
          for (const row of rows) drawRow(row);
        }

        new Setting(containerEl).setName('For new projects').setDesc(`The project templates in the "${LIBRARY_FOLDER}" folder at the top of the vault.`);
        const library = store.libraryNotes().filter((note) => isProjectTemplate(note.frontmatter));
        if (library.length === 0) new Setting(containerEl).setDesc(NO_LIBRARY_TEXT);
        for (const note of library) {
          drawRow({
            name: noteTitle(note.path),
            kind: 'Offered by "Create project"',
            vaultPath: note.path,
            remove: () => store.trashLibraryTemplate(note.path),
          });
        }
      };

      const drawRow = (row: Row): void => {
        const setting = new Setting(containerEl).setName(row.name).setDesc(row.kind);
        // The name of a template is the writer's own text, in any language.
        setting.nameEl.setAttr('dir', 'auto');
        setting.descEl.setAttr('dir', 'auto');
        setting.settingEl.addClass('spellbook-template-row');
        setting.addButton((button) => {
          button.setButtonText('Open').onClick(() => {
            const path = row.vaultPath;
            void (path === null ? Promise.resolve(false) : context.openNote(path, 'tab')).then((shown) => {
              if (!shown) new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
            });
          });
        });
        setting.addButton((button) => {
          button
            .setButtonText('Delete')
            .setWarning()
            .onClick(() => {
              new ConfirmModal(context.app, {
                title: `Delete the template "${row.name}"?`,
                message:
                  'Its note is moved to the trash (where deleted notes go is set in Obsidian, under Settings, Files and links, Deleted files). ' +
                  'Scenes, entries and projects made from it are not changed.',
                confirm: 'Delete',
                onConfirm: () => {
                  void row.remove().then((result) => {
                    if (result.status === 'done') new Notice(`Moved the template "${row.name}" to the trash.`);
                    else if (result.message !== '') new Notice(result.message, PROBLEM_NOTICE_MS);
                    draw();
                  });
                },
              }).open();
            });
        });
      };

      draw();
      // The list follows the open project while the settings are on show.
      return context.store.onChange((change) => {
        if (change.type === 'project') draw();
      });
    },
  };
}
