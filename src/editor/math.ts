import { InputRule, mergeAttributes, Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'
import katex from 'katex'
import { MathfieldElement } from 'mathlive'
import { getSettings } from '../lib/settings'

/**
 * Inline math  ($x^2$)  and display math  ($$ + Enter).
 *
 * Both are atom nodes storing raw LaTeX in a `latex` attribute. They render
 * with KaTeX; clicking one (or pressing Enter while it is selected) opens a
 * MathLive WYSIWYG field with a synced raw-LaTeX box underneath.
 */

/** `$...$` typed inline. Content must not start or end with whitespace, so "$5 and $" stays text. */
const INLINE_MATH_INPUT = /(^|[^$\\])\$([^\s$](?:[^$\n]*[^\s$\\])?)\$$/
/** `$$...$$` typed as a whole paragraph. */
const BLOCK_MATH_INPUT = /^\$\$([^$]+)\$\$$/

export const EDIT_MATH_EVENT = 'marginalia:edit-math'

function renderKatex(el: HTMLElement, latex: string, displayMode: boolean) {
  if (!latex.trim()) {
    el.innerHTML = ''
    el.textContent = displayMode ? 'Empty equation' : '∅'
    el.classList.add('math-empty')
    return
  }
  el.classList.remove('math-empty')
  katex.render(latex, el, { displayMode, throwOnError: false, output: 'html' })
}

class MathView implements NodeView {
  dom: HTMLElement
  private renderEl: HTMLElement
  private panel: HTMLElement | null = null
  private node: PMNode
  private closing = false
  private editor: Editor
  private getPos: () => number | undefined
  private display: boolean

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined, display: boolean) {
    this.node = node
    this.editor = editor
    this.getPos = getPos
    this.display = display
    this.dom = document.createElement(display ? 'div' : 'span')
    this.dom.className = display ? 'math-node math-block' : 'math-node math-inline'
    this.dom.contentEditable = 'false'
    this.renderEl = document.createElement(display ? 'div' : 'span')
    this.renderEl.className = 'math-render'
    this.dom.appendChild(this.renderEl)
    renderKatex(this.renderEl, node.attrs.latex, display)
    if (node.attrs.bid) this.dom.dataset.bid = node.attrs.bid

    this.dom.addEventListener('mousedown', (e) => {
      if (this.panel?.contains(e.target as globalThis.Node)) return
      if (!this.editor.isEditable) return
      e.preventDefault()
      this.open()
    })
    this.dom.addEventListener(EDIT_MATH_EVENT, () => this.open())

    // Freshly inserted empty equations open straight into edit mode.
    if (!node.attrs.latex && editor.isEditable) queueMicrotask(() => this.open())
  }

  private open() {
    if (this.panel) return
    const latex: string = this.node.attrs.latex
    const panel = document.createElement('div')
    panel.className = 'math-panel'

    const mf = new MathfieldElement()
    mf.value = latex
    mf.mathVirtualKeyboardPolicy = 'manual'
    mf.className = 'math-field'

    const raw = document.createElement('textarea')
    raw.className = 'math-raw'
    raw.spellcheck = false
    raw.rows = 1
    raw.value = latex
    raw.placeholder = 'LaTeX'

    const visual = getSettings().mathInput === 'visual'
    const hint = document.createElement('div')
    hint.className = 'math-hint'
    const hintText = document.createElement('span')
    hintText.textContent = visual
      ? 'Type naturally: a/b, x^2, sqrt, alpha, int, sum · Enter to save · Esc to cancel'
      : 'Enter to save · Esc to cancel · Shift+Enter in the LaTeX box for a new line'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'math-toggle'
    const setRawVisible = (show: boolean) => {
      raw.hidden = !show
      toggle.textContent = show ? 'Hide LaTeX' : 'Show LaTeX'
    }
    setRawVisible(!visual)
    toggle.addEventListener('mousedown', (e) => e.preventDefault())
    toggle.addEventListener('click', () => setRawVisible(raw.hidden === true))
    hint.append(hintText, toggle)

    panel.append(mf, raw, hint)
    this.dom.appendChild(panel)
    this.dom.classList.add('editing')
    this.panel = panel

    const preview = (value: string) => renderKatex(this.renderEl, value, this.display)
    mf.addEventListener('input', () => {
      raw.value = mf.value
      preview(mf.value)
    })
    raw.addEventListener('input', () => {
      mf.setValue(raw.value, { silenceNotifications: true })
      preview(raw.value)
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.close(null)
      } else if (e.key === 'Enter' && !(e.shiftKey && e.target === raw)) {
        e.preventDefault()
        this.close(raw.value)
      }
    }
    panel.addEventListener('keydown', onKey, true)
    panel.addEventListener('focusout', (e) => {
      const next = e.relatedTarget as globalThis.Node | null
      if (next && panel.contains(next)) return
      // MathLive moves focus around internally; re-check after it settles.
      setTimeout(() => {
        if (this.panel && !this.panel.contains(document.activeElement)) this.close(raw.value)
      }, 0)
    })

    requestAnimationFrame(() => {
      // Keep the inline popover inside the page / window.
      if (!this.display) {
        const bounds = this.dom.closest('.page')?.getBoundingClientRect()
        const limit = Math.min(window.innerWidth - 8, bounds ? bounds.right - 8 : Infinity)
        const overflow = panel.getBoundingClientRect().right - limit
        if (overflow > 0) panel.style.left = `${-overflow}px`
      }
      mf.focus()
      mf.executeCommand('moveToMathfieldEnd')
    })
  }

  /** Close the editor. `latex === null` cancels; empty latex deletes the node. */
  private close(latex: string | null) {
    if (!this.panel || this.closing) return
    this.closing = true
    this.panel.remove()
    this.panel = null
    this.dom.classList.remove('editing')
    this.closing = false

    const pos = this.getPos()
    if (pos === undefined) return
    const { view } = this.editor
    let tr = view.state.tr
    let after: number
    if (latex !== null && !latex.trim()) {
      tr = tr.delete(pos, pos + this.node.nodeSize)
      after = pos
    } else {
      if (latex !== null && latex !== this.node.attrs.latex) {
        tr = tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, latex })
      } else {
        renderKatex(this.renderEl, this.node.attrs.latex, this.display)
      }
      after = pos + this.node.nodeSize
    }
    tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size)), 1))
    view.dispatch(tr)
    view.focus()
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.panel) renderKatex(this.renderEl, node.attrs.latex, this.display)
    if (node.attrs.bid) this.dom.dataset.bid = node.attrs.bid
    return true
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(event: Event) {
    return !!this.panel && this.panel.contains(event.target as globalThis.Node)
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.panel?.remove()
  }
}

function enterOpensMath(editor: Editor, typeName: string) {
  const { selection } = editor.state
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== typeName) return false
  const dom = editor.view.nodeDOM(selection.from)
  if (!(dom instanceof HTMLElement)) return false
  dom.dispatchEvent(new CustomEvent(EDIT_MATH_EVENT))
  return true
}

const latexAttribute = {
  latex: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-latex': attrs.latex }),
  },
}

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes: () => latexAttribute,

  parseHTML: () => [{ tag: 'span[data-type="inline-math"]' }],

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' }), `$${node.attrs.latex}$`]
  },

  renderText: ({ node }) => `$${node.attrs.latex}$`,

  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor, getPos, false)
  },

  addInputRules() {
    return [
      new InputRule({
        find: INLINE_MATH_INPUT,
        handler: ({ state, range, match }) => {
          const start = range.from + match[1].length
          state.tr.replaceWith(start, range.to, this.type.create({ latex: match[2] }))
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => enterOpensMath(editor, this.name),
      // Word's "insert equation" shortcut
      'Alt-=': ({ editor }) => editor.chain().focus().insertContent({ type: this.name, attrs: { latex: '' } }).run(),
    }
  },
})

export const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes: () => latexAttribute,

  parseHTML: () => [{ tag: 'div[data-type="block-math"]' }],

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' }), `$$${node.attrs.latex}$$`]
  },

  renderText: ({ node }) => `$$\n${node.attrs.latex}\n$$`,

  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor, getPos, true)
  },

  addInputRules() {
    return [
      new InputRule({
        find: BLOCK_MATH_INPUT,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.name !== 'paragraph' || $from.depth !== 1) return null
          state.tr.replaceWith($from.before(), $from.after(), this.type.create({ latex: match[1] }))
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return { Enter: ({ editor }) => enterOpensMath(editor, this.name) }
  },
})
