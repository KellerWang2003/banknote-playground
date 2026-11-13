/**
 * Where the viewer's eye is, seen from the phone, in Demo on a phone (Keller, 13 November). The banknote is shown as an
 * eye there sees the phone (`tiltFromEye`, deviceTilt.ts), so this decides what Arc-en-Ciel and the rest show.
 *
 * A real banknote is mostly looked at square on: held up to the light or looked down at, it goes round the head and the
 * face stays square to it, so Arc-en-Ciel stays hidden ("relatively it's not tilted at an angle"); only turning it in
 * the hand, the head still, shows it. The phone's turn alone (the gyroscope) can't tell the two apart, but how the phone
 * moves can: turned round the head, it sweeps an arc as far out as the eye; turned in the hand, it hardly moves. So the
 * eye is kept as a point (`eye`, in the phone's own axes, EYE_M from the screen's middle) that stays where it is in the
 * room while the phone turns round whatever it turns round (`eyeStep`), which the accelerometer says (`pivotEstimator`):
 * round the eye, the eye stays square on; round the phone itself, the eye goes as far off square as the phone turns, as
 * with the gyroscope alone, which is also what is left whenever the motion says nothing for sure.
 *
 * Where the eye starts, as Demo opens and on coming back to it, is the neutral (Keller: "the point where like everything
 * is at its default should be if the banknote is like holding at 90 degrees ... completely vertical in space", with a
 * slider in ⋯ for it): the phone held NEUTRAL_DEG from lying flat, facing whoever holds it, is looked at square on.
 */
import { clamp } from './frames'
import { heldEye, type Matrix, type Vector } from './deviceTilt'
import { type Quarter } from './rotate'

/** How far the eye is taken to be from the screen, metres: a phone held to look at, about arm's length bent */
export const EYE_M = 0.35
/** The neutral: how far from lying flat, degrees, the phone is looked at square on where the eye starts. Upright */
export const NEUTRAL_DEG = 90
/** How far apart in time the phone's speed is compared, ms, to say what it turns round: about a fifth of a gesture */
export const WINDOW_MS = 200
/** How long what the motion said is remembered, ms: a new gesture soon speaks for itself */
export const MEMORY_MS = 250
/** How far back the eye's last steps are gone over again with what the motion says now, ms */
export const REPLAY_MS = 150
/**
 * How sure the motion must be before it says the phone turns round anything but itself: the phone's speed is known to
 * about SPEED_NOISE (m/s, the accelerometer's own noise and the hand's own wobble), and the point it turns round is
 * seldom further than LEVER_PRIOR (m) from it. A slow turn, whose arc is too slow to measure, stays the gyroscope's
 */
const SPEED_NOISE = 0.05
const LEVER_PRIOR = 0.3
const SURE = (SPEED_NOISE / LEVER_PRIOR) ** 2
/** What the motion said goes stale once no reading has come for this long, ms: the gyroscope's alone */
const STALE_MS = 300
/**
 * Held this still (radians a second, about 15° a second) for this long (ms), the phone has stopped between gestures, and
 * what the motion said is forgotten: the next gesture may turn round something else, and a fast one before it would
 * otherwise outweigh it for a while
 */
const STILL_SPIN = 0.25
const STILL_MS = 150
/** Standard gravity, m/s²: the accelerometer's reading lying still, less what the phone does */
const GRAVITY = 9.80665

const plus = (a: Vector, b: Vector): Vector => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const minus = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const times = (a: Vector, k: number): Vector => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** `v` from the phone's own axes to the earth's, the phone turned `m` (deviceTilt's `Matrix`) */
export const toEarth = (m: Matrix, [x, y, z]: Vector): Vector =>
  [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]
/** `v` from the earth's axes to the phone's own, the phone turned `m` */
export const toPhone = (m: Matrix, [x, y, z]: Vector): Vector =>
  [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z]
/** `v` EYE_M long, or undefined if it has no direction */
const atEye = (v: Vector): Vector | undefined => {
  const length = Math.hypot(v[0], v[1], v[2])
  return length > 1e-9 && Number.isFinite(length) ? times(v, EYE_M / length) : undefined
}

/** Looking straight at the screen: the eye square on, as Recentre puts it */
export const SQUARE_ON: Vector = [0, 0, EYE_M]

/**
 * The eye at the neutral (`deg` from lying flat, upright by default), in the phone's own axes as it is held `now`: where
 * whoever holds it would be looking from, were the phone held that far from lying flat facing them (`heldEye`). Held
 * there, it is square on; held upright with the neutral at 45°, 45° off it, the phone's top further from the eye
 */
export const neutralEye = (now: Matrix, screenAngle: number, upright: Quarter, deg = NEUTRAL_DEG): Vector =>
  atEye(heldEye(now, screenAngle, upright, deg)) ?? SQUARE_ON

/**
 * The eye after the phone turned from `before` to `now`: it stays where it is in the room, and the phone turns round the
 * point `lever` behind it (from that point to the phone, in the phone's own axes, metres: `pivotEstimator`). Round the
 * eye itself, `lever` is the eye turned back (−eye) and it stays square on, however far the phone goes round; round the
 * phone (no lever, the gyroscope's alone), it goes as far off square as the phone turns. Kept EYE_M away, as nothing
 * says how far it really is
 */
export function eyeStep(eye: Vector, before: Matrix, now: Matrix, lever: Vector = [0, 0, 0]): Vector {
  // From the point it turns round to the eye, both fixed in the room: seen from the phone as it is now
  const round = toPhone(now, toEarth(before, plus(eye, lever)))
  return atEye(minus(round, lever)) ?? eye
}

/** How fast the phone turned from `before` to `now` in `seconds`, about its own axes, radians a second */
export function spinBetween(before: Matrix, now: Matrix, seconds: number): Vector {
  // The turn between, in the phone's axes: beforeᵀ·now
  const d = (i: number, j: number) => before[i] * now[j] + before[3 + i] * now[3 + j] + before[6 + i] * now[6 + j]
  const v: Vector = [(d(2, 1) - d(1, 2)) / 2, (d(0, 2) - d(2, 0)) / 2, (d(1, 0) - d(0, 1)) / 2]
  const sine = Math.hypot(v[0], v[1], v[2])
  const cosine = (d(0, 0) + d(1, 1) + d(2, 2) - 1) / 2
  const angle = Math.atan2(sine, cosine)
  return times(v, (sine > 1e-9 ? angle / sine : 1) / Math.max(seconds, 1e-3))
}

/** The phone turned `turn`, then on at `spin` (its own axes, radians a second) for `seconds` */
export function spunOn(turn: Matrix, spin: Vector, seconds: number): Matrix {
  const angle = Math.hypot(spin[0], spin[1], spin[2]) * seconds
  if (!(angle > 1e-12)) return turn
  const [x, y, z] = times(spin, seconds / angle)
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  const by = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
  return product(turn, by) as unknown as Matrix
}

/** The 3 × 3 matrix [v]×, rows first: [v]×·w is v × w */
const crossOf = ([x, y, z]: Vector) => [0, -z, y, z, 0, -x, -y, x, 0]

/** `a`·`b`, 3 × 3 matrices rows first */
const product = (a: readonly number[], b: readonly number[]) =>
  [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]))

/** Solves `m`·x = `b` (3 × 3, rows first), or none if it has no one answer */
function solve(m: readonly number[], b: Vector): Vector | undefined {
  const det = (c: readonly number[]) =>
    c[0] * (c[4] * c[8] - c[5] * c[7]) - c[1] * (c[3] * c[8] - c[5] * c[6]) + c[2] * (c[3] * c[7] - c[4] * c[6])
  const whole = det(m)
  if (!(Math.abs(whole) > 1e-12)) return undefined
  const column = (k: number) => m.map((v, i) => (i % 3 === k ? b[Math.floor(i / 3)] : v))
  return [det(column(0)) / whole, det(column(1)) / whole, det(column(2)) / whole]
}

/** A reading of the accelerometer as the browser gives it (`DeviceMotionEvent`), m/s², in the phone's own axes */
export type Acceleration = { x: number | null; y: number | null; z: number | null } | null | undefined

/**
 * What the phone turns round, from its motion: a body turning about a fixed point at `lever` from it (in its own axes)
 * moves at `spin` × `lever`, so the change in its speed over WINDOW_MS (the accelerometer's readings added up, in the
 * room's axes) against the change in that, from its turn alone, says where the point is. Every comparison is weighed in
 * as it comes and fades over MEMORY_MS, all forgotten once the phone is held still a moment (STILL_MS), and `SURE` keeps
 * the answer at the phone itself (no lever) until the motion clearly says otherwise. Each reading is taken at the moment it was made, the phone's turn and speed between readings
 * worked out from either side. The accelerometer's readings are taken as the spec has them, lying still reading gravity's
 * GRAVITY upward; a browser that gives them the other way round (iPhone's have been) is told by that and turned back.
 */
export function pivotEstimator() {
  /** The phone's turn at the last orientation reading, when, and how fast it was turning then */
  let turn: Matrix | undefined
  let turnedAt = 0
  let spinning: Vector = [0, 0, 0]
  /** Its speed, in the room's axes: the readings added up since the start, so it drifts, but its changes over a window don't */
  let speed: Vector = [0, 0, 0]
  let movedAt: number | undefined
  /** The last acceleration reading, in the room's axes */
  let pushed: Vector = [0, 0, 0]
  /** The speed as it was at the last orientation reading */
  let speedThen: Vector | undefined
  /** Gravity along the room's up, as the readings give it: below nothing, they are the other way round */
  let gravity = 0
  /** Recent turns of the phone, each at the middle of the time between two readings: when, the turn, how fast, and the speed */
  let past: { at: number; turn: Matrix; spin: Vector; speed: Vector }[] = []
  /** The comparisons so far: m·lever = b, weighed and fading */
  let m = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  let b: Vector = [0, 0, 0]
  let weighedAt: number | undefined
  /** Since when the phone has been held still, if it is */
  let stillSince: number | undefined
  const read = (v: Acceleration): Vector | undefined =>
    v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? [v.x!, v.y!, v.z!] : undefined
  /** The speed at `at`, from the last reading on */
  const speedAt = (at: number) => (movedAt === undefined ? speed : plus(speed, times(pushed, clamp((at - movedAt) / 1000, 0, 0.1))))

  return {
    /** A motion reading (`devicemotion`): the acceleration without gravity and with it, at `at` (ms) */
    motion(acceleration: Acceleration, withGravity: Acceleration, at: number) {
      if (!turn) return
      // The phone as turned at the moment of the reading
      const then = spunOn(turn, spinning, clamp((at - turnedAt) / 1000, -0.05, 0.05))
      const up: Vector = [then[6], then[7], then[8]]
      const all = read(withGravity)
      if (all) gravity = gravity * 0.95 + dot(all, up)
      const sign = gravity < 0 ? -1 : 1
      const own = read(acceleration)
      const a = own ? times(own, sign) : all ? minus(times(all, sign), times(up, GRAVITY)) : undefined
      if (!a) return
      const room = toEarth(then, a)
      if (movedAt !== undefined) speed = plus(speed, times(plus(pushed, room), clamp((at - movedAt) / 1000, 0, 0.1) / 2))
      pushed = room
      movedAt = at
    },
    /** An orientation reading (`deviceorientation`): how the phone is turned `now`, at `at` (ms) */
    orient(now: Matrix, at: number) {
      const speedNow = speedAt(at)
      if (turn && at > turnedAt) {
        const seconds = (at - turnedAt) / 1000
        const spin = spinBetween(turn, now, seconds)
        spinning = spin
        past.push({ at: (at + turnedAt) / 2, turn: spunOn(turn, spin, seconds / 2), spin, speed: times(plus(speedThen ?? speedNow, speedNow), 0.5) })
        while (past.length > 2 && past[1].at <= at - WINDOW_MS) past.shift()
        stillSince = Math.hypot(spin[0], spin[1], spin[2]) < STILL_SPIN ? (stillSince ?? turnedAt) : undefined
        const fade = weighedAt === undefined || (stillSince !== undefined && at - stillSince >= STILL_MS) ? 0 : Math.exp(-(at - weighedAt) / MEMORY_MS)
        m = m.map((v) => v * fade)
        b = times(b, fade)
        weighedAt = at
        const first = past[0]
        const last = past[past.length - 1]
        if (movedAt !== undefined && at - movedAt < STALE_MS && first !== last) {
          // The change in speed over the window, in the phone's axes at its end, against what the lever would make of
          // it: spin × lever at the end, less as it was at the start (turned into the phone's axes at the end)
          const change = toPhone(last.turn, minus(last.speed, first.speed))
          const back = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) =>
            last.turn[i] * first.turn[j] + last.turn[3 + i] * first.turn[3 + j] + last.turn[6 + i] * first.turn[6 + j]))
          const then = product(back, crossOf(first.spin))
          const k = crossOf(last.spin).map((v, i) => v - then[i])
          // Weighed in: kᵀk and kᵀ·change
          const along = (i: number, v: readonly number[]) => k[i] * v[0] + k[3 + i] * v[1] + k[6 + i] * v[2]
          m = m.map((v, at) => v + along(at % 3, [k[Math.floor(at / 3)], k[3 + Math.floor(at / 3)], k[6 + Math.floor(at / 3)]]))
          b = plus(b, [along(0, change), along(1, change), along(2, change)])
        }
      }
      speedThen = speedNow
      turn = now
      turnedAt = at
    },
    /**
     * From the point the phone turns round to the phone, in its own axes, metres: none while the motion says nothing for
     * sure; −(the eye) turning round the eye. Never further than the eye
     */
    lever(): Vector {
      const sure = m.map((v, i) => (i % 4 === 0 ? v + SURE : v))
      const lever = solve(sure, b)
      if (!lever || !lever.every(Number.isFinite)) return [0, 0, 0]
      const length = Math.hypot(lever[0], lever[1], lever[2])
      return length > EYE_M ? times(lever, EYE_M / length) : lever
    },
    /** Forgets everything, as motion stops */
    reset() {
      turn = undefined
      spinning = [0, 0, 0]
      speed = [0, 0, 0]
      movedAt = undefined
      pushed = [0, 0, 0]
      speedThen = undefined
      gravity = 0
      past = []
      m = [0, 0, 0, 0, 0, 0, 0, 0, 0]
      b = [0, 0, 0]
      weighedAt = undefined
      stillSince = undefined
    },
  }
}

/**
 * The eye, followed: put somewhere (`set`: the neutral, or square on), then stepped on with each
 * of the phone's turns (`orient`), round what the motion says it turns round (`pivotEstimator`) or, with `motion` off,
 * round the phone itself (the gyroscope's alone). As the motion only says what the phone turns round a moment into a
 * gesture, the last REPLAY_MS of turns are gone over again with what it says now, so the start of a turn round the head
 * comes back square on once it is clear that is what it was
 */
export function eyeTracker() {
  const pivot = pivotEstimator()
  /** The eye as settled, at the oldest turn kept */
  let settled: { eye: Vector; turn: Matrix } | undefined
  /** The turns since, and when */
  let turns: { at: number; turn: Matrix }[] = []
  let eye: Vector | undefined
  return {
    motion: pivot.motion,
    /** Puts the eye at `at`, the phone turned `now`: the turns before no longer count */
    set(to: Vector, now: Matrix, at: number) {
      pivot.orient(now, at)
      settled = { eye: to, turn: now }
      turns = []
      eye = to
    },
    /** The phone's turn `now`, at `at` (ms): the eye stepped on, round what the motion says (`motion`) or the phone itself */
    orient(now: Matrix, at: number, motion = true): Vector | undefined {
      pivot.orient(now, at)
      if (!settled) return undefined
      turns.push({ at, turn: now })
      const lever: Vector = motion ? pivot.lever() : [0, 0, 0]
      while (turns.length > 1 && turns[0].at <= at - REPLAY_MS) {
        settled = { eye: eyeStep(settled.eye, settled.turn, turns[0].turn, lever), turn: turns[0].turn }
        turns.shift()
      }
      let next = settled.eye
      let from = settled.turn
      for (const t of turns) {
        next = eyeStep(next, from, t.turn, lever)
        from = t.turn
      }
      eye = next
      return eye
    },
    /** Where the eye is now, in the phone's own axes as last turned, EYE_M away */
    get eye() {
      return eye
    },
    /** What the motion says the phone turns round now (`pivotEstimator`) */
    lever: () => pivot.lever(),
    /** Forgets everything, as motion stops */
    reset() {
      pivot.reset()
      settled = undefined
      turns = []
      eye = undefined
    },
  }
}
