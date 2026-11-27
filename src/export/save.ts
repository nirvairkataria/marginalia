import { isDesktop } from '../lib/library/backends'

/** Save bytes to a file: a Save dialog on the desktop app, a download in the browser. */
export async function saveFile(name: string, data: Uint8Array | string, filter: { name: string; extensions: string[] }): Promise<boolean> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  if (isDesktop()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({ defaultPath: name, filters: [filter] })
    if (!path) return false
    await writeFile(path, bytes)
    return true
  }
  const url = URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer]))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return true
}

export const safeName = (title: string) =>
  title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Note'
