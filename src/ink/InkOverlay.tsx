import type { Editor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import type * as Y from 'yjs'
import { PageAnchors } from './anchors'
import { attachInkInput } from './input'
import { InkSurface } from './surface'
import { getPageZoom, onPageZoom } from './zoom'

/**
 * Ink drawn directly on the page, over (pens) and under (highlighters) the
 * text. The canvases only cover the visible part of the infinite page and
 * move as you scroll, so very long notes stay cheap to draw.
 */
export function InkOverlay({ doc, editor, pageRef }: { doc: Y.Doc; editor: Editor | null; pageRef: React.RefObject<HTMLDivElement | null> }) {
  const underRef = useRef<HTMLCanvasElement>(null)
  const mainRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const page = pageRef.current
    const under = underRef.current
    const main = mainRef.current
    const live = liveRef.current
    if (!page || !under || !main || !live) return
    const scroller = page.closest('.scroller') as HTMLElement | null
    const anchors = new PageAnchors(page, getPageZoom)

    const viewport = () => {
      const z = getPageZoom()
      const pageRect = page.getBoundingClientRect()
      const viewRect = scroller?.getBoundingClientRect() ?? { top: 0, height: window.innerHeight }
      const top = Math.max(0, (viewRect.top - pageRect.top) / z)
      const height = Math.max(1, Math.min(page.offsetHeight - top, viewRect.height / z + 2))
      return { top, height }
    }

    const surface = new InkSurface({
      doc,
      id: 'page',
      origin: page,
      zoom: getPageZoom,
      under,
      main,
      live,
      viewport,
      size: () => ({ width: page.offsetWidth, height: page.offsetHeight }),
      anchors,
      onViewport: (top, height) => {
        for (const c of [under, main, live]) {
          c.style.top = `${top}px`
          c.style.height = `${height}px`
        }
      },
    })

    const relayout = () => {
      anchors.invalidate()
      surface.requestRender()
    }
    const onScroll = () => surface.requestRender()
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(relayout)
    ro.observe(page)
    const offZoom = onPageZoom(relayout)
    page.addEventListener('marginalia:relayout', relayout)
    const detach = attachInkInput(page, () => surface)

    return () => {
      scroller?.removeEventListener('scroll', onScroll)
      ro.disconnect()
      offZoom()
      page.removeEventListener('marginalia:relayout', relayout)
      detach()
      surface.destroy()
    }
  }, [doc, pageRef])

  // Text edits move blocks around: re-measure anchors and redraw.
  useEffect(() => {
    if (!editor) return
    const page = pageRef.current
    const onUpdate = () => {
      // Wait a frame so node views (math, code) have laid out.
      requestAnimationFrame(() => page?.dispatchEvent(new Event('marginalia:relayout')))
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, pageRef])

  return (
    <>
      <canvas ref={underRef} className="ink-layer ink-under" aria-hidden />
      <canvas ref={mainRef} className="ink-layer ink-over" aria-hidden />
      <canvas ref={liveRef} className="ink-layer ink-live" aria-hidden />
    </>
  )
}
