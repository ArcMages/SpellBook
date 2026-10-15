// The welcome for new writers: the welcome page, a short tour of the screen,
// the "What is new" note after an update, and the Help pane.
//
// When Spellbook starts it waits until the vault has been quiet for a moment
// (a phone may still be reading it), then decides (src/core/welcome/firstRun.ts):
//   - the welcome page opens once per device, the first time Spellbook runs
//     there, and never on a device whose vault already holds a project;
//   - the "What is new" note shows once after an update, unless the writer
//     turned it off.
// What it remembers is kept on the device (prefs.ts). It writes nothing in
// the vault, reads nothing outside it and fetches nothing: the changelog and
// the help texts are bundled in the plugin (bundledText.ts).

import { Notice, Platform } from 'obsidian';
import { isTouchLayout } from '../../ui/layout';
import type { Modal } from 'obsidian';
import {
  COMMANDS_SERVICE,
  LONGEST_WAIT_MS,
  commandHelp,
  hasProjectShape,
  notesBetween,
  parseChangelog,
  parseCommandTable,
  parseTutorialSteps,
  planStart,
  quietBeforeDeciding,
} from '../../core/welcome/index';
import type { ChangelogEntry, CommandsService } from '../../core/welcome/index';
import type { Feature, FeatureContext } from '../registry';
import { CHANGELOG_TEXT, COMMANDS_TEXT, TUTORIAL_CONTENTS_TEXT } from './bundledText';
import { HelpView } from './helpView';
import type { HelpHost } from './helpView';
import { PaneOpener } from './panes';
import { WelcomePrefs } from './prefs';
import { welcomeSettings } from './settings';
import {
  CREATE_COMMAND,
  HELP_VIEW_TYPE,
  OPEN_BINDER_COMMAND,
  OPEN_INSPECTOR_COMMAND,
  SAMPLE_COMMAND,
  TOUR_STOPS,
  WELCOME_COMMANDS,
  WELCOME_VIEW_TYPE,
} from './texts';
import { Tour, pageScreen } from './tour';
import { WelcomeView } from './welcomeView';
import type { WelcomeHost } from './welcomeView';
import { WhatsNewModal } from './whatsNewModal';

export { CHANGELOG_TEXT, COMMANDS_TEXT, TUTORIAL_CONTENTS_TEXT } from './bundledText';
export { HelpView } from './helpView';
export type { HelpHost } from './helpView';
export { LAST_VERSION_KEY, WELCOME_SEEN_KEY, WHATS_NEW_KEY, WelcomePrefs } from './prefs';
export { welcomeSettings } from './settings';
export * from './texts';
export { DRAWER_SETTLE_MS, Tour, pageScreen } from './tour';
export type { TourScreen } from './tour';
export { WelcomeView } from './welcomeView';
export type { WelcomeHost } from './welcomeView';
export { WhatsNewModal } from './whatsNewModal';

export const STILL_STARTING_TEXT = 'Spellbook is still starting. Try again in a moment.';

/** How long the sidebars are given to open before the tour looks for them, in milliseconds. */
const SIDEBARS_SETTLE_MS = 400;

export const welcomeFeature: Feature = {
  id: 'welcome',
  register(context: FeatureContext): void {
    const { app, plugin, store, vault, clock } = context;
    const prefs = new WelcomePrefs(context.storage);
    const welcomePane = new PaneOpener(app, WELCOME_VIEW_TYPE);
    const helpPane = new PaneOpener(app, HELP_VIEW_TYPE);
    const manifestVersion: unknown = (plugin.manifest as { version?: unknown } | undefined)?.version;
    const version = typeof manifestVersion === 'string' && manifestVersion !== '' ? manifestVersion : null;

    let released = false;
    let tour: Tour | null = null;
    let cancelTourTimer: (() => void) | null = null;
    let shown: Modal | null = null;

    let changelog: ChangelogEntry[] | null = null;
    const entries = (): ChangelogEntry[] => (changelog ??= parseChangelog(CHANGELOG_TEXT));
    const commands = (): CommandsService | undefined => context.services.get<CommandsService>(COMMANDS_SERVICE);
    const run = (id: string): boolean => {
      const ran = commands()?.run(id) === true;
      if (!ran && !released) new Notice(STILL_STARTING_TEXT);
      return ran;
    };

    const showWhatsNew = (notes: readonly ChangelogEntry[]): void => {
      if (released || version === null) return;
      shown?.close();
      const modal = new WhatsNewModal(app, notes, version);
      shown = modal;
      modal.open();
    };

    const startTour = (): void => {
      if (released) return;
      tour?.end();
      cancelTourTimer?.();
      // Open the binder and the inspector, so that there is something to
      // point at. On a phone they open in the sidebar drawers, and the tour
      // slides each drawer out in turn and away again.
      commands()?.run(OPEN_BINDER_COMMAND);
      commands()?.run(OPEN_INSPECTOR_COMMAND);
      cancelTourTimer = clock.setTimer(
        () => {
          cancelTourTimer = null;
          if (released || typeof activeDocument === 'undefined') return;
          // The phone's own stops (its sliding sidebars, no bottom bar) go by
          // what the device is; the size of the buttons by the layout setting.
          const screen = pageScreen(activeDocument, Platform.isPhone, isTouchLayout(), app.workspace);
          const started = new Tour(screen, TOUR_STOPS, () => {
            if (tour === started) tour = null;
          });
          tour = started;
          started.start();
        },
        SIDEBARS_SETTLE_MS,
      );
    };

    const welcomeHost: WelcomeHost = {
      choose: (choice) => {
        if (choice === 'sample') run(SAMPLE_COMMAND);
        else if (choice === 'create') run(CREATE_COMMAND);
        else void helpPane.reveal();
      },
      startTour,
      openHelp: () => {
        void helpPane.reveal();
      },
    };

    let descriptions: Map<string, string> | null = null;
    const helpHost: HelpHost = {
      commands: () => {
        const service = commands();
        if (!service) return null;
        descriptions ??= parseCommandTable(COMMANDS_TEXT);
        return commandHelp(service.list(), descriptions);
      },
      steps: () => parseTutorialSteps(TUTORIAL_CONTENTS_TEXT),
      openWelcome: () => {
        void welcomePane.reveal();
      },
      copy: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      },
    };

    plugin.registerView(WELCOME_VIEW_TYPE, (leaf) => new WelcomeView(leaf, welcomeHost));
    plugin.registerView(HELP_VIEW_TYPE, (leaf) => new HelpView(leaf, helpHost));
    plugin.addCommand({
      ...WELCOME_COMMANDS.openWelcome,
      callback: () => {
        void welcomePane.reveal();
      },
    });
    plugin.addCommand({
      ...WELCOME_COMMANDS.help,
      callback: () => {
        void helpPane.reveal();
      },
    });
    plugin.addCommand({
      ...WELCOME_COMMANDS.tour,
      callback: startTour,
    });
    plugin.addCommand({
      ...WELCOME_COMMANDS.whatsNew,
      callback: () => {
        if (version !== null) showWhatsNew(notesBetween(entries(), null, version));
      },
    });
    context.addSettingsSection(
      welcomeSettings(prefs, () => {
        void welcomePane.reveal();
      }),
    );

    // ------------------------------------------------------------ first run
    // Decide once the vault has been quiet for a moment: while Obsidian is
    // still reading it (on a phone above all) its projects are not all known.
    let decided = false;
    let cancelQuiet: (() => void) | null = null;
    let cancelLongest: (() => void) | null = null;
    let stopWatching: (() => void) | null = null;
    const stopWaiting = (): void => {
      cancelQuiet?.();
      cancelLongest?.();
      stopWatching?.();
      cancelQuiet = cancelLongest = stopWatching = null;
    };
    const decide = (): void => {
      if (decided || released) return;
      decided = true;
      stopWaiting();
      try {
        const hasProjects =
          store.listProjects().length > 0 || hasProjectShape(vault.listFolders(), (folder) => vault.listFiles(folder));
        const plan = planStart(
          {
            welcomeSeen: prefs.welcomeSeen,
            hasProjects,
            storedVersion: prefs.lastVersion,
            currentVersion: version ?? '',
            whatsNewOn: prefs.whatsNewOn,
          },
          version === null ? [] : entries(),
        );
        if (plan.welcome !== 'none') prefs.markWelcomeSeen();
        if (plan.welcome === 'show') void welcomePane.reveal();
        if (version !== null && plan.saveVersion !== null) prefs.lastVersion = plan.saveVersion;
        if (plan.whatsNew.length > 0) showWhatsNew(plan.whatsNew);
      } catch (error) {
        console.error('Spellbook: the welcome could not decide what to show', error);
      }
    };
    // How slow the device is to start: what it is, not the layout setting.
    const quiet = quietBeforeDeciding(Platform.isMobile);
    const waitForQuiet = (): void => {
      if (decided || released) return;
      cancelQuiet?.();
      cancelQuiet = clock.setTimer(decide, quiet);
    };
    stopWatching = vault.on(() => {
      waitForQuiet();
    });
    cancelLongest = clock.setTimer(decide, LONGEST_WAIT_MS);
    waitForQuiet();

    context.onUnload(() => {
      released = true;
      stopWaiting();
      cancelTourTimer?.();
      cancelTourTimer = null;
      tour?.end();
      tour = null;
      shown?.close();
      shown = null;
      welcomePane.release();
      helpPane.release();
      prefs.release();
    });
  },
};
