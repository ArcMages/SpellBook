// The continuous manuscript ("scrivenings"): everything it works out with no
// screen and no vault. See layout.ts for which scenes are drawn, scenes.ts
// for which scenes are on show, text.ts for a scene's text and memory.ts for
// what a device remembers.

export {
  DEFAULT_SCENE_HEIGHT,
  MAX_TEXT_WIDTH,
  MIN_SCENE_HEIGHT,
  WINDOW_ROOM,
  estimateHeight,
  offsetsOf,
  placeAt,
  planWindow,
  sceneAt,
  scrollTopOf,
  totalHeight,
} from './layout';
export type { Place, WindowPlan, WindowRoom } from './layout';
export { DEFAULT_VIEW, MAX_REMEMBERED_PROJECTS, moveRemembered, readMemory, remember, writeMemory } from './memory';
export type { RememberedPlace, RememberedView, ScriveningsMemory } from './memory';
export { carryOver, sameScriveningsScope, scenesOfScope } from './scenes';
export type { ListedScene, ScriveningsScope, ShownScene } from './scenes';
export { hasText, lineOfSnippet, plainParagraphs, sceneText } from './text';
export type { SceneText } from './text';
