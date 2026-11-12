import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LAMP_SHARE, LIGHT_REACH, PAPER_GLARE, drawPaperShade, lampMirror, lightBox, lightMove, lightStretch, paintPaperShade,
  paperLightAt, paperLighting, shadeSize,
} from '../src/lib/paper'
import { LAMP_HEIGHT_DEG } from '../src/lib/realisticInk'

const RAD = Math.PI / 180
/** The canvas's eye for a 150 mm banknote, mm */
const EYE = 330
/** How far above the eye the lamp hangs, mm out at the eye's distance */
const LAMP = Math.tan(LAMP_HEIGHT_DEG * RAD) * EYE

describe('where the paper mirrors the lamp', () => {
  it('sits above the middle when flat, halfway up to the lamp', () => {
    const at = lampMirror({ x: 0, y: 0 }, EYE)!
    expect(at.x).toBeCloseTo(0)
    expect(at.y).toBeCloseTo(-LAMP / 2)
  })

  it('reaches the middle with the top tipped back by half the lamp’s height, where magnetic ink’s bar rests too', () => {
    const at = lampMirror({ x: 0, y: LAMP_HEIGHT_DEG / 2 }, EYE)!
    expect(at.x).toBeCloseTo(0)
    expect(at.y).toBeCloseTo(0)
  })

  it('slides down the banknote as its top tips back, about the eye’s distance a radian', () => {
    const before = lampMirror({ x: 0, y: 9 }, EYE)!
    const after = lampMirror({ x: 0, y: 11 }, EYE)!
    expect((after.y - before.y) / (2 * RAD)).toBeGreaterThan(EYE * 0.9)
    expect((after.y - before.y) / (2 * RAD)).toBeLessThan(EYE * 1.1)
  })

  it('slides the other way from the side turning back, the same either way', () => {
    const right = lampMirror({ x: 8, y: 10 }, EYE)!
    const left = lampMirror({ x: -8, y: 10 }, EYE)!
    expect(right.x).toBeLessThan(-30)
    expect(left.x).toBeCloseTo(-right.x)
    expect(left.y).toBeCloseTo(right.y)
  })

  it('stays where the lamp is as the banknotes are rotated on screen, the room’s up along the banknote’s side', () => {
    const at = lampMirror({ x: 0, y: 0 }, EYE, 1)!
    expect(at.y).toBeCloseTo(0)
    expect(Math.abs(at.x)).toBeCloseTo(LAMP / 2)
    expect(lampMirror({ x: 0, y: 0 }, EYE, 2)!.y).toBeCloseTo(LAMP / 2)
  })

  it('is gone, and the light hidden, once the lamp is behind the paper', () => {
    expect(lampMirror({ x: 0, y: -80 }, EYE)).toBeUndefined()
    expect(lightMove({ widthMm: 150, heightMm: 75 }, 2, { x: 0, y: -80 }, 0)).toEqual({ opacity: 0 })
  })
})

describe('the paper’s glare', () => {
  it('is as white as the glare’s middle there, falling off to nothing at its reach', () => {
    expect(paperLightAt(0)).toBeCloseTo(PAPER_GLARE.white)
    const samples = Array.from({ length: 21 }, (_, i) => paperLightAt(i / 20))
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1])
    expect(paperLightAt(1)).toBe(0)
    // Matte paper's soft lobe: a quarter as white one spread out, and a long tail, still a twenty-fifth two out
    expect(paperLightAt(1 / LIGHT_REACH) / PAPER_GLARE.white).toBeCloseTo(1 / 4)
    expect(paperLightAt(2 / LIGHT_REACH) / PAPER_GLARE.white).toBeCloseTo(1 / 25)
    expect(paperLightAt(0.85)).toBeLessThan(0.005)
  })

  it('is big enough to roll across the banknote rather than whip past: half as white over more than half its length', () => {
    const note = { widthMm: 150, heightMm: 75 }
    // Its reach in mm, the canvas's eye 2.2 banknotes away
    const reach = (lightBox(note, 1).width as number) / 2
    expect(reach).toBeCloseTo(LIGHT_REACH * PAPER_GLARE.spread * EYE)
    // Half as white where the lobe is: 1 / (1 + u²)² = 1/2
    const half = Math.sqrt(Math.SQRT2 - 1) / LIGHT_REACH
    expect(paperLightAt(half) / PAPER_GLARE.white).toBeCloseTo(0.5, 2)
    expect(2 * half * reach).toBeGreaterThan(note.widthMm / 2)
  })

  it('stretches as the banknote is seen aslant, up to twice as far', () => {
    expect(lightStretch({ x: 0, y: 0 })).toEqual({ x: 1, y: 1 })
    expect(lightStretch({ x: 0, y: 60 }).y).toBeCloseTo(2)
    expect(lightStretch({ x: 75, y: 80 })).toEqual({ x: 2, y: 2 })
  })

  it('moves to where the lamp mirrors, at the banknote’s scale', () => {
    const note = { widthMm: 150, heightMm: 75 }
    const at = lampMirror({ x: 0, y: 0 }, EYE)!
    expect(lightMove(note, 2, { x: 0, y: 0 }, 0)).toEqual({ opacity: 1, transform: `translate(0.00px, ${(at.y * 2).toFixed(2)}px) scale(1.0000, 1.0000)` })
  })
})

describe('the lamp’s shading', () => {
  const lit = (tilt: { x: number; y: number }, quarter: 0 | 1 | 2 | 3 = 0) => paperLighting(tilt, EYE, quarter)

  it('is all of the light at the middle of a flat banknote, lighter towards the lamp and darker away, the same either side', () => {
    const flat = lit({ x: 0, y: 0 })
    expect(flat(0, 0)).toBeCloseTo(1)
    expect(flat(0, -30)).toBeGreaterThan(1)
    expect(flat(0, 30)).toBeLessThan(1)
    expect(flat(-60, 0)).toBeCloseTo(flat(60, 0))
    expect(flat(60, 0)).toBeLessThan(1)
    // A gentle fall: the bottom corners of a 150 by 75 mm banknote still have nine tenths of the light
    expect(flat(75, 37.5)).toBeGreaterThan(0.85)
    expect(flat(75, 37.5)).toBeLessThan(0.95)
  })

  it('lightens as the top tips back towards the lamp and darkens as it tips forward, to only the room’s light once turned from it', () => {
    expect(lit({ x: 0, y: 10 })(0, 0)).toBeGreaterThan(1)
    expect(lit({ x: 0, y: -10 })(0, 0)).toBeLessThan(1)
    expect(lit({ x: 0, y: -80 })(0, 0)).toBeCloseTo(1 - LAMP_SHARE)
    // Turned sideways either way, alike
    expect(lit({ x: 25, y: 0 })(0, 0)).toBeCloseTo(lit({ x: -25, y: 0 })(0, 0))
    expect(lit({ x: 25, y: 0 })(0, 0)).toBeLessThan(1)
  })

  it('stays where the lamp is as the banknotes are rotated on screen, lighter on the side the glare is on', () => {
    const turned = lit({ x: 0, y: 0 }, 1)
    expect(turned(0, -30)).toBeCloseTo(turned(0, 30))
    const glare = Math.sign(lampMirror({ x: 0, y: 0 }, EYE, 1)!.x)
    expect(turned(30 * glare, 0)).toBeGreaterThan(1)
    expect(turned(-30 * glare, 0)).toBeLessThan(1)
  })

  it('is painted as black where the paper is darker than flat at its middle and clear where it is lighter, into a few cells', () => {
    expect(shadeSize({ widthMm: 150, heightMm: 75 })).toEqual({ width: 96, height: 48 })
    expect(shadeSize({ widthMm: 68, heightMm: 120 })).toEqual({ width: 54, height: 96 })
    expect(shadeSize({ widthMm: 150, heightMm: 1 }).height).toBe(2)

    const note = { widthMm: 150, heightMm: 75 }
    const { width, height } = shadeSize(note)
    let painted: ImageData | undefined
    const g = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData: (image: ImageData) => (painted = image) }
    const canvas = { width, height, getContext: () => g } as unknown as HTMLCanvasElement
    paintPaperShade(canvas, note, { x: 0, y: 0 })
    const alpha = (i: number, j: number) => painted!.data[(j * width + i) * 4 + 3]
    const flat = paperLighting({ x: 0, y: 0 }, EYE)
    // A cell's middle, mm from the banknote's middle
    const at = (i: number, j: number) => [((i + 0.5) / width - 0.5) * 150, ((j + 0.5) / height - 0.5) * 75] as const
    expect(alpha(48, 0)).toBe(0)
    expect(alpha(48, height - 1)).toBe(Math.round(255 * (1 - flat(...at(48, height - 1)))))
    expect(alpha(0, height - 1)).toBeGreaterThan(alpha(48, height - 1))
    expect(alpha(0, height - 1)).toBe(alpha(width - 1, height - 1))
    // Turned from the lamp, the room's light alone, everywhere
    paintPaperShade(canvas, note, { x: 0, y: -80 })
    expect(alpha(10, 10)).toBe(Math.round(255 * LAMP_SHARE))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('is stretched over all of an export’s banknote, smoothly', () => {
    const sheet = { width: 0, height: 0, getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }
    vi.stubGlobal('document', { createElement: () => sheet })
    const drawn: unknown[][] = []
    const ctx = { save() {}, restore() {}, drawImage: (...args: unknown[]) => drawn.push(args) } as unknown as CanvasRenderingContext2D
    drawPaperShade(ctx, { widthMm: 150, heightMm: 75 }, 4, { x: 0, y: 10 }, 1)
    expect([sheet.width, sheet.height]).toEqual([96, 48])
    expect(drawn).toEqual([[sheet, 0, 0, 600, 300]])
    expect(ctx.imageSmoothingQuality).toBe('high')
  })
})
