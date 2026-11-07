// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteView } from '../src/components/NoteView'
import { turnDeg } from '../src/lib/back'
import { perspectiveFor } from '../src/lib/frames'
import { inkLight } from '../src/lib/realisticInk'
import { createNote } from '../src/lib/notes'
import type { MagneticInk, Note } from '../src/lib/types'
import { setTilt } from '../src/tilt/tilt'

// Magnetic ink's mask is read from its image on a canvas, which jsdom lacks: each image's stands in as a plain object
const masks = vi.hoisted(() => new Map<string, object>())
vi.mock('../src/lib/inkMask', () => ({
  useInkMask: (ink?: { imageId?: string }) => {
    if (!ink?.imageId) return undefined
    if (!masks.has(ink.imageId)) masks.set(ink.imageId, { name: ink.imageId })
    return { key: ink.imageId, canvas: masks.get(ink.imageId), url: `mask-${ink.imageId}.png` }
  },
}))

// Nor has jsdom WebGL: the renderer notes what it was asked to light, or is missing altogether
const gpu = vi.hoisted(() => ({ available: true, painted: [] as { canvas: HTMLCanvasElement; mask: unknown; light: unknown; cell: number }[] }))
vi.mock('../src/lib/inkRenderer', () => ({
  litInkAvailable: () => gpu.available,
  paintLitInk: (canvas: HTMLCanvasElement, mask: unknown, light: unknown, cell: number) => {
    gpu.painted.push({ canvas, mask, light, cell })
    return true
  },
}))

beforeEach(() => {
  gpu.available = true
  gpu.painted = []
})

afterEach(() => {
  cleanup()
  setTilt({ source: 'hold', angle: 0, angleX: 0, target: 0, targetX: 0, light: 0, flipped: false, turn: 0, quarterTurns: 0 })
})

const withInk = (change: Partial<MagneticInk> = {}): Note & { magneticInk: MagneticInk } => ({
  ...createNote({ name: 'Live', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#112233' }),
  magneticInk: { imageId: 'ink', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20, color: '#c60057', tiltedColor: '#2e8b57', barAxis: 'y', barWidth: 0.3, realistic: true, ...change },
})
const lastPaint = () => gpu.painted.at(-1)!

describe("a NoteView's realistic magnetic ink", () => {
  it('lights it into a canvas of its own in its box, as many pixels as it shows with, in place of the flat look', () => {
    const note = withInk()
    const { container } = render(<NoteView note={note} scale={2} live perspective />)
    const box = container.querySelector<HTMLElement>('[data-magnetic-ink]')!
    expect(box.hasAttribute('data-realistic')).toBe(true)
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(['20px', '20px', '60px', '40px'])
    // It still takes a press anywhere in its box, to drag it
    expect(box.classList.contains('cursor-move')).toBe(true)
    const canvas = box.querySelector('canvas')!
    expect([canvas.width, canvas.height]).toEqual([60, 40])
    expect(container.querySelector('[data-tilt="ink-bar"], [data-tilt="ink-shift"]')).toBeNull()
    expect(lastPaint()).toEqual({ canvas, mask: masks.get('ink'), light: inkLight(note.magneticInk, note, { x: 0, y: 0 }, perspectiveFor(note, 1)), cell: 1 })
  })

  it('lights it again as the banknote tilts, turns over and is rotated, without re-rendering', () => {
    const note = withInk({ barAxis: 'x' })
    let renders = 0
    function Counted() {
      renders++
      return <NoteView note={note} scale={1} live perspective />
    }
    render(<Counted />)
    const before = renders
    const lit = (tilt: { x: number; y: number }, quarter = 0) => inkLight(note.magneticInk, note, tilt, perspectiveFor(note, 1), quarter)
    act(() => setTilt({ angle: 12, angleX: -5 }))
    expect(lastPaint().light).toEqual(lit({ x: -5, y: 12 }))
    // Turning over turns it from the lamp too, as it turns the banknote on screen
    act(() => setTilt({ turn: 0.2 }))
    expect(lastPaint().light).toEqual(lit({ x: -5 + turnDeg(0.2), y: 12 }))
    // Rotated, the lamp stays where it is
    act(() => setTilt({ turn: 0, quarterTurns: 1 }))
    expect(lastPaint().light).toEqual(lit({ x: -5, y: 12 }, 1))
    expect(renders).toBe(before)
  })

  it('leaves out turning over when the banknote is shown flat, and a still note lights it as at its own tilt', () => {
    const note = withInk()
    const { rerender } = render(<NoteView note={note} scale={1} live />)
    act(() => setTilt({ angle: 6, turn: 0.2 }))
    expect(lastPaint().light).toEqual(inkLight(note.magneticInk, note, { x: 0, y: 6 }, perspectiveFor(note, 1)))
    rerender(<NoteView note={note} scale={3} angle={-9} angleX={4} />)
    expect(lastPaint().light).toEqual(inkLight(note.magneticInk, note, { x: 4, y: -9 }, perspectiveFor(note, 1)))
    expect([lastPaint().canvas.width, lastPaint().canvas.height]).toEqual([90, 60])
  })

  it('keeps the flat look where the browser has no WebGL, and with Realistic off', () => {
    gpu.available = false
    const { container, rerender } = render(<NoteView note={withInk()} scale={1} live />)
    expect(container.querySelector('[data-realistic]')).toBeNull()
    expect(container.querySelector('[data-tilt="ink-bar"]')).not.toBeNull()
    gpu.available = true
    rerender(<NoteView note={withInk({ realistic: undefined })} scale={1} live />)
    expect(container.querySelector('[data-realistic]')).toBeNull()
    expect(container.querySelector('[data-tilt="ink-bar"]')).not.toBeNull()
    expect(gpu.painted).toEqual([])
  })
})
