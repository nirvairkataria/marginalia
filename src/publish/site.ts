import katexPkg from 'katex/package.json'
import { snapshotPage } from '../export/print'
import type { NoteMeta } from '../lib/notes'
import type { SiteSettings } from '../lib/settings'
import type * as Y from 'yjs'

/**
 * Static website generation. A published note is a snapshot of exactly what
 * you see (typeset maths, highlighted code, graphs, ink), written as plain
 * HTML + images, so any static host can serve it with no build step:
 *
 *   index.html                    home page: published notes grouped by folder (course)
 *   assets/marginalia.css         the app's styles
 *   notes/<slug>/index.html       one page per note
 *   notes/<slug>/*.png|svg|…      its drawings, slides and images
 */

export interface SiteFile {
  path: string
  data: Uint8Array | string
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function slugify(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || 'note'
}

export function uniqueSlug(title: string, taken: Set<string>): string {
  const base = slugify(title)
  let slug = base
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
  return slug
}

const KATEX_CDN = `https://cdn.jsdelivr.net/npm/katex@${katexPkg.version}/dist`

/** The app's CSS (including CodeMirror's generated classes), with KaTeX fonts pointing at a CDN. */
export function collectCss(): string {
  const sheets: CSSStyleSheet[] = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]
  const out: string[] = []
  for (const sheet of sheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin sheet
    }
    for (const r of rules) out.push(r.cssText)
  }
  return out
    .join('\n')
    .replace(/url\(["']?[^)"']*?(KaTeX_[\w-]+\.(?:woff2|woff|ttf))["']?\)/g, `url(${KATEX_CDN}/fonts/$1)`)
    .concat(SITE_CSS)
}

const SITE_CSS = `
/* ---- published site ---- */
body.site { overflow: auto !important; background: var(--desk); margin: 0; }
.site-header { max-width: 816px; margin: 0 auto; padding: 18px 16px 10px; display: flex; gap: 10px; align-items: baseline; font-family: var(--font-ui); }
.site-header a { color: var(--ink); text-decoration: none; font-weight: 650; }
.site-header .crumb { color: var(--ink-faint); font-size: 14px; }
.site-main { padding: 0 8px 64px; }
.site .page { width: 816px; margin: 0 auto; min-height: 0; padding-bottom: 72px; }
.site .graph-mf-host .print-math { padding: 4px 2px; }
.site .cm-gutters { display: none; }
.site .print-anchor { position: relative; }
.site-meta { max-width: 816px; margin: 10px auto 0; padding: 0 16px; color: var(--ink-faint); font: 13px var(--font-ui); }
.site-index { max-width: 760px; margin: 0 auto; padding: 8px 16px 64px; font-family: var(--font-ui); color: var(--ink); }
.site-index h1 { font-size: 30px; margin: 18px 0 4px; }
.site-index h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-faint); margin: 32px 0 8px; }
.site-index a.note { display: block; padding: 12px 14px; margin: 6px 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; color: var(--ink); text-decoration: none; }
.site-index a.note:hover { border-color: var(--accent); }
.site-index a.note strong { display: block; font-size: 16px; }
.site-index a.note span { display: block; color: var(--ink-faint); font-size: 13px; margin-top: 3px; }
`

/** Scales the fixed-width page down on phones. */
const FIT_SCRIPT = `<script>(function(){function f(){var p=document.querySelector('.page');if(p){p.style.zoom=Math.min(1,(window.innerWidth-16)/816)}}addEventListener('resize',f);f()})()</script>`

function shell(opts: { title: string; siteTitle: string; css: string; body: string; root: string; crumb?: string }): string {
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="generator" content="Marginalia">
<link rel="stylesheet" href="${opts.root}${opts.css}">
</head>
<body class="site">
<header class="site-header"><a href="${opts.root}">${esc(opts.siteTitle)}</a>${opts.crumb ? `<span class="crumb">/ ${esc(opts.crumb)}</span>` : ''}</header>
${opts.body}
${FIT_SCRIPT}
</body>
</html>
`
}

async function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array | null> {
  if (!c.width || !c.height) return null
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

/** The files for one published note. */
export async function buildNotePage(page: HTMLElement, doc: Y.Doc, meta: NoteMeta, slug: string, site: SiteSettings): Promise<SiteFile[]> {
  const clone = await snapshotPage(page, doc)
  const files: SiteFile[] = []
  const dir = `notes/${slug}/`

  // Canvas bitmaps (drawings, PDF pages, ink layers) → PNG files
  let n = 0
  for (const c of [...clone.querySelectorAll('canvas')]) {
    const png = await canvasPng(c)
    if (!png) {
      c.remove()
      continue
    }
    const name = `figure-${++n}.png`
    files.push({ path: dir + name, data: png })
    const img = document.createElement('img')
    img.src = name
    img.className = c.className
    img.alt = ''
    img.setAttribute('loading', 'lazy')
    img.style.cssText = c.style.cssText
    c.replaceWith(img)
  }
  // Images stored in the note (blob: URLs) → files
  let m = 0
  for (const img of [...clone.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? ''
    if (!src.startsWith('blob:')) continue
    const blob = await (await fetch(src)).blob()
    const name = `image-${++m}.${EXT[blob.type] ?? 'bin'}`
    files.push({ path: dir + name, data: new Uint8Array(await blob.arrayBuffer()) })
    img.setAttribute('src', name)
  }
  clone.querySelectorAll('.graph-list-head, .graph-add-row, .graph-row-tools, .graph-style, .graph-slider button').forEach((e) => e.remove())
  clone.removeAttribute('style')

  const date = new Date(meta.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const body = `<main class="site-main">${clone.outerHTML}</main>\n<p class="site-meta">${meta.folder ? `${esc(meta.folder)} · ` : ''}Updated ${esc(date)}</p>`
  files.push({ path: dir + 'index.html', data: shell({ title: `${meta.title} · ${site.title}`, siteTitle: site.title, css: 'assets/marginalia.css', body, root: '../../', crumb: meta.folder || undefined }) })
  return files
}

/** Home page listing every published note, grouped by folder. */
export function buildIndex(published: NoteMeta[], site: SiteSettings): SiteFile {
  const groups = new Map<string, NoteMeta[]>()
  for (const n of published) {
    const f = n.folder || 'Notes'
    if (!groups.has(f)) groups.set(f, [])
    groups.get(f)!.push(n)
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(
      ([folder, notes]) =>
        `<h2>${esc(folder)}</h2>\n` +
        notes
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((n) => {
            const blurb = (n.text ?? '').replace(/\s+/g, ' ').replace(n.title, '').trim().slice(0, 160)
            return `<a class="note" href="notes/${n.publish!.slug}/"><strong>${esc(n.title)}</strong><span>${esc(new Date(n.updatedAt).toLocaleDateString())}${blurb ? ` · ${esc(blurb)}…` : ''}</span></a>`
          })
          .join('\n'),
    )
    .join('\n')
  const body = `<main class="site-index"><h1>${esc(site.title)}</h1>${sections || '<p>Nothing published yet.</p>'}</main>`
  return { path: 'index.html', data: shell({ title: site.title, siteTitle: site.title, css: 'assets/marginalia.css', body, root: '' }) }
}
