import type { Editor, JSONContent } from '@tiptap/core'
import { zipSync } from 'fflate'
import type * as Y from 'yjs'
import { getAsset } from '../editor/assets'
import { renderPdfPageCanvas } from '../editor/pdfPage'
import type { GraphState } from '../graph/model'
import { strokeAlpha, strokePath, strokesToSvg } from '../ink/render'
import type { Stroke } from '../ink/types'
import { safeName, saveFile } from './save'

/**
 * Note → Markdown (+ an assets/ folder for images, drawings, graphs and PDF
 * pages). Equations stay LaTeX ($…$ / $$…$$), so the result opens nicely in
 * Obsidian, VS Code, GitHub, Typora, etc.
 */

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif' }

interface Ctx {
  doc: Y.Doc
  editor: Editor
  files: Record<string, Uint8Array>
  n: Record<string, number>
}

const enc = new TextEncoder()

function addFile(ctx: Ctx, kind: string, ext: string, bytes: Uint8Array): string {
  ctx.n[kind] = (ctx.n[kind] ?? 0) + 1
  const path = `assets/${kind}-${ctx.n[kind]}.${ext}`
  ctx.files[path] = bytes
  return path
}

const escapeText = (t: string) => t.replace(/([\\`*_[\]$<])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/gm, '$1\\$2$3')

function inline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'inlineMath') return `$${n.attrs?.latex ?? ''}$`
      if (n.type !== 'text') return ''
      const marks = n.marks ?? []
      const has = (t: string) => marks.some((m) => m.type === t)
      if (has('code')) {
        const t = n.text ?? ''
        const fence = t.includes('`') ? '``' : '`'
        return `${fence}${t}${fence}`
      }
      let t = escapeText(n.text ?? '')
      if (has('bold')) t = `**${t}**`
      if (has('italic')) t = `*${t}*`
      if (has('strike')) t = `~~${t}~~`
      if (has('underline')) t = `<u>${t}</u>`
      const link = marks.find((m) => m.type === 'link')
      if (link) t = `[${t}](${link.attrs?.href ?? ''})`
      return t
    })
    .join('')
}

const indent = (text: string, pad: string) =>
  text
    .split('\n')
    .map((l, i) => (i === 0 || !l ? l : pad + l))
    .join('\n')

async function canvasToPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  return new Uint8Array(await blob!.arrayBuffer())
}

async function block(n: JSONContent, ctx: Ctx): Promise<string> {
  const kids = async (list = n.content ?? [], sep = '\n\n') => (await Promise.all(list.map((c) => block(c, ctx)))).filter(Boolean).join(sep)
  const a = n.attrs ?? {}
  switch (n.type) {
    case 'paragraph':
      return inline(n.content)
    case 'heading':
      return `${'#'.repeat(a.level ?? 1)} ${inline(n.content)}`
    case 'blockquote':
      return (await kids())
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n')
    case 'codeBlock':
      return `\`\`\`${a.language ?? ''}\n${(n.content ?? []).map((t) => t.text ?? '').join('')}\n\`\`\``
    case 'blockMath':
      return `$$\n${a.latex ?? ''}\n$$`
    case 'horizontalRule':
      return '---'
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const items: string[] = []
      let i = a.start ?? 1
      for (const item of n.content ?? []) {
        const marker = n.type === 'orderedList' ? `${i++}. ` : n.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : '- '
        const pad = ' '.repeat(n.type === 'taskList' ? 2 : marker.length)
        items.push(marker + indent(await block({ ...item, type: 'listItemBody' }, ctx), pad))
      }
      return items.join('\n')
    }
    case 'listItemBody':
      return (await Promise.all((n.content ?? []).map((c) => block(c, ctx)))).join('\n')
    case 'table': {
      const rows = (n.content ?? []).map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((p) => inline(p.content)).join('<br>').replace(/\|/g, '\\|')))
      if (!rows.length) return ''
      const width = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`
      return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n')
    }
    case 'imageBlock': {
      if (a.asset) {
        const asset = getAsset(ctx.doc, a.asset)
        if (!asset) return ''
        return `![${a.alt ?? ''}](${addFile(ctx, 'image', EXT[asset.type] ?? 'bin', asset.bytes)})`
      }
      return a.src ? `![${a.alt ?? ''}](${a.src})` : ''
    }
    case 'canvasBlock': {
      const strokes = [...ctx.doc.getMap<Stroke>(`ink:${a.id}`).values()]
      if (!strokes.length) return ''
      const el = document.querySelector<HTMLElement>(`[data-bid="${a.bid}"] .canvas-surface`)
      const w = el?.offsetWidth || a.width || 640
      return `![Drawing](${addFile(ctx, 'drawing', 'svg', enc.encode(strokesToSvg(strokes, w, a.height ?? 260, '#ffffff')))})`
    }
    case 'graphBlock': {
      const state = a.state as GraphState | null
      const exprs = (state?.exprs ?? []).filter((e) => e.latex.trim())
      let out = ''
      const svg = document.querySelector(`[data-bid="${a.bid}"] .graph-jxg svg`)
      if (svg) {
        const clone = svg.cloneNode(true) as SVGElement
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        out += `![Graph](${addFile(ctx, 'graph', 'svg', enc.encode(clone.outerHTML))})\n\n`
      }
      return out + exprs.map((e) => `- $${e.latex}$`).join('\n')
    }
    case 'pdfPage': {
      if (!a.asset) return ''
      const el = document.querySelector<HTMLElement>(`[data-bid="${a.bid}"] .pdf-surface`)
      const cssWidth = el?.offsetWidth || 720
      const scale = 2
      const canvas = await renderPdfPageCanvas(ctx.doc, a.asset, a.page, cssWidth, scale)
      const g = canvas.getContext('2d')!
      g.scale(scale, scale)
      for (const s of [...ctx.doc.getMap<Stroke>(`ink:pdf-${a.id}`).values()].sort((x, y) => x.z - y.z)) {
        g.globalAlpha = strokeAlpha(s)
        g.fillStyle = s.color
        g.fill(strokePath(s))
      }
      return `![Page ${a.page}](${addFile(ctx, 'page', 'png', await canvasToPng(canvas))})`
    }
    default:
      return n.content ? kids() : ''
  }
}

export async function noteToMarkdown(editor: Editor, doc: Y.Doc): Promise<{ markdown: string; files: Record<string, Uint8Array> }> {
  const ctx: Ctx = { doc, editor, files: {}, n: {} }
  const parts: string[] = []
  for (const n of editor.getJSON().content ?? []) {
    const md = await block(n, ctx)
    if (md) parts.push(md)
  }
  return { markdown: parts.join('\n\n') + '\n', files: ctx.files }
}

/** Export the open note: a .md file, or a .zip (note + assets/) when it has pictures. */
export async function exportMarkdown(editor: Editor, doc: Y.Doc, title: string): Promise<boolean> {
  const { markdown, files } = await noteToMarkdown(editor, doc)
  const name = safeName(title)
  if (!Object.keys(files).length) return saveFile(`${name}.md`, markdown, { name: 'Markdown', extensions: ['md'] })
  const zip = zipSync({ [`${name}.md`]: enc.encode(markdown), ...files }, { level: 6 })
  return saveFile(`${name}.zip`, zip, { name: 'Zip archive', extensions: ['zip'] })
}
