import type { ClosedTrade } from '../trading/types'

/** Payload shape expected by POST /api/coach/analyze (camelCase JSON). */
export interface CoachClosedTradePayload {
  id: string
  side: 'long' | 'short'
  qty: number
  entryPrice: number
  entryTime: string
  exitPrice: number
  exitTime: string
  realizedPnl: number
}

/** 1:1 map from SessionProvider ClosedTrade into the API body field. */
export function mapClosedTradesForCoach(
  trades: ClosedTrade[],
): CoachClosedTradePayload[] {
  return trades.map((t) => ({
    id: t.id,
    side: t.side,
    qty: t.qty,
    entryPrice: t.entryPrice,
    entryTime: t.entryTime,
    exitPrice: t.exitPrice,
    exitTime: t.exitTime,
    realizedPnl: t.realizedPnl,
  }))
}
