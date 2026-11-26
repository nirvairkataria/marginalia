import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'
import {
  drawSelection,
  EditorView as CMView,
  keymap,
  lineNumbers,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view'
import type { Editor } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection, type EditorState as PMState } from '@tiptap/pm/state'
import type { EditorView, NodeView } from '@tiptap/pm/view'
import { runCode, runnableLang } from '../runner/runner'

/**
 * Code blocks rendered with a real CodeMirror 6 editor (syntax highlighting,
 * bracket matching, auto-indent, Tab to indent), kept in sync with the
 * ProseMirror/Yjs document. Adapted from the official ProseMirror example:
 * https://prosemirror.net/examples/codemirror/
 */

const LANGUAGE_NAMES = languages.flatMap((l) => [l.name.toLowerCase(), ...l.alias]).sort()

/** Syntax colours come from CSS variables, so they follow light/dark theme switches. */
const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--code-type)' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: 'var(--code-def)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-property)' },
  { tag: [t.operator, t.punctuation], color: 'var(--code-punct)' },
  { tag: [t.meta, t.annotation], color: 'var(--code-meta)' },
  { tag: t.heading, fontWeight: 'bold', color: 'var(--code-keyword)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--code-invalid)' },
])

class CodeMirrorView implements NodeView {
  dom: HTMLElement
  private cm: CMView
  private updating = false
  private language = new Compartment()
  private langInput: HTMLInputElement
  private runButton: HTMLButtonElement
  private loadedLanguage: string | null | undefined

  private node: PMNode
  private view: EditorView
  private getPos: () => number | undefined
  private editor: Editor

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, editor: Editor) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.editor = editor
    this.cm = new CMView({
      state: EditorState.create({
        doc: node.textContent,
        extensions: [
          keymap.of([...this.escapeKeymap(), ...closeBracketsKeymap, ...defaultKeymap, indentWithTab]),
          lineNumbers(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          syntaxHighlighting(highlightStyle),
          this.language.of([]),
          CMView.updateListener.of((update) => this.forwardUpdate(update)),
        ],
      }),
    })

    this.dom = document.createElement('div')
    this.dom.className = 'code-block'

    const header = document.createElement('div')
    header.className = 'code-block-header'
    header.contentEditable = 'false'
    this.langInput = document.createElement('input')
    this.langInput.className = 'code-lang'
    this.langInput.placeholder = 'plain text'
    this.langInput.spellcheck = false
    this.langInput.setAttribute('list', 'marginalia-code-languages')
    this.langInput.value = node.attrs.language ?? ''
    this.langInput.addEventListener('change', () => this.setLanguageAttr(this.langInput.value.trim() || null))
    this.langInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.cm.focus()
      }
    })
    this.runButton = document.createElement('button')
    this.runButton.className = 'code-run'
    this.runButton.type = 'button'
    this.runButton.title = 'Run (Shift+Enter)'
    this.runButton.innerHTML = '<span aria-hidden="true">▶</span> Run'
    this.runButton.addEventListener('mousedown', (e) => e.preventDefault())
    this.runButton.addEventListener('click', () => this.run())
    header.append(this.langInput, this.runButton)
    this.syncChrome()

    this.dom.append(header, this.cm.dom)
    this.loadLanguage(node.attrs.language)
  }

  private syncChrome() {
    this.runButton.hidden = !runnableLang(this.node.attrs.language)
    if (this.node.attrs.bid) this.dom.dataset.bid = this.node.attrs.bid
  }

  private run() {
    const lang = runnableLang(this.node.attrs.language)
    if (!lang) return false
    runCode(lang, this.cm.state.doc.toString())
    return true
  }

  private setLanguageAttr(language: string | null) {
    const pos = this.getPos()
    if (pos === undefined) return
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, language }))
  }

  private async loadLanguage(name: string | null) {
    if (name === this.loadedLanguage) return
    this.loadedLanguage = name
    const desc = name ? LanguageDescription.matchLanguageName(languages, name, true) : null
    if (!desc) {
      this.cm.dispatch({ effects: this.language.reconfigure([]) })
      return
    }
    const support = await desc.load()
    if (this.loadedLanguage === name) this.cm.dispatch({ effects: this.language.reconfigure(support) })
  }

  /** CodeMirror -> ProseMirror */
  private forwardUpdate(update: ViewUpdate) {
    if (this.updating || !this.cm.hasFocus) return
    const pos = this.getPos()
    if (pos === undefined) return
    let offset = pos + 1
    const { main } = update.state.selection
    const selFrom = offset + main.from
    const selTo = offset + main.to
    const pmSel = this.view.state.selection
    if (!update.docChanged && pmSel.from === selFrom && pmSel.to === selTo) return
    const tr = this.view.state.tr
    update.changes.iterChanges((fromA, toA, fromB, toB, text) => {
      if (text.length) tr.replaceWith(offset + fromA, offset + toA, this.view.state.schema.text(text.toString()))
      else tr.delete(offset + fromA, offset + toA)
      offset += toB - fromB - (toA - fromA)
    })
    tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo))
    this.view.dispatch(tr)
  }

  /** ProseMirror selection lands inside this node */
  setSelection(anchor: number, head: number) {
    this.cm.focus()
    this.updating = true
    this.cm.dispatch({ selection: { anchor, head } })
    this.updating = false
  }

  private escapeKeymap(): KeyBinding[] {
    return [
      { key: 'ArrowUp', run: () => this.maybeEscape('line', -1) },
      { key: 'ArrowLeft', run: () => this.maybeEscape('char', -1) },
      { key: 'ArrowDown', run: () => this.maybeEscape('line', 1) },
      { key: 'ArrowRight', run: () => this.maybeEscape('char', 1) },
      { key: 'Mod-Enter', run: () => this.exitBelow() },
      { key: 'Shift-Enter', run: () => this.run() },
      { key: 'Mod-z', run: () => this.editor.commands.undo() },
      { key: 'Mod-y', run: () => this.editor.commands.redo() },
      { key: 'Shift-Mod-z', run: () => this.editor.commands.redo() },
      { key: 'Backspace', run: () => this.backspaceEmpty() },
    ]
  }

  private maybeEscape(unit: 'line' | 'char', dir: -1 | 1) {
    const { state } = this.cm
    let range: { from: number; to: number } = state.selection.main
    if (!state.selection.main.empty) return false
    if (unit === 'line') range = state.doc.lineAt(state.selection.main.head)
    if (dir < 0 ? range.from > 0 : range.to < state.doc.length) return false
    const pos = this.getPos()
    if (pos === undefined) return false
    const target = pos + (dir < 0 ? 0 : this.node.nodeSize)
    const selection = Selection.near(this.view.state.doc.resolve(target), dir)
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView())
    this.view.focus()
    return true
  }

  /** Ctrl/Cmd+Enter: leave the code block and continue writing below it. */
  private exitBelow() {
    const pos = this.getPos()
    if (pos === undefined) return false
    const after = pos + this.node.nodeSize
    const { state } = this.view
    let tr = state.tr
    const next = state.doc.resolve(after).nodeAfter
    if (!next || !next.isTextblock) tr = tr.insert(after, state.schema.nodes.paragraph.create())
    tr = tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView()
    this.view.dispatch(tr)
    this.view.focus()
    return true
  }

  /** Backspace in an empty code block turns it back into a paragraph. */
  private backspaceEmpty() {
    if (this.cm.state.doc.length > 0) return false
    const pos = this.getPos()
    if (pos === undefined) return false
    const { state } = this.view
    const tr = state.tr.setBlockType(pos, pos + this.node.nodeSize, state.schema.nodes.paragraph)
    tr.setSelection(TextSelection.create(tr.doc, pos + 1))
    this.view.dispatch(tr)
    this.view.focus()
    return true
  }

  /** ProseMirror -> CodeMirror */
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.syncChrome()
    if (node.attrs.language !== this.loadedLanguage) {
      if (document.activeElement !== this.langInput) this.langInput.value = node.attrs.language ?? ''
      this.loadLanguage(node.attrs.language)
    }
    if (this.updating) return true
    const newText = node.textContent
    const curText = this.cm.state.doc.toString()
    if (newText !== curText) {
      let start = 0
      let curEnd = curText.length
      let newEnd = newText.length
      while (start < curEnd && curText.charCodeAt(start) === newText.charCodeAt(start)) ++start
      while (curEnd > start && newEnd > start && curText.charCodeAt(curEnd - 1) === newText.charCodeAt(newEnd - 1)) {
        curEnd--
        newEnd--
      }
      this.updating = true
      this.cm.dispatch({ changes: { from: start, to: curEnd, insert: newText.slice(start, newEnd) } })
      this.updating = false
    }
    return true
  }

  selectNode() {
    this.cm.focus()
  }

  stopEvent() {
    return true
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.cm.destroy()
  }
}

/** Arrow keys in the surrounding text move the cursor *into* an adjacent code block. */
function arrowIntoCode(dir: 'left' | 'right' | 'up' | 'down') {
  return ({ editor }: { editor: Editor }) => {
    const { state, view } = editor
    if (!state.selection.empty || !view.endOfTextblock(dir)) return false
    const side = dir === 'left' || dir === 'up' ? -1 : 1
    const $head = (state as PMState).selection.$head
    if ($head.depth === 0) return false
    const next = Selection.near(state.doc.resolve(side > 0 ? $head.after() : $head.before()), side)
    if (next.$head && next.$head.parent.type.name === 'codeBlock') {
      view.dispatch(state.tr.setSelection(next))
      return true
    }
    return false
  }
}

export const CodeBlockCM = CodeBlock.extend({
  addNodeView() {
    return ({ node, view, getPos, editor }) => new CodeMirrorView(node, view, getPos, editor)
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-c': () => this.editor.commands.toggleCodeBlock(),
      ArrowLeft: arrowIntoCode('left'),
      ArrowRight: arrowIntoCode('right'),
      ArrowUp: arrowIntoCode('up'),
      ArrowDown: arrowIntoCode('down'),
    }
  },
})

/** Datalist backing the language picker in every code block header. */
export function ensureLanguageDatalist() {
  if (document.getElementById('marginalia-code-languages')) return
  const list = document.createElement('datalist')
  list.id = 'marginalia-code-languages'
  for (const name of new Set(LANGUAGE_NAMES)) {
    const opt = document.createElement('option')
    opt.value = name
    list.appendChild(opt)
  }
  document.body.appendChild(list)
}
