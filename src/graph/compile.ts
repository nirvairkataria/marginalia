/**
 * Turns Compute Engine MathJSON (non-canonical parse of the LaTeX typed into
 * an expression row) into fast JavaScript closures, and classifies each row
 * the way Desmos does: function graph, slider, point, parametric, polar,
 * implicit curve, inequality, definition, or plain calculation.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any

export type Fn = (args: number[]) => number

export interface Scope {
  values: Map<string, number>
  fns: Map<string, (...args: number[]) => number>
  degrees: boolean
}

export class GraphError extends Error {}

const CONSTANTS: Record<string, number> = {
  Pi: Math.PI,
  pi: Math.PI,
  e: Math.E,
  ExponentialE: Math.E,
  PositiveInfinity: Infinity,
  NegativeInfinity: -Infinity,
  tau: 2 * Math.PI,
}

/** Variables that are never sliders. */
export const RESERVED = new Set(['x', 'y', 't', 'theta', 'r'])

const head = (j: Json): string | null => (Array.isArray(j) ? j[0] : null)
const isSym = (j: Json): j is string => typeof j === 'string'

function num(j: Json): number | null {
  if (typeof j === 'number') return j
  if (j && typeof j === 'object' && !Array.isArray(j) && 'num' in j) return parseFloat(j.num)
  if (Array.isArray(j) && j[0] === 'Rational') return j[1] / j[2]
  if (Array.isArray(j) && j[0] === 'Negate') {
    const n = num(j[1])
    return n === null ? null : -n
  }
  return null
}

/** Strip grouping parentheses. */
function ungroup(j: Json): Json {
  while (head(j) === 'Delimiter' && j.length >= 2 && head(j[1]) !== 'Sequence') j = j[1]
  return j
}

/** `f(x, y)` written as InvisibleOperator(f, Delimiter(...)) → { name, args } */
export function asCall(j: Json): { name: string; args: Json[] } | null {
  if (head(j) === 'InvisibleOperator' && j.length === 3 && isSym(j[1]) && head(j[2]) === 'Delimiter') {
    const inner = j[2][1]
    const args = inner === undefined ? [] : head(inner) === 'Sequence' ? inner.slice(1) : [inner]
    return { name: j[1], args }
  }
  return null
}

/** Collect free symbols (excluding bound variables of sums/integrals). */
export function symbols(j: Json, out = new Set<string>(), bound = new Set<string>()): Set<string> {
  if (isSym(j)) {
    if (!bound.has(j) && !(j in CONSTANTS)) out.add(j)
    return out
  }
  if (!Array.isArray(j)) return out
  const h = j[0]
  if ((h === 'Sum' || h === 'Product' || h === 'Integrate') && head(j[2]) === 'Tuple') {
    const v = j[2][1]
    const inner = new Set(bound)
    inner.add(v)
    symbols(j[1], out, inner)
    symbols(j[2][2], out, bound)
    symbols(j[2][3], out, bound)
    return out
  }
  if (h === 'D' || h === 'Delimiter') {
    symbols(j[1], out, bound)
    return out
  }
  const call = asCall(j)
  if (call) {
    out.add(`${call.name}()`)
    call.args.forEach((a) => symbols(a, out, bound))
    return out
  }
  if (h === 'Apply') {
    const f = j[1]
    if (head(f) === 'Derivative' && isSym(f[1])) out.add(`${f[1]}()`)
    j.slice(2).forEach((a: Json) => symbols(a, out, bound))
    return out
  }
  for (let i = 1; i < j.length; i++) symbols(j[i], out, bound)
  return out
}

const fact = (n: number): number => {
  if (n < 0 || !Number.isFinite(n)) return NaN
  if (Number.isInteger(n)) {
    let r = 1
    for (let i = 2; i <= n; i++) r *= i
    return r
  }
  // Lanczos gamma for non-integers
  const g = 7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  const z = n
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x
}

type Unary = (a: number) => number

function trig(scope: Scope, f: Unary): Unary {
  return (a) => f(scope.degrees ? (a * Math.PI) / 180 : a)
}
function arctrig(scope: Scope, f: Unary): Unary {
  return (a) => (scope.degrees ? (f(a) * 180) / Math.PI : f(a))
}

function unaryTable(scope: Scope): Record<string, Unary> {
  return {
    Sin: trig(scope, Math.sin),
    Cos: trig(scope, Math.cos),
    Tan: trig(scope, Math.tan),
    Sec: trig(scope, (a) => 1 / Math.cos(a)),
    Csc: trig(scope, (a) => 1 / Math.sin(a)),
    Cot: trig(scope, (a) => 1 / Math.tan(a)),
    Arcsin: arctrig(scope, Math.asin),
    Arccos: arctrig(scope, Math.acos),
    Arctan: arctrig(scope, Math.atan),
    Arcsec: arctrig(scope, (a) => Math.acos(1 / a)),
    Arccsc: arctrig(scope, (a) => Math.asin(1 / a)),
    Arccot: arctrig(scope, (a) => Math.atan(1 / a)),
    Sinh: Math.sinh,
    Cosh: Math.cosh,
    Tanh: Math.tanh,
    Arsinh: Math.asinh,
    Arcosh: Math.acosh,
    Artanh: Math.atanh,
    Sech: (a) => 1 / Math.cosh(a),
    Csch: (a) => 1 / Math.sinh(a),
    Coth: (a) => 1 / Math.tanh(a),
    Ln: Math.log,
    Log: Math.log10,
    Lg: Math.log10,
    Lb: Math.log2,
    Exp: Math.exp,
    Sqrt: Math.sqrt,
    Abs: Math.abs,
    Floor: Math.floor,
    Ceil: Math.ceil,
    Round: Math.round,
    Sign: Math.sign,
    Factorial: fact,
    Negate: (a) => -a,
    Square: (a) => a * a,
  }
}

const INVERSE: Record<string, string> = { Sin: 'Arcsin', Cos: 'Arccos', Tan: 'Arctan', Sinh: 'Arsinh', Cosh: 'Arcosh', Tanh: 'Artanh' }

/**
 * Compile MathJSON to a closure over `params` (positional arguments).
 * Other symbols are looked up in the scope at call time, so slider changes
 * take effect without recompiling.
 */
/** Params with `v` appended as a new innermost variable (shadowing an outer one). */
const bind = (ps: string[], v: string) => [...ps.map((p) => (p === v ? '\u0000' : p)), v]

export function compile(j: Json, params: string[], scope: Scope): Fn {
  const UN = unaryTable(scope)

  const c = (node: Json, ps: string[]): Fn => {
    const n = num(node)
    if (n !== null) return () => n
    if (isSym(node)) {
      const i = ps.indexOf(node)
      if (i >= 0) return (a) => a[i]
      if (node in CONSTANTS && !scope.values.has(node)) {
        const v = CONSTANTS[node]
        return () => v
      }
      return () => {
        const v = scope.values.get(node)
        if (v === undefined) throw new GraphError(`“${pretty(node)}” is not defined`)
        return v
      }
    }
    if (!Array.isArray(node)) throw new GraphError('Unsupported expression')

    const h = node[0]
    const args: Json[] = node.slice(1)

    if (h === 'Delimiter') {
      if (head(args[0]) === 'Sequence') throw new GraphError('A point can’t be used as a number here')
      return c(args[0], ps)
    }

    const call = asCall(node)
    if (call) {
      const argFns = call.args.map((a) => c(a, ps))
      const name = call.name
      return (a) => {
        const f = scope.fns.get(name)
        if (f) return f(...argFns.map((g) => g(a)))
        // Not a function: implicit multiplication like a(x+1)
        const v = scope.values.get(name) ?? CONSTANTS[name]
        if (v === undefined) throw new GraphError(`“${pretty(name)}” is not defined`)
        if (argFns.length !== 1) throw new GraphError(`“${pretty(name)}” is not a function`)
        return v * argFns[0](a)
      }
    }

    const fs = (): Fn[] => args.map((a) => c(a, ps))

    switch (h) {
      case 'Add': {
        const f = fs()
        return (a) => {
          let s = 0
          for (const g of f) s += g(a)
          return s
        }
      }
      case 'Subtract': {
        const [p, q] = fs()
        return (a) => p(a) - q(a)
      }
      case 'Multiply':
      case 'InvisibleOperator': {
        const f = fs()
        return (a) => {
          let s = 1
          for (const g of f) s *= g(a)
          return s
        }
      }
      case 'Divide': {
        const [p, q] = fs()
        return (a) => p(a) / q(a)
      }
      case 'Power': {
        const [p, q] = fs()
        const k = num(args[1])
        if (k === 2) return (a) => {
          const v = p(a)
          return v * v
        }
        return (a) => {
          const base = p(a)
          const e = q(a)
          // Real odd roots of negatives, e.g. x^(1/3)
          if (base < 0 && !Number.isInteger(e)) {
            const inv = 1 / e
            if (Number.isInteger(Math.round(inv)) && Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2 !== 0) return -Math.pow(-base, e)
          }
          return Math.pow(base, e)
        }
      }
      case 'Root': {
        const [p, q] = fs()
        return (a) => {
          const v = p(a)
          const k = q(a)
          return v < 0 && k % 2 === 1 ? -Math.pow(-v, 1 / k) : Math.pow(v, 1 / k)
        }
      }
      case 'Log': {
        if (args.length === 2) {
          const [p, b] = fs()
          return (a) => Math.log(p(a)) / Math.log(b(a))
        }
        break
      }
      case 'Max':
      case 'Min': {
        const f = fs()
        const m = h === 'Max' ? Math.max : Math.min
        return (a) => m(...f.map((g) => g(a)))
      }
      case 'Mod': {
        const [p, q] = fs()
        return (a) => {
          const m = q(a)
          return ((p(a) % m) + m) % m
        }
      }
      case 'When': {
        const [value, cond] = [c(args[0], ps), condition(args[1], ps)]
        return (a) => (cond(a) ? value(a) : NaN)
      }
      case 'Apply': {
        const f = args[0]
        const rest = args.slice(1).map((x: Json) => c(x, ps))
        if (head(f) === 'Derivative' && isSym(f[1])) {
          const name = f[1]
          const order = num(f[2]) ?? 1
          return (a) => {
            const g = scope.fns.get(name)
            if (!g) throw new GraphError(`“${pretty(name)}” is not a function`)
            return derivative((x) => g(x), rest[0](a), order)
          }
        }
        if (head(f) === 'InverseFunction' && isSym(f[1]) && INVERSE[f[1]]) {
          const inv = UN[INVERSE[f[1]]]
          return (a) => inv(rest[0](a))
        }
        throw new GraphError('Unsupported function')
      }
      case 'D': {
        const v = args[1]
        if (!isSym(v)) throw new GraphError('Unsupported derivative')
        const inner = c(args[0], bind(ps, v))
        const outerIndex = ps.indexOf(v)
        return (a) => {
          const at = outerIndex >= 0 ? a[outerIndex] : (scope.values.get(v) ?? NaN)
          return derivative((x) => inner([...a, x]), at, 1)
        }
      }
      case 'Sum':
      case 'Product': {
        const [body, range] = args
        if (head(range) !== 'Tuple') throw new GraphError('Sums need limits')
        const v = range[1]
        const bodyFn = c(body, bind(ps, v))
        const lo = c(range[2], ps)
        const hi = c(range[3], ps)
        return (a) => {
          const from = Math.round(lo(a))
          const to = Math.round(hi(a))
          if (to - from > 100000) return NaN
          let s = h === 'Sum' ? 0 : 1
          for (let k = from; k <= to; k++) s = h === 'Sum' ? s + bodyFn([...a, k]) : s * bodyFn([...a, k])
          return s
        }
      }
      case 'Integrate': {
        const [body, range] = args
        if (head(range) !== 'Tuple' || range.length < 4) throw new GraphError('Integrals need limits, like \\int_0^x')
        const v = range[1]
        const bodyFn = c(body, bind(ps, v))
        const lo = c(range[2], ps)
        const hi = c(range[3], ps)
        return (a) => simpson((t) => bodyFn([...a, t]), lo(a), hi(a))
      }
    }

    const un = UN[h]
    if (un && args.length === 1) {
      const p = c(args[0], ps)
      return (a) => un(p(a))
    }
    throw new GraphError(`Unsupported: ${h}`)
  }

  const condition = (node: Json, ps: string[]): ((a: number[]) => boolean) => {
    const h = head(node)
    if (h === 'And' || h === 'Or') {
      const parts = node.slice(1).map((x: Json) => condition(x, ps))
      return h === 'And' ? (a) => parts.every((p: (a: number[]) => boolean) => p(a)) : (a) => parts.some((p: (a: number[]) => boolean) => p(a))
    }
    const cmp = COMPARE[h ?? '']
    if (cmp) {
      const terms = node.slice(1).map((x: Json) => c(x, ps))
      return (a) => {
        for (let i = 0; i < terms.length - 1; i++) if (!cmp(terms[i](a), terms[i + 1](a))) return false
        return true
      }
    }
    throw new GraphError('Unsupported condition')
  }

  return c(j, params)
}

export const COMPARE: Record<string, (a: number, b: number) => boolean> = {
  Less: (a, b) => a < b,
  LessEqual: (a, b) => a <= b,
  Greater: (a, b) => a > b,
  GreaterEqual: (a, b) => a >= b,
  Equal: (a, b) => Math.abs(a - b) < 1e-9,
}

export function derivative(f: (x: number) => number, x: number, order = 1): number {
  const h = 1e-4 * Math.max(1, Math.abs(x))
  if (order <= 1) return (f(x + h) - f(x - h)) / (2 * h)
  return (derivative(f, x + h, order - 1) - derivative(f, x - h, order - 1)) / (2 * h)
}

function simpson(f: (x: number) => number, a: number, b: number, n = 200): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  const h = (b - a) / n
  let s = f(a) + f(b)
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h)
  return (s * h) / 3
}

export function pretty(name: string): string {
  const greek: Record<string, string> = { theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', lambda: 'λ', mu: 'μ', omega: 'ω', phi: 'φ', sigma: 'σ' }
  return greek[name] ?? name.replace(/_(\w+)/, '₍$1₎').replace('₍', '_').replace('₎', '')
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type Analysis =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'slider'; name: string; value: number }
  | { kind: 'constant'; name: string; body: Json }
  | { kind: 'function'; name: string; params: string[]; body: Json; plot: boolean }
  | { kind: 'graphY'; body: Json } // y = f(x)
  | { kind: 'graphX'; body: Json } // x = g(y)
  | { kind: 'polar'; body: Json } // r = f(θ)
  | { kind: 'implicit'; lhs: Json; rhs: Json }
  | { kind: 'inequality'; op: string; lhs: Json; rhs: Json }
  | { kind: 'point'; xs: Json; ys: Json; dragX?: string; dragY?: string }
  | { kind: 'points'; pts: [Json, Json][] }
  | { kind: 'parametric'; xs: Json; ys: Json }
  | { kind: 'value'; body: Json }

const INEQ = new Set(['Less', 'LessEqual', 'Greater', 'GreaterEqual'])

function tuple(j: Json): [Json, Json] | null {
  if (head(j) === 'Delimiter' && head(j[1]) === 'Sequence' && j[1].length === 3) return [j[1][1], j[1][2]]
  if (head(j) === 'Pair' || (head(j) === 'Tuple' && j.length === 3)) return [j[1], j[2]]
  return null
}

const uses = (j: Json, v: string) => symbols(j).has(v)

export function analyze(j: Json): Analysis {
  if (j === null || j === undefined || (Array.isArray(j) && j[0] === 'Sequence' && j.length === 1)) return { kind: 'empty' }
  if (head(j) === 'Error') return { kind: 'error', message: 'Can’t read this yet' }
  if (hasError(j)) return { kind: 'error', message: 'Can’t read this yet' }

  const h = head(j)
  if (h === 'Equal' && j.length === 3) {
    const lhs = ungroup(j[1])
    const rhs = j[2]
    const call = asCall(lhs)
    if (call && call.args.every(isSym) && !['x', 'y'].includes(call.name)) {
      return { kind: 'function', name: call.name, params: call.args as string[], body: rhs, plot: call.args.length === 1 }
    }
    if (isSym(lhs)) {
      if (lhs === 'y' && !uses(rhs, 'y')) return { kind: 'graphY', body: rhs }
      if (lhs === 'x' && !uses(rhs, 'x')) return { kind: 'graphX', body: rhs }
      if (lhs === 'r' && !uses(rhs, 'x') && !uses(rhs, 'y') && !uses(rhs, 'r')) return { kind: 'polar', body: rhs }
      if (!RESERVED.has(lhs)) {
        if (uses(rhs, 'x') || uses(rhs, 'y')) return { kind: 'error', message: `Define “${pretty(lhs)}” with a number, or graph y = …` }
        const n = num(rhs)
        if (n !== null) return { kind: 'slider', name: lhs, value: n }
        return { kind: 'constant', name: lhs, body: rhs }
      }
    }
    if (isSym(rhs) && rhs === 'y' && !uses(lhs, 'y')) return { kind: 'graphY', body: lhs }
    return { kind: 'implicit', lhs, rhs }
  }
  if (h && INEQ.has(h) && j.length === 3) return { kind: 'inequality', op: h, lhs: j[1], rhs: j[2] }

  if (head(j) === 'Delimiter' && head(j[1]) === 'Sequence') {
    const items = j[1].slice(1).map(tuple)
    if (items.length > 1 && items.every(Boolean)) return { kind: 'points', pts: items as [Json, Json][] }
  }
  const t = tuple(j)
  if (t) {
    if (uses(t[0], 't') || uses(t[1], 't')) return { kind: 'parametric', xs: t[0], ys: t[1] }
    return { kind: 'point', xs: t[0], ys: t[1], dragX: isSym(t[0]) && !RESERVED.has(t[0]) ? t[0] : undefined, dragY: isSym(t[1]) && !RESERVED.has(t[1]) ? t[1] : undefined }
  }
  if (h === 'Sequence' || h === 'List') {
    const pts = j.slice(1).map(tuple)
    if (pts.length && pts.every(Boolean)) return { kind: 'points', pts: pts as [Json, Json][] }
  }
  if (uses(j, 'y')) return { kind: 'error', message: 'Add an = or < to graph an equation in x and y' }
  if (uses(j, 'x')) return { kind: 'graphY', body: j }
  return { kind: 'value', body: j }
}

function hasError(j: Json): boolean {
  if (!Array.isArray(j)) return false
  if (j[0] === 'Error') return true
  return j.some((x, i) => i > 0 && hasError(x))
}

/** Symbols an analysis depends on that aren't variables of the graph itself. */
export function freeSymbols(a: Analysis): Set<string> {
  const s = new Set<string>()
  const add = (j: Json, local: string[] = []) => {
    for (const v of symbols(j)) if (!local.includes(v)) s.add(v)
  }
  switch (a.kind) {
    case 'function':
      add(a.body, a.params)
      break
    case 'constant':
    case 'value':
      add(a.body)
      break
    case 'graphY':
      add(a.body, ['x'])
      break
    case 'graphX':
      add(a.body, ['y'])
      break
    case 'polar':
      add(a.body, ['theta'])
      break
    case 'implicit':
    case 'inequality':
      add(a.lhs, ['x', 'y'])
      add(a.rhs, ['x', 'y'])
      break
    case 'point':
      add(a.xs)
      add(a.ys)
      break
    case 'points':
      a.pts.forEach(([p, q]) => (add(p), add(q)))
      break
    case 'parametric':
      add(a.xs, ['t'])
      add(a.ys, ['t'])
      break
  }
  return s
}
