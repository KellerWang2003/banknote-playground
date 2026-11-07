import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckboxField, ColorField, InlineField, ScrubField, Segmented } from '../components/controls'
import { reportError } from '../cloud/notices'
import type { ExportFormat } from '../lib/exportMedia'
import { RESOLUTIONS, exportSize, turnsOver } from '../lib/exportRender'
import type { Project } from '../lib/types'
import { usePatternOffsets } from '../lib/patternOffset'
import { ROTATION_NAMES, quarterOf } from '../lib/rotate'
import { useTilt } from '../tilt/tilt'

const FORMATS = [{ value: 'mp4' as const, label: 'MP4' }, { value: 'gif' as const, label: 'GIF' }]
const FRAME_RATES: Record<ExportFormat, number[]> = { mp4: [24, 30, 60], gif: [10, 15, 20, 25] }
const DEFAULTS: Record<ExportFormat, { height: number; fps: number }> = { mp4: { height: 1080, fps: 30 }, gif: { height: 480, fps: 20 } }

function SettingsGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex h-5 items-center justify-between">
        <h3 className="text-[11px] font-medium text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function OptionSelect<T extends string | number>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <Select value={value} items={options} onValueChange={(next) => { if (next !== null) onChange(next as T) }}>
      <SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/** Exports one playback loop of the tilt as MP4 or GIF, laid out like a video editor's export settings */
export function ExportDialog({ project, selectedId, open, onOpenChange }: {
  project: Project
  selectedId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : project.notes.map((n) => n.id)))
  const [separate, setSeparate] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [height, setHeight] = useState(DEFAULTS.mp4.height)
  const [fps, setFps] = useState(DEFAULTS.mp4.fps)
  const [loops, setLoops] = useState(1)
  const [background, setBackground] = useState('#f4f4f5')
  const [transparent, setTransparent] = useState(false)
  const [progress, setProgress] = useState<number>()
  const abort = useRef<AbortController>(null)
  const sheen = useTilt((s) => s.sheen)
  const perspective = useTilt((s) => s.perspective)
  const frameNumbers = useTilt((s) => s.frameNumbers)
  // The lamp switch left on holds the whole video up to the light, as # carries frame numbers into it, banknotes
  // turned over export their backs, and rotated ones export rotated
  const backlit = useTilt((s) => s.backlit)
  const back = useTilt((s) => s.flipped)
  const quarter = useTilt((s) => quarterOf(s.quarterTurns))
  const offsets = usePatternOffsets((s) => s.offsets)

  const notes = project.notes.filter((n) => chosen.has(n.id))
  const several = notes.length > 1
  const allChosen = notes.length === project.notes.length
  const options = { format, notes, separate: several && separate, height, fps, loops: format === 'gif' ? 1 : loops, sheen, perspective, frameNumbers, backlit, back,
    quarter, background: format === 'gif' && transparent ? undefined : background, offsets }
  const size = exportSize(notes, options)
  // Turned over, the banknotes export their backs, or start on them when Flip moves turn them over
  const sides = !back ? '' : notes.length > 0 && turnsOver(notes[0]) ? ' · from the backs' : ' · backs'
  const rotated = quarter ? ` · ${ROTATION_NAMES[quarter]}` : ''
  const busy = progress !== undefined
  const files = options.separate ? notes.length : 1

  const changeFormat = (next: ExportFormat) => {
    setFormat(next)
    setHeight(DEFAULTS[next].height)
    setFps(DEFAULTS[next].fps)
  }
  const toggle = (id: string, on: boolean) => setChosen((set) => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })

  const run = async () => {
    const controller = new AbortController()
    abort.current = controller
    setProgress(0)
    try {
      // The encoders load only when someone exports
      const { downloadFile, exportTilt } = await import('../lib/exportMedia')
      downloadFile(await exportTilt(project.name, options, setProgress, controller.signal))
      onOpenChange(false)
    } catch (error) {
      if (!controller.signal.aborted) reportError(error)
    } finally {
      abort.current = null
      setProgress(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) abort.current?.abort()
      onOpenChange(next)
    }}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
        </DialogHeader>
        <fieldset disabled={busy} className="contents">
          <SettingsGroup
            title="Banknotes"
            action={project.notes.length > 1 && (
              <Label className="flex cursor-pointer items-center gap-1.5 text-xs font-normal text-muted-foreground">
                All
                <Checkbox checked={allChosen} indeterminate={!allChosen && notes.length > 0}
                  onCheckedChange={(on) => setChosen(new Set(on ? project.notes.map((n) => n.id) : []))} />
              </Label>
            )}
          >
            <div className="flex max-h-36 flex-col gap-2 overflow-y-auto rounded-lg border border-border/60 p-2.5">
              {project.notes.map((n) => (
                <CheckboxField key={n.id} label={n.name} checked={chosen.has(n.id)} onChange={(on) => toggle(n.id, on)} />
              ))}
            </div>
            {several && <CheckboxField label="Export as separate files" checked={separate} onChange={setSeparate} />}
          </SettingsGroup>

          <SettingsGroup title="Video">
            <InlineField label="Format">
              <Segmented value={format} options={FORMATS} onChange={changeFormat} />
            </InlineField>
            <InlineField label="Resolution" title="Height of the frame; banknotes keep their proportions">
              <OptionSelect label="Resolution" value={height} options={RESOLUTIONS.filter((r) => format === 'mp4' ? r.value >= 720 : r.value <= 1080)} onChange={setHeight} />
            </InlineField>
            <InlineField label="Frame rate">
              <OptionSelect label="Frame rate" value={fps} options={FRAME_RATES[format].map((f) => ({ value: f, label: `${f} fps` }))} onChange={setFps} />
            </InlineField>
            {format === 'mp4' && (
              <InlineField label="Loops" title="Times the playback loop repeats; a GIF loops forever">
                <ScrubField label="×" value={loops} min={1} max={10} onChange={setLoops} />
              </InlineField>
            )}
          </SettingsGroup>

          <SettingsGroup title="Background">
            {format === 'gif' && <CheckboxField label="Transparent" checked={transparent} onChange={setTransparent} />}
            {!(format === 'gif' && transparent) && (
              <InlineField label="Colour">
                <ColorField value={background} onChange={setBackground} />
              </InlineField>
            )}
          </SettingsGroup>
        </fieldset>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          {busy ? (
            <Progress className="flex-1" value={Math.round(progress * 100)} />
          ) : (
            <span className="text-xs text-muted-foreground tabular-nums">
              {notes.length > 0 && `${size.width} × ${size.height} · ${size.seconds.toFixed(1)} s${files > 1 ? ` · ${files} files` : ''}${sides}${rotated}${backlit ? ' · held to the light' : ''}`}
            </span>
          )}
          <div className="flex shrink-0 gap-2">
            {busy && <Button variant="outline" onClick={() => abort.current?.abort()}>Cancel</Button>}
            <Button disabled={busy || notes.length === 0} onClick={() => void run()}>
              {busy ? `Exporting ${Math.round(progress * 100)}%` : 'Export'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
