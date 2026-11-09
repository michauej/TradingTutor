import { describe, expect, it } from 'vitest'
import type { MarketData } from '../services/api'
import type { ClosedTrade, Lot } from '../trading/types'
import {
  BUY_MARKER_COLOR,
  SELL_MARKER_COLOR,
  buildTradeMarkers,
} from './buildTradeMarkers'
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
const T3 = '2024-06-01T03:00:00.000Z'
const OUTSIDE = '2024-06-01T10:00:00.000Z'

const visible = [candle(T0), candle(T1), candle(T2), candle(T3)]

function closedTrade(partial: Partial<ClosedTrade> & Pick<ClosedTrade, 'id' | 'side'>): ClosedTrade {
  return {
    qty: 1,
    entryPrice: 100,
    entryTime: T0,
    exitPrice: 110,
    exitTime: T2,
    realizedPnl: 10,
    ...partial,
  }
}

function openLot(partial: Partial<Lot> & Pick<Lot, 'id' | 'side'>): Lot {
  return {
    qty: 1,
    entryPrice: 100,
    entryTime: T1,
    ...partial,
  }
}

describe('toUtcTimestamp', () => {
  it('floors ISO strings to UTC seconds', () => {
    expect(toUtcTimestamp(T0)).toBe(Math.floor(Date.parse(T0) / 1000))
  })

  it('returns null for unparseable values', () => {
    expect(toUtcTimestamp('not-a-date')).toBeNull()
  })
})

describe('buildTradeMarkers', () => {
  it('maps a long round-trip to buy then sell', () => {
    const markers = buildTradeMarkers(
      [closedTrade({ id: 'c1', side: 'long', entryTime: T0, exitTime: T2 })],
      [],
      visible,
    )
    expect(markers).toHaveLength(2)
    expect(markers[0]).toMatchObject({
      time: toUtcTimestamp(T0),
      shape: 'arrowUp',
      position: 'belowBar',
      color: BUY_MARKER_COLOR,
      text: 'B',
    })
    expect(markers[1]).toMatchObject({
      time: toUtcTimestamp(T2),
      shape: 'arrowDown',
      position: 'aboveBar',
      color: SELL_MARKER_COLOR,
      text: 'S',
    })
  })

  it('maps a short round-trip to sell then buy', () => {
    const markers = buildTradeMarkers(
      [closedTrade({ id: 'c2', side: 'short', entryTime: T0, exitTime: T2 })],
      [],
      visible,
    )
    expect(markers).toHaveLength(2)
    expect(markers[0]).toMatchObject({
      time: toUtcTimestamp(T0),
      shape: 'arrowDown',
      position: 'aboveBar',
      color: SELL_MARKER_COLOR,
      text: 'S',
    })
    expect(markers[1]).toMatchObject({
      time: toUtcTimestamp(T2),
      shape: 'arrowUp',
      position: 'belowBar',
      color: BUY_MARKER_COLOR,
      text: 'B',
    })
  })

  it('emits only an entry marker for an open long lot', () => {
    const markers = buildTradeMarkers(
      [],
      [openLot({ id: 'l1', side: 'long', entryTime: T1 })],
      visible,
    )
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      time: toUtcTimestamp(T1),
      shape: 'arrowUp',
      position: 'belowBar',
      color: BUY_MARKER_COLOR,
      id: 'l1-entry',
    })
  })

  it('emits only an entry marker for an open short lot', () => {
    const markers = buildTradeMarkers(
      [],
      [openLot({ id: 'l2', side: 'short', entryTime: T1 })],
      visible,
    )
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      time: toUtcTimestamp(T1),
      shape: 'arrowDown',
      position: 'aboveBar',
      color: SELL_MARKER_COLOR,
      id: 'l2-entry',
    })
  })

  it('filters markers outside the visible prefix', () => {
    const markers = buildTradeMarkers(
      [
        closedTrade({
          id: 'c3',
          side: 'long',
          entryTime: T0,
          exitTime: OUTSIDE,
        }),
      ],
      [openLot({ id: 'l3', side: 'long', entryTime: OUTSIDE })],
      visible,
    )
    expect(markers).toHaveLength(1)
    expect(markers[0]?.id).toBe('c3-entry')
  })

  it('skips unparseable timestamps', () => {
    const markers = buildTradeMarkers(
      [
        closedTrade({
          id: 'c4',
          side: 'long',
          entryTime: 'bogus',
          exitTime: T2,
        }),
      ],
      [openLot({ id: 'l4', side: 'long', entryTime: 'also-bogus' })],
      visible,
    )
    expect(markers).toHaveLength(1)
    expect(markers[0]?.id).toBe('c4-exit')
  })

  it('emits multiple markers when several closes share an exitTime', () => {
    const markers = buildTradeMarkers(
      [
        closedTrade({ id: 'c5a', side: 'long', entryTime: T0, exitTime: T2 }),
        closedTrade({ id: 'c5b', side: 'long', entryTime: T1, exitTime: T2 }),
      ],
      [],
      visible,
    )
    const exits = markers.filter((m) => m.id?.endsWith('-exit'))
    expect(exits).toHaveLength(2)
    expect(exits.every((m) => m.time === toUtcTimestamp(T2))).toBe(true)
  })
})
