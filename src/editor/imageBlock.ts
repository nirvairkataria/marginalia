import { mergeAttributes, Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import type * as Y from 'yjs'
import { getPageZoom } from '../ink/zoom'
import { assetUrl, whenAsset } from './assets'

/**
 * An image block: centred, or floated left/right with text wrapping around it
 * (like canvas blocks). Pasted/dropped images are stored in the note itself.
 */

type Align = 'center' | 'left' | 'right'

const ICONS = {
  left: '<svg viewBox="0 0 20 20"><rect x="2" y="4" width="8" height="8" rx="1.5"/><path d="M12 5h6M12 8h6M12 11h6M2 15h16"/></svg>',
  center: '<svg viewBox="0 0 20 20"><rect x="5" y="3" width="10" height="10" rx="1.5"/><path d="M2 16h16"/></svg>',
  right: '<svg viewBox="0 0 20 20"><rect x="10" y="4" width="8" height="8" rx="1.5"/><path d="M2 5h6M2 8h6M2 11h6M2 15h16"/></svg>',
  del: '<svg viewBox="0 0 20 20"><path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/></svg>',
}

class ImageView implements NodeView {
  dom: HTMLElement
  private img: HTMLImageElement
  private node: PMNode
  private editor: Editor
  private getPos: () => number | undefined
  private doc: Y.Doc | null
  private stopWaiting: () => void = () => {}

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined, doc: Y.Doc | null) {
    this.node = node
    this.editor = editor
    this.getPos = getPos
    this.doc = doc
    this.dom = document.createElement('figure')
    this.dom.className = 'image-block'
    this.dom.contentEditable = 'false'
    this.img = document.createElement('img')
    this.img.draggable = false

    const controls = document.createElement('div')
    controls.className = 'canvas-controls'
    controls.dataset.inkIgnore = ''
    const btn = (icon: string, title: string, fn: () => void, key?: string) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.title = title
      b.innerHTML = icon
      if (key) b.dataset.key = key
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', fn)
      controls.appendChild(b)
    }
    btn(ICONS.left, 'Float left, text wraps on the right', () => this.set({ align: 'left', width: this.node.attrs.width ?? 280 }), 'left')
    btn(ICONS.center, 'Centre', () => this.set({ align: 'center' }), 'center')
    btn(ICONS.right, 'Float right, text wraps on the left', () => this.set({ align: 'right', width: this.node.attrs.width ?? 280 }), 'right')
    btn(ICONS.del, 'Delete image', () => {
      const pos = this.getPos()
      if (pos !== undefined) this.editor.view.dispatch(this.editor.state.tr.delete(pos, pos + this.node.nodeSize))
    })

    const handle = document.createElement('div')
    handle.className = 'canvas-resize image-resize'
    handle.dataset.inkIgnore = ''
    handle.title = 'Drag to resize'
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startW = this.img.getBoundingClientRect().width / getPageZoom()
      const right = this.node.attrs.align === 'right'
      const max = (this.dom.parentElement?.clientWidth ?? 640) - 8
      let w = startW
      const move = (ev: PointerEvent) => {
        const d = (ev.clientX - startX) / getPageZoom()
        w = Math.round(Math.max(60, Math.min(max, startW + (right ? -d : d))))
        this.dom.style.width = `${w}px`
      }
      const up = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        this.set({ width: w })
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
    })

    this.dom.append(this.img, controls, handle)
    this.apply()
  }

  private set(patch: Record<string, unknown>) {
    const pos = this.getPos()
    if (pos === undefined) return
    this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch }))
  }

  private apply() {
    const { asset, src, alt, width, align, bid } = this.node.attrs
    this.dom.dataset.align = align
    if (bid) this.dom.dataset.bid = bid
    this.dom.style.width = width ? `${width}px` : ''
    this.img.alt = alt ?? ''
    for (const b of this.dom.querySelectorAll<HTMLElement>('[data-key]')) b.classList.toggle('active', b.dataset.key === align)
    this.stopWaiting()
    if (asset && this.doc) {
      const doc = this.doc
      this.img.removeAttribute('src')
      this.dom.classList.add('loading')
      this.stopWaiting = whenAsset(doc, asset, () => {
        this.img.src = assetUrl(doc, asset) ?? ''
        this.dom.classList.remove('loading')
      })
    } else if (src) {
      this.img.src = src
    }
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    const changed = node.attrs !== this.node.attrs
    this.node = node
    if (changed) this.apply()
    return true
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(e: Event) {
    return e.type !== 'dragstart' && !!(e.target as HTMLElement).closest?.('.canvas-controls, .image-resize')
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.stopWaiting()
  }
}

export const ImageBlock = Node.create<{ doc: Y.Doc | null }>({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions: () => ({ doc: null }),

  addAttributes() {
    return {
      asset: { default: null, parseHTML: (el) => el.getAttribute('data-asset'), renderHTML: (a) => (a.asset ? { 'data-asset': a.asset } : {}) },
      src: { default: null, parseHTML: (el) => (el.getAttribute('data-asset') ? null : el.getAttribute('src')), renderHTML: (a) => (a.src ? { src: a.src } : {}) },
      alt: { default: '', parseHTML: (el) => el.getAttribute('alt') ?? '', renderHTML: (a) => ({ alt: a.alt }) },
      width: { default: null, parseHTML: (el) => Number(el.getAttribute('data-width') ?? el.getAttribute('width')) || null, renderHTML: (a) => (a.width ? { 'data-width': a.width } : {}) },
      align: { default: 'center', parseHTML: (el) => (el.getAttribute('data-align') as Align) ?? 'center', renderHTML: (a) => ({ 'data-align': a.align }) },
    }
  },

  parseHTML: () => [{ tag: 'img[src]' }, { tag: 'img[data-asset]' }],

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    const doc = this.options.doc
    return ({ node, editor, getPos }) => new ImageView(node, editor, getPos, doc)
  },
})
