import { clamp } from './frames'
import type { Note } from './types'

/**
 * Where a layer placed on its banknote sits (the watermark, magnetic ink; `layers.ts` lists them): a box by its top-left
 * corner in mm from the banknote's top-left, its height following its image's proportions. It may hang off the
 * banknote's edges, where the edge cuts it off, as long as ON_NOTE of it stays on. Typed positions and widths are kept
 * exactly, in any unit; what drags, nudges or places a box snaps to PLACE_STEP itself. Every function keeps the
 * layer's other settings as they are.
 *
 * It may be rotated about its middle (Keller, 9 November: "I can also rotate elements on the banknote"), counterclockwise
 * in degrees as Figma's rotation reads, and as Arc-en-Ciel's ridge angle rises: X, Y and W are still the box before it
 * turned, so turning it moves nothing but itself, and whatever it draws turns with it, its own directions included (magnetic
 * ink's bar, Arc-en-Ciel's ridges).
 */
export interface PlacedBox {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** Degrees it is turned about its middle, counterclockwise, from −180 (left out) to 180; saved only when turned */
  rotationDeg?: number
}

export type Size = Pick<Note, 'widthMm' | 'heightMm'>

/** Drags, nudges and new boxes snap position and width to this, in mm, as windows do */
export const PLACE_STEP = 0.5
/** Smallest width or height, in mm */
export const PLACE_MIN_MM = 2
/**
 * How much of a box always stays on its banknote, as a share of its width and of its height: the rest may hang off the
 * edges, as an image's padding round what it shows may need to (Keller, 3 November: at least an edge on the banknote,
 * free to bleed)
 */
export const ON_NOTE = 0.25

const snap = (value: number) => Math.round(value / PLACE_STEP) * PLACE_STEP
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const positive = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback)
/** A length worked out through a rotation, rounded off past a thousandth of a mm, and −0 as 0 */
const neat = (mm: number) => Math.round(mm * 1000) / 1000 + 0
const RAD = Math.PI / 180

/** An angle as a box's rotation: turned onto (−180, 180], rounded off past a millionth of a degree; 0 for anything else */
export function normalRotation(deg: unknown) {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return 0
  const within = deg - 360 * Math.ceil((deg - 180) / 360)
  return Math.round(within * 1e6) / 1e6 + 0
}

/** How far a box is turned, degrees counterclockwise; 0 when it isn't */
export const rotationOf = (box: Pick<PlacedBox, 'rotationDeg'>) => normalRotation(box.rotationDeg)

/** A turn's cosine and sine, rounded off past 12 places so a quarter or half turn is exactly so */
const turnOf = (radians: number) => ({ cos: Math.round(Math.cos(radians) * 1e12) / 1e12, sin: Math.round(Math.sin(radians) * 1e12) / 1e12 })

/**
 * A step (x, y) along the box's own sides, before it turned, as it runs on the banknote (x right, y down): turned
 * counterclockwise by the box's rotation, as CSS's rotate(−rotation) turns it on screen
 */
export function outOfBox(box: Pick<PlacedBox, 'rotationDeg'>, x: number, y: number) {
  const a = rotationOf(box) * RAD
  if (!a) return { x, y }
  const { cos, sin } = turnOf(a)
  return { x: x * cos + y * sin, y: -x * sin + y * cos }
}

/** A step (x, y) on the banknote as it runs along the box's own sides, before it turned: `outOfBox` the other way */
export function intoBox(box: Pick<PlacedBox, 'rotationDeg'>, x: number, y: number) {
  const a = rotationOf(box) * RAD
  if (!a) return { x, y }
  const { cos, sin } = turnOf(a)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

/** A point on the banknote, mm, where it lies on the box before it turned (about its middle): mm on the banknote, as if it hadn't */
export function pointInBox(box: PlacedBox, xMm: number, yMm: number) {
  if (!rotationOf(box)) return { xMm, yMm }
  const cx = box.xMm + box.widthMm / 2, cy = box.yMm + box.heightMm / 2
  const at = intoBox(box, xMm - cx, yMm - cy)
  return { xMm: cx + at.x, yMm: cy + at.y }
}

/** The box a turned box covers on the banknote, mm: as wide and tall as its corners reach, about the same middle */
export function boxBounds(box: PlacedBox): { x: number; y: number; width: number; height: number } {
  const a = rotationOf(box) * RAD
  if (!a) return { x: box.xMm, y: box.yMm, width: box.widthMm, height: box.heightMm }
  const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a))
  const width = box.widthMm * cos + box.heightMm * sin
  const height = box.widthMm * sin + box.heightMm * cos
  return { x: box.xMm + (box.widthMm - width) / 2, y: box.yMm + (box.heightMm - height) / 2, width, height }
}

/** CSS that turns an element in the box's place about its middle, as it is turned on the banknote; none upright */
export const boxTurn = (box: Pick<PlacedBox, 'rotationDeg'>) => {
  const deg = rotationOf(box)
  return deg ? `rotate(${-deg}deg)` : undefined
}

/** Where a box `size` long can start along a banknote side `length` long: as far off either end as keeps ON_NOTE of it on */
const startRange = (size: number, length: number): [number, number] => [-size * (1 - ON_NOTE), length - size * ON_NOTE]

/** The X and Y a box of this size can take on the banknote, mm, lowest and highest */
export const boxRange = (box: Pick<PlacedBox, 'widthMm' | 'heightMm'>, note: Size) =>
  ({ x: startRange(box.widthMm, note.widthMm), y: startRange(box.heightMm, note.heightMm) })

/**
 * A box kept on its banknote: both sides at least PLACE_MIN_MM and no bigger than the banknote (its proportions kept
 * either way), and at least ON_NOTE of it on the banknote each way, the rest free to hang off. Its position is kept as
 * far as that allows, and its rotation, within (−180, 180], only while it is turned. Also repairs a damaged save. Only
 * the box comes back.
 */
export function fitBox(box: PlacedBox, note: Size): PlacedBox {
  let widthMm = positive(box.widthMm, 20)
  let heightMm = positive(box.heightMm, widthMm)
  const grow = Math.max(1, PLACE_MIN_MM / widthMm, PLACE_MIN_MM / heightMm)
  const shrink = Math.min(1, note.widthMm / (widthMm * grow), note.heightMm / (heightMm * grow))
  widthMm *= grow * shrink
  heightMm *= grow * shrink
  const range = boxRange({ widthMm, heightMm }, note)
  const xMm = clamp(finite(box.xMm, 0), ...range.x)
  const yMm = clamp(finite(box.yMm, 0), ...range.y)
  const rotationDeg = rotationOf(box)
  return rotationDeg ? { xMm, yMm, widthMm, heightMm, rotationDeg } : { xMm, yMm, widthMm, heightMm }
}

/** Whether a box lies wholly on a banknote of this size, turned as it is */
export const isWhollyOn = (box: PlacedBox, note: Size) => {
  const b = boxBounds(box)
  return b.x >= -1e-9 && b.y >= -1e-9 && b.x + b.width <= note.widthMm + 1e-9 && b.y + b.height <= note.heightMm + 1e-9
}

/** The box moved wholly onto the banknote, turned as it is, as near where it was as that allows (it must fit) */
export const onto = <T extends PlacedBox>(box: T, note: Size): T => {
  if (!rotationOf(box)) {
    return { ...box, xMm: clamp(box.xMm, 0, Math.max(0, note.widthMm - box.widthMm)), yMm: clamp(box.yMm, 0, Math.max(0, note.heightMm - box.heightMm)) }
  }
  const b = boxBounds(box)
  const dx = clamp(b.x, 0, Math.max(0, note.widthMm - b.width)) - b.x
  const dy = clamp(b.y, 0, Math.max(0, note.heightMm - b.height)) - b.y
  return { ...box, xMm: neat(box.xMm + dx), yMm: neat(box.yMm + dy) }
}

/** The layer with its box moved to `next`, kept on the banknote, turned as `next` is */
const refit = <T extends PlacedBox>(box: T, next: PlacedBox, note: Size): T => {
  const { rotationDeg: _turned, ...rest } = box
  return { ...rest, ...fitBox(next, note) } as T
}

/**
 * A new, square box `share` of the banknote's short side wide, centred at those shares of its width and height: one
 * place on a landscape banknote, another on a portrait one
 */
export function newBox(note: Size, share: number, at: { landscape: [number, number]; portrait: [number, number] }): PlacedBox {
  const side = Math.max(PLACE_MIN_MM, snap(Math.min(note.widthMm, note.heightMm) * share))
  const [x, y] = note.widthMm >= note.heightMm ? at.landscape : at.portrait
  return fitBox({ xMm: snap(note.widthMm * x - side / 2), yMm: snap(note.heightMm * y - side / 2), widthMm: side, heightMm: side }, note)
}

/** Height ÷ width */
export const boxAspect = (box: Pick<PlacedBox, 'widthMm' | 'heightMm'>) => box.heightMm / box.widthMm || 1

/**
 * How wide a box can grow from a fixed edge at `from` along a banknote side `length` long, towards higher (`towards` 1)
 * or lower (-1) values, still keeping ON_NOTE of it on: unlimited from off the banknote, as growing only brings more on
 */
function growRoom(from: number, length: number, towards: 1 | -1) {
  const on = towards > 0 ? length - from : from
  return from < 0 || from > length ? Infinity : on / ON_NOTE
}

/** The widest a box can be with its top-left corner where it is: no bigger than the banknote, and ON_NOTE of it on */
export const maxBoxWidth = (box: PlacedBox, note: Size) => {
  const aspect = boxAspect(box)
  const room = Math.min(growRoom(box.xMm, note.widthMm, 1), growRoom(box.yMm, note.heightMm, 1) / aspect)
  return Math.max(PLACE_MIN_MM, Math.min(note.widthMm, note.heightMm / aspect, room))
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'
/** One of a box's sides, by the way it faces before it turned: its top, right, bottom or left */
export type Side = 'n' | 'e' | 's' | 'w'
/** Where a drag can resize a box from: one of its corners, or anywhere along one of its sides */
export type Handle = Corner | Side

/**
 * Which way a corner, or the middle of a side, lies from the box's middle along its own sides: right (1), left (−1) or
 * neither (0), and down (1), up (−1) or neither
 */
const handleSigns = (handle: Handle): { sx: -1 | 0 | 1; sy: -1 | 0 | 1 } => ({
  sx: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
  sy: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0,
})

/**
 * A turned box at a new width, its proportions kept and what lies across from `handle` staying where it shows on the
 * banknote, the opposite corner or the middle of the opposite side: from there it grows along its own sides. No bigger
 * than the banknote; kept ON_NOTE on it as every box is
 */
function turnedTo<T extends PlacedBox>(box: T, handle: Handle, widthMm: number, note: Size): T {
  const aspect = boxAspect(box)
  const width = clamp(widthMm, PLACE_MIN_MM, Math.max(PLACE_MIN_MM, Math.min(note.widthMm, note.heightMm / aspect)))
  const height = width * aspect
  const { sx, sy } = handleSigns(handle)
  // What stays put, where it shows, then the new middle half the new size on from it along the box's sides
  const stay = outOfBox(box, (-sx * box.widthMm) / 2, (-sy * box.heightMm) / 2)
  const on = outOfBox(box, (sx * width) / 2, (sy * height) / 2)
  const cx = box.xMm + box.widthMm / 2 + stay.x + on.x
  const cy = box.yMm + box.heightMm / 2 + stay.y + on.y
  return refit(box, { ...box, widthMm: width, heightMm: height, xMm: neat(cx - width / 2), yMm: neat(cy - height / 2) }, note)
}

/**
 * A new width with the same proportions, keeping the top-left corner where it is: on a turned box, the corner that was
 * its top-left before it turned, where it shows
 */
export function resizeBox<T extends PlacedBox>(box: T, widthMm: number, note: Size): T {
  if (rotationOf(box)) return turnedTo(box, 'se', widthMm, note)
  const width = clamp(widthMm, PLACE_MIN_MM, maxBoxWidth(box, note))
  return refit(box, { ...box, widthMm: width, heightMm: width * boxAspect(box) }, note)
}

/**
 * Drags a corner or a side by (dx, dy) mm, keeping the proportions and what lies across from it where it was: the
 * opposite corner, or the opposite side with the box's middle staying where it was along it (Keller, 9 November: a drag
 * on the box's border should resize it as a corner does). From a corner the direction that moved more sets the size,
 * from a side the way it faces. The size snaps to PLACE_STEP and stops at the banknote's size, or where less than
 * ON_NOTE of the box would stay on it. On a turned box the drag runs along its own sides, and what stays put stays where
 * it shows on the banknote.
 */
export function dragBoxHandle<T extends PlacedBox>(box: T, handle: Handle, dx: number, dy: number, note: Size): T {
  const aspect = boxAspect(box)
  const { sx, sy } = handleSigns(handle)
  // The width a pull (along the box's own sides) asks for: the way a side faces, or whichever way a corner went further
  const wanted = (along: { x: number; y: number }) => {
    const byX = box.widthMm + sx * along.x
    const byY = (box.heightMm + sy * along.y) / aspect
    return !sy ? byX : !sx ? byY : Math.abs(byX - box.widthMm) >= Math.abs(byY - box.widthMm) ? byX : byY
  }
  if (rotationOf(box)) return turnedTo(box, handle, snap(wanted(intoBox(box, dx, dy))), note)
  // What stays put each way: the side across from the handle, or the middle where the handle has no side that way
  const fixed = (start: number, size: number, s: number) => (s > 0 ? start : s < 0 ? start + size : start + size / 2)
  const fx = fixed(box.xMm, box.widthMm, sx)
  const fy = fixed(box.yMm, box.heightMm, sy)
  const room = Math.min(note.widthMm, note.heightMm / aspect,
    sx ? growRoom(fx, note.widthMm, sx) : Infinity, sy ? growRoom(fy, note.heightMm, sy) / aspect : Infinity)
  const widthMm = clamp(snap(wanted({ x: dx, y: dy })), Math.min(PLACE_MIN_MM, room), Math.max(PLACE_MIN_MM, room))
  const heightMm = widthMm * aspect
  // Back to the top-left from there: snapped from a side that stays put, as drags are, and about the middle kept exactly
  const from = (at: number, size: number, s: number) => (s > 0 ? snap(at) : s < 0 ? snap(at - size) : neat(at - size / 2))
  return refit(box, { widthMm, heightMm, xMm: from(fx, widthMm, sx), yMm: from(fy, heightMm, sy) }, note)
}

/** Drags a corner by (dx, dy) mm, the opposite corner staying put: `dragBoxHandle` from a corner */
export const dragBoxCorner = <T extends PlacedBox>(box: T, corner: Corner, dx: number, dy: number, note: Size): T =>
  dragBoxHandle(box, corner, dx, dy, note)

/** Moves a box by (dx, dy) mm from where it was, snapped and kept ON_NOTE on the banknote */
export const moveBox = <T extends PlacedBox>(box: T, dx: number, dy: number, note: Size): T =>
  refit(box, { ...box, xMm: snap(box.xMm + dx), yMm: snap(box.yMm + dy) }, note)

/** A new image's proportions (height ÷ width) set the height, keeping the width and the middle where they are */
export function withBoxAspect<T extends PlacedBox>(box: T, aspect: number | undefined, note: Size): T {
  const heightMm = box.widthMm * (aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : box.heightMm / box.widthMm || 1)
  return refit(box, { ...box, heightMm, yMm: snap(box.yMm + (box.heightMm - heightMm) / 2) }, note)
}

/**
 * The same place on a banknote of a new size: its middle at the same share across and down, then fitted; one that sat
 * wholly on the banknote stays wholly on it
 */
export function moveBoxTo<T extends PlacedBox>(box: T, from: Size, to: Size): T {
  const cx = ((box.xMm + box.widthMm / 2) / from.widthMm) * to.widthMm
  const cy = ((box.yMm + box.heightMm / 2) / from.heightMm) * to.heightMm
  const moved = refit(box, { ...box, xMm: snap(cx - box.widthMm / 2), yMm: snap(cy - box.heightMm / 2) }, to)
  return isWhollyOn(box, from) ? refit(moved, onto(moved, to), to) : moved
}
