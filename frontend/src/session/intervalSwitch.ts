import { parseUtcMillis } from '../diary/toUtcTimestamp'

export interface TimestampedCandle {
  timestamp: string
}

/** Chart / session intervals supported by the UI (minutes rank ascending = LTF→HTF). */
export const CHART_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const

export type ChartInterval = (typeof CHART_INTERVALS)[number]

const INTERVAL_RANK_MINUTES: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1': 1,
  '5': 5,
  '15': 15,
  '60': 60,
  '240': 240,
  D: 1440,
}

export function intervalRankMinutes(interval: string): number {
  return INTERVAL_RANK_MINUTES[interval.trim()] ?? 60
}

/** True when `next` is a higher timeframe than `current` (coarser bars). */
export function isHigherTimeframe(current: string, next: string): boolean {
  return intervalRankMinutes(next) > intervalRankMinutes(current)
}

export function intervalDurationMs(interval: string): number {
  return intervalRankMinutes(interval) * 60_000
}

/**
 * Wall-clock time of the latest visible candle for an exclusive playhead.
 * Returns null when nothing is visible yet.
 */
export function playheadTimestamp(
  candles: readonly TimestampedCandle[],
  playhead: number,
): string | null {
  if (candles.length === 0 || playhead <= 0) {
    return null
  }
  const index = Math.min(playhead, candles.length) - 1
  return candles[index]?.timestamp ?? null
}

/** True when the series has at least one candle at or before `iso` and one at or after. */
export function seriesCoversTimestamp(
  candles: readonly TimestampedCandle[],
  iso: string,
): boolean {
  if (candles.length === 0) {
    return false
  }
  const target = parseUtcMillis(iso)
  if (target === null) {
    return false
  }
  const first = parseUtcMillis(candles[0]!.timestamp)
  const last = parseUtcMillis(candles[candles.length - 1]!.timestamp)
  if (first === null || last === null) {
    return false
  }
  return first <= target && last >= target
}

/**
 * True when the sim tip falls inside the series, including inside the last bar.
 * Use this for TF switches — LTF tips often sit mid-bar past the last open time.
 */
export function seriesCoversWatermark(
  candles: readonly TimestampedCandle[],
  watermarkIso: string,
  interval: string,
): boolean {
  if (candles.length === 0) {
    return false
  }
  const target = parseUtcMillis(watermarkIso)
  const first = parseUtcMillis(candles[0]!.timestamp)
  const lastOpen = parseUtcMillis(candles[candles.length - 1]!.timestamp)
  if (target === null || first === null || lastOpen === null) {
    return false
  }
  const lastEnd = lastOpen + intervalDurationMs(interval)
  return first <= target && target < lastEnd
}

/**
 * Exclusive playhead on `candles` that keeps the same wall-clock mark time.
 * Uses the first candle strictly after `iso`, or length if `iso` is the last bar.
 * Prefer {@link playheadForWatermark} for TF switches (hides forming bars).
 */
export function playheadForTimestamp(
  candles: readonly TimestampedCandle[],
  iso: string,
): number {
  if (candles.length === 0) {
    return 0
  }
  const target = parseUtcMillis(iso)
  if (target === null) {
    return 0
  }

  for (let i = 0; i < candles.length; i += 1) {
    const ms = parseUtcMillis(candles[i]!.timestamp)
    if (ms === null) {
      continue
    }
    if (ms > target) {
      return i
    }
    if (ms === target) {
      return i + 1
    }
  }

  return candles.length
}

/**
 * Exclusive playhead for the sim watermark on another interval.
 * Includes the in-progress bar that contains the tip (07:25 → 07:00 hour)
 * so HTF switches do not jump back an hour or leave the chart empty.
 * Matches server `SessionService.PlayheadForWatermark`.
 */
export function playheadForWatermark(
  candles: readonly TimestampedCandle[],
  watermarkIso: string,
  interval: string,
): number {
  if (candles.length === 0) {
    return 0
  }
  const target = parseUtcMillis(watermarkIso)
  if (target === null) {
    return 0
  }
  const barMs = intervalDurationMs(interval)

  for (let i = 0; i < candles.length; i += 1) {
    const open = parseUtcMillis(candles[i]!.timestamp)
    if (open === null) {
      continue
    }
    if (open === target) {
      return i + 1
    }
    const end =
      i + 1 < candles.length
        ? parseUtcMillis(candles[i + 1]!.timestamp)
        : open + barMs
    if (end === null) {
      continue
    }
    if (open < target && target < end) {
      return i + 1
    }
    if (open > target) {
      return i
    }
  }

  return candles.length
}

export type IntervalSwitchBlockReason =
  | 'empty'
  | 'too-early'
  | 'too-late'
  | 'load-failed'

export function classifyCoverageGap(
  candles: readonly TimestampedCandle[],
  iso: string,
): IntervalSwitchBlockReason {
  if (candles.length === 0) {
    return 'empty'
  }
  const target = parseUtcMillis(iso)
  const first = parseUtcMillis(candles[0]!.timestamp)
  const last = parseUtcMillis(candles[candles.length - 1]!.timestamp)
  if (target === null || first === null || last === null) {
    return 'empty'
  }
  if (target < first) {
    return 'too-early'
  }
  if (target > last) {
    return 'too-late'
  }
  return 'empty'
}

export function formatIntervalSwitchBlock(params: {
  interval: string
  currentTime: string
  availableFrom?: string
  availableTo?: string
  reason: IntervalSwitchBlockReason
  detail?: string
}): string {
  const tf = params.interval
  if (params.reason === 'load-failed') {
    return (
      params.detail?.trim() ||
      `Could not load ${tf} candles for this range. Staying on the current timeframe.`
    )
  }
  if (params.reason === 'too-early') {
    const from = params.availableFrom
      ? ` Available ${tf} history starts at ${params.availableFrom}.`
      : ''
    return (
      `Cannot switch to ${tf}: lower timeframes often have shorter history, ` +
      `and ${tf} does not cover the current play time (${params.currentTime}).${from}`
    )
  }
  if (params.reason === 'too-late') {
    const to = params.availableTo
      ? ` Available ${tf} history ends at ${params.availableTo}.`
      : ''
    return (
      `Cannot switch to ${tf}: series does not reach the current play time (${params.currentTime}).${to}`
    )
  }
  return (
    `Cannot switch to ${tf}: no candles available for the current play time ` +
    `(${params.currentTime}). Lower timeframes often cannot reach as far back as higher ones.`
  )
}
