import 'katex/dist/katex.min.css'
import { MathfieldElement } from 'mathlive'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// MathLive renders with the KaTeX fonts already loaded by katex.min.css.
MathfieldElement.fontsDirectory = null
MathfieldElement.soundsDirectory = null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
