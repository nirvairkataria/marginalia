import { mergeAttributes, Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import type * as Y from 'yjs'
import { registerCanvasSurface } from '../ink/input'
import { InkSurface } from '../ink/surface'
import { getPageZoom, onPageZoom } from '../ink/zoom'

/**
 * A drawing area inside the document. Full width, or floated left/right with
 * text wrapping around it. Its strokes live in the note's Yjs doc under
 * `ink:<id>`, next to the text.
 */

export type CanvasAlign = 'full' | 'left' | 'right'
export type CanvasBackground = 'blank' | 'grid' | 'lines' | 'dots'

const BACKGROUNDS: CanvasBackground[] = ['blank', 'grid', 'lines', 'dots']
const MIN_H = 80
const MIN_W = 160

export const newCanvasId = () => `c-${crypto.randomUUID().slice(0, 12)}`

const ICONS = {
  left: '<svg viewBox="0 0 20 20"><rect x="2" y="4" width="8" height="8" rx="1.5"/><path d="M12 5h6M12 8h6M12 11h6M2 15h16"/></svg>',
  full: '<svg viewBox="0 0 20 20"><rect x="2" y="3" width="16" height="10" rx="1.5"/><path d="M2 16h16"/></svg>',
  right: '<svg viewBox="0 0 20 20"><rect x="10" y="4" width="8" height="8" rx="1.5"/><path d="M2 5h6M2 8h6M2 11h6M2 15h16"/></svg>',
  bg: '<svg viewBox="0 0 20 20"><rect x="2.5" y="2.5" width="15" height="15" rx="1.5"/><path d="M7.5 2.5v15M12.5 2.5v15M2.5 7.5h15M2.5 12.5h15"/></svg>',
  del: '<svg viewBox="0 0 20 20"><path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/></svg>',
}

class CanvasView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private editor: Editor
  private getPos: () => number | undefined
  private surfaceEl: HTMLElement
  private surface: InkSurface
  private cleanup: (() => void)[] = []

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined, doc: Y.Doc) {
    this.node = node
    this.editor = editor
    this.getPos = getPos

    this.dom = document.createElement('div')
    this.dom.className = 'canvas-block'
    this.dom.contentEditable = 'false'

    this.surfaceEl = document.createElement('div')
    this.surfaceEl.className = 'canvas-surface'
    const main = document.createElement('canvas')
    const live = document.createElement('canvas')
    main.className = 'ink-layer'
    live.className = 'ink-layer'
    this.surfaceEl.append(main, live)

    const controls = document.createElement('div')
    controls.className = 'canvas-controls'
    controls.dataset.inkIgnore = ''
    const button = (icon: string, title: string, fn: () => void, key?: string) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.title = title
      b.setAttribute('aria-label', title)
      b.innerHTML = icon
      if (key) b.dataset.key = key
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', fn)
      controls.appendChild(b)
      return b
    }
    button(ICONS.left, 'Float left, text wraps on the right', () => this.setAlign('left'), 'left')
    button(ICONS.full, 'Full width', () => this.setAlign('full'), 'full')
    button(ICONS.right, 'Float right, text wraps on the left', () => this.setAlign('right'), 'right')
    button(ICONS.bg, 'Change paper (blank, grid, lines, dots)', () => this.cycleBackground())
    button(ICONS.del, 'Delete canvas', () => this.remove())

    const resizeY = document.createElement('div')
    resizeY.className = 'canvas-resize canvas-resize-y'
    resizeY.dataset.inkIgnore = ''
    resizeY.title = 'Drag to resize'
    const resizeX = document.createElement('div')
    resizeX.className = 'canvas-resize canvas-resize-x'
    resizeX.dataset.inkIgnore = ''
    resizeX.title = 'Drag to resize'
    this.bindResize(resizeY, 'y')
    this.bindResize(resizeX, 'x')

    this.dom.append(this.surfaceEl, controls, resizeY, resizeX)
    this.applyAttrs()

    let id: string = node.attrs.id
    if (!id) {
      id = newCanvasId()
      queueMicrotask(() => this.setAttrs({ id }))
    }
    this.surface = new InkSurface({
      doc,
      id,
      origin: this.surfaceEl,
      zoom: getPageZoom,
      main,
      live,
      size: () => ({ width: this.surfaceEl.offsetWidth, height: this.surfaceEl.offsetHeight }),
    })
    this.cleanup.push(registerCanvasSurface(this.surfaceEl, this.surface))
    this.cleanup.push(onPageZoom(() => this.surface.requestRender()))
    const ro = new ResizeObserver(() => this.surface.requestRender())
    ro.observe(this.surfaceEl)
    this.cleanup.push(() => ro.disconnect())
  }

  private applyAttrs() {
    const { align, width, height, background, bid } = this.node.attrs
    this.dom.dataset.align = align
    this.dom.dataset.background = background
    if (bid) this.dom.dataset.bid = bid
    this.dom.style.width = align === 'full' || !width ? '' : `${width}px`
    this.surfaceEl.style.height = `${height}px`
    for (const b of this.dom.querySelectorAll<HTMLElement>('.canvas-controls [data-key]')) {
      b.classList.toggle('active', b.dataset.key === align)
    }
  }

  private setAttrs(patch: Record<string, unknown>) {
    const pos = this.getPos()
    if (pos === undefined) return
    const { view } = this.editor
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch }))
  }

  private setAlign(align: CanvasAlign) {
    const width = align === 'full' ? null : (this.node.attrs.width ?? 320)
    this.setAttrs({ align, width })
  }

  private cycleBackground() {
    const i = BACKGROUNDS.indexOf(this.node.attrs.background)
    this.setAttrs({ background: BACKGROUNDS[(i + 1) % BACKGROUNDS.length] })
  }

  private remove() {
    const pos = this.getPos()
    if (pos === undefined) return
    const { view } = this.editor
    view.dispatch(view.state.tr.delete(pos, pos + this.node.nodeSize))
  }

  private bindResize(handle: HTMLElement, axis: 'x' | 'y') {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startY = e.clientY
      const startH = this.surfaceEl.offsetHeight
      const startW = this.dom.offsetWidth
      const right = this.node.attrs.align === 'right'
      const maxW = (this.dom.parentElement?.clientWidth ?? 640) - 40
      let next = axis === 'y' ? startH : startW
      const onMove = (ev: PointerEvent) => {
        const z = getPageZoom()
        if (axis === 'y') {
          next = Math.max(MIN_H, Math.round(startH + (ev.clientY - startY) / z))
          this.surfaceEl.style.height = `${next}px`
        } else {
          const d = (ev.clientX - startX) / z
          next = Math.min(maxW, Math.max(MIN_W, Math.round(startW + (right ? -d : d))))
          this.dom.style.width = `${next}px`
        }
      }
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        this.setAttrs(axis === 'y' ? { height: next } : { width: next })
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    })
  }

  update(node: PMNode) {
    if (node.type !== this.node.type || node.attrs.id !== this.node.attrs.id) return false
    this.node = node
    this.applyAttrs()
    this.surface.requestRender()
    return true
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent() {
    return true
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.cleanup.forEach((fn) => fn())
    this.surface.destroy()
  }
}

export interface CanvasBlockOptions {
  doc: Y.Doc | null
}

export const CanvasBlock = Node.create<CanvasBlockOptions>({
  name: 'canvasBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions: () => ({ doc: null }),

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-canvas-id'), renderHTML: (a) => ({ 'data-canvas-id': a.id }) },
      align: { default: 'full', parseHTML: (el) => el.getAttribute('data-align') ?? 'full', renderHTML: (a) => ({ 'data-align': a.align }) },
      width: { default: null, parseHTML: (el) => Number(el.getAttribute('data-width')) || null, renderHTML: (a) => (a.width ? { 'data-width': a.width } : {}) },
      height: { default: 260, parseHTML: (el) => Number(el.getAttribute('data-height')) || 260, renderHTML: (a) => ({ 'data-height': a.height }) },
      background: { default: 'blank', parseHTML: (el) => el.getAttribute('data-background') ?? 'blank', renderHTML: (a) => ({ 'data-background': a.background }) },
    }
  },

  parseHTML: () => [{ tag: 'div[data-type="canvas"]' }],

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'canvas' })]
  },

  addNodeView() {
    const doc = this.options.doc
    return ({ node, editor, getPos }) => {
      if (!doc) throw new Error('CanvasBlock needs the note Y.Doc')
      return new CanvasView(node, editor, getPos, doc)
    }
  },
})
