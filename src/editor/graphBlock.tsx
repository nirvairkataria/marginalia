import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { useCallback, useState } from 'react'
import { GraphView } from '../graph/GraphView'
import { defaultGraphState, newExprId, type GraphState, type GraphViewport } from '../graph/model'

/**
 * A Desmos-style graph inside a note. The whole calculator state (expressions,
 * sliders, viewport) lives in the node's `state` attribute, so it syncs,
 * undoes and copies like any other block.
 */

function GraphNodeView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  const [fallback] = useState(defaultGraphState)
  const state = (node.attrs.state as GraphState | null) ?? fallback
  const height = node.attrs.height as number

  const onChange = useCallback((next: GraphState) => updateAttributes({ state: next }), [updateAttributes])

  // Panning/zooming is saved, but shouldn't fill the undo history.
  const onViewChange = useCallback(
    (view: GraphViewport) => {
      const pos = getPos()
      if (typeof pos !== 'number') return
      const current = editor.state.doc.nodeAt(pos)
      if (!current || current.type.name !== 'graphBlock') return
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, state: { ...current.attrs.state, view } })
      editor.view.dispatch(tr.setMeta('addToHistory', false))
    },
    [editor, getPos],
  )

  const onHeight = useCallback((h: number) => updateAttributes({ height: h }), [updateAttributes])

  return (
    <NodeViewWrapper className="graph-block" data-bid={node.attrs.bid ?? undefined} contentEditable={false}>
      <GraphView state={state} height={height} onChange={onChange} onViewChange={onViewChange} onHeight={onHeight} />
    </NodeViewWrapper>
  )
}

export const GraphBlock = Node.create({
  name: 'graphBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      state: {
        default: null,
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-state') ?? '')
          } catch {
            return null
          }
        },
        renderHTML: (a) => ({ 'data-state': JSON.stringify(a.state) }),
      },
      height: { default: 380, parseHTML: (el) => Number(el.getAttribute('data-height')) || 380, renderHTML: (a) => ({ 'data-height': a.height }) },
    }
  },

  parseHTML: () => [{ tag: 'div[data-type="graph"]' }],

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'graph' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(GraphNodeView, {
      stopEvent: () => true,
      ignoreMutation: () => true,
    })
  },
})

/** Content for inserting a graph, optionally pre-filled with expressions. */
export function graphContent(latex: string[] = []) {
  const state = { ...defaultGraphState(), fresh: true }
  if (latex.length) state.exprs = latex.map((l, i) => ({ id: newExprId(), latex: l, color: ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#000000'][i % 6] }))
  return [{ type: 'graphBlock', attrs: { state } }, { type: 'paragraph' }]
}
