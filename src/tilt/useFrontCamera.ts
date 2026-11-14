import { useEffect, useRef, useState } from 'react'
import { TILT_LIMIT, clamp } from '../lib/frames'
import { type Vector, oneEuro, screenAngleNow, tiltFromEye } from '../lib/deviceTilt'
import { type Eyes, faceTracker } from '../lib/faceTracker'
import { CAMERA_FOV_DEG, FACE_AWAY_M, LAPTOP_CAMERA_M, PHONE_CAMERA_M, type Seen, cameraEye, faceAway, sightLine, wellInView } from '../lib/frontCamera'
import { type Quarter, quarterOf } from '../lib/rotate'
import { EYE_M, angleApart } from '../lib/viewer'
import { setTilt, useTilt } from './tilt'
import { eyeNow, inRoom, sightEye } from './useDeviceTilt'

/** How long a camera's picture takes to reach the page, ms, where the browser doesn't say when it was taken: a phone's, near enough */
const CAMERA_LAG_MS = 50
/**
 * How many pictures running, of those looked at (`LOOK_REST`), must find the same face (`SAME_FACE`), well inside
 * (`wellInView`) and as far away as a viewer is (`FACE_AWAY_M`), before what they say counts: a face glimpsed for a
 * moment, or coming back in at an edge, doesn't move the eye
 */
const SEEN_IN_A_ROW = 3
/**
 * A face found in one picture is the one found in the last looked at if the point between its eyes has moved no further
 * than `moved` times as far as they were apart, and they are no more than `grown` times as far apart or as close
 * together: a look on, a face is still nearly where it was and as big, and another face is somewhere else or another size
 */
const SAME_FACE = { moved: 1.5, grown: 1.3 }
/**
 * How many times as far apart another face's eyes must show, so how much nearer it must be, to be gone by rather than
 * the one followed so far: whoever holds the phone is the nearest to it, and of two much the same the first stays
 */
const NEARER = 1.3
/**
 * How far from where Demo has the eye a face may turn up, degrees, and count once SEEN_IN_A_ROW pictures have found it:
 * in the room on a phone, where the eye stays put while the face is out of the picture (`inRoom`), and from the eye last
 * gone by on a laptop. Further off than that it is more likely something else in the room than the viewer come back
 * (Keller, 14 November: "it is making another mistake thinking my background is my eyes"), and counts only after being
 * found for ELSEWHERE_MS on end, ms, as the viewer does who has moved meanwhile, or handed the phone on
 */
const ELSEWHERE_DEG = 25
const ELSEWHERE_MS = 500
/**
 * How long looking for faces rests: from when a look began, `times` as long as it took, though no longer than `most`,
 * ms, the pictures that come meanwhile let go by. So looking takes no more than a third of the time, and the banknote
 * stays smooth, on a phone slow at it (fitting a face's mesh takes some three times as long as finding the face alone
 * did), while one slow look, as the first is with the tracker warming up, costs no more than a moment. The phone's
 * motion carries the tilt meanwhile, and a picture counts for more the longer it has been since the last (`sightEye`)
 */
const LOOK_REST = { times: 3, most: 200 }

/** Where the camera stands: off, coming on (asking for the camera, fetching the face tracker), on, or it couldn't */
export type Camera = 'off' | 'starting' | 'on' | 'failed'
/**
 * The shape a camera's picture will likely have, its width over its height, before it comes: a phone's or a tablet's
 * comes turned as its screen is, so tall on one held upright, and a laptop's comes wide. Its place shows meanwhile
 * (DemoView), and so doesn't change shape as the picture comes
 */
const likelyAspect = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse) and (orientation: portrait)').matches ? 3 / 4 : 4 / 3

/** A face found in a picture that could be the viewer's: its eyes, the eye they make, the point between them, and how far apart they show, px */
interface Found extends Eyes {
  eye: Vector
  between: Seen
  apart: number
}
/**
 * The face followed from look to look: where it was in the last picture looked at and how many running have found it,
 * since when (ms), and whether it turned up near where Demo had the eye
 */
interface Run {
  between: Seen
  apart: number
  pictures: number
  since: number
  near: boolean
}

/**
 * The front camera, while `on` (Demo's ⋯, never on by itself; Keller, 13 November: "with camera access, we should
 * solve these", then "something that we can try out in whatever format that it needs"): it looks for the viewer's face
 * in each picture, or in as many as leaves the banknote most of the time (MediaPipe's face landmarker, `faceTracker`;
 * `LOOK_REST`), and where its two eyes show says where the eye is (`cameraEye`). On a
 * phone whose motion is on (`phone`) that eye is blended into the one its motion follows (`sightEye`), the turns since
 * the picture was taken allowed for, so a turn round the head and one in the hand come apart by sight; on a laptop, which
 * has no motion, the tilt comes from it alone, steadied, the banknote drawn flat on the screen as on a phone (DemoView).
 * Its picture plays in `videoRef`'s <video>, which the caller shows, as wide as `aspect` says for its height, and the
 * two eyes found in it go to `rightRef` and `leftRef`'s two dots over it, placed as shares of it each picture without a
 * render. A phone held sideways with rotation locked (`upright`, which way up it is in the hand) still gives its picture
 * as the screen is, the face in it on its side: it is looked for turned as the view is, upright. Only a face well inside
 * the picture counts (`wellInView`), and only once SEEN_IN_A_ROW pictures running have found it: while none does, as
 * when the phone is tilted further than the camera sees round (Keller, 14 November: "my eye would just go off screen ...
 * we need to have a mechanism where it kind of stays ... based on gyroscope data"), the phone's motion alone carries the
 * tilt, the eye kept where it was last seen in the room (useDeviceTilt), and the dots hide. Nor does anything else in the
 * picture count for the viewer (Keller, 14 November: "it is making another mistake thinking my background is my eyes"):
 * the tracker fits a face's mesh to what it finds and drops what that doesn't fit; a face nearer or farther than a viewer
 * is doesn't count (`FACE_AWAY_M`); of several the one followed so far is gone by, or one clearly nearer (`NEARER`),
 * else the nearest; and one that turns up away from where Demo has the eye must stay found half a second first
 * (`ELSEWHERE_DEG`, `ELSEWHERE_MS`). From between the two eyes,
 * two lines of sight are drawn over the picture, as long as each is far off square on (`sightLine`; Keller, 14 November:
 * "show the line that is coming out of my eye so that I can identify what is going wrong"): `seenRef`'s, the eye as this
 * picture alone has it, and `usedRef`'s, the eye the banknote follows (`eyeNow`, the phone's motion and the pictures so
 * far; on a phone only), so where the two part, the one the banknote follows is slow to the other.
 */
export function useFrontCamera(on: boolean, phone: boolean, turns: number, upright: Quarter = 0) {
  const [camera, setCamera] = useState<Camera>('off')
  /** The picture's width over its height, as it will likely be until it comes */
  const [aspect, setAspect] = useState(likelyAspect)
  const videoRef = useRef<HTMLVideoElement>(null)
  const rightRef = useRef<HTMLElement>(null)
  const leftRef = useRef<HTMLElement>(null)
  const seenRef = useRef<SVGLineElement>(null)
  const usedRef = useRef<SVGLineElement>(null)
  const latest = useRef({ phone, turns, upright })
  useEffect(() => { latest.current = { phone, turns, upright } })

  useEffect(() => {
    const el = videoRef.current
    const dots = { right: rightRef.current, left: leftRef.current }
    const lines = { seen: seenRef.current, used: usedRef.current }
    if (!on || !el) return
    let live = true
    let stream: MediaStream | undefined
    let frame: number | undefined
    const steady = { x: oneEuro(), y: oneEuro() }
    const place = (dot: HTMLElement | null, seen?: Seen) => {
      if (!dot) return
      dot.style.opacity = seen ? '1' : '0'
      if (seen) {
        dot.style.left = `${seen.x * 100}%`
        dot.style.top = `${seen.y * 100}%`
      }
    }
    // A line of sight from `from`, `toward` it (`sightLine`, shares of the picture's height), the picture `tall` times as
    // tall as it is wide; hidden without them
    const draw = (line: SVGLineElement | null, from?: Seen, toward?: { x: number; y: number }, tall = 1) => {
      if (!line) return
      line.style.opacity = from && toward ? '1' : '0'
      if (!from || !toward) return
      line.setAttribute('x1', `${from.x * 100}%`)
      line.setAttribute('y1', `${from.y * 100}%`)
      line.setAttribute('x2', `${(from.x + toward.x * tall) * 100}%`)
      line.setAttribute('y2', `${(from.y + toward.y) * 100}%`)
    }
    setCamera('starting')
    setAspect(likelyAspect())
    // The picture's shape, as it comes and whenever it changes (a phone turned, its picture turning with the page)
    const measure = () => {
      if (el.videoWidth && el.videoHeight) setAspect(el.videoWidth / el.videoHeight)
    }
    el.addEventListener('loadedmetadata', measure)
    el.addEventListener('resize', measure)
    // Asked for at once, with the face tracker fetched meanwhile
    const asked = navigator.mediaDevices?.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      ?? Promise.reject(new Error('no camera here'))
    Promise.all([faceTracker(), asked]).then(async ([tracker, got]) => {
      stream = got
      if (!live) return
      el.muted = true
      el.srcObject = got
      await el.play()
      if (!live) return
      measure()
      setCamera('on')
      /** The face followed, while pictures running find it */
      let run: Run | undefined
      /** A laptop's eye as last gone by, which doesn't move but with the viewer */
      let lastSeen: Vector | undefined
      /** The last look for faces: when it began, as its picture's call said, and how long it took, ms */
      let looked = { at: -Infinity, took: 0 }
      const look = (now: number, picture?: VideoFrameCallbackMetadata) => {
        if (!live) return
        next()
        const width = el.videoWidth
        const height = el.videoHeight
        if (!width || !height) return
        // Let go by, so soon after a slow look
        if (now - looked.at < Math.min(LOOK_REST.times * looked.took, LOOK_REST.most)) return
        const began = performance.now()
        const { phone, turns, upright } = latest.current
        let faces: Eyes[]
        try {
          faces = tracker.eyesIn(el, upright === 3 ? -90 : upright * 90)
        } catch {
          faces = []
        }
        looked = { at: now, took: performance.now() - began }
        // When the picture was taken, where the browser says, else a moment before it reached the page
        const taken = picture?.captureTime
        const came = picture?.presentationTime
        const at = taken !== undefined && now - taken >= 0 && now - taken < 1000 ? taken
          : (came !== undefined && now - came >= 0 && now - came < 500 ? came : now) - CAMERA_LAG_MS
        const screenAngle = screenAngleNow()
        const fov = phone ? CAMERA_FOV_DEG.phone : CAMERA_FOV_DEG.laptop
        // The faces that could be the viewer's: well inside the picture, and as far away as someone looking at the screen
        const found = faces.flatMap(({ right, left }): Found[] => {
          const away = faceAway(right, left, width, height, fov)
          const eye = cameraEye(right, left, width, height, screenAngle, phone ? PHONE_CAMERA_M : LAPTOP_CAMERA_M, fov)
          if (away === undefined || !eye || away < FACE_AWAY_M.nearest || away > FACE_AWAY_M.farthest || !wellInView(right, left, width, height)) return []
          return [{ right, left, eye, between: { x: (right.x + left.x) / 2, y: (right.y + left.y) / 2 }, apart: Math.hypot((right.x - left.x) * width, (right.y - left.y) * height) }]
        })
        // The one followed so far, if it is still there and none is clearly nearer, else the nearest
        const moved = (face: Found, from: Run) => Math.hypot((face.between.x - from.between.x) * width, (face.between.y - from.between.y) * height)
        const before = run
        const followed = before && found
          .filter((face) => moved(face, before) <= SAME_FACE.moved * before.apart && face.apart <= before.apart * SAME_FACE.grown && face.apart >= before.apart / SAME_FACE.grown)
          .reduce<Found | undefined>((best, face) => (!best || moved(face, before) < moved(best, before) ? face : best), undefined)
        const nearest = found.reduce<Found | undefined>((best, face) => (!best || face.apart > best.apart ? face : best), undefined)
        const face = followed && nearest && nearest.apart <= followed.apart * NEARER ? followed : nearest
        if (!face) run = undefined
        else if (before && face === followed) run = { ...before, between: face.between, apart: face.apart, pictures: before.pictures + 1 }
        else {
          // A face newly found: near where Demo has the eye, or somewhere else
          const placed = phone ? inRoom(face.eye, at) : undefined
          const had = phone ? placed?.eye : lastSeen
          run = { between: face.between, apart: face.apart, pictures: 1, since: at, near: !had || angleApart(placed?.seen ?? face.eye, had) <= ELSEWHERE_DEG }
        }
        const counts = !!run && run.pictures >= SEEN_IN_A_ROW && (run.near || at - run.since >= ELSEWHERE_MS)
        place(dots.right, counts ? face?.right : undefined)
        place(dots.left, counts ? face?.left : undefined)
        if (!counts || !face) {
          draw(lines.seen)
          draw(lines.used)
          return
        }
        const { eye, between } = face
        const tall = height / width
        draw(lines.seen, between, sightLine(eye, screenAngle), tall)
        if (phone) {
          sightEye(eye, at)
          const used = eyeNow()
          draw(lines.used, between, used && sightLine(used, screenAngle), tall)
          return
        }
        lastSeen = eye
        const tilt = tiltFromEye([eye[0] / EYE_M, eye[1] / EYE_M, eye[2] / EYE_M], screenAngle, quarterOf(turns), TILT_LIMIT)
        setTilt({ source: 'device', target: clamp(steady.y.next(tilt.y, at), -TILT_LIMIT, TILT_LIMIT), targetX: clamp(steady.x.next(tilt.x, at), -TILT_LIMIT, TILT_LIMIT) })
      }
      // Each new picture, or each frame where the browser can't say when one comes
      const next = () => {
        if (typeof el.requestVideoFrameCallback === 'function') el.requestVideoFrameCallback(look)
        else frame = requestAnimationFrame((now) => look(now))
      }
      next()
    }).catch((error: unknown) => {
      if (!live) return
      console.warn('Front camera:', error)
      setCamera('failed')
    })
    return () => {
      live = false
      el.removeEventListener('loadedmetadata', measure)
      el.removeEventListener('resize', measure)
      if (frame !== undefined) cancelAnimationFrame(frame)
      // Stopped even if it comes after this, as `stream` is set before `live` is looked at
      asked.then((got) => got.getTracks().forEach((track) => track.stop()), () => {})
      stream?.getTracks().forEach((track) => track.stop())
      el.srcObject = null
      place(dots.right)
      place(dots.left)
      draw(lines.seen)
      draw(lines.used)
      setCamera('off')
      // A laptop's tilt, the camera's, back to flat; a phone's is its motion's
      const s = useTilt.getState()
      if (!latest.current.phone && s.source === 'device') setTilt({ source: 'drag', target: 0, targetX: 0, nudge: 0, nudgeX: 0, nudged: 0, nudgedX: 0 })
    }
  }, [on])

  return { camera, aspect, videoRef, rightRef, leftRef, seenRef, usedRef }
}
