import { describe, expect, it } from 'vitest'
import {
  accountBalance,
  markFromCandles,
  netSides,
  qtyFromPercent,
  validateQtyAgainstSoftCap,
  type Lot,
} from './trading'

describe('qtyFromPercent + soft cap', () => {
  it('converts percent of wallet into qty at mark', () => {
    const result = qtyFromPercent(10_000, 10, 100)
    expect(result).toEqual({ ok: true, qty: 10 })
  })

  it('rejects non-positive percent / mark / balance', () => {
    expect(qtyFromPercent(10_000, 0, 100).ok).toBe(false)
    expect(qtyFromPercent(10_000, 10, 0).ok).toBe(false)
    expect(qtyFromPercent(0, 10, 100).ok).toBe(false)
  })

  it('rejects raw qty when notional exceeds balance', () => {
    const result = validateQtyAgainstSoftCap(2, 10_000, 10_000)
    expect(result).toMatchObject({ ok: false, reason: 'softCapExceeded' })
  })

  it('accepts raw qty on the soft-cap boundary', () => {
    expect(validateQtyAgainstSoftCap(1, 10_000, 10_000)).toEqual({
      ok: true,
      qty: 1,
    })
  })
})

describe('netSides', () => {
  it('reports qty-weighted avg entry for pyramid longs', () => {
    const lots: Lot[] = [
      {
        id: 'l1',
        side: 'long',
        qty: 1,
        entryPrice: 100,
        entryTime: 't1',
      },
      {
        id: 'l2',
        side: 'long',
        qty: 1,
        entryPrice: 120,
        entryTime: 't2',
      },
    ]
    expect(netSides(lots).long).toEqual({ qty: 2, avgEntry: 110 })
    expect(netSides(lots).short).toEqual({ qty: 0, avgEntry: 0 })
  })
})

describe('markFromCandles', () => {
  it('returns last close and timestamp', () => {
    expect(
      markFromCandles([
        { close: 100, timestamp: 'a' },
        { close: 105, timestamp: 'b' },
      ]),
    ).toEqual({ markPrice: 105, markTime: 'b' })
  })

  it('returns null for empty series', () => {
    expect(markFromCandles([])).toBeNull()
  })
})

describe('accountBalance', () => {
  it('is starting + realized', () => {
    expect(
      accountBalance({ startingBalance: 10_000, realizedPnl: -250 }),
    ).toBe(9_750)
  })
})
