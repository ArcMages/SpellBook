// The writing modes: Zen, Letter box, Typewriter and Hemingway. Each is a
// switch with a command of its own, and each works in any note, not only in
// the scenes of a project.
//
//   Zen         hides the interface around the note
//   Letter box  covers the page but for a band of lines
//   Typewriter  keeps the line being written at one height
//   Hemingway   refuses deleting, so that a draft only moves forward
//
// The parts, each in a file of its own in this folder:
//   controller.ts      which modes are on, and everything that follows
//   chrome.ts          what is shown and hidden around the editors
//   extensions.ts      what is put into the editors
//   editorFrame.ts     Letter box and Typewriter in one editor
//   hemingwayGuard.ts  Hemingway in the editors
//   prefs.ts           what this device remembers
//   settings.ts        the "Writing modes" part of the settings tab
//
// Every decision (what counts as deleting, where the band and the resting
// line are) is the engine's, in src/core/modes.
//
// This file plugs it all into the plugin. The commands are registered
// through the plugin, so Obsidian takes them away again when the plugin is
// switched off; everything else is let go of by hand, and leaves no trace.

import { Platform } from 'obsidian';
import { MODES, MODES_SERVICE, MODE_IDS } from '../../core/modes/index';
import type { ModesService } from '../../core/modes/index';
import type { Feature, FeatureContext } from '../registry';
import { ModesController } from './controller';
import { modesSettings } from './settings';

export { MODES, MODES_SERVICE, MODE_IDS } from '../../core/modes/index';
export type { ModeId, ModeState, ModesService } from '../../core/modes/index';
export { ModesController } from './controller';

export const modesFeature: Feature = {
  id: 'modes',
  register(context: FeatureContext): void {
    const controller = new ModesController(context, {
      mobile: Platform.isMobile,
      phone: Platform.isPhone,
      ios: Platform.isIosApp === true,
    });
    context.onUnload(() => {
      controller.release();
    });

    for (const id of MODE_IDS) {
      context.plugin.addCommand({
        ...MODES[id].command,
        callback: () => {
          controller.toggle(id);
        },
      });
    }
    context.addSettingsSection(modesSettings(controller));
    // For a screen that shows the modes or switches them, such as a bar with buttons.
    context.services.provide<ModesService>(MODES_SERVICE, controller);
    controller.start();
  },
};
