import type { UTCTimestamp } from 'lightweight-charts'
import type { MarketData } from '../services/api'
import { parseUtcMillis, toUtcTimestamp } from './toUtcTimestamp'

const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '60': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '240': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  D: 24 * 60 * 60_000,
}

function inferBarDurationMs(candles: readonly MarketData[]): number {
  if (candles.length >= 2) {
    const prev = parseUtcMillis(candles[candles.length - 2]!.timestamp)
    const last = parseUtcMillis(candles[candles.length - 1]!.timestamp)
    if (prev != null && last != null && last > prev) {
      return last - prev
    }
  }
  const label = candles[candles.length - 1]?.interval?.trim()
  if (label && INTERVAL_MS[label] != null) {
    return INTERVAL_MS[label]!
  }
  return 60 * 60_000
}

/**
 * Map an arbitrary wall-clock trade time onto the candle that contains it.
 * Candles are oldest-first with open timestamps. Returns null when the time
 * falls before the first bar or at/after the end of the last visible bar
 * (so future fills are not pinned onto the last revealed candle).
 */
export function snapToCandleTimestamp(
  candles: readonly MarketData[],
  iso: string,
): UTCTimestamp | null {
  const targetSec = toUtcTimestamp(iso)
  if (targetSec === null || candles.length === 0) {
    return null
  }
  const targetMs = targetSec * 1000

  let snappedIndex = -1
  for (let i = 0; i < candles.length; i += 1) {
    const open = toUtcTimestamp(candles[i]!.timestamp)
    if (open === null) {
      continue
    }
    if (open * 1000 > targetMs) {
      break
    }
    snappedIndex = i
  }

  if (snappedIndex < 0) {
    return null
  }

  const openMs = parseUtcMillis(candles[snappedIndex]!.timestamp)
  if (openMs === null) {
    return null
  }

  const endMs =
    snappedIndex < candles.length - 1
      ? parseUtcMillis(candles[snappedIndex + 1]!.timestamp)
      : openMs + inferBarDurationMs(candles)

  if (endMs === null || targetMs >= endMs) {
    return null
  }

  return Math.floor(openMs / 1000) as UTCTimestamp
}
