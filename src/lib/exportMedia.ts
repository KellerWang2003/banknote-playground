import { zipSync } from 'fflate'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, getFirstEncodableVideoCodec } from 'mediabunny'
import { sideImageId, type Side } from './back'
import type { Tilt2 } from './lens'
import type { Quarter } from './rotate'
import {
  artworkSize, drawExportFrame, drawStill, exportGroups, exportLayout, imageScale, imageSize, loadNoteAssets, playbackLights, playbackTilts, playbackTurns,
  playbackViews, scaleForHeight, turnsOver, type SideAssets,
} from './exportRender'
import type { Note } from './types'

export type ExportFormat = 'mp4' | 'gif'

export interface ExportOptions {
  format: ExportFormat
  notes: Note[]
  /** One file with the banknotes side by side, or one file per banknote */
  separate: boolean
  /** Output frame height in px; a very wide row may come out smaller to stay within 4K */
  height: number
  fps: number
  /** Passes of playback in a video; a GIF always loops forever */
  loops: number
  /** Omitted for a transparent GIF */
  background?: string
  sheen: boolean
  perspective: boolean
  /** Magnetic ink lit as metal and Arc-en-Ciel drawn as embossed ridges, as Realistic (beside the lamp) shows them on the canvas */
  realistic?: boolean
  /** Draws the visible frame's number on each thread, as the # toggle does on the canvas */
  frameNumbers?: boolean
  /** The whole video held up to the light (the watermark clear throughout), as the lamp switch on the canvas; otherwise only Hold to light moves are */
  backlit?: boolean
  /** Every banknote's back, as the canvas shows them turned over: the video starts on the backs, Flip moves turning them as on the canvas */
  back?: boolean
  /** Every banknote rotated this many quarter turns clockwise about its centre, as the canvas shows them (Rotate left and right) */
  quarter?: Quarter
  /** Where each banknote's thread pattern starts along its thread (mm, by banknote id), as the canvas previews it */
  offsets?: Record<string, number>
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Banknote'

async function renderFile(notes: Note[], assets: Map<string, SideAssets>, options: ExportOptions, onFrame: () => void, signal: AbortSignal) {
  // Every banknote shares the project-wide cycle and playback settings
  const loops = options.format === 'gif' ? 1 : options.loops
  const angles = playbackTilts(notes[0], options.fps, loops)
  const lights = playbackLights(notes[0], options.fps, loops)
  const turns = playbackTurns(notes[0], options.fps, loops, options.back)
  // Laid out with room for what the banknotes turn through on screen, turning over included
  const views = playbackViews(notes[0], options.fps, loops, options.back)
  const scale = scaleForHeight(notes, views, options.perspective, options.height, options.quarter)
  const layout = exportLayout(notes, scale, views, options.perspective, options.quarter)
  const canvas = new OffscreenCanvas(layout.width, layout.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: options.format === 'gif' })!
  const faces = new Map(notes.map((n) => [n.id, new OffscreenCanvas(Math.ceil(n.widthMm * scale), Math.ceil(n.heightMm * scale))]))
  const draw = (i: number) => drawExportFrame(ctx, layout, assets, faces, scale, angles[i], options, lights[i] ?? 0, turns[i] ?? 0)

  if (options.format === 'gif') {
    const gif = GIFEncoder()
    const delay = Math.round(1000 / options.fps)
    const transparent = !options.background
    for (const i of angles.keys()) {
      signal.throwIfAborted()
      draw(i)
      const { data } = ctx.getImageData(0, 0, layout.width, layout.height)
      const format = transparent ? 'rgba4444' : 'rgb565'
      const palette = quantize(data, 256, { format, oneBitAlpha: transparent })
      const index = applyPalette(data, palette, format)
      const transparentIndex = transparent ? Math.max(0, palette.findIndex((c) => c[3] === 0)) : 0
      gif.writeFrame(index, layout.width, layout.height, { palette, delay, repeat: 0, transparent, transparentIndex, dispose: transparent ? 2 : -1 })
      onFrame()
      // Let the progress bar paint between frames; a message isn't throttled like a timer in a background tab
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => resolve()
        channel.port2.postMessage(null)
      })
    }
    gif.finish()
    return { blob: new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), extension: 'gif' }
  }

  const size = { width: layout.width, height: layout.height }
  const avc = await getFirstEncodableVideoCodec(['avc'], { ...size, quality: QUALITY_HIGH })
  const codec = avc ?? await getFirstEncodableVideoCodec(['vp9', 'vp8'], { ...size, quality: QUALITY_HIGH })
  if (!codec) throw new Error('This browser cannot encode video. Try GIF, or use Chrome, Edge or Safari.')
  const output = new Output({ format: avc ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() })
  const source = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH })
  output.addVideoTrack(source, { frameRate: options.fps })
  await output.start()
  try {
    for (const i of angles.keys()) {
      signal.throwIfAborted()
      draw(i)
      await source.add(i / options.fps, 1 / options.fps)
      onFrame()
    }
    await output.finalize()
  } catch (error) {
    await output.cancel()
    throw error
  }
  const buffer = output.target.buffer
  if (!buffer) throw new Error('The video could not be written.')
  return { blob: new Blob([buffer], { type: output.format.mimeType }), extension: avc ? 'mp4' : 'webm' }
}

/** Renders and encodes the export, reporting progress from 0 to 1. Resolves with the file to download. */
export async function exportTilt(projectName: string, options: ExportOptions, onProgress: (progress: number) => void, signal: AbortSignal) {
  const { notes } = options
  const groups = exportGroups(notes, options.separate)
  // The scale each banknote is drawn at, as renderFile works it out, so its images load only as big as they are drawn
  const scales = new Map<string, number>()
  for (const group of groups) {
    const angles = playbackViews(group[0], options.fps, options.format === 'gif' ? 1 : options.loops, options.back)
    const scale = scaleForHeight(group, angles, options.perspective, options.height, options.quarter)
    for (const note of group) scales.set(note.id, Math.max(scales.get(note.id) ?? 0, scale))
  }
  // What the side the banknotes show needs, or both sides when playback turns them over
  const sides: Side[] = turnsOver(notes[0]) ? ['front', 'back'] : [options.back ? 'back' : 'front']
  const loadSides = async (note: Note) => {
    const loaded: SideAssets = {}
    await Promise.all(sides.map(async (side) => { loaded[side] = await loadNoteAssets(note, scales.get(note.id), side === 'back') }))
    return loaded
  }
  const assets = new Map(await Promise.all(notes.map(async (n) => [n.id, await loadSides(n)] as const)))
  const framesEach = playbackTilts(notes[0], options.fps, options.format === 'gif' ? 1 : options.loops).length
  const total = framesEach * groups.length
  let done = 0
  const files: { name: string; blob: Blob }[] = []
  for (const group of groups) {
    const { blob, extension } = await renderFile(group, assets, options, () => onProgress(++done / total), signal)
    files.push({ name: `${safeName(projectName)} - ${groups.length > 1 || notes.length === 1 ? safeName(group[0].name) : 'Banknotes'}.${extension}`, blob })
  }
  return bundle(projectName, files)
}

/** One file as it is, or several in a zip */
async function bundle(projectName: string, files: { name: string; blob: Blob }[]) {
  if (files.length === 1) return files[0]
  // Banknotes can share a name; number repeats so no file in the zip replaces another
  const used = new Map<string, number>()
  for (const file of files) {
    const count = (used.get(file.name) ?? 0) + 1
    used.set(file.name, count)
    if (count > 1) file.name = file.name.replace(/(\.\w+)$/, ` ${count}$1`)
  }
  // Video, GIF and PNG are already compressed, so store them as they are
  const entries = Object.fromEntries(await Promise.all(files.map(async (f) => [f.name, [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }] as const])))
  return { name: `${safeName(projectName)} - Banknotes.zip`, blob: new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }) }
}

/** A still image export (Keller, 9 November): each banknote flat at full resolution, its security features as seen at `tilt` */
export interface ImageOptions {
  notes: Note[]
  /** The tilt the security features are seen at; the banknotes themselves lie flat */
  tilt: Tilt2
  sheen: boolean
  /** Magnetic ink lit as metal and Arc-en-Ciel drawn as embossed ridges, as Realistic shows them on the canvas */
  realistic?: boolean
  /** Draws the visible frame's number on each thread, as the # toggle does on the canvas */
  frameNumbers?: boolean
  /** Every banknote's back, as the canvas shows them turned over */
  back?: boolean
  /** Every banknote rotated this many quarter turns clockwise, as the canvas shows them (Rotate left and right) */
  quarter?: Quarter
  /** Where each banknote's thread pattern starts along its thread (mm, by banknote id), as the canvas previews it */
  offsets?: Record<string, number>
}

/** The tilt in an image's name, in the tilt store's words (positive tilts up, and right), nothing when flat */
export function tiltName({ x, y }: Tilt2) {
  const parts = [
    ...(Math.round(y) ? [`${Math.abs(Math.round(y))}° ${y > 0 ? 'up' : 'down'}`] : []),
    ...(Math.round(x) ? [`${Math.abs(Math.round(x))}° ${x > 0 ? 'right' : 'left'}`] : []),
  ]
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

/**
 * Draws and encodes a PNG of every banknote, each at its own full resolution (`imageScale`), reporting progress from 0
 * to 1. Resolves with the file to download: the image, or a zip of them for several banknotes.
 */
export async function exportImages(projectName: string, options: ImageOptions, onProgress: (progress: number) => void, signal: AbortSignal) {
  const { notes } = options
  const side: Side = options.back ? 'back' : 'front'
  const files: { name: string; blob: Blob }[] = []
  for (const [i, note] of notes.entries()) {
    signal.throwIfAborted()
    const design = sideImageId(note, side)
    const scale = imageScale(note, design ? await artworkSize(design) : undefined)
    const assets = await loadNoteAssets(note, scale, options.back)
    signal.throwIfAborted()
    onProgress((i + 0.5) / notes.length)
    const size = imageSize(note, scale, options.quarter)
    const canvas = new OffscreenCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot draw an image this big.')
    drawStill(ctx, note, assets, scale, options.tilt, {
      sheen: options.sheen, realistic: options.realistic, frameNumbers: options.frameNumbers, back: options.back, quarter: options.quarter, offsetMm: options.offsets?.[note.id],
    })
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    files.push({ name: `${safeName(projectName)} - ${safeName(note.name)}${tiltName(options.tilt)}.png`, blob })
    onProgress((i + 1) / notes.length)
  }
  return bundle(projectName, files)
}

export function downloadFile(file: { name: string; blob: Blob }) {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
