import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval'
import { create } from 'zustand'
import { clearWorkspaceName } from '../cloud/identity'
import { WorkspaceApiError } from '../cloud/client'
import { errorMessage } from '../cloud/errors'
import { useNotice } from '../cloud/notices'
import * as api from './api'
import type { CloudPreset, CloudProject } from './api'
import type { PlaygroundPreset, PlaygroundState } from './engine/playground'
import { prepareImage, projectName } from './images'
import type { Project, SaveStatus } from './types'

/*
 * Intaglio Studio's projects: this browser's copy first, so they open at once and work offline, saved to the cloud a
 * moment after each change, one at a time. Every save carries a new revision and is taken only over the revision this
 * browser last saw; when the project changed elsewhere meanwhile, this browser's work is kept as a copy and the project
 * takes the newer version. Images go up once, before the project that uses them.
 */

interface StudioState {
  workspace: string | null
  /** Deleted ones too, until the cloud has heard (the gallery leaves them out) */
  projects: Project[]
  presets: PlaygroundPreset[]
  /** This browser's copy has been read */
  loaded: boolean
  /** The cloud has answered once */
  listed: boolean
  /** Why the cloud couldn't be reached, while it can't */
  listError: string
  status: SaveStatus
  saveError: string
}

const blank: StudioState = {
  workspace: null, projects: [], presets: [], loaded: false, listed: false, listError: '', status: 'saved', saveError: '',
}
export const useStudio = create<StudioState>(() => blank)

// ---------- this browser's copy: projects and presets in one database, images in another ----------
let kvStore: UseStore | undefined
let imageStore: UseStore | undefined
const kv = () => (kvStore ??= createStore('intaglio-studio', 'kv'))
const imageDb = () => (imageStore ??= createStore('intaglio-studio-images', 'images'))
/** Images this browser couldn't store (no IndexedDB): kept for this visit */
const memoryImages = new Map<string, Blob>()
/** This browser's writes, one after the other, so signing out can wait for them */
let writes: Promise<unknown> = Promise.resolve()
const queue = (write: () => Promise<unknown>) => (writes = writes.then(write).catch(() => undefined))
const projectKey = (workspace: string, id: string) => `p:${workspace}:${id}`

async function storeImage(id: string, blob: Blob) {
  try {
    await set(id, blob, imageDb())
  } catch {
    memoryImages.set(id, blob)
  }
}
async function storedImage(id: string) {
  return memoryImages.get(id) ?? (await get<Blob>(id, imageDb()).catch(() => undefined))
}

// ---------- the open workspace ----------
/** Goes up each time a workspace opens or closes: work begun for an earlier one stops there */
let session = 0
let saveTimer = 0
let retryTimer = 0
let refreshTimer = 0
let retryDelay = 0
let failing = false
/** The session whose saves are running */
let running = 0
let stopListening: (() => void) | undefined
/** The open editor's picture of its project, made as the project saves */
const thumbMakers = new Map<string, () => string | null>()
/** Projects the cloud refused (by their edit count): not sent again until they change */
const refused = new Map<string, number>()

const state = () => useStudio.getState()
const find = (id: string) => state().projects.find((p) => p.id === id)

function put(project: Project) {
  const { projects, workspace } = state()
  if (!workspace) return
  const at = projects.findIndex((p) => p.id === project.id)
  useStudio.setState({ projects: at < 0 ? [...projects, project] : projects.map((p, i) => (i === at ? project : p)) })
  queue(() => set(projectKey(workspace, project.id), project, kv()))
  updateStatus()
}
function drop(id: string) {
  const { projects, workspace } = state()
  if (!workspace) return
  useStudio.setState({ projects: projects.filter((p) => p.id !== id) })
  queue(() => del(projectKey(workspace, id), kv()))
  updateStatus()
}
function updateStatus() {
  const pending = state().projects.some((p) => p.dirty)
  const status: SaveStatus = !pending ? 'saved' : failing ? 'error' : 'saving'
  if (status !== state().status) useStudio.setState({ status })
}

const isProject = (p: unknown): p is Project => {
  const q = p as Project | undefined
  return !!q && typeof q.id === 'string' && typeof q.name === 'string' && typeof q.data?.image?.id === 'string'
}

function fromCloud(row: CloudProject, ext: number): Project | undefined {
  if (!row.data || typeof row.data.image?.id !== 'string') return undefined
  return {
    id: row.id, name: row.name, data: row.data, thumb: row.thumb, updatedAt: Date.parse(row.updated_at) || Date.now(),
    base: row.revision, inflight: null, dirty: false, edits: 0, deleted: false, imagePending: false, syncedAt: 0, ext,
  }
}

function fromPresetRow(row: CloudPreset): PlaygroundPreset | undefined {
  const data = row.data as Partial<PlaygroundPreset> | null
  if (!data || typeof data !== 'object' || !data.cfg) return undefined
  return { ...data, cfg: data.cfg, id: row.id, name: row.name, savedAt: typeof data.savedAt === 'number' ? data.savedAt : Date.parse(row.updated_at) }
}

export async function openStudio(workspace: string) {
  closeStudio()
  const s = ++session
  useStudio.setState({ ...blank, workspace })
  let projects: Project[] = []
  let presets: PlaygroundPreset[] = []
  try {
    const prefix = `p:${workspace}:`
    projects = (await entries(kv())).filter(([key]) => typeof key === 'string' && key.startsWith(prefix)).map(([, value]) => value).filter(isProject)
    presets = (await get<PlaygroundPreset[]>(`presets:${workspace}`, kv())) ?? []
  } catch {
    // no copy in this browser: the cloud's only
  }
  if (s !== session) return
  useStudio.setState({ projects, presets, loaded: true })
  updateStatus()

  const onOnline = () => {
    void refresh()
    void loadPresets()
    retrySave()
  }
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return
    void refresh()
    void loadPresets()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisibility)
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refresh()
  }, 30_000)
  stopListening = () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisibility)
  }
  void refresh()
  void loadPresets()
  if (projects.some((p) => p.dirty)) scheduleSave(0)
}

export function closeStudio() {
  session++
  clearTimeout(saveTimer)
  clearTimeout(retryTimer)
  clearInterval(refreshTimer)
  stopListening?.()
  stopListening = undefined
  thumbMakers.clear()
  refused.clear()
  failing = false
  retryDelay = 0
  running = 0
  useStudio.setState(blank)
}

/** Signing out keeps this browser's copy (offline work saves when the username comes back), written first */
export async function signOut() {
  await writes
  clearWorkspaceName()
}

// ---------- from the cloud ----------
export async function refresh() {
  const s = session
  const workspace = state().workspace
  if (!workspace) return
  const startedAt = Date.now()
  try {
    const rows = await api.listProjects(workspace)
    if (s !== session) return
    for (const row of rows) {
      const local = find(row.id)
      // this browser's own changes win until they save (a clash shows then), and a list from before a save is old news
      if (local && (local.dirty || local.inflight || local.syncedAt >= startedAt)) continue
      if (row.deleted_at || !row.data) {
        if (local) drop(row.id)
        continue
      }
      if (local && local.base === row.revision) continue
      const next = fromCloud(row, local ? local.ext + 1 : 0)
      if (next) put(next)
    }
    useStudio.setState({ listed: true, listError: '' })
  } catch (error) {
    if (s !== session) return
    useStudio.setState({ listError: errorMessage(error, 'Couldn’t reach the workspace. Please retry.') })
  }
}

// ---------- saving ----------
function scheduleSave(delay = 1000) {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void flush(), delay)
}

/** Couldn't save → Retry: now, and from the start of the wait between tries */
export function retrySave() {
  retryDelay = 0
  clearTimeout(retryTimer)
  scheduleSave(0)
}

async function flush() {
  const s = session
  const workspace = state().workspace
  if (!workspace || running === s) return
  running = s
  try {
    for (;;) {
      if (s !== session) return
      const next = state().projects.find((p) => p.dirty && refused.get(p.id) !== p.edits)
      if (!next) break
      await saveOne(next.id, workspace, s)
    }
    if (s !== session) return
    const stuck = state().projects.find((p) => p.dirty)
    failing = !!stuck
    retryDelay = 0
    if (!stuck) useStudio.setState({ saveError: '' })
  } catch (error) {
    if (s !== session) return
    failing = true
    useStudio.setState({ saveError: errorMessage(error, 'Couldn’t save. Please retry.') })
    retryDelay = Math.min(retryDelay ? retryDelay * 2 : 2000, 60_000)
    clearTimeout(retryTimer)
    retryTimer = window.setTimeout(() => void flush(), retryDelay)
  } finally {
    if (running === s) running = 0
    if (s === session) updateStatus()
  }
}

async function saveOne(id: string, workspace: string, s: number) {
  let p = find(id)
  if (!p) return
  if (p.deleted && !p.base && !p.inflight) {
    drop(id)
    return
  }
  // its image first, so no other device ever finds the project without it
  if (p.imagePending && !p.deleted) {
    const imageId = p.data.image.id
    const blob = await storedImage(imageId)
    if (!blob) throw new Error('This project’s image isn’t in this browser any more, so it can’t be saved.')
    await api.uploadImage(workspace, imageId, blob)
    if (s !== session) return
    p = find(id)
    if (!p) return
    if (p.data.image.id === imageId) put({ ...p, imagePending: false })
  }
  // a fresh picture of it, while it is open
  const maker = thumbMakers.get(id)
  p = find(id)
  if (!p) return
  if (maker && !p.deleted) {
    const thumb = maker()
    if (thumb && thumb !== p.thumb) put({ ...p, thumb })
  }
  // the answer to the last save never came: see whether it landed
  p = find(id)
  if (!p) return
  if (p.inflight) {
    const sent = p.inflight
    const cloud = await api.getProject(workspace, id)
    if (s !== session) return
    p = find(id)
    if (!p) return
    put({ ...p, base: cloud && cloud.revision === sent ? sent : p.base, inflight: null })
    p = find(id)
    if (!p) return
  }
  const revision = crypto.randomUUID()
  const edits = p.edits
  put({ ...p, inflight: revision })
  try {
    await api.writeProject(workspace, { id, name: p.name, data: p.data, thumb: p.thumb }, revision, p.base, p.deleted)
  } catch (error) {
    if (s !== session) return
    const answered = error instanceof WorkspaceApiError
    // a refused save didn't land; a dropped connection may have
    const q = find(id)
    if (q && answered) put({ ...q, inflight: null })
    if (answered && error.status === 409) return keepBoth(id, workspace, s)
    if (answered && error.status === 400 && q) refused.set(id, q.edits)
    throw error
  }
  if (s !== session) return
  const q = find(id)
  if (!q) return
  if (q.deleted) {
    drop(id)
    return
  }
  put({ ...q, base: revision, inflight: null, syncedAt: Date.now(), dirty: q.edits !== edits })
}

/**
 * The project changed elsewhere since this browser last saw it: this browser's work carries on as a copy (open in
 * the editor if it was) and the project takes the newer version. A delete here gives way to the change there.
 */
async function keepBoth(id: string, workspace: string, s: number) {
  const cloud = await api.getProject(workspace, id)
  if (s !== session) return
  const p = find(id)
  if (!p) return
  if (!p.deleted) {
    const copy: Project = {
      ...p, id: crypto.randomUUID(), name: `${p.name} copy`, base: null, inflight: null, dirty: true, edits: 1, deleted: false,
      syncedAt: 0, ext: 0, updatedAt: Date.now(),
    }
    put(copy)
    if (location.hash === `#/p/${id}`) location.hash = `#/p/${copy.id}`
    useNotice.setState({ message: `“${p.name}” changed in another tab or on another computer, so your version is kept as “${copy.name}”.` })
  }
  const next = cloud && !cloud.deleted_at ? fromCloud(cloud, p.ext + 1) : undefined
  if (next) put(next)
  else drop(id)
}

// ---------- changes ----------
function edit(id: string, change: (p: Project) => Partial<Project>, delay = 1000) {
  const p = find(id)
  if (!p || p.deleted) return
  put({ ...p, ...change(p), dirty: true, edits: p.edits + 1, updatedAt: Date.now() })
  scheduleSave(delay)
}

/** A new project from an image (picked, dropped or pasted): it opens in the editor with the default waves */
export async function createProject(file: File) {
  const s = session
  const image = await prepareImage(file)
  if (s !== session) throw new Error('The workspace closed before the project could be made.')
  const imageId = crypto.randomUUID()
  await storeImage(imageId, image.blob)
  const project: Project = {
    id: crypto.randomUUID(), name: projectName(file),
    data: { v: 1, cfg: null, ui: null, image: { id: imageId, name: image.name, type: image.type, bytes: image.blob.size } },
    thumb: null, updatedAt: Date.now(), base: null, inflight: null, dirty: true, edits: 1, deleted: false, imagePending: true,
    syncedAt: 0, ext: 0,
  }
  put(project)
  scheduleSave(1500)
  return project.id
}

export function renameProject(id: string, name: string) {
  const clean = name.trim().slice(0, 120)
  if (clean && clean !== find(id)?.name) edit(id, () => ({ name: clean }), 300)
}

export function duplicateProject(id: string) {
  const p = find(id)
  if (!p || p.deleted) return
  put({
    ...p, id: crypto.randomUUID(), name: `${p.name} copy`.slice(0, 120), base: null, inflight: null, dirty: true, edits: 1, deleted: false,
    syncedAt: 0, ext: 0, updatedAt: Date.now(),
  })
  scheduleSave(300)
}

export function deleteProject(id: string) {
  const p = find(id)
  if (!p) return
  put({ ...p, deleted: true, dirty: true, edits: p.edits + 1 })
  scheduleSave(0)
}

// ---------- the editor ----------
/** What the editor hands over after each change: its settings, view, and the image as it measured it */
export function keepEditorState(id: string, next: PlaygroundState) {
  edit(id, (p) => ({
    data: {
      ...p.data, cfg: next.cfg, ui: next.ui,
      image: next.image ? { ...p.data.image, nw: next.image.nw, nh: next.image.nh, widthMm: next.image.widthMm } : p.data.image,
    },
  }))
}

/** The project's image: this browser's copy, else from the cloud (and kept here from then on) */
export async function openImage(id: string, onProgress: (fraction: number) => void) {
  const p = find(id)
  const workspace = state().workspace
  if (!p || !workspace) throw new Error('This project isn’t open.')
  const ref = p.data.image
  let blob = await storedImage(ref.id)
  if (!blob) {
    blob = await api.downloadImage(workspace, ref.id, onProgress)
    void storeImage(ref.id, blob)
  }
  return { blob, name: ref.name, widthMm: ref.widthMm }
}

/** Replace image: the new image is kept (and goes up with the next save); the lines stay */
export async function replaceImage(id: string, file: File) {
  const image = await prepareImage(file)
  const imageId = crypto.randomUUID()
  await storeImage(imageId, image.blob)
  edit(id, (p) => ({
    data: { ...p.data, image: { id: imageId, name: image.name, type: image.type, bytes: image.blob.size } },
    imagePending: true,
  }))
  return { blob: image.blob, name: image.name }
}

/** While a project is open, each of its saves takes a fresh picture of it from the editor */
export function setThumbMaker(id: string, make: () => string | null) {
  thumbMakers.set(id, make)
  return () => {
    if (thumbMakers.get(id) === make) thumbMakers.delete(id)
  }
}

/** The editor's last picture as it closes, for a save still to come */
export function keepThumb(id: string, thumb: string | null) {
  const p = find(id)
  if (p && thumb && p.dirty && !p.deleted) put({ ...p, thumb })
}

// ---------- presets, by username ----------
function setPresets(presets: PlaygroundPreset[]) {
  const workspace = state().workspace
  if (!workspace) return
  useStudio.setState({ presets })
  queue(() => set(`presets:${workspace}`, presets, kv()))
}

async function loadPresets() {
  const s = session
  const workspace = state().workspace
  if (!workspace) return
  try {
    const rows = await api.listPresets(workspace)
    if (s !== session) return
    setPresets(rows.map(fromPresetRow).filter((p): p is PlaygroundPreset => !!p))
  } catch {
    // this browser's list stays until the cloud answers
  }
}

export const presets = {
  subscribe(listener: (presets: PlaygroundPreset[]) => void) {
    listener(state().presets)
    return useStudio.subscribe((now, before) => {
      if (now.presets !== before.presets) listener(now.presets)
    })
  },
  async save(preset: Omit<PlaygroundPreset, 'id'>, replaceId: string | null) {
    const workspace = state().workspace
    if (!workspace) throw new Error('No workspace is open.')
    const id = crypto.randomUUID()
    const { name, ...data } = preset
    await api.savePreset(workspace, { id, name, data })
    if (replaceId) await api.deletePreset(workspace, replaceId).catch(() => undefined)
    if (state().workspace === workspace) setPresets([{ ...preset, id }, ...state().presets.filter((p) => p.id !== replaceId)])
    return id
  },
  async remove(id: string) {
    const workspace = state().workspace
    if (!workspace) throw new Error('No workspace is open.')
    await api.deletePreset(workspace, id)
    if (state().workspace === workspace) setPresets(state().presets.filter((p) => p.id !== id))
  },
}
