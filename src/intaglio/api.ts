import { cloudConfigured, WorkspaceApiError } from '../cloud/client'
import type { ProjectData } from './types'

// Intaglio Studio's one way into Supabase: the intaglio-workspace function, by username, like Banknote Playground's
// thread-workspace (docs/INTAGLIO.md)
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export interface CloudProject {
  id: string
  name: string
  /** Null for a deleted project, which comes as a bare tombstone so other devices drop it */
  data: ProjectData | null
  thumb: string | null
  revision: string
  deleted_at: string | null
  updated_at: string
}

export interface CloudPreset {
  id: string
  name: string
  data: Record<string, unknown>
  updated_at: string
}

async function request(body: Record<string, unknown> | FormData, timeoutMs = 20_000) {
  if (!cloudConfigured) throw new Error('Cloud connection is not configured.')
  const multipart = body instanceof FormData
  const response = await fetch(`${url}/functions/v1/intaglio-workspace`, {
    method: 'POST',
    headers: { apikey: key, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new WorkspaceApiError(data.error || data.message || 'Couldn’t reach the workspace. Please retry.', response.status)
  }
  return response
}

async function call<T>(workspace: string, action: string, data: Record<string, unknown> = {}): Promise<T> {
  return (await request({ ...data, workspace, action })).json()
}

/** Every project of the workspace, deleted ones as tombstones, a hundred at a time */
export async function listProjects(workspace: string) {
  const all: CloudProject[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await call<CloudProject[]>(workspace, 'list', { offset })
    all.push(...page)
    if (page.length < 100) return all
  }
}

export const getProject = (workspace: string, id: string) => call<CloudProject | null>(workspace, 'get', { id })

/**
 * Saves a project as `revision`: a new one when `baseRevision` is null, else only over the revision this device last
 * saw (a 409 otherwise: it changed elsewhere)
 */
export const writeProject = (
  workspace: string,
  project: { id: string; name: string; data: ProjectData; thumb: string | null },
  revision: string,
  baseRevision: string | null,
  deleted: boolean,
) => call<CloudProject>(workspace, 'write', { project, revision, baseRevision, deleted })

/** An image, once, by its id: images never change, so sending one again is fine */
export async function uploadImage(workspace: string, id: string, file: Blob) {
  const form = new FormData()
  form.set('workspace', workspace)
  form.set('id', id)
  form.set('file', file, id)
  await request(form, 300_000)
}

export async function downloadImage(workspace: string, id: string, onProgress?: (fraction: number) => void) {
  const response = await request({ workspace, action: 'download', id }, 300_000)
  const total = Number(response.headers.get('content-length')) || 0
  const type = response.headers.get('content-type') || 'application/octet-stream'
  if (!response.body || !total || !onProgress) return response.blob()
  const reader = response.body.getReader()
  const parts: Uint8Array<ArrayBuffer>[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    onProgress(Math.min(got / total, 1))
  }
  return new Blob(parts, { type })
}

export const listPresets = (workspace: string) => call<CloudPreset[]>(workspace, 'presets')
export const savePreset = (workspace: string, preset: { id: string; name: string; data: Record<string, unknown> }) =>
  call<{ ok: true }>(workspace, 'savePreset', { preset })
export const deletePreset = (workspace: string, id: string) => call<{ ok: true }>(workspace, 'deletePreset', { id })
