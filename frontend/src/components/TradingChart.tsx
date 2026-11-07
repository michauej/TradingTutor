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

export default function TradingChart({ candles }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

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
      return
    }

    const data = candles.map((candle) => ({
      time: toUtcTimestamp(candle.timestamp),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }))

    series.setData(data)
    chart.timeScale().fitContent()
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

function toUtcTimestamp(value: string): UTCTimestamp {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid candle timestamp: ${value}`)
  }
  return Math.floor(ms / 1000) as UTCTimestamp
}
