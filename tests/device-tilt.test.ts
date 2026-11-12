import { describe, expect, it } from 'vitest'
import { eyeFrom, nearestTurn, oneEuro, orientationMatrix, roomTilt, tiltFromEye, uprightQuarter, type Matrix } from '../src/lib/deviceTilt'
import { HELD_DEG } from '../src/lib/light'
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

describe('how the phone lies in the room, for the light', () => {
  const pitched = (beta: number, alpha = 0, gamma = 0) => orientationMatrix({ alpha, beta, gamma })
  const close = (tilt: { x: number; y: number }, y: number, x = 0, digits = 9) => {
    expect(tilt.y).toBeCloseTo(y, digits)
    expect(tilt.x).toBeCloseTo(x, digits)
  }

  it('is no tilt held HELD_DEG from lying flat, the top tipped back lying flat, forward upright and past it, camera up', () => {
    close(roomTilt(pitched(HELD_DEG), 0, 0, 0), 0)
    close(roomTilt(pitched(0), 0, 0, 0), HELD_DEG)
    close(roomTilt(pitched(90), 0, 0, 0), HELD_DEG - 90)
    close(roomTilt(pitched(120), 0, 0, 0), HELD_DEG - 120)
  })

  it('needs no start: wherever the phone faces, however it was held before', () => {
    for (const alpha of [0, 37, 140, 275]) {
      close(roomTilt(pitched(60, alpha), 0, 0, 0), HELD_DEG - 60)
      close(roomTilt(pitched(0, alpha), 0, 0, 0), HELD_DEG)
    }
  })

  it('turns to the side as a hand rocks the phone about its length, near enough as far as the phone turns', () => {
    const rocked = roomTilt(pitched(HELD_DEG, 0, 20), 0, 0, 0)
    expect(rocked.x).toBeGreaterThan(15)
    expect(rocked.x).toBeLessThan(20)
    expect(Math.abs(rocked.y)).toBeLessThan(1)
    expect(roomTilt(pitched(HELD_DEG, 0, -20), 0, 0, 0).x).toBeCloseTo(-rocked.x, 9)
  })

  it('reads whoever holds the phone from the view as it shows: in landscape, and turned for a phone with rotation locked', () => {
    // Held sideways at HELD_DEG, the page turned itself (top to the left: the page's up is the phone's right)
    const sideways = flat(times(rows(pitched(HELD_DEG)), rotZ(90)))
    close(roomTilt(sideways, 90, 0, 0), 0)
    close(roomTilt(flat(times(rows(pitched(0)), rotZ(90))), 90, 0, 0), HELD_DEG)
    // The same with rotation locked: the view turned a quarter in its stead
    close(roomTilt(sideways, 0, 1, 1), 0)
    close(roomTilt(flat(times(rows(pitched(0)), rotZ(90))), 0, 1, 1), HELD_DEG)
  })

  it('measures along the banknote’s own sides once it is rotated on the page, as its own tilt is', () => {
    // Its top to the page's right: lying flat, the room's light is off its left, which is the view's top
    close(roomTilt(pitched(0), 0, 0, 1), 0, -HELD_DEG)
  })

  it('tips on forward past edge-on, face down overhead, keeping the room’s up above the view’s top', () => {
    close(roomTilt(pitched(150), 0, 0, 0), HELD_DEG - 150)
    close(roomTilt(pitched(179), 0, 0, 0), HELD_DEG - 179)
    // Rocked onto its side and past, it turns on to the side instead
    const rolled = roomTilt(pitched(HELD_DEG, 0, 80), 0, 0, 0)
    expect(rolled.x).toBeGreaterThan(40)
    expect(Math.abs(rolled.y)).toBeLessThan(30)
  })

  it('gives the room’s up along the banknote’s own sides, which says how the light comes through it', () => {
    const up = (m: Parameters<typeof roomTilt>[0], quarter: 0 | 1 | 2 | 3 = 0) => roomTilt(m, 0, 0, quarter).up.map((v) => v + 0)
    const near = (got: number[], want: number[]) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 9))
    const s = Math.sin(HELD_DEG * Math.PI / 180)
    near(up(pitched(0)), [0, 0, 1])
    near(up(pitched(HELD_DEG, 140)), [0, -s, s])
    near(up(pitched(90)), [0, -1, 0])
    near(up(pitched(180)), [0, 0, -1])
    // Rotated a quarter on the page, its top to the right: the room's up, held upright, is off its left
    near(up(pitched(90), 1), [-1, 0, 0])
  })

  it('steadies an angle that wraps round from where it was', () => {
    expect(nearestTurn(-179, 179)).toBeCloseTo(181)
    expect(nearestTurn(179, -179)).toBeCloseTo(-181)
    expect(nearestTurn(10, 20)).toBeCloseTo(10)
    expect(nearestTurn(370, 0)).toBeCloseTo(10)
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
