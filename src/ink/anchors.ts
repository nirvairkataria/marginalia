import type { AnchorProvider } from './surface'

/** Measures block positions on the page (in unzoomed page px) for ink anchoring. */
export class PageAnchors implements AnchorProvider {
  private tops = new Map<string, number>()
  private blocks: { bid: string; top: number; bottom: number }[] = []
  private page: HTMLElement
  private zoom: () => number
  private dirty = true

  constructor(page: HTMLElement, zoom: () => number) {
    this.page = page
    this.zoom = zoom
  }

  invalidate() {
    this.dirty = true
  }

  refresh() {
    this.dirty = false
    const pageTop = this.page.getBoundingClientRect().top
    const z = this.zoom()
    this.tops.clear()
    this.blocks = []
    // Document order: parents come before their children.
    for (const el of this.page.querySelectorAll<HTMLElement>('.ProseMirror [data-bid]')) {
      const bid = el.dataset.bid
      if (!bid || this.tops.has(bid)) continue
      const r = el.getBoundingClientRect()
      if (r.height === 0 && r.width === 0) continue
      const top = (r.top - pageTop) / z
      this.tops.set(bid, top)
      this.blocks.push({ bid, top, bottom: top + r.height / z })
    }
  }

  top(anchor: string) {
    if (this.dirty) this.refresh()
    return this.tops.get(anchor)
  }

  find(y: number) {
    if (this.dirty) this.refresh()
    let best: { bid: string; top: number } | null = null
    // Deepest block containing y (later in document order = deeper or lower).
    for (const b of this.blocks) if (y >= b.top && y <= b.bottom) best = b
    if (!best) {
      // Nearest block above, else the first block.
      for (const b of this.blocks) if (b.top <= y && (!best || b.top >= best.top)) best = b
      best ??= this.blocks[0] ?? null
    }
    return best ? { anchor: best.bid, top: best.top } : null
  }
}
