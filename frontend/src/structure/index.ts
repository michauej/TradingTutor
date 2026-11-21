export { detectFvg } from './detectFvg'
export {
  detectExtremeOb,
  findMeanTakeIndex,
  EXTREME_OB_LOOKBACK,
} from './detectExtremeOb'
export {
  detectSwings,
  alternateSwings,
  filterSignificantSwings,
  hasSignificantLegs,
  hasMinAmplitude,
  minSwingMove,
  averageTrueRange,
  SWING_LOOKBACK,
  MIN_SWING_AMPLITUDE_RATIO,
  SWING_ATR_PERIOD,
  MIN_SWING_ATR_MULT,
} from './detectSwings'
export {
  buildFvgRectangles,
  buildExtremeObRectangles,
  buildSwingMarkers,
  mergeMarkersByTime,
} from './buildStructureOverlays'
export {
  buildCausalStructureOverlays,
  type CausalStructureOverlays,
  type StructureOverlayToggles,
} from './buildCausalStructureOverlays'
export type {
  ExtremeOrderBlock,
  FvgZone,
  StructureCandle,
  SwingPoint,
} from './types'
