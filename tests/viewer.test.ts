import { describe, expect, it } from 'vitest'
import { orientationMatrix, tiltFromEye, type Matrix, type Vector } from '../src/lib/deviceTilt'
import { EYE_M, SQUARE_ON, eyeStep, eyeTracker, neutralEye, pivotEstimator, spinBetween } from '../src/lib/viewer'

const RAD = Math.PI / 180
type M3 = number[][]
const rows = (m: Matrix): M3 => [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]]
const flat = (m: M3) => m.flat() as unknown as Matrix
const times = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]))
const apply = (m: M3, v: Vector): Vector => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as unknown as Vector
/** A turn by `deg` about `axis` (a unit vector), as a matrix */
function turnAbout(axis: Vector, deg: number): M3 {
  const [x, y, z] = axis
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD), t = 1 - c
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ]
}
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v: Vector): Vector => {
  const length = Math.hypot(...v)
  return [v[0] / length, v[1] / length, v[2] / length]
}
const tiltOf = (eye: Vector) => tiltFromEye(unit(eye), 0, 0, 180)
/** A steady random number, the same each run: −1 to 1, roughly normal */
function noise(seed: number) {
  let state = seed
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
  return () => (next() + next() + next() + next() - 2) * Math.sqrt(3)
}

/** Held to look at, near upright, facing wherever */
const HELD = orientationMatrix({ alpha: 30, beta: 80, gamma: 4 })

interface Gesture {
  /** The phone's own axis it turns about, and how far, degrees */
  axis: Vector
  deg: number
  /** From the point it turns round to the phone, in the phone's own axes, metres */
  lever: Vector
  /** Seconds it takes, and how long it is then held still */
  seconds?: number
  still?: number
  /** Readings a second, the motion's and the orientation's */
  rate?: number
  /** What the browser gets wrong: no motion readings at all, or the accelerometer the other way round (iPhone) */
  noMotion?: boolean
  flipped?: boolean
  /** How much the readings shake: the accelerometer's, m/s², and the orientation's, degrees */
  shake?: { acceleration: number; turn: number }
  /** The orientation's reading before the motion's at the same moment */
  orientationFirst?: boolean
}

/**
 * A gesture played to the estimator as a phone would send it: turned smoothly by `deg` about `axis` (its own), round a
 * point `lever` behind it, the eye starting square on. Gives where the eye ends up, as the banknote's tilt then, and the
 * lever the estimator ended on
 */
function play(g: Gesture) {
  const rate = g.rate ?? 60
  const seconds = g.seconds ?? 0.6
  const still = g.still ?? 0.2
  const shake = g.shake && { acceleration: noise(7), turn: noise(11) }
  const tracker = eyeTracker()
  let eye = SQUARE_ON
  const levers: Vector[] = []
  const steps = Math.round((seconds + still) * rate)
  for (let i = 0; i <= steps; i++) {
    const t = i / rate
    const k = Math.min(t / seconds, 1)
    // Smoothly there and to a stop: angle, speed and its change
    const angle = g.deg * k * k * (3 - 2 * k)
    const speed = t < seconds ? (g.deg * 6 * k * (1 - k)) / seconds : 0
    const change = t < seconds ? (g.deg * 6 * (1 - 2 * k)) / (seconds * seconds) : 0
    let turn = times(rows(HELD), turnAbout(g.axis, angle))
    if (shake) {
      const wobble = unit([shake.turn(), shake.turn(), shake.turn()])
      turn = times(turn, turnAbout(wobble, g.shake!.turn * Math.abs(shake.turn())))
    }
    const now = flat(turn)
    // The phone's acceleration in its own axes: (α × ·) + ω × (ω × ·), of the lever
    const w = [g.axis[0] * speed * RAD, g.axis[1] * speed * RAD, g.axis[2] * speed * RAD] as Vector
    const a = [g.axis[0] * change * RAD, g.axis[1] * change * RAD, g.axis[2] * change * RAD] as Vector
    const own = cross(a, g.lever).map((v, j) => v + cross(w, cross(w, g.lever))[j]) as unknown as Vector
    const shaken = shake ? (own.map((v) => v + g.shake!.acceleration * shake.acceleration()) as unknown as Vector) : own
    const up: Vector = [now[6], now[7], now[8]]
    const withGravity = shaken.map((v, j) => v + 9.80665 * up[j]) as unknown as Vector
    const sign = g.flipped ? -1 : 1
    const reading = (v: Vector) => ({ x: sign * v[0], y: sign * v[1], z: sign * v[2] })
    const at = t * 1000
    const move = () => { if (!g.noMotion) tracker.motion(reading(shaken), reading(withGravity), at) }
    if (!g.orientationFirst) move()
    if (i === 0) tracker.set(SQUARE_ON, now, at)
    else eye = tracker.orient(now, at)!
    if (g.orientationFirst) move()
    levers.push(tracker.lever())
  }
  return { tilt: tiltOf(eye), eye, lever: levers[levers.length - 1], levers }
}

describe('the eye, moved as the phone turns', () => {
  const tipped = flat(times(rows(HELD), turnAbout([1, 0, 0], 30)))

  it('stays put in the room as the phone turns in place, as the gyroscope alone has it', () => {
    const eye = eyeStep(SQUARE_ON, HELD, tipped)
    // Its top turned 30° towards the eye: the eye is 30° off square, towards the top
    expect(tiltOf(eye).y).toBeCloseTo(-30, 9)
    expect(Math.hypot(...eye)).toBeCloseTo(EYE_M, 12)
  })

  it('stays square on as the phone goes round the eye itself', () => {
    const eye = eyeStep(SQUARE_ON, HELD, tipped, [0, 0, -EYE_M])
    expect(tiltOf(eye).y).toBeCloseTo(0, 9)
    expect(tiltOf(eye).x).toBeCloseTo(0, 9)
  })

  it('goes part of the way round a point between, and further round one behind the phone', () => {
    const between = tiltOf(eyeStep(SQUARE_ON, HELD, tipped, [0, 0, -EYE_M / 2])).y
    expect(between).toBeLessThan(-5)
    expect(between).toBeGreaterThan(-25)
    expect(tiltOf(eyeStep(SQUARE_ON, HELD, tipped, [0, 0.08, 0.02])).y).toBeLessThan(-30)
  })

  it('knows how fast the phone turned, about its own axes', () => {
    const spin = spinBetween(HELD, flat(times(rows(HELD), turnAbout(unit([1, 2, -1]), 3))), 0.02)
    const expected = unit([1, 2, -1]).map((v) => (v * 3 * RAD) / 0.02)
    spin.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9))
  })
})

describe('the neutral', () => {
  const held = (beta: number, alpha = 0, gamma = 0) => orientationMatrix({ alpha, beta, gamma })

  it('is square on with the phone upright, wherever it faces', () => {
    for (const alpha of [0, 70, 200]) {
      const tilt = tiltOf(neutralEye(held(90, alpha), 0, 0))
      expect(tilt.y).toBeCloseTo(0, 9)
      expect(tilt.x).toBeCloseTo(0, 9)
    }
  })

  it('tips the top away as the phone lies back from it, and moves with the slider', () => {
    expect(tiltOf(neutralEye(held(45), 0, 0)).y).toBeCloseTo(45, 9)
    expect(tiltOf(neutralEye(held(45), 0, 0, 45)).y).toBeCloseTo(0, 9)
    expect(tiltOf(neutralEye(held(0), 0, 0, 0)).y).toBeCloseTo(0, 9)
    // Lying flat with the neutral upright: edge-on, seen past its foot
    expect(tiltOf(neutralEye(held(0), 0, 0)).y).toBeCloseTo(90, 9)
  })
})

describe('what the phone turns round, from its motion', () => {
  const pitch: Vector = [1, 0, 0]
  const yaw: Vector = [0, 1, 0]
  const roundTheEye: Vector = [0, 0, -EYE_M]

  it('finds the eye as the phone goes round the head, which keeps it square on, Arc-en-Ciel hidden', () => {
    for (const axis of [pitch, yaw, unit([1, 1, 0])]) {
      const { tilt, levers } = play({ axis, deg: 40, lever: roundTheEye })
      // Midway through, it knows
      const mid = levers[Math.round(levers.length / 3)]
      expect(mid[2]).toBeLessThan(-0.3)
      expect(Math.abs(tilt.y)).toBeLessThan(3)
      expect(Math.abs(tilt.x)).toBeLessThan(3)
    }
  })

  it('finds the phone itself as it turns in the hand, and the eye goes off square as far as it turned', () => {
    expect(play({ axis: pitch, deg: 40, lever: [0, 0, 0] }).tilt.y).toBeCloseTo(-40, 1)
    expect(play({ axis: yaw, deg: -35, lever: [0, 0, 0] }).tilt.x).toBeCloseTo(-35, 1)
    // Round the wrist, below and behind it, about as far
    const wrist = play({ axis: pitch, deg: 40, lever: [0, 0.08, 0.02] }).tilt.y
    expect(wrist).toBeLessThan(-38)
    expect(wrist).toBeGreaterThan(-50)
  })

  it('is the gyroscope alone with no motion readings', () => {
    const { tilt, lever } = play({ axis: pitch, deg: 40, lever: roundTheEye, noMotion: true })
    expect(tilt.y).toBeCloseTo(-40, 6)
    expect(lever).toEqual([0, 0, 0])
  })

  it('reads an accelerometer that gives its readings the other way round (iPhone’s have), and either order of readings', () => {
    expect(Math.abs(play({ axis: pitch, deg: 40, lever: roundTheEye, flipped: true }).tilt.y)).toBeLessThan(3)
    expect(Math.abs(play({ axis: pitch, deg: 40, lever: roundTheEye, orientationFirst: true }).tilt.y)).toBeLessThan(3)
    expect(play({ axis: pitch, deg: 40, lever: [0, 0, 0], flipped: true }).tilt.y).toBeCloseTo(-40, 1)
  })

  it('holds up through a hand’s shake and the sensors’ noise', () => {
    const shake = { acceleration: 0.08, turn: 0.05 }
    expect(Math.abs(play({ axis: pitch, deg: 40, lever: roundTheEye, shake }).tilt.y)).toBeLessThan(6)
    expect(Math.abs(play({ axis: yaw, deg: 40, lever: roundTheEye, shake }).tilt.x)).toBeLessThan(6)
    const twist = play({ axis: pitch, deg: 40, lever: [0, 0, 0], shake }).tilt.y
    expect(twist).toBeLessThan(-34)
    expect(twist).toBeGreaterThan(-46)
  })

  it('keeps to the gyroscope for a turn too slow for its arc to show', () => {
    // 10° over 4 s round the eye: the phone moves at 1.5 cm a second, too little to tell from noise
    const { tilt } = play({ axis: pitch, deg: 10, seconds: 4, lever: roundTheEye, shake: { acceleration: 0.08, turn: 0.02 } })
    expect(tilt.y).toBeLessThan(-3)
  })

  it('starts afresh after a pause, so a fast turn in the hand doesn’t outweigh a turn round the head after it', () => {
    const tracker = eyeTracker()
    const g = 9.80665
    let before = orientationMatrix({ alpha: 0, beta: 60, gamma: 0 })
    const feed = (beta: number, a: Vector, at: number) => {
      const now = orientationMatrix({ alpha: 0, beta, gamma: 0 })
      const up: Vector = [0, Math.sin(beta * RAD), Math.cos(beta * RAD)]
      tracker.motion({ x: a[0], y: a[1], z: a[2] }, { x: a[0] + g * up[0], y: a[1] + g * up[1], z: a[2] + g * up[2] }, at)
      if (at === 0) tracker.set(SQUARE_ON, now, at)
      else tracker.orient(now, at)
      const was = before
      before = now
      return [was, now] as const
    }
    // Snapped 30° in the hand in a moment, then held a second: the gyroscope's 30°
    let at = 0
    feed(60, [0, 0, 0], at)
    for (let i = 1; i <= 60; i++) feed(i < 3 ? 60 + 15 * i : 90, [0, 0, 0], (at = (i * 1000) / 60))
    expect(tiltOf(tracker.eye!).y).toBeCloseTo(-30, 0)
    // Then 40° back round a point straight out from the screen, as far as the eye: where the eye then is, from there
    let ideal = tracker.eye!
    const start = at
    const seconds = 0.6
    for (let i = 1; i <= 96; i++) {
      const t = i / 60
      const k = Math.min(t / seconds, 1)
      const w = t < seconds ? ((-40 * 6 * k * (1 - k)) / seconds) * RAD : 0
      const dw = t < seconds ? ((-40 * 6 * (1 - 2 * k)) / (seconds * seconds)) * RAD : 0
      const [was, now] = feed(90 - 40 * k * k * (3 - 2 * k), [0, dw * EYE_M, w * w * EYE_M], start + t * 1000)
      ideal = eyeStep(ideal, was, now, [0, 0, -EYE_M])
    }
    expect(Math.abs(tiltOf(tracker.eye!).y - tiltOf(ideal).y)).toBeLessThan(2)
  })

  it('never puts the point further than the eye', () => {
    const { lever } = play({ axis: pitch, deg: 50, lever: [0, 0, -0.9] })
    expect(Math.hypot(...lever)).toBeLessThanOrEqual(EYE_M + 1e-9)
  })

  it('forgets on reset', () => {
    const pivot = pivotEstimator()
    pivot.orient(HELD, 0)
    pivot.reset()
    expect(pivot.lever()).toEqual([0, 0, 0])
  })
})

// Checks the test's own gesture: its accelerations are the second derivative of where the phone goes
describe('the test’s gesture', () => {
  it('moves the phone along an arc round the point it turns round', () => {
    const lever: Vector = [0, 0, -EYE_M]
    const at = (deg: number) => apply(times(rows(HELD), turnAbout([1, 0, 0], deg)), lever)
    // Turned 20° round the eye, the phone has moved as far as the arc says
    const moved = at(20).map((v, i) => v - at(0)[i])
    expect(Math.hypot(...moved)).toBeCloseTo(2 * EYE_M * Math.sin(10 * RAD), 9)
  })
})
