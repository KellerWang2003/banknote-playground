/**
 * Rotating the banknotes on screen (Keller, 7 November: Rotate left and Rotate right beside Front | Back): every banknote
 * turns a quarter turn in place, about its own middle, as turning over turns it side to side. A way of looking, as turning
 * over is, never saved or undone, and upright again when the project closes. Everything on a banknote turns with it, its
 * thread, watermark, magnetic ink, windows and their measures, while its name stays upright over it. The tilt is still the
 * banknote's own: its ↕ is up and down along the banknote, whichever way it shows, so the lens, the timeline, the tilt pad
 * and playback mean what they meant upright, and a drag on the canvas is turned back to the banknote's own axes, so the
 * banknote tilts the way the pointer goes, as one held turned in the hand would.
 */

/** Quarter turns clockwise, 0 to 3 */
export type Quarter = 0 | 1 | 2 | 3

/** Seconds a quarter turn takes on screen */
export const ROTATE_SECONDS = 0.3

/** Quarter turns counted on in either direction (−1, 5) as 0 to 3 */
export const quarterOf = (turns: number) => (((Math.round(turns) % 4) + 4) % 4) as Quarter

/** Whether a banknote turned `quarter` lies on its side, its width running up and down the screen */
export const onItsSide = (quarter: Quarter) => quarter % 2 === 1

/**
 * A move on screen as it runs on a banknote turned `quarter` quarter turns clockwise: turned back the other way, so a move
 * up the screen is a move towards whichever edge of the banknote shows at the top
 */
export function unturn(x: number, y: number, quarter: Quarter) {
  switch (quarter) {
    case 1: return { x: y, y: -x }
    case 2: return { x: -x, y: -y }
    case 3: return { x: -y, y: x }
    default: return { x, y }
  }
}

interface Box { x: number; y: number; width: number; height: number }

/**
 * The box a banknote covers turned `quarter` quarter turns about its middle: upright or upside down its own, on its side
 * its width and height swapped about the same middle
 */
export function turnedBox<T extends Box>(box: T, quarter: Quarter): Box {
  const { x, y, width, height } = box
  if (!onItsSide(quarter)) return { x, y, width, height }
  return { x: x + (width - height) / 2, y: y + (height - width) / 2, width: height, height: width }
}

/** A banknote's box on the canvas, mm, as it shows turned `quarter` */
export const noteBox = (note: { x: number; y: number; widthMm: number; heightMm: number }, quarter: Quarter) =>
  turnedBox({ x: note.x, y: note.y, width: note.widthMm, height: note.heightMm }, quarter)

/**
 * Where a box on a banknote turned `quarter` shows its top-left corner, as shares of its own width and height from where
 * it lies upright: what stays upright over the banknote, its name, sits there
 */
export function turnedCorner(width: number, height: number, quarter: Quarter) {
  if (!onItsSide(quarter) || width <= 0 || height <= 0) return { x: 0, y: 0 }
  return { x: (width - height) / (2 * width), y: (height - width) / (2 * height) }
}

/**
 * Where a point on screen lies on an element that turns with its banknote, px from the element's own top-left as it lies
 * on the banknote: its box on screen (`rect`, round its turned shape) keeps its middle. `size` is the element's own size,
 * upright; without it, the box's, turned back.
 */
export function unturnedPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width?: number; height?: number },
  quarter: Quarter,
  size?: { width: number; height: number },
) {
  const side = onItsSide(quarter)
  const width = size?.width ?? (side ? rect.height : rect.width) ?? 0
  const height = size?.height ?? (side ? rect.width : rect.height) ?? 0
  // The box on screen, as wide as the element is tall while it lies on its side
  const middle = { x: rect.left + (side ? height : width) / 2, y: rect.top + (side ? width : height) / 2 }
  const at = unturn(clientX - middle.x, clientY - middle.y, quarter)
  return { x: width / 2 + at.x, y: height / 2 + at.y, width, height }
}

/** What an export says it shows, turned: 'rotated 90° right' and so on; nothing upright */
export const ROTATION_NAMES: Record<Quarter, string> = { 0: '', 1: 'rotated 90° right', 2: 'rotated 180°', 3: 'rotated 90° left' }
