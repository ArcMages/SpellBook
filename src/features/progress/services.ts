// What the writing progress offers the other screens.
//
// The names and the shapes of the two services are declared once, in the
// core (src/core/progress/services.ts), where every screen may import them:
// this feature provides exactly those, and the inspector and the planner use
// exactly those. This file only hands them on under this folder's own roof,
// so that the files here can say "./services".

export { SCENE_LINE_SERVICE, STATS_SERVICE } from '../../core/progress/index';
export type { DayWords, SceneLineButton, SceneLineService, StatsService, StatsSummary } from '../../core/progress/index';
