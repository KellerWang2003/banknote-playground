// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { cameraEye } from '../src/lib/frontCamera'
import { useTilt } from '../src/tilt/tilt'
import { useFrontCamera } from '../src/tilt/useFrontCamera'

type Point = { x: number; y: number }
type Face = { right: Point; left: Point }
type Vector = readonly [number, number, number]
/**
 * What the face tracker finds in each picture it looks at, one entry a look; how many it has looked at; and how long each
 * look takes, ms, all it has taken so far being the time `performance.now()` tells
 */
const found = vi.hoisted(() => ({ pictures: [] as { right: { x: number; y: number }; left: { x: number; y: number } }[][], looks: 0, took: 0, spent: 0 }))
vi.mock('../src/lib/faceTracker', () => ({
  faceTracker: async () => ({
    eyesIn: () => {
      found.looks++
      found.spent += found.took
      return found.pictures.shift() ?? []
    },
  }),
}))
/**
 * The eyes sent on to the phone's motion, the eye the banknote follows meanwhile, and where Demo has the eye in the
 * room, the phone unturned so that its own axes are the room's (none before motion comes)
 */
const sent = vi.hoisted(() => ({ eyes: [] as unknown[], now: undefined as readonly [number, number, number] | undefined, room: undefined as readonly [number, number, number] | undefined }))
vi.mock('../src/tilt/useDeviceTilt', () => ({
  sightEye: (eye: unknown) => { sent.eyes.push(eye) },
  eyeNow: () => sent.now,
  inRoom: (seen: unknown) => (sent.room ? { seen, eye: sent.room } : undefined),
}))

const W = 480, H = 640
/** A face with its eyes level round (`x`, `y`), `apart` px apart, in a 480 × 640 picture */
const face = (x: number, y: number, apart = 96): Face => ({ right: { x: x - apart / 2 / W, y }, left: { x: x + apart / 2 / W, y } })
/** The eye a phone's camera makes of a face */
const eyeOf = ({ right, left }: Face) => cameraEye(right, left, W, H, 0)!
/** 28 cm away, a little above the screen's middle: 21° off square on */
const middle = face(0.5, 0.4)
/** As near, low on the picture's left: 36° from `middle` */
const lowerLeft = face(0.25, 0.8)
/** Half over the top edge, as the detector alone gave it: eyes 15 px inside */
const overTop = face(0.5, 0.024, 83)

function Camera({ phone }: { phone: boolean }) {
  const { videoRef, rightRef, leftRef, seenRef, usedRef } = useFrontCamera(true, phone, 0)
  return (
    <div>
      <video ref={videoRef} />
      <span data-testid="right" ref={rightRef} />
      <span data-testid="left" ref={leftRef} />
      <svg>
        <line data-testid="seen" ref={seenRef} />
        <line data-testid="used" ref={usedRef} />
      </svg>
    </div>
  )
}

describe('the front camera, a face coming and going', () => {
  const frames: ((now: number, picture: object) => void)[] = []
  const restore: (() => void)[] = []
  let clock = 0
  const stub = (target: object, key: string, value: PropertyDescriptor) => {
    const before = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, { configurable: true, ...value })
    restore.push(() => (before ? Object.defineProperty(target, key, before) : delete (target as Record<string, unknown>)[key]))
  }
  /** The camera on, a phone's whose motion is on, or a laptop's */
  const start = async (phone = true) => {
    render(<Camera phone={phone} />)
    await vi.waitFor(() => expect(frames.length).toBe(1))
  }
  /** The next picture, 33 ms on, the tracker finding `faces` in it */
  const picture = (...faces: Face[]) => {
    found.pictures.push(faces)
    clock += 33
    act(() => frames.at(-1)!(clock, {}))
  }
  const pictures = (count: number, ...faces: Face[]) => {
    for (let i = 0; i < count; i++) picture(...faces)
  }
  const dotsShow = () => screen.getByTestId('right').style.opacity === '1' && screen.getByTestId('left').style.opacity === '1'
  /** Where the right eye's dot is, as shares of the picture */
  const rightDot = () => [parseFloat(screen.getByTestId('right').style.left) / 100, parseFloat(screen.getByTestId('right').style.top) / 100]
  /** A line drawn, as shares of the picture: where it starts and how far it goes, or undefined while hidden */
  const line = (id: 'seen' | 'used') => {
    const el = screen.getByTestId(id)
    if (el.style.opacity !== '1') return undefined
    const share = (name: string) => parseFloat(el.getAttribute(name)!) / 100
    return { from: [share('x1'), share('y1')], by: [share('x2') - share('x1'), share('y2') - share('y1')] }
  }
  const apart = (a: Vector, b: Vector) => (Math.acos((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))) * 180) / Math.PI

  beforeEach(() => {
    frames.length = 0
    found.pictures.length = 0
    found.looks = 0
    found.took = 0
    found.spent = 0
    sent.eyes.length = 0
    sent.now = undefined
    sent.room = undefined
    clock = 1000
    stub(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [] }) } })
    stub(HTMLVideoElement.prototype, 'videoWidth', { get: () => W })
    stub(HTMLVideoElement.prototype, 'videoHeight', { get: () => H })
    stub(HTMLMediaElement.prototype, 'play', { value: async () => {} })
    stub(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { value: (callback: (typeof frames)[number]) => frames.push(callback) })
    stub(performance, 'now', { value: () => found.spent })
  })
  afterEach(() => {
    cleanup()
    restore.splice(0).reverse().forEach((undo) => undo())
  })

  it('goes by a face only once three pictures running have found it well inside', async () => {
    await start()
    pictures(2, middle)
    expect(sent.eyes).toHaveLength(0)
    expect(dotsShow()).toBe(false)
    picture(middle)
    expect(sent.eyes).toHaveLength(1)
    expect(dotsShow()).toBe(true)
    picture(middle)
    expect(sent.eyes).toHaveLength(2)
  })

  it('leaves the eye to the phone’s motion while the face is half out of the picture or gone, then takes three again', async () => {
    await start()
    pictures(3, middle)
    expect(sent.eyes).toHaveLength(1)
    // Leaving over the top: its eyes too near the edge to go by
    pictures(3, overTop)
    picture()
    expect(sent.eyes).toHaveLength(1)
    expect(dotsShow()).toBe(false)
    // Glimpsed for a moment
    picture(middle)
    picture()
    expect(sent.eyes).toHaveLength(1)
    // Back, well inside
    pictures(2, middle)
    expect(sent.eyes).toHaveLength(1)
    picture(middle)
    expect(sent.eyes).toHaveLength(2)
    expect(dotsShow()).toBe(true)
  })

  it('draws the line of sight from between the eyes, as the picture has it and as the banknote follows it', async () => {
    await start()
    pictures(3, middle)
    // High in the picture, so above the screen: the eye looks down to it; the banknote's eye not yet there, none of its own
    const seen = line('seen')!
    expect(seen.from[0]).toBeCloseTo(0.5, 9)
    expect(seen.from[1]).toBeCloseTo(0.4, 9)
    expect(seen.by[1]).toBeGreaterThan(0)
    expect(line('used')).toBeUndefined()
    // The banknote square on: a line of no length; then 45° to the screen's right, looking back left, the camera's right
    sent.now = [0, 0, 0.35]
    picture(middle)
    expect(line('used')!.by).toEqual([0, 0])
    sent.now = [0.25, 0, 0.25]
    picture(middle)
    const used = line('used')!
    // Half the picture's height across, the picture three quarters as wide as tall
    expect(used.by[0]).toBeCloseTo(0.5 * (H / W), 9)
    expect(used.by[1]).toBeCloseTo(0, 9)
    // Gone with the face
    picture(overTop)
    expect(line('seen')).toBeUndefined()
    expect(line('used')).toBeUndefined()
  })

  it('doesn’t go by a face nearer or farther than someone looking at the screen', async () => {
    await start()
    // Eyes 19 px apart: 1.4 m away, something in the room behind
    pictures(6, face(0.5, 0.4, 19))
    expect(sent.eyes).toHaveLength(0)
    expect(dotsShow()).toBe(false)
    // Eyes 192 px apart, well inside the picture still: 14 cm away, nearer than a face is held
    pictures(6, face(0.5, 0.4, 192))
    expect(sent.eyes).toHaveLength(0)
    // 1.1 m, at arm's length and more: a viewer still
    pictures(3, face(0.5, 0.4, 24.6))
    expect(sent.eyes).toHaveLength(1)
  })

  it('goes by a face that turns up near where the eye is taken to be after three pictures, by one somewhere else only after half a second', async () => {
    await start()
    // Demo's eye in the room where the face in the middle would be looking from: the viewer's, out of the picture a while
    sent.room = eyeOf(middle)
    expect(apart(eyeOf(lowerLeft), sent.room)).toBeGreaterThan(25)
    // Something else in the room, found picture after picture (Keller, 14 November: "thinking my background is my eyes"):
    // 16 pictures, 495 ms from the first to the last
    pictures(16, lowerLeft)
    expect(sent.eyes).toHaveLength(0)
    expect(dotsShow()).toBe(false)
    // Lost for one picture: half a second over again
    picture()
    pictures(16, lowerLeft)
    expect(sent.eyes).toHaveLength(0)
    // Still there half a second on: the viewer after all, who moved meanwhile
    picture(lowerLeft)
    expect(sent.eyes).toEqual([eyeOf(lowerLeft)])
    expect(dotsShow()).toBe(true)
    // The viewer back where the eye was kept: three pictures
    picture()
    pictures(2, middle)
    expect(sent.eyes).toHaveLength(1)
    picture(middle)
    expect(sent.eyes).toHaveLength(2)
    expect(sent.eyes.at(-1)).toEqual(eyeOf(middle))
  })

  it('doesn’t go by two faces found by turns, each for a picture', async () => {
    await start()
    for (let i = 0; i < 6; i++) {
      picture(middle)
      picture(lowerLeft)
    }
    expect(sent.eyes).toHaveLength(0)
    expect(dotsShow()).toBe(false)
  })

  it('goes by the nearest of several faces, and stays with the one it follows unless another is clearly nearer', async () => {
    await start()
    // The viewer and someone behind, eyes 96 px and 40 px apart
    const behind = face(0.75, 0.2, 40)
    pictures(3, behind, middle)
    expect(sent.eyes).toEqual([eyeOf(middle)])
    expect(rightDot()[0]).toBeCloseTo(middle.right.x, 9)
    // Someone leans in beside, a little nearer (eyes 110 px apart): the one followed stays, without a break
    const beside = face(0.25, 0.75, 110)
    pictures(3, beside, middle, behind)
    expect(sent.eyes).toEqual([eyeOf(middle), eyeOf(middle), eyeOf(middle), eyeOf(middle)])
    // Clearly nearer (140 px, as from 28 cm to 19 cm): that one is the viewer now, after three pictures of its own
    const nearer = face(0.3, 0.7, 140)
    pictures(2, nearer, middle)
    expect(sent.eyes).toHaveLength(4)
    picture(nearer, middle)
    expect(sent.eyes).toHaveLength(5)
    expect(sent.eyes.at(-1)).toEqual(eyeOf(nearer))
    expect(rightDot()[0]).toBeCloseTo(nearer.right.x, 9)
  })

  it('follows a face as it moves across the picture, but takes one that jumps or changes size for another', async () => {
    await start()
    pictures(3, middle)
    expect(sent.eyes).toHaveLength(1)
    // A third of its eyes' spacing a picture: the same face, going on counting
    for (let i = 1; i <= 3; i++) picture(face(0.5 - (i * 32) / W, 0.4))
    expect(sent.eyes).toHaveLength(4)
    // Nearly twice its eyes' spacing away at once: another face, three pictures again
    pictures(2, face(0.65, 0.4))
    expect(sent.eyes).toHaveLength(4)
    picture(face(0.65, 0.4))
    expect(sent.eyes).toHaveLength(5)
    // In the same place, half as big again: another
    pictures(2, face(0.65, 0.4, 144))
    expect(sent.eyes).toHaveLength(5)
  })

  it('on a laptop, tilts by a face somewhere else than the one last gone by only after half a second', async () => {
    await start(false)
    pictures(3, middle)
    const first = useTilt.getState()
    expect(first.source).toBe('device')
    // Off to the side, where no one was: not the tilt's yet
    picture()
    pictures(16, lowerLeft)
    expect(useTilt.getState()).toBe(first)
    expect(dotsShow()).toBe(false)
    picture(lowerLeft)
    expect(useTilt.getState()).not.toBe(first)
    expect(dotsShow()).toBe(true)
  })

  it('lets pictures go by after a slow look, so that looking takes no more than a third of the time', async () => {
    await start()
    // 10 ms a look, a picture every 33: each is looked at
    found.took = 10
    pictures(6, middle)
    expect(found.looks).toBe(6)
    expect(sent.eyes).toHaveLength(4)
    // 20 ms: every other one, the eyes staying where the last look had them meanwhile
    found.took = 20
    pictures(6, middle)
    expect(found.looks).toBe(9)
    expect(sent.eyes).toHaveLength(7)
    expect(dotsShow()).toBe(true)
    // Half a second, as the first look can be: the next comes a fifth of a second on, not a second and a half
    found.took = 500
    picture(middle)
    expect(found.looks).toBe(10)
    found.took = 10
    pictures(6, middle)
    expect(found.looks).toBe(10)
    picture(middle)
    expect(found.looks).toBe(11)
  })

  it('counts three looks, not three pictures, before going by a face', async () => {
    await start()
    found.took = 20
    pictures(4, middle)
    expect(found.looks).toBe(2)
    expect(sent.eyes).toHaveLength(0)
    picture(middle)
    expect(found.looks).toBe(3)
    expect(sent.eyes).toHaveLength(1)
  })
})
