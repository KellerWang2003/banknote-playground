// The export renderer before thread patterns (55b631b), to prove a migrated banknote still exports the same. Its corners
// are square, as every banknote's have been since 9 November (Keller), so the comparison stays on the thread
import { SHADE_DEG } from '../../src/lib/frames'
import { lensMix, lensState, type Tilt2 } from '../../src/lib/lens'
import { playbackPlan, tiltAt } from '../../src/lib/moves'
import { loadImageUrl } from '../../src/lib/images'
import { fitSections, threadLength } from '../../src/lib/thread'
import type { Note } from '../../src/lib/types'

/** Where complete image copies sat along the thread before images sat in the repeat, px: each copy's start and length (frozen copy) */
function imageTiles(thicknessPx: number, lengthPx: number, gapPx: number, aspect: number, direction: 'vertical' | 'horizontal') {
  const naturalPx = direction === 'vertical' ? thicknessPx * aspect : thicknessPx / aspect
  if (!(naturalPx > 0)) return { naturalPx: 0, starts: [] }
  const step = naturalPx + Math.max(0, gapPx)
  return { naturalPx, starts: Array.from({ length: Math.ceil(lengthPx / step) }, (_, i) => i * step) }
}

// Draws banknotes to a canvas exactly as NoteView shows them on the canvas, so the tilt can be exported

/** Same perspective as the canvas: relative to the note's size, so the near edge visibly widens */
export const perspectiveFor = (note: Pick<Note, 'widthMm' | 'heightMm'>, scale: number) => 2.2 * Math.max(note.widthMm, note.heightMm) * scale
/** Space around and between banknotes in an export, in mm */
export const EXPORT_MARGIN_MM = 6

/** The tilt of every video frame for `loops` passes of the project's playback moves, exactly as live playback */
export function playbackTilts(note: Pick<Note, 'tilt' | 'frames'>, fps: number, loops = 1): Tilt2[] {
  const plan = playbackPlan(note.tilt, lensState(note.tilt, note.frames))
  const count = Math.max(1, Math.round(plan.seconds * loops * fps))
  return Array.from({ length: count }, (_, i) => tiltAt(plan, i / fps))
}

const asTilt = (t: Tilt2 | number): Tilt2 => (typeof t === 'number' ? { x: 0, y: t } : t)

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
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('An artwork image could not be loaded.'))
    img.src = url
  })
}

export async function loadArtwork(id: string) {
  const url = await loadImageUrl(id)
  return url ? loadImage(url) : undefined
}

export async function loadNoteAssets(note: Note): Promise<NoteAssets> {
  const frames = new Map<string, HTMLImageElement>()
  const [face] = await Promise.all([
    note.background === 'image' && note.faceImageId ? loadArtwork(note.faceImageId) : undefined,
    ...note.frames.map(async (frame) => {
      if (frame.kind !== 'image' || !frame.imageId) return
      const img = await loadArtwork(frame.imageId)
      if (img) frames.set(frame.id, img)
    }),
  ])
  return { face, frames }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** The flat note at `scale` px per mm, as NoteView draws it before it is turned in 3D */
export function drawFace(ctx: Ctx, note: Note, assets: NoteAssets, scale: number, tiltAt: Tilt2 | number, options: { sheen: boolean; perspective: boolean; frameNumbers?: boolean }) {
  const { thread, frames } = note
  const { x: angleX, y: angle } = asTilt(tiltAt)
  const mm = (value: number) => value * scale
  const width = mm(note.widthMm), height = mm(note.heightMm)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.fillStyle = note.color
  ctx.fillRect(0, 0, width, height)

  const face = assets.face
  if (face && face.naturalWidth > 0) {
    // object-fit: cover
    const k = Math.max(width / face.naturalWidth, height / face.naturalHeight)
    const w = face.naturalWidth * k, h = face.naturalHeight * k
    ctx.drawImage(face, (width - w) / 2, (height - h) / 2, w, h)
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

  const thickness = horizontal ? strip.h : strip.w
  const length = horizontal ? strip.w : strip.h
  const drawFrame = (index: number, opacity: number) => {
    const frame = frames.at(index)
    if (!frame) return
    ctx.globalAlpha = opacity
    if (frame.kind === 'color') {
      ctx.fillStyle = frame.color
      ctx.fillRect(0, 0, strip.w, strip.h)
    } else {
      const img = assets.frames.get(frame.id)
      if (img && img.naturalWidth > 0) {
        const { naturalPx, starts } = imageTiles(thickness, length, mm(thread.imageGapMm ?? 0), img.naturalHeight / img.naturalWidth, thread.direction)
        for (const start of starts) {
          if (horizontal) ctx.drawImage(img, start, 0, naturalPx, thickness)
          else ctx.drawImage(img, 0, start, thickness, naturalPx)
        }
      }
    }
    ctx.globalAlpha = 1
  }
  const mix = lensMix(note, { x: angleX, y: angle })
  drawFrame(mix.base, 1)
  if (mix.blend > 0 && mix.next !== mix.base) drawFrame(mix.next, mix.blend)

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

  if (options.perspective && t !== 0) {
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
  const tx = angleX / SHADE_DEG
  if (options.perspective && tx !== 0) {
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
  if (options.frameNumbers && frames.length > 0) drawFrameNumber(ctx, String(mix.current + 1), strip, mm)
  ctx.restore()
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

/**
 * Banknotes side by side in a row, each in a cell wide and tall enough for its tilted shape at every angle,
 * centred vertically. Sizes are even, which video encoders need.
 */
export function exportLayout(notes: Note[], scale: number, angles: (Tilt2 | number)[], perspective: boolean) {
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
    return { note, top, bottom, halfWidth }
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

/** Renders one export frame: the background, then every banknote at tilt `angle` */
export function drawExportFrame(
  ctx: Ctx,
  layout: ReturnType<typeof exportLayout>,
  assets: Map<string, NoteAssets>,
  faces: Map<string, OffscreenCanvas>,
  scale: number,
  angle: Tilt2 | number,
  options: { sheen: boolean; perspective: boolean; frameNumbers?: boolean; background?: string },
) {
  ctx.clearRect(0, 0, layout.width, layout.height)
  if (options.background) {
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, layout.width, layout.height)
  }
  ctx.imageSmoothingQuality = 'high'
  for (const cell of layout.cells) {
    const face = faces.get(cell.note.id)
    const noteAssets = assets.get(cell.note.id)
    if (!face || !noteAssets) continue
    const faceCtx = face.getContext('2d')!
    faceCtx.clearRect(0, 0, face.width, face.height)
    drawFace(faceCtx, cell.note, noteAssets, scale, angle, options)
    drawTilted(ctx, face, cell.cx, cell.cy, options.perspective ? angle : 0, perspectiveFor(cell.note, scale))
  }
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
export function scaleForHeight(notes: Note[], angles: (Tilt2 | number)[], perspective: boolean, height: number) {
  const unit = exportLayout(notes, 1, angles, perspective)
  return Math.min(height / unit.exactHeight, MAX_EXPORT_PX / unit.exactWidth, MAX_EXPORT_PX / unit.exactHeight)
}

/** The file groups an export makes: one with every banknote side by side, or one per banknote */
export const exportGroups = (notes: Note[], separate: boolean) => (separate && notes.length > 1 ? notes.map((n) => [n]) : [notes])

export function exportSize(notes: Note[], options: { height: number; fps: number; loops: number; perspective: boolean; separate: boolean }) {
  if (notes.length === 0) return { width: 0, height: 0, seconds: 0 }
  const angles = playbackTilts(notes[0], options.fps, options.loops)
  const layouts = exportGroups(notes, options.separate).map((group) =>
    exportLayout(group, scaleForHeight(group, angles, options.perspective, options.height), angles, options.perspective))
  return { width: Math.max(...layouts.map((l) => l.width)), height: Math.max(...layouts.map((l) => l.height)), seconds: angles.length / options.fps }
}
