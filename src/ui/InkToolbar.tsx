import { useEffect, useRef, useState } from 'react'
import { selectionSurface } from '../ink/surface'
import { PEN_TYPES, type ToolKind, type ToolPreset } from '../ink/types'
import { redo, undo } from '../ink/undo'
import { adaptColor } from '../ink/render'
import { isDark, newToolId, updateSettings, useSettings } from '../lib/settings'
import { CanvasIcon, PlusIcon, RedoIcon, TextIcon, ToolIcon, UndoIcon } from './icons'

/**
 * Drawboard-style toolbar: any number of pen / highlighter / eraser / lasso
 * presets. Click a preset to use it, click it again to edit it, drag to
 * reorder, "+" to add more.
 */

const PALETTE = ['#1d232b', '#5b6573', '#ffffff', '#d0312d', '#e8702a', '#f2b705', '#2e9e4f', '#14917f', '#1f5fbf', '#6b3fd4', '#c2389b', '#8a5a2b']
const HIGHLIGHT_PALETTE = ['#ffd400', '#ff9f1c', '#7ee081', '#5ad1f5', '#ff7eb6', '#b69cff']

const KIND_LABEL: Record<ToolKind, string> = { pen: 'Pen', highlighter: 'Highlighter', eraser: 'Eraser', lasso: 'Lasso' }

function defaultsFor(kind: ToolKind): ToolPreset {
  const base: ToolPreset = { id: newToolId(), kind, name: KIND_LABEL[kind], color: '#1d232b', width: 2.5, opacity: 1, penType: 'ballpoint', pressure: true, eraserMode: 'stroke' }
  if (kind === 'highlighter') return { ...base, color: '#7ee081', width: 18, opacity: 0.4, penType: 'marker', pressure: false }
  if (kind === 'eraser') return { ...base, width: 24, eraserMode: 'area', name: 'Area eraser' }
  return base
}

export function InkToolbar({ onInsertCanvas }: { onInsertCanvas: () => void }) {
  const settings = useSettings()
  const { tools, activeToolId, toolbarPosition } = settings
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing && !adding) return
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setEditing(null)
        setAdding(false)
      }
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [editing, adding])

  const select = (tool: ToolPreset | null) => {
    setAdding(false)
    if (!tool) {
      setEditing(null)
      updateSettings({ activeToolId: null })
      return
    }
    const sel = selectionSurface()
    if (sel && (tool.kind === 'pen' || tool.kind === 'highlighter') && activeToolId && tools.find((t) => t.id === activeToolId)?.kind === 'lasso') {
      sel.recolorSelected(tool.color) // pick a pen while strokes are lassoed: recolour them
      return
    }
    if (tool.id === activeToolId) {
      setEditing((e) => (e === tool.id ? null : tool.id))
      return
    }
    setEditing(null)
    updateSettings({ activeToolId: tool.id, ...(tool.kind === 'pen' || tool.kind === 'highlighter' ? { lastInkToolId: tool.id } : {}) })
  }

  const patchTool = (id: string, patch: Partial<ToolPreset>) =>
    updateSettings((s) => ({ tools: s.tools.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))

  const addTool = (kind: ToolKind) => {
    const tool = defaultsFor(kind)
    updateSettings((s) => ({ tools: [...s.tools, tool], activeToolId: tool.id }))
    setAdding(false)
    setEditing(tool.id)
  }

  const removeTool = (id: string) => {
    updateSettings((s) => ({
      tools: s.tools.filter((t) => t.id !== id),
      activeToolId: s.activeToolId === id ? null : s.activeToolId,
      lastInkToolId: s.lastInkToolId === id ? (s.tools.find((t) => t.kind === 'pen' && t.id !== id)?.id ?? null) : s.lastInkToolId,
    }))
    setEditing(null)
  }

  const duplicateTool = (tool: ToolPreset) => {
    const copy = { ...tool, id: newToolId(), name: `${tool.name} copy` }
    updateSettings((s) => {
      const i = s.tools.findIndex((t) => t.id === tool.id)
      const next = [...s.tools]
      next.splice(i + 1, 0, copy)
      return { tools: next, activeToolId: copy.id }
    })
    setEditing(copy.id)
  }

  const moveTool = (from: string, to: string) => {
    if (from === to) return
    updateSettings((s) => {
      const next = [...s.tools]
      const a = next.findIndex((t) => t.id === from)
      const [item] = next.splice(a, 1)
      const b = next.findIndex((t) => t.id === to)
      next.splice(b, 0, item)
      return { tools: next }
    })
  }

  const editingTool = tools.find((t) => t.id === editing) ?? null
  const shown = (c: string) => (settings.adaptInkToDark ? adaptColor(c, isDark()) : c)

  return (
    <div ref={rootRef} className={`ink-toolbar pos-${toolbarPosition}`} role="toolbar" aria-label="Ink tools">
      <div className="tb-row">
        <button className={`tb-btn${activeToolId === null ? ' active' : ''}`} title="Type / select text (Esc)" aria-pressed={activeToolId === null} onClick={() => select(null)}>
          <TextIcon />
        </button>
        <span className="tb-sep" />
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`tb-btn tb-tool${tool.id === activeToolId ? ' active' : ''}${dragId === tool.id ? ' dragging' : ''}`}
            title={`${tool.name}${tool.id === activeToolId ? ' (click to edit)' : ''}`}
            aria-pressed={tool.id === activeToolId}
            draggable
            onDragStart={(e) => {
              setDragId(tool.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId) moveTool(dragId, tool.id)
              setDragId(null)
            }}
            onDragEnd={() => setDragId(null)}
            onClick={() => select(tool)}
          >
            <ToolIcon kind={tool.kind} color={shown(tool.color)} />
            {(tool.kind === 'pen' || tool.kind === 'highlighter') && (
              <span className="tb-swatch" style={{ background: shown(tool.color), opacity: tool.kind === 'highlighter' ? 0.8 : 1 }} />
            )}
          </button>
        ))}
        <button className={`tb-btn${adding ? ' active' : ''}`} title="Add a tool" onClick={() => (setEditing(null), setAdding((a) => !a))}>
          <PlusIcon />
        </button>
        <span className="tb-sep" />
        <button className="tb-btn" title="Undo (Ctrl+Z)" onMouseDown={(e) => e.preventDefault()} onClick={undo}>
          <UndoIcon />
        </button>
        <button className="tb-btn" title="Redo (Ctrl+Y)" onMouseDown={(e) => e.preventDefault()} onClick={redo}>
          <RedoIcon />
        </button>
        <button className="tb-btn" title="Insert a canvas block" onMouseDown={(e) => e.preventDefault()} onClick={onInsertCanvas}>
          <CanvasIcon />
        </button>
      </div>

      {adding && (
        <div className="tb-pop tb-add">
          {(['pen', 'highlighter', 'eraser', 'lasso'] as ToolKind[]).map((k) => (
            <button key={k} className="tb-add-item" onClick={() => addTool(k)}>
              <ToolIcon kind={k} color={k === 'highlighter' ? '#7ee081' : '#1d232b'} /> {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      {editingTool && (
        <ToolEditor
          tool={editingTool}
          canDelete={tools.length > 1}
          onChange={(p) => patchTool(editingTool.id, p)}
          onDelete={() => removeTool(editingTool.id)}
          onDuplicate={() => duplicateTool(editingTool)}
        />
      )}
    </div>
  )
}

function ToolEditor({ tool, canDelete, onChange, onDelete, onDuplicate }: { tool: ToolPreset; canDelete: boolean; onChange: (p: Partial<ToolPreset>) => void; onDelete: () => void; onDuplicate: () => void }) {
  const inky = tool.kind === 'pen' || tool.kind === 'highlighter'
  const palette = tool.kind === 'highlighter' ? HIGHLIGHT_PALETTE : PALETTE
  const [minW, maxW, stepW] = tool.kind === 'pen' ? [0.5, 24, 0.5] : tool.kind === 'highlighter' ? [6, 48, 1] : [4, 96, 2]
  return (
    <div className="tb-pop tb-editor" role="dialog" aria-label={`Edit ${tool.name}`}>
      <input className="tb-name" value={tool.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Tool name" />

      {inky && (
        <div className="tb-field">
          <div className="tb-colors">
            {palette.map((c) => (
              <button key={c} className={`tb-color${c === tool.color ? ' active' : ''}`} style={{ background: c }} title={c} aria-label={`Colour ${c}`} onClick={() => onChange({ color: c })} />
            ))}
            <label className="tb-color tb-color-custom" title="Custom colour">
              <input type="color" value={tool.color} onChange={(e) => onChange({ color: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      {tool.kind !== 'lasso' && (
        <label className="tb-field tb-slider">
          <span>{tool.kind === 'eraser' ? 'Size' : 'Thickness'}</span>
          <input type="range" min={minW} max={maxW} step={stepW} value={tool.width} onChange={(e) => onChange({ width: Number(e.target.value) })} />
          <output>{tool.width}</output>
        </label>
      )}

      {tool.kind === 'pen' && (
        <>
          <div className="tb-field">
            <span className="tb-label">Pen type</span>
            <div className="tb-seg">
              {PEN_TYPES.map((p) => (
                <button key={p.id} className={p.id === tool.penType ? 'active' : ''} onClick={() => onChange({ penType: p.id })}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <label className="tb-field tb-check">
            <input type="checkbox" checked={tool.pressure} onChange={(e) => onChange({ pressure: e.target.checked })} />
            <span>Pressure sensitive</span>
          </label>
          <label className="tb-field tb-slider">
            <span>Opacity</span>
            <input type="range" min={0.1} max={1} step={0.05} value={tool.opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
            <output>{Math.round(tool.opacity * 100)}%</output>
          </label>
        </>
      )}

      {tool.kind === 'highlighter' && (
        <label className="tb-field tb-slider">
          <span>Opacity</span>
          <input type="range" min={0.1} max={0.8} step={0.05} value={tool.opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
          <output>{Math.round(tool.opacity * 100)}%</output>
        </label>
      )}

      {tool.kind === 'eraser' && (
        <div className="tb-field">
          <span className="tb-label">Erase</span>
          <div className="tb-seg">
            <button className={tool.eraserMode === 'stroke' ? 'active' : ''} onClick={() => onChange({ eraserMode: 'stroke' })}>
              Whole strokes
            </button>
            <button className={tool.eraserMode === 'area' ? 'active' : ''} onClick={() => onChange({ eraserMode: 'area' })}>
              Area
            </button>
          </div>
        </div>
      )}

      {tool.kind === 'lasso' && (
        <p className="tb-help">
          Circle strokes to select them. Drag inside the box to move, drag the corner to resize. <kbd>Delete</kbd> removes, <kbd>Ctrl+D</kbd> duplicates, and
          picking a pen recolours the selection.
        </p>
      )}

      {inky && <StrokePreview tool={tool} />}

      <div className="tb-actions">
        <button onClick={onDuplicate}>Duplicate</button>
        {canDelete && (
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

function StrokePreview({ tool }: { tool: ToolPreset }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    import('../ink/render').then(({ strokePath, adaptColor }) => {
      const c = ref.current
      if (!c || cancelled) return
      const dpr = window.devicePixelRatio || 1
      c.width = 240 * dpr
      c.height = 48 * dpr
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, 240, 48)
      const pts: number[] = []
      for (let i = 0; i <= 60; i++) {
        const t = i / 60
        pts.push(16 + t * 208, 24 + Math.sin(t * Math.PI * 2) * 10, 0.15 + Math.sin(t * Math.PI) * 0.8)
      }
      const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
      ctx.globalAlpha = tool.opacity
      ctx.fillStyle = adaptColor(tool.color, dark)
      ctx.fill(
        strokePath({ id: 'p', kind: tool.kind === 'highlighter' ? 'highlighter' : 'pen', penType: tool.penType, color: tool.color, width: tool.width, opacity: tool.opacity, pressure: tool.pressure, sim: false, pts, z: 0 }),
      )
    })
    return () => {
      cancelled = true
    }
  }, [tool])
  return <canvas ref={ref} className="tb-preview" style={{ width: 240, height: 48 }} aria-hidden />
}
