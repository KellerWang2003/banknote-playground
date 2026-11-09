import { useEffect, useState } from 'react'
import { clamp } from './frames'
import { AUTO_CLIP, AUTO_MIN_SHARE, SPECKLE_SPREADS, type Detail, canvasDetail, exportDetail, luma, paperOf, readSource, sourceOf } from './relief'
import type { MagneticInk } from './types'

/**
 * Where magnetic ink goes on its image: how much ink each pixel takes, worked out once per image and Invert and kept as
 * a mask, which the canvas clips the ink's colours and bar to (a CSS mask over them) and the export draws through. The
 * image's pixels come from the watermark's reader (`sourceOf`, 1024 px, or 2048 zoomed in), which keeps them for both.
 */

/**
 * How much ink each pixel takes, 0 (none) to 255 (full), one byte a pixel: the image read as the stencil the ink is
 * printed through. On an opaque background, read from its edges as the watermark's plain paper is (`paperOf`), the ink
 * is whatever is lighter or darker than it, as far as it is, past the background's own speckle (so a JPEG's stays
 * clear). Cut out of transparency, the shape takes the ink, rounded corners and all, less whatever is drawn on it in
 * another colour, as far as that stands out from the shape's own main colour: a strip with its 15 drawn in the paper's
 * colour prints with the 15 left open, and a shape of one colour, whatever it is, prints solid (Keller, 6 November: his
 * 15 strip came out one flat bar while a cutout was read by its outline alone). Either way the strongest part, bar a few
 * stray pixels, counts in full, so a faint scan prints solid, and soft parts stay soft, as thinner ink: clean art (an
 * SVG, pure black and white, a clean cutout) comes out crisp by itself, and soft art as drawn (Keller chose this over a
 * hard limit at each spot). Only brightness counts, as for the watermark. Inverted, the ink goes round the shape instead.
 */
export function inkCoverage(data: Uint8ClampedArray, width: number, height: number, invert = false) {
  const paper = paperOf(data, width, height)
  const n = width * height
  let out: Uint8ClampedArray
  if (paper.clear) {
    const drawn = standingOut(data, n, shapeColour(data, n), true)
    out = new Uint8ClampedArray(n)
    for (let p = 0; p < n; p++) out[p] = Math.round((data[p * 4 + 3] * (255 - drawn[p])) / 255)
  } else {
    out = standingOut(data, n, paper, false)
  }
  if (invert) for (let p = 0; p < n; p++) out[p] = 255 - out[p]
  return out
}

/** Brightness steps the main colour of a cutout is counted in, so a big image needs no sorting */
const SHAPE_BINS = 4096

/**
 * The main colour of a shape cut out of transparency, as `paperOf` reads an opaque image's background from its edges:
 * the middle brightness of the shape's opaque pixels, and `spread`, how far they stray from it (a scan's grain), as a
 * robust standard deviation.
 */
function shapeColour(data: Uint8ClampedArray, n: number) {
  const bin = (level: number) => Math.min(SHAPE_BINS - 1, Math.floor(level * SHAPE_BINS))
  const levels = new Uint32Array(SHAPE_BINS)
  let count = 0
  for (let i = 0; i < n * 4; i += 4) {
    if (data[i + 3] < 128) continue
    levels[bin(luma(data[i], data[i + 1], data[i + 2]))]++
    count++
  }
  const middle = (counts: Uint32Array) => {
    for (let b = 0, seen = 0; b < SHAPE_BINS; b++) {
      seen += counts[b]
      if (seen * 2 > count) return b
    }
    return 0
  }
  const level = (middle(levels) + 0.5) / SHAPE_BINS
  const offs = new Uint32Array(SHAPE_BINS)
  for (let i = 0; i < n * 4; i += 4) if (data[i + 3] >= 128) offs[bin(Math.abs(luma(data[i], data[i + 1], data[i + 2]) - level))]++
  return { level, spread: (1.4826 * middle(offs)) / SHAPE_BINS }
}

/**
 * How far each pixel stands out from a brightness (an opaque image's background, or a cutout's own main colour), 0 to
 * 255, past `SPECKLE_SPREADS` of its spread, with the strongest part, bar a few stray pixels, at 255. Against a
 * background each pixel counts as far as it is opaque; within a cutout only its opaque pixels count, and the rest stay 0.
 */
function standingOut(data: Uint8ClampedArray, n: number, { level, spread }: { level: number; spread: number }, cutout: boolean) {
  const floor = SPECKLE_SPREADS * spread
  // As far as it can stand out either way, past the speckle
  const room = Math.max(level, 1 - level) - floor
  const out = new Uint8ClampedArray(n)
  const counts = new Uint32Array(256)
  let counted = 0
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (cutout && data[i + 3] < 128) continue
    const off = Math.abs(luma(data[i], data[i + 1], data[i + 2]) - level) - floor
    const v = off > 0 && room > 0 ? Math.round(clamp(off / room, 0, 1) * (cutout ? 255 : data[i + 3])) : 0
    out[p] = v
    counts[v]++
    counted++
  }
  // The strongest part, bar a few stray pixels, counts in full; too few pixels stand out to tell, and it is left as read
  const shown = counted - counts[0]
  let strongest = 255
  if (shown > 0 && shown >= AUTO_MIN_SHARE * counted) {
    let skip = AUTO_CLIP * shown
    for (; strongest > 1; strongest--) {
      skip -= counts[strongest]
      if (skip < 0) break
    }
  }
  if (strongest < 255) for (let p = 0; p < n; p++) out[p] = Math.round((out[p] * 255) / strongest)
  return out
}

/** Magnetic ink's shape as a mask: its alpha is how much ink each pixel takes */
export interface InkMask {
  key: string
  canvas: HTMLCanvasElement
  /** The same as an image, for a CSS mask */
  url: string
}

/** Masks kept, the latest first: each image both ways round at both details and a few more, so Invert, undo, redo and zooming never wait */
const MASKS_KEPT = 10

const maskKey = (imageId: string, invert: boolean | undefined, detail: Detail) => `${imageId}@${detail.vector}/${detail.raster}|${invert ? 'invert' : ''}`
const building = new Map<string, Promise<InkMask | undefined>>()
const ready = new Map<string, InkMask>()
const recent: string[] = []

/** How much ink each pixel of an image's pixels takes, as a canvas whose alpha it is */
function maskCanvas({ data, width, height }: { data: Uint8ClampedArray; width: number; height: number }, invert: boolean) {
  const coverage = inkCoverage(data, width, height, invert)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  const image = ctx.createImageData(width, height)
  for (let p = 0; p < coverage.length; p++) image.data[p * 4 + 3] = coverage[p]
  ctx.putImageData(image, 0, 0)
  return canvas
}

async function build(imageId: string, invert: boolean, key: string, detail: Detail): Promise<InkMask | undefined> {
  const source = await sourceOf(imageId, detail)
  const canvas = source && maskCanvas(source, invert)
  if (!canvas) return undefined
  // Saved as a PNG in the background, so a big mask doesn't hold up the page
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve))
  return { key, canvas, url: blob ? URL.createObjectURL(blob) : canvas.toDataURL() }
}

/** Keeps the latest masks and lets the older ones go */
function remember(key: string) {
  const at = recent.indexOf(key)
  if (at >= 0) recent.splice(at, 1)
  recent.unshift(key)
  for (const old of recent.splice(MASKS_KEPT)) {
    const mask = ready.get(old)
    if (mask?.url.startsWith('blob:')) URL.revokeObjectURL(mask.url)
    building.delete(old)
    ready.delete(old)
  }
}

/** Magnetic ink's mask, read the way its Invert says, at `detail` (the usual without) */
export function loadInkMask(imageId: string, invert: boolean | undefined, detail: Detail = canvasDetail()): Promise<InkMask | undefined> {
  const key = maskKey(imageId, invert, detail)
  let mask = building.get(key)
  if (!mask) {
    const made = build(imageId, invert === true, key, detail).catch(() => undefined)
    void made.then((done) => {
      if (done && building.get(key) === made) ready.set(key, done)
    })
    building.set(key, made)
    mask = made
  }
  remember(key)
  return mask
}

/**
 * Magnetic ink's mask for an export, drawn `px` across in it: read from the whole image, as uploaded (an SVG at least as
 * big as it is drawn). Read afresh and not kept, as it can be far bigger than the canvas needs
 */
export async function exportInkMask(imageId: string, invert: boolean | undefined, px: number): Promise<InkMask | undefined> {
  const source = await readSource(imageId, exportDetail(px)).catch(() => undefined)
  const canvas = source && maskCanvas(source, invert === true)
  return canvas && { key: '', canvas, url: '' }
}

/**
 * Magnetic ink's mask for the canvas, once worked out: in more detail once it shows `shownPx` device pixels across, past
 * what the usual reading has. Switching Invert, or zooming in, keeps the last mask showing until the new one is ready,
 * so the ink never blinks out. Undefined while the first one is on its way (a loading state), null if it can't be
 * worked out (its image couldn't be had or read), so it never shows as loading for ever.
 */
export function useInkMask(ink: Pick<MagneticInk, 'imageId' | 'invert'> | undefined, shownPx?: number): InkMask | null | undefined {
  const imageId = ink?.imageId
  const invert = ink?.invert === true
  const detail = canvasDetail(shownPx)
  const key = imageId ? maskKey(imageId, invert, detail) : undefined
  const [loaded, setLoaded] = useState<{ key: string; imageId: string; mask?: InkMask }>()
  const exact = key ? ready.get(key) ?? (loaded?.key === key ? loaded.mask : undefined) : undefined
  const previous = imageId && loaded?.imageId === imageId ? loaded.mask : undefined
  // Rendered without it: work it out, or pick it up if another view did since this one rendered
  useEffect(() => {
    if (!imageId || !key || exact) return
    let live = true
    void loadInkMask(imageId, invert, detail).then((mask) => {
      if (live) setLoaded({ key, imageId, mask })
    })
    return () => {
      live = false
    }
  }, [imageId, invert, key, exact, detail])
  if (key && !exact && loaded?.key === key && !loaded.mask) return null
  return exact ?? previous
}
