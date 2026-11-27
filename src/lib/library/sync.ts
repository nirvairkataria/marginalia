import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import {
  createFolder,
  createNote,
  deleteNote,
  getNote,
  indexReady,
  listFolders,
  listNotes,
  normalizeFolder,
  observeNoteMeta,
  onNoteDocOpen,
  updateNote,
  withNoteDoc,
} from '../notes'
import {
  browserBackend,
  browserPermission,
  canPickBrowserFolder,
  defaultDesktopFolder,
  desktopBackend,
  isDesktop,
  loadBrowserHandle,
  pickBrowserFolder,
  pickDesktopFolder,
  saveBrowserHandle,
  type LibraryBackend,
} from './backends'
import { decodeNoteFile, encodeNoteFile, EXT, folderOf, safeFileName } from './format'

/**
 * Keeps the notes in IndexedDB and the `.marginalia` files in the library
 * folder in step:
 *
 *  - edits are written to the note's file a moment after you stop typing;
 *  - files that appear or change (another device via OneDrive, a restored
 *    backup) are merged in. Yjs merges, so nothing is overwritten;
 *  - moving a file between folders in Explorer moves the note;
 *  - deleting a note deletes its file, and vice versa.
 */

export const LIBRARY_ORIGIN = 'marginalia-library'

export type LibraryStatus = 'off' | 'connecting' | 'needs-permission' | 'syncing' | 'idle' | 'error'

interface State {
  status: LibraryStatus
  label: string
  lastSync: number
  error: string
}

interface Persisted {
  desktopPath?: string
  /** Desktop only: the user turned folder saving off. */
  disabled?: boolean
  /** note id → { relative path, file mtime } as of the last sync */
  known: Record<string, { path: string; mtime: number }>
  /** Notes deleted here whose files still need removing (if the folder was offline) */
  tombstones: string[]
}

const KEY = 'marginalia:library'

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { known: {}, tombstones: [], ...JSON.parse(raw) }
  } catch {
    /* fall through */
  }
  return { known: {}, tombstones: [] }
}

let persisted = loadPersisted()
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(persisted))
  } catch {
    /* best effort */
  }
}

let state: State = { status: 'off', label: '', lastSync: 0, error: '' }
const listeners = new Set<() => void>()
const set = (p: Partial<State>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

export function useLibrary(): State {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

let backend: LibraryBackend | null = null
let pendingHandle: FileSystemDirectoryHandle | null = null
const dirty = new Set<string>()
let writeTimer = 0
let syncing: Promise<void> | null = null
let started = false

const isEmptyUpdate = (u: Uint8Array) => u.length <= 2

// ---------------------------------------------------------------------------
// Writing

function desiredPath(id: string, title: string, folder: string, taken: Set<string>): string {
  const base = safeFileName(title)
  const dir = normalizeFolder(folder)
  const prefix = dir ? `${dir}/` : ''
  const current = persisted.known[id]?.path
  for (let i = 1; ; i++) {
    const p = `${prefix}${base}${i > 1 ? ` (${i})` : ''}${EXT}`
    if (p === current || !taken.has(p.toLowerCase())) return p
  }
}

function takenPaths(except: string): Set<string> {
  const s = new Set<string>()
  for (const [id, k] of Object.entries(persisted.known)) if (id !== except) s.add(k.path.toLowerCase())
  return s
}

async function writeNote(id: string, snapshot?: Uint8Array) {
  const b = backend
  const meta = getNote(id)
  if (!b || !meta) return
  const update = snapshot ?? (await withNoteDoc(id, (doc) => Y.encodeStateAsUpdate(doc)))
  const path = desiredPath(id, meta.title, meta.folder ?? '', takenPaths(id))
  const bytes = encodeNoteFile({ id, title: meta.title, createdAt: meta.createdAt, updatedAt: meta.updatedAt, text: meta.text }, update)
  const mtime = await b.write(path, bytes)
  const old = persisted.known[id]?.path
  if (old && old !== path) await b.remove(old)
  persisted.known[id] = { path, mtime }
  save()
}

function scheduleWrite(id: string, delay = 1200) {
  if (!backend) return
  dirty.add(id)
  window.clearTimeout(writeTimer)
  writeTimer = window.setTimeout(flushWrites, delay)
}

async function flushWrites() {
  if (!backend || state.status === 'syncing') {
    if (backend) writeTimer = window.setTimeout(flushWrites, 800)
    return
  }
  const ids = [...dirty]
  dirty.clear()
  try {
    for (const id of ids) await writeNote(id)
    set({ status: 'idle', lastSync: Date.now(), error: '' })
  } catch (e) {
    ids.forEach((id) => dirty.add(id))
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

// ---------------------------------------------------------------------------
// Full sync (startup, every so often, and when the window regains focus)

export function syncNow(): Promise<void> {
  syncing ??= fullSync().finally(() => (syncing = null))
  return syncing
}

async function fullSync() {
  const b = backend
  if (!b) return
  set({ status: 'syncing' })
  try {
    await indexReady
    const { files, dirs } = await b.list()

    // Notes deleted here while the folder was unavailable
    for (const id of persisted.tombstones.splice(0)) {
      const k = persisted.known[id]
      if (k) await b.remove(k.path)
      delete persisted.known[id]
    }

    // Connecting to a folder that already has notes (e.g. from another device):
    // don't add this device's untouched welcome note as a duplicate.
    const firstConnect = Object.keys(persisted.known).length === 0
    const seen = new Set<string>()
    const pathToId = new Map(Object.entries(persisted.known).map(([id, k]) => [k.path, id]))
    for (const f of files) {
      const knownId = pathToId.get(f.path)
      if (knownId && persisted.known[knownId].mtime === f.mtime && getNote(knownId)) {
        seen.add(knownId) // unchanged since we last wrote or read it
        continue
      }
      const parsed = decodeNoteFile(await b.read(f.path))
      if (!parsed) continue
      const { header, update } = parsed
      if (seen.has(header.id)) continue // duplicate copy of a note (e.g. "Note (1).marginalia" from a sync conflict)
      seen.add(header.id)
      const folder = folderOf(f.path)
      const prev = persisted.known[header.id]
      let localHasMore = false
      if (!getNote(header.id)) {
        createNote({ id: header.id, title: header.title, createdAt: header.createdAt, updatedAt: header.updatedAt, folder, text: header.text })
        await withNoteDoc(header.id, (doc) => Y.applyUpdate(doc, update, LIBRARY_ORIGIN))
      } else {
        await withNoteDoc(header.id, (doc) => {
          Y.applyUpdate(doc, update, LIBRARY_ORIGIN)
          const fileSV = Y.encodeStateVectorFromUpdate(update)
          localHasMore = !isEmptyUpdate(Y.encodeStateAsUpdate(doc, fileSV))
        })
        const meta = getNote(header.id)!
        // Moved in Explorer → move the note; also pick up newer metadata.
        const patch: Parameters<typeof updateNote>[1] = {}
        if (prev && folderOf(prev.path) !== folder) patch.folder = folder
        if (header.updatedAt > meta.updatedAt) Object.assign(patch, { title: header.title, updatedAt: header.updatedAt, text: header.text })
        updateNote(header.id, patch)
      }
      persisted.known[header.id] = { path: f.path, mtime: f.mtime }
      if (localHasMore) dirty.add(header.id)
    }

    if (firstConnect && files.length) {
      for (const n of listNotes()) if (n.pristine && !seen.has(n.id)) await deleteNote(n.id)
    }

    // Notes whose file disappeared: deleted on another device (or in Explorer).
    // If the folder looks empty, assume it's unavailable rather than wiping notes.
    const fileCount = files.length
    for (const [id, k] of Object.entries(persisted.known)) {
      if (seen.has(id)) continue
      if (fileCount === 0) continue
      if (!files.some((f) => f.path === k.path)) {
        delete persisted.known[id]
        if (getNote(id)) await deleteNote(id)
      }
    }

    // Folders: directories on disk appear in the app, and app folders get directories.
    for (const d of dirs) createFolder(d)
    const onDisk = new Set(dirs)
    for (const f of listFolders()) if (!onDisk.has(f)) await b.mkdir(f)

    // Notes that have never been written (new, or library just connected)
    for (const n of listNotes()) if (!persisted.known[n.id]) dirty.add(n.id)

    save()
    set({ status: 'idle', lastSync: Date.now(), error: '' })
    if (dirty.size) await flushWrites()
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

// ---------------------------------------------------------------------------
// Hooks into the app

function wire() {
  if (started) return
  started = true

  // Edits to an open note
  const docHandlers = new Map<string, (u: Uint8Array, origin: unknown) => void>()
  onNoteDocOpen((id, doc, open) => {
    if (open) {
      const h = (_u: Uint8Array, origin: unknown) => {
        if (origin !== LIBRARY_ORIGIN) scheduleWrite(id)
      }
      docHandlers.set(id, h)
      doc.on('update', h)
    } else {
      const h = docHandlers.get(id)
      if (h) doc.off('update', h)
      docHandlers.delete(id)
      // Closing: write now from the doc while it still exists.
      if (dirty.has(id) && backend) {
        dirty.delete(id)
        const snapshot = Y.encodeStateAsUpdate(doc)
        void writeNote(id, snapshot).catch(() => dirty.add(id))
      }
    }
  })

  // Title / folder changes and deletions
  observeNoteMeta((changes) => {
    for (const { id, deleted } of changes) {
      if (deleted) {
        dirty.delete(id)
        const k = persisted.known[id]
        if (!k) continue
        if (backend) {
          delete persisted.known[id]
          void backend.remove(k.path)
        } else persisted.tombstones.push(id)
        save()
      } else {
        const k = persisted.known[id]
        const meta = getNote(id)
        // Only rewrite when the file's name or folder would change; content writes come from doc updates.
        if (meta && (!k || k.path !== desiredPath(id, meta.title, meta.folder ?? '', takenPaths(id)))) scheduleWrite(id, 600)
      }
    }
  })

  window.addEventListener('focus', () => backend && void syncNow())
  window.setInterval(() => backend && document.visibilityState === 'visible' && void syncNow(), 30000)
  window.addEventListener('beforeunload', () => {
    // Best effort: open notes are flushed on close; nothing async can run here.
  })
}

async function connect(b: LibraryBackend) {
  backend = b
  set({ status: 'connecting', label: b.label, error: '' })
  await syncNow()
}

/** Start syncing at app launch (desktop: default folder; browser: previously chosen folder). */
export async function startLibrary() {
  wire()
  try {
    if (isDesktop()) {
      if (persisted.disabled) return
      const path = persisted.desktopPath ?? (await defaultDesktopFolder())
      persisted.desktopPath = path
      save()
      await connect(await desktopBackend(path))
      return
    }
    const h = await loadBrowserHandle().catch(() => undefined)
    if (!h) return
    if ((await browserPermission(h, false)) === 'granted') await connect(browserBackend(h))
    else {
      pendingHandle = h
      set({ status: 'needs-permission', label: h.name })
    }
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

/** Ask for a folder and start syncing to it. Existing notes are written there and its notes are imported. */
export async function chooseLibraryFolder(): Promise<boolean> {
  wire()
  if (isDesktop()) {
    const path = await pickDesktopFolder()
    if (!path) return false
    persisted = { desktopPath: path, known: {}, tombstones: [] }
    save()
    await connect(await desktopBackend(path))
    return true
  }
  if (!canPickBrowserFolder()) return false
  const h = await pickBrowserFolder()
  if (!h) return false
  await saveBrowserHandle(h)
  persisted = { known: {}, tombstones: [] }
  save()
  await connect(browserBackend(h))
  return true
}

/** Browser: the folder needs permission again after a restart (needs a click). */
export async function reconnectLibrary() {
  const h = pendingHandle ?? (await loadBrowserHandle())
  if (!h) return
  if ((await browserPermission(h, true)) === 'granted') {
    pendingHandle = null
    await connect(browserBackend(h))
  }
}

export async function disconnectLibrary() {
  await flushWrites()
  backend = null
  pendingHandle = null
  if (isDesktop()) persisted = { ...persisted, disabled: true }
  else {
    await saveBrowserHandle(null)
    persisted = { known: {}, tombstones: [] }
  }
  save()
  set({ status: 'off', label: '', error: '' })
}

export async function enableDesktopLibrary() {
  persisted = { ...persisted, disabled: false }
  save()
  await startLibrary()
}

export const libraryAvailable = () => isDesktop() || canPickBrowserFolder()

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__marginaliaLibrary = { connectLibraryHandle: (h: FileSystemDirectoryHandle) => connectLibraryHandle(h), syncNow: () => syncNow() }

/** Testing hook: sync to an arbitrary directory handle (e.g. the origin-private file system). */
export async function connectLibraryHandle(h: FileSystemDirectoryHandle) {
  wire()
  persisted = { known: {}, tombstones: [] }
  save()
  await connect(browserBackend(h))
}

