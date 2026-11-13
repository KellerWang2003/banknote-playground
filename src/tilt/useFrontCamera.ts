import { useEffect, useRef, useState } from 'react'
import { TILT_LIMIT, clamp } from '../lib/frames'
import { oneEuro, screenAngleNow, tiltFromEye } from '../lib/deviceTilt'
import { type Face, faceDetector } from '../lib/faceDetector'
import { LAPTOP_CAMERA_M, PHONE_CAMERA_M, type Seen, cameraEye } from '../lib/frontCamera'
import { quarterOf } from '../lib/rotate'
import { EYE_M } from '../lib/viewer'
import { setTilt, useTilt } from './tilt'
import { sightEye } from './useDeviceTilt'

/** How late a camera's picture comes, ms, where the browser doesn't say: a phone's, near enough */
const CAMERA_LAG_MS = 60

/** Where the camera stands: off, coming on (asking for the camera, fetching the detector), on, or it couldn't */
export type Camera = 'off' | 'starting' | 'on' | 'failed'

const area = (face: Face) => (face.boundingBox ? face.boundingBox.width * face.boundingBox.height : 0)

/**
 * The front camera, while `on` (Demo's ⋯, on the dev server for now; Keller, 13 November: "with camera access, we should
 * solve these", then "something that we can try out in whatever format that it needs"): it looks for the viewer's face
 * in every picture (MediaPipe's face detector), and where its two eyes show says where the eye is (`cameraEye`). On a
 * phone whose motion is on (`phone`) that eye is blended into the one its motion follows (`sightEye`), the turns since
 * the picture was taken allowed for, so a turn round the head and one in the hand come apart by sight; on a laptop, which
 * has no motion, the tilt comes from it alone, steadied, the banknote drawn flat on the screen as on a phone (DemoView).
 * Its picture plays in `videoRef`'s <video>, which the caller shows, and the two eyes found in it go to `rightRef` and
 * `leftRef`'s two dots over it, placed as shares of it each picture without a render.
 */
export function useFrontCamera(on: boolean, phone: boolean, turns: number) {
  const [camera, setCamera] = useState<Camera>('off')
  const videoRef = useRef<HTMLVideoElement>(null)
  const rightRef = useRef<HTMLElement>(null)
  const leftRef = useRef<HTMLElement>(null)
  const latest = useRef({ phone, turns })
  useEffect(() => { latest.current = { phone, turns } })

  useEffect(() => {
    const el = videoRef.current
    const dots = { right: rightRef.current, left: leftRef.current }
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
    setCamera('starting')
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
      setCamera('on')
      let stamp = 0
      const look = (now: number, picture?: VideoFrameCallbackMetadata) => {
        if (!live) return
        next()
        if (!el.videoWidth || !el.videoHeight) return
        // The detector wants its moments always later
        stamp = Math.max(performance.now(), stamp + 1)
        let faces: Face[]
        try {
          faces = detector.detectForVideo(el, stamp).detections
        } catch {
          return
        }
        const face = faces.reduce<Face | undefined>((big, f) => (!big || area(f) > area(big) ? f : big), undefined)
        const [r, l] = face?.keypoints ?? []
        place(dots.right, r)
        place(dots.left, l)
        if (!r || !l) return
        const { phone, turns } = latest.current
        const screenAngle = screenAngleNow()
        const eye = cameraEye(r, l, el.videoWidth, el.videoHeight, screenAngle, phone ? PHONE_CAMERA_M : LAPTOP_CAMERA_M)
        if (!eye) return
        // When the picture was taken, where the browser says, else a moment ago
        const taken = picture?.captureTime
        const at = taken !== undefined && now - taken >= 0 && now - taken < 1000 ? taken : performance.now() - CAMERA_LAG_MS
        if (phone) {
          sightEye(eye, at)
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
      if (frame !== undefined) cancelAnimationFrame(frame)
      // Stopped even if it comes after this, as `stream` is set before `live` is looked at
      asked.then((got) => got.getTracks().forEach((track) => track.stop()), () => {})
      stream?.getTracks().forEach((track) => track.stop())
      el.srcObject = null
      place(dots.right)
      place(dots.left)
      setCamera('off')
      // A laptop's tilt, the camera's, back to flat; a phone's is its motion's
      const s = useTilt.getState()
      if (!latest.current.phone && s.source === 'device') setTilt({ source: 'drag', target: 0, targetX: 0, nudge: 0, nudgeX: 0, nudged: 0, nudgedX: 0 })
    }
  }, [on])

  return { camera, videoRef, rightRef, leftRef }
}
