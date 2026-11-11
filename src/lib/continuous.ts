import { useEffect, useState } from 'react'
import { PAPER, mirrored, type Side } from './back'
import { clamp } from './frames'
import { loadImageUrl } from './images'
import { pictureOf, type Picture } from './imageWork'
import { type PlacedBox, boxBounds, pointInBox, rotationOf } from './placed'
import { levelsCurve, type Reading } from './relief'
import { fitSections, threadLength } from './thread'
import type { ContinuousDesign, Note, Watermark } from './types'
import { formatLength, lengthIn, type LengthUnit } from './units'

/**
 * The continuous design check (from the brief, built 3 November): a banknote's design should carry on where its edges
 * meet its neighbours' on the print sheet, the top into the bottom and the left into the right, so a cut that lands a
 * little off shows more of the same design instead of a seam. It reads the design uploaded as the banknote's
 * background as it shows there (cut to the banknote's proportions, centred, over its colour), compares each edge with
 * the one across from it and finds where they break. The cut tolerance is how far the cut may land either side of each
 * edge. The same reading checks two rules the brief sets for light paper, under the watermark and around the thread.
 * The thresholds are first guesses, to tune with Keller.
 */

/** The cut tolerance, mm (the crit said to allow 0.5 to 1 mm) */
export const CUT_MM = { min: 0, max: 5, initial: 1, step: 0.1 }

/** How far out from the banknote its neighbours show on the canvas, mm, and at most on screen, px, so they never cover it */
const NEIGHBOURS_MM = 10
const NEIGHBOURS_MAX_PX = 120

/** How far the neighbours reach out from the banknote's edges on screen, px at `scale` px per mm (ContinuousView.tsx) */
export const neighboursPx = (scale: number) => Math.min(NEIGHBOURS_MM * scale, NEIGHBOURS_MAX_PX)
/** Pixels per mm the design is read at, and the most on its longest side */
const READ_PX_PER_MM = 8
const READ_MAX_PX = 1200
/** Readings and images kept, latest first: scrubbing a size reads the design again at each step */
const KEPT = 4
/** How deep into each edge its colour is read, mm */
const EDGE_BAND_MM = 0.25
/** How far along the other edge a match may sit, mm, so a line crossing the seam a pixel off still joins */
const EDGE_REACH_MM = 0.3
/** Colour difference (OKLab) past which two edges don't join; a shade or two either way still does */
export const EDGE_BREAK = 0.06
/** Breaks closer together than this run as one, mm, and shorter ones are specks */
const BREAK_MERGE_MM = 0.5
const BREAK_MIN_MM = 0.25
/** Lightness (CIE L*, white 100) from which paper counts as light */
export const LIGHT_L = 80
/** Share of a check's paper that may be darker print */
export const DARK_ALLOWED = 0.1
/** How far around where the thread shows the paper should be light, mm: "needs to have white around it" */
export const SURROUND_MM = 2
/** Cropping under this, mm a side, is rounding */
const CROP_EPS_MM = 0.05
/** Breaks along an edge listed one by one; past this many they are counted instead */
const BREAKS_LISTED = 4

/** A saved check kept in range; anything that isn't one is dropped, so the check is off */
export function fitContinuous(raw: unknown): ContinuousDesign | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const cut = (raw as { cutMm?: unknown }).cutMm
  return { cutMm: typeof cut === 'number' && Number.isFinite(cut) ? clamp(cut, CUT_MM.min, CUT_MM.max) : CUT_MM.initial }
}

/** What decides how the design reads: the image, and the banknote's size */
interface DesignLook {
  imageId: string
  widthMm: number
  heightMm: number
}

/** The design as it shows on the banknote, RGBA, read at about READ_PX_PER_MM */
export interface DesignPixels {
  data: Uint8ClampedArray
  width: number
  height: number
  /** The banknote size it was read for, mm */
  widthMm: number
  heightMm: number
  /** How much of the image is cut off each side to fit the banknote's proportions, mm: off its left and right (x), or its top and bottom (y) */
  crop: { x: number; y: number }
}

/**
 * How an image covers the banknote, as `object-fit: cover` draws it: scaled to fill, centred, the overflow cut off.
 * The part that shows, in the image's pixels, and how much is cut off each side, in mm on the banknote.
 */
export function coverCrop(imageWidth: number, imageHeight: number, widthMm: number, heightMm: number) {
  // mm on the banknote per pixel of the image
  const k = Math.max(widthMm / imageWidth, heightMm / imageHeight)
  const sw = widthMm / k
  const sh = heightMm / k
  return {
    sx: (imageWidth - sw) / 2,
    sy: (imageHeight - sh) / 2,
    sw,
    sh,
    crop: { x: Math.max(0, (imageWidth * k - widthMm) / 2), y: Math.max(0, (imageHeight * k - heightMm) / 2) },
  }
}

/** Keeps a map's latest few entries, as a map remembers the order things went in */
function keepLatest<V>(map: Map<string, V>, key: string, value: V, onDrop?: (key: string) => void) {
  map.delete(key)
  map.set(key, value)
  for (const old of [...map.keys()].slice(0, Math.max(0, map.size - KEPT))) {
    map.delete(old)
    onDrop?.(old)
  }
}

const images = new Map<string, Promise<Picture | undefined>>()
/**
 * The design is shrunk off the main thread where it can be, so a large upload doesn't freeze the page while it is
 * read, to twice the most it is read at, which leaves enough once it is cut to the banknote's proportions
 */
const SOURCE_MAX_PX = 2 * READ_MAX_PX

function imageOf(imageId: string) {
  let image = images.get(imageId)
  if (!image) {
    const loading = loadImageUrl(imageId).then((url) => (url ? pictureOf(url, SOURCE_MAX_PX, 'high') : undefined)).catch(() => undefined)
    // A failed load is tried again next time
    void loading.then((loaded) => { if (!loaded && images.get(imageId) === loading) images.delete(imageId) })
    image = loading
  }
  keepLatest(images, imageId, image)
  return image
}

async function readDesign(look: DesignLook): Promise<DesignPixels | undefined> {
  const picture = await imageOf(look.imageId)
  if (!picture) return undefined
  // SVGs without a size of their own draw at 512 px
  const imageWidth = picture.width || 512
  const imageHeight = picture.height || 512
  const k = Math.min(READ_PX_PER_MM, READ_MAX_PX / Math.max(look.widthMm, look.heightMm))
  const width = Math.max(1, Math.round(look.widthMm * k))
  const height = Math.max(1, Math.round(look.heightMm * k))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined
  const { sx, sy, sw, sh, crop } = coverCrop(imageWidth, imageHeight, look.widthMm, look.heightMm)
  // Transparent parts show the paper, as on the canvas
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(picture.source, sx, sy, sw, sh, 0, 0, width, height)
  return { data: ctx.getImageData(0, 0, width, height).data, width, height, widthMm: look.widthMm, heightMm: look.heightMm, crop }
}

const lookKey = ({ imageId, widthMm, heightMm }: DesignLook) => `${imageId}|${widthMm}|${heightMm}`
const designs = new Map<string, Promise<DesignPixels | undefined>>()
const readDesigns = new Map<string, DesignPixels>()

function loadDesign(look: DesignLook) {
  const key = lookKey(look)
  let design = designs.get(key)
  if (!design) {
    const building = readDesign(look).catch(() => undefined)
    void building.then((done) => {
      if (designs.get(key) !== building) return
      if (done) readDesigns.set(key, done)
      else designs.delete(key)
    })
    design = building
  }
  keepLatest(designs, key, design, (old) => readDesigns.delete(old))
  return design
}

/**
 * The banknote's uploaded design as it shows, once read; nothing for a side without one. While a new size is read,
 * the last reading of the same design stands in.
 */
export function useDesign(note: Pick<Note, 'background' | 'faceImageId' | 'widthMm' | 'heightMm'>): DesignPixels | undefined {
  const imageId = note.background === 'image' ? note.faceImageId : undefined
  const { widthMm, heightMm } = note
  const key = imageId ? lookKey({ imageId, widthMm, heightMm }) : undefined
  const [loaded, setLoaded] = useState<{ key: string; imageId: string; design?: DesignPixels }>()
  const exact = key ? readDesigns.get(key) ?? (loaded?.key === key ? loaded.design : undefined) : undefined
  const previous = imageId && loaded?.imageId === imageId ? loaded.design : undefined
  // Rendered without it: read it, or pick it up if another view did since this one rendered
  useEffect(() => {
    if (!imageId || !key || exact) return
    let live = true
    void loadDesign({ imageId, widthMm, heightMm }).then((design) => {
      if (live) setLoaded({ key, imageId, design })
    })
    return () => {
      live = false
    }
  }, [imageId, widthMm, heightMm, key, exact])
  return exact ?? previous
}

/** sRGB channel, 0 to 255, as linear light */
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

/** OKLab of a colour in linear light, written at `out[i]` to `out[i + 2]`: distances in it are how different colours look */
function toOklab(r: number, g: number, b: number, out: Float32Array, i: number) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  out[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  out[i + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  out[i + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
}

type Edge = 'top' | 'bottom' | 'left' | 'right'

/** The design's colour along one edge, averaged over its outermost `band` pixels, in OKLab: one entry a pixel along it */
function edgeColours({ data, width, height }: DesignPixels, edge: Edge, band: number) {
  const across = edge === 'top' || edge === 'bottom'
  const along = across ? width : height
  const depth = Math.max(1, Math.min(band, across ? height : width))
  const out = new Float32Array(along * 3)
  for (let p = 0; p < along; p++) {
    let r = 0
    let g = 0
    let b = 0
    for (let d = 0; d < depth; d++) {
      const x = edge === 'left' ? d : edge === 'right' ? width - 1 - d : p
      const y = edge === 'top' ? d : edge === 'bottom' ? height - 1 - d : p
      const i = (y * width + x) * 4
      r += LINEAR[data[i]]
      g += LINEAR[data[i + 1]]
      b += LINEAR[data[i + 2]]
    }
    toOklab(r / depth, g / depth, b / depth, out, p * 3)
  }
  return out
}

/** Pixels along two edges that meet where neither finds its colour on the other within `reach` pixels */
function mismatches(a: Float32Array, b: Float32Array, reach: number) {
  const n = a.length / 3
  const nearest = (from: Float32Array, to: Float32Array, p: number) => {
    let best = Infinity
    for (let q = Math.max(0, p - reach); q <= Math.min(n - 1, p + reach); q++) {
      const dl = from[p * 3] - to[q * 3]
      const da = from[p * 3 + 1] - to[q * 3 + 1]
      const db = from[p * 3 + 2] - to[q * 3 + 2]
      best = Math.min(best, dl * dl + da * da + db * db)
    }
    return best
  }
  const limit = EDGE_BREAK * EDGE_BREAK
  const out = new Uint8Array(n)
  for (let p = 0; p < n; p++) out[p] = Math.max(nearest(a, b, p), nearest(b, a, p)) > limit ? 1 : 0
  return out
}

/** A stretch along an edge, mm from its start (the left for top and bottom, the top for left and right) */
export interface Stretch {
  startMm: number
  endMm: number
}

const tenth = (mm: number) => Math.round(mm * 10) / 10

/** Runs of mismatched pixels as stretches, to the nearest 0.1 mm: close ones run together, specks go */
function stretchesOf(miss: Uint8Array, mmPerPx: number): Stretch[] {
  const runs: [number, number][] = []
  for (let p = 0; p < miss.length; p++) {
    if (!miss[p]) continue
    let q = p
    while (q + 1 < miss.length && miss[q + 1]) q++
    const last = runs.at(-1)
    if (last && (p - last[1] - 1) * mmPerPx < BREAK_MERGE_MM) last[1] = q
    else runs.push([p, q])
    p = q
  }
  return runs
    .filter(([start, end]) => (end - start + 1) * mmPerPx >= BREAK_MIN_MM)
    .map(([start, end]) => ({ startMm: tenth(start * mmPerPx), endMm: tenth((end + 1) * mmPerPx) }))
}

/** Where the design's edges don't carry on into the ones across from them */
export interface EdgeBreaks {
  /** Along the top edge, where it meets the bottom edge of the banknote above it on the sheet: mm from the left */
  topBottom: Stretch[]
  /** Along the left edge, where it meets the right edge of the banknote beside it: mm from the top */
  leftRight: Stretch[]
}

/**
 * Compares the design's top edge with its bottom edge, and its left with its right, pixel by pixel along them: where
 * the colours differ by more than EDGE_BREAK (allowing EDGE_REACH_MM along, for lines crossing at an angle), the
 * design breaks where it meets its own copy on the sheet.
 */
export function edgeBreaks(design: DesignPixels): EdgeBreaks {
  const mmX = design.widthMm / design.width
  const mmY = design.heightMm / design.height
  const bandY = Math.round(EDGE_BAND_MM / mmY)
  const bandX = Math.round(EDGE_BAND_MM / mmX)
  return {
    topBottom: stretchesOf(mismatches(edgeColours(design, 'top', bandY), edgeColours(design, 'bottom', bandY), Math.round(EDGE_REACH_MM / mmX)), mmX),
    leftRight: stretchesOf(mismatches(edgeColours(design, 'left', bandX), edgeColours(design, 'right', bandX), Math.round(EDGE_REACH_MM / mmY)), mmY),
  }
}

/** A rectangle on the banknote, mm from its top-left */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** CIE L* (white 100) of a luminance in linear light */
const lightnessOf = (y: number) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y)

/**
 * How light the paper is in some boxes, less some holes: the share of it that is darker print (under LIGHT_L), 0 to 1,
 * and how light that darker print is on average (L*). Each pixel counts by its weight (how much of the watermark's
 * light falls there), or all alike; undefined when nothing counts.
 */
export function paperLight(design: DesignPixels, boxes: Box[], holes: Box[] = [], weight?: (xMm: number, yMm: number) => number) {
  if (boxes.length === 0) return undefined
  const { data, width, height } = design
  const mmX = design.widthMm / width
  const mmY = design.heightMm / height
  const inBox = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
  // Only the pixels some box covers need looking at
  const x0 = clamp(Math.floor(Math.min(...boxes.map((b) => b.x)) / mmX), 0, width)
  const x1 = clamp(Math.ceil(Math.max(...boxes.map((b) => b.x + b.width)) / mmX), 0, width)
  const y0 = clamp(Math.floor(Math.min(...boxes.map((b) => b.y)) / mmY), 0, height)
  const y1 = clamp(Math.ceil(Math.max(...boxes.map((b) => b.y + b.height)) / mmY), 0, height)
  let total = 0
  let dark = 0
  let sum = 0
  for (let py = y0; py < y1; py++) {
    const y = (py + 0.5) * mmY
    for (let px = x0; px < x1; px++) {
      const x = (px + 0.5) * mmX
      if (!boxes.some((b) => inBox(b, x, y)) || holes.some((h) => inBox(h, x, y))) continue
      const w = weight ? weight(x, y) : 1
      if (!(w > 0)) continue
      const i = (py * width + px) * 4
      const lightness = lightnessOf(0.2126 * LINEAR[data[i]] + 0.7152 * LINEAR[data[i + 1]] + 0.0722 * LINEAR[data[i + 2]])
      total += w
      if (lightness >= LIGHT_L) continue
      dark += w
      sum += w * lightness
    }
  }
  return total > 0 ? { dark: dark / total, lightness: dark > 0 ? sum / dark : undefined } : undefined
}

/** A light check's verdict: how much of it is darker print, with how dark that print is on hover */
function lightIssues(light: ReturnType<typeof paperLight>, text: (share: string) => string): DesignIssue[] {
  if (!light?.lightness || light.dark <= DARK_ALLOWED) return []
  return [{ text: text(percent(light.dark)), title: `That print is L* ${Math.round(light.lightness)} on average; light is ${LIGHT_L} or more` }]
}

/** Where the thread shows on the banknote, mm: its whole length, or each of its windows */
export function threadBoxes(note: Pick<Note, 'thread' | 'widthMm' | 'heightMm'>): Box[] {
  const { thread } = note
  const length = threadLength(note)
  const stretches = thread.windows.enabled ? fitSections(thread.windows.sections, length).map((s) => [s.startMm, s.endMm]) : [[0, length]]
  const near = thread.positionMm - thread.widthMm / 2
  return stretches.map(([start, end]) => thread.direction === 'vertical'
    ? { x: near, y: start, width: thread.widthMm, height: end - start }
    : { x: start, y: near, width: end - start, height: thread.widthMm })
}

const grow = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by })

/**
 * How much of a watermark's light falls at a point on the banknote, 0 to 1: its image as read, through its levels, so
 * only where it shows counts. Undefined (the whole box alike) without an image read yet. Given its box as it lies seen
 * from the back (`mirror`), its image reads the other way round.
 */
export function watermarkWeight(watermark: Watermark, reading: Reading | undefined, mirror = false) {
  if (!watermark.imageId || !reading || reading.width === 0 || reading.height === 0) return undefined
  const curve = levelsCurve(watermark.levels ?? reading.auto)
  const table = Float32Array.from({ length: 256 }, (_, v) => curve(v / 255))
  return (xMm: number, yMm: number) => {
    // Rotated, the point as it lies on the watermark before it turned
    const at = pointInBox(watermark, xMm, yMm)
    const across = Math.floor(((at.xMm - watermark.xMm) / watermark.widthMm) * reading.width)
    const u = mirror ? reading.width - 1 - across : across
    const v = Math.floor(((at.yMm - watermark.yMm) / watermark.heightMm) * reading.height)
    return u < 0 || v < 0 || u >= reading.width || v >= reading.height ? 0 : table[reading.thin[v * reading.width + u]]
  }
}

/** A rotated box's own shape on the banknote, for what reads under it: 1 within it as it turned, 0 past it; nothing upright */
const withinTurned = (box: PlacedBox) => {
  if (!rotationOf(box)) return undefined
  return (xMm: number, yMm: number) => {
    const at = pointInBox(box, xMm, yMm)
    return at.xMm >= box.xMm && at.xMm < box.xMm + box.widthMm && at.yMm >= box.yMm && at.yMm < box.yMm + box.heightMm ? 1 : 0
  }
}

export interface DesignIssue {
  text: string
  /** More on hover */
  title?: string
}

/** One rule the design is checked against; like the thread's rules, they only ever warn */
export interface DesignCheck {
  id: 'trim' | 'top' | 'side' | 'watermark' | 'thread'
  title: string
  /** The rule in a line, on hover */
  explain: string
  issues: DesignIssue[]
}

const percent = (share: number) => `${Math.round(share * 100)}%`

/** Breaks along one edge, a line each; past a few, how many and how much of the edge (the canvas marks them all) */
function breakIssues(stretches: Stretch[], edgeMm: number, from: string, unit: LengthUnit): DesignIssue[] {
  if (stretches.length > BREAKS_LISTED) {
    const broken = stretches.reduce((sum, s) => sum + s.endMm - s.startMm, 0) / edgeMm
    return [{ text: `Breaks in ${stretches.length} places, ${percent(broken)} of its length` }]
  }
  return stretches.map((s) => ({ text: `${lengthIn(s.startMm, unit)} to ${formatLength(s.endMm, unit)} from the ${from}` }))
}

/**
 * Every check the design takes: with Continuous on, that it is at the banknote's size and its edges join up; then that
 * the paper under the watermark, if any, and around the thread is light. The back's design (`side`) has the watermark
 * the other way round and no thread to check round.
 */
export function designChecks(note: Note, design: DesignPixels, reading: Reading | undefined, unit: LengthUnit, side: Side = 'front'): DesignCheck[] {
  const checks: DesignCheck[] = []
  if (note.continuous) {
    const { crop } = design
    const breaks = edgeBreaks(design)
    checks.push(
      {
        id: 'trim',
        title: "At the banknote's size",
        explain: "The design has the banknote's proportions, so none of it is cut off to fit and its own edges are the ones that meet",
        issues: crop.y > CROP_EPS_MM ? [{ text: `${formatLength(crop.y, unit)} cut off its top and bottom to fit` }]
          : crop.x > CROP_EPS_MM ? [{ text: `${formatLength(crop.x, unit)} cut off its left and right to fit` }] : [],
      },
      {
        id: 'top',
        title: 'Top joins bottom',
        explain: 'The top edge carries on into the bottom edge, where it meets the banknote above it on the print sheet',
        issues: breakIssues(breaks.topBottom, design.widthMm, 'left', unit),
      },
      {
        id: 'side',
        title: 'Left joins right',
        explain: 'The left edge carries on into the right edge, where it meets the banknote beside it on the print sheet',
        issues: breakIssues(breaks.leftRight, design.heightMm, 'top', unit),
      },
    )
  }
  if (note.watermark) {
    // It shows through to the back, where it lies the other way round
    const back = side === 'back'
    const watermark = back ? mirrored(note.watermark, note) : note.watermark
    // All it covers, rotated or not, read within its own shape
    const box = boxBounds(watermark)
    checks.push({
      id: 'watermark',
      title: 'Watermark on light paper',
      explain: `The design under the watermark is light (L* ${LIGHT_L} or more), as the brief asks, so it shows held to the light`,
      issues: lightIssues(paperLight(design, [box], [], watermarkWeight(watermark, reading, back) ?? withinTurned(watermark)), (share) => `${share} of it is over darker print`),
    })
  }
  // Nothing round a thread the side doesn't have
  if (side === 'back' || note.noThread) return checks
  const thread = threadBoxes(note)
  const around = paperLight(design, thread.map((box) => grow(box, SURROUND_MM)), thread)
  if (around) {
    checks.push({
      id: 'thread',
      title: 'Light paper around the thread',
      explain: `The design within ${formatLength(SURROUND_MM, unit)} of where the thread shows is light (L* ${LIGHT_L} or more): the brief asks for white around it`,
      issues: lightIssues(around, (share) => `${share} of it is darker print`),
    })
  }
  return checks
}

/** Checks with something wrong, for the drawer's count */
export const failingChecks = (checks: DesignCheck[]) => checks.filter((c) => c.issues.length > 0).length
