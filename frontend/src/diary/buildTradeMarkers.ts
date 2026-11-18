import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts'
import type { MarketData } from '../services/api'
import type { ClosedTrade, Lot, Side } from '../trading/types'
import { snapToCandleTimestamp } from './snapToCandle'

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
  visibleCandles: MarketData[],
  timestamp: string,
  action: EconomicAction,
  id: string,
): void {
  // Snap to containing bar so a 1m/5m fill still shows on 1h/4h after TF switch.
  const time = snapToCandleTimestamp(visibleCandles, timestamp)
  if (time === null) {
    return
  }
  markers.push(markerForAction(time, action, id))
}

/**
 * Map closed trades + open lots to economic buy/sell markers on the revealed prefix.
 * Trade times are snapped onto the candle that contains them so markers survive TF changes.
 * Markers whose times do not parse or fall outside the visible range are dropped.
 */
export function buildTradeMarkers(
  closedTrades: ClosedTrade[],
  openLots: Lot[],
  visibleCandles: MarketData[],
): SeriesMarker<UTCTimestamp>[] {
  const markers: SeriesMarker<UTCTimestamp>[] = []

  for (const trade of closedTrades) {
    pushIfVisible(
      markers,
      visibleCandles,
      trade.entryTime,
      economicOpen(trade.side),
      `${trade.id}-entry`,
    )
    pushIfVisible(
      markers,
      visibleCandles,
      trade.exitTime,
      economicClose(trade.side),
      `${trade.id}-exit`,
    )
  }

  for (const lot of openLots) {
    pushIfVisible(
      markers,
      visibleCandles,
      lot.entryTime,
      economicOpen(lot.side),
      `${lot.id}-entry`,
    )
  }

  return markers
}
