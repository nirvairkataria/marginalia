import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NoteEditor } from './editor/NoteEditor'
import { createNote, deleteNote, ensureFirstNote, useNoteDoc, useNotes, type NoteMeta } from './lib/notes'

/**
 * The page is an infinite vertical strip with a FIXED width. Fixed width means
 * text never reflows when the window resizes, which keeps future ink
 * annotations anchored exactly where they were drawn and lets the mobile
 * viewer render notes identically (just zoomed). 816 CSS px = 8.5in at 96dpi,
 * so a later PDF export can slice the strip into Letter pages cleanly.
 */
export const PAGE_WIDTH = 816

const LAST_NOTE_KEY = 'marginalia:lastNote'

function readLastNote(): string | null {
  try {
    return localStorage.getItem(LAST_NOTE_KEY)
  } catch {
    return null
  }
}

function writeLastNote(id: string) {
  try {
    localStorage.setItem(LAST_NOTE_KEY, id)
  } catch {
    /* storage unavailable: not important */
  }
}

function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

function Sidebar({
  notes,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: {
  notes: NoteMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (note: NoteMeta) => void
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ✎
        </span>
        Marginalia
      </div>
      <button className="new-note" onClick={onCreate}>
        <span aria-hidden>＋</span> New note
      </button>
      <nav className="note-list" aria-label="Notes">
        {notes.map((note) => (
          <div key={note.id} className={`note-row${note.id === activeId ? ' active' : ''}`}>
            <button className="note-open" onClick={() => onSelect(note.id)}>
              <span className="note-title">{note.title}</span>
              <span className="note-time">{relativeTime(note.updatedAt)}</span>
            </button>
            <button className="note-delete" title="Delete note" aria-label={`Delete ${note.title}`} onClick={() => onDelete(note)}>
              ×
            </button>
          </div>
        ))}
      </nav>
    </aside>
  )
}

/** Scales the fixed-width page down when the window is narrower than it. */
function usePageZoom() {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const update = () => {
      const available = el.clientWidth - 32
      setZoom(Math.min(1, Math.max(0.35, available / PAGE_WIDTH)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { scrollerRef, zoom }
}

export default function App() {
  const notes = useNotes()
  const [ready, setReady] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 720)
  const { scrollerRef, zoom } = usePageZoom()
  const ydoc = useNoteDoc(activeId)

  useEffect(() => {
    ensureFirstNote().then(() => setReady(true))
  }, [])

  // Keep a valid note selected.
  useEffect(() => {
    if (!ready) return
    if (activeId && notes.some((n) => n.id === activeId)) return
    const last = readLastNote()
    const pick = notes.find((n) => n.id === last) ?? notes[0]
    setActiveId(pick ? pick.id : createNote().id)
  }, [ready, notes, activeId])

  useEffect(() => {
    if (activeId) writeLastNote(activeId)
  }, [activeId])

  const handleDelete = async (note: NoteMeta) => {
    if (!window.confirm(`Delete “${note.title}”? This cannot be undone.`)) return
    if (note.id === activeId) setActiveId(null)
    await deleteNote(note.id)
  }

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      <Sidebar
        notes={notes}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={() => setActiveId(createNote().id)}
        onDelete={handleDelete}
      />
      <main className="workspace">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          ☰
        </button>
        <div className="scroller" ref={scrollerRef}>
          <div className="page" style={{ width: PAGE_WIDTH, zoom }}>
            {activeId && ydoc ? <NoteEditor key={activeId} noteId={activeId} ydoc={ydoc} /> : <div className="page-loading" />}
          </div>
        </div>
      </main>
    </div>
  )
}
