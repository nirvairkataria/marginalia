/// <reference lib="webworker" />
/**
 * Python kernel: Pyodide (CPython compiled to WebAssembly) in a worker, so a
 * long computation never freezes the editor. Globals persist between runs,
 * like a Jupyter kernel, until the kernel is restarted.
 */

type Out =
  | { type: 'status'; text: string }
  | { type: 'stream'; id: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'image'; id: string; data: string }
  | { type: 'result'; id: string; text: string }
  | { type: 'error'; id: string; text: string }
  | { type: 'done'; id: string }

const post = (m: Out) => (self as DedicatedWorkerGlobalScope).postMessage(m)

// matplotlib backend that sends figures to the output panel on plt.show().
const BACKEND = `
from matplotlib.backends.backend_agg import FigureCanvasAgg as FigureCanvas, FigureManagerBase as FigureManager
def show(*args, **kwargs):
    import _marginalia
    _marginalia.flush_figures()
`

const SETUP = `
import sys, io, os, base64, types
os.environ["MPLBACKEND"] = "module://marginalia_backend"
_m = types.ModuleType("_marginalia")
def _flush_figures():
    if "matplotlib.pyplot" not in sys.modules:
        return
    import matplotlib.pyplot as plt
    for num in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(num).savefig(buf, format="png", bbox_inches="tight", dpi=110)
        _marginalia_post_image(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
_m.flush_figures = _flush_figures
sys.modules["_marginalia"] = _m
`

let currentId = ''
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodide: Promise<any> | null = null

function load(indexURL: string) {
  pyodide ??= (async () => {
    post({ type: 'status', text: 'Starting Python…' })
    const mod = await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)
    const py = await mod.loadPyodide({
      indexURL,
      // The interpreter ships with the app; extra packages (numpy, matplotlib, …)
      // download from the Pyodide CDN the first time they are imported.
      packageBaseUrl: `https://cdn.jsdelivr.net/pyodide/v${mod.version}/full/`,
    })
    py.setStdout({ batched: (text: string) => post({ type: 'stream', id: currentId, stream: 'stdout', text: text + '\n' }) })
    py.setStderr({ batched: (text: string) => post({ type: 'stream', id: currentId, stream: 'stderr', text: text + '\n' }) })
    py.globals.set('_marginalia_post_image', (data: string) => post({ type: 'image', id: currentId, data }))
    py.FS.writeFile('/home/pyodide/marginalia_backend.py', BACKEND)
    await py.runPythonAsync(SETUP)
    post({ type: 'status', text: '' })
    return py
  })()
  return pyodide
}

self.onmessage = async (e: MessageEvent<{ id: string; code: string; indexURL: string }>) => {
  const { id, code, indexURL } = e.data
  currentId = id
  try {
    const py = await load(indexURL)
    await py.loadPackagesFromImports(code, {
      messageCallback: (msg: string) => post({ type: 'status', text: msg }),
      errorCallback: (msg: string) => post({ type: 'stream', id, stream: 'stderr', text: msg + '\n' }),
    })
    post({ type: 'status', text: '' })
    const result = await py.runPythonAsync(code, { filename: '<cell>' })
    await py.runPythonAsync('import _marginalia; _marginalia.flush_figures()')
    if (result !== undefined && result !== null) {
      const repr = py.globals.get('repr')
      post({ type: 'result', id, text: String(repr(result)) })
      repr.destroy?.()
      result.destroy?.()
    }
  } catch (err) {
    post({ type: 'error', id, text: err instanceof Error ? err.message : String(err) })
  }
  post({ type: 'done', id })
}
