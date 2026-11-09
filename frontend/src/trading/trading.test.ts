import { beforeEach, describe, expect, it } from 'vitest'
import {
  accountBalance,
  cancelOrder,
  closeAll,
  closeLotById,
  closeMarketFifo,
  matchLimits,
  netSides,
  openMarket,
  placeLimitOrder,
  qtyFromPercent,
  realizedPnl,
  resetTradingIdSeq,
  validateQtyAgainstSoftCap,
  type Lot,
  type OhlcBar,
  type Order,
} from './trading'

beforeEach(() => {
  resetTradingIdSeq()
})

function bar(partial: Partial<OhlcBar> & Pick<OhlcBar, 'low' | 'high'>): OhlcBar {
  return {
    open: partial.open ?? partial.low,
    close: partial.close ?? partial.high,
    timestamp: partial.timestamp ?? '2024-06-01T01:00:00.000Z',
    low: partial.low,
    high: partial.high,
  }
}

function limitOrder(
  overrides: Partial<Order> & Pick<Order, 'side' | 'intent' | 'qty' | 'limitPrice'>,
): Order {
  return {
    id: overrides.id ?? `ord-${overrides.side}-${overrides.intent}`,
    type: 'limit',
    createdAt: overrides.createdAt ?? '2024-06-01T00:00:00.000Z',
    side: overrides.side,
    intent: overrides.intent,
    qty: overrides.qty,
    limitPrice: overrides.limitPrice,
  }
}

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

describe('market open pyramid + hedge', () => {
  it('pyramids two longs and reports net avg entry', () => {
    const first = openMarket({
      lots: [],
      side: 'long',
      qty: 1,
      markPrice: 100,
      markTime: 't1',
      balance: 10_000,
      id: 'l1',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = openMarket({
      lots: first.lots,
      side: 'long',
      qty: 1,
      markPrice: 120,
      markTime: 't2',
      balance: 10_000,
      id: 'l2',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.lots).toHaveLength(2)
    expect(netSides(second.lots).long).toEqual({ qty: 2, avgEntry: 110 })
    expect(netSides(second.lots).short).toEqual({ qty: 0, avgEntry: 0 })
  })

  it('allows concurrent long + short (hedge)', () => {
    const longOpen = openMarket({
      lots: [],
      side: 'long',
      qty: 1,
      markPrice: 100,
      markTime: 't1',
      balance: 10_000,
      id: 'l1',
    })
    if (!longOpen.ok) throw new Error('expected open')
    const shortOpen = openMarket({
      lots: longOpen.lots,
      side: 'short',
      qty: 2,
      markPrice: 110,
      markTime: 't2',
      balance: 10_000,
      id: 's1',
    })
    if (!shortOpen.ok) throw new Error('expected open')
    const nets = netSides(shortOpen.lots)
    expect(nets.long).toEqual({ qty: 1, avgEntry: 100 })
    expect(nets.short).toEqual({ qty: 2, avgEntry: 110 })
  })
})

describe('FIFO close + close-all', () => {
  const lots: Lot[] = [
    {
      id: 'a',
      side: 'long',
      qty: 1,
      entryPrice: 100,
      entryTime: 't1',
    },
    {
      id: 'b',
      side: 'long',
      qty: 1,
      entryPrice: 120,
      entryTime: 't2',
    },
    {
      id: 'c',
      side: 'short',
      qty: 1,
      entryPrice: 130,
      entryTime: 't3',
    },
  ]

  it('closes the oldest lot on the chosen side first', () => {
    const result = closeMarketFifo({
      lots,
      side: 'long',
      exitPrice: 150,
      exitTime: 'exit',
      tradeId: 'tr1',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.closedTrade).toMatchObject({
      id: 'tr1',
      side: 'long',
      qty: 1,
      entryPrice: 100,
      exitPrice: 150,
      realizedPnl: 50,
    })
    expect(result.lots.map((lot) => lot.id)).toEqual(['b', 'c'])
  })

  it('close-all flattens both sides', () => {
    const result = closeAll({
      lots,
      exitPrice: 110,
      exitTime: 'exit',
      idFactory: (() => {
        let n = 0
        return () => `t${++n}`
      })(),
    })
    expect(result.lots).toEqual([])
    expect(result.closedTrades).toHaveLength(3)
    // long 100→110 = +10; long 120→110 = -10; short 130→110 = +20
    expect(result.realizedPnl).toBe(20)
  })

  it('reports flat when no lots on side', () => {
    const result = closeMarketFifo({
      lots: lots.filter((lot) => lot.side === 'long'),
      side: 'short',
      exitPrice: 1,
      exitTime: 'x',
    })
    expect(result).toMatchObject({ ok: false, reason: 'flat' })
  })

  it('closes a specific lot by id', () => {
    const result = closeLotById({
      lots,
      lotId: 'b',
      exitPrice: 130,
      exitTime: 'exit',
      tradeId: 'by-id',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.closedTrade).toMatchObject({
      id: 'by-id',
      side: 'long',
      entryPrice: 120,
      exitPrice: 130,
      realizedPnl: 10,
    })
    expect(result.lots.map((lot) => lot.id)).toEqual(['a', 'c'])
  })
})

describe('realized PnL signs', () => {
  it('is positive for long up and short down', () => {
    expect(realizedPnl('long', 2, 100, 110)).toBe(20)
    expect(realizedPnl('short', 2, 100, 90)).toBe(20)
  })

  it('is negative for long down and short up', () => {
    expect(realizedPnl('long', 1, 100, 90)).toBe(-10)
    expect(realizedPnl('short', 1, 100, 110)).toBe(-10)
  })
})

describe('limit touch matching', () => {
  it('fills open long when bar low touches limit (wick)', () => {
    const orders = [
      limitOrder({
        id: 'ol',
        side: 'long',
        intent: 'open',
        qty: 1,
        limitPrice: 95,
      }),
    ]
    const result = matchLimits({
      orders,
      lots: [],
      bar: bar({ low: 94, high: 101, open: 100, close: 99 }),
      balance: 10_000,
      idFactory: () => 'lot-1',
    })
    expect(result.filled).toHaveLength(1)
    expect(result.lots).toEqual([
      {
        id: 'lot-1',
        side: 'long',
        qty: 1,
        entryPrice: 95,
        entryTime: '2024-06-01T01:00:00.000Z',
      },
    ])
    expect(result.orders).toEqual([])
  })

  it('fills open short when bar high touches limit', () => {
    const result = matchLimits({
      orders: [
        limitOrder({
          id: 'os',
          side: 'short',
          intent: 'open',
          qty: 1,
          limitPrice: 105,
        }),
      ],
      lots: [],
      bar: bar({ low: 100, high: 105, close: 104 }),
      balance: 10_000,
      idFactory: () => 'lot-s',
    })
    expect(result.filled.map((o) => o.id)).toEqual(['os'])
    expect(result.lots[0]).toMatchObject({
      side: 'short',
      entryPrice: 105,
    })
  })

  it('does not fill when the bar does not touch the limit', () => {
    const orders = [
      limitOrder({
        id: 'ol',
        side: 'long',
        intent: 'open',
        qty: 1,
        limitPrice: 90,
      }),
    ]
    const result = matchLimits({
      orders,
      lots: [],
      bar: bar({ low: 95, high: 100 }),
      balance: 10_000,
    })
    expect(result.filled).toEqual([])
    expect(result.orders).toEqual(orders)
    expect(result.lots).toEqual([])
  })

  it('fills close long when high touches; close short when low touches @ limit', () => {
    const lots: Lot[] = [
      {
        id: 'l1',
        side: 'long',
        qty: 1,
        entryPrice: 100,
        entryTime: 't0',
      },
      {
        id: 's1',
        side: 'short',
        qty: 1,
        entryPrice: 100,
        entryTime: 't0',
      },
    ]
    const result = matchLimits({
      orders: [
        limitOrder({
          id: 'cl',
          side: 'long',
          intent: 'close',
          qty: 1,
          limitPrice: 110,
        }),
        limitOrder({
          id: 'cs',
          side: 'short',
          intent: 'close',
          qty: 1,
          limitPrice: 90,
        }),
      ],
      lots,
      bar: bar({ low: 90, high: 110 }),
      balance: 10_000,
      idFactory: (() => {
        let n = 0
        return () => `tr-${++n}`
      })(),
    })
    expect(result.filled.map((o) => o.id)).toEqual(['cl', 'cs'])
    expect(result.lots).toEqual([])
    expect(result.closedTrades).toHaveLength(2)
    expect(result.closedTrades[0]).toMatchObject({
      side: 'long',
      exitPrice: 110,
      realizedPnl: 10,
    })
    expect(result.closedTrades[1]).toMatchObject({
      side: 'short',
      exitPrice: 90,
      realizedPnl: 10,
    })
    expect(result.realizedPnlDelta).toBe(20)
  })

  it('fills stop-loss long when bar low touches stop; short when high touches', () => {
    const lots: Lot[] = [
      {
        id: 'l1',
        side: 'long',
        qty: 1,
        entryPrice: 100,
        entryTime: 't0',
      },
      {
        id: 's1',
        side: 'short',
        qty: 1,
        entryPrice: 100,
        entryTime: 't0',
      },
    ]
    const result = matchLimits({
      orders: [
        {
          id: 'sl-l',
          side: 'long',
          intent: 'close',
          type: 'stop',
          qty: 1,
          limitPrice: 90,
          createdAt: 't0',
        },
        {
          id: 'sl-s',
          side: 'short',
          intent: 'close',
          type: 'stop',
          qty: 1,
          limitPrice: 110,
          createdAt: 't0',
        },
      ],
      lots,
      bar: bar({ low: 90, high: 110 }),
      balance: 10_000,
      idFactory: (() => {
        let n = 0
        return () => `tr-${++n}`
      })(),
    })
    expect(result.filled.map((o) => o.id)).toEqual(['sl-l', 'sl-s'])
    expect(result.lots).toEqual([])
    expect(result.closedTrades[0]).toMatchObject({
      side: 'long',
      exitPrice: 90,
      realizedPnl: -10,
    })
    expect(result.closedTrades[1]).toMatchObject({
      side: 'short',
      exitPrice: 110,
      realizedPnl: -10,
    })
  })

  it('leaves stop-loss resting when adverse price is not touched', () => {
    const order: Order = {
      id: 'sl',
      side: 'long',
      intent: 'close',
      type: 'stop',
      qty: 1,
      limitPrice: 90,
      createdAt: 't0',
    }
    const result = matchLimits({
      orders: [order],
      lots: [
        {
          id: 'l1',
          side: 'long',
          qty: 1,
          entryPrice: 100,
          entryTime: 't0',
        },
      ],
      bar: bar({ low: 95, high: 105 }),
      balance: 10_000,
    })
    expect(result.filled).toEqual([])
    expect(result.orders).toEqual([order])
  })

  it('cancels open fill without mutating lots when soft cap fails at fill', () => {
    const order = limitOrder({
      id: 'big',
      side: 'long',
      intent: 'open',
      qty: 2,
      limitPrice: 10_000,
    })
    const result = matchLimits({
      orders: [order],
      lots: [],
      bar: bar({ low: 9_000, high: 10_000 }),
      balance: 10_000,
    })
    expect(result.lots).toEqual([])
    expect(result.filled).toEqual([])
    expect(result.orders).toEqual([])
    expect(result.cancelled).toEqual([
      { order, reason: 'softCapExceeded' },
    ])
  })
})

describe('multi-order book + cancel', () => {
  it('keeps many resting limits and cancels by id', () => {
    let orders = placeLimitOrder(
      [],
      limitOrder({
        id: 'a',
        side: 'long',
        intent: 'open',
        qty: 1,
        limitPrice: 90,
      }),
    )
    orders = placeLimitOrder(
      orders,
      limitOrder({
        id: 'b',
        side: 'short',
        intent: 'open',
        qty: 1,
        limitPrice: 120,
      }),
    )
    expect(orders).toHaveLength(2)
    const cancelled = cancelOrder(orders, 'a')
    expect(cancelled.cancelled?.id).toBe('a')
    expect(cancelled.orders.map((o) => o.id)).toEqual(['b'])
  })
})

describe('accountBalance', () => {
  it('is starting + realized', () => {
    expect(
      accountBalance({ startingBalance: 10_000, realizedPnl: -250 }),
    ).toBe(9_750)
  })
})
