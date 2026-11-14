import { useEffect, useRef, useState } from 'react'
import { TILT_LIMIT, clamp } from '../lib/frames'
import { nearestTurn, oneEuro, orientationMatrix, roomTilt, screenAngleNow, tiltFromEye, uprightQuarter, type Matrix, type Vector } from '../lib/deviceTilt'
import { type Quarter, quarterOf } from '../lib/rotate'
import { EYE_M, eyeToward, heldDeg, neutralEye, toEarth, toPhone } from '../lib/viewer'
import { setTilt, useTilt } from './tilt'
import { setViewing, useViewing } from './viewing'

/**
 * Where the phone's motion stands: still finding out, waiting on a tap to ask for it (iPhone), on, refused, or not there
 * (a laptop, or a browser that gives none)
 */
export type Motion = 'waiting' | 'ask' | 'on' | 'denied' | 'none'

/** How long to wait for the sensor before doing without */
const WAIT_MS = 600
/** How long Recentre takes to glide to flat */
const RECENTRE_MS = 200
/** How long a phone with rotation locked is held another way up before the view turns to it */
const TURN_VIEW_MS = 1000
/** The room's up, a unit vector, steadied as the tilt is: its parts move a radian's worth for every one of the tilt's */
const UP_CUTOFF = 1.2
const UP_BETA = 0.05 * (180 / Math.PI)
/** How long orientation readings are kept, ms, for an eye seen a moment ago (`sightEye`) */
const SIGHT_MS = 500
/**
 * How long an eye seen from outside takes to bring Demo's most of the way there (all but 1/e), ms, the phone held still.
 * The phone's own motion leads, as it knows a turn at once and exactly, and the camera follows close behind, putting right
 * what the motion can't know (the head moving with the phone, the gyroscope drifting): Keller, 14 November, turning his
 * head up with the phone, of the line the banknote follows, "the pink line doesn't immediately follow, and it kind of like
 * slowly goes into it", and "even when I'm like moving my head slowly" (500 ms until then, after Keller, 13 November, with
 * each picture taking the eye most of the way there: "when i am tilting, it is napping back to normal", since put right
 * by a wider field of view and by going only by a face well inside the picture). The tilt's own One Euro filter steadies
 * what shake comes through
 */
const SIGHT_EASE_MS = 60
/**
 * How fast the phone turns the eye across its screen, degrees a second, at which a picture counts for half as much: the
 * faster, the less, as a picture taken mid-turn is the most out of step with the motion (60 until 14 November: a head
 * turned with the phone, at 30° to 60° a second, now counts nearly in full)
 */
const SIGHT_TURN_DEG_S = 120
/** Over how long that is measured, ms */
const TURN_SPAN_MS = 100
/** The longest wait for a picture that counts, ms: after a pause, the next moves the eye no further than after this long */
const SIGHT_GAP_MS = 100

/** The angle between two directions, degrees */
const angleApart = (a: Vector, b: Vector) =>
  Math.acos(clamp((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1), -1, 1)) * (180 / Math.PI)

/** Where an eye seen from outside Demo goes: to the hook showing Demo's tilt, while it does */
let sighted: ((seen: Vector, at: number) => void) | undefined
/**
 * The viewer's eye seen from outside Demo, in the phone's own axes as it was turned at `at` (ms, as performance.now()):
 * Demo's eye moves towards it in the room (`eyeToward`), the phone's turns since allowed for, gently, SIGHT_EASE_MS taking
 * it most of the way there, and less while the phone turns fast. What the front camera sends (`useFrontCamera`; Keller,
 * 13 November: with the camera on, "everything changes", the camera deciding where the eye is), its switch in ⋯, off
 * until switched on
 */
export const sightEye = (seen: Vector, at: number) => sighted?.(seen, at)

/** How Demo's eye is found now, while it shows the phone's tilt */
let seeing: (() => Vector | undefined) | undefined
/**
 * Demo's eye now, in the phone's own axes as it is turned now: what the banknote's tilt follows, the phone's motion and
 * the camera's pictures as they have it (the front camera's picture draws it, `useFrontCamera`), or undefined before
 * motion comes
 */
export const eyeNow = () => seeing?.()

type Answer = 'granted' | 'denied'
/** What iPhone answered, or `tap` when it couldn't ask, as Safari asks only from a tap: asked again at the next */
type Asked = Answer | 'tap'
type Asks = { requestPermission?: () => Promise<Answer> }
/** iPhone's way: motion only after a tap asks for it, and only on a touch screen (a Mac's Safari has the call too) */
const asks = () =>
  typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as unknown as Asks).requestPermission === 'function'
  && (globalThis.navigator?.maxTouchPoints ?? 0) > 0

const request = (): Promise<Asked> =>
  (DeviceOrientationEvent as unknown as Required<Asks>).requestPermission.call(DeviceOrientationEvent).then(
    (answer) => (answer === 'granted' ? 'granted' : 'denied'),
    // Asked without a tap, Safari answers with this rather than asking
    (error: unknown) => ((error as { name?: unknown } | null)?.name === 'NotAllowedError' ? 'tap' : 'denied'),
  )

/** A question asked from a tap, still waiting on its answer: what another ask meanwhile, or Demo opening, waits on */
let asking: Promise<Asked> | undefined

/**
 * Asks iPhone for motion, from a tap, as Safari asks only from one: the tap on a project that opens it in Demo on a phone
 * (`ProjectList`), so the question comes as Demo opens, and in Demo its first tap anywhere, or its button that asks. Once
 * at a time, as one tap can ask twice
 */
export function askForMotion(): Promise<Asked> {
  if (!asks()) return Promise.resolve('granted')
  asking ??= request().finally(() => { asking = undefined })
  return asking
}

/**
 * The phone's own tilt as every banknote's, in Demo (`src/lib/deviceTilt.ts`): the banknote shown as the viewer's eye sees
 * the phone (src/lib/viewer.ts), steadied, into the tilt store as the `device` source, measured along the banknote's own
 * axes (`turns`, its quarter turns on the view, and the view's own for a phone with rotation locked). The eye starts
 * square on as the phone is held when motion starts and on coming back to the page, how far from lying flat it is held
 * then becoming the neutral, as Recentre makes it, its dial in ⋯ moving there (Keller, 14 November: "a previous logic where
 * we had the center or the neutral position to sit whenever the user opens the site is more smart ... matches more what I
 * expect when I first load the site"; from 13 November until then it started at the neutral, upright unless the dial said
 * otherwise: "Let's keep it fixed"), and then stays put in the room as the phone turns, as the gyroscope says (Keller, 13 November: finding where the
 * eye really is "should just be the camera, and gyro should be how it behaves right now"), and with the front camera on
 * (⋯) where it sees the eye moves it there (`sightEye`). Also says which way up the
 * phone is held (`upright`), for such a phone's view to turn to, read as motion starts and then once it has been held
 * another way up a moment. Recentre makes how far from lying flat it is held now the neutral (on a stand, say), its dial
 * moving there, so held so it is square on, gliding there. The light is the room's, never
 * recentred (Keller, 12 November: "recenter only recenters the like the security features, not how light works"): with
 * every reading goes how the phone lies in the room (`roomTilt`, steadied the same way), the store's `room`, which the
 * lamp and the watermark follow. Always on (Keller, 12 November: "I don't think we even need a tilt toggle ... both should
 * be enabled, and it should ask for permission immediately"): on iPhone, Demo opening asks Safari what it answered
 * before, which it says without asking again (until it is quit), and waits on a tap otherwise.
 */
export function useDeviceTilt(turns: number) {
  const [motion, setMotion] = useState<Motion>(() => (typeof DeviceOrientationEvent === 'undefined' ? 'none' : 'waiting'))
  const [upright, setUpright] = useState<Quarter>(0)
  const neutralDeg = useViewing((s) => s.neutralDeg)
  const latest = useRef({ turns, upright, neutralDeg })
  useEffect(() => { latest.current = { turns, upright, neutralDeg } })
  const reading = useRef<{
    /** The viewer's eye, in the earth's axes, EYE_M from the screen: it stays put in the room as the phone turns */
    eye?: Vector
    /** How the phone was turned at the last reading, for Recentre */
    now?: Matrix
    /** Recent readings, when and how the phone was turned, for an eye seen a moment ago (`sightEye`) */
    past: { at: number; turn: Matrix }[]
    /** When the last eye seen from outside was seen, ms */
    seenAt?: number
    /** The neutral the eye was last put at, degrees */
    neutral?: number
    /** The tilt last set, for Recentre to glide from */
    shown: { x: number; y: number }
    /** How the phone lay in the room at the last reading, steadied (`roomTilt`), which Recentre leaves be */
    room?: { x: number; y: number; up: readonly [number, number, number] }
    glide?: { from: { x: number; y: number }; at: number }
    /**
     * The eye to the neutral at the next reading (it has just come back, or the neutral moved), the tilt gliding there or
     * not; `held`: how the phone is held then is square on, that the neutral now (it has just come back)
     */
    again?: { glide: boolean; held?: boolean }
    /** Another way up the phone has been held, since when */
    turning?: { to: Quarter; since: number }
    /** A reading has come */
    heard: boolean
    /** iPhone allowed motion */
    allowed: boolean
  }>({ past: [], shown: { x: 0, y: 0 }, heard: false, allowed: false })
  const filters = useRef({
    x: oneEuro(), y: oneEuro(), roomX: oneEuro(), roomY: oneEuro(),
    up: [oneEuro(UP_CUTOFF, UP_BETA), oneEuro(UP_CUTOFF, UP_BETA), oneEuro(UP_CUTOFF, UP_BETA)],
  })
  /** Listens to the sensor again, as motion may come only to a listener added since iPhone allowed it */
  const relisten = useRef(() => {})
  /** Gives up on readings that haven't come */
  const wait = useRef<ReturnType<typeof setTimeout>>(undefined)

  /** What iPhone answered: allowed, it comes; refused, for good (until Safari is quit); or a tap is still needed to ask */
  const answered = (answer: Asked) => {
    const r = reading.current
    if (r.heard) return
    if (answer !== 'granted') return setMotion(answer === 'denied' ? 'denied' : 'ask')
    r.allowed = true
    setMotion('waiting')
    relisten.current()
    clearTimeout(wait.current)
    wait.current = setTimeout(() => {
      if (!r.heard) setMotion((now) => (now === 'waiting' ? 'none' : now))
    }, WAIT_MS)
  }

  useEffect(() => {
    if (typeof DeviceOrientationEvent === 'undefined') return
    const r = reading.current
    const steady = filters.current
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null && event.gamma === null) return
      const now = orientationMatrix({ alpha: event.alpha ?? 0, beta: event.beta ?? 0, gamma: event.gamma ?? 0 })
      const at = performance.now()
      const screenAngle = screenAngleNow()
      // Which way up it is held: straight away as motion starts, then once it has stayed another way up a moment
      const way = uprightQuarter(now, screenAngle, r.heard ? latest.current.upright : undefined)
      if (!r.heard) {
        r.heard = true
        setMotion('on')
        if (way !== undefined) {
          latest.current.upright = way
          setUpright(way)
        }
      } else if (way !== undefined && way !== latest.current.upright) {
        if (r.turning?.to !== way) r.turning = { to: way, since: at }
        else if (at - r.turning.since >= TURN_VIEW_MS) {
          r.turning = undefined
          latest.current.upright = way
          setUpright(way)
        }
      } else r.turning = undefined
      // The eye: square on as the phone is held when motion starts or comes back, how far from lying flat it is held then
      // the neutral now, as Recentre makes it, its dial moving there; at the neutral as that moves (the dial, or Recentre,
      // gliding there); and otherwise where it was in the room as the phone turns
      if (!r.eye || r.again?.held) {
        const deg = heldDeg(now)
        latest.current.neutralDeg = deg
        if (useViewing.getState().neutralDeg !== deg) setViewing({ neutralDeg: deg })
      }
      const { neutralDeg } = latest.current
      if (!r.eye || r.again) {
        if (r.eye && r.again?.glide) r.glide = { from: r.shown, at }
        r.eye = toEarth(now, neutralEye(now, screenAngle, latest.current.upright, neutralDeg))
        r.neutral = neutralDeg
        r.again = undefined
        filters.current.x.reset()
        filters.current.y.reset()
      }
      r.now = now
      r.past.push({ at, turn: now })
      while (r.past.length > 1 && r.past[0].at < at - SIGHT_MS) r.past.shift()
      const eye = toPhone(now, r.eye)
      const raw = tiltFromEye([eye[0] / EYE_M, eye[1] / EYE_M, eye[2] / EYE_M], screenAngle, quarterOf(latest.current.turns + latest.current.upright), TILT_LIMIT)
      let x = filters.current.x.next(raw.x, at)
      let y = filters.current.y.next(raw.y, at)
      if (r.glide) {
        const k = clamp((at - r.glide.at) / RECENTRE_MS, 0, 1)
        const left = 1 - k * k * (3 - 2 * k)
        x += r.glide.from.x * left
        y += r.glide.from.y * left
        if (k >= 1) r.glide = undefined
      }
      x = clamp(x, -TILT_LIMIT, TILT_LIMIT)
      y = clamp(y, -TILT_LIMIT, TILT_LIMIT)
      r.shown = { x, y }
      // How it lies in the room, for the light, from the room's up alone: neither Recentre nor coming back moves it. Its ↔
      // steadied a whole turn from where it was, as face down overhead it can wrap round
      const lies = roomTilt(now, screenAngle, latest.current.upright, quarterOf(latest.current.turns + latest.current.upright))
      const up = lies.up.map((v, i) => steady.up[i].next(v, at))
      const room = {
        x: steady.roomX.next(r.room ? nearestTurn(lies.x, r.room.x) : lies.x, at),
        y: steady.roomY.next(r.room ? nearestTurn(lies.y, r.room.y) : lies.y, at),
        up: [up[0], up[1], up[2]] as const,
      }
      r.room = room
      const s = useTilt.getState()
      if (s.source !== 'device' || s.target !== y || s.targetX !== x || s.room?.x !== room.x || s.room?.y !== room.y) {
        setTilt({ source: 'device', target: y, targetX: x, room })
      }
    }
    // Back on the page: square on again as it is held then, gliding there
    const onVisible = () => {
      if (document.visibilityState === 'visible') r.again = { glide: true, held: true }
    }
    // An eye seen from outside: into the room as the phone was turned then (the reading nearest), where the eye is kept,
    // moving it there as far as the time since the last says, the less the faster the phone was turning
    seeing = () => (r.eye && r.now ? toPhone(r.now, r.eye) : undefined)
    sighted = (seen, at) => {
      const last = r.past.at(-1)
      if (!r.eye || !last) return
      const near = (time: number) => r.past.reduce((nearest, p) => (Math.abs(p.at - time) < Math.abs(nearest.at - time) ? p : nearest), last)
      const then = near(at)
      const before = near(at - TURN_SPAN_MS)
      const speed = then.at > before.at ? (angleApart(toPhone(then.turn, r.eye), toPhone(before.turn, r.eye)) * 1000) / (then.at - before.at) : 0
      const gap = r.seenAt === undefined ? 0 : clamp(at - r.seenAt, 0, SIGHT_GAP_MS)
      r.seenAt = Math.max(at, r.seenAt ?? at)
      const share = (1 - Math.exp(-gap / SIGHT_EASE_MS)) / (1 + (speed / SIGHT_TURN_DEG_S) ** 2)
      r.eye = eyeToward(r.eye, toEarth(then.turn, seen), share)
    }
    window.addEventListener('deviceorientation', onOrientation)
    document.addEventListener('visibilitychange', onVisible)
    relisten.current = () => {
      window.removeEventListener('deviceorientation', onOrientation)
      window.addEventListener('deviceorientation', onOrientation)
    }
    // No reading meanwhile: none comes (a laptop, or a browser that gives none), or on iPhone, still unasked, it waits on a
    // tap (unless Safari has said already, below)
    wait.current = setTimeout(() => {
      if (!r.heard) setMotion((now) => (now !== 'waiting' ? now : asks() && !r.allowed ? 'ask' : 'none'))
    }, WAIT_MS)
    return () => {
      clearTimeout(wait.current)
      relisten.current = () => {}
      sighted = undefined
      seeing = undefined
      window.removeEventListener('deviceorientation', onOrientation)
      document.removeEventListener('visibilitychange', onVisible)
      r.eye = undefined
      r.now = undefined
      r.past = []
      r.seenAt = undefined
      r.neutral = undefined
      r.again = undefined
      r.glide = undefined
      r.shown = { x: 0, y: 0 }
      r.room = undefined
      for (const filter of [steady.roomX, steady.roomY, ...steady.up]) filter.reset()
      r.heard = false
      // Off the phone's tilt, back to flat, lit as the tilt is
      if (useTilt.getState().source === 'device') {
        setTilt({ source: 'drag', target: 0, targetX: 0, nudge: 0, nudgeX: 0, nudged: 0, nudgedX: 0, room: undefined })
      }
    }
  }, [])

  // iPhone gives motion only once asked. Asked already (the tap on a project that opened Demo, or earlier while Safari has
  // been open), Safari says what it was answered without asking again; never asked, a tap asks (`allow`)
  useEffect(() => {
    if (!asks()) return
    let alive = true
    void (asking ?? request()).then((answer) => {
      if (alive) answered(answer)
    })
    return () => { alive = false }
  }, [])

  /** Asks for motion, from a tap (iPhone): Demo's first tap anywhere, or its button that asks */
  const allow = () => {
    if (motion === 'ask') void askForMotion().then(answered)
  }

  // The neutral moved (its dial in ⋯): the eye goes there at once
  useEffect(() => {
    const r = reading.current
    if (r.eye && r.neutral !== neutralDeg) r.again = { ...r.again, glide: r.again?.glide ?? false }
  }, [neutralDeg])

  /**
   * Makes how far from lying flat the phone is held now the neutral, its dial in ⋯ moving there (Keller, 13 November: the
   * neutral is "just one value that we change in multiple ways ... if I put it on a stand ... I can just hit that"): held
   * so it is square on, gliding there
   */
  const recentre = () => {
    const r = reading.current
    if (!r.eye || !r.now) return
    const deg = heldDeg(r.now)
    latest.current.neutralDeg = deg
    r.again = { glide: true }
    setViewing({ neutralDeg: deg })
  }

  return { motion, upright: motion === 'on' ? upright : (0 as Quarter), allow, recentre }
}

/**
 * Keeps the screen from dimming and locking while Demo shows (Screen Wake Lock, iPhone Safari 16.4 and later), taken again
 * on coming back to the page, as leaving it lets it go
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wakeLock = (globalThis.navigator as Navigator | undefined)?.wakeLock
    if (!active || !wakeLock) return
    let alive = true
    let lock: WakeLockSentinel | undefined
    const take = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return
      try {
        const next = await wakeLock.request('screen')
        if (alive) lock = next
        else void next.release()
      } catch { /* refused (low battery, a frame): the screen may dim as usual */ }
    }
    const onVisible = () => { void take() }
    void take()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [active])
}
