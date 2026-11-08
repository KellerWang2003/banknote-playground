import { workspaceJson, uploadArtwork, fetchArtwork, WorkspaceApiError } from './client'
import { readArtwork, writeArtwork } from './cache'
import { migrateProject } from '../lib/notes'
import { SaveConflict, type CachedProject, type CloudProject, type ProjectRepository } from './sync'
import type { Project } from '../lib/types'

export const projectImageIds = (project: Project) => [...new Set(project.notes.flatMap(
  (note) => [note.faceImageId, note.back?.imageId, note.watermark?.imageId, note.arcEnCiel?.imageId, note.magneticInk?.imageId, ...note.frames.map((f) => f.imageId)],
).filter((id): id is string => !!id))]
interface Row { data: Project; revision: string; deleted_at: string | null }
const fromRow = (row: Row): CloudProject => ({ project: migrateProject(row.data), revision: row.revision, deleted: !!row.deleted_at })

export async function downloadArtwork(workspace: string, id: string) {
  const cached = await readArtwork(workspace, id)
  if (cached) return cached
  const blob = await fetchArtwork(workspace, id)
  await writeArtwork(workspace, id, blob)
  return blob
}
export function createRepository(workspace: string): ProjectRepository {
  const uploaded = new Set<string>()
  const read = (id: string) => workspaceJson<Row | null>(workspace, 'get', { id })
  return {
    async list() {
      const rows: CloudProject[] = []
      for (let offset = 0; ; offset += 100) {
        const data = await workspaceJson<Row[]>(workspace, 'list', { offset })
        rows.push(...data.map(fromRow))
        if (data.length < 100) return rows
      }
    },
    async save(record: CachedProject) {
      // Recover a committed save whose HTTP response was lost.
      const existing = await read(record.project.id)
      if (existing?.revision === record.revision) return fromRow(existing)
      let base = record.baseRevision
      if (existing && existing.revision === record.sentRevision) base = existing.revision
      if (existing && existing.revision !== base) throw new SaveConflict(fromRow(existing))
      if (!existing && base) throw new Error('The cloud project is missing. Retry or save a recovery copy.')
      if (!record.deleted) for (const id of projectImageIds(record.project)) {
        if (uploaded.has(id)) continue
        await uploadArtwork(workspace, id, await downloadArtwork(workspace, id))
        uploaded.add(id)
      }
      try {
        return fromRow(await workspaceJson<Row>(workspace, 'write', {
          project: record.project, revision: record.revision, baseRevision: base, deleted: record.deleted,
        }))
      } catch (error) {
        if (!(error instanceof WorkspaceApiError) || error.status !== 409) throw error
        const latest = await read(record.project.id)
        if (!latest) throw new Error('The cloud project changed. Please retry.')
        if (latest.revision === record.revision) return fromRow(latest)
        throw new SaveConflict(fromRow(latest))
      }
    },
  }
}
