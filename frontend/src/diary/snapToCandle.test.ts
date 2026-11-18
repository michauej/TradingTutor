import { describe, expect, it } from 'vitest'
import type { MarketData } from '../services/api'
import { snapToCandleTimestamp } from './snapToCandle'
import { toUtcTimestamp } from './toUtcTimestamp'

function candle(timestamp: string, interval = '1h'): MarketData {
  return {
    symbol: 'BTCUSDT',
    exchange: 'bybit',
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1,
    timestamp,
    interval,
  }
}

const H0 = '2024-06-01T00:00:00.000Z'
const H1 = '2024-06-01T01:00:00.000Z'
const H2 = '2024-06-01T02:00:00.000Z'
const MID = '2024-06-01T01:17:00.000Z'
const AFTER = '2024-06-01T10:00:00.000Z'

describe('snapToCandleTimestamp', () => {
  it('snaps an intra-bar lower-TF time onto the containing higher-TF candle', () => {
    const visible = [candle(H0), candle(H1), candle(H2)]
    expect(snapToCandleTimestamp(visible, MID)).toBe(toUtcTimestamp(H1))
  })

  it('keeps an exact bar-open time on that candle', () => {
    const visible = [candle(H0), candle(H1), candle(H2)]
    expect(snapToCandleTimestamp(visible, H1)).toBe(toUtcTimestamp(H1))
  })

  it('returns null when the time is after the last visible bar ends', () => {
    const visible = [candle(H0), candle(H1), candle(H2)]
    expect(snapToCandleTimestamp(visible, AFTER)).toBeNull()
  })

  it('returns null when the time is before the first candle', () => {
    const visible = [candle(H1), candle(H2)]
    expect(snapToCandleTimestamp(visible, H0)).toBeNull()
  })
})
