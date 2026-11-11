import { EyeOff, Lamp, LocateFixed, Minus, Plus, Rotate3d, Ruler, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { IconButton, Panel, Segmented } from '../components/controls'
import { NoteView } from '../components/NoteView'
import type { Side } from '../lib/back'
import { TILT_LIMIT, clamp, perspectiveFor } from '../lib/frames'
import { CARD_MM, CARD_RADIUS_MM, isChecked, realPxPerMm, setRealPxPerMm, useRealSize } from '../lib/realSize'
import { setRealistic, useRealistic } from '../lib/realistic'
import { type Quarter, ROTATE_SECONDS, onItsSide, quarterOf, unturn } from '../lib/rotate'
import type { Project } from '../lib/types'
import { pressLight, releaseLight, rotateNotes, setTilt, turnOver, useTilt } from '../tilt/tilt'
import { type Motion, useDeviceTilt, useWakeLock } from '../tilt/useDeviceTilt'
import { useElementSize } from '../editor/useElementSize'
import { PhoneLink } from './PhoneLink'
import { useBlackPage } from './useBlackPage'

/** Fit leaves this much black round the banknote, px */
const MARGIN = 16
/** The bar's distance from the bottom, and the banknote's from the bar while it shows, px */
const BAR_INSET = 12
/** A swipe this long, px, steps to the next banknote, while the phone's motion tilts it */
const SWIPE_PX = 60
/** Pressed this long without moving, ms, a touch holds the banknote to the light until it lifts */
const HOLD_MS = 350
/** Two taps this close, in ms and px, bring the hidden UI back */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
/** Px a press may wander before it counts as a drag: a mouse's, a finger's */
const SLOP = { mouse: 3, touch: 10 }
/** The pointer hides this long, ms, after it last moved, while the UI is hidden */
const IDLE_MS = 1500
/** About 160 px of drag tilts the banknote 30°, as on the canvas */
const DRAG_DEG_PER_PX = 30 / 160

type Size = 'fit' | 'real'
const SIZES: { value: Size; label: string }[] = [{ value: 'fit', label: 'Fit' }, { value: 'real', label: 'Real size' }]
const SIDES: { value: Side; label: string }[] = [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]
/** Larger on a touch screen, for a finger */
const TOUCH = 'pointer-coarse:size-9'
const TOUCH_ROW = 'pointer-coarse:[&_button]:h-8'
/** What a key goes to instead of Demo: a field, or a popup open over it (the picker, the phone's QR code) */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]'

type Gesture =
  /** One finger or the mouse: a drag tilts (with motion on, a finger's swipe steps through the banknotes instead) */
  | { kind: 'press'; id: number; touch: boolean; x: number; y: number; start: number; startSide: number; moved: boolean; held: boolean; swipe: boolean }
  /** Two fingers move the banknote about, at real size bigger than the screen */
  | { kind: 'pan'; x: number; y: number; from: { x: number; y: number } }

/**
 * Demo (Keller, 10 November: "a dedicated demo mode ... like figma's prototype mode"): one banknote of the project on
 * black, as it would be held, with one bar of controls. The laptop opens it over the editor (`Editor`), where dragging tilts
 * it as on the canvas; a phone opens it by link (`DemoPage`), where the phone's own tilt is the banknote's, 1:1, the
 * banknote lying flat on the screen while only its security features change (`useDeviceTilt`). Fit fills the screen with a
 * 16 px margin, Real size shows it as big as it prints (`src/lib/realSize.ts`), and Hide UI leaves only the banknote; ← and
 * → or a swipe step through the banknotes, F turns them over, L or pressing and holding holds them to the light, H hides
 * and brings back the UI, as does a double-click or double-tap. Left out on purpose: playback, the timeline, panels,
 * labels, the tilt pad and hint text. Its controls are the canvas's own, in the app's dark colours, so they sit quietly
 * on black (the whole page turns dark while it shows, so the picker's list and tooltips do too).
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
  const [size, setSize] = useState<Size>('fit')
  const [ui, setUi] = useState(true)
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
  // A phone's own tilt is the banknote's; drawn flat meanwhile, as the phone is what turns
  const { motion, upright, allow, recentre } = useDeviceTilt(true, quarterTurns)
  const flat = motion === 'on'
  useWakeLock(true)

  useBlackPage()

  // The banknote turns about its own middle on the view, and the view, for a phone held sideways with rotation locked, a
  // quarter the way round that is upright in the hand; a drag, a swipe and the tilt go by the banknote's own axes
  const turned = quarterOf(quarterTurns + upright)
  const sideways = onItsSide(upright)
  const width = screen?.width ?? 0
  const height = screen?.height ?? 0
  const view = { width: sideways ? height : width, height: sideways ? width : height }
  // Room for the banknote: the view, less the margin all round and the bar while it shows
  const barRoom = ui ? (barSize?.height ?? 44) + 2 * BAR_INSET - MARGIN : 0
  const area = { width: Math.max(1, view.width - 2 * MARGIN), height: Math.max(1, view.height - 2 * MARGIN - Math.max(0, barRoom)) }
  const onSide = onItsSide(quarterOf(quarterTurns))
  const shownMm = note ? { width: onSide ? note.heightMm : note.widthMm, height: onSide ? note.widthMm : note.heightMm } : { width: 1, height: 1 }
  const scale = size === 'real' ? realPxPerMm(checked) : Math.min(area.width / shownMm.width, area.height / shownMm.height)
  // Bigger than the room, it moves only as far as its edges
  const room = { x: Math.max(0, (shownMm.width * scale - area.width) / 2), y: Math.max(0, (shownMm.height * scale - area.height) / 2) }
  const at = { x: clamp(pan.x, -room.x, room.x), y: clamp(pan.y, -room.y, room.y) }
  const middle = { x: view.width / 2 + at.x, y: MARGIN + area.height / 2 + at.y }
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
    // The picker's list stays in the page, hidden, once the picker has had the keyboard (Base UI): only one showing counts
    const popupOpen = () => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')]
      .some((element) => element !== root.current && !element.closest('[hidden]'))
    const onDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || checking) return
      const element = event.target instanceof Element ? event.target : null
      if (element?.closest(TYPING) || popupOpen()) return
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
      else if (key === 'h') setUi((shown) => !shown)
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
  // The picker or the phone's QR code closed, the keys come back to Demo itself: Base UI would give them to the first control
  // in the bar, Demo taking focus but not Tab, and the picker takes a letter as a banknote's name
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
      if (!(event.target instanceof Node) || !element.contains(event.target) || (event.target as Element).closest?.('[data-demo-bar]')) return
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
  const endHold = (press: Extract<Gesture, { kind: 'press' }>) => {
    clearTimeout(holdTimer.current)
    if (press.held) releaseLight(performance.now(), false)
    press.held = false
  }
  const middleOf = () => {
    const [a, b] = [...pointers.current.values()]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  /** On the view, not over its bar or the card check, nor anything opened from them */
  const onStage = (target: EventTarget) =>
    target instanceof Element && !!root.current?.contains(target) && !target.closest('[data-demo-bar], [data-card-check]')

  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label="Demo" data-demo="" tabIndex={-1}
      className={cn('fixed inset-0 z-40 touch-none overflow-hidden bg-black text-foreground outline-none select-none', !ui && idle && 'cursor-none')}
      onPointerDown={(e) => {
        if (!onStage(e.target)) return
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const touch = e.pointerType !== 'mouse'
        if (pointers.current.size === 2) {
          // A second finger: two fingers move the banknote about, whatever the first had started
          const g = gesture.current
          if (g?.kind === 'press') {
            endHold(g)
            if (g.moved && !g.swipe) setTilt({ target: 0, targetX: 0 })
          }
          gesture.current = { kind: 'pan', ...middleOf(), from: at }
          return
        }
        if (pointers.current.size > 2) return
        if (!touch && e.button !== 0) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        // A second tap soon after the first, near it: the UI back
        const tap = lastTap.current
        if (touch && tap && e.timeStamp - tap.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < DOUBLE_TAP_PX) {
          lastTap.current = undefined
          setUi(true)
          gesture.current = null
          return
        }
        const s = useTilt.getState()
        const press: Gesture = { kind: 'press', id: e.pointerId, touch, x: e.clientX, y: e.clientY, start: s.target, startSide: s.targetX,
          moved: false, held: false, swipe: flat }
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
        if (g.swipe) return
        // Tilts the way the pointer goes on the banknote as it shows, turned or not, springing back on release
        const along = unturn(dx, dy, turned)
        setTilt({
          source: 'drag',
          target: clamp(g.start - along.y * DRAG_DEG_PER_PX, -TILT_LIMIT, TILT_LIMIT),
          targetX: clamp(g.startSide + along.x * DRAG_DEG_PER_PX, -TILT_LIMIT, TILT_LIMIT),
        })
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
        if (g.moved && !g.swipe) setTilt({ target: 0, targetX: 0 })
        if (g.swipe && g.moved && !held) {
          // Along the view as it shows in the hand
          const along = unturn(e.clientX - g.x, e.clientY - g.y, upright)
          if (Math.abs(along.x) > SWIPE_PX && Math.abs(along.x) > 1.5 * Math.abs(along.y)) step(along.x < 0 ? 1 : -1)
        }
        if (g.touch && !g.moved && !held) lastTap.current = { at: e.timeStamp, x: e.clientX, y: e.clientY }
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId)
        const g = gesture.current
        if (g?.kind === 'press' && g.id === e.pointerId) {
          endHold(g)
          if (g.moved && !g.swipe) setTilt({ target: 0, targetX: 0 })
          gesture.current = null
        } else if (g?.kind === 'pan' && pointers.current.size === 0) gesture.current = null
      }}
      onDoubleClick={(e) => {
        if (onStage(e.target)) setUi(true)
      }}
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

        {/* Hidden with Hide UI, not taken away, so it is measured for the room it leaves */}
        {note && (
          <div ref={bar} data-demo-bar="" className={cn('absolute inset-x-3 flex justify-center', !ui && 'invisible')} style={{ bottom: BAR_INSET }}>
            <Panel className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 p-1.5">
              <div className="flex items-center gap-1.5">
                <Select value={note.id} items={notes.map((n) => ({ value: n.id, label: n.name }))} onValueChange={(id) => { if (id) onPick(id) }}>
                  <SelectTrigger aria-label="Banknote" size="sm" className="w-40 pointer-coarse:h-8"><SelectValue /></SelectTrigger>
                  <SelectContent side="top" alignItemWithTrigger={false} finalFocus={backToDemo}>
                    {notes.map((n) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <SideRow />
              </div>
              <div className="flex items-center gap-1">
                <LightToggles />
                <div className={cn('w-36', TOUCH_ROW)}>
                  <Segmented value={size} options={SIZES} onChange={pickSize} />
                </div>
                {size === 'real' && (
                  <IconButton className={TOUCH} label="Check real size against a bank card" onClick={() => setChecking(true)}>
                    <Ruler />
                  </IconButton>
                )}
                <MotionControl motion={motion} onAllow={allow} onRecentre={recentre} />
                <IconButton className={TOUCH} label="Hide UI (H)" onClick={() => setUi(false)}>
                  <EyeOff />
                </IconButton>
                {phoneLink && <PhoneLink link={phoneLink} finalFocus={backToDemo} />}
                {onClose && (
                  <IconButton className={TOUCH} label="Close Demo (Esc)" onClick={onClose}>
                    <X />
                  </IconButton>
                )}
              </div>
            </Panel>
          </div>
        )}

        {checking && <CardCheck quarter={upright} onDone={(px) => { setRealPxPerMm(px); setChecking(false) }} onCancel={() => setChecking(false)} />}
      </div>
      {!note && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">This project has no banknotes yet</p>}
    </div>
  )
}

/** Front | Back, turning every banknote over in 3D as F does */
function SideRow() {
  const side: Side = useTilt((s) => (s.flipped ? 'back' : 'front'))
  return (
    <div className={cn('w-32', TOUCH_ROW)} title="Turn it over (F)">
      <Segmented value={side} options={SIDES} onChange={(next) => turnOver(next === 'back')} />
    </div>
  )
}

/** The lamp, held to the light until pressed again, and Realistic, as beside the tilt card on the canvas */
function LightToggles() {
  const backlit = useTilt((s) => s.backlit)
  const realistic = useRealistic((s) => s.on)
  return (
    <>
      <BarToggle label="Hold up to the light (L)" pressed={backlit} onChange={(on) => setTilt({ backlit: on })}><Lamp /></BarToggle>
      <BarToggle label="Realistic" pressed={realistic} onChange={setRealistic}><Sparkles /></BarToggle>
    </>
  )
}

function BarToggle({ label, pressed, onChange, children }: { label: string; pressed: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Toggle aria-label={label} size="sm" pressed={pressed} onPressedChange={onChange}
        className={cn('size-7 min-w-7 p-0 aria-pressed:bg-primary aria-pressed:text-primary-foreground', TOUCH)} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The phone's motion: Recentre once it tilts the banknote, the pink Tilt button while iPhone waits on a tap to allow it,
 * and in words once it was refused (a page can't ask again until Safari is quit and reopened); nothing on a laptop
 */
function MotionControl({ motion, onAllow, onRecentre }: { motion: Motion; onAllow: () => void; onRecentre: () => void }) {
  if (motion === 'on') {
    return (
      <IconButton className={TOUCH} label="Recentre: flat is how you hold it now" onClick={onRecentre}>
        <LocateFixed />
      </IconButton>
    )
  }
  if (motion === 'ask') {
    return (
      <Button size="sm" className="pointer-coarse:h-9" onClick={onAllow}>
        <Rotate3d />
        Tilt
      </Button>
    )
  }
  if (motion === 'denied') return <span className="px-1.5 text-xs text-muted-foreground">Motion not allowed</span>
  return null
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
