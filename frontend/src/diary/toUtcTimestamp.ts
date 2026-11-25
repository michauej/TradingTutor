import type { UTCTimestamp } from 'lightweight-charts'

/**
 * Parse API / pack timestamps as UTC.
 * Strings without a timezone (`…T08:25:00`) must NOT use the browser local zone —
 * that shifts the tip (e.g. CET −1h) and HTF remap then lands an hour earlier (08:25→06:00).
 */
export function parseUtcMillis(value: string): number | null {
  const raw = value.trim()
  if (!raw) {
    return null
  }
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw)
  const normalized = hasZone ? raw : `${raw}Z`
  const ms = Date.parse(normalized)
  if (Number.isNaN(ms)) {
    return null
  }
  return ms
}

/** Parse an ISO (or Date-parseable) string to floor-seconds UTCTimestamp. */
export function toUtcTimestamp(value: string): UTCTimestamp | null {
  const ms = parseUtcMillis(value)
  if (ms === null) {
    return null
  }
  return Math.floor(ms / 1000) as UTCTimestamp
}
