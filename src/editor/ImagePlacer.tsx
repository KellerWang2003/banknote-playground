import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { IMAGE_STEP, dragImageHandle, snapImage as snap, type UprightBox } from '../lib/artwork'
import type { Corner, Handle, Side } from '../lib/placed'
import { SIDE_ZONE_PX } from './PlacingBox'

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']
const CORNER_NAMES: Record<Corner, string> = { nw: 'top-left', ne: 'top-right', sw: 'bottom-left', se: 'bottom-right' }
const SIDES: Side[] = ['n', 'e', 's', 'w']
const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

/** A point on the thread, upright mm from the strip's top-left corner */
export type ThreadPoint = { x: number; y: number }

/**
 * The current frame's image on the magnified thread, handled directly: a drag moves it, a click picks it, and once
 * picked it shows the watermark's box, whose corners and sides (anywhere along its border) resize it with its
 * proportions kept and whose arrow keys nudge it, in 0.1 mm steps. Every copy follows, one repeat apart. `box` is the
 * image in the repeat being edited, upright, mm from the strip's corner; `others` are the shifts to its copies either
 * side, outlined while it is picked.
 */
export function ImagePlacer({ box, others, aspect, scale, picked, onPick, pointAt, onChange, onDone }: {
  box: UprightBox
  /** mm right and down to each other copy shown */
  others: { x: number; y: number }[]
  aspect: number
  scale: number
  picked: boolean
  onPick: () => void
  /** Where a pointer is on the thread, traced back onto it when it is turned */
  pointAt: (e: { clientX: number; clientY: number }) => ThreadPoint
  onChange: (box: UprightBox) => void
  /** A move or resize has ended */
  onDone: () => void
}) {
  const gesture = useRef<{ mode: Handle | 'move'; start: ThreadPoint; original: UprightBox } | null>(null)
  const finish = () => {
    if (!gesture.current) return
    gesture.current = null
    onDone()
  }
  const at = (b: UprightBox) => ({ left: b.x * scale, top: b.y * scale, width: b.width * scale, height: b.height * scale })

  return (
    <>
      {picked && others.map((shift, k) => (
        <div key={k} aria-hidden="true" data-image-copy="" className="pointer-events-none absolute border border-dashed border-fuchsia-500/70"
          style={at({ ...box, x: box.x + shift.x, y: box.y + shift.y })} />
      ))}
      <div
        role="group"
        tabIndex={0}
        aria-label="Place the image"
        aria-pressed={picked}
        data-image-placer=""
        className={cn(
          'absolute touch-none cursor-move border outline-none',
          picked ? 'border-fuchsia-500 ring-2 ring-fuchsia-500/40 focus-visible:ring-fuchsia-500/70' : 'border-transparent hover:border-fuchsia-500/60',
        )}
        style={at(box)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
          onPick()
          const grip = (event.target as HTMLElement).closest<HTMLElement>('[data-corner], [data-side]')
          const handle = (grip?.dataset.corner ?? grip?.dataset.side) as Handle | undefined
          gesture.current = { mode: handle ?? 'move', start: pointAt(event), original: box }
        }}
        onPointerMove={(event) => {
          const g = gesture.current
          if (!g) return
          event.stopPropagation()
          // A release that never reached us: stop following the pointer
          if (event.buttons === 0) return finish()
          const p = pointAt(event)
          const dx = p.x - g.start.x, dy = p.y - g.start.y
          const next = g.mode === 'move'
            ? { ...g.original, x: snap(g.original.x + dx), y: snap(g.original.y + dy) }
            : dragImageHandle(g.original, g.mode, dx, dy, aspect)
          if (next.x !== box.x || next.y !== box.y || next.width !== box.width) onChange(next)
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          finish()
        }}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          const by = NUDGE[event.key]
          if (!by || !picked) return
          event.preventDefault()
          event.stopPropagation()
          const step = event.shiftKey ? 10 * IMAGE_STEP : IMAGE_STEP
          onChange({ ...box, x: snap(box.x + by[0] * step), y: snap(box.y + by[1] * step) })
        }}
      >
        {picked && SIDES.map((side) => {
          // Along the whole side, over its border, as on the canvas's placing box: a press there resizes it from that side
          const level = side === 'n' || side === 's'
          const inside = Math.min(SIDE_ZONE_PX, ((level ? box.height : box.width) * scale) / 4)
          return (
            <span
              key={`side-${side}`}
              aria-hidden="true"
              data-side={side}
              className={cn('absolute', level ? 'cursor-ns-resize' : 'cursor-ew-resize')}
              style={{
                ...(level ? { left: 0, right: 0, height: SIDE_ZONE_PX + inside } : { top: 0, bottom: 0, width: SIDE_ZONE_PX + inside }),
                [{ n: 'top', e: 'right', s: 'bottom', w: 'left' }[side]]: -SIDE_ZONE_PX,
              }}
            />
          )
        })}
        {picked && CORNERS.map((corner) => (
          <Button
            key={corner}
            variant="outline"
            size="icon-xs"
            tabIndex={-1}
            data-corner={corner}
            aria-label={`Resize the image from its ${CORNER_NAMES[corner]} corner`}
            className={cn(
              'absolute z-10 size-2.5 min-w-0 rounded-sm border-fuchsia-500 p-0 active:translate-y-0',
              corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
            )}
            style={{
              [corner[0] === 'n' ? 'top' : 'bottom']: 0,
              [corner[1] === 'w' ? 'left' : 'right']: 0,
              transform: `translate(${corner[1] === 'w' ? '-50%' : '50%'}, ${corner[0] === 'n' ? '-50%' : '50%'})`,
            }}
          />
        ))}
      </div>
    </>
  )
}
