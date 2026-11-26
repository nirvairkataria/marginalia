import { MathfieldElement } from 'mathlive'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/** A MathLive field for one expression row (always editable, Desmos style). */

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
    mf.addEventListener('input', () => cbs.current.onChange(mf.value))
    mf.addEventListener(
      'keydown',
      (e) => {
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
    host.current!.appendChild(mf)
    field.current = mf
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
        if (mf.hasFocus() && document.activeElement !== mf) mf.blur()
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
