import { PAPER, fitBack } from './back'
import { fitContinuous } from './continuous'
import { featureCopy, withLens } from './copyFeature'
import { promoteExtra } from './extras'
import { keptName } from './layerName'
import { FEATURES, type Feature, fitPlaced, isPlaced } from './layers'
import { defaultPattern, migratePattern } from './pattern'
import { DEFAULT_PLAYBACK, playbackSettings } from './playback'
import { migrateWindows, threadLength } from './thread'
import { fitArcEnCiel } from './arcEnCiel'
import { fitMagneticInk } from './magneticInk'
import type { ExtraFeature, Frame, Note, Project, TiltSettings } from './types'
import { fitWatermark } from './watermark'

export const MIN_FRAMES = 2
export const MAX_FRAMES = 5
/** Timeline length of a new frame, in the timeline's own units */
export const DEFAULT_LENGTH = 10
export const LENGTH_LIMITS = { min: 1, max: 100 }
export const CYCLE_LIMITS = { min: 2, max: 1200 }
export const DEFAULT_TILT: TiltSettings = { ...DEFAULT_PLAYBACK, cycleDeg: 30, transition: 0, effect: 'updown', runY: 'down', runX: 'right' }
export const THREAD_WIDTH = { min: 3, max: 6, step: 0.5 }
/**
 * A banknote's width and height, mm: up to 2 m, as large ones run to (Keller, 3 November; it was 250 mm). The canvas
 * stays smooth at it, as export and the watermark's light layer are drawn at capped sizes; a size typed past it shows
 * an error instead of being taken
 */
export const NOTE_SIZE = { min: 20, max: 2000 }
export const FRAME_COLORS = ['#D9A441', '#2E9C8F', '#C2456B', '#4A6FD1', '#7C4DBA']
/** A new banknote's size, and its colour as saved (it shows as `PAPER`, as every banknote's does) */
export const DEFAULT_NOTE = { widthMm: 150, heightMm: 70, color: PAPER }
/** Space left between notes when they are placed on the canvas */
export const NOTE_GAP = 20

/** Where a new note goes: to the right of everything already on the canvas */
export function nextNotePosition(notes: Pick<Note, 'x' | 'y' | 'widthMm'>[]) {
  if (notes.length === 0) return { x: 0, y: 0 }
  return { x: Math.max(...notes.map((n) => n.x + n.widthMm)) + NOTE_GAP, y: Math.min(...notes.map((n) => n.y)) }
}

export function colorFrame(index: number): Frame {
  return {
    id: crypto.randomUUID(),
    kind: 'color',
    color: FRAME_COLORS[index % FRAME_COLORS.length],
    name: `Colour ${index + 1}`,
    length: DEFAULT_LENGTH,
  }
}

export function createNote({
  name,
  x,
  y,
  widthMm,
  heightMm,
  color,
}: {
  name: string
  x: number
  y: number
  widthMm: number
  heightMm: number
  color: string
}): Note {
  return {
    id: crypto.randomUUID(),
    name,
    x,
    y,
    widthMm,
    heightMm,
    background: 'solid',
    color,
    // Without windows (Keller, 3 November): continuous until they are switched on, which brings these in
    thread: { widthMm: 4, direction: 'vertical', positionMm: widthMm / 2, windows: { ...migrateWindows(undefined, heightMm), enabled: false } },
    frames: [colorFrame(0), colorFrame(1)],
    tilt: DEFAULT_TILT,
    // On Fit: the tile follows the thread, a square until the first image sets its length
    pattern: { ...defaultPattern(), fit: true },
  }
}

/**
 * The banknote with a new security thread, as a new banknote's is (two colour frames, no windows, its tile on Fit), its
 * lens and playback kept: adding the thread from the Add menu, or removing it, which leaves this one waiting unused
 * (`noThread`) so nothing of the old one is kept or saved
 */
export function withNewThread(note: Note, noThread?: true): Note {
  const fresh = createNote({ name: note.name, x: note.x, y: note.y, widthMm: note.widthMm, heightMm: note.heightMm, color: note.color })
  const { noThread: _was, ...rest } = note
  return { ...rest, ...(noThread ? { noThread } : {}), thread: fresh.thread, frames: fresh.frames, pattern: fresh.pattern }
}

export function createProject(name: string): Project {
  const now = Date.now()
  return { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, notes: [] }
}

const spanOf = (f: Frame) => (f as { spanDeg?: number }).spanDeg

/** A frame saved with a degree span gets a timeline length in the same proportion, averaging the default */
function oldLength(frames: Frame[], frame: Frame) {
  const spans = frames.map(spanOf)
  const known = spans.filter((s) => s !== undefined)
  const span = spanOf(frame)
  if (span === undefined || known.length === 0) return DEFAULT_LENGTH
  const mean = known.reduce((total, s) => total + s, 0) / known.length
  return Math.max(LENGTH_LIMITS.min, Math.round((span / mean) * DEFAULT_LENGTH))
}

/** The optional lens settings, kept as saved; a project from before lenses has none and stays Up/down */
function lensFields(tilt: TiltSettings): Partial<TiltSettings> {
  const keys = ['effect', 'cycleXDeg', 'yOn', 'runY', 'runX', 'viewDeg', 'revealAxis', 'revealHide', 'revealWobble', 'revealLevel', 'flatAt', 'playTilt', 'moves', 'recordings'] as const
  return Object.fromEntries(keys.filter((k) => tilt[k] !== undefined).map((k) => [k, tilt[k]]))
}

/**
 * Presets keep their one Cycle in `cycleDeg`; only Custom reads `cycleXDeg`. Vertical, and Partial reveal hidden
 * on up/down, used to keep theirs in `cycleXDeg`: move it over, once, so it's the Cycle they show
 */
function presetCycle(tilt: TiltSettings): { cycleDeg?: number; cycleXDeg?: undefined } {
  const sideCycle = tilt.effect === 'side' || (tilt.effect === 'reveal' && tilt.revealAxis === 'x')
  return sideCycle && tilt.cycleXDeg != null ? { cycleDeg: tilt.cycleXDeg, cycleXDeg: undefined } : {}
}

/** Projects saved before notes existed held a single note's settings at the top level */
export function migrateProject(raw: unknown): Project {
  const p = raw as Project & {
    note?: { widthMm: number; heightMm: number; color: string; faceImageId?: string }
    thread?: Note['thread']
    frames?: Frame[]
    tilt?: Note['tilt']
  }
  const { note, thread, frames, tilt, ...rest } = p
  const notes: Note[] = Array.isArray(p.notes)
    ? p.notes
    : note && thread && frames && tilt
      ? [{ id: crypto.randomUUID(), name: `${note.widthMm} × ${note.heightMm}`, x: 0, y: 0, background: 'solid' as const, ...note, thread, frames, tilt }]
      : []
  // Notes saved before the canvas had no position: lay them out in a row
  const placed: Note[] = []
  for (const saved of notes) {
    const n = migrateNote(saved)
    placed.push(Number.isFinite(n.x) && Number.isFinite(n.y) ? n : { ...n, ...nextNotePosition(placed) })
  }
  return { ...rest, notes: placed }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

/**
 * A banknote's further features as saved (extras.ts), each brought up to date and repaired as the first of its kind is:
 * a placed layer kept on the banknote, a thread as a banknote's own thread is, under its own lens. One that can't be read
 * is left out, and one whose id another already has takes a new one
 */
function migrateExtras(saved: unknown, note: Note): ExtraFeature[] {
  if (!Array.isArray(saved)) return []
  const ids = new Set<string>()
  return saved.flatMap((x: unknown): ExtraFeature[] => {
    if (!isObject(x) || !(FEATURES as readonly unknown[]).includes(x.feature)) return []
    const feature = x.feature as Feature
    const id = typeof x.id === 'string' && x.id && !x.id.includes('/') && !ids.has(x.id) ? x.id : crypto.randomUUID()
    ids.add(id)
    try {
      if (isPlaced(feature)) return isObject(x.layer) ? [{ id, feature, layer: fitPlaced(feature, x.layer as never, note) } as ExtraFeature] : []
      const copy = x.thread
      if (!isObject(copy) || !isObject(copy.thread) || !Array.isArray(copy.frames)) return []
      // As the banknote's own thread would be, from the banknote as saved, with this thread and its lens in place of its own
      const { watermark: _w, arcEnCiel: _a, magneticInk: _m, extras: _x, noThread: _t, continuous: _c, back: _b, ...base } = note
      const lens = isObject(copy.lens) ? copy.lens : {}
      const thread = featureCopy(migrateNote({ ...base, thread: copy.thread as never, frames: copy.frames as Frame[], pattern: copy.pattern as never, tilt: withLens(note.tilt, lens) }), 'thread')
      return thread ? [{ ...thread, id }] : []
    } catch {
      return []
    }
  })
}

/** One banknote as saved, brought up to date and repaired; where it sits on the canvas as saved */
function migrateNote({ watermark, continuous, arcEnCiel, magneticInk, back: savedBack, noThread, extras: savedExtras, ...raw }: Note): Note {
  const check = fitContinuous(continuous)
  const back = fitBack(savedBack)
  const extras = migrateExtras(savedExtras, { ...raw, ...(noThread === true ? { noThread } : {}) } as Note)
  // Older notes had no background mode; an uploaded face meant an image background
  const n: Note = {
    ...raw,
    // Without a thread only when saved so; every banknote from before has its thread
    ...(noThread === true ? { noThread } : {}),
    // Only notes with a watermark, Arc-en-Ciel or magnetic ink have one; a damaged one is put back on its banknote
    ...(watermark && typeof watermark === 'object' ? { watermark: fitWatermark(watermark, raw) } : {}),
    ...(arcEnCiel && typeof arcEnCiel === 'object' ? { arcEnCiel: fitArcEnCiel(arcEnCiel, raw) } : {}),
    ...(magneticInk && typeof magneticInk === 'object' ? { magneticInk: fitMagneticInk(magneticInk, raw) } : {}),
    // The continuous check is on only while saved, its tolerance kept in range
    ...(check ? { continuous: check } : {}),
    // A back once it has been set; until then it shows the front's paper
    ...(back ? { back } : {}),
    background: raw.background ?? (raw.faceImageId ? 'image' : 'solid'),
    // Older frames had degree spans, or split one shared range equally: keep their proportions and cycle
    frames: raw.frames.map((f) => ({ ...f, length: f.length ?? oldLength(raw.frames, f) })),
    tilt: {
      ...playbackSettings(raw.tilt),
      ...lensFields(raw.tilt),
      ...presetCycle(raw.tilt),
      transition: raw.tilt.transition,
      cycleDeg:
        presetCycle(raw.tilt).cycleDeg ??
        raw.tilt.cycleDeg ??
        (raw.frames.every((f) => (f as { spanDeg?: number }).spanDeg !== undefined)
          ? raw.frames.reduce((total, f) => total + ((f as { spanDeg?: number }).spanDeg ?? 0), 0)
          : 2 * ((raw.tilt as { rangeDeg?: number }).rangeDeg ?? 15)),
    },
    thread: {
      // Its own name once it has one (layerName.ts)
      ...keptName(raw.thread.name),
      // Threads without an explicit background let the banknote show through.
      backgroundColor: raw.thread.backgroundColor,
      widthMm: raw.thread.widthMm,
      direction: raw.thread.direction ?? 'vertical',
      positionMm: raw.thread.positionMm ?? (raw.thread as { xMm?: number }).xMm ?? raw.widthMm / 2,
      // Images now sit once per repeat: a thread from before keeps its old gap (none from before gaps, which retired
      // the cropping length) until its images are read and the gap becomes part of its repeat (`settleArtwork`)
      ...(raw.thread.imageGapMm !== undefined || raw.pattern === undefined ? { imageGapMm: Math.max(0, raw.thread.imageGapMm ?? 0) } : {}),
      windows: migrateWindows(raw.thread.windows, threadLength({ ...raw, thread: { direction: raw.thread.direction ?? 'vertical' } })),
    },
    // Banknotes from before patterns are one section over the whole thread with their own lens, drawn as before
    pattern: migratePattern(raw.pattern),
    // Its further features, only while it has them
    ...(extras.length ? { extras } : {}),
  }
  // Never further features of a kind without the first: the next moves up into its place
  return FEATURES.reduce(promoteExtra, n)
}
