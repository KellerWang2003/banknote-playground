import { ChevronDown, ChevronLeft, ChevronRight, Columns2, Copy, GripVertical, Plus, Redo2, Rows2, Trash2, Undo2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { IconButton, Panel } from '../components/controls'
import { CloudStatus } from '../components/CloudStatus'
import { runAction, reportError } from '../cloud/notices'
import { NoteView } from '../components/NoteView'
import { duplicateNote, moveNote, removeNote, updateNote, updateProject, undoProject, redoProject } from '../lib/store'
import { useHistory } from '../lib/history'
import { featureParts } from '../lib/extras'
import { FEATURE_NAMES, featureName, type Feature } from '../lib/layers'
import { useTiltPad } from '../lib/tiltPad'
import type { Note, Project } from '../lib/types'
import { AddFeatureMenu, FEATURE_ICONS } from './AddFeatureMenu'
import { renameFeature, type Layer } from './layerActions'

const THUMB = 28

/** A banknote's block being dragged up or down the list by its grip, measured from the list's top as the drag began */
interface NoteDrag {
  id: string
  from: number
  /** Every block's top and height, in the list's order */
  tops: number[]
  heights: number[]
  /** Where the pointer took hold */
  grabY: number
  /** How far the block has come since */
  dy: number
}

/** How far the dragged block has come with the pointer `y` px below the list's top: as far as the pointer, within the list */
function dragAlong({ from, tops, heights, grabY }: NoteDrag, y: number) {
  const last = tops.length - 1
  return Math.max(tops[0] - tops[from], Math.min(tops[last] + heights[last] - tops[from] - heights[from], y - grabY))
}

/**
 * Where the dragged block lands: the place nearest to where it is, of those it would take with the others making room
 * (its top at the top of the block it takes the place of, or after it, its bottom at that one's bottom), so the top and
 * bottom of the list are first and last whatever the blocks' heights
 */
function landing({ from, tops, heights, dy }: NoteDrag) {
  const at = tops[from] + dy
  const place = (k: number) => (k <= from ? tops[k] : tops[k] + heights[k] - heights[from])
  let to = 0
  for (let k = 1; k < tops.length; k++) if (Math.abs(place(k) - at) < Math.abs(place(to) - at)) to = k
  return to
}

/** How far the block at `i` moves meanwhile: the dragged one with the pointer, those it has passed out of its way */
function shiftOf(drag: NoteDrag, i: number) {
  if (i === drag.from) return drag.dy
  const to = landing(drag)
  // The dragged block's height and the gap after it
  const room = drag.heights[drag.from] + drag.tops[1] - drag.tops[0] - drag.heights[0]
  if (drag.from < i && i <= to) return -room
  if (to <= i && i < drag.from) return room
  return 0
}

/**
 * Top-left: back to the projects, the project's name, and its banknotes as a collapsible list. Each banknote opens
 * to its security features (its threads, watermarks, Arc-en-Ciels and magnetic inks, as many of each as it has, each on
 * a row of its own: added from the Add menu, on the + on its row or, for the selected one, the "Add security feature" row
 * under its features, and removed from the bin on its own row); the selected one opens by itself. A grip at the left of a banknote's row, on hover, drags it up
 * or down the list (Keller, 9 November: "should be able to re-arrange these"), its features with it, the others making
 * room, and it lands where it is let go, one undo step saved with the project; with the grip focused, the up and down
 * arrow keys move it too.
 */
export function ProjectPanel({
  project,
  isDemo = false,
  selectedId,
  layer,
  onSelect,
  onAdd,
  addTip = false,
  onAddLayer,
  onRemoveLayer,
  aboveTilt = false,
}: {
  project: Project
  isDemo?: boolean
  selectedId: string | undefined
  /** The selected banknote's layer the right panel shows */
  layer: Layer
  /** A banknote row picks the banknote itself (no layer, or 'note'), a layer row that layer */
  onSelect: (noteId: string, layer?: Layer) => void
  onAdd: () => void
  /** A tip beside Add banknote saying to start there, while the project has no banknote (Keller, 10 November) */
  addTip?: boolean
  onAddLayer: (noteId: string, feature: Feature) => void
  /** Removes one of the banknote's features, by its layer: the first of its kind or a further one */
  onRemoveLayer: (noteId: string, layer: Layer) => void
  /** The tilt pad sits under the panel, bottom left, so the list stops short of it */
  aboveTilt?: boolean
}) {
  const history = useHistory((state) => state.entries[project.id])
  const [open, setOpen] = useState(true)
  const [renaming, setRenaming] = useState<string>()
  const [deleting, setDeleting] = useState<Note>()
  // Banknotes opened or closed by their chevron; picking another banknote goes back to only the selected one open
  const [toggled, setToggled] = useState<{ selection?: string; open: Record<string, boolean> }>({ open: {} })
  const overrides = toggled.selection === selectedId ? toggled.open : {}
  const isOpen = (id: string) => overrides[id] ?? id === selectedId
  // Above the tilt pad's card it stops short of it, whose height depends on whether the pad is open
  const padOpen = useTiltPad((s) => s.open)
  const list = useRef<HTMLUListElement>(null)
  const [drag, setDrag] = useState<NoteDrag>()
  // Only while the list is still as it was when the drag began
  const dragging = drag && drag.tops.length === project.notes.length && project.notes[drag.from]?.id === drag.id ? drag : undefined
  const endDrag = (drop: boolean) => {
    setDrag(undefined)
    if (!drop || !dragging) return
    const to = landing(dragging)
    if (to !== dragging.from) moveNote(project.id, dragging.id, to)
  }

  return (
    <Panel className={cn('absolute top-3 left-3 flex w-[224px]', aboveTilt ? cn(padOpen ? 'max-h-[calc(100%-342px)]' : 'max-h-[calc(100%-200px)]', 'min-h-12') : 'max-h-[calc(100%-120px)]', 'flex-col')}>
      <div className="flex items-center justify-between gap-1 p-1.5">
        <Button variant="ghost" size="sm" className="rounded-lg px-1.5" onClick={() => (location.hash = '')}>
          <ChevronLeft />
          {isDemo ? 'Exit demo' : 'Projects'}
        </Button>
        <div className="flex items-center gap-0.5">
          <IconButton className="rounded-lg" label="Undo" title="Undo (⌘/Ctrl+Z)" disabled={!history?.past.length} onClick={() => undoProject(project.id)}><Undo2 /></IconButton>
          <IconButton className="rounded-lg" label="Redo" title="Redo (⌘/Ctrl+Shift+Z)" disabled={!history?.future.length} onClick={() => redoProject(project.id)}><Redo2 /></IconButton>
        </div>
      </div>
      <div className="flex items-center gap-2 pb-1.5 pl-1.5 pr-3">
        <Input
          aria-label="Project name"
          className="h-8 flex-1 border-transparent font-medium shadow-none hover:border-input"
          value={project.name}
          onChange={(e) => updateProject(project.id, (p) => ({ ...p, name: e.target.value }))}
        />
        <div className="shrink-0"><CloudStatus isDemo={isDemo} /></div>
      </div>
      <Separator />

      <Collapsible open={open} onOpenChange={setOpen} className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between py-1 pr-1.5 pl-1.5">
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              />
            }
          >
            Banknotes · {project.notes.length}
            <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
          </CollapsibleTrigger>
          <div className="relative flex">
            <IconButton label="Add banknote" size="icon-xs" onClick={onAdd}>
              <Plus />
            </IconButton>
            {/* Anchored to a box over the + rather than the + itself, which keeps its own tooltip and its click, as the
                windows tip is */}
            {addTip && (
              <Tooltip open>
                <TooltipTrigger render={<span aria-hidden className="pointer-events-none absolute inset-0" />} />
                {/* Past the panel's edge, so it sits over the canvas with its arrow at the + */}
                <TooltipContent side="right" sideOffset={16}>Start by adding a banknote here</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <CollapsibleContent className="min-h-0 overflow-y-auto">
          <ul ref={list} className="flex flex-col gap-0.5 px-1.5 pb-1.5">
            {project.notes.map((note, index) => {
              const selected = note.id === selectedId
              // The banknote itself picked: its grey runs on behind its features, as they are part of it (Keller)
              const picked = selected && layer === 'note'
              const expanded = isOpen(note.id)
              // Every feature it has, as many of each kind as it has, each as its own code sees it (extras.ts)
              const parts = featureParts(note)
              const dragged = dragging?.id === note.id
              const shift = dragging ? shiftOf(dragging, index) : 0
              return (
              <li
                key={note.id}
                className={cn(
                  'rounded-lg',
                  picked && 'bg-muted/67',
                  // Lifted while dragged, solid so the rows it passes don't show through it; the others glide out of its way
                  dragging && (dragged ? cn('z-10 shadow-md', picked ? 'bg-muted' : 'bg-background') : 'transition-transform'),
                )}
                style={shift ? { transform: `translateY(${shift}px)` } : undefined}
              >
                <div className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(note.id, 'note')}
                  onDoubleClick={() => setRenaming(note.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg py-1 pr-1.5 pl-6 text-left transition-colors group-has-[[data-popup-open]]:pr-20',
                    'group-hover:pr-20',
                    !picked && 'hover:bg-muted/50',
                  )}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center">
                    <NoteView note={note} scale={THUMB / Math.max(note.widthMm, note.heightMm)} />
                  </span>
                  {renaming === note.id ? (
                    <Input
                      autoFocus
                      aria-label="Banknote name"
                      className="h-6 px-1 text-sm"
                      defaultValue={note.name}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const name = e.target.value.trim()
                        if (name) updateNote(project.id, note.id, (n) => ({ ...n, name }))
                        setRenaming(undefined)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setRenaming(undefined)
                      }}
                    />
                  ) : (
                    <span className={cn('min-w-0 flex-1 truncate text-sm', selected && 'font-medium')}>{note.name}</span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={expanded ? `Hide layers of ${note.name}` : `Show layers of ${note.name}`}
                  aria-expanded={expanded}
                  onClick={() => setToggled({ selection: selectedId, open: { ...overrides, [note.id]: !expanded } })}
                  className="absolute top-1/2 left-1 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
                </button>
                {project.notes.length > 1 && renaming !== note.id && (
                  // In the gap left of the chevron, so the row keeps its layout; shown on hover, as the row's actions are
                  <span
                    role="button"
                    tabIndex={0}
                    data-note-grip={note.id}
                    aria-label={`Move ${note.name}`}
                    title="Drag to reorder"
                    className={cn(
                      'absolute inset-y-0 -left-1.5 flex w-4 touch-none items-center justify-end rounded-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50',
                      dragged ? 'cursor-grabbing text-foreground' : 'cursor-grab opacity-0 group-hover:opacity-100',
                    )}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || !list.current) return
                      e.preventDefault()
                      e.currentTarget.setPointerCapture(e.pointerId)
                      const top = list.current.getBoundingClientRect().top
                      const blocks = [...list.current.children].map((block) => block.getBoundingClientRect())
                      setDrag({ id: note.id, from: index, tops: blocks.map((b) => b.top - top), heights: blocks.map((b) => b.height), grabY: e.clientY - top, dy: 0 })
                    }}
                    onPointerMove={(e) => {
                      if (dragging?.id !== note.id || !list.current) return
                      // Its release went missing
                      if (e.buttons === 0) return endDrag(true)
                      setDrag({ ...dragging, dy: dragAlong(dragging, e.clientY - list.current.getBoundingClientRect().top) })
                    }}
                    onPointerUp={() => endDrag(true)}
                    onPointerCancel={() => endDrag(false)}
                    onLostPointerCapture={() => endDrag(false)}
                    onKeyDown={(e) => {
                      const to = index + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0)
                      if (to === index || to < 0 || to >= project.notes.length) return
                      e.preventDefault()
                      moveNote(project.id, note.id, to)
                      // The grip goes with its banknote
                      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-note-grip="${note.id}"]`)?.focus())
                    }}
                  >
                    <GripVertical className="size-3" />
                  </span>
                )}
                {renaming !== note.id && (
                  <div className="absolute inset-y-0 right-1 hidden items-center group-hover:flex has-[[data-popup-open]]:flex">
                    <AddFeatureMenu onAdd={(feature) => onAddLayer(note.id, feature)} />
                    <IconButton
                      label="Duplicate"
                      size="icon-xs"
                      onClick={async () => {
                        try {
                          const id = await duplicateNote(project.id, note.id)
                          if (id) onSelect(id)
                        } catch (error) { reportError(error) }
                      }}
                    >
                      <Copy />
                    </IconButton>
                    <IconButton label="Delete" size="icon-xs" onClick={() => setDeleting(note)}>
                      <Trash2 />
                    </IconButton>
                  </div>
                )}
                </div>
                {expanded && parts.length > 0 && (
                  <ul aria-label={`Layers of ${note.name}`} className="flex flex-col gap-0.5 pt-0.5">
                    {/* A further one is renamed through its view, as its own code sees it (extras.ts) */}
                    {parts.map((part) => (
                      <LayerRow
                        key={part.layer}
                        icon={part.feature === 'thread' ? (part.note.thread.direction === 'vertical' ? <Columns2 /> : <Rows2 />) : FEATURE_ICONS[part.feature]}
                        name={featureName(part.note, part.feature)}
                        kind={FEATURE_NAMES[part.feature]}
                        selected={selected && layer === part.layer}
                        onBlock={picked}
                        onSelect={() => onSelect(note.id, part.layer)}
                        onRename={(name) => renameFeature({ projectId: project.id, noteId: part.note.id }, part.feature, name)}
                        onRemove={() => onRemoveLayer(note.id, part.layer)}
                      />
                    ))}
                  </ul>
                )}
                {/* Under the selected banknote's features, the way to add more (Keller) */}
                {expanded && selected && (
                  <div className="ml-[52px] pt-0.5">
                    <AddFeatureMenu row={{ onBlock: picked }} onAdd={(feature) => onAddLayer(note.id, feature)} />
                  </div>
                )}
              </li>
              )
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={deleting !== undefined} onOpenChange={(next) => !next && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) runAction(removeNote(project.id, deleting.id))
                setDeleting(undefined)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  )
}

/**
 * One part of a banknote, under it in the list, a level in from the banknote's own row and smaller (Keller, 4
 * November): its icon lines up with the banknote's name, 13 px, its highlight starting just before the icon, and its
 * name 6 px after the icon (Keller). A double-click renames it, as a banknote's row does (Keller, 9 November): Enter or
 * clicking away keeps the name, Escape leaves it as it was.
 */
function LayerRow({ icon, name, kind, selected, onBlock = false, onSelect, onRename, onRemove }: {
  icon: ReactNode
  /** Its own name, once it has one, else what it is */
  name: string
  /** What it is, whatever it is called: Security thread, Watermark… */
  kind: string
  selected: boolean
  /** On its banknote's grey, the banknote itself being picked: its hover darkens that grey */
  onBlock?: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onRemove?: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  return (
    // The banknote's name starts 60 px in (its row's 24 px padding, 28 px thumbnail and 8 px gap): the icon starts there
    <li className="group/layer relative ml-[52px]">
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => setRenaming(true)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg py-1 pr-1.5 pl-2 text-left transition-colors',
          onRemove && 'group-hover/layer:pr-8',
          selected ? 'bg-muted/67' : onBlock ? 'hover:bg-foreground/5' : 'hover:bg-muted/50',
        )}
      >
        <span className={cn('flex h-5 shrink-0 items-center [&_svg]:size-3.5', selected ? 'text-foreground' : 'text-muted-foreground')}>
          {icon}
        </span>
        {renaming ? (
          // As tall as the name's line, so the row keeps its height
          <Input
            autoFocus
            aria-label={`${kind} name`}
            className="-my-0.5 h-6 px-1 py-0 text-[13px] md:text-[13px]"
            defaultValue={name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              onRename(e.target.value)
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
        )}
      </button>
      {onRemove && !renaming && (
        <div className="absolute inset-y-0 right-1 hidden items-center group-hover/layer:flex">
          <IconButton label={`Remove ${kind.toLowerCase()}`} size="icon-xs" onClick={onRemove}>
            <Trash2 />
          </IconButton>
        </div>
      )}
    </li>
  )
}
