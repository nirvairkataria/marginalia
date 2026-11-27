import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { newCanvasId } from './editor/canvasBlock'
import { NoteEditor } from './editor/NoteEditor'
import { handleInkKeys } from './ink/input'
import { InkOverlay } from './ink/InkOverlay'
import { redo, undo } from './ink/undo'
import { setPageZoom } from './ink/zoom'
import { activeTool, useSettings } from './lib/settings'
import { InkToolbar } from './ui/InkToolbar'
import { OutputPanel } from './ui/OutputPanel'
import { SettingsDialog } from './ui/SettingsDialog'
import { Sidebar } from './ui/Sidebar'
import { importFiles, IMPORT_ACCEPT } from './lib/importers'
import { startLibrary } from './lib/library/sync'
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
    ensureFirstNote().then(() => {
      setReady(true)
      void startLibrary()
    })
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
        onCreate={(folder) => setActiveId(createNote({ folder }).id)}
        onImport={(folder, files) => {
          const run = async (list: File[]) => {
            const id = await importFiles(list, folder, editor)
            if (id) setActiveId(id)
          }
          if (files) return void run(files)
          const input = document.createElement('input')
          input.type = 'file'
          input.multiple = true
          input.accept = IMPORT_ACCEPT
          input.onchange = () => input.files?.length && void run([...input.files])
          input.click()
        }}
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
