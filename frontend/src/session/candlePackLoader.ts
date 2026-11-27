import { parseUtcMillis } from '../diary'
import {
  fetchCandles,
  PACK_PAGE_SIZE,
  type MarketData,
} from '../services/api'
import {
  intervalDurationMs,
  seriesCoversWatermark,
} from './intervalSwitch'

/** Floor pad: at least 2 calendar days each side (keeps 1m switches tight). */
export const TIP_WINDOW_MIN_DAYS_MS = 2 * 24 * 60 * 60_000

/**
 * Floor pad: at least this many bars each side so HTF (1h/4h/1d) keeps chart history.
 * 1h → ~21 days; 4h → ~83 days; 1d → ~500 days (then clamped to From–To).
 */
export const TIP_WINDOW_MIN_BARS = 500

/** @deprecated Use tipWindowPadMs(interval) — kept for older imports. */
export const TIP_WINDOW_PAST_MS = TIP_WINDOW_MIN_DAYS_MS

/** @deprecated Use tipWindowPadMs(interval) — kept for older imports. */
export const TIP_WINDOW_FUTURE_MS = TIP_WINDOW_MIN_DAYS_MS

/** Pad each side of the tip: max(2 days, 500 × bar duration). */
export function tipWindowPadMs(interval: string): number {
  const byBars = TIP_WINDOW_MIN_BARS * intervalDurationMs(interval)
  return Math.max(TIP_WINDOW_MIN_DAYS_MS, byBars)
}

export interface PackSeriesState {
  candles: MarketData[]
  /** Next absolute offset to request (end of currently loaded FE series). */
  nextOffset: number
  totalCount: number
  hasMore: boolean
  /** Query window used for offset pages (tip window or full load range). */
  startTime: string
  endTime: string
}

/** Clamp a tip±pad window into the session load range (pad scales with interval). */
export function tipWindowRange(params: {
  watermarkIso: string
  rangeStartIso: string
  rangeEndIso: string
  interval: string
  pastMs?: number
  futureMs?: number
}): { ok: true; startTime: string; endTime: string } | { ok: false; message: string } {
  const tip = parseUtcMillis(params.watermarkIso)
  const rangeStart = parseUtcMillis(params.rangeStartIso)
  const rangeEnd = parseUtcMillis(params.rangeEndIso)
  if (tip === null || rangeStart === null || rangeEnd === null) {
    return { ok: false, message: 'Invalid tip or load-range timestamps.' }
  }
  const pad = tipWindowPadMs(params.interval)
  const pastMs = params.pastMs ?? pad
  const futureMs = params.futureMs ?? pad
  const startMs = Math.max(rangeStart, tip - pastMs)
  const endMs = Math.min(rangeEnd, tip + futureMs)
  if (!(startMs < endMs)) {
    return {
      ok: false,
      message: 'Tip window does not overlap the loaded candle range.',
    }
  }
  return {
    ok: true,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
  }
}

function sameUtcInstant(a: string, b: string): boolean {
  const am = parseUtcMillis(a)
  const bm = parseUtcMillis(b)
  return am !== null && bm !== null && am === bm
}

/**
 * True when the cached FE pack is the tip±pad window for this watermark
 * (same bounds the server sets on ActivePack during reanchor).
 * Covering the tip alone is not enough — an older tip window can still
 * contain a newer tip, but server playhead indexes the *new* window.
 */
export function packMatchesTipWindow(params: {
  pack: PackSeriesState | null | undefined
  watermarkIso: string
  rangeStartIso: string
  rangeEndIso: string
  interval: string
}): boolean {
  const pack = params.pack
  if (!pack || pack.candles.length === 0) {
    return false
  }
  const window = tipWindowRange({
    watermarkIso: params.watermarkIso,
    rangeStartIso: params.rangeStartIso,
    rangeEndIso: params.rangeEndIso,
    interval: params.interval,
  })
  if (!window.ok) {
    return false
  }
  if (
    !sameUtcInstant(pack.startTime, window.startTime) ||
    !sameUtcInstant(pack.endTime, window.endTime)
  ) {
    return false
  }
  return seriesCoversWatermark(
    pack.candles,
    params.watermarkIso,
    params.interval,
  )
}

function withWindow(
  state: Omit<PackSeriesState, 'startTime' | 'endTime'>,
  startTime: string,
  endTime: string,
): PackSeriesState {
  return { ...state, startTime, endTime }
}

export async function loadFirstPack(params: {
  symbol: string
  interval: string
  startTime: string
  endTime: string
  refresh?: boolean
  signal?: AbortSignal
}): Promise<
  PackSeriesState & {
    source: string
    incomplete: boolean
    message?: string | null
  }
> {
  const page = await fetchCandles({
    ...params,
    offset: 0,
    limit: PACK_PAGE_SIZE,
  })
  const candles = page.candles
  const nextOffset = (page.offset ?? 0) + candles.length
  const totalCount = page.totalCount ?? candles.length
  return {
    candles,
    nextOffset,
    totalCount,
    hasMore: page.hasMore ?? nextOffset < totalCount,
    startTime: params.startTime,
    endTime: params.endTime,
    source: page.source,
    incomplete: page.incomplete,
    message: page.message,
  }
}

/** Append the next pack page onto an existing FE series (absolute offsets). */
export async function loadNextPack(params: {
  symbol: string
  interval: string
  current: PackSeriesState
  /** Optional end extension (prefetch past the tip window). */
  endTime?: string
  signal?: AbortSignal
}): Promise<PackSeriesState> {
  const startTime = params.current.startTime
  const endTime = params.endTime ?? params.current.endTime
  const page = await fetchCandles({
    symbol: params.symbol,
    interval: params.interval,
    startTime,
    endTime,
    offset: params.current.nextOffset,
    limit: PACK_PAGE_SIZE,
    signal: params.signal,
  })
  if (page.candles.length === 0) {
    return withWindow(
      {
        candles: params.current.candles,
        nextOffset: params.current.nextOffset,
        totalCount: params.current.totalCount,
        hasMore: false,
      },
      startTime,
      endTime,
    )
  }
  const candles = params.current.candles.concat(page.candles)
  const nextOffset =
    (page.offset ?? params.current.nextOffset) + page.candles.length
  const totalCount = page.totalCount ?? params.current.totalCount
  return withWindow(
    {
      candles,
      nextOffset,
      totalCount,
      hasMore: page.hasMore ?? nextOffset < totalCount,
    },
    startTime,
    endTime,
  )
}

/**
 * Extend the pack query end toward the session range end, then fetch the next page.
 * Used when play reaches the end of a tip window but more pack history exists.
 */
export function extendPackEndTime(
  currentEndIso: string,
  rangeEndIso: string,
  extendMs: number = TIP_WINDOW_MIN_DAYS_MS,
): string | null {
  const currentEnd = parseUtcMillis(currentEndIso)
  const rangeEnd = parseUtcMillis(rangeEndIso)
  if (currentEnd === null || rangeEnd === null) {
    return null
  }
  if (currentEnd >= rangeEnd) {
    return null
  }
  return new Date(Math.min(rangeEnd, currentEnd + extendMs)).toISOString()
}

/**
 * TF switch: load the full tip±pad window (clamped to load range).
 * Pad = max(2 days, 500 bars) so LTF stays tight and HTF keeps history.
 * Loads every page in the window so the tip sits mid-series (Play still works).
 */
export async function loadPackAroundWatermark(params: {
  symbol: string
  interval: string
  rangeStartIso: string
  rangeEndIso: string
  watermarkIso: string
  signal?: AbortSignal
  maxPages?: number
  pastMs?: number
  futureMs?: number
}): Promise<PackSeriesState> {
  const window = tipWindowRange({
    watermarkIso: params.watermarkIso,
    rangeStartIso: params.rangeStartIso,
    rangeEndIso: params.rangeEndIso,
    interval: params.interval,
    pastMs: params.pastMs,
    futureMs: params.futureMs,
  })
  if (!window.ok) {
    return {
      candles: [],
      nextOffset: 0,
      totalCount: 0,
      hasMore: false,
      startTime: params.rangeStartIso,
      endTime: params.rangeEndIso,
    }
  }

  let state: PackSeriesState = {
    candles: [],
    nextOffset: 0,
    totalCount: 0,
    hasMore: true,
    startTime: window.startTime,
    endTime: window.endTime,
  }
  const maxPages = params.maxPages ?? 40
  for (let i = 0; i < maxPages; i += 1) {
    if (!state.hasMore) {
      break
    }
    const page = await fetchCandles({
      symbol: params.symbol,
      interval: params.interval,
      startTime: state.startTime,
      endTime: state.endTime,
      offset: state.nextOffset,
      limit: PACK_PAGE_SIZE,
      signal: params.signal,
    })
    if (page.candles.length === 0) {
      state = { ...state, hasMore: false }
      break
    }
    const candles = state.candles.concat(page.candles)
    const nextOffset = (page.offset ?? state.nextOffset) + page.candles.length
    const totalCount = page.totalCount ?? Math.max(state.totalCount, nextOffset)
    state = {
      candles,
      nextOffset,
      totalCount,
      hasMore: page.hasMore ?? nextOffset < totalCount,
      startTime: state.startTime,
      endTime: state.endTime,
    }
  }

  return state
}

/** @deprecated Use loadPackAroundWatermark — kept name for older imports. */
export async function loadPacksThroughWatermark(params: {
  symbol: string
  interval: string
  startTime: string
  endTime: string
  watermarkIso: string
  signal?: AbortSignal
  maxPages?: number
}): Promise<PackSeriesState> {
  return loadPackAroundWatermark({
    symbol: params.symbol,
    interval: params.interval,
    rangeStartIso: params.startTime,
    rangeEndIso: params.endTime,
    watermarkIso: params.watermarkIso,
    signal: params.signal,
    maxPages: params.maxPages,
  })
}
