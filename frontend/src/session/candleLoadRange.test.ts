import { describe, expect, it } from 'vitest'
import {
  alignDownToInterval,
  candleRangeFromDates,
  defaultCandleRange,
  defaultRangeDates,
  earliestFromDateForInterval,
  formatCandleLoadStatus,
  MAX_BARS_PER_LOAD,
} from './candleLoadRange'

describe('defaultCandleRange', () => {
  it('returns last N days ending on an aligned interval boundary', () => {
    const now = new Date('2024-11-08T15:37:12.000Z')
    const range = defaultCandleRange({ lastDays: 7, interval: '1h', now })

    expect(range.endTime).toBe('2024-11-08T15:00:00.000Z')
    expect(range.startTime).toBe('2024-11-01T15:00:00.000Z')
  })
})

describe('defaultRangeDates', () => {
  it('returns UTC calendar From/To for last N days', () => {
    const now = new Date('2024-11-08T15:37:12.000Z')
    const range = defaultRangeDates({ lastDays: 90, now })
    expect(range.endDate).toBe('2024-11-08')
    expect(range.startDate).toBe('2024-08-10')
  })
})

describe('earliestFromDateForInterval', () => {
  it('sets From so ~MaxBars 1d candles fit before To', () => {
    const from = earliestFromDateForInterval({
      endDate: '2024-11-08',
      interval: '1d',
      maxBars: 100,
    })
    expect(from).toBe('2024-08-01')
  })

  it('uses MaxBarsPerLoad by default for 1h', () => {
    const from = earliestFromDateForInterval({
      endDate: '2024-11-08',
      interval: '1h',
    })
    expect(from).not.toBeNull()
    // ~10000 hours ≈ 416 days before end-of-day 2024-11-08
    expect(from).toBe(
      earliestFromDateForInterval({
        endDate: '2024-11-08',
        interval: '1h',
        maxBars: MAX_BARS_PER_LOAD,
      }),
    )
  })
})

describe('candleRangeFromDates', () => {
  it('builds an aligned ISO range from date inputs', () => {
    const range = candleRangeFromDates({
      startDate: '2024-01-01',
      endDate: '2024-06-30',
      interval: '1d',
    })
    expect(range.ok).toBe(true)
    if (!range.ok) {
      return
    }
    expect(range.startTime).toBe('2024-01-01T00:00:00.000Z')
    expect(range.endTime).toBe('2024-06-30T00:00:00.000Z')
  })

  it('rejects inverted dates', () => {
    const range = candleRangeFromDates({
      startDate: '2024-06-30',
      endDate: '2024-01-01',
      interval: '1d',
    })
    expect(range.ok).toBe(false)
  })
})

describe('alignDownToInterval', () => {
  it('floors to 1h boundary', () => {
    const aligned = alignDownToInterval(
      new Date('2024-11-08T15:37:12.000Z'),
      '1h',
    )
    expect(aligned.toISOString()).toBe('2024-11-08T15:00:00.000Z')
  })
})

describe('formatCandleLoadStatus', () => {
  it('mentions local pack source', () => {
    expect(
      formatCandleLoadStatus({
        source: 'local',
        incomplete: false,
        candleCount: 42,
      }),
    ).toBe('Loaded 42 candles from local pack.')
  })

  it('surfaces incomplete warning from message', () => {
    expect(
      formatCandleLoadStatus({
        source: 'partial',
        incomplete: true,
        message: 'Stopped at MaxBarsPerLoad (10000).',
        candleCount: 10000,
      }),
    ).toContain('Warning: Stopped at MaxBarsPerLoad (10000).')
  })
})
