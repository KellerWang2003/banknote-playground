import { describe, expect, it, vi } from 'vitest'
import {
  drawExportFrame, drawFace, drawInk, exportLayout, exportSize, framePx, loadNoteAssets, perspectiveFor, playbackAngles, playbackTurns, playbackViews, projectRow, rotatedReach,
  sourceRow, tiltedBounds, turnsOver,
} from '../src/lib/exportRender'
import type { InkMask } from '../src/lib/inkMask'
import type { Relief } from '../src/lib/relief'
import { DEFAULT_INK, INK_BAR_LIGHT, INK_ROLL_DEG, barCentre, inkShift } from '../src/lib/magneticInk'
import { FLIP_SECONDS, PAPER } from '../src/lib/back'
import { createNote } from '../src/lib/notes'
import { SWEEP_SECONDS } from '../src/lib/playback'
import { copyStarts, imageBox } from '../src/lib/artwork'
import type { Note, PlaybackMove } from '../src/lib/types'

const loadImageUrl = vi.hoisted(() => vi.fn(async (_id: string, _px?: number): Promise<string | undefined> => undefined))
vi.mock('../src/lib/images', () => ({ loadImageUrl }))

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
