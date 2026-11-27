import { isDesktop } from '../lib/library/backends'
import type { SiteFile } from './site'

/**
 * Where a published site is written. Each publish is one atomic update:
 * new/changed files are written and everything under `removePrefixes` that
 * isn't rewritten is deleted (e.g. a note's old images).
 */
export interface PublishTarget {
  label: string
  write(files: SiteFile[], removePrefixes: string[], message: string): Promise<void>
}

const enc = new TextEncoder()
const bytesOf = (d: Uint8Array | string) => (typeof d === 'string' ? enc.encode(d) : d)

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// ---------------------------------------------------------------------------
// GitHub (one commit per publish, via the Git Data API)

const TOKEN_KEY = 'marginalia:githubToken'

/** The token never leaves this device and is never written into notes or the library. */
export function getGitHubToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setGitHubToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token.trim())
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export class GitHubError extends Error {}

export function githubTarget(repo: string, branch: string, token: string): PublishTarget & { check(): Promise<string> } {
  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (!res.ok) {
      let msg = `${res.status}`
      try {
        msg = (await res.json()).message ?? msg
      } catch {
        /* keep status */
      }
      const hint = res.status === 401 ? ' (check the token)' : res.status === 403 || res.status === 404 ? ' (does the token have Contents: read & write on this repository?)' : ''
      throw new GitHubError(`GitHub: ${msg}${hint}`)
    }
    return res.status === 204 ? null : res.json()
  }

  return {
    label: `github.com/${repo}`,
    async check() {
      const info = await api('')
      return info.full_name as string
    },
    async write(files, removePrefixes, message) {
      // Current branch tip (an empty repository gets its first commit through the contents API).
      let head: string
      try {
        head = (await api(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha
      } catch (e) {
        if (!(e instanceof GitHubError) || !/empty|Not Found/i.test(e.message)) throw e
        await api(`/contents/.nojekyll`, { method: 'PUT', body: JSON.stringify({ message: 'Start notes site', content: '', branch }) })
        head = (await api(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha
      }
      const baseTree = (await api(`/git/commits/${head}`)).tree.sha

      const entries: { path: string; mode: string; type: string; sha: string | null }[] = []
      for (const f of files) {
        const blob = await api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: base64(bytesOf(f.data)), encoding: 'base64' }) })
        entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
      }
      if (removePrefixes.length) {
        const written = new Set(files.map((f) => f.path))
        const tree = await api(`/git/trees/${baseTree}?recursive=1`)
        for (const t of tree.tree as { path: string; type: string }[]) {
          if (t.type === 'blob' && removePrefixes.some((p) => t.path.startsWith(p)) && !written.has(t.path)) entries.push({ path: t.path, mode: '100644', type: 'blob', sha: null })
        }
      }
      const newTree = await api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree: entries }) })
      const commit = await api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }) })
      await api(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) })
    },
  }
}

// ---------------------------------------------------------------------------
// A folder on this computer

export async function folderTarget(root: string): Promise<PublishTarget> {
  if (!isDesktop()) throw new Error('Publishing to a folder needs the desktop app (or use a GitHub repository).')
  const fs = await import('@tauri-apps/plugin-fs')
  const sep = root.includes('\\') ? '\\' : '/'
  const abs = (rel: string) => `${root}${sep}${rel.split('/').filter(Boolean).join(sep)}`
  return {
    label: root,
    async write(files, removePrefixes) {
      for (const p of removePrefixes) if (await fs.exists(abs(p))) await fs.remove(abs(p), { recursive: true })
      for (const f of files) {
        const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
        if (dir) await fs.mkdir(abs(dir), { recursive: true })
        await fs.writeFile(abs(f.path), bytesOf(f.data))
      }
    },
  }
}
