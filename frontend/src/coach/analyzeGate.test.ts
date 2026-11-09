import { describe, expect, it } from 'vitest'
import { getAnalyzeGate, MIN_CLOSED_TRADES_FOR_ANALYZE } from './analyzeGate'
import { mapClosedTradesForCoach } from './mapClosedTradesForCoach'
import type { ClosedTrade } from '../trading/types'

describe('getAnalyzeGate', () => {
  it('disables at 0 with remaining 5', () => {
    const gate = getAnalyzeGate(0)
    expect(gate.canAnalyze).toBe(false)
    expect(gate.remainingToAnalyze).toBe(5)
    expect(gate.hint).toBe('Need 5 more closed trades to analyze.')
  })

  it('disables at 4 with remaining 1', () => {
    const gate = getAnalyzeGate(4)
    expect(gate.canAnalyze).toBe(false)
    expect(gate.remainingToAnalyze).toBe(1)
    expect(gate.hint).toBe('Need 1 more closed trade to analyze.')
  })

  it('enables at 5 with empty hint', () => {
    const gate = getAnalyzeGate(5)
    expect(gate.canAnalyze).toBe(true)
    expect(gate.remainingToAnalyze).toBe(0)
    expect(gate.hint).toBe('')
  })

  it('enables at 6+', () => {
    const gate = getAnalyzeGate(6)
    expect(gate.canAnalyze).toBe(true)
    expect(gate.remainingToAnalyze).toBe(0)
    expect(MIN_CLOSED_TRADES_FOR_ANALYZE).toBe(5)
  })
})

describe('mapClosedTradesForCoach', () => {
  it('maps ClosedTrade fields 1:1 for the API payload', () => {
    const trade: ClosedTrade = {
      id: 't1',
      side: 'short',
      qty: 0.5,
      entryPrice: 100,
      entryTime: '2024-01-01T00:00:00.000Z',
      exitPrice: 90,
      exitTime: '2024-01-01T01:00:00.000Z',
      realizedPnl: 5,
    }

    expect(mapClosedTradesForCoach([trade])).toEqual([
      {
        id: 't1',
        side: 'short',
        qty: 0.5,
        entryPrice: 100,
        entryTime: '2024-01-01T00:00:00.000Z',
        exitPrice: 90,
        exitTime: '2024-01-01T01:00:00.000Z',
        realizedPnl: 5,
      },
    ])
  })
})
