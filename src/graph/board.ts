import JXG from 'jsxgraph'
import { adaptColor } from '../ink/render'
import { COMPARE, derivative } from './compile'
import { safe, type Item } from './engine'
import { fmt, type GraphViewport } from './model'

/**
 * Draws an evaluated expression list on a JSXGraph board, Desmos style:
 * pan/zoom, auto grid, click a curve for its roots, extrema and
 * intersections, drag points bound to sliders, shaded inequalities.
 */

// JSXGraph's typings are loose; keep our usage typed as `any` at the edges.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = any

export interface BoardTheme {
  dark: boolean
}

export interface BoardCallbacks {
  onViewChange: (v: GraphViewport) => void
  /** A draggable point moved: new values for the sliders it is bound to. */
  onDragPoint: (exprId: string, values: Record<string, number>, done: boolean) => void
  onSelect: (exprId: string | null) => void
}

const POI_COLOR = '#8a8f98'

function palette(dark: boolean) {
  return dark
    ? { axis: '#c8ccd2', label: '#a6adb7', major: 'rgba(255,255,255,0.16)', minor: 'rgba(255,255,255,0.06)', bg: '#1e2228' }
    : { axis: '#2b2f36', label: '#5b6573', major: 'rgba(0,0,0,0.16)', minor: 'rgba(0,0,0,0.06)', bg: '#ffffff' }
}

let boardSeq = 0

export class GraphBoard {
  private board: El
  private shade: HTMLCanvasElement
  private items: Item[] = []
  private elements = new Map<string, El[]>()
  private poi: El[] = []
  private selected: string | null = null
  private dragging: string | null = null
  private cb: BoardCallbacks
  private shadeFrame = 0
  private viewTimer = 0
  private colors: ReturnType<typeof palette>
  private dark: boolean
  private resizeObserver: ResizeObserver

  constructor(host: HTMLElement, view: GraphViewport, theme: BoardTheme, cb: BoardCallbacks, showGrid: boolean) {
    this.cb = cb
    this.colors = palette(theme.dark)
    this.dark = theme.dark
    host.innerHTML = ''
    host.style.background = this.colors.bg

    this.shade = document.createElement('canvas')
    this.shade.className = 'graph-shade'
    const boardEl = document.createElement('div')
    boardEl.className = 'graph-jxg'
    boardEl.id = `marginalia-graph-${++boardSeq}`
    host.append(this.shade, boardEl)

    const c = this.colors
    const ticks = {
      insertTicks: true,
      minTicksDistance: 8,
      majorHeight: 0,
      minorHeight: 0,
      minorTicks: 4,
      strokeColor: c.axis,
      drawZero: true,
      label: { fontSize: 11, strokeColor: c.label, highlight: false, display: 'internal' as const },
    }
    this.board = JXG.JSXGraph.initBoard(boardEl.id, {
      boundingbox: [view.xmin, view.ymax, view.xmax, view.ymin],
      keepAspectRatio: true,
      axis: true,
      grid: showGrid
        ? { majorStep: 'auto', minorElements: 'auto', major: { face: 'line', strokeColor: c.major, strokeWidth: 1 }, minor: { visible: true, face: 'line', strokeColor: c.minor, strokeWidth: 1 } }
        : false,
      showCopyright: false,
      showNavigation: false,
      showInfobox: false,
      pan: { enabled: true, needShift: false, needTwoFingers: false },
      zoom: { enabled: true, wheel: true, needShift: false, pinch: true, factorX: 1.15, factorY: 1.15, min: 1e-6, max: 1e6 },
      defaultAxes: {
        x: { strokeColor: c.axis, strokeWidth: 1.4, highlight: false, lastArrow: false, ticks: { ...ticks, label: { ...ticks.label, offset: [-3, -12], anchorX: 'middle' } } },
        y: { strokeColor: c.axis, strokeWidth: 1.4, highlight: false, lastArrow: false, ticks: { ...ticks, drawZero: false, label: { ...ticks.label, offset: [-6, 0], anchorX: 'right', anchorY: 'middle' } } },
      },
    } as El)
    this.squareUp(view)

    this.board.on('boundingbox', () => {
      this.scheduleShade()
      window.clearTimeout(this.viewTimer)
      this.viewTimer = window.setTimeout(() => this.cb.onViewChange(this.view()), 350)
    })
    this.board.on('update', () => this.scheduleShade())
    this.board.on('down', (e: PointerEvent) => {
      // Clicking empty space clears the selection
      const hit = this.board.downObjects?.length
      if (!hit) this.select(null)
      void e
    })

    this.resizeObserver = new ResizeObserver(() => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w > 0 && h > 0 && (w !== this.board.canvasWidth || h !== this.board.canvasHeight)) {
        const v = this.view()
        this.board.resizeContainer(w, h, true)
        this.squareUp(v)
        this.scheduleShade()
      }
    })
    this.resizeObserver.observe(host)
  }

  destroy() {
    this.resizeObserver.disconnect()
    window.clearTimeout(this.viewTimer)
    cancelAnimationFrame(this.shadeFrame)
    JXG.JSXGraph.freeBoard(this.board)
  }

  view(): GraphViewport {
    const [xmin, ymax, xmax, ymin] = this.board.getBoundingBox()
    return { xmin, xmax, ymin, ymax }
  }

  setView(v: GraphViewport) {
    this.board.setBoundingBox([v.xmin, v.ymax, v.xmax, v.ymin], false)
  }

  zoom(factor: number) {
    const [x1, y1, x2, y2] = this.board.getBoundingBox()
    const cx = (x1 + x2) / 2
    const cy = (y1 + y2) / 2
    const hw = ((x2 - x1) / 2) * factor
    const hh = ((y1 - y2) / 2) * factor
    this.board.setBoundingBox([cx - hw, cy + hh, cx + hw, cy - hh], false)
  }

  /** Reset to the default view. */
  home(v: GraphViewport) {
    this.squareUp(v)
  }

  /**
   * Show the given view with equal units on both axes (circles look round),
   * keeping its centre and its x range.
   */
  squareUp(v: GraphViewport) {
    const w = this.board.canvasWidth
    const h = this.board.canvasHeight
    if (!w || !h) return
    const cx = (v.xmin + v.xmax) / 2
    const cy = (v.ymin + v.ymax) / 2
    const hw = (v.xmax - v.xmin) / 2
    const hh = (hw * h) / w
    this.board.setBoundingBox([cx - hw, cy + hh, cx + hw, cy - hh], false)
  }

  // -------------------------------------------------------------------------

  /** Rebuild all elements from a new evaluation. */
  render(items: Item[]) {
    this.items = items
    this.board.suspendUpdate()
    for (const els of this.elements.values())
      for (const el of els) {
        el.__unsync?.()
        this.board.removeObject(el)
      }
    this.elements.clear()
    this.clearPoi()
    for (const it of items) {
      if (it.error || it.expr.hidden) continue
      const els = this.create(it)
      if (els.length) this.elements.set(it.expr.id, els)
    }
    this.board.unsuspendUpdate()
    if (this.selected) this.select(this.selected)
    this.scheduleShade()
  }

  /** Slider values changed but the structure didn't: just redraw. */
  refresh(items: Item[]) {
    this.items = items
    this.board.update()
    if (this.selected) this.select(this.selected)
    this.scheduleShade()
  }

  /** Expression colour, lightened in dark mode if it would be unreadable (e.g. black). */
  private col(c: string) {
    return adaptColor(c, this.dark)
  }

  private style(it: Item, extra: Record<string, unknown> = {}) {
    return {
      strokeColor: this.col(it.expr.color),
      strokeWidth: 2.6,
      dash: it.expr.dashed ? 2 : 0,
      highlight: false,
      fixed: true,
      hasInnerPoints: false,
      ...extra,
    }
  }

  private create(it: Item): El[] {
    const a = it.analysis
    const b = this.board
    const bb = () => b.getBoundingBox()
    const els: El[] = []
    const clickable = (el: El) => {
      el.on('down', () => this.select(it.expr.id))
      return el
    }

    switch (a.kind) {
      case 'graphY':
      case 'function': {
        const f = it.f!
        els.push(clickable(b.create('functiongraph', [(x: number) => safe(f, [x])], this.style(it))))
        break
      }
      case 'graphX': {
        const f = it.f!
        els.push(clickable(b.create('curve', [(t: number) => safe(f, [t]), (t: number) => t, () => bb()[3], () => bb()[1]], this.style(it))))
        break
      }
      case 'polar': {
        const f = it.f!
        const max = it.expr.domain?.max ?? 2 * Math.PI
        const min = it.expr.domain?.min ?? 0
        els.push(clickable(b.create('curve', [(t: number) => safe(f, [t]), [0, 0], min, max], this.style(it))))
        break
      }
      case 'parametric': {
        const f = it.f!
        const g = it.g!
        const min = it.expr.domain?.min ?? 0
        const max = it.expr.domain?.max ?? 1
        els.push(clickable(b.create('curve', [(t: number) => safe(f, [t]), (t: number) => safe(g, [t]), min, max], this.style(it))))
        break
      }
      case 'implicit': {
        const d = it.diff!
        els.push(clickable(b.create('implicitcurve', [(x: number, y: number) => safe(d, [x, y])], this.style(it, { resolution_outer: 6, resolution_inner: 6 }))))
        break
      }
      case 'inequality': {
        // Boundary (dashed when strict); the shaded region is drawn on the canvas below.
        const strict = a.op === 'Less' || a.op === 'Greater'
        const style = this.style(it, { dash: strict ? 2 : 0, strokeWidth: 2 })
        if (it.f) {
          const f = it.f
          els.push(clickable(b.create('functiongraph', [(x: number) => safe(f, [x])], style)))
        } else {
          const d = it.diff!
          els.push(b.create('implicitcurve', [(x: number, y: number) => safe(d, [x, y])], style))
        }
        break
      }
      case 'point':
      case 'points': {
        const pts = it.pts!
        const drag = a.kind === 'point' && (a.dragX || a.dragY) ? a : null
        pts.forEach(([px, py]) => {
          const X = () => safe(px, [])
          const Y = () => safe(py, [])
          const attrs = {
            name: '',
            size: 4,
            strokeColor: this.col(it.expr.color),
            fillColor: this.col(it.expr.color),
            highlight: false,
            showInfobox: false,
            withLabel: false,
            fixed: !drag,
          }
          if (!drag) {
            els.push(clickable(b.create('point', [X, Y], attrs)))
            return
          }
          // Draggable: free point synced from/to its sliders
          const p = b.create('point', [X(), Y()], { ...attrs, size: 5, strokeWidth: 3, fillColor: this.colors.bg })
          p.__sync = () => {
            if (this.dragging !== it.expr.id) p.setPositionDirectly(JXG.COORDS_BY_USER, [X(), Y()])
          }
          const report = (done: boolean) => {
            const values: Record<string, number> = {}
            const round = (v: number) => Math.round(v * 100) / 100
            if (drag.dragX) values[drag.dragX] = round(p.X())
            if (drag.dragY) values[drag.dragY] = round(p.Y())
            if (!drag.dragX) p.setPositionDirectly(JXG.COORDS_BY_USER, [X(), p.Y()])
            if (!drag.dragY) p.setPositionDirectly(JXG.COORDS_BY_USER, [p.X(), Y()])
            this.cb.onDragPoint(it.expr.id, values, done)
          }
          p.on('down', () => {
            this.dragging = it.expr.id
          })
          p.on('drag', () => report(false))
          p.on('up', () => {
            report(true)
            this.dragging = null
          })
          b.on('update', p.__sync)
          p.__unsync = () => b.off('update', p.__sync)
          els.push(p)
        })
        break
      }
    }
    return els
  }

  // -------------------------------------------------------------------------
  // Selection: points of interest + trace

  select(id: string | null) {
    this.selected = id
    this.clearPoi()
    this.cb.onSelect(id)
    if (!id) return
    const it = this.items.find((i) => i.expr.id === id)
    const curve = this.elements.get(id)?.[0]
    if (!it || !curve || it.error) return
    const fnOf = (item: Item) => (item.analysis.kind === 'graphY' || (item.analysis.kind === 'function' && item.analysis.plot) ? item.f : null)
    const f = fnOf(it)
    this.board.suspendUpdate()
    if (f) {
      const pts = pointsOfInterest(
        (x) => safe(f, [x]),
        this.items.filter((o) => o !== it && !o.error && !o.expr.hidden).map(fnOf).filter(Boolean).map((g) => (x: number) => safe(g!, [x])),
        this.view(),
      )
      for (const [x, y] of pts) this.addPoi(x, y)
    }
    // Trace: a point you can slide along the curve
    if (curve.elementClass === (JXG as El).OBJECT_CLASS_CURVE) {
      const [x1, , x2] = this.board.getBoundingBox()
      const start = f ? [(x1 + x2) / 2 + (x2 - x1) * 0.13, safe(f, [(x1 + x2) / 2 + (x2 - x1) * 0.13])] : [0, 0]
      if (Number.isFinite(start[1])) {
        const g = this.board.create('glider', [start[0], start[1], curve], {
          name: '',
          size: 5,
          strokeColor: this.col(it.expr.color),
          fillColor: this.colors.bg,
          strokeWidth: 3,
          highlight: false,
          showInfobox: false,
          withLabel: true,
          label: { offset: [10, 12], fontSize: 12, strokeColor: this.colors.label, highlight: false },
        })
        g.setLabelText = undefined
        g.label?.setText(() => `(${fmt(g.X())}, ${fmt(g.Y())})`)
        this.poi.push(g)
      }
    }
    this.board.unsuspendUpdate()
  }

  private addPoi(x: number, y: number) {
    const p = this.board.create('point', [x, y], {
      name: '',
      size: 3.5,
      fixed: true,
      strokeColor: POI_COLOR,
      fillColor: POI_COLOR,
      highlight: false,
      showInfobox: false,
      withLabel: true,
      label: { offset: [8, 10], fontSize: 12, strokeColor: this.colors.label, highlight: false, visible: false },
    })
    p.label?.setText(`(${fmt(x)}, ${fmt(y)})`)
    p.on('over', () => p.label?.setAttribute({ visible: true }))
    p.on('out', () => p.label?.setAttribute({ visible: false }))
    p.on('down', () => p.label?.setAttribute({ visible: !p.label.visProp.visible }))
    this.poi.push(p)
  }

  private clearPoi() {
    for (const p of this.poi) this.board.removeObject(p)
    this.poi = []
  }

  // -------------------------------------------------------------------------
  // Inequality shading

  private scheduleShade() {
    cancelAnimationFrame(this.shadeFrame)
    this.shadeFrame = requestAnimationFrame(() => this.drawShade())
  }

  private drawShade() {
    const canvas = this.shade
    const w = this.board.canvasWidth
    const h = this.board.canvasHeight
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const ineqs = this.items.filter((it) => it.analysis.kind === 'inequality' && !it.error && !it.expr.hidden && it.diff)
    if (!ineqs.length) return
    const [x1, y1, x2, y2] = this.board.getBoundingBox()
    const cell = 3
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (const it of ineqs) {
      const a = it.analysis as Extract<Item['analysis'], { kind: 'inequality' }>
      const cmp = COMPARE[a.op]
      const d = it.diff!
      ctx.fillStyle = this.col(it.expr.color)
      ctx.globalAlpha = 0.22
      for (let py = 0; py < h; py += cell) {
        const y = y1 + ((py + cell / 2) / h) * (y2 - y1)
        let runStart = -1
        for (let px = 0; px <= w; px += cell) {
          const x = x1 + ((px + cell / 2) / w) * (x2 - x1)
          const inside = px < w && cmp(safe(d, [x, y]), 0)
          if (inside && runStart < 0) runStart = px
          if (!inside && runStart >= 0) {
            ctx.fillRect(runStart, py, px - runStart, cell)
            runStart = -1
          }
        }
      }
    }
    ctx.globalAlpha = 1
  }
}

/** Roots, extrema, y-intercept, and intersections with other function graphs, in view. */
export function pointsOfInterest(f: (x: number) => number, others: ((x: number) => number)[], v: GraphViewport): [number, number][] {
  const out: [number, number][] = []
  const N = 600
  const dx = (v.xmax - v.xmin) / N
  const bisect = (g: (x: number) => number, a: number, b: number) => {
    let ga = g(a)
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2
      const gm = g(m)
      if (Math.sign(gm) === Math.sign(ga)) {
        a = m
        ga = gm
      } else b = m
    }
    return (a + b) / 2
  }
  const signChanges = (g: (x: number) => number, jumpGuard: boolean) => {
    let px = v.xmin
    let pv = g(px)
    for (let i = 1; i <= N; i++) {
      const x = v.xmin + i * dx
      const val = g(x)
      if (Number.isFinite(pv) && Number.isFinite(val)) {
        if (val === 0) out.push([x, f(x)])
        else if (pv !== 0 && Math.sign(pv) !== Math.sign(val)) {
          const r = bisect(g, px, x)
          // Skip asymptotes (sign change through infinity)
          const fr = f(r)
          if (!jumpGuard || (Number.isFinite(fr) && Math.abs(g(r)) < 1e-6 * (1 + Math.abs(fr)))) out.push([r, fr])
        }
      }
      px = x
      pv = val
    }
  }
  signChanges(f, true) // roots
  signChanges((x) => derivative(f, x), false) // extrema (where f' changes sign)
  for (const g of others) signChanges((x) => f(x) - g(x), true)
  const y0 = f(0)
  if (v.xmin < 0 && v.xmax > 0 && Number.isFinite(y0)) out.push([0, y0])
  // De-duplicate and keep only points inside the view
  const seen: [number, number][] = []
  for (const [x, y] of out) {
    if (!Number.isFinite(y) || y < v.ymin || y > v.ymax) continue
    if (seen.some(([sx, sy]) => Math.abs(sx - x) < dx && Math.abs(sy - y) < (v.ymax - v.ymin) / 200)) continue
    seen.push([Math.abs(x) < 1e-9 ? 0 : x, Math.abs(y) < 1e-9 ? 0 : y])
    if (seen.length > 60) break
  }
  return seen
}
