import { useEffect, useRef, useState } from 'react'
import { TILT_LIMIT, clamp } from '../lib/frames'
import { oneEuro, screenAngleNow, tiltFromEye } from '../lib/deviceTilt'
import { type Face, faceDetector } from '../lib/faceDetector'
import { CAMERA_FOV_DEG, LAPTOP_CAMERA_M, PHONE_CAMERA_M, type Seen, cameraEye, sightLine, wellInView } from '../lib/frontCamera'
import { type Quarter, quarterOf } from '../lib/rotate'
import { EYE_M } from '../lib/viewer'
import { setTilt, useTilt } from './tilt'
import { eyeNow, sightEye } from './useDeviceTilt'

/** How long a camera's picture takes to reach the page, ms, where the browser doesn't say when it was taken: a phone's, near enough */
const CAMERA_LAG_MS = 50
/**
 * How many pictures running must find the face well inside (`wellInView`) before what they say counts, after one that
 * didn't: a face glimpsed for a moment (something in the room behind once the face has gone, or the face coming back in
 * at an edge) doesn't move the eye
 */
const SEEN_IN_A_ROW = 3

/** Where the camera stands: off, coming on (asking for the camera, fetching the detector), on, or it couldn't */
export type Camera = 'off' | 'starting' | 'on' | 'failed'

const area = (face: Face) => (face.boundingBox ? face.boundingBox.width * face.boundingBox.height : 0)

/**
 * The front camera, while `on` (Demo's ⋯, never on by itself; Keller, 13 November: "with camera access, we should
 * solve these", then "something that we can try out in whatever format that it needs"): it looks for the viewer's face
 * in every picture (MediaPipe's face detector), and where its two eyes show says where the eye is (`cameraEye`). On a
 * phone whose motion is on (`phone`) that eye is blended into the one its motion follows (`sightEye`), the turns since
 * the picture was taken allowed for, so a turn round the head and one in the hand come apart by sight; on a laptop, which
 * has no motion, the tilt comes from it alone, steadied, the banknote drawn flat on the screen as on a phone (DemoView).
 * Its picture plays in `videoRef`'s <video>, which the caller shows, as wide as `aspect` says for its height, and the
 * two eyes found in it go to `rightRef` and `leftRef`'s two dots over it, placed as shares of it each picture without a
 * render. A phone held sideways with rotation locked (`upright`, which way up it is in the hand) still gives its picture
 * as the screen is, the face in it on its side: it is looked for turned as the view is, upright. Only a face well inside
 * the picture counts (`wellInView`), and only once SEEN_IN_A_ROW pictures running have found one: while none does, as
 * when the phone is tilted further than the camera sees round (Keller, 14 November: "my eye would just go off screen ...
 * we need to have a mechanism where it kind of stays ... based on gyroscope data"), the phone's motion alone carries the
 * tilt, the eye kept where it was last seen in the room (useDeviceTilt), and the dots hide. From between the two eyes,
 * two lines of sight are drawn over the picture, as long as each is far off square on (`sightLine`; Keller, 14 November:
 * "show the line that is coming out of my eye so that I can identify what is going wrong"): `seenRef`'s, the eye as this
 * picture alone has it, and `usedRef`'s, the eye the banknote follows (`eyeNow`, the phone's motion and the pictures so
 * far; on a phone only), so where the two part, the one the banknote follows is slow to the other.
 */
export function useFrontCamera(on: boolean, phone: boolean, turns: number, upright: Quarter = 0) {
  const [camera, setCamera] = useState<Camera>('off')
  /** The picture's width over its height, a laptop's until it comes */
  const [aspect, setAspect] = useState(4 / 3)
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
    // The picture's shape, as it comes and whenever it changes (a phone turned, its picture turning with the page)
    const measure = () => {
      if (el.videoWidth && el.videoHeight) setAspect(el.videoWidth / el.videoHeight)
    }
    el.addEventListener('loadedmetadata', measure)
    el.addEventListener('resize', measure)
    // Asked for at once, with the detector fetched meanwhile
    const asked = navigator.mediaDevices?.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      ?? Promise.reject(new Error('no camera here'))
    Promise.all([faceDetector(), asked]).then(async ([detector, got]) => {
      stream = got
      if (!live) return
      el.muted = true
      el.srcObject = got
      await el.play()
      if (!live) return
      measure()
      setCamera('on')
      let stamp = 0
      /** Pictures running that found the face well inside */
      let inARow = 0
      const look = (now: number, picture?: VideoFrameCallbackMetadata) => {
        if (!live) return
        next()
        if (!el.videoWidth || !el.videoHeight) return
        // The detector wants its moments always later
        stamp = Math.max(performance.now(), stamp + 1)
        const { phone, turns, upright } = latest.current
        let faces: Face[]
        try {
          faces = detector.detectForVideo(el, stamp, { rotationDegrees: upright === 3 ? -90 : upright * 90 }).detections
        } catch {
          inARow = 0
          return
        }
        const face = faces.reduce<Face | undefined>((big, f) => (!big || area(f) > area(big) ? f : big), undefined)
        const [r, l] = face?.keypoints ?? []
        inARow = r && l && wellInView(r, l, el.videoWidth, el.videoHeight) ? inARow + 1 : 0
        const counts = inARow >= SEEN_IN_A_ROW
        place(dots.right, counts ? r : undefined)
        place(dots.left, counts ? l : undefined)
        if (!counts || !r || !l) {
          draw(lines.seen)
          draw(lines.used)
          return
        }
        const screenAngle = screenAngleNow()
        const eye = phone
          ? cameraEye(r, l, el.videoWidth, el.videoHeight, screenAngle, PHONE_CAMERA_M, CAMERA_FOV_DEG.phone)
          : cameraEye(r, l, el.videoWidth, el.videoHeight, screenAngle, LAPTOP_CAMERA_M, CAMERA_FOV_DEG.laptop)
        if (!eye) return
        const between = { x: (r.x + l.x) / 2, y: (r.y + l.y) / 2 }
        const tall = el.videoHeight / el.videoWidth
        draw(lines.seen, between, sightLine(eye, screenAngle), tall)
        // When the picture was taken, where the browser says, else a moment before it reached the page
        const taken = picture?.captureTime
        const came = picture?.presentationTime
        const at = taken !== undefined && now - taken >= 0 && now - taken < 1000 ? taken
          : (came !== undefined && now - came >= 0 && now - came < 500 ? came : now) - CAMERA_LAG_MS
        if (phone) {
          sightEye(eye, at)
          const used = eyeNow()
          draw(lines.used, between, used && sightLine(used, screenAngle), tall)
          return
        }
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
