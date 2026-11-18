export interface TimestampedCandle {
  timestamp: string
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
  const target = Date.parse(iso)
  if (Number.isNaN(target)) {
    return false
  }
  const first = Date.parse(candles[0]!.timestamp)
  const last = Date.parse(candles[candles.length - 1]!.timestamp)
  if (Number.isNaN(first) || Number.isNaN(last)) {
    return false
  }
  return first <= target && last >= target
}

/**
 * Exclusive playhead on `candles` that keeps the same wall-clock mark time.
 * Uses the first candle strictly after `iso`, or length if `iso` is the last bar.
 */
export function playheadForTimestamp(
  candles: readonly TimestampedCandle[],
  iso: string,
): number {
  if (candles.length === 0) {
    return 0
  }
  const target = Date.parse(iso)
  if (Number.isNaN(target)) {
    return 0
  }

  for (let i = 0; i < candles.length; i += 1) {
    const ms = Date.parse(candles[i]!.timestamp)
    if (Number.isNaN(ms)) {
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
  const target = Date.parse(iso)
  const first = Date.parse(candles[0]!.timestamp)
  const last = Date.parse(candles[candles.length - 1]!.timestamp)
  if (Number.isNaN(target) || Number.isNaN(first) || Number.isNaN(last)) {
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
