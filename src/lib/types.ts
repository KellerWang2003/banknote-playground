export interface Frame {
  id: string
  /** What the frame shows: nothing (the thread's background shows), one colour over the whole thread, or one image in the repeat */
  kind: 'none' | 'color' | 'image'
  color: string
  imageId?: string
  /** The image's height ÷ width, read when it was added; absent on images from before, until they have been read */
  aspect?: number
  /** Where the image sits in the repeat; absent, it fits the repeat and the thread, centred */
  place?: ImagePlace
  name: string
  /** This frame's length on the timeline, relative to the others; its share of the full cycle */
  length: number
}

/**
 * Where a frame's image sits in the thread's repeat (`ThreadPattern.repeatMm`). It shows once in every repeat, so
 * its copies fall one repeat apart, and one that runs past the repeat's end carries on into the next. Along is mm
 * from the repeat's start to the image's near end; across and size are shares of the thread's thickness, as a
 * section's are, so the image keeps its place when the thread gets thicker. It always stays upright.
 */
export interface ImagePlace {
  alongMm: number
  /** Where the image starts across the thread, from its left edge (vertical) or top edge (horizontal) */
  across: number
  /** How much of the thread's thickness the image spans */
  size: number
}

export interface ThreadSettings {
  /** Its own name, given in the Banknotes list; absent, it is called Security thread (layerName.ts) */
  name?: string
  /** Optional colour behind the frame artwork; omitted for transparency */
  backgroundColor?: string
  widthMm: number
  /** Which way the thread runs across the note */
  direction: 'vertical' | 'horizontal'
  /** Thread centre: from the left edge for a vertical thread, from the top edge for a horizontal one */
  positionMm: number
  /**
   * No longer drawn: images sit once per repeat. A thread from before keeps its old spacing between image copies
   * here until its images have been read, to take its repeat from it (`settleArtwork`)
   */
  imageGapMm?: number
  windows: ThreadWindows
}

/** A visible section, measured along the thread from the banknote's top/left edge. */
export interface ThreadWindow {
  id: string
  startMm: number
  endMm: number
}

export interface ThreadWindows {
  enabled: boolean
  sections: ThreadWindow[]
}

export type PlaybackCurve = 'smooth' | 'linear' | 'ease-in' | 'ease-out'

export interface TiltSettings {
  /** Playback speed multiplier; 1 = a sweep each way in SWEEP_SECONDS (about 1.9 s) */
  speed?: number
  curve?: PlaybackCurve
  /** No longer read: pauses are Hold moves in `moves` (Keller, 3 November); kept so older saves still type-check */
  holdSeconds?: number
  /** Degrees of tilt for one full cycle of the frames; past it the frames loop */
  cycleDeg: number
  /** 0 = hard cut between frames, 1 = crossfade across the whole slice */
  transition: number
  /** What tilting does; absent on projects from before lenses, which are Up/down */
  effect?: 'updown' | 'side' | 'both' | 'reveal' | 'custom'
  /** Degrees of side tilt for one pass; null when side tilt does nothing (Custom) */
  cycleXDeg?: number | null
  /** Custom only: false when up/down tilt does nothing */
  yOn?: boolean
  /** Which way 1 → 5 plays on the up/down tilt; absent means up, as before lenses */
  runY?: 'up' | 'down'
  /** Which way 1 → 5 plays on the side tilt */
  runX?: 'right' | 'left'
  /** No longer edited or read (the viewing range is fixed at TILT_LIMIT); kept so older saves still type-check */
  viewDeg?: number
  /** Reveal only: the tilt that plays every frame */
  revealAxis?: 'x' | 'y'
  /** No longer read: Reveal always hides the fewest frames it can, the outer ones */
  revealHide?: number
  /** Partial reveal: degrees of fast tilt a viewer may drift by while sweeping the slow tilt (default 5) */
  revealWobble?: number
  /**
   * Where flat sits, in half-frame steps from the start of frame 1 (1 = middle of frame 1, 2 = between frames 1
   * and 2, …). Absent or 'center' = the middle of the middle frame; 'start' (older saves) = 0
   */
  flatAt?: 'start' | 'center' | number
  /** Partial reveal: how far the slow tilt reaches, as a step from the widest (0, fewest frames hidden) inwards */
  revealLevel?: number
  /** Which tilt playback sweeps: up/down, side to side, or one after the other. Superseded by `moves` */
  playTilt?: 'x' | 'y' | 'both'
  /** What playback does, in order; absent means what `playTilt` chose */
  moves?: PlaybackMove[]
  /** Movements recorded on the tilt pad, kept to add to playback again */
  recordings?: Recording[]
}

/** A moment of a recording: seconds from the start, the tilt then, and how far it was held to the light (0 to 1, absent = 0) */
export interface RecordedPoint {
  t: number
  x: number
  y: number
  light?: number
}

export interface Recording {
  id: string
  name: string
  points: RecordedPoint[]
}

/**
 * One step of playback. Preset moves go out from flat and back: up/down, side to side, both at once
 * (diagonal), or once round an ellipse (circle). `x`/`y` are the signed angles reached; absent means one full
 * cycle of that tilt. Hold (`hold`) stays flat, a pause once the move before it has come back. Hold to light
 * (`light`) stays flat, fades the light behind the banknote in, holds and fades it out. Flip (`flip`) stays flat while
 * every banknote turns over to its other side, as F does. A gesture is a recording of the tilt pad.
 */
export interface PlaybackMove {
  id: string
  kind: 'y' | 'x' | 'diagonal' | 'circle' | 'hold' | 'light' | 'flip' | 'gesture'
  x?: number
  y?: number
  /** Up/down and side only: the signed angle the move starts and returns to (flat when absent), so it can swing −12° to +12° */
  from?: number
  /** Hold and Hold to light only: seconds held, flat or up to the light, at 1× (default HOLD_SECONDS, LIGHT_HOLD_SECONDS) */
  seconds?: number
  /** Gesture only: seconds from the start, the tilt then and the light (a copy of the recording's) */
  points?: RecordedPoint[]
  /** Gesture only: the recording it came from; deleting that recording removes the move */
  recordingId?: string
}

/**
 * A watermark made in the paper: an image that is only a hint flat and shows clearly tilted or held to the
 * light. Paper has no colour of its own, so only each pixel's brightness counts: the light parts of the image are
 * thinner paper, which lets more light through, or the dark parts when inverted; its background counts as plain paper.
 * It only ever gets lighter. Its levels then shape how thin that reading makes the paper.
 * Placed by its top-left corner in mm from the banknote's top-left; its height follows the image's proportions.
 */
export interface Watermark {
  /** Its own name, given in the Banknotes list; absent, it is called Watermark (layerName.ts) */
  name?: string
  /** Absent until an image is uploaded */
  imageId?: string
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** How strongly the paper's thickness shows at its clearest (tilted or held to the light), 0 to 1 */
  depth: number
  /** The dark parts of the image are the thinner paper instead of the light ones */
  invert?: boolean
  /** Levels set by hand; absent means Auto, fitted to the image as it is read (relief.ts) */
  levels?: WatermarkLevels
}

/**
 * Levels on how thin a watermark's paper is, from 0 (plain) to 1 (the thinnest), after its image is read. They
 * reshape that reading, so they mean the same with Invert on or off, and plain paper always stays plain.
 */
export interface WatermarkLevels {
  /** Where the watermark starts: this thin or less stays plain paper */
  low: number
  /** Where it reaches the thinnest paper: this thin or more is the thinnest */
  high: number
  /** Midtones, as in Photoshop's Levels: above 1 brightens them, below 1 darkens them (0.1 to 9.99) */
  gamma: number
}

/**
 * The continuous design check, on while present: the banknote's uploaded design should carry on where its edges meet
 * its neighbours' on the print sheet, top into bottom and left into right (continuous.ts). A check only: it changes
 * nothing about how the banknote looks or exports.
 */
export interface ContinuousDesign {
  /** How far either side of each edge the cut may land, mm: the dashed line inside each edge */
  cutMm: number
}

/**
 * Magnetic ink printed in a shape, with the look of SICPA's SPARK Flow PRIME: its colour shifts from Flat to Tilted as
 * the banknote turns away from the viewer, and a bright bar rolls across the shape on one tilt. The shape is its image
 * read as a stencil (`inkCoverage` in inkMask.ts); the magnetism itself isn't shown. Placed by its
 * top-left corner in mm from the banknote's top-left; its height follows the image's proportions.
 */
export interface MagneticInk {
  /** Its own name, given in the Banknotes list; absent, it is called Magnetic ink (layerName.ts) */
  name?: string
  /** Absent until an image is uploaded */
  imageId?: string
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** Ink round the shape instead of in it */
  invert?: boolean
  /** The ink's colour seen flat, #rrggbb */
  color: string
  /** Its colour turned away from the viewer, #rrggbb: all of it from INK_SHIFT_DEG on */
  tiltedColor: string
  /** The tilt that rolls the bar: up/down rolls a level bar up and down the shape, side to side an upright bar across it */
  barAxis: 'y' | 'x'
  /** How wide the bar is, as a share of the shape the way it rolls (INK_BAR) */
  barWidth: number
}

/** A spot on a placed layer, as shares of its box: 0, 0 its top-left corner and 1, 1 its bottom-right. It may lie off the box */
export interface BoxSpot {
  x: number
  y: number
}

/** Where Arc-en-Ciel's bands start: each shape's edge, holes in the shape, points or a line placed on the canvas */
export type ArcFlow = 'edge' | 'holes' | 'point' | 'line'

/**
 * Oberthur's Arc-en-Ciel: an offset line screen in three or four colours, embossed blind in register with it, whose colour
 * bands slide as the banknote tilts across its ridges (arcEnCiel.ts). The shape is its image read as magnetic ink's
 * stencil is (`inkCoverage` in inkMask.ts). Placed by its top-left corner in mm from the banknote's top-left; its height
 * follows the image's proportions. Its points and line are kept whatever the bands start from, so switching back finds
 * them where they were.
 */
export interface ArcEnCiel {
  /** Its own name, given in the Banknotes list; absent, it is called Arc-en-Ciel (layerName.ts) */
  name?: string
  /** Absent until an image is uploaded */
  imageId?: string
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** Bands round the shape instead of in it */
  invert?: boolean
  /** Where the bands start */
  flow: ArcFlow
  /** Point's starts, one or more: their rings meet */
  points: BoxSpot[]
  /** Line's two ends, first and last, with any points that bend it between, in order along it */
  line: BoxSpot[]
  /** The bands' colours, #rrggbb, in order from where they start, three or four (ARC_COLOURS); they repeat */
  colors: string[]
  /** How wide one colour band is, mm */
  bandMm: number
  /**
   * The ridges' angle from the banknote's horizontal, degrees, −90 to 90, rising to the right as it grows: the tilt across
   * them slides the bands, so level ridges (0) answer tipping the top away, upright ones (90) turning a side away, and any
   * between both (Keller, 9 November, in place of Moves on's ↕ or ↔)
   */
  angleDeg: number
}

/**
 * Lens settings a section keeps for itself while mixed angles is on: the same fields as the banknote's lens. Any
 * left out take their defaults, not the banknote's, so a section's lens never shifts when the shared one changes.
 */
export type SectionLens = Partial<Pick<TiltSettings, 'effect' | 'cycleDeg' | 'cycleXDeg' | 'yOn' | 'runY' | 'runX' | 'revealAxis' | 'revealWobble' | 'revealLevel' | 'flatAt'>>

/**
 * One area of the thread pattern: a mask that shows, at the current tilt, the frame its own lens and track give.
 * It sits within one repeat; the pattern repeats along the whole thread.
 */
export interface ThreadSection {
  id: string
  name: string
  /** Along the thread, mm from the start of the repeat (0 to the repeat length) */
  startMm: number
  endMm: number
  /** Across the thread, as a share of its width (0 to 1) from the left edge (vertical) or the top edge (horizontal) */
  acrossStart: number
  acrossEnd: number
  /** Its own lens, used only while mixed angles is on; absent means the banknote's */
  lens?: SectionLens
  /** The frame each strip of the print shows here, by frame id, one per banknote frame; absent means every frame in order */
  track?: string[]
}

/** The thread as sections that repeat along it */
export interface ThreadPattern {
  /** Length of one repeat along the thread, mm: the tile the artwork and the sections repeat in (Tile length) */
  repeatMm: number
  /**
   * The tile follows the thread (Fit, which new banknotes start on, Keller): as long as the first image is when it fills
   * the thread's width, so it repeats back to back, or as long as the thread is wide without one. Typing a length turns
   * it off; absent, as on banknotes from before it, the tile keeps its length
   */
  fit?: boolean
  /** Off: one ridge angle for the whole thread (the banknote's lens). On: each section has its own lens */
  mixed: boolean
  sections: ThreadSection[]
}

/**
 * The banknote's back, shown when the banknotes are turned over (side to side, as a page turns): its own background, a
 * solid colour or an uploaded design. The thread and magnetic ink don't show there; the watermark, being in the paper,
 * shows through, mirrored (back.ts).
 */
export interface NoteBack {
  background: 'solid' | 'image'
  color: string
  /** The back's uploaded design; kept while the background is solid, so it comes back when Image is picked again */
  imageId?: string
}

/** One banknote in a project, with its own size, thread and frames */
export interface Note {
  id: string
  name: string
  /** Top-left corner on the canvas, in mm */
  x: number
  y: number
  widthMm: number
  heightMm: number
  /** The note's background: a solid colour, or the uploaded design */
  background: 'solid' | 'image'
  color: string
  faceImageId?: string
  /**
   * The security thread, added like any other feature (Keller, 4 November): set when the banknote has none (new
   * banknotes, or one removed), its thread, frames and pattern then waiting unused, as a new thread's; banknotes from
   * before have their thread
   */
  noThread?: true
  thread: ThreadSettings
  frames: Frame[]
  tilt: TiltSettings
  /** A sibling of the thread; absent until one is added */
  watermark?: Watermark
  /** The continuous design check for an uploaded design; absent while it is off */
  continuous?: ContinuousDesign
  /** A sibling of the thread, drawn over the watermark and under magnetic ink; absent until one is added */
  arcEnCiel?: ArcEnCiel
  /** A sibling of the thread and the watermark, drawn over the watermark and under the thread; absent until one is added */
  magneticInk?: MagneticInk
  /** The thread's sections; absent on banknotes from before patterns, which are one section with the banknote's lens */
  pattern?: ThreadPattern
  /** The back; absent until it is set, when it is plain paper of the front's colour (`backOf`) */
  back?: NoteBack
}

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  notes: Note[]
}
