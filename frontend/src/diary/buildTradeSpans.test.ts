import { describe, expect, it } from 'vitest'
import type { MarketData } from '../services/api'
import type { ClosedTrade } from '../trading/types'
import { TRADE_SPAN_OPACITY, buildTradeSpans } from './buildTradeSpans'
import { toUtcTimestamp } from './toUtcTimestamp'

function candle(timestamp: string): MarketData {
  return {
    symbol: 'BTCUSDT',
    exchange: 'bybit',
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1,
    timestamp,
    interval: '60',
  }
}

const T0 = '2024-06-01T00:00:00.000Z'
const T1 = '2024-06-01T01:00:00.000Z'
const T2 = '2024-06-01T02:00:00.000Z'
const OUTSIDE = '2024-06-01T10:00:00.000Z'

const visible = [candle(T0), candle(T1), candle(T2)]

function trade(partial: Partial<ClosedTrade> & Pick<ClosedTrade, 'id'>): ClosedTrade {
  return {
    side: 'long',
    qty: 1,
    entryPrice: 100,
    entryTime: T0,
    exitPrice: 110,
    exitTime: T2,
    realizedPnl: 10,
    ...partial,
  }
}

describe('buildTradeSpans', () => {
  it('connects entry to exit for a closed trade on the visible prefix', () => {
    const spans = buildTradeSpans([trade({ id: 'c1' })], visible)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toEqual({
      id: 'c1',
      points: [
        { time: toUtcTimestamp(T0), value: 100 },
        { time: toUtcTimestamp(T2), value: 110 },
      ],
      color: `rgba(34, 197, 94, ${TRADE_SPAN_OPACITY})`,
    })
  })

  it('uses red at 40% opacity for losing trades', () => {
    const spans = buildTradeSpans(
      [trade({ id: 'c2', exitPrice: 90, realizedPnl: -10 })],
      visible,
    )
    expect(spans[0]?.color).toBe(`rgba(239, 83, 80, ${TRADE_SPAN_OPACITY})`)
  })

  it('drops spans whose entry or exit is outside the visible prefix', () => {
    const spans = buildTradeSpans(
      [trade({ id: 'c3', exitTime: OUTSIDE })],
      visible,
    )
    expect(spans).toHaveLength(0)
  })

  it('skips same-bar entry and exit', () => {
    const spans = buildTradeSpans(
      [trade({ id: 'c4', entryTime: T1, exitTime: T1 })],
      visible,
    )
    expect(spans).toHaveLength(0)
  })

  it('snaps lower-TF entry/exit onto containing higher-TF candles', () => {
    const spans = buildTradeSpans(
      [
        trade({
          id: 'c5',
          entryTime: '2024-06-01T00:17:00.000Z',
          exitTime: '2024-06-01T02:05:00.000Z',
        }),
      ],
      visible,
    )
    expect(spans).toHaveLength(1)
    expect(spans[0]?.points[0]?.time).toBe(toUtcTimestamp(T0))
    expect(spans[0]?.points[1]?.time).toBe(toUtcTimestamp(T2))
  })
})
