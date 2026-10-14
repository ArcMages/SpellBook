// The writing modes engine: everything Zen, Letter box, Typewriter and
// Hemingway are worked out with.
//
// Plain calculations only. Nothing here touches the screen, the editor or
// the clock: values go in, values come out.
//
//   modes      the four modes, and the saved form of which are on
//   settings   what the writer can tune, and its saved form
//   frame      the band of the letter box and the resting line of the typewriter
//   hemingway  what counts as deleting
//   services   what the other screens are offered

export { MODES, MODE_IDS, NO_MODES, anyMode, formatModes, isModeId, parseModes, withMode } from './modes';
export type { ModeId, ModeInfo, ModeSet } from './modes';
export {
  ALLOW_WHERE,
  ANCHOR_PERCENTS,
  BAND_PERCENTS,
  BAND_SHADES,
  SHADE_OPACITY,
  allowedHere,
  defaultModeSettings,
  formatModeSettings,
  parseModeSettings,
  sameModeSettings,
} from './settings';
export type { AllowWhere, BandShade, ModeSettings } from './settings';
export { MIN_BAND_LINES, SETTLED_WITHIN, frameOf, sameFrame, typewriterTarget } from './frame';
export type { Frame, FrameInput, LinePlace } from './frame';
export { blockedChange, blockedInput, blockedKeys, blockedText, hemingwayAllows } from './hemingway';
export type { Blocked, BlockedKey, ChangeFacts } from './hemingway';
export { MODES_SERVICE } from './services';
export type { ModeState, ModesService } from './services';
