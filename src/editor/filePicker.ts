import type { Editor } from '@tiptap/core'

/** Open a file picker and insert the chosen files at the cursor (via the paste/drop pipeline). */
export function pickAndInsertFiles(editor: Editor, accept: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.multiple = true
  input.onchange = () => {
    const files = [...(input.files ?? [])]
    if (!files.length) return
    const dt = new DataTransfer()
    files.forEach((f) => dt.items.add(f))
    // Reuse the paste handler: it knows how to turn files into blocks.
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }
  input.click()
}
