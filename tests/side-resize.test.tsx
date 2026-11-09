// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImagePlacer } from '../src/editor/ImagePlacer'
import { PlacingBox, SIDE_ZONE_PX } from '../src/editor/PlacingBox'
import { createNote } from '../src/lib/notes'
import { type PlacedBox, type Side, dragBoxCorner, dragBoxHandle, outOfBox } from '../src/lib/placed'

// Keller, 9 November: "resizing things is broken if I try to resize by dragging the border. The corner works"

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
})

const plain = () => createNote({ name: 'Banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#112233' })
const near = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
}
/** Where the middle of a box's side shows on the banknote, turned with it */
const sideAt = (box: PlacedBox, side: Side) => {
  const sx = side === 'e' ? 1 : side === 'w' ? -1 : 0
  const sy = side === 's' ? 1 : side === 'n' ? -1 : 0
  const on = outOfBox(box, (sx * box.widthMm) / 2, (sy * box.heightMm) / 2)
  return { x: box.xMm + box.widthMm / 2 + on.x, y: box.yMm + box.heightMm / 2 + on.y }
}
const press = { button: 0, buttons: 1, pointerId: 1 }

describe('a placed box resized from a side', () => {
  it('keeps its proportions, the side across from it staying put and its middle along that side kept', () => {
    const note = plain()
    const box = { xMm: 40, yMm: 30, widthMm: 20, heightMm: 10 }
    // 4 mm out from its right side: 24 wide and 12 tall, from its left side, its middle still 35 mm down
    expect(dragBoxHandle(box, 'e', 4, 3, note)).toEqual({ xMm: 40, yMm: 29, widthMm: 24, heightMm: 12 })
    expect(dragBoxHandle(box, 'w', -4, 0, note)).toEqual({ xMm: 36, yMm: 29, widthMm: 24, heightMm: 12 })
    // 2 mm out from its bottom: 12 tall and 24 wide, from its top, its middle still 50 mm across
    expect(dragBoxHandle(box, 's', 0, 2, note)).toEqual({ xMm: 38, yMm: 30, widthMm: 24, heightMm: 12 })
    expect(dragBoxHandle(box, 'n', 5, -2, note)).toEqual({ xMm: 38, yMm: 28, widthMm: 24, heightMm: 12 })
    // Along a side, the way it doesn't face, nothing changes; in, it shrinks, its middle kept exactly
    expect(dragBoxHandle(box, 'e', 0, 6, note)).toEqual(box)
    expect(dragBoxHandle(box, 'n', 6, 0, note)).toEqual(box)
    expect(dragBoxHandle(box, 'e', -9, 0, note)).toEqual({ xMm: 40, yMm: 32.25, widthMm: 11, heightMm: 5.5 })
    // No bigger than the banknote, 70 mm tall here, and no further than keeps a quarter of it on
    expect(dragBoxHandle(box, 'e', 500, 0, note)).toEqual({ xMm: 40, yMm: 0, widthMm: 140, heightMm: 70 })
    expect(dragBoxHandle({ ...box, xMm: 10 }, 'w', -500, 0, note)).toEqual({ xMm: -90, yMm: 5, widthMm: 120, heightMm: 60 })
    // Corners resize as they did, whichever way they went further
    expect(dragBoxCorner(box, 'se', 4, 0, note)).toEqual({ xMm: 40, yMm: 30, widthMm: 24, heightMm: 12 })
    expect(dragBoxHandle(box, 'nw', -4, -1, note)).toEqual({ xMm: 36, yMm: 28, widthMm: 24, heightMm: 12 })
  })

  it('turned, runs along its own sides, the middle of the side across from it staying where it shows', () => {
    const note = plain()
    const box = { xMm: 40, yMm: 30, widthMm: 20, heightMm: 10, rotationDeg: 30 }
    // 4 mm out along its own right, and 3 along its side, which changes nothing
    const out = outOfBox(box, 4, 3)
    const wider = dragBoxHandle(box, 'e', out.x, out.y, note)
    expect([wider.widthMm, wider.heightMm, wider.rotationDeg]).toEqual([24, 12, 30])
    near(sideAt(wider, 'w'), sideAt(box, 'w'), 2)
    const up = outOfBox(box, 1, -2)
    const taller = dragBoxHandle(box, 'n', up.x, up.y, note)
    expect([taller.widthMm, taller.heightMm, taller.rotationDeg]).toEqual([24, 12, 30])
    near(sideAt(taller, 's'), sideAt(box, 's'), 2)
  })
})

describe('the placing box', () => {
  it('resizes from anywhere along its border, with a resize cursor straight out from each side, and still moves from its middle', () => {
    const note = plain()
    const box = { xMm: 10, yMm: 10, widthMm: 30, heightMm: 20 }
    const onChange = vi.fn()
    const { container, rerender } = render(<PlacingBox note={note} layer="watermark" box={box} scale={2} onChange={onChange} />)
    const side = (s: Side) => container.querySelector<HTMLElement>(`[data-side="${s}"]`)!
    // Along each whole side, 5 px out past its border and 5 in
    expect([side('e').style.right, side('e').style.width, side('e').style.top, side('e').style.bottom])
      .toEqual([`-${SIDE_ZONE_PX}px`, `${2 * SIDE_ZONE_PX}px`, '0px', '0px'])
    expect(side('n').style.cursor).toBe('ns-resize')
    expect(side('e').style.cursor).toBe('ew-resize')

    // Its right side 6 mm (12 px) further right: 36 mm wide and 24 tall, its left side and its middle down it kept
    fireEvent.pointerDown(side('e'), { ...press, clientX: 60, clientY: 20 })
    fireEvent.pointerMove(side('e'), { ...press, clientX: 72, clientY: 30 })
    expect(onChange).toHaveBeenLastCalledWith({ xMm: 10, yMm: 8, widthMm: 36, heightMm: 24 })
    fireEvent.pointerUp(side('e'), { ...press, clientX: 72, clientY: 30 })
    // Its top 4 mm up: 24 tall and 36 wide, from its bottom, its middle across kept
    fireEvent.pointerDown(side('n'), { ...press, clientX: 30, clientY: 0 })
    fireEvent.pointerMove(side('n'), { ...press, clientX: 30, clientY: -8 })
    expect(onChange).toHaveBeenLastCalledWith({ xMm: 7, yMm: 6, widthMm: 36, heightMm: 24 })
    fireEvent.pointerUp(side('n'), { ...press, clientX: 30, clientY: -8 })
    // Away from its border it moves
    const group = screen.getByRole('group', { name: 'Place watermark' })
    fireEvent.pointerDown(group, { ...press, clientX: 30, clientY: 20 })
    fireEvent.pointerMove(group, { ...press, clientX: 34, clientY: 20 })
    expect(onChange).toHaveBeenLastCalledWith({ xMm: 12, yMm: 10, widthMm: 30, heightMm: 20 })
    fireEvent.pointerUp(group, { ...press, clientX: 34, clientY: 20 })

    // On the back, the side showing on the right is the front's left one: dragged right there, the front's box grows leftwards
    rerender(<PlacingBox note={note} layer="watermark" box={box} scale={2} mirror onChange={onChange} />)
    fireEvent.pointerDown(side('e'), { ...press, clientX: 60, clientY: 20 })
    fireEvent.pointerMove(side('e'), { ...press, clientX: 72, clientY: 20 })
    expect(onChange).toHaveBeenLastCalledWith({ xMm: 4, yMm: 8, widthMm: 36, heightMm: 24 })
    fireEvent.pointerUp(side('e'), { ...press, clientX: 72, clientY: 20 })

    // Turned a quarter, its right side shows at the top: dragged up, it grows from its left, the side across
    const turned = { ...box, rotationDeg: 90 }
    rerender(<PlacingBox note={note} layer="watermark" box={turned} scale={2} onChange={onChange} />)
    expect(side('e').style.cursor).toBe('ns-resize')
    expect(side('n').style.cursor).toBe('ew-resize')
    fireEvent.pointerDown(side('e'), { ...press, clientX: 30, clientY: 0 })
    fireEvent.pointerMove(side('e'), { ...press, clientX: 30, clientY: -12 })
    const grown = onChange.mock.lastCall![0] as PlacedBox
    expect([grown.widthMm, grown.heightMm, grown.rotationDeg]).toEqual([36, 24, 90])
    near(sideAt(grown, 'w'), sideAt(turned, 'w'), 2)
    fireEvent.pointerUp(side('e'), { ...press, clientX: 30, clientY: -12 })
    // and half way between, the cursors go diagonal
    rerender(<PlacingBox note={note} layer="watermark" box={{ ...box, rotationDeg: 45 }} scale={2} onChange={onChange} />)
    expect(side('e').style.cursor).toBe('nesw-resize')
    expect(side('n').style.cursor).toBe('nwse-resize')

    // A small box keeps its middle to move it by: inside it, a side takes at most a quarter of it
    rerender(<PlacingBox note={note} layer="watermark" box={{ ...box, widthMm: 6, heightMm: 4 }} scale={2} onChange={onChange} />)
    expect(side('e').style.width).toBe(`${SIDE_ZONE_PX + 3}px`)
    expect(side('n').style.height).toBe(`${SIDE_ZONE_PX + 2}px`)
  })

  it("takes no double-click on its border for one of Arc-en-Ciel's points", () => {
    const onDoubleClick = vi.fn()
    const { container } = render(<PlacingBox note={plain()} layer="arcEnCiel" box={{ xMm: 10, yMm: 10, widthMm: 30, heightMm: 20 }}
      scale={2} onChange={() => {}} onDoubleClick={onDoubleClick} />)
    fireEvent.doubleClick(container.querySelector('[data-side="s"]')!)
    expect(onDoubleClick).not.toHaveBeenCalled()
  })
})

describe("Thread Studio's image box", () => {
  it('resizes from anywhere along its border once picked, its proportions kept and the side across from it staying put', () => {
    const onChange = vi.fn()
    const props = {
      box: { x: 0, y: 4, width: 4, height: 2 }, others: [], aspect: 0.5, scale: 10, onPick: () => {}, onChange, onDone: () => {},
      pointAt: (e: { clientX: number; clientY: number }) => ({ x: e.clientX / 10, y: e.clientY / 10 }),
    }
    const { container, rerender } = render(<ImagePlacer {...props} picked={false} />)
    expect(container.querySelector('[data-side]')).toBeNull()
    rerender(<ImagePlacer {...props} picked />)
    const side = (s: Side) => container.querySelector<HTMLElement>(`[data-side="${s}"]`)!
    expect(side('s').className).toContain('cursor-ns-resize')
    expect(side('w').className).toContain('cursor-ew-resize')

    // Its bottom 1 mm lower: 3 mm tall and 6 wide, from its top, its middle across kept
    fireEvent.pointerDown(side('s'), { ...press, clientX: 20, clientY: 60 })
    fireEvent.pointerMove(side('s'), { ...press, clientX: 25, clientY: 70 })
    expect(onChange).toHaveBeenLastCalledWith({ x: -1, y: 4, width: 6, height: 3 })
    fireEvent.pointerUp(side('s'), { ...press, clientX: 25, clientY: 70 })
    // Its left side 1 mm further left: 5 mm wide, from its right side
    fireEvent.pointerDown(side('w'), { ...press, clientX: 0, clientY: 50 })
    fireEvent.pointerMove(side('w'), { ...press, clientX: -10, clientY: 50 })
    expect(onChange).toHaveBeenLastCalledWith({ x: -1, y: 3.75, width: 5, height: 2.5 })
  })
})
