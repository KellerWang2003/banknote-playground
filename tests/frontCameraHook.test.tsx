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
/** The eyes sent on to the phone's motion */
const sent = vi.hoisted(() => ({ eyes: [] as unknown[] }))
vi.mock('../src/tilt/useDeviceTilt', () => ({ sightEye: (eye: unknown) => { sent.eyes.push(eye) } }))

/** A face with its two eyes at `right` and `left`, as shares of a 480 × 640 picture */
const face = (right: Point, left: Point) => ({ keypoints: [right, left, { x: 0.5, y: 0.6 }, { x: 0.5, y: 0.7 }] })
const middle = face({ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 })
/** Half over the top edge, as the detector gives it: eyes 15 px inside */
const overTop = face({ x: 0.425, y: 0.024 }, { x: 0.598, y: 0.024 })

function Camera() {
  const { videoRef, rightRef, leftRef } = useFrontCamera(true, true, 0)
  return (
    <div>
      <video ref={videoRef} />
      <span data-testid="right" ref={rightRef} />
      <span data-testid="left" ref={leftRef} />
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

  beforeEach(async () => {
    frames.length = 0
    found.pictures.length = 0
    sent.eyes.length = 0
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
})
