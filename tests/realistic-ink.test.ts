import { describe, expect, it } from 'vitest'
import { DEFAULT_INK, INK_ROLL_DEG, barCentre, inkRoll } from '../src/lib/magneticInk'
import {
  LAMP_ABOVE, MAX_INK_PIXELS, MAX_INK_SIDE, REAL_SHIFT_DEG, filmShift, flakeEdge, flakeNormal, hueTravel, inkLight, inkPixels, lampLobe, oklch,
  tiltMatrix, turned,
} from '../src/lib/realisticInk'
import type { MagneticInk } from '../src/lib/types'

const RAD = Math.PI / 180
const ink = (change: Partial<MagneticInk> = {}): MagneticInk => ({ xMm: 96, yMm: 8, widthMm: 14, heightMm: 54, ...DEFAULT_INK, realistic: true, ...change })
const note = { widthMm: 150, heightMm: 70 }
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * Where across the shape (0 to 1 the way the bar rolls, carried on past the edges) the flakes face a viewer far off
 * straight on at a tilt, so mirror a lamp at the viewer's eye back to it: the middle of the lamp's bar
 */
function barMiddle(barAxis: MagneticInk['barAxis'], barWidth: number, tilt: { x: number; y: number }) {
  const m = tiltMatrix(tilt)
  let best = { t: 0, facing: -Infinity }
  for (let t = -1; t <= 2; t += 0.0002) {
    const facing = dot(turned(m, flakeNormal(barAxis, barWidth, t)), [0, 0, 1])
    if (facing > best.facing) best = { t, facing }
  }
  return best.t
}

describe('realistic magnetic ink', () => {
  it('turns the banknote as NoteView does, rotateX then rotateY', () => {
    expect(tiltMatrix({ x: 0, y: 0 }).map((v) => v + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
    // Tilting up takes the top edge away from the viewer, and a side tilt the right edge
    expect(turned(tiltMatrix({ x: 0, y: 30 }), [0, -1, 0])[2]).toBeCloseTo(-Math.sin(30 * RAD))
    expect(turned(tiltMatrix({ x: 30, y: 0 }), [1, 0, 0])[2]).toBeCloseTo(-Math.sin(30 * RAD))
    // Both: the side turn first, then the up/down one, as CSS applies rotateX(y) rotateY(x)
    const [a, b] = [-35 * RAD, 20 * RAD]
    const sideFirst = [Math.cos(b) * 0.3 + Math.sin(b) * 0.5, -0.8, -Math.sin(b) * 0.3 + Math.cos(b) * 0.5]
    const expected = [sideFirst[0], Math.cos(a) * sideFirst[1] - Math.sin(a) * sideFirst[2], Math.sin(a) * sideFirst[1] + Math.cos(a) * sideFirst[2]]
    turned(tiltMatrix({ x: 20, y: -35 }), [0.3, -0.8, 0.5]).forEach((v, i) => expect(v).toBeCloseTo(expected[i]))
  })

  it("rests the lamp's bar in the middle flat and rolls it as the flat look's bar, off the edge by INK_ROLL_DEG", () => {
    for (const barWidth of [0.05, 0.3, 1]) {
      const level = ink({ barWidth })
      expect(barMiddle('y', barWidth, { x: 0, y: 0 })).toBeCloseTo(0.5, 3)
      for (const y of [-INK_ROLL_DEG, -8, 5, INK_ROLL_DEG / 2, INK_ROLL_DEG]) {
        expect(barMiddle('y', barWidth, { x: 0, y })).toBeCloseTo(barCentre(level, inkRoll(level, { x: 0, y })), 3)
      }
      // An upright bar rolls left as the right edge turns away
      const upright = ink({ barAxis: 'x', barWidth })
      for (const x of [-INK_ROLL_DEG, 7, INK_ROLL_DEG]) {
        expect(barMiddle('x', barWidth, { x, y: 0 })).toBeCloseTo(barCentre(upright, inkRoll(upright, { x, y: 0 })), 3)
      }
    }
    // A wider bar's flakes curve less, so it still rolls off in the same tilt
    expect(flakeEdge(1)).toBeCloseTo(flakeEdge(0) / 2)
  })

  it("makes the bar's bright core as wide as the flat look's bar: half as bright a quarter of a bar from its middle", () => {
    for (const barWidth of [0.1, 0.3, 0.8]) {
      // Flat, a flake a quarter of a bar from the middle turns this far, and its reflection twice as far
      const normal = flakeNormal('y', barWidth, 0.5 + barWidth / 4)
      const turn = Math.atan2(normal[1], normal[2])
      expect(Math.exp(-((2 * turn) ** 2) / lampLobe(barWidth) ** 2)).toBeCloseTo(0.5)
    }
  })

  it('reads colours in OKLCH and shifts them the shorter way round the hue wheel, a grey taking the other colour’s hue', () => {
    expect(oklch('#ffffff')[0]).toBeCloseTo(1, 3)
    expect(oklch('#ffffff')[1]).toBeCloseTo(0, 3)
    const red = oklch('#ff0000')
    expect(red[0]).toBeCloseTo(0.628, 3)
    expect(red[1]).toBeCloseTo(0.2577, 3)
    expect(red[2] / RAD).toBeCloseTo(29.23, 1)
    expect(hueTravel(350 * RAD, 10 * RAD) / RAD).toBeCloseTo(20)
    expect(hueTravel(10 * RAD, 350 * RAD) / RAD).toBeCloseTo(-20)
    expect(Math.abs(hueTravel(0, 3 * Math.PI))).toBeCloseTo(Math.PI)
    // Keller's 15 strip: pink round through red and yellow to green, as the thin film goes
    const strip = inkLight(ink({ color: '#c60057', tiltedColor: '#2e8b57' }), note, { x: 0, y: 0 }, 330)
    expect(strip.hue).toBeGreaterThan(0)
    expect(strip.flat[2] + strip.hue).toBeCloseTo(oklch('#2e8b57')[2])
    const grey = inkLight(ink({ color: '#808080', tiltedColor: '#2e8b57' }), note, { x: 0, y: 0 }, 330)
    expect(grey.flat[2]).toBeCloseTo(oklch('#2e8b57')[2])
    expect(grey.hue).toBeCloseTo(0)
  })

  it('shows the Flat colour square-on and the Tilted one from REAL_SHIFT_DEG, slowly at first, as a thin film does', () => {
    expect(filmShift(0)).toBe(0)
    expect(filmShift(REAL_SHIFT_DEG * RAD)).toBeCloseTo(1)
    expect(filmShift(70 * RAD)).toBe(1)
    const shifts = [5, 10, 20, 30, 40].map((deg) => filmShift(deg * RAD))
    shifts.slice(1).forEach((shift, i) => expect(shift).toBeGreaterThan(shifts[i]))
    expect(filmShift(15 * RAD)).toBeLessThan(15 / REAL_SHIFT_DEG)
  })

  it('sets the ink in its box from the middle of the banknote, the lamp just above the eye, both staying put as the banknotes rotate', () => {
    const light = inkLight(ink(), note, { x: 0, y: 12 }, 330)
    expect(light.origin).toEqual([96 - 75, 8 - 35])
    expect(light.size).toEqual([14, 54])
    expect(light.eye).toBe(330)
    expect(light.axis).toEqual([0, 1])
    expect(light.rot).toEqual(tiltMatrix({ x: 0, y: 12 }))
    expect(light.lobe).toBeCloseTo(lampLobe(DEFAULT_INK.barWidth))
    expect(light.lamp).toEqual([0, -LAMP_ABOVE * 330, 330])
    expect(light.down).toEqual([0, 1, 0])
    expect(inkLight(ink({ barAxis: 'x' }), note, { x: 0, y: 0 }, 330).axis).toEqual([1, 0])
    // Rotated a quarter turn right, the room's down runs along the banknote to its right edge, and so on round
    expect(inkLight(ink(), note, { x: 0, y: 0 }, 330, 1).down).toEqual([1, 0, 0])
    expect(inkLight(ink(), note, { x: 0, y: 0 }, 330, 2).down).toEqual([0, -1, 0])
    expect(inkLight(ink(), note, { x: 0, y: 0 }, 330, 3).down).toEqual([-1, 0, 0])
    expect(inkLight(ink(), note, { x: 0, y: 0 }, 330, 1).lamp).toEqual([-LAMP_ABOVE * 330, 0, 330])
  })

  it('draws with as many pixels as the ink shows with, up to a limit, its grain a px on screen', () => {
    expect(inkPixels(100, 50, 2)).toEqual({ width: 200, height: 100, cell: 2 })
    expect(inkPixels(30.4, 10.2, 1)).toEqual({ width: 30, height: 10, cell: 1 })
    // Zoomed far in: coarser, its grain with it, down to a cell a pixel
    const big = inkPixels(1500, 1500, 2)
    expect(big.width * big.height).toBeLessThanOrEqual(MAX_INK_PIXELS)
    expect(big.cell).toBeCloseTo(2 * (big.width / 3000), 2)
    expect(inkPixels(3000, 3000, 2).cell).toBe(1)
    expect(inkPixels(6000, 100, 1).width).toBe(MAX_INK_SIDE)
  })
})
