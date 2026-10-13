// The corkboard and the inspector: index cards for the scenes of the open
// project, and a panel that edits the open scene's properties.
//
// Not built yet. Everything this feature needs goes into this folder (and
// its stylesheet, src/styles/corkboard.css); nothing outside it has to change.

import type { Feature, FeatureContext } from '../registry';

export const corkboardFeature: Feature = {
  id: 'corkboard',
  register(_context: FeatureContext): void {
    // Nothing to register yet.
  },
};
