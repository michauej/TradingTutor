import { describe, expect, it } from 'vitest'
import { detectExtremeOb, findMeanTakeIndex } from './detectExtremeOb'
import { detectFvg } from './detectFvg'
import {
  alternateSwings,
  averageTrueRange,
  detectSwings,
  hasSignificantLegs,
  minSwingMove,
} from './detectSwings'
import type { StructureCandle, SwingPoint } from './types'
import fixture from './fixtures/structure-ohlc.json'

const candles = fixture as StructureCandle[]

describe('detectSwings', () => {
  it('finds swing highs and lows on the golden fixture', () => {
    const swings = detectSwings(candles)
    expect(swings.some((s) => s.isHigh)).toBe(true)
    expect(swings.some((s) => !s.isHigh)).toBe(true)
    const lowest = [...swings]
      .filter((s) => !s.isHigh)
      .sort((a, b) => a.price - b.price)[0]
    expect(lowest?.price).toBeLessThanOrEqual(91)
  })

  it('never emits two SH or two SL in a row', () => {
    const swings = detectSwings(candles)
    for (let i = 1; i < swings.length; i++) {
      expect(swings[i]!.isHigh).not.toBe(swings[i - 1]!.isHigh)
    }
  })
})

describe('alternateSwings', () => {
  it('keeps the more extreme pivot when consecutive same-type', () => {
    const raw: SwingPoint[] = [
      { index: 1, timestamp: 'a', price: 100, isHigh: true },
      { index: 3, timestamp: 'b', price: 105, isHigh: true },
      { index: 5, timestamp: 'c', price: 90, isHigh: false },
      { index: 7, timestamp: 'd', price: 88, isHigh: false },
      { index: 9, timestamp: 'e', price: 110, isHigh: true },
    ]
    const alt = alternateSwings(raw)
    expect(alt.map((s) => s.price)).toEqual([105, 88, 110])
    expect(alt.map((s) => s.isHigh)).toEqual([true, false, true])
  })

  it('drops micro opposite swings under amplitude threshold', () => {
    const raw: SwingPoint[] = [
      { index: 1, timestamp: 'a', price: 100, isHigh: true },
      { index: 3, timestamp: 'b', price: 99.9, isHigh: false }, // 0.1% — noise
      { index: 5, timestamp: 'c', price: 110, isHigh: true },
      { index: 7, timestamp: 'd', price: 90, isHigh: false },
    ]
    const alt = alternateSwings(raw)
    expect(alt.map((s) => s.price)).toEqual([110, 90])
    expect(alt.map((s) => s.isHigh)).toEqual([true, false])
  })
})

describe('hasSignificantLegs', () => {
  it('rejects a high with a shallow left leg', () => {
    const series: StructureCandle[] = []
    for (let i = 0; i < 30; i++) {
      const px = i < 10 ? 100 + i * 0.02 : i === 10 ? 100.6 : 100.6 - (i - 10) * 2
      series.push({
        timestamp: String(i),
        open: px,
        high: px + 0.1,
        low: px - 0.1,
        close: px,
      })
    }
    series[10] = {
      timestamp: '10',
      open: 100.5,
      high: 100.8,
      low: 100.4,
      close: 100.6,
    }
    const swing: SwingPoint = {
      index: 10,
      timestamp: '10',
      price: 100.8,
      isHigh: true,
    }
    const atr = averageTrueRange(series)
    const move = minSwingMove(swing.price, atr, 0.005)
    expect(hasSignificantLegs(series, swing, 5, move)).toBe(false)
  })
})

describe('detectFvg', () => {
  it('finds a bullish FVG on the golden fixture (parity with server)', () => {
    const fvgs = detectFvg(candles)
    expect(fvgs.some((f) => f.isBullish && f.low < f.high)).toBe(true)
    // Last three bars of fixture: left.high 100.2 < right.low 102.3
    const lastBull = fvgs.filter((f) => f.isBullish).at(-1)
    expect(lastBull?.low).toBeCloseTo(100.2, 5)
    expect(lastBull?.high).toBeCloseTo(102.3, 5)
  })
})

describe('detectExtremeOb', () => {
  it('finds extreme OBs at swing extremes on the golden fixture', () => {
    const blocks = detectExtremeOb(candles)
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.some((b) => b.isBullish)).toBe(true)
    expect(blocks.every((b) => b.low < b.high || b.low === b.high)).toBe(true)
  })

  it('extends each OB to the right at least through the adjacent candle', () => {
    const blocks = detectExtremeOb(candles)
    for (const ob of blocks) {
      const minExtend = Math.min(ob.candleIndex + 1, candles.length - 1)
      expect(ob.endIndex).toBeGreaterThanOrEqual(minExtend)
      expect(ob.mean).toBeCloseTo((ob.low + ob.high) / 2, 8)
    }
  })
})

describe('findMeanTakeIndex', () => {
  it('requires price to leave the OB before a 50% take counts', () => {
    const insideOnly: StructureCandle[] = [
      { timestamp: 'a', open: 110, high: 110, low: 100, close: 101 },
      { timestamp: 'b', open: 101, high: 109, low: 101, close: 108 },
      { timestamp: 'c', open: 108, high: 109, low: 104, close: 105 },
      { timestamp: 'd', open: 105, high: 109, low: 104, close: 108 },
    ]
    expect(findMeanTakeIndex(insideOnly, 0, 100, 110, true)).toBe(3)

    const leaveThenTake: StructureCandle[] = [
      { timestamp: 'a', open: 110, high: 110, low: 100, close: 101 },
      { timestamp: 'b', open: 101, high: 108, low: 101, close: 107 },
      { timestamp: 'c', open: 107, high: 115, low: 107, close: 114 },
      { timestamp: 'd', open: 114, high: 114, low: 104, close: 105 },
    ]
    expect(findMeanTakeIndex(leaveThenTake, 0, 100, 110, true)).toBe(3)
  })
})
