import type { ToolKind } from '../ink/types'

/** Small inline icons (24px grid, currentColor strokes). */

const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export const TextIcon = () => (
  <svg {...base}>
    <path d="M9 4h6M9 20h6M12 4v16" />
  </svg>
)

export function ToolIcon({ kind, color }: { kind: ToolKind; color?: string }) {
  if (kind === 'pen')
    return (
      <svg {...base}>
        <path d="M14.5 4.5l5 5L9 20H4v-5z" />
        <path d="M4 20l5-5" stroke={color} strokeWidth={3} />
        <circle cx="16" cy="8" r="1.6" fill={color} stroke="none" />
      </svg>
    )
  if (kind === 'highlighter')
    return (
      <svg {...base}>
        <path d="M15 4l5 5-8 8H8v-4z" />
        <path d="M8 17l-3 3h5" />
        <rect x="3" y="20" width="18" height="2.4" rx="1" fill={color} stroke="none" opacity={0.85} />
      </svg>
    )
  if (kind === 'eraser')
    return (
      <svg {...base}>
        <path d="M8.5 19.5L3.8 14.8a1.8 1.8 0 010-2.5L12.3 3.8a1.8 1.8 0 012.5 0l5.4 5.4a1.8 1.8 0 010 2.5L12.4 19.5z" />
        <path d="M8 10l6.5 6.5M12.4 19.5H20" />
      </svg>
    )
  return (
    <svg {...base}>
      <path d="M12 4c4.4 0 8 2.2 8 5s-3.6 5-8 5-8-2.2-8-5 3.6-5 8-5z" strokeDasharray="2.5 2.5" />
      <path d="M7 13c-1 2 0 4 1.5 4.5S11 19 10 21" />
    </svg>
  )
}

export const UndoIcon = () => (
  <svg {...base}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 010 12h-3" />
  </svg>
)

export const RedoIcon = () => (
  <svg {...base}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 000 12h3" />
  </svg>
)

export const PlusIcon = () => (
  <svg {...base}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const CanvasIcon = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 15c2-3 3.5-3 5-1s3 2 5-2" />
  </svg>
)

export const GearIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </svg>
)

export const TerminalIcon = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9l3 3-3 3M12 15h5" />
  </svg>
)
