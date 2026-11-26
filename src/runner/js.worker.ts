/// <reference lib="webworker" />
/** JavaScript runner: each run executes in this worker with console captured. */

const post = (m: unknown) => (self as DedicatedWorkerGlobalScope).postMessage(m)

function format(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2) ?? String(v)
  } catch {
    return String(v)
  }
}

self.onmessage = async (e: MessageEvent<{ id: string; code: string }>) => {
  const { id, code } = e.data
  const out = (stream: 'stdout' | 'stderr') => (...args: unknown[]) =>
    post({ type: 'stream', id, stream, text: args.map(format).join(' ') + '\n' })
  const fakeConsole = { log: out('stdout'), info: out('stdout'), debug: out('stdout'), table: out('stdout'), warn: out('stderr'), error: out('stderr') }
  try {
    const fn = new Function('console', `"use strict";\nreturn (async () => {\n${code}\n})()`)
    const result = await fn(fakeConsole)
    if (result !== undefined) post({ type: 'result', id, text: format(result) })
  } catch (err) {
    post({ type: 'error', id, text: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
  }
  post({ type: 'done', id })
}
