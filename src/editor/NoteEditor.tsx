import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import type * as Y from 'yjs'
import { bindUndoEditor } from '../ink/undo'
import { getNote, updateNote } from '../lib/notes'
import { BlockIds } from './blockIds'
import { CanvasBlock } from './canvasBlock'
import { CodeBlockCM, ensureLanguageDatalist } from './codeBlock'
import { MarkdownBlockShortcuts } from './markdownShortcuts'
import { BlockMath, InlineMath } from './math'
import { SlashCommand } from './slashCommand'
import { WELCOME_HTML } from './welcome'

function deriveTitle(editor: Editor): string {
  let title = ''
  editor.state.doc.descendants((node) => {
    if (title) return false
    if (node.isTextblock && node.textContent.trim()) {
      title = node.textContent.trim()
      return false
    }
    return true
  })
  return title.slice(0, 80) || 'Untitled'
}

export function NoteEditor({ noteId, ydoc, onReady }: { noteId: string; ydoc: Y.Doc; onReady?: (editor: Editor | null) => void }) {
  const titleTimer = useRef<number | undefined>(undefined)

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false, // Yjs provides undo/redo
          codeBlock: false, // replaced by CodeMirror-backed block
          link: { openOnClick: false, autolink: true },
        }),
        Collaboration.configure({ document: ydoc, field: 'content' }),
        Placeholder.configure({
          placeholder: ({ node }) =>
            node.type.name === 'heading' ? 'Heading' : "Write, use Markdown, or type '/' for blocks…",
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        CodeBlockCM,
        InlineMath,
        BlockMath,
        CanvasBlock.configure({ doc: ydoc }),
        BlockIds,
        MarkdownBlockShortcuts,
        SlashCommand,
      ],
      editorProps: { attributes: { class: 'prose', spellcheck: 'true' } },
      onCreate: ({ editor }) => {
        const meta = getNote(noteId)
        if (meta?.seed === 'welcome' && editor.isEmpty) {
          editor.commands.setContent(WELCOME_HTML)
        }
        if (meta?.seed) updateNote(noteId, { seed: undefined })
        if (editor.isEmpty) editor.commands.focus('end')
      },
      onUpdate: ({ editor, transaction }) => {
        if (!transaction.docChanged) return
        window.clearTimeout(titleTimer.current)
        titleTimer.current = window.setTimeout(() => {
          updateNote(noteId, { title: deriveTitle(editor), updatedAt: Date.now() })
        }, 400)
      },
    },
    [ydoc, noteId],
  )

  useEffect(() => {
    onReady?.(editor)
    bindUndoEditor(editor)
    return () => {
      onReady?.(null)
      bindUndoEditor(null)
    }
  }, [editor, onReady])

  useEffect(() => {
    ensureLanguageDatalist()
    return () => window.clearTimeout(titleTimer.current)
  }, [])

  return <EditorContent editor={editor} className="editor-host" />
}
