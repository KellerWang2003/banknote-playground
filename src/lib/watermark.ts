import { clamp } from './frames'
import { keptName } from './layerName'
import { PLACE_MIN_MM, PLACE_STEP, type Size, dragBoxCorner, fitBox, maxBoxWidth, moveBox, moveBoxTo, newBox, resizeBox, withBoxAspect } from './placed'
import type { Watermark, WatermarkLevels } from './types'

/**
 * Where a watermark sits on its banknote, how big it is, which parts of its image are thinner and its levels;
 * drawing it is in relief.ts
 */

/** Default depth of a new watermark, 0 to 1 */
export const WATERMARK_DEPTH = 0.6
/** Drags, nudges and new watermarks snap position and width to this, in mm, as every placed layer does; typed values are kept */
export const WATERMARK_STEP = PLACE_STEP
/** Smallest width or height, in mm */
export const WATERMARK_MIN_MM = PLACE_MIN_MM

/** Levels that leave the image as it is read */
export const FULL_LEVELS: WatermarkLevels = { low: 0, high: 1, gamma: 1 }
/** Closest the two ends of the levels come, as a share of how thin the paper can be */
export const LEVELS_GAP = 0.02
/** Midtones range, as in Photoshop's Levels */
export const GAMMA_MIN = 0.1
export const GAMMA_MAX = 9.99

/** Where the midtones handle sits between the two ends, 0 to 1: the thinness that comes out halfway */
export const midtonesAt = (gamma: number) => 0.5 ** gamma
/** The midtones for a handle that far between the two ends, 0 to 1 */
export const gammaAt = (share: number) =>
  Math.round(clamp(Math.log(clamp(share, 1e-4, 1 - 1e-4)) / Math.log(0.5), GAMMA_MIN, GAMMA_MAX) * 100) / 100

/** Levels kept in range: the ends in order at least LEVELS_GAP apart, midtones within theirs; not levels at all, undefined */
export function fitLevels(levels: unknown): WatermarkLevels | undefined {
  if (!levels || typeof levels !== 'object') return undefined
  const { low, high, gamma } = levels as Record<string, unknown>
  if (typeof low !== 'number' || typeof high !== 'number' || typeof gamma !== 'number') return undefined
  if (![low, high, gamma].every(Number.isFinite)) return undefined
  const lo = clamp(low, 0, 1 - LEVELS_GAP)
  return { low: lo, high: clamp(high, lo + LEVELS_GAP, 1), gamma: clamp(gamma, GAMMA_MIN, GAMMA_MAX) }
}

const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/**
 * Keeps a watermark on its banknote, as every placed layer is kept (`fitBox`), with depth between 0 and 1 and levels in
 * range. Also repairs a damaged save: its name is kept only when it is text, Invert only when it is on, levels only when
 * they are levels, and anything unknown is dropped.
 */
export function fitWatermark(watermark: Watermark, note: Size): Watermark {
  const fitted: Watermark = { ...keptName(watermark.name), ...fitBox(watermark, note), depth: clamp(finite(watermark.depth, WATERMARK_DEPTH), 0, 1) }
  if (watermark.invert === true) fitted.invert = true
  const levels = fitLevels(watermark.levels)
  if (levels) fitted.levels = levels
  return typeof watermark.imageId === 'string' ? { imageId: watermark.imageId, ...fitted } : fitted
}

/** A new, empty watermark: a square in the plain part of the banknote, left of centre (or low on a portrait one) */
export const newWatermark = (note: Size): Watermark =>
  fitWatermark({ ...newBox(note, 0.45, { landscape: [0.2, 0.5], portrait: [0.5, 0.78] }), depth: WATERMARK_DEPTH }, note)

/** Placed as every placed layer is (placed.ts) */
export const maxWatermarkWidth = maxBoxWidth
export const resizeWatermark = resizeBox
export const dragWatermarkCorner = dragBoxCorner
export const moveWatermark = moveBox
export const moveWatermarkTo = moveBoxTo

/** A new image: its proportions set the height, keeping the width and the centre where they are; it starts on Auto levels */
export function withWatermarkImage(watermark: Watermark, imageId: string, aspect: number | undefined, note: Size): Watermark {
  const { levels: _byHand, ...rest } = watermark
  return fitWatermark({ ...withBoxAspect(rest, aspect, note), imageId }, note)
}
