import { Banknote, Columns2, RectangleHorizontal, RectangleVertical, Rows2, Shuffle, TriangleAlert } from 'lucide-react'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { Drawer, Group, IconButton, Labeled, LengthField, Panel, Section, Segmented, SwitchField } from '../components/controls'
import { sideImageId, type Side } from '../lib/back'
import { clamp } from '../lib/frames'
import { featureName, fitLayers, moveLayersTo } from '../lib/layers'
import { NOTE_SIZE } from '../lib/notes'
import { mod, patternOf } from '../lib/pattern'
import { setPatternOffset, shufflePatternOffset, usePatternOffsets } from '../lib/patternOffset'
import { windowReports } from '../lib/patternRules'
import { updateNote } from '../lib/store'
import { fitSections } from '../lib/thread'
import type { Note } from '../lib/types'
import { showsBack, useTilt } from '../tilt/tilt'
import { FEATURE_ICONS } from './AddFeatureMenu'
import { ArcEnCielPanel } from './ArcEnCielPanel'
import { ChecksDrawer, ContinuousSection } from './DesignChecks'
import { EffectSection, LensMenu, LensPreview, ThreadPrint, type SetLens } from './EffectSection'
import { DesignCards } from './DesignCards'
import { FramePanel } from './FramePanel'
import { MagneticInkPanel } from './MagneticInkPanel'
import { PanelResizer } from './PanelResizer'
import { FitTileButton, ThreadWidthField, TileLengthField } from './ThreadSizeFields'
import { WatermarkPanel } from './WatermarkPanel'
import { WindowsCard } from './WindowsCard'
import type { NoteRef } from './frameActions'
import { useTimelineFrame } from './useTimelineFrame'
import type { Layer } from './layerActions'

type Change = (note: Note) => Note

/**
 * Right: the part of the selected banknote picked on the canvas or in the Banknotes list, one at a time, so the panel never
 * grows with features, under a header with its name and icon from the list (Keller, 9 November: no tabs, and a feature's
 * own name once it is renamed there): the banknote itself (size, its two sides), its security thread (where it sits and
 * its lens, with the lens's preview in a drawer at the foot; what is printed on it, its artwork and sections, is designed
 * in Thread Studio, which opens from the button above the timeline) and its watermark, Arc-en-Ciel and magnetic ink once
 * it has them. Every control has a small label over it (`Labeled`) unless a word in it or beside it already says what it
 * is.
 */
export function Inspector({ note, noteRef, layer, onWindowSelect, onPlace, windowsTip, onWindowsTipDone }: {
  note: Note
  noteRef: NoteRef
  layer: Layer
  /** Selecting a window edits it on the canvas; undefined leaves window editing */
  onWindowSelect: (id: string | undefined) => void
  /** Shows the placed layer the panel shows on the canvas, flat, with its box to place it */
  onPlace: () => void
  /** The tip by Windows saying they can be added there (a new project's first banknote), and its end */
  windowsTip?: boolean
  onWindowsTipDone?: () => void
}) {
  const update = (change: Change) => updateNote(noteRef.projectId, noteRef.noteId, change)
  const { thread } = note
  const setThread = (patch: Partial<Note['thread']>) => update((n) => ({ ...n, thread: { ...n.thread, ...patch } }))
  const acrossOf = (n: Pick<Note, 'widthMm' | 'heightMm'>, direction: Note['thread']['direction']) =>
    direction === 'vertical' ? n.widthMm : n.heightMm
  // The watermark, Arc-en-Ciel and magnetic ink stay where they were, as far as they fit (wholly on the banknote if they were)
  const setSize = (widthMm: number, heightMm: number) =>
    update((n) => fitLayers({
      ...n,
      widthMm,
      heightMm,
      thread: { ...n.thread, positionMm: clamp(n.thread.positionMm, 0, acrossOf({ widthMm, heightMm }, n.thread.direction)),
        windows: { ...n.thread.windows, sections: fitSections(n.thread.windows.sections, n.thread.direction === 'vertical' ? heightMm : widthMm) } },
    }, n))
  // Turning the thread keeps it at the same relative position across the note
  const setDirection = (direction: Note['thread']['direction']) =>
    update((n) => ({
      ...n,
      thread: {
        ...n.thread,
        direction,
        windows: { ...n.thread.windows, sections: fitSections(n.thread.windows.sections, direction === 'vertical' ? n.heightMm : n.widthMm) },
        positionMm: Math.round((n.thread.positionMm / acrossOf(n, n.thread.direction)) * acrossOf(n, direction) * 2) / 2,
      },
    }))
  // Turning the note keeps the thread and the placed layers at the same relative position across it
  const flipOrientation = () =>
    update((n) => {
      const flipped = { widthMm: n.heightMm, heightMm: n.widthMm }
      const across = acrossOf(n, n.thread.direction)
      const positionMm = Math.round((n.thread.positionMm / across) * acrossOf(flipped, n.thread.direction) * 2) / 2
      return moveLayersTo({ ...n, ...flipped, thread: { ...n.thread, positionMm, windows: { ...n.thread.windows, sections: fitSections(n.thread.windows.sections, n.thread.direction === 'vertical' ? flipped.heightMm : flipped.widthMm) } } }, n)
    })
  const portrait = note.heightMm >= note.widthMm
  // An uploaded design can be checked: whether it joins up at its edges, and is light where the brief asks. The checks
  // are for the side the canvas shows, the back's once the banknotes are turned over
  const side: Side = useTilt(showsBack) ? 'back' : 'front'
  const hasDesign = sideImageId(note, side) !== undefined

  return (
    <>
    {/* Under the canvas's corner bar (zoom and Export), at the height Thread Studio's panel starts */}
    <PanelResizer className="top-16" />
    <Panel className="absolute top-16 right-3 bottom-3 flex w-(--panel-w) flex-col overflow-hidden">
      {/* What is picked, with its name and icon from the Banknotes list: the banknote's own name, or a feature's, which is
          what it is until it is renamed there (Keller, 9 November, in place of a tab for each part). Export is in the
          corner bar above the panel */}
      <div className="shrink-0 border-b border-border px-4 pt-3 pb-2.5">
        <h2 className="flex h-7 items-center gap-1.5 text-[13px] font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0">
          {layer === 'note' ? <Banknote /> : layer === 'thread' ? (thread.direction === 'vertical' ? <Columns2 /> : <Rows2 />) : FEATURE_ICONS[layer]}
          <span className="min-w-0 truncate">{layer === 'note' ? note.name : featureName(note, layer)}</span>
        </h2>
      </div>

      {/* The picked part's own settings, scrolled to their top for each part */}
      <div key={layer} className="min-h-0 flex-1 overflow-y-auto text-sm">
      {layer === 'note' && (
      <Group>
      <Section nested>
        <Labeled label="Orientation">
          <Segmented
            value={portrait ? 'portrait' : 'landscape'}
            options={[
              { value: 'portrait', label: <RectangleVertical className="size-3.5" aria-label="Portrait" /> },
              { value: 'landscape', label: <RectangleHorizontal className="size-3.5" aria-label="Landscape" /> },
            ]}
            onChange={(next) => {
              if ((next === 'portrait') !== portrait) flipOrientation()
            }}
          />
        </Labeled>
        {/* A size typed past the limits shows an error under its field and isn't taken (Keller) */}
        <div className="grid grid-cols-2 items-start gap-2">
          <Labeled label="Width">
            <LengthField label="W" value={note.widthMm} min={NOTE_SIZE.min} max={NOTE_SIZE.max} step={0.5} strict onChange={(w) => setSize(w, note.heightMm)} />
          </Labeled>
          <Labeled label="Height">
            <LengthField label="H" value={note.heightMm} min={NOTE_SIZE.min} max={NOTE_SIZE.max} step={0.5} strict onChange={(h) => setSize(note.widthMm, h)} />
          </Labeled>
        </div>
      </Section>

      {/* Front and Back side by side, each its design and nothing else (Keller): working on one turns the banknotes to it */}
      <Section nested>
        <DesignCards note={note} noteRef={noteRef} />
      </Section>
      {hasDesign && <ContinuousSection note={note} noteRef={noteRef} />}
      </Group>
      )}

      {layer === 'thread' && (
      <Group>
      <Section nested>
        <Labeled label="Direction">
          <Segmented
            value={thread.direction}
            options={[
              { value: 'vertical', label: 'Vertical' },
              { value: 'horizontal', label: 'Horizontal' },
            ]}
            onChange={setDirection}
          />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          {/* How big the thread is: its width, and the tile its artwork repeats in, as beside it in Thread Studio (Keller) */}
          {/* Across the thread: its width when it runs down the banknote, its height when it runs across (Keller) */}
          <Labeled label={thread.direction === 'vertical' ? 'Width' : 'Height'}>
            <ThreadWidthField note={note} noteRef={noteRef} />
          </Labeled>
          <Labeled label="Tile length" action={<FitTileButton note={note} noteRef={noteRef} />}>
            <TileLengthField note={note} noteRef={noteRef} />
          </Labeled>
          <Labeled label="Position">
          <LengthField
            label={thread.direction === 'vertical' ? 'X' : 'Y'}
            title={thread.direction === 'vertical' ? 'Thread position from the left edge' : 'Thread position from the top edge'}
            value={thread.positionMm}
            min={0}
            max={acrossOf(note, thread.direction)}
            step={0.5}
            onChange={(positionMm) => setThread({ positionMm })}
          />
          </Labeled>
        </div>
        <WindowsCard note={note} noteRef={noteRef} onWindowSelect={onWindowSelect} tip={windowsTip} onTipDone={onWindowsTipDone} />
      </Section>

      <TimelineFrame note={note} noteRef={noteRef} />
      <LensEffect note={note} noteRef={noteRef} />
      <PrintOffset note={note} onWindowSelect={onWindowSelect} />
      </Group>
      )}

      {layer === 'watermark' && note.watermark && <WatermarkPanel note={note} watermark={note.watermark} noteRef={noteRef} onPlace={onPlace} />}
      {layer === 'arcEnCiel' && note.arcEnCiel && <ArcEnCielPanel note={note} arc={note.arcEnCiel} noteRef={noteRef} onPlace={onPlace} />}
      {layer === 'magneticInk' && note.magneticInk && <MagneticInkPanel note={note} ink={note.magneticInk} noteRef={noteRef} onPlace={onPlace} />}
      </div>
      {layer === 'thread' && <PreviewDrawer note={note} />}
      {layer === 'note' && hasDesign && <ChecksDrawer note={note} side={side} />}
    </Panel>
    </>
  )
}

/**
 * The frame the timeline is on and its fill, as in Thread Studio's Frames tab: Keller wants it here too, as a normal
 * control, but not the frame numbers (the timeline picks the frame here) or where an image sits in the tile (here it
 * fits the width, the tile following it; Thread Studio places it by hand). Its own component, so only it follows the
 * tilt
 */
function TimelineFrame({ note, noteRef }: { note: Note; noteRef: NoteRef }) {
  const { frame, index, show } = useTimelineFrame(note)
  return <FramePanel note={note} noteRef={noteRef} frame={frame} index={index} onShow={show} picker={false} place={false} />
}

/**
 * The thread's lens, a section of the thread: its basic controls, as in the thread editor, its preview in the drawer at
 * the panel's foot. With mixed angles each section has its own lens, edited in Thread Studio, so nothing here.
 */
function LensEffect({ note, noteRef }: { note: Note; noteRef: NoteRef }) {
  const set: SetLens = (patch) => updateNote(noteRef.projectId, noteRef.noteId, (n) => ({ ...n, tilt: { ...n.tilt, ...patch } }))
  // With Mixed angles each section plays its own lens, set in Thread Studio; the switch says so, and turning it off here
  // brings back the one lens for every section (Keller missed the lens on a banknote with it on)
  if (patternOf(note).mixed) {
    return (
      <Section nested title="Lens effect">
        <SwitchField label="Mixed angles" title="Each section plays its own lens, set in Thread Studio; off, every section plays the one set here" checked
          onChange={(mixed) => updateNote(noteRef.projectId, noteRef.noteId, (n) => ({ ...n, pattern: { ...patternOf(n), mixed } }))} />
      </Section>
    )
  }
  return <EffectSection note={note} set={set} title="Lens effect" action={<LensMenu note={note} set={set} />} preview={false} />
}

/** Whether the preview drawer is open, kept as you go from banknote to banknote (the panel is rebuilt for each) */
const usePreviewDrawer = create<{ open: boolean }>(() => ({ open: false }))

/**
 * The thread's preview at the panel's foot, as in the thread editor: the lens angle and cycle, the frames each tilt shows
 * and the tilt map, or the print; with mixed angles, the print of every section together
 */
function PreviewDrawer({ note }: { note: Note }) {
  const open = usePreviewDrawer((s) => s.open)
  const mixed = patternOf(note).mixed
  return (
    <Drawer title="Preview" open={open} onOpenChange={(next) => usePreviewDrawer.setState({ open: next })}
      action={mixed ? <span className="text-[11px] text-muted-foreground" title="Mixed angles is on: each section plays its own lens">Mixed</span> : undefined}>
      {mixed ? <ThreadPrint note={note} /> : <LensPreview note={note} />}
    </Drawer>
  )
}

/**
 * Where the print lands along the thread. It isn't registered to the banknote, so this only previews one landing
 * (remembered per browser, never saved in the project): Shuffle tries another. Shown only when some section is
 * shorter than the repeat, since lanes look the same wherever they land. Windows that miss a tilt (or frames only one
 * tilt shows) at this landing are listed, rule 1; a click selects the window.
 */
function PrintOffset({ note, onWindowSelect }: { note: Note; onWindowSelect: (id: string | undefined) => void }) {
  const saved = usePatternOffsets((s) => s.offsets[note.id] ?? 0)
  const pattern = patternOf(note)
  const repeat = pattern.repeatMm
  if (!pattern.sections.some((s) => s.startMm > 1e-6 || s.endMm < repeat - 1e-6)) return null
  const misses = windowReports(note, saved).flatMap((w) => {
    const now = w.misses.filter((m) => m.now)
    if (!now.length) return []
    const share = Math.max(...w.misses.map((m) => m.share))
    return [{ id: w.windowId, text: `${w.label} misses ${now.map((m) => m.label).join(' · ')}`, title: `At ${Math.round(share * 100)}% of offsets` }]
  })
  return (
    <Section nested>
      <div className="flex items-center gap-1">
        <LengthField className="flex-1" label="Offset" title="Where the print lands along the thread: a preview, not saved in the project"
          value={mod(saved, repeat)} min={0} max={repeat} step={0.1} onChange={(mm) => setPatternOffset(note.id, mm)} />
        <IconButton label="Shuffle the offset" onClick={() => shufflePatternOffset(note.id, repeat)}><Shuffle /></IconButton>
      </div>
      {misses.length > 0 && (
        <div className="flex flex-col">
          {misses.map((miss) => (
            <Button key={miss.id ?? 'thread'} variant="ghost" size="xs" title={miss.title}
              className="h-auto min-h-6 justify-start py-1 text-left leading-snug font-normal whitespace-normal text-amber-700 dark:text-amber-500"
              onClick={() => onWindowSelect(miss.id)}>
              <TriangleAlert />
              {miss.text}
            </Button>
          ))}
        </div>
      )}
    </Section>
  )
}
