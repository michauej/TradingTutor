import { describe, expect, it } from 'vitest'
import {
  classifyCoverageGap,
  formatIntervalSwitchBlock,
  playheadForTimestamp,
  playheadTimestamp,
  seriesCoversTimestamp,
} from './intervalSwitch'

const series = [
  { timestamp: '2024-11-01T00:00:00.000Z' },
  { timestamp: '2024-11-01T01:00:00.000Z' },
  { timestamp: '2024-11-01T02:00:00.000Z' },
]

describe('playheadTimestamp', () => {
  it('returns the last visible candle time for an exclusive playhead', () => {
    expect(playheadTimestamp(series, 2)).toBe('2024-11-01T01:00:00.000Z')
  })

  it('returns null when nothing is visible', () => {
    expect(playheadTimestamp(series, 0)).toBeNull()
  })
})

describe('seriesCoversTimestamp', () => {
  it('is true when target sits inside the series span', () => {
    expect(seriesCoversTimestamp(series, '2024-11-01T01:00:00.000Z')).toBe(true)
  })

  it('is false when target is before the first bar', () => {
    expect(seriesCoversTimestamp(series, '2024-10-31T23:00:00.000Z')).toBe(
      false,
    )
  })
})

describe('playheadForTimestamp', () => {
  it('maps an exact bar time to exclusive playhead after that bar', () => {
    expect(playheadForTimestamp(series, '2024-11-01T01:00:00.000Z')).toBe(2)
  })

  it('maps a time between bars to the next bar index', () => {
    expect(playheadForTimestamp(series, '2024-11-01T01:30:00.000Z')).toBe(2)
  })
})

describe('formatIntervalSwitchBlock', () => {
  it('explains shorter lower-TF history on too-early', () => {
    const message = formatIntervalSwitchBlock({
      interval: '1m',
      currentTime: '2024-10-01T00:00:00.000Z',
      availableFrom: '2024-11-01T00:00:00.000Z',
      reason: 'too-early',
    })
    expect(message).toContain('1m')
    expect(message).toContain('shorter history')
    expect(message).toContain('2024-11-01T00:00:00.000Z')
  })

  it('classifies too-early gaps', () => {
    expect(classifyCoverageGap(series, '2024-10-01T00:00:00.000Z')).toBe(
      'too-early',
    )
  })
})
