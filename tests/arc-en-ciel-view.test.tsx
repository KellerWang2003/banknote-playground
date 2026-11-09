// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteView } from '../src/components/NoteView'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { ArcEnCielPanel } from '../src/editor/ArcEnCielPanel'
import { ArcHandles } from '../src/editor/ArcHandles'
import { ColourList } from '../src/editor/ColourList'
import { PlacingBox } from '../src/editor/PlacingBox'
import { ARC_SLIDE_BANDS, ARC_SLIDE_DEG, DEFAULT_ARC, arcLight, newArcEnCiel, withBend, withLineMoved, withoutSpot, withSpot } from '../src/lib/arcEnCiel'
import { turnDeg } from '../src/lib/back'
import { bandLook, type BandShape } from '../src/lib/bandMap'
import { createNote } from '../src/lib/notes'
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
const solid: BandShape = { key: 'disc|', edge: { width: 1, height: 1, data: new Float32Array(1), max: 0 } }
const embossed: BandShape = { ...solid, emboss: { width: 1, height: 1, data: new Float32Array([0.2]), max: 0.2 } }

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
    act(() => setTilt({ angle: ARC_SLIDE_DEG / 2, angleX: 7 }))
    expect(lastPaint().look).toMatchObject({ slide: ARC_SLIDE_BANDS / 2 })
    // Rotated on screen, the bands still go by the banknote's own tilt
    act(() => setTilt({ quarterTurns: 1 }))
    expect(lastPaint().look).toMatchObject({ slide: ARC_SLIDE_BANDS / 2 })
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
    const note = withArc({ flow: 'point', realistic: true })
    let renders = 0
    function Counted() {
      renders++
      return <NoteView note={note} scale={2} live perspective />
    }
    render(<Counted />)
    // Its shape's maps are read for the area it embosses, though Point needs none
    expect(lastPaint().look).toEqual(bandLook(note.arcEnCiel, embossed, { x: 0, y: 0 }, arcLight(note.arcEnCiel, { x: 0, y: 0 })))
    expect(lastPaint().look).toMatchObject({ emboss: embossed.emboss })
    const before = renders
    act(() => setTilt({ angle: 10 }))
    expect(lastPaint().look).toMatchObject({ slide: 0, lit: arcLight(note.arcEnCiel, { x: 0, y: 10 }) })
    // The lamp stays put as the banknote is rotated on screen, and turning it over turns the ridges from it too
    act(() => setTilt({ quarterTurns: 1 }))
    expect(lastPaint().look).toMatchObject({ lit: arcLight(note.arcEnCiel, { x: 0, y: 10 }, 1) })
    act(() => setTilt({ turn: 0.2 }))
    expect(lastPaint().look).toMatchObject({ lit: arcLight(note.arcEnCiel, { x: turnDeg(0.2), y: 10 }, 1) })
    expect(renders).toBe(before)
  })

  it('with Realistic on but no WebGL, shows its bands as without it', () => {
    held.shape = embossed
    const note = withArc({ flow: 'point', realistic: true })
    render(<NoteView note={note} scale={2} live perspective />)
    expect(lastPaint().look).toEqual(bandLook(note.arcEnCiel, embossed, { x: 0, y: 0 }))
    expect(lastPaint().look).not.toHaveProperty('lit')
  })

  it('shows nothing without an image, nor on the back, and a still note draws it as at its own tilt', () => {
    const { container, rerender } = render(<NoteView note={withArc({ imageId: undefined, flow: 'point' })} scale={1} live />)
    expect(container.querySelector('[data-arc-en-ciel], [data-loading]')).toBeNull()
    rerender(<NoteView note={withArc({ flow: 'point' })} scale={1} side="back" />)
    expect(container.querySelector('[data-arc-en-ciel]')).toBeNull()
    rerender(<NoteView note={withArc({ flow: 'point', axis: 'x' })} scale={1} angle={3} angleX={-ARC_SLIDE_DEG} />)
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
    const order = ['From left', 'From top', 'Width', 'Image', 'Invert', 'Bands from', 'Colours', 'Band width', 'Moves on', 'Realistic'].map((words) => text.indexOf(words))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
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

  it('ends with Realistic, saved only when on', async () => {
    show({ flow: 'point' })
    await userEvent.click(screen.getByRole('switch', { name: 'Realistic' }))
    expect(panel.arc!.realistic).toBe(true)
  })

  it('offers Invert only once it has an image', () => {
    show({ imageId: undefined, flow: 'point' })
    expect(screen.queryByRole('switch', { name: 'Invert' })).toBeNull()
    cleanup()
    show({ flow: 'point' })
    expect(screen.getByRole('switch', { name: 'Invert' })).toBeDefined()
  })
})
