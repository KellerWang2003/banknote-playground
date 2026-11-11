import { describe, expect, it } from 'vitest'
import { eyeFrom, oneEuro, orientationMatrix, tiltFromEye, uprightQuarter, type Matrix } from '../src/lib/deviceTilt'
import { type Quarter } from '../src/lib/rotate'

const RAD = Math.PI / 180
type M3 = number[][]
const rows = (m: Matrix): M3 => [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]]
const flat = (m: M3) => m.flat() as unknown as Matrix
const times = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]))
const rotZ = (deg: number): M3 => {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD)
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]]
}
/**
 * The turn NoteView gives a banknote, rotateX(y) then rotateY(x), as CSS has it (y down), written in the phone's axes
 * (y up): the phone tilted as the banknote is on the canvas, in the viewer's own axes
 */
function cssTilt(y: number, x: number): M3 {
  const ca = Math.cos(y * RAD), sa = Math.sin(y * RAD), cb = Math.cos(x * RAD), sb = Math.sin(x * RAD)
  const rx = [[1, 0, 0], [0, ca, -sa], [0, sa, ca]]
  const ry = [[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]]
  const flip = [[1, 0, 0], [0, -1, 0], [0, 0, 1]]
  return times(times(flip, times(rx, ry)), flip)
}
/** Somewhere a phone might be held to look at it: tipped back a little, facing anywhere */
const REST = orientationMatrix({ alpha: 37, beta: 62, gamma: -8 })

describe('the phone’s tilt as the banknote’s', () => {
  it('is flat while the phone stays where it was held, however it spins flat in the hand', () => {
    const still = tiltFromEye(eyeFrom(REST, REST), 0, 0)
    expect(still.x).toBeCloseTo(0, 9)
    expect(still.y).toBeCloseTo(0, 9)
    const spun = flat(times(rows(REST), rotZ(33)))
    const tilt = tiltFromEye(eyeFrom(REST, spun), 0, 0)
    expect(tilt.x).toBeCloseTo(0, 9)
    expect(tilt.y).toBeCloseTo(0, 9)
  })

  it('gives back the tilt the phone was turned by, 1:1, as the canvas would show it', () => {
    for (const [y, x] of [[20, 0], [0, 20], [-35, 0], [0, -35], [25, 40], [-60, 15], [10, -70], [80, 30]]) {
      const now = flat(times(rows(REST), cssTilt(y, x)))
      const tilt = tiltFromEye(eyeFrom(REST, now), 0, 0)
      expect(tilt.y).toBeCloseTo(y, 9)
      expect(tilt.x).toBeCloseTo(x, 9)
    }
  })

  it('tilts the top away as positive ↕ and the right away as positive ↔', () => {
    // Beta about the phone's width: positive brings its top towards the viewer
    const flatOnTable = orientationMatrix({ alpha: 0, beta: 0, gamma: 0 })
    expect(tiltFromEye(eyeFrom(flatOnTable, orientationMatrix({ alpha: 0, beta: 15, gamma: 0 })), 0, 0).y).toBeCloseTo(-15, 9)
    // Gamma about its height: positive takes its right edge away
    expect(tiltFromEye(eyeFrom(flatOnTable, orientationMatrix({ alpha: 0, beta: 0, gamma: 15 })), 0, 0).x).toBeCloseTo(15, 9)
  })

  it('measures from the page’s own top in landscape and upside down', () => {
    for (const screenAngle of [90, 180, 270]) {
      // The phone held turned under the page, so the page shows upright to the viewer
      const rest = flat(times(rows(REST), rotZ(screenAngle)))
      const now = flat(times(times(rows(REST), cssTilt(25, -40)), rotZ(screenAngle)))
      const tilt = tiltFromEye(eyeFrom(rest, now), screenAngle, 0)
      expect(tilt.y).toBeCloseTo(25, 9)
      expect(tilt.x).toBeCloseTo(-40, 9)
    }
  })

  it('measures from the banknote’s own top once it is rotated on the page', () => {
    // Its top to the page's right: taking the phone's right edge away takes the banknote's top away
    const right = orientationMatrix({ alpha: 0, beta: 0, gamma: 20 })
    const upright = orientationMatrix({ alpha: 0, beta: 0, gamma: 0 })
    const eye = eyeFrom(upright, right)
    expect(tiltFromEye(eye, 0, 1).y).toBeCloseTo(20, 9)
    expect(tiltFromEye(eye, 0, 1).x).toBeCloseTo(0, 9)
    // Upside down, it is the banknote's left that goes away; turned left, its bottom
    expect(tiltFromEye(eye, 0, 2).x).toBeCloseTo(-20, 9)
    expect(tiltFromEye(eye, 0, 3).y).toBeCloseTo(-20, 9)
    // Whichever way it is turned, the phone held as the canvas shows the banknote turned that way gives its own tilt back:
    // the canvas turns it on the page (clockwise, so −90° a quarter with y up) and tilts it inside, the phone tilts the page
    for (const q of [0, 1, 2, 3] as Quarter[]) {
      const phone = times(times(rotZ(-90 * q), cssTilt(-30, 50)), rotZ(90 * q))
      const tilt = tiltFromEye(eyeFrom(REST, flat(times(rows(REST), phone))), 0, q)
      expect(tilt.y).toBeCloseTo(-30, 9)
      expect(tilt.x).toBeCloseTo(50, 9)
    }
  })

  it('stops at the limit, edge-on', () => {
    const now = flat(times(rows(REST), cssTilt(0, 85)))
    expect(tiltFromEye(eyeFrom(REST, now), 0, 0, 60).x).toBe(60)
    const behind = flat(times(rows(REST), cssTilt(0, 120)))
    expect(tiltFromEye(eyeFrom(REST, behind), 0, 0).x).toBe(90)
  })
})

describe('which way up the phone is held', () => {
  const upright = orientationMatrix({ alpha: 10, beta: 90, gamma: 0 })
  const turned = (deg: number) => flat(times(rows(upright), rotZ(deg)))

  it('reads the room’s up on the page', () => {
    expect(uprightQuarter(upright, 0)).toBe(0)
    // Top to the left: the room's up is the page's right, so the page turns a quarter clockwise
    expect(uprightQuarter(turned(90), 0)).toBe(1)
    expect(uprightQuarter(turned(180), 0)).toBe(2)
    expect(uprightQuarter(turned(-90), 0)).toBe(3)
  })

  it('is upright once the page has turned itself', () => {
    expect(uprightQuarter(turned(90), 90)).toBe(0)
    expect(uprightQuarter(turned(-90), 270)).toBe(0)
  })

  it('can’t tell lying flat', () => {
    expect(uprightQuarter(orientationMatrix({ alpha: 0, beta: 5, gamma: 3 }), 0)).toBeUndefined()
  })

  it('waits until the phone is well past halfway', () => {
    expect(uprightQuarter(turned(50), 0, 0)).toBe(0)
    expect(uprightQuarter(turned(60), 0, 0)).toBe(1)
    expect(uprightQuarter(turned(50), 0)).toBe(1)
  })
})

describe('steadying the tilt', () => {
  it('starts where the value is and settles on it', () => {
    const filter = oneEuro()
    expect(filter.next(12, 0)).toBe(12)
    let value = 0
    for (let t = 16; t < 2000; t += 16) value = filter.next(12, t)
    expect(value).toBe(12)
  })

  it('smooths a hand’s shake while still', () => {
    const filter = oneEuro()
    const shaken: number[] = []
    for (let i = 0; i < 300; i++) shaken.push(filter.next(10 + (i % 2 ? 0.4 : -0.4), i * 16))
    const late = shaken.slice(100)
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(0.2)
  })

  it('keeps up with a fast tilt', () => {
    const filter = oneEuro()
    let value = 0
    // 120° a second for half a second
    for (let i = 0; i <= 30; i++) value = filter.next(i * 2, i * 16)
    expect(60 - value).toBeLessThan(6)
  })

  it('starts again after a reset', () => {
    const filter = oneEuro()
    filter.next(0, 0)
    filter.next(1, 16)
    filter.reset()
    expect(filter.next(40, 32)).toBe(40)
  })
})
