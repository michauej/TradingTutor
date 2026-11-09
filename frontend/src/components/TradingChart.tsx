import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type UTCTimestamp,
} from 'lightweight-charts'
import { toUtcTimestamp, type TradeSpanLine } from '../diary'
import type { MarketData } from '../services/api'

interface TradingChartProps {
  candles: MarketData[]
  markers?: SeriesMarker<UTCTimestamp>[]
  /** Semi-transparent entry→exit connectors (diary only). */
  tradeSpans?: TradeSpanLine[]
}

interface SeriesSnapshot {
  length: number
  firstTimestamp: string | null
  lastTimestamp: string | null
}

export default function TradingChart({
  candles,
  markers = [],
  tradeSpans = [],
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersPluginRef = useRef<{
    setMarkers: (next: SeriesMarker<UTCTimestamp>[]) => void
    detach: () => void
  } | null>(null)
  const spanSeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const snapshotRef = useRef<SeriesSnapshot>({
    length: 0,
    firstTimestamp: null,
    lastTimestamp: null,
  })
  const spanKeyRef = useRef<string>('')

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

    const markersPlugin = createSeriesMarkers(series, [])

    chartRef.current = chart
    seriesRef.current = series
    markersPluginRef.current = markersPlugin

    return () => {
      for (const spanSeries of spanSeriesRef.current) {
        chart.removeSeries(spanSeries)
      }
      spanSeriesRef.current = []
      markersPlugin.detach()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersPluginRef.current = null
      snapshotRef.current = {
        length: 0,
        firstTimestamp: null,
        lastTimestamp: null,
      }
      spanKeyRef.current = ''
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
      snapshotRef.current = {
        length: 0,
        firstTimestamp: null,
        lastTimestamp: null,
      }
      return
    }

    const firstTimestamp = candles[0]!.timestamp
    const lastTimestamp = candles[candles.length - 1]!.timestamp
    const prev = snapshotRef.current

    // Parent often passes a fresh array slice with the same window — do not
    // setData/fitContent on those no-op reference changes (trades remount zoom).
    const isUnchangedWindow =
      prev.length === candles.length &&
      prev.firstTimestamp === firstTimestamp &&
      prev.lastTimestamp === lastTimestamp
    if (isUnchangedWindow) {
      return
    }

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
          lastTimestamp,
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
      lastTimestamp,
    }
  }, [candles])

  useEffect(() => {
    markersPluginRef.current?.setMarkers(markers)
  }, [markers])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) {
      return
    }

    const nextKey = tradeSpans
      .map(
        (span) =>
          `${span.id}:${span.color}:${span.points.map((p) => `${p.time},${p.value}`).join('|')}`,
      )
      .join(';')
    if (nextKey === spanKeyRef.current) {
      return
    }
    spanKeyRef.current = nextKey

    for (const spanSeries of spanSeriesRef.current) {
      chart.removeSeries(spanSeries)
    }
    spanSeriesRef.current = []

    for (const span of tradeSpans) {
      const line = chart.addSeries(LineSeries, {
        color: span.color,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceScaleId: 'right',
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        // Keep entry→exit connectors from hijacking candle price autoscale.
        autoscaleInfoProvider: () => null,
      })
      line.setData(span.points)
      spanSeriesRef.current.push(line)
    }
  }, [tradeSpans])

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
  const time = toUtcTimestamp(candle.timestamp)
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
