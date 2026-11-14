import { create } from 'zustand'
import { type Seen } from './frontCamera'

/** MediaPipe's tasks for the web, the face landmarker among them: fetched as the camera first comes on, never bundled */
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0'
/**
 * Its face landmarker's models, 3.8 MB: a face detector (BlazeFace, short range, which the front camera went by on its
 * own until 14 November) and a mesh of 478 points fitted to each face that finds, which also says how surely there is a
 * face there at all. The detector alone takes much else for one (Keller, 14 November: "it is making another mistake
 * thinking my background is my eyes ... see if there is a existing project that does head and eyesight tracking pretty
 * well"): of 18 views of a cat, coins, a flower, gravel, stars, the moon, motorcycles and a page of text that it found a
 * face in, 0.52 to 0.79 sure, the mesh fitted one, a head on a coin. The mesh also keeps a face's eyes within a pixel or
 * two as it leaves over an edge, where the detector alone put them up to 40 px further in than they were
 */
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
/**
 * How big the two big files it needs are, bytes: MediaPipe's code (WebAssembly, `vision_wasm_internal.wasm`) and the
 * models, 18 MB between them, fewer as they come, the code squeezed. The bar that shows them coming goes by these
 * (`useTrackerLoading`), as a file that comes squeezed doesn't say how big it will be
 */
const BYTES = { code: 14_466_654, models: 3_758_596 }
/**
 * How surely the mesh must fit, 0 to 1, for there to be a face. Real faces fitted as surely at 0.7 as at 0.5 however
 * small, dim, blurred or turned over; at 0.9 a blurred one was lost sooner
 */
const SURE = 0.7
/** How many faces it fits a mesh to in a picture, the ones the detector is surest of: the viewer, and whoever looks on */
const FACES = 4
/**
 * Each picture is looked over afresh (the landmarker's IMAGE mode), not each face followed from the last picture by
 * where its mesh was (its VIDEO mode), which loses its place when a face moves far between two looks, as when the phone
 * is flicked or the looks come slowly: turned 9° a look, a face leaving over the top came back 8° nearer the middle than
 * it was, still well inside, on a plain wall and a busy one alike, and afresh never more than 0.2° off in 80 sweeps over
 * every edge. Afresh is also the quicker, as following looks for new faces in every picture besides (22 ms a look to 31),
 * and takes no more else for a face; the phone's own motion says where the eye is between looks (`useDeviceTilt`)
 */
const MODE = 'IMAGE'
/** The mesh's points at the two corners of the viewer's right eye (on the picture's left, as the camera sees) and left */
const RIGHT_EYE = [33, 133] as const
const LEFT_EYE = [362, 263] as const

/** A face's two eyes in the camera's picture, as shares of it, unmirrored: the viewer's right eye, on its left, and left */
export interface Eyes {
  right: Seen
  left: Seen
}
export interface FaceTracker {
  /**
   * The eyes of each face in the video's picture now: looked for in the picture turned `rotationDegrees` clockwise
   * (quarter turns), and placed in it as it is, unturned
   */
  eyesIn(video: HTMLVideoElement, rotationDegrees?: number): Eyes[]
}
/** The landmarker as it comes from the CDN, untyped: what of it the front camera uses */
interface Landmarker {
  detect(picture: HTMLVideoElement, options?: { rotationDegrees?: number }): { faceLandmarks?: Seen[][] }
}
/** Where MediaPipe's code is: the script that starts it, and the WebAssembly that script fetches */
interface Files {
  wasmLoaderPath: string
  wasmBinaryPath: string
}
interface Vision {
  FilesetResolver: { forVisionTasks(path: string): Promise<Files> }
  FaceLandmarker: { createFromOptions(files: Files, options: object): Promise<Landmarker> }
}

const between = (a: Seen, b: Seen): Seen => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
/**
 * A face's two eyes from its mesh: the middle of each from its two corners, which stays put as the eye looks about (the
 * mesh has the irises too, which go with the look). Undefined for a mesh without them
 */
export function eyesOf(mesh: Seen[]): Eyes | undefined {
  const [rightOuter, rightInner, leftInner, leftOuter] = [...RIGHT_EYE, ...LEFT_EYE].map((point) => mesh[point])
  return rightOuter && rightInner && leftInner && leftOuter
    ? { right: between(rightOuter, rightInner), left: between(leftInner, leftOuter) }
    : undefined
}

/**
 * How much of the tracker's code and models has come, 0 to 1, from when it is first asked for until it can look, so 1
 * while it is set up; undefined before and after, and once it couldn't be had. Demo shows it as a bar where the
 * camera's picture will be (Keller, 14 November: "lets add a little progress abr for the google thing to load as right
 * now it just feels like it is stuck when loading")
 */
export const useTrackerLoading = create<{ fetched: number | undefined }>(() => ({ fetched: undefined }))

/** `url` fetched whole, as a file of that `type`, `came` told how many bytes there are so far as each piece comes */
async function fetchedFrom(url: string, type: string, signal: AbortSignal, came: (bytes: number) => void) {
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) throw new Error(`${response.status}: ${url}`)
  const reader = response.body.getReader()
  const pieces: BlobPart[] = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return new Blob(pieces, { type })
    pieces.push(value)
    bytes += value.length
    came(bytes)
  }
}

const looking = (landmarker: Landmarker): FaceTracker => ({
  eyesIn: (video, rotationDegrees = 0) =>
    (landmarker.detect(video, { rotationDegrees }).faceLandmarks ?? []).flatMap((mesh) => eyesOf(mesh) ?? []),
})

let tracking: Promise<FaceTracker> | undefined
/**
 * The face tracker for the front camera (`useFrontCamera`), made once and kept: on the GPU where it can be, else the
 * CPU. Its code and models are fetched here, both at once, and handed to MediaPipe, rather than left for it to fetch,
 * one after the other and saying nothing meanwhile, so that how much has come can be told as it comes
 * (`useTrackerLoading`). One that can't be fetched here is left to MediaPipe as before
 */
export const faceTracker = () =>
  (tracking ??= (async (): Promise<FaceTracker> => {
    const came = { code: 0, models: 0 }
    const stop = new AbortController()
    let over = false
    // How much has come, in hundredths, said as it changes
    const say = () => {
      const fetched = Math.floor(((came.code + came.models) / (BYTES.code + BYTES.models)) * 100) / 100
      if (!over && fetched !== useTrackerLoading.getState().fetched) useTrackerLoading.setState({ fetched })
    }
    // One of the two files, or undefined if it couldn't be fetched here; all of it counted as come either way
    const part = (name: keyof typeof BYTES, url: string, type: string) =>
      fetchedFrom(url, type, stop.signal, (bytes) => {
        came[name] = Math.min(bytes, BYTES[name])
        say()
      }).catch(() => undefined).finally(() => {
        came[name] = BYTES[name]
        say()
      })
    say()
    try {
      const models = part('models', FACE_MODEL, 'application/octet-stream')
      const vision = (await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`)) as Vision
      const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`)
      const [code, model] = await Promise.all([part('code', files.wasmBinaryPath, 'application/wasm'), models])
      // The code as an address of its own, which lasts until it is let go, and the models as bytes
      const codeUrl = code && URL.createObjectURL(code)
      const modelBytes = model && new Uint8Array(await model.arrayBuffer())
      const make = (delegate: 'GPU' | 'CPU') =>
        vision.FaceLandmarker.createFromOptions(codeUrl ? { ...files, wasmBinaryPath: codeUrl } : files, {
          baseOptions: { ...(modelBytes ? { modelAssetBuffer: modelBytes } : { modelAssetPath: FACE_MODEL }), delegate },
          runningMode: MODE,
          numFaces: FACES,
          minFacePresenceConfidence: SURE,
        })
      return looking(await make('GPU').catch(() => make('CPU')).finally(() => {
        if (codeUrl) URL.revokeObjectURL(codeUrl)
      }))
    } finally {
      over = true
      stop.abort()
      useTrackerLoading.setState({ fetched: undefined })
    }
  })().catch((error: unknown) => {
    tracking = undefined
    throw error
  }))
