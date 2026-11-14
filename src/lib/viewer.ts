/**
 * Where the viewer's eye is, seen from the phone, in Demo on a phone (Keller, 13 November). The banknote is shown as an
 * eye there sees the phone (`tiltFromEye`, deviceTilt.ts), so this decides what Arc-en-Ciel and the rest show. The eye
 * stays put in the room as the phone turns, as the gyroscope says (`useDeviceTilt` keeps it in the earth's axes:
 * `toEarth`, `toPhone`); where the eye really is, were the head to move with the phone, only a camera could see, and the
 * front camera, switched on from Demo's ⋯, moves it there (`eyeToward`; frontCamera.ts).
 *
 * Where the eye starts is the neutral: the phone held that far from lying flat, facing whoever holds it, is looked at
 * square on. It is one value however it is set ("just one value that we change in multiple ways"): as Demo opens and on
 * coming back to it, how far from lying flat the phone is held then (Keller, 14 November: "a previous logic where we had
 * the center or the neutral position to sit whenever the user opens the site is more smart ... matches more what I expect
 * when I first load the site"), and meanwhile by its dial in ⋯, or by Recentre, which makes it how far the phone is held
 * then too (`heldDeg`: "if I put it on a stand ... I can just hit that, and the stand wherever it is ... is the flat").
 * From 13 November until then it started fixed, upright (NEUTRAL_DEG: Keller, "the point where like everything is at its
 * default should be if the banknote is like holding at 90 degrees"), which is still what it is before motion comes.
 */
import { clamp } from './frames'
import { heldEye, type Matrix, type Vector } from './deviceTilt'
import { type Quarter } from './rotate'

/** How far the eye is taken to be from the screen, metres: a phone held to look at, about arm's length bent */
export const EYE_M = 0.35
/** The neutral before motion comes: how far from lying flat, degrees, the phone is looked at square on. Upright */
export const NEUTRAL_DEG = 90

/** `v` from the phone's own axes to the earth's, the phone turned `m` (deviceTilt's `Matrix`) */
export const toEarth = (m: Matrix, [x, y, z]: Vector): Vector =>
  [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]
/** `v` from the earth's axes to the phone's own, the phone turned `m` */
export const toPhone = (m: Matrix, [x, y, z]: Vector): Vector =>
  [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z]
/** `v` EYE_M long, or undefined if it has no direction */
const atEye = (v: Vector): Vector | undefined => {
  const length = Math.hypot(v[0], v[1], v[2])
  return length > 1e-9 && Number.isFinite(length) ? [(v[0] * EYE_M) / length, (v[1] * EYE_M) / length, (v[2] * EYE_M) / length] : undefined
}

/** The angle between two directions, degrees */
export const angleApart = (a: Vector, b: Vector) =>
  Math.acos(clamp((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1), -1, 1)) * (180 / Math.PI)

/** Looking straight at the screen: the eye square on */
export const SQUARE_ON: Vector = [0, 0, EYE_M]

/** The eye `share` of the way to `seen` from where it was taken to be, EYE_M away still */
export const eyeToward = (eye: Vector, seen: Vector, share: number): Vector =>
  atEye([eye[0] + (seen[0] - eye[0]) * share, eye[1] + (seen[1] - eye[1]) * share, eye[2] + (seen[2] - eye[2]) * share]) ?? eye

/**
 * The eye at the neutral (`deg` from lying flat, upright by default), in the phone's own axes as it is held `now`: where
 * whoever holds it would be looking from, were the phone held that far from lying flat facing them (`heldEye`). Held
 * there, it is square on; held upright with the neutral at 45°, 45° off it, the phone's top further from the eye
 */
export const neutralEye = (now: Matrix, screenAngle: number, upright: Quarter, deg = NEUTRAL_DEG): Vector =>
  atEye(heldEye(now, screenAngle, upright, deg)) ?? SQUARE_ON

/**
 * How far from lying flat the phone is held `now`, whole degrees within the neutral's 0° to 90°: its screen's tilt from
 * facing straight up. Made the neutral (Recentre), the phone held so, on a stand say, is square on
 */
export const heldDeg = (now: Matrix) => Math.round(clamp((Math.acos(clamp(now[8], -1, 1)) * 180) / Math.PI, 0, 90))
