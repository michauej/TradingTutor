import type {
  Account,
  Lot,
  NetSide,
  Side,
  SoftCapReason,
} from './types'

export type {
  Account,
  CancelReason,
  ClosedTrade,
  Lot,
  NetSide,
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

export function accountBalance(account: Account): number {
  return account.startingBalance + account.realizedPnl
}

/** Unrealized / realized PnL for a lot (1x paper) — display helper. */
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

/**
 * Convert a percent-of-wallet sizing input into qty at `markPrice`.
 * Client-side preview only — server re-validates on open.
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

/** Accept raw qty if positive and within soft notional cap vs balance (preview). */
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

/** Last visible candle close + timestamp for display mark. */
export function markFromCandles(
  candles: readonly { close: number; timestamp: string }[],
): { markPrice: number; markTime: string } | null {
  if (candles.length === 0) {
    return null
  }
  const last = candles[candles.length - 1]!
  return { markPrice: last.close, markTime: last.timestamp }
}
