import { describe, expect, it } from 'vitest'
import {
  alignDownToInterval,
  defaultCandleRange,
  formatCandleLoadStatus,
} from './candleLoadRange'

describe('defaultCandleRange', () => {
  it('returns last N days ending on an aligned interval boundary', () => {
    const now = new Date('2024-11-08T15:37:12.000Z')
    const range = defaultCandleRange({ lastDays: 7, interval: '1h', now })

    expect(range.endTime).toBe('2024-11-08T15:00:00.000Z')
    expect(range.startTime).toBe('2024-11-01T15:00:00.000Z')
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
