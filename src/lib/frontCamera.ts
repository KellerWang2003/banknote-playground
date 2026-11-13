import { type Vector } from './deviceTilt'
import { EYE_M } from './viewer'

/**
 * Where the viewer's eye is, as the front camera sees the face (Keller, 13 November: "with camera access, we should solve
 * these"; tried from Demo's ⋯ on the dev server for now, `useFrontCamera`). The phone's turn and motion only say what it
 * turns round (viewer.ts); the camera sees the eye itself. The face's two eyes in its picture say where the eye is: the
 * point between them which way, and how far apart they look how far.
 */

const RAD = Math.PI / 180

/** The front camera's field of view across its picture's diagonal, degrees: a phone's selfie camera, near enough */
export const CAMERA_FOV_DEG = 75
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
 * `above` the screen's middle. Undefined when the two eyes are one
 */
export function cameraEye(right: Seen, left: Seen, width: number, height: number, screenAngle: number, above = PHONE_CAMERA_M, fovDeg = CAMERA_FOV_DEG): Vector | undefined {
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
