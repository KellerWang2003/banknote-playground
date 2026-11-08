import { clamp } from './frames'
import type { Tilt2 } from './lens'
import { type Size, fitBox, newBox, withBoxAspect } from './placed'
import type { ArcEnCiel, ArcFlow, BoxSpot } from './types'

/**
 * Arc-en-Ciel's settings and how it looks at a tilt (the plan of 8 November). Oberthur's feature is an offset line screen
 * in at least three colours, embossed blind by an intaglio plate in register with it: flat, it shows colour bands laid out
 * to follow the motif; tilted across its ridges, the slopes facing the eye win, and as the two slopes of each ridge carry
 * neighbouring colours, one band apart, the bands seem to slide. Its shape is one uploaded image, read as magnetic ink's
 * stencil is (`inkCoverage` in inkMask.ts). The bands start from the shape's edges, holes in it, or points or a line placed
 * on the canvas (`flow`), run through its colours in order and repeat, each Band width wide. How far they slide, and over
 * what tilt, are fixed numbers tuned by eye, as magnetic ink's were, not settings. The canvas and the export both use them;
 * the distance maps Edge and Holes start from are in bandMap.ts, and the drawing on the GPU in inkRenderer.ts.
 */

export const ARC_FLOWS: readonly ArcFlow[] = ['edge', 'holes', 'point', 'line']
/** Colours a design has: three at least (Oberthur's minimum, "an offset raster with a minimum of three colours"), four at most */
export const ARC_COLOURS = { min: 3, max: 4 }
/** Band width, mm */
export const ARC_BAND = { min: 0.3, max: 5, step: 0.1 }
/** The most points Point takes */
export const ARC_POINTS = 8
/** The most points on Line, its two ends included */
export const ARC_LINE_POINTS = 8
/** How far off its box a point or the line can go, in box sizes either way */
export const ARC_REACH = 1
/** Tilt across the ridges, either way, that slides the bands all the way */
export const ARC_SLIDE_DEG = 20
/** How far the bands slide from flat to either end, in bands: half a band each way, one band in all, the most two slopes give */
export const ARC_SLIDE_BANDS = 0.5
/** Each band blends into the next over this share of it at its far end, as two inks' lines meet in a screen */
export const BAND_BLEND = 0.3
/** Bands narrower than this share of a pixel's width start to fade to their colours' average, as they do to the eye */
export const BAND_BLUR = { from: 0.35, to: 1 }
/** The steps each stretch of Line between two of its points is drawn in, on the canvas, in the export and on the GPU */
export const CURVE_STEPS = 16

/** A new Arc-en-Ciel's look: bands from its edge in gold, rose and blue, 1 mm wide, sliding on the up/down tilt */
export const DEFAULT_ARC: Pick<ArcEnCiel, 'flow' | 'points' | 'line' | 'colors' | 'bandMm' | 'axis'> = {
  flow: 'edge',
  points: [{ x: 0.5, y: 0.5 }],
  // Across the level ridges, as bands under level lines would read as plain stripes
  line: [{ x: 0.15, y: 0.75 }, { x: 0.85, y: 0.25 }],
  colors: ['#e0a91b', '#d23a7c', '#3a68d6'],
  bandMm: 1,
  axis: 'y',
}

const HEX = /^#[0-9a-f]{6}$/i
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** A spot kept within ARC_REACH of its box; undefined for a damaged one */
function fitSpot(value: unknown): BoxSpot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { x, y } = value as Record<string, unknown>
  return finite(x) && finite(y) ? { x: clamp(x, -ARC_REACH, 1 + ARC_REACH), y: clamp(y, -ARC_REACH, 1 + ARC_REACH) } : undefined
}

/** Spots kept, `min` to `max` of them, or the default ones when too few are left */
function fitSpots(value: unknown, min: number, max: number, fallback: BoxSpot[]) {
  const kept = (Array.isArray(value) ? value : []).map(fitSpot).filter((s) => s !== undefined).slice(0, max)
  return kept.length >= min ? kept : fallback.map((s) => ({ ...s }))
}

/**
 * Keeps Arc-en-Ciel on its banknote, as every placed layer is kept (`fitBox`), with three or four colours, its band width in
 * range, at least one point and a line with its two ends, all within ARC_REACH of its box. Also repairs a damaged save:
 * colours that aren't #rrggbb are dropped (missing ones come from the defaults), an unknown flow or axis goes back to the
 * default, Invert is kept only when it is on, and anything unknown is dropped.
 */
export function fitArcEnCiel(arc: ArcEnCiel, note: Size): ArcEnCiel {
  const colors = (Array.isArray(arc.colors) ? arc.colors : []).filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, ARC_COLOURS.max)
  const fitted: ArcEnCiel = {
    ...fitBox(arc, note),
    flow: ARC_FLOWS.includes(arc.flow) ? arc.flow : DEFAULT_ARC.flow,
    points: fitSpots(arc.points, 1, ARC_POINTS, DEFAULT_ARC.points),
    line: fitSpots(arc.line, 2, ARC_LINE_POINTS, DEFAULT_ARC.line),
    colors: colors.length >= ARC_COLOURS.min ? colors : [...colors, ...DEFAULT_ARC.colors.slice(colors.length)],
    bandMm: clamp(finite(arc.bandMm) ? arc.bandMm : DEFAULT_ARC.bandMm, ARC_BAND.min, ARC_BAND.max),
    axis: arc.axis === 'x' ? 'x' : 'y',
  }
  if (arc.invert === true) fitted.invert = true
  return typeof arc.imageId === 'string' ? { imageId: arc.imageId, ...fitted } : fitted
}

/**
 * New Arc-en-Ciel, without an image yet: a square about 15 mm across on a banknote of the usual size, low and right of the
 * middle, clear of a new watermark, magnetic ink and a thread down the middle (on a portrait banknote, high on the left)
 */
export const newArcEnCiel = (note: Size): ArcEnCiel =>
  fitArcEnCiel({ ...newBox(note, 0.22, { landscape: [0.6, 0.72], portrait: [0.25, 0.3] }), ...DEFAULT_ARC }, note)

/** A new image: its proportions set the height, keeping the width and the middle where they are */
export const withArcImage = (arc: ArcEnCiel, imageId: string, aspect: number | undefined, note: Size): ArcEnCiel =>
  fitArcEnCiel({ ...withBoxAspect(arc, aspect, note), imageId }, note)

/**
 * How far the bands have slid at a tilt, in bands: none flat, up to ARC_SLIDE_BANDS by ARC_SLIDE_DEG across the ridges,
 * away from where the bands start as the top tilts away (↕) or the right side turns away (↔), back towards it the other way.
 * Tilting along the ridges changes nothing.
 */
export const bandSlide = (arc: Pick<ArcEnCiel, 'axis'>, tilt: Tilt2) =>
  clamp((arc.axis === 'x' ? tilt.x : tilt.y) / ARC_SLIDE_DEG, -1, 1) * ARC_SLIDE_BANDS || 0

/** A colour as red, green and blue in linear light, 0 to 1, where colours mix as light does */
export type Rgb = [number, number, number]

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** A #rrggbb colour in linear light */
export const linearRgb = (hex: string): Rgb => [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as Rgb

/** A colour in linear light as 0 to 255 sRGB channels */
export const srgbBytes = (rgb: Rgb): Rgb => rgb.map((c) => Math.round(toSrgb(clamp(c, 0, 1)) * 255)) as Rgb

const smooth = (t: number) => t * t * (3 - 2 * t)

/** The average of some colours, which bands too fine to see fade to */
export const averageRgb = (colours: Rgb[]): Rgb =>
  [0, 1, 2].map((k) => colours.reduce((sum, c) => sum + c[k], 0) / colours.length) as Rgb

/**
 * The colour, in linear light, `phase` bands from where the bands start: they run through the colours in order and
 * repeat, each blending into the next over its last BAND_BLEND. `blur` is a pixel's width in bands: bands too fine for
 * the pixels fade to the colours' average instead of flickering. The GPU draws the same (inkRenderer.ts).
 */
export function bandColour(colours: Rgb[], phase: number, blur = 0, average = averageRgb(colours)): Rgb {
  const n = colours.length
  const f = phase - n * Math.floor(phase / n)
  const i = Math.min(n - 1, Math.floor(f))
  const b = smooth(clamp((f - i - (1 - BAND_BLEND)) / BAND_BLEND, 0, 1))
  const from = colours[i]
  const to = colours[(i + 1) % n]
  const fade = smooth(clamp((blur - BAND_BLUR.from) / (BAND_BLUR.to - BAND_BLUR.from), 0, 1))
  return [0, 1, 2].map((k) => {
    const c = from[k] + (to[k] - from[k]) * b
    return c + (average[k] - c) * fade
  }) as Rgb
}

/** A point in mm from the top-left corner of the layer's box */
export type MmPoint = [number, number]

/** A spot on the box in mm from its top-left corner */
export const spotMm = (spot: BoxSpot, box: Pick<ArcEnCiel, 'widthMm' | 'heightMm'>): MmPoint => [spot.x * box.widthMm, spot.y * box.heightMm]

/** A point in mm from the box's top-left corner as a spot on it */
export const mmSpot = ([x, y]: MmPoint, box: Pick<ArcEnCiel, 'widthMm' | 'heightMm'>): BoxSpot => fitSpot({ x: x / box.widthMm, y: y / box.heightMm })!

/**
 * Line's control points in mm: its points with one more at each end, as far past it as the next one is before it, so the
 * curve through them runs straight on out of its ends. A line of two points is straight.
 */
export function curveControls(arc: Pick<ArcEnCiel, 'line' | 'widthMm' | 'heightMm'>): MmPoint[] {
  const points = arc.line.map((spot) => spotMm(spot, arc))
  const n = points.length
  const past = (end: MmPoint, next: MmPoint): MmPoint => [2 * end[0] - next[0], 2 * end[1] - next[1]]
  return [past(points[0], points[1]), ...points, past(points[n - 1], points[n - 2])]
}

/**
 * Line as drawn from its controls (`curveControls`): a smooth curve through its points (a Catmull-Rom spline), CURVE_STEPS
 * straight steps between each two, in mm from the box's top-left corner. Each step knows which stretch of the line it is on.
 */
export function sampleCurve(c: MmPoint[]): { points: MmPoint[]; stretch: number[] } {
  const points: MmPoint[] = [c[1]]
  const stretch: number[] = []
  for (let s = 0; s + 3 < c.length; s++) {
    const [p0, p1, p2, p3] = [c[s], c[s + 1], c[s + 2], c[s + 3]]
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS
      points.push([0, 1].map((a) => p1[a] + 0.5 * ((p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t * t
        + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t * t * t)) as MmPoint)
      stretch.push(s)
    }
  }
  return { points, stretch }
}

/** Line as drawn, in mm from the box's top-left corner */
export const curvePoints = (arc: Pick<ArcEnCiel, 'line' | 'widthMm' | 'heightMm'>) => sampleCurve(curveControls(arc))

/** How far a point is from the nearest of some starts, mm: rings round each, meeting between them */
export function pointsDistance(starts: MmPoint[], [x, y]: MmPoint) {
  let best = Infinity
  for (const [px, py] of starts) best = Math.min(best, Math.hypot(x - px, y - py))
  return best
}

/**
 * How far a point is from Line, mm, + on one side and − on the other, so the bands carry on across it in order. Its two
 * ends run on straight past its points (the first and last steps go on for ever), so the bands are straight beyond them.
 * The GPU works it out the same way. Also says which step is nearest.
 */
export function lineDistance(curve: MmPoint[], [x, y]: MmPoint) {
  let best = Infinity
  let side = 1
  let step = 0
  const last = curve.length - 2
  for (let i = 0; i <= last; i++) {
    const [ax, ay] = curve[i]
    const [bx, by] = curve[i + 1]
    const vx = bx - ax, vy = by - ay
    const wx = x - ax, wy = y - ay
    let t = (wx * vx + wy * vy) / Math.max(vx * vx + vy * vy, 1e-12)
    if (i > 0) t = Math.max(t, 0)
    if (i < last) t = Math.min(t, 1)
    const d = Math.hypot(wx - t * vx, wy - t * vy)
    if (d < best) {
      best = d
      side = vx * wy - vy * wx < 0 ? -1 : 1
      step = i
    }
  }
  return { distance: best * side, step }
}

/** The points with one more at `spot`, unless it has as many as it can take */
export const withPoint = (arc: ArcEnCiel, spot: BoxSpot): ArcEnCiel =>
  arc.points.length >= ARC_POINTS ? arc : { ...arc, points: [...arc.points, fitSpot(spot)!] }

/**
 * Line bent with one more point at `spot`, between the two points of the stretch nearest it, unless it has as many as it
 * can take. Also says where in the line the new point went, or −1.
 */
export function withBend(arc: ArcEnCiel, spot: BoxSpot): { arc: ArcEnCiel; index: number } {
  if (arc.line.length >= ARC_LINE_POINTS) return { arc, index: -1 }
  const { points, stretch } = curvePoints(arc)
  const at = lineDistance(points, spotMm(spot, arc)).step
  const index = (stretch[at] ?? 0) + 1
  return { arc: { ...arc, line: [...arc.line.slice(0, index), fitSpot(spot)!, ...arc.line.slice(index)] }, index }
}

/** Line as it was (`from`) moved (dx, dy) mm as one, as far as all its points stay within ARC_REACH of the box */
export function withLineMoved(arc: ArcEnCiel, from: BoxSpot[], dx: number, dy: number): ArcEnCiel {
  const xs = from.map((s) => s.x)
  const ys = from.map((s) => s.y)
  const x = clamp(dx / arc.widthMm, -ARC_REACH - Math.min(...xs), 1 + ARC_REACH - Math.max(...xs))
  const y = clamp(dy / arc.heightMm, -ARC_REACH - Math.min(...ys), 1 + ARC_REACH - Math.max(...ys))
  return { ...arc, line: from.map((s) => ({ x: s.x + x, y: s.y + y })) }
}

/** Which of the layer's spots a handle is: one of Point's starts, or one of Line's points */
export type ArcHandle = { kind: 'point' | 'line'; index: number }

/** The spot a handle sits on */
export const handleSpot = (arc: ArcEnCiel, handle: ArcHandle) => (handle.kind === 'point' ? arc.points : arc.line)[handle.index]

/** The layer with a handle's spot moved to `spot` */
export function withSpot(arc: ArcEnCiel, handle: ArcHandle, spot: BoxSpot): ArcEnCiel {
  const fitted = fitSpot(spot)!
  const list = (handle.kind === 'point' ? arc.points : arc.line).map((s, i) => (i === handle.index ? fitted : s))
  return handle.kind === 'point' ? { ...arc, points: list } : { ...arc, line: list }
}

/** Whether a handle's spot can be taken out: one of several points, or a point bending Line (its ends stay) */
export const canRemove = (arc: ArcEnCiel, handle: ArcHandle) =>
  handle.kind === 'point' ? arc.points.length > 1 : handle.index > 0 && handle.index < arc.line.length - 1

/** The layer without a handle's spot, where it can be taken out */
export function withoutSpot(arc: ArcEnCiel, handle: ArcHandle): ArcEnCiel {
  if (!canRemove(arc, handle)) return arc
  const list = (handle.kind === 'point' ? arc.points : arc.line).filter((_, i) => i !== handle.index)
  return handle.kind === 'point' ? { ...arc, points: list } : { ...arc, line: list }
}
