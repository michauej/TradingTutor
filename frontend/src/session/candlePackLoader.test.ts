import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PACK_PAGE_SIZE, type MarketData } from '../services/api'
import {
  extendPackEndTime,
  loadFirstPack,
  loadNextPack,
  loadPackAroundWatermark,
  packMatchesTipWindow,
  tipWindowPadMs,
  tipWindowRange,
  TIP_WINDOW_MIN_BARS,
  TIP_WINDOW_MIN_DAYS_MS,
  type PackSeriesState,
} from './candlePackLoader'
import { intervalDurationMs, seriesCoversWatermark } from './intervalSwitch'

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>()
  return {
    ...actual,
    fetchCandles: vi.fn(),
  }
})

import { fetchCandles } from '../services/api'

function bar(iso: string): MarketData {
  return {
    symbol: 'BTCUSDT',
    exchange: 'ByBit',
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1,
    timestamp: iso,
    interval: '1h',
  }
}

describe('tipWindowPadMs', () => {
  it('keeps 2 days for 1m', () => {
    expect(tipWindowPadMs('1m')).toBe(TIP_WINDOW_MIN_DAYS_MS)
  })

  it('uses 500 bars for 1h (~21 days)', () => {
    const expected = TIP_WINDOW_MIN_BARS * intervalDurationMs('1h')
    expect(tipWindowPadMs('1h')).toBe(expected)
    expect(expected).toBeGreaterThan(TIP_WINDOW_MIN_DAYS_MS)
  })
})

describe('tipWindowRange', () => {
  it('clamps tip±pad into the load range for 1m', () => {
    const tip = '2024-10-13T12:00:00.000Z'
    const pad = tipWindowPadMs('1m')
    const window = tipWindowRange({
      watermarkIso: tip,
      rangeStartIso: '2024-08-25T00:00:00.000Z',
      rangeEndIso: '2024-11-19T00:00:00.000Z',
      interval: '1m',
    })
    expect(window.ok).toBe(true)
    if (!window.ok) {
      return
    }
    expect(window.startTime).toBe(new Date(Date.parse(tip) - pad).toISOString())
    expect(window.endTime).toBe(new Date(Date.parse(tip) + pad).toISOString())
  })

  it('gives 1h a longer past window than 2 days', () => {
    const tip = '2024-10-13T12:00:00.000Z'
    const window = tipWindowRange({
      watermarkIso: tip,
      rangeStartIso: '2024-01-01T00:00:00.000Z',
      rangeEndIso: '2024-11-19T00:00:00.000Z',
      interval: '1h',
    })
    expect(window.ok).toBe(true)
    if (!window.ok) {
      return
    }
    const pastMs = Date.parse(tip) - Date.parse(window.startTime)
    expect(pastMs).toBeGreaterThan(TIP_WINDOW_MIN_DAYS_MS)
    expect(pastMs).toBe(tipWindowPadMs('1h'))
  })

  it('does not start before the pack range', () => {
    const window = tipWindowRange({
      watermarkIso: '2024-08-26T00:00:00.000Z',
      rangeStartIso: '2024-08-25T00:00:00.000Z',
      rangeEndIso: '2024-11-19T00:00:00.000Z',
      interval: '1h',
    })
    expect(window.ok).toBe(true)
    if (!window.ok) {
      return
    }
    expect(window.startTime).toBe('2024-08-25T00:00:00.000Z')
  })
})

describe('packMatchesTipWindow', () => {
  const rangeStart = '2026-08-29T00:00:00.000Z'
  const rangeEnd = '2026-11-27T23:00:00.000Z'
  const tip = '2026-09-11T11:45:00.000Z'

  function packFor(
    startTime: string,
    endTime: string,
    candles: MarketData[],
  ): PackSeriesState {
    return {
      candles,
      nextOffset: candles.length,
      totalCount: candles.length,
      hasMore: false,
      startTime,
      endTime,
    }
  }

  it('accepts a pack whose bounds match the current tip±pad window', () => {
    const window = tipWindowRange({
      watermarkIso: tip,
      rangeStartIso: rangeStart,
      rangeEndIso: rangeEnd,
      interval: '5m',
    })
    expect(window.ok).toBe(true)
    if (!window.ok) {
      return
    }
    const pack = packFor(window.startTime, window.endTime, [
      bar(window.startTime),
      bar(tip),
      bar(window.endTime),
    ])
    expect(
      packMatchesTipWindow({
        pack,
        watermarkIso: tip,
        rangeStartIso: rangeStart,
        rangeEndIso: rangeEnd,
        interval: '5m',
      }),
    ).toBe(true)
  })

  it('rejects an older tip window that still covers a newer tip', () => {
    // Previous tip ~2 days earlier: window still contains Sep 11 11:45,
    // but server playhead indexes the *new* window — reuse would jump back.
    const oldTip = '2026-09-10T19:55:00.000Z'
    const oldWindow = tipWindowRange({
      watermarkIso: oldTip,
      rangeStartIso: rangeStart,
      rangeEndIso: rangeEnd,
      interval: '5m',
    })
    expect(oldWindow.ok).toBe(true)
    if (!oldWindow.ok) {
      return
    }
    const pack = packFor(oldWindow.startTime, oldWindow.endTime, [
      bar(oldWindow.startTime),
      bar(oldTip),
      bar(tip),
      bar(oldWindow.endTime),
    ])
    expect(
      seriesCoversWatermark(pack.candles, tip, '5m'),
    ).toBe(true)
    expect(
      packMatchesTipWindow({
        pack,
        watermarkIso: tip,
        rangeStartIso: rangeStart,
        rangeEndIso: rangeEnd,
        interval: '5m',
      }),
    ).toBe(false)
  })
})

describe('extendPackEndTime', () => {
  it('extends toward the session range end', () => {
    const next = extendPackEndTime(
      '2024-10-15T12:00:00.000Z',
      '2024-11-19T00:00:00.000Z',
      tipWindowPadMs('1h'),
    )
    expect(next).toBe(
      new Date(
        Date.parse('2024-10-15T12:00:00.000Z') + tipWindowPadMs('1h'),
      ).toISOString(),
    )
  })

  it('returns null at the range end', () => {
    expect(
      extendPackEndTime(
        '2024-11-19T00:00:00.000Z',
        '2024-11-19T00:00:00.000Z',
      ),
    ).toBeNull()
  })
})

describe('candlePackLoader', () => {
  beforeEach(() => {
    vi.mocked(fetchCandles).mockReset()
  })

  it('loadFirstPack requests offset 0 with PACK_PAGE_SIZE', async () => {
    vi.mocked(fetchCandles).mockResolvedValue({
      candles: [bar('2024-01-01T00:00:00.000Z')],
      source: 'local',
      incomplete: false,
      offset: 0,
      totalCount: 1200,
      hasMore: true,
    })

    const pack = await loadFirstPack({
      symbol: 'BTCUSDT',
      interval: '1h',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-02-01T00:00:00.000Z',
    })

    expect(fetchCandles).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: 0,
        limit: PACK_PAGE_SIZE,
      }),
    )
    expect(pack.nextOffset).toBe(1)
    expect(pack.hasMore).toBe(true)
    expect(pack.startTime).toBe('2024-01-01T00:00:00.000Z')
  })

  it('loadNextPack appends the next page', async () => {
    vi.mocked(fetchCandles).mockResolvedValue({
      candles: [bar('2024-01-01T01:00:00.000Z')],
      source: 'local',
      incomplete: false,
      offset: 1,
      totalCount: 2,
      hasMore: false,
    })

    const next = await loadNextPack({
      symbol: 'BTCUSDT',
      interval: '1h',
      current: {
        candles: [bar('2024-01-01T00:00:00.000Z')],
        nextOffset: 1,
        totalCount: 2,
        hasMore: true,
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-02-01T00:00:00.000Z',
      },
    })

    expect(next.candles).toHaveLength(2)
    expect(next.nextOffset).toBe(2)
    expect(next.hasMore).toBe(false)
  })

  it('loadPackAroundWatermark queries tip±pad, not pack start', async () => {
    const tip = '2024-10-13T12:00:00.000Z'
    const pad = tipWindowPadMs('1h')
    const windowStart = new Date(Date.parse(tip) - pad).toISOString()
    const windowEnd = new Date(Date.parse(tip) + pad).toISOString()

    vi.mocked(fetchCandles)
      .mockResolvedValueOnce({
        candles: [
          bar('2024-10-11T12:00:00.000Z'),
          bar('2024-10-12T12:00:00.000Z'),
        ],
        source: 'local',
        incomplete: false,
        offset: 0,
        totalCount: 4,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        candles: [
          bar('2024-10-13T12:00:00.000Z'),
          bar('2024-10-14T12:00:00.000Z'),
        ],
        source: 'local',
        incomplete: false,
        offset: 2,
        totalCount: 4,
        hasMore: false,
      })

    const state = await loadPackAroundWatermark({
      symbol: 'BTCUSDT',
      interval: '1h',
      rangeStartIso: '2024-08-25T00:00:00.000Z',
      rangeEndIso: '2024-11-19T00:00:00.000Z',
      watermarkIso: tip,
    })

    expect(fetchCandles).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        startTime: windowStart,
        endTime: windowEnd,
        offset: 0,
      }),
    )
    expect(fetchCandles).toHaveBeenCalledTimes(2)
    expect(state.startTime).toBe(windowStart)
    expect(state.candles).toHaveLength(4)
    expect(state.hasMore).toBe(false)
  })
})
