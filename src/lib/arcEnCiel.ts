import { PAPER } from './back'
import { clamp } from './frames'
import { keptName } from './layerName'
import type { Tilt2 } from './lens'
import { type Size, fitBox, newBox, rotationOf, withBoxAspect } from './placed'
import { LAMP_HEIGHT_DEG, tiltMatrix, withBoxRotation } from './realisticInk'
import { type Quarter, unturn } from './rotate'
import type { ArcEnCiel, ArcFlow, BoxSpot } from './types'

/**
 * Arc-en-Ciel's settings and how it looks at a tilt (the plan of 8 November). Oberthur's feature is an offset line screen
 * in at least three colours, embossed blind by an intaglio plate in register with it: flat, it shows colour bands laid out
 * to follow the motif; tilted across its ridges, the slopes facing the eye win, and as the two slopes of each ridge carry
 * neighbouring colours, one band apart, the bands seem to slide. Its shape is one uploaded image, read as magnetic ink's
 * stencil is (`inkCoverage` in inkMask.ts). The bands start from the shape's edges, holes in it, or points or a line placed
 * on the canvas (`flow`), run through its colours in order and repeat, each Band width wide. The ridges run at any angle
 * (`angleDeg`), and the tilt across them slides the bands. How far they slide, and over what tilt, are fixed numbers tuned
 * by eye, as magnetic ink's were, not settings. With Realistic on (Keller, 8 November: a realistic mode for it too) it is
 * drawn as the ridges themselves instead, in magnetic ink's lamp (`arcLight`), printed as Oberthur's brochure shows it. An
 * edge of bare paper can go round the shape, as wide as the designer sets (`edgeMm`), or in a colour they pick
 * (`edgeColor`), embossed with the ridges with Realistic on. The canvas and the export both use them; the distance maps
 * Edge and Holes start from, rounded deeper in, and the one the edge is drawn from, are in bandMap.ts, and the drawing on
 * the GPU in inkRenderer.ts.
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
/** The ridges' angle from the banknote's horizontal, degrees: level at 0, rising to the right up to upright at 90 */
export const ARC_ANGLE = { min: -90, max: 90 }
/** How wide the white edge round the shape is, mm, and how wide when it is first switched on (Oberthur's brochure's) */
export const ARC_EDGE = { min: 0.5, max: 3, step: 0.1, initial: 1 }
/** The colour of the edge round the shape: the one picked for it, or the paper's own, bare paper, as it starts */
export const edgeColorOf = (arc: Pick<ArcEnCiel, 'edgeColor'>) => arc.edgeColor ?? PAPER
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

/** A new Arc-en-Ciel's look: bands from its edge in gold, rose and blue, 1 mm wide, under level ridges (sliding on the up/down tilt) */
export const DEFAULT_ARC: Pick<ArcEnCiel, 'flow' | 'points' | 'line' | 'colors' | 'bandMm' | 'angleDeg'> = {
  flow: 'edge',
  points: [{ x: 0.5, y: 0.5 }],
  // Across the level ridges, as bands under level lines would read as plain stripes
  line: [{ x: 0.15, y: 0.75 }, { x: 0.85, y: 0.25 }],
  colors: ['#e0a91b', '#d23a7c', '#3a68d6'],
  bandMm: 1,
  angleDeg: 0,
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
 * The ridges' angle within ARC_ANGLE: one past it turned half a turn, as ridges at 100° are those at −80°. Ridges at 90° and
 * −90° are the same, but the tilt that slides the bands outward is the other way round, so both are kept
 */
export function ridgeAngle(deg: number) {
  if (!finite(deg)) return DEFAULT_ARC.angleDeg
  const within = deg >= ARC_ANGLE.min && deg <= ARC_ANGLE.max ? deg : deg - 180 * Math.floor((deg - ARC_ANGLE.min) / 180)
  return within + 0
}

/**
 * Across the ridges, on the banknote (x right, y down, a unit step): down the banknote across level ones, as tipping the
 * top away shows the slopes facing down, turning with the ridges, so left across upright ones at −90° and right at 90°.
 * The tilt that moves the eye this way slides the bands outward (`bandSlide`)
 */
export function ridgeAcross(arc: Pick<ArcEnCiel, 'angleDeg'>): [number, number] {
  const a = (arc.angleDeg * Math.PI) / 180
  // Rounded off, so level and upright ridges are exactly so
  return [Math.round(Math.sin(a) * 1e12) / 1e12 + 0, Math.round(Math.cos(a) * 1e12) / 1e12 + 0]
}

/**
 * Keeps Arc-en-Ciel on its banknote, as every placed layer is kept (`fitBox`), with three or four colours, its band width in
 * range, at least one point and a line with its two ends, all within ARC_REACH of its box, its ridges' angle within
 * ARC_ANGLE, and its white edge, when it has one, within ARC_EDGE. Also repairs a damaged save: colours that aren't #rrggbb
 * are dropped (missing ones come from the defaults), an unknown flow goes back to the default, Invert is kept only when it
 * is on, a white edge only when it is a number, its colour only with it and when it is #rrggbb, and anything unknown is
 * dropped, Realistic included, which older saves kept on Arc-en-Ciel (it is the canvas's own switch now,
 * `src/lib/realistic.ts`). A save from before the angle (8 November) had Moves on's ↕ or ↔ (`axis`), read as level or
 * upright ridges sliding the same way (0° or −90°).
 */
export function fitArcEnCiel(arc: ArcEnCiel, note: Size): ArcEnCiel {
  const colors = (Array.isArray(arc.colors) ? arc.colors : []).filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, ARC_COLOURS.max)
  const edge = finite(arc.edgeMm) ? { edgeMm: clamp(arc.edgeMm, ARC_EDGE.min, ARC_EDGE.max) } : undefined
  const fitted: ArcEnCiel = {
    ...keptName(arc.name),
    ...fitBox(arc, note),
    flow: ARC_FLOWS.includes(arc.flow) ? arc.flow : DEFAULT_ARC.flow,
    points: fitSpots(arc.points, 1, ARC_POINTS, DEFAULT_ARC.points),
    line: fitSpots(arc.line, 2, ARC_LINE_POINTS, DEFAULT_ARC.line),
    colors: colors.length >= ARC_COLOURS.min ? colors : [...colors, ...DEFAULT_ARC.colors.slice(colors.length)],
    bandMm: clamp(finite(arc.bandMm) ? arc.bandMm : DEFAULT_ARC.bandMm, ARC_BAND.min, ARC_BAND.max),
    angleDeg: finite(arc.angleDeg) ? ridgeAngle(arc.angleDeg) : (arc as { axis?: unknown }).axis === 'x' ? -90 : DEFAULT_ARC.angleDeg,
    ...edge,
    ...(edge && typeof arc.edgeColor === 'string' && HEX.test(arc.edgeColor) ? { edgeColor: arc.edgeColor } : {}),
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
 * away from where the bands start as the tilt moves the eye across them (`ridgeAcross`: under level ridges as the top
 * tips away, under upright ones at −90° as the right side turns away), back towards it the other way. Tilting along the
 * ridges changes nothing. Rotated on its banknote, its ridges turn with it, so they lie at their angle plus its rotation.
 */
export function bandSlide(arc: Pick<ArcEnCiel, 'angleDeg' | 'rotationDeg'>, tilt: Tilt2) {
  const [x, y] = ridgeAcross({ angleDeg: arc.angleDeg + rotationOf(arc) })
  // The tilt across the ridges, degrees: the eye moves left on the banknote as its right side turns away, and down it as
  // the top tips away, so level ridges go by the up/down tilt alone and upright ones by the side to side, as Moves on did
  const across = -tilt.x * x + tilt.y * y
  return clamp(across / ARC_SLIDE_DEG, -1, 1) * ARC_SLIDE_BANDS || 0
}

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

/*
 * Realistic: the ridges themselves, printed as Oberthur's brochure shows its own (Keller, 9 November: Realistic still looked
 * off beside it; he picked this of three looks drawn with the numpy model). The intaglio plate embosses ridges at the
 * layer's angle ARC_RIDGE_MM apart, in register with the print, and every ridge carries all the colours as fine lines, one
 * each, in order, shifted across the ridge by a line for every band the design moves on: flat, every ridge shows them all,
 * so the design nearly hides and only bows the lines; tilted across the ridges, the slopes facing the eye take more of
 * each ridge, until by ARC_SLIDE_DEG only they show, each half the lines, and the design comes out as soft rings of mixed
 * colours, the other half of them tilted the other way. The ridges are round, steepest down in a groove and flat along the
 * crest, and shaded by how they face magnetic ink's lamp, LAMP_HEIGHT_DEG above the eye, staying where it is as the
 * banknote is rotated, in a room that lights them a little more from all round than the lamp does, so the light is soft,
 * as it is indoors (Keller, 9 November: real light isn't direct, and the lamp cast shadows too harsh): a ridge seen flat
 * averages as much light as flat paper (nothing else on the banknote is lit), so the slope facing the lamp is a little
 * brighter than paper and the other a little darker, with a faint shadow down each groove and a soft, broad sheen,
 * strongest on the crests with the top tipped back by half LAMP_HEIGHT_DEG. The print is ink on paper rather than exact
 * (`ARC_PRINT`; Keller, 9 November: the first look was "too precise and too computer"): each line spreads a little into
 * the next, along a slightly ragged edge, the print sits a little out of register with the ridges, which wander a
 * little, the ink is a little uneven and dull, and the paper is grainy and a little cockled. The white edge round the
 * shape, when it has one (`edgeMm`), is bare paper, or the colour picked for it (`edgeColor`), embossed with the same
 * ridges and lit the same way (inkRenderer.ts).
 * The numbers are tuned by eye on stills from a numpy model, as magnetic ink's were (8 November; on 9 November Keller
 * picked the deepest of three softer reliefs, then the softer of two lights), and are not settings.
 */

/** How far apart the ridges are, mm: 0.4 until Oberthur says how fine their plates emboss */
export const ARC_RIDGE_MM = 0.4
/** How steep the ridges are at the bottom of a groove, degrees, rounding over to a flat crest, for how they catch the light */
export const ARC_RIDGE_SLOPE_DEG = 52
/**
 * The room's light, the lamp's, and how far the lamp's light wraps round a slope turning away from it: more of the room's
 * than the lamp's, wrapping far, as soft light does
 */
export const ARC_LIGHT = { room: 0.55, lamp: 0.45, wrap: 0.6 }
/** The grooves between ridges: how much darker at the bottom, and how wide their shadow, as a share of a ridge either side */
export const ARC_GROOVE = { dark: 0.2, width: 0.14 }
/** The lamp's sheen off each ridge: how bright, and how broad (the power of its fall-off, lower being broader) */
export const ARC_SHEEN = { strength: 0.07, power: 10 }
/**
 * The print as ink on paper. Each unevenness is smooth noise over the paper on a grid `scale` mm apart (`scales`: two
 * sizes at once, the second weaker); what is finer than a pixel fades out, as the eye averages it
 */
export const ARC_PRINT = {
  /** How far, mm, each printed line's colour spreads into the next where they meet */
  spread: 0.022,
  /** How ragged, mm, the edges they meet along are */
  ragged: { mm: 0.006, scale: 0.035 },
  /** How far the print is out of register with the ridges, as a share of a ridge */
  register: { ridges: 0.06, scale: 3.5 },
  /** How far the ridges wander off straight, mm */
  wander: { mm: 0.02, scale: 1.3 },
  /** How much thinner the ink is at its thinnest, showing the paper through */
  uneven: { amount: 0.03, scales: [0.7, 0.16] },
  /** How far the ink is dulled towards a darker grey of the paper */
  dull: 0.05,
  /** How far the paper's grain tilts its surface, radians */
  grain: { tilt: 0.04, scales: [0.05, 0.09] },
  /** How far the sheet is cockled, degrees */
  cockle: { deg: 1.5, scale: 7 },
} as const
/**
 * How much rounder rings get deeper in, from where the bands start (Edge and Holes): a ring's corners round off over about
 * this share of how far in it is, so rings near the edge follow it and deeper ones turn smooth, as the brochure's do,
 * where the exact distance met in sharp corners and a seam (bandMap.ts's `roundedField`)
 */
export const ARC_ROUNDING = 0.55
/** The paper the ink thins to, linear RGB */
export const ARC_PAPER = linearRgb(PAPER)
/** Pixels wider than `from` of a ridge start to show the ridges' average, and from `to` show only it, as the eye sees ridges too fine to tell apart */
export const ARC_RIDGE_FADE = { from: 0.3, to: 0.6 }
/** Spots across each pixel the ridges are drawn from where they are wide enough to see */
export const ARC_RIDGE_SAMPLES = 6

const RAD = Math.PI / 180
const wrapped = (cosine: number) => Math.max(0, (cosine + ARC_LIGHT.wrap) / (1 + ARC_LIGHT.wrap))

type Vec3 = [number, number, number]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

/** Everything the GPU needs to draw Arc-en-Ciel's ridges at one tilt, as they lie on the banknote (x right, y down, z out of it) */
export interface ArcLight {
  /** Which way the ridges are counted, across them (`ridgeAcross`): each ridge's lines run in order this way across it */
  across: [number, number]
  /** How much more of each ridge the slopes facing `across` show than the others, −1 to 1: 0 flat, all of it by ARC_SLIDE_DEG */
  share: number
  /** Which way the lamp is, and halfway between it and the eye, where a slope facing it shines */
  lamp: Vec3
  half: Vec3
  /** Each slope's average light, `shade` × (1 − `sheen`), and its average sheen: the other slope's, then the one facing `across` */
  means: [number, number, number, number]
}

/** Which way a spot `p` of the way across a ridge faces, and the light it catches from the lamp, before it is measured against paper */
function ridgeFacing(across: [number, number], lamp: Vec3, p: number) {
  // Steepest at the bottoms of the grooves, flat along the crest
  const beta = ARC_RIDGE_SLOPE_DEG * RAD * (1 - 2 * p)
  const n: Vec3 = [-across[0] * Math.sin(beta), -across[1] * Math.sin(beta), Math.cos(beta)]
  const groove = Math.min(p, 1 - p) / ARC_GROOVE.width
  return { n, light: (ARC_LIGHT.room + ARC_LIGHT.lamp * wrapped(dot(n, lamp))) * (1 - ARC_GROOVE.dark * Math.exp(-groove * groove)) }
}

/** A level ridge's light seen flat, averaged across it, which the slopes' light is measured against: so a ridge seen flat averages as much light as flat paper */
export const ARC_MEAN_LIGHT = (() => {
  const lamp: Vec3 = [0, -Math.sin(LAMP_HEIGHT_DEG * RAD), Math.cos(LAMP_HEIGHT_DEG * RAD)]
  let sum = 0
  for (let i = 0; i < 1024; i++) sum += ridgeFacing([0, 1], lamp, (i + 0.5) / 1024).light
  return sum / 1024
})()

/**
 * How a spot `p` of the way across a ridge catches the light (0 and 1 the bottoms of its grooves, ½ its crest): `shade`,
 * from how it faces the lamp and how deep in a groove it is, measured so that a ridge seen flat averages 1, as flat paper
 * does; `sheen`, how much of the lamp it mirrors to the eye
 */
export function ridgeLight(light: Pick<ArcLight, 'across' | 'lamp' | 'half'>, p: number) {
  const { n, light: lit } = ridgeFacing(light.across, light.lamp, p)
  return { shade: lit / ARC_MEAN_LIGHT, sheen: ARC_SHEEN.strength * Math.max(0, dot(n, light.half)) ** ARC_SHEEN.power }
}

/** Spots each slope's average light is taken from */
const MEAN_SAMPLES = 64

/**
 * How to draw Arc-en-Ciel's ridges with its banknote turned through `tilt` (turning over included) and rotated `quarter`
 * quarter turns on screen: how much of each ridge each slope shows, seen from straight in front, and where the lamp is, as
 * they lie on the banknote, or on Arc-en-Ciel's own box once that is rotated on the banknote (its ridges turn with it).
 * The lamp stays where it is as the banknote is rotated, as magnetic ink's does (`inkLight`).
 */
export function arcLight(arc: Pick<ArcEnCiel, 'angleDeg' | 'rotationDeg'>, tilt: Tilt2, quarter: Quarter = 0): ArcLight {
  // The banknote's turn, after the box's own rotation on it
  const m = withBoxRotation(tiltMatrix(tilt), arc)
  // From the room onto the banknote, then the box: rotated back first, then turned back
  const onNote = ([x, y, z]: Vec3): Vec3 => {
    const on = unturn(x, y, quarter)
    const v: Vec3 = [on.x, on.y, z]
    return [dot([m[0], m[1], m[2]], v), dot([m[3], m[4], m[5]], v), dot([m[6], m[7], m[8]], v)]
  }
  const eye = onNote([0, 0, 1])
  const lamp = unit(onNote([0, -Math.tan(LAMP_HEIGHT_DEG * RAD), 1]))
  // Down the banknote across level ridges, as tilting the top away shows the slopes facing down, the second half of each
  // ridge's lines, turning with the ridges
  const across = ridgeAcross(arc)
  const tan = (eye[0] * across[0] + eye[1] * across[1]) / Math.max(eye[2], 1e-6)
  const share = clamp(tan / Math.tan(ARC_SLIDE_DEG * RAD), -1, 1)
  const light = { across, lamp, half: unit([lamp[0] + eye[0], lamp[1] + eye[1], lamp[2] + eye[2]]) }
  const mean = (from: number) => {
    let shade = 0, sheen = 0
    for (let i = 0; i < MEAN_SAMPLES; i++) {
      const at = ridgeLight(light, from + (i + 0.5) / (2 * MEAN_SAMPLES))
      shade += at.shade * (1 - at.sheen)
      sheen += at.sheen
    }
    return [shade / MEAN_SAMPLES, sheen / MEAN_SAMPLES]
  }
  // + 0 turns a −0 into 0
  return { ...light, share: share + 0, means: [...mean(0), ...mean(0.5)] as ArcLight['means'] }
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
