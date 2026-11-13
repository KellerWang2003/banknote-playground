import { describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import {
  drawExportFrame, drawFace, drawInk, exportLayout, exportSides, exportSize, framePx, loadNoteAssets, perspectiveFor, playbackAngles, playbackTilts, playbackTurns,
  playbackViews, projectRow, rotatedReach, sourceRow, tiltedBounds, turnsOver,
} from '../src/lib/exportRender'
import { exportTilt } from '../src/lib/exportMedia'
import type { InkMask } from '../src/lib/inkMask'
import type { Relief } from '../src/lib/relief'
import { DEFAULT_INK, INK_BAR_LIGHT, INK_ROLL_DEG, barCentre, inkShift } from '../src/lib/magneticInk'
import { inkLight } from '../src/lib/realisticInk'
import { arcLight, bandSlide, newArcEnCiel } from '../src/lib/arcEnCiel'
import type { BandLook } from '../src/lib/bandMap'
import { FLIP_SECONDS, PAPER, turnDeg } from '../src/lib/back'
import { createNote } from '../src/lib/notes'
import { PAPER_THROUGH, featureShade } from '../src/lib/paper'
import { SWEEP_SECONDS } from '../src/lib/playback'
import { copyStarts, imageBox } from '../src/lib/artwork'
import type { Note, PlaybackMove } from '../src/lib/types'

const loadImageUrl = vi.hoisted(() => vi.fn(async (_id: string, _px?: number): Promise<string | undefined> => undefined))
vi.mock('../src/lib/images', () => ({ loadImageUrl }))
// Arc-en-Ciel's maps are worked out from its image, which jsdom can't read: a test asks only whether they were
const loadBandShape = vi.hoisted(() => vi.fn(async (_id: string, _invert?: boolean) => undefined))
vi.mock('../src/lib/bandMap', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/bandMap')>()), loadBandShape }))

// jsdom has no WebGL: realistic magnetic ink's renderer, and Arc-en-Ciel's, note what they were asked to draw, and draw
// it or not as told
const gpu = vi.hoisted(() => ({ lights: true, drawn: [] as unknown[][], bands: [] as unknown[][] }))
vi.mock('../src/lib/inkRenderer', () => ({
  drawLitInk: (...args: unknown[]) => {
    gpu.drawn.push(args)
    return gpu.lights
  },
  drawBands: (...args: unknown[]) => {
    gpu.bands.push(args)
    return true
  },
}))

// Realistic's lamp shading, which draws only on a page: a test notes where it was asked to shade, in the order drawn
const paperShade = vi.hoisted(() => ({ calls: [] as unknown[][], order: undefined as unknown[][] | undefined }))
vi.mock('../src/lib/paper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/paper')>()),
  drawPaperShade: (...args: unknown[]) => {
    paperShade.calls.push(args)
    paperShade.order?.push(['paperShade'])
  },
}))

const makeNote = (widthMm = 68, heightMm = 120) => createNote({ name: 'Test', x: 0, y: 0, widthMm, heightMm, color: '#ffffff' })

describe('playback angles', () => {
  it('goes from flat up through the cycle and back, like live playback', () => {
    const tilt = { cycleDeg: 30, transition: 0, speed: 1, curve: 'linear' as const }
    // A sweep up and one down at 1×, 40 frames each
    const angles = playbackAngles(tilt, 40 / SWEEP_SECONDS)
    expect(angles).toHaveLength(80)
    expect(angles[0]).toBe(0)
    expect(angles[20]).toBeCloseTo(15)
    expect(angles[40]).toBeCloseTo(30)
    expect(angles[60]).toBeCloseTo(15)
  })

  it('loops at the project speed, turning straight back at full tilt', () => {
    const tilt = { cycleDeg: 20, transition: 0, speed: 2, curve: 'smooth' as const }
    // Half a sweep's time up and half down at 2×: 10 frames each
    const angles = playbackAngles(tilt, 20 / SWEEP_SECONDS, 2)
    expect(angles).toHaveLength(40)
    expect(angles[10]).toBeCloseTo(20)
    expect(angles[13]).toBeLessThan(20)
    expect(angles[20]).toBeCloseTo(0)
    expect(angles[30]).toBeCloseTo(20)
  })
})

describe('tilt projection', () => {
  it('matches CSS rotateX under perspective: the far top edge narrows, the near bottom edge widens', () => {
    const top = projectRow(-60, 30, 500)
    const bottom = projectRow(60, 30, 500)
    expect(top.scale).toBeLessThan(1)
    expect(bottom.scale).toBeGreaterThan(1)
    // y' = y·cos a, scaled by p / (p − y·sin a)
    expect(bottom.y).toBeCloseTo(60 * Math.cos(Math.PI / 6) * (500 / (500 - 30)))
  })

  it('finds the source row for each screen row', () => {
    for (const y of [-50, -10, 0, 25, 60]) {
      const screen = projectRow(y, -40, 420).y
      expect(sourceRow(screen, -40, 420)).toBeCloseTo(y)
    }
  })

  it('keeps flat notes their own size', () => {
    expect(tiltedBounds(100, 200, 0, 400)).toEqual({ top: -100, bottom: 100, halfWidth: 50 })
  })
})

describe('layout', () => {
  it('places banknotes side by side with room for the tilt, at even pixel sizes', () => {
    const notes = [makeNote(), makeNote(80, 140)]
    const angles = [0, 30]
    const layout = exportLayout(notes, 5, angles, true)
    expect(layout.width % 2).toBe(0)
    expect(layout.height % 2).toBe(0)
    expect(layout.cells[1].cx).toBeGreaterThan(layout.cells[0].cx + 68 * 5 / 2)
    const near = tiltedBounds(80 * 5, 140 * 5, 30, perspectiveFor(notes[1], 5))
    expect(layout.width).toBeGreaterThanOrEqual(Math.ceil(layout.cells[1].cx + near.halfWidth))
  })

  it('sizes separate files by the largest banknote', () => {
    const notes = [makeNote(), makeNote(80, 140)]
    const together = exportSize(notes, { height: 720, fps: 30, loops: 1, perspective: false, separate: false })
    const apart = exportSize(notes, { height: 720, fps: 30, loops: 1, perspective: false, separate: true })
    expect(together.height).toBe(720)
    expect(apart.height).toBe(720)
    expect(apart.width).toBeLessThan(together.width)
    // The default playlist at 1×: a glide out to 30° at a 60° sweep's pace (half a sweep), then one sweep back to flat,
    // in whole frames
    expect(apart.seconds).toBeCloseTo(Math.round(1.5 * SWEEP_SECONDS * 30) / 30)
  })

  it('hits the chosen resolution with tilt, and keeps wide rows within 4K', () => {
    const notes = [makeNote()]
    expect(exportSize(notes, { height: 1080, fps: 30, loops: 1, perspective: true, separate: false }).height).toBe(1080)
    const row = Array.from({ length: 8 }, () => makeNote(150, 70))
    const wide = exportSize(row, { height: 2160, fps: 30, loops: 1, perspective: false, separate: false })
    expect(wide.width).toBeLessThanOrEqual(3840)
  })
})

describe('an image in the repeat', () => {
  it('fits the repeat and the thread by default, centred, and its copies fall one repeat apart', () => {
    // Twice as tall as wide on a 10 mm vertical thread: 20 mm long, centred in a 25 mm repeat
    const box = imageBox(undefined, 2, 25, 10, 'vertical')
    expect(box).toEqual({ along: 2.5, across: 0, alongSize: 20, acrossSize: 10 })
    expect(copyStarts(box, 25, 0, 90)).toEqual([2.5, 27.5, 52.5, 77.5])
    // A repeat shorter than the image shrinks it to fit, centred across
    expect(imageBox(undefined, 2, 10, 10, 'vertical')).toEqual({ along: 0, across: 2.5, alongSize: 10, acrossSize: 5 })
  })

  it('keeps images upright on horizontal threads', () => {
    expect(imageBox(undefined, 2, 25, 10, 'horizontal').alongSize).toBe(5)
  })

  it('carries a copy that runs past the repeat on into the next, and follows the repeat’s start', () => {
    const box = imageBox({ alongMm: 20, across: 0.25, size: 0.5 }, 2, 25, 10, 'vertical')
    expect(box).toEqual({ along: 20, across: 2.5, alongSize: 10, acrossSize: 5 })
    // The copy from before the stretch shows its last 5 mm at the start
    expect(copyStarts(box, 25, 0, 90)).toEqual([-5, 20, 45, 70])
    expect(copyStarts(box, 25, 3, 90)).toEqual([-2, 23, 48, 73])
  })
})

describe('images in an export', () => {
  it('works out how many pixels a frame’s image is drawn across, once its proportions are known', () => {
    const note = makeNote()
    const frame = { ...note.frames[0], kind: 'image' as const, imageId: 'art', aspect: 1.5 }
    const box = imageBox(undefined, 1.5, note.pattern!.repeatMm, note.thread.widthMm, note.thread.direction)
    expect(framePx(note, frame, 10)).toBeCloseTo(Math.max(box.acrossSize, box.alongSize) * 10)
    expect(framePx(note, { ...frame, aspect: undefined }, 10)).toBeUndefined()
  })

  it('draws the design and every frame from the originals, at the full resolution they were uploaded at', async () => {
    const plain = makeNote(150, 75)
    const frame = { ...plain.frames[0], kind: 'image' as const, imageId: 'art', aspect: 2 }
    const note = { ...plain, background: 'image' as const, faceImageId: 'design', frames: [frame, ...plain.frames.slice(1)] }
    loadImageUrl.mockClear()
    await loadNoteAssets(note, 10)
    expect(loadImageUrl).toHaveBeenCalledWith('design', undefined)
    expect(loadImageUrl).toHaveBeenCalledWith('art', undefined)
  })
})

describe('magnetic ink in an export', () => {
  it('draws what the canvas shows: Flat, Tilted over it as far as the note has turned, the bar where it rolled, through the mask', () => {
    const calls: [string, ...unknown[]][] = []
    const note = (name: string) => (...args: unknown[]) => calls.push([name, ...args])
    const layer = {
      set fillStyle(value: unknown) { calls.push(['fill', value]) },
      set globalAlpha(value: number) { calls.push(['alpha', value]) },
      set globalCompositeOperation(value: string) { calls.push(['composite', value]) },
      set imageSmoothingQuality(_value: string) {},
      fillRect: note('rect'),
      drawImage: note('draw'),
      createLinearGradient: (...args: unknown[]) => {
        calls.push(['gradient', ...args])
        return { addColorStop: note('stop') }
      },
    }
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return layer }
    })
    const ink = { xMm: 10, yMm: 5, widthMm: 30, heightMm: 20, ...DEFAULT_INK, barWidth: 0.25 }
    const tilt = { x: 0, y: INK_ROLL_DEG / 2 }
    const face = { drawImage: vi.fn() }
    drawInk(face as unknown as CanvasRenderingContext2D, ink, { canvas: 'mask' as unknown as HTMLCanvasElement }, (mm) => mm * 2, tilt)
    vi.unstubAllGlobals()

    expect(calls.slice(0, 6)).toEqual([
      ['fill', DEFAULT_INK.color], ['rect', 0, 0, 60, 40],
      ['alpha', inkShift(tilt)], ['fill', DEFAULT_INK.tiltedColor], ['rect', 0, 0, 60, 40], ['alpha', 1],
    ])
    // A level bar, white in its middle, rolled halfway down: its middle where the canvas's translate puts it
    const centre = barCentre(ink, 0.5) * 40
    expect(calls).toContainEqual(['gradient', 0, centre - 5, 0, centre + 5])
    expect(calls).toContainEqual(['stop', 0.5, `rgba(255,255,255,${INK_BAR_LIGHT})`])
    // Only where the shape takes ink, then onto the banknote at its box
    expect(calls.slice(-2)).toEqual([['composite', 'destination-in'], ['draw', 'mask', 0, 0, 60, 40]])
    expect(face.drawImage).toHaveBeenCalledWith(expect.anything(), 20, 10, 60, 40)
  })

  it('lights it as metal with the canvas’s renderer when Realistic, turned over and rotated as the banknote shows, else draws it flat', () => {
    gpu.drawn = []
    gpu.lights = true
    const note = makeNote(150, 70)
    const ink = { xMm: 10, yMm: 5, widthMm: 30.2, heightMm: 20, ...DEFAULT_INK }
    const face = { drawImage: vi.fn() }
    const mask = { canvas: 'mask' as unknown as HTMLCanvasElement }
    drawInk(face as unknown as CanvasRenderingContext2D, ink, mask, (mm) => mm * 2, { x: 3, y: 12 }, { note, turn: 0.2, quarter: 1, grain: 2 })
    expect(gpu.drawn).toEqual([[
      face, { x: 20, y: 10, width: 60.4, height: 40 }, 'mask', inkLight(ink, note, { x: 3 + turnDeg(0.2), y: 12 }, 2.2 * 150, 1), { width: 60, height: 40 }, 2,
    ]])
    expect(face.drawImage).not.toHaveBeenCalled()

    // Without WebGL, or with Realistic off (nothing to light it on), it keeps the flat look
    gpu.lights = false
    const layer = new Proxy({}, { get: (_target, key) => (key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true })
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return layer }
    })
    drawInk(face as unknown as CanvasRenderingContext2D, ink, mask, (mm) => mm * 2, { x: 3, y: 12 }, { note })
    expect(face.drawImage).toHaveBeenCalledTimes(1)
    drawInk(face as unknown as CanvasRenderingContext2D, ink, mask, (mm) => mm * 2, { x: 3, y: 12 })
    vi.unstubAllGlobals()
    expect(face.drawImage).toHaveBeenCalledTimes(2)
    expect(gpu.drawn).toHaveLength(2)
  })

  it('turns realistic ink over with the banknote only as it shows turning, in perspective, with a grain for the video’s size', () => {
    gpu.drawn = []
    gpu.lights = true
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
      set: (target, key, value) => {
        target[key as string] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    const note = { ...makeNote(150, 70), noThread: true, magneticInk: { imageId: 'i', xMm: 100, yMm: 10, widthMm: 20, heightMm: 20, ...DEFAULT_INK } }
    const assets = { frames: new Map(), ink: { canvas: 'mask' } as unknown as InkMask }
    drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: true, realistic: true, turn: 0.3, quarter: 3, grain: 2 })
    drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: false, realistic: true, turn: 0.3, quarter: 3 })
    // Opaque, it is shaded as Realistic's paper round it is, at the same tilt
    const eye = perspectiveFor(note, 1)
    const lit = (x: number) => inkLight(note.magneticInk, note, { x, y: 10 }, eye, 3, featureShade(note.magneticInk, note, { x, y: 10 }, eye, 3))
    expect(gpu.drawn.map((args) => [args[3], args[5]])).toEqual([[lit(turnDeg(0.3)), 2], [lit(0), 1]])
    // With Realistic off it is drawn flat, on a scratch canvas of its own
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return ctx }
    })
    drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: true, turn: 0.3, quarter: 3 })
    vi.unstubAllGlobals()
    expect(gpu.drawn).toHaveLength(2)

    // An export frame passes its turn, its rotation and a grain cell a px of a 1080p video
    gpu.drawn = []
    const layout = exportLayout([note], 12, [0], true, 1)
    const faces = new Map([[note.id, { width: 1800, height: 840, getContext: () => ctx } as unknown as OffscreenCanvas]])
    // Turned in 3D on scratch canvases, which only need to take the drawing
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return ctx }
    })
    drawExportFrame(ctx, layout, new Map([[note.id, { front: assets }]]), faces, 12, { x: 0, y: 4 }, { sheen: false, perspective: true, realistic: true, quarter: 1 }, 0, 0.1)
    vi.unstubAllGlobals()
    const view = { x: turnDeg(0.1), y: 4 }
    expect(gpu.drawn.map((args) => args[3])).toEqual([inkLight(note.magneticInk, note, view, eye, 1, featureShade(note.magneticInk, note, view, eye, 1))])
    expect(gpu.drawn[0][5]).toBe(Math.max(1, Math.round(layout.height / 1080)))
  })
})

describe('Arc-en-Ciel in an export', () => {
  it('slides its bands with the tilt, or with Realistic on lights its ridges as the canvas does, turned over and rotated as the banknote shows', () => {
    gpu.bands = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
      set: (target, key, value) => {
        target[key as string] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    const base = makeNote(150, 70)
    const arc = { ...newArcEnCiel(base), imageId: 'a', flow: 'point' as const }
    const assets = { frames: new Map(), arc: { mask: { canvas: 'mask' } as unknown as InkMask } }
    const note = { ...base, noThread: true, arcEnCiel: arc }
    drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: true, turn: 0.3, quarter: 3 })
    drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: true, realistic: true, turn: 0.3, quarter: 3 })
    drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: false, realistic: true, turn: 0.3, quarter: 3 })
    const looks = gpu.bands.map((args) => args[3] as BandLook)
    expect(looks[0]).toMatchObject({ slide: bandSlide(arc, { x: 0, y: 10 }) })
    expect(looks[0]).not.toHaveProperty('lit')
    // Opaque, shaded as Realistic's paper round it is at the same tilt, its white edge, bare paper, letting through what
    // light from behind the paper does
    const lit = (view: { x: number; y: number }, through = 0) => arcLight(arc, view, 3, featureShade(arc, note, view, perspectiveFor(note, 1), 3, through))
    expect(looks[1]).toEqual({ ...looks[1], slide: 0, lit: lit({ x: turnDeg(0.3), y: 10 }) })
    // Without perspective, turning over leaves it lit as it was, as realistic ink is
    expect(looks[2]).toEqual({ ...looks[2], lit: lit({ x: 0, y: 10 }) })
    drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: false, realistic: true, quarter: 3, backlight: 0.5 })
    expect(gpu.bands.at(-1)![3]).toEqual({ ...looks[2], lit: lit({ x: 0, y: 10 }, PAPER_THROUGH * 0.5) })
  })

  it('reads the maps for its white edge, or when its bands start from the shape, and otherwise not', async () => {
    const base = makeNote(150, 70)
    const note = { ...base, arcEnCiel: { ...newArcEnCiel(base), imageId: 'a', flow: 'point' as const } }
    loadBandShape.mockClear()
    await loadNoteAssets(note, 10)
    expect(loadBandShape).not.toHaveBeenCalled()
    await loadNoteAssets({ ...note, arcEnCiel: { ...note.arcEnCiel, edgeMm: 1 } }, 10)
    expect(loadBandShape).toHaveBeenCalledWith('a', undefined)
    loadBandShape.mockClear()
    await loadNoteAssets({ ...note, arcEnCiel: { ...note.arcEnCiel, flow: 'edge' } }, 10)
    expect(loadBandShape).toHaveBeenCalledTimes(1)
  })
})

describe('Realistic’s lamp in an export', () => {
  it('shades the paper under the watermarks and the thread in its windows, turned over and rotated as it shows, in place of the light and shade of turning', () => {
    const calls: unknown[][] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(target, key) {
        if (key in target) return target[key as string]
        if (key === 'createLinearGradient') return (...args: unknown[]) => (calls.push([key, ...args]), { addColorStop() {} })
        return (...args: unknown[]) => calls.push([key, ...args])
      },
      set(target, key, value) {
        target[key as string] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    const light = { width: 1, height: 1 } as unknown as HTMLCanvasElement
    const note = { ...makeNote(150, 70), watermark: { imageId: 'w', xMm: 10, yMm: 5, widthMm: 20, heightMm: 30, depth: 0.6 } }
    const assets = { frames: new Map(), relief: { canvas: light } as unknown as Relief }
    paperShade.calls = []
    paperShade.order = calls
    try {
      drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: true, realistic: true, turn: 0.3, quarter: 3 })
      // On the banknote's own canvas (a proxy, so compared by itself), over all of it: once over the paper, again in the
      // thread's windows
      expect(paperShade.calls).toHaveLength(2)
      for (const call of paperShade.calls) expect(call[0]).toBe(ctx)
      // None of the light from behind comes through it here, nor ever through the thread, which is opaque
      expect(paperShade.calls.map((call) => call.slice(1))).toEqual([[note, 2, { x: turnDeg(0.3), y: 10 }, 3, 0], [note, 2, { x: turnDeg(0.3), y: 10 }, 3]])
      const keys = calls.map(([key]) => key)
      const watermark = calls.findIndex(([key, image]) => key === 'drawImage' && image === light)
      expect(keys.indexOf('paperShade')).toBeLessThan(watermark)
      // The thread's: within its clip, from the banknote's top left, then the clip let go
      const inThread = keys.lastIndexOf('paperShade')
      expect(inThread).toBeGreaterThan(watermark)
      expect(keys.lastIndexOf('clip', inThread)).toBeGreaterThan(watermark)
      expect(calls[inThread - 1]).toEqual(['translate', -2 * (note.thread.positionMm - note.thread.widthMm / 2), -0])
      expect(keys[inThread + 1]).toBe('restore')
      expect(calls.some(([key]) => key === 'createLinearGradient')).toBe(false)
      // The back too, and without perspective turning over leaves the lamp's light as it was, as it does the ink's
      drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: false, realistic: true, back: true, turn: 0.3, quarter: 3 })
      expect(paperShade.calls).toHaveLength(3)
      expect(paperShade.calls[2].slice(1)).toEqual([note, 2, { x: 0, y: 10 }, 3, 0])
      // With Realistic off, the light and shade of turning over everything, as before
      calls.length = 0
      drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: true, turn: 0.3, quarter: 3 })
      expect(paperShade.calls).toHaveLength(3)
      expect(calls.filter(([key]) => key === 'createLinearGradient')).toHaveLength(1)
      // Held to the light, a little of it comes through the paper, as far as it is held to it, and none through the thread
      paperShade.calls = []
      drawFace(ctx, note, assets, 2, { x: 0, y: 10 }, { sheen: false, perspective: false, realistic: true, quarter: 3, backlight: 0.5 })
      expect(paperShade.calls.map((call) => call.slice(4))).toEqual([[3, PAPER_THROUGH * 0.5], [3]])
    } finally {
      paperShade.order = undefined
    }
  })

  it('lets a little of the light from behind through the paper of a frame held to the light, or of a backlit one', () => {
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
      set: (target, key, value) => {
        target[key as string] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    const note = { ...makeNote(150, 70), noThread: true }
    const layout = exportLayout([note], 12, [0], true, 1)
    const faces = new Map([[note.id, { width: 1800, height: 840, getContext: () => ctx } as unknown as OffscreenCanvas]])
    const assets = new Map([[note.id, { front: { frames: new Map() } }]])
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return ctx }
    })
    paperShade.calls = []
    try {
      drawExportFrame(ctx, layout, assets, faces, 12, { x: 0, y: 4 }, { sheen: false, realistic: true }, 0.3)
      drawExportFrame(ctx, layout, assets, faces, 12, { x: 0, y: 4 }, { sheen: false, realistic: true, backlit: true })
      drawExportFrame(ctx, layout, assets, faces, 12, { x: 0, y: 4 }, { sheen: false, realistic: true })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(paperShade.calls.map((call) => call[5])).toEqual([PAPER_THROUGH * 0.3, PAPER_THROUGH, 0])
  })
})

describe('the back in an export', () => {
  it('draws the back’s paper and the watermark the other way round at the other side, and nothing of the thread or magnetic ink', () => {
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
    }) as unknown as CanvasRenderingContext2D
    const note = {
      ...makeNote(150, 75),
      back: { background: 'solid' as const, color: '#F0EAD6' },
      watermark: { imageId: 'w', xMm: 10, yMm: 10, widthMm: 30, heightMm: 30, depth: 0.6 },
      magneticInk: { imageId: 'i', xMm: 100, yMm: 10, widthMm: 20, heightMm: 20, ...DEFAULT_INK },
    }
    const light = 'light' as unknown as HTMLCanvasElement
    drawFace(ctx, note, { frames: new Map(), relief: { canvas: light } as Relief, ink: { canvas: 'mask' } as unknown as InkMask }, 2, 20, { sheen: true, perspective: true, back: true })
    // Plain paper, as on every banknote: a back's old colour no longer shows (Keller: they have to use the design)
    expect(calls).toContainEqual(['=', 'fillStyle', PAPER])
    // 150 − 10 − 30 = 110 mm: drawn from its right edge, at 140 mm, flipped
    expect(calls).toContainEqual(['translate', 280, 20])
    expect(calls).toContainEqual(['scale', -1, 1])
    expect(calls.filter((c) => c[0] === 'drawImage')).toEqual([['drawImage', light, 0, 0, 60, 60]])
    // The paper, then only the light and shade of the tilt: no thread, no sheen
    expect(calls.filter((c) => c[0] === 'fillRect')).toEqual([['fillRect', 0, 0, 300, 150], ['fillRect', 0, 0, 300, 150]])
    expect(calls).not.toContainEqual(['=', 'globalCompositeOperation', 'soft-light'])
  })

  it('loads only what the back shows: its design and the watermark', async () => {
    const plain = makeNote(150, 75)
    const frame = { ...plain.frames[0], kind: 'image' as const, imageId: 'art', aspect: 2 }
    const note = { ...plain, background: 'image' as const, faceImageId: 'design', back: { background: 'image' as const, color: '#ffffff', imageId: 'back' },
      frames: [frame, ...plain.frames.slice(1)] }
    loadImageUrl.mockClear()
    await loadNoteAssets(note, 10, true)
    expect(loadImageUrl.mock.calls.map(([id]) => id)).toEqual(['back'])
  })
})

describe('turning over in an export', () => {
  const withMoves = (note: Note, moves: PlaybackMove[]): Note => ({ ...note, tilt: { ...note.tilt, moves } })
  const flip: PlaybackMove = { id: 'f', kind: 'flip' }
  const swing: PlaybackMove = { id: 'a', kind: 'y', y: 30 }

  it('turns the banknotes over at each Flip, playing twice a loop when that leaves them on their other side', () => {
    const once = withMoves(makeNote(), [flip])
    expect(turnsOver(once)).toBe(true)
    expect(turnsOver(makeNote())).toBe(false)
    // Over to the back, then round to the front again, so a GIF comes round where it began
    const turns = playbackTurns(once, 20)
    expect(turns).toHaveLength(2 * FLIP_SECONDS * 20)
    expect(turns[0]).toBe(0)
    expect(turns[5]).toBeCloseTo(0.5)
    expect(turns[10]).toBeCloseTo(1)
    expect(turns[15]).toBeCloseTo(0.5)
    // From the backs, the other way round
    expect(playbackTurns(once, 20, 1, true)[0]).toBe(1)
    // Two Flips come round within a loop
    expect(playbackTurns(withMoves(makeNote(), [flip, { ...flip, id: 'g' }]), 20)).toHaveLength(2 * FLIP_SECONDS * 20)
    const options = { height: 720, fps: 30, loops: 1, perspective: true, separate: false }
    expect(exportSize([withMoves(makeNote(), [swing, flip])], options).seconds).toBeCloseTo(Math.round(2 * (2 * SWEEP_SECONDS + FLIP_SECONDS) * 30) / 30)
  })

  it('makes room for the banknotes turning edge-on, their near edge growing as it comes round', () => {
    const turning = withMoves(makeNote(150, 75), [swing, flip])
    expect(Math.max(...playbackViews(turning, 30).map((view) => Math.abs(view.x)))).toBeGreaterThan(85)
    const options = { height: 1080, fps: 30, loops: 1, perspective: true, separate: false }
    const still = exportSize([withMoves(makeNote(150, 75), [swing])], options)
    const turned = exportSize([turning], options)
    expect(turned.height).toBe(1080)
    // Drawn smaller to fit the same height
    expect(turned.width).toBeLessThan(still.width)
  })

  it('draws each banknote from its back’s assets from halfway round', () => {
    const drawn: unknown[] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(target, key) {
        if (key in target) return target[key as string]
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} })
        return key === 'drawImage' ? (image: unknown) => drawn.push(image) : () => {}
      },
      set(target, key, value) {
        target[key as string] = value
        return true
      },
    }) as unknown as OffscreenCanvasRenderingContext2D
    const note = makeNote(150, 75)
    const image = (side: string) => ({ side, naturalWidth: 300, naturalHeight: 150 }) as unknown as HTMLImageElement
    const assets = new Map([[note.id, { front: { face: image('front'), frames: new Map() }, back: { face: image('back'), frames: new Map() } }]])
    const faces = new Map([[note.id, { width: 300, height: 150, getContext: () => ctx } as unknown as OffscreenCanvas]])
    const layout = exportLayout([note], 2, [0], false)
    for (const [turn, side, other] of [[0.4, 'front', 'back'], [0.6, 'back', 'front']] as const) {
      drawn.length = 0
      drawExportFrame(ctx, layout, assets, faces, 2, 0, { sheen: false, perspective: false }, 0, turn)
      expect(drawn).toContainEqual(expect.objectContaining({ side }))
      expect(drawn).not.toContainEqual(expect.objectContaining({ side: other }))
    }
  })
})

describe('rotating in an export', () => {
  it('turns what a banknote reaches with it: on its side its reach up and down runs across, upside down its top is its bottom', () => {
    const reach = { top: -40, bottom: 60, halfWidth: 75 }
    expect(rotatedReach(reach, 0)).toEqual(reach)
    expect(rotatedReach(reach, 2)).toEqual({ top: -60, bottom: 40, halfWidth: 75 })
    // Each cell is as wide either side, so it takes the further of the two
    expect(rotatedReach(reach, 1)).toEqual({ top: -75, bottom: 75, halfWidth: 60 })
    expect(rotatedReach(reach, 3)).toEqual({ top: -75, bottom: 75, halfWidth: 60 })
  })

  it('lays the banknotes out on their sides, as the canvas shows them, and sizes the file for them', () => {
    const note = makeNote(150, 75)
    const upright = exportLayout([note], 2, [0], false)
    const turned = exportLayout([note], 2, [0], false, 1)
    // 6 mm round each at 2 px per mm: 150 × 75 mm upright, 75 × 150 on its side
    expect([upright.width, upright.height]).toEqual([324, 174])
    expect([turned.width, turned.height]).toEqual([174, 324])
    expect(exportLayout([note], 2, [0], false, 2)).toEqual(upright)
    const options = { height: 1080, fps: 30, loops: 1, perspective: false, separate: false }
    // 75 + 12 mm wide and 150 + 12 tall: 1080 px tall at 6⅔ px per mm
    expect(exportSize([note], { ...options, quarter: 1 })).toMatchObject({ height: 1080, width: 580 })
    expect(exportSize([note], options).width).toBeGreaterThan(exportSize([note], { ...options, quarter: 3 }).width)
  })

  it('draws each banknote tilted about its own axes, then turned about its middle', () => {
    const calls: unknown[][] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(target, key) {
        if (key in target) return target[key as string]
        return (...args: unknown[]) => calls.push([key, ...args])
      },
      set(target, key, value) {
        target[key as string] = value
        return true
      },
    }) as unknown as OffscreenCanvasRenderingContext2D
    const quiet = new Proxy({} as Record<string, unknown>, {
      get(target, key) {
        if (key in target) return target[key as string]
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} })
        return () => {}
      },
      set(target, key, value) {
        target[key as string] = value
        return true
      },
    }) as unknown as OffscreenCanvasRenderingContext2D
    const note = makeNote(150, 75)
    const face = { width: 300, height: 150, getContext: () => quiet } as unknown as OffscreenCanvas
    const assets = new Map([[note.id, { front: { frames: new Map() }, back: { frames: new Map() } }]])
    const faces = new Map([[note.id, face]])
    const layout = exportLayout([note], 2, [0], false, 1)
    const { cx, cy } = layout.cells[0]
    drawExportFrame(ctx, layout, assets, faces, 2, 0, { sheen: false, perspective: false, quarter: 1 }, 0, 0)
    const drawing = calls.filter((c) => c[0] !== 'clearRect')
    expect(drawing).toEqual([['save'], ['translate', cx, cy], ['rotate', Math.PI / 2], ['drawImage', face, -150, -75], ['restore']])
    // Upright, straight onto the canvas
    calls.length = 0
    drawExportFrame(ctx, exportLayout([note], 2, [0], false), assets, faces, 2, 0, { sheen: false, perspective: false }, 0, 0)
    expect(calls.filter((c) => c[0] !== 'clearRect').map((c) => c[0])).toEqual(['drawImage'])
  })
})

describe('exporting each side', () => {
  it('lists the sides an export makes files of, the front first', () => {
    expect(exportSides()).toEqual(['front'])
    expect(exportSides('back')).toEqual(['back'])
    expect(exportSides('both')).toEqual(['front', 'back'])
  })

  it('makes a video from the fronts and one from the backs, named for their sides, the back’s starting on the backs', async () => {
    // Every canvas notes the designs drawn on it and reads back blank; images take their size from nothing
    const drawn: string[] = []
    const context = () => new Proxy({}, {
      get: (_target, key) => {
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} })
        if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
        if (key === 'drawImage') return (image: { src?: string }) => { if (image.src) drawn.push(image.src) }
        return () => {}
      },
      set: () => true,
    })
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return context() }
    })
    vi.stubGlobal('Image', class {
      naturalWidth = 300
      naturalHeight = 150
      src = ''
      onload?: () => void
      constructor() { queueMicrotask(() => this.onload?.()) }
    })
    // The pause between GIF frames, without leaving message ports open
    vi.stubGlobal('MessageChannel', class {
      port1: { onmessage?: () => void } = {}
      port2 = { postMessage: () => queueMicrotask(() => this.port1.onmessage?.()) }
    })
    loadImageUrl.mockImplementation(async (id: string) => `url:${id}`)
    try {
      const note: Note = { ...makeNote(150, 75), name: 'Fifteen', background: 'image', faceImageId: 'front', back: { background: 'image', color: '#ffffff', imageId: 'back' } }
      const progress: number[] = []
      const file = await exportTilt('Project', { format: 'gif', notes: [note], separate: false, height: 36, fps: 5, loops: 1, sheen: false, perspective: false, side: 'both' },
        (p) => progress.push(p), new AbortController().signal)
      expect(file.name).toBe('Project - Fifteen.zip')
      expect(Object.keys(unzipSync(new Uint8Array(await file.blob.arrayBuffer())))).toEqual(['Project - Fifteen (front).gif', 'Project - Fifteen (back).gif'])
      const frames = playbackTilts(note, 5).length
      expect(drawn).toEqual([...Array(frames).fill('url:front'), ...Array(frames).fill('url:back')])
      expect(progress).toHaveLength(2 * frames)
      expect(progress.at(-1)).toBe(1)
    } finally {
      loadImageUrl.mockImplementation(async () => undefined)
      vi.unstubAllGlobals()
    }
  })
})

describe('further features in an export', () => {
  // Keller, 10 November: "you should be able to add multiple of the same security feature. so no limit"
  it('draws each one with the first of its kind, every watermark under every thread, each from its own assets', () => {
    const calls: unknown[][] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string]
        : key === 'createLinearGradient' ? () => ({ addColorStop() {} })
          : (...args: unknown[]) => { calls.push([key, ...args]) }),
      set: (target, key, value) => {
        target[key as string] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    const plain = makeNote(150, 70)
    const watermark = { xMm: 10, yMm: 10, widthMm: 20, heightMm: 20, depth: 1, imageId: 'a' }
    const note: Note = {
      ...plain, watermark,
      extras: [
        { id: 'w2', feature: 'watermark', layer: { ...watermark, xMm: 60, imageId: 'b' } },
        { id: 't2', feature: 'thread', thread: { thread: { ...plain.thread, positionMm: 30 }, frames: plain.frames, lens: {} } },
      ],
    }
    const relief = (canvas: string) => ({ canvas }) as unknown as Relief
    const assets = { frames: new Map(), relief: relief('A'), extras: new Map([['w2', { frames: new Map(), relief: relief('B') }], ['t2', { frames: new Map() }]]) }
    drawFace(ctx, note, assets, 2, { x: 0, y: 0 }, { sheen: false, perspective: false })
    const drawn = calls.filter(([name]) => name === 'drawImage').map(([, image, x]) => [image, x])
    expect(drawn).toEqual([['A', 20], ['B', 120]])
    // Each thread's strip, the first one's then the further one's, after the watermarks
    const strips = calls.flatMap((call, i) => (call[0] === 'translate' ? [[i, call[1]]] : []))
    expect(strips.map(([, x]) => x)).toEqual([(75 - 2) * 2, (30 - 2) * 2])
    expect(Math.min(...strips.map(([i]) => i as number))).toBeGreaterThan(calls.findLastIndex(([name]) => name === 'drawImage'))

    // A further feature without assets loaded for it is left out, and on the back only the watermarks show
    calls.length = 0
    drawFace(ctx, note, { ...assets, extras: new Map([['w2', { frames: new Map(), relief: relief('B') }]]) }, 2, 0, { sheen: false, perspective: false, back: true })
    expect(calls.filter(([name]) => name === 'drawImage').map(([, image]) => image)).toEqual(['A', 'B'])
    // (each watermark mirrored by a translate to its far edge, no thread's strip at the top)
    expect(calls.filter(([name]) => name === 'translate').map(([, x, y]) => [x, y])).toEqual([[280, 20], [180, 20]])
  })

  it('loads each further feature’s images with the banknote’s own, the design once', async () => {
    const plain = makeNote(150, 75)
    const frame = { ...plain.frames[0], kind: 'image' as const, imageId: 'second art', aspect: 2 }
    const note: Note = {
      ...plain, background: 'image', faceImageId: 'design',
      extras: [{ id: 't2', feature: 'thread', thread: { thread: plain.thread, frames: [frame, plain.frames[1]], lens: {} } }],
    }
    loadImageUrl.mockClear()
    const assets = await loadNoteAssets(note, 10)
    expect(loadImageUrl.mock.calls.map(([id]) => id).sort()).toEqual(['design', 'second art'])
    expect(assets.extras?.has('t2')).toBe(true)
    // Its back shows no thread, so nothing of it is loaded
    loadImageUrl.mockClear()
    await loadNoteAssets(note, 10, true)
    expect(loadImageUrl.mock.calls.map(([id]) => id)).toEqual([])
  })
})
