import { GripVertical, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ColorField, IconButton } from '../components/controls'

/** The list with the colour at `from` moved to `to`, the others keeping their order */
function moved(colors: string[], from: number, to: number) {
  const next = [...colors]
  const [colour] = next.splice(from, 1)
  next.splice(to, 0, colour)
  return next
}

/**
 * Colours in order, one row each (Arc-en-Ciel's bands, from where they start; Keller, 8 November: "a list format with like
 * handles on the left, which you can reorder"): a grip on the left to drag the row up or down the list, the colour's field,
 * and × to take it out while more than `min` are left. A row moves as the pointer passes over the others, so the canvas
 * shows the new order as it goes; `onDrag` says when a drag starts and ends, so it can be one undo step. With the grip
 * focused, the up and down arrow keys move the row too.
 */
export function ColourList({ colors, min, onChange, onDrag }: {
  colors: string[]
  min: number
  onChange: (colors: string[]) => void
  onDrag?: (dragging: boolean) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  // The row being dragged, where it is now
  const [dragging, setDragging] = useState<number>()
  /** The row the pointer is over, or the nearest end of the list past either end */
  const rowAt = (clientY: number) => {
    const rows = [...(list.current?.children ?? [])]
    const at = rows.findIndex((row) => clientY < row.getBoundingClientRect().bottom)
    return at < 0 ? rows.length - 1 : at
  }
  const end = () => {
    if (dragging === undefined) return
    setDragging(undefined)
    onDrag?.(false)
  }

  return (
    <div ref={list} className="-ml-1.5 flex flex-col gap-1.5">
      {colors.map((colour, i) => (
        // By position: rows are only ever moved by a drag, which carries the dragged one along as it goes
        <div key={i} data-colour-row={i} className={cn('flex items-center gap-0.5 rounded-lg', dragging === i && 'bg-muted/60')}>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Move colour ${i + 1}`}
            title="Drag to reorder"
            className={cn('flex h-8 w-5 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              dragging === i ? 'cursor-grabbing' : 'cursor-grab')}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              setDragging(i)
              onDrag?.(true)
            }}
            onPointerMove={(event) => {
              if (dragging === undefined) return
              if (event.buttons === 0) return end()
              const to = rowAt(event.clientY)
              if (to === dragging) return
              onChange(moved(colors, dragging, to))
              setDragging(to)
            }}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onKeyDown={(event) => {
              const to = i + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)
              if (to === i || to < 0 || to >= colors.length) return
              event.preventDefault()
              onChange(moved(colors, i, to))
              // The grip goes with its row
              requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-colour-row="${to}"] [role="button"]`)?.focus())
            }}
          >
            <GripVertical className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <ColorField value={colour} onChange={(value) => onChange(colors.map((c, j) => (j === i ? value : c)))} />
          </div>
          <IconButton label="Remove colour" size="icon-xs" className="-mr-1 text-muted-foreground" disabled={colors.length <= min}
            onClick={() => onChange(colors.filter((_, j) => j !== i))}>
            <X />
          </IconButton>
        </div>
      ))}
    </div>
  )
}
