import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { writeArtwork } from '../src/cloud/cache'
import { createRepository, projectImageIds } from '../src/cloud/repository'
import { DEMO_ART, demoProject } from '../src/lib/demo'
import { framesReached } from '../src/lib/lens'
import { createNote, createProject, migrateProject } from '../src/lib/notes'
import type { Note, Project } from '../src/lib/types'

// The workspace function keeps each project as the JSON it was sent (one jsonb column), and artwork as files
const cloud = vi.hoisted(() => ({ rows: new Map<string, unknown>(), uploads: [] as string[] }))
vi.mock('../src/cloud/client', () => ({
  WorkspaceApiError: class extends Error { status = 0 },
  fetchArtwork: async () => { throw new Error('Artwork is on this device') },
  uploadArtwork: async (_workspace: string, id: string) => { cloud.uploads.push(id) },
  workspaceJson: async (_workspace: string, action: string, body: { id?: string; project?: Project; revision?: string; deleted?: boolean }) => {
    if (action === 'get') return cloud.rows.get(body.id!) ?? null
    const row = { data: JSON.parse(JSON.stringify(body.project)), revision: body.revision, deleted_at: body.deleted ? new Date().toISOString() : null }
    cloud.rows.set(body.project!.id, row)
    return structuredClone(row)
  },
}))

/** A banknote using everything added since the first cloud saves: frame fills, a rotated watermark, the continuous check, thread sections, a back */
function everything(): Note {
  const note = createNote({ name: 'Banknote', x: 0, y: 0, widthMm: 134, heightMm: 68, color: '#DBECC6' })
  const [empty, colour] = note.frames
  const image = { id: crypto.randomUUID(), kind: 'image' as const, color: '#ffffff', imageId: crypto.randomUUID(), aspect: 0.5, place: { alongMm: 2.5, across: 0.1, size: 0.8 }, name: 'Bird', length: 15 }
  return {
    ...note,
    background: 'image',
    faceImageId: crypto.randomUUID(),
    thread: { ...note.thread, widthMm: 5.5, backgroundColor: '#112233', windows: { enabled: true, sections: [{ id: 'w1', startMm: 5, endMm: 17 }, { id: 'w2', startMm: 24, endMm: 62 }] } },
    frames: [{ ...empty, kind: 'none' }, { ...colour, color: '#C2456B' }, image],
    watermark: { imageId: crypto.randomUUID(), xMm: 12.3, yMm: 4.5, widthMm: 20, heightMm: 30, rotationDeg: -12.5, depth: 0.4, invert: true, levels: { low: 0.1, high: 0.8, gamma: 1.6 } },
    continuous: { cutMm: 0.7 },
    back: { background: 'image', color: '#F0EAD6', imageId: crypto.randomUUID() },
    pattern: {
      repeatMm: 12.5,
      mixed: true,
      sections: [
        { id: 'left', name: 'Left', startMm: 0, endMm: 12.5, acrossStart: 0, acrossEnd: 0.5, lens: { effect: 'side', cycleDeg: 40 }, track: [empty.id, colour.id, image.id] },
        { id: 'right', name: 'Right', startMm: 0, endMm: 12.5, acrossStart: 0.5, acrossEnd: 1, track: [image.id, colour.id, empty.id] },
      ],
    },
  }
}

describe('saving to the cloud', () => {
  it('brings every setting back as it was saved, after uploading every image the project uses', async () => {
    const note = everything()
    // A new banknote comes without a thread, which saves too (Keller, 4 November)
    const plain = { ...createNote({ name: 'Plain', x: 154, y: 0, widthMm: 68, heightMm: 120, color: '#5B6B8C' }), noThread: true as const }
    const project = { ...createProject('Everything'), notes: [note, plain] }
    for (const id of projectImageIds(project)) await writeArtwork('save-test', id, new Blob(['art'], { type: 'image/png' }))
    const saved = await createRepository('save-test').save({ project, revision: crypto.randomUUID(), baseRevision: null, deleted: false, dirty: true })
    expect(saved.project).toEqual(project)
    expect(cloud.uploads.toSorted()).toEqual([note.faceImageId, note.back!.imageId, note.watermark!.imageId, note.frames[2].imageId].toSorted())
  })

  it('saves the demo with all it shows: a watermark, Partial reveal and a playlist, but no mixed angles', async () => {
    const demo = demoProject()
    const [bird, stars] = demo.notes
    expect(bird.watermark?.imageId).toBe(DEMO_ART.portrait)
    // Up/down shows all five star frames, side to side only the middle three: the outer two are the special ones
    expect([...framesReached(stars, 'y')]).toEqual([0, 1, 2, 3, 4])
    expect([...framesReached(stars, 'x')].toSorted()).toEqual([1, 2, 3])
    expect(stars.frames.map((f) => f.name)).toEqual(['1 sparkle', '2 star', '3 star', '4 star', '5 sparkle'])
    expect(demo.notes.map((n) => [n.pattern?.mixed, n.pattern?.sections.length])).toEqual([[false, 1], [false, 1]])
    expect(demo.notes.map((n) => n.tilt.moves?.map((m) => m.kind))).toEqual([['y', 'x'], ['y', 'x']])
    // It opens as it was built: nothing for an old save's migrations to change
    expect(migrateProject(structuredClone(demo))).toEqual(demo)
    expect(projectImageIds(demo).toSorted()).toEqual([...DEMO_ART.faces, ...DEMO_ART.backs, DEMO_ART.portrait, ...DEMO_ART.birds, ...DEMO_ART.stars].toSorted())
    for (const id of projectImageIds(demo)) await writeArtwork('demo-save-test', id, new Blob(['art'], { type: 'image/png' }))
    const saved = await createRepository('demo-save-test').save({ project: demo, revision: crypto.randomUUID(), baseRevision: null, deleted: false, dirty: true })
    expect(saved.project).toEqual(demo)
  })

  it('opens the old shared demo, saved before these settings, with its banknotes as they were', () => {
    const demo = JSON.parse(readFileSync(new URL('../supabase/demo/demo-template.json', import.meta.url), 'utf8')) as Project
    const opened = migrateProject(structuredClone(demo))
    // All but the hold every move had then (0 s), which Hold moves in the playlist replaced
    const asSaved = demo.notes.map(({ tilt: { holdSeconds: _hold, ...tilt }, ...note }) => ({ ...note, tilt }))
    expect(opened.notes.map(({ pattern: _pattern, ...note }) => note)).toEqual(asSaved)
    expect(opened.notes.every((n) => n.pattern?.sections.length === 1 && n.thread.imageGapMm === 0)).toBe(true)
  })
})
