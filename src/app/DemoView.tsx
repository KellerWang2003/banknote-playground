import { Ellipsis, EyeOff, FlipHorizontal2, Lamp, LocateFixed, Minus, Plus, Rotate3d, Ruler, Smartphone, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { IconButton, Panel, Segmented } from '../components/controls'
import { NoteView } from '../components/NoteView'
import { TILT_LIMIT, clamp, perspectiveFor } from '../lib/frames'
import { CARD_MM, CARD_RADIUS_MM, isChecked, realPxPerMm, setRealPxPerMm, useRealSize } from '../lib/realSize'
import { setRealistic, useRealistic } from '../lib/realistic'
import { type Quarter, ROTATE_SECONDS, onItsSide, quarterOf, unturn } from '../lib/rotate'
import type { Project } from '../lib/types'
import { pressLight, releaseLight, rotateNotes, setTilt, turnOver, useTilt } from '../tilt/tilt'
import { type Motion, useDeviceTilt, useWakeLock } from '../tilt/useDeviceTilt'
import { setViewing, useViewing } from '../tilt/viewing'
import { useElementSize } from '../editor/useElementSize'
import { PhoneLink } from './PhoneLink'
import { useBlackPage } from './useBlackPage'
import { POPUPS, popupOpen } from '../lib/popups'

/** Fit leaves this much black round the banknote, px */
const MARGIN = 16
/** The bar's distance from the bottom, and the banknote's from the bar while it shows, px */
const BAR_INSET = 12
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
/** About 160 px of drag tilts the banknote 30°, as on the canvas */
const DRAG_DEG_PER_PX = 30 / 160

type Size = 'fit' | 'real'
const SIZES: { value: Size; label: string }[] = [{ value: 'fit', label: 'Fit' }, { value: 'real', label: 'Real size' }]
/** Larger on a touch screen, for a finger */
const TOUCH = 'pointer-coarse:size-9'
const TOUCH_ROW = 'pointer-coarse:[&_button]:h-8'
/** Demo's own controls, which a press or scroll on leaves the banknote alone: the bar, Hide UI and the button that asks for motion */
const CONTROLS = '[data-demo-bar], [data-demo-hide], [data-demo-ask]'
/** What a key goes to instead of Demo: a field, or a popup open over it (the picker, the phone's QR code) */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]'

type Gesture =
  /**
   * One finger or the mouse: a drag tilts, from `start` and `startSide`; with the phone's own tilt on, it turns the
   * banknote further in the hand (`hand`, the tilt store's `nudge`), springing back to the phone's tilt
   */
  | { kind: 'press'; id: number; touch: boolean; x: number; y: number; start: number; startSide: number; moved: boolean; held: boolean; hand: boolean }
  /** Two fingers move the banknote about, at real size bigger than the screen */
  | { kind: 'pan'; x: number; y: number; from: { x: number; y: number } }

/**
 * Demo (Keller, 10 November: "a dedicated demo mode ... like figma's prototype mode"): one banknote of the project on
 * black, as it would be held, with one bar of controls. The laptop opens it over the editor (`Editor`), where dragging tilts
 * it as on the canvas; a phone opens it by link (`DemoPage`), where the phone's own tilt is the banknote's, 1:1, the
 * banknote lying flat on the screen while only its security features change (`useDeviceTilt`), and a drag turns it further
 * in the hand, springing back, both at once (Keller, 12 November: "it shouldn't be two modes"). Fit fills the screen with
 * a 16 px margin, Real size shows it as big as it prints (`src/lib/realSize.ts`), and Hide UI, a button of its own at the
 * top centre rather than one of the bar's, as it hides the bar (Keller, 11 and 12 November), leaves only the banknote,
 * saying for 2 s how to bring the UI back; ← and → step through the banknotes, F or Flip turns them over, L or pressing
 * and holding holds them to the light, H hides and brings back the UI, as does a double-click or double-tap. Recentre,
 * the lamp and Realistic wait in the bar's ⋯ menu, as they rarely change, so the bar is one line (Keller, 11 November:
 * "the default should just be with realistic mode on and lamp off. And this can live in a 3-dotted menu", then "it can
 * be just one line"). Left out on purpose: playback, the timeline, panels, labels, the tilt pad and hint text, but for
 * the one line on hiding the UI and the button iPhone needs to ask for motion. Its controls are the canvas's own, in the
 * app's dark colours, so they sit quietly on black (the whole page turns dark while it shows, so the picker's list, the
 * menu and tooltips do too).
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
  const flat = motion === 'on'
  useWakeLock(true)

  useBlackPage()

  // The banknote turns about its own middle on the view, and the view, for a phone held sideways with rotation locked, a
  // quarter the way round that is upright in the hand; a drag and the tilt go by the banknote's own axes
  const turned = quarterOf(quarterTurns + upright)
  const sideways = onItsSide(upright)
  const width = screen?.width ?? 0
  const height = screen?.height ?? 0
  const view = { width: sideways ? height : width, height: sideways ? width : height }
  // Room for the banknote: the view, less the margin all round, and the bar below and Hide UI above while they show
  const barRoom = ui ? Math.max(0, (barSize?.height ?? 44) + 2 * BAR_INSET - MARGIN) : 0
  const hideRoom = ui ? Math.max(0, (hideSize?.height ?? 40) + 2 * BAR_INSET - MARGIN) : 0
  const area = { width: Math.max(1, view.width - 2 * MARGIN), height: Math.max(1, view.height - 2 * MARGIN - barRoom - hideRoom) }
  const onSide = onItsSide(quarterOf(quarterTurns))
  const shownMm = note ? { width: onSide ? note.heightMm : note.widthMm, height: onSide ? note.widthMm : note.heightMm } : { width: 1, height: 1 }
  const scale = size === 'real' ? realPxPerMm(checked) : Math.min(area.width / shownMm.width, area.height / shownMm.height)
  // Bigger than the room, it moves only as far as its edges
  const room = { x: Math.max(0, (shownMm.width * scale - area.width) / 2), y: Math.max(0, (shownMm.height * scale - area.height) / 2) }
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
  /** A drag let go of: back to flat, or on the phone's own tilt, back to the phone's */
  const letGo = (press: Extract<Gesture, { kind: 'press' }>) => {
    if (!press.moved) return
    if (press.hand) setTilt({ nudge: 0, nudgeX: 0 })
    else if (useTilt.getState().source !== 'device') setTilt({ target: 0, targetX: 0 })
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
            letGo(g)
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
        const press: Gesture = { kind: 'press', id: e.pointerId, touch, x: e.clientX, y: e.clientY, start: hand ? s.nudge : s.target,
          startSide: hand ? s.nudgeX : s.targetX, moved: false, held: false, hand }
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
        // own tilt, in the hand. A drag begun before motion came leaves the phone's tilt alone
        const along = unturn(dx, dy, turned)
        const y = clamp(g.start - along.y * DRAG_DEG_PER_PX, -TILT_LIMIT, TILT_LIMIT)
        const x = clamp(g.startSide + along.x * DRAG_DEG_PER_PX, -TILT_LIMIT, TILT_LIMIT)
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
          letGo(g)
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
          transform: upright ? `rotate(${upright === 3 ? -90 : upright * 90}deg)` : undefined, transitionDuration: `${ROTATE_SECONDS}s`,
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

        {/* One line, on a phone too (Keller, 11 November: "it can be just one line"): the picker gives up width, its name
            cut short, before anything else does, and only a screen under 360 px wraps it. Hidden with Hide UI, not taken
            away, so it is measured for the room it leaves */}
        {note && (
          <div ref={bar} data-demo-bar="" className={cn('absolute inset-x-3 flex justify-center', !ui && 'invisible')} style={{ bottom: BAR_INSET }}>
            <Panel className="flex max-w-full items-center justify-center gap-1.5 p-1.5 max-[359px]:flex-wrap pointer-coarse:gap-1">
              <Select value={note.id} items={notes.map((n) => ({ value: n.id, label: n.name }))} onValueChange={(id) => { if (id) onPick(id) }}>
                <SelectTrigger aria-label="Banknote" size="sm" className="w-40 min-w-0 pointer-coarse:h-8 *:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="top" alignItemWithTrigger={false} finalFocus={backToDemo}>
                  {notes.map((n) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {/* One button that turns it over, as F does, not Front | Back (Keller, 11 November) */}
              <Button variant="ghost" size="sm" className="pointer-coarse:h-8" title="Turn it over (F)" onClick={() => turnOver()}>
                <FlipHorizontal2 />
                Flip
              </Button>
              <div className={cn('w-36 shrink-0', TOUCH_ROW)}>
                <Segmented value={size} options={SIZES} onChange={pickSize} />
              </div>
              <LookMenu finalFocus={backToDemo} motion={motion} onRecentre={recentre}
                onCheckSize={size === 'real' ? () => setChecking(true) : undefined} />
              {phoneLink && <PhoneLink link={phoneLink} finalFocus={backToDemo} />}
              {onClose && (
                <IconButton className={TOUCH} label="Close Demo (Esc)" onClick={onClose}>
                  <X />
                </IconButton>
              )}
            </Panel>
          </div>
        )}

        {checking && <CardCheck quarter={upright} onDone={(px) => { setRealPxPerMm(px); setChecking(false) }} onCancel={() => setChecking(false)} />}
      </div>
      {!note && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">This project has no banknotes yet</p>}
    </div>
  )
}

/**
 * ⋯, all that rarely changes, so the bar stays one line (Keller, 11 November). On a phone first Recentre while it tilts
 * (since 13 November it makes how the phone is held then the neutral, moving the dial: "just one value"),
 * or in words once motion was refused (a page can't ask again until Safari is quit and reopened), and no switch for its
 * tilt, always on (Keller, 12 November); with it the neutral's dial (Keller, 13 November), how far from lying flat the
 * phone is looked at square on as Demo opens ("a dial ... making the default 90 degrees");
 * then the lamp, held to the light until switched off again, and Realistic, the
 * tilt card's two toggles, Realistic on until switched off and Demo opening with the lamp off ("the default should just
 * be with realistic mode on and lamp off. And this can live in a 3-dotted menu"); and with Real size picked, its check
 * against a bank card. Toggles are ticked while on.
 */
function LookMenu({ finalFocus, motion, onRecentre, onCheckSize }: {
  finalFocus: () => boolean
  motion: Motion
  onRecentre: () => void
  /** Real size's check, while Real size is picked */
  onCheckSize?: () => void
}) {
  const backlit = useTilt((s) => s.backlit)
  const realistic = useRealistic((s) => s.on)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" className={TOUCH} />} />}>
          <Ellipsis />
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" className="w-auto" finalFocus={finalFocus}>
        {(motion === 'on' || motion === 'denied') && (
          <>
            {motion === 'on' ? (
              <>
                <DropdownMenuItem onClick={onRecentre}>
                  <LocateFixed />
                  Recentre
                </DropdownMenuItem>
                <NeutralDial />
              </>
            ) : (
              <DropdownMenuItem disabled>
                <Rotate3d />
                Motion not allowed
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuCheckboxItem checked={backlit} onCheckedChange={(on) => setTilt({ backlit: on })}>
          <Lamp />
          Hold up to the light
          <DropdownMenuShortcut className="pl-4 pointer-coarse:hidden">L</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={realistic} onCheckedChange={setRealistic}>
          <Sparkles />
          Realistic
        </DropdownMenuCheckboxItem>
        {onCheckSize && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCheckSize}>
              <Ruler />
              Check real size
            </DropdownMenuItem>
          </>
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
