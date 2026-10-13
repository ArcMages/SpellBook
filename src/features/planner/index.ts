// The planner: the project's to-dos (kept in To-do.md) and the calendar,
// which shows the words written each day, the to-dos that are due and the
// marks put on days.
//
// Not built yet. Everything this feature needs goes into this folder (and
// its stylesheet, src/styles/planner.css); nothing outside it has to change.

import type { Feature, FeatureContext } from '../registry';

export const plannerFeature: Feature = {
  id: 'planner',
  register(_context: FeatureContext): void {
    // Nothing to register yet.
  },
};
