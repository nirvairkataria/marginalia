/**
 * Where the library lives. Paths are relative to the library root and always
 * use '/' as the separator.
 */

export interface LibraryEntry {
  path: string
  mtime: number
}

export interface LibraryBackend {
  kind: 'desktop' | 'browser'
  /** Human-readable location, e.g. C:\Users\me\Documents\Marginalia */
  label: string
  /** All note files and all directories, recursively. */
  list(): Promise<{ files: LibraryEntry[]; dirs: string[] }>
  read(path: string): Promise<Uint8Array>
  write(path: string, data: Uint8Array): Promise<number>
  remove(path: string): Promise<void>
  mkdir(path: string): Promise<void>
}

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

// ---------------------------------------------------------------------------
// Desktop (Tauri)

export async function desktopBackend(root: string): Promise<LibraryBackend> {
  const fs = await import('@tauri-apps/plugin-fs')
  const sep = root.includes('\\') ? '\\' : '/'
  const abs = (rel: string) => (rel ? `${root}${sep}${rel.split('/').join(sep)}` : root)
  await fs.mkdir(root, { recursive: true })

  return {
    kind: 'desktop',
    label: root,
    async list() {
      const files: LibraryEntry[] = []
      const dirs: string[] = []
      const walk = async (rel: string) => {
        for (const e of await fs.readDir(abs(rel))) {
          if (e.name.startsWith('.')) continue
          const p = rel ? `${rel}/${e.name}` : e.name
          if (e.isDirectory) {
            dirs.push(p)
            await walk(p)
          } else if (e.isFile && e.name.endsWith('.marginalia')) {
            const st = await fs.stat(abs(p))
            files.push({ path: p, mtime: st.mtime ? new Date(st.mtime).getTime() : 0 })
          }
        }
      }
      await walk('')
      return { files, dirs }
    },
    read: (p) => fs.readFile(abs(p)),
    async write(p, data) {
      const dir = parentOf(p)
      if (dir) await fs.mkdir(abs(dir), { recursive: true })
      // Write to a temp file then swap, so a crash never leaves half a note.
      const tmp = `${abs(p)}.tmp`
      await fs.writeFile(tmp, data)
      await fs.rename(tmp, abs(p))
      const st = await fs.stat(abs(p))
      return st.mtime ? new Date(st.mtime).getTime() : Date.now()
    },
    async remove(p) {
      if (await fs.exists(abs(p))) await fs.remove(abs(p))
    },
    async mkdir(p) {
      await fs.mkdir(abs(p), { recursive: true })
    },
  }
}

export async function pickDesktopFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, multiple: false, title: 'Choose a folder for your notes' })
  return typeof picked === 'string' ? picked : null
}

export async function defaultDesktopFolder(): Promise<string> {
  const { documentDir, join } = await import('@tauri-apps/api/path')
  return join(await documentDir(), 'Marginalia')
}

// ---------------------------------------------------------------------------
// Browser (File System Access API)

type Dir = FileSystemDirectoryHandle

async function dirAt(root: Dir, rel: string, create: boolean): Promise<Dir> {
  let d = root
  for (const part of rel.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create })
  return d
}

export function browserBackend(root: Dir, label = root.name): LibraryBackend {
  const split = (p: string) => ({ dir: parentOf(p), name: p.slice(p.lastIndexOf('/') + 1) })
  return {
    kind: 'browser',
    label,
    async list() {
      const files: LibraryEntry[] = []
      const dirs: string[] = []
      const walk = async (d: Dir, rel: string) => {
        for await (const h of (d as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
          if (h.name.startsWith('.')) continue
          const p = rel ? `${rel}/${h.name}` : h.name
          if (h.kind === 'directory') {
            dirs.push(p)
            await walk(h as Dir, p)
          } else if (h.name.endsWith('.marginalia')) {
            const f = await (h as FileSystemFileHandle).getFile()
            files.push({ path: p, mtime: f.lastModified })
          }
        }
      }
      await walk(root, '')
      return { files, dirs }
    },
    async read(p) {
      const { dir, name } = split(p)
      const f = await (await (await dirAt(root, dir, false)).getFileHandle(name)).getFile()
      return new Uint8Array(await f.arrayBuffer())
    },
    async write(p, data) {
      const { dir, name } = split(p)
      const fh = await (await dirAt(root, dir, true)).getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(data as unknown as ArrayBuffer)
      await w.close()
      return (await fh.getFile()).lastModified
    },
    async remove(p) {
      const { dir, name } = split(p)
      try {
        await (await dirAt(root, dir, false)).removeEntry(name)
      } catch {
        /* already gone */
      }
    },
    async mkdir(p) {
      await dirAt(root, p, true)
    },
  }
}

// The chosen browser folder handle is remembered in IndexedDB (handles can't go in localStorage).
const HANDLE_DB = 'marginalia:library-handle'

function handleStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(HANDLE_DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('h')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction('h', mode)
      const req = fn(tx.objectStore('h'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }
  })
}

export const saveBrowserHandle = (h: Dir | null) => handleStore<unknown>('readwrite', (s) => (h ? s.put(h, 'root') : s.delete('root')) as IDBRequest<unknown>)
export const loadBrowserHandle = () => handleStore<Dir | undefined>('readonly', (s) => s.get('root'))

export const canPickBrowserFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

export async function pickBrowserFolder(): Promise<Dir | null> {
  try {
    // @ts-expect-error: showDirectoryPicker is Chromium-only
    return (await window.showDirectoryPicker({ id: 'marginalia', mode: 'readwrite' })) as Dir
  } catch {
    return null
  }
}

/** 'granted' | 'prompt' | 'denied' for an already-chosen folder. */
export async function browserPermission(h: Dir, request: boolean): Promise<PermissionState> {
  // @ts-expect-error: permission methods are Chromium-only
  const q = request ? await h.requestPermission({ mode: 'readwrite' }) : await h.queryPermission({ mode: 'readwrite' })
  return q as PermissionState
}
