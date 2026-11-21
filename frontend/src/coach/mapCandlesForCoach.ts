import type { MarketData } from '../services/api'

/** Compact candle DTO for POST /api/coach/analyze (camelCase JSON). */
export interface CoachCandlePayload {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
}

/** Max bars posted to the coach API (must match backend CandlePayloadPolicy.MaxBars). */
export const COACH_MAX_CANDLE_BARS = 1500

export interface MapCandlesForCoachOptions {
  /** ISO timestamps of trade entry/exit — preferred when downsampling. */
  preferTimes?: string[]
  maxBars?: number
}

/**
 * Compact MarketData → coach candle DTO.
 * When over maxBars: keep ends + bars nearest preferTimes + uniform stride.
 */
export function mapCandlesForCoach(
  candles: MarketData[],
  options: MapCandlesForCoachOptions = {},
): CoachCandlePayload[] {
  const maxBars = options.maxBars ?? COACH_MAX_CANDLE_BARS
  if (candles.length === 0) {
    return []
  }

  const ordered = [...candles].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  )

  const selected =
    ordered.length <= maxBars
      ? ordered
      : downsampleCandles(ordered, options.preferTimes ?? [], maxBars)

  return selected.map((c) => ({
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }))
}

function downsampleCandles(
  ordered: MarketData[],
  preferTimes: string[],
  maxBars: number,
): MarketData[] {
  const keep = new Set<number>()
  keep.add(0)
  keep.add(ordered.length - 1)

  for (const iso of preferTimes) {
    const ms = Date.parse(iso)
    if (Number.isNaN(ms)) {
      continue
    }
    const idx = nearestIndex(ordered, ms)
    keep.add(idx)
    if (idx > 0) {
      keep.add(idx - 1)
    }
    if (idx < ordered.length - 1) {
      keep.add(idx + 1)
    }
  }

  const stride = Math.max(1, Math.ceil(ordered.length / maxBars))
  for (let i = 0; i < ordered.length; i += stride) {
    keep.add(i)
  }

  let indices = [...keep].sort((a, b) => a - b)
  if (indices.length > maxBars) {
    const thinned = [indices[0]!]
    const step = (indices.length - 1) / (maxBars - 1)
    for (let n = 1; n < maxBars - 1; n++) {
      const idx = indices[Math.round(n * step)]!
      if (idx !== thinned[thinned.length - 1]) {
        thinned.push(idx)
      }
    }
    if (thinned[thinned.length - 1] !== indices[indices.length - 1]) {
      thinned.push(indices[indices.length - 1]!)
    }
    indices = thinned
  }

  return indices.map((i) => ordered[i]!)
}

function nearestIndex(ordered: MarketData[], targetMs: number): number {
  let best = 0
  let bestDelta = Number.POSITIVE_INFINITY
  for (let i = 0; i < ordered.length; i++) {
    const ms = Date.parse(ordered[i]!.timestamp)
    const delta = Math.abs(ms - targetMs)
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  }
  return best
}
