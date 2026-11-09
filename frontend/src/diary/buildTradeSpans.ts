import type { UTCTimestamp } from 'lightweight-charts'
import type { MarketData } from '../services/api'
import type { ClosedTrade } from '../trading/types'
import { toUtcTimestamp } from './toUtcTimestamp'

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
 * Build semi-transparent entry→exit lines for closed trades whose times land on the revealed prefix.
 */
export function buildTradeSpans(
  closedTrades: ClosedTrade[],
  visibleCandles: MarketData[],
): TradeSpanLine[] {
  const visibleTimes = new Set<number>()
  for (const candle of visibleCandles) {
    const t = toUtcTimestamp(candle.timestamp)
    if (t !== null) {
      visibleTimes.add(t)
    }
  }

  const spans: TradeSpanLine[] = []

  for (const trade of closedTrades) {
    const entryTime = toUtcTimestamp(trade.entryTime)
    const exitTime = toUtcTimestamp(trade.exitTime)
    if (entryTime === null || exitTime === null) {
      continue
    }
    if (!visibleTimes.has(entryTime) || !visibleTimes.has(exitTime)) {
      continue
    }
    if (exitTime < entryTime) {
      continue
    }
    // Same-bar round-trip: still draw a degenerate two-point series at one time
    // by using entry then exit prices — LineSeries needs ascending times, so skip.
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
