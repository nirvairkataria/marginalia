import type { Editor } from '@tiptap/core'
import { fileBytes, putAsset } from '../editor/assets'
import { writeHtmlToDoc, writeJsonToDoc } from '../editor/extensions'
import { markdownPlainText, markdownTitle, markdownToHtml } from '../editor/markdown'
import { readPdfPages } from '../editor/pdfPage'
import { createNote, SEARCH_TEXT_LIMIT, withNoteDoc } from './notes'

/**
 * Import files from the sidebar's import button (or files dropped on it):
 * Markdown → a new note each, PDF → a new note with annotatable pages,
 * images → into the open note (or a new note if none is open).
 */

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '')
const isMarkdown = (f: File) => /\.(md|markdown|mdown|txt)$/i.test(f.name) || f.type === 'text/markdown'
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isImage = (f: File) => f.type.startsWith('image/')

export const IMPORT_ACCEPT = '.md,.markdown,.txt,.pdf,image/*'

export async function importFiles(files: File[], folder: string, editor: Editor | null): Promise<string | null> {
  let lastNote: string | null = null
  const images: File[] = []
  for (const file of files) {
    if (isMarkdown(file)) {
      const md = await file.text()
      const note = createNote({ folder, title: markdownTitle(md, baseName(file)), text: markdownPlainText(md).slice(0, SEARCH_TEXT_LIMIT) })
      await withNoteDoc(note.id, (doc) => writeHtmlToDoc(markdownToHtml(md), doc))
      lastNote = note.id
    } else if (isPdf(file)) {
      const bytes = await fileBytes(file)
      const info = await readPdfPages(bytes, true)
      const title = info.title && info.title.length > 3 ? info.title : baseName(file)
      const note = createNote({ folder, title, text: `${title}\n${info.text}`.slice(0, SEARCH_TEXT_LIMIT) })
      await withNoteDoc(note.id, async (doc) => {
        const asset = await putAsset(doc, bytes, 'application/pdf')
        const tag = Math.random().toString(36).slice(2, 7)
        writeJsonToDoc(
          {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
              ...info.aspects.map((aspect, i) => ({ type: 'pdfPage', attrs: { id: `${asset.slice(0, 8)}-${tag}-${i + 1}`, asset, page: i + 1, aspect } })),
              { type: 'paragraph' },
            ],
          },
          doc,
        )
      })
      lastNote = note.id
    } else if (isImage(file)) {
      images.push(file)
    }
  }
  if (images.length) {
    if (editor && !editor.isDestroyed) {
      const dt = new DataTransfer()
      images.forEach((f) => dt.items.add(f))
      editor.commands.focus('end')
      editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    } else {
      const note = createNote({ folder, title: baseName(images[0]) })
      await withNoteDoc(note.id, async (doc) => {
        const content = []
        for (const f of images) content.push({ type: 'imageBlock', attrs: { asset: await putAsset(doc, await fileBytes(f), f.type), alt: baseName(f) } })
        writeJsonToDoc({ type: 'doc', content: [...content, { type: 'paragraph' }] }, doc)
      })
      lastNote = note.id
    }
  }
  return lastNote
}
