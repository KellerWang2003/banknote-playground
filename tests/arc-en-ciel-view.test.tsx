// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteView } from '../src/components/NoteView'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { ArcEnCielPanel } from '../src/editor/ArcEnCielPanel'
import { ArcHandles, RidgeDial } from '../src/editor/ArcHandles'
import { ColourList } from '../src/editor/ColourList'
import { PlacingBox } from '../src/editor/PlacingBox'
import { ARC_EASE, ARC_SLIDE_BANDS, ARC_SLIDE_DEG, DEFAULT_ARC, arcLight, linearRgb, newArcEnCiel, withBend, withLineMoved, withoutSpot, withSpot } from '../src/lib/arcEnCiel'
import { turnDeg } from '../src/lib/back'
import { bandLook, type BandShape } from '../src/lib/bandMap'
import { perspectiveFor } from '../src/lib/frames'
import { createNote } from '../src/lib/notes'
import { PAPER_THROUGH, featureShade } from '../src/lib/paper'
import { PLACE_STEP } from '../src/lib/placed'
import type { ArcEnCiel, Note } from '../src/lib/types'
import { setTilt } from '../src/tilt/tilt'

// Arc-en-Ciel's mask is read from its image on a canvas, which jsdom lacks: each image's stands in as a plain object
const masks = vi.hoisted(() => new Map<string, object>())
vi.mock('../src/lib/inkMask', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/inkMask')>()),
  useInkMask: (layer?: { imageId?: string }) => {
    if (!layer?.imageId || layer.imageId === 'loading') return undefined
    if (!masks.has(layer.imageId)) masks.set(layer.imageId, { name: layer.imageId })
    return { key: layer.imageId, canvas: masks.get(layer.imageId), url: `mask-${layer.imageId}.png` }
  },
}))
// Nor can it work out the maps or draw on the GPU: the maps are what a test says, and drawing notes what it was asked
const held = vi.hoisted(() => ({ shape: undefined as BandShape | null | undefined, painted: [] as { canvas: HTMLCanvasElement; mask: unknown; look: unknown }[] }))
vi.mock('../src/lib/bandMap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/bandMap')>()),
  useBandShape: (arc?: { imageId?: string }) => (arc?.imageId ? held.shape : undefined),
  paintArcEnCiel: (canvas: HTMLCanvasElement, mask: unknown, look: unknown) => { held.painted.push({ canvas, mask, look }) },
}))
// Nor has it WebGL: whether Realistic's ridges can be drawn is what a test says
const gpu = vi.hoisted(() => ({ bands: false }))
vi.mock('../src/lib/inkRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/inkRenderer')>()),
  bandsAvailable: () => gpu.bands,
}))
// The panel's changes go to the banknote here
const panel = vi.hoisted(() => ({ arc: undefined as ArcEnCiel | undefined, note: undefined as Note | undefined }))
vi.mock('../src/editor/layerActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/editor/layerActions')>()),
  updateArcEnCiel: (_ref: unknown, change: (arc: ArcEnCiel, note: Note) => ArcEnCiel) => { panel.arc = change(panel.arc!, panel.note!) },
  setArcEnCielImage: vi.fn(async () => {}),
}))
vi.mock('../src/lib/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/images')>()),
  useImageUrl: () => undefined,
}))

beforeEach(() => {
  held.shape = undefined
  held.painted = []
  gpu.bands = false
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1 }
  })
  for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
    Object.defineProperty(Element.prototype, name, { configurable: true, value: vi.fn(() => true) })
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setTilt({ source: 'hold', angle: 0, angleX: 0, target: 0, targetX: 0, light: 0, flipped: false, turn: 0, quarterTurns: 0 })
})

const plain = () => createNote({ name: 'Live', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#112233' })
const arcOf = (change: Partial<ArcEnCiel> = {}): ArcEnCiel => ({ ...newArcEnCiel(plain()), imageId: 'disc', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20, ...change })
const withArc = (change: Partial<ArcEnCiel> = {}): Note & { arcEnCiel: ArcEnCiel } => ({ ...plain(), arcEnCiel: arcOf(change) })
const lastPaint = () => held.painted.at(-1)!
const RAD = Math.PI / 180
const solid: BandShape = { key: 'disc|', edge: { width: 1, height: 1, data: new Float32Array(1), max: 0 } }
// Its white edge's map reaching a pixel past an image a pixel across: as far as the box is wide, so an edge as wide as it
// is set reaches that far past it
const embossed: BandShape = { ...solid, emboss: { width: 3, height: 3, data: new Float32Array(9).fill(0.2), max: 0.2, pad: 1 } }

describe("a NoteView's Arc-en-Ciel", () => {
  it('draws its bands into a canvas of its own in its box, as many pixels as it shows with, and slides them as it tilts', () => {
    const note = withArc({ flow: 'point' })
    let renders = 0
    function Counted() {
      renders++
      return <NoteView note={note} scale={2} live perspective />
    }
    const { container } = render(<Counted />)
    const box = container.querySelector<HTMLElement>('[data-arc-en-ciel]')!
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(['20px', '20px', '60px', '40px'])
    // It takes a press anywhere in its box, to drag it, as the other placed layers do
    expect(box.getAttribute('data-placed')).toBe('arcEnCiel')
    expect(box.classList.contains('cursor-move')).toBe(true)
    const canvas = box.querySelector('canvas')!
    expect([canvas.width, canvas.height]).toEqual([60, 40])
    expect(lastPaint()).toEqual({ canvas, mask: masks.get('disc'), look: bandLook(note.arcEnCiel, undefined, { x: 0, y: 0 }) })
    const before = renders
    // Halfway to ARC_SLIDE_DEG, as far along as `arcTurned` says
    act(() => setTilt({ angle: ARC_SLIDE_DEG / 2, angleX: 7 }))
    expect(lastPaint().look).toMatchObject({ slide: ARC_SLIDE_BANDS * 0.5 ** ARC_EASE })
    // Rotated on screen, the bands still go by the banknote's own tilt
    act(() => setTilt({ quarterTurns: 1 }))
    expect(lastPaint().look).toMatchObject({ slide: ARC_SLIDE_BANDS * 0.5 ** ARC_EASE })
    expect(renders).toBe(before)
  })

  it('shimmers in its box while its shape, or the maps Edge needs, are on their way', () => {
    const { container, rerender } = render(<NoteView note={withArc({ imageId: 'loading', flow: 'point' })} scale={1} live />)
    expect(container.querySelector('[data-loading]')).not.toBeNull()
    expect(container.querySelector('[data-arc-en-ciel]')).toBeNull()
    rerender(<NoteView note={withArc()} scale={1} live />)
    expect(container.querySelector('[data-loading]')).not.toBeNull()
    held.shape = solid
    rerender(<NoteView note={withArc()} scale={1} live />)
    expect(container.querySelector('[data-loading]')).toBeNull()
    expect(lastPaint().look).toMatchObject({ from: 'map', field: solid.edge })
  })

  it('with Realistic on, draws its ridges lit and embossed, turning from the lamp as the banknote tilts, rotates and turns over', () => {
    gpu.bands = true
    held.shape = embossed
    const note = withArc({ flow: 'point', edgeMm: 1 })
    // Opaque, it is shaded as Realistic's paper round it is at the same tilt, outside Demo on a phone
    const lit = (tilt: { x: number; y: number }, quarter: 0 | 1 = 0, through = 0) =>
      arcLight(note.arcEnCiel, tilt, quarter, featureShade(note.arcEnCiel, note, tilt, perspectiveFor(note, 1), quarter, through))
    let renders = 0
    function Counted() {
      renders++
      return <NoteView note={note} scale={2} live perspective realistic />
    }
    const { container } = render(<Counted />)
    // Its shape's maps are read for its white edge, though Point needs none
    expect(lastPaint().look).toEqual(bandLook(note.arcEnCiel, embossed, { x: 0, y: 0 }, lit({ x: 0, y: 0 })))
    expect(lastPaint().look).toMatchObject({ emboss: embossed.emboss, outset: 1 })
    // Its canvas reaches 1 mm past its box all round for the white edge, as many pixels as that shows with, and takes no
    // press of its own: its box does
    const canvas = container.querySelector<HTMLElement>('[data-arc-en-ciel] canvas')! as HTMLCanvasElement
    expect([canvas.style.left, canvas.style.top, canvas.style.width, canvas.style.height]).toEqual(['-2px', '-2px', '64px', '44px'])
    expect([canvas.width, canvas.height]).toEqual([64, 44])
    expect(canvas.classList.contains('pointer-events-none')).toBe(true)
    const before = renders
    act(() => setTilt({ angle: 10 }))
    expect(lastPaint().look).toMatchObject({ slide: 0, lit: lit({ x: 0, y: 10 }) })
    // The lamp stays put as the banknote is rotated on screen, and turning it over turns the ridges from it too
    act(() => setTilt({ quarterTurns: 1 }))
    expect(lastPaint().look).toMatchObject({ lit: lit({ x: 0, y: 10 }, 1) })
    act(() => setTilt({ turn: 0.2 }))
    expect(lastPaint().look).toMatchObject({ lit: lit({ x: turnDeg(0.2), y: 10 }, 1) })
    expect(renders).toBe(before)
    // Held to the light, its white edge, bare paper, lets a little of it through as the paper round it does; the print none
    act(() => setTilt({ turn: 0, light: 0.5 }))
    expect((lastPaint().look as { lit: { paper: { through: number } } }).lit.paper.through).toBeCloseTo(PAPER_THROUGH * 0.5)
    expect(lastPaint().look).toEqual(bandLook(note.arcEnCiel, embossed, { x: 0, y: 10 }, lit({ x: 0, y: 10 }, 1, PAPER_THROUGH * 0.5)))
  })

  it('with its white edge on, reaches past its box as far as the edge is wide, Realistic or not', () => {
    held.shape = embossed
    const { container, rerender } = render(<NoteView note={withArc({ flow: 'point', edgeMm: 2 })} scale={2} live perspective />)
    expect(lastPaint().look).toMatchObject({ emboss: embossed.emboss, outset: 2 })
    expect(lastPaint().look).not.toHaveProperty('lit')
    const canvas = () => container.querySelector<HTMLCanvasElement>('[data-arc-en-ciel] canvas')!
    expect([canvas().style.left, canvas().style.width, canvas().width, canvas().height]).toEqual(['-4px', '68px', 68, 48])
    // In the colour picked for it
    rerender(<NoteView note={withArc({ flow: 'point', edgeMm: 2, edgeColor: '#c8a24a' })} scale={2} live perspective />)
    expect(lastPaint().look).toMatchObject({ outset: 2, edgeColour: linearRgb('#c8a24a') })
    // Off, it keeps to its box
    rerender(<NoteView note={withArc({ flow: 'point' })} scale={2} live perspective />)
    expect(lastPaint().look).not.toHaveProperty('emboss')
    expect([canvas().style.left, canvas().width]).toEqual(['0px', 60])
  })

  it('with Realistic on but no WebGL, shows its bands as without it', () => {
    held.shape = embossed
    const note = withArc({ flow: 'point' })
    render(<NoteView note={note} scale={2} live perspective realistic />)
    expect(lastPaint().look).toEqual(bandLook(note.arcEnCiel, embossed, { x: 0, y: 0 }))
    expect(lastPaint().look).not.toHaveProperty('lit')
  })

  it('shows nothing without an image, nor on the back, and a still note draws it as at its own tilt', () => {
    const { container, rerender } = render(<NoteView note={withArc({ imageId: undefined, flow: 'point' })} scale={1} live />)
    expect(container.querySelector('[data-arc-en-ciel], [data-loading]')).toBeNull()
    rerender(<NoteView note={withArc({ flow: 'point' })} scale={1} side="back" />)
    expect(container.querySelector('[data-arc-en-ciel]')).toBeNull()
    rerender(<NoteView note={withArc({ flow: 'point', angleDeg: -90 })} scale={1} angle={3} angleX={-ARC_SLIDE_DEG} />)
    expect(lastPaint().look).toMatchObject({ slide: -ARC_SLIDE_BANDS })
  })
})

describe('the handles where the bands start', () => {
  const press = { button: 0, pointerId: 1 }

  it('drag a point, nudge it with the arrow keys, and Delete takes out a picked one while others are left', () => {
    const onChange = vi.fn()
    const arc = arcOf({ flow: 'point', points: [{ x: 0.5, y: 0.5 }, { x: 0.1, y: 0.2 }] })
    render(<ArcHandles arc={arc} scale={2} onChange={onChange} />)
    const dots = screen.getAllByRole('button', { name: /^Move point/ })
    expect(dots.map((dot) => [dot.style.left, dot.style.top])).toEqual([['50px', '40px'], ['26px', '28px']])
    fireEvent.pointerDown(dots[0], { ...press, clientX: 100, clientY: 100 })
    expect(dots[0].getAttribute('aria-pressed')).toBe('true')
    fireEvent.pointerMove(dots[0], { clientX: 112, clientY: 104, buttons: 1 })
    expect(onChange).toHaveBeenLastCalledWith(withSpot(arc, { kind: 'point', index: 0 }, { x: 0.5 + 6 / 30, y: 0.5 + 2 / 20 }))
    fireEvent.pointerUp(dots[0])
    fireEvent.keyDown(dots[0], { key: 'ArrowLeft', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(withSpot(arc, { kind: 'point', index: 0 }, { x: (15 - 10 * PLACE_STEP) / 30, y: 0.5 }))
    // Delete takes out the point, and the layer stays
    expect(fireEvent.keyDown(window, { key: 'Delete' })).toBe(false)
    expect(onChange).toHaveBeenLastCalledWith(withoutSpot(arc, { kind: 'point', index: 0 }))
  })

  it('turn with a rotated banknote, moving the way the pointer goes on screen', () => {
    const onChange = vi.fn()
    const arc = arcOf({ flow: 'point', points: [{ x: 0.5, y: 0.5 }] })
    render(<ArcHandles arc={arc} scale={2} quarter={1} onChange={onChange} />)
    const dot = screen.getByRole('button', { name: 'Move point 1' })
    fireEvent.pointerDown(dot, { ...press, clientX: 0, clientY: 0 })
    // Right on screen is up the banknote turned a quarter clockwise
    fireEvent.pointerMove(dot, { clientX: 8, clientY: 0, buttons: 1 })
    expect(onChange).toHaveBeenLastCalledWith(withSpot(arc, { kind: 'point', index: 0 }, { x: 0.5, y: 0.5 - 4 / 20 }))
  })

  it('let a picked dot go on a press elsewhere, and keep the last point and the line’s ends, the layer too', () => {
    const onChange = vi.fn()
    render(<ArcHandles arc={arcOf({ flow: 'point', points: [{ x: 0.5, y: 0.5 }] })} scale={1} onChange={onChange} />)
    const dot = screen.getByRole('button', { name: 'Move point 1' })
    fireEvent.pointerDown(dot, press)
    fireEvent.pointerUp(dot)
    expect(fireEvent.keyDown(window, { key: 'Backspace' })).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body, press)
    expect(dot.getAttribute('aria-pressed')).toBe('false')
    // Nothing picked: Delete is the editor's again
    expect(fireEvent.keyDown(window, { key: 'Delete' })).toBe(true)
  })

  it('draw Line with its ends solid and its bends hollow; dragging it moves it whole, and a double-click bends it there', () => {
    const onChange = vi.fn()
    const arc = arcOf({ flow: 'line', xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, line: [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.8 }, { x: 1, y: 0.5 }] })
    // Not a press on the banknote, which would stop placing
    const outer = vi.fn()
    const { container } = render(<div onPointerDown={outer}><ArcHandles arc={arc} scale={2} onChange={onChange} /></div>)
    expect(screen.getAllByRole('button').map((dot) => dot.getAttribute('aria-label'))).toEqual(['Move the line’s start', 'Move bend 1', 'Move the line’s end'])
    expect(screen.getByRole('button', { name: 'Move bend 1' }).classList.contains('bg-background')).toBe(true)
    expect(screen.getByRole('button', { name: 'Move the line’s end' }).classList.contains('bg-fuchsia-500')).toBe(true)
    const line = container.querySelector('[data-arc-line]')!
    fireEvent.pointerDown(line, { ...press, clientX: 50, clientY: 50 })
    expect(outer).not.toHaveBeenCalled()
    fireEvent.pointerMove(line, { clientX: 51, clientY: 51, buttons: 1 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerMove(line, { clientX: 58, clientY: 46, buttons: 1 })
    expect(onChange).toHaveBeenLastCalledWith(withLineMoved(arc, arc.line, 4, -2))
    fireEvent.pointerUp(line)
    onChange.mockClear()
    // On the banknote 20 mm across and 13 mm down, a quarter of the way along the line
    fireEvent.doubleClick(line, { clientX: 30, clientY: 26 })
    expect(onChange).toHaveBeenCalledWith(withBend(arc, { x: 0.25, y: 0.3 }).arc)
    expect(withBend(arc, { x: 0.25, y: 0.3 }).index).toBe(1)
  })

  it('turn the ridges with a dial over the box, a knob towards each end, in whole degrees and steps of 15° with Shift', () => {
    const onTurn = vi.fn()
    const arc = arcOf({ flow: 'edge', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20, angleDeg: 0 })
    // Not a press on the box, which would move it
    const outer = vi.fn()
    const { container, rerender } = render(<div onPointerDown={outer}><RidgeDial arc={arc} scale={2} onTurn={onTurn} /></div>)
    // Level ridges: a line across the middle of the box, edge to edge, its knobs 0.42 of the box's height either side
    const line = container.querySelector('[data-ridge-line]')!
    expect(['x1', 'y1', 'x2', 'y2'].map((name) => Number(line.getAttribute(name)))).toEqual([20, 40, 80, 40])
    const [right, left] = screen.getAllByRole('button', { name: 'Turn the ridges' })
    const at = (knob: HTMLElement) => [Number.parseFloat(knob.style.left), Number.parseFloat(knob.style.top)]
    expect(at(right)[0]).toBeCloseTo(50 + 16.8)
    expect(at(left)[0]).toBeCloseTo(50 - 16.8)
    fireEvent.pointerDown(right, { ...press, clientX: 66.8, clientY: 40 })
    expect(outer).not.toHaveBeenCalled()
    // Round the middle to up and right: rising to the right at 45°; with Shift, to the nearest 15°
    fireEvent.pointerMove(right, { clientX: 60, clientY: 30, buttons: 1 })
    expect(onTurn).toHaveBeenLastCalledWith(45)
    fireEvent.pointerMove(right, { clientX: 50 + 20 * Math.cos(53 * RAD), clientY: 40 - 20 * Math.sin(53 * RAD), buttons: 1, shiftKey: true })
    expect(onTurn).toHaveBeenLastCalledWith(60)
    // On past upright, the same ridges as those at −80°
    fireEvent.pointerMove(right, { clientX: 50 + 20 * Math.cos(100 * RAD), clientY: 40 - 20 * Math.sin(100 * RAD), buttons: 1 })
    expect(onTurn).toHaveBeenLastCalledWith(-80)
    fireEvent.pointerUp(right)
    // The other knob points the other way round
    fireEvent.pointerDown(left, { ...press, clientX: 33.2, clientY: 40 })
    fireEvent.pointerMove(left, { clientX: 40, clientY: 50, buttons: 1 })
    expect(onTurn).toHaveBeenLastCalledWith(45)
    fireEvent.pointerUp(left)
    // A cancelled drag puts the ridges back
    fireEvent.pointerDown(right, { ...press, clientX: 66.8, clientY: 40 })
    fireEvent.pointerMove(right, { clientX: 60, clientY: 30, buttons: 1 })
    fireEvent.pointerCancel(right)
    expect(onTurn).toHaveBeenLastCalledWith(0)
    // Arrow keys turn them a degree, 15° with Shift, on past upright too
    fireEvent.keyDown(right, { key: 'ArrowUp' })
    expect(onTurn).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(right, { key: 'ArrowLeft', shiftKey: true })
    expect(onTurn).toHaveBeenLastCalledWith(-15)
    rerender(<div onPointerDown={outer}><RidgeDial arc={{ ...arc, angleDeg: 87 }} scale={2} onTurn={onTurn} /></div>)
    fireEvent.keyDown(right, { key: 'ArrowRight', shiftKey: true })
    expect(onTurn).toHaveBeenLastCalledWith(90)
    rerender(<div onPointerDown={outer}><RidgeDial arc={{ ...arc, angleDeg: 90 }} scale={2} onTurn={onTurn} /></div>)
    fireEvent.keyDown(right, { key: 'ArrowUp' })
    expect(onTurn).toHaveBeenLastCalledWith(-89)
    // Upright: the line runs top to bottom of the box, its knob turned across it
    expect(['x1', 'y1', 'x2', 'y2'].map((name) => Math.round(Number(container.querySelector('[data-ridge-line]')!.getAttribute(name))))).toEqual([50, 60, 50, 20])
    expect(right.style.transform).toContain('rotate(-90deg)')
  })

  it('turn the ridges the way the pointer goes on screen on a rotated banknote', () => {
    const onTurn = vi.fn()
    const arc = arcOf({ flow: 'point', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20, angleDeg: 0 })
    render(<RidgeDial arc={arc} scale={2} quarter={1} onTurn={onTurn} />)
    const [right] = screen.getAllByRole('button', { name: 'Turn the ridges' })
    // Turned a quarter clockwise, the knob at the banknote's right shows below its middle
    fireEvent.pointerDown(right, { ...press, clientX: -40, clientY: 66.8 })
    // Right of that on screen is towards the banknote's top: the ridges rise to the right on it
    fireEvent.pointerMove(right, { clientX: -30, clientY: 60, buttons: 1 })
    expect(onTurn).toHaveBeenLastCalledWith(45)
  })

  it('add a point where the placing box is double-clicked, away from its corners', () => {
    const onDoubleClick = vi.fn()
    const note = withArc()
    render(<PlacingBox note={note} layer="arcEnCiel" box={note.arcEnCiel} scale={2} onChange={() => {}} onDoubleClick={onDoubleClick} />)
    const box = screen.getByRole('group', { name: 'Place arc-en-ciel' })
    fireEvent.doubleClick(box, { clientX: 10, clientY: 6 })
    expect(onDoubleClick).toHaveBeenCalledWith({ xMm: 15, yMm: 13 })
    fireEvent.doubleClick(screen.getByRole('button', { name: /top-left corner/ }))
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
  })
})

describe('the colour list', () => {
  it('moves a colour up or down with its grip, by dragging or the arrow keys, as one undo step a drag', () => {
    const onChange = vi.fn()
    const onDrag = vi.fn()
    const colors = ['#111111', '#222222', '#333333']
    const { container } = render(<ColourList colors={colors} min={3} onChange={onChange} onDrag={onDrag} />)
    const rows = [...container.querySelectorAll<HTMLElement>('[data-colour-row]')]
    rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 40, bottom: i * 40 + 32 }) as DOMRect })
    const grips = screen.getAllByRole('button', { name: /^Move colour/ })
    fireEvent.keyDown(grips[1], { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(['#111111', '#333333', '#222222'])
    fireEvent.keyDown(grips[0], { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(grips[0], { button: 0, pointerId: 1, clientY: 10 })
    expect(onDrag).toHaveBeenLastCalledWith(true)
    fireEvent.pointerMove(grips[0], { clientY: 50, buttons: 1 })
    expect(onChange).toHaveBeenLastCalledWith(['#222222', '#111111', '#333333'])
    fireEvent.pointerUp(grips[0])
    expect(onDrag).toHaveBeenLastCalledWith(false)
  })

  it('takes a colour out only while more than the fewest are left', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<ColourList colors={['#111111', '#222222', '#333333']} min={3} onChange={onChange} />)
    expect(screen.getAllByRole('button', { name: 'Remove colour' }).every((button) => button.hasAttribute('disabled'))).toBe(true)
    rerender(<ColourList colors={['#111111', '#222222', '#333333', '#444444']} min={3} onChange={onChange} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove colour' })[1])
    expect(onChange).toHaveBeenLastCalledWith(['#111111', '#333333', '#444444'])
  })
})

describe('the Arc-en-Ciel panel', () => {
  const show = (change: Partial<ArcEnCiel> = {}) => {
    panel.note = plain()
    panel.arc = arcOf(change)
    const onPlace = vi.fn()
    const view = () => (
      <TooltipProvider>
        <ArcEnCielPanel note={panel.note!} arc={panel.arc!} noteRef={{ projectId: 'p', noteId: panel.note!.id }} onPlace={onPlace} />
      </TooltipProvider>
    )
    const { rerender } = render(view())
    return { onPlace, again: () => rerender(view()) }
  }

  it('reads where it sits first, then its image, then the bands', () => {
    held.shape = solid
    show()
    const text = document.body.textContent!
    const order = ['From left', 'From top', 'Width', 'Image', 'Invert', 'Bands from', 'Colours', 'Band width', 'Ridge angle']
      .map((words) => text.indexOf(words))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // The edge last
    const edge = screen.getByRole('switch', { name: 'Edge' })
    expect(screen.getByText('Ridge angle').compareDocumentPosition(edge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Realistic isn't one of its own: it is the canvas's, beside the lamp, for every banknote
    expect(screen.queryByRole('switch', { name: 'Realistic' })).toBeNull()
  })

  it('greys out Holes on a shape without any, and Point and Line show their handles on the canvas', async () => {
    held.shape = solid
    const { onPlace } = show()
    expect(screen.getByRole('button', { name: 'Holes' }).hasAttribute('disabled')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Point' }))
    expect(panel.arc!.flow).toBe('point')
    expect(onPlace).toHaveBeenCalledTimes(1)
    cleanup()
    held.shape = { ...solid, holes: solid.edge }
    show()
    expect(screen.getByRole('button', { name: 'Holes' }).hasAttribute('disabled')).toBe(false)
  })

  it('adds a fourth colour the list doesn’t have yet, and no fifth', async () => {
    held.shape = solid
    const { again } = show()
    const add = () => screen.getByRole('button', { name: 'Add colour' })
    await userEvent.click(add())
    expect(panel.arc!.colors).toHaveLength(4)
    expect(new Set(panel.arc!.colors.map((c) => c.toLowerCase())).size).toBe(4)
    expect(panel.arc!.colors.slice(0, 3)).toEqual(DEFAULT_ARC.colors)
    again()
    expect(add().hasAttribute('disabled')).toBe(true)
  })

  it('sets the ridges’ angle in degrees, from −90° to 90°', () => {
    show({ flow: 'point' })
    const field = within(screen.getByTitle(/The ridges' angle/)).getByRole('spinbutton')
    fireEvent.change(field, { target: { value: '30' } })
    expect(panel.arc!.angleDeg).toBe(30)
    fireEvent.change(field, { target: { value: '-90' } })
    expect(panel.arc!.angleDeg).toBe(-90)
  })

  it('ends with the edge, off at first, saved only when on, its width from 0.5 to 3 mm and its colour the paper’s until one is picked', async () => {
    const { again } = show({ flow: 'point' })
    expect(screen.queryByTitle(/How wide the edge/)).toBeNull()
    expect(screen.queryByTitle('The edge\'s colour')).toBeNull()
    await userEvent.click(screen.getByRole('switch', { name: 'Edge' }))
    expect(panel.arc!.edgeMm).toBe(1)
    expect(panel.arc!).not.toHaveProperty('edgeColor')
    again()
    const field = within(screen.getByTitle(/How wide the edge/)).getByRole('textbox')
    fireEvent.change(field, { target: { value: '2.5' } })
    expect(panel.arc!.edgeMm).toBe(2.5)
    again()
    const colour = within(screen.getByTitle('The edge\'s colour'))
    expect((colour.getByRole('textbox') as HTMLInputElement).value).toBe('#E5E5E5')
    fireEvent.change(colour.getByRole('textbox'), { target: { value: '#c8a24a' } })
    expect(panel.arc!.edgeColor).toBe('#c8a24a')
    again()
    expect((within(screen.getByTitle('The edge\'s colour')).getByRole('textbox') as HTMLInputElement).value).toBe('#c8a24a')
    // Off, it forgets both, so it starts again as bare paper 1 mm wide
    await userEvent.click(screen.getByRole('switch', { name: 'Edge' }))
    expect(panel.arc!).not.toHaveProperty('edgeMm')
    expect(panel.arc!).not.toHaveProperty('edgeColor')
  })

  it('offers Invert only once it has an image', () => {
    show({ imageId: undefined, flow: 'point' })
    expect(screen.queryByRole('switch', { name: 'Invert' })).toBeNull()
    cleanup()
    show({ flow: 'point' })
    expect(screen.getByRole('switch', { name: 'Invert' })).toBeDefined()
  })
})
