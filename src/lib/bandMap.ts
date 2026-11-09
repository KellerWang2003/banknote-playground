import { useEffect, useState } from 'react'
import {
  ARC_EMBOSS_MM, ARC_ROUNDING, type ArcLight, type MmPoint, type Rgb, averageRgb, bandColour, bandSlide, curveControls, lineDistance,
  linearRgb, pointsDistance, sampleCurve, spotMm, srgbBytes,
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
 * its own, since each pixel goes by the edge nearest it. Deeper in, the distances are rounded (`roundedField`), so rings
 * near an edge follow it and deeper ones round off its corners rather than meet in sharp tips and seams, as printed rings
 * do (Keller, 9 November). Point and Line need no map: their distances are worked out as they are drawn. Tilting only
 * slides the bands along these distances (`bandSlide`), so a map is never redrawn for a tilt. With Realistic on, how far
 * the paper round the shape lies from it is worked out with them, for the outline the intaglio plate embosses round it
 * (`outlineField`), whatever the bands start from.
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
  /** Pixels it reaches past the image all round, for paper beyond its edges (the outline's); none for the others */
  pad?: number
}

/** An image's maps, read the way Invert says */
export interface BandShape {
  key: string
  /** How far each pixel lies inside the shape from its nearest edge (0 outside it) */
  edge: BandField
  /** How far each pixel lies from the nearest hole in the shape; none when it has no holes */
  holes?: BandField
  /** How far each pixel lies from the shape, reaching past the image (`outlineField`, 0 in it); none when nothing is in the shape */
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
 * The normal curve's inverse: the z under which a share `p` of it lies, to about one part in a billion (Peter Acklam's
 * rational approximation)
 */
export function normalQuantile(p: number) {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  if (p < 0.02425 || p > 0.97575) {
    const q = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p))
    const z = (((((-7.784894002430293e-3 * q - 3.223964580411365e-1) * q - 2.400758277161838) * q - 2.549732539343734) * q + 4.374664141464968) * q + 2.938163982698783)
      / ((((7.784695709041462e-3 * q + 3.224671290700398e-1) * q + 2.445134137142996) * q + 3.754408661907416) * q + 1)
    return p < 0.5 ? z : -z
  }
  const q = p - 0.5
  const r = q * q
  return (((((-3.969683028665376e1 * r + 2.209460984245205e2) * r - 2.759285104469687e2) * r + 1.38357751867269e2) * r - 3.066479806614716e1) * r + 2.506628277459239) * q
    / (((((-5.447609879822406e1 * r + 1.615858368580409e2) * r - 1.556989798598866e2) * r + 6.680131188771972e1) * r - 1.328068155288572e1) * r + 1)
}

/** A grid blurred by a Gaussian `sigma` px wide, along its rows and then down its columns, `outside` everywhere beyond it */
function gaussianBlur(grid: Float64Array, width: number, height: number, sigma: number, outside: number) {
  const reach = Math.max(1, Math.ceil(4.5 * sigma))
  const taps = 2 * reach + 1
  const kernel = new Float64Array(taps)
  let total = 0
  for (let i = 0; i < taps; i++) total += kernel[i] = Math.exp(-((i - reach) ** 2) / (2 * sigma * sigma))
  for (let i = 0; i < taps; i++) kernel[i] /= total
  // Each line copied out with `outside` either side of it first, so the sums never look past its ends
  const line = new Float64Array(Math.max(width, height) + 2 * reach)
  const pass = (from: Float64Array, n: number, lines: number, step: number, next: number) => {
    const to = new Float64Array(from.length)
    line.fill(outside)
    for (let l = 0; l < lines; l++) {
      const base = l * next
      for (let i = 0; i < n; i++) line[reach + i] = from[base + i * step]
      line.fill(outside, reach + n, n + 2 * reach)
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (let k = 0; k < taps; k++) sum += kernel[k] * line[i + k]
        to[base + i * step] = sum
      }
    }
    return to
  }
  return pass(pass(grid, width, height, 1, width), height, width, width, 1)
}

/** The finest Gaussian the distances are rounded through, px, each next one this much wider */
const ROUND_FROM_PX = 2
const ROUND_GROWTH = 1.4

/**
 * A field from distances to seeds on the shape's grid with a border of paper round it (`width` + 2 across): how far each
 * pixel's middle lies from the seeds' edge (half a pixel nearer than their middles), in box widths, 0 on them, rounded
 * deeper in (ARC_ROUNDING), as printed rings are: each pixel's distance is measured through a Gaussian as wide as
 * ARC_ROUNDING of it, from how much of the Gaussian round the pixel falls on the seeds, turned back into a distance through
 * the normal curve. A straight edge gives exactly its distance, so rings near the edges follow them; at a corner less of
 * the Gaussian reaches the seeds, so deeper rings round it off, its radius about ARC_ROUNDING of how deep it is; the middle
 * of a narrow stretch loses a little of its depth, with no flat top. The Gaussians are a few, each 1.4 times as wide as the
 * last, worked out on grids coarser as they widen, each pixel taking the two either side of the width it needs. Pixels so
 * near the seeds that the finest is wide enough (under 4 px or so) keep their exact distance.
 */
function roundedField(seeds: Uint8Array, width: number, height: number, within?: Uint8Array): BandField {
  const w = width + 2, h = height + 2
  const squared = squaredDistances(seeds, w, h)
  const result = new Float64Array(w * h)
  let deepest = 0
  // The pixels still to work out (only those `within`, where given: the rest keep their exact distance), with the last
  // Gaussian's distance and its width over that distance
  let active = new Int32Array(w * h)
  let count = 0
  for (let i = 0; i < seeds.length; i++) {
    if (seeds[i]) continue
    const d = Math.max(0, Math.sqrt(squared[i]) - 0.5)
    result[i] = d
    if (within && !within[i]) continue
    if (d > deepest) deepest = d
    active[count++] = i
  }
  const lastPhi = new Float64Array(w * h)
  const lastRatio = new Float64Array(w * h)
  // Beyond the grid as at its corner: paper round the shape, or no hole
  const outside = seeds[0] ? 1 : 0
  const k = ARC_ROUNDING
  for (let level = 0, sigma = ROUND_FROM_PX; count > 0; level++, sigma *= ROUND_GROWTH) {
    // On a grid about half as coarse as the Gaussian is wide: the seeds' share of each cell, beyond the grid `outside`,
    // and the Gaussian there narrower by as much as the cells spread them
    const step = Math.max(1, Math.ceil(sigma / 2))
    const cw = Math.ceil(w / step), ch = Math.ceil(h / step)
    const cells = new Float64Array(cw * ch)
    if (step === 1) cells.set(seeds)
    else {
      for (let y = 0; y < ch * step; y++) {
        const row = ((y / step) | 0) * cw
        for (let x = 0; x < cw * step; x++) cells[row + ((x / step) | 0)] += x < w && y < h ? seeds[y * w + x] : outside
      }
      for (let i = 0; i < cells.length; i++) cells[i] /= step * step
    }
    const blurred = gaussianBlur(cells, cw, ch, Math.sqrt((sigma / step) ** 2 - (1 - 1 / (step * step)) / 12), outside)
    // Through the normal curve, where a straight edge makes it change evenly, so it can be interpolated between cells
    const z = blurred
    for (let i = 0; i < z.length; i++) z[i] = normalQuantile(Math.min(Math.max(z[i], 1e-300), 1 - 1e-16))
    const last = sigma >= k * deepest
    // Which cells each column and row of pixels lies between, and how far along
    const between = (n: number, cells: number) => {
      const lo = new Int32Array(n), hi = new Int32Array(n), t = new Float64Array(n)
      for (let x = 0; x < n; x++) {
        const f = Math.min(Math.max((x + 0.5) / step - 0.5, 0), cells - 1)
        lo[x] = Math.floor(f)
        hi[x] = Math.min(lo[x] + 1, cells - 1)
        t[x] = f - lo[x]
      }
      return { lo, hi, t }
    }
    const cols = between(w, cw), rows = between(h, ch)
    let kept = 0
    for (let a = 0; a < count; a++) {
      const i = active[a]
      let zi: number
      if (step === 1) zi = z[i]
      else {
        const x = i % w, y = (i - x) / w
        const top = rows.lo[y] * cw, bottom = rows.hi[y] * cw, tx = cols.t[x], ty = rows.t[y]
        const x0 = cols.lo[x], x1 = cols.hi[x]
        zi = (z[top + x0] * (1 - tx) + z[top + x1] * tx) * (1 - ty) + (z[bottom + x0] * (1 - tx) + z[bottom + x1] * tx) * ty
      }
      const phi = -sigma * zi
      const ratio = phi > 0 ? sigma / phi : Infinity
      if (ratio >= k) {
        // So near the seeds the finest is already wide enough: the exact distance, kept
        if (level > 0) {
          const t = Math.min(Math.max((k - lastRatio[i]) / (ratio - lastRatio[i]), 0), 1)
          result[i] = lastPhi[i] + (Number.isFinite(t) ? t : 1) * (phi - lastPhi[i])
        }
      } else if (last) {
        // Deeper than the widest reaches
        result[i] = phi
      } else {
        lastPhi[i] = phi
        lastRatio[i] = ratio
        active[kept++] = i
      }
    }
    count = kept
    if (last) break
    if (kept < active.length / 4) active = active.slice(0, kept)
  }
  const data = new Float32Array(width * height)
  let max = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = result[(y + 1) * w + x + 1]
      const d = Number.isFinite(v) ? Math.max(0, v) / width : 0
      data[y * width + x] = d
      if (d > max) max = d
    }
  }
  return { width, height, data, max }
}

/** How far the outline's map reaches past the image all round, as a share of its longest side: room for the embossed outline round a shape up to the image's edge */
const OUTLINE_PAD = 0.15

/**
 * How far the paper lies from the shape, for the outline the intaglio plate embosses round it with Realistic on, ARC_EMBOSS_MM
 * wide all round it as Oberthur's brochure shows (Keller, 9 November), its holes and bays too where they are as narrow:
 * from each pixel's middle to the shape's nearest edge, in box widths, 0 in it, over the image and OUTLINE_PAD of its longest
 * side past it all round (`pad`), as the outline can reach past the image. Read from half coverage, as `shapeMaps` reads
 * the shape. Undefined when nothing is in the shape.
 */
export function outlineField(coverage: Uint8ClampedArray, width: number, height: number): BandField | undefined {
  const pad = Math.max(1, Math.ceil(OUTLINE_PAD * Math.max(width, height)))
  const w = width + 2 * pad, h = height + 2 * pad
  const seeds = new Uint8Array(w * h)
  let any = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (coverage[y * width + x] < 128) continue
      seeds[(y + pad) * w + x + pad] = 1
      any = true
    }
  }
  if (!any) return undefined
  const squared = squaredDistances(seeds, w, h)
  const data = new Float32Array(w * h)
  let max = 0
  for (let i = 0; i < data.length; i++) {
    const d = Math.max(0, Math.sqrt(squared[i]) - 0.5) / width
    data[i] = d
    if (d > max) max = d
  }
  return { width: w, height: h, data, max, pad }
}

/**
 * How far, mm, the embossed outline reaches past Arc-en-Ciel's box all round: ARC_EMBOSS_MM, or as far as its map reaches
 * past the image where that is less (a box under 7 mm or so across). None without one
 */
export function embossOutset(box: { widthMm: number; heightMm: number }, emboss: BandField | undefined) {
  if (!emboss?.pad) return 0
  const inner = { width: emboss.width - 2 * emboss.pad, height: emboss.height - 2 * emboss.pad }
  return Math.min(ARC_EMBOSS_MM, (emboss.pad * box.widthMm) / inner.width, (emboss.pad * box.heightMm) / inner.height)
}

/**
 * The maps for a shape, from how much ink each pixel takes (0 to 255, one byte a pixel, `inkCoverage`): a pixel is in the
 * shape from half coverage. Beyond the image is paper, so a shape cut by its edge has an edge there. Holes are paper the
 * shape closes round: paper that can't reach the image's edge without crossing the shape. Both are rounded deeper in
 * (`roundedField`). How far the paper round the shape lies from it, for the outline Realistic embosses, comes with them
 * (`outlineField`).
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
  const emboss = outlineField(coverage, width, height)
  return {
    key,
    edge: roundedField(paper, width, height),
    // Only in the shape, where they are drawn
    ...(anyHole ? { holes: roundedField(holes, width, height, inShape) } : {}),
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
  /** With Realistic on, where it is drawn as lit ridges: the light at this tilt (`arcLight`), and how far the paper lies from the shape, for the embossed outline */
  lit?: ArcLight
  emboss?: BandField
  /** How far, mm, the drawing reaches past the box all round, for the embossed outline (`embossOutset`); none without it */
  outset?: number
}

/**
 * How Arc-en-Ciel looks at a tilt: undefined while the maps it needs are on their way. Holes on a shape without any start
 * the bands from its edge, as Edge does. With `light` (Realistic on, where the GPU can draw it) it is drawn as lit ridges
 * instead of sliding, with the outline embossed round its shape once that is worked out, reaching past its box.
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
    ...(light ? { lit: light, ...(shape?.emboss ? { emboss: shape.emboss, outset: embossOutset(arc, shape.emboss) } : {}) } : {}),
  }
}

/** Where Arc-en-Ciel's box lies in a drawing of it that reaches `look.outset` past it all round, drawn at `dest` */
export function boxIn(dest: { x: number; y: number; width: number; height: number }, look: BandLook) {
  const o = look.outset ?? 0
  if (!o) return dest
  const [w, h] = look.box
  const kx = dest.width / (w + 2 * o), ky = dest.height / (h + 2 * o)
  return { x: dest.x + o * kx, y: dest.y + o * ky, width: w * kx, height: h * ky }
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
  const box = boxIn({ x: 0, y: 0, width: canvas.width, height: canvas.height }, look)
  const drawn = bandsByHand(mask, look, Math.round(box.width), Math.round(box.height))
  const ctx = canvas.getContext('2d')
  if (!drawn || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(drawn, box.x, box.y, box.width, box.height)
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Draws Arc-en-Ciel onto an export's banknote face at `dest`, with `size` pixels: as the canvas does, on the GPU or at rest */
export function drawArcEnCiel(target: Ctx, dest: { x: number; y: number; width: number; height: number }, mask: MaskSource, look: BandLook,
  size: { width: number; height: number }) {
  if (drawBands(target, dest, mask, look, size)) return
  const box = boxIn(dest, look)
  const drawn = bandsByHand(mask, look, Math.round((size.width * box.width) / dest.width), Math.round((size.height * box.height) / dest.height))
  if (!drawn) return
  target.imageSmoothingQuality = 'high'
  target.drawImage(drawn, box.x, box.y, box.width, box.height)
  target.imageSmoothingQuality = 'low'
}
