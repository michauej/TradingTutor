const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
}

/** Must match backend CandleStorage:MaxBarsPerLoad. */
export const MAX_BARS_PER_LOAD = 10_000

/** Align timestamp down to the interval boundary (UTC). */
export function alignDownToInterval(isoOrDate: Date, interval: string): Date {
  const ms = INTERVAL_MS[interval] ?? INTERVAL_MS['1h']!
  const time = isoOrDate.getTime()
  return new Date(Math.floor(time / ms) * ms)
}

export function defaultCandleRange(params: {
  lastDays?: number
  interval?: string
  now?: Date
}): { startTime: string; endTime: string } {
  const lastDays = params.lastDays ?? 7
  const interval = params.interval ?? '1h'
  const now = params.now ?? new Date()
  const end = alignDownToInterval(now, interval)
  const start = new Date(end.getTime() - lastDays * 24 * 60 * 60_000)
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  }
}

/** `YYYY-MM-DD` for `<input type="date">` from a Date (UTC calendar day). */
export function toUtcDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Default From/To calendar dates for the session entry load form. */
export function defaultRangeDates(params?: {
  lastDays?: number
  now?: Date
}): { startDate: string; endDate: string } {
  const lastDays = params?.lastDays ?? 90
  const now = params?.now ?? new Date()
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  const start = new Date(end.getTime() - lastDays * 24 * 60 * 60_000)
  return {
    startDate: toUtcDateInputValue(start),
    endDate: toUtcDateInputValue(end),
  }
}

/**
 * Earliest From calendar day that still fits under MaxBarsPerLoad
 * for the selected interval, ending at `endDate` (or today).
 */
export function earliestFromDateForInterval(params: {
  endDate: string
  interval: string
  maxBars?: number
}): string | null {
  const endRaw = parseDateInputUtc(params.endDate, true)
  if (endRaw == null) {
    return null
  }
  const barMs = INTERVAL_MS[params.interval] ?? INTERVAL_MS['1h']!
  const maxBars = Math.max(1, params.maxBars ?? MAX_BARS_PER_LOAD)
  // Leave one bar of slack so start < end after alignment.
  const spanBars = Math.max(1, maxBars - 1)
  const start = new Date(endRaw.getTime() - spanBars * barMs)
  return toUtcDateInputValue(start)
}

function parseDateInputUtc(dateStr: string, endOfDay: boolean): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }
  if (endOfDay) {
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
}

/**
 * Build an API candle range from From/To date inputs (`YYYY-MM-DD`).
 * Aligns both ends down to the selected interval.
 */
export function candleRangeFromDates(params: {
  startDate: string
  endDate: string
  interval: string
}):
  | { ok: true; startTime: string; endTime: string }
  | { ok: false; message: string } {
  const startRaw = parseDateInputUtc(params.startDate, false)
  const endRaw = parseDateInputUtc(params.endDate, true)
  if (startRaw == null || endRaw == null) {
    return {
      ok: false,
      message: 'From date and To date must be valid calendar dates.',
    }
  }
  const start = alignDownToInterval(startRaw, params.interval)
  const end = alignDownToInterval(endRaw, params.interval)
  if (!(start.getTime() < end.getTime())) {
    return {
      ok: false,
      message: 'From date must be earlier than To date.',
    }
  }
  return {
    ok: true,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  }
}

export function formatCandleLoadStatus(params: {
  source: string
  incomplete: boolean
  message?: string | null
  candleCount: number
}): string {
  const sourceLabel =
    params.source === 'local'
      ? 'local pack'
      : params.source === 'partial'
        ? 'partial download'
        : 'exchange'
  const base = `Loaded ${params.candleCount} candles from ${sourceLabel}.`
  if (params.incomplete) {
    const detail = params.message?.trim()
    return detail ? `${base} Warning: ${detail}` : `${base} Warning: series is incomplete.`
  }
  if (params.message?.trim()) {
    return `${base} ${params.message.trim()}`
  }
  return base
}
