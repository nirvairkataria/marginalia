import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isDark, subscribeSettings } from '../lib/settings'
import { GraphBoard } from './board'
import { pretty } from './compile'
import { evaluate, type Evaluation, type Item } from './engine'
import { MathInput, type MathInputHandle } from './MathInput'
import { defaultSlider, fmt, GRAPH_COLORS, newExprId, nextColor, type GraphExpr, type GraphState, type GraphViewport, type TableColumn } from './model'

/**
 * Desmos-style graphing calculator: expression list on the left, graph on
 * the right. Runs entirely offline (Compute Engine parsing + JSXGraph).
 */

interface Props {
  state: GraphState
  height: number
  onChange: (state: GraphState) => void
  /** Viewport changes are saved without creating undo steps. */
  onViewChange: (view: GraphViewport) => void
  onHeight: (h: number) => void
}

const SLIDER_RE = /=\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*$/

function nameToLatex(name: string): string {
  const greek = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'lambda', 'mu', 'omega', 'phi', 'sigma', 'tau', 'rho', 'kappa', 'nu', 'psi']
  const m = /^([a-zA-Z]+)_(\w+)$/.exec(name)
  if (m) return `${greek.includes(m[1]) ? `\\${m[1]}` : m[1]}_{${m[2]}}`
  return greek.includes(name) ? `\\${name}` : name
}

function roundForStep(v: number, s: { min: number; max: number; step: number }) {
  if (s.step > 0) return Math.round(v / s.step) * s.step
  const span = Math.abs(s.max - s.min) || 1
  const decimals = Math.max(0, 2 - Math.floor(Math.log10(span)))
  return parseFloat(v.toFixed(decimals))
}

function useDark() {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const off = subscribeSettings(() => setDark(isDark()))
    return () => {
      off()
    }
  }, [])
  return dark
}

export function GraphView({ state, height, onChange, onViewChange, onHeight }: Props) {
  const [full, setFull] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [styleFor, setStyleFor] = useState<string | null>(null)
  const [playing, setPlaying] = useState<Set<string>>(new Set())
  const dark = useDark()
  const hostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<GraphBoard | null>(null)
  const inputs = useRef(new Map<string, MathInputHandle>())
  const stateRef = useRef(state)
  stateRef.current = state
  const scopeRef = useRef<Evaluation['scope'] | undefined>(undefined)

  const evaluation = useMemo(() => {
    const ev = evaluate(state.exprs, state.degrees, scopeRef.current)
    scopeRef.current = ev.scope
    return ev
  }, [state.exprs, state.degrees])
  const evalRef = useRef(evaluation)
  evalRef.current = evaluation

  // Structure key: changes here rebuild the board; slider-only changes just redraw.
  const structure = useMemo(
    () =>
      JSON.stringify([
        state.degrees,
        evaluation.items.map((it) => [
          it.analysis.kind === 'slider' ? `S:${it.analysis.name}` : it.analysis.kind === 'namedPoint' && it.analysis.draggable ? `P:${it.analysis.name}` : it.expr.latex,
          it.expr.table,
          it.expr.label,
          it.expr.color,
          it.expr.hidden,
          it.expr.dashed,
          it.expr.domain,
          it.error,
        ]),
      ]),
    [evaluation, state.degrees],
  )

  const update = useCallback(
    (fn: (s: GraphState) => GraphState) => {
      onChange(fn(stateRef.current))
    },
    [onChange],
  )

  const setExpr = useCallback(
    (id: string, patch: Partial<GraphExpr>) => update((s) => ({ ...s, exprs: s.exprs.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
    [update],
  )

  // ---- board lifecycle ----
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const board = new GraphBoard(
      host,
      stateRef.current.view,
      { dark },
      {
        onViewChange: (v) => onViewChange(v),
        onSelect: (id) => setSelected(id),
        onMoveNamedPoint: (exprId, x, y) => {
          update((s) => ({
            ...s,
            exprs: s.exprs.map((e) => {
              if (e.id !== exprId) return e
              const i = e.latex.indexOf('=')
              return i < 0 ? e : { ...e, latex: `${e.latex.slice(0, i)}=\\left(${x},${y}\\right)` }
            }),
          }))
        },
        onDragPoint: (_exprId, values) => {
          const ids = new Map<string, number>()
          for (const it of evalRef.current.items) if (it.analysis.kind === 'slider' && it.analysis.name in values) ids.set(it.expr.id, values[it.analysis.name])
          update((s) => ({ ...s, exprs: s.exprs.map((e) => (ids.has(e.id) ? { ...e, latex: e.latex.replace(SLIDER_RE, `=${ids.get(e.id)}`) } : e)) }))
        },
      },
      stateRef.current.grid,
    )
    boardRef.current = board
    board.fnLookup = (name) => {
      const f = evalRef.current.scope.fns.get(name)
      return f ? (x: number) => f(x) : null
    }
    board.render(evaluation.items)
    return () => {
      board.destroy()
      boardRef.current = null
    }
    // Rebuild on theme / grid / fullscreen changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, state.grid, full])

  const lastStructure = useRef('')
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    if (structure !== lastStructure.current) board.render(evaluation.items)
    else board.refresh(evaluation.items)
    lastStructure.current = structure
  }, [evaluation, structure])

  // ---- slider animation ----
  useEffect(() => {
    if (!playing.size) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      update((s) => ({
        ...s,
        exprs: s.exprs.map((e) => {
          if (!playing.has(e.id)) return e
          const m = SLIDER_RE.exec(e.latex)
          if (!m) return e
          const sl = e.slider ?? defaultSlider(parseFloat(m[1]))
          let v = parseFloat(m[1]) + ((sl.max - sl.min) / 6) * dt
          if (v > sl.max) v = sl.min
          return { ...e, latex: e.latex.replace(SLIDER_RE, `=${roundForStep(v, sl)}`) }
        }),
      }))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, update])

  // A freshly inserted graph puts the cursor in its first row.
  useEffect(() => {
    if (!stateRef.current.fresh) return
    setFocusId(stateRef.current.exprs[0]?.id ?? null)
    update((s) => {
      const { fresh: _fresh, ...rest } = s
      return rest
    })
  }, [update])

  // ---- focus handling ----
  useEffect(() => {
    if (!focusId) return
    const h = inputs.current.get(focusId)
    if (h) {
      h.focus()
      setFocusId(null)
    }
  }, [focusId, state.exprs])

  const addTable = () => {
    const id = newExprId()
    update((s) => {
      // Name columns x_n / y_n with the next free n
      const used = new Set(s.exprs.flatMap((e) => e.table?.columns.map((c) => c.name) ?? []))
      let n = 1
      while (used.has(`x_${n}`) || used.has(`y_${n}`)) n++
      const table = { columns: [{ name: `x_${n}`, values: ['', '', ''] }, { name: `y_${n}`, values: ['', '', ''] }] }
      return { ...s, exprs: [...s.exprs, { id, latex: '', color: nextColor(s.exprs), table }] }
    })
  }

  const addExpr = (afterId?: string, latex = '') => {
    const id = newExprId()
    update((s) => {
      const exprs = [...s.exprs]
      const i = afterId ? exprs.findIndex((e) => e.id === afterId) + 1 : exprs.length
      exprs.splice(i, 0, { id, latex, color: nextColor(s.exprs) })
      return { ...s, exprs }
    })
    setFocusId(id)
    return id
  }

  const removeExpr = (id: string, focusPrev: boolean) => {
    const exprs = stateRef.current.exprs
    const i = exprs.findIndex((e) => e.id === id)
    if (exprs.length === 1) {
      setExpr(id, { latex: '' })
      return
    }
    update((s) => ({ ...s, exprs: s.exprs.filter((e) => e.id !== id) }))
    if (focusPrev) setFocusId(exprs[Math.max(0, i - 1)]?.id ?? null)
  }

  const addSliders = (afterId: string, names: string[]) => {
    update((s) => {
      const exprs = [...s.exprs]
      let i = exprs.findIndex((e) => e.id === afterId) + 1
      const used = [...s.exprs]
      for (const n of names) {
        const e = { id: newExprId(), latex: `${nameToLatex(n)}=1`, color: nextColor(used), slider: defaultSlider(1) }
        used.push(e)
        exprs.splice(i++, 0, e)
      }
      return { ...s, exprs }
    })
  }

  const move = (id: string, dir: 'upward' | 'downward') => {
    const exprs = stateRef.current.exprs
    const i = exprs.findIndex((e) => e.id === id)
    const j = dir === 'upward' ? i - 1 : i + 1
    if (j >= 0 && j < exprs.length) inputs.current.get(exprs[j].id)?.focus()
    else if (j === exprs.length && exprs[i].latex) addExpr(id)
  }

  const onResize = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const start = height
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const zoom = parseFloat(getComputedStyle(el.closest('.page') ?? document.body).zoom || '1') || 1
    const onMove = (ev: PointerEvent) => onHeight(Math.max(220, Math.min(1200, Math.round(start + (ev.clientY - startY) / zoom))))
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const content = (
    <div className={`graph${full ? ' graph-full' : ''}${state.showList ? '' : ' list-hidden'}`} style={full ? undefined : { height }}>
      {state.showList && (
        <div className="graph-list" data-ink-ignore>
          <div className="graph-list-head">
            <AddMenu onExpression={() => addExpr()} onTable={() => addTable()} />
            <span className="spacer" />
            <button className={`gbtn small${state.degrees ? ' on' : ''}`} title="Angles in degrees or radians" onClick={() => update((s) => ({ ...s, degrees: !s.degrees }))}>
              {state.degrees ? 'DEG' : 'RAD'}
            </button>
            <button className={`gbtn small${state.grid ? ' on' : ''}`} title="Grid" onClick={() => update((s) => ({ ...s, grid: !s.grid }))}>
              #
            </button>
            <button className="gbtn" title="Hide expression list" onClick={() => update((s) => ({ ...s, showList: false }))}>
              «
            </button>
          </div>
          <div className="graph-rows">
            {evaluation.items.map((it, i) => (
              <ExprRow
                key={it.expr.id}
                index={i + 1}
                item={it}
                selected={selected === it.expr.id}
                styleOpen={styleFor === it.expr.id}
                playing={playing.has(it.expr.id)}
                inputRef={(h) => (h ? inputs.current.set(it.expr.id, h) : inputs.current.delete(it.expr.id))}
                onLatex={(latex) => setExpr(it.expr.id, { latex })}
                onEnter={() => addExpr(it.expr.id)}
                onBackspaceEmpty={() => removeExpr(it.expr.id, true)}
                onMove={(d) => move(it.expr.id, d)}
                onDelete={() => removeExpr(it.expr.id, false)}
                onToggle={() => setExpr(it.expr.id, { hidden: !it.expr.hidden })}
                onStyle={() => setStyleFor((s) => (s === it.expr.id ? null : it.expr.id))}
                onPatch={(p) => setExpr(it.expr.id, p)}
                onAddSliders={(names) => addSliders(it.expr.id, names)}
                onPlay={() =>
                  setPlaying((p) => {
                    const n = new Set(p)
                    if (n.has(it.expr.id)) n.delete(it.expr.id)
                    else n.add(it.expr.id)
                    return n
                  })
                }
              />
            ))}
            <button className="graph-add-row" onClick={() => addExpr()}>
              Add expression
            </button>
          </div>
        </div>
      )}
      <div className="graph-canvas" data-ink-passive>
        <div ref={hostRef} className="graph-host" />
        <div className="graph-corner" data-ink-ignore>
          {!state.showList && (
            <button className="gbtn" title="Show expressions" onClick={() => update((s) => ({ ...s, showList: true }))}>
              »
            </button>
          )}
          <button className="gbtn" title="Zoom in" onClick={() => boardRef.current?.zoom(1 / 1.5)}>
            +
          </button>
          <button className="gbtn" title="Zoom out" onClick={() => boardRef.current?.zoom(1.5)}>
            −
          </button>
          <button className="gbtn" title="Default view" onClick={() => boardRef.current?.home({ xmin: -10, xmax: 10, ymin: -7, ymax: 7 })}>
            ⌂
          </button>
          <button className="gbtn" title={full ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setFull((f) => !f)}>
            {full ? '⤡' : '⤢'}
          </button>
        </div>
      </div>
      {!full && <div className="graph-resize" data-ink-ignore onPointerDown={onResize} title="Drag to resize" />}
    </div>
  )

  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  if (full) return createPortal(<div className="graph-overlay">{content}</div>, document.body)
  return content
}

interface RowProps {
  index: number
  item: Item
  selected: boolean
  styleOpen: boolean
  playing: boolean
  inputRef: (h: MathInputHandle | null) => void
  onLatex: (latex: string) => void
  onEnter: () => void
  onBackspaceEmpty: () => void
  onMove: (d: 'upward' | 'downward') => void
  onDelete: () => void
  onToggle: () => void
  onStyle: () => void
  onPatch: (p: Partial<GraphExpr>) => void
  onAddSliders: (names: string[]) => void
  onPlay: () => void
}

function ExprRow({ index, item, selected, styleOpen, playing, inputRef, onLatex, onEnter, onBackspaceEmpty, onMove, onDelete, onToggle, onStyle, onPatch, onAddSliders, onPlay }: RowProps) {
  const { expr, analysis: a, error } = item
  const plottable = !['empty', 'error', 'slider', 'constant', 'value', 'list'].includes(a.kind) && !(a.kind === 'function' && !a.plot)
  const pointish = ['point', 'points', 'namedPoint', 'table'].includes(a.kind)
  const slider = a.kind === 'slider' && !error ? (expr.slider ?? defaultSlider(a.value)) : null

  return (
    <div className={`graph-row${selected ? ' selected' : ''}${error && expr.latex.trim() ? ' has-error' : ''}`}>
      <div className="graph-row-main">
        <span className="graph-index">{index}</span>
        <button
          className={`graph-swatch${expr.hidden ? ' off' : ''}${plottable ? '' : ' inert'}`}
          style={{ '--c': expr.color } as React.CSSProperties}
          title={plottable ? (expr.hidden ? 'Show' : 'Hide') : ''}
          onClick={plottable ? onToggle : undefined}
          onContextMenu={(e) => {
            e.preventDefault()
            onStyle()
          }}
        />
        {expr.table ? (
          <TableEditor table={expr.table} onChange={(table) => onPatch({ table })} />
        ) : (
          <MathInput ref={inputRef} value={expr.latex} onChange={onLatex} onEnter={onEnter} onBackspaceEmpty={onBackspaceEmpty} onMoveOut={onMove} />
        )}
        <div className="graph-row-tools">
          {plottable && (
            <button className="gbtn tiny" title="Colour and style" onClick={onStyle}>
              ◐
            </button>
          )}
          <button className="gbtn tiny" title="Delete" onClick={onDelete}>
            ×
          </button>
        </div>
      </div>

      {styleOpen && (
        <div className="graph-style">
          {GRAPH_COLORS.concat(['#e0428c', '#14917f']).map((c) => (
            <button key={c} className={`graph-color${c === expr.color ? ' on' : ''}`} style={{ background: c }} onClick={() => onPatch({ color: c })} aria-label={`Colour ${c}`} />
          ))}
          <label className="graph-color custom" title="Custom colour">
            <input type="color" value={expr.color} onChange={(e) => onPatch({ color: e.target.value })} />
          </label>
          {!pointish && (
            <button className={`gbtn small${expr.dashed ? ' on' : ''}`} onClick={() => onPatch({ dashed: !expr.dashed })}>
              dashed
            </button>
          )}
          {pointish && (
            <button className={`gbtn small${expr.label ? ' on' : ''}`} onClick={() => onPatch({ label: !expr.label })}>
              label
            </button>
          )}
        </div>
      )}

      {slider && a.kind === 'slider' && (
        <div className="graph-slider">
          <button className="gbtn tiny" title={playing ? 'Pause' : 'Animate'} onClick={onPlay}>
            {playing ? '❚❚' : '▶'}
          </button>
          <NumberBox value={slider.min} onCommit={(v) => onPatch({ slider: { ...slider, min: v } })} />
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={slider.step > 0 ? slider.step : (slider.max - slider.min) / 1000}
            value={a.value}
            onChange={(e) => onLatex(expr.latex.replace(SLIDER_RE, `=${roundForStep(parseFloat(e.target.value), slider)}`))}
          />
          <NumberBox value={slider.max} onCommit={(v) => onPatch({ slider: { ...slider, max: v } })} />
        </div>
      )}

      {(a.kind === 'parametric' || a.kind === 'polar') && !error && (
        <div className="graph-domain">
          <NumberBox value={expr.domain?.min ?? 0} onCommit={(v) => onPatch({ domain: { min: v, max: expr.domain?.max ?? (a.kind === 'polar' ? 2 * Math.PI : 1) } })} />
          <span>
            ≤ {a.kind === 'polar' ? 'θ' : 't'} ≤
          </span>
          <NumberBox value={expr.domain?.max ?? (a.kind === 'polar' ? 2 * Math.PI : 1)} onCommit={(v) => onPatch({ domain: { min: expr.domain?.min ?? 0, max: v } })} />
        </div>
      )}

      {!error && item.value !== undefined && (a.kind === 'value' || a.kind === 'constant') && <div className="graph-value">= {fmt(item.value)}</div>}

      {!error && item.regression && (
        <div className="graph-regression">
          {Object.entries(item.regression.params).map(([k, v]) => (
            <span key={k}>
              <i>{pretty(k)}</i> = {fmt(v)}
            </span>
          ))}
          <span className="r2">
            R² = {fmt(item.regression.r2)}
          </span>
        </div>
      )}

      {error && expr.latex.trim() && (
        <div className="graph-error">
          <span>{error}</span>
          {item.missing.length > 0 && (
            <span className="graph-suggest">
              add slider:
              {item.missing.map((m) => (
                <button key={m} className="gbtn chip" onClick={() => onAddSliders([m])}>
                  {pretty(m)}
                </button>
              ))}
              {item.missing.length > 1 && (
                <button className="gbtn chip" onClick={() => onAddSliders(item.missing)}>
                  all
                </button>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** Show multiples of π as π (domains like 0 ≤ θ ≤ 2π). */
function fmtPi(v: number): string {
  const k = v / Math.PI
  if (v !== 0 && Math.abs(k - Math.round(k * 4) / 4) < 1e-9) {
    const q = Math.round(k * 4) / 4
    if (q === 1) return 'π'
    if (q === -1) return '−π'
    return `${fmt(q)}π`
  }
  return fmt(v)
}

function parseNum(text: string): number {
  const t = text.trim().replace(/−/g, '-').replace(/pi/gi, 'π')
  const m = /^(-?\d*\.?\d*)\s*π$/.exec(t)
  if (m) return (m[1] === '' ? 1 : m[1] === '-' ? -1 : parseFloat(m[1])) * Math.PI
  return parseFloat(t)
}

function AddMenu({ onExpression, onTable }: { onExpression: () => void; onTable: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="graph-add-menu">
      <button className="gbtn" title="Add an expression or table" onClick={() => setOpen((o) => !o)}>
        ＋
      </button>
      {open && (
        <span className="graph-add-pop" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => (setOpen(false), onExpression())}>Expression</button>
          <button onClick={() => (setOpen(false), onTable())}>Table</button>
        </span>
      )}
    </span>
  )
}

/** Desmos-style table: header row of column names, then numbers. A blank last row grows the table. */
function TableEditor({ table, onChange }: { table: { columns: TableColumn[] }; onChange: (t: { columns: TableColumn[] }) => void }) {
  const rows = Math.max(...table.columns.map((c) => c.values.length), 1)
  const setCell = (ci: number, ri: number, v: string) => {
    const columns = table.columns.map((c, i) => {
      if (i !== ci) return c
      const values = [...c.values]
      while (values.length <= ri) values.push('')
      values[ri] = v
      return { ...c, values }
    })
    // Keep one empty row at the bottom to type into
    const last = Math.max(...columns.map((c) => c.values.length)) - 1
    if (columns.some((c) => (c.values[last] ?? '').trim())) columns.forEach((c) => c.values.push(''))
    onChange({ columns })
  }
  const setName = (ci: number, name: string) => onChange({ columns: table.columns.map((c, i) => (i === ci ? { ...c, name } : c)) })
  const addColumn = () => {
    const used = new Set(table.columns.map((c) => c.name))
    let n = 1
    while (used.has(`y_${n}`)) n++
    onChange({ columns: [...table.columns, { name: `y_${n}`, values: Array(rows).fill('') }] })
  }
  const removeColumn = (ci: number) => table.columns.length > 2 && onChange({ columns: table.columns.filter((_, i) => i !== ci) })
  const focusCell = (ci: number, ri: number, host: HTMLElement) => host.closest('table')?.querySelector<HTMLInputElement>(`[data-cell="${ci}-${ri}"]`)?.focus()
  return (
    <table className="graph-table">
      <thead>
        <tr>
          {table.columns.map((c, ci) => (
            <th key={ci}>
              <input value={c.name} onChange={(e) => setName(ci, e.target.value)} spellCheck={false} aria-label="Column name" />
              {ci > 1 && (
                <button className="col-x" title="Remove column" onClick={() => removeColumn(ci)}>
                  ×
                </button>
              )}
            </th>
          ))}
          <th className="col-add">
            <button title="Add column" onClick={addColumn}>
              ＋
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, ri) => (
          <tr key={ri}>
            {table.columns.map((c, ci) => (
              <td key={ci}>
                <input
                  data-cell={`${ci}-${ri}`}
                  value={c.values[ri] ?? ''}
                  inputMode="decimal"
                  onChange={(e) => setCell(ci, ri, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'ArrowDown') {
                      e.preventDefault()
                      requestAnimationFrame(() => focusCell(ci, ri + 1, e.target as HTMLElement))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      focusCell(ci, ri - 1, e.target as HTMLElement)
                    }
                  }}
                />
              </td>
            ))}
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NumberBox({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(fmtPi(value))
  useEffect(() => setText(fmtPi(value)), [value])
  const commit = () => {
    const v = parseNum(text)
    if (Number.isFinite(v)) onCommit(v)
    else setText(fmtPi(value))
  }
  return (
    <input
      className="graph-num"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
