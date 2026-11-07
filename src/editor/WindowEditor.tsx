import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LengthField } from '../components/controls'
import { clamp } from '../lib/frames'
import { type Quarter, onItsSide, unturnedPoint } from '../lib/rotate'
import { sectionBounds, snapWindow, threadLength, WINDOW_STEP } from '../lib/thread'
import type { Note, ThreadWindow } from '../lib/types'
import { Measure } from './Measure'

type Gesture = {
  mode: 'draw' | 'move' | 'start' | 'end'
  id: string
  anchor: number
  min: number
  max: number
  original: ThreadWindow[]
  section?: ThreadWindow
}

/** Px per mm under which the measurements hide: zoomed out that far, they can't be read against their windows */
const MEASURE_MIN_SCALE = 2
/** A measurement's card, px: its small label over a small field `FIELD` wide, as beside the thread in Thread Studio */
const CARD = { width: 92, height: 57 }
const FIELD = 'w-[80px]'
/** Room kept between two cards along the thread, px */
const CARD_GAP = 4
/** Room a card on its window's tile keeps from the window's ends (and their handles) and sides, px */
const TILE_ROOM = { along: 16, across: 8 }
/** Lengths typed in any unit are kept to a millionth of a mm, as the fields keep them, without float dust */
const exact = (mm: number) => Math.round(mm * 1e6) / 1e6

/**
 * Canvas-only editing surface; it intercepts gestures before the banknote can tilt or pan. On a rotated banknote
 * (`quarter`, quarter turns clockwise) it turns with it, measures and all, and reads the pointer along the thread as it
 * lies there.
 */
export function WindowEditor({ note, scale, quarter = 0, selectedId, onSelect, onChange }: {
  note: Note
  scale: number
  quarter?: Quarter
  selectedId?: string
  onSelect: (id: string | undefined) => void
  onChange: (sections: ThreadWindow[]) => void
}) {
  const gesture = useRef<Gesture | null>(null)
  const horizontal = note.thread.direction === 'horizontal'
  const length = threadLength(note)
  const sections = note.thread.windows.sections
  // In order along the thread, as they are numbered (the Checks' Window 1, Window 2…)
  const windows = sections.toSorted((a, b) => a.startMm - b.startMm)
  // On a banknote rotated onto its side, the thread runs the other way on screen
  const resizeCursor = horizontal !== onItsSide(quarter) ? 'cursor-ew-resize' : 'cursor-ns-resize'
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const size = horizontal ? { width: length * scale, height: note.thread.widthMm * scale } : { width: note.thread.widthMm * scale, height: length * scale }
    const at = unturnedPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), quarter, size)
    return clamp(snapWindow((horizontal ? at.x : at.y) / scale), 0, length)
  }
  const finish = (event: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    if (!gesture.current) return
    event.stopPropagation()
    if (cancel) onChange(gesture.current.original)
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label="Edit thread windows"
      data-window-editor
      className="absolute touch-none cursor-crosshair outline-1 outline-fuchsia-500/50"
      style={horizontal
        ? { left: 0, top: (note.thread.positionMm - note.thread.widthMm / 2) * scale, width: length * scale, height: note.thread.widthMm * scale }
        : { top: 0, left: (note.thread.positionMm - note.thread.widthMm / 2) * scale, height: length * scale, width: note.thread.widthMm * scale }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        const anchor = point(event)
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-section-id]')
        const section = sections.find((s) => s.id === target?.dataset.sectionId)
        if (section) {
          const bounds = sectionBounds(sections, section.id, length)
          gesture.current = { mode: (target?.dataset.edge as 'start' | 'end' | undefined) ?? 'move', id: section.id, anchor, original: sections, section, ...bounds }
          onSelect(section.id)
        } else {
          const min = Math.max(0, ...sections.filter((s) => s.endMm <= anchor).map((s) => s.endMm))
          const max = Math.min(length, ...sections.filter((s) => s.startMm >= anchor).map((s) => s.startMm))
          const id = crypto.randomUUID()
          gesture.current = { mode: 'draw', id, anchor, min, max, original: sections }
          onSelect(undefined)
        }
      }}
      onPointerMove={(event) => {
        const g = gesture.current
        if (!g) return
        event.stopPropagation()
        const at = point(event)
        let section: ThreadWindow
        if (g.mode === 'draw') {
          const other = clamp(at, g.min, g.max)
          if (Math.abs(other - g.anchor) < WINDOW_STEP) {
            onChange(g.original)
            onSelect(undefined)
            return
          }
          section = { id: g.id, startMm: Math.min(g.anchor, other), endMm: Math.max(g.anchor, other) }
          onChange([...g.original, section].sort((a, b) => a.startMm - b.startMm))
          onSelect(g.id)
          return
        }
        const original = g.section!
        const minimum = Math.min(WINDOW_STEP, original.endMm - original.startMm)
        if (g.mode === 'move') {
          const delta = clamp(at - g.anchor, g.min - original.startMm, g.max - original.endMm)
          section = { ...original, startMm: original.startMm + delta, endMm: original.endMm + delta }
        } else if (g.mode === 'start') {
          section = { ...original, startMm: clamp(at, g.min, original.endMm - minimum) }
        } else {
          section = { ...original, endMm: clamp(at, original.startMm + minimum, g.max) }
        }
        onChange(g.original.map((s) => s.id === g.id ? section : s))
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
    >
      {windows.map((section, i) => {
        const selected = section.id === selectedId
        return (
          <div key={section.id} className="absolute" style={horizontal
            ? { left: section.startMm * scale, width: (section.endMm - section.startMm) * scale, top: 0, bottom: 0 }
            : { top: section.startMm * scale, height: (section.endMm - section.startMm) * scale, left: 0, right: 0 }}>
            <Button variant="ghost" data-section-id={section.id} aria-label={`Window ${i + 1}`} aria-pressed={selected}
              className={cn('absolute inset-0 h-full w-full cursor-move rounded-none border border-fuchsia-500 p-0 hover:bg-fuchsia-500/10 active:translate-y-0', selected && 'ring-2 ring-fuchsia-500/40')}
              onClick={() => onSelect(section.id)} />
            {selected && (['start', 'end'] as const).map((edge) => (
              <Button key={edge} variant="outline" size="icon-xs" data-section-id={section.id} data-edge={edge}
                aria-label={`${edge === 'start' ? 'Start' : 'End'} of window ${i + 1}`}
                className={cn('absolute z-10 rounded-sm border-fuchsia-500 p-0 active:translate-y-0', resizeCursor)}
                style={horizontal
                  ? { width: 8, height: 24, top: '50%', [edge === 'start' ? 'left' : 'right']: 0, transform: `translate(${edge === 'start' ? '-50%' : '50%'}, -50%)` }
                  : { height: 8, width: 24, left: '50%', [edge === 'start' ? 'top' : 'bottom']: 0, transform: `translate(-50%, ${edge === 'start' ? '-50%' : '50%'})` }} />
            ))}
          </div>
        )
      })}
      <WindowMeasures note={note} windows={windows} scale={scale} selectedId={selectedId} onSelect={onSelect}
        onMove={(id, startMm, endMm) => onChange(sections.map((s) => (s.id === id ? { ...s, startMm: exact(startMm), endMm: exact(endMm) } : s)))} />
    </div>
  )
}

/**
 * The windows' measurements while they are edited, each a small field to scrub or type, as beside the thread in Thread
 * Studio (Keller): every window's length, on its tile where it fits and else beside it, and for the picked window the
 * distance to what lies either side of it along the thread, the next window (a gap) or the banknote's edge. Typing a
 * length moves the window's end; typing a distance moves the window, its length kept. A length with no room from its
 * neighbours' hides, though never the picked window's, and all of them hide once zoomed too far out to read.
 */
function WindowMeasures({ note, windows, scale, selectedId, onSelect, onMove }: {
  note: Note
  /** In order along the thread */
  windows: ThreadWindow[]
  scale: number
  selectedId?: string
  onSelect: (id: string) => void
  /** Sets where a window starts and ends, mm */
  onMove: (id: string, startMm: number, endMm: number) => void
}) {
  if (scale < MEASURE_MIN_SCALE) return null
  const horizontal = note.thread.direction === 'horizontal'
  const length = threadLength(note)
  const thickness = note.thread.widthMm * scale
  // Lengths along one side of the thread, the picked window's distances along the other
  const lengthSide = horizontal ? 'top' : 'left'
  const distanceSide = horizontal ? 'bottom' : 'right'
  // Along the thread a card takes its width on a horizontal thread, its height on an upright one
  const along = horizontal ? CARD.width : CARD.height
  const across = horizontal ? CARD.height : CARD.width
  const onTile = (w: ThreadWindow) => (w.endMm - w.startMm) * scale >= along + TILE_ROOM.along && thickness >= across + TILE_ROOM.across
  const middle = (w: ThreadWindow) => ((w.startMm + w.endMm) / 2) * scale
  // Cards beside the thread run along it in the windows' order, so one clashes with another only if it does with the next
  const beside = windows.filter((w) => !onTile(w))
  const crowded = (w: ThreadWindow) => {
    const i = beside.indexOf(w)
    return [beside[i - 1], beside[i + 1]].some((other) => other && Math.abs(middle(other) - middle(w)) < along + CARD_GAP)
  }
  const at = windows.findIndex((w) => w.id === selectedId)
  const picked = windows[at]

  return (
    <>
      {windows.map((w, i) => (w === picked || onTile(w) || !crowded(w)) && (
        <Measure key={w.id} side={lengthSide} from={w.startMm * scale} to={w.endMm * scale} inside={onTile(w)}
          label={`Window ${i + 1}`} onPress={() => onSelect(w.id)}>
          <LengthField size="sm" className={FIELD} label="L" title={`Length of window ${i + 1}`}
            value={w.endMm - w.startMm} min={Math.min(WINDOW_STEP, w.endMm - w.startMm)} max={(windows[i + 1]?.startMm ?? length) - w.startMm}
            step={WINDOW_STEP} onChange={(mm) => onMove(w.id, w.startMm, w.startMm + mm)} />
        </Measure>
      ))}
      {picked && <Distances picked={picked} index={at} before={windows[at - 1]} after={windows[at + 1]} length={length}
        horizontal={horizontal} side={distanceSide} scale={scale} along={along} onMove={onMove} />}
    </>
  )
}

/**
 * The picked window's distance to what lies before and after it along the thread: the previous and next windows' ends (a
 * Gap), or where there is none, the banknote's edges (From top and From bottom, or From left and From right). Each card
 * sits in the middle of what it measures where it fits, else flush against the window
 */
function Distances({ picked: w, index, before, after, length, horizontal, side, scale, along, onMove }: {
  picked: ThreadWindow
  index: number
  before?: ThreadWindow
  after?: ThreadWindow
  length: number
  horizontal: boolean
  side: 'right' | 'bottom'
  scale: number
  along: number
  onMove: (id: string, startMm: number, endMm: number) => void
}) {
  const from = before?.endMm ?? 0
  const to = after?.startMm ?? length
  const size = w.endMm - w.startMm
  // How far the window can be from either side, its length kept
  const room = to - from - size
  const moveTo = (startMm: number) => onMove(w.id, startMm, startMm + size)
  const n = index + 1
  const edge = horizontal ? { before: 'left', after: 'right' } : { before: 'top', after: 'bottom' }
  return (
    <>
      <Measure key="before" side={side} from={from * scale} to={w.startMm * scale} align={(w.startMm - from) * scale >= along ? 'center' : 'end'}
        label={before ? 'Gap' : `From ${edge.before}`}>
        <LengthField size="sm" className={FIELD} label={before ? 'G' : horizontal ? 'X' : 'Y'}
          title={before ? `Gap between windows ${n - 1} and ${n}` : `Window ${n} from the ${edge.before} of the banknote`}
          value={w.startMm - from} min={0} max={room} step={WINDOW_STEP} onChange={(mm) => moveTo(from + mm)} />
      </Measure>
      <Measure key="after" side={side} from={w.endMm * scale} to={to * scale} align={(to - w.endMm) * scale >= along ? 'center' : 'start'}
        label={after ? 'Gap' : `From ${edge.after}`}>
        <LengthField size="sm" className={FIELD} label={after ? 'G' : horizontal ? 'X' : 'Y'}
          title={after ? `Gap between windows ${n} and ${n + 1}` : `Window ${n} from the ${edge.after} of the banknote`}
          value={to - w.endMm} min={0} max={room} step={WINDOW_STEP} onChange={(mm) => moveTo(to - mm - size)} />
      </Measure>
    </>
  )
}
