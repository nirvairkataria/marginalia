import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { isDesktop } from '../lib/library/backends'
import { getNote, useNotes } from '../lib/notes'
import { updateSettings, useSettings, type SiteSettings } from '../lib/settings'
import { noteUrl, publishNote, unpublishNote } from './publish'
import { getGitHubToken, githubTarget, setGitHubToken } from './targets'

/** Publish the open note to your notes website, and set the site up the first time. */
export function PublishDialog({ open, onClose, noteId, page, doc }: { open: boolean; onClose: () => void; noteId: string | null; page: HTMLElement | null; doc: Y.Doc | null }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { site } = useSettings()
  useNotes() // re-render when publish status changes
  const meta = noteId ? getNote(noteId) : undefined
  const [token, setToken] = useState(getGitHubToken)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; url?: string } | null>(null)
  const [showSetup, setShowSetup] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setMessage(null)
      d.showModal()
    }
    if (!open && d.open) d.close()
  }, [open])

  const configured = site.target === 'folder' ? !!site.folder : !!site.repo && !!token
  // Setup stays open while you fill it in; it starts open only if the site isn't set up yet.
  useEffect(() => {
    if (open) setShowSetup(!configured)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const setSite = (patch: Partial<SiteSettings>) => updateSettings((s) => ({ site: { ...s.site, ...patch } }))

  const run = async (fn: () => Promise<{ text: string; url?: string } | void>) => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await fn()
      if (r) setMessage({ kind: 'ok', ...r })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const testGitHub = () =>
    run(async () => {
      setGitHubToken(token)
      const name = await githubTarget(site.repo, site.branch || 'main', token).check()
      if (!site.baseUrl) {
        const [owner, repo] = name.split('/')
        setSite({ baseUrl: repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${repo}/` : `https://${owner}.github.io/${repo}/` })
      }
      return { text: `Connected to ${name}.` }
    })

  const publish = () =>
    run(async () => {
      if (!noteId || !page || !doc) throw new Error('Open a note first.')
      setGitHubToken(token)
      const url = await publishNote(noteId, page, doc)
      return { text: meta?.publish ? 'Updated on your site.' : 'Published.', url: url ?? undefined }
    })

  const unpublish = () =>
    run(async () => {
      if (!noteId) return
      await unpublishNote(noteId)
      return { text: 'Removed from your site.' }
    })

  const url = meta?.publish ? noteUrl(site, meta.publish.slug) : null
  const setupOpen = showSetup

  return (
    <dialog ref={ref} className="settings publish" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="settings-body">
        <header>
          <h2>Publish to your website</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {meta && (
          <section>
            <h3>This note</h3>
            <div className="publish-note">
              <div>
                <strong>{meta.title}</strong>
                <small>
                  {meta.folder ? `Listed under “${meta.folder}”` : 'Listed under “Notes”'} ·{' '}
                  {meta.publish ? `published ${new Date(meta.publish.at).toLocaleString()}` : 'not published'}
                </small>
                {url && (
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                )}
              </div>
              <div className="seg">
                <button className="primary" disabled={busy || !configured} onClick={publish}>
                  {meta.publish ? 'Update' : 'Publish'}
                </button>
                {meta.publish && (
                  <button disabled={busy} onClick={unpublish}>
                    Unpublish
                  </button>
                )}
              </div>
            </div>
            <p className="setting-hint">Publishing makes a web page that looks exactly like the note (maths, code, graphs, drawings and ink). Only notes you publish are on the site; folders become sections of the home page.</p>
            {busy && (
              <p className="publish-msg">
                <span className="spinner" /> Working…
              </p>
            )}
            {message && (
              <p className={`publish-msg ${message.kind}`}>
                {message.text}{' '}
                {message.url && (
                  <a href={message.url} target="_blank" rel="noreferrer">
                    Open page
                  </a>
                )}
              </p>
            )}
          </section>
        )}

        <section>
          <h3>
            Site{' '}
            {configured && (
              <button className="link-btn" onClick={() => setShowSetup((v) => !v)}>
                {setupOpen ? 'hide settings' : 'settings'}
              </button>
            )}
          </h3>
          {setupOpen && (
            <div className="publish-setup">
              <label>
                <span>Site title</span>
                <input value={site.title} onChange={(e) => setSite({ title: e.target.value })} />
              </label>
              <div className="setting-row">
                <span>Publish to</span>
                <div className="seg">
                  <button className={site.target === 'github' ? 'active' : ''} onClick={() => setSite({ target: 'github' })}>
                    GitHub repository
                  </button>
                  {isDesktop() && (
                    <button className={site.target === 'folder' ? 'active' : ''} onClick={() => setSite({ target: 'folder' })}>
                      A folder
                    </button>
                  )}
                </div>
              </div>
              {site.target === 'github' ? (
                <>
                  <label>
                    <span>Repository</span>
                    <input placeholder="you/notes" value={site.repo} onChange={(e) => setSite({ repo: e.target.value.trim() })} spellCheck={false} />
                  </label>
                  <label>
                    <span>Branch</span>
                    <input value={site.branch} onChange={(e) => setSite({ branch: e.target.value.trim() })} spellCheck={false} />
                  </label>
                  <label>
                    <span>Token</span>
                    <input type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} onBlur={() => setGitHubToken(token)} autoComplete="off" />
                  </label>
                  <p className="setting-hint">
                    Create a{' '}
                    <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                      fine-grained token
                    </a>{' '}
                    with access to <em>only this repository</em> and <strong>Contents: Read and write</strong>. It's stored only on this device.
                  </p>
                  <div className="seg">
                    <button disabled={busy || !site.repo || !token} onClick={testGitHub}>
                      Test connection
                    </button>
                  </div>
                </>
              ) : (
                <div className="setting-row">
                  <span className="library-path">{site.folder ?? 'No folder chosen'}</span>
                  <div className="seg">
                    <button
                      onClick={async () => {
                        const { open: pick } = await import('@tauri-apps/plugin-dialog')
                        const folder = await pick({ directory: true, title: 'Folder for your website' })
                        if (typeof folder === 'string') setSite({ folder })
                      }}
                    >
                      Choose…
                    </button>
                  </div>
                </div>
              )}
              <label>
                <span>Site address</span>
                <input placeholder="https://you.github.io/notes/" value={site.baseUrl} onChange={(e) => setSite({ baseUrl: e.target.value.trim() })} spellCheck={false} />
              </label>
              <details className="publish-help">
                <summary>How to host it for free</summary>
                <ol>
                  <li>
                    <strong>GitHub Pages:</strong> make a repository (e.g. <code>notes</code>), publish a note once, then in the repo go to <em>Settings → Pages → Deploy from a branch → main / (root)</em>. Your site appears at{' '}
                    <code>https://you.github.io/notes/</code>.
                  </li>
                  <li>
                    <strong>Cloudflare Pages</strong> (unlimited bandwidth): <em>Workers &amp; Pages → Create → Pages → Connect to Git</em>, pick the repo, framework <em>None</em>, build command empty, output directory <code>/</code>.
                  </li>
                  <li>
                    <strong>A folder</strong> (desktop): upload it anywhere that serves static files (Netlify Drop, your uni's web space…).
                  </li>
                </ol>
              </details>
            </div>
          )}
        </section>
      </div>
    </dialog>
  )
}
