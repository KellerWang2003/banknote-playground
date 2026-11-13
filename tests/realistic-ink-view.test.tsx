// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteView } from '../src/components/NoteView'
import { turnDeg } from '../src/lib/back'
import { perspectiveFor } from '../src/lib/frames'
import { featureShade } from '../src/lib/paper'
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
  setTilt({ source: 'hold', angle: 0, angleX: 0, target: 0, targetX: 0, light: 0, flipped: false, turn: 0, quarterTurns: 0, room: undefined, nudged: 0, nudgedX: 0 })
})

const withInk = (change: Partial<MagneticInk> = {}): Note & { magneticInk: MagneticInk } => ({
  ...createNote({ name: 'Live', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#112233' }),
  magneticInk: { imageId: 'ink', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20, color: '#c60057', tiltedColor: '#2e8b57', barAxis: 'y', barWidth: 0.3, ...change },
})
const lastPaint = () => gpu.painted.at(-1)!
// Lit at `tilt`, and opaque, shaded as Realistic's paper round it at `paper` (outside Demo on a phone, the same tilt)
const litAt = (note: Note & { magneticInk: MagneticInk }, tilt: { x: number; y: number }, quarter: 0 | 1 | 2 | 3 = 0, paper = tilt) =>
  inkLight(note.magneticInk, note, tilt, perspectiveFor(note, 1), quarter, featureShade(note.magneticInk, note, paper, perspectiveFor(note, 1), quarter))

describe("a NoteView's realistic magnetic ink", () => {
  it('lights it into a canvas of its own in its box, as many pixels as it shows with, in place of the flat look', () => {
    const note = withInk()
    const { container } = render(<NoteView note={note} scale={2} live perspective realistic />)
    const box = container.querySelector<HTMLElement>('[data-magnetic-ink]')!
    expect(box.hasAttribute('data-realistic')).toBe(true)
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(['20px', '20px', '60px', '40px'])
    // It still takes a press anywhere in its box, to drag it
    expect(box.classList.contains('cursor-move')).toBe(true)
    const canvas = box.querySelector('canvas')!
    expect([canvas.width, canvas.height]).toEqual([60, 40])
    expect(container.querySelector('[data-tilt="ink-bar"], [data-tilt="ink-shift"]')).toBeNull()
    expect(lastPaint()).toEqual({ canvas, mask: masks.get('ink'), light: litAt(note, { x: 0, y: 0 }), cell: 1 })
  })

  it('lights it again as the banknote tilts, turns over and is rotated, without re-rendering', () => {
    const note = withInk({ barAxis: 'x' })
    let renders = 0
    function Counted() {
      renders++
      return <NoteView note={note} scale={1} live perspective realistic />
    }
    render(<Counted />)
    const before = renders
    const lit = (tilt: { x: number; y: number }, quarter: 0 | 1 = 0) => litAt(note, tilt, quarter)
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
    const { rerender } = render(<NoteView note={note} scale={1} live realistic />)
    act(() => setTilt({ angle: 6, turn: 0.2 }))
    expect(lastPaint().light).toEqual(litAt(note, { x: 0, y: 6 }))
    rerender(<NoteView note={note} scale={3} angle={-9} angleX={4} realistic />)
    expect(lastPaint().light).toEqual(litAt(note, { x: 4, y: -9 }))
    expect([lastPaint().canvas.width, lastPaint().canvas.height]).toEqual([90, 60])
  })

  it('shades it in Demo on a phone as the paper round it is, by the room’s light, which Recentre leaves; its own light by the banknote’s tilt', () => {
    const note = withInk()
    render(<NoteView note={note} scale={1} live perspective flat realistic />)
    act(() => setTilt({ source: 'device', target: -30, targetX: 5, angle: -30, angleX: 5, room: { x: 2, y: 20, up: [0.02, -0.42, 0.9] } }))
    expect(lastPaint().light).toEqual(litAt(note, { x: 5, y: -30 }, 0, { x: 2, y: 20 }))
    // Recentred, its flakes and bar start again from flat; the paper round it, and so it, stays lit as the phone lies
    act(() => setTilt({ target: 0, targetX: 0, angle: 0, angleX: 0 }))
    expect(lastPaint().light).toEqual(litAt(note, { x: 0, y: 0 }, 0, { x: 2, y: 20 }))
    // Held to the light, none of it comes through the ink, which is opaque
    act(() => setTilt({ light: 1 }))
    expect(lastPaint().light).toEqual(litAt(note, { x: 0, y: 0 }, 0, { x: 2, y: 20 }))
  })

  it('shades a further magnetic ink, drawn alone over its banknote, as the paper round it too', () => {
    const base = withInk()
    const second = { ...base.magneticInk, imageId: 'second-ink', xMm: 90, name: 'Magnetic ink 2' }
    const note = { ...base, extras: [{ id: 'second', feature: 'magneticInk' as const, layer: second }] }
    render(<NoteView note={note} scale={1} live perspective realistic />)
    act(() => setTilt({ angle: 8 }))
    const painted = gpu.painted.filter((paint) => paint.mask === masks.get('second-ink')).at(-1)!
    const eye = perspectiveFor(note, 1)
    expect(painted.light).toEqual(inkLight(second, note, { x: 0, y: 8 }, eye, 0, featureShade(second, note, { x: 0, y: 8 }, eye, 0)))
  })

  it('keeps the flat look where the browser has no WebGL, and with Realistic off', () => {
    gpu.available = false
    const { container, rerender } = render(<NoteView note={withInk()} scale={1} live realistic />)
    expect(container.querySelector('[data-realistic]')).toBeNull()
    expect(container.querySelector('[data-tilt="ink-bar"]')).not.toBeNull()
    gpu.available = true
    rerender(<NoteView note={withInk()} scale={1} live />)
    expect(container.querySelector('[data-realistic]')).toBeNull()
    expect(container.querySelector('[data-tilt="ink-bar"]')).not.toBeNull()
    expect(gpu.painted).toEqual([])
  })
})
