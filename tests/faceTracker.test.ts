import { resolveObjectURL } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eyesOf } from '../src/lib/faceTracker'

const CODE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm/vision_wasm_internal.wasm'
const MODELS = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
/** How big the two are, bytes */
const BYTES = { code: 14_466_654, models: 3_758_596 }
const ALL = BYTES.code + BYTES.models

interface Files { wasmLoaderPath: string; wasmBinaryPath: string }
interface Options { baseOptions: { modelAssetBuffer?: Uint8Array; modelAssetPath?: string; delegate: string }; runningMode: string }
/**
 * MediaPipe as the tracker meets it, in place of the one fetched from the CDN: what each landmarker was made from (its
 * code, if it came as a file's own address, read there and then, as MediaPipe would), which of them can't be made, and
 * what holds the making up
 */
const mediapipe = vi.hoisted(() => ({
  made: [] as { files: Files; options: Options; code?: { bytes: number; type: string } }[],
  fails: [] as string[],
  noCode: false,
  wait: undefined as Promise<void> | undefined,
}))
vi.mock('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/vision_bundle.mjs', () => ({
  FilesetResolver: {
    forVisionTasks: async (path: string): Promise<Files> => {
      if (mediapipe.noCode) throw new Error('no code')
      return { wasmLoaderPath: `${path}/vision_wasm_internal.js`, wasmBinaryPath: `${path}/vision_wasm_internal.wasm` }
    },
  },
  FaceLandmarker: {
    createFromOptions: async (files: Files, options: Options) => {
      const code = files.wasmBinaryPath.startsWith('blob:') ? resolveObjectURL(files.wasmBinaryPath) : undefined
      mediapipe.made.push({ files, options, code: code && { bytes: code.size, type: code.type } })
      await mediapipe.wait
      if (mediapipe.fails.includes(options.baseOptions.delegate)) throw new Error(`no ${options.baseOptions.delegate}`)
      const mesh = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
      return { detect: () => ({ faceLandmarks: [mesh] }) }
    },
  },
}))

describe('a face’s eyes from its mesh', () => {
  /** A mesh of 478 points, all at the picture's middle but those given */
  const mesh = (points: Record<number, { x: number; y: number }>) =>
    Array.from({ length: 478 }, (_, i) => points[i] ?? { x: 0.5, y: 0.5 })

  it('are the middle of each eye’s two corners, the viewer’s right eye on the picture’s left', () => {
    const eyes = eyesOf(mesh({ 33: { x: 0.3, y: 0.4 }, 133: { x: 0.4, y: 0.42 }, 362: { x: 0.5, y: 0.42 }, 263: { x: 0.6, y: 0.4 } }))!
    expect(eyes.right.x).toBeCloseTo(0.35, 12)
    expect(eyes.right.y).toBeCloseTo(0.41, 12)
    expect(eyes.left.x).toBeCloseTo(0.55, 12)
    expect(eyes.left.y).toBeCloseTo(0.41, 12)
  })

  it('stay put as the eyes look about: the irises, which the mesh has too, don’t count', () => {
    const corners = { 33: { x: 0.3, y: 0.4 }, 133: { x: 0.4, y: 0.4 }, 362: { x: 0.5, y: 0.4 }, 263: { x: 0.6, y: 0.4 } }
    const ahead = eyesOf(mesh({ ...corners, 468: { x: 0.35, y: 0.4 }, 473: { x: 0.55, y: 0.4 } }))
    const aside = eyesOf(mesh({ ...corners, 468: { x: 0.38, y: 0.4 }, 473: { x: 0.58, y: 0.4 } }))
    expect(aside).toEqual(ahead)
  })

  it('are none for a mesh without them', () => {
    expect(eyesOf([])).toBeUndefined()
    expect(eyesOf(mesh({}).slice(0, 200))).toBeUndefined()
  })
})

describe('the face tracker, fetched', () => {
  /** A download the test feeds: `send` so many more bytes, `end` it, or `lose` it part way */
  function download() {
    let feed!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start: (controller) => { feed = controller } })
    return {
      response: new Response(body),
      send: (bytes: number) => feed.enqueue(new Uint8Array(bytes)),
      end: () => feed.close(),
      lose: () => feed.error(new Error('lost')),
    }
  }
  let code = download()
  let models = download()
  /** What each address answers, and what it was asked with */
  let answers: Record<string, () => Promise<Response>> = {}
  const asked: { url: string; signal?: AbortSignal }[] = []
  /** Until a download has been asked for at `url` */
  const askedFor = (url: string) => vi.waitFor(() => expect(asked.map((ask) => ask.url)).toContain(url))

  beforeEach(() => {
    vi.resetModules()
    Object.assign(mediapipe, { made: [], fails: [], noCode: false, wait: undefined })
    code = download()
    models = download()
    answers = { [CODE]: async () => code.response, [MODELS]: async () => models.response }
    asked.length = 0
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      asked.push({ url, signal: init?.signal ?? undefined })
      return answers[url]()
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('says how much of its code and models has come as they come, both at once, then hands them to MediaPipe', async () => {
    const { faceTracker, useTrackerLoading } = await import('../src/lib/faceTracker')
    const fetched = () => useTrackerLoading.getState().fetched
    const said: (number | undefined)[] = []
    useTrackerLoading.subscribe((state) => said.push(state.fetched))
    // Nothing fetched until it is asked for (Keller, 13 November: "people might not want cameras")
    expect(fetched()).toBeUndefined()
    expect(asked).toEqual([])
    let ready!: () => void
    mediapipe.wait = new Promise((resolve) => { ready = resolve })
    const tracker = faceTracker()
    // From the first: nothing yet, the models asked for at once and the code as soon as MediaPipe says which
    expect(fetched()).toBe(0)
    expect(asked.map((ask) => ask.url)).toEqual([MODELS])
    await askedFor(CODE)
    // Half the models: a tenth of it all
    models.send(BYTES.models / 2)
    await vi.waitFor(() => expect(fetched()).toBe(0.1))
    // Half the code too: just short of half of it all, in hundredths
    code.send((BYTES.code - 2) / 2)
    await vi.waitFor(() => expect(fetched()).toBe(0.49))
    // The models whole, the code still coming, and nothing made meanwhile
    models.send(BYTES.models / 2)
    models.end()
    await vi.waitFor(() => expect(fetched()).toBe(0.6))
    expect(mediapipe.made).toEqual([])
    // All of it: full, while it is set up, from the code as a file of its own and the models as bytes
    code.send((BYTES.code + 2) / 2)
    code.end()
    await vi.waitFor(() => expect(mediapipe.made).toHaveLength(1))
    expect(fetched()).toBe(1)
    const [{ files, options, code: handed }] = mediapipe.made
    expect(files.wasmLoaderPath).toBe('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm/vision_wasm_internal.js')
    expect(files.wasmBinaryPath).toMatch(/^blob:/)
    // A browser compiles it as it streams only if it comes as WebAssembly
    expect(handed).toEqual({ bytes: BYTES.code, type: 'application/wasm' })
    expect(options.baseOptions.modelAssetBuffer).toHaveLength(BYTES.models)
    expect(options.baseOptions.modelAssetPath).toBeUndefined()
    expect(options).toMatchObject({ baseOptions: { delegate: 'GPU' }, runningMode: 'IMAGE', numFaces: 4, minFacePresenceConfidence: 0.7 })
    // Ready: no longer on its way, the code's address let go, and it finds a face's eyes
    ready()
    const { eyesIn } = await tracker
    expect(fetched()).toBeUndefined()
    expect(resolveObjectURL(files.wasmBinaryPath)).toBeUndefined()
    expect(eyesIn({} as HTMLVideoElement)).toEqual([{ right: { x: 0.5, y: 0.5 }, left: { x: 0.5, y: 0.5 } }])
    // Never back, and each hundredth said once
    const steps = said.slice(0, -1) as number[]
    expect(steps.every((step, i) => i === 0 || step > steps[i - 1])).toBe(true)
    expect(said.at(-1)).toBeUndefined()
    // Made once and kept
    expect(faceTracker()).toBe(tracker)
    expect(asked).toHaveLength(2)
  })

  it('counts a file bigger or smaller than it was as far as its share goes, and whole once it has come', async () => {
    const { faceTracker, useTrackerLoading } = await import('../src/lib/faceTracker')
    const fetched = () => useTrackerLoading.getState().fetched
    mediapipe.wait = new Promise(() => {})
    void faceTracker()
    await askedFor(CODE)
    // The models twice as big: their share and no more
    models.send(BYTES.models)
    models.send(BYTES.models)
    await vi.waitFor(() => expect(fetched()).toBe(Math.floor((BYTES.models / ALL) * 100) / 100))
    models.end()
    // The code a tenth smaller, as it is for a browser without SIMD: short of full until it ends
    code.send(BYTES.code - 1_551_253)
    await vi.waitFor(() => expect(fetched()).toBe(0.91))
    code.end()
    await vi.waitFor(() => expect(fetched()).toBe(1))
  })

  it('leaves to MediaPipe a file it couldn’t fetch itself, counted as come', async () => {
    const { faceTracker, useTrackerLoading } = await import('../src/lib/faceTracker')
    // The code lost part way, the models not there
    answers[MODELS] = async () => new Response('gone', { status: 404 })
    const tracker = faceTracker()
    await askedFor(CODE)
    code.send(1000)
    code.lose()
    await tracker
    expect(mediapipe.made).toHaveLength(1)
    const [{ files, options }] = mediapipe.made
    expect(files.wasmBinaryPath).toBe(CODE)
    expect(options.baseOptions.modelAssetPath).toBe(MODELS)
    expect(options.baseOptions.modelAssetBuffer).toBeUndefined()
    expect(useTrackerLoading.getState().fetched).toBeUndefined()
  })

  it('makes it on the CPU where the GPU can’t, from the same code and models', async () => {
    const { faceTracker } = await import('../src/lib/faceTracker')
    mediapipe.fails = ['GPU']
    const tracker = faceTracker()
    await askedFor(CODE)
    models.send(BYTES.models)
    models.end()
    code.send(BYTES.code)
    code.end()
    await tracker
    expect(mediapipe.made.map((made) => made.options.baseOptions.delegate)).toEqual(['GPU', 'CPU'])
    const [gpu, cpu] = mediapipe.made
    // The code still there for the second, and let go after it
    expect(cpu.code).toEqual({ bytes: BYTES.code, type: 'application/wasm' })
    expect(cpu.files.wasmBinaryPath).toBe(gpu.files.wasmBinaryPath)
    expect(cpu.options.baseOptions.modelAssetBuffer).toBe(gpu.options.baseOptions.modelAssetBuffer)
    expect(resolveObjectURL(cpu.files.wasmBinaryPath)).toBeUndefined()
    expect(asked).toHaveLength(2)
  })

  it('stops fetching once it can’t be had, on its way no longer, and starts afresh when asked again', async () => {
    const { faceTracker, useTrackerLoading } = await import('../src/lib/faceTracker')
    const fetched = () => useTrackerLoading.getState().fetched
    // MediaPipe's own script couldn't be had, the models part way
    mediapipe.noCode = true
    const tracker = faceTracker()
    models.send(BYTES.models / 2)
    await expect(tracker).rejects.toThrow('no code')
    expect(fetched()).toBeUndefined()
    expect(asked).toHaveLength(1)
    expect(asked[0].signal?.aborted).toBe(true)
    // What comes of the old download says nothing
    models.send(BYTES.models / 2)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetched()).toBeUndefined()
    // Asked again: fetched again, from nothing
    mediapipe.noCode = false
    models = download()
    const again = faceTracker()
    expect(again).not.toBe(tracker)
    expect(fetched()).toBe(0)
    await askedFor(CODE)
    models.send(BYTES.models)
    models.end()
    code.send(BYTES.code)
    code.end()
    await again
    expect(fetched()).toBeUndefined()
    expect(asked.map((ask) => ask.url)).toEqual([MODELS, MODELS, CODE])
  })

  it('is on its way no longer once it can’t be made, on the GPU or the CPU', async () => {
    const { faceTracker, useTrackerLoading } = await import('../src/lib/faceTracker')
    mediapipe.fails = ['GPU', 'CPU']
    const tracker = faceTracker()
    await askedFor(CODE)
    models.send(BYTES.models)
    models.end()
    code.send(BYTES.code)
    code.end()
    await expect(tracker).rejects.toThrow('no CPU')
    expect(useTrackerLoading.getState().fetched).toBeUndefined()
    expect(resolveObjectURL(mediapipe.made[0].files.wasmBinaryPath)).toBeUndefined()
    // Asked again, it is tried again
    const again = faceTracker()
    expect(again).not.toBe(tracker)
    await expect(again).rejects.toThrow('no CPU')
    expect(mediapipe.made).toHaveLength(4)
  })
})
