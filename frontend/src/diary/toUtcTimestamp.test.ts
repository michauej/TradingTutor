import { describe, expect, it } from 'vitest'
import { parseUtcMillis, toUtcTimestamp } from './toUtcTimestamp'

describe('parseUtcMillis', () => {
  it('treats timezone-less ISO as UTC (not browser local)', () => {
    const withZ = parseUtcMillis('2024-11-25T08:25:00.000Z')
    const bare = parseUtcMillis('2024-11-25T08:25:00')
    expect(bare).toBe(withZ)
  })

  it('keeps explicit offsets', () => {
    const utc = parseUtcMillis('2024-11-25T08:25:00Z')
    const plusOne = parseUtcMillis('2024-11-25T09:25:00+01:00')
    expect(plusOne).toBe(utc)
  })
})

describe('toUtcTimestamp', () => {
  it('floors to UTC seconds', () => {
    expect(toUtcTimestamp('2024-11-25T08:25:00.500Z')).toBe(
      Math.floor(Date.parse('2024-11-25T08:25:00.500Z') / 1000),
    )
  })
})
