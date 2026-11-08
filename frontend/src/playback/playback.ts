/** Minimum warm-up candles revealed before Play (clamped to remaining length). */
export const WARMUP_CANDLES = 300

/** Allowed wall-clock playback multipliers. */
export type PlaybackSpeed = 1 | 2 | 5

/** Delay in ms between playhead advances for each speed. */
const SPEED_DELAY_MS: Record<PlaybackSpeed, number> = {
  1: 500,
  2: 250,
  5: 100,
}

export interface TimestampedCandle {
  timestamp: string
}

/**
 * Map a playback speed to its wall-clock advance delay.
 * Higher speeds must produce strictly shorter delays.
 */
export function delayForSpeed(speed: PlaybackSpeed): number {
  return SPEED_DELAY_MS[speed]
}

/**
 * Resolve the session start index: first candle at/after `sessionStartDate`.
 *
 * Edge cases (documented by tests):
 * - Empty series → 0
 * - Date before first candle → 0
 * - Date after last candle → `length` (empty remaining session; Play is already at end)
 */
export function resolveSessionStartIndex(
  candles: readonly TimestampedCandle[],
  sessionStartDate: string | Date,
): number {
  const length = candles.length
  if (length === 0) {
    return 0
  }

  const targetMs = toUtcMs(sessionStartDate)
  for (let i = 0; i < length; i += 1) {
    if (toUtcMs(candles[i]!.timestamp) >= targetMs) {
      return i
    }
  }

  // All candles are strictly before the requested date → empty remaining window.
  return length
}

/**
 * Exclusive end index of the initial warm-up window.
 * `playhead` is the count of candles visible from the session start slice end,
 * i.e. candles in `[startIndex, playhead)` when slicing the full series from start.
 *
 * When fewer than WARMUP_CANDLES remain after start, playhead = length
 * (entire remaining window revealed; Play may immediately be at end).
 */
export function initialPlayhead(startIndex: number, length: number): number {
  if (length <= 0) {
    return 0
  }
  const clampedStart = clamp(startIndex, 0, length)
  return Math.min(length, clampedStart + WARMUP_CANDLES)
}

export type AdvanceResult =
  | { kind: 'advanced'; playhead: number }
  | { kind: 'atEnd'; playhead: number }

/**
 * Advance the exclusive playhead by one candle, or signal that playback is at end.
 * Auto-pause consumers should treat `atEnd` as `playing = false` with playhead = length.
 */
export function advancePlayhead(playhead: number, length: number): AdvanceResult {
  if (length <= 0) {
    return { kind: 'atEnd', playhead: 0 }
  }
  const clamped = clamp(playhead, 0, length)
  if (clamped >= length) {
    return { kind: 'atEnd', playhead: length }
  }
  const next = clamped + 1
  if (next >= length) {
    return { kind: 'atEnd', playhead: length }
  }
  return { kind: 'advanced', playhead: next }
}

export function isAtEnd(playhead: number, length: number): boolean {
  return length <= 0 || playhead >= length
}

function toUtcMs(value: string | Date): number {
  if (value instanceof Date) {
    return value.getTime()
  }
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid date: ${value}`)
  }
  return ms
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
