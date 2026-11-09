// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteView } from '../src/components/NoteView'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { ArcHandles, RidgeDial } from '../src/editor/ArcHandles'
import { PlaceFields } from '../src/editor/PlacedFields'
import { PlacingBox, ROTATE_ZONE_PX } from '../src/editor/PlacingBox'
import { arcLight, bandSlide, fitArcEnCiel, newArcEnCiel, withSpot } from '../src/lib/arcEnCiel'
import { mirrored } from '../src/lib/back'
import { watermarkWeight } from '../src/lib/continuous'
import { drawFace } from '../src/lib/exportRender'
import type { InkMask } from '../src/lib/inkMask'
import { DEFAULT_INK, fitMagneticInk, inkRoll, newMagneticInk } from '../src/lib/magneticInk'
import { createNote, createProject, migrateProject } from '../src/lib/notes'
import {
  type Corner, type PlacedBox, boxBounds, dragBoxCorner, fitBox, intoBox, isWhollyOn, moveBox, normalRotation, onto, outOfBox, pointInBox, resizeBox,
} from '../src/lib/placed'
import { flakeRest, inkLight, tiltMatrix, turned, withBoxRotation } from '../src/lib/realisticInk'
import type { Reading, Relief } from '../src/lib/relief'
import type { ArcEnCiel, MagneticInk, Note, Watermark } from '../src/lib/types'
import { fitWatermark, newWatermark } from '../src/lib/watermark'
import { setTilt } from '../src/tilt/tilt'

// Masks and maps are read from images on a canvas, which jsdom lacks: each image's stands in as a plain object
vi.mock('../src/lib/inkMask', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/inkMask')>()),
  useInkMask: (layer?: { imageId?: string }) => (layer?.imageId ? { key: layer.imageId, canvas: { name: layer.imageId }, url: `mask-${layer.imageId}.png` } : undefined),
}))
vi.mock('../src/lib/bandMap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/bandMap')>()),
  useBandShape: () => undefined,
  paintArcEnCiel: () => {},
}))
vi.mock('../src/lib/relief', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/relief')>()),
  useRelief: () => undefined,
}))
// Nor has it WebGL
vi.mock('../src/lib/inkRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/inkRenderer')>()),
  bandsAvailable: () => false,
  litInkAvailable: () => false,
  drawLitInk: () => false,
  drawBands: () => false,
}))
vi.mock('../src/lib/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/images')>()),
  useImageUrl: () => undefined,
}))

beforeEach(() => {
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

const RAD = Math.PI / 180
const plain = () => createNote({ name: 'Banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#112233' })
const near = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
}
/** Where a box's corner shows on the banknote, turned with it */
const cornerAt = (box: PlacedBox, corner: Corner) => {
  const sx = corner === 'ne' || corner === 'se' ? 1 : -1
  const sy = corner === 'sw' || corner === 'se' ? 1 : -1
  const on = outOfBox(box, (sx * box.widthMm) / 2, (sy * box.heightMm) / 2)
  return { x: box.xMm + box.widthMm / 2 + on.x, y: box.yMm + box.heightMm / 2 + on.y }
}

describe('a placed box rotated about its middle', () => {
  it('reads its rotation counterclockwise within (−180°, 180°], kept only while it is turned, by every layer and on load', () => {
    expect(normalRotation(190)).toBe(-170)
    expect(normalRotation(-180)).toBe(180)
    expect(normalRotation(540)).toBe(180)
    expect(normalRotation(-370)).toBe(-10)
    expect(Object.is(normalRotation(-0), 0)).toBe(true)
    expect(normalRotation(Number.NaN)).toBe(0)
    expect(normalRotation('45')).toBe(0)

    const note = plain()
    expect(fitBox({ xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, rotationDeg: 370 }, note)).toEqual({ xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, rotationDeg: 10 })
    expect(fitBox({ xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, rotationDeg: 360 }, note)).not.toHaveProperty('rotationDeg')
    expect(fitWatermark({ ...newWatermark(note), rotationDeg: 30 }, note).rotationDeg).toBe(30)
    expect(fitMagneticInk({ ...newMagneticInk(note), rotationDeg: -200 }, note).rotationDeg).toBe(160)
    expect(fitArcEnCiel({ ...newArcEnCiel(note), rotationDeg: 12.5 }, note).rotationDeg).toBe(12.5)
    expect(fitWatermark({ ...newWatermark(note), rotationDeg: 0 }, note)).not.toHaveProperty('rotationDeg')

    // A saved project brings it back
    const saved = { ...createProject('Turned'), notes: [{ ...note, watermark: { ...newWatermark(note), rotationDeg: -45 } }] }
    expect(migrateProject(JSON.parse(JSON.stringify(saved))).notes[0].watermark?.rotationDeg).toBe(-45)
  })

  it('turns a step along its own sides onto the banknote counterclockwise, and back', () => {
    // A quarter turn: its right is up the banknote, its bottom towards the banknote's right
    near(outOfBox({ rotationDeg: 90 }, 1, 0), { x: 0, y: -1 })
    near(outOfBox({ rotationDeg: 90 }, 0, 1), { x: 1, y: 0 })
    near(intoBox({ rotationDeg: 90 }, 0, -1), { x: 1, y: 0 })
    const there = outOfBox({ rotationDeg: 30 }, 3, -2)
    near(intoBox({ rotationDeg: 30 }, there.x, there.y), { x: 3, y: -2 })
    // Upright, nothing changes, exactly
    expect(outOfBox({}, 3, -2)).toEqual({ x: 3, y: -2 })
    const box = { xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, rotationDeg: 90 }
    // 3 mm above its middle on the banknote is 3 mm right of its middle on the box before it turned
    const at = pointInBox(box, 20, 12)
    expect(at.xMm).toBeCloseTo(23)
    expect(at.yMm).toBeCloseTo(15)
  })

  it('covers as much as its corners reach, and stays wholly on a banknote turned as it is', () => {
    const note = { widthMm: 100, heightMm: 100 }
    const box = { xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, rotationDeg: 90 }
    const bounds = boxBounds(box)
    expect(bounds.x).toBeCloseTo(15)
    expect(bounds.y).toBeCloseTo(5)
    expect(bounds.width).toBeCloseTo(10)
    expect(bounds.height).toBeCloseTo(20)
    expect(isWhollyOn(box, note)).toBe(true)
    // Upright it would lie wholly on; turned 45°, its corners reach off the left edge, and onto moves it back on
    const edge = { xMm: 0, yMm: 40, widthMm: 20, heightMm: 10, rotationDeg: 45 }
    expect(isWhollyOn({ ...edge, rotationDeg: 0 }, note)).toBe(true)
    expect(isWhollyOn(edge, note)).toBe(false)
    const moved = onto(edge, note)
    expect(boxBounds(moved).x).toBeCloseTo(0, 2)
    expect(moved.rotationDeg).toBe(45)
    expect(isWhollyOn(moved, note)).toBe(true)
  })

  it('resizes from a corner along its own sides, the opposite corner staying where it shows; a typed width keeps its own top-left', () => {
    const note = plain()
    const box = { xMm: 40, yMm: 30, widthMm: 20, heightMm: 10, rotationDeg: 30 }
    // Out along its own diagonal from its bottom-right corner, by 4 mm on its own sides
    const step = outOfBox(box, 4, 2)
    const grown = dragBoxCorner(box, 'se', step.x, step.y, note)
    expect(grown.widthMm).toBe(24)
    expect(grown.heightMm).toBe(12)
    expect(grown.rotationDeg).toBe(30)
    near(cornerAt(grown, 'nw'), cornerAt(box, 'nw'), 2)
    // From its top-left corner the bottom-right one stays
    const fromTop = outOfBox(box, -2, -1)
    near(cornerAt(dragBoxCorner(box, 'nw', fromTop.x, fromTop.y, note), 'se'), cornerAt(box, 'se'), 2)
    const typed = resizeBox(box, 30, note)
    expect([typed.widthMm, typed.heightMm, typed.rotationDeg]).toEqual([30, 15, 30])
    near(cornerAt(typed, 'nw'), cornerAt(box, 'nw'), 2)
    // Moving it keeps its turn; upright, nothing about it changes
    expect(moveBox(box, 1, 1, note)).toEqual({ ...box, xMm: 41, yMm: 31 })
    expect(dragBoxCorner({ ...box, rotationDeg: undefined }, 'se', 4, 0, note)).toEqual({ xMm: 40, yMm: 30, widthMm: 24, heightMm: 12 })
  })

  it('shows from the back turned the other way round', () => {
    const note = { widthMm: 150 }
    expect(mirrored({ xMm: 10, yMm: 5, widthMm: 30, heightMm: 20, rotationDeg: 30 }, note)).toEqual({ xMm: 110, yMm: 5, widthMm: 30, heightMm: 20, rotationDeg: -30 })
    expect(mirrored({ xMm: 10, yMm: 5, widthMm: 30, heightMm: 20 }, note)).not.toHaveProperty('rotationDeg')
  })
})

describe('what turns with it', () => {
  it("rolls magnetic ink's bar on the tilt across it: turned a quarter, a level bar rolls as an upright one does", () => {
    const side = { x: 10, y: 0 }
    const upDown = { x: 0, y: 10 }
    expect(inkRoll({ barAxis: 'y' }, upDown)).toBe(0.5)
    expect(inkRoll({ barAxis: 'y', rotationDeg: 90 }, side)).toBeCloseTo(inkRoll({ barAxis: 'x' }, side))
    expect(inkRoll({ barAxis: 'y', rotationDeg: 90 }, upDown)).toBeCloseTo(0)
    // Half a turn round, it rolls the other way
    expect(inkRoll({ barAxis: 'y', rotationDeg: 180 }, upDown)).toBeCloseTo(-0.5)
    expect(inkRoll({ barAxis: 'x', rotationDeg: -90 }, upDown)).toBeCloseTo(inkRoll({ barAxis: 'y' }, upDown))
  })

  it("slides Arc-en-Ciel's bands as ridges at their angle plus its rotation, and lights its ridges turned with it", () => {
    for (const tilt of [{ x: 0, y: 12 }, { x: -9, y: 4 }, { x: 15, y: -6 }]) {
      expect(bandSlide({ angleDeg: 10, rotationDeg: 20 }, tilt)).toBeCloseTo(bandSlide({ angleDeg: 30 }, tilt))
      expect(arcLight({ angleDeg: 10, rotationDeg: 20 }, tilt, 1).share).toBeCloseTo(arcLight({ angleDeg: 30 }, tilt, 1).share)
    }
    // The lamp, which stays where it is, lies along the box's own sides once the box is turned
    const tilt = { x: 5, y: 8 }
    const upright = arcLight({ angleDeg: 0 }, tilt)
    const quarter = arcLight({ angleDeg: 0, rotationDeg: 90 }, tilt)
    const along = intoBox({ rotationDeg: 90 }, upright.lamp[0], upright.lamp[1])
    expect(quarter.lamp[0]).toBeCloseTo(along.x)
    expect(quarter.lamp[1]).toBeCloseTo(along.y)
    expect(quarter.lamp[2]).toBeCloseTo(upright.lamp[2])
  })

  it('lights realistic magnetic ink along its own sides: its middle lands where it is, and its flakes face the viewer from there', () => {
    const note = plain()
    const ink: MagneticInk = { xMm: 100, yMm: 10, widthMm: 30, heightMm: 20, ...DEFAULT_INK, rotationDeg: 90 }
    const middle = { x: 115 - 75, y: 20 - 35 }
    for (const tilt of [{ x: 0, y: 0 }, { x: 7, y: -12 }]) {
      const light = inkLight(ink, note, tilt, 300)
      expect(light.rot).toEqual(withBoxRotation(tiltMatrix(tilt), ink))
      // The pixel in the middle of its box, as the shader places it, is where the banknote's turn puts the ink's middle
      const drawn = turned(light.rot, [light.origin[0] + light.size[0] / 2, light.origin[1] + light.size[1] / 2, 0])
      const real = turned(tiltMatrix(tilt), [middle.x, middle.y, 0])
      drawn.forEach((v, i) => expect(v).toBeCloseTo(real[i]))
    }
    // Its box's right lies up the banknote
    const right = turned(withBoxRotation(tiltMatrix({ x: 0, y: 0 }), ink), [1, 0, 0])
    right.forEach((v, i) => expect(v).toBeCloseTo([0, -1, 0][i]))
    // A level bar on it runs up and down the banknote, so its rest comes from where it sits across the banknote, and its bar's own way
    expect(flakeRest(ink, note, 300)[0]).toBeCloseTo(Math.atan2(-middle.x, 300))
    expect(flakeRest(ink, note, 300)[1]).toBeCloseTo(Math.atan2(middle.y, 300))
  })

  it('reads the design under a turned watermark within its own shape, its image turned with it', () => {
    // Its image: thin paper on its left half, plain on its right
    const reading = { key: 'r', width: 2, height: 1, thin: new Uint8Array([255, 0]), auto: { low: 0, high: 1, gamma: 1 } } as unknown as Reading
    const watermark: Watermark = { imageId: 'w', xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, depth: 1, rotationDeg: 90 }
    const weight = watermarkWeight(watermark, reading)!
    // Turned a quarter, its right half is above its middle on the banknote, its left half below
    expect(weight(20, 12)).toBe(0)
    expect(weight(20, 18)).toBe(1)
    expect(weight(12, 15)).toBe(0)
  })
})

describe('on the canvas', () => {
  const layered = (): Note => ({
    ...plain(),
    watermark: { imageId: 'w', xMm: 10, yMm: 10, widthMm: 30, heightMm: 30, depth: 0.6, rotationDeg: 30 },
    arcEnCiel: { ...newArcEnCiel(plain()), imageId: 'disc', flow: 'point', xMm: 60, yMm: 20, widthMm: 20, heightMm: 20, rotationDeg: -45 },
    magneticInk: { imageId: 'ink', xMm: 100, yMm: 10, widthMm: 30, heightMm: 20, ...DEFAULT_INK, rotationDeg: 90 },
  })

  it('turns each placed layer about its middle, its outline too, and the watermark the other way round from the back', () => {
    const note = layered()
    const { container, rerender } = render(<NoteView note={note} scale={2} selected="magneticInk" />)
    const shown = (selector: string) => container.querySelector<HTMLElement>(selector)!
    expect(shown('[data-watermark]').style.transform).toBe('rotate(-30deg)')
    expect(shown('[data-arc-en-ciel]').style.transform).toBe('rotate(45deg)')
    expect(shown('[data-magnetic-ink]').style.transform).toBe('rotate(-90deg)')
    expect(shown('[data-magnetic-ink]').style.left).toBe('200px')
    expect(shown('[data-outline="selected"]').style.transform).toBe('rotate(-90deg)')
    // Its bar turns with it: tipping the top away rolls nothing on ink turned a quarter, turning a side away does
    rerender(<NoteView note={note} scale={2} angle={10} />)
    expect(shown('[data-tilt="ink-bar"]').style.transform).toBe('translateY(0%)')
    rerender(<NoteView note={note} scale={2} angleX={-10} />)
    expect(shown('[data-tilt="ink-bar"]').style.transform).not.toBe('translateY(0%)')
    rerender(<NoteView note={note} scale={2} side="back" />)
    expect(shown('[data-watermark]').style.transform).toBe('rotate(30deg) scaleX(-1)')
  })

  it('turns from just past a corner of its placing box, in whole degrees or 15° with Shift, and the other way round on the back', () => {
    const note = plain()
    const box = { xMm: 10, yMm: 10, widthMm: 30, heightMm: 20 }
    const onChange = vi.fn()
    const { container, rerender } = render(<PlacingBox note={note} layer="watermark" box={box} scale={2} onChange={onChange} />)
    const zone = container.querySelector<HTMLElement>('[data-rotate="ne"]')!
    expect([zone.style.width, zone.style.top, zone.style.right]).toEqual([`${ROTATE_ZONE_PX}px`, `-${ROTATE_ZONE_PX}px`, `-${ROTATE_ZONE_PX}px`])
    expect(zone.style.cursor).toContain('data:image/svg+xml')
    // jsdom puts the box's bounds at 0, 0: its middle is half of them in, 30 px across and 20 down
    const press = { button: 0, buttons: 1, pointerId: 1 }
    fireEvent.pointerDown(zone, { ...press, clientX: 70, clientY: 20 })
    // A quarter round counterclockwise, from its right to straight above its middle
    fireEvent.pointerMove(zone, { ...press, clientX: 30, clientY: -20 })
    expect(onChange).toHaveBeenLastCalledWith({ ...box, rotationDeg: 90 })
    fireEvent.pointerMove(zone, { ...press, clientX: 30 + 40 * Math.cos(53 * RAD), clientY: 20 - 40 * Math.sin(53 * RAD), shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith({ ...box, rotationDeg: 60 })
    fireEvent.pointerMove(zone, { ...press, clientX: 30 + 40 * Math.cos(-20.4 * RAD), clientY: 20 - 40 * Math.sin(-20.4 * RAD) })
    expect(onChange).toHaveBeenLastCalledWith({ ...box, rotationDeg: -20 })
    // A cancelled turn puts it back
    fireEvent.pointerCancel(zone)
    expect(onChange).toHaveBeenLastCalledWith(box)

    // Turned, the box shows turned, its corners resizing along their diagonals as they show
    rerender(<PlacingBox note={note} layer="watermark" box={{ ...box, rotationDeg: 45 }} scale={2} onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Place watermark' })
    expect(group.style.transform).toBe('rotate(-45deg)')
    expect(screen.getByRole('button', { name: /top-right corner/ }).style.cursor).toBe('ns-resize')
    expect(screen.getByRole('button', { name: /top-left corner/ }).style.cursor).toBe('ew-resize')

    // On the back, a turn counterclockwise there turns the front clockwise
    onChange.mockClear()
    rerender(<PlacingBox note={note} layer="watermark" box={box} scale={2} mirror onChange={onChange} />)
    fireEvent.pointerDown(zone, { ...press, clientX: 70, clientY: 20 })
    fireEvent.pointerMove(zone, { ...press, clientX: 30 + 40 * Math.cos(30 * RAD), clientY: 20 - 40 * Math.sin(30 * RAD) })
    expect(onChange).toHaveBeenLastCalledWith({ ...box, rotationDeg: -30 })
  })

  it('resizes a turned placing box from its corners along its own sides, and places a double-click on it as on the box before it turned', () => {
    const note = plain()
    const box = { xMm: 10, yMm: 10, widthMm: 30, heightMm: 20, rotationDeg: 90 }
    const onChange = vi.fn()
    const onDoubleClick = vi.fn()
    render(<PlacingBox note={note} layer="arcEnCiel" box={box} scale={2} onChange={onChange} onDoubleClick={onDoubleClick} />)
    // Its bottom-right corner shows at its top right, turned a quarter: out from there, right and up
    const corner = screen.getByRole('button', { name: /bottom-right corner/ })
    expect(corner.style.cursor).toBe('nesw-resize')
    fireEvent.pointerDown(corner, { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(corner, { buttons: 1, pointerId: 1, clientX: 112, clientY: 92 })
    const grown = onChange.mock.lastCall![0] as PlacedBox
    expect(grown.widthMm).toBeGreaterThan(30)
    expect(grown.rotationDeg).toBe(90)
    near(cornerAt(grown, 'nw'), cornerAt(box, 'nw'), 2)
    // Its bounds on screen are 40 px across and 60 down: 10 px above their middle is 5 mm right of its middle, as it lay
    const group = screen.getByRole('group', { name: 'Place arc-en-ciel' })
    fireEvent.doubleClick(group, { clientX: 20, clientY: 20 })
    const at = onDoubleClick.mock.lastCall![0] as { xMm: number; yMm: number }
    expect(at.xMm).toBeCloseTo(30)
    expect(at.yMm).toBeCloseTo(20)
  })

  it("takes a Rotation in its panel, carrying on round past half a turn, read the other way round from the back", () => {
    const note = plain()
    let box: Watermark = { imageId: 'w', xMm: 10, yMm: 10, widthMm: 30, heightMm: 30, depth: 0.6, rotationDeg: 30 }
    const change = (next: (box: Watermark, note: Note) => Watermark) => { box = next(box, note) }
    const view = () => <TooltipProvider><PlaceFields note={note} box={box} name="Watermark" onChange={change} /></TooltipProvider>
    const { rerender } = render(view())
    const input = () => screen.getByTitle('Watermark turned about its middle, counterclockwise').querySelector('input')!
    expect(screen.getByText('Rotation')).toBeDefined()
    expect(input().value).toBe('30')
    fireEvent.change(input(), { target: { value: '270' } })
    expect(box.rotationDeg).toBe(-90)
    fireEvent.blur(input())
    rerender(view())
    expect(input().value).toBe('-90')
    // From the back it shows turned the other way, and is typed as it shows there
    setTilt({ flipped: true, turn: 1 })
    rerender(view())
    expect(input().value).toBe('90')
    fireEvent.change(input(), { target: { value: '45' } })
    expect(box.rotationDeg).toBe(-45)
  })

  it("lays Arc-en-Ciel's handles on its turned box, moving them and turning its ridges along the box's own sides", () => {
    const arc: ArcEnCiel = { ...newArcEnCiel(plain()), imageId: 'disc', flow: 'point', points: [{ x: 0.5, y: 0.5 }], xMm: 10, yMm: 10, widthMm: 30, heightMm: 20, angleDeg: 0, rotationDeg: 90 }
    const onChange = vi.fn()
    const { container } = render(<ArcHandles arc={arc} scale={2} onChange={onChange} />)
    const turnedLayer = container.querySelector<HTMLElement>('[data-arc-handles] > div')!
    expect(turnedLayer.style.transform).toBe('rotate(-90deg)')
    expect(turnedLayer.style.transformOrigin).toBe('50px 40px')
    // Right on screen is down the box turned a quarter counterclockwise
    const dot = screen.getByRole('button', { name: 'Move point 1' })
    fireEvent.pointerDown(dot, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(dot, { clientX: 8, clientY: 0, buttons: 1 })
    const moved = onChange.mock.lastCall![0] as ArcEnCiel
    const expected = withSpot(arc, { kind: 'point', index: 0 }, { x: 0.5, y: 0.5 + 4 / 20 })
    expect(moved.points[0].x).toBeCloseTo(expected.points[0].x)
    expect(moved.points[0].y).toBeCloseTo(expected.points[0].y)
    cleanup()

    // The dial turns with the box: its knob at the box's right shows above its middle, and a turn to its left is a quarter more
    const onTurn = vi.fn()
    render(<RidgeDial arc={arc} scale={2} onTurn={onTurn} />)
    const [right] = screen.getAllByRole('button', { name: 'Turn the ridges' })
    fireEvent.pointerDown(right, { button: 0, pointerId: 1, clientX: 50, clientY: 40 - 16.8 })
    fireEvent.pointerMove(right, { clientX: 30, clientY: 40, buttons: 1 })
    expect(onTurn).toHaveBeenLastCalledWith(90)
  })

  it('exports each turned layer turned about its middle, as the canvas shows it, the watermark the other way round on the back', () => {
    const calls: unknown[][] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string]
        : key === 'createLinearGradient' ? () => ({ addColorStop() {} })
        : (...args: unknown[]) => { calls.push([key, ...args]) }),
      set: (target, key, value) => {
        target[key as string] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return ctx }
    })
    const note = { ...layered(), noThread: true as const, arcEnCiel: undefined }
    const light = 'light' as unknown as HTMLCanvasElement
    const assets = { frames: new Map(), relief: { canvas: light } as Relief, ink: { canvas: 'mask' } as unknown as InkMask }
    drawFace(ctx, note, assets, 2, { x: 0, y: 0 }, { sheen: false, perspective: false })
    const turnAbout = (cx: number, cy: number, deg: number) => [['translate', cx, cy], ['rotate', (-deg * Math.PI) / 180], ['translate', -cx, -cy]]
    const at = (call: unknown[]) => calls.findIndex((c) => JSON.stringify(c) === JSON.stringify(call))
    // The watermark's middle is 25 mm in, at 2 px a mm; the light drawn upright in its box once turned
    const watermark = at(turnAbout(50, 50, 30)[1])
    expect(calls.slice(watermark - 1, watermark + 2)).toEqual(turnAbout(50, 50, 30))
    expect(calls.slice(watermark + 2).find((c) => c[0] === 'drawImage')).toEqual(['drawImage', light, 20, 20, 60, 60])
    // Magnetic ink, a quarter round about its middle
    const ink = at(turnAbout(230, 40, 90)[1])
    expect(calls.slice(ink - 1, ink + 2)).toEqual(turnAbout(230, 40, 90))

    // On the back the watermark lies at the other side, turned the other way, then flipped in its box
    calls.length = 0
    drawFace(ctx, { ...note, back: { background: 'solid', color: '#F0EAD6' } }, assets, 2, { x: 0, y: 0 }, { sheen: false, perspective: false, back: true })
    const back = at(turnAbout(250, 50, -30)[1])
    expect(calls.slice(back - 1, back + 2)).toEqual(turnAbout(250, 50, -30))
    expect(calls.slice(back + 2, back + 6)).toEqual([['save'], ['translate', 280, 20], ['scale', -1, 1], ['drawImage', light, 0, 0, 60, 60]])
  })
})
