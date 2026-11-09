import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fitArcEnCiel, newArcEnCiel } from '../src/lib/arcEnCiel'
import { featureName } from '../src/lib/layers'
import { fitMagneticInk, newMagneticInk } from '../src/lib/magneticInk'
import { createNote, createProject, migrateProject } from '../src/lib/notes'
import type { Note } from '../src/lib/types'
import { newWatermark } from '../src/lib/watermark'

// One banknote in place of the project store, artwork that stores at once, and a stand-in that draws at once
const held = vi.hoisted(() => ({ note: undefined as Note | undefined, steps: [] as string[], drawable: true }))
vi.mock('../src/lib/store', () => ({
  findNote: () => held.note,
  updateNote: (_project: string, _note: string, change: (note: Note) => Note) => { held.note = change(held.note!) },
}))
vi.mock('../src/lib/images', () => ({ storeImage: async () => 'stand-in', removeImage: async () => {}, imageAspect: async () => 1.25 }))
vi.mock('../src/lib/history', () => ({
  beginHistoryGroup: () => held.steps.push('begin'),
  endHistoryGroup: () => held.steps.push('end'),
}))
vi.mock('../src/lib/standIns', () => ({
  standIn: async (layer: string) => {
    if (!held.drawable) throw new Error('Canvas is not available')
    return new File(['x'], `${layer}.png`, { type: 'image/png' })
  },
}))
const { addFeature, addLayer, removeFeature, renameFeature, updateWatermark } = await import('../src/editor/layerActions')

const ref = { projectId: 'p', noteId: 'n' }

beforeEach(() => {
  held.note = createNote({ name: 'Banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#123456' })
  held.steps = []
  held.drawable = true
})

describe('adding a watermark or magnetic ink', () => {
  it('shows its box at once and its stand-in image a moment later, as one undo step', async () => {
    addLayer(ref, 'watermark')
    const box = held.note!.watermark!
    expect(box.imageId).toBeUndefined()
    await vi.waitFor(() => expect(held.note!.watermark!.imageId).toBe('stand-in'))
    // The portrait's proportions set its height, about its middle
    expect(held.note!.watermark).toMatchObject({ widthMm: box.widthMm, heightMm: box.widthMm * 1.25 })
    await vi.waitFor(() => expect(held.steps).toEqual(['begin', 'end']))
  })

  it('gives magnetic ink its stand-in too', async () => {
    addLayer(ref, 'magneticInk')
    await vi.waitFor(() => expect(held.note!.magneticInk!.imageId).toBe('stand-in'))
  })

  it('gives Arc-en-Ciel its disc, whose proportions set its height', async () => {
    addLayer(ref, 'arcEnCiel')
    const box = held.note!.arcEnCiel!
    expect(box).toMatchObject({ flow: 'edge', colors: ['#e0a91b', '#d23a7c', '#3a68d6'] })
    await vi.waitFor(() => expect(held.note!.arcEnCiel!.imageId).toBe('stand-in'))
    expect(held.note!.arcEnCiel).toMatchObject({ widthMm: box.widthMm, heightMm: box.widthMm * 1.25 })
  })

  it('leaves a layer that got an image of its own meanwhile, or went, as it is', async () => {
    addLayer(ref, 'watermark')
    held.note = { ...held.note!, watermark: { ...held.note!.watermark!, imageId: 'mine' } }
    await vi.waitFor(() => expect(held.steps).toEqual(['begin', 'end']))
    expect(held.note!.watermark!.imageId).toBe('mine')
  })

  it('starts empty, as before, where the stand-in can’t be drawn', async () => {
    held.drawable = false
    addLayer(ref, 'magneticInk')
    await vi.waitFor(() => expect(held.steps).toEqual(['begin', 'end']))
    expect(held.note!.magneticInk!.imageId).toBeUndefined()
  })
})

describe('renaming a security feature', () => {
  const reopened = (note: Note) => migrateProject({ ...createProject('Project'), notes: [note] }).notes[0]

  it('keeps the name on the feature itself, through edits and the project opening again', () => {
    held.note = { ...held.note!, watermark: newWatermark(held.note!) }
    renameFeature(ref, 'thread', '  Star thread ')
    renameFeature(ref, 'watermark', 'Bird glow')
    expect(held.note!.thread.name).toBe('Star thread')
    expect(featureName(held.note!, 'thread')).toBe('Star thread')
    expect(featureName(held.note!, 'watermark')).toBe('Bird glow')
    updateWatermark(ref, (w) => ({ ...w, depth: 0.3 }))
    expect(held.note!.watermark).toMatchObject({ name: 'Bird glow', depth: 0.3 })
    const again = reopened(held.note!)
    expect([again.thread.name, again.watermark!.name]).toEqual(['Star thread', 'Bird glow'])
    // A name that isn't text with something in it doesn't survive a damaged save; the rest of the feature does
    const damaged = { ...again, thread: { ...again.thread, name: 42 }, watermark: { ...again.watermark!, name: '  ' } } as unknown as Note
    const repaired = reopened(damaged)
    expect('name' in repaired.thread).toBe(false)
    expect('name' in repaired.watermark!).toBe(false)
    expect(repaired.watermark!.depth).toBe(0.3)
  })

  it('goes by what it is again once its name is cleared, typed as what it is, or it is removed and added again', async () => {
    held.note = { ...held.note!, watermark: newWatermark(held.note!) }
    renameFeature(ref, 'thread', 'Star thread')
    renameFeature(ref, 'watermark', 'Bird glow')
    renameFeature(ref, 'thread', '   ')
    renameFeature(ref, 'watermark', 'Watermark')
    expect('name' in held.note!.thread).toBe(false)
    expect('name' in held.note!.watermark!).toBe(false)
    expect(featureName(held.note!, 'thread')).toBe('Security thread')
    renameFeature(ref, 'thread', 'Star thread')
    await removeFeature(ref, 'thread')
    addFeature(ref, 'thread')
    expect(featureName(held.note!, 'thread')).toBe('Security thread')
    // A feature the banknote doesn't have stays away
    renameFeature(ref, 'magneticInk', 'Fifteen')
    expect(held.note!.magneticInk).toBeUndefined()
  })

  it('keeps Arc-en-Ciel’s and magnetic ink’s names through their fits too', () => {
    const size = { widthMm: 150, heightMm: 70 }
    expect(fitArcEnCiel({ ...newArcEnCiel(size), name: 'Petals' }, size).name).toBe('Petals')
    expect(fitMagneticInk({ ...newMagneticInk(size), name: 'Fifteen' }, size).name).toBe('Fifteen')
    expect(featureName({ ...held.note!, arcEnCiel: { ...newArcEnCiel(size), name: 'Petals' } }, 'arcEnCiel')).toBe('Petals')
  })
})
