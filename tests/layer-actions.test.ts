import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNote } from '../src/lib/notes'
import type { Note } from '../src/lib/types'

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
const { addLayer } = await import('../src/editor/layerActions')

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
