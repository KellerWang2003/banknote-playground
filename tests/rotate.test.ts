import { afterEach, describe, expect, it } from 'vitest'
import { ROTATION_NAMES, noteBox, onItsSide, quarterOf, turnedBox, turnedCorner, unturn, unturnedPoint, type Quarter } from '../src/lib/rotate'
import { rotateNotes, setTilt, useTilt } from '../src/tilt/tilt'

/** −0 reads as 0, so a move compares as it reads */
const tidy = ({ x, y }: { x: number; y: number }) => ({ x: x + 0, y: y + 0 })

/** A move on a banknote as it shows on screen turned `quarter` quarter turns clockwise (y down, as on screen) */
function turn(x: number, y: number, quarter: Quarter) {
  const angle = (quarter * Math.PI) / 2
  return { x: Math.round(x * Math.cos(angle) - y * Math.sin(angle)), y: Math.round(x * Math.sin(angle) + y * Math.cos(angle)) }
}

afterEach(() => setTilt({ quarterTurns: 0 }))

describe('rotating the banknotes', () => {
  it('counts quarter turns on either way, read as 0 to 3', () => {
    expect([quarterOf(0), quarterOf(1), quarterOf(2), quarterOf(3), quarterOf(4), quarterOf(5)]).toEqual([0, 1, 2, 3, 0, 1])
    expect([quarterOf(-1), quarterOf(-2), quarterOf(-3), quarterOf(-4), quarterOf(-5)]).toEqual([3, 2, 1, 0, 3])
    expect([0, 1, 2, 3].map((q) => onItsSide(q as Quarter))).toEqual([false, true, false, true])
  })

  it('turns right and left from wherever it is, counting on so each turn plays the way it was asked', () => {
    setTilt({ quarterTurns: 0 })
    rotateNotes(1)
    expect(useTilt.getState().quarterTurns).toBe(1)
    rotateNotes(-1)
    rotateNotes(-1)
    // A quarter turn left of upright is three right, but plays as one left
    expect(useTilt.getState().quarterTurns).toBe(-1)
    expect(quarterOf(useTilt.getState().quarterTurns)).toBe(3)
    for (let i = 0; i < 5; i++) rotateNotes(1)
    expect(quarterOf(useTilt.getState().quarterTurns)).toBe(0)
  })

  it('turns a move on screen back to the banknote’s own axes: up the screen is towards whichever edge shows at the top', () => {
    const up = { x: 0, y: -1 }
    // Upright, its top; turned right, its left edge is at the top; upside down, its bottom; turned left, its right edge
    expect(tidy(unturn(up.x, up.y, 0))).toEqual({ x: 0, y: -1 })
    expect(tidy(unturn(up.x, up.y, 1))).toEqual({ x: -1, y: 0 })
    expect(tidy(unturn(up.x, up.y, 2))).toEqual({ x: 0, y: 1 })
    expect(tidy(unturn(up.x, up.y, 3))).toEqual({ x: 1, y: 0 })
    // Turned right, a move to the right of the screen is towards its top
    expect(tidy(unturn(1, 0, 1))).toEqual({ x: 0, y: -1 })
    // Whatever the move, it comes back to the move it was on the banknote
    for (const quarter of [0, 1, 2, 3] as Quarter[]) {
      for (const [x, y] of [[3, 0], [0, 5], [-2, 7], [4, -6]]) {
        const shown = turn(x, y, quarter)
        expect(tidy(unturn(shown.x, shown.y, quarter))).toEqual({ x, y })
      }
    }
  })

  it('covers a box its width and height swapped about the same middle on its side, its own upright or upside down', () => {
    const note = { x: 10, y: 20, widthMm: 150, heightMm: 70 }
    expect(noteBox(note, 0)).toEqual({ x: 10, y: 20, width: 150, height: 70 })
    expect(noteBox(note, 2)).toEqual({ x: 10, y: 20, width: 150, height: 70 })
    for (const quarter of [1, 3] as Quarter[]) {
      const box = noteBox(note, quarter)
      expect(box).toEqual({ x: 50, y: -20, width: 70, height: 150 })
      // The same middle
      expect([box.x + box.width / 2, box.y + box.height / 2]).toEqual([85, 55])
    }
    expect(turnedBox({ x: 0, y: 0, width: 40, height: 40 }, 1)).toEqual({ x: 0, y: 0, width: 40, height: 40 })
  })

  it('puts what stays upright over the banknote, its name, at the top left of the box it shows', () => {
    expect(turnedCorner(150, 70, 0)).toEqual({ x: 0, y: 0 })
    expect(turnedCorner(150, 70, 2)).toEqual({ x: 0, y: 0 })
    // On its side, 70 wide and 150 tall about the same middle: 40 mm in from its own left, 40 mm above its own top
    const corner = turnedCorner(150, 70, 1)
    expect(corner.x * 150).toBeCloseTo(40)
    expect(corner.y * 70).toBeCloseTo(-40)
    expect(turnedCorner(150, 70, 3)).toEqual(corner)
    // Nothing to place on a banknote with no size
    expect(turnedCorner(0, 70, 1)).toEqual({ x: 0, y: 0 })
  })

  it('finds where a point on screen lies on an element turned with its banknote, from the element’s own top left', () => {
    // Upright: simply from its top left
    expect(unturnedPoint(130, 220, { left: 100, top: 200, width: 150, height: 70 }, 0)).toEqual({ x: 30, y: 20, width: 150, height: 70 })
    // Turned right, 150 × 70 shows 70 wide and 150 tall: its own top left is at the top right of that box, and its own top
    // right at the bottom right
    const rect = { left: 100, top: 200, width: 70, height: 150 }
    expect(unturnedPoint(170, 200, rect, 1)).toEqual({ x: 0, y: 0, width: 150, height: 70 })
    expect(unturnedPoint(170, 350, rect, 1)).toEqual({ x: 150, y: 0, width: 150, height: 70 })
    // Turned left, its own top left is at the bottom left
    expect(unturnedPoint(100, 350, rect, 3)).toEqual({ x: 0, y: 0, width: 150, height: 70 })
    // Upside down, at the bottom right
    expect(unturnedPoint(250, 270, { left: 100, top: 200, width: 150, height: 70 }, 2)).toEqual({ x: 0, y: 0, width: 150, height: 70 })
    // Given its own size, the box on screen needs only its corner
    expect(unturnedPoint(170, 350, { left: 100, top: 200 }, 1, { width: 150, height: 70 })).toEqual({ x: 150, y: 0, width: 150, height: 70 })
  })

  it('names the turn for an export, and nothing upright', () => {
    expect(ROTATION_NAMES).toEqual({ 0: '', 1: 'rotated 90° right', 2: 'rotated 180°', 3: 'rotated 90° left' })
  })
})
