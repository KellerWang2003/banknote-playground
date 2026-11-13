import { describe, expect, it } from 'vitest'
import { orientationMatrix, tiltFromEye, type Vector } from '../src/lib/deviceTilt'
import { CAMERA_FOV_DEG, LAPTOP_CAMERA_M, PHONE_CAMERA_M, cameraEye } from '../src/lib/frontCamera'
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
