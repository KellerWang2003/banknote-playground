import { Pipette } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { type Hsv, hexToHsv, hsvFor, hsvToHex, pickedHex } from '../lib/color'

/** Keys typed into these are text, never the eyedropper's I, as with the editor's other single-key shortcuts */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]'

/** Every hue, red round to red, along the hue strip */
const HUES = 'linear-gradient(to right, #f00, #ff0 16.667%, #0f0 33.333%, #0ff 50%, #00f 66.667%, #f0f 83.333%, #f00)'
/** A thumb's white ring, edged faintly so it shows on white too */
const THUMB = 'pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_white,0_0_0_3px_rgb(0_0_0/0.25)]'
/** The arrow keys on the square: saturation across, brightness up and down */
const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
const BLACK: Hsv = { h: 0, s: 0, v: 0 }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** The browser's eyedropper, where it has one: Chrome, Edge and the other Chromium browsers on a computer, not Safari or Firefox */
type EyeDropperApi = new () => { open: (options?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }> }
const eyeDropper = () => (globalThis as { EyeDropper?: EyeDropperApi }).EyeDropper

/**
 * A colour field's swatch, which opens the app's own colour picker, laid out as Figma's: a square of saturation and
 * brightness, then the eyedropper beside a hue strip. While it is open, I starts the eyedropper, as in Figma, unless a
 * text field has the keyboard (Keller, 9 November: "when a color picker is active, i should be able to just press the
 * key I to initiate the actual color picking"). It took the place of the browser's own picker, which on a Mac is the
 * system's Colors window: that takes the keyboard while it is open, so the page never hears a key. Escape ends a pick
 * under way, the picker staying open, and closes the picker after that.
 */
export function ColorPicker({ value, onChange, className }: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Pick colour"
        // Outlined faintly, so a white colour still shows on the field's white fill
        className={cn('size-5 cursor-pointer rounded-[max(0px,calc(var(--radius)-6px))] ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
        style={{ backgroundColor: value }}
      />
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-56">
        <Picker value={value} onChange={onChange} open={open} />
      </PopoverContent>
    </Popover>
  )
}

function Picker({ value, onChange, open }: { value: string; onChange: (value: string) => void; open: boolean }) {
  // Where the square and the strip were last set, which `hsvFor` shows while it is still the value's colour, and whose
  // hue it keeps for a grey (and saturation for black), so neither jumps back to red as a drag reaches one
  const [kept, setKept] = useState<Hsv>(() => hexToHsv(value) ?? BLACK)
  const hsv = hsvFor(value, kept)
  const hex = hsvToHex(hsv)
  // The colour last given to the field, until the field shows it: a drag can move on before the field has re-rendered
  const sent = useRef<string | null>(null)
  useEffect(() => {
    sent.current = null
  }, [value])
  /** Shows `next` and gives the field its colour, unless the field has it already */
  const set = (next: Hsv) => {
    setKept(next)
    const colour = hsvToHex(next)
    if (colour === (sent.current ?? value.toLowerCase())) return
    sent.current = colour
    onChange(colour)
  }
  const square = useDrag((x, y) => set({ h: hsv.h, s: x, v: 1 - y }))
  const strip = useDrag((x) => set({ ...hsv, h: x * 360 }))

  // The eyedropper's pick under way, if one is, which Escape or the picker closing ends
  const [picking, setPicking] = useState(false)
  const pickRef = useRef<AbortController | null>(null)
  // The latest, for the eyedropper's answer
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  const canPick = !!eyeDropper()
  /** Starts the browser's eyedropper: a click anywhere on the screen gives the field the colour under it */
  const pick = () => {
    const Dropper = eyeDropper()
    if (!Dropper || pickRef.current) return
    const controller = new AbortController()
    pickRef.current = controller
    setPicking(true)
    let picked: Promise<{ sRGBHex: string }>
    try {
      picked = new Dropper().open({ signal: controller.signal })
    } catch (error) {
      picked = Promise.reject(error)
    }
    picked
      .then(({ sRGBHex }) => {
        const colour = pickedHex(sRGBHex)
        if (!colour || controller.signal.aborted) return
        setKept((from) => hsvFor(colour, from))
        latest.current(colour)
      })
      // Escape, or the picker closing: the colour stays as it was
      .catch(() => {})
      .finally(() => {
        if (pickRef.current !== controller) return
        pickRef.current = null
        setPicking(false)
      })
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      // Escape ends a pick under way before the picker hears it, as Figma's does, should the browser pass it on
      if (event.key === 'Escape' && pickRef.current) {
        event.preventDefault()
        event.stopPropagation()
        pickRef.current.abort()
        return
      }
      if (event.key.toLowerCase() !== 'i' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest(TYPING)) return
      if (!eyeDropper()) return
      event.preventDefault()
      if (!event.repeat) pick()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      // Closing the picker ends a pick under way
      pickRef.current?.abort()
    }
  }, [open])

  return (
    <>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        className="relative aspect-square w-full cursor-crosshair touch-none rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)`, backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)' }}
        {...square}
        onKeyDown={(event) => {
          const by = NUDGE[event.key]
          if (!by) return
          event.preventDefault()
          const step = event.shiftKey ? 0.1 : 0.01
          set({ ...hsv, s: clamp01(hsv.s + by[0] * step), v: clamp01(hsv.v + by[1] * step) })
        }}
      >
        <span className={THUMB} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hex }} />
      </div>
      <div className="flex items-center gap-2">
        {canPick && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Eyedropper" aria-pressed={picking} onClick={pick}
                  className="-ml-0.5 aria-pressed:bg-muted/67 aria-pressed:text-foreground" />
              }
            >
              <Pipette />
            </TooltipTrigger>
            <TooltipContent>
              Eyedropper
              <kbd data-slot="kbd" className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-background/20 px-1 font-sans text-xs font-medium text-background">I</kbd>
            </TooltipContent>
          </Tooltip>
        )}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Hue"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          className="relative h-3 flex-1 cursor-pointer touch-none rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
          style={{ backgroundImage: HUES }}
          {...strip}
          onKeyDown={(event) => {
            const by = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
            if (!by) return
            event.preventDefault()
            set({ ...hsv, h: Math.min(360, Math.max(0, Math.round(hsv.h) + by * (event.shiftKey ? 10 : 1))) })
          }}
        >
          <span className={cn(THUMB, 'top-1/2')} style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }} />
        </div>
      </div>
    </>
  )
}

/**
 * A press of the main button on the square or the strip and its drag, giving where the pointer is on it as shares of
 * its width and height (0 to 1). As a ScrubField's scrub, anything saying the press is over ends it: the release, the
 * browser cancelling the pointer or the element losing it, a context menu, or a move with no button held
 */
function useDrag(onAt: (x: number, y: number) => void) {
  const [pointer, setPointer] = useState<number>()
  const at = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    onAt(clamp01((event.clientX - box.left) / (box.width || 1)), clamp01((event.clientY - box.top) / (box.height || 1)))
  }
  const end = (event: SyntheticEvent<HTMLElement>) => {
    if (pointer === undefined) return
    if (event.currentTarget.hasPointerCapture(pointer)) event.currentTarget.releasePointerCapture(pointer)
    setPointer(undefined)
  }
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      // A secondary click opens the context menu instead
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setPointer(event.pointerId)
      at(event)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerId !== pointer) return
      if ((event.buttons & 1) === 0) end(event)
      else at(event)
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onContextMenu: end,
  }
}
