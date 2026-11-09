import { clamp } from './frames'
import { keptName } from './layerName'
import type { Tilt2 } from './lens'
import { offAxisDeg } from './light'
import { type Size, fitBox, newBox, outOfBox, withBoxAspect } from './placed'
import type { MagneticInk } from './types'

/**
 * Magnetic ink's settings and how it looks at a tilt, SICPA's SPARK Flow PRIME look (the plan of 3 November): its
 * colour shifts from Flat to Tilted as the banknote turns away from the viewer, either way, and a bright bar rolls
 * across the shape on one tilt, from its middle flat right off its edge. How far each goes is fixed, tuned by eye as
 * the watermark's 30° was, not a setting. The canvas and the export both use these numbers. Reading its shape from
 * the image is in inkMask.ts. With Realistic on it is lit as metal flakes instead, from the same settings (realisticInk.ts).
 */

/** Tilt, either way or both together, from which the ink shows only its Tilted colour */
export const INK_SHIFT_DEG = 30
/** Tilt on the bar's own axis that rolls the bar from the middle of the shape right off its edge */
export const INK_ROLL_DEG = 20
/** How white the middle of the bar is, 0 to 1; it fades out to either side */
export const INK_BAR_LIGHT = 0.75
/** The bar's width, as a share of the shape the way it rolls */
export const INK_BAR = { min: 0.05, max: 1, step: 0.05 }
/** A new magnetic ink's look: gold flat, turning green, with a level bar rolling on the up/down tilt */
export const DEFAULT_INK: Pick<MagneticInk, 'color' | 'tiltedColor' | 'barAxis' | 'barWidth'> = {
  color: '#c9a227',
  tiltedColor: '#2e8b57',
  barAxis: 'y',
  barWidth: 0.3,
}

const HEX = /^#[0-9a-f]{6}$/i
const colour = (value: unknown, fallback: string) => (typeof value === 'string' && HEX.test(value) ? value : fallback)

/**
 * Keeps magnetic ink on its banknote, as every placed layer is kept (`fitBox`), with its bar's width in range. Also
 * repairs a damaged save: colours that aren't #rrggbb and an unknown bar axis go back to the defaults, Invert is kept
 * only when it is on, and anything unknown is dropped, Realistic included, which older saves kept on the ink (it is the
 * canvas's own switch now, `src/lib/realistic.ts`).
 */
export function fitMagneticInk(ink: MagneticInk, note: Size): MagneticInk {
  const barWidth = typeof ink.barWidth === 'number' && Number.isFinite(ink.barWidth) ? ink.barWidth : DEFAULT_INK.barWidth
  const fitted: MagneticInk = {
    ...keptName(ink.name),
    ...fitBox(ink, note),
    color: colour(ink.color, DEFAULT_INK.color),
    tiltedColor: colour(ink.tiltedColor, DEFAULT_INK.tiltedColor),
    barAxis: ink.barAxis === 'x' ? 'x' : 'y',
    barWidth: clamp(barWidth, INK_BAR.min, INK_BAR.max),
  }
  if (ink.invert === true) fitted.invert = true
  return typeof ink.imageId === 'string' ? { imageId: ink.imageId, ...fitted } : fitted
}

/** New magnetic ink, without an image yet: a square right of centre and low (high on a portrait banknote), clear of a new watermark */
export const newMagneticInk = (note: Size): MagneticInk =>
  fitMagneticInk({ ...newBox(note, 0.3, { landscape: [0.8, 0.7], portrait: [0.7, 0.2] }), ...DEFAULT_INK }, note)

/** A new image: its proportions set the height, keeping the width and the middle where they are */
export const withInkImage = (ink: MagneticInk, imageId: string, aspect: number | undefined, note: Size): MagneticInk =>
  fitMagneticInk({ ...withBoxAspect(ink, aspect, note), imageId }, note)

const smooth = (t: number) => t * t * (3 - 2 * t)

/** How much of the Tilted colour shows over the Flat one: none flat, easing up to all of it from INK_SHIFT_DEG on, whichever way it turns */
export const inkShift = (tilt: Tilt2) => smooth(clamp(offAxisDeg(tilt) / INK_SHIFT_DEG, 0, 1))

/**
 * How far the bar has rolled, −1 to 1: 0 flat, its middle in the middle of the shape; ±1 from INK_ROLL_DEG on its axis,
 * right off the shape's edge. It rolls towards the edge coming nearer, as the thread's sheen slides: tilting the top
 * away rolls a level bar down, turning the right side away rolls an upright bar left. On ink rotated on its banknote the
 * bar turns with it, and rolls on the tilt across it there: rotated a quarter turn, a level bar rolls as an upright one.
 */
export function inkRoll(ink: Pick<MagneticInk, 'barAxis' | 'rotationDeg'>, tilt: Tilt2) {
  // Which way the bar rolls on the banknote (x right, y down): down the ink for a level bar, right for an upright one,
  // turned counterclockwise with the ink
  const across = outOfBox(ink, ink.barAxis === 'x' ? 1 : 0, ink.barAxis === 'x' ? 0 : 1)
  // The eye moves left on the banknote as its right side turns away, and down it as the top tips away
  return clamp((-tilt.x * across.x + tilt.y * across.y) / INK_ROLL_DEG, -1, 1) || 0
}

/** Where the middle of the bar is at a roll, as a share of the shape the way it rolls (down, or right): halfway flat, half a bar beyond the edge at ±1 */
export const barCentre = (ink: Pick<MagneticInk, 'barWidth'>, roll: number) => 0.5 + (roll * (1 + ink.barWidth)) / 2

/** The same as a CSS translate of the bar from the middle of the shape, in % of the bar's own size */
export const barShift = (ink: Pick<MagneticInk, 'barWidth'>, roll: number) => ((barCentre(ink, roll) - 0.5) / ink.barWidth) * 100
