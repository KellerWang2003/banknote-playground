import { describe, expect, it } from 'vitest'
import { PAPER_GLARE, lampMirror, lightMove, lightStretch, paperLightAt } from '../src/lib/paper'
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
    // A third as white at one spread out, and barely there by two
    expect(paperLightAt(1 / 2.2) / PAPER_GLARE.white).toBeCloseTo(Math.exp(-1))
    expect(paperLightAt(2 / 2.2)).toBeLessThan(0.004)
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
