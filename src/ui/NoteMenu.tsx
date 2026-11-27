import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { exportMarkdown } from '../export/markdown'
import { printNote } from '../export/print'

/** The ⋯ menu at the top right of a note: export (and later, publish). */
export function NoteMenu({ editor, doc, title, pageRef, onPublish }: { editor: Editor | null; doc: Y.Doc | null; title: string; pageRef: React.RefObject<HTMLDivElement | null>; onPublish: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setOpen(false)
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      console.error(e)
      window.alert(`${label} failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  const ready = !!editor && !!doc && !!pageRef.current
  return (
    <div className="note-menu" ref={ref}>
      <button className="note-menu-btn" onClick={() => setOpen((o) => !o)} disabled={!ready} title="Export or publish this note" aria-haspopup="menu" aria-expanded={open}>
        {busy ? <span className="spinner" aria-label={busy} /> : '⋯'}
      </button>
      {open && ready && (
        <div className="note-menu-pop" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onPublish()
            }}
          >
            <strong>Publish to website…</strong>
            <small>Share this note as a web page (free hosting)</small>
          </button>
          <button role="menuitem" onClick={() => run('PDF export', () => printNote(pageRef.current!, doc!))}>
            <strong>Export PDF…</strong>
            <small>Letter pages, ink included (choose “Save as PDF”)</small>
          </button>
          <button role="menuitem" onClick={() => run('Markdown export', () => exportMarkdown(editor!, doc!, title))}>
            <strong>Export Markdown…</strong>
            <small>.md with LaTeX; drawings, graphs and slides as images</small>
          </button>
        </div>
      )}
    </div>
  )
}
