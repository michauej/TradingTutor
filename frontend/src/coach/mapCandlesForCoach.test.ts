import { describe, expect, it } from 'vitest'
import {
  COACH_MAX_CANDLE_BARS,
  mapCandlesForCoach,
} from './mapCandlesForCoach'
import { toCritiqueCard } from './critiqueCards'
import type { MarketData } from '../services/api'

function bar(i: number): MarketData {
  return {
    symbol: 'BTCUSDT',
    exchange: 'ByBit',
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 1,
    timestamp: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    interval: '1',
  }
}

describe('mapCandlesForCoach', () => {
  it('compacts MarketData to ohlc + timestamp', () => {
    const mapped = mapCandlesForCoach([bar(0)])
    expect(mapped).toEqual([
      {
        timestamp: bar(0).timestamp,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
      },
    ])
  })

  it('downsamples when over max bars', () => {
    const candles = Array.from({ length: COACH_MAX_CANDLE_BARS + 200 }, (_, i) =>
      bar(i),
    )
    const prefer = [candles[100]!.timestamp, candles[150]!.timestamp]
    const mapped = mapCandlesForCoach(candles, {
      preferTimes: prefer,
      maxBars: COACH_MAX_CANDLE_BARS,
    })
    expect(mapped.length).toBeLessThanOrEqual(COACH_MAX_CANDLE_BARS)
    expect(mapped.length).toBeGreaterThan(10)
  })
})

describe('toCritiqueCard', () => {
  it('uses zone text when better zone is present', () => {
    const card = toCritiqueCard({
      id: 'ict-premium-discount',
      severity: 'warning',
      message: 'Long into premium',
      relatedTradeIds: ['p1'],
      alternativeSummary: 'Buy discount',
      betterZoneLow: 90,
      betterZoneHigh: 100,
      biasLabel: 'FOMO',
    })
    expect(card.hasZone).toBe(true)
    expect(card.better).toContain('Better zone')
    expect(card.biasLabel).toBe('FOMO')
    expect(card.bad).toContain('p1')
    expect(card.relatedTradeIds).toEqual(['p1'])
  })

  it('falls back to qualitative better when zones are null', () => {
    const card = toCritiqueCard({
      id: 'ict-bos-choch',
      severity: 'info',
      message: 'BOS chase',
      alternativeSummary: 'Wait for retest',
    })
    expect(card.hasZone).toBe(false)
    expect(card.better).toBe('Wait for retest')
    expect(card.relatedTradeIds).toEqual([])
  })
})
