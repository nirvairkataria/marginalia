import * as Y from 'yjs'
import { getSettings, isDark, subscribeSettings } from '../lib/settings'
import {
  drawStrokes,
  eraseArea,
  prepareCanvas,
  strokeBox,
  strokeHitsCircle,
  strokeInLasso,
  strokePath,
  adaptColor,
  type Box,
  type DrawView,
} from './render'
import { INK_ORIGIN, type Stroke, type ToolPreset } from './types'
import { addInkScope, syncUndoScope } from './undo'

/**
 * An ink surface: the page overlay, or one canvas block. Owns rendering and
 * the behaviour of every ink tool (pen, highlighter, eraser, lasso).
 *
 * Surface coordinates are CSS px of the unzoomed page (or canvas block).
 */

export interface AnchorProvider {
  /** Current top (surface y) of an anchor block, if it still exists. */
  top(anchor: string): number | undefined
  /** Best block to attach a stroke at surface y to. */
  find(y: number): { anchor: string; top: number } | null
  /** Re-measure block positions (after layout changes). */
  refresh(): void
}

export interface SurfaceOptions {
  doc: Y.Doc
  id: string
  /** Element whose top-left corner is the surface origin. */
  origin: HTMLElement
  zoom: () => number
  /** Canvas for highlighters, under the text (page overlay only). */
  under?: HTMLCanvasElement
  main: HTMLCanvasElement
  live: HTMLCanvasElement
  /** Visible part of the surface in surface coords (page overlay only). */
  viewport?: () => { top: number; height: number }
  /** Size of the surface (canvas blocks). */
  size: () => { width: number; height: number }
  anchors?: AnchorProvider
  /** Lighten dark ink in dark mode (off for surfaces that stay white, like PDF pages). Default true. */
  adaptToDark?: boolean
  /** Called after the canvases are positioned for a new viewport. */
  onViewport?: (top: number, height: number) => void
}

type Mode =
  | { type: 'idle' }
  | { type: 'draw'; tool: ToolPreset; pts: number[]; sim: boolean }
  | { type: 'erase'; tool: ToolPreset; x: number; y: number }
  | { type: 'lasso'; poly: number[] }
  | { type: 'move'; startX: number; startY: number; dx: number; dy: number }
  | { type: 'scale'; ox: number; oy: number; startX: number; startY: number; k: number }

let surfaceWithSelection: InkSurface | null = null

export function clearAllSelections() {
  surfaceWithSelection?.clearSelection()
}

export function deleteSelection(): boolean {
  if (!surfaceWithSelection?.hasSelection()) return false
  surfaceWithSelection.deleteSelected()
  return true
}

export function duplicateSelection(): boolean {
  if (!surfaceWithSelection?.hasSelection()) return false
  surfaceWithSelection.duplicateSelected()
  return true
}

export function selectionSurface(): InkSurface | null {
  return surfaceWithSelection?.hasSelection() ? surfaceWithSelection : null
}

const HANDLE = 9

export class InkSurface {
  readonly map: Y.Map<Stroke>
  private opts: SurfaceOptions
  private mode: Mode = { type: 'idle' }
  private selection = new Set<string>()
  private hidden = new Set<string>()
  private frame = 0
  private liveFrame = 0
  private unsubscribe: () => void
  private onMapChange = () => this.requestRender()
  private seq = 0

  constructor(opts: SurfaceOptions) {
    this.opts = opts
    this.map = opts.doc.getMap<Stroke>(`ink:${opts.id}`)
    // Request a low-latency canvas for the stroke being drawn.
    opts.live.getContext('2d', { desynchronized: true })
    this.map.observe(this.onMapChange)
    addInkScope(this.map as Y.Map<unknown>)
    this.unsubscribe = subscribeSettings(() => this.requestRender())
    this.requestRender()
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.liveFrame)
    this.map.unobserve(this.onMapChange)
    this.unsubscribe()
    if (surfaceWithSelection === this) surfaceWithSelection = null
  }

  // ---------- coordinates ----------

  toSurface(e: { clientX: number; clientY: number }) {
    const r = this.opts.origin.getBoundingClientRect()
    const z = this.opts.zoom()
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z }
  }

  private offset = (s: Stroke) => {
    if (!this.opts.anchors) return { dx: 0, dy: 0 }
    const top = s.anchor ? this.opts.anchors.top(s.anchor) : undefined
    return { dx: 0, dy: top ?? s.ay ?? 0 }
  }

  private sorted(): Stroke[] {
    return [...this.map.values()].sort((a, b) => a.z - b.z)
  }

  private view(): DrawView {
    const z = this.opts.zoom()
    const { width, height } = this.opts.size()
    const vp = this.opts.viewport?.() ?? { top: 0, height }
    return { top: vp.top, height: vp.height, width, scale: (window.devicePixelRatio || 1) * z, dark: isDark() }
  }

  // ---------- rendering ----------

  requestRender() {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.render())
  }

  render() {
    const view = this.view()
    this.opts.onViewport?.(view.top, view.height)
    const adapt = (getSettings().adaptInkToDark && this.opts.adaptToDark !== false)
    const strokes = this.sorted().filter((s) => !this.hidden.has(s.id))
    if (this.opts.under) {
      const under = prepareCanvas(this.opts.under, view)
      const main = prepareCanvas(this.opts.main, view)
      if (under) drawStrokes(under, strokes.filter((s) => s.kind === 'highlighter'), view, this.offset, strokeBox, adapt)
      if (main) drawStrokes(main, strokes.filter((s) => s.kind !== 'highlighter'), view, this.offset, strokeBox, adapt)
    } else {
      const main = prepareCanvas(this.opts.main, view)
      if (main) drawStrokes(main, strokes, view, this.offset, strokeBox, adapt)
    }
    this.renderLive()
  }

  private requestLive() {
    cancelAnimationFrame(this.liveFrame)
    this.liveFrame = requestAnimationFrame(() => this.renderLive())
  }

  private renderLive() {
    const view = this.view()
    const ctx = prepareCanvas(this.opts.live, view)
    if (!ctx) return
    const dark = view.dark
    const adapt = (getSettings().adaptInkToDark && this.opts.adaptToDark !== false)
    const m = this.mode
    if (m.type === 'draw') {
      const s = this.draftStroke(m.tool, m.pts, m.sim)
      ctx.globalAlpha = s.opacity
      ctx.fillStyle = adaptColor(s.color, adapt && dark)
      ctx.fill(strokePath(s, false))
      ctx.globalAlpha = 1
    }
    if (m.type === 'erase') {
      ctx.beginPath()
      ctx.arc(m.x, m.y, m.tool.width / 2, 0, Math.PI * 2)
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)'
      ctx.lineWidth = 1 / this.opts.zoom()
      ctx.stroke()
    }
    if (m.type === 'lasso' && m.poly.length >= 4) {
      ctx.beginPath()
      ctx.moveTo(m.poly[0], m.poly[1])
      for (let i = 2; i < m.poly.length; i += 2) ctx.lineTo(m.poly[i], m.poly[i + 1])
      ctx.closePath()
      ctx.fillStyle = 'rgba(64, 128, 220, 0.08)'
      ctx.fill()
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = '#3d7fd9'
      ctx.lineWidth = 1.2
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (this.selection.size) this.drawSelection(ctx, adapt && dark)
  }

  private transformOf(): (x: number, y: number) => [number, number] {
    const m = this.mode
    if (m.type === 'move') return (x, y) => [x + m.dx, y + m.dy]
    if (m.type === 'scale') return (x, y) => [m.ox + (x - m.ox) * m.k, m.oy + (y - m.oy) * m.k]
    return (x, y) => [x, y]
  }

  private drawSelection(ctx: CanvasRenderingContext2D, adapt: boolean) {
    const t = this.transformOf()
    const moving = this.mode.type === 'move' || this.mode.type === 'scale'
    if (moving) {
      for (const id of this.selection) {
        const s = this.map.get(id)
        if (!s) continue
        const moved = this.transformStroke(s, t)
        const { dy } = this.offset(moved)
        ctx.save()
        ctx.translate(0, dy)
        ctx.globalAlpha = moved.opacity
        ctx.fillStyle = adaptColor(moved.color, adapt)
        ctx.fill(strokePath(moved))
        ctx.restore()
      }
    }
    const box = this.selectionBox()
    if (!box) return
    const [x0, y0] = t(box.minX, box.minY)
    const [x1, y1] = t(box.maxX, box.maxY)
    const z = this.opts.zoom()
    ctx.setLineDash([6 / z, 4 / z])
    ctx.strokeStyle = '#3d7fd9'
    ctx.lineWidth = 1.2 / z
    ctx.strokeRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8)
    ctx.setLineDash([])
    ctx.fillStyle = '#ffffff'
    const h = HANDLE / z
    ctx.fillRect(x1 + 4 - h / 2, y1 + 4 - h / 2, h, h)
    ctx.strokeRect(x1 + 4 - h / 2, y1 + 4 - h / 2, h, h)
  }

  // ---------- stroke helpers ----------

  private draftStroke(tool: ToolPreset, pts: number[], sim: boolean): Stroke {
    return {
      id: 'draft',
      kind: tool.kind === 'highlighter' ? 'highlighter' : 'pen',
      penType: tool.penType,
      color: tool.color,
      width: tool.width,
      opacity: tool.kind === 'highlighter' ? tool.opacity : tool.opacity || 1,
      pressure: tool.kind === 'pen' && tool.pressure,
      sim,
      pts,
      z: 0,
    }
  }

  private newId() {
    return `${Date.now().toString(36)}-${(this.seq++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }

  private nextZ() {
    let z = Date.now()
    for (const s of this.map.values()) if (s.z >= z) z = s.z + 1
    return z
  }

  /** Convert surface-space points to a stored stroke (anchored on the page overlay). */
  private place(base: Omit<Stroke, 'anchor' | 'ay'>, surfacePts: number[]): Stroke {
    const anchors = this.opts.anchors
    if (!anchors) return { ...base, pts: round(surfacePts) }
    anchors.refresh()
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 1; i < surfacePts.length; i += 3) {
      minY = Math.min(minY, surfacePts[i])
      maxY = Math.max(maxY, surfacePts[i])
    }
    const hit = anchors.find((minY + maxY) / 2)
    const top = hit?.top ?? 0
    const pts = surfacePts.slice()
    for (let i = 1; i < pts.length; i += 3) pts[i] -= top
    return { ...base, pts: round(pts), anchor: hit?.anchor ?? null, ay: top }
  }

  /** Stroke with points mapped through a transform in surface space, re-anchored. */
  private transformStroke(s: Stroke, t: (x: number, y: number) => [number, number], scale = 1): Stroke {
    const { dy } = this.offset(s)
    const pts: number[] = []
    for (let i = 0; i < s.pts.length; i += 3) {
      const [x, y] = t(s.pts[i], s.pts[i + 1] + dy)
      pts.push(x, y, s.pts[i + 2])
    }
    const { anchor: _a, ay: _y, ...rest } = s
    return this.place({ ...rest, width: s.width * scale }, pts)
  }

  /** All ink edits go through here: one undo step, tagged as ink. */
  private tx(fn: () => void) {
    syncUndoScope()
    this.map.doc!.transact(fn, INK_ORIGIN)
  }

  // ---------- input ----------

  begin(e: PointerEvent, tool: ToolPreset) {
    const { x, y } = this.toSurface(e)
    if (surfaceWithSelection && surfaceWithSelection !== this) surfaceWithSelection.clearSelection()

    if (tool.kind === 'pen' || tool.kind === 'highlighter') {
      this.clearSelection()
      const sim = e.pointerType !== 'pen' || e.pressure === 0
      this.mode = { type: 'draw', tool, pts: [x, y, pressureOf(e)], sim }
      this.requestLive()
    } else if (tool.kind === 'eraser') {
      this.clearSelection()
      this.mode = { type: 'erase', tool, x, y }
      this.eraseAt(x, y, x, y, tool)
      this.requestLive()
    } else if (tool.kind === 'lasso') {
      const box = this.selectionBox()
      const z = this.opts.zoom()
      if (box && Math.abs(x - (box.maxX + 4)) < 12 / z && Math.abs(y - (box.maxY + 4)) < 12 / z) {
        this.mode = { type: 'scale', ox: box.minX, oy: box.minY, startX: x, startY: y, k: 1 }
        this.hideSelection()
      } else if (box && x >= box.minX - 6 && x <= box.maxX + 6 && y >= box.minY - 6 && y <= box.maxY + 6) {
        this.mode = { type: 'move', startX: x, startY: y, dx: 0, dy: 0 }
        this.hideSelection()
      } else {
        this.clearSelection()
        this.mode = { type: 'lasso', poly: [x, y] }
      }
      this.requestLive()
    }
  }

  move(events: PointerEvent[]) {
    const m = this.mode
    for (const e of events) {
      const { x, y } = this.toSurface(e)
      if (m.type === 'draw') {
        const n = m.pts.length
        if (Math.abs(m.pts[n - 3] - x) + Math.abs(m.pts[n - 2] - y) < 0.4) continue
        m.pts.push(x, y, pressureOf(e))
      } else if (m.type === 'erase') {
        this.eraseAt(m.x, m.y, x, y, m.tool)
        m.x = x
        m.y = y
      } else if (m.type === 'lasso') {
        m.poly.push(x, y)
      } else if (m.type === 'move') {
        m.dx = x - m.startX
        m.dy = y - m.startY
      } else if (m.type === 'scale') {
        const box = this.selectionBox()
        if (!box) continue
        const w = Math.max(1, box.maxX - box.minX)
        const h = Math.max(1, box.maxY - box.minY)
        const kx = (box.maxX - box.minX + (x - m.startX)) / w
        const ky = (box.maxY - box.minY + (y - m.startY)) / h
        m.k = Math.max(0.1, Math.min(10, Math.max(kx, ky)))
      }
    }
    this.requestLive()
  }

  /** Pen hovering (eraser outline preview etc.) */
  hover(e: PointerEvent, tool: ToolPreset | null) {
    if (this.mode.type !== 'idle') return
    if (tool?.kind === 'eraser') {
      const { x, y } = this.toSurface(e)
      this.mode = { type: 'erase', tool, x, y }
      this.renderLive()
      this.mode = { type: 'idle' }
    }
  }

  clearHover() {
    if (this.mode.type === 'idle') this.requestLive()
  }

  end() {
    const m = this.mode
    this.mode = { type: 'idle' }
    if (m.type === 'draw') {
      const tool = m.tool
      let pts = m.pts
      if (pts.length === 3) pts = [pts[0], pts[1], pts[2], pts[0] + 0.1, pts[1] + 0.1, pts[2]] // a dot
      const base = this.draftStroke(tool, pts, m.sim)
      const stroke = this.place({ ...base, id: this.newId(), z: this.nextZ() }, pts)
      this.tx(() => this.map.set(stroke.id, stroke))
    } else if (m.type === 'lasso') {
      if (m.poly.length >= 6) {
        for (const s of this.map.values()) {
          const { dx, dy } = this.offset(s)
          if (strokeInLasso(s, dx, dy, m.poly)) this.selection.add(s.id)
        }
        if (this.selection.size) surfaceWithSelection = this
      }
    } else if (m.type === 'move' || m.type === 'scale') {
      const t = m.type === 'move' ? (x: number, y: number): [number, number] => [x + m.dx, y + m.dy] : (x: number, y: number): [number, number] => [m.ox + (x - m.ox) * m.k, m.oy + (y - m.oy) * m.k]
      const scale = m.type === 'scale' ? m.k : 1
      const moved = m.type === 'move' ? m.dx !== 0 || m.dy !== 0 : m.k !== 1
      if (moved) {
        this.tx(() => {
          for (const id of this.selection) {
            const s = this.map.get(id)
            if (s) this.map.set(id, this.transformStroke(s, t, scale))
          }
        })
      }
      this.hidden.clear()
      this.requestRender()
    }
    this.requestLive()
  }

  cancel() {
    this.mode = { type: 'idle' }
    this.hidden.clear()
    this.requestRender()
  }

  // ---------- eraser ----------

  private eraseAt(x0: number, y0: number, x1: number, y1: number, tool: ToolPreset) {
    const r = tool.width / 2
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, r / 2)))
    const samples: [number, number][] = []
    for (let i = 0; i <= steps; i++) samples.push([x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps])

    this.tx(() => {
      for (const s of [...this.map.values()]) {
        const { dx, dy } = this.offset(s)
        if (tool.eraserMode === 'stroke') {
          if (samples.some(([sx, sy]) => strokeHitsCircle(s, sx - dx, sy - dy, r))) this.map.delete(s.id)
          continue
        }
        let pieces: number[][] | null = null
        let current = s
        for (const [sx, sy] of samples) {
          const res = eraseArea(current, sx - dx, sy - dy, r)
          if (!res) continue
          pieces = res
          if (res.length !== 1) break
          current = { ...current, pts: res[0] }
        }
        if (!pieces) continue
        this.map.delete(s.id)
        // Remaining pieces keep their anchor (local coords are unchanged).
        for (const pts of pieces) {
          const id = this.newId()
          this.map.set(id, { ...s, id, pts: round(pts) })
        }
      }
    })
  }

  // ---------- selection ----------

  hasSelection() {
    return this.selection.size > 0
  }

  /** Is the pointer on the selection box or its resize handle? */
  hitsSelection(e: { clientX: number; clientY: number }): boolean {
    const box = this.selectionBox()
    if (!box) return false
    const { x, y } = this.toSurface(e)
    const pad = 12 / this.opts.zoom()
    return x >= box.minX - pad && x <= box.maxX + pad && y >= box.minY - pad && y <= box.maxY + pad
  }

  private hideSelection() {
    for (const id of this.selection) this.hidden.add(id)
    this.requestRender()
  }

  selectionBox(): Box | null {
    if (!this.selection.size) return null
    let box: Box | null = null
    for (const id of this.selection) {
      const s = this.map.get(id)
      if (!s) continue
      const b = strokeBox(s)
      const { dx, dy } = this.offset(s)
      box = box
        ? { minX: Math.min(box.minX, b.minX + dx), minY: Math.min(box.minY, b.minY + dy), maxX: Math.max(box.maxX, b.maxX + dx), maxY: Math.max(box.maxY, b.maxY + dy) }
        : { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy }
    }
    return box
  }

  clearSelection() {
    if (!this.selection.size) return
    this.selection.clear()
    this.hidden.clear()
    if (surfaceWithSelection === this) surfaceWithSelection = null
    this.requestRender()
  }

  deleteSelected() {
    this.tx(() => {
      for (const id of this.selection) this.map.delete(id)
    })
    this.clearSelection()
  }

  duplicateSelected() {
    const ids: string[] = []
    let z = this.nextZ()
    this.tx(() => {
      for (const id of this.selection) {
        const s = this.map.get(id)
        if (!s) continue
        const copy = this.transformStroke({ ...s, id: this.newId(), z: z++ }, (x, y) => [x + 16, y + 16])
        this.map.set(copy.id, copy)
        ids.push(copy.id)
      }
    })
    this.selection = new Set(ids)
    this.requestRender()
  }

  /** Recolour the selected strokes (e.g. picking a pen while strokes are lassoed). */
  recolorSelected(color: string) {
    this.tx(() => {
      for (const id of this.selection) {
        const s = this.map.get(id)
        if (s) this.map.set(id, { ...s, color })
      }
    })
  }

  isBusy() {
    return this.mode.type !== 'idle'
  }
}

function pressureOf(e: PointerEvent) {
  return e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5
}

function round(pts: number[]): number[] {
  return pts.map((v) => Math.round(v * 100) / 100)
}
