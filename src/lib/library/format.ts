/**
 * `.marginalia` note file:
 *
 *   MARGINALIA 1\n
 *   {"id":"…","title":"…","createdAt":…,"updatedAt":…,"text":"…"}\n
 *   <Yjs document update, binary>
 *
 * The Yjs update contains the note's full editing state (text, ink, graphs),
 * so two copies of a note edited on different devices can be merged.
 */

export const EXT = '.marginalia'
const MAGIC = 'MARGINALIA 1\n'

export interface FileHeader {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  text?: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function encodeNoteFile(header: FileHeader, update: Uint8Array): Uint8Array {
  const head = enc.encode(MAGIC + JSON.stringify(header) + '\n')
  const out = new Uint8Array(head.length + update.length)
  out.set(head, 0)
  out.set(update, head.length)
  return out
}

export function decodeNoteFile(bytes: Uint8Array): { header: FileHeader; update: Uint8Array } | null {
  const magic = enc.encode(MAGIC)
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return null
  const nl = bytes.indexOf(10, magic.length)
  if (nl < 0) return null
  try {
    const header = JSON.parse(dec.decode(bytes.subarray(magic.length, nl))) as FileHeader
    if (!header.id) return null
    return { header, update: bytes.subarray(nl + 1) }
  } catch {
    return null
  }
}

/** A title made safe for Windows/macOS/Linux file names. */
export function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim()
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i
  return !cleaned || reserved.test(cleaned) ? 'Untitled' : cleaned
}

/** Folder part of a relative path ('' for the root). */
export function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}
