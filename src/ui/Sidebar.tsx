import { useEffect, useMemo, useRef, useState } from 'react'
import { chooseLibraryFolder, libraryAvailable, reconnectLibrary, syncNow, useLibrary } from '../lib/library/sync'
import { createFolder, deleteFolder, moveNote, renameFolder, searchNotes, useFolders, type NoteMeta } from '../lib/notes'
import { setRunnerOpen, useRunner } from '../runner/runner'
import { GearIcon, TerminalIcon } from './icons'

/**
 * Notes sidebar: search, a folder tree (folders are real folders in the
 * library on disk), and the library's save status.
 */

interface Props {
  notes: NoteMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: (folder: string) => void
  onDelete: (note: NoteMeta) => void
  onSettings: () => void
  onImport?: (folder: string, files?: File[]) => void
}

const COLLAPSED_KEY = 'marginalia:collapsedFolders'

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function relativeTime(ts: number): string {
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

const leaf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

export function Sidebar({ notes, activeId, onSelect, onCreate, onDelete, onSettings, onImport }: Props) {
  const folders = useFolders()
  const runnerOpen = useRunner().open
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [editing, setEditing] = useState<{ mode: 'new' | 'rename'; path: string } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [currentFolder, setCurrentFolder] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
    } catch {
      /* ignore */
    }
  }, [collapsed])

  // Ctrl+Shift+F / Ctrl+K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === 'f') || e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hits = useMemo(() => (query.trim() ? searchNotes(query) : []), [query, notes])

  const byFolder = useMemo(() => {
    const m = new Map<string, NoteMeta[]>()
    for (const n of notes) {
      const f = n.folder ?? ''
      if (!m.has(f)) m.set(f, [])
      m.get(f)!.push(n)
    }
    return m
  }, [notes])

  const countIn = (path: string) => notes.filter((n) => (n.folder ?? '') === path || (n.folder ?? '').startsWith(`${path}/`)).length

  const toggle = (path: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })

  const dropProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-marginalia-note') && !e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragOver(folder)
    },
    onDragLeave: () => setDragOver((d) => (d === folder ? null : d)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData('application/x-marginalia-note')
      setDragOver(null)
      if (id) {
        e.stopPropagation()
        moveNote(id, folder)
      } else if (e.dataTransfer.files.length && onImport) {
        e.preventDefault()
        e.stopPropagation()
        onImport(folder, [...e.dataTransfer.files])
      }
    },
  })

  const noteRow = (note: NoteMeta, depth: number, snippet?: string) => (
    <div
      key={note.id}
      className={`note-row${note.id === activeId ? ' active' : ''}`}
      style={{ paddingLeft: depth * 14 }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-marginalia-note', note.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <button className="note-open" onClick={() => onSelect(note.id)}>
        <span className="note-title">{note.title}</span>
        {snippet !== undefined ? (
          <span className="note-snippet">
            {note.folder ? <span className="note-folder">{note.folder} · </span> : null}
            {highlight(snippet)}
          </span>
        ) : (
          <span className="note-time">{relativeTime(note.updatedAt)}</span>
        )}
      </button>
      <button className="note-delete" title="Delete note" aria-label={`Delete ${note.title}`} onClick={() => onDelete(note)}>
        ×
      </button>
    </div>
  )

  const folderEditor = (mode: 'new' | 'rename', path: string, depth: number) => (
    <FolderNameInput
      key={`edit-${mode}-${path}`}
      depth={depth}
      initial={mode === 'rename' ? leaf(path) : ''}
      onDone={(name) => {
        setEditing(null)
        if (!name) return
        if (mode === 'new') {
          const created = createFolder(path ? `${path}/${name}` : name)
          setCollapsed((c) => {
            const n = new Set(c)
            n.delete(path)
            return n
          })
          setCurrentFolder(created)
        } else {
          const parent = parentOf(path)
          renameFolder(path, parent ? `${parent}/${name}` : name)
        }
      }}
    />
  )

  const renderFolder = (path: string, depth: number): React.ReactNode => {
    const children = folders.filter((f) => parentOf(f) === path)
    const isOpen = !collapsed.has(path)
    const own = byFolder.get(path) ?? []
    return (
      <div key={`f-${path}`} className="folder-group">
        {editing?.mode === 'rename' && editing.path === path ? (
          folderEditor('rename', path, depth)
        ) : (
          <div
            className={`folder-row${dragOver === path ? ' drop' : ''}${currentFolder === path ? ' current' : ''}`}
            style={{ paddingLeft: depth * 14 }}
            {...dropProps(path)}
          >
            <button
              className="folder-open"
              onClick={() => {
                toggle(path)
                setCurrentFolder(path)
              }}
              aria-expanded={isOpen}
            >
              <span className={`chev${isOpen ? ' open' : ''}`}>›</span>
              <span className="folder-name">{leaf(path)}</span>
              <span className="folder-count">{countIn(path)}</span>
            </button>
            <span className="folder-actions">
              <button title="New note here" onClick={() => onCreate(path)}>
                ＋
              </button>
              <button title="New subfolder" onClick={() => setEditing({ mode: 'new', path })}>
                ⊞
              </button>
              <button title="Rename folder" onClick={() => setEditing({ mode: 'rename', path })}>
                ✎
              </button>
              <button
                title="Delete folder (its notes move up a level)"
                onClick={() => {
                  if (window.confirm(`Delete the folder “${leaf(path)}”? Its notes move to ${parentOf(path) ? `“${leaf(parentOf(path))}”` : 'the top level'}.`)) deleteFolder(path)
                }}
              >
                ×
              </button>
            </span>
          </div>
        )}
        {isOpen && (
          <>
            {editing?.mode === 'new' && editing.path === path && folderEditor('new', path, depth + 1)}
            {children.map((c) => renderFolder(c, depth + 1))}
            {own.map((n) => noteRow(n, depth + 1))}
          </>
        )}
      </div>
    )
  }

  const topFolders = folders.filter((f) => !f.includes('/'))
  const rootNotes = byFolder.get('') ?? []

  return (
    <aside
      className="sidebar"
      onDragOver={(e) => {
        if (onImport && e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!onImport || !e.dataTransfer.files.length) return
        e.preventDefault()
        onImport(dragOver ?? currentFolder, [...e.dataTransfer.files])
      }}
    >
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ✎
        </span>
        Marginalia
      </div>
      <div className="search-box">
        <input ref={searchRef} type="search" placeholder="Search notes (Ctrl+K)" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
      </div>
      <div className="sidebar-actions">
        <button className="new-note" onClick={() => onCreate(currentFolder)} title={currentFolder ? `New note in ${currentFolder}` : 'New note'}>
          <span aria-hidden>＋</span> New note
        </button>
        <button className="icon-action" title="New folder" onClick={() => (setCurrentFolder(''), setEditing({ mode: 'new', path: '' }))}>
          ⊞
        </button>
        {onImport && (
          <button className="icon-action" title="Import Markdown files, PDFs or images (or drop them here)" onClick={() => onImport(currentFolder)}>
            ⇪
          </button>
        )}
      </div>

      <nav className="note-list" aria-label="Notes">
        {query.trim() ? (
          hits.length ? (
            hits.map((h) => noteRow(h.note, 0, h.snippet))
          ) : (
            <p className="empty-hint">No notes match “{query}”.</p>
          )
        ) : (
          <>
            {editing?.mode === 'new' && editing.path === '' && folderEditor('new', '', 0)}
            {topFolders.map((f) => renderFolder(f, 0))}
            <div className={`root-drop${dragOver === '' ? ' drop' : ''}`} {...dropProps('')} onClick={() => setCurrentFolder('')}>
              {rootNotes.map((n) => noteRow(n, 0))}
              {dragOver === '' && <div className="drop-hint">Move to top level</div>}
            </div>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <LibraryStatus />
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

function highlight(snippet: string) {
  const parts = snippet.split(/«|»/)
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))
}

function FolderNameInput({ depth, initial, onDone }: { depth: number; initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v?.replace(/[/\\]/g, ' ').trim() || null)
  }
  return (
    <div className="folder-row editing" style={{ paddingLeft: depth * 14 }}>
      <span className="chev">›</span>
      <input
        autoFocus
        className="folder-input"
        placeholder="Folder name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(value)
          if (e.key === 'Escape') finish(null)
        }}
        onBlur={() => finish(value)}
      />
    </div>
  )
}

function LibraryStatus() {
  const lib = useLibrary()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30000)
    return () => window.clearInterval(t)
  }, [])
  if (!libraryAvailable()) return null
  if (lib.status === 'off')
    return (
      <button className="library-status warn" onClick={() => void chooseLibraryFolder()} title="Notes are only stored inside the app. Pick a folder (e.g. in OneDrive) to keep a copy you can back up and sync.">
        <span className="dot" /> Save notes to a folder…
      </button>
    )
  if (lib.status === 'needs-permission')
    return (
      <button className="library-status warn" onClick={() => void reconnectLibrary()} title={`Allow access to “${lib.label}” again`}>
        <span className="dot" /> Reconnect “{lib.label}”
      </button>
    )
  const text =
    lib.status === 'error'
      ? `Couldn't save: ${lib.error}`
      : lib.status === 'syncing' || lib.status === 'connecting'
        ? 'Syncing…'
        : `Saved ${relativeTime(lib.lastSync)}`
  return (
    <button className={`library-status ${lib.status === 'error' ? 'bad' : 'ok'}`} onClick={() => void syncNow()} title={`Library folder: ${lib.label}\nClick to sync now`}>
      <span className="dot" /> {text}
    </button>
  )
}
