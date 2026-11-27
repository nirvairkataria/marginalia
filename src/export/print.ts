import katex from 'katex'
import type * as Y from 'yjs'
import { renderAllPdfPagesForPrint } from '../editor/pdfPage'
import { strokeAlpha, strokeSvgPath } from '../ink/render'
import type { Stroke } from '../ink/types'
import { getPageZoom } from '../ink/zoom'

/**
 * Export the open note as a PDF via the system print dialog ("Save as PDF").
 *
 * The note is printed from a static copy of the page: page ink is redrawn as
 * SVG *inside the block it's anchored to*, so when the printer moves a block
 * to the next page (page breaks avoid splitting equations, code, images,
 * graphs and slides), its annotations move with it. The page keeps its
 * on-screen width (8.5in), so text wraps exactly as it does on screen.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

function inkSvg(strokes: Stroke[], dx: number, dy: number, width: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'print-ink')
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', '1')
  svg.style.left = `${dx}px`
  svg.style.top = `${dy}px`
  for (const s of [...strokes].sort((a, b) => a.z - b.z)) {
    const p = document.createElementNS(SVG_NS, 'path')
    p.setAttribute('d', strokeSvgPath(s))
    p.setAttribute('fill', s.color)
    if (strokeAlpha(s) < 1) p.setAttribute('fill-opacity', String(strokeAlpha(s)))
    if (s.kind === 'highlighter') p.setAttribute('class', 'hl')
    svg.appendChild(p)
  }
  return svg
}

/**
 * A static copy of the page with page ink redrawn inside the blocks it's
 * anchored to. Shared by PDF export and website publishing.
 */
export async function snapshotPage(page: HTMLElement, doc: Y.Doc): Promise<HTMLElement> {
  await renderAllPdfPagesForPrint()
  await document.fonts?.ready

  const zoom = getPageZoom()
  const pageRect = page.getBoundingClientRect()
  const pageWidth = page.offsetWidth

  // 1. Static copy of the page
  const clone = page.cloneNode(true) as HTMLElement
  clone.style.zoom = '1'
  clone.querySelectorAll(':scope > .ink-layer, .canvas-controls, .canvas-resize, .graph-corner, .graph-resize, .math-panel, .code-run, .code-lang, .slash-menu-host').forEach((e) => e.remove())
  clone.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'))

  // Equation fields (graph rows) keep their content in shadow DOM, which doesn't clone: typeset them.
  const liveFields = page.querySelectorAll('math-field')
  clone.querySelectorAll('math-field').forEach((mf, i) => {
    const latex = (liveFields[i] as HTMLElement & { value?: string })?.value ?? ''
    const span = document.createElement('span')
    span.className = 'print-math'
    span.innerHTML = latex ? katex.renderToString(latex, { throwOnError: false }) : ''
    mf.replaceWith(span)
  })

  // Canvas bitmaps don't survive cloning: copy them across.
  const src = page.querySelectorAll('canvas')
  const dst = clone.querySelectorAll('canvas')
  src.forEach((c, i) => {
    const d = dst[i]
    if (!d || !c.width || !c.height) return
    d.width = c.width
    d.height = c.height
    d.getContext('2d')?.drawImage(c, 0, 0)
  })

  // 2. Page ink, grouped by the block it's anchored to
  const byAnchor = new Map<string, Stroke[]>()
  const loose: Stroke[] = []
  for (const s of doc.getMap<Stroke>('ink:page').values()) {
    if (s.anchor && page.querySelector(`.ProseMirror [data-bid="${CSS.escape(s.anchor)}"]`)) {
      if (!byAnchor.has(s.anchor)) byAnchor.set(s.anchor, [])
      byAnchor.get(s.anchor)!.push(s)
    } else loose.push(s)
  }
  for (const [anchor, strokes] of byAnchor) {
    const live = page.querySelector<HTMLElement>(`.ProseMirror [data-bid="${CSS.escape(anchor)}"]`)!
    const target = clone.querySelector<HTMLElement>(`.ProseMirror [data-bid="${CSS.escape(anchor)}"]`)
    if (!target) continue
    const r = live.getBoundingClientRect()
    // Stroke x is relative to the page's left edge; y to the block's top.
    target.classList.add('print-anchor')
    target.appendChild(inkSvg(strokes, -(r.left - pageRect.left) / zoom, 0, pageWidth))
  }
  if (loose.length) {
    const svg = inkSvg(
      loose.map((s) => ({ ...s, pts: s.pts.map((v, i) => (i % 3 === 1 ? v + (s.ay ?? 0) : v)) })),
      0,
      0,
      pageWidth,
    )
    clone.appendChild(svg)
  }

  return clone
}

export async function printNote(page: HTMLElement, doc: Y.Doc): Promise<void> {
  const clone = await snapshotPage(page, doc)

  // 3. Print it (light theme, nothing but the page)
  const root = document.createElement('div')
  root.className = 'print-root'
  root.appendChild(clone)
  document.body.appendChild(root)
  const html = document.documentElement
  const theme = html.getAttribute('data-theme')
  html.setAttribute('data-theme', 'light')
  html.classList.add('printing')

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    root.remove()
    html.classList.remove('printing')
    if (theme === null) html.removeAttribute('data-theme')
    else html.setAttribute('data-theme', theme)
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  // Give the browser a frame to lay out the copy (and decode images) before printing.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  window.print()
  setTimeout(cleanup, 1000)
}
