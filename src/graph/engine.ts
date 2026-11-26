import { ComputeEngine } from '@cortex-js/compute-engine'
import { analyze, compile, freeSymbols, GraphError, pretty, RESERVED, type Analysis, type Fn, type Json, type Scope } from './compile'
import type { GraphExpr } from './model'

/**
 * Evaluates a whole expression list: builds the scope (sliders, constants,
 * user functions) in dependency order, then compiles everything plottable.
 */

let ce: ComputeEngine | null = null
const parseCache = new Map<string, Json>()

export function parseLatex(latex: string): Json {
  const hit = parseCache.get(latex)
  if (hit !== undefined) return hit
  ce ??= new ComputeEngine()
  let json: Json
  try {
    json = latex.trim() ? ce.parse(latex, { form: 'raw' }).json : null
  } catch {
    json = ['Error']
  }
  if (parseCache.size > 2000) parseCache.clear()
  parseCache.set(latex, json)
  return json
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
}

export interface Evaluation {
  scope: Scope
  items: Item[]
}

const MAX_DEPTH = 64

export function evaluate(exprs: GraphExpr[], degrees: boolean, previous?: Scope): Evaluation {
  const scope: Scope = previous ?? { values: new Map(), fns: new Map(), degrees }
  scope.values.clear()
  scope.fns.clear()
  scope.degrees = degrees

  const items: Item[] = exprs.map((expr) => {
    const json = parseLatex(expr.latex)
    return { expr, analysis: analyze(json), missing: [] }
  })

  // 1. Names defined more than once
  const definedBy = new Map<string, Item>()
  for (const it of items) {
    const a = it.analysis
    const name = a.kind === 'slider' || a.kind === 'constant' || a.kind === 'function' ? a.name : null
    if (!name) continue
    if (RESERVED.has(name)) {
      it.error = `“${pretty(name)}” is a graphing variable`
      continue
    }
    if (definedBy.has(name)) it.error = `“${pretty(name)}” is defined more than once`
    else definedBy.set(name, it)
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

  // 3. Constants in dependency order (b = 2a, c = b + 1, ...)
  const pending = items.filter((it) => !it.error && it.analysis.kind === 'constant')
  for (let pass = 0; pass < pending.length + 1 && pending.length; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const it = pending[i]
      const a = it.analysis as Extract<Analysis, { kind: 'constant' }>
      const deps = [...freeSymbols(a)].filter((s) => !s.endsWith('()'))
      if (deps.some((d) => !scope.values.has(d) && d !== a.name && definedBy.has(d))) continue
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

  // 4. Undefined symbols → "add slider" suggestions
  for (const it of items) {
    if (it.error || it.analysis.kind === 'error' || it.analysis.kind === 'empty') continue
    const missing: string[] = []
    for (const s of freeSymbols(it.analysis)) {
      if (s.endsWith('()')) {
        const fname = s.slice(0, -2)
        if (!scope.fns.has(fname) && !scope.values.has(fname)) missing.push(fname)
        continue
      }
      if (RESERVED.has(s)) continue
      if (it.analysis.kind === 'slider' || it.analysis.kind === 'constant') if (s === it.analysis.name) continue
      if (!scope.values.has(s)) missing.push(s)
    }
    // Single-letter function names used as f(x) but undefined are usually multiplication; only flag them if not a value either
    it.missing = [...new Set(missing)].filter((m) => !/\(\)$/.test(m))
    if (it.missing.length) it.error = `${it.missing.map((m) => `“${pretty(m)}”`).join(', ')} ${it.missing.length > 1 ? 'are' : 'is'} not defined`
  }

  // 5. Compile plottables
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
          if (a.kind === 'inequality' && a.lhs === 'y' && !freeSymbols({ kind: 'graphY', body: a.rhs }).has('y')) it.f = compile(a.rhs, ['x'], scope)
          if (a.kind === 'inequality' && a.rhs === 'y' && !freeSymbols({ kind: 'graphY', body: a.lhs }).has('y')) it.f = compile(a.lhs, ['x'], scope)
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
        case 'value':
          it.value = compile(a.body, [], scope)([])
          break
      }
    } catch (e) {
      it.error = e instanceof Error ? e.message : String(e)
    }
  }

  return { scope, items }
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
