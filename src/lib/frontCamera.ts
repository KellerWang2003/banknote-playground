import { type Vector } from './deviceTilt'
import { EYE_M } from './viewer'

/**
 * Where the viewer's eye is, as the front camera sees the face (Keller, 13 November: "with camera access, we should solve
 * these"; switched on from Demo's ⋯, `useFrontCamera`). The phone's turn and motion only say what it
 * turns round (viewer.ts); the camera sees the eye itself. The face's two eyes in its picture say where the eye is: the
 * point between them which way, and how far apart they look how far.
 */

const RAD = Math.PI / 180

/**
 * The front camera's field of view across its picture's diagonal, degrees, near enough: a phone's selfie camera, which
 * gives a page its whole width (on iPhones since the 11 a lens like 23 mm on 35 mm film, 86° across a 4:3 picture), and a
 * laptop's. Taken as narrower than it is, the camera sees a turn as smaller than the motion knows it was, and pulls the
 * tilt back towards square on (Keller, 13 November, with a phone's at 75°: "when i am tilting, it is napping back to normal")
 */
export const CAMERA_FOV_DEG = { phone: 86, laptop: 75 }
/** How far the front camera sits above the screen's middle along the phone's own up, metres: a phone's, near enough */
export const PHONE_CAMERA_M = 0.065
/** The same for a laptop's camera, over its screen */
export const LAPTOP_CAMERA_M = 0.1
/** How far apart a grown-up's eyes are, metres: how far away a face is, from how far apart its eyes look */
export const EYES_APART_M = 0.063

/** A point in the camera's picture, as a share of its width (from the left) and height (from the top) */
export interface Seen {
  x: number
  y: number
}

/**
 * The eye as the front camera sees it, in the phone's own axes from the screen's middle, EYE_M away as viewer.ts keeps it:
 * from where the viewer's two eyes (`right` and `left`) show in its picture (`width` × `height` px), as the camera sees,
 * not mirrored, and upright as the page shows (`screenAngle`, which turns it to the phone's own axes). The camera sits
 * `above` the screen's middle and sees `fovDeg` across its picture's diagonal. Undefined when the two eyes are one
 */
export function cameraEye(right: Seen, left: Seen, width: number, height: number, screenAngle: number, above = PHONE_CAMERA_M, fovDeg = CAMERA_FOV_DEG.phone): Vector | undefined {
  const f = Math.hypot(width, height) / 2 / Math.tan((fovDeg * RAD) / 2)
  const apart = Math.hypot((right.x - left.x) * width, (right.y - left.y) * height)
  if (!(apart > 1)) return undefined
  const away = (f * EYES_APART_M) / apart
  // From the camera, along the page as the screen shows it (x right, y up): what is to the page's right shows on the
  // picture's left, as the camera faces the other way from whoever looks at the screen
  const px = (-(((right.x + left.x) / 2) * width - width / 2) / f) * away
  const py = (-(((right.y + left.y) / 2) * height - height / 2) / f) * away
  // In the phone's own axes, from the screen's middle
  const c = Math.cos(screenAngle * RAD), s = Math.sin(screenAngle * RAD)
  const eye: Vector = [c * px + s * py, -s * px + c * py + above, away]
  const length = Math.hypot(eye[0], eye[1], eye[2])
  return [(eye[0] / length) * EYE_M, (eye[1] / length) * EYE_M, (eye[2] / length) * EYE_M]
}

/**
 * Whether the viewer's two eyes (`right` and `left`, as `cameraEye` takes them) are well inside the camera's picture
 * (`width` × `height` px): each at least half as far from every edge as the two are apart. Nearer an edge than that, the
 * face partly out of the picture, the face detector still finds it, often as surely as a whole one, but puts its eyes
 * nearer the middle than they are (a probe, 14 November: eyes just over a 640 px picture's top edge came back 29 px and
 * then 40 px further in than they were, found 0.57 and 0.53 sure), which would pull Demo's eye back towards square on just
 * as the face leaves the picture (Keller, 14 November: tilting far, "my eye would just go off screen")
 */
export function wellInView(right: Seen, left: Seen, width: number, height: number) {
  const margin = Math.hypot((right.x - left.x) * width, (right.y - left.y) * height) / 2
  return [right, left].every(({ x, y }) =>
    x * width >= margin && x * width <= width - margin && y * height >= margin && y * height <= height - margin)
}

/**
 * A line of sight drawn in the camera's picture (Keller, 14 November: its picture should "show the line that is coming
 * out of my eye so that I can identify what is going wrong"): from between the two eyes there, the way the eye at `eye`
 * (in the phone's own axes from the screen's middle, as `cameraEye` gives it) looks to the banknote at the screen's middle,
 * as long as its angle off square on over 90°, as a share of the picture's height, and nothing square on. In the picture
 * as the camera sees it, unmirrored (x right, y down); `screenAngle` is the page's turn on the phone, as `cameraEye` takes it
 */
export function sightLine(eye: Vector, screenAngle = 0): { x: number; y: number } {
  const c = Math.cos(screenAngle * RAD), s = Math.sin(screenAngle * RAD)
  // Where the eye lies off square on, along the page (x right, y up)
  const px = c * eye[0] - s * eye[1]
  const py = s * eye[0] + c * eye[1]
  const off = Math.hypot(px, py)
  if (!(off > 1e-9)) return { x: 0, y: 0 }
  const share = Math.atan2(off, eye[2]) / RAD / 90
  // An eye to the page's right looks back to its left, which the camera, facing the other way, has on its right; one above
  // looks down
  return { x: (px / off) * share, y: (py / off) * share }
}
