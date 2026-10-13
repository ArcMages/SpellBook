// Colour schemes: a short list of palettes to write in, light and dark, that
// recolour the editor and Spellbook's own screens on top of whatever
// Obsidian theme is in use. "None" gives everything back to the theme.
//
// This file plugs them into the plugin: it puts on the scheme this device
// chose the last time, adds the two commands and the part of the settings
// that change it, and takes everything off the page again when the plugin is
// switched off.
//
// A scheme and Obsidian's own light and dark mode: a scheme says of itself
// whether it is light or dark, and keeps its own colours whichever mode
// Obsidian is in. What the writer picks is what the writer sees, always;
// nothing changes by itself when the system goes dark in the evening.
//
// Changing the Obsidian theme takes nothing off: what a scheme sets is on the
// page's body itself. On a phone the page may still lose it without the
// plugin being told, when the app comes back from the background or a window
// of Obsidian's closes. So the scheme is put right again at those two
// moments. The page is never watched for changes: watching the page while
// writing to it is how a plugin freezes the app.

import { Notice } from 'obsidian';
import type { Feature, FeatureContext } from '../registry';
import { SchemeKeeper } from './keeper';
import { SCHEME_NOTICE_MS, schemeNoticeText } from './parts';
import { SchemePickerModal } from './picker';
import { schemesSettings } from './settings';
import { SchemeWearer, bodySurface } from './wearer';

export { SCHEME_KEY, SchemeKeeper } from './keeper';
export { SchemePickerModal } from './picker';
export { SchemeWearer } from './wearer';

/** The commands this feature adds. Obsidian puts the plugin's name in front of their names. */
export const SCHEME_COMMANDS = {
  choose: { id: 'choose-colour-scheme', name: 'Choose colour scheme' },
  next: { id: 'next-colour-scheme', name: 'Next colour scheme' },
} as const;

export const schemesFeature: Feature = {
  id: 'schemes',
  register(context: FeatureContext): void {
    const { app, plugin, clock } = context;
    const page = app.workspace.containerEl.ownerDocument;
    const keeper = new SchemeKeeper(context.storage, new SchemeWearer(bodySurface(page.body)));
    context.onUnload(() => keeper.release());
    keeper.start();

    const settle = (): void => keeper.settle();
    /** After a window of Obsidian's has closed: once it is gone, and once more when the page has been drawn. */
    const settleSoon = (): void => {
      clock.setTimer(settle, 0);
      clock.nextFrame(settle);
    };
    plugin.registerDomEvent(page, 'visibilitychange', () => {
      if (page.visibilityState !== 'hidden') settle();
    });

    plugin.addCommand({
      ...SCHEME_COMMANDS.choose,
      callback: () => {
        new SchemePickerModal(app, {
          current: keeper.scheme,
          choose: (scheme) => keeper.choose(scheme),
          closed: settleSoon,
        }).open();
      },
    });
    plugin.addCommand({
      ...SCHEME_COMMANDS.next,
      callback: () => {
        new Notice(schemeNoticeText(keeper.chooseNext()), SCHEME_NOTICE_MS);
      },
    });
    context.addSettingsSection(schemesSettings(keeper, settleSoon));
  },
};
