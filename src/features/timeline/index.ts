// The timeline: named, coloured lanes on one time axis, with the events kept
// as notes in the project's Timeline folder.
//
// Not built yet. Everything this feature needs goes into this folder (and
// its stylesheet, src/styles/timeline.css); nothing outside it has to change.

import type { Feature, FeatureContext } from '../registry';

export const timelineFeature: Feature = {
  id: 'timeline',
  register(_context: FeatureContext): void {
    // Nothing to register yet.
  },
};
