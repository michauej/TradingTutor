/** Compact OHLC used by client structure detectors (parity with server CandleInput). */
export interface StructureCandle {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
}

/**
 * Swing lookback = 5 on each side (same as backend StructureDetector.DefaultSwingLookback).
 * A bar is a swing high when its high is strictly greater than the highs of the
 * lookback bars on both sides; swing low uses lows symmetrically.
 * After raw detection: alternate SH/SL, amplitude gate, then both-side leg filter
 * (ATR/%) so shallow pullbacks and unconfirmed edge pivots are ignored.
 */
export interface SwingPoint {
  index: number
  timestamp: string
  price: number
  isHigh: boolean
}

/**
 * Fair value gap via the three-candle rule (same as backend StructureDetector.DetectFvgs):
 * bullish when candle[i-2].high < candle[i].low; bearish when candle[i-2].low > candle[i].high.
 */
export interface FvgZone {
  midIndex: number
  start: string
  end: string
  low: number
  high: number
  isBullish: boolean
}

/**
 * Extreme order block at a swing extreme (parity with backend ExtremeOrderBlock):
 * bullish EOB = last bearish candle at/near swing low; bearish EOB = last bullish at/near swing high.
 * Extends right until the 50% mean is taken (or series end). `mean` is the preferred entry.
 */
export interface ExtremeOrderBlock {
  candleIndex: number
  swingIndex: number
  endIndex: number
  start: string
  end: string
  low: number
  high: number
  /** 50% mean threshold of the OB range. */
  mean: number
  isBullish: boolean
}
