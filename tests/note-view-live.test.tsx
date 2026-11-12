// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteView } from '../src/components/NoteView'
import { turnDeg } from '../src/lib/back'
import { HELD_DEG, WATERMARK_TILTED, roomThrough, watermarkOpacity, watermarkReveal } from '../src/lib/light'
import { DEFAULT_INK, INK_ROLL_DEG, INK_SHIFT_DEG, barShift, inkShift } from '../src/lib/magneticInk'
import { createNote } from '../src/lib/notes'
import type { MagneticInk, Note } from '../src/lib/types'
import { setTilt } from '../src/tilt/tilt'

// The watermark's light layer is worked out from its image on a canvas, which jsdom lacks: each is named for what it
// was drawn from, and painting one onto the watermark's canvas notes its name there
const lights = vi.hoisted(() => ({ made: new Map<string, { name: string }>(), painted: new Map<unknown, string>() }))
vi.mock('../src/lib/relief', () => ({
  useRelief: (watermark?: { imageId?: string; invert?: boolean; levels?: { low: number } }) => {
    if (!watermark?.imageId) return undefined
    const name = `light-${watermark.imageId}${watermark.invert ? '-inverted' : ''}${watermark.levels ? `-from-${watermark.levels.low}` : ''}`
    if (!lights.made.has(name)) lights.made.set(name, { name })
    return lights.made.get(name)
  },
  reliefPixels: (_relief: unknown, px: number) => ({ width: Math.min(400, Math.round(px)), height: Math.min(400, Math.round(px)) }),
  paintRelief: (canvas: HTMLCanvasElement, relief: { name: string }) => lights.painted.set(canvas, relief.name),
}))

// Magnetic ink's mask is read from its image on a canvas too: each is named for what it was read from
vi.mock('../src/lib/inkMask', () => ({
  useInkMask: (ink?: { imageId?: string; invert?: boolean }) =>
    ink?.imageId ? { key: ink.imageId, canvas: undefined, url: `mask-${ink.imageId}${ink.invert ? '-inverted' : ''}.png` } : undefined,
}))

afterEach(() => {
  cleanup()
  setTilt({ source: 'hold', angle: 0, angleX: 0, target: 0, targetX: 0, light: 0, flipped: false, turn: 0, room: undefined, nudged: 0, nudgedX: 0 })
})

const makeNote = () => createNote({ name: 'Live', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#112233' })

describe('a live NoteView', () => {
  it('turns with the shared tilt without re-rendering, and re-renders only when the frame changes', () => {
    const note = makeNote()
    let renders = 0
    function Counted() {
      renders++
      return <NoteView note={note} scale={1} live perspective sheen showFrameNumber />
    }
    const { container } = render(<Counted />)
    const root = container.firstElementChild as HTMLElement
    const number = () => container.querySelector('[data-frame-number]')?.textContent
    const startFrame = number()
    const before = renders

    // A degree or two stays within one frame: the note turns and the shading moves, with no render
    act(() => setTilt({ angle: 1, angleX: 0.5 }))
    expect(root.style.transform).toBe('rotateX(1deg) rotateY(0.5deg)')
    const shade = container.querySelector<HTMLElement>('[data-tilt="shade-down"]')!
    expect(Number(shade.style.opacity)).toBeGreaterThan(0)
    expect(container.querySelector<HTMLElement>('[data-tilt="sheen"]')!.style.transform).toBe(`translateY(${(1 / 60) * 120}%)`)
    expect(renders).toBe(before)
    expect(number()).toBe(startFrame)

    // Tilting a whole cycle's worth further shows another frame, which does render
    act(() => setTilt({ angle: -20 }))
    expect(number()).not.toBe(startFrame)
  })

  it('draws a still note from its props', () => {
    const { container } = render(<NoteView note={makeNote()} scale={1} angle={30} perspective />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.transform).toBe('rotateX(30deg)')
    expect(Number(container.querySelector<HTMLElement>('[data-tilt="shade-down"]')!.style.opacity)).toBeCloseTo(0.5 / 1.5)
  })
})

describe("a NoteView's watermark", () => {
  const withWatermark = () =>
    ({ ...makeNote(), watermark: { imageId: 'mark', xMm: 10, yMm: 10, widthMm: 30, heightMm: 30, depth: 0.6 } })
  const withoutImage = () => ({ ...makeNote(), watermark: { xMm: 10, yMm: 10, widthMm: 30, heightMm: 30, depth: 0.6 } })
  const mark = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-watermark]')!
  const opacity = (container: HTMLElement) => Number(mark(container).style.opacity)

  it("shows in the note's own colours under the thread, faint flat, and held to the light nothing else changes", () => {
    const { container } = render(<NoteView note={withWatermark()} scale={2} live perspective showFrameNumber />)
    const watermark = mark(container)
    // Light through thinner paper, colour-dodged over the design so it only ever brightens it
    expect(watermark.style.mixBlendMode).toBe('color-dodge')
    expect(lights.painted.get(watermark)).toBe('light-mark')
    expect(watermark.style.left).toBe('20px')
    expect(watermark.style.width).toBe('60px')
    // As many pixels as it shows at
    expect((watermark as HTMLCanvasElement).width).toBe(60)
    expect(watermark.compareDocumentPosition(container.querySelector('[data-thread]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(opacity(container)).toBeCloseTo(watermarkOpacity(0.6, 0))

    const elements = container.querySelectorAll('*').length
    act(() => setTilt({ light: 1 }))
    expect(opacity(container)).toBeCloseTo(0.6)
    expect(container.querySelectorAll('*').length).toBe(elements)
    expect(container.querySelector<HTMLElement>('[data-frame-number]')!.style.opacity).toBe('')
  })

  it('comes out as the note tilts either way, and with the light, which never re-renders it', () => {
    const note = withWatermark()
    let renders = 0
    function Counted() {
      renders++
      return <NoteView note={note} scale={1} live perspective />
    }
    const { container } = render(<Counted />)
    act(() => setTilt({ angle: 10 }))
    expect(opacity(container)).toBeCloseTo(watermarkOpacity(0.6, watermarkReveal(0, { x: 0, y: 10 })))
    act(() => setTilt({ angle: 0, angleX: -30 }))
    expect(opacity(container)).toBeCloseTo(0.6 * WATERMARK_TILTED)
    act(() => setTilt({ angleX: 0 }))
    const before = renders
    act(() => setTilt({ light: 0.5 }))
    expect(opacity(container)).toBeCloseTo(watermarkOpacity(0.6, 0.5))
    act(() => setTilt({ light: 1 }))
    expect(opacity(container)).toBeCloseTo(0.6)
    expect(renders).toBe(before)
  })

  it('shows in Demo on a phone by the room’s light coming through it as the phone lies in the room, not by tilting', () => {
    const RAD = Math.PI / 180
    // As Demo keeps how the phone lies: tipped `beta` from lying flat towards upright and on past it, facing whoever holds it
    const lying = (beta: number) => ({ x: 0, y: HELD_DEG - beta, up: [0, -Math.sin(beta * RAD), Math.cos(beta * RAD)] as const })
    const { container } = render(<NoteView note={withWatermark()} scale={1} live perspective flat />)
    // Held as people hold a phone to look at it, tilted however far from where Demo began: only a hint
    act(() => setTilt({ source: 'device', target: 35, targetX: -20, angle: 35, angleX: -20, room: lying(HELD_DEG) }))
    expect(opacity(container)).toBeCloseTo(watermarkOpacity(0.6, 0))
    // Lying flat on a table, the same
    act(() => setTilt({ room: lying(0) }))
    expect(opacity(container)).toBeCloseTo(watermarkOpacity(0.6, 0))
    // Pointing the camera up, the light behind it: clearer, then clear, whatever the banknote's own tilt
    act(() => setTilt({ angle: 0, angleX: 0, room: lying(110) }))
    const through = roomThrough(lying(110).up)
    expect(through).toBeGreaterThan(0.5)
    expect(through).toBeLessThan(1)
    expect(opacity(container)).toBeCloseTo(watermarkOpacity(0.6, through))
    act(() => setTilt({ room: lying(120) }))
    expect(opacity(container)).toBeCloseTo(0.6)
    // A drag turning it back towards upright in the hand
    act(() => setTilt({ nudged: 20 }))
    expect(opacity(container)).toBeCloseTo(watermarkOpacity(0.6, roomThrough(lying(120).up, { x: 0, y: 20 })))
    expect(opacity(container)).toBeLessThan(0.6)
    // Held to the lamp, clear however it lies
    act(() => setTilt({ room: lying(HELD_DEG), nudged: 0, light: 1 }))
    expect(opacity(container)).toBeCloseTo(0.6)
  })

  it('takes a press on the canvas, faint or clear, but not in a thumbnail or with no depth', () => {
    const grabbable = (container: HTMLElement) =>
      !mark(container).classList.contains('pointer-events-none') && mark(container).style.pointerEvents === ''
    const { container, rerender } = render(<NoteView note={withWatermark()} scale={2} live />)
    expect(grabbable(container)).toBe(true)
    expect(mark(container).classList.contains('cursor-move')).toBe(true)
    act(() => setTilt({ angle: 20 }))
    expect(grabbable(container)).toBe(true)
    act(() => setTilt({ angle: 0, light: 1 }))
    expect(grabbable(container)).toBe(true)
    rerender(<NoteView note={withWatermark()} scale={2} />)
    expect(grabbable(container)).toBe(false)
    rerender(<NoteView note={{ ...withWatermark(), watermark: { ...withWatermark().watermark, depth: 0 } }} scale={2} live />)
    expect(grabbable(container)).toBe(false)
  })

  it('takes a fixed reveal from its props; a still note shows it as at its own tilt in reflected light', () => {
    const { container, rerender } = render(<NoteView note={withWatermark()} scale={1} live reveal={1} />)
    expect(opacity(container)).toBeCloseTo(0.6)
    // Editing windows shows it faint even with the lamp on
    act(() => setTilt({ light: 1 }))
    rerender(<NoteView note={withWatermark()} scale={1} live reveal={0} />)
    expect(opacity(container)).toBeCloseTo(watermarkOpacity(0.6, 0))
    // Thumbnails are flat, so faint, whatever the light
    rerender(<NoteView note={withWatermark()} scale={1} />)
    expect(opacity(container)).toBeCloseTo(watermarkOpacity(0.6, 0))
    rerender(<NoteView note={withWatermark()} scale={1} angle={30} />)
    expect(opacity(container)).toBeCloseTo(0.6 * WATERMARK_TILTED)
  })

  it('lets the dark parts of its image through instead when inverted', () => {
    const { container, rerender } = render(<NoteView note={withWatermark()} scale={1} live />)
    expect(lights.painted.get(mark(container))).toBe('light-mark')
    rerender(<NoteView note={{ ...withWatermark(), watermark: { ...withWatermark().watermark, invert: true } }} scale={1} live />)
    expect(lights.painted.get(mark(container))).toBe('light-mark-inverted')
    expect(mark(container).style.mixBlendMode).toBe('color-dodge')
  })

  it('draws through its levels, and again at the size it shows at when zoomed', () => {
    const levels = { low: 0.2, high: 0.7, gamma: 1 }
    const { container, rerender } = render(<NoteView note={{ ...withWatermark(), watermark: { ...withWatermark().watermark, levels } }} scale={1} live />)
    expect(lights.painted.get(mark(container))).toBe('light-mark-from-0.2')
    expect((mark(container) as HTMLCanvasElement).width).toBe(30)
    rerender(<NoteView note={{ ...withWatermark(), watermark: { ...withWatermark().watermark, levels } }} scale={4} live />)
    expect((mark(container) as HTMLCanvasElement).width).toBe(120)
    expect(lights.painted.get(mark(container))).toBe('light-mark-from-0.2')
  })

  it('draws nothing until it has an image', () => {
    const { container } = render(<NoteView note={withoutImage()} scale={1} live />)
    act(() => setTilt({ light: 1 }))
    expect(container.querySelector('[data-watermark]')).toBeNull()
  })
})

describe("a NoteView's magnetic ink", () => {
  const withInk = (change: Partial<MagneticInk> = {}) => ({
    ...makeNote(),
    magneticInk: { imageId: 'ink', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20, color: '#c9a227', tiltedColor: '#2e8b57', barAxis: 'y', barWidth: 0.25, ...change } satisfies MagneticInk,
  })
  const ink = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-magnetic-ink]')!
  const shift = (container: HTMLElement) => Number(container.querySelector<HTMLElement>('[data-tilt="ink-shift"]')!.style.opacity)
  const bar = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-tilt="ink-bar"]')!
  const shape = (container: HTMLElement) => ink(container).style.maskImage || ink(container).style.getPropertyValue('-webkit-mask-image')

  it('prints its shape in its Flat colour over the watermark and under the thread, its bar resting across the middle', () => {
    const note = { ...withInk(), watermark: { imageId: 'mark', xMm: 10, yMm: 10, widthMm: 30, heightMm: 30, depth: 0.6 } }
    const { container } = render(<NoteView note={note} scale={2} live />)
    const layer = ink(container)
    expect([layer.style.left, layer.style.top, layer.style.width, layer.style.height]).toEqual(['20px', '20px', '60px', '40px'])
    // Clipped to the shape read from its image
    expect(shape(container)).toContain('mask-ink.png')
    expect(container.querySelector('[data-watermark]')!.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(layer.compareDocumentPosition(container.querySelector('[data-thread]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((layer.firstElementChild as HTMLElement).style.backgroundColor).toBe('rgb(201, 162, 39)')
    expect(shift(container)).toBe(0)
    expect([bar(container).style.top, bar(container).style.height, bar(container).style.transform]).toEqual(['37.5%', '25%', 'translateY(0%)'])
    // It takes a press on the canvas, anywhere in its box, to drag it
    expect(layer.classList.contains('cursor-move')).toBe(true)
  })

  it('turns to its Tilted colour as the note turns away, either way, and rolls its bar on its own tilt, without re-rendering', () => {
    const note = withInk()
    let renders = 0
    function Counted() {
      renders++
      return <NoteView note={note} scale={1} live />
    }
    const { container } = render(<Counted />)
    const before = renders
    act(() => setTilt({ angle: INK_ROLL_DEG / 2 }))
    expect(shift(container)).toBeCloseTo(inkShift({ x: 0, y: INK_ROLL_DEG / 2 }))
    expect(bar(container).style.transform).toBe(`translateY(${barShift(note.magneticInk, 0.5)}%)`)
    act(() => setTilt({ angle: 0, angleX: -INK_SHIFT_DEG }))
    expect(shift(container)).toBe(1)
    // A level bar doesn't roll on the side tilt
    expect(bar(container).style.transform).toBe('translateY(0%)')
    expect(renders).toBe(before)
  })

  it('rolls an upright bar side to side instead, and a still note shows it as at its own tilt, taking no press', () => {
    const upright = withInk({ barAxis: 'x' })
    const { container, rerender } = render(<NoteView note={upright} scale={1} live />)
    expect([bar(container).style.left, bar(container).style.width]).toEqual(['37.5%', '25%'])
    act(() => setTilt({ angleX: INK_ROLL_DEG }))
    expect(bar(container).style.transform).toBe(`translateX(${barShift(upright.magneticInk, -1)}%)`)
    rerender(<NoteView note={upright} scale={1} angle={INK_SHIFT_DEG} />)
    expect(shift(container)).toBe(1)
    expect(ink(container).classList.contains('pointer-events-none')).toBe(true)
  })

  it('goes round the shape when inverted, and draws nothing until it has an image', () => {
    const { container, rerender } = render(<NoteView note={withInk({ invert: true })} scale={1} live />)
    expect(shape(container)).toContain('mask-ink-inverted.png')
    rerender(<NoteView note={withInk({ imageId: undefined })} scale={1} live />)
    expect(container.querySelector('[data-magnetic-ink]')).toBeNull()
  })
})

describe("a NoteView's back", () => {
  const twoSided = (): Note => ({
    ...makeNote(),
    back: { background: 'solid', color: '#F0EAD6' },
    watermark: { imageId: 'mark', xMm: 10, yMm: 10, widthMm: 30, heightMm: 30, depth: 0.6 },
    magneticInk: { imageId: 'ink', xMm: 100, yMm: 10, widthMm: 20, heightMm: 20, ...DEFAULT_INK },
  })

  it('shows plain paper and the watermark through it the other way round, and no thread or magnetic ink', () => {
    const { container } = render(<NoteView note={twoSided()} scale={2} side="back" selected="watermark" hovered="thread" />)
    const root = container.firstElementChild as HTMLElement
    // Plain paper: a back's old colour no longer shows (Keller: they have to use the design)
    expect(root.style.backgroundColor).toBe('rgb(229, 229, 229)')
    expect(root.hasAttribute('data-back')).toBe(true)
    expect(container.querySelector('[data-thread]')).toBeNull()
    expect(container.querySelector('[data-magnetic-ink]')).toBeNull()
    const mark = container.querySelector<HTMLElement>('[data-watermark]')!
    // 150 − 10 − 30 = 110 mm from the left, at 2 px per mm, flipped
    expect([mark.style.left, mark.style.transform]).toEqual(['220px', 'scaleX(-1)'])
    // Its outline follows it there; the thread has none to show
    expect(container.querySelector<HTMLElement>('[data-outline="selected"]')!.style.left).toBe('220px')
    expect(container.querySelector('[data-outline="hover"]')).toBeNull()
  })

  it('turns over with the shared turn, coming round edge-on to its back, and tilts there as the front does', () => {
    const { container } = render(<NoteView note={twoSided()} scale={1} live perspective />)
    const root = () => container.firstElementChild as HTMLElement
    const mark = () => container.querySelector<HTMLElement>('[data-watermark]')!
    act(() => setTilt({ turn: 0.25 }))
    expect(root().style.transform).toBe(`rotateX(0deg) rotateY(${turnDeg(0.25)}deg)`)
    expect(container.querySelector('[data-thread]')).not.toBeNull()
    expect(mark().style.left).toBe('10px')
    act(() => setTilt({ turn: 0.75 }))
    expect(root().hasAttribute('data-back')).toBe(true)
    expect(container.querySelector('[data-thread]')).toBeNull()
    expect(root().style.transform).toBe(`rotateX(0deg) rotateY(${turnDeg(0.75)}deg)`)
    // The same light layer, the other way round at the other side
    expect([mark().style.left, mark().style.transform]).toEqual(['110px', 'scaleX(-1)'])
    act(() => setTilt({ turn: 1, angle: 5, angleX: 10 }))
    expect(root().style.transform).toBe('rotateX(5deg) rotateY(10deg)')
    expect(Number(mark().style.opacity)).toBeCloseTo(watermarkOpacity(0.6, watermarkReveal(0, { x: 10, y: 5 })))
    // And back again
    act(() => setTilt({ turn: 0, angle: 0, angleX: 0 }))
    expect(root().hasAttribute('data-back')).toBe(false)
    expect([mark().style.left, mark().style.transform]).toEqual(['10px', ''])
  })
})
