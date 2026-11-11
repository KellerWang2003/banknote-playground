import { ChevronLeft, CircleCheck, Columns2, Copy, Eye, EyeOff, GalleryHorizontal, Info, Plus, Redo2, RotateCcw, Rows2, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { Drawer, Group, IconButton, Labeled, Panel, PartTab, Section, SwitchField, TabStrip } from '../components/controls'
import { canStepNote, useHistory } from '../lib/history'
import {
  addBlankSection,
  duplicateSection,
  fillGaps,
  isIdentity,
  patternOf,
  playbackLens,
  playbackTilt,
  preparePattern,
  removeSection,
  sectionSlots,
  sectionView,
  setSectionLens,
  setSectionTrack,
  updateSection,
} from '../lib/pattern'
import { PATTERN_PRESETS, presetPattern } from '../lib/patternPresets'
import { checkPattern, warningCount, type PatternCheck } from '../lib/patternRules'
import { stepNote, updateNote } from '../lib/store'
import { useTiltPad } from '../lib/tiltPad'
import type { Note, Project, ThreadPattern, ThreadSection } from '../lib/types'
import { EffectSection, LensMenu, LensPreview, ThreadPrint, type SetLens } from './EffectSection'
import { Explain, RidgeIcon, swatch } from './LensVisuals'
import { PanelResizer } from './PanelResizer'
import { PatternPicture } from './PatternPicture'
import { PatternView } from './PatternView'
import { FramePanel } from './FramePanel'
import { TiltRail } from './TiltRail'
import { TimelineBar } from './TimelineBar'
import { useTimelineFrame } from './useTimelineFrame'
import { popupOpen } from '../lib/popups'

/**
 * One banknote's thread pattern, full screen. Top: back, the banknote, the ridges and undo. Left: Mixed angles, the
 * presets it allows and the sections. Middle: the thread magnified, where the frame's image is placed and sections
 * resized, and the view panned, zoomed and tilted. Right, in two tabs as on the canvas (Keller): Thread, the selected
 * section's frames and the lens (the section's own with mixed angles, otherwise the shared one), and Frames, the
 * frame the timeline is on: where its image sits and what it shows. Thread is open first; a click on the thread turns
 * to Frames, and nothing else turns them. Where the thread sits on the banknote is set on the canvas. Under them,
 * fixed at the bottom, Preview and Checks, for information only, open upwards. Bottom: the tilt pad and the playback
 * bar, as on the canvas.
 */
export function ThreadEditor({ project, note, onClose }: { project: Project; note: Note; onClose: () => void }) {
  const pattern = patternOf(note)
  const [selectedId, setSelectedId] = useState(() => pattern.sections.at(0)?.id)
  const selectSection = setSelectedId
  const [ridges, setRidges] = useState(false)
  // How strongly the ridges show, while they show
  const [ridgeOpacity, setRidgeOpacity] = useState(1)
  // The right panel's tab: the whole thread, or the frames. A click on the thread turns to Frames, and letting go of
  // it, by a click around it or Escape, back to Thread (Keller)
  const [tab, setTab] = useState<'thread' | 'frames'>('thread')
  const selectOnThread = (id: string | undefined) => {
    selectSection(id)
    if (!id) setTab('thread')
  }
  // Preview and Checks open one at a time, as an accordion, so the controls above always keep room
  const [info, setInfo] = useState<'preview' | 'checks'>()
  const openInfo = (part: 'preview' | 'checks') => (open: boolean) => setInfo(open ? part : undefined)
  // The left panel stops short of the tilt pad's card, whose height depends on whether the pad is open
  const padOpen = useTiltPad((s) => s.open)
  const history = useHistory((s) => s.entries[project.id])
  // Undo here only takes back this banknote's steps; the canvas's undo still covers the whole project
  const canUndo = canStepNote(project, note.id, 'undo', history)
  const canRedo = canStepNote(project, note.id, 'redo', history)
  // A section undone away, or removed, is simply no longer selected
  const selected = pattern.sections.find((s) => s.id === selectedId)
  const selectedSectionId = selected?.id
  // The frame the timeline is on, for the section it follows (the selected one, else the first): the right panel
  // shows it, and its image can be handled on the thread
  const timelineFrame = useTimelineFrame(note, selectedSectionId)
  const canRemove = pattern.sections.length > 1
  const noteRef = { projectId: project.id, noteId: note.id }
  const checks = checkPattern(note)
  const warnings = warningCount(checks)
  const lens = playbackLens(note)
  const vertical = note.thread.direction === 'vertical'

  /** Saves a pattern worked out from the banknote as it is when saved */
  const edit = (change: (n: Note) => ThreadPattern) => updateNote(project.id, note.id, (n) => ({ ...n, pattern: change(n) }))
  // Removing the selected section selects the next one in the list, else the one before, so the panel stays on a section
  const remove = (id: string) => {
    edit((n) => removeSection(patternOf(n), id))
    if (id === selectedId) selectSection(neighbourOf(pattern, id))
  }
  const added = (result: { pattern: ThreadPattern; id: string } | undefined) => {
    if (!result) return
    edit(() => result.pattern)
    selectSection(result.id)
  }

  // Escape deselects, then goes back to the canvas; Delete removes the selected section. Caught before the
  // editor's own keys, which would otherwise clear the banknote selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      if (e.key !== 'Escape' && e.key !== 'Delete' && e.key !== 'Backspace') return
      const element = e.target instanceof Element ? e.target : null
      if (element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      if (popupOpen()) return
      e.preventDefault()
      if (e.key === 'Escape') {
        if (selectedSectionId || tab === 'frames') {
          setSelectedId(undefined)
          setTab('thread')
        } else onClose()
      } else if (selectedSectionId && canRemove) {
        updateNote(project.id, note.id, (n) => ({ ...n, pattern: removeSection(patternOf(n), selectedSectionId) }))
        setSelectedId(neighbourOf(pattern, selectedSectionId))
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [selectedSectionId, tab, canRemove, onClose, project.id, note.id, pattern])

  // ⌘Z and ⇧⌘Z (or Ctrl+Y) undo and redo this banknote's steps only, caught before the canvas's project-wide undo
  useEffect(() => {
    const onHistory = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.isComposing) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const element = e.target instanceof Element ? e.target : null
      // Text fields keep native text undo while they are being edited
      if (element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      if (popupOpen()) return
      e.preventDefault()
      stepNote(project.id, note.id, key === 'y' || e.shiftKey ? 'redo' : 'undo')
    }
    window.addEventListener('keydown', onHistory, { capture: true })
    return () => window.removeEventListener('keydown', onHistory, { capture: true })
  }, [project.id, note.id])

  // The lens the right panel edits: the selected section as the lens sees it (its strips as frames, its own lens
  // with mixed angles), or the banknote's own; with mixed angles every change lands on that section only, and with
  // nothing selected the panel shows the whole print instead
  const lensNote = selected ? sectionView(note, selected) : pattern.mixed ? undefined : note
  const setLens: SetLens = (patch) =>
    pattern.mixed && selectedSectionId
      ? edit((n) => setSectionLens(n, selectedSectionId, patch))
      : updateNote(project.id, note.id, (n) => ({ ...n, tilt: { ...n.tilt, ...patch } }))

  return (
    <div role="region" aria-label="Thread editor" data-thread-editor="" className="absolute inset-0 z-10 bg-background">
      <div className="absolute inset-0 bg-muted/40" />

      {/* The whole editor, behind the panels, as on the canvas; the thread fits between them, and fits again once turned */}
      <PatternView key={note.thread.direction} note={note} projectId={project.id} selectedId={selectedSectionId} onSelect={selectOnThread} ridges={ridges} ridgeOpacity={ridgeOpacity}
        frame={timelineFrame.index} onThreadClick={() => setTab('frames')}
        limit={lens.viewDeg} room="top-16 right-[calc(var(--panel-w)+24px)] bottom-[112px] left-[248px]" />

      <Panel className="absolute top-3 right-3 left-3 flex h-11 items-center gap-2 rounded-[calc(var(--radius)+0.375rem+1px)] pr-1.5 pl-1.5">
        <IconButton className="rounded-lg" label="Back to the canvas" onClick={onClose}><ChevronLeft /></IconButton>
        <span className="min-w-0 truncate text-sm font-medium">{note.name}</span>
        <span className="shrink-0 text-sm text-muted-foreground">Thread Studio</span>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {warnings > 0 && (
            <Button variant="ghost" size="sm" className="text-amber-600 dark:text-amber-500" title="Rule warnings: show the checks"
              onClick={() => setInfo('checks')}>
              <TriangleAlert />
              {warnings}
            </Button>
          )}
          <Toggle size="sm" aria-label="Ridges" title={ridges ? "Hide each section's ridges" : "Show each section's ridges"} pressed={ridges} onPressedChange={setRidges}>
            {ridges ? <Eye /> : <EyeOff />}
            Ridges
          </Toggle>
          {/* A slider fills its box, so the box holds its width and the toggles keep theirs */}
          {ridges && (
            <div className="flex w-24 shrink-0 items-center" title="How strongly the ridges show">
              <Slider value={[Math.round(ridgeOpacity * 100)]} min={10} max={100} step={5} thumbLabel={() => 'Ridge opacity'}
                onValueChange={(value) => { const [v] = Array.isArray(value) ? value : [value]; if (v !== undefined) setRidgeOpacity(v / 100) }} />
            </div>
          )}
          <div className="flex items-center gap-0.5">
            <IconButton className="rounded-lg" label="Undo" title="Undo (⌘/Ctrl+Z)" disabled={!canUndo} onClick={() => stepNote(project.id, note.id, 'undo')}><Undo2 /></IconButton>
            <IconButton className="rounded-lg" label="Redo" title="Redo (⌘/Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => stepNote(project.id, note.id, 'redo')}><Redo2 /></IconButton>
          </div>
        </div>
      </Panel>

      {/* As wide as the canvas's Banknotes panel */}
      <Panel className={cn('absolute top-16 left-3 flex min-h-12 w-[224px] flex-col rounded-[calc(var(--radius)+0.375rem+1px)]',
        padOpen ? 'max-h-[calc(100%-406px)]' : 'max-h-[calc(100%-264px)]')}>
        {/* The hero control: whether sections can each have their own lens, and so which presets apply */}
        <div className="px-3 pt-3 pb-2">
          <SwitchField label="Mixed angles" title="Each section plays its own lens; off, every section plays the banknote's"
            checked={pattern.mixed} onChange={(mixed) => edit((n) => ({ ...patternOf(n), mixed }))} />
        </div>
        <Separator />
        <div className="flex flex-col gap-2 p-3 pb-2">
          <h2 className="text-[11px] font-medium text-muted-foreground">Presets</h2>
          <div className="grid grid-cols-2 gap-1.5">
            {PATTERN_PRESETS.filter((preset) => pattern.mixed || !preset.mixed).map((preset) => (
              <Button key={preset.value} variant="outline" title={preset.title} className="h-auto flex-col gap-1.5 p-2 text-xs font-normal"
                onClick={() => {
                  // A preset never switches Mixed angles: it is only offered when it fits the setting
                  const next = { ...presetPattern(note, preset.value), mixed: pattern.mixed }
                  edit(() => next)
                  selectSection(next.sections.at(0)?.id)
                }}>
                <PatternPicture note={note} pattern={presetPattern(note, preset.value)} width={vertical ? 40 : 76} height={vertical ? 52 : 29} />
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
        <Separator />
        <SectionList note={note} selectedId={selectedSectionId} onSelect={selectSection}
          onAdd={() => added(addBlankSection(pattern, note.thread.widthMm, selectedSectionId))}
          onDuplicate={(id) => added(duplicateSection(pattern, id, note.thread.widthMm))}
          onRemove={canRemove ? remove : undefined}
          onRename={(id, name) => edit((n) => updateSection(patternOf(n), id, { name }))} />
      </Panel>

      <PanelResizer className="top-16" />
      <Panel className="absolute top-16 right-3 bottom-3 flex w-(--panel-w) flex-col overflow-hidden">
        <Tabs value={tab} onValueChange={(next) => setTab(next as typeof tab)} className="min-h-0 flex-1 gap-0">
        {/* Its parts as pill tabs, as on the canvas's panel: the whole thread, then its frames */}
        <div className="flex border-b border-border px-4 pt-3 pb-2.5">
          <TabStrip active={tab}>
            <PartTab value="thread">{vertical ? <Columns2 /> : <Rows2 />}Thread</PartTab>
            <PartTab value="frames"><GalleryHorizontal />Frames</PartTab>
          </TabStrip>
        </div>

        <TabsContent value="thread" className="min-h-0 overflow-y-auto">
          {/* The selected section's strips, only once there are sections to tell apart: with one, the timeline's order
              says it all (Keller); its size comes from its edges on the thread */}
          {selected && pattern.sections.length > 1 && (
            <Group title={selected.name}>
              <Section nested title="Strips" action={
                <IconButton label="Every frame in order" size="icon-xs" disabled={isIdentity(sectionSlots(note.frames, selected))}
                  onClick={() => edit((n) => setSectionTrack(n, selected.id, n.frames.map((_, i) => i)))}>
                  <RotateCcw />
                </IconButton>
              }>
                <Labeled label="Frame each strip shows">
                  <TrackEditor note={note} section={selected} onChange={(slots) => edit((n) => setSectionTrack(n, selected.id, slots))} />
                </Labeled>
              </Section>
            </Group>
          )}
          {/* Mixed angles with nothing selected: no one lens to edit (Preview shows the print of them all) */}
          {lensNote && (
            <Group title="Lens" action={
              <div className="flex items-center gap-1">
                {!pattern.mixed && <span className="text-[11px] text-muted-foreground" title="Mixed angles is off: every section plays this lens">Shared</span>}
                <LensMenu note={lensNote} set={setLens} />
              </div>
            }>
              <EffectSection key={pattern.mixed ? selectedSectionId : 'shared'} note={lensNote} set={setLens} printNote={note} preview={false} />
            </Group>
          )}
        </TabsContent>

        {/* The frame the timeline is on: where its image sits, and what it shows */}
        <TabsContent value="frames" className="min-h-0 overflow-y-auto">
          <Group>
            <FramePanel note={note} noteRef={noteRef} frame={timelineFrame.frame} index={timelineFrame.index} onShow={timelineFrame.show} />
          </Group>
        </TabsContent>
        </Tabs>

        {/* For information only, so fixed at the bottom under the controls, opening upwards one at a time */}
        <div className="flex shrink-0 flex-col">
          <Drawer title="Preview" open={info === 'preview'} onOpenChange={openInfo('preview')} action={pattern.mixed && !lensNote
            ? <span className="text-[11px] text-muted-foreground" title="Mixed angles is on: each section plays its own lens">Mixed</span> : undefined}>
            {lensNote ? <LensPreview note={lensNote} printNote={note} /> : <ThreadPrint note={note} />}
          </Drawer>
          <Drawer title="Checks" open={info === 'checks'} onOpenChange={openInfo('checks')}
            action={warnings > 0 ? <span className="text-xs text-amber-600 tabular-nums dark:text-amber-500">{warnings}</span> : undefined}>
            <CheckList checks={checks} onSelect={selectSection} onFillGaps={() => added(fillGaps(pattern, note.thread.widthMm))} />
          </Drawer>
        </div>
      </Panel>

      <TiltRail limit={lens.viewDeg} playback={{ projectId: project.id, tilt: playbackTilt(note), lens }} />
      <TimelineBar projectId={project.id} notes={project.notes} note={note} noteRef={noteRef} besidePanel sectionId={selectedSectionId} />
    </div>
  )
}

/** The section to select once `id` is removed: the next in the list, else the one before */
function neighbourOf(pattern: ThreadPattern, id: string) {
  const i = pattern.sections.findIndex((s) => s.id === id)
  return i < 0 ? undefined : (pattern.sections[i + 1] ?? pattern.sections[i - 1])?.id
}

/** The sections, in drawing order, each with its ridges; double-click a name to rename it */
function SectionList({ note, selectedId, onSelect, onAdd, onDuplicate, onRemove, onRename }: {
  note: Note
  selectedId?: string
  onSelect: (id: string) => void
  onAdd: () => void
  onDuplicate: (id: string) => void
  /** Absent while only one section is left */
  onRemove?: (id: string) => void
  onRename: (id: string, name: string) => void
}) {
  const [renaming, setRenaming] = useState<string>()
  const cancelled = useRef(false)
  const { sections } = preparePattern(note)
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between py-1 pr-1.5 pl-3">
        <h2 className="text-[11px] font-medium text-muted-foreground">Sections · {sections.length}</h2>
        <IconButton label="Add section" size="icon-xs" onClick={onAdd}><Plus /></IconButton>
      </div>
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5">
        {sections.map(({ section, angle }) => {
          const on = section.id === selectedId
          return (
            <li key={section.id} className="group relative">
              {renaming === section.id ? (
                <Input
                  autoFocus
                  aria-label="Section name"
                  className="h-8 px-1.5 text-sm"
                  defaultValue={section.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim()
                    if (name && name !== section.name && !cancelled.current) onRename(section.id, name)
                    cancelled.current = false
                    setRenaming(undefined)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      cancelled.current = true
                      e.currentTarget.blur()
                    }
                  }}
                />
              ) : (
                <>
                  <Button variant="ghost" aria-pressed={on} title={`${Math.round(Math.abs(angle))}° ridges`}
                    className={cn('h-8 w-full justify-start gap-2 px-1.5 font-normal group-hover:pr-14', on ? 'bg-muted/67 hover:bg-muted/67' : 'hover:bg-muted/50')}
                    onClick={() => onSelect(section.id)} onDoubleClick={() => setRenaming(section.id)}>
                    <RidgeIcon angle={angle} />
                    <span className="min-w-0 flex-1 truncate text-left">{section.name}</span>
                  </Button>
                  <div className="absolute inset-y-0 right-1 hidden items-center group-hover:flex">
                    <IconButton label="Duplicate" size="icon-xs" onClick={() => onDuplicate(section.id)}><Copy /></IconButton>
                    <IconButton label="Delete" size="icon-xs" disabled={!onRemove} onClick={() => onRemove?.(section.id)}><Trash2 /></IconButton>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** One cell per strip of the section's print, as wide as its frame's share of the cycle: pick the frame each strip shows */
function TrackEditor({ note, section, onChange }: { note: Note; section: ThreadSection; onChange: (slots: number[]) => void }) {
  const slots = sectionSlots(note.frames, section)
  return (
    <div className="flex gap-1">
      {slots.map((frame, strip) => (
        <DropdownMenu key={strip}>
          <DropdownMenuTrigger render={
            <Button variant="outline" size="sm" aria-label={`Strip ${strip + 1}: frame ${frame + 1}`}
              className="min-w-0 flex-1 px-0 tabular-nums hover:border-foreground/30 aria-expanded:border-foreground/30"
              // Tinted like the frame strip and frame rows of the lens: mixing towards the background shifted the hue
              style={{ flexGrow: note.frames[strip]?.length ?? 1, backgroundColor: `color-mix(in oklch, ${swatch(note, frame)} 35%, transparent)` }} />
          }>
            {frame + 1}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-36">
            <DropdownMenuRadioGroup value={String(frame)} onValueChange={(v) => onChange(slots.map((f, k) => (k === strip ? Number(v) : f)))}>
              {note.frames.map((f, i) => (
                <DropdownMenuRadioItem key={f.id} value={String(i)} closeOnClick>
                  <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: swatch(note, i) }} />
                  Frame {i + 1}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </div>
  )
}

/** Every rule as a line, ticked or with what breaks it; a click on a problem selects its section, and gaps can be filled from here */
function CheckList({ checks, onSelect, onFillGaps }: { checks: PatternCheck[]; onSelect: (id: string) => void; onFillGaps: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      {checks.map((check) => {
        const clear = check.issues.length === 0
        const warn = !clear && check.level === 'warn'
        const Icon = clear ? CircleCheck : warn ? TriangleAlert : Info
        return (
          <div key={check.id} data-check={check.id} className="flex flex-col gap-0.5">
            <div className={cn('flex items-center gap-1.5 text-xs', clear && 'text-muted-foreground')}>
              <Icon className={cn('size-3.5 shrink-0', clear ? 'text-emerald-600 dark:text-emerald-500' : warn ? 'text-amber-600 dark:text-amber-500' : 'text-sky-600 dark:text-sky-500')} />
              <Explain label={check.title} caption={check.explain} />
            </div>
            {check.issues.map((issue, k) => {
              const { sectionId } = issue
              return sectionId ? (
                <Button key={k} variant="ghost" size="xs" title={issue.title}
                  className="h-auto min-h-6 justify-start py-1 pl-5 text-left leading-snug font-normal whitespace-normal text-muted-foreground"
                  onClick={() => onSelect(sectionId)}>
                  {issue.text}
                </Button>
              ) : check.id === 'gaps' ? (
                <div key={k} className="flex items-center gap-2 pl-5">
                  <p title={issue.title} className="min-w-0 flex-1 py-1 text-xs leading-snug text-muted-foreground">{issue.text}</p>
                  <Button variant="outline" size="xs" title="Fill each empty area: the section in line with it runs on over it, or a new one takes its look" onClick={onFillGaps}>Fill</Button>
                </div>
              ) : (
                <p key={k} title={issue.title} className="py-1 pl-5 text-xs leading-snug text-muted-foreground">{issue.text}</p>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
