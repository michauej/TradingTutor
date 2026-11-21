import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import { CanvasRenderingTarget2D } from 'fancy-canvas'

export interface PriceRectangle {
  id: string
  timeStart: UTCTimestamp
  timeEnd: UTCTimestamp
  priceHigh: number
  priceLow: number
  fillColor: string
  borderColor?: string
}

interface RectViewData {
  x1: number
  x2: number
  y1: number
  y2: number
  fillColor: string
  borderColor?: string
}

/**
 * Programmatic multi-rectangle overlay for FVG (and similar) zones.
 * Slim ISeriesPrimitive — add/clear via setRectangles.
 */
export class RectangleOverlayPrimitive implements ISeriesPrimitive<Time> {
  private _rects: PriceRectangle[] = []
  private _chart: IChartApi | null = null
  private _series: ISeriesApi<SeriesType> | null = null
  private _requestUpdate: (() => void) | null = null
  private readonly _paneViews: RectanglePaneView[]

  constructor() {
    this._paneViews = [new RectanglePaneView(this)]
  }

  setRectangles(rects: PriceRectangle[]): void {
    this._rects = rects
    this._requestUpdate?.()
  }

  clear(): void {
    this.setRectangles([])
  }

  getRectangles(): readonly PriceRectangle[] {
    return this._rects
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart
    this._series = param.series
    this._requestUpdate = param.requestUpdate
  }

  detached(): void {
    this._chart = null
    this._series = null
    this._requestUpdate = null
  }

  updateAllViews(): void {
    for (const view of this._paneViews) {
      view.update()
    }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews
  }

  /** @internal used by pane view */
  _buildViewData(): RectViewData[] {
    const chart = this._chart
    const series = this._series
    if (!chart || !series) {
      return []
    }

    const ts = chart.timeScale()
    const out: RectViewData[] = []
    for (const rect of this._rects) {
      const x1 = ts.timeToCoordinate(rect.timeStart)
      const x2 = ts.timeToCoordinate(rect.timeEnd)
      const y1 = series.priceToCoordinate(rect.priceHigh)
      const y2 = series.priceToCoordinate(rect.priceLow)
      if (x1 === null || x2 === null || y1 === null || y2 === null) {
        continue
      }
      out.push({
        x1,
        x2,
        y1,
        y2,
        fillColor: rect.fillColor,
        borderColor: rect.borderColor,
      })
    }
    return out
  }
}

class RectanglePaneView implements IPrimitivePaneView {
  private readonly _source: RectangleOverlayPrimitive
  private _data: RectViewData[] = []

  constructor(source: RectangleOverlayPrimitive) {
    this._source = source
  }

  update(): void {
    this._data = this._source._buildViewData()
  }

  renderer(): IPrimitivePaneRenderer {
    return new RectangleRenderer(this._data)
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom'
  }
}

class RectangleRenderer implements IPrimitivePaneRenderer {
  private readonly _data: RectViewData[]

  constructor(data: RectViewData[]) {
    this._data = data
  }

  draw(target: CanvasRenderingTarget2D): void {
    // utils unused — bitmap space is enough for filled rects
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context
      const hRatio = scope.horizontalPixelRatio
      const vRatio = scope.verticalPixelRatio
      for (const r of this._data) {
        const left = Math.min(r.x1, r.x2) * hRatio
        const right = Math.max(r.x1, r.x2) * hRatio
        const top = Math.min(r.y1, r.y2) * vRatio
        const bottom = Math.max(r.y1, r.y2) * vRatio
        const width = Math.max(1, right - left)
        const height = Math.max(1, bottom - top)
        ctx.fillStyle = r.fillColor
        ctx.fillRect(left, top, width, height)
        if (r.borderColor) {
          ctx.strokeStyle = r.borderColor
          ctx.lineWidth = Math.max(1, Math.floor(hRatio))
          ctx.strokeRect(left, top, width, height)
        }
      }
    })
  }
}
