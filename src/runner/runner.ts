import { useSyncExternalStore } from 'react'

/**
 * Runs code blocks and collects their output for the Output panel.
 * Output is never written into the note.
 */

export type RunLang = 'python' | 'javascript'

export interface RunOutput {
  kind: 'stdout' | 'stderr' | 'image' | 'result' | 'error'
  text: string
}

export interface Run {
  id: string
  lang: RunLang
  code: string
  startedAt: number
  finishedAt?: number
  outputs: RunOutput[]
}

interface RunnerState {
  runs: Run[]
  open: boolean
  status: string
  busy: boolean
}

const LANG_ALIASES: Record<string, RunLang> = {
  python: 'python',
  py: 'python',
  python3: 'python',
  javascript: 'javascript',
  js: 'javascript',
  node: 'javascript',
}

export function runnableLang(lang: string | null | undefined): RunLang | null {
  return lang ? (LANG_ALIASES[lang.toLowerCase()] ?? null) : null
}

let state: RunnerState = { runs: [], open: false, status: '', busy: false }
const listeners = new Set<() => void>()

function set(patch: Partial<RunnerState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function updateRun(id: string, fn: (r: Run) => Run) {
  set({ runs: state.runs.map((r) => (r.id === id ? fn(r) : r)) })
}

export function useRunner(): RunnerState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

const workers: Partial<Record<RunLang, Worker>> = {}
const queue: { run: Run }[] = []
let running: Run | null = null

function workerFor(lang: RunLang): Worker {
  let w = workers[lang]
  if (w) return w
  w =
    lang === 'python'
      ? new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('./js.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e) => handle(e.data)
  w.onerror = (e) => {
    if (running) {
      const id = running.id
      updateRun(id, (r) => ({ ...r, outputs: [...r.outputs, { kind: 'error', text: e.message || 'Worker crashed' }] }))
      handle({ type: 'done', id })
    }
  }
  workers[lang] = w
  return w
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handle(m: any) {
  if (m.type === 'status') {
    set({ status: m.text })
    return
  }
  const id: string = m.id
  if (m.type === 'done') {
    updateRun(id, (r) => ({ ...r, finishedAt: Date.now() }))
    running = null
    set({ busy: false, status: '' })
    next()
    return
  }
  const kind = m.type === 'stream' ? m.stream : m.type
  const text: string = m.type === 'image' ? m.data : m.text
  updateRun(id, (r) => {
    const outputs = [...r.outputs]
    const last = outputs[outputs.length - 1]
    if (last && last.kind === kind && (kind === 'stdout' || kind === 'stderr')) outputs[outputs.length - 1] = { kind, text: last.text + text }
    else outputs.push({ kind, text })
    return { ...r, outputs }
  })
}

function next() {
  if (running) return
  const item = queue.shift()
  if (!item) return
  running = item.run
  set({ busy: true })
  const indexURL = new URL(`${import.meta.env.BASE_URL}pyodide/`, location.href).href
  workerFor(item.run.lang).postMessage({ id: item.run.id, code: item.run.code, indexURL })
}

export function runCode(lang: RunLang, code: string) {
  const run: Run = { id: crypto.randomUUID(), lang, code, startedAt: Date.now(), outputs: [] }
  set({ runs: [...state.runs, run].slice(-50), open: true })
  queue.push({ run })
  next()
}

/** Stop whatever is running and reset both kernels (Python globals are lost). */
export function restartKernels() {
  for (const lang of Object.keys(workers) as RunLang[]) {
    workers[lang]?.terminate()
    delete workers[lang]
  }
  if (running) {
    const id = running.id
    updateRun(id, (r) => ({ ...r, finishedAt: Date.now(), outputs: [...r.outputs, { kind: 'error', text: 'Stopped.' }] }))
  }
  for (const q of queue.splice(0)) updateRun(q.run.id, (r) => ({ ...r, finishedAt: Date.now(), outputs: [{ kind: 'error', text: 'Cancelled.' }] }))
  running = null
  set({ busy: false, status: '' })
}

export function clearRuns() {
  set({ runs: state.runs.filter((r) => !r.finishedAt) })
}

export function setRunnerOpen(open: boolean) {
  set({ open })
}
