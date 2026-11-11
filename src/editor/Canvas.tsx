import { runAction } from '../cloud/notices'
import { Maximize, Minus, Plus, Share } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { IconButton, Panel } from '../components/controls'
import { NoteView } from '../components/NoteView'
import { designFace } from '../lib/back'
import { neighboursPx } from '../lib/continuous'
import { clamp, perspectiveFor } from '../lib/frames'
import { lensState } from '../lib/lens'
import { playbackPlan } from '../lib/moves'
import { usePanelWidth } from '../lib/panelWidth'
import { playbackLens, playbackTilt } from '../lib/pattern'
import { usePatternOffsets } from '../lib/patternOffset'
import { useRealistic } from '../lib/realistic'
import { type Guide, snapBox } from '../lib/snap'
import { updateNote } from '../lib/store'
import type { Note } from '../lib/types'
import { lengthIn, useLengthUnit } from '../lib/units'
import { mmSpot, withPoint } from '../lib/arcEnCiel'
import { featureOf, featurePart, hostNoteId, noteOrPart } from '../lib/extras'
import { type Feature, isPlaced, type PlacedLayer } from '../lib/layers'
import { type PlacedBox, moveBox } from '../lib/placed'
import { type Quarter, ROTATE_SECONDS, noteBox, onItsSide, quarterOf, turnedCorner, unturn, unturnedPoint } from '../lib/rotate'
import { setTilt, showsBack, springToFlat, useTilt, useTiltLoop } from '../tilt/tilt'
import { AddFeatureMenu } from './AddFeatureMenu'
import { EdgeMarks, NeighbourRing } from './ContinuousView'
import { addImageFrames, type NoteRef } from './frameActions'
import { ArcHandles, RidgeDial } from './ArcHandles'
import { placeLayer, type Layer, updateArcEnCiel } from './layerActions'
import { PlacingBox } from './PlacingBox'
import { spacePanned, useSpaceHand } from './spaceHand'
import { UploadDesignButton } from './UploadDesignButton'
import { WindowEditor } from './WindowEditor'
import { useElementSize } from './useElementSize'

/** CSS pixels per millimetre at 100% zoom, so 100% is roughly true size */
const PX_PER_MM = 96 / 25.4
/** Far enough out to fit a few banknotes of the largest size (2 m) side by side */
const MIN_ZOOM = 0.02
const MAX_ZOOM = 8
/** Room kept clear of the floating panels when fitting notes into view: the Banknotes panel is 224 px wide, the right one 280 */
const FIT = { left: 260, right: 316, top: 48, bottom: 128 }
/** How close, in screen px, a moving banknote's edge or centre must come to another's to snap to it */
const SNAP_PX = 6
/** How long a pan or zoom pauses before banknotes are redrawn at the new view */
const COMMIT_MS = 120
/** Background dot spacing at `scale` px per mm: every 10 mm, else 50 mm, else 500 mm, at least 12 px apart */
const gridStep = (scale: number) => scale * (scale * 10 >= 12 ? 10 : scale * 50 >= 12 ? 50 : 500)
/** The dots, in a little of the text colour so they show (Keller: in the border colour they were all but invisible) */
export const DOTS = 'radial-gradient(circle, color-mix(in oklab, var(--foreground) 18%, transparent) 1px, transparent 1.2px)'

/** Zoom level and where the canvas origin (0, 0 mm) sits on screen, in px */
interface View {
  zoom: number
  x: number
  y: number
}

type Gesture =
  | { mode: 'pan'; startX: number; startY: number; view: View }
  | { mode: 'move'; noteId: string; startX: number; startY: number; noteX: number; noteY: number }
  /**
   * Pressed on a banknote, or on the empty canvas (no `noteId`). `moved` once the drag passes a few px: a plain click
   * leaves the tilt where it is, and picks the banknote, or clears the selection
   */
  | { mode: 'tilt'; noteId?: string; startX: number; startY: number; start: number; startSide: number; moved: boolean }
  /** A thread dragged across its banknote: `noteId` is the banknote's, or a further thread's view's (extras.ts), and `layer` which thread */
  | { mode: 'thread'; noteId: string; layer: Layer; startX: number; startY: number; startPosition: number; alongMm: number }
  /**
   * A placed layer (the watermark, magnetic ink) moves only once the drag passes a few px, so a click just picks it;
   * pressed on the banknote's back (`mirror`), a drag to the right moves it towards the front's left. `noteId` is the
   * banknote's, or a further layer's view's (extras.ts), and `layer` its kind
   */
  | { mode: 'placed'; layer: PlacedLayer; noteId: string; startX: number; startY: number; original: PlacedBox; moved: boolean; mirror: boolean }

function fitView(notes: Note[], size: { width: number; height: number }, quarter: Quarter = 0): View {
  // A widened right panel takes more room
  const FIT_INSETS = { ...FIT, right: Math.max(FIT.right, usePanelWidth.getState().width + 36) }
  // A blank canvas has nothing to fit: 100%, with the origin, where the first banknote goes, in the middle of the room
  if (!notes.length) {
    return {
      zoom: 1,
      x: FIT_INSETS.left + (size.width - FIT_INSETS.left - FIT_INSETS.right) / 2,
      y: FIT_INSETS.top + (size.height - FIT_INSETS.top - FIT_INSETS.bottom) / 2,
    }
  }
  // The banknotes as they show, rotated onto their sides or not
  const boxes = notes.map((n) => noteBox(n, quarter))
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.width))
  const maxY = Math.max(...boxes.map((b) => b.y + b.height))
  const zoom = clamp(
    Math.min(
      (size.width - FIT_INSETS.left - FIT_INSETS.right) / ((maxX - minX) * PX_PER_MM),
      (size.height - FIT_INSETS.top - FIT_INSETS.bottom) / ((maxY - minY) * PX_PER_MM),
    ),
    MIN_ZOOM,
    MAX_ZOOM,
  )
  const scale = zoom * PX_PER_MM
  return {
    zoom,
    x: FIT_INSETS.left + (size.width - FIT_INSETS.left - FIT_INSETS.right) / 2 - ((minX + maxX) / 2) * scale,
    y: FIT_INSETS.top + (size.height - FIT_INSETS.top - FIT_INSETS.bottom) / 2 - ((minY + maxY) / 2) * scale,
  }
}

/**
 * Whether the continuous check shows round a banknote: around an uploaded design on the side showing (turned over, the
 * back's), while the banknote itself is picked
 */
function checksContinuous(note: Note, back: boolean, picked: Layer | undefined) {
  const face = designFace(note, back ? 'back' : 'front')
  return picked === 'note' && face.background === 'image' && !!face.faceImageId && !!note.continuous
}

/**
 * Every note of the project on one zoomable canvas, handled as Figma's (Keller): scroll, middle or right drag, or drag
 * with Space held to pan, pinch or ⌘/Ctrl-scroll to zoom, drag a note's label to move it, its thread, watermark or
 * magnetic ink to move that across it, and the note itself or the empty canvas to tilt every note.
 */
export function Canvas({
  projectId,
  notes,
  selectedId,
  layer = 'note',
  onSelect,
  onSelectLayer,
  focus,
  editingWindows = false,
  selectedWindowId,
  onWindowSelect,
  onExitWindows,
  placing,
  onExitPlacing,
  onExport,
  demoButton,
  covered = false,
  onEditWindow,
  onEditThread,
  onAddFeature,
  inStudio = false,
}: {
  projectId: string
  notes: Note[]
  selectedId: string | undefined
  /**
   * The selected banknote's part that is picked, outlined on the canvas: the banknote itself, or one of its security
   * features, the first of its kind or a further one (extras.ts)
   */
  layer?: Layer
  /** Selects a banknote itself, or nothing */
  onSelect: (noteId: string | undefined) => void
  /** A press on a banknote's thread, watermark or magnetic ink picks that layer only */
  onSelectLayer: (noteId: string, layer: Layer) => void
  /** Centres the canvas on a note whenever the token changes */
  focus?: { noteId: string; token: number }
  editingWindows?: boolean
  selectedWindowId?: string
  onWindowSelect: (id: string | undefined) => void
  onExitWindows?: () => void
  /** The selected banknote's placed layer being placed: the banknote shows flat (its watermarks clear) with the layer's box to drag */
  placing?: Layer
  onExitPlacing?: () => void
  /** Export, at the end of the corner bar after the zoom controls; left out while the thread editor is open */
  onExport?: () => void
  /**
   * ▶ Demo, left of Export (Keller, 10 November: a "play button" secondary button), with the panel it opens (`DemoButton`);
   * left out while the thread editor is open
   */
  demoButton?: ReactNode
  /**
   * Demo is open over the canvas: its banknotes and corner bar aren't drawn, so nothing is drawn twice, while it stays,
   * as it runs the tilt loop
   */
  covered?: boolean
  /** A click on a thread window opens it for editing, on the thread whose layer it is */
  onEditWindow?: (noteId: string, windowId: string, layer: Layer) => void
  /** A double-click on a thread opens the thread editor on it; left out while it is open */
  onEditThread?: (noteId: string, layer: Layer) => void
  /** Adds a security feature from the + under the selected banknote, as the Add menu in the Banknotes list does; left out while the thread editor is open */
  onAddFeature?: (noteId: string, feature: Feature) => void
  /** The thread editor is open over the canvas: the thread is only on the front, so playback's Flip moves wait flat, as F does nothing there */
  inStudio?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const size = useElementSize(ref)
  const [view, setView] = useState<View>()
  const gesture = useRef<Gesture | null>(null)
  const [activeMode, setActiveMode] = useState<Gesture['mode']>()
  const [dropping, setDropping] = useState(false)
  const [guides, setGuides] = useState<Guide[]>([])
  // What a click would pick under the pointer, outlined lightly: a banknote itself (or its label), its thread, watermark or magnetic ink
  const [hover, setHover] = useState<{ noteId: string; part: Layer }>()
  // Not the angles themselves: each NoteView follows the tilt on its own, so the canvas doesn't re-render
  // every animation frame while tilting or playing
  const source = useTilt((s) => s.source)
  const perspective = useTilt((s) => s.perspective)
  const sheen = useTilt((s) => s.sheen)
  const frameNumbers = useTilt((s) => s.frameNumbers)
  // Realistic (beside the lamp): every banknote's magnetic ink lit as metal and Arc-en-Ciel as embossed ridges
  const realistic = useRealistic((s) => s.on)
  // Turned over, the banknotes show their backs (from halfway round, as NoteView does)
  const back = useTilt(showsBack)
  // Rotated (Rotate left and right beside Front | Back), every banknote turns about its own middle, counted on either way
  // so each quarter turn plays the way it was asked
  const quarterTurns = useTilt((s) => s.quarterTurns)
  const quarter = quarterOf(quarterTurns)
  // Space held: a press pans, whatever it lands on
  const hand = useSpaceHand((s) => s.held)

  const selected = notes.find((n) => n.id === selectedId)
  const reference = selected ?? notes.at(0)
  // A thread mixing ridge angles plays each tilt at its fastest section's cycle
  const lens = useMemo(() => (reference ? playbackLens(reference) : undefined), [reference])
  const loopLens = lens ?? lensState({ cycleDeg: 30, transition: 0 })
  const plan = useMemo(() => playbackPlan(reference ? playbackTilt(reference) : { cycleDeg: 30, transition: 0 }, loopLens), [reference, loopLens])
  useTiltLoop(plan, loopLens.viewDeg, !inStudio)
  const offsets = usePatternOffsets((s) => s.offsets)
  const unit = useLengthUnit((s) => s.unit)

  // Until the first pan or zoom, the view simply fits every note (a blank canvas sits at 100%)
  const current = view ?? (size ? fitView(notes, size, quarter) : undefined)
  const scale = current ? current.zoom * PX_PER_MM : 0

  /**
   * Panning and zooming move the drawn canvas as one layer (a CSS transform on `content`) instead of
   * re-rendering every banknote on each wheel step; the view is committed, and banknotes redrawn sharp
   * at the new zoom, once the gesture pauses. `viewRef` is always the view on screen.
   */
  const content = useRef<HTMLDivElement>(null)
  const live = useRef<View>(undefined)
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const committed = useRef(current)
  committed.current = current
  const viewRef = useRef(current)
  viewRef.current = live.current ?? current
  // Still fitting every note: nothing has panned or zoomed it yet
  const fitting = useRef(view === undefined)
  fitting.current = view === undefined

  const showView = (v: View) => {
    stopGlide()
    const base = committed.current
    const element = ref.current
    if (!base || !content.current || !element) return setView(v)
    live.current = v
    viewRef.current = v
    clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(commitView, COMMIT_MS)
    // A trackpad sends several wheel events per frame: draw only the latest, once a frame
    if (!frame.current) frame.current = requestAnimationFrame(drawLive)
  }
  const frame = useRef(0)
  const drawLive = () => {
    frame.current = 0
    const v = live.current
    const base = committed.current
    const element = ref.current
    if (!v || !base || !content.current || !element) return
    const k = v.zoom / base.zoom
    content.current.style.transform = `translate(${v.x - base.x * k}px, ${v.y - base.y * k}px) scale(${k})`
    content.current.style.willChange = 'transform'
    const s = v.zoom * PX_PER_MM
    const g = gridStep(s)
    element.style.backgroundSize = `${g}px ${g}px`
    element.style.backgroundPosition = `${v.x}px ${v.y}px`
    // Labels stay their usual size, and the zoom readout current, while the layer scales
    for (const label of content.current.querySelectorAll<HTMLElement>('[data-note-label], [data-keep-size]')) label.style.transform = k === 1 ? '' : `scale(${1 / k})`
    const readout = element.querySelector('[data-zoom-readout]')?.firstChild
    if (readout) readout.nodeValue = `${Math.round(v.zoom * 100)}%`
  }
  /** Ends a live pan or zoom: React draws the view for real */
  const commitView = () => {
    stopGlide()
    clearTimeout(commitTimer.current)
    const v = live.current
    if (v) setView(v)
  }
  /** A jump (zoom buttons, fit, focus) replaces any live view straight away */
  const jumpTo = (v: View) => {
    stopGlide()
    clearTimeout(commitTimer.current)
    live.current = undefined
    setView(v)
  }
  /** The layer as React drew it, with no transform, and the dots for the committed view */
  const settle = () => {
    if (content.current) {
      content.current.style.transform = ''
      content.current.style.willChange = ''
      for (const label of content.current.querySelectorAll<HTMLElement>('[data-note-label], [data-keep-size]')) label.style.transform = ''
    }
    const v = committed.current
    if (ref.current && v) {
      const g = gridStep(v.zoom * PX_PER_MM)
      ref.current.style.backgroundSize = `${g}px ${g}px`
      ref.current.style.backgroundPosition = `${v.x}px ${v.y}px`
    }
  }
  // Once React has drawn the committed view, the layer goes back to no transform, in the same frame
  useLayoutEffect(() => {
    if (live.current && current && live.current !== current) return
    live.current = undefined
    cancelAnimationFrame(frame.current)
    frame.current = 0
    settle()
  })

  /**
   * Rotating (Rotate left and right): a view that has been panned or zoomed stays where it is, so the banknotes turn in
   * place, and Fit takes them all in again; a view still fitting every banknote glides, as they turn, to fit them as they
   * show once turned, so none turns off the screen. The glide is a live view, as a pan's is, never committed, so the view
   * goes on fitting; a pan, zoom or press stops it where it is.
   */
  const turnFrom = useRef<View>(undefined)
  const glide = useRef(0)
  const stopGlide = () => {
    cancelAnimationFrame(glide.current)
    glide.current = 0
  }
  useEffect(() => useTilt.subscribe((state, previous) => {
    if (state.quarterTurns !== previous.quarterTurns && fitting.current) turnFrom.current = viewRef.current
  }), [])
  useLayoutEffect(() => {
    const from = turnFrom.current
    const to = committed.current
    turnFrom.current = undefined
    if (!from || !to || !fitting.current) return
    stopGlide()
    const start = performance.now()
    const step = (now: number) => {
      const t = clamp((now - start) / (ROTATE_SECONDS * 1000), 0, 1)
      // Eased in and out, as the banknotes turn
      const k = t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2
      if (t < 1) {
        live.current = { zoom: from.zoom + (to.zoom - from.zoom) * k, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }
        viewRef.current = live.current
        drawLive()
        glide.current = requestAnimationFrame(step)
      } else {
        glide.current = 0
        live.current = undefined
        viewRef.current = committed.current
        settle()
      }
    }
    step(start)
    // Only as the banknotes start to turn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarterTurns])
  useEffect(() => () => {
    clearTimeout(commitTimer.current)
    cancelAnimationFrame(frame.current)
    cancelAnimationFrame(glide.current)
  }, [])

  const zoomAround = (factor: number, cx: number, cy: number) => {
    const v = viewRef.current
    if (!v) return
    const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const k = zoom / v.zoom
    jumpTo({ zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k })
  }

  const showViewRef = useRef(showView)
  showViewRef.current = showView

  // Wheel needs a non-passive listener so the page itself never scrolls or zooms
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      if (!v) return
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrl + wheel
        const rect = element.getBoundingClientRect()
        // Mouse wheels send big steps, trackpad pinches small ones; cap each step so neither jumps
        const zoom = clamp(v.zoom * Math.exp(-clamp(e.deltaY, -40, 40) * 0.01), MIN_ZOOM, MAX_ZOOM)
        const k = zoom / v.zoom
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        showViewRef.current({ zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k })
      } else {
        showViewRef.current({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    if (!focus || !size) return
    const note = notes.find((n) => n.id === focus.noteId)
    const v = viewRef.current
    if (!note || !v) return
    const s = v.zoom * PX_PER_MM
    jumpTo({
      zoom: v.zoom,
      x: size.width / 2 - (note.x + note.widthMm / 2) * s,
      y: size.height / 2 - (note.y + note.heightMm / 2) * s,
    })
    // Only when a new focus is requested, not when notes or the size change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.token])

  // Editing windows or placing a layer pauses playback but leaves the view where it is, so you edit at the zoom you chose
  useEffect(() => {
    if (!(editingWindows || placing) || !selected) return
    setTilt({ source: 'slider', target: useTilt.getState().angle, targetX: useTilt.getState().angleX })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingWindows, placing, selectedId])

  // Every way a gesture can end comes through here, so a tilt drag always springs back the same way
  const endGesture = () => {
    const g = gesture.current
    if (g?.mode === 'tilt' && g.moved && useTilt.getState().springBack) springToFlat()
    if (g?.mode === 'pan') commitView()
    gesture.current = null
    setActiveMode(undefined)
    setGuides([])
  }
  const endGestureRef = useRef(endGesture)
  endGestureRef.current = endGesture

  // Switching apps or windows mid-drag can swallow the release
  useEffect(() => {
    const onBlur = () => endGestureRef.current()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  /**
   * A press on the canvas itself. A menu or tooltip opened from it (the + under the selected banknote's) is drawn elsewhere
   * on the page, in a portal, though React hands its presses up through the canvas: a pick in the menu, or the press that
   * closes it, would otherwise tilt the banknotes, or clear the selection, and take the pointer from the menu
   */
  const ownPress = (e: React.PointerEvent<HTMLDivElement>) => e.currentTarget.contains(e.target as Node)

  const noteAt = (target: EventTarget, attribute: 'data-note-label' | 'data-note-body') =>
    (target as HTMLElement).closest(`[${attribute}]`)?.getAttribute(attribute) ?? undefined

  /** A placed layer the pointer is on, on the banknote or its placing box: the first of its kind or a further one */
  const placedAt = (target: EventTarget) => {
    const layer = (target as HTMLElement).closest('[data-placed]')?.getAttribute('data-placed') ?? undefined
    return isPlaced(featureOf(layer)) ? (layer as Layer) : undefined
  }

  /**
   * The thread the pointer is on, the first one or a further one; for hovering and double-clicks the window editor counts
   * as the thread it edits (`editor`)
   */
  const threadAt = (target: EventTarget, editor = true): Layer | undefined => {
    const element = target as HTMLElement
    const thread = element.closest('[data-thread]')
    if (thread) return (thread.getAttribute('data-thread') || 'thread') as Layer
    return editor && element.closest('[data-window-editor]') && featureOf(layer) === 'thread' ? layer : undefined
  }

  /** A banknote, or a further feature's view, by its id (extras.ts) */
  const partNote = (id: string) => noteOrPart(notes.find((n) => n.id === hostNoteId(id)), id)

  /** Follows the pointer between gestures; the window editor and placing box count as the part they edit */
  const hoverOver = (target: EventTarget) => {
    const noteId = noteAt(target, 'data-note-label') ?? noteAt(target, 'data-note-body')
    const part: Layer = threadAt(target) ?? placedAt(target) ?? 'note'
    setHover((h) => (!noteId ? undefined : h?.noteId === noteId && h.part === part ? h : { noteId, part }))
  }

  /** A gesture takes the pointer, the view staying where it is on screen */
  const startGesture = (e: React.PointerEvent<HTMLDivElement>, v: View) => {
    setHover(undefined)
    // Freeze the fitted view, or moving a note would refit the canvas under the pointer. A live pan or
    // zoom is committed first, so drags measure in the scale on screen.
    if (live.current) commitView()
    else if (!view) setView(v)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const grid = gridStep(scale)
  // Selection outlines step back while banknotes play or are dragged, so they never get in the way of the motion
  const quiet = source === 'wobble' || activeMode === 'tilt' || activeMode === 'move'
  // The hand shows over everything a press would pan from, the notes' own cursors included
  const grab = activeMode === 'pan' ? 'grabbing' : hand ? 'grab' : undefined
  // The + under the selected banknote (Keller, 10 November), on every banknote, whatever it has already (Keller: "the button
  // should appear on all of the banknotes"), goes with its other marks of selection while banknotes play or are dragged, and
  // makes way while windows are edited or a layer placed. Where it hangs: the bottom of the box the banknote shows, rotated
  // or not, as a share of its height as it lies upright, and past the neighbours while the continuous check shows them
  const shown = selected && noteBox(selected, quarter)
  const addUnder = selected && shown && onAddFeature && !quiet && !editingWindows && !placing
    ? (shown.y + shown.height - selected.y) / selected.heightMm
    : undefined
  const addBelow = selected && checksContinuous(selected, back, layer) ? neighboursPx(scale) : 0

  return (
    <div
      ref={ref}
      className={cn(
        'relative flex-1 touch-none overflow-hidden select-none',
        dropping ? 'bg-muted' : 'bg-muted/40',
        grab === 'grabbing' ? 'cursor-grabbing' : grab === 'grab' ? 'cursor-grab' : activeMode === 'placed' && 'cursor-move',
      )}
      style={
        current
          ? {
              backgroundImage: DOTS,
              backgroundSize: `${grid}px ${grid}px`,
              backgroundPosition: `${current.x}px ${current.y}px`,
            }
          : undefined
      }
      // A middle or right drag, or any press while Space is held, pans, whatever it lands on: a banknote, its thread, a
      // window or a placed layer's box take no part. The corner bar keeps its clicks
      onPointerDownCapture={(e) => {
        const v = viewRef.current
        const pans = e.button === 1 || e.button === 2 || (e.button === 0 && useSpaceHand.getState().held)
        if (!v || !pans || (e.target as HTMLElement).closest('[data-corner-bar]') || !ownPress(e)) return
        e.stopPropagation()
        startGesture(e, v)
        gesture.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, view: v }
        spacePanned()
        setActiveMode('pan')
      }}
      // No browser menu on the canvas: the right button pans
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        const v = viewRef.current
        // Only the left button gets here: the others pan (above)
        if (!v || e.button !== 0 || !ownPress(e)) return
        const labelId = noteAt(e.target, 'data-note-label')
        const bodyId = noteAt(e.target, 'data-note-body')
        const note = notes.find((n) => n.id === (labelId ?? bodyId))
        // A click on the banknote outside the thread's windows (or the placed layer's box), or on the empty canvas, ends
        // editing; a drag from there tilts as usual
        if (editingWindows && (!note || bodyId === selectedId)) onExitWindows?.()
        if (placing && (!note || bodyId === selectedId)) onExitPlacing?.()
        startGesture(e, v)
        // The thread or placed layer pressed, the first of its kind or a further one, as its own code sees it (extras.ts)
        const onThread = labelId || !note ? undefined : featurePart(note, threadAt(e.target, false) ?? 'note')
        const onPlaced = labelId || !note ? undefined : featurePart(note, placedAt(e.target) ?? 'note')
        const placed = onPlaced && isPlaced(onPlaced.feature) ? onPlaced.note[onPlaced.feature] : undefined
        if (onThread && note) {
          // The thread moves across the banknote, along the axis its position is measured on
          onSelectLayer(note.id, onThread.layer)
          const { thread } = onThread.note
          const rect = (e.target as HTMLElement).closest('[data-note-body]')?.firstElementChild?.getBoundingClientRect()
          const horizontal = thread.direction === 'horizontal'
          // Where the press is on the banknote as it lies, rotated or not
          const at = rect && unturnedPoint(e.clientX, e.clientY, rect, quarter)
          const alongMm = at
            ? horizontal
              ? (at.x / at.width) * note.widthMm
              : (at.y / at.height) * note.heightMm
            : -1
          gesture.current = { mode: 'thread', noteId: onThread.note.id, layer: onThread.layer, startX: e.clientX, startY: e.clientY, startPosition: thread.positionMm, alongMm }
        } else if (onPlaced && placed && isPlaced(onPlaced.feature) && note) {
          // The watermark or magnetic ink moves around the banknote, as the thread moves across it. Picking it shows its
          // box, whose corners resize it.
          onSelectLayer(note.id, onPlaced.layer)
          gesture.current = { mode: 'placed', layer: onPlaced.feature, noteId: onPlaced.note.id, startX: e.clientX, startY: e.clientY, original: placed, moved: false, mirror: back }
        } else if (labelId && note) {
          onSelect(note.id)
          gesture.current = { mode: 'move', noteId: note.id, startX: e.clientX, startY: e.clientY, noteX: note.x, noteY: note.y }
        } else {
          // A drag on a banknote or the empty canvas tilts every banknote, as the tilt pad does. A press picks another
          // banknote itself; on the selected one only a click does (on release), so tilting it by dragging keeps its layer
          // in the panel. On the empty canvas a click clears the selection, and playback goes on until a drag starts
          if (note && note.id !== selectedId) onSelect(note.id)
          const s = useTilt.getState()
          const start = s.source === 'drag' ? s.target : s.angle
          const startSide = s.source === 'drag' ? s.targetX : s.angleX
          gesture.current = { mode: 'tilt', noteId: note?.id, startX: e.clientX, startY: e.clientY, start, startSide, moved: false }
          if (note) setTilt({ source: 'drag', target: start, targetX: startSide })
        }
        setActiveMode(gesture.current.mode)
      }}
      onPointerMove={(e) => {
        const g = gesture.current
        if (!g) return hoverOver(e.target)
        // A release that never reached us: stop following the pointer
        if (e.buttons === 0) {
          endGesture()
          return
        }
        const dx = e.clientX - g.startX
        const dy = e.clientY - g.startY
        if (g.mode === 'pan') {
          showView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy })
        } else if (g.mode === 'thread') {
          // Along the banknote's own axes, which a rotated banknote turns on screen
          const along = unturn(dx, dy, quarter)
          updateNote(projectId, g.noteId, (n) => {
            const horizontal = n.thread.direction === 'horizontal'
            const across = horizontal ? n.heightMm : n.widthMm
            const half = n.thread.widthMm / 2
            const positionMm = clamp(Math.round((g.startPosition + (horizontal ? along.y : along.x) / scale) * 2) / 2, half, across - half)
            return positionMm === n.thread.positionMm ? n : { ...n, thread: { ...n.thread, positionMm } }
          })
        } else if (g.mode === 'placed') {
          if (!g.moved && Math.hypot(dx, dy) < 3) return
          g.moved = true
          // From where the press found it, in 0.5 mm steps, kept on the banknote, the way the pointer goes on it rotated
          const note = partNote(g.noteId)
          const box = note?.[g.layer]
          const along = unturn(dx, dy, quarter)
          const next = note && moveBox(g.original, (g.mirror ? -along.x : along.x) / scale, along.y / scale, note)
          if (box && next && (next.xMm !== box.xMm || next.yMm !== box.yMm)) placeLayer({ projectId, noteId: g.noteId }, g.layer, next)
        } else if (g.mode === 'move') {
          const round = (mm: number) => Math.round(mm * 2) / 2
          const rawX = g.noteX + dx / scale
          const rawY = g.noteY + dy / scale
          const moving = notes.find((n) => n.id === g.noteId)
          // Edges and centres snap to the other banknotes as they show, rotated or not; hold ⌘/Ctrl to place freely on the
          // 0.5 mm grid
          const shown = moving && noteBox({ x: rawX, y: rawY, widthMm: moving.widthMm, heightMm: moving.heightMm }, quarter)
          const snapped =
            shown && !(e.metaKey || e.ctrlKey)
              ? snapBox(shown, notes.filter((n) => n.id !== g.noteId).map((n) => noteBox(n, quarter)), SNAP_PX / scale)
              : undefined
          // The banknote moves as far as the box it shows snapped
          const x = shown && snapped && snapped.guides.some((d) => d.axis === 'x') ? rawX + snapped.x - shown.x : round(rawX)
          const y = shown && snapped && snapped.guides.some((d) => d.axis === 'y') ? rawY + snapped.y - shown.y : round(rawY)
          setGuides(snapped?.guides ?? [])
          updateNote(projectId, g.noteId, (n) => (n.x === x && n.y === y ? n : { ...n, x, y }))
        } else {
          if (!g.moved && Math.hypot(dx, dy) < 3) return
          g.moved = true
          // About 160 px of drag tilts the note 30°; past one cycle the frames loop. Both directions always
          // tilt, unless locked on the tilt pad. Rotated, the drag is turned back to the banknotes' own axes, so they tilt
          // the way the pointer goes on screen and the lens plays as it would turned in the hand
          const limit = loopLens.viewDeg
          const { lockX, lockY } = useTilt.getState()
          const along = unturn(dx, dy, quarter)
          setTilt({
            source: 'drag',
            target: lockY ? g.start : clamp(g.start - (along.y * 30) / 160, -limit, limit),
            targetX: lockX ? g.startSide : clamp(g.startSide + (along.x * 30) / 160, -limit, limit),
          })
        }
      }}
      onPointerUp={(e) => {
        const g = gesture.current
        // A click on a window, without dragging, opens it for resizing
        if (g?.mode === 'thread' && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 3) {
          const note = partNote(g.noteId)
          const section = note?.thread.windows.enabled
            ? note.thread.windows.sections.find((s) => g.alongMm >= s.startMm && g.alongMm <= s.endMm)
            : undefined
          if (note && section) onEditWindow?.(hostNoteId(note.id), section.id, g.layer)
        }
        // A click without tilting picks the banknote itself, away from its thread and placed layers, or on the empty
        // canvas clears the selection
        if (g?.mode === 'tilt' && !g.moved) onSelect(g.noteId)
        endGesture()
      }}
      onPointerCancel={endGesture}
      onLostPointerCapture={endGesture}
      onPointerLeave={() => setHover(undefined)}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement
        const noteId = noteAt(target, 'data-note-body')
        const thread = threadAt(target)
        if (noteId && thread) onEditThread?.(noteId, thread)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        const noteId = noteAt(e.target, 'data-note-body') ?? noteAt(e.target, 'data-note-label') ?? selectedId
        if (!noteId) return
        // Dropped images become the thread's frames
        onSelectLayer(noteId, 'thread')
        runAction(addImageFrames({ projectId, noteId }, Array.from(e.dataTransfer.files)))
      }}
    >
      {/* Everything drawn in canvas space, so a live pan or zoom can move it as one layer */}
      <div ref={content} className={cn('absolute top-0 left-0 origin-top-left', grab === 'grabbing' ? '**:cursor-grabbing!' : grab === 'grab' && '**:cursor-grab!')}>
      {current && !covered &&
        notes.map((note) => {
          const isSelected = note.id === selectedId
          const editingThis = isSelected && editingWindows
          // The thread whose windows are edited, or the placed layer being placed, as its own code sees it (extras.ts)
          const edited = editingThis ? featurePart(note, layer) : undefined
          const placingPart = isSelected && placing ? featurePart(note, placing) : undefined
          const placingThis = placingPart && isPlaced(placingPart.feature) ? placingPart.feature : undefined
          const placingRef: NoteRef = { projectId, noteId: placingPart?.note.id ?? note.id }
          const arc = placingThis === 'arcEnCiel' ? placingPart?.note.arcEnCiel : undefined
          // Only what is picked is outlined, the banknote itself or one of its parts; what a click would pick is outlined
          // lightly, but not while Space is held, as a press then only pans
          const picked = isSelected ? layer : undefined
          const hovered = !hand && hover?.noteId === note.id && hover.part !== picked ? hover.part : undefined
          const ref: NoteRef = { projectId, noteId: note.id }
          // The continuous check shows around an uploaded design while the banknote itself is picked. Meanwhile the
          // banknote has no outline, label or shadow, so nothing comes between it and its neighbours (Keller). It checks
          // the side showing: turned over, the back's design
          const face = designFace(note, back ? 'back' : 'front')
          const checking = checksContinuous(note, back, picked)
          // Where the banknote's top-left corner shows once rotated, for its name
          const corner = turnedCorner(note.widthMm, note.heightMm, quarter)
          return (
            <div
              key={note.id}
              className="absolute"
              style={{ left: current.x + note.x * scale, top: current.y + note.y * scale, width: note.widthMm * scale, height: note.heightMm * scale }}
            >
              {/* The name stays upright over the top left of the banknote as it shows, rotated or not, gliding there as it
                  turns (in shares of the banknote, so a zoom doesn't set it gliding) */}
              <div className="absolute transition-[left,top] ease-in-out motion-reduce:transition-none"
                style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%`, transitionDuration: `${ROTATE_SECONDS}s` }}>
                <div
                  data-note-label={note.id}
                  className={cn(
                    'absolute bottom-full left-0 mb-1.5 flex origin-bottom-left items-baseline gap-1.5 text-xs whitespace-nowrap',
                    'cursor-move',
                    checking && 'invisible',
                  )}
                >
                  <span className={cn('font-medium', isSelected ? 'text-foreground' : 'text-muted-foreground')}>{note.name}</span>
                  <span className="text-muted-foreground/70 tabular-nums">
                    {lengthIn(note.widthMm, unit)} × {lengthIn(note.heightMm, unit)} {unit}
                  </span>
                  {/* Which side shows, once turned over, as the back has no thread to tell it by */}
                  {back && <span data-side-label="" className="text-muted-foreground/70">Back</span>}
                </div>
              </div>
              {/* Rotated, everything on the banknote turns with it about its middle, its tilt in 3D still about its own axes
                  inside. On its side, its thread's cursor turns too, unless Space's hand is showing */}
              <div data-note-turn={quarter || undefined}
                className={cn('absolute inset-0 transition-transform ease-in-out motion-reduce:transition-none',
                  onItsSide(quarter) && !grab && (note.thread.direction === 'vertical' ? '[&_[data-thread]]:cursor-ns-resize!' : '[&_[data-thread]]:cursor-ew-resize!'))}
                style={{ transform: quarterTurns ? `rotate(${quarterTurns * 90}deg)` : undefined, transitionDuration: `${ROTATE_SECONDS}s` }}>
                {checking && <NeighbourRing note={face} scale={scale} quiet={quiet} />}
                <div
                  data-note-body={note.id}
                  // A short perspective, relative to the note's size, so the near edge visibly widens and the far edge
                  // narrows: you can see which way the note is tilting, not just that it got shorter. Its outline is as
                  // square-cornered as the banknote
                  style={{ perspective: perspectiveFor(note, scale) }}
                  className={cn(
                    'outline-offset-4 transition-[outline-color] duration-150 cursor-ns-resize',
                    checking ? 'outline-0' : picked === 'note' ? 'outline-2' : hovered === 'note' ? 'outline-1' : 'outline-0',
                    quiet ? 'outline-primary/5' : 'outline-primary/25',
                    // NoteView's own shadow would darken the seam
                    checking && '[&>div:first-child]:shadow-none',
                  )}
                >
                  {/* Editing windows shows the banknote flat with its watermark faint; placing a layer, flat (the watermark clear) */}
                  <NoteView note={note} scale={scale} live perspective={perspective && !editingThis && !placingThis} sheen={sheen} realistic={realistic}
                    reveal={editingThis ? 0 : placingThis === 'watermark' ? 1 : undefined} showWindowCuts={editingThis && edited?.layer} showFrameNumber={frameNumbers}
                    offsetMm={offsets[note.id]} offsets={offsets}
                    selected={picked === 'note' || editingThis || placingThis || quiet ? undefined : picked} hovered={hovered === 'note' ? undefined : hovered} />
                  {placingPart && placingThis && (
                    <PlacingBox note={placingPart.note} layer={placingThis} part={placingPart.layer} box={placingPart.note[placingThis]!} scale={scale} mirror={back} quarter={quarter}
                      onChange={(next) => placeLayer(placingRef, placingThis, next)}
                      // Arc-en-Ciel's rings start from points: a double-click in its box adds one there
                      onDoubleClick={placingThis === 'arcEnCiel' && arc?.flow === 'point'
                        ? (at) => updateArcEnCiel(placingRef, (a) => withPoint(a, mmSpot([at.xMm - a.xMm, at.yMm - a.yMm], a)))
                        : undefined} />
                  )}
                  {/* Arc-en-Ciel's ridges, turned with a dial over its box, and where its bands start from points or a line,
                      placed with handles over it */}
                  {placingThis === 'arcEnCiel' && arc && !back && (
                    <RidgeDial arc={arc} part={placingPart?.layer} scale={scale} quarter={quarter} onTurn={(angleDeg) => updateArcEnCiel(placingRef, (a) => ({ ...a, angleDeg }))} />
                  )}
                  {placingThis === 'arcEnCiel' && arc && !back && (arc.flow === 'point' || arc.flow === 'line') && (
                    <ArcHandles arc={arc} part={placingPart?.layer} scale={scale} quarter={quarter} onChange={(next) => updateArcEnCiel(placingRef, () => next)} />
                  )}
                  {edited?.feature === 'thread' && edited.note.thread.windows.enabled && (
                    <WindowEditor note={edited.note} scale={scale} quarter={quarter} selectedId={selectedWindowId} onSelect={onWindowSelect}
                      onChange={(sections) => updateNote(projectId, edited.note.id, (n) => ({ ...n, thread: { ...n.thread, windows: { ...n.thread.windows, sections } } }))} />
                  )}
                  {/* A side showing no design has a + in its middle to upload one (Keller), out of the way while it plays or is
                      dragged, edited or placed on, and on banknotes too small on screen to hold it */}
                  {!(face.background === 'image' && face.faceImageId) && !quiet && !editingThis && !placingThis
                    && Math.min(note.widthMm, note.heightMm) * scale >= 64 && (
                    <UploadDesignButton noteRef={ref} side={back ? 'back' : 'front'} />
                  )}
                </div>
                {checking && <EdgeMarks note={face} scale={scale} quiet={quiet} />}
              </div>
            </div>
          )
        })}

      {current &&
        guides.map((d) => (
          <div
            key={`${d.axis}${d.at}`}
            data-snap-guide={d.axis}
            className="pointer-events-none absolute bg-rose-500"
            style={
              d.axis === 'x'
                ? { left: current.x + d.at * scale - 0.5, top: current.y + d.from * scale, width: 1, height: (d.to - d.from) * scale }
                : { top: current.y + d.at * scale - 0.5, left: current.x + d.from * scale, height: 1, width: (d.to - d.from) * scale }
            }
          />
        ))}

      {/* A + under the selected banknote that adds a security feature from the canvas (Keller, 10 November), the Banknotes
          list's Add menu. Drawn after every banknote, so none covers it, over the canvas and never in the banknote, so it is
          never exported: upright under the middle of the box the banknote shows, gliding there as it turns, as its name does
          (in shares of the banknote, so a zoom doesn't set it gliding), and as big at any zoom */}
      {current && !covered && selected && onAddFeature && addUnder !== undefined && (
        <div className="pointer-events-none absolute"
          style={{ left: current.x + selected.x * scale, top: current.y + selected.y * scale, width: selected.widthMm * scale, height: selected.heightMm * scale }}>
          <div data-keep-size="" className="absolute left-1/2 origin-top-left transition-[top] ease-in-out motion-reduce:transition-none"
            style={{ top: `${addUnder * 100}%`, transitionDuration: `${ROTATE_SECONDS}s` }}>
            <div className="pointer-events-auto absolute left-0 -translate-x-1/2" style={{ top: 12 + addBelow }}>
              <AddFeatureMenu onCanvas onAdd={(feature) => onAddFeature(selected.id, feature)} />
            </div>
          </div>
        </div>
      )}
      </div>

      {current && size && !covered && (
        // The corner bar, built like Thread Studio's top bar: fixed top right, as wide as the properties panel that
        // opens under it, with the zoom controls, then ▶ Demo and Export, in the same place whatever is selected.
        // Export, filled, sits 12 px in from the right edge, as far as − shows in from the left inside its ghost button
        // (Keller, 11 November: at 6 px the right end looked squeezed). Its own pointer events, or the canvas captures
        // the pointer and the buttons never get a click
        <div data-corner-bar="" className="absolute top-3 right-3 w-(--panel-w)" onPointerDown={(e) => e.stopPropagation()}>
          <Panel className="flex h-11 items-center gap-0.5 pr-3 pl-1.5">
            <IconButton className="rounded-lg" label="Zoom out" onClick={() => zoomAround(1 / 1.25, size.width / 2, size.height / 2)}>
              <Minus />
            </IconButton>
            {/* 100% is about true size, at the screen's 96 px an inch (Keller wanted the readout back on 4 November). 44 px
                holds 800%, the most it reads, and leaves − and + about as far from it as + is from fit: at 56 px it took
                the room the bar's right end lacked (Keller, 11 November) */}
            <Button
              variant="ghost"
              size="sm"
              className="w-11 rounded-lg px-1 tabular-nums"
              title="Zoom to 100% (about true size)"
              onClick={() => zoomAround(1 / (viewRef.current?.zoom ?? 1), size.width / 2, size.height / 2)}
            >
              <span data-zoom-readout="">{`${Math.round(current.zoom * 100)}%`}</span>
            </Button>
            <IconButton className="rounded-lg" label="Zoom in" onClick={() => zoomAround(1.25, size.width / 2, size.height / 2)}>
              <Plus />
            </IconButton>
            <IconButton className="rounded-lg" label="Fit all notes" onClick={() => jumpTo(fitView(notes, size, quarter))}>
              <Maximize />
            </IconButton>
            {(demoButton || onExport) && (
              <div className="ml-auto flex items-center gap-1">
                {/* Its icon alone, Demo in its tooltip, as Figma's ▶ (there is just room for it at the bar's narrowest) */}
                {demoButton}
                {onExport && (
                  <Button size="sm" onClick={onExport}>
                    <Share />
                    Export
                  </Button>
                )}
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}
