import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Ships the Pyodide Python interpreter with the app (served at /pyodide/), so
 * running Python code blocks works offline.
 */
const PYODIDE_FILES: Record<string, string> = {
  'pyodide.mjs': 'text/javascript',
  'pyodide.asm.mjs': 'text/javascript',
  'pyodide.asm.wasm': 'application/wasm',
  'python_stdlib.zip': 'application/zip',
  'pyodide-lock.json': 'application/json',
}

function pyodideAssets(): Plugin {
  const dir = path.resolve(__dirname, 'node_modules/pyodide')
  return {
    name: 'marginalia-pyodide-assets',
    configureServer(server) {
      server.middlewares.use('/pyodide', (req, res, next) => {
        const file = (req.url ?? '').split('?')[0].replace(/^\//, '')
        const type = PYODIDE_FILES[file]
        if (!type) return next()
        res.setHeader('Content-Type', type)
        fs.createReadStream(path.join(dir, file)).pipe(res)
      })
    },
    generateBundle() {
      for (const file of Object.keys(PYODIDE_FILES)) {
        this.emitFile({ type: 'asset', fileName: `pyodide/${file}`, source: fs.readFileSync(path.join(dir, file)) })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pyodideAssets()],
  // Tauri expects a fixed port; a desktop app ships one bundle, so large chunks are fine.
  server: { port: 5173, strictPort: true },
  clearScreen: false,
  build: { chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
})
