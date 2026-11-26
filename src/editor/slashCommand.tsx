import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { exitSuggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * The `/` command menu. This is where blocks with no Markdown equivalent live
 * (and where canvas blocks and graphs will be added).
 */

export interface SlashItem {
  title: string
  description: string
  icon: string
  /** Markdown shortcut that does the same thing, shown as a hint. */
  shortcut?: string
  keywords: string[]
  run: (editor: Editor, range: Range) => void
}

const chainFor = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range)

export const SLASH_ITEMS: SlashItem[] = [
  { title: 'Text', description: 'Plain paragraph', icon: '¶', keywords: ['paragraph', 'p'], run: (e, r) => chainFor(e, r).setParagraph().run() },
  { title: 'Heading 1', description: 'Large section heading', icon: 'H1', shortcut: '#', keywords: ['h1', 'title'], run: (e, r) => chainFor(e, r).setNode('heading', { level: 1 }).run() },
  { title: 'Heading 2', description: 'Medium section heading', icon: 'H2', shortcut: '##', keywords: ['h2', 'subtitle'], run: (e, r) => chainFor(e, r).setNode('heading', { level: 2 }).run() },
  { title: 'Heading 3', description: 'Small section heading', icon: 'H3', shortcut: '###', keywords: ['h3'], run: (e, r) => chainFor(e, r).setNode('heading', { level: 3 }).run() },
  { title: 'Bulleted list', description: 'Simple bullet points', icon: '•', shortcut: '-', keywords: ['ul', 'unordered', 'bullet'], run: (e, r) => chainFor(e, r).toggleBulletList().run() },
  { title: 'Numbered list', description: 'Ordered steps', icon: '1.', shortcut: '1.', keywords: ['ol', 'ordered'], run: (e, r) => chainFor(e, r).toggleOrderedList().run() },
  { title: 'Checklist', description: 'Tasks with checkboxes', icon: '☑', shortcut: '[]', keywords: ['todo', 'task', 'checkbox'], run: (e, r) => chainFor(e, r).toggleTaskList().run() },
  { title: 'Quote', description: 'Blockquote', icon: '❝', shortcut: '>', keywords: ['blockquote', 'citation'], run: (e, r) => chainFor(e, r).toggleBlockquote().run() },
  { title: 'Code block', description: 'Syntax-highlighted code', icon: '{}', shortcut: '```', keywords: ['code', 'program', 'snippet'], run: (e, r) => chainFor(e, r).setCodeBlock().run() },
  { title: 'Equation', description: 'Display (block) math', icon: '∑', shortcut: '$$', keywords: ['math', 'latex', 'katex', 'formula', 'block'], run: (e, r) => chainFor(e, r).insertContent({ type: 'blockMath', attrs: { latex: '' } }).run() },
  { title: 'Inline math', description: 'Math inside a sentence', icon: '𝑥²', shortcut: '$…$', keywords: ['math', 'latex', 'inline', 'formula'], run: (e, r) => chainFor(e, r).insertContent({ type: 'inlineMath', attrs: { latex: '' } }).run() },
  { title: 'Divider', description: 'Horizontal rule', icon: '—', shortcut: '---', keywords: ['hr', 'rule', 'separator', 'line'], run: (e, r) => chainFor(e, r).setHorizontalRule().run() },
]

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter((item) => item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.startsWith(q)))
}

interface MenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const SlashMenu = forwardRef<MenuHandle, SuggestionProps<SlashItem>>(function SlashMenu({ items, command }, ref) {
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setIndex(0), [items])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (!items.length) return false
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        command(items[index])
        return true
      }
      return false
    },
  }))

  return (
    <div className="slash-menu" ref={listRef} role="listbox">
      {items.length === 0 && <div className="slash-empty">No matching blocks</div>}
      {items.map((item, i) => (
        <button
          key={item.title}
          data-index={i}
          className={`slash-item${i === index ? ' active' : ''}`}
          role="option"
          aria-selected={i === index}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            command(item)
          }}
        >
          <span className="slash-icon">{item.icon}</span>
          <span className="slash-text">
            <span className="slash-title">{item.title}</span>
            <span className="slash-desc">{item.description}</span>
          </span>
          {item.shortcut && <kbd className="slash-shortcut">{item.shortcut}</kbd>}
        </button>
      ))}
    </div>
  )
})

function place(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return
  const menuHeight = el.offsetHeight || 320
  const below = rect.bottom + 6
  const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - menuHeight - 6) : below
  const left = Math.min(rect.left, window.innerWidth - (el.offsetWidth || 300) - 8)
  el.style.top = `${top}px`
  el.style.left = `${Math.max(8, left)}px`
}

const slashKey = new PluginKey('slashCommand')

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<MenuHandle, SuggestionProps<SlashItem>> | null = null
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor })
              const el = renderer.element as HTMLElement
              el.classList.add('slash-menu-host')
              document.body.appendChild(el)
              requestAnimationFrame(() => place(el, props.clientRect?.()))
            },
            onUpdate: (props) => {
              renderer?.updateProps(props)
              if (renderer) place(renderer.element as HTMLElement, props.clientRect?.())
            },
            onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
              if (event.key === 'Escape') {
                exitSuggestion(view, slashKey)
                return true
              }
              return renderer?.ref?.onKeyDown(event) ?? false
            },
            onExit: () => {
              renderer?.element.remove()
              renderer?.destroy()
              renderer = null
            },
          }
        },
      }),
    ]
  },
})
