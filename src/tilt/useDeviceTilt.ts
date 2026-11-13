import { useEffect, useRef, useState } from 'react'
import { TILT_LIMIT, clamp } from '../lib/frames'
import { nearestTurn, oneEuro, orientationMatrix, roomTilt, screenAngleNow, tiltFromEye, uprightQuarter } from '../lib/deviceTilt'
import { type Quarter, quarterOf } from '../lib/rotate'
import { EYE_M, SQUARE_ON, eyeTracker, neutralEye } from '../lib/viewer'
import { setTilt, useTilt } from './tilt'
import { useViewing } from './viewing'

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
 * axes (`turns`, its quarter turns on the view, and the view's own for a phone with rotation locked). The eye starts at
 * the neutral, the phone held upright square on unless its dial in ⋯ says otherwise (Keller, 13 November: "the default
 * position is set to be wherever the site loads ... Let's keep it fixed"), as motion starts and on coming back to the
 * page, and then stays put in the room as the phone turns, or, head-aware (⋯, on by default), goes round with the phone
 * as it goes round the head, so only a turn in the hand tilts it, as the accelerometer tells. Also says which way up the
 * phone is held (`upright`), for such a phone's view to turn to, read as motion starts and then once it has been held
 * another way up a moment. Recentre makes how it is held now square on, gliding there. The light is the room's, never
 * recentred (Keller, 12 November: "recenter only recenters the like the security features, not how light works"): with
 * every reading goes how the phone lies in the room (`roomTilt`, steadied the same way), the store's `room`, which the
 * lamp and the watermark follow. Always on (Keller, 12 November: "I don't think we even need a tilt toggle ... both should
 * be enabled, and it should ask for permission immediately"): on iPhone, Demo opening asks Safari what it answered
 * before, which it says without asking again (until it is quit), and waits on a tap otherwise.
 */
export function useDeviceTilt(turns: number) {
  const [motion, setMotion] = useState<Motion>(() => (typeof DeviceOrientationEvent === 'undefined' ? 'none' : 'waiting'))
  const [upright, setUpright] = useState<Quarter>(0)
  const headAware = useViewing((s) => s.headAware)
  const neutralDeg = useViewing((s) => s.neutralDeg)
  const latest = useRef({ turns, upright, headAware, neutralDeg })
  useEffect(() => { latest.current = { turns, upright, headAware, neutralDeg } })
  const reading = useRef<{
    /** The tilt last set, for Recentre to glide from */
    shown: { x: number; y: number }
    /** How the phone lay in the room at the last reading, steadied (`roomTilt`), which Recentre leaves be */
    room?: { x: number; y: number; up: readonly [number, number, number] }
    glide?: { from: { x: number; y: number }; at: number }
    /**
     * Where the eye goes at the next reading: to the neutral (motion has just come back, or the neutral moved) or square
     * on (Recentre), the tilt gliding there or not
     */
    again?: { to: 'neutral' | 'square'; glide: boolean }
    /** Another way up the phone has been held, since when */
    turning?: { to: Quarter; since: number }
    /** A reading has come */
    heard: boolean
    /** iPhone allowed motion */
    allowed: boolean
  }>({ shown: { x: 0, y: 0 }, heard: false, allowed: false })
  /** The viewer's eye, followed (viewer.ts) */
  const [eyes] = useState(eyeTracker)
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
      // The eye: at the neutral as motion starts or comes back, or as the neutral moves; square on with Recentre, gliding
      // there; and otherwise on from where it was as the phone turns, head-aware or the gyroscope's alone
      const { headAware, neutralDeg } = latest.current
      const tracker = eyes
      if (!tracker.eye || r.again) {
        if (tracker.eye && r.again?.glide) r.glide = { from: r.shown, at }
        tracker.set(r.again?.to === 'square' ? SQUARE_ON : neutralEye(now, screenAngle, latest.current.upright, neutralDeg), now, at)
        r.again = undefined
        filters.current.x.reset()
        filters.current.y.reset()
      } else tracker.orient(now, at, headAware)
      const eye = tracker.eye ?? SQUARE_ON
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
    // The accelerometer, which says what the phone turns round
    const onMotion = (event: DeviceMotionEvent) => {
      eyes.motion(event.acceleration, event.accelerationIncludingGravity, performance.now())
    }
    // Back on the page: the eye at the neutral again, gliding there
    const onVisible = () => {
      if (document.visibilityState === 'visible') r.again = { to: 'neutral', glide: true }
    }
    window.addEventListener('deviceorientation', onOrientation)
    window.addEventListener('devicemotion', onMotion)
    document.addEventListener('visibilitychange', onVisible)
    relisten.current = () => {
      window.removeEventListener('deviceorientation', onOrientation)
      window.removeEventListener('devicemotion', onMotion)
      window.addEventListener('deviceorientation', onOrientation)
      window.addEventListener('devicemotion', onMotion)
    }
    // No reading meanwhile: none comes (a laptop, or a browser that gives none), or on iPhone, still unasked, it waits on a
    // tap (unless Safari has said already, below)
    wait.current = setTimeout(() => {
      if (!r.heard) setMotion((now) => (now !== 'waiting' ? now : asks() && !r.allowed ? 'ask' : 'none'))
    }, WAIT_MS)
    return () => {
      clearTimeout(wait.current)
      relisten.current = () => {}
      window.removeEventListener('deviceorientation', onOrientation)
      window.removeEventListener('devicemotion', onMotion)
      document.removeEventListener('visibilitychange', onVisible)
      eyes.reset()
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
  }, [eyes])

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
    if (eyes.eye) reading.current.again = { to: 'neutral', glide: false }
  }, [eyes, neutralDeg])

  /** Makes how the phone is held now square on, gliding there */
  const recentre = () => {
    if (eyes.eye) reading.current.again = { to: 'square', glide: true }
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
