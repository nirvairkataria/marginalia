import type * as Y from 'yjs'

/**
 * Binary files (images, PDFs) stored inside a note's Yjs doc, keyed by a hash
 * of their content. They travel with the note: into IndexedDB, the library
 * file, and other devices.
 */

const data = (doc: Y.Doc) => doc.getMap<Uint8Array>('assets')
const types = (doc: Y.Doc) => doc.getMap<string>('assetTypes')

async function hashOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24)
}

export async function putAsset(doc: Y.Doc, bytes: Uint8Array, mime: string): Promise<string> {
  const id = await hashOf(bytes)
  if (!data(doc).has(id)) {
    doc.transact(() => {
      data(doc).set(id, bytes)
      types(doc).set(id, mime)
    })
  }
  return id
}

export function getAsset(doc: Y.Doc, id: string): { bytes: Uint8Array; type: string } | null {
  const bytes = data(doc).get(id)
  if (!bytes) return null
  return { bytes, type: types(doc).get(id) ?? 'application/octet-stream' }
}

const urls = new WeakMap<Y.Doc, Map<string, string>>()

/** Object URL for an asset (cached per doc). */
export function assetUrl(doc: Y.Doc, id: string): string | null {
  let cache = urls.get(doc)
  if (!cache) urls.set(doc, (cache = new Map()))
  const hit = cache.get(id)
  if (hit) return hit
  const a = getAsset(doc, id)
  if (!a) return null
  const url = URL.createObjectURL(new Blob([a.bytes as unknown as ArrayBuffer], { type: a.type }))
  cache.set(id, url)
  return url
}

/** Call `fn` when an asset arrives (e.g. synced from another device). */
export function whenAsset(doc: Y.Doc, id: string, fn: () => void): () => void {
  if (data(doc).has(id)) {
    fn()
    return () => {}
  }
  const h = () => {
    if (data(doc).has(id)) {
      data(doc).unobserve(h)
      fn()
    }
  }
  data(doc).observe(h)
  return () => data(doc).unobserve(h)
}

export async function fileBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}
