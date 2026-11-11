import { describe, expect, it } from 'vitest'
import { newArcEnCiel } from '../src/lib/arcEnCiel'
import { featureCopy, featureImageIds, withFeatureCopy } from '../src/lib/copyFeature'
import { newMagneticInk } from '../src/lib/magneticInk'
import { colorFrame, createNote, withNewThread } from '../src/lib/notes'
import { presetPattern } from '../src/lib/patternPresets'
import { isWhollyOn } from '../src/lib/placed'
import type { Note } from '../src/lib/types'
import { newWatermark } from '../src/lib/watermark'

/** A banknote as New banknote makes it: no security features yet */
const banknote = (widthMm = 150, heightMm = 70): Note =>
  ({ ...createNote({ name: 'Banknote', x: 0, y: 0, widthMm, heightMm, color: '#123456' }), noThread: true })

/** A banknote with a thread worth copying: an image frame and a colour one, a split pattern following them, its own lens and playback */
function threaded(widthMm = 150, heightMm = 70): Note {
  const note = withNewThread(banknote(widthMm, heightMm))
  const frames = [{ ...note.frames[0], kind: 'image' as const, imageId: 'bird', aspect: 1.5 }, colorFrame(1)]
  const withFrames = { ...note, frames }
  const split = presetPattern(withFrames, 'split')
  const [lane, ...lanes] = split.sections
  return {
    ...withFrames,
    thread: { ...note.thread, name: 'Bird thread', widthMm: 5, positionMm: 90, backgroundColor: '#ffeedd',
      windows: { enabled: true, sections: [{ id: 'w1', startMm: 5, endMm: 20 }, { id: 'w2', startMm: 50, endMm: 65 }] } },
    // One lane tells its own story: the second frame, then the first
    pattern: { ...split, sections: [{ ...lane, track: [frames[1].id, frames[0].id] }, ...lanes] },
    tilt: { ...note.tilt, effect: 'side', cycleDeg: 44, flatAt: 2, speed: 2, curve: 'linear', transition: 0.4,
      moves: [{ id: 'hold', kind: 'hold', seconds: 2 }] },
  }
}

describe('copying a security feature', () => {
  it('copies a placed layer as it is, its name, image and turn included, apart from the banknote', () => {
    const note = banknote()
    const watermark = { ...newWatermark(note), name: 'Bird', imageId: 'portrait', rotationDeg: 30, invert: true as const }
    const copy = featureCopy({ ...note, watermark }, 'watermark')
    expect(copy).toEqual({ feature: 'watermark', layer: watermark })
    expect(copy?.feature === 'watermark' && copy.layer).not.toBe(watermark)
  })

  it('copies nothing of a feature the banknote hasn’t got', () => {
    expect(featureCopy(banknote(), 'magneticInk')).toBeUndefined()
    expect(featureCopy(banknote(), 'thread')).toBeUndefined()
  })

  it('copies a thread with its settings, frames, sections and lens, but not the project’s playback', () => {
    const note = threaded()
    const copy = featureCopy(note, 'thread')
    expect(copy).toEqual({ feature: 'thread', thread: {
      thread: note.thread, frames: note.frames, pattern: note.pattern,
      lens: { effect: 'side', cycleDeg: 44, flatAt: 2, runY: 'down', runX: 'right' },
    } })
  })

  it('lists the images it uses once each', () => {
    const note = threaded()
    const twice = { ...note, frames: [note.frames[0], { ...note.frames[1], kind: 'image' as const, imageId: 'bird' }] }
    expect(featureImageIds(featureCopy(twice, 'thread')!)).toEqual(['bird'])
    expect(featureImageIds(featureCopy({ ...banknote(), magneticInk: newMagneticInk(banknote()) }, 'magneticInk')!)).toEqual([])
  })
})

describe('pasting a security feature', () => {
  it('adds a placed layer where it sat on the other banknote, using its image’s copy', () => {
    const from = banknote()
    const arcEnCiel = { ...newArcEnCiel(from), imageId: 'disc', xMm: 20, yMm: 10, colors: ['#111111', '#222222', '#333333'] }
    const copy = featureCopy({ ...from, arcEnCiel }, 'arcEnCiel')!
    const pasted = withFeatureCopy(banknote(), copy, from, new Map([['disc', 'disc copy']]))
    expect(pasted.arcEnCiel).toEqual({ ...arcEnCiel, imageId: 'disc copy' })
  })

  it('takes the place of the one of that kind the banknote had', () => {
    const from = banknote()
    const ink = { ...newMagneticInk(from), imageId: 'star', color: '#ff0000', name: 'Star' }
    const to = { ...banknote(), magneticInk: { ...newMagneticInk(from), imageId: 'old', color: '#000000', invert: true as const } }
    const pasted = withFeatureCopy(to, featureCopy({ ...from, magneticInk: ink }, 'magneticInk')!, from, new Map([['star', 'star copy']]))
    expect(pasted.magneticInk).toEqual({ ...ink, imageId: 'star copy' })
  })

  it('keeps a layer wholly on a smaller banknote if it was wholly on the other, and a quarter of it on otherwise', () => {
    const from = banknote(150, 70)
    const to = banknote(68, 120)
    const inside = { ...newWatermark(from), xMm: 100, yMm: 10, widthMm: 40, heightMm: 40 }
    const pasted = withFeatureCopy(to, featureCopy({ ...from, watermark: inside }, 'watermark')!, from).watermark!
    expect(isWhollyOn(pasted, to)).toBe(true)
    expect(pasted).toMatchObject({ xMm: 28, yMm: 10, widthMm: 40, heightMm: 40 })

    const bleeding = { ...inside, xMm: 130 }
    const hanging = withFeatureCopy(to, featureCopy({ ...from, watermark: bleeding }, 'watermark')!, from).watermark!
    expect(isWhollyOn(hanging, to)).toBe(false)
    expect(hanging.xMm).toBe(68 - 40 * 0.25)
  })

  it('gives a banknote without a thread this one: its frames with new ids and their images’ copies, sections following them', () => {
    const from = threaded()
    const to = banknote()
    const pasted = withFeatureCopy(to, featureCopy(from, 'thread')!, from, new Map([['bird', 'bird copy']]))
    expect(pasted.noThread).toBeUndefined()
    expect(pasted.thread).toEqual(from.thread)
    expect(pasted.frames.map(({ id: _id, ...frame }) => frame)).toEqual([{ ...from.frames[0], imageId: 'bird copy' }, from.frames[1]].map(({ id: _id, ...frame }) => frame))
    expect(pasted.frames.map((f) => f.id)).not.toEqual(from.frames.map((f) => f.id))
    const ids = new Map(from.frames.map((f, i) => [f.id, pasted.frames[i].id]))
    const track = from.pattern!.sections.find((s) => s.track)!.track!
    expect(pasted.pattern!.sections.find((s) => s.track)!.track).toEqual(track.map((id) => ids.get(id)))
    expect(pasted.pattern!.sections.map(({ track: _t, ...s }) => s)).toEqual(from.pattern!.sections.map(({ track: _t, ...s }) => s))
  })

  it('brings the thread’s lens and leaves the banknote’s playback as it was', () => {
    const from = threaded()
    const to = { ...banknote(), tilt: { ...banknote().tilt, effect: 'custom' as const, cycleXDeg: 77, yOn: false, speed: 0.5, transition: 1,
      moves: [{ id: 'flip', kind: 'flip' as const }] } }
    const { tilt } = withFeatureCopy(to, featureCopy(from, 'thread')!, from)
    expect(tilt).toEqual({ ...to.tilt, effect: 'side', cycleDeg: 44, flatAt: 2, runY: 'down', runX: 'right', cycleXDeg: undefined, yOn: undefined })
    expect('cycleXDeg' in tilt || 'yOn' in tilt).toBe(false)
  })

  it('keeps the thread on a banknote of another size: wholly on it if it was, its windows as far along as it is long', () => {
    const from = threaded(150, 70)
    const to = withNewThread(banknote(60, 120))
    const turned = { ...from, thread: { ...from.thread, direction: 'horizontal' as const, positionMm: 50 } }
    const pasted = withFeatureCopy(to, featureCopy(turned, 'thread')!, turned)
    // Horizontal, so it runs along the 60 mm width and sits down the 120 mm height
    expect(pasted.thread.positionMm).toBe(50)
    expect(pasted.thread.windows.sections).toEqual([{ id: 'w1', startMm: 5, endMm: 20 }, { id: 'w2', startMm: 50, endMm: 60 }])
    // 90 mm across a 150 mm banknote, 5 mm wide: on one 60 mm across, its far edge at the banknote's
    const upright = withFeatureCopy(to, featureCopy(from, 'thread')!, from)
    expect(upright.thread.positionMm).toBe(57.5)
    expect(upright.thread.windows.sections).toEqual(from.thread.windows.sections)
    // Hanging off the other's edge, it may hang off this one's too, its middle on it
    const hanging = { ...from, thread: { ...from.thread, positionMm: 149 } }
    expect(withFeatureCopy(to, featureCopy(hanging, 'thread')!, hanging).thread.positionMm).toBe(60)
  })

  it('takes the place of the thread a banknote had, sections and all, or none from a banknote from before sections', () => {
    const from = threaded()
    const own = threaded()
    const to = { ...own, frames: [...own.frames, colorFrame(2)], pattern: presetPattern(own, 'alternate') }
    const pasted = withFeatureCopy(to, featureCopy(from, 'thread')!, from)
    expect(pasted.frames).toHaveLength(2)
    expect(pasted.pattern!.sections.map((s) => s.name)).toEqual(['Lane ↔', 'Lane ↕'])
    const { pattern: _none, ...old } = from
    expect(withFeatureCopy(to, featureCopy(old, 'thread')!, old).pattern).toBeUndefined()
  })
})
