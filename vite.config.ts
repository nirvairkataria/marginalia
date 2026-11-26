import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed port; a desktop app ships one bundle, so large chunks are fine.
  server: { port: 5173, strictPort: true },
  clearScreen: false,
  build: { chunkSizeWarningLimit: 4000 },
})
