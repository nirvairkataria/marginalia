import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

/**
 * Markdown-style block shortcuts that finish on Enter rather than Space.
 * (Space-triggered ones such as `## `, `- `, `> `, `[] `, and inline marks like
 * `**bold**` come from the individual Tiptap extensions' input rules.)
 *
 *   ```python  + Enter  ->  Python code block
 *   $$         + Enter  ->  display equation
 */
export const MarkdownBlockShortcuts = Extension.create({
  name: 'markdownBlockShortcuts',
  priority: 200,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty || $from.parent.type.name !== 'paragraph') return false
        if ($from.parentOffset !== $from.parent.content.size) return false
        const text = $from.parent.textContent

        if (text === '$$' && $from.depth === 1) {
          const blockMath = state.schema.nodes.blockMath
          const tr = state.tr.replaceWith($from.before(), $from.after(), blockMath.create({ latex: '' }))
          editor.view.dispatch(tr)
          return true
        }

        const fence = /^(?:```|~~~)([\w+#.-]*)$/.exec(text)
        if (fence) {
          const codeBlock = state.schema.nodes.codeBlock
          const start = $from.start()
          const tr = state.tr
            .delete(start, $from.end())
            .setBlockType(start, start, codeBlock, { language: fence[1] || null })
          tr.setSelection(TextSelection.create(tr.doc, start))
          editor.view.dispatch(tr)
          return true
        }
        return false
      },
    }
  },
})
