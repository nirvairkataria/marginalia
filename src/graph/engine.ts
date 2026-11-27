import { ComputeEngine } from '@cortex-js/compute-engine'
import {
  analyze,
  compile,
  compileList,
  compilePoint,
  freeSymbols,
  GraphError,
  newScope,
  pretty,
  RESERVED,
  symbols,
  type Analysis,
  type Fn,
  type Json,
  type Pt,
  type Scope,
} from './compile'
import type { GraphExpr } from './model'

/**
 * Evaluates a whole expression list: builds the scope in dependency order
 * (sliders, functions, tables/lists, named points, regressions, constants),
 * then compiles everything plottable.
 */

let ce: ComputeEngine | null = null
const parseCache = new Map<string, Json>()

/** Function names people type as plain letters (Desmos style): segment(A,B) → \operatorname{segment}(A,B) */
const WORD_FNS = ['segment', 'polygon', 'circle', 'line', 'ray', 'midpoint', 'distance', 'tangent', 'mean', 'median', 'total', 'length', 'stdev', 'count']
const WORD_RE = new RegExp(`(?<![\\\\a-zA-Z{])(${WORD_FNS.join('|')})(?=\\s*(?:\\\\left)?\\()`, 'g')
/** The same words when MathLive has split them with a command, e.g. "\\tan gent", "dis\\tan ce". */
const SPLIT_WORDS = WORD_FNS.map((w) => [w, new RegExp(`(?<![\\\\a-zA-Z{])${w.split('').map((c) => `\\\\?${c}\\s*`).join('')}(?=(?:\\\\left)?\\()`, 'g')] as const)

export function parseLatex(latex: string): Json {
  const hit = parseCache.get(latex)
  if (hit !== undefined) return hit
  ce ??= new ComputeEngine()
  let json: Json
  try {
    // MathLive writes named functions as \operatorname{\mathrm{name}}
    let joined = latex.replace(/\\operatorname\{\\mathrm\{([a-zA-Z]+)\}\}/g, '\\operatorname{$1}')
    for (const [w, re] of SPLIT_WORDS) joined = joined.replace(re, w)
    const prepared = joined.replace(WORD_RE, '\\operatorname{$1}').replace(/\\operatorname\{stdev\}/g, '\\operatorname{stddev}')
    json = latex.trim() ? ce.parse(prepared, { form: 'raw' }).json : null
  } catch {
    json = ['Error']
  }
  if (parseCache.size > 2000) parseCache.clear()
  parseCache.set(latex, json)
  return json
}

export interface Regression {
  params: Record<string, number>
  r2: number
}

export interface Item {
  expr: GraphExpr
  analysis: Analysis
  error?: string
  /** Undefined variables the user could add sliders for */
  missing: string[]
  /** Result shown under value / constant rows */
  value?: number
  // Compiled pieces (present when the row is plottable and error-free)
  f?: Fn
  g?: Fn
  /** Inequality / implicit: lhs - rhs as a function of [x, y] */
  diff?: Fn
  /** Points: compiled coordinate pairs */
  pts?: [Fn, Fn][]
  /** Named point / geometry: point-valued functions */
  points?: (() => Pt)[]
  /** Geometry: numeric arguments (radius, x for tangent) */
  nums?: Fn[]
  /** Tangent: the function and its name */
  fnName?: string
  /** Regression result */
  regression?: Regression
  /** Table: one point list per y column */
  tablePoints?: { color: string; pts: Pt[]; column: string }[]
  /** Name a point row defines (A = (1, 2)) */
  name?: string
}

export interface Evaluation {
  scope: Scope
  items: Item[]
}

const MAX_DEPTH = 64

/** Symbol a table column header stands for, e.g. "x_1" or "x_{1}" → x_1 */
export function columnSymbol(header: string): string | null {
  const j = parseLatex(header)
  return typeof j === 'string' ? j : null
}

export function evaluate(exprs: GraphExpr[], degrees: boolean, previous?: Scope): Evaluation {
  const scope: Scope = previous ?? newScope(degrees)
  scope.values.clear()
  scope.fns.clear()
  scope.points.clear()
  scope.lists.clear()
  scope.degrees = degrees

  const items: Item[] = exprs.map((expr) => {
    if (expr.table) return { expr, analysis: { kind: 'table' }, missing: [] }
    return { expr, analysis: analyze(parseLatex(expr.latex)), missing: [] }
  })

  // 1. Names defined more than once / reserved
  const definedBy = new Map<string, Item>()
  const define = (name: string, it: Item) => {
    if (RESERVED.has(name)) it.error = `“${pretty(name)}” is a graphing variable`
    else if (definedBy.has(name) && definedBy.get(name) !== it) it.error = `“${pretty(name)}” is defined more than once`
    else definedBy.set(name, it)
  }
  for (const it of items) {
    const a = it.analysis
    if (a.kind === 'slider' || a.kind === 'constant' || a.kind === 'function' || a.kind === 'namedPoint' || a.kind === 'list') define(a.name, it)
    if (a.kind === 'table') for (const col of it.expr.table!.columns) {
      const sym = columnSymbol(col.name)
      if (sym) define(sym, it)
      else it.error = `Column name “${col.name}” isn’t a variable name (try x_1)`
    }
  }

  // 2. Sliders and user functions (functions resolve their body lazily)
  for (const it of items) {
    if (it.error) continue
    const a = it.analysis
    if (a.kind === 'slider') scope.values.set(a.name, a.value)
    if (a.kind === 'function') {
      let depth = 0
      let body: Fn | null = null
      scope.fns.set(a.name, (...args: number[]) => {
        body ??= compile(a.body, a.params, scope)
        if (++depth > MAX_DEPTH) {
          depth = 0
          throw new GraphError(`“${pretty(a.name)}” refers to itself`)
        }
        try {
          return body(args)
        } finally {
          depth--
        }
      })
    }
  }

  // 3. Tables and list literals
  for (const it of items) {
    if (it.error) continue
    const a = it.analysis
    if (a.kind === 'table') {
      const cols = it.expr.table!.columns
      const nums = cols.map((c) => c.values.map((v) => (v.trim() === '' ? NaN : Number(v.replace('−', '-')))))
      cols.forEach((c, i) => {
        const sym = columnSymbol(c.name)
        if (sym) scope.lists.set(sym, nums[i].filter((v) => Number.isFinite(v)))
      })
      const xs = nums[0] ?? []
      it.tablePoints = cols.slice(1).map((c, k) => ({
        column: c.name,
        color: c.color ?? it.expr.color,
        pts: c.hidden ? [] : xs.map((x, i) => [x, nums[k + 1][i]] as Pt).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
      }))
    }
    if (a.kind === 'list') {
      try {
        scope.lists.set(a.name, compileList(a.items, [], scope)([]))
      } catch (e) {
        it.error = e instanceof Error ? e.message : String(e)
      }
    }
  }

  // 4. Named points (lazy, so they follow sliders and constants)
  for (const it of items) {
    if (it.error) continue
    const a = it.analysis
    if (a.kind !== 'namedPoint') continue
    let f: ((args: number[]) => Pt) | null = null
    let depth = 0
    scope.points.set(a.name, () => {
      f ??= compilePoint(a.point, [], scope)
      if (++depth > MAX_DEPTH) {
        depth = 0
        throw new GraphError(`“${pretty(a.name)}” refers to itself`)
      }
      try {
        return f([])
      } finally {
        depth--
      }
    })
    it.name = a.name
  }

  // 5. Regressions (their fitted parameters become usable everywhere)
  for (const it of items) {
    if (it.error || it.analysis.kind !== 'regression') continue
    try {
      fitRegression(it, scope, definedBy)
    } catch (e) {
      it.error = e instanceof Error ? e.message : String(e)
    }
  }

  // 6. Constants in dependency order (b = 2a, c = b + 1, ...)
  const pending = items.filter((it) => !it.error && it.analysis.kind === 'constant')
  for (let pass = 0; pass < pending.length + 1 && pending.length; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const it = pending[i]
      const a = it.analysis as Extract<Analysis, { kind: 'constant' }>
      const deps = [...freeSymbols(a)].filter((s) => !s.endsWith('()'))
      if (deps.some((d) => !scope.values.has(d) && d !== a.name && definedBy.has(d) && definedBy.get(d)!.analysis.kind === 'constant')) continue
      try {
        const v = compile(a.body, [], scope)([])
        scope.values.set(a.name, v)
        it.value = v
      } catch (e) {
        it.error = e instanceof Error ? e.message : String(e)
      }
      pending.splice(i, 1)
    }
  }
  for (const it of pending) it.error = 'These definitions depend on each other'

  // 7. Undefined symbols → "add slider" suggestions
  for (const it of items) {
    const a = it.analysis
    if (it.error || a.kind === 'error' || a.kind === 'empty' || a.kind === 'table' || a.kind === 'regression') continue
    const missing: string[] = []
    for (const s of freeSymbols(a)) {
      if (s.endsWith('()')) {
        const fname = s.slice(0, -2)
        if (!scope.fns.has(fname) && !scope.values.has(fname) && !['midpoint'].includes(fname)) missing.push(fname)
        continue
      }
      if (RESERVED.has(s)) continue
      if ((a.kind === 'slider' || a.kind === 'constant' || a.kind === 'namedPoint' || a.kind === 'list') && s === a.name) continue
      if (!scope.values.has(s) && !scope.points.has(s) && !scope.lists.has(s) && !scope.fns.has(s)) missing.push(s)
    }
    it.missing = [...new Set(missing)]
    if (it.missing.length) it.error = `${it.missing.map((m) => `“${pretty(m)}”`).join(', ')} ${it.missing.length > 1 ? 'are' : 'is'} not defined`
  }

  // 8. Compile plottables
  for (const it of items) {
    const a = it.analysis
    if (a.kind === 'error') it.error ??= a.message
    if (it.error) continue
    try {
      switch (a.kind) {
        case 'graphY':
          it.f = compile(a.body, ['x'], scope)
          break
        case 'graphX':
          it.f = compile(a.body, ['y'], scope)
          break
        case 'polar':
          it.f = compile(a.body, ['theta'], scope)
          break
        case 'function':
          if (a.plot) it.f = compile(a.body, a.params, scope)
          break
        case 'parametric':
          it.f = compile(a.xs, ['t'], scope)
          it.g = compile(a.ys, ['t'], scope)
          break
        case 'implicit':
        case 'inequality': {
          const l = compile(a.lhs, ['x', 'y'], scope)
          const r = compile(a.rhs, ['x', 'y'], scope)
          it.diff = (v) => l(v) - r(v)
          if (a.kind === 'inequality' && a.lhs === 'y' && !symbols(a.rhs).has('y')) it.f = compile(a.rhs, ['x'], scope)
          if (a.kind === 'inequality' && a.rhs === 'y' && !symbols(a.lhs).has('y')) it.f = compile(a.lhs, ['x'], scope)
          break
        }
        case 'point':
          it.pts = [[compile(a.xs, [], scope), compile(a.ys, [], scope)]]
          it.pts[0][0]([])
          it.pts[0][1]([])
          break
        case 'points':
          it.pts = a.pts.map(([p, q]) => [compile(p, [], scope), compile(q, [], scope)] as [Fn, Fn])
          break
        case 'namedPoint':
          it.points = [scope.points.get(a.name)!]
          it.points[0]()
          break
        case 'value':
          it.value = compile(a.body, [], scope)([])
          break
        case 'geometry':
          compileGeometry(it, a, scope)
          break
      }
    } catch (e) {
      it.error = e instanceof Error ? e.message : String(e)
    }
  }

  return { scope, items }
}

function compileGeometry(it: Item, a: Extract<Analysis, { kind: 'geometry' }>, scope: Scope) {
  const P = (j: Json) => {
    const f = compilePoint(j, [], scope)
    return () => f([])
  }
  switch (a.shape) {
    case 'segment':
    case 'line':
    case 'ray':
      if (a.args.length !== 2) throw new GraphError(`${a.shape} needs two points, like ${a.shape}(A, B)`)
      it.points = a.args.map(P)
      break
    case 'polygon':
      if (a.args.length < 3) throw new GraphError('polygon needs at least three points')
      it.points = a.args.map(P)
      break
    case 'circle': {
      if (a.args.length !== 2) throw new GraphError('circle needs a centre and a radius (or a point on it)')
      it.points = [P(a.args[0])]
      try {
        it.points.push(P(a.args[1]))
        it.points[1]()
      } catch {
        it.points = [P(a.args[0])]
        it.nums = [compile(a.args[1], [], scope)]
      }
      break
    }
    case 'tangent': {
      const [fj, xj] = a.args
      if (typeof fj !== 'string' || !scope.fns.has(fj) || xj === undefined) throw new GraphError('tangent needs a function and an x, like tangent(f, 2)')
      it.fnName = fj
      it.nums = [compile(xj, [], scope)]
      break
    }
  }
  it.points?.forEach((p) => p())
}

/**
 * Least-squares fit of `lhs ~ rhs`: the list on the left is the data, the one
 * list on the right is the input, and the other unknowns are parameters
 * (Levenberg–Marquardt with a numerical Jacobian).
 */
function fitRegression(it: Item, scope: Scope, definedBy: Map<string, Item>) {
  const a = it.analysis as Extract<Analysis, { kind: 'regression' }>
  const ys = scope.lists.get(a.lhs)
  if (!ys) throw new GraphError(`“${pretty(a.lhs)}” should be a list or table column`)
  const syms = [...symbols(a.rhs)].filter((s) => !s.endsWith('()'))
  const inputs = syms.filter((s) => scope.lists.has(s))
  if (inputs.length !== 1) throw new GraphError('Use one table column on the right, e.g. y_1 ~ m x_1 + b')
  const xsym = inputs[0]
  const xs = scope.lists.get(xsym)!
  const params = syms.filter((s) => s !== xsym && !scope.values.has(s) && !RESERVED.has(s) && !definedBy.has(s))
  const n = Math.min(xs.length, ys.length)
  if (n < Math.max(2, params.length)) throw new GraphError('Not enough data points to fit')

  // Model is compiled with the parameters and the input as positional arguments.
  const model = compile(a.rhs, [...params, xsym], scope)
  let p = params.map(() => 1)
  const residuals = (q: number[]) => {
    const r: number[] = []
    for (let i = 0; i < n; i++) r.push(model([...q, xs[i]]) - ys[i])
    return r
  }
  const sse = (q: number[]) => residuals(q).reduce((s, v) => s + v * v, 0)
  let lambda = 1e-3
  let err = sse(p)
  for (let iter = 0; iter < 200 && params.length; iter++) {
    const r = residuals(p)
    // Jacobian J (n × k)
    const J = p.map((_, k) => {
      const h = 1e-6 * Math.max(1, Math.abs(p[k]))
      const q = [...p]
      q[k] += h
      const rq = residuals(q)
      return rq.map((v, i) => (v - r[i]) / h)
    })
    const k = p.length
    const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => J[i].reduce((s, v, t) => s + v * J[j][t], 0)))
    const g = Array.from({ length: k }, (_, i) => J[i].reduce((s, v, t) => s + v * r[t], 0))
    let improved = false
    for (let tries = 0; tries < 10; tries++) {
      const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)))
      const step = solve(M, g.map((v) => -v))
      if (!step) break
      const q = p.map((v, i) => v + step[i])
      const e2 = sse(q)
      if (Number.isFinite(e2) && e2 < err) {
        p = q
        const done = Math.abs(err - e2) < 1e-14 * (1 + err)
        err = e2
        lambda = Math.max(lambda / 10, 1e-12)
        improved = true
        if (done) iter = Infinity
        break
      }
      lambda *= 10
    }
    if (!improved) break
  }
  const mean = ys.slice(0, n).reduce((s, v) => s + v, 0) / n
  const sst = ys.slice(0, n).reduce((s, v) => s + (v - mean) ** 2, 0)
  const result: Record<string, number> = {}
  params.forEach((name, i) => {
    result[name] = p[i]
    scope.values.set(name, p[i])
  })
  it.regression = { params: result, r2: sst > 0 ? 1 - err / sst : 1 }
  // The fitted curve as y = f(x)
  it.f = (args) => model([...p, args[0]])
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (Math.abs(M[piv][c]) < 1e-300) return null
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** Swallow evaluation errors inside plotting loops. */
export function safe(f: Fn, args: number[]): number {
  try {
    const v = f(args)
    return Number.isFinite(v) ? v : NaN
  } catch {
    return NaN
  }
}

export function safePt(f: () => Pt): Pt {
  try {
    const p = f()
    return [Number.isFinite(p[0]) ? p[0] : NaN, Number.isFinite(p[1]) ? p[1] : NaN]
  } catch {
    return [NaN, NaN]
  }
}
