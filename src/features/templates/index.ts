// Templates: saving a scene, an entry of the World or the shape of a whole
// project as a template, and the list of templates in the settings.
//
// Using a template happens elsewhere, where things are made: "Create
// project" offers the starting structures and the project templates; "New
// scene" and "New character" (and the other types) offer the project's
// templates when it has any. Those read and fill the templates through
// src/core/templates and the project store.
//
// This file plugs the saving into the plugin: three commands and a settings
// section, all registered through the plugin, so Obsidian takes them away
// again when the plugin is switched off.

import { Notice } from 'obsidian';
import { noteTitle } from '../../core/paths';
import { TextPromptModal } from '../../ui/textPromptModal';
import type { Feature, FeatureContext } from '../registry';
import { SaveProjectTemplateModal } from './projectModal';
import { entryOf, saveProjectTemplate, saveSceneTemplate, saveWorldTemplate, sceneOf } from './saving';
import type { Saved } from './saving';
import { templatesSettings } from './settings';

export { SaveProjectTemplateModal } from './projectModal';
export * from './saving';
export { TEMPLATES_SECTION_ID, TEMPLATES_SECTION_TITLE, templatesSettings } from './settings';

/** The commands this feature adds. Obsidian puts the plugin's name in front of each name. */
export const TEMPLATES_COMMANDS = {
  saveScene: { id: 'save-scene-as-template', name: 'Save scene as template' },
  saveWorld: { id: 'save-as-world-template', name: 'Save as World template' },
  saveProject: { id: 'save-project-as-template', name: 'Save project as template' },
} as const;

/** Ask for a template's name, starting from the note's own, and save it. */
function askName(context: FeatureContext, title: string, current: string, save: (typed: string) => Promise<Saved>): void {
  new TextPromptModal(context.app, {
    title,
    label: 'Name of the template',
    placeholder: 'Name of the template',
    value: current,
    confirm: 'Save',
    submit: async (typed) => {
      const saved = await save(typed);
      if ('problem' in saved) return saved.problem;
      new Notice(`Saved the template "${saved.name}" in "${saved.path.split('/').slice(0, -1).join('/')}".`);
      return null;
    },
  }).open();
}

export const templatesFeature: Feature = {
  id: 'templates',
  register(context: FeatureContext): void {
    const { app, plugin, store } = context;
    let released = false;
    context.onUnload(() => {
      released = true;
    });
    const activePath = (): string | null => app.workspace.getActiveFile()?.path ?? null;

    plugin.addCommand({
      ...TEMPLATES_COMMANDS.saveScene,
      checkCallback: (checking) => {
        const project = store.project;
        const active = activePath();
        const scene = project && active !== null ? sceneOf(project, active) : null;
        if (released || scene === null) return false;
        if (!checking) {
          askName(context, TEMPLATES_COMMANDS.saveScene.name, noteTitle(scene), (typed) => saveSceneTemplate(context, scene, typed));
        }
        return true;
      },
    });

    plugin.addCommand({
      ...TEMPLATES_COMMANDS.saveWorld,
      checkCallback: (checking) => {
        const project = store.project;
        const active = activePath();
        const entry = project && active !== null ? entryOf(project, active) : null;
        if (released || entry === null) return false;
        if (!checking) {
          askName(context, TEMPLATES_COMMANDS.saveWorld.name, noteTitle(entry), (typed) => saveWorldTemplate(context, entry, typed));
        }
        return true;
      },
    });

    plugin.addCommand({
      ...TEMPLATES_COMMANDS.saveProject,
      checkCallback: (checking) => {
        const project = store.project;
        if (released || !project) return false;
        if (!checking) {
          new SaveProjectTemplateModal(app, project.title, async (choice) => {
            const saved = await saveProjectTemplate(context, choice);
            if ('problem' in saved) return saved.problem;
            new Notice(`Saved the project template "${saved.name}". "Create project" offers it from now on.`);
            return null;
          }).open();
        }
        return true;
      },
    });

    context.addSettingsSection(templatesSettings(context));
  },
};
