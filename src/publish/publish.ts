import type * as Y from 'yjs'
import { getNote, listNotes, updateNote } from '../lib/notes'
import { getSettings, type SiteSettings } from '../lib/settings'
import { buildIndex, buildNotePage, collectCss, uniqueSlug, type SiteFile } from './site'
import { folderTarget, getGitHubToken, githubTarget, type PublishTarget } from './targets'

/** Publishing pipeline: snapshot the open note → static files → one update of the site. */

export async function targetFor(site: SiteSettings): Promise<PublishTarget> {
  if (site.target === 'folder') {
    if (!site.folder) throw new Error('Choose a folder for the site first.')
    return folderTarget(site.folder)
  }
  const token = getGitHubToken()
  if (!site.repo || !/^[\w.-]+\/[\w.-]+$/.test(site.repo)) throw new Error('Enter the repository as owner/name.')
  if (!token) throw new Error('Add a GitHub token first.')
  return githubTarget(site.repo, site.branch || 'main', token)
}

export function noteUrl(site: SiteSettings, slug: string): string | null {
  if (!site.baseUrl) return null
  return `${site.baseUrl.replace(/\/?$/, '/')}notes/${slug}/`
}

/** Home page + stylesheet, for the published set *after* this change. */
function sharedFiles(site: SiteSettings, change: { id: string; publish?: { slug: string; at: number } }): SiteFile[] {
  const published = listNotes()
    .map((n) => (n.id === change.id ? { ...n, publish: change.publish } : n))
    .filter((n) => n.publish)
  return [buildIndex(published, site), { path: 'assets/marginalia.css', data: collectCss() }, { path: '.nojekyll', data: '' }]
}

/** Publish (or republish) the open note. Returns its public address, if the site address is set. */
export async function publishNote(noteId: string, page: HTMLElement, doc: Y.Doc): Promise<string | null> {
  const site = getSettings().site
  const target = await targetFor(site)
  const meta = getNote(noteId)
  if (!meta) throw new Error('Note not found')
  const taken = new Set(listNotes().filter((n) => n.id !== noteId && n.publish).map((n) => n.publish!.slug))
  const slug = meta.publish?.slug ?? uniqueSlug(meta.title, taken)
  const files = await buildNotePage(page, doc, meta, slug, site)
  const publish = { slug, at: Date.now() }
  await target.write([...files, ...sharedFiles(site, { id: noteId, publish })], [`notes/${slug}/`], `Publish “${meta.title}”`)
  updateNote(noteId, { publish }) // only once the site has it
  return noteUrl(site, slug)
}

export async function unpublishNote(noteId: string): Promise<void> {
  const site = getSettings().site
  const target = await targetFor(site)
  const meta = getNote(noteId)
  if (!meta?.publish) return
  const slug = meta.publish.slug
  await target.write(sharedFiles(site, { id: noteId, publish: undefined }), [`notes/${slug}/`], `Unpublish “${meta.title}”`)
  updateNote(noteId, { publish: undefined })
}
