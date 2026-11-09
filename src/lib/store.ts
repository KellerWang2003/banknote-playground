import { fitTiles } from './artwork'
import { canStepNote, recordEdit, historyStep, reconcileHistory, resetHistory } from './history'
import { useWorkspace, putProject, editorProject } from '../cloud/workspace'
import { copyImage, removeImage } from './images'
import { nextNotePosition } from './notes'
import { remapTracks } from './pattern'
import type { Note, Project } from './types'

const noteImageIds = (note: Note) =>
  [note.faceImageId, note.back?.imageId, note.watermark?.imageId, note.arcEnCiel?.imageId, note.magneticInk?.imageId, ...note.frames.map((f) => f.imageId)].filter((i) => i !== undefined)

/** A copy of a note with fresh ids and its own copies of the images, so deleting one never breaks the other */
async function copyNote(note: Note): Promise<Note> {
  const frames = await Promise.all(
    note.frames.map(async (f) => ({
      ...f,
      id: crypto.randomUUID(),
      imageId: f.imageId ? await copyImage(f.imageId) : undefined,
    })),
  )
  const faceImageId = note.faceImageId ? await copyImage(note.faceImageId) : undefined
  const back = note.back?.imageId ? { ...note.back, imageId: await copyImage(note.back.imageId) } : note.back
  // The watermark, Arc-en-Ciel and magnetic ink are part of the banknote's design, so a copy keeps them, with their own images
  const watermark = note.watermark?.imageId ? { ...note.watermark, imageId: await copyImage(note.watermark.imageId) } : note.watermark
  const arcEnCiel = note.arcEnCiel?.imageId ? { ...note.arcEnCiel, imageId: await copyImage(note.arcEnCiel.imageId) } : note.arcEnCiel
  const magneticInk = note.magneticInk?.imageId ? { ...note.magneticInk, imageId: await copyImage(note.magneticInk.imageId) } : note.magneticInk
  // Section tracks name frames by id, so they follow the frames to their new ids
  const pattern = remapTracks(note.pattern, new Map(note.frames.map((f, i) => [f.id, frames[i].id])))
  return { ...note, id: crypto.randomUUID(), faceImageId, frames, ...(back ? { back } : {}), ...(watermark ? { watermark } : {}), ...(arcEnCiel ? { arcEnCiel } : {}), ...(magneticInk ? { magneticInk } : {}), ...(pattern ? { pattern } : {}) }
}

// Keep the editor's existing actions while the cloud workspace owns persistence.
const actions = {
  add: (project: Project) => putProject(project),
  update: (id: string, change: (project: Project) => Project) => {
    const project = editorProject(id)
    if (!project) return
    // A tile on Fit follows its thread, whatever changed it
    const next = fitTiles(change(project))
    if (recordEdit(project, next)) putProject({ ...next, updatedAt: Date.now() })
  },
  duplicate: async (id: string) => {
    const workspace = useWorkspace.getState().workspace
    const source = useWorkspace.getState().projects.find((p) => p.id === id)
    if (!source) return undefined
    const now = Date.now()
    const copy: Project = {
      ...source, id: crypto.randomUUID(), name: `${source.name} copy`,
      createdAt: now, updatedAt: now, notes: await Promise.all(source.notes.map(copyNote)),
    }
    if (useWorkspace.getState().workspace !== workspace) throw new Error('The workspace changed. Try again.')
    actions.add(copy)
    return copy
  },
  remove: async (id: string) => {
    const project = useWorkspace.getState().projects.find((p) => p.id === id)
    if (project) putProject(project, true)
  },
}

// Zustand's hook and imperative API are both used by the existing UI.
export const useProjects = Object.assign(
  <T = ReturnType<typeof useWorkspace.getState>>(selector?: (state: ReturnType<typeof useWorkspace.getState>) => T) =>
    useWorkspace(selector ?? ((state) => state as T)),
  { getState: () => ({ ...useWorkspace.getState(), ...actions }) },
)

// History is session-local and is invalidated if the cloud replaces a project.
const unsubscribeHistory = useWorkspace.subscribe((state, previous) => {
  if (state.workspace !== previous.workspace) resetHistory()
  reconcileHistory([...state.projects, ...(state.demoPreview ? [state.demoPreview] : [])])
})
if (import.meta.hot) import.meta.hot.dispose(unsubscribeHistory)

export function undoProject(id: string) {
  const project = editorProject(id)
  const restored = project && historyStep(project, 'undo')
  if (restored) putProject(restored)
}
export function redoProject(id: string) {
  const project = editorProject(id)
  const restored = project && historyStep(project, 'redo')
  if (restored) putProject(restored)
}

/** Undo or redo from one banknote's thread editor: only a step that is that banknote's (`canStepNote`) */
export function stepNote(projectId: string, noteId: string, direction: 'undo' | 'redo') {
  const project = editorProject(projectId)
  const restored = project && canStepNote(project, noteId, direction) && historyStep(project, direction)
  if (restored) putProject(restored)
}

export const updateProject = (id: string, change: (project: Project) => Project) =>
  useProjects.getState().update(id, change)

export const findNote = (projectId: string, noteId: string) =>
  editorProject(projectId)?.notes.find((note) => note.id === noteId)

export const updateNote = (projectId: string, noteId: string, change: (note: Note) => Note) =>
  updateProject(projectId, (p) => ({ ...p, notes: p.notes.map((n) => (n.id === noteId ? change(n) : n)) }))

/** Changes a note without an undo step: for bringing older data up to date, never for an edit */
export function settleNote(projectId: string, noteId: string, change: (note: Note) => Note) {
  const project = editorProject(projectId)
  if (!project?.notes.some((n) => n.id === noteId)) return
  putProject(fitTiles({ ...project, notes: project.notes.map((n) => (n.id === noteId ? change(n) : n)) }))
}

export const addNote = (projectId: string, note: Note) =>
  updateProject(projectId, (p) => ({ ...p, notes: [...p.notes, note] }))

/**
 * Moves a banknote to `to` in the project's list, the others keeping their order. The list's order is saved with the
 * project; where each banknote sits on the canvas doesn't change.
 */
export const moveNote = (projectId: string, noteId: string, to: number) =>
  updateProject(projectId, (p) => {
    const from = p.notes.findIndex((n) => n.id === noteId)
    const at = Math.max(0, Math.min(p.notes.length - 1, to))
    if (from < 0 || at === from) return p
    const notes = [...p.notes]
    notes.splice(at, 0, ...notes.splice(from, 1))
    return { ...p, notes }
  })

/** Inserts the copy right after the original and returns its id */
export async function duplicateNote(projectId: string, noteId: string) {
  const source = findNote(projectId, noteId)
  if (!source) return undefined
  const copied = { ...(await copyNote(source)), name: `${source.name} copy` }
  let copy = copied
  updateProject(projectId, (p) => {
    copy = { ...copied, ...nextNotePosition(p.notes) }
    const at = p.notes.findIndex((n) => n.id === noteId)
    const notes = [...p.notes]
    notes.splice(at + 1, 0, copy)
    return { ...p, notes }
  })
  return copy.id
}

export async function removeNote(projectId: string, noteId: string) {
  const note = findNote(projectId, noteId)
  if (!note) return
  updateProject(projectId, (p) => ({ ...p, notes: p.notes.filter((n) => n.id !== noteId) }))
  await Promise.all(noteImageIds(note).map((i) => removeImage(i)))
}
