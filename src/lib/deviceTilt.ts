/**
 * Demo on a phone (Keller, 10 November: "a dedicated demo mode what uses gyro on my phone, like figma's prototype mode"):
 * the phone is the banknote. It is drawn flat on the screen, and tilting the phone tilts it, 1:1, so a banknote seen on
 * a phone held 20° away shows what the same banknote shows on the canvas tilted 20° away.
 *
 * The browser gives the phone's orientation (`deviceorientation`: alpha, beta, gamma) as a turn from the earth's axes.
 * Where the phone was held when Demo began (or Recentre was pressed) the viewer was looking straight at the screen; the
 * eye stays put in the room, so as the phone turns, the eye's direction seen from the phone (`eyeFrom`) says how it is
 * tilted from there. That direction, turned to the screen's own axes as the page shows them (landscape too) and to the
 * banknote's own (rotated on screen, or the view turned for a phone with rotation locked), gives the tilt the canvas
 * would show the same view at (`tiltFromEye`): ↕ and ↔ as NoteView turns a banknote, rotateX(↕) then rotateY(↔).
 */
import { TILT_LIMIT, clamp } from './frames'
import { type Quarter, unturn } from './rotate'

/** As `deviceorientation` gives it, degrees: alpha about the screen's normal, beta about its width, gamma about its height */
export interface Orientation {
  alpha: number
  beta: number
  gamma: number
}

/** A turn, rows first: from the phone's own axes (x right, y up the screen, z out of it) to the earth's */
export type Matrix = readonly [number, number, number, number, number, number, number, number, number]
export type Vector = readonly [number, number, number]

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** The phone's orientation as a turn from its own axes to the earth's: Rz(alpha)·Rx(beta)·Ry(gamma), as the spec has it */
export function orientationMatrix({ alpha, beta, gamma }: Orientation): Matrix {
  const cA = Math.cos(alpha * RAD), sA = Math.sin(alpha * RAD)
  const cB = Math.cos(beta * RAD), sB = Math.sin(beta * RAD)
  const cG = Math.cos(gamma * RAD), sG = Math.sin(gamma * RAD)
  return [
    cA * cG - sA * sB * sG, -sA * cB, cA * sG + sA * sB * cG,
    sA * cG + cA * sB * sG, cA * cB, sA * sG - cA * sB * cG,
    -cB * sG, sB, cB * cG,
  ]
}

/**
 * Where the viewer's eye lies seen from the phone now, in the phone's own axes, the eye having been straight out of the
 * screen where the phone was held at `rest`: (0, 0, 1) while it is held there still, however it spins flat in the hand
 */
export function eyeFrom(rest: Matrix, now: Matrix): Vector {
  // The screen's normal at rest, in the earth's axes, turned back into the phone's as it is now
  const e0 = rest[2], e1 = rest[5], e2 = rest[8]
  return [
    now[0] * e0 + now[3] * e1 + now[6] * e2,
    now[1] * e0 + now[4] * e1 + now[7] * e2,
    now[2] * e0 + now[5] * e1 + now[8] * e2,
  ]
}

/**
 * The tilt that shows a banknote as an eye at `eye` (in the phone's axes) sees the phone: ↕ (`y`, positive as its top
 * goes away) and ↔ (`x`, positive as its right goes away), as NoteView turns a banknote, rotateX(y) then rotateY(x).
 * `screenAngle` is how far the page is turned on the phone (`screen.orientation.angle`: 90 in landscape with the
 * phone's top to the left), and `quarter` how far the banknote is turned on the page, clockwise, so its own top is
 * where the tilt is measured from. Each kept within ±`limit`.
 */
export function tiltFromEye([ex, ey, ez]: Vector, screenAngle: number, quarter: Quarter, limit = TILT_LIMIT) {
  const c = Math.cos(screenAngle * RAD), s = Math.sin(screenAngle * RAD)
  // In the page's axes as the screen shows it, y still up
  const px = c * ex - s * ey
  const py = s * ex + c * ey
  // As the page lays things out, y down, and turned back to the banknote's own axes
  const own = unturn(px, -py, quarter)
  // Seen from the banknote turned rotateX(y) rotateY(x), the eye lies at (−sin x cos y, sin y, cos x cos y)
  const y = Math.asin(clamp(own.y, -1, 1)) * DEG
  const x = Math.atan2(-own.x, ez) * DEG
  return { x: clamp(x, -limit, limit), y: clamp(y, -limit, limit) }
}

/** How far, degrees, a phone turns from the way it was held before the page turns with it: past halfway (45°), so it never flickers */
const SWITCH_DEG = 55

/**
 * Which way up the phone is held, as the quarter turn, clockwise on the page, that shows the page upright to whoever
 * holds it: 0 as it is, 1 when the phone is turned with its top to the left (the room's up is the page's right), 2 upside
 * down, 3 with its top to the right. For a phone with rotation locked, whose page doesn't turn itself. Undefined while
 * the phone lies too flat to tell; with `current`, it stays until the phone is a good way past halfway to another.
 */
export function uprightQuarter(now: Matrix, screenAngle: number, current?: Quarter): Quarter | undefined {
  // The room's up, in the phone's axes, then in the page's as the screen shows it
  const ux = now[6], uy = now[7]
  const c = Math.cos(screenAngle * RAD), s = Math.sin(screenAngle * RAD)
  const x = c * ux - s * uy
  const y = s * ux + c * uy
  if (Math.hypot(x, y) < 0.5) return undefined
  // Clockwise from the page's up: 0 up, 90 right, 180 down, 270 left
  const deg = (Math.atan2(x, y) * DEG + 360) % 360
  if (current !== undefined) {
    const off = Math.abs(((deg - current * 90 + 540) % 360) - 180)
    if (off <= SWITCH_DEG) return current
  }
  return (Math.round(deg / 90) % 4) as Quarter
}

/**
 * The One Euro filter (Casiez, Roussel and Vogel, 2012): steadies a value that shakes a little, as a hand holding a phone
 * does, smoothing hard while it is still and hardly at all while it moves fast, so a tilt follows the hand without lag.
 * `minCutoff` (Hz) is how smooth it is still, `beta` how quickly it lets go as the value speeds up (per unit a second).
 */
export function oneEuro(minCutoff = 1.2, beta = 0.05, dCutoff = 1) {
  let value: number | undefined
  let speed = 0
  let at = 0
  const share = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
  return {
    /** The steadied value of `x`, read at `now` (ms) */
    next(x: number, now: number) {
      if (value === undefined) {
        value = x
        speed = 0
        at = now
        return x
      }
      const dt = Math.max((now - at) / 1000, 1e-3)
      at = now
      speed += share(dCutoff, dt) * ((x - value) / dt - speed)
      value += share(minCutoff + beta * Math.abs(speed), dt) * (x - value)
      return value
    },
    /** Starts again from the next value, as after a pause */
    reset() {
      value = undefined
    },
  }
}

/** The page's turn on the phone, degrees clockwise to 0 to 359: what `screenAngle` takes */
export function screenAngleNow() {
  const angle = globalThis.screen?.orientation?.angle ?? (globalThis as { orientation?: number }).orientation ?? 0
  return ((Math.round(angle) % 360) + 360) % 360
}
