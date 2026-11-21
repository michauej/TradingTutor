import type { FvgZone, StructureCandle } from './types'

/**
 * Three-candle FVG detection — must match backend StructureDetector.DetectFvgs.
 */
export function detectFvg(candles: StructureCandle[]): FvgZone[] {
  if (candles.length < 3) {
    return []
  }

  const zones: FvgZone[] = []
  for (let i = 2; i < candles.length; i++) {
    const left = candles[i - 2]!
    const right = candles[i]!

    if (left.high < right.low) {
      zones.push({
        midIndex: i - 1,
        start: left.timestamp,
        end: right.timestamp,
        low: left.high,
        high: right.low,
        isBullish: true,
      })
    }

    if (left.low > right.high) {
      zones.push({
        midIndex: i - 1,
        start: left.timestamp,
        end: right.timestamp,
        low: right.high,
        high: left.low,
        isBullish: false,
      })
    }
  }
  return zones
}
