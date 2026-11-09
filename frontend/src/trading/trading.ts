import type {
  Account,
  ClosedTrade,
  Lot,
  MatchLimitsResult,
  NetSide,
  OhlcBar,
  Order,
  OrderType,
  Side,
  SoftCapReason,
} from './types'

export type {
  Account,
  CancelReason,
  ClosedTrade,
  Lot,
  MatchLimitsResult,
  NetSide,
  OhlcBar,
  Order,
  OrderIntent,
  OrderType,
  Side,
  SoftCapReason,
} from './types'

export type SizingReject =
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: SoftCapReason; message: string }

export type SizingAccept = { ok: true; qty: number }

export type SizingResult = SizingAccept | SizingReject

let idSeq = 0

/** Test-friendly id factory; reset via `resetTradingIdSeq` in tests if needed. */
export function nextTradingId(prefix = 't'): string {
  idSeq += 1
  return `${prefix}-${idSeq}`
}

export function resetTradingIdSeq(): void {
  idSeq = 0
}

export function accountBalance(account: Account): number {
  return account.startingBalance + account.realizedPnl
}

/**
 * Convert a percent-of-wallet sizing input into qty at `markPrice`.
 * Rejects non-positive percent / mark / balance and soft-cap failures.
 */
export function qtyFromPercent(
  balance: number,
  percent: number,
  markPrice: number,
): SizingResult {
  if (!(balance > 0) || !(percent > 0) || !(markPrice > 0)) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Balance, percent, and mark price must be positive',
    }
  }
  const notional = balance * (percent / 100)
  const qty = notional / markPrice
  return validateQtyAgainstSoftCap(qty, markPrice, balance)
}

/** Accept raw qty if positive and within soft notional cap vs balance. */
export function validateQtyAgainstSoftCap(
  qty: number,
  markPrice: number,
  balance: number,
): SizingResult {
  if (!(qty > 0) || !(markPrice > 0)) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Qty and mark price must be positive',
    }
  }
  if (!(balance >= 0)) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Balance must be non-negative',
    }
  }
  const notional = qty * markPrice
  if (notional > balance) {
    return {
      ok: false,
      reason: 'softCapExceeded',
      message: `Order notional ${notional} exceeds balance ${balance}`,
    }
  }
  return { ok: true, qty }
}

/** Realized PnL for a closed lot (1x paper). */
export function realizedPnl(
  side: Side,
  qty: number,
  entryPrice: number,
  exitPrice: number,
): number {
  if (side === 'long') {
    return (exitPrice - entryPrice) * qty
  }
  return (entryPrice - exitPrice) * qty
}

/** Net Long / Short aggregates from hidden lots (qty-weighted avg entry). */
export function netSides(lots: readonly Lot[]): {
  long: NetSide
  short: NetSide
} {
  return {
    long: aggregateSide(lots, 'long'),
    short: aggregateSide(lots, 'short'),
  }
}

function aggregateSide(lots: readonly Lot[], side: Side): NetSide {
  let qty = 0
  let cost = 0
  for (const lot of lots) {
    if (lot.side !== side) {
      continue
    }
    qty += lot.qty
    cost += lot.qty * lot.entryPrice
  }
  return {
    qty,
    avgEntry: qty > 0 ? cost / qty : 0,
  }
}

export interface OpenMarketParams {
  lots: readonly Lot[]
  side: Side
  qty: number
  markPrice: number
  markTime: string
  balance: number
  id?: string
}

export type OpenMarketResult =
  | { ok: true; lots: Lot[]; lot: Lot }
  | SizingReject

/** Append a lot at mark price after soft-cap check. */
export function openMarket(params: OpenMarketParams): OpenMarketResult {
  const sized = validateQtyAgainstSoftCap(
    params.qty,
    params.markPrice,
    params.balance,
  )
  if (!sized.ok) {
    return sized
  }
  const lot: Lot = {
    id: params.id ?? nextTradingId('lot'),
    side: params.side,
    qty: sized.qty,
    entryPrice: params.markPrice,
    entryTime: params.markTime,
  }
  return { ok: true, lots: [...params.lots, lot], lot }
}

export interface CloseMarketFifoParams {
  lots: readonly Lot[]
  side: Side
  exitPrice: number
  exitTime: string
  tradeId?: string
}

export type CloseMarketFifoResult =
  | {
      ok: true
      lots: Lot[]
      closedTrade: ClosedTrade
      realizedPnl: number
    }
  | { ok: false; reason: 'flat'; message: string }

/** Close the oldest full lot on `side` at market (FIFO). */
export function closeMarketFifo(
  params: CloseMarketFifoParams,
): CloseMarketFifoResult {
  const index = params.lots.findIndex((lot) => lot.side === params.side)
  if (index < 0) {
    return { ok: false, reason: 'flat', message: `No ${params.side} lots to close` }
  }
  const lot = params.lots[index]!
  const pnl = realizedPnl(lot.side, lot.qty, lot.entryPrice, params.exitPrice)
  const closedTrade: ClosedTrade = {
    id: params.tradeId ?? nextTradingId('trade'),
    side: lot.side,
    qty: lot.qty,
    entryPrice: lot.entryPrice,
    entryTime: lot.entryTime,
    exitPrice: params.exitPrice,
    exitTime: params.exitTime,
    realizedPnl: pnl,
  }
  const lots = [...params.lots.slice(0, index), ...params.lots.slice(index + 1)]
  return { ok: true, lots, closedTrade, realizedPnl: pnl }
}

export interface CloseLotByIdParams {
  lots: readonly Lot[]
  lotId: string
  exitPrice: number
  exitTime: string
  tradeId?: string
}

/** Close a specific open lot at market (used by Open trades → Close). */
export function closeLotById(
  params: CloseLotByIdParams,
): CloseMarketFifoResult {
  const index = params.lots.findIndex((lot) => lot.id === params.lotId)
  if (index < 0) {
    return { ok: false, reason: 'flat', message: `Lot ${params.lotId} not found` }
  }
  const lot = params.lots[index]!
  const pnl = realizedPnl(lot.side, lot.qty, lot.entryPrice, params.exitPrice)
  const closedTrade: ClosedTrade = {
    id: params.tradeId ?? nextTradingId('trade'),
    side: lot.side,
    qty: lot.qty,
    entryPrice: lot.entryPrice,
    entryTime: lot.entryTime,
    exitPrice: params.exitPrice,
    exitTime: params.exitTime,
    realizedPnl: pnl,
  }
  const lots = [...params.lots.slice(0, index), ...params.lots.slice(index + 1)]
  return { ok: true, lots, closedTrade, realizedPnl: pnl }
}

export interface CloseAllParams {
  lots: readonly Lot[]
  exitPrice: number
  exitTime: string
  idFactory?: () => string
}

/** Flatten every lot on both sides at market. */
export function closeAll(params: CloseAllParams): {
  lots: Lot[]
  closedTrades: ClosedTrade[]
  realizedPnl: number
} {
  const closedTrades: ClosedTrade[] = []
  let pnlSum = 0
  const nextId = params.idFactory ?? (() => nextTradingId('trade'))
  for (const lot of params.lots) {
    const pnl = realizedPnl(lot.side, lot.qty, lot.entryPrice, params.exitPrice)
    pnlSum += pnl
    closedTrades.push({
      id: nextId(),
      side: lot.side,
      qty: lot.qty,
      entryPrice: lot.entryPrice,
      entryTime: lot.entryTime,
      exitPrice: params.exitPrice,
      exitTime: params.exitTime,
      realizedPnl: pnl,
    })
  }
  return { lots: [], closedTrades, realizedPnl: pnlSum }
}

/**
 * Close up to `qty` on `side` consuming oldest lots FIFO (may partially reduce a lot).
 * Used when a close limit fills for a free-form qty.
 */
export function closeQtyFifo(
  lots: readonly Lot[],
  side: Side,
  qty: number,
  exitPrice: number,
  exitTime: string,
  idFactory?: () => string,
): {
  ok: true
  lots: Lot[]
  closedTrades: ClosedTrade[]
  realizedPnl: number
} | { ok: false; reason: 'insufficient'; message: string } {
  if (!(qty > 0)) {
    return { ok: false, reason: 'insufficient', message: 'Close qty must be positive' }
  }
  const available = lots
    .filter((lot) => lot.side === side)
    .reduce((sum, lot) => sum + lot.qty, 0)
  if (available + 1e-12 < qty) {
    return {
      ok: false,
      reason: 'insufficient',
      message: `Insufficient ${side} qty to close ${qty}`,
    }
  }

  const nextId = idFactory ?? (() => nextTradingId('trade'))
  const nextLots: Lot[] = []
  const closedTrades: ClosedTrade[] = []
  let remaining = qty
  let pnlSum = 0

  for (const lot of lots) {
    if (lot.side !== side || remaining <= 0) {
      nextLots.push(lot)
      continue
    }
    const take = Math.min(lot.qty, remaining)
    const pnl = realizedPnl(lot.side, take, lot.entryPrice, exitPrice)
    pnlSum += pnl
    closedTrades.push({
      id: nextId(),
      side: lot.side,
      qty: take,
      entryPrice: lot.entryPrice,
      entryTime: lot.entryTime,
      exitPrice,
      exitTime,
      realizedPnl: pnl,
    })
    remaining -= take
    const leftover = lot.qty - take
    if (leftover > 1e-12) {
      nextLots.push({ ...lot, qty: leftover })
    }
  }

  return { ok: true, lots: nextLots, closedTrades, realizedPnl: pnlSum }
}

export function cancelOrder(
  orders: readonly Order[],
  orderId: string,
): { orders: Order[]; cancelled: Order | null } {
  const index = orders.findIndex((order) => order.id === orderId)
  if (index < 0) {
    return { orders: [...orders], cancelled: null }
  }
  const cancelled = orders[index]!
  return {
    orders: [...orders.slice(0, index), ...orders.slice(index + 1)],
    cancelled,
  }
}

export function placeLimitOrder(
  orders: readonly Order[],
  order: Omit<Order, 'type'> & { type?: OrderType },
): Order[] {
  const next: Order = {
    ...order,
    type: 'limit',
    limitPrice: order.limitPrice,
  }
  return [...orders, next]
}

/** Resting stop-loss (close) or stop entry; trigger price stored in `limitPrice`. */
export function placeStopOrder(
  orders: readonly Order[],
  order: Omit<Order, 'type'> & { type?: OrderType },
): Order[] {
  const next: Order = {
    ...order,
    type: 'stop',
    limitPrice: order.limitPrice,
  }
  return [...orders, next]
}

function isTouched(order: Order, bar: OhlcBar): boolean {
  const trigger = order.limitPrice
  if (trigger == null || !(trigger > 0)) {
    return false
  }

  // Take-profit / limit open: buy below / sell above.
  if (order.type === 'limit') {
    if (order.intent === 'open') {
      if (order.side === 'long') {
        return bar.low <= trigger
      }
      return bar.high >= trigger
    }
    // close = take profit
    if (order.side === 'long') {
      return bar.high >= trigger
    }
    return bar.low <= trigger
  }

  // Stop-loss / stop: adverse touch.
  if (order.type === 'stop') {
    if (order.intent === 'open') {
      if (order.side === 'long') {
        return bar.high >= trigger
      }
      return bar.low <= trigger
    }
    // close = stop loss
    if (order.side === 'long') {
      return bar.low <= trigger
    }
    return bar.high >= trigger
  }

  return false
}

export interface MatchLimitsParams {
  orders: readonly Order[]
  lots: readonly Lot[]
  bar: OhlcBar
  /** Paper balance used for soft-cap re-check on open fills. */
  balance: number
  /** Realized PnL accumulated before this match (for soft-cap after prior fills). */
  realizedPnl?: number
  idFactory?: () => string
}

/**
 * Match resting limit (TP) and stop (SL) orders against a newly revealed bar.
 * Fill price = trigger; full qty only. Soft-cap failure on open cancels without mutating lots.
 */
export function matchLimits(params: MatchLimitsParams): MatchLimitsResult {
  const idFactory = params.idFactory ?? (() => nextTradingId('x'))
  let lots = [...params.lots]
  let runningBalance = params.balance
  let realizedPnlDelta = 0
  const remaining: Order[] = []
  const cancelled: MatchLimitsResult['cancelled'] = []
  const filled: Order[] = []
  const closedTrades: ClosedTrade[] = []

  for (const order of params.orders) {
    const isResting = order.type === 'limit' || order.type === 'stop'
    if (!isResting || !isTouched(order, params.bar)) {
      remaining.push(order)
      continue
    }

    const fillPrice = order.limitPrice!
    const fillTime = params.bar.timestamp

    if (order.intent === 'open') {
      const sized = validateQtyAgainstSoftCap(
        order.qty,
        fillPrice,
        runningBalance,
      )
      if (!sized.ok) {
        if (sized.reason === 'softCapExceeded') {
          cancelled.push({ order, reason: 'softCapExceeded' })
          continue
        }
        // Invalid resting order — leave on book (submit path should prevent this).
        remaining.push(order)
        continue
      }
      const lot: Lot = {
        id: idFactory(),
        side: order.side,
        qty: sized.qty,
        entryPrice: fillPrice,
        entryTime: fillTime,
      }
      lots = [...lots, lot]
      filled.push(order)
      continue
    }

    // close (take-profit limit or stop-loss)
    const closed = closeQtyFifo(
      lots,
      order.side,
      order.qty,
      fillPrice,
      fillTime,
      idFactory,
    )
    if (!closed.ok) {
      // Cannot fill — leave resting (insufficient exposure).
      remaining.push(order)
      continue
    }
    lots = closed.lots
    closedTrades.push(...closed.closedTrades)
    realizedPnlDelta += closed.realizedPnl
    runningBalance += closed.realizedPnl
    filled.push(order)
  }

  return {
    orders: remaining,
    lots,
    closedTrades,
    realizedPnlDelta,
    cancelled,
    filled,
  }
}

/** Last visible candle close + timestamp for market fills. */
export function markFromCandles(
  candles: readonly { close: number; timestamp: string }[],
): { markPrice: number; markTime: string } | null {
  if (candles.length === 0) {
    return null
  }
  const last = candles[candles.length - 1]!
  return { markPrice: last.close, markTime: last.timestamp }
}
