import { MathfieldElement } from 'mathlive'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/** A MathLive field for one expression row (always editable, Desmos style). */

/**
 * MathLive tracks focus with an internal `blurred` flag that only updates on a
 * real blur event. It can go stale (a new field starts "focused"; moving focus
 * to a plain input isn't always noticed), after which clicks and focus() do
 * nothing. Correct the flag whenever the field isn't actually focused.
 */
export function resyncMathfieldFocus(mf: MathfieldElement) {
  const inner = (mf as unknown as { _mathfield?: { blurred?: boolean; focusBlurInProgress?: boolean } })._mathfield
  if (!inner || document.activeElement === mf) return
  // If a focus attempt was interrupted (field re-created within MathLive's 60ms
  // focus timer), its "in progress" flag is left on and blocks every later focus.
  inner.focusBlurInProgress = false
  if (inner.blurred === false) inner.blurred = true
}

/** Words typed as functions in graph rows (shown upright, and not split by MathLive's \\tan, \\sin… shortcuts). */
const GRAPH_WORDS = ['tangent', 'distance', 'segment', 'polygon', 'midpoint', 'circle', 'line', 'ray', 'mean', 'median', 'total', 'length', 'stdev', 'count']

/** Keys that end a subscript, like Desmos: y_1 + … , x_1 ~ … */
const SUBSCRIPT_ENDERS = new Set(['+', '-', '=', '~', '<', '>', ',', '*', '/', ' ', '(', ')', '^', '!'])

function inSubscript(mf: MathfieldElement): boolean {
  const model = (mf as unknown as { _mathfield?: { model?: { position: number; at(p: number): { parentBranch?: string } | undefined } } })._mathfield?.model
  return model?.at(model.position)?.parentBranch === 'subscript'
}

export interface MathInputHandle {
  focus: (atEnd?: boolean) => void
}

interface Props {
  value: string
  placeholder?: string
  onChange: (latex: string) => void
  onEnter?: () => void
  onBackspaceEmpty?: () => void
  onMoveOut?: (direction: 'upward' | 'downward') => void
  onFocus?: () => void
}

export const MathInput = forwardRef<MathInputHandle, Props>(function MathInput(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const field = useRef<MathfieldElement | null>(null)
  const cbs = useRef(props)
  cbs.current = props

  useEffect(() => {
    const mf = new MathfieldElement()
    mf.mathVirtualKeyboardPolicy = 'manual'
    mf.smartFence = true
    mf.smartSuperscript = false // Desmos-style: 2^10 keeps typing in the exponent
    mf.className = 'graph-mf'
    mf.value = cbs.current.value
    if (cbs.current.placeholder) mf.placeholder = cbs.current.placeholder
    mf.addEventListener('input', () => cbs.current.onChange(mf.getValue('latex-without-placeholders')))
    mf.addEventListener(
      'keydown',
      (e) => {
        if (SUBSCRIPT_ENDERS.has(e.key) && !e.ctrlKey && !e.metaKey && inSubscript(mf)) mf.executeCommand('moveAfterParent')
        if (e.key === '~') {
          // Regression: y_1 ~ m x_1 + b
          e.preventDefault()
          e.stopPropagation()
          mf.insert('\\sim ')
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          cbs.current.onEnter?.()
        } else if (e.key === 'Backspace' && !mf.value) {
          e.preventDefault()
          cbs.current.onBackspaceEmpty?.()
        }
      },
      { capture: true },
    )
    mf.addEventListener('move-out', (e) => {
      const dir = (e as CustomEvent<{ direction: string }>).detail.direction
      if (dir === 'upward' || dir === 'downward') {
        e.preventDefault()
        cbs.current.onMoveOut?.(dir)
      }
    })
    mf.addEventListener('focus', () => cbs.current.onFocus?.())
    // MathLive can miss a blur (e.g. when focus moves to a table cell) and then
    // ignore clicks because it thinks it's still focused: re-sync before a click.
    mf.addEventListener(
      'pointerdown',
      () => resyncMathfieldFocus(mf),
      { capture: true },
    )
    // Shortcut options can only be set once MathLive has mounted the field.
    const addShortcuts = () => {
      mf.inlineShortcuts = { ...mf.inlineShortcuts, ...Object.fromEntries(GRAPH_WORDS.map((w) => [w, `\\operatorname{${w}}`])) }
    }
    mf.addEventListener('mount', addShortcuts, { once: true })
    host.current!.appendChild(mf)
    field.current = mf
    // MathLive starts out thinking it has focus (hasFocus = !blurred), which makes
    // clicks and focus() no-ops while another input is focused. Reset that state.
    requestAnimationFrame(() => resyncMathfieldFocus(mf))
    return () => {
      mf.remove()
      field.current = null
    }
  }, [])

  // External changes (slider drag, remote edit) update the field unless it is being edited.
  useEffect(() => {
    const mf = field.current
    if (!mf || mf.value === props.value) return
    if (document.activeElement === mf && mf.hasFocus()) return
    mf.setValue(props.value, { silenceNotifications: true })
  }, [props.value])

  useImperativeHandle(ref, () => ({
    focus(atEnd = true) {
      // A just-created field may not accept focus until MathLive has set it up.
      let tries = 0
      const attempt = () => {
        const mf = field.current
        if (!mf) return
        // MathLive reports a never-focused field as focused (hasFocus = !blurred),
        // which makes focus() a no-op; reset that state first.
        resyncMathfieldFocus(mf)
        mf.focus()
        if (mf.hasFocus() && document.activeElement === mf) {
          if (atEnd) mf.executeCommand('moveToMathfieldEnd')
        } else if (++tries < 20) requestAnimationFrame(attempt)
      }
      attempt()
    },
  }))

  return <div ref={host} className="graph-mf-host" />
})
