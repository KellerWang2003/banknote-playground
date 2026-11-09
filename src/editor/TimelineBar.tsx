import { reportError } from '../cloud/notices'
import { EyeOff, Hash, ImagePlus, Pause, Pencil, Play, Plus, SlidersHorizontal, SquareDashed, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { IconButton, Panel } from '../components/controls'
import { FrameThumb } from '../components/NoteView'
import { clamp, cyclePhase } from '../lib/frames'
import { cyclePosition, flatLabel, flatStep, lensState, reachSpans, respondsTo, revealLevelAt, revealReaches, tiltForPosition, tiltReach, type Axis, type LensState } from '../lib/lens'
import { pickFiles } from '../lib/images'
import { DEFAULT_TILT, LENGTH_LIMITS, MAX_FRAMES, MIN_FRAMES } from '../lib/notes'
import { usePasteImages } from '../lib/pasteImages'
import { setTiltPadOpen } from '../lib/tiltPad'
import { framesMissed, patternOf, playbackLens, playbackTilt, sectionMix, setSectionLens, timelineSection } from '../lib/pattern'
import { updateNote } from '../lib/store'
import type { Note, TiltSettings } from '../lib/types'
import { framesTiltOf, scrubFrames, setRecording, setTilt, togglePlayback, useTilt } from '../tilt/tilt'
import { FrameFillPanel } from './FillPicker'
import { PlaybackPanel } from './PlaybackPanel'
import { TILT_PANEL_PX } from './TiltRail'
import { addEmptyFrame, addImageFrames, deleteFrame, moveFrameTo, updateFrame, type NoteRef } from './frameActions'

const PAD = 12
/** The track's padding before the frames while it has lanes: room for their ↕ and ↔, which Keller wanted a little bigger again */
const LANE_PAD = 18
/** The + after the last frame: its gap from the last clip and its width, px */
const ADD_GAP = 4
const ADD_PX = 28
/** Height of one tilt-reach lane above the frames, in px: room for its ↕ or ↔, which Keller wanted bigger (4 November) */
const LANE = 12
/** Thickness of a lane's bar, px */
const BAR = 6
/** Height of the band above the frames to scrub on when there are no lanes there, px */
const SCRUB_BAND = 14
/** Pixels per unit of frame length; a new frame (10 units) starts 100 px wide */
const ZOOM = { min: 3, max: 40, initial: 10 }

/**
 * Bottom of the canvas: play and pause with the project's playback controls stacked beside it, always, as wide
 * as the tilt pad's panel above them; while a banknote's thread is picked the panel widens to show its frames, on
 * the front only, where the thread is.
 */
export function TimelineBar({
  projectId,
  notes,
  note,
  noteRef,
  besidePanel,
  sectionId,
}: {
  projectId: string
  notes: Note[]
  /** The banknote whose lens the playback settings follow (else the first), and whose frames the track shows */
  note?: Note
  /** Where its frames are edited: the track shows only with it, which the canvas passes only while the thread is picked */
  noteRef?: NoteRef
  besidePanel: boolean
  /** The thread section whose lens the track follows, in the thread editor */
  sectionId?: string
}) {
  const source = useTilt((state) => state.source)
  const playing = source === 'wobble'
  // The thread is only on the front: turned over, even a selected banknote has no frames to show, so the bar stays
  // as it is with nothing selected (Keller). It follows the switch rather than the turn, so they go as Back is pressed
  const flipped = useTilt((state) => state.flipped)
  const trackNote = flipped || !noteRef ? undefined : note

  return (
    <Panel
      className={cn(
        'absolute bottom-3 left-3 flex h-[88px] items-stretch gap-2 p-2',
        trackNote && (besidePanel ? 'right-[calc(var(--panel-w)+20px)]' : 'right-3'),
      )}
    >
      <div className="flex shrink-0 gap-2" style={{ width: TILT_PANEL_PX - 2 * 8 - 2 }}>
        <IconButton
          label={playing ? 'Pause' : 'Play'}
          variant={playing ? 'default' : 'outline'}
          size="icon"
          className="size-auto flex-1 rounded-lg [&_svg:not([class*='size-'])]:size-6"
          onClick={togglePlayback}
        >
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <FrameSettings projectId={projectId} note={note ?? notes.at(0)} />
      </div>
      {trackNote && noteRef && <FrameTrack note={trackNote} noteRef={noteRef} sectionId={sectionId} />}
    </Panel>
  )
}

/** One of the small buttons stacked beside Play, sharing the column's height (each with the same border, so the shares match) */
const STACKED = 'min-h-0 flex-1 rounded-md border border-transparent'

/**
 * Project-wide playback controls, shared by every banknote, stacked in a column beside Play: Playback settings on top,
 * the # frame-number toggle under it. A move is recorded from the settings' list of moves (Record a move), which closes
 * them, opens the tilt pad to drag on and arms recording; Escape cancels it (`TiltRail`).
 */
function FrameSettings({ projectId, note }: { projectId: string; note?: Note }) {
  // A thread mixing ridge angles plays each tilt at its fastest section's cycle
  const tilt = note ? playbackTilt(note) : DEFAULT_TILT
  const lens = note ? playbackLens(note) : lensState(tilt)
  const frameNumbers = useTilt((s) => s.frameNumbers)
  // Held here so Record a move can close it, leaving the pad free to drag on
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex w-8 shrink-0 flex-col gap-0.5">
      <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Tooltip>
          <TooltipTrigger
            render={<PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Playback settings" className={cn(STACKED, 'size-auto')} />} />}
          >
            <SlidersHorizontal className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>Playback settings</TooltipContent>
        </Tooltip>
        <PopoverContent side="top" align="start" sideOffset={12} className="w-[580px] gap-0 overflow-hidden p-0">
          <PopoverTitle className="border-b px-3 py-2.5 text-sm">Playback settings</PopoverTitle>
          <PlaybackPanel projectId={projectId} tilt={tilt} lens={lens}
            onRecord={() => {
              setSettingsOpen(false)
              setTiltPadOpen(true)
              setRecording(true)
            }} />
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label="Frame numbers on threads"
              pressed={frameNumbers}
              onPressedChange={(on) => setTilt({ frameNumbers: on })}
              className={cn(STACKED, 'h-auto min-w-0 px-0 aria-pressed:bg-primary aria-pressed:text-primary-foreground')}
            />
          }
        >
          <Hash className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>{frameNumbers ? 'Hide frame numbers on threads' : 'Show frame numbers on threads'}</TooltipContent>
      </Tooltip>
    </div>
  )
}

/** A clip being dragged along the track: how far, and where in the order it would land */
type ClipDrag = { frameId: string; from: number; dx: number; to: number }

/**
 * The selected banknote's frames as one cycle of clips on a track, plus its frame settings. A frame's width is its
 * share of the cycle; drag its right edge to change that. Each clip handles itself, as Keller laid out: drag it along
 * to change the order (the others slide aside), a click goes to it, the pencil at its top right edits its fill, and
 * the × at its top left, on hover, deletes it. The playhead shows where in the cycle the current tilt is, wrapping
 * around as the frames loop; drag the line itself, by a wide grab area round it, or press on the track round the
 * frames (a band above them is kept for it), to scrub. Scroll to move along,
 * ⌘-scroll to zoom.
 */
function FrameTrack({ note, noteRef, sectionId }: { note: Note; noteRef: NoteRef; sectionId?: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const gesture = useRef<
    | { mode: 'scrub' }
    | { mode: 'resize'; frameId: string; startX: number; startLength: number }
    | { mode: 'drag'; frameId: string; from: number; startX: number; moved: boolean }
    | { mode: 'reach' }
    | null
  >(null)
  const [drag, setDrag] = useState<ClipDrag>()
  const [pxPerUnit, setPxPerUnit] = useState(ZOOM.initial)
  // Images pasted while the pointer is over the + come in as frames, as Upload images brings them
  const pasteFrames = usePasteImages((files) => addImageFrames(noteRef, files))
  const { frames } = note
  // One section's lens (the first, or the one picked in the thread editor); a plain thread's is the banknote's
  const followed = timelineSection(note, sectionId)
  const { lens, tilt } = followed
  // Only the frame shown, so the track re-renders when it changes rather than on every animation frame
  const current = useTilt((s) => sectionMix(note, followed, framesTiltOf(s, note.id)).current)
  // Frames a tilt plays somewhere on the thread yet never shows anywhere
  const unseen = framesMissed(note)
  const missed = (i: number) => unseen.at(i) ?? []
  const lengths = frames.map((f) => f.length)
  const totalLength = lengths.reduce((sum, l) => sum + l, 0)
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((sum, l) => sum + l, 0))
  const bars = (['y', 'x'] as const).filter((a) => respondsTo(lens, a)).map((a) => ({ axis: a, spans: reachSpans(lens.offset, tiltReach(lens, a)) }))
  // With both tilts live, each tilt's reach gets its own lane above the frames instead of sitting on them; either way
  // a band above the frames is there to scrub on
  const lanes = bars.length > 1 ? bars.length : 0
  const pad = lanes ? LANE_PAD : PAD
  const x = (units: number) => pad + units * pxPerUnit
  const laneTop = (row: number) => 2 + row * LANE
  const framesTop = lanes ? 4 + lanes * LANE : SCRUB_BAND
  // Partial reveal: the slow tilt's lane has two ends to drag, hiding more or fewer frames as the band on the Lens effect's
  // Seen flat strip does (Keller); either end snaps to the reach nearest it
  const slowAxis: Axis | undefined = lens.effect === 'reveal' ? (lens.revealAxis === 'y' ? 'x' : 'y') : undefined
  const reaches = slowAxis ? revealReaches(frames, lens.offset, (lens.revealAxis === 'y' ? lens.cycleY : lens.cycleX) ?? 0, lens.wobble) : []
  const reachEnds = slowAxis && reaches.length
    ? [lens.offset - tiltReach(lens, slowAxis), lens.offset + tiltReach(lens, slowAxis)].map((end) => ((end % 1) + 1) % 1)
    : []
  const level = Math.min(Math.max(0, Math.round(tilt.revealLevel ?? 0)), Math.max(0, reaches.length - 1))
  /** Changes the lens the track follows: the banknote's, or with Mixed angles that section's own */
  const setLens = (patch: Partial<TiltSettings>) => updateNote(noteRef.projectId, noteRef.noteId, (n) =>
    patternOf(n).mixed ? { ...n, pattern: setSectionLens(n, followed.section.id, patch) } : { ...n, tilt: { ...n.tilt, ...patch } })
  const reachTo = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect()
    if (!rect || !reaches.length) return
    const next = revealLevelAt(reaches, lens.offset, clamp((clientX - rect.left - pad) / (totalLength * pxPerUnit), 0, 1))
    if (next !== level) setLens({ revealLevel: next })
  }

  // Wheel: ⌘/Ctrl zooms the timeline, a plain vertical wheel scrolls it sideways
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        setPxPerUnit((p) => clamp(p * Math.exp(-clamp(e.deltaY, -40, 40) * 0.01), ZOOM.min, ZOOM.max))
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        element.scrollLeft += e.deltaY
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const scrubTo = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect()
    if (!rect) return
    const u = clamp((clientX - rect.left - pad) / (totalLength * pxPerUnit), 0, 1)
    // It picks the frames shown and leaves the banknotes' tilt alone (Keller)
    scrubFrames(note.id, tiltForPosition(lens, u))
  }
  /** Goes to the middle of a frame, as a click on its clip does */
  const goTo = (i: number) => scrubTo((track.current?.getBoundingClientRect().left ?? 0) + x((starts.at(i) ?? 0) + (lengths.at(i) ?? 0) / 2))
  /** Where in the order a clip dragged `dx` px from frame `from` lands: past every other clip whose middle it has passed */
  const landing = (from: number, dx: number) => {
    const middle = x((starts.at(from) ?? 0) + (lengths.at(from) ?? 0) / 2) + dx
    return frames.filter((_, k) => k !== from && x((starts.at(k) ?? 0) + (lengths.at(k) ?? 0) / 2) < middle).length
  }
  /** How far each clip slides while another is dragged, px: the dragged one with the pointer, those it passes aside */
  const slide = (k: number) => {
    if (!drag) return 0
    if (k === drag.from) return drag.dx
    const gap = (lengths.at(drag.from) ?? 0) * pxPerUnit
    if (drag.from < k && k <= drag.to) return -gap
    if (drag.to <= k && k < drag.from) return gap
    return 0
  }

  return (
    <>
      <div className="w-px shrink-0 bg-border" />
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden rounded-lg bg-muted/40">
        <div
          ref={track}
          className="relative h-full touch-none overflow-hidden select-none"
          style={{ width: x(totalLength) + ADD_GAP + ADD_PX + PAD }}
          onPointerDown={(e) => {
            const el = e.target as HTMLElement
            if (e.button !== 0 || el.closest('button') || el.closest('[role=menu]')) return
            const handle = el.closest<HTMLElement>('[data-resize]')
            const resized = frames.find((f) => f.id === handle?.dataset.resize)
            const clip = el.closest<HTMLElement>('[data-frame-clip]')
            const from = frames.findIndex((f) => f.id === clip?.dataset.frameClip)
            if (el.closest('[data-reach]')) {
              gesture.current = { mode: 'reach' }
            } else if (resized) {
              gesture.current = { mode: 'resize', frameId: resized.id, startX: e.clientX, startLength: resized.length }
            } else if (from >= 0 && !el.closest('[data-playhead]')) {
              gesture.current = { mode: 'drag', frameId: frames[from].id, from, startX: e.clientX, moved: false }
            } else {
              // The line itself (Keller), or the track round the frames, the band above them included, scrubs: a moving
              // line during playback is hard to catch, and a press there stops it
              gesture.current = { mode: 'scrub' }
              scrubTo(e.clientX)
            }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const g = gesture.current
            // The release never reached us: stop following the pointer
            if (g && e.buttons === 0) {
              gesture.current = null
              return
            }
            if (g?.mode === 'scrub') scrubTo(e.clientX)
            if (g?.mode === 'reach') reachTo(e.clientX)
            if (g?.mode === 'drag') {
              const dx = e.clientX - g.startX
              // Past a few px a press becomes a drag, so a click still goes to the frame
              if (!g.moved && Math.abs(dx) < 4) return
              g.moved = true
              setDrag({ frameId: g.frameId, from: g.from, dx, to: landing(g.from, dx) })
            }
            if (g?.mode === 'resize' && noteRef) {
              const length = clamp(Math.round(g.startLength + (e.clientX - g.startX) / pxPerUnit), LENGTH_LIMITS.min, LENGTH_LIMITS.max)
              updateFrame(noteRef, g.frameId, { length })
            }
          }}
          onPointerUp={(e) => {
            const g = gesture.current
            gesture.current = null
            if (g?.mode !== 'drag') return
            setDrag(undefined)
            // A click goes to the frame; a drag puts it where it was let go
            if (!g.moved) goTo(g.from)
            else moveFrameTo(noteRef, g.frameId, landing(g.from, e.clientX - g.startX))
          }}
          onPointerCancel={() => {
            gesture.current = null
            setDrag(undefined)
          }}
          onLostPointerCapture={() => {
            gesture.current = null
            setDrag(undefined)
          }}
        >
          {frames.map((frame, i) => {
            const left = x(starts.at(i) ?? 0)
            const width = frame.length * pxPerUnit
            return (
              <div
                key={frame.id}
                data-frame-clip={frame.id}
                className={cn(
                  'group absolute bottom-1 cursor-grab overflow-hidden rounded-sm border bg-background',
                  i === current && 'ring-1 ring-primary/30',
                  // The dragged clip follows the pointer above the others, which slide aside
                  drag?.from === i ? 'z-10 cursor-grabbing shadow-md' : drag && 'transition-transform duration-150',
                )}
                style={{ top: framesTop, left: left + 1, width: Math.max(width - 2, 4), transform: drag ? `translateX(${slide(i)}px)` : undefined }}
              >
                <FrameThumb frame={frame} backgroundColor={note.thread.backgroundColor} />
                {width > 28 && (
                  <span className={cn('absolute top-0.5 left-1 rounded bg-background/80 px-1 text-[10px] font-medium tabular-nums',
                    frames.length > MIN_FRAMES && !drag && 'group-hover:opacity-0')}>
                    {i + 1}
                  </span>
                )}
                {missed(i).length > 0 && (
                  // Big enough to read at a glance which tilt never shows it (Keller)
                  <span
                    className="absolute bottom-0.5 left-1 flex items-center gap-0.5 rounded bg-background/80 px-1 text-xs leading-4 font-semibold"
                    title={missed(i).map((a) => (a === 'y' ? 'Never seen tilting up or down' : 'Never seen tilting side to side')).join('; ')}
                  >
                    <EyeOff className="size-3.5" />
                    {missed(i).map((a) => (a === 'y' ? '↕' : '↔')).join('')}
                  </span>
                )}
                {/* On hover: × at the top left deletes it (while more than the fewest frames are left) */}
                {frames.length > MIN_FRAMES && !drag && (
                  <Button variant="secondary" size="icon-xs" aria-label={`Delete frame ${i + 1}`}
                    className="absolute top-0.5 left-0.5 size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => void deleteFrame(noteRef, frame.id)}>
                    <X className="size-3" />
                  </Button>
                )}
                {/* The pencil at the top right edits its fill, in the same panel as the right panel's, going to the frame */}
                <FrameFillPanel note={note} noteRef={noteRef} frame={frame} side="top" align="center"
                  onOpenChange={(open) => {
                    if (open) goTo(i)
                  }}
                  trigger={
                    <Button variant="secondary" size="icon-xs" aria-label={`Edit frame ${i + 1}`}
                      className={cn('absolute top-0.5 right-2 size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100',
                        drag && 'hidden')}>
                      <Pencil className="size-3" />
                    </Button>
                  } />
                <div
                  data-resize={frame.id}
                  aria-label={`Change frame ${i + 1} length`}
                  className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize bg-foreground/0 transition-colors hover:bg-primary/40"
                />
              </div>
            )
          })}

          {lanes > 0 && bars.map(({ axis, spans }, row) => (
            // The frames each tilt alone shows: how far it reaches either way from flat (to ±90°), wrapping round the loop
            <div key={axis} className="absolute" style={{ top: laneTop(row) + (LANE - BAR) / 2, height: BAR, left: x(0), width: totalLength * pxPerUnit }}
              title={axis === 'y' ? 'Frames tilting up or down shows' : 'Frames tilting side to side shows'}>
              <div className="absolute inset-0 rounded-full bg-foreground/5" />
              {spans.map(([lo, hi], k) => (
                <div key={k} className={cn('absolute inset-y-0 rounded-full', axis === 'y' ? 'bg-sky-500' : 'bg-amber-500')} style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} />
              ))}
              {axis === slowAxis && reachEnds.map((end, k) => (
                // Where it meets the frames it never shows; above the playhead, being the smaller target
                <div key={k} data-reach="" title={`${axis === 'y' ? '↕' : '↔'} reach: drag to hide more or fewer frames`}
                  className="absolute -inset-y-[3px] z-30 w-4 -translate-x-1/2 cursor-ew-resize" style={{ left: `${end * 100}%` }}>
                  <div className={cn('absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full ring-2 ring-background', axis === 'y' ? 'bg-sky-600' : 'bg-amber-600')} />
                </div>
              ))}
            </div>
          ))}
          {lanes > 0 && bars.map(({ axis }, row) => (
            // Which lane is which, just left of the first frame, big enough to read (Keller), clear of the lane's start
            <span key={axis} className={cn('pointer-events-none absolute flex items-center justify-center text-sm leading-none font-semibold', axis === 'y' ? 'text-sky-600' : 'text-amber-600')}
              style={{ top: laneTop(row), height: LANE, left: 0, width: pad - 2 }}>
              {axis === 'y' ? '↕' : '↔'}
            </span>
          ))}

          {/* Flat: what a straight-on view shows; set on the Lens effect strip */}
          <div className="pointer-events-none absolute bottom-0 -translate-x-1/2" style={{ left: x(lens.offset * totalLength) }}
            title={`Flat: ${flatLabel(flatStep(tilt, frames.length))}`}>
            <div className="size-0 border-x-4 border-b-[5px] border-x-transparent border-b-foreground/70" />
          </div>

          <Playhead noteId={note.id} lens={lens} left={x(0)} width={totalLength * pxPerUnit} />

          {/* Just after the last frame, as tall as the clips, rather than at the bar's far end (Keller) */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  {...pasteFrames}
                  type="button"
                  aria-label="Add frame"
                  disabled={frames.length >= MAX_FRAMES && !frames.every((f) => f.kind !== 'image')}
                  className="absolute bottom-1 flex items-center justify-center rounded-sm border border-dashed border-foreground/25 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  style={{ top: framesTop, left: x(totalLength) + ADD_GAP, width: ADD_PX }}
                />
              }
            >
              <Plus className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-44" side="top" align="start">
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    const files = await pickFiles({ multiple: true })
                    if (files.length) await addImageFrames(noteRef, files)
                  } catch (error) { reportError(error) }
                }}
              >
                <ImagePlus />
                Upload images
              </DropdownMenuItem>
              <DropdownMenuItem disabled={frames.length >= MAX_FRAMES} onClick={() => addEmptyFrame(noteRef)}>
                <SquareDashed />
                Empty frame
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  )
}

/**
 * Where in the cycle the current tilt is; on its own so it alone re-renders as the tilt moves. Dragging the line
 * scrubs, from anywhere in a wide grab area round it (Keller)
 */
function Playhead({ noteId, lens, left, width }: { noteId: string; lens: LensState; left: number; width: number }) {
  const phase = useTilt((s) => cyclePhase(cyclePosition(lens, framesTiltOf(s, noteId)), 1))
  return (
    <div data-playhead="" aria-label="Playhead" className="absolute inset-y-0 z-20 w-4 -translate-x-1/2 cursor-ew-resize" style={{ left: left + phase * width }}>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary" />
      <div className="pointer-events-none absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-primary" />
    </div>
  )
}
