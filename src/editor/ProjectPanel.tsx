import { ChevronDown, ChevronLeft, ChevronRight, Columns2, Copy, Plus, Redo2, Rows2, Trash2, Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
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
import { cn } from '@/lib/utils'
import { IconButton, Panel } from '../components/controls'
import { CloudStatus } from '../components/CloudStatus'
import { runAction, reportError } from '../cloud/notices'
import { NoteView } from '../components/NoteView'
import { duplicateNote, removeNote, updateNote, updateProject, undoProject, redoProject } from '../lib/store'
import { useHistory } from '../lib/history'
import { FEATURES, FEATURE_NAMES, PLACED_LAYERS, featureName, hasFeature, hasThread, type Feature } from '../lib/layers'
import { useTiltPad } from '../lib/tiltPad'
import type { Note, Project } from '../lib/types'
import { AddFeatureMenu, FEATURE_ICONS } from './AddFeatureMenu'
import { renameFeature, type Layer } from './layerActions'

const THUMB = 28

/**
 * Top-left: back to the projects, the project's name, and its banknotes as a collapsible list. Each banknote opens
 * to its security features (its thread, watermark and magnetic ink, as it has them: each added from the Add menu, on
 * the + on its row or, for the selected one, the "Add security feature" row under its features, and removed from the
 * bin on its own row); the selected one opens by itself.
 */
export function ProjectPanel({
  project,
  isDemo = false,
  selectedId,
  layer,
  onSelect,
  onAdd,
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
  onAddLayer: (noteId: string, layer: Feature) => void
  onRemoveLayer: (noteId: string, layer: Feature) => void
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
          <IconButton label="Add banknote" size="icon-xs" onClick={onAdd}>
            <Plus />
          </IconButton>
        </div>
        <CollapsibleContent className="min-h-0 overflow-y-auto">
          <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5">
            {project.notes.map((note) => {
              const selected = note.id === selectedId
              // The banknote itself picked: its grey runs on behind its features, as they are part of it (Keller)
              const picked = selected && layer === 'note'
              const expanded = isOpen(note.id)
              // The + lists only the features the banknote doesn't have yet, and goes once it has them all
              const canAdd = FEATURES.some((f) => !hasFeature(note, f))
              return (
              <li key={note.id} className={cn('rounded-lg', picked && 'bg-muted')}>
                <div className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(note.id, 'note')}
                  onDoubleClick={() => setRenaming(note.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg py-1 pr-1.5 pl-6 text-left transition-colors group-has-[[data-popup-open]]:pr-20',
                    canAdd ? 'group-hover:pr-20' : 'group-hover:pr-14',
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
                {renaming !== note.id && (
                  <div className="absolute inset-y-0 right-1 hidden items-center group-hover:flex has-[[data-popup-open]]:flex">
                    <AddFeatureMenu note={note} onAdd={(feature) => onAddLayer(note.id, feature)} />
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
                {expanded && FEATURES.some((f) => hasFeature(note, f)) && (
                  <ul aria-label={`Layers of ${note.name}`} className="flex flex-col gap-0.5 pt-0.5">
                    {hasThread(note) && (
                      <LayerRow
                        icon={note.thread.direction === 'vertical' ? <Columns2 /> : <Rows2 />}
                        name={featureName(note, 'thread')}
                        kind={FEATURE_NAMES.thread}
                        selected={selected && layer === 'thread'}
                        onBlock={picked}
                        onSelect={() => onSelect(note.id, 'thread')}
                        onRename={(name) => renameFeature({ projectId: project.id, noteId: note.id }, 'thread', name)}
                        onRemove={() => onRemoveLayer(note.id, 'thread')}
                      />
                    )}
                    {PLACED_LAYERS.filter((l) => note[l]).map((l) => (
                      <LayerRow
                        key={l}
                        icon={FEATURE_ICONS[l]}
                        name={featureName(note, l)}
                        kind={FEATURE_NAMES[l]}
                        selected={selected && layer === l}
                        onBlock={picked}
                        onSelect={() => onSelect(note.id, l)}
                        onRename={(name) => renameFeature({ projectId: project.id, noteId: note.id }, l, name)}
                        onRemove={() => onRemoveLayer(note.id, l)}
                      />
                    ))}
                  </ul>
                )}
                {/* Under the selected banknote's features, the way to add more (Keller) */}
                {expanded && selected && canAdd && (
                  <div className="ml-[52px] pt-0.5">
                    <AddFeatureMenu note={note} row={{ onBlock: picked }} onAdd={(feature) => onAddLayer(note.id, feature)} />
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
          selected ? 'bg-muted' : onBlock ? 'hover:bg-foreground/5' : 'hover:bg-muted/50',
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
