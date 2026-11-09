import type { UTCTimestamp } from 'lightweight-charts'

/** Parse an ISO (or Date-parseable) string to floor-seconds UTCTimestamp. */
export function toUtcTimestamp(value: string): UTCTimestamp | null {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    return null
  }
  return Math.floor(ms / 1000) as UTCTimestamp
}
