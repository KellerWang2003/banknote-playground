import { describe, expect, it, vi } from 'vitest'
import {
  CUT_MM, type DesignPixels, coverCrop, designChecks, edgeBreaks, failingChecks, fitContinuous, paperLight, threadBoxes, watermarkWeight,
} from '../src/lib/continuous'
import { createNote, migrateProject } from '../src/lib/notes'
import type { Reading } from '../src/lib/relief'
import type { Note } from '../src/lib/types'
import { FULL_LEVELS } from '../src/lib/watermark'

vi.mock('../src/lib/images', () => ({ loadImageUrl: async () => undefined }))

type Rgb = [number, number, number]
const PAPER: Rgb = [244, 241, 232]
const RED: Rgb = [192, 57, 43]
const NAVY: Rgb = [31, 42, 68]

/** A design read at 8 px per mm for a banknote of that size, each pixel painted by `paint` (x and y in px) */
function design(widthMm: number, heightMm: number, paint: (x: number, y: number) => Rgb = () => PAPER): DesignPixels {
  const width = widthMm * 8
  const height = heightMm * 8
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y)
      data.set([r, g, b, 255], (y * width + x) * 4)
    }
  }
  return { data, width, height, widthMm, heightMm, crop: { x: 0, y: 0 } }
}

/** Stripes 7.5 mm apart and lines 15 mm apart, clear of the edges, which tile both ways on a 150 × 75 mm banknote */
const tiling = (x: number, y: number): Rgb => (x % 120 >= 40 && x % 120 < 46 ? [47, 111, 94] : y % 60 >= 24 && y % 60 < 36 ? [159, 195, 217] : PAPER)

describe('the design as it shows on the banknote', () => {
  it('is cut to the banknote as object-fit: cover cuts it, centred', () => {
    expect(coverCrop(1500, 750, 150, 75)).toEqual({ sx: 0, sy: 0, sw: 1500, sh: 750, crop: { x: 0, y: 0 } })
    // Too tall for a 150 × 70 banknote: 2.5 mm off its top and bottom
    expect(coverCrop(1500, 750, 150, 70)).toMatchObject({ sx: 0, sy: 25, sw: 1500, sh: 700, crop: { x: 0, y: 2.5 } })
    // Too wide for a 140 × 75 one: 5 mm off its left and right
    expect(coverCrop(1500, 750, 140, 75)).toMatchObject({ sx: 50, sy: 0, crop: { x: 5, y: 0 } })
  })
})

describe('where the edges meet their copies on the sheet', () => {
  it('finds no break in a design that tiles', () => {
    expect(edgeBreaks(design(150, 75, tiling))).toEqual({ topBottom: [], leftRight: [] })
  })

  it('marks a block that touches one edge only, from where it starts to where it ends', () => {
    const block = design(150, 75, (x, y) => (x >= 320 && x < 480 && y >= 552 ? RED : x >= 1140 && y >= 160 && y < 240 ? NAVY : tiling(x, y)))
    expect(edgeBreaks(block)).toEqual({ topBottom: [{ startMm: 40, endMm: 60 }], leftRight: [{ startMm: 20, endMm: 30 }] })
  })

  it('lets a line cross the seam a pixel off, but not half a millimetre off', () => {
    const line = (offset: number) => design(150, 75, (x, y) => ((y < 300 ? x - offset : x) >= 400 && (y < 300 ? x - offset : x) < 402 ? NAVY : PAPER))
    expect(edgeBreaks(line(1)).topBottom).toEqual([])
    // Each end of the line misses the other: two stretches 0.25 mm apart, run together
    expect(edgeBreaks(line(4)).topBottom).toEqual([{ startMm: 50, endMm: 50.8 }])
  })

  it('takes a shade or two of difference as joining, and drops specks', () => {
    const shade = design(150, 75, (_x, y) => (y < 300 ? [46, 156, 143] : [49, 159, 146]))
    expect(edgeBreaks(shade).topBottom).toEqual([])
    const speck = design(150, 75, (x, y) => (x === 600 && y === 599 ? NAVY : PAPER))
    expect(edgeBreaks(speck).topBottom).toEqual([])
  })
})

describe('light paper', () => {
  const half = design(100, 50, (x) => (x < 400 ? [255, 255, 255] : [0, 0, 0]))
  const all = { x: 0, y: 0, width: 100, height: 50 }

  it('is the share of the paper darker than L* 80, with how dark that print is', () => {
    expect(paperLight(half, [all])).toEqual({ dark: 0.5, lightness: 0 })
    expect(paperLight(half, [{ x: 0, y: 0, width: 50, height: 50 }])).toEqual({ dark: 0, lightness: undefined })
    // Holes don't count, and nothing at all is no verdict
    expect(paperLight(half, [all], [{ x: 50, y: 0, width: 50, height: 50 }])?.dark).toBe(0)
    expect(paperLight(half, [])).toBeUndefined()
  })

  it("counts the watermark's paper by how much of its light falls there", () => {
    expect(paperLight(half, [all], [], (x) => (x < 50 ? 1 : 0))?.dark).toBe(0)
    expect(paperLight(half, [all], [], (x) => (x < 50 ? 1 : 3))?.dark).toBe(0.75)
  })

  it("reads the watermark's light from its image through its levels, and the whole box without one", () => {
    const reading: Reading = { key: 'w', thin: new Uint8ClampedArray([0, 255, 128, 0]), width: 2, height: 2, auto: FULL_LEVELS }
    const watermark = { imageId: 'w', xMm: 10, yMm: 10, widthMm: 20, heightMm: 20, depth: 1, levels: FULL_LEVELS }
    const weight = watermarkWeight(watermark, reading)!
    expect([weight(15, 15), weight(25, 15), weight(5, 5)]).toEqual([0, 1, 0])
    expect(weight(15, 25)).toBeCloseTo(128 / 255)
    expect(watermarkWeight(watermark, undefined)).toBeUndefined()
    expect(watermarkWeight({ ...watermark, imageId: undefined }, reading)).toBeUndefined()
    // Seen from the back of a 150 mm banknote it lies at 120 to 140 mm, the other way round
    const back = watermarkWeight({ ...watermark, xMm: 120 }, reading, true)!
    expect([back(125, 15), back(135, 15)]).toEqual([1, 0])
  })

  it('around the thread is where it shows: each window, or its whole length', () => {
    const note = createNote({ name: 'N', x: 0, y: 0, widthMm: 150, heightMm: 75, color: '#ffffff' })
    const windows = { enabled: true, sections: [{ id: 'a', startMm: 5, endMm: 17 }, { id: 'b', startMm: 24, endMm: 62 }] }
    expect(threadBoxes({ ...note, thread: { ...note.thread, windows } })).toEqual([{ x: 73, y: 5, width: 4, height: 12 }, { x: 73, y: 24, width: 4, height: 38 }])
    expect(threadBoxes({ ...note, thread: { ...note.thread, windows: { ...windows, enabled: false } } })).toEqual([{ x: 73, y: 0, width: 4, height: 75 }])
    expect(threadBoxes({ ...note, thread: { ...note.thread, direction: 'horizontal', positionMm: 30, windows: { ...windows, enabled: false } } }))
      .toEqual([{ x: 0, y: 28, width: 150, height: 4 }])
  })
})

describe('the checks', () => {
  const base = createNote({ name: 'N', x: 0, y: 0, widthMm: 150, heightMm: 75, color: '#ffffff' })
  const note: Note = { ...base, background: 'image', faceImageId: 'design', thread: { ...base.thread, windows: { enabled: false, sections: [] } } }
  const broken = design(150, 75, (x, y) => (x >= 320 && x < 480 && y >= 552 ? RED : x >= 1140 && y >= 160 && y < 240 ? NAVY : PAPER))
  const lines = (checks: ReturnType<typeof designChecks>) => Object.fromEntries(checks.map((c) => [c.id, c.issues.map((i) => i.text)]))

  it('with Continuous off, only ask for light paper', () => {
    expect(lines(designChecks(note, broken, undefined, 'mm'))).toEqual({ thread: [] })
  })

  it('with it on, list each break in the unit lengths read in', () => {
    const on = { ...note, continuous: { cutMm: 1 } }
    const checks = designChecks(on, broken, undefined, 'mm')
    expect(lines(checks)).toEqual({ trim: [], top: ['40 to 60 mm from the left'], side: ['20 to 30 mm from the top'], thread: [] })
    expect(failingChecks(checks)).toBe(2)
    expect(lines(designChecks(on, broken, undefined, 'cm')).top).toEqual(['4 to 6 cm from the left'])
  })

  it('count the breaks past a few, and say what is cut off to fit', () => {
    const on = { ...note, continuous: { cutMm: 1 } }
    const comb = design(150, 75, (x, y) => (y >= 590 && x % 80 < 16 ? NAVY : PAPER))
    expect(lines(designChecks(on, { ...comb, crop: { x: 0, y: 2.5 } }, undefined, 'mm'))).toMatchObject({
      trim: ['2.5 mm cut off its top and bottom to fit'],
      top: ['Breaks in 15 places, 20% of its length'],
    })
  })

  it('flag a watermark or a thread on darker print', () => {
    const watermark = { xMm: 10, yMm: 10, widthMm: 20, heightMm: 20, depth: 1 }
    // Darker print under the watermark's left half, and over the first of the 2 mm either side of the thread at 73 to 77 mm
    const print = design(150, 75, (x) => ((x >= 80 && x < 160) || (x >= 568 && x < 576) ? NAVY : PAPER))
    const checks = designChecks({ ...note, watermark }, print, undefined, 'mm')
    expect(lines(checks)).toEqual({ watermark: ['50% of it is over darker print'], thread: ['25% of it is darker print'] })
    expect(checks.find((c) => c.id === 'thread')?.issues[0].title).toBe('That print is L* 17 on average; light is 80 or more')
  })

  it('check the back where the watermark shows through it, at the other side, and not round the thread, which is only on the front', () => {
    const watermark = { xMm: 10, yMm: 10, widthMm: 20, heightMm: 20, depth: 1 }
    // Seen from the back the watermark lies at 120 to 140 mm: darker print over its right half, and where the thread runs on the front
    const print = design(150, 75, (x) => ((x >= 1040 && x < 1120) || (x >= 568 && x < 576) ? NAVY : PAPER))
    expect(lines(designChecks({ ...note, watermark }, print, undefined, 'mm', 'back'))).toEqual({ watermark: ['50% of it is over darker print'] })
    expect(lines(designChecks({ ...note, watermark }, print, undefined, 'mm'))).toEqual({ watermark: [], thread: ['25% of it is darker print'] })
  })
})

describe('saving the check', () => {
  it('keeps a check with its tolerance in range, and drops anything that is not one', () => {
    expect(fitContinuous({ cutMm: 0.5 })).toEqual({ cutMm: 0.5 })
    expect(fitContinuous({ cutMm: 9 })).toEqual({ cutMm: CUT_MM.max })
    expect(fitContinuous({ cutMm: 'wide' })).toEqual({ cutMm: CUT_MM.initial })
    expect(fitContinuous(true)).toBeUndefined()
    expect(fitContinuous(undefined)).toBeUndefined()
  })

  it('opens a project with it as saved, and without it when there was none', () => {
    const note = createNote({ name: 'N', x: 0, y: 0, widthMm: 150, heightMm: 75, color: '#ffffff' })
    const project = { id: 'p', name: 'P', createdAt: 0, updatedAt: 0, notes: [{ ...note, continuous: { cutMm: 0.8 } }, { ...note, id: 'b', continuous: 'on' }, { ...note, id: 'c' }] }
    const opened = migrateProject(structuredClone(project))
    expect(opened.notes.map((n) => n.continuous)).toEqual([{ cutMm: 0.8 }, undefined, undefined])
    expect(opened.notes.every((n, i) => i === 0 || !('continuous' in n))).toBe(true)
  })
})
