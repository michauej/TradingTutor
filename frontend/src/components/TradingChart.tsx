import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { MarketData } from '../services/api'

interface TradingChartProps {
  candles: MarketData[]
}

interface SeriesSnapshot {
  length: number
  firstTimestamp: string | null
}

export default function TradingChart({ candles }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const snapshotRef = useRef<SeriesSnapshot>({
    length: 0,
    firstTimestamp: null,
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#111b2e' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#243352' },
        horzLines: { color: '#243352' },
      },
      rightPriceScale: {
        borderColor: '#243352',
      },
      timeScale: {
        borderColor: '#243352',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      snapshotRef.current = { length: 0, firstTimestamp: null }
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) {
      return
    }

    if (candles.length === 0) {
      series.setData([])
      snapshotRef.current = { length: 0, firstTimestamp: null }
      return
    }

    const firstTimestamp = candles[0]!.timestamp
    const prev = snapshotRef.current
    const isSingleCandleAdvance =
      prev.length > 0 &&
      prev.firstTimestamp === firstTimestamp &&
      candles.length === prev.length + 1

    if (isSingleCandleAdvance) {
      const nextBar = toCandlestickBar(candles[candles.length - 1]!)
      if (nextBar) {
        series.update(nextBar)
        snapshotRef.current = {
          length: candles.length,
          firstTimestamp,
        }
      }
      return
    }

    const data = []
    for (const candle of candles) {
      const bar = toCandlestickBar(candle)
      if (bar === null) {
        console.warn('Skipping candle with invalid timestamp:', candle.timestamp)
        continue
      }
      data.push(bar)
    }

    series.setData(data)
    if (data.length > 0) {
      chart.timeScale().fitContent()
    }
    snapshotRef.current = {
      length: candles.length,
      firstTimestamp,
    }
  }, [candles])

  return (
    <div className="chart-panel">
      <h2>Chart</h2>
      {candles.length === 0 ? (
        <p className="chart-placeholder">Load candles to see the chart.</p>
      ) : null}
      <div
        ref={containerRef}
        className="chart-container"
        aria-label="Candlestick chart"
      />
    </div>
  )
}

function toCandlestickBar(candle: MarketData): {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
} | null {
  const time = tryUtcTimestamp(candle.timestamp)
  if (time === null) {
    return null
  }
  return {
    time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }
}

function tryUtcTimestamp(value: string): UTCTimestamp | null {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    return null
  }
  return Math.floor(ms / 1000) as UTCTimestamp
}
