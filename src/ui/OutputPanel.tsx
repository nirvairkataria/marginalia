import { useEffect, useRef } from 'react'
import { clearRuns, restartKernels, setRunnerOpen, useRunner, type Run } from '../runner/runner'

/** Side panel with code-run output. Nothing here is saved into the note. */
export function OutputPanel() {
  const { runs, open, status, busy } = useRunner()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [runs])

  if (!open) return null
  return (
    <aside className="output-panel" aria-label="Code output">
      <header>
        <strong>Output</strong>
        {status && <span className="out-status">{status}</span>}
        <span className="spacer" />
        <button onClick={restartKernels} title="Stop running code and reset Python's variables">
          {busy ? 'Stop' : 'Restart'}
        </button>
        <button onClick={clearRuns}>Clear</button>
        <button className="icon-btn" onClick={() => setRunnerOpen(false)} aria-label="Close output">
          ×
        </button>
      </header>
      <div className="out-list">
        {runs.length === 0 && <p className="out-empty">Press ▶ Run on a Python or JavaScript code block (or Shift+Enter inside it).</p>}
        {runs.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}
        <div ref={endRef} />
      </div>
    </aside>
  )
}

function RunCard({ run }: { run: Run }) {
  const first = run.code.split('\n').find((l) => l.trim()) ?? ''
  const done = run.finishedAt !== undefined
  return (
    <article className="out-run">
      <div className="out-head">
        <span className={`out-lang lang-${run.lang}`}>{run.lang === 'python' ? 'py' : 'js'}</span>
        <code className="out-src">{first}</code>
        <span className="out-time">{done ? `${((run.finishedAt! - run.startedAt) / 1000).toFixed(2)}s` : <span className="spinner" aria-label="Running" />}</span>
      </div>
      {run.outputs.map((o, i) =>
        o.kind === 'image' ? (
          <img key={i} className="out-img" src={`data:image/png;base64,${o.text}`} alt="Plot output" />
        ) : (
          <pre key={i} className={`out-${o.kind}`}>
            {o.text}
          </pre>
        ),
      )}
      {done && run.outputs.length === 0 && <p className="out-none">No output</p>}
    </article>
  )
}
