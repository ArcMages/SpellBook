// Writing progress: the words typed on this device are counted and kept in
// the project's daily word log (Stats/<month> <device>.md), the bottom bar
// shows the line of figures for the open note, scenes get their "created" and
// "edited" dates, and the writer sets targets for the project, for a day and
// for a scene.
//
// The parts, each in a file of its own in this folder:
//   editorWatch.ts      the one editor extension: it reports what was changed
//   wordLedger.ts       counting when typing pauses, and saving the daily log
//   statsLog.ts         reading every device's log files and adding them up
//   sceneDateKeeper.ts  writing a scene's dates when the writer leaves it
//   statusBar.ts        the bottom bar (a desktop and a tablet have one)
//   targetsModal.ts     the "Set writing targets" window
//   settings.ts         the "Writing progress" part of the settings tab
//   services.ts         what the other screens are offered, and its types
//   writingProgress.ts  all of it put together
//
// Every decision (what counts, when to save, which date to write, how the
// line reads) is the engine's, in src/core/progress.

import type { Feature, FeatureContext } from '../registry';
import { WritingProgress } from './writingProgress';

export { SCENE_LINE_SERVICE, STATS_SERVICE } from './services';
export type { DayWords, SceneLineService, StatsService, StatsSummary } from './services';
export type { StatusSegment, StatusSegmentId } from '../../core/progress/index';

export const progressFeature: Feature = {
  id: 'progress',
  register(context: FeatureContext): void {
    // Everything here hangs on watching the editor. Where the plugin cannot
    // be given a place in it, the feature stays off as a whole, rather than
    // showing a bar and a log that never move.
    const plugin: { registerEditorExtension?: unknown } = context.plugin;
    if (typeof plugin.registerEditorExtension !== 'function') return;
    new WritingProgress(context).start();
  },
};
