// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIGHT_TAP_MS, framesTiltOf, lightTarget, pressLight, releaseLight, scrubFrames, setTilt, togglePlayback, useTilt, useTiltLoop } from '../src/tilt/tilt'
import { LIGHT_RAMP_SECONDS } from '../src/lib/light'
import { cyclePhase, frameMix, frameSpans, sliceRange } from '../src/lib/frames'
import { lensState } from '../src/lib/lens'
import { playbackPlan } from '../src/lib/moves'
import type { TiltSettings } from '../src/lib/types'

// These test how the loop follows the plan, on sweeps of a whole second; moves.test.ts covers the real pace
vi.mock('../src/lib/playback', async (importOriginal) => ({ ...await importOriginal<typeof import('../src/lib/playback')>(), SWEEP_SECONDS: 1 }))

const lensFor = (cycleDeg: number) => lensState({ cycleDeg, transition: 0 })
/** Up/down out to the cycle and back, unless the settings bring moves of their own */
const planFor = (cycleDeg: number, settings: Partial<TiltSettings> = {}) =>
  playbackPlan({ cycleDeg, transition: 0, moves: [{ id: 'm', kind: 'y', y: cycleDeg }], ...settings }, lensFor(cycleDeg))

let now = 0
let nextId = 0
let callbacks = new Map<number, FrameRequestCallback>()
function tick(milliseconds: number) {
  act(() => {
    now += milliseconds
    const pending = [...callbacks.values()]
    callbacks.clear()
    for (const callback of pending) callback(now)
  })
}
function advance(milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 20) tick(20)
}
beforeEach(() => {
  now = 0
  nextId = 0
  callbacks = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextId; callbacks.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  setTilt({ source: 'drag', angle: 0, target: 0 })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('flat-to-upward playback', () => {
  it.each([30, 75, 120])('reaches the %s° cycle (at most the ±90° tilt range), returns flat, and never tilts below it', (cycle) => {
    const top = Math.min(cycle, 90)
    renderHook(() => useTiltLoop(planFor(cycle)))
    setTilt({ source: 'wobble' })
    tick(20)
    expect(useTilt.getState().angle).toBe(0)
    const angles = [useTilt.getState().angle]
    for (let i = 0; i < 100; i++) { tick(20); angles.push(useTilt.getState().angle) }
    expect(angles[50]).toBeCloseTo(top, 8)
    expect(angles[100]).toBeCloseTo(0, 8)
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...angles)).toBeLessThanOrEqual(top)
  })

  it.each([
    ['smooth', (1 - Math.cos(Math.PI * 0.2)) / 2],
    ['linear', 0.2],
    ['ease-in', 0.04],
    ['ease-out', 0.36],
  ] as const)('uses the %s curve while still reaching the full tilt', (curve, expected) => {
    renderHook(() => useTiltLoop(planFor(30, { curve })))
    setTilt({ source: 'wobble' })
    tick(20)
    advance(200)
    expect(useTilt.getState().angle).toBeCloseTo(expected * 30, 8)
    advance(800)
    expect(useTilt.getState().angle).toBeCloseTo(30, 8)
  })

  it('changes speed during playback without restarting the motion', () => {
    const { rerender } = renderHook(({ speed }) => useTiltLoop(planFor(30, { speed, curve: 'linear' })), { initialProps: { speed: 1 } })
    setTilt({ source: 'wobble' })
    tick(20)
    advance(200)
    expect(useTilt.getState().angle).toBeCloseTo(6, 8)
    rerender({ speed: 2 })
    tick(20)
    expect(useTilt.getState().angle).toBeCloseTo(7.2, 8)
    advance(380)
    expect(useTilt.getState().angle).toBeCloseTo(30, 8)
    advance(500)
    expect(useTilt.getState().angle).toBeCloseTo(0, 8)
  })

  it('pauses flat for as long as a Hold move says, and turns straight back at full tilt', () => {
    renderHook(() => useTiltLoop(planFor(30, { curve: 'linear', moves: [{ id: 'a', kind: 'y', y: 30 }, { id: 'h', kind: 'hold', seconds: 0.4 }] })))
    setTilt({ source: 'wobble' })
    tick(20)
    advance(1000)
    expect(useTilt.getState().angle).toBeCloseTo(30, 8)
    advance(200)
    expect(useTilt.getState().angle).toBeCloseTo(24, 8)
    advance(800)
    expect(useTilt.getState().angle).toBeCloseTo(0, 8)
    advance(400)
    expect(useTilt.getState().angle).toBeCloseTo(0, 8)
    advance(200)
    expect(useTilt.getState().angle).toBeCloseTo(6, 8)
  })

  it('holds the current angle on pause and starts the next play run flat', () => {
    renderHook(() => useTiltLoop(planFor(30)))
    setTilt({ source: 'wobble' })
    tick(20)
    advance(500)
    const angle = useTilt.getState().angle
    expect(angle).toBeCloseTo(15, 8)
    setTilt({ source: 'slider', target: angle })
    advance(400)
    expect(useTilt.getState().angle).toBe(angle)
    setTilt({ source: 'wobble' })
    tick(20)
    expect(useTilt.getState().angle).toBe(0)
  })

  it('can scrub to the full cycle while retaining negative manual tilt', () => {
    renderHook(() => useTiltLoop(planFor(120)))
    setTilt({ source: 'slider', target: 120 })
    advance(2000)
    expect(useTilt.getState().angle).toBeCloseTo(120, 1)
    setTilt({ source: 'drag', target: -30 })
    advance(2000)
    expect(useTilt.getState().angle).toBeCloseTo(-30, 1)
  })
})

describe('turning over in playback', () => {
  const state = () => useTilt.getState()
  // Up/down to 30° and back, a second each way, then a Flip
  const flipPlan = (settings: Partial<TiltSettings> = {}) =>
    planFor(30, { curve: 'linear', moves: [{ id: 'a', kind: 'y', y: 30 }, { id: 'f', kind: 'flip' }], ...settings })
  beforeEach(() => setTilt({ flipped: false, turn: 0 }))
  afterEach(() => setTilt({ flipped: false, turn: 0 }))

  it('turns the banknotes over, flat, as a Flip begins, as F does, and back round at the next', () => {
    renderHook(() => useTiltLoop(flipPlan()))
    setTilt({ source: 'wobble' })
    tick(20)
    advance(1900)
    expect(state()).toMatchObject({ flipped: false, turn: 0 })
    advance(200)
    // Under way, at F's half a second for the whole turn
    expect(state().flipped).toBe(true)
    expect(state().turn).toBeGreaterThan(0.1)
    expect(state().turn).toBeLessThan(0.5)
    expect(state().angle).toBe(0)
    advance(500)
    expect(state().turn).toBe(1)
    // The next pass plays on the backs, until its Flip turns them back round
    advance(500)
    expect(state()).toMatchObject({ flipped: true, turn: 1 })
    expect(state().angle).toBeGreaterThan(0)
    advance(1500)
    expect(state().flipped).toBe(false)
    advance(500)
    expect(state().turn).toBe(0)
  })

  it('turns them at playback’s speed, so a Flip takes its move’s time', () => {
    renderHook(() => useTiltLoop(flipPlan({ speed: 2 })))
    setTilt({ source: 'wobble' })
    tick(20)
    // At 2× the Flip begins a second in and takes a quarter of a second; at 1× pace it would be halfway round
    advance(1300)
    expect(state()).toMatchObject({ flipped: true, turn: 1 })
  })

  it('leaves them as they are while turning over is off, as in Thread Studio, where F does nothing either', () => {
    renderHook(() => useTiltLoop(flipPlan(), undefined, false))
    setTilt({ source: 'wobble' })
    tick(20)
    advance(2600)
    expect(state()).toMatchObject({ flipped: false, turn: 0 })
  })
})

describe('scrubbing a banknote’s timeline', () => {
  it('shows that banknote’s frames where it was scrubbed, without tilting, and every tilt syncs them all again', () => {
    setTilt({ source: 'wobble', angle: 12, target: 12, angleX: 0, targetX: 0 })
    scrubFrames('a', { x: 0, y: -20 })
    // The banknotes stay where playback left them; only banknote a's frames go where its timeline was scrubbed (Keller)
    expect(useTilt.getState()).toMatchObject({ source: 'slider', angle: 12, target: 12, frameTilts: { a: { x: 0, y: -20 } } })
    expect(framesTiltOf(useTilt.getState(), 'a')).toEqual({ x: 0, y: -20 })
    expect(framesTiltOf(useTilt.getState(), 'b')).toEqual({ x: 0, y: 12 })
    // Each banknote's timeline is its own
    scrubFrames('b', { x: 0, y: 30 })
    expect(framesTiltOf(useTilt.getState(), 'a')).toEqual({ x: 0, y: -20 })
    expect(framesTiltOf(useTilt.getState(), 'b')).toEqual({ x: 0, y: 30 })
    // Settings that don't tilt leave the scrubs alone; a tilt syncs every banknote back to it
    setTilt({ frameNumbers: true })
    expect(Object.keys(useTilt.getState().frameTilts)).toEqual(['a', 'b'])
    setTilt({ source: 'hold', target: 5, targetX: 0 })
    expect(useTilt.getState().frameTilts).toEqual({})
    expect(framesTiltOf(useTilt.getState(), 'a')).toEqual({ x: 0, y: 12 })
    setTilt({ frameNumbers: false })
  })
})

describe('frame and timeline alignment', () => {
  it('starts with the first weighted frame flat and reaches the last at the cycle endpoint', () => {
    const spans = frameSpans({ frames: [{ length: 1 }, { length: 2 }, { length: 1 }], tilt: { cycleDeg: 40 } })
    expect(sliceRange(0, spans)).toEqual([0, 10])
    expect(sliceRange(1, spans)).toEqual([10, 30])
    expect(frameMix(0, spans, 0).current).toBe(0)
    expect(frameMix(10, spans, 0).current).toBe(1)
    expect(frameMix(40, spans, 0).current).toBe(2)
    expect(frameMix(41, spans, 0).current).toBe(0)
    expect(frameMix(-1, spans, 0).current).toBe(2)
    expect(cyclePhase(0, 40)).toBe(0)
    expect(cyclePhase(40, 40)).toBe(1)
    expect(cyclePhase(41, 40)).toBeCloseTo(0.025)
  })

  it('preserves a continuous crossfade around the loop boundary', () => {
    const flat = frameMix(0, [10, 20, 10], 1)
    const end = frameMix(40, [10, 20, 10], 1)
    expect(flat.base).toBe(end.base)
    expect(flat.next).toBe(end.next)
    expect(flat.blend).toBeCloseTo(end.blend, 8)
  })
})

describe('the light behind the banknotes', () => {
  const light = () => useTilt.getState().light
  const RAMP_MS = LIGHT_RAMP_SECONDS * 1000
  beforeEach(() => setTilt({ backlit: false, peek: false, light: 0 }))

  it('flips the lamp switch on a tap of L, and only peeks at the other light while L is held', () => {
    pressLight(0)
    expect(useTilt.getState()).toMatchObject({ peek: true, backlit: false })
    expect(lightTarget(useTilt.getState())).toBe(1)
    releaseLight(LIGHT_TAP_MS - 50)
    expect(useTilt.getState()).toMatchObject({ peek: false, backlit: true })
    // Held, with key repeats: reflected light until it is let go, then backlit again as before
    pressLight(1000)
    pressLight(1100)
    expect(lightTarget(useTilt.getState())).toBe(0)
    releaseLight(1000 + LIGHT_TAP_MS + 100)
    expect(useTilt.getState()).toMatchObject({ peek: false, backlit: true })
    // A release lost to another window ends the peek without flipping the switch
    pressLight(3000)
    releaseLight(3010, false)
    expect(useTilt.getState()).toMatchObject({ peek: false, backlit: true })
    // A release with no press does nothing
    releaseLight(4000)
    expect(useTilt.getState().backlit).toBe(true)
  })

  it('fades the light in and out over the ramp time, turning round from wherever it is', () => {
    renderHook(() => useTiltLoop(planFor(30)))
    setTilt({ source: 'hold', backlit: true })
    tick(20)
    expect(light()).toBeCloseTo(20 / RAMP_MS)
    advance(RAMP_MS)
    expect(light()).toBe(1)
    setTilt({ backlit: false })
    advance(100)
    expect(light()).toBeCloseTo(1 - 100 / RAMP_MS)
    setTilt({ backlit: true })
    advance(100)
    expect(light()).toBeCloseTo(1)
    setTilt({ backlit: false })
    advance(RAMP_MS)
    expect(light()).toBe(0)
  })

  it('holds the banknotes to the light while playback says so, and fades back to the switch on pause', () => {
    renderHook(() => useTiltLoop(planFor(30, { moves: [{ id: 'l', kind: 'light' }], curve: 'linear' })))
    setTilt({ source: 'wobble' })
    tick(20)
    expect(light()).toBe(0)
    advance(240)
    expect(light()).toBeCloseTo(0.48)
    advance(760)
    expect(light()).toBe(1)
    expect(useTilt.getState().angle).toBe(0)
    togglePlayback()
    advance(100)
    expect(light()).toBeCloseTo(1 - 100 / RAMP_MS)
    advance(RAMP_MS)
    expect(light()).toBe(0)
  })

  it('keeps the lamp switch on through moves played in reflected light', () => {
    renderHook(() => useTiltLoop(planFor(30)))
    setTilt({ source: 'hold', backlit: true })
    advance(RAMP_MS + 20)
    setTilt({ source: 'wobble' })
    advance(500)
    expect(light()).toBe(1)
    expect(useTilt.getState().angle).toBeGreaterThan(0)
  })
})

describe('a phone’s own tilt in Demo', () => {
  it('follows the phone exactly, a drag on top turning it further with the drag’s spring and springing back to the phone’s tilt', () => {
    renderHook(() => useTiltLoop(planFor(30)))
    setTilt({ source: 'device', target: 20, targetX: -10, nudge: 0, nudgeX: 0, nudged: 0, nudgedX: 0 })
    tick(20)
    expect(useTilt.getState()).toMatchObject({ angle: 20, angleX: -10 })
    // A drag on top: on its way with the spring, not there at once
    setTilt({ nudge: 15, nudgeX: 30 })
    tick(20)
    const { angle, nudged } = useTilt.getState()
    expect(nudged).toBeGreaterThan(0)
    expect(nudged).toBeLessThan(15)
    expect(angle).toBeCloseTo(20 + nudged, 9)
    advance(1500)
    expect(useTilt.getState()).toMatchObject({ angle: 35, angleX: 20, nudged: 15, nudgedX: 30 })
    // The phone moves meanwhile: followed exactly, the drag still on top
    setTilt({ target: 25 })
    tick(20)
    expect(useTilt.getState().angle).toBe(40)
    // Let go: back to the phone's own tilt
    setTilt({ nudge: 0, nudgeX: 0 })
    advance(1500)
    expect(useTilt.getState()).toMatchObject({ angle: 25, angleX: -10, nudged: 0, nudgedX: 0 })
  })
})
