import { Marked, type TokenizerAndRendererExtension } from 'marked'

/**
 * Markdown → editor HTML (which the editor's node types parse), plus helpers
 * for pasting Markdown and math-bearing HTML.
 *
 * Supports CommonMark + GFM (tables, task lists, strikethrough), and math in
 * $…$, $$…$$, \(…\) and \[…\] (the forms ChatGPT and most notes apps use).
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const blockTag = (latex: string) => `<div data-type="block-math" data-latex="${esc(latex.trim())}"></div>\n`
const inlineTag = (latex: string) => `<span data-type="inline-math" data-latex="${esc(latex.trim())}"></span>`

const blockMath: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  start: (src) => {
    const i = src.search(/\$\$|\\\[/)
    return i < 0 ? undefined : i
  },
  tokenizer(src) {
    const m = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/.exec(src)
    if (m) return { type: 'blockMath', raw: m[0], text: m[1] ?? m[2] }
    return undefined
  },
  renderer: (t) => blockTag(t.text as string),
}

const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start: (src) => {
    const i = src.search(/\$|\\\(/)
    return i < 0 ? undefined : i
  },
  tokenizer(src) {
    // $$…$$ used inline, \(…\), and $…$ (not "$5 and $6": no space inside the delimiters, no digit right after)
    const m =
      /^\$\$((?:\\.|[^$])+?)\$\$/.exec(src) ?? /^\\\(([\s\S]+?)\\\)/.exec(src) ?? /^\$(?![\s$])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)/.exec(src)
    if (m) return { type: 'inlineMath', raw: m[0], text: m[1] }
    return undefined
  },
  renderer: (t) => inlineTag(t.text as string),
}

const md = new Marked({ gfm: true, breaks: false })
md.use({ extensions: [blockMath, inlineMath] })

/** Reshape marked's HTML into the structures the editor's nodes parse. */
function adapt(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  // GFM task lists → Tiptap task lists
  for (const ul of doc.querySelectorAll('ul')) {
    const items = [...ul.children].filter((c) => c.tagName === 'LI')
    if (!items.length || !items.every((li) => li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]'))) continue
    ul.setAttribute('data-type', 'taskList')
    for (const li of items) {
      const box = li.querySelector('input[type=checkbox]') as HTMLInputElement
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false')
      box.remove()
      if (!li.querySelector(':scope > p')) {
        const p = doc.createElement('p')
        while (li.firstChild && !(li.firstChild instanceof HTMLUListElement || li.firstChild instanceof HTMLOListElement)) p.appendChild(li.firstChild)
        li.prepend(p)
      }
    }
  }
  // Images are blocks in the editor: lift them out of their paragraphs.
  for (const img of doc.querySelectorAll('p > img')) {
    const p = img.parentElement!
    p.before(img)
    if (!p.textContent?.trim() && !p.querySelector('img')) p.remove()
  }
  return doc.body.innerHTML
}

export function markdownToHtml(markdown: string): string {
  const html = md.parse(markdown.replace(/\r\n?/g, '\n'), { async: false }) as string
  return adapt(html)
}

/** Title from a Markdown document: its first heading, else the given fallback. */
export function markdownTitle(markdown: string, fallback: string): string {
  const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(markdown)
  return (m?.[1] ?? fallback).replace(/[*_`$]/g, '').trim().slice(0, 80) || fallback
}

/** Rough plain text for search, from Markdown. */
export function markdownPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ''))
    .replace(/[#>*_`|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const MD_HINTS = [/^#{1,6}\s+\S/m, /^\s*[-*+]\s+\S/m, /^\s*\d+[.)]\s+\S/m, /^```/m, /\$\$[\s\S]+\$\$/, /\\\[[\s\S]+\\\]/, /\\\(.+?\\\)/, /^\|.+\|\s*$/m, /\*\*[^*]+\*\*/, /^>\s+\S/m, /\[[^\]]+\]\([^)]+\)/]

/** Does pasted plain text look like Markdown worth converting? */
export function looksLikeMarkdown(text: string): boolean {
  let score = 0
  for (const re of MD_HINTS) if (re.test(text)) score++
  return score >= 1 && (text.includes('\n') || score >= 2)
}

/**
 * Pasted HTML from web pages / ChatGPT renders math with KaTeX or MathML but
 * keeps the LaTeX in an annotation: turn those back into editable equations.
 */
export function recoverMathInHtml(html: string): string {
  if (!/katex|<math|application\/x-tex/i.test(html)) return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const latexOf = (el: Element) => el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? null
  for (const el of [...doc.querySelectorAll('.katex-display, math[display="block"]')]) {
    const latex = latexOf(el)
    if (latex === null) continue
    const div = doc.createElement('div')
    div.setAttribute('data-type', 'block-math')
    div.setAttribute('data-latex', latex.trim())
    el.replaceWith(div)
  }
  for (const el of [...doc.querySelectorAll('.katex, math')]) {
    if (!el.isConnected) continue
    const latex = latexOf(el)
    if (latex === null) continue
    const span = doc.createElement('span')
    span.setAttribute('data-type', 'inline-math')
    span.setAttribute('data-latex', latex.trim())
    el.replaceWith(span)
  }
  return doc.body.innerHTML
}
