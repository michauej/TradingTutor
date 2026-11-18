import type { UTCTimestamp } from 'lightweight-charts'
import type { MarketData } from '../services/api'
import type { ClosedTrade } from '../trading/types'
import { snapToCandleTimestamp } from './snapToCandle'

/** Line opacity for entry→exit connectors on the diary chart. */
export const TRADE_SPAN_OPACITY = 0.4

export interface TradeSpanLine {
  id: string
  points: Array<{ time: UTCTimestamp; value: number }>
  /** CSS color including alpha (≈40% opacity). */
  color: string
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function spanColor(realizedPnl: number): string {
  if (realizedPnl > 0) {
    return rgba(34, 197, 94, TRADE_SPAN_OPACITY)
  }
  if (realizedPnl < 0) {
    return rgba(239, 83, 80, TRADE_SPAN_OPACITY)
  }
  return rgba(148, 163, 184, TRADE_SPAN_OPACITY)
}

/**
 * Build semi-transparent entry→exit lines for closed trades on the revealed prefix.
 * Entry/exit times snap onto containing candles so spans survive timeframe switches.
 */
export function buildTradeSpans(
  closedTrades: ClosedTrade[],
  visibleCandles: MarketData[],
): TradeSpanLine[] {
  const spans: TradeSpanLine[] = []

  for (const trade of closedTrades) {
    const entryTime = snapToCandleTimestamp(visibleCandles, trade.entryTime)
    const exitTime = snapToCandleTimestamp(visibleCandles, trade.exitTime)
    if (entryTime === null || exitTime === null) {
      continue
    }
    if (exitTime < entryTime) {
      continue
    }
    // Same-bar round-trip: LineSeries needs ascending times, so skip.
    if (exitTime === entryTime) {
      continue
    }

    spans.push({
      id: trade.id,
      points: [
        { time: entryTime, value: trade.entryPrice },
        { time: exitTime, value: trade.exitPrice },
      ],
      color: spanColor(trade.realizedPnl),
    })
  }

  return spans
}
