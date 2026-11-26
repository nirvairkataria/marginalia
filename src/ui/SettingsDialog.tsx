import { useEffect, useRef } from 'react'
import { updateSettings, useSettings, type Settings } from '../lib/settings'

function Choice<K extends keyof Settings>({ name, value, options }: { name: K; value: Settings[K]; options: { value: Settings[K]; label: string }[] }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => updateSettings({ [name]: o.value } as Partial<Settings>)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ name, label, hint }: { name: 'penAlwaysDraws' | 'touchDraws' | 'adaptInkToDark'; label: string; hint: string }) {
  const s = useSettings()
  return (
    <label className="setting-toggle">
      <input type="checkbox" checked={s[name]} onChange={(e) => updateSettings({ [name]: e.target.checked })} />
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </label>
  )
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog ref={ref} className="settings" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="settings-body">
        <header>
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </header>

        <section>
          <h3>Appearance</h3>
          <div className="setting-row">
            <span>Theme</span>
            <Choice name="theme" value={s.theme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </div>
          <Toggle name="adaptInkToDark" label="Adapt ink to dark mode" hint="Dark ink is shown light on dark paper. Your strokes keep their real colours." />
        </section>

        <section>
          <h3>Equations</h3>
          <div className="setting-row">
            <span>Typing style</span>
            <Choice name="mathInput" value={s.mathInput} options={[{ value: 'latex', label: 'LaTeX' }, { value: 'visual', label: 'Visual (Word-style)' }]} />
          </div>
          <p className="setting-hint">
            Visual: type <code>a/b</code>, <code>x^2</code>, <code>sqrt</code>, <code>alpha</code>, <code>int</code> and it turns into maths as you type, like Word. The LaTeX stays one click away. <kbd>Alt</kbd>+<kbd>=</kbd> inserts an equation in either mode.
          </p>
        </section>

        <section>
          <h3>Pen &amp; touch</h3>
          <Toggle name="penAlwaysDraws" label="Pen always draws" hint="Writing with a pen inks even when the text tool is selected. The mouse keeps editing text." />
          <Toggle name="touchDraws" label="Fingers draw" hint="When off, fingers scroll and pinch while an ink tool is selected (recommended with an active pen)." />
          <div className="setting-row">
            <span>Toolbar position</span>
            <Choice name="toolbarPosition" value={s.toolbarPosition} options={[{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
          </div>
        </section>

        <section>
          <h3>Code</h3>
          <p className="setting-hint">
            Python runs on your device in a bundled interpreter (Pyodide). Packages such as numpy, scipy, sympy and matplotlib download once, the first time you import them. JavaScript runs in a sandboxed worker. Output appears in the Output panel and is never saved into the note.
          </p>
        </section>
      </div>
    </dialog>
  )
}
