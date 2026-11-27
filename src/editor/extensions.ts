import { Extension, generateJSON, getSchema, type AnyExtension, type Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'
import { fileBytes, putAsset } from './assets'
import { BlockIds } from './blockIds'
import { CanvasBlock } from './canvasBlock'
import { CodeBlockCM } from './codeBlock'
import { GraphBlock } from './graphBlock'
import { ImageBlock } from './imageBlock'
import { looksLikeMarkdown, markdownToHtml, recoverMathInHtml } from './markdown'
import { MarkdownBlockShortcuts } from './markdownShortcuts'
import { BlockMath, InlineMath } from './math'
import { PdfPage, readPdfPages } from './pdfPage'
import { SlashCommand } from './slashCommand'

/** Everything that defines what a note can contain (the schema). */
export function contentExtensions(doc: Y.Doc | null): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: false, // Yjs provides undo/redo
      codeBlock: false, // replaced by CodeMirror-backed block
      link: { openOnClick: false, autolink: true },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    CodeBlockCM,
    InlineMath,
    BlockMath,
    CanvasBlock.configure({ doc }),
    GraphBlock,
    ImageBlock.configure({ doc }),
    PdfPage.configure({ doc }),
    BlockIds,
  ]
}

/** The full editor: content + collaboration, shortcuts, menus, paste/drop handling. */
export function editorExtensions(doc: Y.Doc): AnyExtension[] {
  return [
    ...contentExtensions(doc),
    Collaboration.configure({ document: doc, field: 'content' }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : "Write, use Markdown, or type '/' for blocks…"),
    }),
    MarkdownBlockShortcuts,
    SlashCommand,
    PasteAndDrop.configure({ doc }),
  ]
}

let schemaCache: ReturnType<typeof getSchema> | null = null
const schemaExtensions = () => contentExtensions(null)

/** Write HTML into a note's Yjs doc without opening an editor (used by importers). */
export function writeHtmlToDoc(html: string, doc: Y.Doc) {
  const json = generateJSON(html, schemaExtensions())
  writeJsonToDoc(json, doc)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeJsonToDoc(json: any, doc: Y.Doc) {
  schemaCache ??= getSchema(schemaExtensions())
  const fragment = doc.getXmlFragment('content')
  doc.transact(() => {
    if (fragment.length) fragment.delete(0, fragment.length)
    prosemirrorJSONToYXmlFragment(schemaCache!, json, fragment)
  })
}

// ---------------------------------------------------------------------------
// Paste & drop: Markdown text, HTML with math, images, PDFs

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)$/

export async function fileToNodes(doc: Y.Doc, file: File): Promise<Record<string, unknown>[] | null> {
  if (IMAGE_TYPES.test(file.type)) {
    const asset = await putAsset(doc, await fileBytes(file), file.type)
    return [{ type: 'imageBlock', attrs: { asset, alt: file.name.replace(/\.[^.]+$/, '') } }]
  }
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const bytes = await fileBytes(file)
    const asset = await putAsset(doc, bytes, 'application/pdf')
    const { aspects } = await readPdfPages(bytes)
    const tag = Math.random().toString(36).slice(2, 7)
    return aspects.map((aspect, i) => ({ type: 'pdfPage', attrs: { id: `${asset.slice(0, 8)}-${tag}-${i + 1}`, asset, page: i + 1, aspect } }))
  }
  if (/\.(md|markdown|txt)$/i.test(file.name) || file.type === 'text/markdown') {
    return [{ type: '__html', html: markdownToHtml(await file.text()) }]
  }
  return null
}

async function insertFiles(editor: Editor, doc: Y.Doc, files: File[], pos?: number) {
  const nodes: Record<string, unknown>[] = []
  const htmls: string[] = []
  for (const f of files) {
    const n = await fileToNodes(doc, f)
    if (!n) continue
    for (const item of n) {
      if (item.type === '__html') htmls.push(item.html as string)
      else nodes.push(item)
    }
  }
  if (editor.isDestroyed || (!nodes.length && !htmls.length)) return
  // Build the command only now: the document may have changed while files were read.
  if (pos !== undefined) editor.commands.setTextSelection(pos)
  if (nodes.length) editor.chain().focus().insertContent([...nodes, { type: 'paragraph' }]).run()
  for (const html of htmls) editor.chain().focus().insertContent(html).run()
}

export const PasteAndDrop = Extension.create<{ doc: Y.Doc | null }>({
  name: 'pasteAndDrop',
  addOptions: () => ({ doc: null }),

  addProseMirrorPlugins() {
    const editor = this.editor
    const doc = this.options.doc
    return [
      new Plugin({
        key: new PluginKey('pasteAndDrop'),
        props: {
          transformPastedHTML: (html) => recoverMathInHtml(html),
          handlePaste: (view, event) => {
            const data = event.clipboardData
            if (!data) return false
            const files = [...data.files].filter((f) => IMAGE_TYPES.test(f.type) || f.type === 'application/pdf')
            if (files.length && doc) {
              insertFiles(editor, doc, files).catch((e) => console.error('Could not insert files', e))
              return true
            }
            if (view.state.selection.$from.parent.type.spec.code) return false
            const text = data.getData('text/plain')
            const html = data.getData('text/html')
            // Prefer real HTML structure; but code editors put Markdown on the clipboard as styled spans.
            const structural = /<(p|h[1-6]|ul|ol|li|table|pre|blockquote)\b/i.test(html)
            if (text && (!html || !structural) && looksLikeMarkdown(text)) {
              editor.chain().focus().insertContent(markdownToHtml(text)).run()
              return true
            }
            return false
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved || !doc) return false
            const files = [...(event.dataTransfer?.files ?? [])]
            if (!files.length) return false
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
            event.preventDefault()
            insertFiles(editor, doc, files, at?.pos).catch((e) => console.error('Could not insert files', e))
            return true
          },
        },
      }),
    ]
  },
})

