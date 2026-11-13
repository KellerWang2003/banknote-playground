import { useEffect, useSyncExternalStore, type CSSProperties } from 'react'
import { perspectiveFor } from './frames'
import type { Tilt2 } from './lens'
import { type PlacedBox, type Size, intoBox, rotationOf } from './placed'
import { LAMP_HEIGHT_DEG, tiltMatrix, withBoxRotation } from './realisticInk'
import { type Quarter, unturn } from './rotate'

/**
 * Realistic's paper (Keller, 11 November: "a bit of lighting and treatment to the entire paper, whether it is just a faint
 * glare, or anything, just so that it would look real"; of the looks he was shown he kept "just the lamp glare", with its
 * light grain; 12 November, of that glare: "isn't that apparent ... it's moving so fast ... I think it can be bigger ... a
 * bigger thing that moves slowly", and of four looks rendered tilting in a hand he took the bigger glare with the lamp
 * shading the paper, not easing after the tilt; then, of the shading on a phone pointing its camera up, "too dim ... maybe
 * like 60% of the dimness of right now"). The lamp that lights magnetic ink and Arc-en-Ciel (realisticInk.ts, hanging
 * LAMP_HEIGHT_DEG over the viewer's head) lights the paper too:
 * - its glare, where the paper mirrors the lamp into the eye: as wide and soft as matte paper's (a Trowbridge-Reitz lobe,
 *   PAPER_GLARE.spread wide), sliding across the banknote as it tilts about the eye's distance in mm a radian (6 mm a
 *   degree on a 150 mm banknote), as real light does, but so wide that it rolls across rather than whipping past. Flat, it
 *   sits above the banknote's middle, just past a long banknote's top edge, lighting its top half; with its top tipped back
 *   by half LAMP_HEIGHT_DEG it is in the middle, where magnetic ink's bar rests too;
 * - its shading (`paperLighting`): the paper a little darker the further it lies from the lamp and the more it turns from
 *   it, LAMP_SHARE of its light being the lamp's and the rest the room's, and never lighter than flat at its middle. A
 *   screen can't show light paper any whiter, so this is what lets the glare show there;
 * - and, fixed to the paper, a light cotton grain, its fibres and a faint cloudiness.
 * The grain, the glare and the shading lie over the design, in place of the canvas's own light and shade of turning, and
 * under every security feature. Only thinner paper lets light from behind through (Keller, 13 November): the watermarks,
 * which brighten it past its shading (in Demo on a phone, the room's light: light.ts), and the paper itself a little
 * (PAPER_THROUGH). Arc-en-Ciel, magnetic ink and the thread are opaque, lit from the front only: each is shaded as the
 * paper round it, never lighter, and nothing comes through them (`featureShade`, on the GPU; the thread, a shading in its
 * windows). On the canvas (NoteView: the grain painted once, the glare one canvas per banknote that only moves, the
 * shading a small canvas painted as the tilt changes, again in the thread's windows) and in exports (`drawPaper`,
 * `drawPaperShade`) alike. In Demo on a phone all of it is lit as the phone lies in the room, not as it was held when Demo
 * began (`lightTiltOf`). The numbers are those of the look Keller picked, and are not settings.
 */

const RAD = Math.PI / 180

/**
 * The glare where the paper mirrors the lamp: how wide its lobe is, radians off the mirror's direction (the paper's
 * roughness, so mm on the paper at the eye's distance: 92 mm on a 150 mm banknote), and how white its middle is. Until 12
 * November 0.085 and 0.15, a bell curve: a spot that crossed its own width in 8° of tilt
 */
export const PAPER_GLARE = { spread: 0.28, white: 0.3 }
/** How far out the glare is drawn, in its spreads: beyond, it would be less than 0.3% white */
export const LIGHT_REACH = 3.2

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

/**
 * How white the glare is `r` of its reach out from its middle (0 to 1): Trowbridge-Reitz's lobe, as rough surfaces reflect
 * light, a soft middle with a long tail, a quarter as white one spread out
 */
export function paperLightAt(r: number) {
  const u = r * LIGHT_REACH
  const lobe = PAPER_GLARE.white / (1 + u * u) ** 2
  // Faded to nothing over the last stretch, so the drawn circle has no edge
  const edge = Math.min(1, Math.max(0, (1 - r) / 0.15))
  return lobe * edge * edge * (3 - 2 * edge)
}

/** The glare's reach on a banknote at `scale` px per mm, px: as far as it spreads at the canvas's eye (`perspectiveFor`) */
const reachPx = (note: Size, scale: number) => LIGHT_REACH * PAPER_GLARE.spread * perspectiveFor(note, 1) * scale

/** A 2D canvas `width` by `height` px (square without it) to draw on, where there is one: none outside a page */
function scratch(width: number, height = width) {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
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

/**
 * How much of the paper's light is the lamp's; the rest is the room's, the same everywhere. The paper is at most this much
 * darker, with the lamp behind it: until 12 November 0.6, which Keller found too dark on a phone pointing its camera up
 */
export const LAMP_SHARE = 0.36

/**
 * How much of the light behind the banknote comes through its paper, held to the light or, in Demo on a phone, with the
 * room's light behind it: the paper is at most this much lighter, never lighter than flat at its middle (Keller, 13
 * November: only the watermark, and later any thinner paper, shines through, "whereas maybe the rest of the banknote can
 * be just like ... a little bit transparent"). Magnetic ink, Arc-en-Ciel and the thread aren't paper, and none comes
 * through them ("they are not papery. They should be opaque")
 */
export const PAPER_THROUGH = 0.1

/**
 * The lamp's light on the paper of a banknote turned through `tilt` (turning over included), seen from `eye` mm out from
 * its middle, rotated `quarter` quarter turns on screen, the lamp staying where it is as for the glare: at a point mm from
 * the banknote's middle along its own sides (x right, y down), the room's light and the lamp's, which falls off with the
 * cosine of the angle it comes in at and the square of how far it comes, as a share of all of it flat at the middle
 */
export function paperLighting(tilt: Tilt2, eye: number, quarter: Quarter = 0): (x: number, y: number) => number {
  const m = tiltMatrix(tilt)
  const above = unturn(0, -Math.tan(LAMP_HEIGHT_DEG * RAD) * eye, quarter)
  // Flat, at the middle: the lamp LAMP_HEIGHT_DEG off straight on, eye / cos(LAMP_HEIGHT_DEG) away
  const flat = Math.cos(LAMP_HEIGHT_DEG * RAD) ** 3 / eye ** 2
  return (x, y) => {
    // From the point, turned with the banknote, to the lamp
    const dx = above.x - x * m[0] - y * m[3]
    const dy = above.y - x * m[1] - y * m[4]
    const dz = eye - x * m[2] - y * m[5]
    const facing = Math.max(0, dx * m[6] + dy * m[7] + dz * m[8])
    return 1 - LAMP_SHARE + (LAMP_SHARE * facing) / Math.hypot(dx, dy, dz) ** 3 / flat
  }
}

/** Cells along a banknote's longer side in its shading: the shading is so gradual that stretched to any size they never show */
const SHADE_CELLS = 96

/** How many cells a banknote's shading has across and down: SHADE_CELLS along its longer side */
export function shadeSize(note: Size) {
  const long = Math.max(note.widthMm, note.heightMm)
  const cells = (mm: number) => Math.max(2, Math.round((SHADE_CELLS * mm) / long))
  return { width: cells(note.widthMm), height: cells(note.heightMm) }
}

/**
 * Paints a banknote's shading at `tilt` and `quarter` (as `paperLighting`) into `canvas`, shadeSize's cells: black as
 * much as the paper there is darker than flat at its middle, clear where it is as light or lighter. `through` is the light
 * from behind coming through it (PAPER_THROUGH as far as it is held to the light), lightening it: none for the thread
 */
export function paintPaperShade(canvas: HTMLCanvasElement, note: Size, tilt: Tilt2, quarter: Quarter = 0, through = 0) {
  const g = canvas.getContext('2d')
  if (!g) return
  const { width, height } = canvas
  const lit = paperLighting(tilt, perspectiveFor(note, 1), quarter)
  const image = g.createImageData(width, height)
  for (let j = 0; j < height; j++) {
    const y = ((j + 0.5) / height - 0.5) * note.heightMm
    for (let i = 0; i < width; i++) {
      const x = ((i + 0.5) / width - 0.5) * note.widthMm
      image.data[(j * width + i) * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, 1 - lit(x, y) - through)))
    }
  }
  g.putImageData(image, 0, 0)
}

/**
 * How a feature drawn over the paper is shaded as the paper round it is (`paperLighting`), for the GPU to work out at each
 * of its pixels (inkRenderer.ts): magnetic ink and Arc-en-Ciel are opaque, lit from the front only, so they are never
 * lighter than their paper, nor lit through from behind (Keller, 13 November: "they are not papery. They should be opaque")
 */
export interface FeatureShade {
  /** The banknote's turn as the lamp lights it (`tiltMatrix`), after the box's own rotation on it (`withBoxRotation`) */
  rot: number[]
  /** The box's top-left corner along its own sides, about the banknote's middle, mm */
  origin: [number, number]
  /** Where the lamp hangs, mm from the banknote's middle before it turns, as `paperLighting` has it, and the eye's distance */
  lamp: [number, number, number]
  eye: number
  /** How much of the paper's light is the lamp's (LAMP_SHARE) */
  share: number
  /** The light from behind coming through any bare paper it draws (Arc-en-Ciel's white edge), as through the paper round it */
  through: number
}

/**
 * The shading of a feature in `box` on `note` turned through `tilt` (turning over included) as the lamp lights it, seen from
 * `eye` mm and rotated `quarter` on screen, with `through` coming through its bare paper (`paintPaperShade`)
 */
export function featureShade(
  box: Pick<PlacedBox, 'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'rotationDeg'>,
  note: Size,
  tilt: Tilt2,
  eye: number,
  quarter: Quarter = 0,
  through = 0,
): FeatureShade {
  // Rotated, its top-left corner along its own sides, about the banknote's middle, as magnetic ink's (`inkLight`)
  const middle = intoBox(box, box.xMm + box.widthMm / 2 - note.widthMm / 2, box.yMm + box.heightMm / 2 - note.heightMm / 2)
  const origin: [number, number] = rotationOf(box)
    ? [middle.x - box.widthMm / 2, middle.y - box.heightMm / 2]
    : [box.xMm - note.widthMm / 2, box.yMm - note.heightMm / 2]
  const above = unturn(0, -Math.tan(LAMP_HEIGHT_DEG * RAD) * eye, quarter)
  // + 0 turns a −0 into 0
  return { rot: withBoxRotation(tiltMatrix(tilt), box), origin, lamp: [above.x + 0, above.y + 0, eye], eye, share: LAMP_SHARE, through }
}

/**
 * The lamp's light at `p`, mm along a feature's box's own sides from its top-left corner, as `paperLighting` lights the
 * paper there: what the GPU works out from a FeatureShade, at the eye's distance for its precision
 */
export function featureLight({ rot: m, origin, lamp, eye, share }: FeatureShade, [px, py]: [number, number]) {
  const x = origin[0] + px, y = origin[1] + py
  const d = [(lamp[0] - x * m[0] - y * m[3]) / eye, (lamp[1] - x * m[1] - y * m[4]) / eye, (lamp[2] - x * m[2] - y * m[5]) / eye]
  const facing = Math.max(0, dot(d, [m[6], m[7], m[8]]))
  return 1 - share + (share * facing) / Math.hypot(d[0], d[1], d[2]) ** 3 / Math.cos(LAMP_HEIGHT_DEG * RAD) ** 3
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
 * The lamp's shading on an export's canvas, as NoteView shows it, over all of the banknote, `ctx` at its top left in px,
 * at `scale` px per mm, for the banknote turned through `tilt` on screen (turning over included) and rotated `quarter`
 */
export function drawPaperShade(ctx: Ctx, note: Size, scale: number, tilt: Tilt2, quarter: Quarter = 0, through = 0) {
  const { width, height } = shadeSize(note)
  const sheet = scratch(width, height)
  if (!sheet) return
  paintPaperShade(sheet.canvas, note, tilt, quarter, through)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sheet.canvas, 0, 0, note.widthMm * scale, note.heightMm * scale)
  ctx.restore()
}

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
