import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Gives every block a stable id (`data-bid`). Ink drawn on the page attaches
 * to the block under it via this id, so annotations follow their paragraph
 * when content above is added or removed.
 */

export const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'codeBlock',
  'blockMath',
  'horizontalRule',
  'canvasBlock',
  'graphBlock',
  'imageBlock',
  'pdfPage',
  'table',
]

const newBid = () => Math.random().toString(36).slice(2, 10)

export const BlockIds = Extension.create({
  name: 'blockIds',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_ID_TYPES,
        attributes: {
          bid: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-bid'),
            renderHTML: (attrs) => (attrs.bid ? { 'data-bid': attrs.bid } : {}),
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    const types = new Set(BLOCK_ID_TYPES)
    return [
      new Plugin({
        key: new PluginKey('blockIds'),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const seen = new Set<string>()
          const tr = state.tr
          let changed = false
          state.doc.descendants((node, pos) => {
            if (!types.has(node.type.name)) return true
            const bid = node.attrs.bid as string | null
            if (!bid || seen.has(bid)) {
              const id = newBid()
              tr.setNodeAttribute(pos, 'bid', id)
              seen.add(id)
              changed = true
            } else seen.add(bid)
            return node.type.name !== 'codeBlock' && !node.isAtom
          })
          if (!changed) return null
          return tr.setMeta('addToHistory', false)
        },
      }),
    ]
  },
})
