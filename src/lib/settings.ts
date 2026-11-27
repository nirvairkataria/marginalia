import { useSyncExternalStore } from 'react'
import type { ToolPreset } from '../ink/types'

/**
 * App settings, persisted per device in localStorage. (Tool presets could move
 * into a synced Yjs doc later so they follow you between devices.)
 */

export type ThemeSetting = 'system' | 'light' | 'dark'
export type ToolbarPosition = 'top' | 'bottom' | 'left' | 'right'
/** What holding a pen side button does. 'none' leaves it to Windows (right-click). */
export type PenButtonAction = 'eraser' | 'lasso' | 'highlighter' | 'none'

export interface SiteSettings {
  title: string
  /** Where published pages go */
  target: 'github' | 'folder'
  /** GitHub: owner/name */
  repo: string
  branch: string
  /** Public address of the site, e.g. https://you.github.io/notes/ */
  baseUrl: string
  /** Desktop: folder to write the site into */
  folder?: string
}

export interface Settings {
  theme: ThemeSetting
  /** 'latex': raw LaTeX box front and centre. 'visual': Word-style typing, LaTeX hidden. */
  mathInput: 'latex' | 'visual'
  /** A pen touching the page always draws, even when the text tool is selected. */
  penAlwaysDraws: boolean
  /** Fingers draw (instead of scrolling) while an ink tool is selected. */
  touchDraws: boolean
  /** Invert ink lightness in dark mode so black ink stays readable. */
  adaptInkToDark: boolean
  toolbarPosition: ToolbarPosition
  /** Main (lower) side button */
  penButton1: PenButtonAction
  /** Second (upper) side button, on pens that have one */
  penButton2: PenButtonAction
  tools: ToolPreset[]
  site: SiteSettings
  /** null = text tool */
  activeToolId: string | null
  /** Tool used when a pen touches down while the text tool is active */
  lastInkToolId: string | null
}

const preset = (p: Partial<ToolPreset> & Pick<ToolPreset, 'id' | 'kind' | 'name'>): ToolPreset => ({
  color: '#1d232b',
  width: 2.5,
  opacity: 1,
  penType: 'ballpoint',
  pressure: true,
  eraserMode: 'stroke',
  ...p,
})

export const DEFAULT_TOOLS: ToolPreset[] = [
  preset({ id: 'pen-black', kind: 'pen', name: 'Ballpoint', color: '#1d232b', width: 2.5 }),
  preset({ id: 'pen-blue', kind: 'pen', name: 'Fountain', color: '#1f5fbf', width: 3, penType: 'fountain' }),
  preset({ id: 'pen-red', kind: 'pen', name: 'Red pen', color: '#d0312d', width: 2.5 }),
  preset({ id: 'hl-yellow', kind: 'highlighter', name: 'Highlighter', color: '#ffd400', width: 18, opacity: 0.4, penType: 'marker', pressure: false }),
  preset({ id: 'eraser', kind: 'eraser', name: 'Eraser', width: 16, eraserMode: 'stroke' }),
  preset({ id: 'lasso', kind: 'lasso', name: 'Lasso' }),
]

const DEFAULTS: Settings = {
  theme: 'system',
  mathInput: 'latex',
  penAlwaysDraws: true,
  touchDraws: false,
  adaptInkToDark: true,
  toolbarPosition: 'top',
  penButton1: 'eraser',
  penButton2: 'lasso',
  tools: DEFAULT_TOOLS,
  site: { title: 'My notes', target: 'github', repo: '', branch: 'main', baseUrl: '' },
  activeToolId: null,
  lastInkToolId: 'pen-black',
}

const KEY = 'marginalia:settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* unavailable or corrupt: use defaults */
  }
  return DEFAULTS
}

let current = load()
const listeners = new Set<() => void>()

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) {
  const p = typeof patch === 'function' ? patch(current) : patch
  current = { ...current, ...p }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* not persisted this time */
  }
  applyTheme()
  listeners.forEach((l) => l())
}

export function subscribeSettings(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings)
}

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function isDark(): boolean {
  if (current.theme === 'system') return darkQuery?.matches ?? false
  return current.theme === 'dark'
}

function applyTheme() {
  const root = document.documentElement
  if (current.theme === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = current.theme
}

applyTheme()
darkQuery?.addEventListener('change', () => listeners.forEach((l) => l()))

export function activeTool(s: Settings = current): ToolPreset | null {
  return s.tools.find((t) => t.id === s.activeToolId) ?? null
}

export function newToolId() {
  return `tool-${crypto.randomUUID().slice(0, 8)}`
}
