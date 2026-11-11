import { useEffect, useSyncExternalStore, type CSSProperties } from 'react'
import { perspectiveFor } from './frames'
import type { Tilt2 } from './lens'
import type { Size } from './placed'
import { LAMP_HEIGHT_DEG, tiltMatrix } from './realisticInk'
import { type Quarter, unturn } from './rotate'

/**
 * Realistic's paper (Keller, 11 November: "a bit of lighting and treatment to the entire paper, whether it is just a faint
 * glare, or anything, just so that it would look real"; of the looks he was shown he kept "just the lamp glare", with its
 * light grain). The lamp that lights magnetic ink and Arc-en-Ciel (realisticInk.ts, hanging LAMP_HEIGHT_DEG over the
 * viewer's head) shines off the paper too: a soft glare where the paper mirrors it into the eye, sliding across the banknote
 * as it tilts, about the eye's distance in mm a radian (6 mm a degree on a 150 mm banknote). Flat, it sits above the
 * banknote's middle, just past a long banknote's top edge; with its top tipped back by half LAMP_HEIGHT_DEG it is in the
 * middle, where magnetic ink's bar rests too. And the paper has a light cotton grain, its fibres and a faint cloudiness,
 * fixed to it. Both lie over the design and under every security feature, which has its own light, on the canvas (NoteView:
 * the grain painted once, the glare one small canvas per banknote that only moves) and in exports (`drawPaper`) alike. The
 * numbers are those of the mockup Keller picked from (its look B), and are not settings.
 */

const RAD = Math.PI / 180

/**
 * The glare where the paper mirrors the lamp: how far it spreads, radians off the mirror's direction (the paper's
 * roughness, so mm on the paper at the eye's distance), and how white its middle is
 */
export const PAPER_GLARE = { spread: 0.085, white: 0.15 }
/** How far out the glare is drawn, in its spreads: beyond, it would be less than 0.2% white */
export const LIGHT_REACH = 2.2

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * Where the paper mirrors the lamp into the eye, on a banknote turned through `tilt` (turning over included) and seen
 * from `eye` mm out from its middle, with the banknotes rotated `quarter` quarter turns on screen, the lamp and the eye
 * staying where they are as they do for magnetic ink (`inkLight`): mm from the banknote's middle along its own sides (x
 * right, y down). None once the lamp or the eye is behind the paper.
 */
export function lampMirror(tilt: Tilt2, eye: number, quarter: Quarter = 0): { x: number; y: number } | undefined {
  const m = tiltMatrix(tilt)
  const facing = [m[6], m[7], m[8]]
  const above = unturn(0, -Math.tan(LAMP_HEIGHT_DEG * RAD) * eye, quarter)
  const lamp = [above.x, above.y, eye]
  const viewer = [0, 0, eye]
  const lampOut = dot(lamp, facing)
  const eyeOut = dot(viewer, facing)
  if (lampOut <= 0 || eyeOut <= 0) return undefined
  // The lamp's image behind the paper, seen where the line to it from the eye crosses the paper
  const image = lamp.map((v, i) => v - 2 * lampOut * facing[i])
  const t = eyeOut / (eyeOut + lampOut)
  const at = viewer.map((v, i) => v + t * (image[i] - v))
  // + 0 turns a −0 into 0
  return { x: dot(at, [m[0], m[1], m[2]]) + 0, y: dot(at, [m[3], m[4], m[5]]) + 0 }
}

/** How much further the light reaches along each of a banknote's sides at `tilt`, as a reflection stretches seen aslant */
export const lightStretch = (tilt: Tilt2) => ({ x: 1 / Math.max(Math.cos(tilt.x * RAD), 0.5), y: 1 / Math.max(Math.cos(tilt.y * RAD), 0.5) })

/** How white the glare is `r` of its reach out from its middle (0 to 1): a bell curve */
export function paperLightAt(r: number) {
  const bell = PAPER_GLARE.white * Math.exp(-((r * LIGHT_REACH) ** 2))
  // Faded to nothing over the last stretch, so the drawn circle has no edge
  const edge = Math.min(1, Math.max(0, (1 - r) / 0.15))
  return bell * edge * edge * (3 - 2 * edge)
}

/** The glare's reach on a banknote at `scale` px per mm, px: as far as it spreads at the canvas's eye (`perspectiveFor`) */
const reachPx = (note: Size, scale: number) => LIGHT_REACH * PAPER_GLARE.spread * perspectiveFor(note, 1) * scale

/** A 2D canvas `size` px square to draw on, where there is one: none outside a page */
function scratch(size: number) {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  return g ? { canvas, g } : undefined
}

/** Pixels across the light's image: it is soft enough for the GPU to stretch it to any size without showing them */
export const LIGHT_PX = 256

/** Every banknote's light draws from this one image */
let lightImage: HTMLCanvasElement | null | undefined

/** The paper's light as an image, white over clear, made once; none where there is no 2D canvas */
export function paperLightImage(): HTMLCanvasElement | undefined {
  if (lightImage === undefined) {
    const sheet = scratch(LIGHT_PX)
    lightImage = null
    if (sheet) {
      const { canvas, g } = sheet
      const image = g.createImageData(LIGHT_PX, LIGHT_PX)
      const half = LIGHT_PX / 2
      for (let y = 0; y < LIGHT_PX; y++) {
        for (let x = 0; x < LIGHT_PX; x++) {
          const i = (y * LIGHT_PX + x) * 4
          image.data[i] = image.data[i + 1] = image.data[i + 2] = 255
          image.data[i + 3] = Math.round(255 * paperLightAt(Math.hypot(x + 0.5 - half, y + 0.5 - half) / half))
        }
      }
      g.putImageData(image, 0, 0)
      lightImage = canvas
    }
  }
  return lightImage ?? undefined
}

/** Paints the paper's light into a banknote's own canvas, LIGHT_PX square */
export function paintPaperLight(canvas: HTMLCanvasElement) {
  const image = paperLightImage()
  const g = image && canvas.getContext('2d')
  if (!image || !g) return
  g.clearRect(0, 0, canvas.width, canvas.height)
  g.drawImage(image, 0, 0, canvas.width, canvas.height)
}

/** Where the light's canvas lies on a banknote at `scale` px per mm, before it moves: square round the banknote's middle */
export function lightBox(note: Size, scale: number): CSSProperties {
  const reach = reachPx(note, scale)
  return { left: (note.widthMm * scale) / 2 - reach, top: (note.heightMm * scale) / 2 - reach, width: 2 * reach, height: 2 * reach }
}

/**
 * The light's move for a banknote at `scale` px per mm, turned through `tilt` on screen and rotated `quarter` quarter
 * turns: to where the paper mirrors the lamp, stretched as seen aslant; hidden while the lamp or the eye is behind the paper
 */
export function lightMove(note: Size, scale: number, tilt: Tilt2, quarter: Quarter): Pick<CSSProperties, 'transform' | 'opacity'> {
  const at = lampMirror(tilt, perspectiveFor(note, 1), quarter)
  if (!at) return { opacity: 0 }
  const stretch = lightStretch(tilt)
  return {
    opacity: 1,
    transform: `translate(${(at.x * scale).toFixed(2)}px, ${(at.y * scale).toFixed(2)}px) scale(${stretch.x.toFixed(4)}, ${stretch.y.toFixed(4)})`,
  }
}

/** The grain's tile: GRAIN_PX across for GRAIN_TILE_MM of paper, 16 px a mm */
export const GRAIN_TILE_MM = 32
const GRAIN_PX = 512
/** The most the grain lightens or darkens the paper, light as the mockup's look B has it, and how far its height is taken towards that */
const GRAIN_LIGHT = 0.04
const GRAIN_DARK = 0.035
const GRAIN_CONTRAST = 0.4

/** The same every time: a seeded generator */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
}

/**
 * The paper's height over a tile that repeats seamlessly, of zero mean and unit spread: cotton paper's cloudiness, kept
 * faint (blobs of 4, 1.6 and 0.5 mm), a fine felt (0.2 mm), and many short, fine fibres, 0.6 to 2.8 mm long
 */
function paperHeight(): Float32Array | undefined {
  const sheet = scratch(GRAIN_PX)
  if (!sheet) return undefined
  const { g } = sheet
  const random = seeded(1787)
  const height = new Float32Array(GRAIN_PX * GRAIN_PX)
  const noise = (cells: number, amount: number) => {
    const at = Float32Array.from({ length: cells * cells }, () => random() * 2 - 1)
    const value = (i: number, j: number) => at[(j % cells) * cells + (i % cells)]
    for (let y = 0; y < GRAIN_PX; y++) {
      const fy = (y / GRAIN_PX) * cells, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty)
      for (let x = 0; x < GRAIN_PX; x++) {
        const fx = (x / GRAIN_PX) * cells, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx)
        const top = value(x0, y0) * (1 - sx) + value(x0 + 1, y0) * sx
        const bottom = value(x0, y0 + 1) * (1 - sx) + value(x0 + 1, y0 + 1) * sx
        height[y * GRAIN_PX + x] += (top * (1 - sy) + bottom * sy) * amount
      }
    }
  }
  noise(8, 0.22)
  noise(20, 0.18)
  noise(64, 0.2)
  noise(160, 0.28)
  g.fillStyle = '#000'
  g.fillRect(0, 0, GRAIN_PX, GRAIN_PX)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const pxPerMm = GRAIN_PX / GRAIN_TILE_MM
  for (let i = 0; i < 2600; i++) {
    const length = (0.6 + random() * 2.2) * pxPerMm
    const steps = Math.max(4, Math.round(length / 5))
    let x = random() * GRAIN_PX, y = random() * GRAIN_PX, turn = random() * Math.PI * 2
    const bend = (random() - 0.5) * 0.12
    const points: [number, number][] = []
    for (let k = 0; k <= steps; k++) {
      points.push([x, y])
      x += (Math.cos(turn) * length) / steps
      y += (Math.sin(turn) * length) / steps
      turn += bend + (random() - 0.5) * 0.18
    }
    g.strokeStyle = `rgba(255,255,255,${0.15 + random() * 0.35})`
    g.lineWidth = 0.45 + random() * 0.7
    // Wrapped round the tile's edges, where it crosses them, so the tile repeats seamlessly
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1])
    const across = (lo: number, hi: number) => [0, ...(lo < 2 ? [GRAIN_PX] : []), ...(hi > GRAIN_PX - 2 ? [-GRAIN_PX] : [])]
    for (const ox of across(Math.min(...xs), Math.max(...xs))) {
      for (const oy of across(Math.min(...ys), Math.max(...ys))) {
        g.beginPath()
        points.forEach(([px, py], k) => (k ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)))
        g.stroke()
      }
    }
  }
  const fibres = g.getImageData(0, 0, GRAIN_PX, GRAIN_PX).data
  for (let i = 0; i < height.length; i++) height[i] += (fibres[i * 4] / 255) * 0.9
  let mean = 0
  for (const v of height) mean += v
  mean /= height.length
  let spread = 0
  for (const v of height) spread += (v - mean) ** 2
  spread = Math.sqrt(spread / height.length) || 1
  for (let i = 0; i < height.length; i++) height[i] = (height[i] - mean) / spread
  return height
}

let grainImage: HTMLCanvasElement | null | undefined

/** The paper's grain as a tile, white where it lightens the paper and black where it darkens it, made once; none without a 2D canvas */
export function paperGrainImage(): HTMLCanvasElement | undefined {
  if (grainImage === undefined) {
    grainImage = null
    const height = paperHeight()
    const sheet = height && scratch(GRAIN_PX)
    if (height && sheet) {
      const { canvas, g } = sheet
      const image = g.createImageData(GRAIN_PX, GRAIN_PX)
      for (let i = 0; i < height.length; i++) {
        const shade = Math.max(-1, Math.min(1, height[i] * GRAIN_CONTRAST))
        image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = shade >= 0 ? 255 : 0
        image.data[i * 4 + 3] = Math.round(255 * (shade >= 0 ? shade * GRAIN_LIGHT : -shade * GRAIN_DARK))
      }
      g.putImageData(image, 0, 0)
      grainImage = canvas
    }
  }
  return grainImage ?? undefined
}

// The grain as a URL for CSS: made once, the first time it is wanted, a moment later, so switching Realistic on doesn't wait for it
let grainUrl: string | undefined
let grainWanted = false
const grainListeners = new Set<() => void>()
const subscribeGrain = (listener: () => void) => {
  grainListeners.add(listener)
  return () => grainListeners.delete(listener)
}
function wantGrain() {
  if (grainWanted) return
  grainWanted = true
  setTimeout(() => {
    paperGrainImage()?.toBlob((blob) => {
      if (!blob) return
      grainUrl = URL.createObjectURL(blob)
      for (const listener of grainListeners) listener()
    }, 'image/png')
  }, 0)
}

/** The grain's URL while `on`, once it is made (none drawn on a server, as in a test's static markup) */
export function usePaperGrain(on: boolean): string | undefined {
  const url = useSyncExternalStore(subscribeGrain, () => grainUrl, () => undefined)
  useEffect(() => {
    if (on) wantGrain()
  }, [on])
  return on ? url : undefined
}

/** The grain's tile as CSS, at `scale` px per mm */
export const grainStyle = (url: string, scale: number): CSSProperties =>
  ({ backgroundImage: `url(${url})`, backgroundSize: `${GRAIN_TILE_MM * scale}px ${GRAIN_TILE_MM * scale}px`, backgroundRepeat: 'repeat' })

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * The paper's grain and light on an export's canvas, as NoteView shows them, `ctx` at the banknote's top left in px, at
 * `scale` px per mm, for the banknote turned through `tilt` on screen (turning over included) and rotated `quarter`
 */
export function drawPaper(ctx: Ctx, note: Size, scale: number, tilt: Tilt2, quarter: Quarter = 0) {
  const grain = paperGrainImage()
  const pattern = grain && ctx.createPattern(grain, 'repeat')
  if (pattern) {
    pattern.setTransform(new DOMMatrix().scale((GRAIN_TILE_MM * scale) / GRAIN_PX))
    ctx.save()
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, note.widthMm * scale, note.heightMm * scale)
    ctx.restore()
  }
  const light = paperLightImage()
  const at = lampMirror(tilt, perspectiveFor(note, 1), quarter)
  if (light && at) {
    const reach = reachPx(note, scale)
    const stretch = lightStretch(tilt)
    ctx.save()
    ctx.translate((note.widthMm / 2 + at.x) * scale, (note.heightMm / 2 + at.y) * scale)
    ctx.scale(stretch.x, stretch.y)
    ctx.drawImage(light, -reach, -reach, 2 * reach, 2 * reach)
    ctx.restore()
  }
}
