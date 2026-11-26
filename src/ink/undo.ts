import type { Editor } from '@tiptap/core'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'
import { INK_ORIGIN } from './types'

/**
 * Ink shares one undo history with the text editor: the Yjs UndoManager that
 * Tiptap's collaboration extension creates. Ink surfaces register their maps
 * here; Ctrl+Z then undoes text and ink in the order they happened.
 *
 * The manager is looked up from the live editor each time (editors can be
 * recreated), and ink maps are added to whichever manager is current.
 */
let editor: Editor | null = null
let synced: Y.UndoManager | null = null
const scopes = new WeakMap<Y.Doc, Set<Y.Map<unknown>>>()

export function bindUndoEditor(e: Editor | null) {
  editor = e
  syncUndoScope()
}

function current(): Y.UndoManager | null {
  if (!editor || editor.isDestroyed) return null
  return (yUndoPluginKey.getState(editor.state)?.undoManager as Y.UndoManager | undefined) ?? null
}

/** Make sure the current manager tracks ink. Cheap; call before ink edits. */
export function syncUndoScope() {
  const m = current()
  if (!m || m === synced) return
  synced = m
  m.addTrackedOrigin(INK_ORIGIN)
  const maps = scopes.get(m.doc)
  if (maps) m.addToScope([...maps])
}

export function addInkScope(map: Y.Map<unknown>) {
  const doc = map.doc
  if (!doc) return
  let maps = scopes.get(doc)
  if (!maps) scopes.set(doc, (maps = new Set()))
  maps.add(map)
  const m = current()
  if (m && m === synced && m.doc === doc) m.addToScope(map)
  else syncUndoScope()
}

export function undo() {
  syncUndoScope()
  current()?.undo()
}

export function redo() {
  syncUndoScope()
  current()?.redo()
}
