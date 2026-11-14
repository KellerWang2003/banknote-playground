import { describe, expect, it } from 'vitest'
import { orientationMatrix, tiltFromEye, type Vector } from '../src/lib/deviceTilt'
import { CAMERA_FOV_DEG, FACE_AWAY_M, LAPTOP_CAMERA_M, PHONE_CAMERA_M, cameraEye, faceAway, sightLine, wellInView } from '../src/lib/frontCamera'
import { EYE_M, toPhone } from '../src/lib/viewer'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const unit = (v: Vector): Vector => {
  const length = Math.hypot(...v)
  return [v[0] / length, v[1] / length, v[2] / length]
}
const tiltOf = (eye: Vector) => tiltFromEye(unit(eye), 0, 0, 180)

describe('the eye as the front camera sees it', () => {
  const W = 480, H = 640
  /** The two eyes, `apart` of the picture's width apart, round a middle at (x, y) */
  const eyes = (x: number, y: number, apart = 0.2) => [{ x: x - apart / 2, y }, { x: x + apart / 2, y }] as const

  it('looks from in front of the camera, which is above the screen’s middle, at the distance the eyes’ spacing says', () => {
    const [right, left] = eyes(0.5, 0.5)
    const eye = cameraEye(right, left, W, H, 0)!
    const f = Math.hypot(W, H) / 2 / Math.tan((CAMERA_FOV_DEG.phone / 2) * RAD)
    const away = (f * 0.063) / (0.2 * W)
    expect(tiltOf(eye).x).toBeCloseTo(0, 9)
    // Above the middle: the phone's top nearer, as tipped towards the eye
    expect(tiltOf(eye).y).toBeCloseTo(-Math.atan2(PHONE_CAMERA_M, away) * DEG, 6)
    expect(Math.hypot(...eye)).toBeCloseTo(EYE_M, 12)
  })

  it('takes a face on the picture’s left as on the screen’s right, the camera facing the other way', () => {
    const [right, left] = eyes(0.2, 0.5)
    // On the screen's right: the banknote's right edge nearer, as turned towards the eye
    expect(tiltOf(cameraEye(right, left, W, H, 0)!).x).toBeLessThan(-15)
    // Low in the picture: below the screen, the top further away
    const [low1, low2] = eyes(0.5, 0.9)
    expect(tiltOf(cameraEye(low1, low2, W, H, 0)!).y).toBeGreaterThan(15)
  })

  it('reads the picture upright as the page shows, in landscape too', () => {
    // The phone's top to the left: the camera on the page's left, so a face in the picture's middle is left of the screen's
    const [right, left] = eyes(0.5, 0.5)
    const eye = cameraEye(right, left, H, W, 90)!
    const tilt = tiltFromEye(unit(eye), 90, 0, 180)
    expect(tilt.x).toBeGreaterThan(5)
    expect(tilt.y).toBeCloseTo(0, 9)
  })

  it('gives nothing for two eyes in one place', () => {
    expect(cameraEye({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, W, H, 0)).toBeUndefined()
  })

  it('agrees with the phone’s own turn: a face seen off square is as far off as the eye is', () => {
    // The eye 25° to the screen's right of square on, seen by the camera: its picture, then back
    const toward = unit([Math.sin(25 * RAD), 0, Math.cos(25 * RAD)])
    const eyeAt = toward.map((v) => v * 0.4) as unknown as Vector
    const fromCamera: Vector = [eyeAt[0], eyeAt[1] - PHONE_CAMERA_M, eyeAt[2]]
    const f = Math.hypot(W, H) / 2 / Math.tan((CAMERA_FOV_DEG.phone / 2) * RAD)
    const u = W / 2 - (fromCamera[0] / fromCamera[2]) * f
    const v = H / 2 - (fromCamera[1] / fromCamera[2]) * f
    const apart = (f * 0.063) / fromCamera[2] / W
    const seen = cameraEye({ x: u / W - apart / 2, y: v / H }, { x: u / W + apart / 2, y: v / H }, W, H, 0)!
    const back = unit(toPhone(orientationMatrix({ alpha: 0, beta: 0, gamma: 0 }), seen))
    back.forEach((value, i) => expect(value).toBeCloseTo(toward[i], 2))
  })
})

describe('a laptop’s camera', () => {
  it('sits further above the screen’s middle, so a face in the middle of its picture is looked from lower down', () => {
    const W = 640, H = 480
    const right = { x: 0.45, y: 0.5 }, left = { x: 0.55, y: 0.5 }
    const f = Math.hypot(W, H) / 2 / Math.tan((CAMERA_FOV_DEG.laptop / 2) * RAD)
    const away = (f * 0.063) / (0.1 * W)
    const eye = cameraEye(right, left, W, H, 0, LAPTOP_CAMERA_M, CAMERA_FOV_DEG.laptop)!
    expect(tiltOf(eye).y).toBeCloseTo(-Math.atan2(LAPTOP_CAMERA_M, away) * DEG, 6)
    expect(tiltOf(eye).y).toBeLessThan(tiltOf(cameraEye(right, left, W, H, 0, PHONE_CAMERA_M, CAMERA_FOV_DEG.laptop)!).y)
  })

  it('sees narrower than a phone’s: a face as far across its picture is less far off square', () => {
    // Keller, 13 November: with a phone's taken as narrow as a laptop's, a turn looked smaller to the camera than it was,
    // and the tilt went "back to normal"
    const right = { x: 0.15, y: 0.5 }, left = { x: 0.25, y: 0.5 }
    const phone = tiltOf(cameraEye(right, left, 480, 640, 0, 0)!).x
    const laptop = tiltOf(cameraEye(right, left, 480, 640, 0, 0, CAMERA_FOV_DEG.laptop)!).x
    expect(phone).toBeLessThan(laptop)
    expect(Math.tan(-phone * RAD) / Math.tan(-laptop * RAD)).toBeCloseTo(Math.tan(43 * RAD) / Math.tan(37.5 * RAD), 6)
  })
})

describe('how far away a face is', () => {
  const W = 480, H = 640
  const eyes = (apart: number) => [{ x: 0.5 - apart / 2 / W, y: 0.4 }, { x: 0.5 + apart / 2 / W, y: 0.4 }] as const

  it('is told from how far apart its eyes show: half as far apart, twice as far away', () => {
    // A phone's camera sees 86° across its picture's diagonal: 429 px from it lies the 480 × 640 picture
    expect(faceAway(...eyes(96), W, H)).toBeCloseTo(0.2815, 4)
    expect(faceAway(...eyes(48), W, H)).toBeCloseTo(0.563, 4)
    // The same on its side, a phone held sideways
    expect(faceAway({ x: 0.5, y: 0.4 - 48 / H }, { x: 0.5, y: 0.4 + 48 / H }, W, H)).toBeCloseTo(0.2815, 4)
    // A laptop's sees narrower, so the same picture of a face is of one further off
    expect(faceAway(...eyes(96), W, H, CAMERA_FOV_DEG.laptop)).toBeGreaterThan(0.33)
    expect(faceAway({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, W, H)).toBeUndefined()
  })

  it('is the distance the eye is seen from', () => {
    // In the picture's middle the eye is straight out from the camera, as far as its face is away
    const [right, left] = [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }]
    const eye = cameraEye(right, left, W, H, 0, 0)!
    expect(eye[0]).toBeCloseTo(0, 12)
    expect(eye[1]).toBeCloseTo(0, 12)
    // And off the middle, as far out from the camera's plane
    const away = faceAway({ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }, W, H)!
    const off = cameraEye({ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }, W, H, 0, 0)!
    const f = Math.hypot(W, H) / 2 / Math.tan((CAMERA_FOV_DEG.phone / 2) * RAD)
    expect(off[0] / off[2]).toBeCloseTo((0.3 * W) / f, 9)
    expect(away).toBeCloseTo(0.2815, 4)
  })

  it('takes a viewer to be within arm’s length and a little more, and not right up against the camera', () => {
    // Eyes 22 px apart in that picture are 1.23 m away, 181 px apart 14.9 cm: neither is whoever holds the phone
    expect(faceAway(...eyes(22), W, H)!).toBeGreaterThan(FACE_AWAY_M.farthest)
    expect(faceAway(...eyes(23), W, H)!).toBeLessThan(FACE_AWAY_M.farthest)
    expect(faceAway(...eyes(181), W, H)!).toBeLessThan(FACE_AWAY_M.nearest)
    expect(faceAway(...eyes(180), W, H)!).toBeGreaterThan(FACE_AWAY_M.nearest)
  })
})

describe('a face well inside the camera’s picture', () => {
  const W = 480, H = 640

  it('counts two eyes each at least half their spacing in from every edge', () => {
    // 96 px apart, so at least 48 px in
    expect(wellInView({ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }, W, H)).toBe(true)
    expect(wellInView({ x: 0.11, y: 0.5 }, { x: 0.31, y: 0.5 }, W, H)).toBe(true)
    expect(wellInView({ x: 0.09, y: 0.5 }, { x: 0.29, y: 0.5 }, W, H)).toBe(false)
    // 106 px apart, the left eye 38 px from the right edge
    expect(wellInView({ x: 0.7, y: 0.5 }, { x: 0.92, y: 0.5 }, W, H)).toBe(false)
    expect(wellInView({ x: 0.45, y: 0.95 }, { x: 0.65, y: 0.95 }, W, H)).toBe(false)
  })

  it('turns down a face half over an edge, whose eyes come back nearer the middle than they are', () => {
    // As the face detector gave them for eyes 13 px over a 640 px picture's top: 15 px inside it, 83 px apart
    expect(wellInView({ x: 0.425, y: 0.024 }, { x: 0.598, y: 0.024 }, W, H)).toBe(false)
  })

  it('measures a face on its side alike, a phone held sideways', () => {
    expect(wellInView({ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.45 }, W, H)).toBe(true)
    expect(wellInView({ x: 0.08, y: 0.3 }, { x: 0.08, y: 0.45 }, W, H)).toBe(false)
  })
})

describe('the line of sight drawn in the camera’s picture', () => {
  const at = (x: number, y: number, z: number): Vector => unit([x, y, z]).map((v) => v * EYE_M) as unknown as Vector

  it('is nothing square on, and as long as the eye is far off it, 90° the picture’s height', () => {
    const none = sightLine(at(0, 0, 1))
    expect(Math.hypot(none.x, none.y)).toBe(0)
    // 30° above the screen: it looks down, a third of the picture's height
    const above = sightLine(at(0, Math.sin(30 * RAD), Math.cos(30 * RAD)))
    expect(above.x).toBeCloseTo(0, 12)
    expect(above.y).toBeCloseTo(1 / 3, 12)
    // 45° to the screen's right: it looks back left, which the camera has on its right
    const right = sightLine(at(1, 0, 1))
    expect(right.x).toBeCloseTo(0.5, 12)
    expect(right.y).toBeCloseTo(0, 12)
  })

  it('goes along the page however it is turned on the phone', () => {
    // The page turned a quarter: the phone's right is the page's up
    const line = sightLine(at(Math.sin(30 * RAD), 0, Math.cos(30 * RAD)), 90)
    expect(line.x).toBeCloseTo(0, 12)
    expect(line.y).toBeCloseTo(1 / 3, 12)
  })

  it('points from a face seen off the middle of the picture back towards the banknote', () => {
    const W = 480, H = 640
    // High in the picture: down; on its left (the screen's right): right
    const high = sightLine(cameraEye({ x: 0.4, y: 0.15 }, { x: 0.6, y: 0.15 }, W, H, 0)!)
    expect(high.y).toBeGreaterThan(0.1)
    expect(Math.abs(high.x)).toBeLessThan(1e-9)
    const left = sightLine(cameraEye({ x: 0.05, y: 0.4 }, { x: 0.25, y: 0.4 }, W, H, 0)!)
    expect(left.x).toBeGreaterThan(0.1)
  })
})
