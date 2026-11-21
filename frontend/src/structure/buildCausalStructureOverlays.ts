import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts'
import type { PriceRectangle } from '../plugins/rectangleOverlay'
import {
  buildExtremeObRectangles,
  buildFvgRectangles,
  buildSwingMarkers,
} from './buildStructureOverlays'
import type { StructureCandle } from './types'

export interface StructureOverlayToggles {
  showFvg: boolean
  showSwings: boolean
  showExtremeOb: boolean
}

export interface CausalStructureOverlays {
  swingMarkers: SeriesMarker<UTCTimestamp>[]
  priceRectangles: PriceRectangle[]
}

/**
 * Build FVG / extreme OB / swing layers from a candle **prefix** only.
 *
 * During playback, callers MUST pass `visibleCandles` (session start → playhead).
 * Never pass the full loaded series — detectors would peek at future bars.
 * Confirmation (e.g. swing lookback on the right) only uses bars already revealed.
 */
export function buildCausalStructureOverlays(
  candles: StructureCandle[],
  toggles: StructureOverlayToggles,
): CausalStructureOverlays {
  return {
    swingMarkers: toggles.showSwings ? buildSwingMarkers(candles) : [],
    priceRectangles: [
      ...(toggles.showFvg ? buildFvgRectangles(candles) : []),
      ...(toggles.showExtremeOb ? buildExtremeObRectangles(candles) : []),
    ],
  }
}
