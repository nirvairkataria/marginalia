# Marginalia

Scientific and mathematical notes you can **type** *and* **draw** on.

Marginalia combines a structured, StemPad-style note editor (inline LaTeX, display equations, syntax-highlighted code, graphs) with Drawboard-style pen annotation, built for Windows pens first, with sync and a mobile viewer planned from day one.

> **Status:** early. The editor, ink and code running work; graphs, export and publishing are next. See [docs/ROADMAP.md](docs/ROADMAP.md).

## What works today

- **WYSIWYG editing with Markdown shortcuts.** Markdown is only a fast way to type; notes are rich documents, not Markdown files.

  | Type | You get |
  |---|---|
  | `# ` `## ` `### ` | Headings |
  | `- ` / `1. ` / `[] ` | Bulleted, numbered, checklist |
  | `> ` | Quote |
  | `**bold**` `*italic*` `` `code` `` `~~strike~~` | Inline formatting |
  | `$e^{i\pi}+1=0$` | Inline math (KaTeX) |
  | `$$` + Enter | Display equation |
  | ```` ```python ```` + Enter | Code block (CodeMirror, any language) |
  | `---` | Divider |
  | `/` | Block menu |

  Press **Backspace** right after a shortcut fires to undo it back into the characters you typed.

- **Math editing.** Click an equation to edit it in a visual MathLive field, with the raw LaTeX synced underneath. A *Visual (Word-style)* setting hides the LaTeX: type `a/b`, `x^2`, `sqrt`, `alpha` and it becomes maths as you type. **Alt+=** inserts an equation, as in Word.
- **Ink everywhere.**
  - Write anywhere on the page. Strokes attach to the paragraph under them and move with it when you edit above.
  - Highlighters draw *under* the text.
  - **Canvas blocks** (`/canvas`) give you a drawing area, full width or floated left/right with text wrapping around it. Each has blank, grid, lined or dotted paper and can be resized.
- **Tools.**
  - Any number of pen presets: ballpoint, fountain, pencil, marker or brush, with pressure on/off, colour, thickness and opacity.
  - Highlighters.
  - Eraser: whole strokes or area.
  - Lasso: move, resize, delete (`Delete`), duplicate (`Ctrl+D`), or recolour by picking a pen.
  - Click a tool again to edit it; drag to reorder; dock the toolbar on any edge.
- **Pen-first input.**
  - The pen draws even in text mode (optional), and the pen's eraser end erases.
  - Fingers scroll, with palm rejection.
  - Ctrl+Z undoes text and ink together.
- **Run code.** ▶ Run (or **Shift+Enter**) on a Python or JavaScript block. Python runs offline in a bundled interpreter (Pyodide); numpy, matplotlib and other packages download on first import. Output, including plots, appears in a side panel and is never saved into the note.
- **Code blocks.** Syntax highlighting, auto-indent, bracket matching, Tab indents, and a language picker. **Ctrl+Enter** exits the block.
- **Infinite page.** One continuous, fixed-width page (8.5in wide) with no page breaks. Fixed width keeps future ink annotations anchored exactly and lets a later PDF export slice the strip into pages cleanly.
- **Local-first storage.** Notes save automatically to on-device storage as Yjs documents.
- Light and dark themes (system, or forced in Settings). Ink adapts so black ink stays readable on dark paper.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md), including the plans for Desmos-style graph blocks and for publishing notes as a website.

## Architecture

| Piece | Choice | Why |
|---|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) | Small, fast; uses Windows' built-in WebView2, which has full pen pressure/tilt support |
| Editor | [Tiptap](https://tiptap.dev) / ProseMirror | Custom block types, input rules for Markdown shortcuts |
| Math | KaTeX (render) + MathLive (edit) | Fast rendering, WYSIWYG editing |
| Code | CodeMirror 6 | A real code editor inside each code block |
| Data model | [Yjs](https://yjs.dev) CRDT | Offline-first; devices merge edits automatically, so sync is "add a provider", not a rewrite |
| Storage | IndexedDB via `y-indexeddb` | One Yjs doc per note + an index doc |
| Ink | Canvas 2D + [perfect-freehand](https://github.com/steveruizok/perfect-freehand) | Pressure-shaped strokes, stored as vector points in the same Yjs doc |
| Code running | [Pyodide](https://pyodide.org) + Web Workers | Python/JS run off the UI thread, fully local |

Source layout:

```
src/
  App.tsx                 shell: sidebar, infinite fixed-width page, zoom-to-fit
  lib/notes.ts            note index + per-note Yjs docs (persistence lives here)
  editor/
    NoteEditor.tsx        Tiptap setup
    math.ts               inline + display math nodes (KaTeX/MathLive)
    codeBlock.ts          CodeMirror-backed code block
    markdownShortcuts.ts  Enter-triggered shortcuts (``` and $$)
    slashCommand.tsx      "/" block menu
    canvasBlock.ts        drawing block (inline or floated)
    blockIds.ts           stable block ids that page ink anchors to
  ink/
    surface.ts            rendering + pen/highlighter/eraser/lasso behaviour
    input.ts              pointer routing: pen vs touch vs mouse, palm rejection
    render.ts             stroke shapes per pen type, dark-mode colours, hit testing
    InkOverlay.tsx        ink layer over (and highlighter layer under) the page
  runner/                 Python (Pyodide) and JavaScript workers, output store
  ui/                     toolbar, settings, output panel
src-tauri/                Windows desktop app (Rust)
```

## Development

Requires Node 22+. For the desktop app you also need Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (on Windows: the Microsoft C++ Build Tools; WebView2 is preinstalled on Windows 10/11).

```bash
npm install
```

Run in a browser (fastest for editor work):

```bash
npm run dev
```

Run as the desktop app:

```bash
npm run app:dev
```

Build the Windows installer (`.exe` + `.msi` in `src-tauri/target/release/bundle/`):

```bash
npm run app:build
```

### Downloading a build without setting up Rust

Every push to `main` builds the Windows installer in GitHub Actions and publishes it to the [**Latest build**](../../releases/tag/latest) pre-release. Download the `.exe` (or `.msi`) from there. The installer is unsigned for now, so Windows SmartScreen will ask you to confirm with *More info → Run anyway*.
