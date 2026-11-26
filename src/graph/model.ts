/** Persistent graph state, stored on the graph block node. */

export interface SliderSettings {
  min: number
  max: number
  step: number
}

export interface GraphExpr {
  id: string
  latex: string
  color: string
  hidden?: boolean
  dashed?: boolean
  slider?: SliderSettings
  /** Parameter range for parametric curves (t) */
  domain?: { min: number; max: number }
}

export interface GraphViewport {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
}

export interface GraphState {
  exprs: GraphExpr[]
  view: GraphViewport
  degrees: boolean
  grid: boolean
  showList: boolean
  /** Just inserted: focus the first expression once. */
  fresh?: boolean
}

/** Desmos-like palette, cycled for new expressions. */
export const GRAPH_COLORS = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#000000']

export const DEFAULT_VIEW: GraphViewport = { xmin: -10, xmax: 10, ymin: -7, ymax: 7 }

export const newExprId = () => Math.random().toString(36).slice(2, 10)

export function nextColor(exprs: GraphExpr[]): string {
  const used = exprs.map((e) => e.color)
  return GRAPH_COLORS.find((c) => !used.includes(c)) ?? GRAPH_COLORS[exprs.length % GRAPH_COLORS.length]
}

export function defaultGraphState(): GraphState {
  return {
    exprs: [{ id: newExprId(), latex: '', color: GRAPH_COLORS[0] }],
    view: { ...DEFAULT_VIEW },
    degrees: false,
    grid: true,
    showList: true,
  }
}

export function defaultSlider(value: number): SliderSettings {
  const mag = Math.max(10, Math.pow(10, Math.ceil(Math.log10(Math.abs(value) + 1e-9))))
  return { min: value < 0 ? -mag : -10 <= value && value <= 10 ? -10 : 0, max: mag, step: 0 }
}

/** Format numbers the way a calculator would. */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'undefined' : v > 0 ? '∞' : '−∞'
  if (Math.abs(v) < 1e-10) return '0'
  if (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4) {
    const [m, e] = v.toExponential(4).split('e')
    return `${parseFloat(m)}×10^${parseInt(e, 10)}`
  }
  return String(parseFloat(v.toPrecision(6))).replace('-', '−')
}
