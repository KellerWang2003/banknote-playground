import { type Seen } from './frontCamera'

/** MediaPipe's tasks for the web, the face detector among them: fetched as the camera first comes on, never bundled */
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0'
/** Its short-range face model (BlazeFace), for a face within a couple of metres, as a front camera sees one */
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

/** A face as MediaPipe finds it, what of it the front camera uses (it comes from the CDN untyped) */
export interface Face {
  boundingBox?: { width: number; height: number }
  /** BlazeFace's six: the right eye, the left eye, the nose, the mouth and the two ears, as shares of the picture */
  keypoints: Seen[]
}
export interface FaceDetector {
  /** The faces in the video's picture now, at `at` ms, always later than the last */
  detectForVideo(video: HTMLVideoElement, at: number): { detections: Face[] }
}
interface Vision {
  FilesetResolver: { forVisionTasks(path: string): Promise<unknown> }
  FaceDetector: { createFromOptions(files: unknown, options: object): Promise<FaceDetector> }
}

let detecting: Promise<FaceDetector> | undefined
/** The face detector for the front camera (`useFrontCamera`), made once and kept: on the GPU where it can be, else the CPU */
export const faceDetector = () =>
  (detecting ??= (async () => {
    const vision = (await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`)) as Vision
    const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`)
    const make = (delegate: 'GPU' | 'CPU') =>
      vision.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: 'VIDEO' })
    return make('GPU').catch(() => make('CPU'))
  })().catch((error: unknown) => {
    detecting = undefined
    throw error
  }))
