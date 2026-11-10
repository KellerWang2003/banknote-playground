import { ChevronDown, ChevronUp, CircleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ChangeEvent, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { typedHex } from '../lib/color'
import { LENGTH_UNITS, formatLength, lengthField, setLengthUnit, useLengthUnit, type LengthUnit } from '../lib/units'
import { ColorPicker } from './ColorPicker'

// Playground-specific compositions of the shadcn primitives in components/ui

const round = (value: number) => Math.round(value * 100) / 100
const twoDecimals = (value: number) => String(round(value))

/**
 * A floating panel over the canvas, see-through enough to show the banknotes under it (Keller); every control with a box
 * inside (fields, selectors, dropdowns, outline buttons) has a 90% fill instead, in its own colour, so a banknote behind
 * doesn't show through it (Keller). Every floating panel has the same corners (Keller): `rounded-lg` controls inset 6 px,
 * plus the border
 */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-[calc(var(--radius)+0.375rem+1px)] border border-border/70 bg-background/85 shadow-panel backdrop-blur', className)}>{children}</div>
}

interface NumberInput {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  /** How the value shows; two decimals by default */
  format?: (value: number) => string
  /**
   * Reads what's typed, for a field that takes more than a plain number (a length with a unit after it); undefined
   * when it isn't a value. Such a field takes text, and steps with the arrow keys itself.
   */
  parse?: (text: string) => number | undefined
  /**
   * What to say about a value typed past a limit, for a field that keeps it, marked as an error, until it is fixed,
   * rather than dropping it once it is left (Keller, for a banknote's size): `over` as soon as it is typed, `under` once
   * Enter is pressed or the field is left, as typing 150 passes 1 and 15 on the way. Nothing past a limit is taken, and
   * what typing took on the way there (25 and 250 on the way to 2500) goes back to the value from before.
   */
  limitErrors?: { under: string; over: string }
}

/**
 * A number field's input: it commits while typing only when the value is in range, so a half-typed number never jumps,
 * and shows the value again once you leave it (or, with `limitErrors`, keeps one typed past a limit and says what is
 * wrong with it, until it is fixed or the value changes some other way). A field that reads its own text (`parse`)
 * steps on ↑ and ↓ itself, as a number input does, to the next multiple of its step (ten steps on with Shift).
 */
function useNumberInput({ value, onChange, min, max, step, format = twoDecimals, parse, limitErrors }: NumberInput) {
  // What's typed and the value from before it; one kept past a limit stays only while that value does, and goes for
  // good once it changes some other way (a scrub, an undo), so coming back to it doesn't bring it back
  const [draft, setDraft] = useState<{ text: string; from: number; kept?: boolean } | null>(null)
  if (draft?.kept && draft.from !== value) setDraft(null)
  const shown = draft && (!draft.kept || draft.from === value) ? draft : null
  const snap = (v: number) => clampValue(Math.round(v / step) * step, min, max)
  const read = (text: string) => {
    if (parse) return parse(text)
    const next = Number(text)
    return text !== '' && Number.isFinite(next) ? next : undefined
  }
  const typed = shown ? read(shown.text) : undefined
  const error = !limitErrors || typed === undefined ? undefined
    : typed > max ? limitErrors.over
    : typed < min && shown?.kept ? limitErrors.under
    : undefined
  /** Keeps what's typed if it is past a limit, with `limitErrors`, putting back the value from before it; else lets it go */
  const leave = () => {
    if (!shown || !limitErrors || typed === undefined || (typed >= min && typed <= max)) return false
    setDraft({ ...shown, kept: true })
    if (value !== shown.from) onChange(shown.from)
    return true
  }
  const input = {
    ...(parse ? { type: 'text', autoComplete: 'off', spellCheck: false } : { type: 'number', min, max, step }),
    value: shown?.text ?? format(value),
    'aria-invalid': error ? true : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const from = shown?.from ?? value
      setDraft({ text: e.target.value, from })
      const next = read(e.target.value)
      if (next !== undefined && next >= min && next <= max) onChange(next)
      else if (limitErrors && next !== undefined && next > max && value !== from) onChange(from)
    },
    onBlur: () => {
      if (!leave()) setDraft(null)
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        // Past a limit it stays in the field to be fixed, and doesn't send its form
        if (leave()) e.preventDefault()
        else e.currentTarget.blur()
      } else if (parse && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const at = (typed ?? value) / step
        const steps = e.shiftKey ? 10 : 1
        onChange(clampValue((e.key === 'ArrowUp' ? Math.floor(at + 1e-9) + steps : Math.ceil(at - 1e-9) - steps) * step, min, max))
        setDraft(null)
      }
    },
  }
  return { input, snap, error }
}

/** What's wrong with a value typed into a field, under it in red */
function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-center gap-1 text-xs text-destructive">
      <CircleAlert className="size-3.5 shrink-0" />
      {children}
    </p>
  )
}

/**
 * A Figma-style number field: a short label inside the field that you can drag sideways to scrub the
 * value, and a number you can type. Commits while typing only when the value is in range. Its fill is 90%, as every
 * boxed control's is: a banknote seen through the panel tints the panel, and a see-through fill all but vanished (Keller
 * noticed W and H). A length is a `LengthField`.
 */
export function ScrubField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  parse,
  limitErrors,
  unit,
  title,
  size = 'default',
  trailing,
  className,
}: Omit<NumberInput, 'step'> & {
  label: ReactNode
  /** Tooltip naming what a terse label stands for */
  title?: string
  step?: number
  /** After the number: its unit, or a control such as the unit menu */
  unit?: ReactNode
  /** 'sm' is shorter, with a narrow label and smaller digits, for tight floating panels */
  size?: 'default' | 'sm'
  /** A small control after the unit, inside the field */
  trailing?: ReactNode
  className?: string
}) {
  // The scrub under way: where it was pressed, the value then, and the pointer pressing
  const [scrub, setScrub] = useState<{ x: number; start: number; pointerId: number } | null>(null)
  /** Ends the scrub, letting go of the pointer if the label still holds it */
  const endScrub = (label: HTMLElement) => {
    if (scrub && label.hasPointerCapture(scrub.pointerId)) label.releasePointerCapture(scrub.pointerId)
    setScrub(null)
  }
  const { input, snap, error } = useNumberInput({ value, onChange, min, max, step, format, parse, limitErrors })
  const errorId = useId()
  const sm = size === 'sm'

  const field = (
    <div
      title={title}
      className={cn(
        'flex min-w-0 items-center rounded-md border border-transparent bg-muted/67 focus-within:border-ring hover:border-border',
        error && 'border-destructive focus-within:border-destructive hover:border-destructive',
        sm ? 'h-7' : 'h-8',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-full shrink-0 cursor-ew-resize touch-none items-center justify-center text-xs text-muted-foreground select-none',
          sm ? 'w-4 pl-0.5' : 'min-w-7 px-2',
        )}
        // A scrub lasts only while the main button that began it is held. Its release can go missing, so anything that
        // says the press is over ends it too: the browser cancelling the pointer or the label losing it, a context menu
        // (Ctrl-click on a Mac opens one on the press, and the menu keeps the release from the page) or a move with no
        // button held. Ended by the release alone, a scrub could stay attached, the value following the pointer whenever
        // it came back over the label with no button held (Keller, 9 November)
        onPointerDown={(e) => {
          // A secondary click (two fingers on a trackpad) opens the context menu instead
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setScrub({ x: e.clientX, start: value, pointerId: e.pointerId })
        }}
        onPointerMove={(e) => {
          if (!scrub || e.pointerId !== scrub.pointerId) return
          if ((e.buttons & 1) === 0) endScrub(e.currentTarget)
          else onChange(snap(scrub.start + ((e.clientX - scrub.x) / 2) * step))
        }}
        onPointerUp={(e) => endScrub(e.currentTarget)}
        onPointerCancel={(e) => endScrub(e.currentTarget)}
        onLostPointerCapture={(e) => endScrub(e.currentTarget)}
        onContextMenu={(e) => endScrub(e.currentTarget)}
      >
        {label}
      </span>
      <input
        {...input}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'h-full w-full min-w-0 bg-transparent tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none',
          sm ? 'pl-0.5 text-xs' : 'text-sm',
        )}
      />
      {typeof unit === 'string'
        ? <span className={cn('text-xs text-muted-foreground', sm ? (trailing ? 'pr-0.5' : 'pr-1.5') : 'pr-2')}>{unit}</span>
        : unit && <span className={cn('flex shrink-0 items-center', sm ? 'pr-0.5' : 'pr-1')}>{unit}</span>}
      {trailing}
    </div>
  )
  if (!limitErrors) return field
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {field}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  )
}

/**
 * The unit after a length, a menu that reads every length in the app in another unit: the same pick wherever it's
 * opened, remembered per browser (`src/lib/units.ts`). It sits where the unit's text sat.
 */
function UnitMenu({ unit }: { unit: LengthUnit }) {
  const name = LENGTH_UNITS.find((u) => u.unit === unit)?.name ?? unit
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="xs" aria-label={`Unit: ${name}`} title="Unit for every length"
          className="h-5 rounded px-1 font-normal text-muted-foreground hover:text-foreground aria-expanded:text-foreground" />}
      >
        {unit}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={unit} onValueChange={(next) => setLengthUnit(next as LengthUnit)}>
          {LENGTH_UNITS.map((u) => (
            <DropdownMenuRadioItem key={u.unit} value={u.unit} closeOnClick>
              {u.name}
              <DropdownMenuShortcut className="tracking-normal">{u.unit}</DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type LengthProps = {
  /** All in mm, whatever the unit */
  value: number
  onChange: (mm: number) => void
  min: number
  max: number
  /** Today's step in mm; the field steps the round number of its unit that isn't coarser (`stepIn`) */
  step: number
  /** Steps exactly `step`, converted, as a section's twelfths of the thread */
  exactStep?: boolean
  /** A length typed past a limit stays, marked as an error with the limit, until it is fixed (a banknote's size) */
  strict?: boolean
}

/** What a strict length field says about a length typed past its limits, in the unit it reads in */
const lengthLimitErrors = (min: number, max: number, unit: LengthUnit) =>
  ({ under: `Min ${formatLength(min, unit)}`, over: `Max ${formatLength(max, unit)}` })

/**
 * A ScrubField for a length: it takes and gives mm, and shows, reads and steps in the unit picked from the menu on its
 * unit, rounded to that unit's decimals. A unit typed after the number (6.14in, 6.14", 15.6cm, 442pt) converts without
 * switching. The number shown at a limit can always be typed.
 */
export function LengthField({ value, onChange, min, max, step, exactStep, strict, ...field }: LengthProps &
  Omit<ComponentProps<typeof ScrubField>, keyof LengthProps | 'format' | 'parse' | 'unit' | 'limitErrors'>) {
  const unit = useLengthUnit((s) => s.unit)
  const { toMm, ...length } = lengthField(unit, { value, min, max, step, exactStep })
  return <ScrubField {...field} {...length} limitErrors={strict ? lengthLimitErrors(min, max, unit) : undefined}
    onChange={(typed) => onChange(toMm(typed))} unit={<UnitMenu unit={unit} />} />
}

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** A top-level part in a side panel, with its nested sections; untitled under a tab that already names it */
export function Group({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col border-b border-border', title && 'pt-3')}>
      {title && (
        <div className="flex h-5 items-center justify-between pr-2.5 pl-4">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {/* Inside a part, its sections split by lighter, inset lines; the dark full-width ones divide the parts themselves */}
      <div className="flex flex-col divide-y divide-border/70">{children}</div>
    </div>
  )
}

/** One titled set of controls in the side panel; inside a Group it drops its divider */
export function Section({ title, action, nested = false, children }: { title?: string; action?: ReactNode; nested?: boolean; children: ReactNode }) {
  return (
    <section className={cn('flex flex-col gap-3', nested ? 'mx-4 py-3' : 'border-b border-border px-4 py-3')}>
      {(title || action) && (
        <div className="flex h-5 items-center justify-between">
          {title && <h3 className="text-[11px] font-medium text-muted-foreground">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * A control in a side panel with a small label over it saying what it is, always shown, like Figma's property labels
 * (Keller), so nobody has to guess what T or a picture strip means. A small `action` (an `IconButton` at `size-5`) can
 * sit at the label's end, as Tile length's Fit does, keeping the field itself clear
 */
export function Labeled({ label, title, action, className, children }: {
  label: string
  title?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  const text = <span className="text-[11px] leading-none text-muted-foreground">{label}</span>
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)} title={title}>
      {action ? (
        // As tall as the label alone, so fields side by side stay level; the action reaches past it
        <div className="flex h-[11px] items-center justify-between gap-1">{text}{action}</div>
      ) : text}
      {children}
    </div>
  )
}

/** A part of a side panel fixed at its foot, as the thread editor's Preview: its title stays put under what scrolls above, and it opens upwards */
export function Drawer({ title, action, open, onOpenChange, children }: {
  title: string
  action?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="flex shrink-0 flex-col border-t border-border">
      <div className="flex h-9 items-center justify-between pr-2.5 pl-4">
        <CollapsibleTrigger render={<Button variant="ghost" size="xs" className="-ml-1.5 gap-1 px-1.5 text-[13px] font-semibold" />}>
          {title}
          {open ? <ChevronDown className="text-muted-foreground" /> : <ChevronUp className="text-muted-foreground" />}
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent className="max-h-[50vh] overflow-y-auto px-4 pb-3">
        <div className="flex flex-col gap-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * A part's tab, as Figma's Design and Prototype: the open one a filled pill in dark semibold text, the others plain grey
 * text that darkens under the pointer
 */
const PART_TAB = "h-7 flex-none rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground data-active:bg-muted/67 data-active:font-semibold data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-none [&_svg:not([class*='size-'])]:size-3.5"

/** One of a side panel's part tabs, in a `TabStrip`; its icon goes before its name */
export function PartTab({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return <TabsTrigger className={cn(PART_TAB, className)} {...props} />
}

/** How far the part tabs fade out at an edge with more tabs beyond it, px */
const STRIP_FADE = 16

/**
 * A side panel's part tabs (`PartTab`s), inside its `Tabs`: the strip scrolls sideways once there are more tabs than
 * fit, fades at an edge while more lie beyond, and keeps the open tab in sight (picking the watermark on the canvas
 * brings its tab round). The first pill's icon lines up with the panel's content under it, its fill reaching out past
 * it.
 */
export function TabStrip({ active, children }: { active: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })
  useEffect(() => {
    const strip = ref.current
    if (!strip) return
    const measure = () => {
      const left = strip.scrollLeft > 0
      const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }))
    }
    measure()
    strip.addEventListener('scroll', measure, { passive: true })
    const resize = new ResizeObserver(measure)
    resize.observe(strip)
    if (strip.firstElementChild) resize.observe(strip.firstElementChild)
    return () => {
      strip.removeEventListener('scroll', measure)
      resize.disconnect()
    }
  }, [])
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])
  const mask = more.left || more.right
    ? `linear-gradient(to right, ${more.left ? 'transparent' : 'black'}, black ${STRIP_FADE}px, black calc(100% - ${STRIP_FADE}px), ${more.right ? 'transparent' : 'black'})`
    : undefined
  return (
    <div ref={ref} className="-ml-2.5 min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maskImage: mask, WebkitMaskImage: mask }}>
      <TabsList className="h-auto w-max gap-1 bg-transparent p-0">{children}</TabsList>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  )
}

/** A label on the left and its control on the right, as in a video editor's export settings */
export function InlineField({ label, title, children }: { label: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-3" title={title}>
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Commits while typing only when the value is in range, so a half-typed number never jumps. A length is a `LengthNumberField`. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  parse,
  limitErrors,
  unit,
  className,
}: Omit<NumberInput, 'step'> & {
  step?: number
  /** After the number: its unit, or a control such as the unit menu */
  unit?: ReactNode
  className?: string
}) {
  const { input, error } = useNumberInput({ value, onChange, min, max, step, format, parse, limitErrors })
  const errorId = useId()
  const field = (
    <div className={cn('relative', className)}>
      <Input
        {...input}
        aria-describedby={error ? errorId : undefined}
        className={cn('h-8 bg-background/67 text-right tabular-nums [&::-webkit-inner-spin-button]:appearance-none', unit && (typeof unit === 'string' ? 'pr-7' : 'pr-8'))}
      />
      {typeof unit === 'string' ? (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
          {unit}
        </span>
      ) : unit && <span className="absolute inset-y-0 right-1 flex items-center">{unit}</span>}
    </div>
  )
  if (!limitErrors) return field
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {field}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  )
}

/** A NumberField for a length, as `LengthField`: mm in and out, shown and typed in the unit picked from its unit menu */
export function LengthNumberField({ value, onChange, min, max, step, exactStep, strict, className }: LengthProps & { className?: string }) {
  const unit = useLengthUnit((s) => s.unit)
  const { toMm, ...length } = lengthField(unit, { value, min, max, step, exactStep })
  return <NumberField {...length} className={className} limitErrors={strict ? lengthLimitErrors(min, max, unit) : undefined}
    onChange={(typed) => onChange(toMm(typed))} unit={<UnitMenu unit={unit} />} />
}

export function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  unit?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
        <NumberField className="w-[88px]" value={value} onChange={onChange} min={min} max={max} step={step} unit={unit} />
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
      />
    </div>
  )
}

/**
 * A single-choice toggle group that always keeps one option selected, drawn as Figma's selectors are (Keller): a grey
 * track, as a field's fill, with the picked option a white raised pill in dark text and the others grey text. As tall
 * as a field, its pills inset 2 px and rounded to match
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
}) {
  return (
    <ToggleGroup
      size="sm"
      // Pills of their own with a 2 px gap, not buttons joined into one bar
      spacing={0.5}
      className="w-full rounded-md bg-muted/67 p-0.5"
      value={[value]}
      onValueChange={(next) => {
        const picked = next.at(0)
        if (picked) onChange(picked as T)
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value}
          className="flex-1 rounded-sm text-xs text-muted-foreground hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function SwitchField({ label, title, checked, onChange, className }: {
  label: string
  /** Tooltip saying what the switch does */
  title?: string
  checked: boolean
  onChange: (value: boolean) => void
  className?: string
}) {
  return (
    <Label title={title} className={cn('flex cursor-pointer items-center justify-between gap-3 text-xs font-normal text-muted-foreground', className)}>
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </Label>
  )
}

export function CheckboxField({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span className="min-w-0 truncate">{label}</span>
    </Label>
  )
}

/** A colour as its hex, typed, with its swatch before it, which opens the app's own picker (`ColorPicker`) */
export function ColorField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="relative min-w-0">
      <ColorPicker value={value} onChange={onChange} className="absolute top-1/2 left-1.5 -translate-y-1/2" />
      <Input
        className="h-8 bg-background/67 pl-8 uppercase tabular-nums"
        value={draft ?? value}
        onChange={(e) => {
          setDraft(e.target.value)
          // With its # or without, as Figma takes it
          const typed = typedHex(e.target.value)
          if (typed && typed !== value.toLowerCase()) onChange(typed)
        }}
        onBlur={() => {
          // Three digits are Figma's shorthand (F80 is FF8800), read once the field is left
          const typed = draft === null ? undefined : typedHex(draft, true)
          if (typed && typed !== value.toLowerCase()) onChange(typed)
          setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </div>
  )
}

/** An icon-only button with its label in a tooltip */
export function IconButton({
  label,
  size = 'icon-sm',
  variant = 'ghost',
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label'> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant={variant} size={size} aria-label={label} {...props} />} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
