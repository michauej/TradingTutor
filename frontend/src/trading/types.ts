/** Position / order side. */
export type Side = 'long' | 'short'

/** Whether an order opens exposure or closes it. */
export type OrderIntent = 'open' | 'close'

/** Execution style. Limit close = take-profit; stop close = stop-loss. */
export type OrderType = 'market' | 'limit' | 'stop'

/** Hidden lot under a net-per-side aggregate. */
export interface Lot {
  id: string
  side: Side
  qty: number
  entryPrice: number
  entryTime: string
}

/** Display aggregate for one side. */
export interface NetSide {
  qty: number
  avgEntry: number
}

/** Resting or market order ticket (market usually executed immediately). */
export interface Order {
  id: string
  side: Side
  intent: OrderIntent
  type: OrderType
  qty: number
  limitPrice?: number
  createdAt: string
}

/** Diary-ready closed trade record (markers deferred to S-04). */
export interface ClosedTrade {
  id: string
  side: Side
  qty: number
  entryPrice: number
  entryTime: string
  exitPrice: number
  exitTime: string
  realizedPnl: number
}

/** Paper account: balance = startingBalance + realizedPnl. */
export interface Account {
  startingBalance: number
  realizedPnl: number
}

/** OHLC bar used for limit touch matching. */
export interface OhlcBar {
  open: number
  high: number
  low: number
  close: number
  timestamp: string
}

export type SoftCapReason = 'softCapExceeded'

export type CancelReason = SoftCapReason | 'userCancel'

export interface MatchLimitsResult {
  orders: Order[]
  lots: Lot[]
  closedTrades: ClosedTrade[]
  realizedPnlDelta: number
  /** Orders removed without fill (e.g. soft-cap failure at fill). */
  cancelled: Array<{ order: Order; reason: SoftCapReason }>
  /** Orders that filled on this bar. */
  filled: Order[]
}
