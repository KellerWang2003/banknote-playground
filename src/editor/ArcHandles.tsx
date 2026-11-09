import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { type ArcHandle, type MmPoint, canRemove, curvePoints, mmSpot, ridgeAngle, spotMm, withBend, withLineMoved, withSpot, withoutSpot } from '../lib/arcEnCiel'
import { PLACE_STEP } from '../lib/placed'
import { type Quarter, unturn, unturnedPoint } from '../lib/rotate'
import type { ArcEnCiel, BoxSpot } from '../lib/types'

/** Arrow keys nudge a picked dot one step (ten with Shift), as they nudge a placing box */
const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

/** A drag on a dot, from where it started, or on the line, which moves it whole once the pointer has gone 3 px */
type Gesture =
  | { kind: 'dot'; handle: ArcHandle; startX: number; startY: number; from: MmPoint }
  | { kind: 'line'; startX: number; startY: number; from: BoxSpot[]; moved: boolean }

/** A dot's place in px on the banknote */
const dotAt = (arc: ArcEnCiel, spot: BoxSpot, scale: number): MmPoint => {
  const [x, y] = spotMm(spot, arc)
  return [(arc.xMm + x) * scale, (arc.yMm + y) * scale]
}

/**
 * Canvas-only handles for where Arc-en-Ciel's bands start, over its placing box while it is placed (the plan of 8 November):
 * a fuchsia dot for each of Point's starts, or Line drawn in fuchsia with a dot at each end and a hollow one at each point
 * bending it. Drag a dot to move it, anywhere up to the box's own size off it, or the line to move it whole; double-click
 * the line to bend it there (a double-click in the box adds a point, through the placing box). Click a dot to pick it:
 * arrow keys nudge it, and Delete takes it out (one of several points, or a point bending Line; its ends stay) before the
 * editor's Delete can take out the layer. On a rotated banknote (`quarter`) the handles turn with it, and drags and arrow
 * keys still move them the way they point on screen.
 */
export function ArcHandles({ arc, scale, quarter = 0, onChange }: {
  arc: ArcEnCiel
  scale: number
  quarter?: Quarter
  onChange: (arc: ArcEnCiel) => void
}) {
  const kind: ArcHandle['kind'] = arc.flow === 'point' ? 'point' : 'line'
  const spots = kind === 'point' ? arc.points : arc.line
  const [chosen, setChosen] = useState<ArcHandle>()
  // Only while it is still one of the dots shown (undo can take it away, or the bands start elsewhere now)
  const picked = chosen && chosen.kind === kind && chosen.index < spots.length ? chosen : undefined
  const gesture = useRef<Gesture | null>(null)
  // The latest, for the listeners below
  const latest = useRef({ arc, onChange })
  useEffect(() => {
    latest.current = { arc, onChange }
  })

  useEffect(() => {
    if (!picked) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const element = event.target instanceof Element ? event.target : null
      if (element?.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return
      // The dot, never the layer, even where the dot has to stay
      event.preventDefault()
      const { arc: now, onChange: change } = latest.current
      if (!canRemove(now, picked)) return
      change(withoutSpot(now, picked))
      setChosen(undefined)
    }
    // A press anywhere but on a dot lets it go
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest('[data-arc-handle]'))) setChosen(undefined)
    }
    // Caught on the way down, before the editor's own Delete
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [picked])

  /** Follows a drag on a dot or the line, (dx, dy) px on screen from where it started */
  const follow = (g: Gesture, dx: number, dy: number) => {
    const along = unturn(dx, dy, quarter)
    if (g.kind === 'dot') onChange(withSpot(arc, g.handle, mmSpot([g.from[0] + along.x / scale, g.from[1] + along.y / scale], arc)))
    else onChange(withLineMoved(arc, g.from, along.x / scale, along.y / scale))
  }
  /** Ends a drag; a cancelled one puts back what it moved */
  const finish = (event: React.PointerEvent, cancel = false) => {
    const g = gesture.current
    if (!g) return
    event.stopPropagation()
    gesture.current = null
    if (cancel) follow(g, 0, 0)
  }
  const pointer = {
    onPointerMove: (event: React.PointerEvent) => {
      const g = gesture.current
      if (!g) return
      event.stopPropagation()
      // A release that never reached us: stop following the pointer
      if (event.buttons === 0) {
        gesture.current = null
        return
      }
      const dx = event.clientX - g.startX
      const dy = event.clientY - g.startY
      if (g.kind === 'line' && !g.moved) {
        if (Math.hypot(dx, dy) < 3) return
        g.moved = true
      }
      follow(g, dx, dy)
    },
    onPointerUp: (event: React.PointerEvent) => finish(event),
    onPointerCancel: (event: React.PointerEvent) => finish(event, true),
    onLostPointerCapture: () => { gesture.current = null },
  }

  const curve = kind === 'line' ? curvePoints(arc).points.map(([x, y]) => `${(arc.xMm + x) * scale},${(arc.yMm + y) * scale}`).join(' ') : ''

  return (
    <div data-placed="arcEnCiel" data-arc-handles="" className="pointer-events-none absolute inset-0">
      {kind === 'line' && (
        <svg aria-hidden="true" className="absolute top-0 left-0 overflow-visible" width={1} height={1}>
          <polyline points={curve} fill="none" stroke="white" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={curve} fill="none" className="stroke-fuchsia-500" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* Wider than it looks, to press */}
          <polyline data-arc-line="" points={curve} fill="none" stroke="transparent" strokeWidth={14} strokeLinejoin="round" strokeLinecap="round"
            className="cursor-move touch-none" style={{ pointerEvents: 'stroke' }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              // Not a press on the banknote, which would stop placing
              event.stopPropagation()
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              gesture.current = { kind: 'line', startX: event.clientX, startY: event.clientY, from: arc.line, moved: false }
            }}
            {...pointer}
            onDoubleClick={(event) => {
              // Where on the banknote, as it lies before it was turned: the handles cover it from its corner
              const banknote = event.currentTarget.closest('[data-arc-handles]')
              if (!banknote) return
              const at = unturnedPoint(event.clientX, event.clientY, banknote.getBoundingClientRect(), quarter)
              const { arc: bent, index } = withBend(arc, mmSpot([at.x / scale - arc.xMm, at.y / scale - arc.yMm], arc))
              if (index < 0) return
              onChange(bent)
              setChosen({ kind: 'line', index })
            }} />
        </svg>
      )}
      {spots.map((spot, index) => {
        const [left, top] = dotAt(arc, spot, scale)
        const handle: ArcHandle = { kind, index }
        // Points and Line's ends are solid; points bending Line are hollow
        const bend = kind === 'line' && index > 0 && index < spots.length - 1
        const isPicked = picked?.kind === kind && picked.index === index
        const name = kind === 'point' ? `point ${index + 1}` : index === 0 ? 'the line’s start' : index === spots.length - 1 ? 'the line’s end' : `bend ${index}`
        return (
          <button
            key={index}
            type="button"
            data-arc-handle={index}
            aria-label={`Move ${name}`}
            aria-pressed={isPicked}
            className={cn(
              'pointer-events-auto absolute z-20 size-3 -translate-x-1/2 -translate-y-1/2 touch-none cursor-grab rounded-full border-2 shadow-sm outline-none',
              bend ? 'border-fuchsia-500 bg-background' : 'border-background bg-fuchsia-500',
              isPicked && 'ring-2 ring-fuchsia-500/50 ring-offset-1',
            )}
            style={{ left, top }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
              event.currentTarget.setPointerCapture(event.pointerId)
              gesture.current = { kind: 'dot', handle, startX: event.clientX, startY: event.clientY, from: spotMm(spot, arc) }
              setChosen(handle)
            }}
            {...pointer}
            onKeyDown={(event) => {
              const by = NUDGE[event.key]
              if (!by) return
              event.preventDefault()
              event.stopPropagation()
              const step = (event.shiftKey ? 10 : 1) * PLACE_STEP * scale
              follow({ kind: 'dot', handle, startX: 0, startY: 0, from: spotMm(spot, arc) }, by[0] * step, by[1] * step)
            }}
          />
        )
      })}
    </div>
  )
}

/** Arrow keys turn the ridges a degree, fifteen with Shift, as does a drag on a knob with Shift held */
const TURN: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }
const TURN_SNAP = 15

/** The angle, degrees, of a point (dx, dy) px from the middle, on screen's y down: 0 to the right, 90 straight up */
const angleTo = (dx: number, dy: number) => (Math.atan2(-dy, dx) * 180) / Math.PI

/** A drag on a knob: the ridges' angle it started from, and how far round from it the pointer was then */
type Turn = { from: number; offset: number }

/**
 * Canvas-only handle for the ridges' angle (Keller, 9 November: an angle in place of Moves on's up/down or side to side),
 * over Arc-en-Ciel's placing box while it is placed, whatever its bands start from: a dashed line through the middle of
 * the box along the ridges, with a knob towards each end. Drag either knob round the middle to turn the ridges, in whole
 * degrees, or steps of 15° with Shift held; with a knob picked, arrow keys turn them a degree at a time (15° with Shift).
 * Ridges half a turn round are the same ridges, so the angle stays within ±90° (`ridgeAngle`) and the knob carries on
 * past upright. On a rotated banknote it turns with it and still follows the pointer on screen.
 */
export function RidgeDial({ arc, scale, quarter = 0, onTurn }: {
  arc: ArcEnCiel
  scale: number
  quarter?: Quarter
  onTurn: (angleDeg: number) => void
}) {
  const turn = useRef<Turn | null>(null)
  const width = arc.widthMm * scale
  const height = arc.heightMm * scale
  const middle = { x: arc.xMm * scale + width / 2, y: arc.yMm * scale + height / 2 }
  const a = (arc.angleDeg * Math.PI) / 180
  // Along the ridges on screen, y down
  const along = { x: Math.cos(a), y: -Math.sin(a) }
  // Edge to edge of the box, and the knobs inside it whatever the angle
  const reach = Math.min(along.x ? width / 2 / Math.abs(along.x) : Infinity, along.y ? height / 2 / Math.abs(along.y) : Infinity)
  const knob = 0.42 * Math.min(width, height)

  /** Where the pointer is round the middle, degrees */
  const pointerAngle = (event: React.PointerEvent<HTMLElement>) => {
    const banknote = event.currentTarget.closest('[data-ridge-dial]')
    if (!banknote) return undefined
    const at = unturnedPoint(event.clientX, event.clientY, banknote.getBoundingClientRect(), quarter)
    const dx = at.x - middle.x
    const dy = at.y - middle.y
    return Math.hypot(dx, dy) < 1 ? undefined : angleTo(dx, dy)
  }
  const turnTo = (deg: number, snap: number) => onTurn(ridgeAngle(Math.round(deg / snap) * snap))
  const finish = (event: React.PointerEvent, cancel = false) => {
    const t = turn.current
    if (!t) return
    event.stopPropagation()
    turn.current = null
    if (cancel) onTurn(t.from)
  }

  return (
    <div data-placed="arcEnCiel" data-ridge-dial="" className="pointer-events-none absolute inset-0">
      <svg aria-hidden="true" className="absolute top-0 left-0 overflow-visible" width={1} height={1}>
        {[{ stroke: 'white', strokeWidth: 3, opacity: 0.7 }, { className: 'stroke-fuchsia-500', strokeWidth: 1.25, strokeDasharray: '5 4' }].map((look, i) => (
          <line key={i} data-ridge-line={i ? '' : undefined} x1={middle.x - along.x * reach} y1={middle.y - along.y * reach}
            x2={middle.x + along.x * reach} y2={middle.y + along.y * reach} strokeLinecap="round" {...look} />
        ))}
      </svg>
      {[1, -1].map((end) => (
        <button
          key={end}
          type="button"
          data-ridge-knob={end > 0 ? 'right' : 'left'}
          aria-label="Turn the ridges"
          className="pointer-events-auto absolute z-20 h-3.5 w-2 touch-none cursor-grab rounded-full border-2 border-background bg-fuchsia-500 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/50"
          style={{
            left: middle.x + along.x * knob * end,
            top: middle.y + along.y * knob * end,
            // Across the line, as a slider's thumb sits across its track
            transform: `translate(-50%, -50%) rotate(${-arc.angleDeg}deg)`,
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            // Not a press on the box, which would move it
            event.stopPropagation()
            event.preventDefault()
            event.currentTarget.focus({ preventScroll: true })
            const at = pointerAngle(event)
            if (at === undefined) return
            event.currentTarget.setPointerCapture(event.pointerId)
            // From the knob pressed, as the far one points the other way
            turn.current = { from: arc.angleDeg, offset: at - (arc.angleDeg + (end > 0 ? 0 : 180)) }
          }}
          onPointerMove={(event) => {
            const t = turn.current
            if (!t) return
            event.stopPropagation()
            // A release that never reached us: stop following the pointer
            if (event.buttons === 0) {
              turn.current = null
              return
            }
            const at = pointerAngle(event)
            if (at !== undefined) turnTo(at - t.offset - (end > 0 ? 0 : 180), event.shiftKey ? TURN_SNAP : 1)
          }}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={() => { turn.current = null }}
          onKeyDown={(event) => {
            const by = TURN[event.key]
            if (!by) return
            event.preventDefault()
            event.stopPropagation()
            const step = event.shiftKey ? TURN_SNAP : 1
            // With Shift, on to the next step of 15° the way pressed
            const next = event.shiftKey ? (by > 0 ? Math.floor(arc.angleDeg / step) + 1 : Math.ceil(arc.angleDeg / step) - 1) * step : arc.angleDeg + by
            onTurn(ridgeAngle(next))
          }}
        />
      ))}
    </div>
  )
}
