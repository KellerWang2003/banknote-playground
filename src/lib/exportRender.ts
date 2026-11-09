import { PAPER, mirrored, showsBackAt, sideImageId, turnDeg, type Side } from './back'
import { SHADE_DEG, perspectiveFor } from './frames'
import { lensMix, type Tilt2 } from './lens'
import { watermarkOpacity, watermarkReveal } from './light'
import { lightAt, playbackPlan, tiltAt, turnAt, type PlaybackPlan } from './moves'
import { loadImageUrl } from './images'
import { patternMix, playbackLens, playbackTilt, preparePattern, sectionSpans, shownLabel } from './pattern'
import { SWEEP_SECONDS, playbackEase, playbackSettings } from './playback'
import { type Relief, exportRelief } from './relief'
import { arcLight } from './arcEnCiel'
import { type BandShape, bandLook, drawArcEnCiel, loadBandShape, needsShape } from './bandMap'
import { type InkMask, exportInkMask } from './inkMask'
import { drawLitInk } from './inkRenderer'
import { INK_BAR_LIGHT, barCentre, inkRoll, inkShift } from './magneticInk'
import { type PlacedBox, type Size, rotationOf } from './placed'
import { inkLight } from './realisticInk'
import { copyStarts, imageBox } from './artwork'
import { fitSections, threadLength } from './thread'
import { onItsSide, type Quarter } from './rotate'
import type { ArcEnCiel, Frame, MagneticInk, Note } from './types'

// Draws banknotes to a canvas exactly as NoteView shows them on the canvas, so the tilt can be exported

/** Same perspective as the canvas (frames.ts) */
export { perspectiveFor }
/** Space around and between banknotes in an export, in mm */
export const EXPORT_MARGIN_MM = 6

/** One sweep's easing at each video frame: 0 at flat, 1 at the end of the cycle, as live playback */
function sweepProgress(tilt: Note['tilt'], fps: number, sweeps: number) {
  const { speed, curve } = playbackSettings(tilt)
  const loopSeconds = (2 * SWEEP_SECONDS) / speed
  const count = Math.max(1, Math.round(loopSeconds * sweeps * fps))
  return Array.from({ length: count }, (_, i) => {
    const phase = (((i / fps) % loopSeconds) * speed) / SWEEP_SECONDS
    return playbackEase(phase <= 1 ? phase : 2 - phase, curve)
  })
}

/**
 * The angle of every video frame for `loops` passes of up/down playback: flat, up through the cycle, back to
 * flat, with the project's speed and curve. Uses the same maths as live playback.
 */
export function playbackAngles(tilt: Note['tilt'], fps: number, loops = 1) {
  return sweepProgress(tilt, fps, loops).map((k) => Math.max(0, tilt.cycleDeg) * k)
}

type PlaybackNote = Pick<Note, 'tilt' | 'frames' | 'pattern'>
const planOf = (note: PlaybackNote) => playbackPlan(playbackTilt(note), playbackLens(note))

/**
 * Video frames in `loops` loops of the project's playback. A playlist that leaves the banknotes on their other side (an
 * odd number of Flips) plays twice a loop, so a video ends, and a GIF comes round, on the side it began
 */
const frameCount = (plan: PlaybackPlan, fps: number, loops: number) =>
  Math.max(1, Math.round(plan.seconds * loops * (plan.flips.length % 2 ? 2 : 1) * fps))

/** The tilt of every video frame for `loops` loops of the project's playback moves, exactly as live playback */
export function playbackTilts(note: PlaybackNote, fps: number, loops = 1): Tilt2[] {
  const plan = planOf(note)
  return Array.from({ length: frameCount(plan, fps, loops) }, (_, i) => tiltAt(plan, i / fps))
}

/** How far the banknotes are held to the light at every video frame, matching playbackTilts frame for frame */
export function playbackLights(note: PlaybackNote, fps: number, loops = 1): number[] {
  const plan = planOf(note)
  return Array.from({ length: frameCount(plan, fps, loops) }, (_, i) => lightAt(plan, i / fps))
}

/**
 * How far the banknotes are turned over at every video frame, 0 (front) to 1 (back), matching playbackTilts frame for
 * frame: from their backs (`back`, as the canvas shows them turned over) or fronts, Flip moves turning them as live
 */
export function playbackTurns(note: PlaybackNote, fps: number, loops = 1, back = false): number[] {
  const plan = planOf(note)
  return Array.from({ length: frameCount(plan, fps, loops) }, (_, i) => turnAt(plan, i / fps, back))
}

/** Whether the project's playback turns the banknotes over: its playlist has a Flip */
export const turnsOver = (note: PlaybackNote) => planOf(note).flips.length > 0

const asTilt = (t: Tilt2 | number): Tilt2 => (typeof t === 'number' ? { x: 0, y: t } : t)

/** What a banknote turns through on screen: its tilt, and turning over added to its side tilt, as NoteView adds it to rotateY */
const withTurn = (tilt: Tilt2 | number, turn: number): Tilt2 => {
  const { x, y } = asTilt(tilt)
  return { x: x + turnDeg(turn), y }
}

/** What every video frame turns the banknotes through on screen (`withTurn`), for laying them out with room for it */
export function playbackViews(note: PlaybackNote, fps: number, loops = 1, back = false): Tilt2[] {
  const turns = playbackTurns(note, fps, loops, back)
  return playbackTilts(note, fps, loops).map((tilt, i) => withTurn(tilt, turns[i]))
}

/**
 * CSS rotateX(angle) about the note's centre under `perspective`: where a point `y` px from the centre lands
 * on screen, and how much its row is scaled. Positive angles tip the top edge away.
 */
export function projectRow(y: number, angleDeg: number, perspective: number) {
  const a = (angleDeg * Math.PI) / 180
  const depth = y * Math.sin(a)
  const s = perspective / (perspective - depth)
  return { y: y * Math.cos(a) * s, scale: s }
}

/** The inverse of projectRow: which row of the flat note shows at screen row `screenY` (from the centre) */
export function sourceRow(screenY: number, angleDeg: number, perspective: number) {
  const a = (angleDeg * Math.PI) / 180
  return (screenY * perspective) / (perspective * Math.cos(a) + screenY * Math.sin(a))
}

/**
 * The screen box a tilted note covers, relative to its centre. A side tilt is rotateY: columns behave like
 * rows do under rotateX, with the angle reversed (CSS turns the right edge away for positive angles).
 */
export function tiltedBounds(width: number, height: number, tilt: Tilt2 | number, perspective: number) {
  const { x, y } = asTilt(tilt)
  const top = projectRow(-height / 2, y, perspective)
  const bottom = projectRow(height / 2, y, perspective)
  const rows = { top: top.y, bottom: bottom.y, halfWidth: (width / 2) * Math.max(top.scale, bottom.scale) }
  if (!x) return rows
  const w = rows.halfWidth * 2
  const left = projectRow(-w / 2, -x, perspective)
  const right = projectRow(w / 2, -x, perspective)
  const grow = Math.max(left.scale, right.scale)
  return { top: rows.top * grow, bottom: rows.bottom * grow, halfWidth: Math.max(-left.y, right.y), left: left.y, right: right.y }
}

export interface NoteAssets {
  face?: HTMLImageElement
  frames: Map<string, HTMLImageElement>
  /** The watermark worked out as light through thinner paper, through its levels, colour-dodged over the design (relief.ts) */
  relief?: Relief
  /** Arc-en-Ciel's shape, the mask its bands are drawn through, and for bands from the shape its maps (bandMap.ts) */
  arc?: { mask: InkMask; shape?: BandShape }
  /** Magnetic ink's shape, the mask its colours and bar are drawn through (inkMask.ts) */
  ink?: InkMask
}
/** A banknote's assets for each side an export shows: the one it shows, or both when playback turns it over */
export type SideAssets = Partial<Record<Side, NoteAssets>>

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('An artwork image could not be loaded.'))
    img.src = url
  })
}

/** An artwork image to draw on a canvas; given `px`, the pixels it is drawn across, its display copy for that size */
export async function loadArtwork(id: string, px?: number) {
  const url = await loadImageUrl(id, px)
  return url ? loadImage(url) : undefined
}

/** Pixels a frame's image is drawn across at `scale` px per mm, once its proportions are known */
export function framePx(note: Note, frame: Frame, scale: number) {
  if (!frame.aspect) return undefined
  const box = imageBox(frame.place, frame.aspect, preparePattern(note).pattern.repeatMm, note.thread.widthMm, note.thread.direction)
  return Math.max(box.acrossSize, box.alongSize) * scale
}

/**
 * A banknote's images, ready to draw at the full resolution they were uploaded at (Keller): the originals, never display
 * copies, and the watermark, Arc-en-Ciel and magnetic ink read from the whole image, an SVG's at least as big as `scale`
 * (px per mm) draws it. For its back (`back`), only what shows there: the back's design and the watermark.
 */
export async function loadNoteAssets(note: Note, scale = 0, back = false): Promise<NoteAssets> {
  const frames = new Map<string, HTMLImageElement>()
  const drawnPx = (box: { widthMm: number; heightMm: number }) => Math.max(box.widthMm, box.heightMm) * scale
  const { watermark } = note
  const magneticInk = back ? undefined : note.magneticInk
  const arcEnCiel = back ? undefined : note.arcEnCiel
  const design = sideImageId(note, back ? 'back' : 'front')
  const [face, relief, arc, ink] = await Promise.all([
    design ? loadArtwork(design) : undefined,
    watermark?.imageId ? exportRelief({ imageId: watermark.imageId, invert: watermark.invert, levels: watermark.levels }, drawnPx(watermark)) : undefined,
    arcEnCiel?.imageId ? loadArc(arcEnCiel, arcEnCiel.imageId, drawnPx(arcEnCiel)) : undefined,
    magneticInk?.imageId ? exportInkMask(magneticInk.imageId, magneticInk.invert, drawnPx(magneticInk)) : undefined,
    ...(back ? [] : note.frames).map(async (frame) => {
      if (frame.kind !== 'image' || !frame.imageId) return
      const img = await loadArtwork(frame.imageId)
      if (img) frames.set(frame.id, img)
    }),
  ])
  return { face, frames, relief, arc, ink }
}

/**
 * Arc-en-Ciel's mask from the whole image, and the maps its bands start from or its white edge is drawn from, which need
 * no more detail than the canvas's
 */
async function loadArc(arc: ArcEnCiel, imageId: string, px: number): Promise<NoteAssets['arc']> {
  const [mask, shape] = await Promise.all([
    exportInkMask(imageId, arc.invert, px),
    needsShape(arc) ? loadBandShape(imageId, arc.invert) : undefined,
  ])
  return mask && { mask, ...(shape ? { shape } : {}) }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * Draws a placed layer turned about its box's middle as far as it is rotated on the banknote, as NoteView's CSS rotate
 * turns its box (`boxTurn`): `draw` draws it upright in its box, as before it turned
 */
function turnedAs(ctx: Ctx, box: PlacedBox, mm: (value: number) => number, draw: () => void) {
  const deg = rotationOf(box)
  if (!deg) return draw()
  const cx = mm(box.xMm + box.widthMm / 2), cy = mm(box.yMm + box.heightMm / 2)
  ctx.save()
  ctx.translate(cx, cy)
  // Counterclockwise on the banknote, which on a canvas's y-down is a negative turn
  ctx.rotate((-deg * Math.PI) / 180)
  ctx.translate(-cx, -cy)
  draw()
  ctx.restore()
}

export interface FaceOptions {
  sheen: boolean
  perspective: boolean
  /** Magnetic ink lit as metal and Arc-en-Ciel drawn as embossed ridges, as Realistic shows them on the canvas */
  realistic?: boolean
  frameNumbers?: boolean
  /** How clearly the watermark shows, 0 (faint) to 1; without it, as at this tilt in reflected light */
  reveal?: number
  /** Where along the thread the pattern's repeat starts, mm, as the canvas previews it */
  offsetMm?: number
  /** The banknote's back, as the canvas shows it turned over: its own background and the watermark, mirrored (its assets loaded for it) */
  back?: boolean
  /** How far it has turned over, 0 (front) to 1 (back), which turns realistic magnetic ink from the lamp as it shows turning (with `perspective`) */
  turn?: number
  /** Quarter turns the banknotes are rotated on screen, which realistic magnetic ink's lamp stays still through */
  quarter?: Quarter
  /** Realistic magnetic ink's grain, px across a cell (by default 1) */
  grain?: number
}

/** The flat note at `scale` px per mm, as NoteView draws it before it is turned in 3D */
export function drawFace(ctx: Ctx, note: Note, assets: NoteAssets, scale: number, tiltAt: Tilt2 | number, options: FaceOptions) {
  const { thread, frames, watermark, arcEnCiel, magneticInk } = note
  const { x: angleX, y: angle } = asTilt(tiltAt)
  const mm = (value: number) => value * scale
  const width = mm(note.widthMm), height = mm(note.heightMm)
  ctx.save()
  // Cut square at its edges, as NoteView is (Keller, 9 November: no corner radius, exports above all), the paper and its
  // design filling every corner of a still image or a video's banknote
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, width, height)

  const face = assets.face
  if (face && face.naturalWidth > 0) {
    // object-fit: cover
    const k = Math.max(width / face.naturalWidth, height / face.naturalHeight)
    const w = face.naturalWidth * k, h = face.naturalHeight * k
    ctx.drawImage(face, (width - w) / 2, (height - h) / 2, w, h)
  }
  if (watermark && assets.relief) {
    // As NoteView: light through thinner paper, colour-dodged over the design so it only brightens it and keeps the
    // note's own colours, at how much of that light comes through, under the thread
    ctx.globalCompositeOperation = 'color-dodge'
    ctx.globalAlpha = watermarkOpacity(watermark.depth, options.reveal ?? watermarkReveal(0, { x: angleX, y: angle }))
    // Scaled down as smoothly as the canvas draws it, so fine detail doesn't turn to grain
    ctx.imageSmoothingQuality = 'high'
    const light = assets.relief.canvas
    if (options.back) {
      // Seen from the back it lies the other way round, at the other side, turned the other way
      const box = mirrored(watermark, note)
      turnedAs(ctx, box, mm, () => {
        ctx.save()
        ctx.translate(mm(box.xMm + box.widthMm), mm(box.yMm))
        ctx.scale(-1, 1)
        ctx.drawImage(light, 0, 0, mm(box.widthMm), mm(box.heightMm))
        ctx.restore()
      })
    } else {
      turnedAs(ctx, watermark, mm, () => ctx.drawImage(light, mm(watermark.xMm), mm(watermark.yMm), mm(watermark.widthMm), mm(watermark.heightMm)))
    }
    ctx.imageSmoothingQuality = 'low'
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
  if (options.back) {
    // Nothing else shows on the back: no Arc-en-Ciel, no magnetic ink, no thread
    drawShade(ctx, width, height, { x: angleX, y: angle }, options.perspective)
    ctx.restore()
    return
  }
  // Realistic, lit as the canvas lights them, turned over (only as it shows turning, in perspective) and rotated as the banknote shows
  const turn = options.perspective ? options.turn : 0
  // Each turned about its middle as far as it is rotated on the banknote, as NoteView turns its box
  if (arcEnCiel && assets.arc) {
    const arc = assets.arc
    turnedAs(ctx, arcEnCiel, mm, () =>
      drawArc(ctx, arcEnCiel, arc, mm, { x: angleX, y: angle }, options.realistic ? { turn, quarter: options.quarter } : undefined))
  }
  if (magneticInk && assets.ink) {
    const ink = assets.ink
    turnedAs(ctx, magneticInk, mm, () =>
      drawInk(ctx, magneticInk, ink, mm, { x: angleX, y: angle }, options.realistic ? { note, turn, quarter: options.quarter, grain: options.grain } : undefined))
  }
  // A banknote without a thread ends there too (Keller, 4 November: the thread is added like any other feature)
  if (note.noThread) {
    drawShade(ctx, width, height, { x: angleX, y: angle }, options.perspective)
    ctx.restore()
    return
  }

  const horizontal = thread.direction === 'horizontal'
  const lengthMm = threadLength(note)
  const strip = horizontal
    ? { x: 0, y: mm(thread.positionMm - thread.widthMm / 2), w: mm(lengthMm), h: mm(thread.widthMm) }
    : { x: mm(thread.positionMm - thread.widthMm / 2), y: 0, w: mm(thread.widthMm), h: mm(lengthMm) }

  ctx.save()
  ctx.beginPath()
  if (thread.windows.enabled) {
    for (const section of fitSections(thread.windows.sections ?? [], lengthMm)) {
      const start = mm(section.startMm), end = mm(section.endMm)
      if (horizontal) ctx.rect(strip.x + start, strip.y, end - start, strip.h)
      else ctx.rect(strip.x, strip.y + start, strip.w, end - start)
    }
  } else {
    ctx.rect(strip.x, strip.y, strip.w, strip.h)
  }
  ctx.clip()
  ctx.translate(strip.x, strip.y)
  if (thread.backgroundColor) {
    ctx.fillStyle = thread.backgroundColor
    ctx.fillRect(0, 0, strip.w, strip.h)
  }

  // Each section of the pattern shows its own frames through its areas, as NoteView clips them, and each frame's image
  // sits once in every repeat from the same start
  const prepared = preparePattern(note)
  const { repeatMm } = prepared.pattern
  const offsetMm = options.offsetMm ?? 0
  const thickness = horizontal ? strip.h : strip.w
  const drawFrame = (index: number, opacity: number) => {
    const frame = frames.at(index)
    if (!frame || frame.kind === 'none') return
    ctx.globalAlpha = opacity
    if (frame.kind === 'color') {
      ctx.fillStyle = frame.color
      ctx.fillRect(0, 0, strip.w, strip.h)
    } else {
      const img = assets.frames.get(frame.id)
      if (img && img.naturalWidth > 0) {
        const box = imageBox(frame.place, frame.aspect ?? img.naturalHeight / img.naturalWidth, repeatMm, thread.widthMm, thread.direction)
        for (const start of copyStarts(box, repeatMm, offsetMm, lengthMm)) {
          if (horizontal) ctx.drawImage(img, mm(start), mm(box.across), mm(box.alongSize), mm(box.acrossSize))
          else ctx.drawImage(img, mm(box.across), mm(start), mm(box.acrossSize), mm(box.alongSize))
        }
      }
    }
    ctx.globalAlpha = 1
  }
  const mixes = prepared.plain ? [lensMix(note, { x: angleX, y: angle })] : patternMix(note, { x: angleX, y: angle })
  mixes.forEach((mix, i) => {
    const section = prepared.plain ? undefined : prepared.sections[i].section
    if (section) {
      ctx.save()
      ctx.beginPath()
      const near = thickness * section.acrossStart, far = thickness * section.acrossEnd
      for (const [lo, hi] of sectionSpans(section, repeatMm, offsetMm, lengthMm)) {
        if (horizontal) ctx.rect(mm(lo), near, mm(hi - lo), far - near)
        else ctx.rect(near, mm(lo), far - near, mm(hi - lo))
      }
      ctx.clip()
    }
    drawFrame(mix.base, 1)
    if (mix.blend > 0 && mix.next !== mix.base) drawFrame(mix.next, mix.blend)
    if (section) ctx.restore()
  })

  const t = angle / SHADE_DEG
  if (options.sheen) {
    // A highlight that travels down the thread's box as the note tilts, soft-light blended
    const at = (50 + t * 120) / 100
    const gradient = ctx.createLinearGradient(0, 0, 0, strip.h)
    const stop = (offset: number, color: string) => {
      if (offset >= 0 && offset <= 1) gradient.addColorStop(offset, color)
    }
    const clear = 'rgba(255,255,255,0)'
    const lerp = (edge: number) => `rgba(255,255,255,${0.7 * Math.max(0, 1 - Math.abs(edge - at) / 0.18)})`
    stop(0, lerp(0))
    stop(at - 0.18, clear)
    stop(at, 'rgba(255,255,255,0.7)')
    stop(at + 0.18, clear)
    stop(1, lerp(1))
    ctx.globalCompositeOperation = 'soft-light'
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, strip.w, strip.h)
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.restore()

  drawShade(ctx, width, height, { x: angleX, y: angle }, options.perspective)
  if (options.frameNumbers && frames.length > 0) drawFrameNumber(ctx, shownLabel(mixes.map((mix) => mix.current)), strip, mm)
  ctx.restore()
}

/** The light and shade a note catches as it turns, over all of it, as NoteView's shade parts (only in perspective) */
function drawShade(ctx: Ctx, width: number, height: number, tilt: Tilt2, perspective: boolean) {
  const t = tilt.y / SHADE_DEG
  if (perspective && t !== 0) {
    // The note catches a little light or shade as it turns away from flat
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    if (t < 0) {
      gradient.addColorStop(0, `rgba(255,255,255,${-t * 0.12})`)
      gradient.addColorStop(1, `rgba(0,0,0,${-t * 0.08})`)
    } else {
      gradient.addColorStop(0, `rgba(0,0,0,${t * 0.08})`)
      gradient.addColorStop(1, `rgba(255,255,255,${t * 0.12})`)
    }
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }
  const tx = tilt.x / SHADE_DEG
  if (perspective && tx !== 0) {
    // Turning sideways, as NoteView: the edge turning away darkens, the near edge catches the light
    const gradient = ctx.createLinearGradient(0, 0, width, 0)
    if (tx > 0) {
      gradient.addColorStop(0, `rgba(255,255,255,${tx * 0.12})`)
      gradient.addColorStop(1, `rgba(0,0,0,${tx * 0.08})`)
    } else {
      gradient.addColorStop(0, `rgba(0,0,0,${-tx * 0.08})`)
      gradient.addColorStop(1, `rgba(255,255,255,${-tx * 0.12})`)
    }
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }
}

/**
 * Magnetic ink as NoteView draws it, over the watermark and under the thread: its Flat colour, the Tilted one over it as
 * far as the note has turned away, and the bright bar where it has rolled, all through the ink's mask. Realistic (`lit`,
 * on its banknote), it is lit as metal by the canvas's renderer instead, turned over and rotated as the banknote shows
 * (`lit.turn`, `lit.quarter`), where the browser can.
 */
export function drawInk(
  ctx: Ctx,
  ink: MagneticInk,
  mask: Pick<InkMask, 'canvas'>,
  mm: (value: number) => number,
  tilt: Tilt2,
  lit?: { note: Size; turn?: number; quarter?: Quarter; grain?: number },
) {
  const width = Math.max(1, Math.round(mm(ink.widthMm)))
  const height = Math.max(1, Math.round(mm(ink.heightMm)))
  if (lit) {
    const view = { x: tilt.x + turnDeg(lit.turn ?? 0), y: tilt.y }
    const light = inkLight(ink, lit.note, view, perspectiveFor(lit.note, 1), lit.quarter)
    const box = { x: mm(ink.xMm), y: mm(ink.yMm), width: mm(ink.widthMm), height: mm(ink.heightMm) }
    if (drawLitInk(ctx, box, mask.canvas, light, { width, height }, lit.grain ?? 1)) return
  }
  const layer = new OffscreenCanvas(width, height)
  const lctx = layer.getContext('2d')
  if (!lctx) return
  lctx.fillStyle = ink.color
  lctx.fillRect(0, 0, width, height)
  lctx.globalAlpha = inkShift(tilt)
  lctx.fillStyle = ink.tiltedColor
  lctx.fillRect(0, 0, width, height)
  lctx.globalAlpha = 1
  // The bar, white in its middle fading out to either side, along the way it rolls
  const across = ink.barAxis === 'x'
  const along = across ? width : height
  const centre = barCentre(ink, inkRoll(ink, tilt)) * along
  const half = (ink.barWidth * along) / 2
  const bar = across ? lctx.createLinearGradient(centre - half, 0, centre + half, 0) : lctx.createLinearGradient(0, centre - half, 0, centre + half)
  bar.addColorStop(0, 'rgba(255,255,255,0)')
  bar.addColorStop(0.5, `rgba(255,255,255,${INK_BAR_LIGHT})`)
  bar.addColorStop(1, 'rgba(255,255,255,0)')
  lctx.fillStyle = bar
  if (across) lctx.fillRect(centre - half, 0, half * 2, height)
  else lctx.fillRect(0, centre - half, width, half * 2)
  // Only where the shape takes ink, scaled as smoothly as the canvas's mask
  lctx.globalCompositeOperation = 'destination-in'
  lctx.imageSmoothingQuality = 'high'
  lctx.drawImage(mask.canvas, 0, 0, width, height)
  ctx.drawImage(layer, mm(ink.xMm), mm(ink.yMm), mm(ink.widthMm), mm(ink.heightMm))
}

/**
 * Arc-en-Ciel as NoteView draws it, over the watermark and under magnetic ink: its bands slid as far as the tilt takes
 * them, through its mask, on the canvas's renderer, or at rest where the browser has no WebGL. Realistic (`lit`), its
 * ridges are lit as the canvas lights them, turned over and rotated as the banknote shows (`lit.turn`, `lit.quarter`).
 */
export function drawArc(
  ctx: Ctx,
  arc: ArcEnCiel,
  assets: NonNullable<NoteAssets['arc']>,
  mm: (value: number) => number,
  tilt: Tilt2,
  lit?: { turn?: number; quarter?: Quarter },
) {
  const light = lit ? arcLight(arc, { x: tilt.x + turnDeg(lit.turn ?? 0), y: tilt.y }, lit.quarter) : undefined
  const look = bandLook(arc, assets.shape, tilt, light)
  if (!look) return
  // The white edge reaches past the box all round
  const o = look.outset ?? 0
  const dest = { x: mm(arc.xMm - o), y: mm(arc.yMm - o), width: mm(arc.widthMm + 2 * o), height: mm(arc.heightMm + 2 * o) }
  const size = { width: Math.max(1, Math.round(dest.width)), height: Math.max(1, Math.round(dest.height)) }
  drawArcEnCiel(ctx, dest, assets.mask.canvas, look, size)
}

/** The frame-number pill NoteView shows in the middle of the thread when the # toggle is on */
function drawFrameNumber(ctx: Ctx, label: string, strip: { x: number; y: number; w: number; h: number }, mm: (value: number) => number) {
  const size = Math.max(mm(2), Math.min(strip.w, strip.h) * 0.6)
  ctx.save()
  ctx.font = `600 ${size}px 'Geist Variable', system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const pad = size * 0.3
  const w = Math.max(ctx.measureText(label).width + pad * 4, size + pad * 2)
  const h = size + pad * 2
  const cx = strip.x + strip.w / 2, cy = strip.y + strip.h / 2
  ctx.shadowColor = 'rgba(0,0,0,0.15)'
  ctx.shadowBlur = size * 0.2
  ctx.shadowOffsetY = size * 0.05
  ctx.fillStyle = 'rgba(24,24,27,0.85)'
  ctx.beginPath()
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = '#fff'
  ctx.fillText(label, cx, cy + size * 0.04)
  ctx.restore()
}

type Face = CanvasImageSource & { width: number; height: number }

/**
 * Draws a flat face centred on (cx, cy), turned by rotateX(y) and rotateY(x) under `perspective`. Each screen
 * row (or column, for a side tilt) samples its source row, so the near edge widens and the far edge narrows
 * like the CSS transform. Playback only ever turns one axis at a time.
 */
export function drawTilted(ctx: Ctx, face: Face, cx: number, cy: number, tilt: Tilt2 | number, perspective: number) {
  const { x, y } = asTilt(tilt)
  if (!x) return drawRows(ctx, face, cx, cy, y, perspective)
  let source: Face = face
  if (y) {
    // Both axes: turn the rows first on a scratch canvas big enough for the result, then the columns
    const b = tiltedBounds(face.width, face.height, y, perspective)
    const scratch = new OffscreenCanvas(Math.ceil(b.halfWidth * 2), Math.ceil(Math.max(-b.top, b.bottom) * 2))
    drawRows(scratch.getContext('2d')!, face, scratch.width / 2, scratch.height / 2, y, perspective)
    source = scratch
  }
  // Columns under rotateY(x) are rows under rotateX(−x) with the axes swapped
  ctx.save()
  ctx.translate(cx, cy)
  ctx.transform(0, 1, 1, 0, 0, 0)
  const swapped = new OffscreenCanvas(source.height, source.width)
  const sctx = swapped.getContext('2d')!
  sctx.transform(0, 1, 1, 0, 0, 0)
  sctx.drawImage(source, 0, 0)
  drawRows(ctx, swapped, 0, 0, -x, perspective)
  ctx.restore()
}

function drawRows(ctx: Ctx, face: Face, cx: number, cy: number, angle: number, perspective: number) {
  const { width, height } = face
  if (angle === 0) {
    ctx.drawImage(face, cx - width / 2, cy - height / 2)
    return
  }
  const bounds = tiltedBounds(width, height, angle, perspective)
  const first = Math.floor(bounds.top), last = Math.ceil(bounds.bottom)
  for (let row = first; row < last; row++) {
    const y = sourceRow(row + 0.5, angle, perspective) + height / 2
    if (y < 0 || y >= height) continue
    const s = projectRow(y - height / 2, angle, perspective).scale
    const top = Math.max(row, bounds.top), bottom = Math.min(row + 1, bounds.bottom)
    // One source row stretched to fill this screen row
    ctx.drawImage(face, 0, Math.floor(y), width, 1, cx - (width / 2) * s, cy + top, width * s, bottom - top)
  }
}

export interface ExportCell {
  note: Note
  /** Centre of the note in the output, px */
  cx: number
  cy: number
}

/** How far a note reaches round its centre: up (`top`, negative) and down, and as far either side (`halfWidth`) */
interface Reach { top: number; bottom: number; halfWidth: number }

/**
 * What a note reaches as it shows rotated `quarter` quarter turns clockwise about its centre (Rotate left and right): on
 * its side, its reach up and down runs across, and its reach across runs up and down
 */
export function rotatedReach(reach: Reach, quarter: Quarter = 0): Reach {
  const { top, bottom, halfWidth } = reach
  if (quarter === 2) return { top: -bottom, bottom: -top, halfWidth }
  if (quarter % 2 === 1) return { top: -halfWidth, bottom: halfWidth, halfWidth: Math.max(-top, bottom) }
  return reach
}

/**
 * Banknotes side by side in a row, each in a cell wide and tall enough for its tilted shape at every angle, rotated as
 * the canvas shows them (`quarter`), centred vertically. Sizes are even, which video encoders need.
 */
export function exportLayout(notes: Note[], scale: number, angles: (Tilt2 | number)[], perspective: boolean, quarter: Quarter = 0) {
  const margin = EXPORT_MARGIN_MM * scale
  const cells = notes.map((note) => {
    const width = note.widthMm * scale, height = note.heightMm * scale
    let top = -height / 2, bottom = height / 2, halfWidth = width / 2
    if (perspective) {
      for (const angle of angles) {
        const b = tiltedBounds(width, height, angle, perspectiveFor(note, scale))
        top = Math.min(top, b.top)
        bottom = Math.max(bottom, b.bottom)
        halfWidth = Math.max(halfWidth, b.halfWidth)
      }
    }
    return { note, ...rotatedReach({ top, bottom, halfWidth }, quarter) }
  })
  const above = Math.max(...cells.map((c) => -c.top))
  const below = Math.max(...cells.map((c) => c.bottom))
  let x = margin
  const placed: ExportCell[] = cells.map((c) => {
    const cx = x + c.halfWidth
    x = cx + c.halfWidth + margin
    return { note: c.note, cx, cy: margin + above }
  })
  // A hair of tolerance so float error never rounds an exact size up a step
  const even = (value: number) => Math.ceil(value / 2 - 1e-6) * 2
  const height = margin * 2 + above + below
  return { width: even(x), height: even(height), exactWidth: x, exactHeight: height, cells: placed }
}

/**
 * How clearly the watermark shows in an export frame: as far as it is held to the light (all the way with the lamp
 * switch on) or tilted, whichever shows it more
 */
export const exportReveal = (light: number, angle: Tilt2 | number, backlit = false) => watermarkReveal(Math.max(light, backlit ? 1 : 0), asTilt(angle))

/**
 * Renders one export frame: the background, then every banknote at tilt `angle`, held to the light by `light` (0 to 1)
 * and turned `turn` of the way over (0 front, 1 back), showing its back from halfway as the canvas does, and rotated
 * `quarter` quarter turns about its centre as the canvas shows it, its tilt still its own
 */
export function drawExportFrame(
  ctx: Ctx,
  layout: ReturnType<typeof exportLayout>,
  assets: Map<string, SideAssets>,
  faces: Map<string, OffscreenCanvas>,
  scale: number,
  angle: Tilt2 | number,
  options: Omit<FaceOptions, 'reveal' | 'offsetMm' | 'back' | 'turn' | 'grain'> & { background?: string; backlit?: boolean; offsets?: Record<string, number> },
  light = 0,
  turn = 0,
) {
  const reveal = exportReveal(light, angle, options.backlit)
  const back = showsBackAt(turn)
  // Realistic magnetic ink's grain: a cell a px up to 1080p, and wider in a bigger video, so it looks the same full screen
  const grain = Math.max(1, Math.round(layout.height / 1080))
  ctx.clearRect(0, 0, layout.width, layout.height)
  if (options.background) {
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, layout.width, layout.height)
  }
  ctx.imageSmoothingQuality = 'high'
  for (const cell of layout.cells) {
    const face = faces.get(cell.note.id)
    const noteAssets = assets.get(cell.note.id)?.[back ? 'back' : 'front']
    if (!face || !noteAssets) continue
    const faceCtx = face.getContext('2d')!
    faceCtx.clearRect(0, 0, face.width, face.height)
    drawFace(faceCtx, cell.note, noteAssets, scale, angle, { ...options, back, reveal, offsetMm: options.offsets?.[cell.note.id], turn, grain })
    const view = options.perspective ? withTurn(angle, turn) : 0
    const perspective = perspectiveFor(cell.note, scale)
    if (!options.quarter) {
      drawTilted(ctx, face, cell.cx, cell.cy, view, perspective)
      continue
    }
    // Tilted about its own axes, then rotated on screen, as the canvas turns the banknote round its 3D tilt
    ctx.save()
    ctx.translate(cell.cx, cell.cy)
    ctx.rotate((options.quarter * Math.PI) / 2)
    drawTilted(ctx, face, 0, 0, view, perspective)
    ctx.restore()
  }
}

/** The least a still image is drawn at, px per mm: 300 dpi, print quality, for a side without a design or with a small one */
export const IMAGE_MIN_PX_PER_MM = 300 / 25.4
/** Longest side of a still image, px: as big as browsers reliably make a canvas */
export const MAX_IMAGE_PX = 16384

/**
 * Px per mm a still image of a banknote is drawn at, full resolution (Keller, 9 November): its design pixel for pixel as it
 * covers the banknote (`design`, the image's own size as uploaded), never under print quality (IMAGE_MIN_PX_PER_MM, which
 * a side without a design gets) and within MAX_IMAGE_PX
 */
export function imageScale(note: Size, design?: { width: number; height: number }) {
  const own = design && design.width > 0 && design.height > 0 ? Math.min(design.width / note.widthMm, design.height / note.heightMm) : 0
  return Math.min(Math.max(own, IMAGE_MIN_PX_PER_MM), MAX_IMAGE_PX / Math.max(note.widthMm, note.heightMm))
}

/** A still image's size in px at `scale` px per mm: the banknote's own, on its side when the canvas shows it so (`quarter`) */
export function imageSize(note: Size, scale: number, quarter: Quarter = 0) {
  const width = Math.max(1, Math.round(note.widthMm * scale))
  const height = Math.max(1, Math.round(note.heightMm * scale))
  return onItsSide(quarter) ? { width: height, height: width } : { width, height }
}

const artworkSizes = new Map<string, Promise<{ width: number; height: number } | undefined>>()

/** The pixels an uploaded image has, read from the image itself, once a session (an id always holds the same image) */
export function artworkSize(id: string) {
  let size = artworkSizes.get(id)
  if (!size) {
    size = loadArtwork(id).then((image) => (image && image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : undefined))
    // One that couldn't be had is asked for again next time
    size.then((read) => { if (!read) artworkSizes.delete(id) }, () => artworkSizes.delete(id))
    artworkSizes.set(id, size)
  }
  return size
}

/** What a still image follows from the canvas, as a video does: the sheen, Realistic, #, the side shown, the rotation, the pattern's offset */
export type StillOptions = Pick<FaceOptions, 'sheen' | 'realistic' | 'frameNumbers' | 'back' | 'quarter' | 'offsetMm'>

/**
 * A still image of one banknote (Keller, 9 November): the banknote flat and face on, filling the image at `scale` px per mm
 * (`imageSize`), turned as the canvas shows it (`quarter`), with only its security features as seen at `tilt`: the
 * thread's frames and sheen, Arc-en-Ciel's bands and magnetic ink, lit as the canvas lights them with Realistic. The
 * banknote itself never turns or shades, and its watermark shows as held to the light, whatever the tilt.
 */
export function drawStill(ctx: Ctx, note: Note, assets: NoteAssets, scale: number, tilt: Tilt2, options: StillOptions) {
  const { width, height } = imageSize(note, scale)
  const quarter = options.quarter ?? 0
  ctx.save()
  ctx.imageSmoothingQuality = 'high'
  // Turned clockwise, as the canvas turns it, the banknote still filling the image
  if (quarter === 1) ctx.translate(height, 0)
  else if (quarter === 2) ctx.translate(width, height)
  else if (quarter === 3) ctx.translate(0, width)
  if (quarter) ctx.rotate((quarter * Math.PI) / 2)
  // Realistic magnetic ink's grain as a video frame as big would have it: a cell a px up to 1920 px along its long side
  const grain = Math.max(1, Math.round(Math.max(width, height) / 1920))
  drawFace(ctx, note, assets, scale, tilt, { ...options, perspective: false, reveal: 1, grain })
  ctx.restore()
}

/** Largest output side; hardware video encoders commonly stop at 4K */
export const MAX_EXPORT_PX = 3840

/** Output resolutions by frame height, as video editors name them */
export const RESOLUTIONS = [
  { value: 360, label: '360p' },
  { value: 480, label: '480p' },
  { value: 720, label: '720p' },
  { value: 1080, label: '1080p' },
  { value: 1440, label: '1440p' },
  { value: 2160, label: '4K' },
]

/**
 * Px per mm that makes a file `height` px tall. The layout grows in proportion to its scale, so it is
 * measured once at 1 px per mm. Very wide rows are scaled down to stay within MAX_EXPORT_PX.
 */
export function scaleForHeight(notes: Note[], angles: (Tilt2 | number)[], perspective: boolean, height: number, quarter: Quarter = 0) {
  const unit = exportLayout(notes, 1, angles, perspective, quarter)
  return Math.min(height / unit.exactHeight, MAX_EXPORT_PX / unit.exactWidth, MAX_EXPORT_PX / unit.exactHeight)
}

/** The file groups an export makes: one with every banknote side by side, or one per banknote */
export const exportGroups = (notes: Note[], separate: boolean) => (separate && notes.length > 1 ? notes.map((n) => [n]) : [notes])

/**
 * The side of every banknote an export shows (Keller, 9 November: "make sure I can also export the back"), picked in the
 * Export dialog, which starts on the side the canvas shows, or both, a file of each
 */
export type ExportSide = Side | 'both'

/** The sides an export makes files of, the front first */
export const exportSides = (side: ExportSide = 'front'): Side[] => (side === 'both' ? ['front', 'back'] : [side])

export function exportSize(notes: Note[], options: { height: number; fps: number; loops: number; perspective: boolean; separate: boolean; side?: ExportSide; quarter?: Quarter }) {
  if (notes.length === 0) return { width: 0, height: 0, seconds: 0 }
  // A video from the backs turns through the same angles as one from the fronts, so either side's is the size of both
  const angles = playbackViews(notes[0], options.fps, options.loops, options.side === 'back')
  const layouts = exportGroups(notes, options.separate).map((group) =>
    exportLayout(group, scaleForHeight(group, angles, options.perspective, options.height, options.quarter), angles, options.perspective, options.quarter))
  return { width: Math.max(...layouts.map((l) => l.width)), height: Math.max(...layouts.map((l) => l.height)), seconds: angles.length / options.fps }
}
