# Roadmap and design notes

## Graph blocks (Desmos-style)

**Can we use Desmos itself?** Yes for personal, educational, non-commercial use, but with strings attached:

- Production use needs your own API key, requested through Desmos's form (the shared demo key is being retired).
- The calculator loads from desmos.com, so graphs would not work offline and would depend on Desmos keeping that key valid.
- A paid or commercial version of Marginalia would need a licence from Desmos.

**Plan: our own graph block, with an optional Desmos block.**

1. **Graph block (default, built).** Fully offline, free, publishable. Drawing is done by [JSXGraph](https://jsxgraph.org) (MIT/LGPL).
   - Expression list on the left, edited with the same MathLive fields as equations, so `y = \sin(ax)` is typed the same way as anywhere else in a note.
   - Expressions are parsed and compiled with the [Compute Engine](https://cortexjs.io/compute-engine/) (MIT, same authors as MathLive): LaTeX in, fast JavaScript function out.
   - Free parameters (`a`, `b`, …) automatically get sliders, like Desmos.
   - Plotted on a canvas with pan and zoom: explicit `y = f(x)`, `x = f(y)`, parametric curves, points and tables first; implicit equations (`x^2 + y^2 = 1`, via marching squares) and inequalities (shaded regions) next.
   - Stored in the note's Yjs doc like any other block, so it syncs, exports to SVG for PDFs, and stays interactive on the published site.
2. **Desmos block (optional).** If you paste in your own Desmos API key in Settings, a "Desmos" block embeds the real calculator. Clearly marked as online-only.

## Publishing notes as a website

GitHub Pages would actually cope fine with many notes: a static site is just files, and hundreds of pages is small. The real questions are how notes get turned into pages and how they get uploaded. Plan:

```
Marginalia (desktop)                  GitHub                    Host (free)
┌──────────────────────┐   commit   ┌──────────────────┐ build ┌──────────────────────┐
│ Note marked "Publish"│ ─────────▶ │ notes-site repo  │ ────▶ │ Cloudflare Pages     │
│ → export to HTML/MD  │  via API   │ (content + site) │       │ yourname.pages.dev   │
└──────────────────────┘            └──────────────────┘       └──────────────────────┘
```

1. **Opt-in per note.** A note is private until you mark it *Publish*, then pick a course (e.g. `MATH 2410`), tags and a slug.
2. **Export.** The note is rendered to static HTML:
   - Math is pre-rendered with KaTeX, so it needs no JavaScript.
   - Code is syntax-highlighted.
   - Ink becomes SVG laid over the page at the same coordinates. The fixed page width makes this exact.
   - Canvas blocks become SVG images, and graph blocks become small interactive widgets.
3. **Upload.** The app commits the exported files to a separate `notes-site` repo using the GitHub API. The token is stored in the Windows Credential Manager, never in the repo. Publishing again updates the page; un-publishing deletes it.
4. **Build and host.** The repo holds a small static site (Astro): home page, one page per course, a page per note, search, RSS. Cloudflare Pages rebuilds on every push.
   - **Free plan:** unlimited bandwidth, 500 builds/month, 20,000 files per site.
   - **Vercel or GitHub Pages:** both work as drop-in alternatives if you prefer them.

Because publishing is "commit to a repo", you get full history of every published version for free, and the site is portable to any host.

## Phases

1. ✅ Block editor: Markdown shortcuts, LaTeX, code blocks, local persistence
2. ✅ Ink: pens (5 types, pressure on/off), highlighter, stroke/area eraser, lasso, customizable toolbar, canvas blocks with text wrap, page annotations anchored to blocks, dark mode
3. ✅ Run code: Python (bundled Pyodide) and JavaScript, output panel
4. ✅ Graph blocks (built on JSXGraph, see above)
5. ✅ Graph extras: tables and regressions, lists, labels on points, geometry (Desmos block with your own API key still open)
6. ✅ Images, tables (callouts still open)
7. ✅ Export: PDF (paged, with ink), Markdown + LaTeX; import Markdown and PDFs
8. ✅ Publishing pipeline (built: GitHub repo + GitHub/Cloudflare Pages, or a folder; static pages, no build step)
9. ◐ Sync between devices: the library folder (OneDrive etc.) merges edits across computers. Still to do: live sync and a mobile viewer
