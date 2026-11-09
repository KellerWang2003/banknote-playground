import { Maximize, Minus, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { IconButton, Panel } from '../components/controls'
import { ThreadArt } from '../components/NoteView'
import { imageBox, placeOf, uprightBox, type UprightBox } from '../lib/artwork'
import { clamp } from '../lib/frames'
import { lensMix } from '../lib/lens'
import {
  fillGaps,
  mod,
  patternMix,
  patternOf,
  preparePattern,
  resizeEdge,
  sectionAt,
  type Edge,
  type PatternPoint,
} from '../lib/pattern'
import { updateNote } from '../lib/store'
import type { Note, ThreadPattern, ThreadSection } from '../lib/types'
import { framesTiltOf, setTilt, springToFlat, useTilt } from '../tilt/tilt'
import { ImagePlacer } from './ImagePlacer'
import { Measure } from './Measure'
import { FitTileButton, ThreadWidthField, TileLengthField } from './ThreadSizeFields'
import { useElementSize } from './useElementSize'

/** Px per mm the view never goes past, so a short repeat doesn't blow up into a blur */
const MAX_SCALE = 120
/** Room around the strip for the measurements, px: wide beside it, where the fields sit, shorter above and below */
const MARGIN = { x: 104, y: 76 }
/** How far either side of an edge grabs it, px */
const EDGE_PX = 5

type Rect = Pick<ThreadSection, 'startMm' | 'endMm' | 'acrossStart' | 'acrossEnd'>
type Gesture =
  | { mode: 'resize'; id: string; edge: Edge; pattern: ThreadPattern; copy: number }
  | { mode: 'tilt'; startX: number; startY: number; start: number; startSide: number; moved: boolean; on?: PatternPoint }
  | { mode: 'pan'; startX: number; startY: number; from: View; button: number; moved: boolean }

/** Repeats shown: always three, however long the repeat (Keller) */
const REPEATS = 3
/** The repeat being edited: the middle one, the others either side copying it (Keller) */
const MIDDLE = 1

/** The view: px per mm, and where the thread's start (its top or left end, at the middle of its width) sits, px from the middle of the room */
type View = { scale: number; x: number; y: number }
/** How far the view zooms out and in from its fit */
const ZOOM_LIMITS = { min: 0.25, max: 8 }

const EDGES: Edge[] = ['startMm', 'endMm', 'acrossStart', 'acrossEnd']
const isAlong = (edge: Edge) => edge === 'startMm' || edge === 'endMm'

/** Three repeats of `repeatMm` on a thread `widthMm` thick, fitted into the room and centred in it */
function fitView(box: { width: number; height: number }, repeatMm: number, widthMm: number, vertical: boolean): View {
  const free = { width: box.width - 2 * MARGIN.x, height: box.height - 2 * MARGIN.y }
  const room = { along: vertical ? free.height : free.width, across: vertical ? free.width : free.height }
  // However long the repeat, the thread fits: a cramped view shrinks it rather than spilling over the panels
  const scale = Math.max(0.05, Math.min(MAX_SCALE, room.along / (REPEATS * repeatMm), room.across / widthMm))
  const half = (REPEATS * repeatMm * scale) / 2
  return { scale, x: vertical ? 0 : -half, y: vertical ? -half : 0 }
}

/**
 * The centre of the thread editor: the thread magnified over three repeats, in its own direction, showing
 * the real artwork at the current tilt, with the repeat's ends, each section's outline and, optionally, its ridges.
 * The middle repeat is the one edited; the two either side copy it (Keller). A drag around the thread pans; a drag on
 * it, on any of its repeats, tilts it, and only then does the thread turn in perspective: the timeline, the pad and
 * playback change frames with it lying flat (Keller). A click on it picks the section under it. On the middle repeat the current frame's image (`frame`, the timeline's) drags straight away, and once picked
 * its corners and sides resize it (`ImagePlacer`); the selected section's edges resize it (snapping to 0.5 mm along and twelfths
 * across), and a double-click on empty thread fills that gap. Beside the middle repeat, the repeat and the thread's
 * thickness to read and edit. Scrolling or a middle-button drag also pans, and pinching or ⌘/Ctrl-scrolling zooms. The
 * view fills its parent, behind the floating panels, as the canvas does; the thread fits and centres in `room`
 * (Tailwind insets clear of the panels), and panned it runs on under them instead of being cut off at that box. A
 * longer repeat or a thicker thread keeps the zoom, so the thread itself grows.
 */
export function PatternView({ note, projectId, selectedId, onSelect, onThreadClick, ridges, ridgeOpacity = 1, frame, limit = 90, room: roomClassName }: {
  note: Note
  projectId: string
  selectedId?: string
  onSelect: (id: string | undefined) => void
  /** A click on the thread, or a press on the frame's image there: the right panel turns to the frames (Keller) */
  onThreadClick?: () => void
  /** Hatch each section at its ridge angle */
  ridges: boolean
  /** How strongly the ridges show, 0 to 1 */
  ridgeOpacity?: number
  /** The frame the timeline is on (by index): its image can be moved and resized on the thread */
  frame?: number
  /** How far a drag may tilt, either way */
  limit?: number
  /** Where the thread fits and centres, as Tailwind insets within the view */
  room?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const room = useRef<HTMLDivElement>(null)
  const size = useElementSize(room)
  const gesture = useRef<Gesture | null>(null)
  // A drag on the thread is tilting it: only then does the thread turn with the tilt
  const [dragTilting, setDragTilting] = useState(false)
  const [hover, setHover] = useState<string>()
  const uid = useId().replace(/:/g, '')
  const angle = useTilt((s) => s.angle)
  const angleX = useTilt((s) => s.angleX)
  // The frames shown: the timeline's once it is scrubbed (Keller), else the tilt's
  const shownAngle = useTilt((s) => framesTiltOf(s, note.id).y)
  const shownAngleX = useTilt((s) => framesTiltOf(s, note.id).x)
  const { thread } = note
  const vertical = thread.direction === 'vertical'
  const pattern = patternOf(note)
  const repeat = pattern.repeatMm
  // The view fits the repeat and thickness it opened with, or had when Fit was last asked for: changing them later
  // keeps the zoom, so the thread grows from its start and about its middle instead (Keller). Once panned or zoomed,
  // the view stays as it was left. Turning the thread opens a new view (ThreadEditor keys this one by direction)
  const [basis, setBasis] = useState(() => ({ repeatMm: repeat, widthMm: thread.widthMm }))
  const [moved, setView] = useState<View>()
  const fitted = size ? fitView(size, basis.repeatMm, basis.widthMm, vertical) : undefined
  const view = moved ?? fitted
  const refit = () => {
    setBasis({ repeatMm: repeat, widthMm: thread.widthMm })
    setView(undefined)
  }
  // The wheel's listener is added once, so it reads the view from here
  const latest = useRef({ view, fit: fitted?.scale })
  useEffect(() => { latest.current = { view, fit: fitted?.scale } })
  const [panning, setPanning] = useState(false)
  // The current frame's image, once a click has picked it: its box and corners show
  const [pickedImage, setPickedImage] = useState<string>()

  // Wheel needs a non-passive listener so the page never scrolls or zooms: scroll pans, pinch or ⌘/Ctrl-scroll zooms
  useEffect(() => {
    const element = box.current
    if (!element) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view: v, fit } = latest.current
      if (!v || !fit) return
      if (e.ctrlKey || e.metaKey) {
        // About the pointer, measured from the middle of the room, where the thread is centred
        const r = (room.current ?? element).getBoundingClientRect()
        // Mouse wheels send big steps, trackpad pinches small ones; cap each step so neither jumps
        setView(zoomAround(v, Math.exp(-clamp(e.deltaY, -40, 40) * 0.01), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, fit))
      } else {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const prepared = preparePattern(note)
  if (!view) return <div ref={box} className="absolute inset-0 overflow-hidden"><div ref={room} className={cn('absolute inset-0', roomClassName)} /></div>
  const repeats = REPEATS
  const { scale } = view
  const fit = fitted?.scale ?? scale
  const lengthMm = repeats * repeat
  const thickness = thread.widthMm * scale
  const length = lengthMm * scale
  const width = vertical ? thickness : length
  const height = vertical ? length : thickness
  // The strip is centred in the room: shifted so its start sits at the view's point, whatever its length and width
  const shift = vertical ? { x: view.x, y: view.y + height / 2 } : { x: view.x + width / 2, y: view.y }

  // What each section shows now: the view follows the tilt, re-rendering as it moves
  const tilt = { x: shownAngleX, y: shownAngle }
  const mixes = prepared.plain ? [lensMix(note, tilt)] : patternMix(note, tilt)
  const shown = mixes.map((m) => [m.base, m.blend > 0 ? m.next : m.base, m.current])
  const fill = { direction: thread.direction, scale, thicknessMm: thread.widthMm, lengthMm, repeatMm: repeat, offsetMm: 0 }

  /** A rect of copy `k`, in px within the strip */
  const place = (r: Rect, k: number) => {
    const a0 = (k * repeat + r.startMm) * scale, a1 = (k * repeat + r.endMm) * scale
    const c0 = r.acrossStart * thickness, c1 = r.acrossEnd * thickness
    return vertical ? { x: c0, y: a0, width: c1 - c0, height: a1 - a0 } : { x: a0, y: c0, width: a1 - a0, height: c1 - c0 }
  }
  // The thread turns in perspective only while a drag on it tilts it (Keller), so nothing is ever placed on it turned
  const turned = dragTilting && (angle !== 0 || angleX !== 0)
  const depth = 2.2 * Math.max(width, height)
  const locate = (e: { clientX: number; clientY: number }) => {
    // The untilted box: the strip's parent, the same size and never turned
    const r = (strip.current!.parentElement ?? strip.current!).getBoundingClientRect()
    const px = e.clientX - r.left, py = e.clientY - r.top
    return { along: (vertical ? py : px) / scale, across: (vertical ? px : py) / thickness }
  }
  const write = (next: ThreadPattern) => updateNote(projectId, note.id, (n) => ({ ...n, pattern: next }))
  const noteRef = { projectId, noteId: note.id }
  const sameRect = (a: Rect, b: Rect) => a.startMm === b.startMm && a.endMm === b.endMm && a.acrossStart === b.acrossStart && a.acrossEnd === b.acrossEnd
  const alongCursor = vertical ? 'cursor-ns-resize' : 'cursor-ew-resize'
  const acrossCursor = vertical ? 'cursor-ew-resize' : 'cursor-ns-resize'

  const selected = pattern.sections.find((s) => s.id === selectedId)
  /** A drag that moves the view, from wherever it starts */
  const startPan = (e: React.PointerEvent<HTMLElement>) => {
    gesture.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, from: view, button: e.button, moved: false }
    setPanning(true)
  }
  /** A drag that tilts the thread, from where the tilt is heading (springing back on release unless the pad holds it) */
  const startTilt = (e: React.PointerEvent<HTMLElement>, on?: PatternPoint) => {
    const s = useTilt.getState()
    const start = s.source === 'drag' ? s.target : s.angle
    const startSide = s.source === 'drag' ? s.targetX : s.angleX
    gesture.current = { mode: 'tilt', startX: e.clientX, startY: e.clientY, start, startSide, moved: false, on }
    setTilt({ source: 'drag', target: start, targetX: startSide })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    // A field being typed in lets go, so Delete and Escape reach the sections
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('input, textarea')) document.activeElement.blur()
    setPickedImage(undefined)
    // The selected section's edges, on the middle repeat, resize it
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-edge]')
    if (handle && selected) {
      gesture.current = { mode: 'resize', id: selected.id, edge: handle.dataset.edge as Edge, pattern, copy: MIDDLE }
      return
    }
    // Anywhere else on the thread, on any of its repeats, a drag tilts it and a click picks the section under it (Keller)
    const at = locate(e)
    startTilt(e, { along: mod(at.along, repeat), across: at.across })
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    if (e.buttons === 0) return end()
    if (g.mode === 'pan') {
      g.moved ||= Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 3
      return setView({ ...g.from, x: g.from.x + e.clientX - g.startX, y: g.from.y + e.clientY - g.startY })
    }
    if (g.mode === 'tilt') {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY
      if (!g.moved && Math.hypot(dx, dy) < 3) return
      if (!g.moved) setDragTilting(true)
      g.moved = true
      // About 160 px of drag tilts 30°, as on the canvas, unless an axis is locked on the tilt pad
      const { lockX, lockY } = useTilt.getState()
      setTilt({
        target: lockY ? g.start : clamp(g.start - (dy * 30) / 160, -limit, limit),
        targetX: lockX ? g.startSide : clamp(g.startSide + (dx * 30) / 160, -limit, limit),
      })
      return
    }
    const at = locate(e)
    const value = isAlong(g.edge) ? at.along - g.copy * repeat : at.across
    const next = resizeEdge(g.pattern, g.id, g.edge, value)
    const was = pattern.sections.find((s) => s.id === g.id), now = next.sections.find((s) => s.id === g.id)
    if (was && now && (!sameRect(was, now) || next.sections.some((s, i) => !sameRect(s, pattern.sections[i] ?? s)))) write(next)
  }
  const end = () => {
    const g = gesture.current
    gesture.current = null
    setPanning(false)
    if (g?.mode === 'tilt') {
      setDragTilting(false)
      // A click without tilting picks the section under it, or clears the selection, as on the canvas
      if (g.moved && useTilt.getState().springBack) springToFlat()
      else if (!g.moved) {
        onSelect(g.on && sectionAt(pattern, g.on)?.id)
        onThreadClick?.()
      }
      return
    }
    // A click where a drag would pan clears the selection
    if (g?.mode === 'pan' && g.button === 0 && !g.moved) onSelect(undefined)
  }


  // The current frame's image, handled on the middle repeat; every copy follows, one repeat apart
  const current = frame !== undefined ? note.frames.at(frame) : undefined
  const placing = current?.kind === 'image' && current.aspect ? { frame: current, aspect: current.aspect } : undefined
  const inRepeat = placing && uprightBox(imageBox(placing.frame.place, placing.aspect, repeat, thread.widthMm, thread.direction), thread.direction)
  // Repeat to strip, and back: the middle repeat starts one repeat along
  const alongBy = (b: UprightBox, mm: number) => (vertical ? { ...b, y: b.y + mm } : { ...b, x: b.x + mm })
  const placed = inRepeat && alongBy(inRepeat, MIDDLE * repeat)
  const placeImage = (next: UprightBox) => {
    if (!placing) return
    const local = alongBy(next, -MIDDLE * repeat)
    updateNote(projectId, note.id, (n) => ({
      ...n,
      frames: n.frames.map((f) => (f.id === placing.frame.id ? { ...f, place: placeOf(local, n.thread.widthMm, n.thread.direction) } : f)),
    }))
  }
  // Once let go, the image is held by its copy that starts in the middle repeat: the same image, one repeat on
  const wrapImage = () => {
    if (!inRepeat || !placed) return
    const along = vertical ? inRepeat.y : inRepeat.x
    const wrapped = mod(along, repeat)
    if (Math.abs(wrapped - along) > 1e-9) placeImage(alongBy(placed, wrapped - along))
  }
  const pointAt = (e: { clientX: number; clientY: number }) => {
    const at = locate(e)
    return vertical ? { x: at.across * thread.widthMm, y: at.along } : { x: at.along, y: at.across * thread.widthMm }
  }

  // A double-click on empty thread fills that whole gap, as Fill does: the section in line with it runs on, or new ones take its look
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-section-id]')) return
    const at = locate(e)
    const filled = fillGaps(pattern, thread.widthMm, { along: clamp(mod(at.along, repeat), 0, repeat), across: clamp(at.across, 0, 1) })
    if (!filled) return
    write(filled.pattern)
    onSelect(filled.id)
  }

  return (
    <div ref={box} className={cn('absolute inset-0 touch-none overflow-hidden', panning && 'cursor-grabbing')}
      onPointerDown={(e) => {
        // Around the thread a drag pans, with either button; on the thread it tilts
        if (e.button !== 0 && e.button !== 1) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setPickedImage(undefined)
        startPan(e)
      }}
      onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onDoubleClick={(e) => { if (e.target === e.currentTarget) refit() }}>
      {/* Lets presses through to the view, so they pan, except on the thread, its measurements and the zoom controls */}
      <div ref={room} className={cn('pointer-events-none absolute inset-0 flex items-center justify-center', roomClassName)}>
      <div className="pointer-events-auto relative shrink-0" style={{ width, height, transform: `translate(${shift.x}px, ${shift.y}px)`, perspective: depth }}>
      <div
        ref={strip}
        role="group"
        aria-label="Thread pattern"
        data-pattern-view=""
        className={cn('relative touch-none shadow-sm select-none', dragTilting ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ width, height, transform: turned ? `rotateX(${angle}deg) rotateY(${angleX}deg)` : undefined }}
        // Moves and releases bubble up to the view's own handlers
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        <div className="absolute inset-0 overflow-hidden" style={{ backgroundColor: thread.backgroundColor, ...EMPTY }}>
          <ThreadArt note={note} shown={shown} blends={mixes.map((m) => m.blend)} fill={fill} />
        </div>
        {/* The copies either side, a little quieter than the repeat being edited */}
        {[0, repeats - 1].map((k) => (
          <div key={`copy-${k}`} aria-hidden="true" data-repeat-copy={k} className="pointer-events-none absolute bg-background/35"
            style={vertical ? { left: 0, width, top: k * repeat * scale, height: repeat * scale } : { top: 0, height, left: k * repeat * scale, width: repeat * scale }} />
        ))}

        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height} aria-hidden>
          <defs>
            {prepared.sections.map((p, i) => (
              <pattern key={p.section.id} id={`${uid}-${i}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform={`rotate(${p.angle})`}>
                <line x1="0" y1="5" x2="9" y2="5" stroke="black" strokeOpacity="0.35" strokeWidth="1" />
                <line x1="0" y1="4" x2="9" y2="4" stroke="white" strokeOpacity="0.75" strokeWidth="1" />
              </pattern>
            ))}
          </defs>
          {ridges && (
            <g opacity={ridgeOpacity} data-ridges="">
              {Array.from({ length: repeats }, (_, k) => prepared.sections.map((p, i) => (
                <rect key={`ridges-${k}-${p.section.id}`} {...place(p.section, k)} fill={`url(#${uid}-${i})`} />
              )))}
            </g>
          )}
          {Array.from({ length: repeats - 1 }, (_, k) => {
            const at = (k + 1) * repeat * scale
            return <line key={`repeat-${k}`} data-repeat-edge="" {...(vertical ? { x1: -8, x2: width + 8, y1: at, y2: at } : { x1: at, x2: at, y1: -8, y2: height + 8 })}
              className="stroke-fuchsia-500" strokeWidth="1" strokeDasharray="4 3" />
          })}
          {Array.from({ length: repeats }, (_, k) => pattern.sections.map((s) => {
            const on = s.id === selectedId
            const r = place(s, k)
            return (
              <g key={`outline-${k}-${s.id}`}>
                <rect {...r} fill="none" stroke="black" strokeOpacity={on ? 0 : 0.4} strokeWidth="2.5" />
                <rect {...r} fill="none" className={on ? 'stroke-primary' : 'stroke-white'} strokeOpacity={on || s.id === hover ? 1 : 0.8} strokeWidth={on ? 2.5 : 1} />
              </g>
            )
          }))}
        </svg>

        {Array.from({ length: repeats }, (_, k) => pattern.sections.map((s) => {
          const r = place(s, k)
          return (
            <div key={`hit-${k}-${s.id}`} data-section-id={s.id} data-copy={k} title={s.name} className="absolute"
              style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
              onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover((h) => (h === s.id ? undefined : h))}>
              {k === MIDDLE && s.id === selectedId && EDGES.map((edge) => (
                <div key={edge} data-edge={edge} className={cn('absolute', isAlong(edge) ? alongCursor : acrossCursor)} style={edgeStyle(edge, vertical)} />
              ))}
            </div>
          )
        }))}

        {placing && placed && (
          <ImagePlacer box={placed} aspect={placing.aspect} scale={scale} picked={pickedImage === placing.frame.id}
            onPick={() => { setPickedImage(placing.frame.id); onThreadClick?.() }} pointAt={pointAt} onChange={placeImage} onDone={wrapImage}
            others={[-1, 1].map((k) => (vertical ? { x: 0, y: k * repeat } : { x: k * repeat, y: 0 }))} />
        )}

        {/* Measurements on the middle repeat, turning with the thread: the tile's length along it, the width across it */}
        <Measure side={vertical ? 'left' : 'top'} from={MIDDLE * repeat * scale} to={(MIDDLE + 1) * repeat * scale} label="Tile length"
          action={<FitTileButton note={note} noteRef={noteRef} />}>
          <TileLengthField size="sm" className="w-[88px]" note={note} noteRef={noteRef} />
        </Measure>
        <Measure side={vertical ? 'top' : 'left'} from={0} to={thickness} label={vertical ? 'Width' : 'Height'}>
          <ThreadWidthField size="sm" className="w-[88px]" note={note} noteRef={noteRef} />
        </Measure>
      </div>
      </div>

      {/* Zoom, as in the canvas's corner bar; its own pointer events, so a click never starts a pan */}
      <div className="pointer-events-auto absolute top-3 right-3" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <Panel className="flex h-11 items-center gap-0.5 px-1.5">
          <IconButton className="rounded-lg" label="Zoom out" onClick={() => setView(zoomAround(view, 1 / 1.25, 0, 0, fit))}><Minus /></IconButton>
          <IconButton className="rounded-lg" label="Zoom in" onClick={() => setView(zoomAround(view, 1.25, 0, 0, fit))}><Plus /></IconButton>
          <IconButton className="rounded-lg" label="Fit" onClick={refit}><Maximize /></IconButton>
        </Panel>
      </div>
      </div>
    </div>
  )
}

/** The view zoomed by `factor` about a point given from the middle of the view, px, which stays put; within ZOOM_LIMITS of its `fit` */
function zoomAround(v: View, factor: number, cx: number, cy: number, fit: number): View {
  const scale = clamp(v.scale * factor, fit * ZOOM_LIMITS.min, fit * ZOOM_LIMITS.max)
  const k = scale / v.scale
  return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
}

/** Empty thread (no section prints there) as a faint check */
const EMPTY: CSSProperties = {
  backgroundImage: 'repeating-conic-gradient(color-mix(in oklab, var(--foreground) 9%, transparent) 0% 25%, transparent 0% 50%)',
  backgroundSize: '12px 12px',
}

/** A grab strip over one edge of a section's area, half inside it and half out */
function edgeStyle(edge: Edge, vertical: boolean): CSSProperties {
  const along = isAlong(edge)
  const end = edge === 'endMm' || edge === 'acrossEnd'
  // Along edges run across the thread: horizontal lines on a vertical thread
  const horizontalLine = along === vertical
  const offset = -EDGE_PX
  if (horizontalLine) return { left: 0, right: 0, height: 2 * EDGE_PX, ...(end ? { bottom: offset } : { top: offset }) }
  return { top: 0, bottom: 0, width: 2 * EDGE_PX, ...(end ? { right: offset } : { left: offset }) }
}
