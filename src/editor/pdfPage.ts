import { mergeAttributes, Node } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type * as Y from 'yjs'
import { registerCanvasSurface } from '../ink/input'
import { InkSurface } from '../ink/surface'
import { getPageZoom, onPageZoom } from '../ink/zoom'
import { getAsset, whenAsset } from './assets'

/**
 * One page of an imported PDF (lecture slides, papers, worksheets). The page
 * is drawn with pdf.js and has its own ink layer, so annotations stay glued to
 * the page. Pages are ordinary blocks: you can type notes between them.
 */

let pdfjs: Promise<typeof import('pdfjs-dist')> | null = null

export function loadPdfjs() {
  pdfjs ??= (async () => {
    const lib = await import('pdfjs-dist')
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    return lib
  })()
  return pdfjs
}

const docs = new WeakMap<Y.Doc, Map<string, Promise<PDFDocumentProxy>>>()

function openPdf(doc: Y.Doc, asset: string): Promise<PDFDocumentProxy> {
  let m = docs.get(doc)
  if (!m) docs.set(doc, (m = new Map()))
  let p = m.get(asset)
  if (!p) {
    p = loadPdfjs().then((lib) => {
      const a = getAsset(doc, asset)
      if (!a) throw new Error('PDF not available yet')
      // pdf.js takes ownership of the buffer, so hand it a copy.
      return lib.getDocument({ data: a.bytes.slice() }).promise
    })
    m.set(asset, p)
  }
  return p
}

/** Page sizes of a PDF file, for building page blocks when importing. */
export async function readPdfPages(bytes: Uint8Array, withText = false): Promise<{ count: number; aspects: number[]; title: string | null; text: string }> {
  const lib = await loadPdfjs()
  const task = lib.getDocument({ data: bytes.slice() })
  const pdf = await task.promise
  const aspects: number[] = []
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    aspects.push(vp.height / vp.width)
    if (withText && text.length < 20000) {
      const content = await page.getTextContent()
      text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
    }
  }
  const meta = await pdf.getMetadata().catch(() => null)
  const title = ((meta?.info as Record<string, unknown> | undefined)?.Title as string | undefined)?.trim() || null
  await task.destroy()
  return { count: aspects.length, aspects, title, text }
}

/** Render a PDF page to a canvas `cssWidth` px wide at `scale` device px per px. */
export async function renderPdfPageCanvas(doc: Y.Doc, asset: string, pageNo: number, cssWidth: number, scale: number): Promise<HTMLCanvasElement> {
  const pdf = await openPdf(doc, asset)
  const page = await pdf.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: (cssWidth / base.width) * scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  await page.render({ canvas, viewport: vp }).promise
  return canvas
}

/** Every mounted PDF page view, so printing can render them all first. */
const mountedPages = new Set<PdfPageView>()

/** Render every PDF page in the open note at print quality. */
export async function renderAllPdfPagesForPrint(): Promise<void> {
  await Promise.all([...mountedPages].map((v) => v.renderForPrint()))
}

class PdfPageView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private doc: Y.Doc
  private pageCanvas: HTMLCanvasElement
  private surfaceEl: HTMLElement
  private surface: InkSurface
  private cleanup: (() => void)[] = []
  private renderedScale = 0
  private visible = false
  private rendering: Promise<void> | null = null

  constructor(node: PMNode, doc: Y.Doc) {
    this.node = node
    this.doc = doc
    this.dom = document.createElement('div')
    this.dom.className = 'pdf-page'
    this.dom.contentEditable = 'false'

    this.surfaceEl = document.createElement('div')
    this.surfaceEl.className = 'pdf-surface'
    this.pageCanvas = document.createElement('canvas')
    this.pageCanvas.className = 'pdf-canvas'
    const main = document.createElement('canvas')
    const live = document.createElement('canvas')
    main.className = live.className = 'ink-layer'
    this.surfaceEl.append(this.pageCanvas, main, live)
    const label = document.createElement('div')
    label.className = 'pdf-label'
    this.dom.append(this.surfaceEl, label)
    this.apply()

    this.surface = new InkSurface({
      doc,
      id: `pdf-${node.attrs.id}`,
      adaptToDark: false, // the page stays white in dark mode
      origin: this.surfaceEl,
      zoom: getPageZoom,
      main,
      live,
      size: () => ({ width: this.surfaceEl.offsetWidth, height: this.surfaceEl.offsetHeight }),
    })
    this.cleanup.push(registerCanvasSurface(this.surfaceEl, this.surface))
    this.cleanup.push(
      onPageZoom(() => {
        this.surface.requestRender()
        void this.renderPage()
      }),
    )
    const ro = new ResizeObserver(() => {
      this.surface.requestRender()
      void this.renderPage()
    })
    ro.observe(this.surfaceEl)
    this.cleanup.push(() => ro.disconnect())

    // Only rasterise pages near the viewport.
    const io = new IntersectionObserver(
      (entries) => {
        this.visible = entries.some((e) => e.isIntersecting)
        if (this.visible) void this.renderPage()
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(this.dom)
    this.cleanup.push(() => io.disconnect())
    this.cleanup.push(whenAsset(doc, node.attrs.asset, () => void this.renderPage()))
    mountedPages.add(this)
    this.cleanup.push(() => mountedPages.delete(this))
  }

  /** Make sure this page is drawn (even if off screen), sharp enough for paper. */
  async renderForPrint() {
    const width = this.surfaceEl.offsetWidth
    if (!width || !this.node.attrs.asset) return
    const canvas = await renderPdfPageCanvas(this.doc, this.node.attrs.asset, this.node.attrs.page, width, 2.5)
    this.pageCanvas.width = canvas.width
    this.pageCanvas.height = canvas.height
    this.pageCanvas.getContext('2d')!.drawImage(canvas, 0, 0)
    this.renderedScale = 0
    this.dom.classList.add('rendered')
    this.surface.render()
  }

  private apply() {
    const { aspect, page, bid } = this.node.attrs
    this.surfaceEl.style.aspectRatio = `1 / ${aspect || 1.294}`
    ;(this.dom.querySelector('.pdf-label') as HTMLElement).textContent = `p. ${page}`
    if (bid) this.dom.dataset.bid = bid
  }

  private async renderPage() {
    if (!this.visible || !this.node.attrs.asset) return
    const scale = (window.devicePixelRatio || 1) * getPageZoom()
    const width = this.surfaceEl.offsetWidth
    if (!width || (this.renderedScale === scale * width && this.pageCanvas.width)) return
    if (this.rendering) return
    this.rendering = (async () => {
      try {
        const pdf = await openPdf(this.doc, this.node.attrs.asset)
        const page = await pdf.getPage(this.node.attrs.page)
        const base = page.getViewport({ scale: 1 })
        const vp = page.getViewport({ scale: (width / base.width) * scale })
        const off = document.createElement('canvas')
        off.width = Math.round(vp.width)
        off.height = Math.round(vp.height)
        await page.render({ canvas: off, viewport: vp }).promise
        this.pageCanvas.width = off.width
        this.pageCanvas.height = off.height
        this.pageCanvas.getContext('2d')!.drawImage(off, 0, 0)
        this.renderedScale = scale * width
        this.dom.classList.add('rendered')
      } catch (e) {
        this.dom.classList.add('failed')
        console.warn('PDF page render failed', e)
      } finally {
        this.rendering = null
      }
    })()
  }

  update(node: PMNode) {
    if (node.type !== this.node.type || node.attrs.id !== this.node.attrs.id || node.attrs.asset !== this.node.attrs.asset || node.attrs.page !== this.node.attrs.page) return false
    this.node = node
    this.apply()
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
    this.cleanup.forEach((f) => f())
    this.surface.destroy()
  }
}

export const PdfPage = Node.create<{ doc: Y.Doc | null }>({
  name: 'pdfPage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions: () => ({ doc: null }),

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id'), renderHTML: (a) => ({ 'data-id': a.id }) },
      asset: { default: null, parseHTML: (el) => el.getAttribute('data-asset'), renderHTML: (a) => ({ 'data-asset': a.asset }) },
      page: { default: 1, parseHTML: (el) => Number(el.getAttribute('data-page')) || 1, renderHTML: (a) => ({ 'data-page': a.page }) },
      aspect: { default: 1.294, parseHTML: (el) => Number(el.getAttribute('data-aspect')) || 1.294, renderHTML: (a) => ({ 'data-aspect': a.aspect }) },
    }
  },

  parseHTML: () => [{ tag: 'div[data-type="pdf-page"]' }],

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'pdf-page' })]
  },

  addNodeView() {
    const doc = this.options.doc
    return ({ node }) => {
      if (!doc) throw new Error('PdfPage needs the note Y.Doc')
      return new PdfPageView(node, doc)
    }
  },
})
