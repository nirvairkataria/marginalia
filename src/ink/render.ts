import { getStroke, type StrokeOptions } from 'perfect-freehand'
import type { PenType, Stroke } from './types'

/** How each pen type feels. `thinning` controls how much pressure changes width. */
const PEN_FEEL: Record<PenType, StrokeOptions & { alpha?: number }> = {
  ballpoint: { thinning: 0.25, smoothing: 0.5, streamline: 0.45 },
  fountain: { thinning: 0.7, smoothing: 0.6, streamline: 0.4, start: { taper: 6, cap: true }, end: { taper: 14, cap: true } },
  pencil: { thinning: 0.35, smoothing: 0.35, streamline: 0.3, alpha: 0.8 },
  marker: { thinning: 0, smoothing: 0.65, streamline: 0.55 },
  brush: { thinning: 0.85, smoothing: 0.7, streamline: 0.5, start: { taper: 18, cap: true }, end: { taper: 30, cap: true } },
}

export function strokeOptions(s: Pick<Stroke, 'penType' | 'width' | 'pressure' | 'sim' | 'kind'>, last: boolean): StrokeOptions {
  const feel = PEN_FEEL[s.penType] ?? PEN_FEEL.ballpoint
  const opts: StrokeOptions = { ...feel, size: s.width, last }
  if (s.kind === 'highlighter' || !s.pressure) {
    opts.thinning = 0
    opts.simulatePressure = false
    opts.start = { taper: 0, cap: true }
    opts.end = { taper: 0, cap: true }
  } else {
    opts.simulatePressure = s.sim
  }
  return opts
}

function toPoints(pts: number[], pressure: boolean): number[][] {
  const out: number[][] = []
  for (let i = 0; i < pts.length; i += 3) out.push([pts[i], pts[i + 1], pressure ? pts[i + 2] : 0.5])
  return out
}

/** Outline polygon of a stroke as a Path2D, in local coordinates. */
export function strokePath(s: Stroke, last = true): Path2D {
  const outline = getStroke(toPoints(s.pts, s.pressure && !s.sim), strokeOptions(s, last))
  const path = new Path2D()
  if (!outline.length) return path
  path.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length - 1; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[i + 1]
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  path.closePath()
  return path
}

const pathCache = new Map<string, { stroke: Stroke; path: Path2D }>()

export function cachedPath(s: Stroke): Path2D {
  const hit = pathCache.get(s.id)
  if (hit && hit.stroke === s) return hit.path
  const path = strokePath(s)
  pathCache.set(s.id, { stroke: s, path })
  if (pathCache.size > 20000) pathCache.clear()
  return path
}

// ---------- Colour handling for dark mode ----------

const colorCache = new Map<string, string>()

/** Invert lightness (keeping hue) so dark ink reads on dark paper. */
export function adaptColor(hex: string, dark: boolean): string {
  if (!dark) return hex
  const cached = colorCache.get(hex)
  if (cached) return cached
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let sat = 0
  if (max !== min) {
    const d = max - min
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  // Only flip colours that would be hard to read; keep bright hues as they are.
  const nl = l < 0.5 ? 1 - l * 0.85 : l
  const out = `hsl(${Math.round(h * 360)} ${Math.round(sat * 100)}% ${Math.round(nl * 100)}%)`
  colorCache.set(hex, out)
  return out
}

export interface DrawView {
  /** Surface y shown at the top of the canvas */
  top: number
  height: number
  width: number
  /** Device pixels per surface px */
  scale: number
  dark: boolean
}

export function prepareCanvas(canvas: HTMLCanvasElement, view: DrawView): CanvasRenderingContext2D | null {
  const w = Math.max(1, Math.round(view.width * view.scale))
  const h = Math.max(1, Math.round(view.height * view.scale))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.setTransform(view.scale, 0, 0, view.scale, 0, -view.top * view.scale)
  return ctx
}

/** Draw strokes; `offset` maps a stroke to its surface offset (overlay anchors). */
export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  view: DrawView,
  offset: (s: Stroke) => { dx: number; dy: number },
  bounds: (s: Stroke) => Box,
  adapt: boolean,
) {
  for (const s of strokes) {
    const { dx, dy } = offset(s)
    const b = bounds(s)
    if (b.maxY + dy < view.top - 40 || b.minY + dy > view.top + view.height + 40) continue
    ctx.save()
    ctx.translate(dx, dy)
    ctx.globalAlpha = s.opacity * (PEN_FEEL[s.penType]?.alpha ?? 1)
    ctx.fillStyle = adaptColor(s.color, adapt && view.dark)
    ctx.fill(cachedPath(s))
    ctx.restore()
  }
}

// ---------- Geometry ----------

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const boxCache = new WeakMap<Stroke, Box>()

export function strokeBox(s: Stroke): Box {
  const hit = boxCache.get(s)
  if (hit) return hit
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < s.pts.length; i += 3) {
    minX = Math.min(minX, s.pts[i])
    maxX = Math.max(maxX, s.pts[i])
    minY = Math.min(minY, s.pts[i + 1])
    maxY = Math.max(maxY, s.pts[i + 1])
  }
  const r = s.width / 2
  const box = { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r }
  boxCache.set(s, box)
  return box
}

function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0
  t = Math.max(0, Math.min(1, t))
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return x * x + y * y
}

/** Does a circle (in stroke-local coords) touch the stroke? */
export function strokeHitsCircle(s: Stroke, cx: number, cy: number, r: number): boolean {
  const b = strokeBox(s)
  if (cx + r < b.minX || cx - r > b.maxX || cy + r < b.minY || cy - r > b.maxY) return false
  const rr = (r + s.width / 2) ** 2
  const p = s.pts
  if (p.length === 3) return (p[0] - cx) ** 2 + (p[1] - cy) ** 2 <= rr
  for (let i = 3; i < p.length; i += 3) {
    if (distToSegmentSq(cx, cy, p[i - 3], p[i - 2], p[i], p[i + 1]) <= rr) return true
  }
  return false
}

/**
 * Area erase: remove the parts of a stroke inside the circle. Returns the
 * remaining pieces as point arrays (empty array = stroke fully erased), or
 * null if the stroke is untouched.
 */
export function eraseArea(s: Stroke, cx: number, cy: number, r: number): number[][] | null {
  if (!strokeHitsCircle(s, cx, cy, r)) return null
  const step = Math.max(1, r / 3)
  // Resample so gaps are cut precisely.
  const dense: number[] = []
  const p = s.pts
  for (let i = 0; i < p.length; i += 3) {
    if (i > 0) {
      const dx = p[i] - p[i - 3]
      const dy = p[i + 1] - p[i - 2]
      const n = Math.floor(Math.hypot(dx, dy) / step)
      for (let k = 1; k < n; k++) {
        const t = k / n
        dense.push(p[i - 3] + dx * t, p[i - 2] + dy * t, p[i - 1] + (p[i + 2] - p[i - 1]) * t)
      }
    }
    dense.push(p[i], p[i + 1], p[i + 2])
  }
  const cut = (r + s.width / 2) ** 2
  const pieces: number[][] = []
  let cur: number[] = []
  for (let i = 0; i < dense.length; i += 3) {
    const inside = (dense[i] - cx) ** 2 + (dense[i + 1] - cy) ** 2 <= cut
    if (inside) {
      if (cur.length >= 6) pieces.push(cur)
      cur = []
    } else cur.push(dense[i], dense[i + 1], dense[i + 2])
  }
  if (cur.length >= 6) pieces.push(cur)
  return pieces
}

export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i]
    const yi = poly[i + 1]
    const xj = poly[j]
    const yj = poly[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A stroke is lassoed when most of its points are inside the polygon. */
export function strokeInLasso(s: Stroke, dx: number, dy: number, poly: number[]): boolean {
  let hits = 0
  let total = 0
  for (let i = 0; i < s.pts.length; i += 3) {
    total++
    if (pointInPolygon(s.pts[i] + dx, s.pts[i + 1] + dy, poly)) hits++
  }
  return total > 0 && hits / total >= 0.6
}
