/** Ink data model. Strokes are immutable records stored in Yjs maps. */

export type PenType = 'ballpoint' | 'fountain' | 'pencil' | 'marker' | 'brush'

export const PEN_TYPES: { id: PenType; label: string }[] = [
  { id: 'ballpoint', label: 'Ballpoint' },
  { id: 'fountain', label: 'Fountain' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'marker', label: 'Marker' },
  { id: 'brush', label: 'Brush' },
]

export interface Stroke {
  id: string
  kind: 'pen' | 'highlighter'
  penType: PenType
  color: string
  /** Base diameter in page px */
  width: number
  opacity: number
  /** Width follows pen pressure */
  pressure: boolean
  /** Pressure is simulated from speed (mouse / pen without pressure) */
  sim: boolean
  /** Flat x,y,pressure triplets in the stroke's local coordinates */
  pts: number[]
  /**
   * Page overlay only: id of the block the stroke is attached to. Coordinates
   * are relative to that block's top edge (x relative to the page's left edge),
   * so the stroke moves with the block when content above it changes.
   */
  anchor?: string | null
  /** Page overlay only: the anchor block's top when drawn (fallback if it is deleted) */
  ay?: number
  /** Ordering (later = on top) */
  z: number
}

export type ToolKind = 'pen' | 'highlighter' | 'eraser' | 'lasso'

export interface ToolPreset {
  id: string
  kind: ToolKind
  name: string
  color: string
  width: number
  opacity: number
  penType: PenType
  pressure: boolean
  eraserMode: 'stroke' | 'area'
}

export const INK_ORIGIN = 'marginalia-ink'
