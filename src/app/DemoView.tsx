import { Ellipsis, EyeOff, Lamp, LocateFixed, Minus, Plus, Rotate3d, Ruler, RulerDimensionLine, ScanFace, Smartphone, Sparkles, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { IconButton, Panel } from '../components/controls'
import { NoteView } from '../components/NoteView'
import { useTrackerLoading } from '../lib/faceTracker'
import { TILT_LIMIT, clamp, perspectiveFor } from '../lib/frames'
import { CARD_MM, CARD_RADIUS_MM, isChecked, realPxPerMm, setRealPxPerMm, useRealSize } from '../lib/realSize'
import { setRealistic, useRealistic } from '../lib/realistic'
import { type Quarter, ROTATE_SECONDS, onItsSide, quarterOf, unturn } from '../lib/rotate'
import type { Note, Project } from '../lib/types'
import { HALF_TURN, pressLight, releaseLight, rotateNotes, setTilt, turnOver, useTilt } from '../tilt/tilt'
import { type Motion, useDeviceTilt, useWakeLock } from '../tilt/useDeviceTilt'
import { type Camera, useFrontCamera } from '../tilt/useFrontCamera'
import { setViewing, useViewing } from '../tilt/viewing'
import { useElementSize } from '../editor/useElementSize'
import { PhoneLink } from './PhoneLink'
import { useBlackPage } from './useBlackPage'
import { POPUPS, popupOpen } from '../lib/popups'

/** Fit leaves this much black round the banknote, px */
const MARGIN = 16
/** The bar's distance from the bottom, and the banknote's from the bar while it shows, px */
const BAR_INSET = 12
/** How tall the front camera's picture shows at the top left, px, as the screen shows it */
const PICTURE_PX = 96
/** Pressed this long without moving, ms, a touch holds the banknote to the light until it lifts */
const HOLD_MS = 350
/** Two taps this close, in ms and px, bring the hidden UI back */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
/** Px a press may wander before it counts as a drag: a mouse's, a finger's */
const SLOP = { mouse: 3, touch: 10 }
/** The pointer hides this long, ms, after it last moved, while the UI is hidden */
const IDLE_MS = 1500
/** How to bring the UI back shows this long, ms, once it hides, then fades out over HINT_FADE_MS */
const HINT_MS = 2000
const HINT_FADE_MS = 300
/** About 160 px of drag tilts the banknote 30°, as on the canvas: up and down, and side to side at least as fast */
const DRAG_DEG_PER_PX = 30 / 160
/** A drag still this quick along the banknote's width as it lets go, px a second, and mostly sideways, turns it over */
const FLICK_PX_PER_S = 500
/** A drag's speed as it lets go is taken over this last stretch of it, ms, unless it had stopped this long before */
const FLICK_MS = 100
const FLICK_STILL_MS = 50

/** Fit fills the screen; Real size, ticked in ⋯, shows the banknote as big as it prints */
type Size = 'fit' | 'real'
/** Larger on a touch screen, for a finger */
const TOUCH = 'pointer-coarse:size-9'
/** The strip's banknotes are at most this tall and this wide, px, sharing one scale so they keep their relative sizes */
const STRIP_MAX = { height: 56, width: 72 }
/** ⋯'s menu and the phone's QR code open this far above the bar, px, clear of the banknotes in it */
const ABOVE_BAR = 8
/** Demo's own controls, which a press or scroll on leaves the banknote alone: the bar, Hide UI and the button that asks for motion */
const CONTROLS = '[data-demo-bar], [data-demo-hide], [data-demo-ask]'
/** What a key goes to instead of Demo: a field, or a popup open over it (⋯'s menu, the phone's QR code) */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]'

type Gesture =
  /**
   * One finger or the mouse: a drag tilts, from `start` and `startSide`; with the phone's own tilt on, it turns the
   * banknote further in the hand (`hand`, the tilt store's `nudge`), springing back to the phone's tilt. Side to side it
   * may go on past edge-on and over (`side`, as far as the finger wants it, from the store's `halfTurns` as it began), and
   * `trail` is where it has been lately along the banknote's own axes, for how fast it lets go
   */
  | { kind: 'press'; id: number; touch: boolean; x: number; y: number; start: number; startSide: number; moved: boolean; held: boolean; hand: boolean
      side: number; halfTurns: number; trail: { at: number; x: number; y: number }[] }
  /** Two fingers move the banknote about, at real size bigger than the screen */
  | { kind: 'pan'; x: number; y: number; from: { x: number; y: number } }

/** How fast a drag goes as it lets go at `now`, px a second along the banknote's own axes: none if it had stopped */
function speedOf(trail: Extract<Gesture, { kind: 'press' }>['trail'], now: number) {
  const recent = trail.filter((p) => now - p.at <= FLICK_MS)
  const first = recent[0]
  const last = recent.at(-1)
  const seconds = first && last ? (last.at - first.at) / 1000 : 0
  if (!first || !last || now - last.at > FLICK_STILL_MS || seconds < 0.008) return { x: 0, y: 0 }
  return { x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds }
}

/**
 * The half turns from where a drag began that it settles on as it lets go, `side` its side tilt then: the nearest, the
 * side the finger has it on; or flicked side to side, the next the flick's way, so it turns over (Keller, 13 November: one
 * gesture, as a real banknote is turned over, a slow drag springing back, one past edge-on or a quick flick settling on
 * the back)
 */
function settleTurns(side: number, speed = { x: 0, y: 0 }) {
  const flick = Math.abs(speed.x) >= FLICK_PX_PER_S && Math.abs(speed.x) > Math.abs(speed.y)
  if (!flick) return Math.round(side / HALF_TURN)
  return speed.x > 0 ? Math.ceil(side / HALF_TURN) : Math.floor(side / HALF_TURN)
}

/**
 * Demo (Keller, 10 November: "a dedicated demo mode ... like figma's prototype mode"): one banknote of the project on
 * black, as it would be held, with one bar of controls. The laptop opens it over the editor (`Editor`), where dragging tilts
 * it as on the canvas; a phone opens it by link (`DemoPage`), where the phone's own tilt is the banknote's, 1:1, the
 * banknote lying flat on the screen while only its security features change (`useDeviceTilt`), and a drag turns it further
 * in the hand, springing back, both at once (Keller, 12 November: "it shouldn't be two modes"). Fit fills the screen with
 * a 16 px margin, Real size shows it as big as it prints (`src/lib/realSize.ts`), and Hide UI, a button of its own at the
 * top centre rather than one of the bar's, as it hides the bar (Keller, 11 and 12 November), leaves only the banknote,
 * saying for 2 s how to bring the UI back; the bar's strip of the project's banknotes, or ← and →, shows another, F or a
 * swipe side to side past edge-on or flicked turns them over, L or pressing and holding holds them to the light, H hides
 * and brings back the UI, as does a double-click or double-tap. All else waits in the bar's ⋯ menu, as it rarely
 * changes: Recentre, the lamp, Realistic and Real size, and on the laptop the phone's QR code and Close Demo, so the bar is
 * the banknotes and ⋯ (Keller, 11 November: "the default should just be with realistic mode on and lamp off. And this can
 * live in a 3-dotted menu"; 14 November: "the UI should just be like 3 dots"). Left out on purpose: playback, the
 * timeline, panels, labels, the tilt pad and hint text, but for the one line on hiding the UI and the button iPhone needs
 * to ask for motion. Its controls are the canvas's own, in the app's dark colours, so they sit quietly on black (the
 * whole page turns dark while it shows, so the menu, the phone's QR code and tooltips do too). ⋯ also has Camera: the
 * front camera, which sees where the eye is (`useFrontCamera`), its
 * picture small at the top left while it looks, always switched on by hand (Keller, 13 November: "people might not want
 * cameras"); on the dev server only at first, on the live site too since Keller wanted to try it out of doors ("push it
 * so i test it outside"). While its face tracker is fetched, a bar in the picture's place shows how much has come
 * (`TrackerLoading`).
 */
export function DemoView({ project, noteId, onPick, onClose, phoneLink }: {
  project: Project
  /** The banknote shown; the first if it isn't in the project (any more) */
  noteId: string | undefined
  onPick: (noteId: string) => void
  /** ✕ and Esc: back to the editor (none on the phone's page) */
  onClose?: () => void
  /** The banknote shown, by link, for a phone to open (the laptop's phone button) */
  phoneLink?: string
}) {
  const notes = project.notes
  const index = Math.max(0, notes.findIndex((n) => n.id === noteId))
  const note = notes[index]
  const step = (by: 1 | -1) => {
    if (notes.length > 1) onPick(notes[(index + by + notes.length) % notes.length].id)
  }

  const root = useRef<HTMLDivElement>(null)
  const screen = useElementSize(root)
  const bar = useRef<HTMLDivElement>(null)
  const barSize = useElementSize(bar)
  const hide = useRef<HTMLDivElement>(null)
  const hideSize = useElementSize(hide)
  // The bar's panel, which ⋯'s menu and the phone's QR code open above, clear of the banknotes in it
  const barPanel = useRef<HTMLDivElement>(null)
  // The phone's QR code, from ⋯ on the laptop (Keller, 14 November: the bar "just like 3 dots"; a button of its own in the
  // bar until then); `phoneComing` keeps ⋯ from taking the keys back to Demo as it closes for it
  const [phoneShown, setPhoneShown] = useState(false)
  const phoneComing = useRef(false)
  const [size, setSize] = useState<Size>('fit')
  const [ui, setUi] = useState(true)
  // How to bring the UI back, for 2 s once it hides, then fading (Keller, 12 November: "have a like prompt that stays for
  // like 2 seconds and say something like double click to ... see the UI again")
  const [hint, setHint] = useState<'shown' | 'fading'>()
  const hintTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const hideUi = () => {
    setUi(false)
    hintTimers.current.forEach(clearTimeout)
    setHint('shown')
    hintTimers.current = [setTimeout(() => setHint('fading'), HINT_MS), setTimeout(() => setHint(undefined), HINT_MS + HINT_FADE_MS)]
  }
  const showUi = () => {
    setUi(true)
    hintTimers.current.forEach(clearTimeout)
    setHint(undefined)
  }
  const toggleUi = () => (ui ? hideUi() : showUi())
  useEffect(() => () => hintTimers.current.forEach(clearTimeout), [])
  // Where a banknote bigger than the screen has been moved to, for the banknote and size it was moved at: another starts
  // from its middle again
  const panKey = `${note?.id}|${size}`
  const [panned, setPanned] = useState({ key: panKey, x: 0, y: 0 })
  const pan = panned.key === panKey ? panned : { x: 0, y: 0 }
  const [checking, setChecking] = useState(false)
  const autoChecked = useRef(false)
  const [idle, setIdle] = useState(false)
  const quarterTurns = useTilt((s) => s.quarterTurns)
  const sheen = useTilt((s) => s.sheen)
  const realistic = useRealistic((s) => s.on)
  const checked = useRealSize((s) => s.checked)
  // A phone's own tilt is the banknote's, always (Keller, 12 November: "I don't think we even need a tilt toggle ... both
  // should be enabled"); drawn flat meanwhile, as the phone is what turns, and a drag turns it further in the hand
  const { motion, upright, allow, recentre } = useDeviceTilt(quarterTurns)
  // The front camera, tried from ⋯ (Keller, 13 November: "it doesn't have to be a separate page"), off until switched on;
  // on a laptop, the screen standing still, the banknote is drawn flat too
  const [camera, setCamera] = useState(false)
  const { camera: cameraState, aspect: cameraAspect, videoRef: cameraRef, rightRef: rightEyeRef, leftRef: leftEyeRef, seenRef: seenLineRef, usedRef: usedLineRef } =
    useFrontCamera(camera, motion === 'on', quarterTurns, upright)
  const flat = motion === 'on' || camera
  useWakeLock(true)

  useBlackPage()

  // The banknote turns about its own middle on the view, and the view, for a phone held sideways with rotation locked, a
  // quarter the way round that is upright in the hand; a drag and the tilt go by the banknote's own axes
  const turned = quarterOf(quarterTurns + upright)
  const sideways = onItsSide(upright)
  const viewDeg = upright === 3 ? -90 : upright * 90
  // The front camera's picture, at the top left while it is on: as the screen shows it, so on its side in a view turned for
  // a phone held sideways, and leaving room above the banknote as Hide UI does
  const picture = { width: PICTURE_PX * cameraAspect, height: PICTURE_PX }
  const pictureBox = sideways ? { width: picture.height, height: picture.width } : picture
  const width = screen?.width ?? 0
  const height = screen?.height ?? 0
  const view = { width: sideways ? height : width, height: sideways ? width : height }
  // Room for the banknote: the view, less the margin all round, and the bar below and Hide UI above while they show
  const barRoom = ui ? Math.max(0, (barSize?.height ?? 44) + 2 * BAR_INSET - MARGIN) : 0
  const hideRoom = ui ? Math.max(0, Math.max(hideSize?.height ?? 40, camera ? pictureBox.height : 0) + 2 * BAR_INSET - MARGIN) : 0
  const area = { width: Math.max(1, view.width - 2 * MARGIN), height: Math.max(1, view.height - 2 * MARGIN - barRoom - hideRoom) }
  const onSide = onItsSide(quarterOf(quarterTurns))
  const shownMm = note ? { width: onSide ? note.heightMm : note.widthMm, height: onSide ? note.widthMm : note.heightMm } : { width: 1, height: 1 }
  const scale = size === 'real' ? realPxPerMm(checked) : Math.min(area.width / shownMm.width, area.height / shownMm.height)
  // Bigger than the room, it moves only as far as its edges
  const room = { x: Math.max(0, (shownMm.width * scale - area.width) / 2), y: Math.max(0, (shownMm.height * scale - area.height) / 2) }
  // Side to side, a drag turns the banknote as a page turns: its edge dragged to its middle, it is edge-on, and on across
  // it, right over; by its width as it shows, as far as the screen shows it, and never slower than up and down
  const across = Math.min(note ? note.widthMm * scale : Infinity, onItsSide(turned) ? height : width)
  const sideDegPerPx = across > 0 ? Math.max(DRAG_DEG_PER_PX, HALF_TURN / across) : DRAG_DEG_PER_PX
  const at = { x: clamp(pan.x, -room.x, room.x), y: clamp(pan.y, -room.y, room.y) }
  const middle = { x: view.width / 2 + at.x, y: MARGIN + hideRoom + area.height / 2 + at.y }
  const panTo = (x: number, y: number) => setPanned({ key: panKey, x: clamp(x, -room.x, room.x), y: clamp(y, -room.y, room.y) })
  const panBy = (dx: number, dy: number) => {
    // Along the view, which a phone held sideways turns on the screen
    const along = unturn(dx, dy, upright)
    panTo(at.x + along.x, at.y + along.y)
  }

  // Real size, the first time on a screen not yet checked: the card check, once
  const pickSize = (next: Size) => {
    setSize(next)
    if (next === 'real' && !isChecked() && !autoChecked.current) {
      autoChecked.current = true
      setChecking(true)
    }
  }

  // When the browser last left full screen: the Esc that left it isn't also the one that leaves Demo
  const leftFullScreen = useRef(-Infinity)
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) leftFullScreen.current = performance.now()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Keys: Esc leaves (full screen first, which the browser does itself), ← and → step through the banknotes, F turns them
  // over, L holds them to the light (a tap flips the lamp), H hides or brings back the UI, R and Shift+R rotate them
  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || checking) return
      const element = event.target instanceof Element ? event.target : null
      if (element?.closest(TYPING) || popupOpen(POPUPS, root.current)) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (key === 'Escape') {
        if (document.fullscreenElement || performance.now() - leftFullScreen.current < 500 || !onClose) return
        event.preventDefault()
        onClose()
        return
      }
      if (!['ArrowLeft', 'ArrowRight', 'f', 'l', 'h', 'r'].includes(key)) return
      event.preventDefault()
      if (key === 'l') {
        if (!event.repeat) pressLight()
        return
      }
      if (event.repeat && key !== 'ArrowLeft' && key !== 'ArrowRight') return
      if (key === 'ArrowLeft') step(-1)
      else if (key === 'ArrowRight') step(1)
      else if (key === 'f') turnOver()
      else if (key === 'h') toggleUi()
      else rotateNotes(event.shiftKey ? -1 : 1)
    }
    const onUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'l') releaseLight()
    }
    const onBlur = () => releaseLight(performance.now(), false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  })
  // Its keys from the start, as a dialog takes focus; leaving lets go of a light still held, without flipping the lamp
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
    return () => releaseLight(performance.now(), false)
  }, [])
  // The picker, the ⋯ menu or the phone's QR code closed, the keys come back to Demo itself: Base UI would give them to the
  // first control in the bar, Demo taking focus but not Tab, and the picker takes a letter as a banknote's name
  const backToDemo = () => {
    queueMicrotask(() => root.current?.focus({ preventScroll: true }))
    return false
  }
  // ⋯ closed for the phone's QR code, which takes the keys itself and gives them back to Demo as it closes
  const menuClosed = () => {
    if (!phoneComing.current) return backToDemo()
    phoneComing.current = false
    return false
  }

  // Scrolling moves a banknote bigger than the screen about; a pinch or ⌘-scroll never zooms the page
  const panRef = useRef(panBy)
  useEffect(() => { panRef.current = panBy })
  useEffect(() => {
    const element = root.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!(event.target instanceof Node) || !element.contains(event.target) || (event.target as Element).closest?.(CONTROLS)) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) return
      panRef.current(-event.deltaX, -event.deltaY)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // With the UI hidden, the pointer hides too while it rests
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wake = () => {
    if (idle) setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS)
  }
  useEffect(() => {
    if (ui) return
    const timer = setTimeout(() => setIdle(true), IDLE_MS)
    idleTimer.current = timer
    return () => clearTimeout(timer)
  }, [ui])

  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastTap = useRef<{ at: number; x: number; y: number }>(undefined)
  /** The UI hidden or brought back by a double tap's taps, which the browser then makes a double-click of as well */
  const doubleTapped = useRef(false)
  const endHold = (press: Extract<Gesture, { kind: 'press' }>) => {
    clearTimeout(holdTimer.current)
    if (press.held) releaseLight(performance.now(), false)
    press.held = false
  }
  /**
   * A drag let go of: back to flat, or on the phone's own tilt, back to the phone's; or, past edge-on or flicked side to
   * side, flat on the banknote's other side (`settleTurns`), the tilt loop taking it over. Lost to a second finger or the
   * browser, it is not flicked
   */
  const letGo = (press: Extract<Gesture, { kind: 'press' }>, flicked = true) => {
    if (!press.moved) return
    const s = useTilt.getState()
    const turns = settleTurns(press.side, flicked ? speedOf(press.trail, performance.now()) : undefined)
    // Half turns the loop has already taken it over are in the store's side tilt
    const side = HALF_TURN * (turns - (s.halfTurns - press.halfTurns)) || 0
    if (press.hand) setTilt({ nudge: 0, nudgeX: side })
    else if (s.source !== 'device') setTilt({ target: 0, targetX: side })
  }
  const middleOf = () => {
    const [a, b] = [...pointers.current.values()]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  /** On the view, not over its controls or the card check, nor anything opened from them */
  const onStage = (target: EventTarget) =>
    target instanceof Element && !!root.current?.contains(target) && !target.closest(`${CONTROLS}, [data-card-check]`)

  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label="Demo" data-demo="" tabIndex={-1}
      className={cn('fixed inset-0 z-40 touch-none overflow-hidden bg-black text-foreground outline-none select-none', !ui && idle && 'cursor-none')}
      onPointerDown={(e) => {
        if (!onStage(e.target)) return
        doubleTapped.current = false
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const touch = e.pointerType !== 'mouse'
        if (pointers.current.size === 2) {
          // A second finger: two fingers move the banknote about, whatever the first had started
          const g = gesture.current
          if (g?.kind === 'press') {
            endHold(g)
            letGo(g, false)
          }
          gesture.current = { kind: 'pan', ...middleOf(), from: at }
          return
        }
        if (pointers.current.size > 2) return
        if (!touch && e.button !== 0) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        // A second tap soon after the first, near it: the UI hidden, or back (Keller, 13 November: "we have double tap to
        // ... get back the UI. We should also have double tap to get rid of the UI")
        const tap = lastTap.current
        if (touch && tap && e.timeStamp - tap.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < DOUBLE_TAP_PX) {
          lastTap.current = undefined
          doubleTapped.current = true
          toggleUi()
          gesture.current = null
          return
        }
        // On the phone's own tilt, a drag turns the banknote further in the hand, from where a drag left it springing back
        const s = useTilt.getState()
        const hand = s.source === 'device'
        const startSide = hand ? s.nudgeX : s.targetX
        const press: Gesture = { kind: 'press', id: e.pointerId, touch, x: e.clientX, y: e.clientY, start: hand ? s.nudge : s.target,
          startSide, moved: false, held: false, hand, side: startSide, halfTurns: s.halfTurns, trail: [] }
        gesture.current = press
        // Pressed and held still, a finger holds the banknote to the light until it lifts, as holding L does
        if (touch) holdTimer.current = setTimeout(() => {
          if (gesture.current !== press || press.moved) return
          press.held = true
          pressLight()
        }, HOLD_MS)
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') wake()
        if (!pointers.current.has(e.pointerId)) return
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const g = gesture.current
        if (g?.kind === 'pan') {
          if (pointers.current.size < 2) return
          const now = middleOf()
          const along = unturn(now.x - g.x, now.y - g.y, upright)
          panTo(g.from.x + along.x, g.from.y + along.y)
          return
        }
        if (g?.kind !== 'press' || g.id !== e.pointerId) return
        const dx = e.clientX - g.x
        const dy = e.clientY - g.y
        if (!g.moved && Math.hypot(dx, dy) < (g.touch ? SLOP.touch : SLOP.mouse)) return
        if (!g.moved) {
          g.moved = true
          if (!g.held) clearTimeout(holdTimer.current)
        }
        // Tilts the way the pointer goes on the banknote as it shows, turned or not, springing back on release; on the phone's
        // own tilt, in the hand. Side to side it goes on past edge-on, over onto the other side (Keller, 13 November: "When
        // the UI is off, we should use swipe"), within a half turn and edge-on again either way. A drag begun before motion
        // came leaves the phone's tilt alone
        const along = unturn(dx, dy, turned)
        const now = performance.now()
        g.trail = [...g.trail.filter((p) => now - p.at <= FLICK_MS), { at: now, x: along.x, y: along.y }]
        g.side = clamp(g.startSide + along.x * sideDegPerPx, -HALF_TURN - TILT_LIMIT, HALF_TURN + TILT_LIMIT)
        const y = clamp(g.start - along.y * DRAG_DEG_PER_PX, -TILT_LIMIT, TILT_LIMIT)
        // As far as the finger wants it, less the half turns the loop has taken it over meanwhile
        const x = g.side - HALF_TURN * (useTilt.getState().halfTurns - g.halfTurns)
        if (g.hand) setTilt({ nudge: y, nudgeX: x })
        else if (useTilt.getState().source !== 'device') setTilt({ source: 'drag', target: y, targetX: x })
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId)
        const g = gesture.current
        if (g?.kind === 'pan') {
          if (pointers.current.size === 0) gesture.current = null
          return
        }
        if (g?.kind !== 'press' || g.id !== e.pointerId) return
        gesture.current = null
        const held = g.held
        endHold(g)
        letGo(g)
        if (g.touch && !g.moved && !held) lastTap.current = { at: e.timeStamp, x: e.clientX, y: e.clientY }
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId)
        const g = gesture.current
        if (g?.kind === 'press' && g.id === e.pointerId) {
          endHold(g)
          letGo(g, false)
          gesture.current = null
        } else if (g?.kind === 'pan' && pointers.current.size === 0) gesture.current = null
      }}
      onDoubleClick={(e) => {
        // Once for a double tap: its taps have done it, unless they were too slow or too far apart for that
        if (onStage(e.target) && !doubleTapped.current) toggleUi()
      }}
      // iPhone gives motion only once a tap asks for it: the first tap anywhere in Demo asks, as its button does
      onClickCapture={allow}
    >
      {/* The view: the screen, or for a phone held sideways with rotation locked, turned a quarter to be upright in the hand */}
      <div data-demo-view="" className="absolute transition-transform ease-in-out motion-reduce:transition-none"
        style={{
          width: view.width, height: view.height, left: (width - view.width) / 2, top: (height - view.height) / 2,
          transform: upright ? `rotate(${viewDeg}deg)` : undefined, transitionDuration: `${ROTATE_SECONDS}s`,
        }}>
        {note && screen && (
          <div data-demo-note={note.id} className="absolute"
            style={{ left: middle.x - (note.widthMm * scale) / 2, top: middle.y - (note.heightMm * scale) / 2, width: note.widthMm * scale, height: note.heightMm * scale }}>
            {/* Rotated (R, or the editor's Rotate), it turns about its middle, its tilt still about its own axes inside */}
            <div className="absolute inset-0 transition-transform ease-in-out motion-reduce:transition-none"
              style={{ transform: quarterTurns ? `rotate(${quarterTurns * 90}deg)` : undefined, transitionDuration: `${ROTATE_SECONDS}s` }}>
              <div style={{ perspective: perspectiveFor(note, scale) }}>
                <NoteView key={note.id} note={note} scale={scale} live perspective flat={flat} sheen={sheen} realistic={realistic} />
              </div>
            </div>
          </div>
        )}

        {/* Hide UI in words, at the top centre (Keller, 12 November: "let's have the hide UI button to actually say hide UI,
            and let's have it at the center top"), apart from the bar it hides; hidden with the rest, not taken away, so it is
            measured for the room it leaves above the banknote, as the bar is below */}
        {note && (
          <div ref={hide} data-demo-hide="" className={cn('absolute left-1/2 -translate-x-1/2', !ui && 'invisible')} style={{ top: BAR_INSET }}>
            <Panel className="p-1.5">
              <Button variant="ghost" size="sm" className="pointer-coarse:h-8" title="Hide UI (H)" onClick={hideUi}>
                <EyeOff />
                Hide UI
              </Button>
            </Panel>
          </div>
        )}

        {/* The front camera's picture while it looks, mirrored as a mirror shows a face, with the two eyes it found; faded
            rather than hidden with the UI, as a picture that isn't shown may stop coming. Its box is the picture's own shape
            (Keller, 13 November: "the camara preview is not showing up properly"), so the dots sit on the eyes, and it stays
            as the screen is while a view for a phone held sideways turns, as the picture does. From between the eyes go two
            lines of sight, as long as each is far off square on: white, as this picture has the eye, and pink, the eye the
            banknote follows (Keller, 14 November: "show the line that is coming out of my eye so that I can identify what
            is going wrong"). Its place shows, black, from when the camera is switched on, with a bar in it for how much
            of the face tracker has come while that is fetched (`TrackerLoading`) */}
        {camera && (
          <div data-front-camera="" className={cn('pointer-events-none absolute overflow-hidden rounded-md bg-black ring-1 ring-white/15 transition-opacity',
            (!ui || (cameraState !== 'on' && cameraState !== 'starting')) && 'opacity-0')} style={{ top: BAR_INSET, left: BAR_INSET, width: pictureBox.width, height: pictureBox.height }}>
            <div className="absolute top-1/2 left-1/2 transition-transform ease-in-out motion-reduce:transition-none"
              style={{ width: picture.width, height: picture.height, transform: `translate(-50%, -50%) rotate(${-viewDeg}deg) scaleX(-1)`, transitionDuration: `${ROTATE_SECONDS}s` }}>
              <video ref={cameraRef} className="absolute inset-0 size-full object-fill" muted playsInline />
              <svg className="absolute inset-0 size-full" aria-hidden="true">
                <line ref={usedLineRef} className="opacity-0" stroke="#f472b6" strokeWidth={2.5} strokeLinecap="round" />
                <line ref={seenLineRef} className="opacity-0" stroke="#ffffff" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
              <span ref={rightEyeRef} className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 ring-1 ring-black/60" />
              <span ref={leftEyeRef} className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 ring-1 ring-black/60" />
            </div>
            {cameraState === 'starting' && <TrackerLoading />}
          </div>
        )}

        {/* Where Hide UI was, for 2 s once the UI hides, how to bring it back; taps go through it to the banknote */}
        {hint && (
          <div data-demo-hint="" role="status"
            className={cn('pointer-events-none absolute left-1/2 -translate-x-1/2 transition-opacity animate-in fade-in motion-reduce:animate-none motion-reduce:transition-none',
              hint === 'fading' && 'opacity-0')}
            style={{ top: BAR_INSET, transitionDuration: `${HINT_FADE_MS}ms` }}>
            <Panel className="px-3 py-2 text-sm whitespace-nowrap">
              <span className="pointer-coarse:hidden">Double-click to bring back the UI</span>
              <span className="hidden pointer-coarse:inline">Double-tap to bring back the UI</span>
            </Panel>
          </div>
        )}

        {/* iPhone asks for motion only from a tap: as Demo opens, one button in the middle asks (Keller, 12 November: "once
            people open this on the phone, it should ask for permission"), as a tap anywhere does. Hidden with the UI */}
        {note && motion === 'ask' && ui && (
          <div data-demo-ask="" className="absolute inset-x-0 flex -translate-y-1/2 justify-center" style={{ top: MARGIN + hideRoom + area.height / 2 }}>
            <Button className="shadow-lg pointer-coarse:h-10 pointer-coarse:px-4" onClick={allow}>
              <Rotate3d />
              Tilt with your phone
            </Button>
          </div>
        )}

        {/* The bar, at the bottom: the project's banknotes in a row, and ⋯ (Keller, 14 November: "the UI should just be like
            3 dots ... lay the designs in that project out horizontally ... at the bottom, so I can just like quickly switch
            between different banknotes"). Flip went, as a swipe or F turns the banknote over ("since we have flip built in,
            we can just get rid of the flip button"), Fit | Real size went into ⋯ as Real size ("the real size should be an
            option in the 3-dot menu"), and on the laptop the phone button and ✕ too; the strip took the picker's place,
            and a project of one banknote has ⋯ alone. Hidden with Hide UI, not taken away, so it is measured for the room
            it leaves */}
        {note && (
          <div ref={bar} data-demo-bar="" className={cn('absolute inset-x-3 flex justify-center', !ui && 'invisible')} style={{ bottom: BAR_INSET }}>
            <div ref={barPanel} className="flex max-w-full min-w-0">
              <Panel className="flex max-w-full min-w-0 items-center gap-1.5 p-1.5">
                {notes.length > 1 && (
                  <>
                    <NoteStrip notes={notes} shownId={note.id} onPick={(id) => { onPick(id); backToDemo() }} />
                    <div className="h-7 w-px shrink-0 bg-border" aria-hidden="true" />
                  </>
                )}
                <LookMenu finalFocus={menuClosed} anchor={barPanel} motion={motion} onRecentre={recentre}
                  camera={{ on: camera, state: cameraState, onChange: setCamera }}
                  size={size} onSize={pickSize} onCheckSize={() => setChecking(true)}
                  onPhone={phoneLink ? () => { phoneComing.current = true; setPhoneShown(true) } : undefined} onClose={onClose} />
              </Panel>
            </div>
            {phoneLink && <PhoneLink link={phoneLink} open={phoneShown} onOpenChange={setPhoneShown} anchor={barPanel} finalFocus={backToDemo} />}
          </div>
        )}

        {checking && <CardCheck quarter={upright} onDone={(px) => { setRealPxPerMm(px); setChecking(false) }} onCancel={() => setChecking(false)} />}
      </div>
      {!note && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">This project has no banknotes yet</p>}
    </div>
  )
}

/**
 * How much of the front camera's face tracker has come (`useTrackerLoading`), as a bar across the middle of the picture's
 * place while the camera starts (Keller, 14 November: "lets add a little progress abr for the google thing to load as
 * right now it just feels like it is stuck when loading"): the 18 MB it fetches the first time, which said nothing as it
 * came. Only if the tracker was still on its way as the camera started, and then until the picture takes its place: full,
 * and pulsing, once all of it is here and it is being set up. In no words, as nothing that loads says so (CLAUDE.md,
 * Loading states)
 */
function TrackerLoading() {
  const fetched = useTrackerLoading((s) => s.fetched)
  const [shown, setShown] = useState(false)
  if (fetched !== undefined && !shown) setShown(true)
  if (fetched === undefined && !shown) return null
  const percent = Math.round((fetched ?? 1) * 100)
  return (
    <Progress data-tracker-loading="" aria-label="Loading the camera" value={percent}
      className={cn('absolute inset-x-3 top-1/2 -translate-y-1/2', percent === 100 && 'animate-pulse motion-reduce:animate-none')} />
  )
}

/**
 * The project's banknotes in a row, in the bar (Keller, 14 November: "lay the designs in that project out horizontally ...
 * at the bottom, so I can just like quickly switch between different banknotes"): their fronts at one scale, at most
 * `STRIP_MAX`, bottoms lined up, as the project list's cards show them, the one shown outlined and the others dimmed, and a
 * tap shows one, its name in a tooltip. Drawn flat, as the Banknotes list draws them. More than fit scroll sideways, the
 * one shown kept in sight, as ← and → step through them too
 */
function NoteStrip({ notes, shownId, onPick }: { notes: Note[]; shownId: string; onPick: (noteId: string) => void }) {
  const strip = useRef<HTMLDivElement>(null)
  const shown = useRef<HTMLButtonElement>(null)
  const scale = Math.min(STRIP_MAX.height / Math.max(...notes.map((n) => n.heightMm), 1), STRIP_MAX.width / Math.max(...notes.map((n) => n.widthMm), 1))
  useLayoutEffect(() => {
    const box = strip.current
    const button = shown.current
    if (!box || !button) return
    const left = button.offsetLeft
    const right = left + button.offsetWidth
    if (left < box.scrollLeft) box.scrollLeft = left - 8
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + 8
  }, [shownId])
  return (
    <div ref={strip} data-demo-strip=""
      className="relative flex min-w-0 touch-pan-x items-end gap-2 overflow-x-auto overflow-y-hidden p-[5px] [scrollbar-width:none] pointer-coarse:gap-2.5 [&::-webkit-scrollbar]:hidden">
      {notes.map((n) => {
        const on = n.id === shownId
        return (
          <button key={n.id} ref={on ? shown : undefined} type="button" title={n.name} aria-label={n.name} aria-pressed={on}
            className={cn('shrink-0 transition-opacity focus-visible:outline-2 focus-visible:outline-ring', !on && 'opacity-50 hover:opacity-80')}
            style={on ? { outline: '1.5px solid white', outlineOffset: 2.5 } : undefined}
            onClick={() => onPick(n.id)}>
            <NoteView note={n} scale={scale} />
          </button>
        )
      })}
    </div>
  )
}

/**
 * ⋯, all else, so the bar is only the banknotes and ⋯ (Keller, 11 November; 14 November: "the UI should just be like 3
 * dots"). On a phone first Recentre while it tilts
 * (since 13 November it makes how the phone is held then the neutral, moving the dial: "just one value"),
 * or in words once motion was refused (a page can't ask again until Safari is quit and reopened), and no switch for its
 * tilt, always on (Keller, 12 November); with it the neutral's dial (Keller, 13 November), how far from lying flat the
 * phone is looked at square on as Demo opens ("a dial ... making the default 90 degrees"); the front camera, on a laptop
 * too ("Camera unavailable" while it couldn't start);
 * then the lamp, held to the light until switched off again, and Realistic, the
 * tilt card's two toggles, Realistic on until switched off and Demo opening with the lamp off ("the default should just
 * be with realistic mode on and lamp off. And this can live in a 3-dotted menu"); then Real size, ticked, Fit unticked
 * ("the real size should be an option in the 3-dot menu"; Fit | Real size in the bar until then), and while it is, its
 * check against a bank card; and on the laptop the phone's QR code and Close Demo. Toggles are ticked while on. It opens
 * above the bar, lined up with the bar's right end, clear of the banknotes in it
 */
function LookMenu({ finalFocus, anchor, motion, onRecentre, camera, size, onSize, onCheckSize, onPhone, onClose }: {
  finalFocus: () => boolean
  /** What it opens above: the bar's panel */
  anchor: RefObject<Element | null>
  motion: Motion
  onRecentre: () => void
  /** The front camera's switch */
  camera: { on: boolean; state: Camera; onChange: (on: boolean) => void }
  /** Fit, or Real size ticked */
  size: Size
  onSize: (size: Size) => void
  /** Real size's check, while Real size is ticked */
  onCheckSize: () => void
  /** The phone's QR code (on the laptop) */
  onPhone?: () => void
  /** Leaves Demo (on the laptop), as Esc does */
  onClose?: () => void
}) {
  const backlit = useTilt((s) => s.backlit)
  const realistic = useRealistic((s) => s.on)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" className={cn('shrink-0', TOUCH)} />} />}>
          <Ellipsis />
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent anchor={anchor} side="top" align="end" sideOffset={ABOVE_BAR} className="w-auto" finalFocus={finalFocus}>
        {motion === 'on' ? (
          <>
            <DropdownMenuItem onClick={onRecentre}>
              <LocateFixed />
              Recentre
            </DropdownMenuItem>
            <NeutralDial />
          </>
        ) : motion === 'denied' && (
          <DropdownMenuItem disabled>
            <Rotate3d />
            Motion not allowed
          </DropdownMenuItem>
        )}
        <DropdownMenuCheckboxItem checked={camera.on} onCheckedChange={camera.onChange}>
          <ScanFace />
          {camera.state === 'failed' ? 'Camera unavailable' : 'Camera'}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={backlit} onCheckedChange={(on) => setTilt({ backlit: on })}>
          <Lamp />
          Hold up to the light
          <DropdownMenuShortcut className="pl-4 pointer-coarse:hidden">L</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={realistic} onCheckedChange={setRealistic}>
          <Sparkles />
          Realistic
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {/* The menu closes on it, as the banknote changes size, or the card check opens the first time */}
        <DropdownMenuCheckboxItem checked={size === 'real'} closeOnClick onCheckedChange={(on) => onSize(on ? 'real' : 'fit')}>
          <RulerDimensionLine />
          Real size
        </DropdownMenuCheckboxItem>
        {size === 'real' && (
          <DropdownMenuItem onClick={onCheckSize}>
            <Ruler />
            Check real size
          </DropdownMenuItem>
        )}
        {(onPhone || onClose) && <DropdownMenuSeparator />}
        {onPhone && (
          <DropdownMenuItem onClick={onPhone}>
            <Smartphone />
            Open on your phone
          </DropdownMenuItem>
        )}
        {onClose && (
          <DropdownMenuItem onClick={onClose}>
            <X />
            Close Demo
            <DropdownMenuShortcut className="pl-4 pointer-coarse:hidden">Esc</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The keys a slider takes for itself */
const DIAL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'])

/**
 * The neutral's dial: how far from lying flat, 0° to 90°, the phone is looked at square on as Demo opens, upright unless
 * moved, by it or by Recentre, which sets it to how the phone is held then. Moving it puts the eye there at once, so the
 * banknote shows what it does
 */
function NeutralDial() {
  const neutralDeg = useViewing((s) => s.neutralDeg)
  return (
    // Its keys move the dial, not the menu's highlight; Esc and Tab still reach the menu, the dial having the focus as ⋯ opens
    <div data-neutral-dial="" className="flex items-center gap-1.5 py-1 pr-2 pl-1.5 text-sm"
      onKeyDown={(e) => { if (DIAL_KEYS.has(e.key)) e.stopPropagation() }}>
      <Smartphone className="size-4 shrink-0" />
      <span className="mr-1.5">Neutral</span>
      <Slider className="w-24 pointer-coarse:w-28" value={[neutralDeg]} min={0} max={90} step={1} largeStep={10} thumbLabel={() => 'Neutral'}
        onValueChange={(value) => setViewing({ neutralDeg: Array.isArray(value) ? value[0] : value })} />
      <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{neutralDeg}°</span>
    </div>
  )
}

/**
 * Real size's check (plan: "hold a bank card against an outline of one on the screen and size the outline to match"): a
 * bank card's outline at the size Real size would draw it, sized by dragging it or with − and +, or ← and →, and kept for
 * this screen with Done (Enter). `quarter` is how far the view it shows on is turned on the screen.
 */
function CardCheck({ quarter, onDone, onCancel }: { quarter: Quarter; onDone: (cssPxPerMm: number) => void; onCancel: () => void }) {
  const [px, setPx] = useState(() => realPxPerMm())
  const keep = (next: number) => setPx(clamp(next, 2, 14))
  const drag = useRef<{ x: number; y: number; px: number; sign: number } | null>(null)
  const width = CARD_MM.width * px
  const height = CARD_MM.height * px
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
      else if (event.key === 'Enter') onDone(px)
      else if (event.key === 'ArrowLeft' || event.key === '-') keep(px * (event.shiftKey ? 0.98 : 0.998))
      else if (event.key === 'ArrowRight' || event.key === '+' || event.key === '=') keep(px * (event.shiftKey ? 1.02 : 1.002))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div data-card-check="" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-black/90 p-4">
      <p className="text-center text-sm text-muted-foreground">Hold a bank card to the outline and size it to match</p>
      <div data-card-outline="" className="relative shrink-0 cursor-ew-resize touch-none border-2 border-white/90"
        style={{ width, height, borderRadius: CARD_RADIUS_MM * px }}
        onPointerDown={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          // Pressed on its right half, a drag right makes it bigger; on its left half, a drag left
          const at = unturn(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2), quarter)
          drag.current = { x: e.clientX, y: e.clientY, px, sign: at.x < 0 ? -1 : 1 }
          e.currentTarget.setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const along = unturn(e.clientX - d.x, e.clientY - d.y, quarter)
          // The card stays centred, so its edge moving by a px makes it 2 px wider
          keep(d.px * (1 + (2 * d.sign * along.x) / (CARD_MM.width * d.px)))
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}>
        <div className="absolute -right-2.5 -bottom-2.5 size-5 rounded-full border-2 border-black bg-white" />
      </div>
      <Panel className="flex items-center gap-1 p-1.5">
        <IconButton className={TOUCH} label="Smaller" onClick={() => keep(px * 0.995)}><Minus /></IconButton>
        <IconButton className={TOUCH} label="Bigger" onClick={() => keep(px * 1.005)}><Plus /></IconButton>
        <Button variant="ghost" size="sm" className="pointer-coarse:h-9" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="pointer-coarse:h-9" onClick={() => onDone(px)}>Done</Button>
      </Panel>
    </div>
  )
}
