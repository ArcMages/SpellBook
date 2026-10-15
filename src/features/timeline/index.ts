// The timeline: named, coloured lanes on one time axis, with the events kept
// as notes in the project's Timeline folder.
//
// This file plugs the screen into the plugin: it makes the timeline's host
// (timelineWiring.ts), registers the view with it, and adds the command and
// the ribbon button that open the timeline. Everything the timeline needs is
// in this folder and in its stylesheet, src/styles/timeline.css.

import { Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { STORY_CALENDAR_SERVICE, WORLD_HISTORY_SERVICE } from '../../core/world';
import type { StoryCalendarService, WorldHistoryService } from '../../core/world';
import { iconName } from '../../ui/icons';
import type { Feature, FeatureContext, SettingsSection } from '../registry';
import { TimelineActions } from './timelineActions';
import { TIMELINE_ICONS } from './timelineMenus';
import { readContent } from './timelineScene';
import { TIMELINE_VIEW_TYPE, TimelineView, createTimelineView } from './timelineView';
import { TimelineWiring } from './timelineWiring';
import { PROBLEM_NOTICE_MS } from '../../ui/notices';

export { TIMELINE_VIEW_NAME, TIMELINE_VIEW_TYPE, TimelineView, createTimelineView } from './timelineView';
export { TimelineWiring } from './timelineWiring';
export type { TimelineHost } from './timelineHost';

/** The command's id; Obsidian puts the plugin's own id in front. */
export const OPEN_TIMELINE_COMMAND = 'open-timeline';
/** The command's name; Obsidian puts "Spellbook: " in front. */
export const OPEN_TIMELINE_NAME = 'Open timeline';
/** What the ribbon button says when it is pointed at. */
export const OPEN_TIMELINE_TOOLTIP = 'Open Spellbook timeline';
export const TIMELINE_NOT_OPENED = 'The timeline could not be opened.';
/** The command that opens the window in which the project's story calendar is defined. */
export const EDIT_CALENDAR_COMMAND = 'edit-story-calendar';
export const EDIT_CALENDAR_NAME = 'Edit story calendar';
/** The button that opens the same window, in the settings and in the World browser. */
export const STORY_CALENDAR_TEXT = 'Story calendar';
export const STORY_CALENDAR_SETTING_DESC =
  "The calendar the open project's story dates are counted in: real-world dates, or a calendar of your own with its own months and weekdays. " +
  'It belongs to the project, and is the same on every device.';
/** The command that opens the timeline as the history of the world: the world lanes on, the scenes' lane off. */
export const OPEN_WORLD_HISTORY_COMMAND = 'open-world-history';
export const OPEN_WORLD_HISTORY_NAME = 'Open world history';

/**
 * Show the timeline as a tab in the main area. A timeline that is already
 * open anywhere is brought to the front instead: asking twice never opens two.
 */
async function showTimeline(app: App): Promise<void> {
  const { workspace } = app;
  try {
    let leaf = workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  } catch (error) {
    console.error('Spellbook: the timeline could not be opened', error);
    new Notice(TIMELINE_NOT_OPENED, PROBLEM_NOTICE_MS);
  }
}

/** The timeline's part of the settings tab: a button that opens the Story calendar window. */
export function storyCalendarSettings(open: () => void): SettingsSection {
  return {
    id: 'timeline',
    title: 'Timeline',
    render(containerEl: HTMLElement): void {
      new Setting(containerEl)
        .setName(STORY_CALENDAR_TEXT)
        .setDesc(STORY_CALENDAR_SETTING_DESC)
        .addButton((button) => {
          button.setButtonText(STORY_CALENDAR_TEXT).onClick(open);
        });
    },
  };
}

export const timelineFeature: Feature = {
  id: 'timeline',
  register(context: FeatureContext): void {
    // The host is there before the view type is: Obsidian may put a timeline
    // that was open last time back on the screen the moment the type exists,
    // before any project is open. Until one is, the host has nothing to show.
    const host = new TimelineWiring(context);
    context.onUnload(() => {
      host.release();
    });

    /** The timeline being brought to the front, so that two requests cannot open two. */
    let opening: Promise<void> | null = null;
    const open = (): void => {
      if (host.isReleased) return;
      opening ??= showTimeline(context.app).finally(() => {
        opening = null;
      });
    };

    context.plugin.registerView(TIMELINE_VIEW_TYPE, (leaf) => createTimelineView(leaf, host));
    context.plugin.addCommand({ id: OPEN_TIMELINE_COMMAND, name: OPEN_TIMELINE_NAME, callback: open });

    // The calendar can be edited without the timeline on screen: the window
    // only needs what the host knows of the project at that moment.
    const actions = new TimelineActions(
      host,
      () => {
        const data = host.isReleased ? null : host.getData();
        return data === null ? null : readContent(data);
      },
      () => 'date',
    );
    const askCalendar = (): void => {
      if (!host.isReleased) actions.askCalendar();
    };
    context.plugin.addCommand({ id: EDIT_CALENDAR_COMMAND, name: EDIT_CALENDAR_NAME, callback: askCalendar });
    // The same window from a button in the settings, and from the World browser's toolbar.
    context.addSettingsSection(storyCalendarSettings(askCalendar));
    const calendar: StoryCalendarService = { open: askCalendar };
    context.services.provide(STORY_CALENDAR_SERVICE, calendar);
    context.plugin.addRibbonIcon(iconName(...TIMELINE_ICONS.view) ?? 'calendar', OPEN_TIMELINE_TOOLTIP, open);

    // The world's history: the timeline, with the world lanes on and the
    // scenes' lane off, fitted to the range of the world's dates. The World
    // browser's "History" button asks for it by name.
    const openWorldHistory = (): void => {
      if (host.isReleased) return;
      opening ??= showTimeline(context.app).finally(() => {
        opening = null;
      });
      void opening.then(() => {
        if (host.isReleased) return;
        const view: unknown = context.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)[0]?.view;
        if (view instanceof TimelineView) view.showWorldHistory();
      });
    };
    const history: WorldHistoryService = { show: openWorldHistory };
    context.services.provide(WORLD_HISTORY_SERVICE, history);
    context.plugin.addCommand({ id: OPEN_WORLD_HISTORY_COMMAND, name: OPEN_WORLD_HISTORY_NAME, callback: openWorldHistory });
  },
};
