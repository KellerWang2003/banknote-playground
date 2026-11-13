import { clamp } from './frames'
import type { Tilt2 } from './lens'
import { INK_ROLL_DEG } from './magneticInk'
import type { FeatureShade } from './paper'
import { type PlacedBox, type Size, intoBox, outOfBox, rotationOf } from './placed'
import { type Quarter, unturn } from './rotate'
import type { MagneticInk } from './types'

/**
 * Magnetic ink drawn as lit metal, with Realistic on (Keller, 7 November: a Realistic switch on the Magnetic ink tab, and
 * none of the tuned look, though with its glow round the bar and its sparkle). SPARK Flow's ink is mirror flakes, each a
 * thin-film stack whose colour depends on how steeply it is seen, which a magnet turns into a curve across the shape before
 * the ink is cured: the bright bar is the band of flakes mirroring the lamp to the eye, and it rolls as a tilt brings the
 * next band round. Here the flakes curve across the shape the way the bar rolls, just far enough that the bar rolls off by
 * INK_ROLL_DEG, as the flat look's does; Bar width sets how wide the lamp's reflection is, and Flat and Tilted are the
 * colour seen square-on and from REAL_SHIFT_DEG off it. There is one light, a lamp hanging over the viewer's head (Keller,
 * 8 November: lit from above, as more realistic than the lamp at the eye it first had), and the magnet
 * sets the flakes to face that viewer (`flakeRest`), so wherever the ink sits on the banknote its bar rests the same way:
 * flat, towards the top, where the flakes face halfway between the lamp and the eye, and in the middle, as bright, with the
 * banknote's top tipped back by half LAMP_HEIGHT_DEG. An upright bar shows only near that tip, the lamp being above it
 * rather than in its curve. Holding the banknote to the light leaves the ink as it was, as it is opaque, and with
 * Realistic's paper it is shaded as the paper round it is, never lighter (paper.ts). The numbers are tuned by eye on
 * Keller's 15 strip, as the flat look's are, and are not settings; Keller found the first ones too flashy, reflective and
 * sparkly (9 November), so the lamp is dimmer and whitens less, and the glints are fewer and dimmer, over a finer grain,
 * the bar and its glow rolling as before. This file sets up each draw
 * (`inkLight`); the GPU shades every pixel with it (inkRenderer.ts), on the canvas and in exports alike.
 */

const RAD = Math.PI / 180

/** A flake seen this far off square-on shows only the Tilted colour; between, it moves along the thin film's curve */
export const REAL_SHIFT_DEG = 45
/** The square of the film's refractive index, which sets how the colour moves with the angle it is seen at */
export const FILM_N2 = 2.1
/** How much less vivid the colour is halfway between Flat and Tilted, as a metal's in-between colour is */
export const SHIFT_DIP = 0.2
/** The lamp's brightness off a flake mirroring it straight to the eye */
export const LAMP_POWER = 1.8
/** The soft glow round the bar, three times as wide as its core: the flakes are never all perfectly aligned */
export const LAMP_GLOW = 0.3
/** How far the brightest light goes towards white as it rolls off, rather than keeping the ink's colour */
export const HIGHLIGHT_WHITE = 0.35
/**
 * How high the lamp hangs over the viewer's head: degrees above the line from the middle of the banknote to their eye.
 * Flat, the bar rests towards the top of the ink, where the flakes face halfway between the lamp and the eye, and tipping
 * the banknote's top back by half this brings it to the middle. Straight above the eye, so the lamp and the eye see an ink
 * from the same side whatever its place on the banknote, and every ink's bar rests alike (a lamp further off would rest
 * each upright bar off its middle, towards the banknote's)
 */
export const LAMP_HEIGHT_DEG = 20
/** The light the room gives, mirrored from above and from below */
export const ROOM_LIGHT = { above: 0.8, below: 0.4 }
/** How far each flake strays from the curve, radians either way, and how much brighter or darker it is: the metal's fine grain */
export const GRAIN_TILT = 0.012
export const GRAIN_LIGHT = 0.06
/** Stray flakes tilted any which way, up to this far either way: each catches the lamp for a moment, so the ink sparkles as it turns */
export const GLINT_TILT = 0.4
/** How narrow a stray flake's flash is (radians), how bright, and how far towards white */
export const GLINT_LOBE = 0.055
export const GLINT_POWER = 1.6
export const GLINT_WHITE = 0.25
/** Flakes turned away from the viewer are seen only dimly, by their edges */
export const AWAY_LIGHT = 0.15
/**
 * How gradually flakes dim as they turn edge-on to the viewer and on away: either side of edge-on, in the cosine of the
 * angle they are seen at, about 9° (Keller, 13 November: past a certain tilt the ink's far end went dark along a ragged
 * line, each flake of its grain going dark on its own; until then they went dark at once at edge-on)
 */
export const AWAY_SOFT = 0.15
/** Chroma below which a colour counts as grey, with no hue of its own */
const GREY_CHROMA = 0.02

/**
 * How far the flakes turn from square-on at the shape's edges, radians: far enough that a tilt of INK_ROLL_DEG on the bar's
 * axis rolls the middle of the lamp's reflection half a bar beyond the edge, where the flat look's bar ends up too
 */
export const flakeEdge = (barWidth: number) => (INK_ROLL_DEG / (1 + barWidth)) * RAD

/**
 * How wide the lamp's reflection is, radians: its bright core as wide as the flat look's bar, half as bright a quarter of a
 * bar either side of its middle (a reflection turns twice as far as the flake does)
 */
export const lampLobe = (barWidth: number) => (barWidth * flakeEdge(barWidth)) / Math.sqrt(Math.LN2)

/**
 * How the flakes in the middle of the ink are turned to face the eye of the viewer `eye` mm out from the middle of the
 * banknote, as the magnet sets them: radians the way the bar rolls, and across it. So the bar rests in the same place in
 * the ink wherever it sits (flat, towards the top, the lamp hanging above; in the middle with the top tipped back by half
 * LAMP_HEIGHT_DEG), and as bright as in the banknote's middle. Square-on flakes would face the eye only nearer the
 * banknote's middle, resting the bar off towards it, and off to its side would mirror the lamp past the eye, leaving the
 * bar only its glow. Ink rotated on its banknote is set along its own sides, as its bar turns with it.
 */
export function flakeRest(ink: Pick<MagneticInk, 'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'barAxis' | 'rotationDeg'>, note: Size, eye: number): [number, number] {
  // Where its middle is from the banknote's, along the ink's own sides
  const { x, y } = intoBox(ink, ink.xMm + ink.widthMm / 2 - note.widthMm / 2, ink.yMm + ink.heightMm / 2 - note.heightMm / 2)
  const [along, across] = ink.barAxis === 'x' ? [x, y] : [y, x]
  // + 0 turns a negative zero into 0
  return [Math.atan2(-along, eye) + 0, Math.atan2(-across, eye) + 0]
}

/**
 * A flake's facing `t` of the way across the shape the way the bar rolls (down for a level bar, right for an upright one),
 * before the banknote turns: turned `rest` in the middle (`flakeRest`; square-on for a viewer far off), turning up to
 * `flakeEdge` further the way the bar rolls towards either edge
 */
export function flakeNormal(barAxis: MagneticInk['barAxis'], barWidth: number, t: number, rest: [number, number] = [0, 0]): [number, number, number] {
  const phi = (t - 0.5) * 2 * flakeEdge(barWidth) + rest[0]
  const along = Math.sin(phi), across = Math.tan(rest[1]) * Math.cos(phi), z = Math.cos(phi)
  const length = Math.hypot(along, across, z)
  return barAxis === 'x' ? [along / length, across / length, z / length] : [across / length, along / length, z / length]
}

/**
 * The turn CSS rotateX(y) rotateY(x) gives, as NoteView turns the banknote (x right, y down, z towards the viewer), as a
 * 3 × 3 matrix in WebGL's column order
 */
export function tiltMatrix({ x, y }: Tilt2): number[] {
  const ca = Math.cos(y * RAD), sa = Math.sin(y * RAD), cb = Math.cos(x * RAD), sb = Math.sin(x * RAD)
  return [cb, sa * sb, -ca * sb, 0, ca, sa, sb, -sa * cb, ca * cb]
}

/** A matrix in WebGL's column order times a vector */
export const turned = (m: number[], [x, y, z]: [number, number, number]): [number, number, number] =>
  [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z]

/**
 * A banknote's turn (`tiltMatrix`) after a box's own rotation on the banknote (placed.ts), in WebGL's column order: it
 * takes what lies along the box's own sides, its flakes or ridges, onto the banknote first, then turns it with the banknote.
 * Upright, the turn itself.
 */
export function withBoxRotation(m: number[], box: Pick<PlacedBox, 'rotationDeg'>): number[] {
  if (!rotationOf(box)) return m
  // The box's own x and y as they lie on the banknote
  const bx = outOfBox(box, 1, 0)
  const by = outOfBox(box, 0, 1)
  const column = (v: { x: number; y: number }) => turned(m, [v.x, v.y, 0])
  return [...column(bx), ...column(by), m[6], m[7], m[8]]
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** A #rrggbb colour in OKLCH, where a colour's lightness, vividness and hue each move evenly: lightness, chroma, hue (radians) */
export function oklch(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => linear(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), Math.atan2(B, A)]
}

/** How far round the hue wheel from one hue to the other, the shorter way, radians from −π to π */
export function hueTravel(from: number, to: number) {
  let d = (to - from) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** Thin-film interference: light comes back from a shorter path the more steeply the film is seen, λ ∝ √(1 − sin²θ / n²) */
const film = (theta: number) => 1 - Math.sqrt(1 - Math.sin(theta) ** 2 / FILM_N2)
/** The film's shift at REAL_SHIFT_DEG, where the Tilted colour is reached */
export const FILM_FULL = film(REAL_SHIFT_DEG * RAD)

/** How far a flake seen `theta` radians off square-on has moved from the Flat colour to the Tilted one: 0 to 1, all of it from REAL_SHIFT_DEG */
export const filmShift = (theta: number) => clamp(film(theta) / FILM_FULL, 0, 1)

/** Everything the GPU needs to light one magnetic ink at one tilt: lengths in mm, from the middle of the banknote */
export interface InkLight {
  /** How the banknote is turned (`tiltMatrix`) */
  rot: number[]
  /** The ink's box: its top-left corner, and its size */
  origin: [number, number]
  size: [number, number]
  /** How far away the viewer's eye is, straight out from the middle of the banknote */
  eye: number
  /** Which way the flakes curve: across for an upright bar, up and down for a level one */
  axis: [number, number]
  /** `flakeEdge`, `flakeRest` and `lampLobe` */
  edge: number
  rest: [number, number]
  lobe: number
  /** Where the lamp is, and which way is down in the room, as they lie on the banknote's own turn, before Rotate turns it on screen */
  lamp: [number, number, number]
  down: [number, number, number]
  /** The Flat colour and the Tilted one in OKLCH, and the hue travelled between them */
  flat: [number, number, number]
  tilted: [number, number]
  hue: number
  /** With Realistic's paper, how the paper under it is shaded: as an opaque ink, it is shaded alike (`featureShade`) */
  paper?: FeatureShade
}

type LitInk = Pick<MagneticInk, 'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'rotationDeg' | 'color' | 'tiltedColor' | 'barAxis' | 'barWidth'>

/**
 * How to light `ink` on its banknote turned through `tilt` (turning over included), seen from `eye` mm away, as the
 * canvas's perspective sees it, with the banknotes rotated `quarter` quarter turns on screen. The lamp and the room stay
 * where they are as the banknote is rotated, as they would round one turned in the hand. Ink rotated on its banknote is
 * worked out along its own sides, the banknote's turn taking them onto it first (`withBoxRotation`), so its flakes and
 * bar turn with it: its box is then where it lies along those sides, about the banknote's middle. With `paper`, it is
 * shaded as the paper round it is.
 */
export function inkLight(ink: LitInk, note: Size, tilt: Tilt2, eye: number, quarter: Quarter = 0, paper?: FeatureShade): InkLight {
  const flat = oklch(ink.color)
  const tilted = oklch(ink.tiltedColor)
  // A grey has no hue of its own: it takes the other colour's, so the shift between them doesn't swing round the wheel
  if (flat[1] < GREY_CHROMA) flat[2] = tilted[2]
  if (tilted[1] < GREY_CHROMA) tilted[2] = flat[2]
  const room = (x: number, y: number, z: number): [number, number, number] => {
    const on = unturn(x, y, quarter)
    // + 0 turns a −0 into 0
    return [on.x + 0, on.y + 0, z]
  }
  // Rotated, its top-left corner along its own sides, about the banknote's middle
  const middle = intoBox(ink, ink.xMm + ink.widthMm / 2 - note.widthMm / 2, ink.yMm + ink.heightMm / 2 - note.heightMm / 2)
  const origin: [number, number] = rotationOf(ink)
    ? [middle.x - ink.widthMm / 2, middle.y - ink.heightMm / 2]
    : [ink.xMm - note.widthMm / 2, ink.yMm - note.heightMm / 2]
  return {
    rot: withBoxRotation(tiltMatrix(tilt), ink),
    origin,
    size: [ink.widthMm, ink.heightMm],
    eye,
    axis: ink.barAxis === 'x' ? [1, 0] : [0, 1],
    edge: flakeEdge(ink.barWidth),
    rest: flakeRest(ink, note, eye),
    lobe: lampLobe(ink.barWidth),
    lamp: room(0, -Math.tan(LAMP_HEIGHT_DEG * RAD) * eye, eye),
    down: room(0, 1, 0),
    flat,
    tilted: [tilted[0], tilted[1]],
    hue: hueTravel(flat[2], tilted[2]),
    ...(paper ? { paper } : {}),
  }
}

/** The most pixels a realistic ink is drawn with on the canvas, and across its longer side: zoomed in further, it is drawn coarser and stretched */
export const MAX_INK_PIXELS = 2048 * 2048
export const MAX_INK_SIDE = 4096

/**
 * The pixels a realistic ink is drawn with for a box `width` × `height` px on screen at `ratio` device pixels a px: as many
 * as it shows with, up to MAX_INK_PIXELS and MAX_INK_SIDE; and its grain, a cell a px on screen (`cell`, in its own pixels)
 */
export function inkPixels(width: number, height: number, ratio: number) {
  const w = Math.max(1, width * ratio), h = Math.max(1, height * ratio)
  const k = Math.min(1, Math.sqrt(MAX_INK_PIXELS / (w * h)), MAX_INK_SIDE / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), cell: Math.max(1, ratio * k) }
}
