import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { newCanvasId } from './editor/canvasBlock'
import { NoteEditor } from './editor/NoteEditor'
import { handleInkKeys } from './ink/input'
import { InkOverlay } from './ink/InkOverlay'
import { redo, undo } from './ink/undo'
import { setPageZoom } from './ink/zoom'
import { activeTool, useSettings } from './lib/settings'
import { setRunnerOpen, useRunner } from './runner/runner'
import { GearIcon, TerminalIcon } from './ui/icons'
import { InkToolbar } from './ui/InkToolbar'
import { OutputPanel } from './ui/OutputPanel'
import { SettingsDialog } from './ui/SettingsDialog'
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
  onSettings,
}: {
  notes: NoteMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (note: NoteMeta) => void
  onSettings: () => void
}) {
  const runnerOpen = useRunner().open
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
      <div className="sidebar-footer">
        <button className="footer-btn" onClick={onSettings}>
          <GearIcon /> Settings
        </button>
        <button className="footer-btn" onClick={() => setRunnerOpen(!runnerOpen)}>
          <TerminalIcon /> Output
        </button>
      </div>
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
  const settings = useSettings()
  const [ready, setReady] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 720)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const { scrollerRef, zoom } = usePageZoom()
  const pageRef = useRef<HTMLDivElement>(null)
  const ydoc = useNoteDoc(activeId)
  const inkTool = activeTool(settings)

  useEffect(() => {
    ensureFirstNote().then(() => setReady(true))
  }, [])

  useEffect(() => setPageZoom(zoom), [zoom])

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

  // Ink shortcuts, and undo/redo when focus is outside the text editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleInkKeys(e)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const inText = (e.target as HTMLElement | null)?.closest?.('.ProseMirror, input, textarea, math-field')
      if (inText || !(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) undo()
      else if (k === 'y' || (k === 'z' && e.shiftKey)) redo()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const handleDelete = async (note: NoteMeta) => {
    if (!window.confirm(`Delete “${note.title}”? This cannot be undone.`)) return
    if (note.id === activeId) setActiveId(null)
    await deleteNote(note.id)
  }

  const insertCanvas = useCallback(() => {
    editor?.chain().focus().insertContent([{ type: 'canvasBlock', attrs: { id: newCanvasId() } }, { type: 'paragraph' }]).run()
  }, [editor])

  const pageClass = ['page', inkTool ? `ink-active ink-${inkTool.kind}` : '', inkTool && settings.touchDraws ? 'touch-draws' : ''].filter(Boolean).join(' ')

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      <Sidebar
        notes={notes}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={() => setActiveId(createNote().id)}
        onDelete={handleDelete}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace">
        <div className={`workspace-main tb-${settings.toolbarPosition}`}>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            ☰
          </button>
          <InkToolbar onInsertCanvas={insertCanvas} />
          <div className="scroller" ref={scrollerRef}>
            <div className={pageClass} ref={pageRef} style={{ width: PAGE_WIDTH, zoom }}>
              {activeId && ydoc ? (
                <>
                  <NoteEditor key={activeId} noteId={activeId} ydoc={ydoc} onReady={setEditor} />
                  <InkOverlay key={`ink-${activeId}`} doc={ydoc} editor={editor} pageRef={pageRef} />
                </>
              ) : (
                <div className="page-loading" />
              )}
            </div>
          </div>
        </div>
        <OutputPanel />
      </main>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
