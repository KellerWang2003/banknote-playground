/**
 * Demo on a phone (Keller, 10 November: "a dedicated demo mode what uses gyro on my phone, like figma's prototype mode"):
 * the phone is the banknote. It is drawn flat on the screen, and tilting the phone tilts it, 1:1, so a banknote seen on
 * a phone held 20° away shows what the same banknote shows on the canvas tilted 20° away.
 *
 * The browser gives the phone's orientation (`deviceorientation`: alpha, beta, gamma) as a turn from the earth's axes.
 * The viewer's eye is a direction seen from the phone, followed as it turns (src/lib/viewer.ts: from the phone held
 * upright, square on, it stays put in the room as the gyroscope says); an eye that stays put, straight out of the
 * screen as the phone was held at rest, is where `eyeFrom` says. That direction, turned to the screen's own axes as the
 * page shows them (landscape too) and to the banknote's own (rotated on screen, or the view turned for a phone with
 * rotation locked), gives the tilt the canvas would show the same view at (`tiltFromEye`): ↕ and ↔ as NoteView turns a
 * banknote, rotateX(↕) then rotateY(↔).
 */
import { TILT_LIMIT, clamp } from './frames'
import { HELD_DEG, roomUp } from './light'
import { tiltMatrix } from './realisticInk'
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

/**
 * How much more the way the view's foot points (or its top, tipped forward past upright) says where whoever holds the
 * phone stands than the way the screen faces, but upright: so turning it about its own length, as a hand rocks it side to
 * side, turns it in the room's light, which can't tell that from turning round
 */
const FOOT_WEIGHT = 10

/**
 * Where whoever holds the phone would look at it from, were it held `deg` from lying flat facing them: a direction in the
 * phone's own axes, straight up the room at 0, level towards them at 90 (`now`'s last row is the room's up). Whoever
 * holds it is taken to stand level with it where the screen faces, the foot of the view (`screenAngle`, and `upright` for
 * a phone with rotation locked, whose view turns itself: `uprightQuarter`) pointing their way as the phone lies back, its
 * top as it tips forward past upright. Both the room's light (`roomTilt`, at HELD_DEG) and Demo's neutral (viewer.ts)
 * take the eye from here
 */
export function heldEye(now: Matrix, screenAngle: number, upright: Quarter, deg: number): Vector {
  const up: Vector = [now[6], now[7], now[8]]
  // Level, along the room's floor: `v` less its share of the room's up
  const level = ([x, y, z]: Vector): Vector => {
    const d = x * up[0] + y * up[1] + z * up[2]
    return [x - d * up[0], y - d * up[1], z - d * up[2]]
  }
  // The view's up on the phone: the page's, turned as far as the view is turned on it
  const turn = (screenAngle + 90 * upright) * RAD
  const foot = level([-Math.sin(turn), -Math.cos(turn), 0])
  const screen = level([0, 0, 1])
  // Lying back, whoever holds it is past the view's foot; tipped forward past upright, past its top
  const lying = FOOT_WEIGHT * up[2]
  let toward: Vector = [screen[0] + lying * foot[0], screen[1] + lying * foot[1], screen[2] + lying * foot[2]]
  // Should the two ever cancel out, the screen alone
  if (Math.hypot(...toward) < 1e-6) toward = screen
  const length = Math.hypot(...toward) || 1
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD)
  return [c * up[0] + (s * toward[0]) / length, c * up[1] + (s * toward[1]) / length, c * up[2] + (s * toward[2]) / length]
}

/**
 * How the phone lies in the room, as the tilt the room's light falls on the banknote at in Demo (light.ts: from above, so
 * lying flat is as bright as held, and pointing the camera up puts the light behind the paper), from the room's up alone
 * (`now`'s last row), so neither Recentre nor where the phone was held when Demo began moves it. It is the tilt of the
 * banknote from being held HELD_DEG from lying flat, facing whoever holds it (`heldEye`): there none; lying flat, its top
 * tipped back HELD_DEG; upright, tipped forward as far. `quarter` measures it along the banknote's own sides, as
 * `tiltFromEye` does. Neither tilt is kept within a limit: the light can come from behind. With it, the room's up itself
 * along the banknote's own sides (`up`: x right, y down, z out of its face), which says how the light comes through it
 * (`roomThrough`) as two angles can't quite once the eye is edge-on.
 */
export function roomTilt(now: Matrix, screenAngle: number, upright: Quarter, quarter: Quarter) {
  const up: Vector = [now[6], now[7], now[8]]
  // The eye where it would be were the phone held HELD_DEG from lying flat facing it
  const eye = heldEye(now, screenAngle, upright, HELD_DEG)
  // Both along the banknote's own sides, as `tiltFromEye` takes the eye there
  const own = ([x, y, z]: Vector): Vector => {
    const cs = Math.cos(screenAngle * RAD), sn = Math.sin(screenAngle * RAD)
    const on = unturn(cs * x - sn * y, -(sn * x + cs * y), quarter)
    return [on.x, on.y, z]
  }
  const e = own(eye)
  const u = own(up)
  // Two tilts put the eye there, the second half a turn round its line from the first, past edge-on the other way: the
  // one that keeps the room's up where it is, so the light comes from above the view's top, and past edge-on, pointing the
  // camera up, the banknote tips on forward rather than turning over
  const y = Math.asin(clamp(e[1], -1, 1)) * DEG
  const x = Math.atan2(-e[0], e[2]) * DEG
  const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180
  const tilts = [{ x, y }, { x: wrap(x + 180), y: wrap(180 - y) }]
  const room = roomUp(quarter)
  const keeps = (tilt: { x: number; y: number }) => {
    const m = tiltMatrix(tilt)
    const seen = [0, 3, 6].map((i) => m[i] * room[0] + m[i + 1] * room[1] + m[i + 2] * room[2])
    return seen[0] * u[0] + seen[1] * u[1] + seen[2] * u[2]
  }
  const best = keeps(tilts[1]) > keeps(tilts[0]) + 1e-9 ? tilts[1] : tilts[0]
  // + 0 turns a −0 into 0
  return { x: best.x + 0, y: best.y + 0, up: [u[0] + 0, u[1] + 0, u[2] + 0] as Vector }
}

/** `angle`, degrees, a whole number of turns from it as near to `near` as can be: for steadying an angle that wraps round */
export const nearestTurn = (angle: number, near: number) => near + ((((angle - near) % 360) + 540) % 360) - 180

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
