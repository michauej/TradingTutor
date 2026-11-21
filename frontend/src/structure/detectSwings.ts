import type { StructureCandle, SwingPoint } from './types'

/** Must match backend StructureDetector.DefaultSwingLookback. */
export const SWING_LOOKBACK = 5

/**
 * Minimum |Δprice|/price between consecutive opposite swings (0.5%).
 * Must match backend StructureDetector.MinSwingAmplitudeRatio.
 */
export const MIN_SWING_AMPLITUDE_RATIO = 0.005

/** ATR length for adaptive swing size. Must match backend. */
export const SWING_ATR_PERIOD = 14

/** Min leg size as a multiple of ATR. Must match backend. */
export const MIN_SWING_ATR_MULT = 0.75

export function detectSwings(
  candles: StructureCandle[],
  lookback: number = SWING_LOOKBACK,
  minAmplitudeRatio: number = MIN_SWING_AMPLITUDE_RATIO,
): SwingPoint[] {
  if (lookback < 1 || candles.length < lookback * 2 + 1) {
    return []
  }

  const atr = averageTrueRange(candles, SWING_ATR_PERIOD)
  const raw: SwingPoint[] = []
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]!
    let isHigh = true
    let isLow = true
    for (let k = 1; k <= lookback; k++) {
      if (c.high <= candles[i - k]!.high || c.high <= candles[i + k]!.high) {
        isHigh = false
      }
      if (c.low >= candles[i - k]!.low || c.low >= candles[i + k]!.low) {
        isLow = false
      }
    }

    // Same bar cannot be both SH and SL — prefer the more decisive wick.
    if (isHigh && isLow) {
      const mid = (c.high + c.low) / 2
      if (c.high - mid >= mid - c.low) {
        isLow = false
      } else {
        isHigh = false
      }
    }

    if (isHigh) {
      raw.push({
        index: i,
        timestamp: c.timestamp,
        price: c.high,
        isHigh: true,
      })
    }
    if (isLow) {
      raw.push({
        index: i,
        timestamp: c.timestamp,
        price: c.low,
        isHigh: false,
      })
    }
  }

  const alternating = alternateSwings(raw, minAmplitudeRatio)
  return filterSignificantSwings(candles, alternating, lookback, atr, minAmplitudeRatio)
}

/**
 * Enforce alternating SH/SL. Consecutive same-type pivots keep the more extreme
 * (higher high / lower low). Opposite pivots must clear minAmplitudeRatio or are dropped.
 * Must match backend StructureDetector.AlternateSwings.
 */
export function alternateSwings(
  raw: SwingPoint[],
  minAmplitudeRatio: number = MIN_SWING_AMPLITUDE_RATIO,
): SwingPoint[] {
  if (raw.length === 0) {
    return []
  }

  const ordered = [...raw].sort((a, b) => {
    if (a.index !== b.index) {
      return a.index - b.index
    }
    return Number(b.isHigh) - Number(a.isHigh)
  })

  const result: SwingPoint[] = [ordered[0]!]
  for (let i = 1; i < ordered.length; i++) {
    const next = ordered[i]!
    const last = result[result.length - 1]!
    if (next.isHigh === last.isHigh) {
      const keepNext = next.isHigh
        ? next.price > last.price
        : next.price < last.price
      if (keepNext) {
        result[result.length - 1] = next
      }
    } else if (hasMinAmplitude(last.price, next.price, minAmplitudeRatio)) {
      result.push(next)
    }
  }
  return result
}

/**
 * Keep only pivots with a meaningful leg on BOTH sides (ATR / % floor).
 * Drops shallow pullback highs and unconfirmed trailing lows/highs.
 * Must match backend StructureDetector.FilterSignificantSwings.
 */
export function filterSignificantSwings(
  candles: StructureCandle[],
  swings: SwingPoint[],
  lookback: number,
  atr: number,
  minAmplitudeRatio: number = MIN_SWING_AMPLITUDE_RATIO,
): SwingPoint[] {
  if (swings.length === 0) {
    return []
  }

  const kept: SwingPoint[] = []
  for (const swing of swings) {
    const minMove = minSwingMove(swing.price, atr, minAmplitudeRatio)
    if (hasSignificantLegs(candles, swing, lookback, minMove)) {
      kept.push(swing)
    }
  }

  // Re-alternate after drops so we never leave SH-SH / SL-SL.
  return alternateSwings(kept, minAmplitudeRatio)
}

export function hasSignificantLegs(
  candles: StructureCandle[],
  swing: SwingPoint,
  lookback: number,
  minMove: number,
): boolean {
  const leftFrom = Math.max(0, swing.index - lookback * 2)
  const rightTo = Math.min(candles.length - 1, swing.index + lookback * 2)
  if (swing.index <= leftFrom || swing.index >= rightTo) {
    return false
  }

  let leftLeg = 0
  let rightLeg = 0
  if (swing.isHigh) {
    let leftLow = candles[swing.index]!.low
    for (let i = leftFrom; i < swing.index; i++) {
      leftLow = Math.min(leftLow, candles[i]!.low)
    }
    let rightLow = candles[swing.index]!.low
    for (let i = swing.index + 1; i <= rightTo; i++) {
      rightLow = Math.min(rightLow, candles[i]!.low)
    }
    leftLeg = swing.price - leftLow
    rightLeg = swing.price - rightLow
  } else {
    let leftHigh = candles[swing.index]!.high
    for (let i = leftFrom; i < swing.index; i++) {
      leftHigh = Math.max(leftHigh, candles[i]!.high)
    }
    let rightHigh = candles[swing.index]!.high
    for (let i = swing.index + 1; i <= rightTo; i++) {
      rightHigh = Math.max(rightHigh, candles[i]!.high)
    }
    leftLeg = leftHigh - swing.price
    rightLeg = rightHigh - swing.price
  }

  return leftLeg >= minMove && rightLeg >= minMove
}

export function minSwingMove(
  price: number,
  atr: number,
  minAmplitudeRatio: number,
): number {
  const pctFloor = Math.abs(price) * minAmplitudeRatio
  const atrFloor = atr > 0 ? atr * MIN_SWING_ATR_MULT : 0
  return Math.max(pctFloor, atrFloor)
}

export function averageTrueRange(
  candles: StructureCandle[],
  period: number = SWING_ATR_PERIOD,
): number {
  if (candles.length < 2) {
    return 0
  }
  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i]!
    const prev = candles[i - 1]!
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    )
    trs.push(tr)
  }
  if (trs.length === 0) {
    return 0
  }
  const use = trs.slice(-Math.min(period, trs.length))
  return use.reduce((a, b) => a + b, 0) / use.length
}

export function hasMinAmplitude(
  fromPrice: number,
  toPrice: number,
  minAmplitudeRatio: number,
): boolean {
  const basis = Math.abs(fromPrice)
  if (!(basis > 0)) {
    return Math.abs(toPrice - fromPrice) > 0
  }
  return Math.abs(toPrice - fromPrice) / basis >= minAmplitudeRatio
}
