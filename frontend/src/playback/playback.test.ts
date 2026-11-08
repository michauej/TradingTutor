import { describe, expect, it } from 'vitest'
import {
  WARMUP_CANDLES,
  advancePlayhead,
  delayForSpeed,
  initialPlayhead,
  isAtEnd,
  resolveSessionStartIndex,
  type TimestampedCandle,
} from './playback'

function candlesFromDates(isoDates: string[]): TimestampedCandle[] {
  return isoDates.map((timestamp) => ({ timestamp }))
}

/** Build `count` hourly candles starting at `startIso`. */
function hourlySeries(startIso: string, count: number): TimestampedCandle[] {
  const start = Date.parse(startIso)
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(start + i * 60 * 60 * 1000).toISOString(),
  }))
}

describe('resolveSessionStartIndex', () => {
  it('returns 0 for an empty series', () => {
    expect(resolveSessionStartIndex([], '2024-01-01T00:00:00.000Z')).toBe(0)
  })

  it('clamps to 0 when the start date is before the first candle', () => {
    const candles = hourlySeries('2024-06-01T00:00:00.000Z', 10)
    expect(resolveSessionStartIndex(candles, '2024-01-01T00:00:00.000Z')).toBe(0)
  })

  it('returns the first candle at or after the start date', () => {
    const candles = candlesFromDates([
      '2024-06-01T00:00:00.000Z',
      '2024-06-01T01:00:00.000Z',
      '2024-06-01T02:00:00.000Z',
      '2024-06-01T03:00:00.000Z',
    ])
    expect(resolveSessionStartIndex(candles, '2024-06-01T02:00:00.000Z')).toBe(2)
    expect(resolveSessionStartIndex(candles, '2024-06-01T01:30:00.000Z')).toBe(2)
  })

  it('returns length (empty remaining session) when the start date is after the last candle', () => {
    const candles = hourlySeries('2024-06-01T00:00:00.000Z', 5)
    expect(resolveSessionStartIndex(candles, '2024-12-31T00:00:00.000Z')).toBe(5)
  })
})

describe('initialPlayhead', () => {
  it(`reveals ${WARMUP_CANDLES} candles from start when enough remain`, () => {
    expect(initialPlayhead(0, 1000)).toBe(WARMUP_CANDLES)
    expect(initialPlayhead(100, 1000)).toBe(100 + WARMUP_CANDLES)
  })

  it('clamps to length when remaining candles after start are fewer than warm-up', () => {
    expect(initialPlayhead(0, 50)).toBe(50)
    expect(initialPlayhead(900, 1000)).toBe(1000)
    expect(initialPlayhead(950, 1000)).toBe(1000)
  })

  it('returns length when start is already at end (empty remaining window)', () => {
    expect(initialPlayhead(1000, 1000)).toBe(1000)
  })

  it('returns 0 for empty length', () => {
    expect(initialPlayhead(0, 0)).toBe(0)
  })
})

describe('advancePlayhead', () => {
  it('advances by one while candles remain', () => {
    expect(advancePlayhead(300, 1000)).toEqual({
      kind: 'advanced',
      playhead: 301,
    })
  })

  it('signals atEnd when advancing onto the last candle', () => {
    expect(advancePlayhead(999, 1000)).toEqual({
      kind: 'atEnd',
      playhead: 1000,
    })
  })

  it('signals atEnd when already at the end', () => {
    expect(advancePlayhead(1000, 1000)).toEqual({
      kind: 'atEnd',
      playhead: 1000,
    })
  })

  it('signals atEnd for an empty series', () => {
    expect(advancePlayhead(0, 0)).toEqual({ kind: 'atEnd', playhead: 0 })
  })
})

describe('isAtEnd', () => {
  it('is true when playhead reaches length', () => {
    expect(isAtEnd(1000, 1000)).toBe(true)
    expect(isAtEnd(300, 1000)).toBe(false)
    expect(isAtEnd(0, 0)).toBe(true)
  })
})

describe('delayForSpeed', () => {
  it('maps 1x / 2x / 5x to strictly shorter delays', () => {
    const d1 = delayForSpeed(1)
    const d2 = delayForSpeed(2)
    const d5 = delayForSpeed(5)
    expect(d1).toBe(500)
    expect(d2).toBe(250)
    expect(d5).toBe(100)
    expect(d5).toBeLessThan(d2)
    expect(d2).toBeLessThan(d1)
  })
})
