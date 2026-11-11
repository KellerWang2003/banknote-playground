import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { PAPER, backOf, mirrored, turnDeg, type Side } from '../lib/back'
import { SHADE_DEG, TILT_LIMIT, perspectiveFor } from '../lib/frames'
import { lensMix, type Tilt2 } from '../lib/lens'
import { watermarkOpacity, watermarkReveal } from '../lib/light'
import { THUMB_PX, designPx, devicePx, useImageUrl, useWarmImages } from '../lib/images'
import { copyStarts, imageBox } from '../lib/artwork'
import { patternMix, patternOf, preparePattern, sectionClip, shownLabel } from '../lib/pattern'
import { threadWindowMask, windowEdges } from '../lib/thread'
import type { Frame, MagneticInk, Note } from '../lib/types'
import { paintRelief, reliefPixels, useRelief } from '../lib/relief'
import { useInkMask } from '../lib/inkMask'
import { bandsAvailable, litInkAvailable, paintLitInk } from '../lib/inkRenderer'
import { bandLook, embossOutset, fromShape, needsShape, paintArcEnCiel, useBandShape } from '../lib/bandMap'
import { arcLight } from '../lib/arcEnCiel'
import { INK_BAR_LIGHT, barShift, inkRoll, inkShift } from '../lib/magneticInk'
import { inkLight, inkPixels } from '../lib/realisticInk'
import { type PlacedBox, boxTurn } from '../lib/placed'
import { type Quarter, quarterOf } from '../lib/rotate'
import { hasThread, type PlacedLayer } from '../lib/layers'
import { framesTiltOf, showsBack, useTilt } from '../tilt/tilt'

// Height ÷ width of each image, once loaded
const aspects = new Map<string, number>()

function useImageAspect(url: string | null | undefined) {
  const [loaded, setLoaded] = useState<{ url: string; aspect: number }>()
  const aspect = url ? aspects.get(url) ?? (loaded?.url === url ? loaded.aspect : undefined) : undefined
  // Rendered without it: measure it, even if another view did since this one rendered (the browser has it by then)
  useEffect(() => {
    if (!url || aspect !== undefined) return
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth === 0) return
      const aspect = img.naturalHeight / img.naturalWidth
      aspects.set(url, aspect)
      setLoaded({ url, aspect })
    }
    img.src = url
  }, [url, aspect])
  return aspect
}

/**
 * In place of a part of a banknote whose image is still on its way (its design, a frame's image, magnetic ink's shape):
 * a shimmer, so it reads as loading rather than missing. Sweeping across its own box, as it turns with the banknote. On
 * screen only, like the outlines: export waits for every image
 */
function Loading({ style }: { style?: CSSProperties }) {
  return <Skeleton data-loading="" className="pointer-events-none absolute inset-0 rounded-none bg-foreground/5 bg-scroll" style={style} />
}

/**
 * A banknote's shape before its project is here, at `scale` px per mm: plain paper under the same shimmer a banknote
 * whose design is still loading shows, so a skeleton turns into the banknotes without changing its look (the project
 * list's and the editor's skeletons)
 */
export function NoteSkeleton({ widthMm, heightMm, scale }: { widthMm: number; heightMm: number; scale: number }) {
  return (
    <div aria-hidden="true" data-note-skeleton="" className="relative shrink-0 overflow-hidden shadow-note"
      style={{ width: widthMm * scale, height: heightMm * scale, backgroundColor: PAPER }}>
      <Skeleton className="absolute inset-0 rounded-none bg-foreground/5" />
    </div>
  )
}

/**
 * How a stretch of thread lays out its artwork, at `scale` px per mm: which way it runs, its thickness and length, and
 * its repeat, starting `offsetMm` from the stretch's start, in which each frame's image sits once.
 */
export interface FillLayout {
  direction: Note['thread']['direction']
  scale: number
  thicknessMm: number
  lengthMm: number
  repeatMm: number
  offsetMm: number
}

/**
 * One frame's artwork along the thread: its colour over the whole of it, or its image once in every repeat, upright,
 * where its place puts it (`imageBox`); nothing for an empty frame, so the thread's background shows.
 */
export function FrameFill({
  frame,
  direction,
  scale,
  thicknessMm,
  lengthMm,
  repeatMm,
  offsetMm,
  opacity = 1,
}: FillLayout & {
  frame: Frame
  opacity?: number
}) {
  const imageId = frame.kind === 'image' ? frame.imageId : undefined
  // Frames from before their proportions were recorded are measured once, from the original
  const original = useImageUrl(frame.aspect ? undefined : imageId)
  const measured = useImageAspect(original)
  const aspect = frame.aspect ?? measured
  const box = aspect ? imageBox(frame.place, aspect, repeatMm, thicknessMm, direction) : undefined
  // The display copy with as many pixels as the image shows with on this screen, however large the upload
  const url = useImageUrl(box && imageId, box && devicePx(Math.max(box.acrossSize, box.alongSize) * scale))
  if (frame.kind === 'color') return <div className="absolute inset-0" style={{ opacity, backgroundColor: frame.color }} />
  // Still on its way (for a frame from before proportions were kept, its proportions first): a shimmer along the thread
  if (imageId && (box ? url === undefined : original !== null)) return <Loading style={{ opacity }} />
  if (frame.kind !== 'image' || !url || !box) return null
  const vertical = direction === 'vertical'
  return (
    <div className="absolute inset-0" style={{ opacity }}>
      {copyStarts(box, repeatMm, offsetMm, lengthMm).map((start) => (
        <img key={start} src={url} alt="" draggable={false} className="absolute max-w-none" style={vertical
          ? { left: box.across * scale, top: start * scale, width: box.acrossSize * scale, height: box.alongSize * scale }
          : { left: start * scale, top: box.across * scale, width: box.alongSize * scale, height: box.acrossSize * scale }} />
      ))}
    </div>
  )
}

/**
 * A frame as a thumbnail: the uploaded image whole, or its colour; an empty one shows the thread's background, and one
 * whose image is still on its way a shimmer
 */
export function FrameThumb({ frame, backgroundColor }: { frame: Frame; backgroundColor?: string }) {
  const url = useImageUrl(frame.kind === 'image' ? frame.imageId : undefined, THUMB_PX)
  if (frame.kind === 'image' && frame.imageId && url === undefined) {
    return <div className="absolute inset-0" style={{ backgroundColor }}><Loading /></div>
  }
  if (frame.kind !== 'image' || !url) {
    return <div className="absolute inset-0" style={{ backgroundColor: frame.kind === 'color' ? frame.color : backgroundColor }} />
  }
  return (
    <div className="absolute inset-0" style={{ backgroundColor }}>
      <img src={url} alt="" draggable={false} className="absolute inset-0 size-full object-contain p-1" />
    </div>
  )
}

/** Light and shade reach full strength at SHADE_DEG; past it (up to TILT_LIMIT) they keep growing */
const SHADE_MAX = TILT_LIMIT / SHADE_DEG

type TiltPart = 'shade-up' | 'shade-down' | 'shade-left' | 'shade-right' | 'sheen' | 'blend' | 'watermark' | 'ink-shift' | 'ink-bar'

/** The bar's look on magnetic ink, and how the ink is rotated on the banknote, which turns the tilt it rolls on */
type InkBar = Pick<MagneticInk, 'barAxis' | 'barWidth' | 'rotationDeg'>

/**
 * Everything about a tilt that changes continuously: the 3D turn, the light and shade overlays' opacity,
 * where the sheen sits, the fade between two frames, how clearly the watermark shows (its `depth` at `reveal`), and
 * magnetic ink's Tilted colour and where its bar has rolled (`ink`), and how far the note has turned over (`turn`, in
 * degrees of its own side turn, `turnDeg`). All of it is transform or opacity, which the GPU animates without
 * repainting. Live notes write these straight onto their elements every animation frame instead of re-rendering React.
 */
function tiltStyle(angle: number, angleX: number, blend: number, depth: number, reveal: number, ink?: InkBar, turn = 0) {
  const t = angle / SHADE_DEG
  const tx = angleX / SHADE_DEG
  const share = (v: number) => Math.min(Math.max(v, 0) / SHADE_MAX, 1)
  const tilt = { x: angleX, y: angle }
  const roll = ink ? barShift(ink, inkRoll(ink, tilt)) : 0
  const parts: Record<TiltPart, CSSProperties> = {
    'shade-up': { opacity: share(-t) },
    'shade-down': { opacity: share(t) },
    'shade-right': { opacity: share(tx) },
    'shade-left': { opacity: share(-tx) },
    sheen: { transform: `translateY(${t * 120}%)` },
    blend: { opacity: blend },
    watermark: { opacity: watermarkOpacity(depth, reveal) },
    'ink-shift': { opacity: inkShift(tilt) },
    'ink-bar': { transform: ink?.barAxis === 'x' ? `translateX(${roll}%)` : `translateY(${roll}%)` },
  }
  const side = angleX + turn
  return { rotate: side ? `rotateX(${angle}deg) rotateY(${side}deg)` : `rotateX(${angle}deg)`, parts }
}

const CLEAR_WHITE = 'rgba(255,255,255,0)'

/**
 * Magnetic ink's bright bar at rest, across the middle of the shape: level when it rolls on ↕, upright on ↔, white in
 * its middle fading out to either side. Its roll is a translate (`tiltStyle`).
 */
function inkBarBox(ink: InkBar, live: boolean): CSSProperties {
  const along = `${ink.barWidth * 100}%`
  const from = `${(0.5 - ink.barWidth / 2) * 100}%`
  const light = (deg: number) => `linear-gradient(${deg}deg, ${CLEAR_WHITE}, rgba(255,255,255,${INK_BAR_LIGHT}) 50%, ${CLEAR_WHITE})`
  const willChange = live ? 'transform' : undefined
  return ink.barAxis === 'x'
    ? { top: 0, bottom: 0, left: from, width: along, background: light(90), willChange }
    : { left: 0, right: 0, top: from, height: along, background: light(180), willChange }
}

/**
 * Which frames show, and which one counts as current: the only parts of a tilt that need a re-render. One entry
 * per section of the thread's pattern; a thread from before patterns has the one.
 */
const shownKey = (note: Note, angle: number, angleX: number) => {
  if (preparePattern(note).plain) {
    const mix = lensMix(note, { x: angleX, y: angle })
    return `${mix.base}|${mix.blend > 0 ? mix.next : mix.base}|${mix.current}`
  }
  return patternMix(note, { x: angleX, y: angle }).map((mix) => `${mix.base}|${mix.blend > 0 ? mix.next : mix.base}|${mix.current}`).join(';')
}
const parseShown = (key: string) => key.split(';').map((entry) => entry.split('|').map(Number))
/** How much the next frame shows over the base one, per section */
const blendsAt = (note: Note, angle: number, angleX: number) =>
  preparePattern(note).plain ? [lensMix(note, { x: angleX, y: angle }).blend] : patternMix(note, { x: angleX, y: angle }).map((mix) => mix.blend)

/**
 * What a stretch of thread shows: the frames each section of the pattern shows (`shown`, base and next per section),
 * through that section's areas repeated along it from the fill's offset, as the frames' images are. Fading frames
 * take their opacity from `blends`, or live views write it onto `[data-tilt="blend"]` themselves (`data-section`
 * says whose). A plain thread (one section playing the banknote's lens) is drawn without clipping.
 */
export function ThreadArt({ note, shown, blends, fill }: {
  note: Note
  shown: number[][]
  blends?: number[]
  fill: FillLayout
}) {
  const { lengthMm, scale, offsetMm } = fill
  const { frames } = note
  // Only the frames shown are drawn; the others' copies get ready for when a tilt comes to them
  useWarmImages(frames.map((frame) => (frame.kind === 'image' ? frame.imageId : undefined)))
  const prepared = preparePattern(note)
  if (prepared.plain) {
    const [base, next] = shown[0] ?? []
    const baseFrame = frames.at(base)
    const nextFrame = next !== base ? frames.at(next) : undefined
    return (
      <>
        {baseFrame && <FrameFill frame={baseFrame} {...fill} />}
        {nextFrame && <div className="absolute inset-0" data-tilt="blend" style={blends ? { opacity: blends[0] } : {}}><FrameFill frame={nextFrame} {...fill} /></div>}
      </>
    )
  }
  return prepared.sections.map((p, i) => {
    const entry = shown[i]
    if (!entry) return null
    const [base, next] = entry
    const baseFrame = frames.at(base)
    const nextFrame = next !== base ? frames.at(next) : undefined
    return (
      <div key={p.section.id} data-section={i} className="absolute inset-0" style={sectionClip(p.section, prepared.pattern.repeatMm, offsetMm, lengthMm, scale, fill.direction)}>
        {baseFrame && <FrameFill frame={baseFrame} {...fill} />}
        {nextFrame && <div className="absolute inset-0" data-tilt="blend" data-section={i} style={blends ? { opacity: blends[i] } : {}}><FrameFill frame={nextFrame} {...fill} /></div>}
      </div>
    )
  })
}

const SIDE_LIGHT = `rgba(255,255,255,${0.12 * SHADE_MAX})`
const SIDE_DARK = `rgba(0,0,0,${0.08 * SHADE_MAX})`

/**
 * The tilt, light and turn a live note follows, the tilt its frames are shown at while the timeline has been scrubbed,
 * and the quarter turns the banknotes are rotated on screen (which realistic magnetic ink's lamp stays still through)
 */
type LiveState = { angle: number; angleX: number; light: number; turn: number; frameTilts: Record<string, { x: number; y: number }>; quarterTurns?: number }

/**
 * The note with its thread, drawn at `scale` px per mm. The frame shown comes from the tilt (up/down `angle`,
 * side `angleX`) through the note's lens, or with `live` from the shared tilt as it moves; with `perspective`
 * the note also turns in 3D, and `sheen` adds a highlight that travels along the thread. Its watermark, in the
 * note's own colours under the thread, is only a hint flat, comes out clearly as the note tilts, and shows flat
 * held to the light. Its magnetic ink, over the watermark and under the thread, shifts colour as the note turns away
 * and rolls its bright bar on one tilt, or with `realistic` is lit as metal flakes. Its Arc-en-Ciel, under the ink, shows
 * its colour bands sliding as the note tilts across its ridges, or with `realistic` its embossed ridges lit. Its back
 * (`side`, or for a live note the shared turn) shows the back's own background and the watermark through it, mirrored,
 * and nothing else: no thread, no Arc-en-Ciel, no magnetic ink.
 */
export function NoteView({
  note,
  scale,
  angle = 0,
  angleX = 0,
  live = false,
  perspective = false,
  flat = false,
  sheen = false,
  realistic = false,
  reveal,
  showWindowCuts = false,
  showFrameNumber = false,
  offsetMm = 0,
  selected,
  hovered,
  side = 'front',
}: {
  note: Note
  scale: number
  angle?: number
  angleX?: number
  /** Follows the shared tilt (`useTilt`) itself, re-rendering only when the frame shown changes */
  live?: boolean
  perspective?: boolean
  /**
   * With `perspective`, keeps the banknote flat on the screen, without the light and shade of turning, while it still turns
   * over in 3D and its security features change with the tilt: Demo on a phone, where the phone itself is what tilts
   * (`DemoView`)
   */
  flat?: boolean
  sheen?: boolean
  /**
   * Realistic, the canvas's switch beside the lamp (`src/lib/realistic.ts`): magnetic ink lit as metal flakes and
   * Arc-en-Ciel drawn as embossed ridges in the lamp's light, where the browser can (WebGL)
   */
  realistic?: boolean
  /**
   * How clearly the watermark shows, 0 (faint) to 1 (clear), fixed. Without it a live note follows the shared light
   * and tilt, and a still note shows it as at its tilt in reflected light.
   */
  reveal?: number
  showWindowCuts?: boolean
  /** Labels the thread with the number of the frame it shows; exports draw it too when the toggle is on */
  showFrameNumber?: boolean
  /** Where along the thread the pattern's repeat starts, mm: a preview of where the print may land */
  offsetMm?: number
  /** On the canvas, the part picked, outlined firmly */
  selected?: 'thread' | PlacedLayer
  /** On the canvas, the part a click would pick, outlined lightly */
  hovered?: 'thread' | PlacedLayer
  /** The face a still note shows; a live one shows whichever the shared turn has come round to, turning over in 3D with `perspective` */
  side?: Side
}) {
  const { thread, frames, watermark, arcEnCiel, magneticInk } = note
  const root = useRef<HTMLDivElement>(null)
  const mm = (value: number) => value * scale
  // Live notes re-render once as they come edge-on, where the face changes
  const liveBack = useTilt((s) => live && showsBack(s))
  const back = live ? liveBack : side === 'back'
  const shownBack = back ? backOf(note) : undefined
  const design = shownBack ? (shownBack.background === 'image' ? shownBack.imageId : undefined) : note.background === 'image' ? note.faceImageId : undefined
  const face = useImageUrl(design, designPx(note, scale))
  // Live notes re-render only when this changes, not on every animation frame
  const liveShown = useTilt((s) => (live ? shownKey(note, framesTiltOf(s, note.id).y, framesTiltOf(s, note.id).x) : ''))
  const shown = parseShown(live ? liveShown : shownKey(note, angle, angleX))
  // Read in more detail once zoomed in far enough to need it, so an SVG's stays sharp
  const relief = useRelief(watermark, watermark && devicePx(Math.max(watermark.widthMm, watermark.heightMm) * scale))
  const light = useRef<HTMLCanvasElement>(null)
  // As many pixels as the watermark shows at on this screen, up to the light layer's own
  const lightSize = relief && watermark ? reliefPixels(relief, devicePx(watermark.widthMm * scale)) : undefined
  const lightWidth = lightSize?.width ?? 1
  const lightHeight = lightSize?.height ?? 1
  useLayoutEffect(() => {
    // Again whenever its size changes too, as that clears it
    if (light.current && relief && lightWidth * lightHeight > 0) paintRelief(light.current, relief)
  }, [relief, lightWidth, lightHeight])
  const depth = watermark?.depth ?? 0
  const inkMask = useInkMask(magneticInk, magneticInk && devicePx(Math.max(magneticInk.widthMm, magneticInk.heightMm) * scale))
  // Only its bar's look, and its rotation on the banknote, change how it tilts
  const inkBar: InkBar | undefined = magneticInk && { barAxis: magneticInk.barAxis, barWidth: magneticInk.barWidth, rotationDeg: magneticInk.rotationDeg }
  // Realistic, it is lit as metal into a canvas of its own, as many pixels as it shows with, where the browser can (WebGL);
  // elsewhere it keeps its flat look
  const inkLit = realistic && magneticInk !== undefined && litInkAvailable()
  const inkPx = inkLit && magneticInk ? inkPixels(magneticInk.widthMm * scale, magneticInk.heightMm * scale, devicePx(1)) : undefined
  const inkCanvas = useRef<HTMLCanvasElement>(null)
  const paintInk = (tilt: Tilt2, quarter: Quarter) => {
    const canvas = inkCanvas.current
    if (canvas && magneticInk && inkMask?.canvas && inkPx) {
      paintLitInk(canvas, inkMask.canvas, inkLight(magneticInk, note, tilt, perspectiveFor(note, 1), quarter), inkPx.cell)
    }
  }
  // Arc-en-Ciel: its shape's mask as magnetic ink's is read, and for bands from the shape (Edge, Holes) or its white edge
  // its maps; drawn into a canvas of its own in its box, as many pixels as it shows with, again only when its bands move,
  // or with Realistic on its ridges turn from the lamp (where the browser can draw them: WebGL), the canvas reaching past
  // the box all round for the white edge
  const arcMask = useInkMask(arcEnCiel, arcEnCiel && devicePx(Math.max(arcEnCiel.widthMm, arcEnCiel.heightMm) * scale))
  const arcShape = useBandShape(arcEnCiel && needsShape(arcEnCiel) ? arcEnCiel : undefined)
  const arcLit = realistic && arcEnCiel !== undefined && bandsAvailable()
  const arcOutset = arcEnCiel ? embossOutset(arcEnCiel, arcShape?.emboss) : 0
  const arcPx = arcEnCiel
    ? inkPixels((arcEnCiel.widthMm + 2 * arcOutset) * scale, (arcEnCiel.heightMm + 2 * arcOutset) * scale, devicePx(1))
    : undefined
  const arcCanvas = useRef<HTMLCanvasElement>(null)
  const paintArc = (tilt: Tilt2, view: Tilt2, quarter: Quarter) => {
    const canvas = arcCanvas.current
    const look = canvas && arcEnCiel && bandLook(arcEnCiel, arcShape, tilt, arcLit ? arcLight(arcEnCiel, view, quarter) : undefined)
    if (canvas && look && arcMask?.canvas) paintArcEnCiel(canvas, arcMask.canvas, look)
  }
  const revealOf = (state: LiveState) => reveal ?? watermarkReveal(state.light, { x: state.angleX, y: state.angle })

  // Live: write the continuous parts straight onto the elements, after every render and on every tilt change
  const apply = useRef((_state: LiveState) => {})
  useLayoutEffect(() => {
    apply.current = (state: LiveState) => {
      const element = root.current
      if (!live || !element) return
      const { angle, angleX } = state
      // The frames follow the timeline once it is scrubbed; the turn, shade and watermark follow the banknote's tilt
      const frameTilt = framesTiltOf(state, note.id)
      const blends = blendsAt(note, frameTilt.y, frameTilt.x)
      const turn = turnDeg(state.turn)
      const style = tiltStyle(angle, angleX, blends[0] ?? 0, depth, revealOf(state), inkBar, turn)
      // Flat, only turning over turns it: the phone it shows on is what tilts
      element.style.transform = !perspective ? '' : !flat ? style.rotate : turn ? `rotateY(${turn}deg)` : ''
      for (const part of element.querySelectorAll<HTMLElement>('[data-tilt]')) {
        const section = part.dataset.section
        Object.assign(part.style, section === undefined ? style.parts[part.dataset.tilt as TiltPart] : { opacity: blends[Number(section)] ?? 0 })
      }
      // Realistic ink turns from the lamp as the banknote turns on screen, turning over included; it draws again only when
      // that changes, not with the light or the timeline
      const view = { x: angleX + (perspective ? turnDeg(state.turn) : 0), y: angle }
      const quarter = quarterOf(state.quarterTurns ?? 0)
      if (inkLit) paintInk(view, quarter)
      // Arc-en-Ciel's bands slide with the banknote's own tilt, whichever way it is rotated on screen; Realistic, its ridges
      // turn from the lamp as the ink does
      paintArc({ x: angleX, y: angle }, view, quarter)
    }
    apply.current(useTilt.getState())
  })
  // A still note's realistic ink and Arc-en-Ciel, as at its own tilt
  useLayoutEffect(() => {
    if (live) return
    if (inkLit) paintInk({ x: angleX, y: angle }, 0)
    paintArc({ x: angleX, y: angle }, { x: angleX, y: angle }, 0)
  })
  useLayoutEffect(() => {
    if (!live) return
    return useTilt.subscribe((state, previous) => {
      if (state.angle !== previous.angle || state.angleX !== previous.angleX || state.light !== previous.light || state.turn !== previous.turn
        || state.frameTilts[note.id] !== previous.frameTilts[note.id] || state.quarterTurns !== previous.quarterTurns) apply.current(state)
    })
  }, [live, note.id])

  const horizontal = thread.direction === 'horizontal'
  const lengthMm = horizontal ? note.widthMm : note.heightMm
  const strip: CSSProperties = horizontal
    ? { left: 0, top: mm(thread.positionMm - thread.widthMm / 2), width: mm(lengthMm), height: mm(thread.widthMm) }
    : { left: mm(thread.positionMm - thread.widthMm / 2), top: 0, width: mm(thread.widthMm), height: mm(lengthMm) }

  const fill = { direction: thread.direction, scale, thicknessMm: thread.widthMm, lengthMm, repeatMm: patternOf(note).repeatMm, offsetMm }

  const windowMask = threadWindowMask(thread, scale)
  // Static notes (thumbnails, tests) are drawn from props; live ones leave these to apply()
  const blends = live ? undefined : blendsAt(note, angle, angleX)
  const still = blends && tiltStyle(angle, angleX, blends[0] ?? 0, depth, revealOf({ angle, angleX, light: 0, turn: 0, frameTilts: {} }), inkBar)
  const part = (name: TiltPart, style: CSSProperties = {}) => ({ 'data-tilt': name, style: { ...style, ...still?.parts[name] } })
  // Its box, turned about its middle as far as it is rotated on the banknote: what it draws turns with it, and takes a
  // press only within it as it shows
  const placed = (box: PlacedBox): CSSProperties =>
    ({ left: mm(box.xMm), top: mm(box.yMm), width: mm(box.widthMm), height: mm(box.heightMm), transform: boxTurn(box) })
  // Seen from the back, the watermark lies the other way round, at the other side, turned the other way
  const watermarkBox = watermark && placed(back ? mirrored(watermark, note) : watermark)
  const arcBox = arcEnCiel && placed(arcEnCiel)
  // Its shape, or the maps its bands start from, still on their way: a shimmer in its box meanwhile
  const arcLoading = arcEnCiel?.imageId !== undefined && (arcMask === undefined || (fromShape(arcEnCiel) && arcShape === undefined))
  const inkBox = magneticInk && placed(magneticInk)
  // The thread shows only on the front (Keller), and only once the banknote has one (Keller, 4 November: it is added
  // like any other feature)
  const threadShown = !back && hasThread(note)
  // The back has only the watermark to outline
  const boxOf = (target: 'thread' | PlacedLayer | undefined) =>
    target === 'watermark' ? watermarkBox : back ? undefined : target === 'thread' ? (threadShown ? strip : undefined)
      : target === 'arcEnCiel' ? arcBox : target === 'magneticInk' ? inkBox : undefined
  const inkShape = inkMask && `url(${inkMask.url})`
  const art = <ThreadArt note={note} shown={shown} blends={blends} fill={fill} />

  return (
    <div
      ref={root}
      data-back={back ? '' : undefined}
      className="relative overflow-hidden shadow-note"
      style={{
        // Square-cornered, as a banknote is cut, here and in every export (Keller, 9 November: "banknotes shouldn't have
        // corner radius at all"; until then 1.5 mm)
        width: mm(note.widthMm),
        height: mm(note.heightMm),
        backgroundColor: PAPER,
        transform: perspective && still && !flat ? still.rotate : undefined,
        willChange: live && perspective ? 'transform' : undefined,
      }}
    >
      {face && <img src={face} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />}
      {/* The design still on its way: the paper shimmers where it will show, under everything drawn over it */}
      {design && face === undefined && <Loading />}

      {watermarkBox && watermark?.imageId && (
        // Light through thinner paper (relief.ts, through its levels), colour-dodged over the design: it only ever
        // brightens it, in proportion, so it keeps the note's own colours and dark print stays dark. Its opacity is how
        // much of that light comes through. The thread lies over it, unchanged. On the canvas it takes a press, faint or
        // clear, so it drags as the thread does; not with no depth to show. The same canvas on either face, so its
        // light stays painted: from the back it is the other way round
        <canvas ref={light} data-watermark={note.id} data-placed="watermark" width={lightWidth} height={lightHeight}
          className={cn('absolute', live && depth > 0 ? 'cursor-move' : 'pointer-events-none')}
          {...part('watermark', back
            ? { ...watermarkBox, mixBlendMode: 'color-dodge', transform: [watermarkBox.transform, 'scaleX(-1)'].filter(Boolean).join(' ') }
            : { ...watermarkBox, mixBlendMode: 'color-dodge' })} />
      )}

      {!back && arcBox && arcLoading && <Loading style={arcBox} />}

      {!back && arcBox && arcEnCiel?.imageId && !arcLoading && arcMask && arcPx && (
        // Arc-en-Ciel, offset print over the design and the watermark, under magnetic ink and the thread: its colour bands
        // drawn whole on the GPU through its shape's mask (inkRenderer.ts), sliding as the note tilts. Like the other placed
        // layers it takes a press anywhere in its box, to drag it
        <div data-arc-en-ciel={note.id} data-placed="arcEnCiel" className={cn('absolute', live ? 'cursor-move' : 'pointer-events-none')} style={arcBox}>
          <canvas ref={arcCanvas} width={arcPx.width} height={arcPx.height} className="pointer-events-none absolute"
            style={{ left: -mm(arcOutset), top: -mm(arcOutset), width: mm(arcEnCiel.widthMm + 2 * arcOutset), height: mm(arcEnCiel.heightMm + 2 * arcOutset) }} />
        </div>
      )}

      {/* Magnetic ink's shape still being had or worked out: a shimmer in its box meanwhile */}
      {!back && inkBox && magneticInk?.imageId && inkMask === undefined && <Loading style={inkBox} />}

      {!back && inkBox && magneticInk?.imageId && inkMask && inkPx && (
        // Realistic: lit as metal through its mask, drawn whole on the GPU (inkRenderer.ts), in the same place and taking a
        // press the same way
        <div data-magnetic-ink={note.id} data-placed="magneticInk" data-realistic=""
          className={cn('absolute', live ? 'cursor-move' : 'pointer-events-none')} style={inkBox}>
          <canvas ref={inkCanvas} width={inkPx.width} height={inkPx.height} className="absolute inset-0 size-full" />
        </div>
      )}

      {!back && inkBox && magneticInk?.imageId && !inkPx && inkShape && inkBar && (
        // Magnetic ink, printed over the design and the watermark, under the thread: its Flat colour, the Tilted one fading
        // in over it as the note turns away, and the bright bar rolling across on its tilt, all clipped to the shape by
        // its mask (inkMask.ts). Like the watermark, it takes a press on the canvas anywhere in its box, to drag it
        <div data-magnetic-ink={note.id} data-placed="magneticInk"
          className={cn('absolute overflow-hidden', live ? 'cursor-move' : 'pointer-events-none')}
          style={{ ...inkBox, maskImage: inkShape, WebkitMaskImage: inkShape, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }}>
          <div className="absolute inset-0" style={{ backgroundColor: magneticInk.color }} />
          <div className="absolute inset-0" {...part('ink-shift', { backgroundColor: magneticInk.tiltedColor })} />
          <div className="absolute" {...part('ink-bar', inkBarBox(inkBar, live))} />
        </div>
      )}

      {threadShown && showWindowCuts && thread.windows.enabled && (
        <div aria-hidden="true" data-window-ghost className="pointer-events-none absolute overflow-hidden" style={{ ...strip, opacity: 0.2, backgroundColor: thread.backgroundColor }}>
          {art}
        </div>
      )}

      {threadShown && (
        <div
          data-thread=""
          className={cn('absolute overflow-hidden', horizontal ? 'cursor-ns-resize' : 'cursor-ew-resize')}
          style={{ ...strip, ...windowMask, backgroundColor: thread.backgroundColor }}
        >
          {art}
          {sheen && (
            // The highlight sits halfway along the thread when flat and slides along it as the note tilts
            <div
              className="absolute inset-0 mix-blend-soft-light"
              {...part('sheen', {
                background: 'linear-gradient(180deg, transparent 32%, rgba(255,255,255,0.7) 50%, transparent 68%)',
                willChange: live ? 'transform' : undefined,
              })}
            />
          )}
        </div>
      )}

      {threadShown && showWindowCuts && thread.windows.enabled && (
        <div aria-hidden="true" data-window-cuts className="pointer-events-none absolute" style={strip}>
          {windowEdges(thread, lengthMm).map((edge) => (
            <div key={edge} className="absolute border-dashed border-fuchsia-500" style={horizontal
              ? { left: mm(edge), top: -4, bottom: -4, borderLeftWidth: 1 }
              : { top: mm(edge), left: -4, right: -4, borderTopWidth: 1 }} />
          ))}
        </div>
      )}

      {threadShown && showFrameNumber && frames.length > 0 && (
        <div aria-hidden="true" data-frame-number className="pointer-events-none absolute flex items-center justify-center" style={strip}>
          <span
            className="rounded-full bg-foreground/85 px-1.5 font-semibold leading-none text-background tabular-nums shadow-sm"
            style={{ fontSize: Math.max(10, Math.min(mm(thread.widthMm) * 0.6, 18)), paddingBlock: 3 }}
          >
            {shownLabel(shown.map((entry) => entry[2]))}
          </span>
        </div>
      )}

      {perspective && !flat && (
        // Light and shade as the note turns: they fade in with opacity rather than redrawing a gradient each frame. Not
        // while it lies flat on a phone, where the room's own light falls on the phone as it turns
        <>
          {/* Turning sideways, the edge turning away darkens a little and the near edge catches the light */}
          <div className="pointer-events-none absolute inset-0" {...part('shade-right', { background: `linear-gradient(90deg, ${SIDE_LIGHT}, ${SIDE_DARK})` })} />
          <div className="pointer-events-none absolute inset-0" {...part('shade-left', { background: `linear-gradient(90deg, ${SIDE_DARK}, ${SIDE_LIGHT})` })} />
          {/* Turning up or down, the note catches a little light or shade */}
          <div className="pointer-events-none absolute inset-0" {...part('shade-up', { background: `linear-gradient(180deg, ${SIDE_LIGHT}, ${SIDE_DARK})` })} />
          <div className="pointer-events-none absolute inset-0" {...part('shade-down', { background: `linear-gradient(180deg, ${SIDE_DARK}, ${SIDE_LIGHT})` })} />
        </>
      )}

      {/* Canvas only, never exported. Outside the part, so a thin thread keeps its artwork in view, edged in the background
          colour so the line shows on any design, and over everything, so the watermark's crosses the thread */}
      {boxOf(selected) && <div aria-hidden="true" data-outline="selected" className="pointer-events-none absolute ring-2 ring-primary shadow-[0_0_0_3px_var(--background)]" style={boxOf(selected)} />}
      {boxOf(hovered) && <div aria-hidden="true" data-outline="hover" className="pointer-events-none absolute ring-1 ring-primary shadow-[0_0_0_2px_var(--background)]" style={boxOf(hovered)} />}
    </div>
  )
}
