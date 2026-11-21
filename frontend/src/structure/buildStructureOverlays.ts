import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts'
import { toUtcTimestamp } from '../diary'
import type { PriceRectangle } from '../plugins/rectangleOverlay'
import { detectExtremeOb } from './detectExtremeOb'
import { detectFvg } from './detectFvg'
import { detectSwings } from './detectSwings'
import type { StructureCandle } from './types'

const BULLISH_FVG_FILL = 'rgba(38, 166, 154, 0.18)'
const BEARISH_FVG_FILL = 'rgba(239, 83, 80, 0.18)'
const BULLISH_EOB_FILL = 'rgba(56, 189, 248, 0.28)'
const BEARISH_EOB_FILL = 'rgba(251, 146, 60, 0.28)'
const SWING_HIGH_COLOR = '#f59e0b'
const SWING_LOW_COLOR = '#38bdf8'

export function buildFvgRectangles(candles: StructureCandle[]): PriceRectangle[] {
  const fvgs = detectFvg(candles)
  const rects: PriceRectangle[] = []
  for (let i = 0; i < fvgs.length; i++) {
    const fvg = fvgs[i]!
    const t0 = toUtcTimestamp(fvg.start)
    const t1 = toUtcTimestamp(fvg.end)
    if (t0 === null || t1 === null) {
      continue
    }
    rects.push({
      id: `fvg-${i}`,
      timeStart: t0,
      timeEnd: t1,
      priceHigh: fvg.high,
      priceLow: fvg.low,
      fillColor: fvg.isBullish ? BULLISH_FVG_FILL : BEARISH_FVG_FILL,
    })
  }
  return rects
}

export function buildExtremeObRectangles(
  candles: StructureCandle[],
): PriceRectangle[] {
  const blocks = detectExtremeOb(candles)
  const rects: PriceRectangle[] = []
  for (let i = 0; i < blocks.length; i++) {
    const ob = blocks[i]!
    const t0 = toUtcTimestamp(ob.start)
    const t1 = toUtcTimestamp(ob.end)
    if (t0 === null || t1 === null) {
      continue
    }
    rects.push({
      id: `eob-${i}`,
      timeStart: Math.min(t0, t1) as UTCTimestamp,
      timeEnd: Math.max(t0, t1) as UTCTimestamp,
      priceHigh: ob.high,
      priceLow: ob.low,
      fillColor: ob.isBullish ? BULLISH_EOB_FILL : BEARISH_EOB_FILL,
      borderColor: ob.isBullish
        ? 'rgba(56, 189, 248, 0.7)'
        : 'rgba(251, 146, 60, 0.7)',
    })
  }
  return rects
}

export function buildSwingMarkers(
  candles: StructureCandle[],
): SeriesMarker<UTCTimestamp>[] {
  const swings = detectSwings(candles)
  const markers: SeriesMarker<UTCTimestamp>[] = []
  for (const swing of swings) {
    const time = toUtcTimestamp(swing.timestamp)
    if (time === null) {
      continue
    }
    markers.push({
      time,
      position: swing.isHigh ? 'aboveBar' : 'belowBar',
      shape: swing.isHigh ? 'arrowDown' : 'arrowUp',
      color: swing.isHigh ? SWING_HIGH_COLOR : SWING_LOW_COLOR,
      text: swing.isHigh ? 'SH' : 'SL',
    })
  }
  return markers
}

/** Merge trade + structure markers ascending by time (stable within equal times). */
export function mergeMarkersByTime(
  ...groups: SeriesMarker<UTCTimestamp>[][]
): SeriesMarker<UTCTimestamp>[] {
  const all = groups.flat()
  return all.sort((a, b) => {
    const ta = typeof a.time === 'number' ? a.time : 0
    const tb = typeof b.time === 'number' ? b.time : 0
    return ta - tb
  })
}
