import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fitTiles } from '../src/lib/artwork'
import { projectImageIds } from '../src/cloud/repository'
import {
  extraImageIds, extraView, featurePart, featureParts, nextName, noteOrPart, partLayer, partNoteId, promoteExtra, splitNoteId, throughExtra,
  withEveryPart,
} from '../src/lib/extras'
import { fitLayers } from '../src/lib/layers'
import { newMagneticInk } from '../src/lib/magneticInk'
import { createNote, createProject, migrateProject } from '../src/lib/notes'
import type { ExtraFeature, Note, Watermark } from '../src/lib/types'
import { newWatermark } from '../src/lib/watermark'

// Keller, 10 November: "you should be able to add multiple of the same security feature. so no limit"

// One banknote in place of the project store, read and written through further features' views as the store does
const held = vi.hoisted(() => ({ note: undefined as Note | undefined, steps: [] as string[] }))
vi.mock('../src/lib/store', async () => {
  const { noteOrPart, splitNoteId, throughExtra } = await import('../src/lib/extras')
  return {
    findNote: (_project: string, id: string) => noteOrPart(held.note, id),
    updateNote: (_project: string, id: string, change: (note: Note) => Note) => {
      const { extraId } = splitNoteId(id)
      held.note = extraId === undefined ? change(held.note!) : throughExtra(held.note!, extraId, change)
    },
  }
})
vi.mock('../src/lib/images', () => ({ storeImage: async () => 'stand-in', removeImage: async () => {}, imageAspect: async () => 1 }))
vi.mock('../src/lib/history', () => ({
  beginHistoryGroup: () => held.steps.push('begin'),
  endHistoryGroup: () => held.steps.push('end'),
}))
vi.mock('../src/lib/standIns', () => ({ standIn: async (layer: string) => new File(['x'], `${layer}.png`, { type: 'image/png' }) }))
const { addFeature, layerOf, removeFeature, renameFeature, placeLayer, updateWatermark } = await import('../src/editor/layerActions')

const ref = { projectId: 'p', noteId: 'n' }
const banknote = (): Note => ({ ...createNote({ name: 'Banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#123456' }), id: 'n' })
/** A banknote with a watermark and a second one, `second` */
function twoWatermarks(): Note {
  const note = banknote()
  return { ...note, watermark: newWatermark(note), extras: [{ id: 'second', feature: 'watermark', layer: { ...newWatermark(note), xMm: 80, name: 'Watermark 2' } }] }
}
/** A banknote with a second thread, `t2`, with its own lens */
function twoThreads(): Note {
  const note = banknote()
  return { ...note, extras: [{ id: 't2', feature: 'thread', thread: { thread: { ...note.thread, positionMm: 30 }, frames: note.frames, pattern: note.pattern, lens: { effect: 'side', cycleDeg: 40 } } }] }
}
const second = (note: Note) => note.extras?.find((x) => x.id === 'second') as Extract<ExtraFeature, { feature: 'watermark' }> | undefined

beforeEach(() => {
  held.note = banknote()
  held.steps = []
})

describe('a further feature’s view', () => {
  it('is the banknote with it in the first of its kind’s place, under an id of its own, without the others', () => {
    const note = twoWatermarks()
    const view = extraView(note, note.extras![0])
    expect(view.id).toBe(partNoteId('n', 'second'))
    expect(splitNoteId(view.id)).toEqual({ noteId: 'n', extraId: 'second' })
    expect(splitNoteId('n')).toEqual({ noteId: 'n' })
    expect(view.watermark).toBe(second(note)!.layer)
    expect(view.extras).toBeUndefined()
    expect({ ...view, id: note.id, watermark: note.watermark, extras: note.extras }).toEqual(note)
    expect(noteOrPart(note, view.id)).toEqual(view)
    expect(noteOrPart(note, 'n/gone')).toBeUndefined()
    expect(noteOrPart(note, 'n')).toBe(note)
  })

  it('of a thread brings its frames, sections and lens, the banknote keeping its playback, with or without a thread of its own', () => {
    const note = { ...twoThreads(), tilt: { ...banknote().tilt, speed: 2, moves: [] } }
    const view = extraView(note, note.extras![0])
    expect(view.thread.positionMm).toBe(30)
    expect(view.tilt).toMatchObject({ effect: 'side', cycleDeg: 40, speed: 2, moves: [] })
    expect(view.tilt.runY).toBeUndefined()
    expect(extraView({ ...note, noThread: true }, note.extras![0]).noThread).toBeUndefined()
  })

  it('takes changes back to the feature: its box, its lens, even its removal; a thread’s playback goes to the banknote', () => {
    const note = { ...twoWatermarks(), extras: [...twoWatermarks().extras!, ...twoThreads().extras!] }
    const moved = throughExtra(note, 'second', (v) => ({ ...v, watermark: { ...v.watermark!, xMm: 90 } }))
    expect(second(moved)!.layer.xMm).toBe(90)
    expect(moved.watermark).toBe(note.watermark)
    // Nothing changed, nothing new
    expect(throughExtra(note, 'second', (v) => v)).toBe(note)
    expect(throughExtra(note, 'gone', () => banknote())).toBe(note)

    const relensed = throughExtra(note, 't2', (v) => ({ ...v, tilt: { ...v.tilt, cycleDeg: 60, speed: 3 } }))
    expect(relensed.extras![1]).toMatchObject({ thread: { lens: { effect: 'side', cycleDeg: 60 } } })
    expect(relensed.tilt).toMatchObject({ cycleDeg: note.tilt.cycleDeg, speed: 3 })
    expect(relensed.tilt.effect).toBe(note.tilt.effect)

    const removed = throughExtra(throughExtra(note, 'second', (v) => ({ ...v, watermark: undefined })), 't2', (v) => ({ ...v, noThread: true }))
    expect(removed.extras).toBeUndefined()
    expect(removed.watermark).toBe(note.watermark)
  })

  it('is what the store reads and writes by the view’s id', () => {
    held.note = twoWatermarks()
    updateWatermark({ projectId: 'p', noteId: partNoteId('n', 'second') }, (w) => ({ ...w, depth: 0.25 }))
    expect(second(held.note)!.layer.depth).toBe(0.25)
    expect(held.note.watermark!.depth).not.toBe(0.25)
    placeLayer({ projectId: 'p', noteId: partNoteId('n', 'second') }, 'watermark', { xMm: 5, yMm: 6, widthMm: 20, heightMm: 20 })
    expect(second(held.note)!.layer).toMatchObject({ xMm: 5, yMm: 6, widthMm: 20 })
  })
})

describe('a banknote’s security features, as many of each as it has', () => {
  it('lists them by kind, each kind’s first one first, the rest as added, each as its own code sees it', () => {
    const note = { ...twoThreads(), watermark: newWatermark(banknote()), extras: [...twoThreads().extras!, ...twoWatermarks().extras!], magneticInk: newMagneticInk(banknote()) }
    expect(featureParts(note).map((p) => [p.layer, p.note.id])).toEqual([
      ['thread', 'n'], ['thread/t2', 'n/t2'], ['watermark', 'n'], ['watermark/second', 'n/second'], ['magneticInk', 'n'],
    ])
    expect(featurePart(note, 'watermark/second')?.note.watermark?.xMm).toBe(80)
    expect(featurePart(note, 'arcEnCiel')).toBeUndefined()
    expect(featurePart(note, 'magneticInk/second')).toBeUndefined()
    expect(featurePart(note, 'note')).toBeUndefined()
    // One gone (undone, say) shows the banknote itself
    expect(layerOf(note, 'watermark/second')).toBe('watermark/second')
    expect(layerOf(note, 'watermark/gone')).toBe('note')
  })

  it('names another of a kind with the next number none goes by', () => {
    const note = twoWatermarks()
    expect(nextName(note, 'watermark')).toBe('Watermark 3')
    expect(nextName(note, 'thread')).toBe('Security thread 2')
    expect(nextName({ ...note, watermark: { ...note.watermark!, name: 'Watermark 3' } }, 'watermark')).toBe('Watermark 4')
  })

  it('moves the next of a kind up into the first one’s place when that one goes', () => {
    const note = twoWatermarks()
    const { watermark: _gone, ...without } = note
    const promoted = promoteExtra(without, 'watermark')
    expect(promoted.watermark).toBe(second(note)!.layer)
    expect(promoted.extras).toBeUndefined()
    expect(promoteExtra(note, 'watermark')).toBe(note)

    const threads = twoThreads()
    const thread = promoteExtra({ ...threads, noThread: true }, 'thread')
    expect(thread.noThread).toBeUndefined()
    expect(thread.thread.positionMm).toBe(30)
    expect(thread.tilt).toMatchObject({ effect: 'side', cycleDeg: 40 })
    expect(thread.extras).toBeUndefined()
  })

  it('keeps every one where it was when the banknote is resized, not only the first of each', () => {
    const note = twoWatermarks()
    const resized = withEveryPart(note, (n) => fitLayers({ ...n, widthMm: 60, heightMm: 40 }, n))
    for (const box of [resized.watermark!, second(resized)!.layer] as Watermark[]) {
      expect(box.xMm + box.widthMm).toBeLessThanOrEqual(60 + 1e-9)
      expect(box.yMm + box.heightMm).toBeLessThanOrEqual(40 + 1e-9)
    }
    expect(resized.widthMm).toBe(60)
  })

  it('keeps a further thread’s tile on Fit following it, as the first one’s', () => {
    const note = twoThreads()
    const widened = { ...note, extras: [{ ...note.extras![0], thread: { ...(note.extras![0] as Extract<ExtraFeature, { feature: 'thread' }>).thread, thread: { ...note.thread, widthMm: 6 } } }] as ExtraFeature[] }
    const project = { ...createProject('P'), notes: [widened] }
    const fitted = fitTiles(project).notes[0].extras![0] as Extract<ExtraFeature, { feature: 'thread' }>
    expect(fitted.thread.pattern!.repeatMm).toBe(6)
    expect(fitTiles(fitTiles(project))).toEqual(fitTiles(project))
  })

  it('saves every image they use, with the banknote’s own', () => {
    const note = { ...twoWatermarks(), extras: [{ ...twoWatermarks().extras![0], layer: { ...second(twoWatermarks())!.layer, imageId: 'second art' } }] as ExtraFeature[] }
    expect(extraImageIds(note)).toEqual(['second art'])
    expect(projectImageIds({ ...createProject('P'), notes: [note] })).toContain('second art')
  })
})

describe('adding and removing them', () => {
  it('adds the first of a kind in its place, then more after it, each named, beside the others, with a stand-in image', async () => {
    expect(addFeature(ref, 'watermark')).toBe('watermark')
    await vi.waitFor(() => expect(held.note!.watermark!.imageId).toBe('stand-in'))
    const layer = addFeature(ref, 'watermark')
    const id = held.note!.extras![0].id
    expect(layer).toBe(partLayer('watermark', id))
    const further = second({ ...held.note!, extras: held.note!.extras!.map((x) => ({ ...x, id: 'second' })) })!.layer
    expect(further.name).toBe('Watermark 2')
    // Beside the first, not under it
    expect([further.xMm, further.yMm]).not.toEqual([held.note!.watermark!.xMm, held.note!.watermark!.yMm])
    await vi.waitFor(() => expect(featurePart(held.note!, layer)!.note.watermark!.imageId).toBe('stand-in'))
    expect(held.note!.watermark!.name).toBeUndefined()
    expect(held.steps.slice(-2)).toEqual(['begin', 'end'])
  })

  it('adds another thread across from the first, with fresh frames, the banknote’s lens and its own name', () => {
    held.note = { ...banknote(), tilt: { ...banknote().tilt, effect: 'side' } }
    const layer = addFeature(ref, 'thread')
    const added = featurePart(held.note, layer)!.note
    expect(added.thread.name).toBe('Security thread 2')
    expect(Math.abs(added.thread.positionMm - held.note.thread.positionMm)).toBeGreaterThanOrEqual(added.thread.widthMm)
    expect(added.frames.map((f) => f.id)).not.toEqual(held.note.frames.map((f) => f.id))
    expect(added.tilt.effect).toBe('side')
  })

  it('renames and removes a further one alone, and the first gives its place to the next', async () => {
    held.note = twoWatermarks()
    renameFeature({ projectId: 'p', noteId: partNoteId('n', 'second') }, 'watermark', 'Portrait')
    expect(second(held.note)!.layer.name).toBe('Portrait')
    const first = held.note.watermark
    await removeFeature(ref, 'watermark/second')
    expect(held.note.extras).toBeUndefined()
    expect(held.note.watermark).toBe(first)

    held.note = twoWatermarks()
    const next = second(held.note)!.layer
    await removeFeature(ref, 'watermark')
    expect(held.note.watermark).toBe(next)
    expect(held.note.extras).toBeUndefined()

    held.note = twoThreads()
    await removeFeature(ref, 'thread')
    expect(held.note.thread.positionMm).toBe(30)
    expect(held.note.noThread).toBeUndefined()
    await removeFeature(ref, 'thread')
    expect(held.note.noThread).toBe(true)
  })
})

describe('further features saved', () => {
  const save = (note: unknown) => migrateProject({ ...createProject('P'), notes: [note] }).notes[0]

  it('read back as saved, a damaged one put back on its banknote and one that can’t be read left out', () => {
    const note = { ...twoWatermarks(), extras: [...twoWatermarks().extras!, ...twoThreads().extras!] }
    expect(save(structuredClone(note))).toEqual(note)
    const damaged = save({
      ...structuredClone(note),
      extras: [
        { id: 'second', feature: 'watermark', layer: { ...second(note)!.layer, xMm: 5000 } },
        { id: 'junk', feature: 'hologram', layer: {} },
        { id: 'bare', feature: 'magneticInk' },
        'nonsense',
        { id: 'second', feature: 'thread', thread: { thread: note.thread, frames: note.frames, lens: { effect: 'side' } } },
      ],
    })
    expect(damaged.extras!.map((x) => x.feature)).toEqual(['watermark', 'thread'])
    const box = (damaged.extras![0] as Extract<ExtraFeature, { feature: 'watermark' }>).layer
    expect(box.xMm).toBeLessThan(150)
    // The repeated id takes a new one
    expect(damaged.extras![1].id).not.toBe('second')
  })

  it('never leave further ones without the first of their kind: the next moves up', () => {
    const note = twoWatermarks()
    const { watermark: _gone, ...without } = note
    const read = save(structuredClone(without))
    expect(read.watermark).toEqual(second(note)!.layer)
    expect(read.extras).toBeUndefined()
  })

  it('leave banknotes from before as they were', () => {
    const note = banknote()
    expect(save(structuredClone(note))).toEqual(note)
    expect(save(structuredClone(note)).extras).toBeUndefined()
  })
})
