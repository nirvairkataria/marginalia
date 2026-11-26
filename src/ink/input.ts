import { activeTool, getSettings, updateSettings } from '../lib/settings'
import { clearAllSelections, deleteSelection, duplicateSelection, type InkSurface } from './surface'
import type { ToolPreset } from './types'

/**
 * Routes pointer input on the page to the right ink surface.
 *
 * - With an ink tool selected, pen and mouse draw; fingers scroll (unless
 *   "fingers draw" is on). Touch is ignored right after pen activity (palm
 *   rejection).
 * - With the text tool selected, a pen still draws if "pen always draws" is
 *   on; the mouse edits text as usual.
 * - The pen's eraser end (or barrel eraser button) always erases.
 * - Canvas blocks register themselves; strokes starting on one go there,
 *   everything else goes to the page overlay.
 */

const canvasSurfaces = new Map<HTMLElement, InkSurface>()

export function registerCanvasSurface(el: HTMLElement, surface: InkSurface) {
  canvasSurfaces.set(el, surface)
  return () => canvasSurfaces.delete(el)
}

function canvasSurfaceAt(x: number, y: number): InkSurface | null {
  for (const [el, surface] of canvasSurfaces) {
    if (!el.isConnected) continue
    const r = el.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return surface
  }
  return null
}

const DEFAULT_ERASER: ToolPreset = {
  id: 'builtin-eraser',
  kind: 'eraser',
  name: 'Eraser',
  color: '#000000',
  width: 16,
  opacity: 1,
  penType: 'ballpoint',
  pressure: false,
  eraserMode: 'stroke',
}

function isEraserEnd(e: PointerEvent) {
  return e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0)
}

function toolFor(e: PointerEvent): ToolPreset | null {
  const s = getSettings()
  if (isEraserEnd(e)) return s.tools.find((t) => t.kind === 'eraser') ?? DEFAULT_ERASER
  const tool = activeTool(s)
  if (tool) return tool
  if (e.pointerType === 'pen' && s.penAlwaysDraws) {
    return s.tools.find((t) => t.id === s.lastInkToolId) ?? s.tools.find((t) => t.kind === 'pen') ?? null
  }
  return null
}

export function attachInkInput(page: HTMLElement, pageSurface: () => InkSurface | null): () => void {
  let active: { id: number; surface: InkSurface } | null = null
  let lastPen = 0
  let suppressClick = false
  let penNearTimer = 0

  const penNear = () => {
    lastPen = performance.now()
    page.classList.add('pen-near')
    window.clearTimeout(penNearTimer)
    penNearTimer = window.setTimeout(() => page.classList.remove('pen-near'), 1200)
  }

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'pen') penNear()
    if ((e.target as HTMLElement).closest('[data-ink-ignore]')) return
    const s = getSettings()
    if (e.pointerType === 'touch') {
      if (!s.touchDraws || !activeTool(s)) return
      if (performance.now() - lastPen < 600) {
        e.preventDefault() // palm resting while writing
        return
      }
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const tool = toolFor(e)
    if (!tool) return
    if (active) return
    e.preventDefault()
    e.stopPropagation()
    const surface = canvasSurfaceAt(e.clientX, e.clientY) ?? pageSurface()
    if (!surface) return
    try {
      page.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic or already-released pointer */
    }
    active = { id: e.pointerId, surface }
    suppressClick = true
    surface.begin(e, tool)
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'pen') penNear()
    if (active && e.pointerId === active.id) {
      e.preventDefault()
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      active.surface.move(events.length ? events : [e])
      return
    }
    if (!active && e.pointerType === 'pen' && e.buttons === 0) {
      const surface = canvasSurfaceAt(e.clientX, e.clientY) ?? pageSurface()
      surface?.hover(e, toolFor(e))
    }
  }

  const onUp = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.id) return
    e.preventDefault()
    active.surface.end()
    active = null
    try {
      if (page.hasPointerCapture(e.pointerId)) page.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onCancel = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.id) return
    active.surface.cancel()
    active = null
  }

  const onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'pen' && !active) pageSurface()?.clearHover()
  }

  const onClick = (e: MouseEvent) => {
    if (!suppressClick) return
    suppressClick = false
    e.preventDefault()
    e.stopPropagation()
  }
  const onMouseDown = () => {
    suppressClick = false
  }

  page.addEventListener('pointerdown', onDown, true)
  page.addEventListener('pointermove', onMove, true)
  page.addEventListener('pointerup', onUp, true)
  page.addEventListener('pointercancel', onCancel, true)
  page.addEventListener('pointerleave', onLeave)
  page.addEventListener('click', onClick, true)
  page.addEventListener('mousedown', onMouseDown, true)
  return () => {
    page.removeEventListener('pointerdown', onDown, true)
    page.removeEventListener('pointermove', onMove, true)
    page.removeEventListener('pointerup', onUp, true)
    page.removeEventListener('pointercancel', onCancel, true)
    page.removeEventListener('pointerleave', onLeave)
    page.removeEventListener('click', onClick, true)
    page.removeEventListener('mousedown', onMouseDown, true)
    window.clearTimeout(penNearTimer)
  }
}

/** Keyboard: Esc returns to the text tool; Delete / Ctrl+D act on a lasso selection. */
export function handleInkKeys(e: KeyboardEvent): boolean {
  const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"], math-field, .cm-editor')
  if (e.key === 'Escape') {
    clearAllSelections()
    if (getSettings().activeToolId) {
      updateSettings({ activeToolId: null })
      return true
    }
    return false
  }
  if (typing && !getSettings().activeToolId) return false
  if (e.key === 'Delete' || e.key === 'Backspace') return deleteSelection()
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') return duplicateSelection()
  return false
}
