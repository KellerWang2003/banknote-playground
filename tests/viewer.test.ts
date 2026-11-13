import { describe, expect, it } from 'vitest'
import { orientationMatrix, tiltFromEye, type Vector } from '../src/lib/deviceTilt'
import { EYE_M, heldDeg, neutralEye, toEarth, toPhone } from '../src/lib/viewer'

const unit = (v: Vector): Vector => {
  const length = Math.hypot(...v)
  return [v[0] / length, v[1] / length, v[2] / length]
}
const tiltOf = (eye: Vector) => tiltFromEye(unit(eye), 0, 0, 180)
const held = (beta: number, alpha = 0, gamma = 0) => orientationMatrix({ alpha, beta, gamma })

describe('the eye, kept in the room', () => {
  it('goes from the phone’s axes to the earth’s and back', () => {
    const turn = held(62, 125, 14)
    const eye: Vector = [0.05, -0.1, 0.3]
    toPhone(turn, toEarth(turn, eye)).forEach((v, i) => expect(v).toBeCloseTo(eye[i], 12))
  })

  it('is off square on as far as the phone turned, as the gyroscope has it', () => {
    // Square on upright, kept in the room; the phone's top tipped 20° back: its top 20° further away
    const room = toEarth(held(90), neutralEye(held(90), 0, 0))
    expect(tiltOf(toPhone(held(70), room)).y).toBeCloseTo(20, 9)
    // Its right edge turned 25° away: 25° right
    expect(tiltOf(toPhone(held(90, 0, 25), room)).x).toBeCloseTo(25, 9)
  })
})

describe('the neutral', () => {
  it('is square on with the phone upright, wherever it faces', () => {
    for (const alpha of [0, 70, 200]) {
      const tilt = tiltOf(neutralEye(held(90, alpha), 0, 0))
      expect(tilt.y).toBeCloseTo(0, 9)
      expect(tilt.x).toBeCloseTo(0, 9)
    }
  })

  it('tips the top away as the phone lies back from it, and moves with the dial', () => {
    expect(tiltOf(neutralEye(held(45), 0, 0)).y).toBeCloseTo(45, 9)
    expect(tiltOf(neutralEye(held(45), 0, 0, 45)).y).toBeCloseTo(0, 9)
    expect(tiltOf(neutralEye(held(0), 0, 0, 0)).y).toBeCloseTo(0, 9)
    // Lying flat with the neutral upright: edge-on, seen past its foot
    expect(tiltOf(neutralEye(held(0), 0, 0)).y).toBeCloseTo(90, 9)
    expect(Math.hypot(...neutralEye(held(45), 0, 0))).toBeCloseTo(EYE_M, 12)
  })

  it('is how far from lying flat the phone is held, with Recentre: held so, on a stand say, square on', () => {
    expect(heldDeg(held(0))).toBe(0)
    expect(heldDeg(held(90, 40))).toBe(90)
    const stand = held(62.4, 125)
    expect(heldDeg(stand)).toBe(62)
    const eye = neutralEye(stand, 0, 0, heldDeg(stand))
    expect(Math.abs(tiltOf(eye).y)).toBeLessThan(0.5)
    expect(Math.abs(tiltOf(eye).x)).toBeLessThan(1e-6)
    // Past upright, face down: no further than the dial goes
    expect(heldDeg(held(150))).toBe(90)
  })
})
