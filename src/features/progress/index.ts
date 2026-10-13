// Writing progress: the line of word counts for the open scene (a bottom bar
// on a desktop), the session and project totals, and the daily word log kept
// in the project's Stats folder.
//
// Not built yet. Everything this feature needs goes into this folder (and
// its stylesheet, src/styles/progress.css); nothing outside it has to change.

import type { Feature, FeatureContext } from '../registry';

export const progressFeature: Feature = {
  id: 'progress',
  register(_context: FeatureContext): void {
    // Nothing to register yet.
  },
};
