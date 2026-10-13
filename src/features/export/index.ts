// The export: the manuscript of the open project as one file, a Word
// document, a web page or a Markdown note, with the scenes in binder order
// and the scenes whose "compile" switch is off left out.
//
// This file plugs it into the plugin: it adds the command that opens the
// export window. The window asks the exporter (exporter.ts), which reads the
// scenes and saves the new file through the project store. The command is
// registered through the plugin, so Obsidian takes it away again when the
// plugin is switched off; a window that is still open then is closed by hand.

import { Notice } from 'obsidian';
import type { Feature, FeatureContext } from '../registry';
import { ExportModal, PROBLEM_NOTICE_MS } from './exportModal';
import { Exporter, NO_PROJECT_TEXT } from './exporter';

export { ExportModal } from './exportModal';
export { Exporter } from './exporter';
export type { ExportCount, ExportOutcome, ExportProject } from './exporter';

/** The command this feature adds. Obsidian puts the plugin's name in front of its name. */
export const EXPORT_COMMANDS = {
  exportManuscript: { id: 'export-manuscript', name: 'Export manuscript' },
} as const;

export const exportFeature: Feature = {
  id: 'export',
  register(context: FeatureContext): void {
    const { app, plugin } = context;
    const exporter = new Exporter(context);
    let shown: ExportModal | null = null;
    let released = false;
    context.onUnload(() => {
      released = true;
      shown?.close();
      shown = null;
    });

    plugin.addCommand({
      ...EXPORT_COMMANDS.exportManuscript,
      callback: () => {
        if (released) return;
        const project = exporter.project();
        if (!project) {
          new Notice(NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
          return;
        }
        // One window at a time: asking again brings a fresh one.
        shown?.close();
        shown = new ExportModal(app, exporter, project);
        shown.open();
      },
    });
  },
};
