import { detectSwings } from './detectSwings'
import type { ExtremeOrderBlock, StructureCandle, SwingPoint } from './types'

/** Must match backend StructureDetector.ExtremeObLookback. */
export const EXTREME_OB_LOOKBACK = 3

/**
 * Extreme order blocks at swing extremes — parity with
 * backend StructureDetector.DetectExtremeOrderBlocks.
 * Boxes extend right until the 50% mean threshold is taken.
 */
export function detectExtremeOb(
  candles: StructureCandle[],
  swings?: SwingPoint[],
): ExtremeOrderBlock[] {
  if (candles.length === 0) {
    return []
  }

  const pivots = swings ?? detectSwings(candles)
  if (pivots.length === 0) {
    return []
  }

  const blocks: ExtremeOrderBlock[] = []
  for (const swing of pivots) {
    const from = Math.max(0, swing.index - EXTREME_OB_LOOKBACK)
    let obIndex: number | null = null
    let isBullish = false

    for (let i = swing.index; i >= from; i--) {
      const c = candles[i]!
      const bearish = c.close < c.open
      const bullish = c.close > c.open

      if (!swing.isHigh && bearish) {
        obIndex = i
        isBullish = true
        break
      }

      if (swing.isHigh && bullish) {
        obIndex = i
        isBullish = false
        break
      }
    }

    if (obIndex === null) {
      continue
    }

    const obCandle = candles[obIndex]!
    const endIndex = findMeanTakeIndex(
      candles,
      obIndex,
      obCandle.low,
      obCandle.high,
      isBullish,
    )

    blocks.push({
      candleIndex: obIndex,
      swingIndex: swing.index,
      endIndex,
      start: obCandle.timestamp,
      end: candles[endIndex]!.timestamp,
      low: obCandle.low,
      high: obCandle.high,
      mean: (obCandle.low + obCandle.high) / 2,
      isBullish,
    })
  }

  return blocks
}

/**
 * Extend through the adjacent candle (never a take). 50% take only after price
 * has left the OB (bullish: high > OB high; bearish: low < OB low), then returns to mean.
 * Must match backend StructureDetector.FindMeanTakeIndex.
 */
export function findMeanTakeIndex(
  candles: StructureCandle[],
  obIndex: number,
  low: number,
  high: number,
  isBullish: boolean,
): number {
  const mean = (low + high) / 2
  const endIndex = candles.length - 1
  const minExtend = Math.min(obIndex + 1, endIndex)
  let leftOb = false
  for (let i = obIndex + 1; i < candles.length; i++) {
    const c = candles[i]!
    if (!leftOb) {
      if (isBullish && c.high > high) {
        leftOb = true
      } else if (!isBullish && c.low < low) {
        leftOb = true
      }
    }

    if (i === obIndex + 1) {
      continue
    }

    if (!leftOb) {
      continue
    }

    if (isBullish && c.low <= mean) {
      return Math.max(i, minExtend)
    }
    if (!isBullish && c.high >= mean) {
      return Math.max(i, minExtend)
    }
  }
  return endIndex
}
