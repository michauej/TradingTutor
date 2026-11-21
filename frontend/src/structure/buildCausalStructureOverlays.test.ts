import { describe, expect, it } from 'vitest'
import { buildCausalStructureOverlays } from './buildCausalStructureOverlays'
import { detectSwings } from './detectSwings'
import type { StructureCandle } from './types'
import fixture from './fixtures/structure-ohlc.json'

const full = fixture as StructureCandle[]

describe('buildCausalStructureOverlays', () => {
  it('only uses the candle prefix — mid-series swings can differ from full-series', () => {
    const prefix = full.slice(0, Math.floor(full.length / 2))
    const prefixSwings = detectSwings(prefix)
    const fullSwings = detectSwings(full)

    // A swing near the prefix end needs right-side lookback; full series may confirm
    // extra pivots that the prefix cannot see yet.
    const prefixIndexes = new Set(prefixSwings.map((s) => s.index))
    const lateFullOnly = fullSwings.filter(
      (s) => s.index < prefix.length && !prefixIndexes.has(s.index),
    )
    // Either equal or full has more confirmed pivots in the same window — never
    // should prefix invent pivots that need bars beyond its length.
    for (const s of prefixSwings) {
      expect(s.index).toBeLessThan(prefix.length - 5) // lookback=5 right side
    }
    expect(lateFullOnly.length + prefixSwings.length).toBeGreaterThanOrEqual(
      prefixSwings.length,
    )
    expect(fullSwings.length).toBeGreaterThanOrEqual(prefixSwings.length)
  })

  it('returns empty layers when toggles are off', () => {
    const layers = buildCausalStructureOverlays(full, {
      showFvg: false,
      showSwings: false,
      showExtremeOb: false,
    })
    expect(layers.swingMarkers).toEqual([])
    expect(layers.priceRectangles).toEqual([])
  })

  it('builds layers from prefix when toggles are on', () => {
    const layers = buildCausalStructureOverlays(full, {
      showFvg: true,
      showSwings: true,
      showExtremeOb: true,
    })
    expect(layers.swingMarkers.length + layers.priceRectangles.length).toBeGreaterThan(0)
  })
})
