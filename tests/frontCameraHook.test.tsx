// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useFrontCamera } from '../src/tilt/useFrontCamera'

type Point = { x: number; y: number }
/** What the face detector finds in each picture to come, one entry a picture */
const found = vi.hoisted(() => ({ pictures: [] as { keypoints: Point[] }[][] }))
vi.mock('../src/lib/faceDetector', () => ({
  faceDetector: async () => ({ detectForVideo: () => ({ detections: found.pictures.shift() ?? [] }) }),
}))
/** The eyes sent on to the phone's motion, and the eye the banknote follows meanwhile */
const sent = vi.hoisted(() => ({ eyes: [] as unknown[], now: undefined as [number, number, number] | undefined }))
vi.mock('../src/tilt/useDeviceTilt', () => ({ sightEye: (eye: unknown) => { sent.eyes.push(eye) }, eyeNow: () => sent.now }))

/** A face with its two eyes at `right` and `left`, as shares of a 480 × 640 picture */
const face = (right: Point, left: Point) => ({ keypoints: [right, left, { x: 0.5, y: 0.6 }, { x: 0.5, y: 0.7 }] })
const middle = face({ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 })
/** Half over the top edge, as the detector gives it: eyes 15 px inside */
const overTop = face({ x: 0.425, y: 0.024 }, { x: 0.598, y: 0.024 })

function Camera() {
  const { videoRef, rightRef, leftRef, seenRef, usedRef } = useFrontCamera(true, true, 0)
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
  const stub = (target: object, key: string, value: PropertyDescriptor) => {
    const before = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, { configurable: true, ...value })
    restore.push(() => (before ? Object.defineProperty(target, key, before) : delete (target as Record<string, unknown>)[key]))
  }
  /** The next picture, the detector finding `faces` in it */
  const picture = (...faces: { keypoints: Point[] }[]) => {
    found.pictures.push(faces)
    act(() => frames.at(-1)!(performance.now(), {}))
  }
  const dotsShow = () => screen.getByTestId('right').style.opacity === '1' && screen.getByTestId('left').style.opacity === '1'
  /** A line drawn, as shares of the picture: where it starts and how far it goes, or undefined while hidden */
  const line = (id: 'seen' | 'used') => {
    const el = screen.getByTestId(id)
    if (el.style.opacity !== '1') return undefined
    const share = (name: string) => parseFloat(el.getAttribute(name)!) / 100
    return { from: [share('x1'), share('y1')], by: [share('x2') - share('x1'), share('y2') - share('y1')] }
  }

  beforeEach(async () => {
    frames.length = 0
    found.pictures.length = 0
    sent.eyes.length = 0
    sent.now = undefined
    stub(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [] }) } })
    stub(HTMLVideoElement.prototype, 'videoWidth', { get: () => 480 })
    stub(HTMLVideoElement.prototype, 'videoHeight', { get: () => 640 })
    stub(HTMLMediaElement.prototype, 'play', { value: async () => {} })
    stub(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { value: (callback: (typeof frames)[number]) => frames.push(callback) })
    render(<Camera />)
    await vi.waitFor(() => expect(frames.length).toBe(1))
  })
  afterEach(() => {
    cleanup()
    restore.splice(0).reverse().forEach((undo) => undo())
  })

  it('goes by a face only once three pictures running have found it well inside', () => {
    picture(middle)
    picture(middle)
    expect(sent.eyes).toHaveLength(0)
    expect(dotsShow()).toBe(false)
    picture(middle)
    expect(sent.eyes).toHaveLength(1)
    expect(dotsShow()).toBe(true)
    picture(middle)
    expect(sent.eyes).toHaveLength(2)
  })

  it('leaves the eye to the phone’s motion while the face is half out of the picture or gone, then takes three again', () => {
    picture(middle)
    picture(middle)
    picture(middle)
    expect(sent.eyes).toHaveLength(1)
    // Leaving over the top: found, surely, but its eyes nearer the middle than they are
    picture(overTop)
    picture(overTop)
    picture(overTop)
    picture()
    expect(sent.eyes).toHaveLength(1)
    expect(dotsShow()).toBe(false)
    // Something glimpsed in the room behind for a moment
    picture(middle)
    picture()
    expect(sent.eyes).toHaveLength(1)
    // Back, well inside
    picture(middle)
    picture(middle)
    expect(sent.eyes).toHaveLength(1)
    picture(middle)
    expect(sent.eyes).toHaveLength(2)
    expect(dotsShow()).toBe(true)
  })

  it('draws the line of sight from between the eyes, as the picture has it and as the banknote follows it', () => {
    picture(middle)
    picture(middle)
    picture(middle)
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
    expect(used.by[0]).toBeCloseTo(0.5 * (640 / 480), 9)
    expect(used.by[1]).toBeCloseTo(0, 9)
    // Gone with the face
    picture(overTop)
    expect(line('seen')).toBeUndefined()
    expect(line('used')).toBeUndefined()
  })
})
