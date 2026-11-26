import { useEffect, useState } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'

/**
 * Storage model
 * -------------
 * Every note is its own Yjs document, persisted locally in IndexedDB under
 * `marginalia:note:<id>`. A separate small Yjs document (`marginalia:index`)
 * holds the list of notes and their metadata.
 *
 * Because everything is a Yjs document, syncing to other devices later is a
 * matter of attaching another provider (websocket, cloud relay, ...) to the
 * same docs. No storage-format migration needed.
 */

export interface NoteMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Set on the welcome note until its starter content has been inserted. */
  seed?: 'welcome'
}

const indexDoc = new Y.Doc()
const indexProvider = new IndexeddbPersistence('marginalia:index', indexDoc)
const notes = indexDoc.getMap<NoteMeta>('notes')

export const indexReady: Promise<unknown> = indexProvider.whenSynced

export const noteDbName = (id: string) => `marginalia:note:${id}`

function newId() {
  return crypto.randomUUID()
}

export function listNotes(): NoteMeta[] {
  return [...notes.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getNote(id: string): NoteMeta | undefined {
  return notes.get(id)
}

export function createNote(init: Partial<NoteMeta> = {}): NoteMeta {
  const now = Date.now()
  const meta: NoteMeta = { id: newId(), title: 'Untitled', createdAt: now, updatedAt: now, ...init }
  notes.set(meta.id, meta)
  return meta
}

export function updateNote(id: string, patch: Partial<NoteMeta>) {
  const current = notes.get(id)
  if (!current) return
  const next = { ...current, ...patch }
  if ('seed' in patch && patch.seed === undefined) delete next.seed
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

/** Make sure there is at least one note (the welcome note) on first launch. */
export async function ensureFirstNote(): Promise<void> {
  await indexReady
  if (notes.size === 0) createNote({ title: 'Welcome to Marginalia', seed: 'welcome' })
}

/** React hook: the live, sorted list of notes. */
export function useNotes(): NoteMeta[] {
  const [list, setList] = useState(listNotes)
  useEffect(() => {
    const update = () => setList(listNotes())
    notes.observe(update)
    update()
    return () => notes.unobserve(update)
  }, [])
  return list
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
      if (!cancelled) setLoaded({ id, doc: ydoc })
    })
    return () => {
      cancelled = true
      setLoaded((prev) => (prev?.doc === ydoc ? null : prev))
      provider.destroy()
      ydoc.destroy()
    }
  }, [id])
  // Never hand out a previous note's doc while the next one is loading.
  return loaded && loaded.id === id ? loaded.doc : null
}
