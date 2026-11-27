import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'

/**
 * Storage model
 * -------------
 * Every note is its own Yjs document, persisted locally in IndexedDB under
 * `marginalia:note:<id>`. A separate small Yjs document (`marginalia:index`)
 * holds the list of notes, their metadata and the folder list.
 *
 * The library module (library/sync.ts) mirrors every note to a file in a
 * folder on disk, which doubles as backup and as cross-device sync (e.g. via
 * OneDrive): Yjs documents merge, so edits from two devices combine.
 */

export interface NoteMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Folder path, '' for the top level. Segments separated by '/'. */
  folder?: string
  /** Plain text of the note (truncated), for search. */
  text?: string
  /** Set on the welcome note until its starter content has been inserted. */
  seed?: 'welcome'
  /** Created by the app and not edited yet (an untouched welcome note). */
  pristine?: boolean
}

const indexDoc = new Y.Doc()
const indexProvider = new IndexeddbPersistence('marginalia:index', indexDoc)
const notes = indexDoc.getMap<NoteMeta>('notes')
/** Explicit folders (so empty folders exist too). Keys are folder paths. */
const folders = indexDoc.getMap<true>('folders')

export const indexReady: Promise<unknown> = indexProvider.whenSynced

export const noteDbName = (id: string) => `marginalia:note:${id}`

export const SEARCH_TEXT_LIMIT = 20000

function newId() {
  return crypto.randomUUID()
}

export const normalizeFolder = (f: string | undefined | null) =>
  (f ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/')

export function listNotes(): NoteMeta[] {
  return [...notes.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getNote(id: string): NoteMeta | undefined {
  return notes.get(id)
}

export function createNote(init: Partial<NoteMeta> = {}): NoteMeta {
  const now = Date.now()
  const meta: NoteMeta = { id: newId(), title: 'Untitled', createdAt: now, updatedAt: now, folder: '', ...init }
  meta.folder = normalizeFolder(meta.folder)
  notes.set(meta.id, meta)
  return meta
}

export function updateNote(id: string, patch: Partial<NoteMeta>) {
  const current = notes.get(id)
  if (!current) return
  const next = { ...current, ...patch }
  if ('seed' in patch && patch.seed === undefined) delete next.seed
  if ('pristine' in patch && !patch.pristine) delete next.pristine
  if ('folder' in patch) next.folder = normalizeFolder(patch.folder)
  // Avoid churn: Y.Map writes always create history.
  if (JSON.stringify(next) === JSON.stringify(current)) return
  notes.set(id, next)
}

export async function deleteNote(id: string) {
  notes.delete(id)
  const doc = new Y.Doc()
  const persistence = new IndexeddbPersistence(noteDbName(id), doc)
  await persistence.whenSynced
  await persistence.clearData()
  doc.destroy()
}

// ---------------------------------------------------------------------------
// Folders

/** Every folder: explicit ones, ones notes live in, and their parents. */
export function listFolders(): string[] {
  const all = new Set<string>()
  const add = (f: string) => {
    const parts = normalizeFolder(f).split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'))
  }
  for (const f of folders.keys()) add(f)
  for (const n of notes.values()) add(n.folder ?? '')
  return [...all].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

export function createFolder(path: string): string {
  const p = normalizeFolder(path)
  if (p && !folders.has(p) && !listFolders().includes(p)) folders.set(p, true)
  return p
}

const within = (folder: string, root: string) => folder === root || folder.startsWith(`${root}/`)

export function renameFolder(from: string, to: string) {
  const a = normalizeFolder(from)
  const b = normalizeFolder(to)
  if (!a || !b || a === b) return
  indexDoc.transact(() => {
    for (const f of [...folders.keys()]) {
      if (within(f, a)) {
        folders.delete(f)
        folders.set(b + f.slice(a.length), true)
      }
    }
    for (const n of [...notes.values()]) {
      const f = n.folder ?? ''
      if (within(f, a)) notes.set(n.id, { ...n, folder: b + f.slice(a.length) })
    }
  })
}

/** Delete a folder; its notes and subfolders move up to the parent folder. */
export function deleteFolder(path: string) {
  const a = normalizeFolder(path)
  if (!a) return
  const parent = a.includes('/') ? a.slice(0, a.lastIndexOf('/')) : ''
  indexDoc.transact(() => {
    for (const f of [...folders.keys()]) {
      if (within(f, a)) {
        folders.delete(f)
        if (f !== a) folders.set(normalizeFolder(`${parent}/${f.slice(a.length + 1)}`), true)
      }
    }
    for (const n of [...notes.values()]) {
      const f = n.folder ?? ''
      if (within(f, a)) notes.set(n.id, { ...n, folder: normalizeFolder(f === a ? parent : `${parent}/${f.slice(a.length + 1)}`) })
    }
  })
}

export function moveNote(id: string, folder: string) {
  updateNote(id, { folder })
}

// ---------------------------------------------------------------------------
// Search

export interface SearchHit {
  note: NoteMeta
  /** Text around the first match, with the match marked by « » */
  snippet: string
  score: number
}

export function searchNotes(query: string): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const hits: SearchHit[] = []
  for (const note of notes.values()) {
    const title = note.title.toLowerCase()
    const text = (note.text ?? '').toLowerCase()
    const folder = (note.folder ?? '').toLowerCase()
    let score = 0
    let ok = true
    for (const t of terms) {
      const inTitle = title.includes(t)
      const inText = text.includes(t)
      const inFolder = folder.includes(t)
      if (!inTitle && !inText && !inFolder) {
        ok = false
        break
      }
      score += (inTitle ? 5 : 0) + (inFolder ? 2 : 0) + (inText ? 1 : 0)
    }
    if (!ok) continue
    const first = terms.map((t) => text.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0]
    let snippet = ''
    if (first !== undefined) {
      const raw = note.text ?? ''
      const term = terms.find((t) => text.indexOf(t) === first)!
      const start = Math.max(0, first - 40)
      const end = Math.min(raw.length, first + term.length + 60)
      snippet = `${start > 0 ? '…' : ''}${raw.slice(start, first)}«${raw.slice(first, first + term.length)}»${raw.slice(first + term.length, end)}${end < raw.length ? '…' : ''}`.replace(/\s+/g, ' ')
    }
    hits.push({ note, snippet, score: score + note.updatedAt / 1e15 })
  }
  return hits.sort((a, b) => b.score - a.score)
}

/** Make sure there is at least one note (the welcome note) on first launch. */
export async function ensureFirstNote(): Promise<void> {
  await indexReady
  if (notes.size === 0) createNote({ title: 'Welcome to Marginalia', seed: 'welcome', pristine: true })
}

// ---------------------------------------------------------------------------
// Subscriptions (React + the library sync)

let indexVersion = 0
const indexListeners = new Set<() => void>()
const bump = () => {
  indexVersion++
  indexListeners.forEach((l) => l())
}
notes.observe(bump)
folders.observe(bump)

export function onIndexChange(fn: () => void) {
  indexListeners.add(fn)
  return () => indexListeners.delete(fn)
}

/** Fires with the ids of notes whose metadata changed or were deleted. */
export function observeNoteMeta(fn: (changed: { id: string; deleted: boolean }[]) => void) {
  const h = (e: Y.YMapEvent<NoteMeta>) => fn([...e.keysChanged].map((id) => ({ id, deleted: !notes.has(id) })))
  notes.observe(h)
  return () => notes.unobserve(h)
}

function useIndexVersion() {
  return useSyncExternalStore((fn) => onIndexChange(fn), () => indexVersion)
}

/** React hook: the live, sorted list of notes. */
export function useNotes(): NoteMeta[] {
  const v = useIndexVersion()
  // Computed during render so it's never a render behind the index.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => listNotes(), [v])
}

export function useFolders(): string[] {
  const v = useIndexVersion()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => listFolders(), [v])
}

// ---------------------------------------------------------------------------
// Note documents

/** Docs currently open in the editor, so background work can reuse them. */
const openDocs = new Map<string, Y.Doc>()
const openListeners = new Set<(id: string, doc: Y.Doc, open: boolean) => void>()

/** Fires when a note's doc is opened in the editor (open = true) and just before it closes. */
export function onNoteDocOpen(fn: (id: string, doc: Y.Doc, open: boolean) => void) {
  openListeners.add(fn)
  return () => openListeners.delete(fn)
}

export function getOpenDoc(id: string): Y.Doc | undefined {
  return openDocs.get(id)
}

/** Run `fn` with a note's doc: the open one, or a temporary one loaded from IndexedDB. */
export async function withNoteDoc<T>(id: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
  const open = openDocs.get(id)
  if (open) return fn(open)
  const doc = new Y.Doc()
  const provider = new IndexeddbPersistence(noteDbName(id), doc)
  await provider.whenSynced
  try {
    return await fn(doc)
  } finally {
    // Let IndexedDB persist any updates made by fn before closing.
    await new Promise((r) => setTimeout(r, 50))
    await provider.destroy()
    doc.destroy()
  }
}

/** React hook: open a note's Yjs document and wait for it to load from disk. */
export function useNoteDoc(id: string | null): Y.Doc | null {
  const [loaded, setLoaded] = useState<{ id: string; doc: Y.Doc } | null>(null)
  useEffect(() => {
    if (!id) return
    let cancelled = false
    const ydoc = new Y.Doc()
    const provider = new IndexeddbPersistence(noteDbName(id), ydoc)
    provider.whenSynced.then(() => {
      if (cancelled) return
      openDocs.set(id, ydoc)
      openListeners.forEach((l) => l(id, ydoc, true))
      setLoaded({ id, doc: ydoc })
    })
    return () => {
      cancelled = true
      if (openDocs.get(id) === ydoc) {
        openDocs.delete(id)
        openListeners.forEach((l) => l(id, ydoc, false))
      }
      setLoaded((prev) => (prev?.doc === ydoc ? null : prev))
      provider.destroy()
      ydoc.destroy()
    }
  }, [id])
  // Never hand out a previous note's doc while the next one is loading.
  return loaded && loaded.id === id ? loaded.doc : null
}
