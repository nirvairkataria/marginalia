# Marginalia

Scientific and mathematical notes you can **type** *and* **draw** on.

Marginalia combines a structured, StemPad-style note editor (inline LaTeX, display equations, syntax-highlighted code, graphs) with Drawboard-style pen annotation, built for Windows pens first, with sync and a mobile viewer planned from day one.

> **Status:** early. Phase 1 (the text editor) works; ink and canvases are next.

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

- **Math editing.** Click an equation to edit it in a visual MathLive field, with the raw LaTeX synced underneath.
- **Code blocks.** Syntax highlighting, auto-indent, bracket matching, Tab indents, and a language picker. **Ctrl+Enter** exits the block.
- **Infinite page.** One continuous, fixed-width page (8.5in wide) with no page breaks. Fixed width keeps future ink annotations anchored exactly and lets a later PDF export slice the strip into pages cleanly.
- **Local-first storage.** Notes save automatically to on-device storage as Yjs documents.
- Light and dark themes follow the system setting.

## Roadmap

1. ✅ Block editor: Markdown shortcuts, inline/display LaTeX, code blocks, local persistence
2. ⬜ **Canvas blocks:** a drawing area inside the document (full width, or floated left/right with text wrapping around it). Pressure-sensitive pen, eraser end of the pen, palm rejection.
3. ⬜ **Ink overlay:** annotate anywhere on the page. Strokes are anchored to the block under them, so they move with the content when you edit above them.
4. ⬜ Graph blocks (Desmos API, with an open-source fallback), images, callouts
5. ⬜ Export: PDF (paged), Markdown + LaTeX (ink exported as images)
6. ⬜ Sync between devices + a read-only mobile viewer

## Architecture

| Piece | Choice | Why |
|---|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) | Small, fast; uses Windows' built-in WebView2, which has full pen pressure/tilt support |
| Editor | [Tiptap](https://tiptap.dev) / ProseMirror | Custom block types, input rules for Markdown shortcuts |
| Math | KaTeX (render) + MathLive (edit) | Fast rendering, WYSIWYG editing |
| Code | CodeMirror 6 | A real code editor inside each code block |
| Data model | [Yjs](https://yjs.dev) CRDT | Offline-first; devices merge edits automatically, so sync is "add a provider", not a rewrite |
| Storage | IndexedDB via `y-indexeddb` | One Yjs doc per note + an index doc |

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

Every push to `main` and every pull request builds the Windows installer in GitHub Actions. Open the **Actions** tab, select the latest run, and download the `marginalia-windows` artifact. The installer is unsigned for now, so Windows SmartScreen will ask you to confirm with *More info → Run anyway*.
