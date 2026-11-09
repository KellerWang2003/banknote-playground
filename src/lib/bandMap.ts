import { useEffect, useState } from 'react'
import {
  type ArcLight, type MmPoint, type Rgb, averageRgb, bandColour, bandSlide, curveControls, lineDistance, linearRgb, pointsDistance,
  sampleCurve, spotMm, srgbBytes,
} from './arcEnCiel'
import { inkCoverage } from './inkMask'
import { type MaskSource, drawBands, paintBands } from './inkRenderer'
import type { Tilt2 } from './lens'
import { sourceOf } from './relief'
import type { ArcEnCiel } from './types'

/**
 * Where Arc-en-Ciel's bands sit at rest, and how they are drawn without the GPU. Edge and Holes start them from the shape
 * itself: for each pixel, how far it lies inside the shape from its nearest edge, and how far from the nearest hole in it
 * (paper the shape closes round), worked out once per image and Invert from the same reading magnetic ink's mask has
 * (`inkCoverage`), and kept. Every separate shape in the image gets its own bands, as the sponsor's flower gives each petal
 * its own, since each pixel goes by the edge nearest it. Point and Line need no map: their distances are worked out as
 * they are drawn. Tilting only slides the bands along these distances (`bandSlide`), so a map is never redrawn for a tilt.
 * With Realistic on, the area the intaglio plate embosses is worked out with them (`embossField`), whatever the bands
 * start from.
 */

/** Longest side a map is worked out at, px: a distance changes smoothly, so the GPU's interpolation keeps band edges smooth at any zoom */
export const MAP_PX = 512
/** Shapes' maps kept, the latest first: an image both ways round and a few more, so Invert, undo and redo never wait */
const SHAPES_KEPT = 6

/** Distances across the layer's box, row by row, in box widths: the box's width is `width` pixels of it */
export interface BandField {
  width: number
  height: number
  data: Float32Array
  /** The largest distance in it */
  max: number
}

/** An image's maps, read the way Invert says */
export interface BandShape {
  key: string
  /** How far each pixel lies inside the shape from its nearest edge (0 outside it) */
  edge: BandField
  /** How far each pixel lies from the nearest hole in the shape; none when it has no holes */
  holes?: BandField
  /** How far each pixel lies inside the area the plate embosses (`embossField`, 0 outside it); none when nothing is in the shape */
  emboss?: BandField
}

const UNREACHED = 1e20

/** Squared distances to the nearest seed along a line of `n` values (`f`: 0 at a seed, UNREACHED elsewhere): Felzenszwalb and Huttenlocher's method */
function line1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const r = q - v[k]
    d[q] = r * r + f[v[k]]
  }
}

/** Squared distance from each pixel's middle to the nearest seed pixel's, exactly, in two passes: down each column, then along each row */
export function squaredDistances(seeds: Uint8Array, width: number, height: number) {
  const n = Math.max(width, height)
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1)
  const grid = new Float64Array(width * height)
  for (let i = 0; i < grid.length; i++) grid[i] = seeds[i] ? 0 : UNREACHED
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]
    line1d(f, height, d, v, z)
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]
  }
  for (let y = 0, row = 0; y < height; y++, row += width) {
    for (let x = 0; x < width; x++) f[x] = grid[row + x]
    line1d(f, width, d, v, z)
    for (let x = 0; x < width; x++) grid[row + x] = d[x]
  }
  return grid
}

/**
 * A field from distances to seeds on the shape's grid with a border of paper round it (`padded`, `width` + 2 across):
 * how far each pixel's middle lies from the seeds' edge (half a pixel nearer than their middles), in box widths, 0 on them
 */
function fieldFrom(seeds: Uint8Array, width: number, height: number): BandField {
  const w = width + 2
  const squared = squaredDistances(seeds, w, height + 2)
  const data = new Float32Array(width * height)
  let max = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.max(0, Math.sqrt(squared[(y + 1) * w + x + 1]) - 0.5) / width
      data[y * width + x] = d
      if (d > max) max = d
    }
  }
  return { width, height, data, max }
}

/** A corner of a pixel on the shape's grid, px from its top-left */
type GridPoint = [number, number]

const cross = (o: GridPoint, a: GridPoint, b: GridPoint) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** The convex hull of some points, in order round it, without points along its sides: Andrew's monotone chain */
export function convexHull(points: GridPoint[]): GridPoint[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const chain = (from: GridPoint[]) => {
    const kept: GridPoint[] = []
    for (const p of from) {
      while (kept.length >= 2 && cross(kept[kept.length - 2], kept[kept.length - 1], p) <= 0) kept.pop()
      kept.push(p)
    }
    kept.pop()
    return kept
  }
  return [...chain(sorted), ...chain([...sorted].reverse())]
}

/**
 * The area the intaglio plate embosses, with Realistic on (the plan of 8 November: white emboss inside a rubber band round
 * the shape): the convex hull of its pixels, read from half coverage as `shapeMaps` reads them, so the paper in its holes
 * and bays is embossed too. How far each pixel's middle lies inside it, in box widths, 0 outside, worked out exactly from
 * the hull's sides, so its edge stays straight however far in it is seen. Undefined when nothing is in the shape.
 */
export function embossField(coverage: Uint8ClampedArray, width: number, height: number): BandField | undefined {
  // The pixels at either end of each row, by their corners: the hull of those is the hull of them all
  const corners: GridPoint[] = []
  for (let y = 0; y < height; y++) {
    let first = -1, last = -1
    for (let x = 0, row = y * width; x < width; x++) {
      if (coverage[row + x] < 128) continue
      if (first < 0) first = x
      last = x
    }
    if (first >= 0) corners.push([first, y], [first, y + 1], [last + 1, y], [last + 1, y + 1])
  }
  const hull = convexHull(corners)
  if (hull.length < 3) return undefined
  // Each side as a line, its normal pointing in: a pixel's distance inside is the least of its distances from them
  let area = 0
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length]
    area += a[0] * b[1] - b[0] * a[1]
  })
  const sides = hull.map((a, i) => {
    const b = hull[(i + 1) % hull.length]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const nx = ((a[1] - b[1]) / length) * Math.sign(area), ny = ((b[0] - a[0]) / length) * Math.sign(area)
    return { nx, ny, c: nx * a[0] + ny * a[1] }
  }).sort((a, b) => b.nx - a.nx)
  const data = new Float32Array(width * height)
  let max = 0
  // Along each row the sides' distances are straight lines; the least of them is a chain of them in order of slope, found
  // once a row (the lower envelope), so each pixel looks at one or two
  const slopes: number[] = [], heights: number[] = []
  for (let y = 0; y < height; y++) {
    const py = y + 0.5
    slopes.length = 0
    heights.length = 0
    for (const { nx, ny, c } of sides) {
      const b = ny * py - c
      const top = slopes.length - 1
      if (top >= 0 && Math.abs(slopes[top] - nx) < 1e-12) {
        if (b >= heights[top]) continue
        slopes.pop()
        heights.pop()
      }
      while (slopes.length >= 2) {
        const m1 = slopes[slopes.length - 2], b1 = heights[heights.length - 2]
        const m2 = slopes[slopes.length - 1], b2 = heights[heights.length - 1]
        if ((b - b1) * (m1 - m2) > (b2 - b1) * (m1 - nx)) break
        slopes.pop()
        heights.pop()
      }
      slopes.push(nx)
      heights.push(b)
    }
    for (let x = 0, j = 0, row = y * width; x < width; x++) {
      const px = x + 0.5
      while (j + 1 < slopes.length && slopes[j + 1] * px + heights[j + 1] <= slopes[j] * px + heights[j]) j++
      const d = Math.max(0, slopes[j] * px + heights[j]) / width
      data[row + x] = d
      if (d > max) max = d
    }
  }
  return { width, height, data, max }
}

/**
 * The maps for a shape, from how much ink each pixel takes (0 to 255, one byte a pixel, `inkCoverage`): a pixel is in the
 * shape from half coverage. Beyond the image is paper, so a shape cut by its edge has an edge there. Holes are paper the
 * shape closes round: paper that can't reach the image's edge without crossing the shape. The embossed area comes with
 * them (`embossField`).
 */
export function shapeMaps(coverage: Uint8ClampedArray, width: number, height: number, key = ''): BandShape {
  const w = width + 2, h = height + 2
  const inShape = new Uint8Array(w * h)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) inShape[(y + 1) * w + x + 1] = coverage[y * width + x] >= 128 ? 1 : 0
  const paper = new Uint8Array(w * h)
  for (let i = 0; i < paper.length; i++) paper[i] = inShape[i] ? 0 : 1
  // Paper reached from beyond the image, side by side (the shape's pixels touching at corners still close a hole)
  const outside = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let top = 0
  const reach = (i: number) => {
    if (paper[i] && !outside[i]) {
      outside[i] = 1
      stack[top++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    reach(x)
    reach((h - 1) * w + x)
  }
  for (let y = 1; y < h - 1; y++) {
    reach(y * w)
    reach(y * w + w - 1)
  }
  while (top > 0) {
    const i = stack[--top]
    const x = i % w
    if (x > 0) reach(i - 1)
    if (x < w - 1) reach(i + 1)
    if (i >= w) reach(i - w)
    if (i < w * (h - 1)) reach(i + w)
  }
  const holes = new Uint8Array(w * h)
  let anyHole = false
  for (let i = 0; i < holes.length; i++) {
    if (paper[i] && !outside[i]) {
      holes[i] = 1
      anyHole = true
    }
  }
  const emboss = embossField(coverage, width, height)
  return {
    key,
    edge: fieldFrom(paper, width, height),
    ...(anyHole ? { holes: fieldFrom(holes, width, height) } : {}),
    ...(emboss ? { emboss } : {}),
  }
}

/** Coverage averaged down to at most MAP_PX on its longest side, in whole steps */
function shrunk(coverage: Uint8ClampedArray, width: number, height: number) {
  const step = Math.ceil(Math.max(width, height) / MAP_PX)
  if (step <= 1) return { coverage, width, height }
  const w = Math.ceil(width / step), h = Math.ceil(height / step)
  const out = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let count = 0
      for (let yy = y * step; yy < Math.min(height, (y + 1) * step); yy++) {
        for (let xx = x * step; xx < Math.min(width, (x + 1) * step); xx++) {
          sum += coverage[yy * width + xx]
          count++
        }
      }
      out[y * w + x] = Math.round(sum / count)
    }
  }
  return { coverage: out, width: w, height: h }
}

const shapeKey = (imageId: string, invert: boolean | undefined) => `${imageId}|${invert ? 'invert' : ''}`
const building = new Map<string, Promise<BandShape | undefined>>()
const ready = new Map<string, BandShape>()
const recent: string[] = []

async function build(imageId: string, invert: boolean, key: string): Promise<BandShape | undefined> {
  // The usual reading of the image's pixels, which magnetic ink's and Arc-en-Ciel's masks start from too
  const source = await sourceOf(imageId)
  if (!source) return undefined
  const small = shrunk(inkCoverage(source.data, source.width, source.height, invert), source.width, source.height)
  return shapeMaps(small.coverage, small.width, small.height, key)
}

/** Keeps the latest shapes' maps and lets the older ones go */
function remember(key: string) {
  const at = recent.indexOf(key)
  if (at >= 0) recent.splice(at, 1)
  recent.unshift(key)
  for (const old of recent.splice(SHAPES_KEPT)) {
    building.delete(old)
    ready.delete(old)
  }
}

/** An image's maps, read the way Invert says; the export draws from the same ones, as a distance needs no more detail */
export function loadBandShape(imageId: string, invert: boolean | undefined): Promise<BandShape | undefined> {
  const key = shapeKey(imageId, invert)
  let shape = building.get(key)
  if (!shape) {
    const made = build(imageId, invert === true, key).catch(() => undefined)
    void made.then((done) => {
      if (done && building.get(key) === made) ready.set(key, done)
    })
    building.set(key, made)
    shape = made
  }
  remember(key)
  return shape
}

/**
 * Arc-en-Ciel's maps, once worked out. Switching Invert keeps the last ones until the new ones are ready, so the bands
 * never blink out. Undefined while the first are on their way, null if they can't be worked out (the image couldn't be
 * had or read), so nothing waits for them for ever.
 */
export function useBandShape(arc: Pick<ArcEnCiel, 'imageId' | 'invert'> | undefined): BandShape | null | undefined {
  const imageId = arc?.imageId
  const invert = arc?.invert === true
  const key = imageId ? shapeKey(imageId, invert) : undefined
  const [loaded, setLoaded] = useState<{ key: string; imageId: string; shape?: BandShape }>()
  const exact = key ? ready.get(key) ?? (loaded?.key === key ? loaded.shape : undefined) : undefined
  const previous = imageId && loaded?.imageId === imageId ? loaded.shape : undefined
  // Rendered without them: work them out, or pick them up if another view did since this one rendered
  useEffect(() => {
    if (!imageId || !key || exact) return
    let live = true
    void loadBandShape(imageId, invert).then((shape) => {
      if (live) setLoaded({ key, imageId, shape })
    })
    return () => {
      live = false
    }
  }, [imageId, invert, key, exact])
  if (key && !exact && loaded?.key === key && !loaded.shape) return null
  return exact ?? previous
}

/** Whether the bands start from the shape (Edge, Holes), so they need its maps */
export const fromShape = (arc: Pick<ArcEnCiel, 'flow'>) => arc.flow === 'edge' || arc.flow === 'holes'

/** Whether Arc-en-Ciel needs its shape's maps: for bands from the shape, or with Realistic on for the area it embosses */
export const needsShape = (arc: Pick<ArcEnCiel, 'flow' | 'realistic'>) => fromShape(arc) || arc.realistic === true

/** Everything Arc-en-Ciel is drawn from at a tilt, the canvas and the export alike, on the GPU or not */
export interface BandLook {
  /** Where the distances come from: a map (Edge, Holes), the nearest point (Point) or Line */
  from: 'map' | 'point' | 'line'
  field?: BandField
  /** Point's starts, or Line's controls (`curveControls`), mm from the box's top-left corner */
  spots: MmPoint[]
  /** The box, mm */
  box: [number, number]
  bandMm: number
  /** How far the bands have slid, in bands (`bandSlide`); none with Realistic on, where the ridges move them */
  slide: number
  /** The colours in linear light */
  colours: Rgb[]
  /** With Realistic on, where it is drawn as lit ridges: the light at this tilt (`arcLight`), and the area embossed */
  lit?: ArcLight
  emboss?: BandField
}

/**
 * How Arc-en-Ciel looks at a tilt: undefined while the maps it needs are on their way. Holes on a shape without any start
 * the bands from its edge, as Edge does. With `light` (Realistic on, where the GPU can draw it) it is drawn as lit ridges
 * instead of sliding, its shape's embossed area round it once that is worked out.
 */
export function bandLook(arc: ArcEnCiel, shape: BandShape | null | undefined, tilt: Tilt2, light?: ArcLight): BandLook | undefined {
  const map = fromShape(arc)
  const field = map ? (arc.flow === 'holes' && shape?.holes) || shape?.edge : undefined
  if (map && !field) return undefined
  return {
    from: map ? 'map' : arc.flow === 'point' ? 'point' : 'line',
    ...(field ? { field } : {}),
    spots: arc.flow === 'point' ? arc.points.map((spot) => spotMm(spot, arc)) : arc.flow === 'line' ? curveControls(arc) : [],
    box: [arc.widthMm, arc.heightMm],
    bandMm: arc.bandMm,
    slide: light ? 0 : bandSlide(arc, tilt),
    colours: arc.colors.map(linearRgb),
    ...(light ? { lit: light, ...(shape?.emboss ? { emboss: shape.emboss } : {}) } : {}),
  }
}

/** A map's distance at a spot on the box, mm: between pixels, it is interpolated from the four nearest, as the GPU does */
function fieldAt(field: BandField, [boxW, boxH]: [number, number], [x, y]: MmPoint) {
  const { width, height, data } = field
  const px = Math.min(Math.max((x / boxW) * width - 0.5, 0), width - 1)
  const py = Math.min(Math.max((y / boxH) * height - 0.5, 0), height - 1)
  const x0 = Math.floor(px), y0 = Math.floor(py)
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1)
  const fx = px - x0, fy = py - y0
  const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx
  const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx
  return (top * (1 - fy) + bottom * fy) * boxW
}

/** How far a spot on the box is from where the bands start, mm, as the GPU works it out */
export function bandDistance(look: BandLook, at: MmPoint, curve = look.from === 'line' ? sampleCurve(look.spots).points : []) {
  if (look.from === 'map') return look.field ? fieldAt(look.field, look.box, at) : 0
  return look.from === 'point' ? pointsDistance(look.spots, at) : lineDistance(curve, at).distance
}

/**
 * Arc-en-Ciel drawn without the GPU, `width` × `height` pixels as sRGB RGBA (as ImageData holds them), its alpha from its
 * mask (`alpha`, one byte a pixel at that size): each pixel's colour from its distance, as the GPU draws it
 */
export function bandPixels(look: BandLook, alpha: Uint8ClampedArray, width: number, height: number) {
  const out = new Uint8ClampedArray(width * height * 4)
  const curve = look.from === 'line' ? sampleCurve(look.spots).points : []
  const [boxW, boxH] = look.box
  const blur = boxW / width / look.bandMm
  const average = averageRgb(look.colours)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const a = alpha[p]
      if (a === 0) continue
      const at: MmPoint = [((x + 0.5) / width) * boxW, ((y + 0.5) / height) * boxH]
      const [r, g, b] = srgbBytes(bandColour(look.colours, bandDistance(look, at, curve) / look.bandMm - look.slide, blur, average))
      out[p * 4] = r
      out[p * 4 + 1] = g
      out[p * 4 + 2] = b
      out[p * 4 + 3] = a
    }
  }
  return out
}

/** The most pixels Arc-en-Ciel is drawn with without the GPU, on its longest side, as each is worked out one by one */
const BY_HAND_PX = 512
/** What each mask's bands were last drawn as without the GPU */
const byHand = new WeakMap<MaskSource, { key: string; field?: BandField; canvas: HTMLCanvasElement }>()

/**
 * Arc-en-Ciel drawn without the GPU, at rest (it doesn't slide, as each frame would mean working out every pixel again),
 * and plain with Realistic on: a canvas to scale into its box, up to BY_HAND_PX on its longest side for a box `width` ×
 * `height` pixels. Drawn again only when it would look different. Undefined where there is no canvas to draw on (the tests).
 */
export function bandsByHand(mask: MaskSource, look: BandLook, width: number, height: number) {
  const k = Math.min(1, BY_HAND_PX / Math.max(width, height))
  const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k))
  const { field, ...rest } = { ...look, slide: 0, lit: undefined, emboss: undefined }
  const key = `${w}×${h}|${JSON.stringify(rest)}`
  const last = byHand.get(mask)
  if (last?.key === key && last.field === field) return last.canvas
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined
  // The mask's coverage at this size, as smoothly as the canvas scales it
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(mask, 0, 0, w, h)
  const covered = ctx.getImageData(0, 0, w, h).data
  const alpha = new Uint8ClampedArray(w * h)
  for (let p = 0; p < alpha.length; p++) alpha[p] = covered[p * 4 + 3]
  ctx.putImageData(new ImageData(bandPixels({ ...look, slide: 0 }, alpha, w, h), w, h), 0, 0)
  byHand.set(mask, { key, field, canvas })
  return canvas
}

/**
 * Draws Arc-en-Ciel into a canvas of its own, its whole box at the canvas's size: on the GPU, sliding with the tilt, or
 * where it can't be (no WebGL), at rest
 */
export function paintArcEnCiel(canvas: HTMLCanvasElement, mask: MaskSource, look: BandLook) {
  if (paintBands(canvas, mask, look)) return
  const drawn = bandsByHand(mask, look, canvas.width, canvas.height)
  const ctx = canvas.getContext('2d')
  if (!drawn || !ctx) return
  ctx.globalCompositeOperation = 'copy'
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(drawn, 0, 0, canvas.width, canvas.height)
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Draws Arc-en-Ciel onto an export's banknote face at `dest`, with `size` pixels: as the canvas does, on the GPU or at rest */
export function drawArcEnCiel(target: Ctx, dest: { x: number; y: number; width: number; height: number }, mask: MaskSource, look: BandLook,
  size: { width: number; height: number }) {
  if (drawBands(target, dest, mask, look, size)) return
  const drawn = bandsByHand(mask, look, size.width, size.height)
  if (!drawn) return
  target.imageSmoothingQuality = 'high'
  target.drawImage(drawn, dest.x, dest.y, dest.width, dest.height)
  target.imageSmoothingQuality = 'low'
}
