import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { type ArcHandle, type MmPoint, canRemove, curvePoints, mmSpot, spotMm, withBend, withLineMoved, withSpot, withoutSpot } from '../lib/arcEnCiel'
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
