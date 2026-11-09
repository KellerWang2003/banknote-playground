import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckboxField, ColorField, InlineField, ScrubField, Segmented } from '../components/controls'
import { reportError } from '../cloud/notices'
import { sideImageId } from '../lib/back'
import type { ExportFormat } from '../lib/exportMedia'
import { RESOLUTIONS, artworkSize, exportSize, imageScale, imageSize, turnsOver } from '../lib/exportRender'
import { TILT_LIMIT } from '../lib/frames'
import type { Tilt2 } from '../lib/lens'
import type { Note, Project } from '../lib/types'
import { usePatternOffsets } from '../lib/patternOffset'
import { useRealistic } from '../lib/realistic'
import { ROTATION_NAMES, quarterOf } from '../lib/rotate'
import { useTilt } from '../tilt/tilt'

type Mode = 'video' | 'image'
const MODES = [{ value: 'video' as const, label: 'Video' }, { value: 'image' as const, label: 'Image' }]
const FORMATS = [{ value: 'mp4' as const, label: 'MP4' }, { value: 'gif' as const, label: 'GIF' }]
const FRAME_RATES: Record<ExportFormat, number[]> = { mp4: [24, 30, 60], gif: [10, 15, 20, 25] }
const DEFAULTS: Record<ExportFormat, { height: number; fps: number }> = { mp4: { height: 1080, fps: 30 }, gif: { height: 480, fps: 20 } }
/** The mode last picked, which the dialog opens on again for the rest of the session */
let lastMode: Mode = 'video'

/** The tilt the canvas shows, in whole degrees: where the pad or the angle fields hold it, else where it is */
function canvasTilt(): Tilt2 {
  const s = useTilt.getState()
  const shown = s.source === 'hold' ? { x: s.targetX, y: s.target } : { x: s.angleX, y: s.angle }
  return { x: Math.round(shown.x) || 0, y: Math.round(shown.y) || 0 }
}

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

/**
 * Exports one playback loop of the tilt as MP4 or GIF, laid out like a video editor's export settings, or each banknote as
 * a still image: flat at full resolution, its security features seen at the angle picked and its watermark as held to the
 * light (Keller, 9 November)
 */
export function ExportDialog({ project, selectedId, open, onOpenChange }: {
  project: Project
  selectedId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [mode, setMode] = useState<Mode>(lastMode)
  // An image starts at the angle the canvas shows, so what is seen is what comes out
  const [angle, setAngle] = useState<Tilt2>(canvasTilt)
  // Each design's own pixels by image id, once read (null where it couldn't be), which an image's size follows
  const [designs, setDesigns] = useState<Record<string, { width: number; height: number } | null>>({})
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
  // The lamp switch left on holds the whole video up to the light, as # carries frame numbers into it, Realistic its lit
  // inks and ridges, banknotes turned over export their backs, and rotated ones export rotated
  const backlit = useTilt((s) => s.backlit)
  const realistic = useRealistic((s) => s.on)
  const back = useTilt((s) => s.flipped)
  const quarter = useTilt((s) => quarterOf(s.quarterTurns))
  const offsets = usePatternOffsets((s) => s.offsets)

  const notes = project.notes.filter((n) => chosen.has(n.id))
  const several = notes.length > 1
  const allChosen = notes.length === project.notes.length
  const image = mode === 'image'
  const options = { format, notes, separate: several && separate, height, fps, loops: format === 'gif' ? 1 : loops, sheen, perspective, realistic, frameNumbers, backlit,
    back, quarter, background: format === 'gif' && transparent ? undefined : background, offsets }
  const imageOptions = { notes, tilt: angle, sheen, realistic, frameNumbers, back, quarter, offsets }
  const size = exportSize(notes, options)
  // Turned over, the banknotes export their backs, or a video starts on them when Flip moves turn them over
  const sides = !back ? '' : !image && notes.length > 0 && turnsOver(notes[0]) ? ' · from the backs' : ' · backs'
  const rotated = quarter ? ` · ${ROTATION_NAMES[quarter]}` : ''
  const busy = progress !== undefined
  // An image is one file per banknote
  const files = image ? notes.length : options.separate ? notes.length : 1

  // Each image's size, the banknote's own at its design's full resolution, once that design's pixels are known
  const designOf = (note: Note) => sideImageId(note, back ? 'back' : 'front')
  const imageSizes = notes.map((note) => {
    const id = designOf(note)
    const design = id ? designs[id] : null
    return design === undefined ? undefined : imageSize(note, imageScale(note, design ?? undefined), quarter)
  })
  const unread = image ? [...new Set(notes.flatMap((note) => designOf(note) ?? []))].filter((id) => !(id in designs)).join('\n') : ''
  useEffect(() => {
    if (!unread) return
    let live = true
    for (const id of unread.split('\n')) {
      void artworkSize(id).catch(() => undefined).then((read) => {
        if (live) setDesigns((known) => ({ ...known, [id]: read ?? null }))
      })
    }
    return () => { live = false }
  }, [unread])
  const shown = imageSizes.filter((s) => s !== undefined)
  const sameSize = shown.length === notes.length && shown.every((s) => s.width === shown[0].width && s.height === shown[0].height)
  const imageSummary = notes.length === 0 ? '' : [
    ...(sameSize ? [`${shown[0].width} × ${shown[0].height}`] : []),
    files > 1 ? `${files} PNGs` : 'PNG',
  ].join(' · ') + sides + rotated

  const changeMode = (next: Mode) => {
    lastMode = next
    setMode(next)
  }
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
      const { downloadFile, exportImages, exportTilt } = await import('../lib/exportMedia')
      downloadFile(await (image
        ? exportImages(project.name, imageOptions, setProgress, controller.signal)
        : exportTilt(project.name, options, setProgress, controller.signal)))
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
          <Segmented value={mode} options={MODES} onChange={changeMode} />
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
            {several && !image && <CheckboxField label="Export as separate files" checked={separate} onChange={setSeparate} />}
          </SettingsGroup>

          {image ? (
            <SettingsGroup title="Image">
              <InlineField label="Angle" title="The tilt the security features are seen at; the banknote itself stays flat">
                <div className="flex gap-2">
                  <ScrubField className="flex-1" label="↕" title="Up/down tilt" value={angle.y} min={-TILT_LIMIT} max={TILT_LIMIT} unit="°"
                    onChange={(y) => setAngle((a) => ({ ...a, y }))} />
                  <ScrubField className="flex-1" label="↔" title="Side tilt" value={angle.x} min={-TILT_LIMIT} max={TILT_LIMIT} unit="°"
                    onChange={(x) => setAngle((a) => ({ ...a, x }))} />
                </div>
              </InlineField>
            </SettingsGroup>
          ) : (
            <>
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
            </>
          )}
        </fieldset>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          {busy ? (
            <Progress className="flex-1" value={Math.round(progress * 100)} />
          ) : (
            <span className="text-xs text-muted-foreground tabular-nums">
              {image ? imageSummary : notes.length > 0 && `${size.width} × ${size.height} · ${size.seconds.toFixed(1)} s${files > 1 ? ` · ${files} files` : ''}${sides}${rotated}${backlit ? ' · held to the light' : ''}`}
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
