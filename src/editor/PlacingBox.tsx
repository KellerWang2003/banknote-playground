import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { mirrored } from '../lib/back'
import type { Layer } from '../lib/extras'
import { LAYER_NAMES, type PlacedLayer } from '../lib/layers'
import { type Corner, type Handle, PLACE_STEP, type PlacedBox, type Side, boxTurn, dragBoxHandle, intoBox, moveBox, normalRotation, rotationOf } from '../lib/placed'
import { type Quarter, unturn } from '../lib/rotate'
import type { Note } from '../lib/types'

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']
const CORNER_NAMES: Record<Corner, string> = { nw: 'top-left', ne: 'top-right', sw: 'bottom-left', se: 'bottom-right' }
const SIDES: Side[] = ['n', 'e', 's', 'w']

type Gesture =
  | { mode: 'move' | Handle; startX: number; startY: number; original: PlacedBox }
  /** Turning it: where the pointer started round the box's middle on screen, degrees, and that middle */
  | { mode: 'rotate'; from: number; middle: { x: number; y: number }; original: PlacedBox }
/** Arrow keys nudge one step (ten with Shift) */
const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

/** The same corner or side seen from the banknote's back, where left and right swap */
const MIRRORED: Record<Handle, Handle> = { nw: 'ne', ne: 'nw', sw: 'se', se: 'sw', n: 'n', e: 'w', s: 's', w: 'e' }

/**
 * Which way each corner, or the middle of each side, lies from the middle of an upright box, degrees counterclockwise
 * from its right, as on a square
 */
const HANDLE_DEG: Record<Handle, number> = { e: 0, ne: 45, n: 90, nw: 135, w: 180, sw: 225, s: 270, se: 315 }
/** The resize cursor along a corner's diagonal, or straight out from a side, each 45° round from level */
const RESIZE_CURSORS = ['ew-resize', 'nesw-resize', 'ns-resize', 'nwse-resize']
const resizeCursor = (deg: number) => RESIZE_CURSORS[((Math.round(deg / 45) % 4) + 4) % 4]

/** px across the area just past each corner that turns the box, as in Figma */
export const ROTATE_ZONE_PX = 16
/**
 * px either way of each side's border that resize the box from that side, as Thread Studio's section edges do (and
 * Figma's); inside it, no more than a quarter of the box across, so a small one still has its middle to move it by
 */
export const SIDE_ZONE_PX = 5
/** A turn with Shift held goes in steps this big, as the ridges' dial does */
const ROTATE_SNAP = 15

/** Degrees round a point (dx, dy) px from the middle, on screen's y down: 0 to the right, 90 straight up */
const angleTo = (dx: number, dy: number) => (Math.atan2(-dy, dx) * 180) / Math.PI

/**
 * The cursor just past a corner that turns the box: a curved arrow round the corner, pointing both ways, drawn for the
 * top-right corner and turned `deg` counterclockwise to the corner it is at (white under black, to show on any banknote)
 */
function rotateCursor(deg: number) {
  const arc = 'M6 7 A11 11 0 0 1 17 18'
  const heads = 'M2.5 7 L6.5 3.5 L6.5 10.5 Z M17 21.5 L13.5 17.5 L20.5 17.5 Z'
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(${-deg + 45} 12 12) translate(0.5 -0.5)'>`
    + `<path d='${arc}' fill='none' stroke='white' stroke-width='4' stroke-linecap='round'/><path d='${heads}' fill='white' stroke='white' stroke-width='2.5' stroke-linejoin='round'/>`
    + `<path d='${arc}' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'/><path d='${heads}' fill='black'/></g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`
}

/**
 * Canvas-only placing surface for a layer placed on a flat banknote (the watermark, shown clear, or magnetic ink): drag
 * the box to move the layer, and a corner or anywhere along its border to resize it with its proportions kept, in 0.5
 * mm steps (Keller, 9 November: "resizing things is broken if I try to resize by dragging the border. The corner
 * works"): from a side, the side across from it stays where it is and the box stays centred along it. Arrow keys nudge
 * it. Just past each corner, a press turns it about its middle instead, as in Figma (Keller, 9 November: "I can also
 * rotate elements on the banknote"): in whole degrees, or steps of 15° with Shift held, the cursor a curved arrow
 * there. A turned box shows turned, its corners and sides resizing it along its own sides. It takes its gestures before
 * the banknote can tilt or pan. On the banknote's back (`mirror`, only the watermark shows there) it sits where the
 * layer shows, the other side round and turned the other way, and moves and turns the way the pointer does there. On a
 * rotated banknote (`quarter`, quarter turns clockwise) it turns with it, and drags and arrow keys still move it the
 * way they point on screen. A double-click in it, away from its corners and border, can place something there
 * (`onDoubleClick`: one more of Arc-en-Ciel's points).
 */
export function PlacingBox({ note, layer, part, box, scale, mirror = false, quarter = 0, onChange, onDoubleClick }: {
  note: Note
  layer: PlacedLayer
  /** Which of its kind it places, read off a press on it: the first (its kind), or a further one (extras.ts) */
  part?: Layer
  box: PlacedBox
  scale: number
  mirror?: boolean
  quarter?: Quarter
  onChange: (box: PlacedBox) => void
  /** Where a double-click lands on the banknote, mm from its front's top-left, as on the box before it turned */
  onDoubleClick?: (at: { xMm: number; yMm: number }) => void
}) {
  const gesture = useRef<Gesture | null>(null)
  const name = LAYER_NAMES[layer].toLowerCase()
  // Along the front's X, a move to the right on the back is a move to the left
  const across = mirror ? -1 : 1
  const shown = mirror ? mirrored(box, note) : box
  const width = shown.widthMm * scale
  const height = shown.heightMm * scale
  // How far it shows turned on screen, degrees counterclockwise: its own rotation, less the banknote's quarter turns clockwise
  const onScreen = rotationOf(shown) - 90 * quarter
  /**
   * Where its middle is on screen. A box turned about its middle has its bounds on screen about the same middle, so it
   * is that far into them from their top-left (worked out rather than read, as `unturnedPoint` does)
   */
  const middleOf = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const a = (onScreen * Math.PI) / 180
    const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a))
    return { x: rect.left + (width * cos + height * sin) / 2, y: rect.top + (width * sin + height * cos) / 2 }
  }
  const finish = (event: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    const g = gesture.current
    if (!g) return
    event.stopPropagation()
    if (cancel) onChange(g.original)
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`Place ${name}`}
      data-placed={part ?? layer}
      data-placing=""
      className="absolute touch-none cursor-move border border-fuchsia-500 ring-2 ring-fuchsia-500/40 outline-none focus-visible:ring-fuchsia-500/70"
      style={{ left: shown.xMm * scale, top: shown.yMm * scale, width, height, transform: boxTurn(shown) }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        const target = event.target as HTMLElement
        if (target.closest('[data-rotate]')) {
          const middle = middleOf(event.currentTarget)
          gesture.current = { mode: 'rotate', from: angleTo(event.clientX - middle.x, event.clientY - middle.y), middle, original: box }
          return
        }
        // The corner or side as it shows, which on the back is the front's other one (but for the top and bottom)
        const grip = target.closest<HTMLElement>('[data-corner], [data-side]')
        const handle = (grip?.dataset.corner ?? grip?.dataset.side) as Handle | undefined
        gesture.current = { mode: handle ? (mirror ? MIRRORED[handle] : handle) : 'move', startX: event.clientX, startY: event.clientY, original: box }
      }}
      onPointerMove={(event) => {
        const g = gesture.current
        if (!g) return
        event.stopPropagation()
        // A release that never reached us: stop following the pointer
        if (event.buttons === 0) return finish(event)
        if (g.mode === 'rotate') {
          // As far round its middle as the pointer has gone on screen, counterclockwise; on the back that turns the front the other way
          const turned = angleTo(event.clientX - g.middle.x, event.clientY - g.middle.y) - g.from
          const step = event.shiftKey ? ROTATE_SNAP : 1
          const rotationDeg = normalRotation(Math.round((rotationOf(g.original) + across * turned) / step) * step)
          if (rotationDeg !== rotationOf(box)) onChange({ ...g.original, rotationDeg })
          return
        }
        const along = unturn(event.clientX - g.startX, event.clientY - g.startY, quarter)
        const dx = (across * along.x) / scale
        const dy = along.y / scale
        const next = g.mode === 'move' ? moveBox(g.original, dx, dy, note) : dragBoxHandle(g.original, g.mode, dx, dy, note)
        if (next.xMm !== box.xMm || next.yMm !== box.yMm || next.widthMm !== box.widthMm) onChange(next)
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={() => { gesture.current = null }}
      onDoubleClick={(event) => {
        if (!onDoubleClick || (event.target as HTMLElement).closest('[data-corner], [data-side], [data-rotate]')) return
        // Where in the box as it lies before the banknote was turned and before the box itself was, then on the banknote;
        // on the back the other side round
        const middle = middleOf(event.currentTarget)
        const onNote = unturn(event.clientX - middle.x, event.clientY - middle.y, quarter)
        const at = intoBox(shown, onNote.x, onNote.y)
        const xMm = shown.xMm + (width / 2 + at.x) / scale
        onDoubleClick({ xMm: mirror ? note.widthMm - xMm : xMm, yMm: shown.yMm + (height / 2 + at.y) / scale })
      }}
      onKeyDown={(event) => {
        const by = NUDGE[event.key]
        if (!by) return
        event.preventDefault()
        event.stopPropagation()
        const step = event.shiftKey ? 10 * PLACE_STEP : PLACE_STEP
        const along = unturn(by[0], by[1], quarter)
        onChange(moveBox(box, across * along.x * step, along.y * step, note))
      }}
    >
      {CORNERS.map((corner) => (
        // Just past the corner, out along its diagonal, under the corner's own handle: a press there turns the box
        <span
          key={`rotate-${corner}`}
          aria-hidden="true"
          data-rotate={corner}
          className="absolute"
          style={{
            width: ROTATE_ZONE_PX,
            height: ROTATE_ZONE_PX,
            [corner[0] === 'n' ? 'top' : 'bottom']: -ROTATE_ZONE_PX,
            [corner[1] === 'w' ? 'left' : 'right']: -ROTATE_ZONE_PX,
            cursor: rotateCursor(HANDLE_DEG[corner] + onScreen),
          }}
        />
      ))}
      {SIDES.map((side) => {
        // Along the whole side, over its border, half out past it and half in (less in a small box), under the corners'
        // handles: a press there resizes the box from that side
        const level = side === 'n' || side === 's'
        const inside = Math.min(SIDE_ZONE_PX, (level ? height : width) / 4)
        return (
          <span
            key={`side-${side}`}
            aria-hidden="true"
            data-side={side}
            className="absolute"
            style={{
              ...(level ? { left: 0, right: 0, height: SIDE_ZONE_PX + inside } : { top: 0, bottom: 0, width: SIDE_ZONE_PX + inside }),
              [{ n: 'top', e: 'right', s: 'bottom', w: 'left' }[side]]: -SIDE_ZONE_PX,
              // Straight out from the side as it shows, turned with the box and the banknote
              cursor: resizeCursor(HANDLE_DEG[side] + onScreen),
            }}
          />
        )
      })}
      {CORNERS.map((corner) => (
        <Button
          key={corner}
          variant="outline"
          size="icon-xs"
          tabIndex={-1}
          data-corner={corner}
          aria-label={`Resize ${name} from its ${CORNER_NAMES[corner]} corner`}
          className="absolute z-10 size-2.5 min-w-0 rounded-sm border-fuchsia-500 p-0 active:translate-y-0"
          style={{
            [corner[0] === 'n' ? 'top' : 'bottom']: 0,
            [corner[1] === 'w' ? 'left' : 'right']: 0,
            transform: `translate(${corner[1] === 'w' ? '-50%' : '50%'}, ${corner[0] === 'n' ? '-50%' : '50%'})`,
            // Along its diagonal as it shows, turned with the box and the banknote
            cursor: resizeCursor(HANDLE_DEG[corner] + onScreen),
          }}
        />
      ))}
    </div>
  )
}
