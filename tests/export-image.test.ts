import { afterEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { IMAGE_MIN_PX_PER_MM, MAX_IMAGE_PX, drawFace, drawStill, imageScale, imageSize, perspectiveFor, type NoteAssets } from '../src/lib/exportRender'
import { exportImages, fileTags } from '../src/lib/exportMedia'
import type { InkMask } from '../src/lib/inkMask'
import type { Relief } from '../src/lib/relief'
import { DEFAULT_INK } from '../src/lib/magneticInk'
import { inkLight } from '../src/lib/realisticInk'
import { bandSlide, newArcEnCiel } from '../src/lib/arcEnCiel'
import type { BandLook } from '../src/lib/bandMap'
import { PAPER } from '../src/lib/back'
import { lensMix } from '../src/lib/lens'
import { createNote } from '../src/lib/notes'
import type { Note } from '../src/lib/types'

// No uploaded image can be had here: banknotes are drawn on plain paper, at print quality
const loadImageUrl = vi.hoisted(() => vi.fn(async (_id: string, _px?: number): Promise<string | undefined> => undefined))
vi.mock('../src/lib/images', () => ({ loadImageUrl }))
const loadBandShape = vi.hoisted(() => vi.fn(async (_id: string, _invert?: boolean) => undefined))
vi.mock('../src/lib/bandMap', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/bandMap')>()), loadBandShape }))
// No WebGL either: the renderer notes what it was asked to draw
const gpu = vi.hoisted(() => ({ drawn: [] as unknown[][], bands: [] as unknown[][] }))
vi.mock('../src/lib/inkRenderer', () => ({
  drawLitInk: (...args: unknown[]) => {
    gpu.drawn.push(args)
    return true
  },
  drawBands: (...args: unknown[]) => {
    gpu.bands.push(args)
    return true
  },
}))

afterEach(() => vi.unstubAllGlobals())

const makeNote = (widthMm = 150, heightMm = 75) => createNote({ name: 'Test', x: 0, y: 0, widthMm, heightMm, color: '#ffffff' })

/** A canvas context that notes every call and every property set, in order */
function recorder() {
  const calls: unknown[][] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (key in target) return target[key as string]
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} })
      return (...args: unknown[]) => calls.push([key, ...args])
    },
    set(target, key, value) {
      calls.push(['=', key, value])
      target[key as string] = value
      return true
    },
  }) as unknown as OffscreenCanvasRenderingContext2D
  return { ctx, calls }
}

describe('a still image’s size', () => {
  it('matches the design pixel for pixel, as it covers the banknote', () => {
    // Keller's FIFTEEN: 2720 × 5360 px for 68 × 134 mm, 40 px a mm
    const note = makeNote(68, 134)
    expect(imageScale(note, { width: 2720, height: 5360 })).toBe(40)
    expect(imageSize(note, 40)).toEqual({ width: 2720, height: 5360 })
    // Of other proportions it is cut to the banknote's, as on the canvas: its width fits, pixel for pixel, its height is cut
    const wide = makeNote(150, 75)
    expect(imageScale(wide, { width: 3000, height: 2000 })).toBe(20)
    expect(imageSize(wide, 20)).toEqual({ width: 3000, height: 1500 })
  })

  it('never comes out under print quality, with or without a design, nor past the largest canvas', () => {
    const note = makeNote(150, 75)
    expect(imageScale(note)).toBe(IMAGE_MIN_PX_PER_MM)
    // 300 dpi
    expect(imageSize(note, imageScale(note))).toEqual({ width: 1772, height: 886 })
    // A 1× design of 10 px a mm is drawn at 300 dpi
    expect(imageScale(makeNote(68, 148), { width: 680, height: 1480 })).toBe(IMAGE_MIN_PX_PER_MM)
    const big = makeNote(500, 250)
    expect(imageSize(big, imageScale(big, { width: 50000, height: 25000 }))).toEqual({ width: MAX_IMAGE_PX, height: MAX_IMAGE_PX / 2 })
  })

  it('lies on its side when the canvas shows the banknotes so', () => {
    const note = makeNote(150, 75)
    expect(imageSize(note, 2, 1)).toEqual({ width: 150, height: 300 })
    expect(imageSize(note, 2, 2)).toEqual({ width: 300, height: 150 })
    expect(imageSize(note, 2, 3)).toEqual({ width: 150, height: 300 })
  })
})

describe('drawing a still image', () => {
  const watermark = { imageId: 'w', xMm: 10, yMm: 10, widthMm: 30, heightMm: 30, depth: 0.6 }
  const light = 'light' as unknown as HTMLCanvasElement
  const alphaAfterDodge = (calls: unknown[][]) => {
    const dodge = calls.findIndex((c) => c[0] === '=' && c[1] === 'globalCompositeOperation' && c[2] === 'color-dodge')
    return calls.slice(dodge).find((c) => c[0] === '=' && c[1] === 'globalAlpha')?.[2]
  }

  it('shows the watermark as held to the light at any angle, and the banknote flat, catching no light or shade', () => {
    const note: Note = { ...makeNote(150, 75), noThread: true, watermark }
    const assets: NoteAssets = { frames: new Map(), relief: { canvas: light } as Relief }
    for (const tilt of [{ x: 0, y: 0 }, { x: 15, y: -40 }]) {
      const { ctx, calls } = recorder()
      drawStill(ctx, note, assets, 2, tilt, { sheen: true })
      expect(alphaAfterDodge(calls)).toBe(watermark.depth)
      // The paper and nothing else over the whole banknote: no light or shade from turning
      expect(calls.filter((c) => c[0] === 'fillRect')).toEqual([['fillRect', 0, 0, 300, 150]])
      expect(calls).toContainEqual(['=', 'fillStyle', PAPER])
    }
    // On the canvas, flat in reflected light, it is only a hint
    const { ctx, calls } = recorder()
    drawFace(ctx, note, assets, 2, 0, { sheen: true, perspective: true })
    expect(alphaAfterDodge(calls)).toBeCloseTo(watermark.depth * 0.05)
  })

  it('shows the watermark held to the light on the back too, the other way round', () => {
    const note: Note = { ...makeNote(150, 75), watermark }
    const { ctx, calls } = recorder()
    drawStill(ctx, note, { frames: new Map(), relief: { canvas: light } as Relief }, 2, { x: 0, y: 25 }, { sheen: true, back: true })
    expect(alphaAfterDodge(calls)).toBe(watermark.depth)
    expect(calls).toContainEqual(['scale', -1, 1])
  })

  it('shows the thread’s frame, Arc-en-Ciel’s bands and magnetic ink as at the angle picked', () => {
    gpu.drawn = []
    gpu.bands = []
    const base = makeNote(150, 75)
    const arcEnCiel = { ...newArcEnCiel(base), imageId: 'a', flow: 'point' as const }
    const magneticInk = { imageId: 'i', xMm: 100, yMm: 10, widthMm: 20, heightMm: 20, ...DEFAULT_INK }
    const note: Note = { ...base, arcEnCiel, magneticInk }
    const assets: NoteAssets = { frames: new Map(), arc: { mask: { canvas: 'mask' } as unknown as InkMask }, ink: { canvas: 'mask' } as unknown as InkMask }
    const colours = new Set(note.frames.flatMap((f) => (f.kind === 'color' ? [f.color] : [])))
    const framesDrawn = (calls: unknown[][]) => calls.filter((c) => c[0] === '=' && c[1] === 'fillStyle' && colours.has(c[2] as string)).map((c) => c[2])
    const shown = (tilt: { x: number; y: number }) => {
      const mix = lensMix(note, tilt)
      const frame = note.frames[mix.base]
      return frame.kind === 'color' ? frame.color : undefined
    }

    const tilt = { x: 0, y: 15 }
    const { ctx, calls } = recorder()
    drawStill(ctx, note, assets, 40, tilt, { sheen: false, realistic: true })
    expect(framesDrawn(calls)).toEqual([shown(tilt)])
    expect(shown(tilt)).not.toBe(shown({ x: 0, y: 0 }))
    // Realistic: the ink lit at that angle, the banknote never turned over, with the grain a video as big would have
    expect(gpu.drawn).toHaveLength(1)
    expect(gpu.drawn[0][3]).toEqual(inkLight(magneticInk, note, tilt, perspectiveFor(note, 1)))
    // 150 mm at 40 px a mm is 6000 px across: a cell 3 px
    expect(gpu.drawn[0][5]).toBe(3)

    // Arc-en-Ciel's bands slid as far as that angle slides them (flat ink drawn on a scratch canvas of its own)
    gpu.bands = []
    const flat = recorder()
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return recorder().ctx }
    })
    drawStill(flat.ctx, note, assets, 2, tilt, { sheen: false })
    expect((gpu.bands[0][3] as BandLook).slide).toBe(bandSlide(arcEnCiel, tilt))
    expect(framesDrawn(flat.calls)).toEqual([shown(tilt)])
  })

  it('turns the banknote as the canvas shows it, still filling the image', () => {
    const note: Note = { ...makeNote(150, 75), noThread: true }
    const turns = (quarter: 0 | 1 | 2 | 3) => {
      const { ctx, calls } = recorder()
      drawStill(ctx, note, { frames: new Map() }, 2, { x: 0, y: 0 }, { sheen: false, quarter })
      return calls.filter((c) => c[0] === 'translate' || c[0] === 'rotate')
    }
    expect(turns(0)).toEqual([])
    // 300 × 150 px upright, 150 × 300 on its side
    expect(turns(1)).toEqual([['translate', 150, 0], ['rotate', Math.PI / 2]])
    expect(turns(2)).toEqual([['translate', 300, 150], ['rotate', Math.PI]])
    expect(turns(3)).toEqual([['translate', 0, 300], ['rotate', (3 * Math.PI) / 2]])
  })
})

describe('exporting still images', () => {
  /** Canvases that take any drawing and encode it as a tiny PNG, noting their sizes */
  const canvases = () => {
    const sizes: [number, number][] = []
    const quiet = new Proxy({}, { get: (_target, key) => (key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true })
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) { sizes.push([width, height]) }
      getContext() { return quiet }
      async convertToBlob(options?: { type?: string }) { return new Blob([new Uint8Array([137, 80, 78, 71])], { type: options?.type }) }
    })
    return sizes
  }

  it('names the side, then the tilt as the angle fields have it, saying nothing of it when flat', () => {
    expect(fileTags('front', { x: 0, y: 0 })).toBe(' (front)')
    expect(fileTags('front', { x: 0, y: 20 })).toBe(' (front, 20° up)')
    expect(fileTags('front', { x: 15, y: -10 })).toBe(' (front, 10° down, 15° right)')
    expect(fileTags('front', { x: -30, y: 0 })).toBe(' (front, 30° left)')
    expect(fileTags('back')).toBe(' (back)')
  })

  it('makes a PNG of a banknote at full resolution, named for it, its side and its angle', async () => {
    const sizes = canvases()
    const note = { ...makeNote(150, 75), name: 'Front: test' }
    const progress: number[] = []
    const file = await exportImages('Project', { notes: [note], tilt: { x: 0, y: 20 }, sheen: true }, (p) => progress.push(p), new AbortController().signal)
    expect(file.name).toBe('Project - Front- test (front, 20° up).png')
    expect(file.blob.type).toBe('image/png')
    expect(sizes).toEqual([[1772, 886]])
    expect(progress.at(-1)).toBe(1)
  })

  it('zips one PNG per banknote, on their sides when the canvas shows them so', async () => {
    const sizes = canvases()
    const notes = [makeNote(150, 75), makeNote(68, 134)]
    const file = await exportImages('Project', { notes, tilt: { x: 0, y: 0 }, sheen: true, quarter: 1 }, () => {}, new AbortController().signal)
    expect(file.name).toBe('Project - Banknotes.zip')
    expect(file.blob.type).toBe('application/zip')
    expect(sizes).toEqual([[886, 1772], [1583, 803]])
  })

  it('makes a PNG of the back, or of each side, each at its own design’s full resolution, the back’s named without the angle', async () => {
    // Keller's FIFTEEN on the front, 40 px a mm, and a 1× export of its back, 10 px a mm, which comes out at 300 dpi
    const pixels: Record<string, [number, number]> = { 'url:front-15': [2720, 5360], 'url:back-15': [680, 1340] }
    loadImageUrl.mockImplementation(async (id: string) => `url:${id}`)
    vi.stubGlobal('Image', class {
      naturalWidth = 0
      naturalHeight = 0
      onload?: () => void
      set src(url: string) {
        ;[this.naturalWidth, this.naturalHeight] = pixels[url]
        queueMicrotask(() => this.onload?.())
      }
    })
    try {
      const note: Note = { ...makeNote(68, 134), name: 'Fifteen', background: 'image', faceImageId: 'front-15',
        back: { background: 'image', color: '#ffffff', imageId: 'back-15' } }
      const tilt = { x: 0, y: 20 }
      let sizes = canvases()
      const back = await exportImages('Project', { notes: [note], tilt, sheen: true, side: 'back' }, () => {}, new AbortController().signal)
      expect(back.name).toBe('Project - Fifteen (back).png')
      expect(sizes).toEqual([[803, 1583]])

      sizes = canvases()
      const progress: number[] = []
      const both = await exportImages('Project', { notes: [note], tilt, sheen: true, side: 'both' }, (p) => progress.push(p), new AbortController().signal)
      // A zip named for the banknote, its front then its back
      expect(both.name).toBe('Project - Fifteen.zip')
      expect(Object.keys(unzipSync(new Uint8Array(await both.blob.arrayBuffer())))).toEqual(['Project - Fifteen (front, 20° up).png', 'Project - Fifteen (back).png'])
      expect(sizes).toEqual([[2720, 5360], [803, 1583]])
      expect(progress).toEqual([0.25, 0.5, 0.75, 1])
    } finally {
      loadImageUrl.mockImplementation(async () => undefined)
    }
  })

  it('zips the front and back of every banknote, named for each', async () => {
    canvases()
    const notes = [{ ...makeNote(150, 75), name: 'One' }, { ...makeNote(150, 75), name: 'Two' }]
    const file = await exportImages('Project', { notes, tilt: { x: 0, y: 0 }, sheen: true, side: 'both' }, () => {}, new AbortController().signal)
    expect(file.name).toBe('Project - Banknotes.zip')
    expect(Object.keys(unzipSync(new Uint8Array(await file.blob.arrayBuffer())))).toEqual([
      'Project - One (front).png', 'Project - One (back).png', 'Project - Two (front).png', 'Project - Two (back).png',
    ])
  })

  it('stops when cancelled', async () => {
    canvases()
    const controller = new AbortController()
    controller.abort()
    await expect(exportImages('Project', { notes: [makeNote()], tilt: { x: 0, y: 0 }, sheen: true }, () => {}, controller.signal)).rejects.toThrow()
  })
})
