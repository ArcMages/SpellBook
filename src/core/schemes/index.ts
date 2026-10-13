// The colour schemes engine: the palettes, the colour maths, and the list of
// CSS variables a scheme sets.
//
// Plain calculations only. Nothing here reads or writes a file, touches the
// screen or looks at the clock: values go in, values come out.
//
//   palettes    SCHEMES, schemeById, nextScheme, the eight named colours
//   maths       contrast, mix, over, readableOn, bestInk
//   painting    schemeVariables, SCHEME_VARIABLE_NAMES, namedColours, derivedColours

export { READABLE, VISIBLE, bestInk, contrast, hexOf, hslOf, isHex, leastContrast, luminance, mix, over, readableOn, rgbList, rgbOf, rgba } from './colour';
export type { Rgb } from './colour';
export {
  NAMED_COLOURS,
  NAMED_ON_DARK,
  NAMED_ON_LIGHT,
  NO_SCHEME_DESCRIPTION,
  NO_SCHEME_NAME,
  SCHEMES,
  nextScheme,
  schemeById,
} from './palettes';
export type { ColourScheme, NamedColour } from './palettes';
export {
  HIGHLIGHT_STRENGTH,
  SCHEME_VARIABLE_NAMES,
  SELECTION_STRENGTH,
  derivedColours,
  namedColours,
  schemeVariables,
} from './variables';
export type { DerivedColours, SchemeVariable } from './variables';
