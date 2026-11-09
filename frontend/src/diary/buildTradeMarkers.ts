import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts'
import type { MarketData } from '../services/api'
import type { ClosedTrade, Lot, Side } from '../trading/types'
import { toUtcTimestamp } from './toUtcTimestamp'

export const BUY_MARKER_COLOR = '#22c55e'
export const SELL_MARKER_COLOR = '#ef5350'

type EconomicAction = 'buy' | 'sell'

function economicOpen(side: Side): EconomicAction {
  return side === 'long' ? 'buy' : 'sell'
}

function economicClose(side: Side): EconomicAction {
  return side === 'long' ? 'sell' : 'buy'
}

function markerForAction(
  time: UTCTimestamp,
  action: EconomicAction,
  id: string,
): SeriesMarker<UTCTimestamp> {
  if (action === 'buy') {
    return {
      time,
      position: 'belowBar',
      shape: 'arrowUp',
      color: BUY_MARKER_COLOR,
      id,
      text: 'B',
    }
  }
  return {
    time,
    position: 'aboveBar',
    shape: 'arrowDown',
    color: SELL_MARKER_COLOR,
    id,
    text: 'S',
  }
}

function pushIfVisible(
  markers: SeriesMarker<UTCTimestamp>[],
  visibleTimes: Set<number>,
  timestamp: string,
  action: EconomicAction,
  id: string,
): void {
  const time = toUtcTimestamp(timestamp)
  if (time === null || !visibleTimes.has(time)) {
    return
  }
  markers.push(markerForAction(time, action, id))
}

/**
 * Map closed trades + open lots to economic buy/sell markers on the revealed prefix.
 * Markers whose times do not parse or do not land on a visible bar are dropped.
 */
export function buildTradeMarkers(
  closedTrades: ClosedTrade[],
  openLots: Lot[],
  visibleCandles: MarketData[],
): SeriesMarker<UTCTimestamp>[] {
  const visibleTimes = new Set<number>()
  for (const candle of visibleCandles) {
    const t = toUtcTimestamp(candle.timestamp)
    if (t !== null) {
      visibleTimes.add(t)
    }
  }

  const markers: SeriesMarker<UTCTimestamp>[] = []

  for (const trade of closedTrades) {
    pushIfVisible(
      markers,
      visibleTimes,
      trade.entryTime,
      economicOpen(trade.side),
      `${trade.id}-entry`,
    )
    pushIfVisible(
      markers,
      visibleTimes,
      trade.exitTime,
      economicClose(trade.side),
      `${trade.id}-exit`,
    )
  }

  for (const lot of openLots) {
    pushIfVisible(
      markers,
      visibleTimes,
      lot.entryTime,
      economicOpen(lot.side),
      `${lot.id}-entry`,
    )
  }

  return markers
}
