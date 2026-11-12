import { Bird, ChevronDown, Copy, LogOut, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { IconButton } from '../components/controls'
import { CloudStatus } from '../components/CloudStatus'
import { importBrowserProjects, useWorkspace, openDemoPreview, signOut } from '../cloud/workspace'
import { runAction, reportError } from '../cloud/notices'
import { NoteSkeleton, NoteView } from '../components/NoteView'
import { createProject } from '../lib/notes'
import { updateProject, useProjects } from '../lib/store'
import type { Note, Project } from '../lib/types'
import { isPhone } from '../lib/demoLink'
import { askForMotion } from '../tilt/useDeviceTilt'

/**
 * A project opens in the editor, or on a phone (a small touch screen) in Demo, as the editor isn't made for one (Keller,
 * 10 November); an iPad still opens the editor. On a phone the tap that opens it also asks iPhone for motion, as Safari
 * asks only from a tap, so the question comes as Demo opens (Keller, 12 November: "once people open this on the phone, it
 * should ask for permission")
 */
const open = (id: string) => {
  const { workspace } = useWorkspace.getState()
  const demo = isPhone() && workspace
  if (demo) void askForMotion()
  location.hash = demo ? `#/play/${encodeURIComponent(workspace)}/${encodeURIComponent(id)}` : `#/p/${id}`
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4'

type Size = Pick<Note, 'widthMm' | 'heightMm'>

/**
 * The banknotes the skeleton cards show while the projects are on their way, as projects tend to hold them: a series
 * growing with its value, one alone, a pair, a series of four
 */
const SERIES: Size[][] = [
  [{ widthMm: 120, heightMm: 62 }, { widthMm: 127, heightMm: 66 }, { widthMm: 133, heightMm: 70 }],
  [{ widthMm: 150, heightMm: 70 }],
  [{ widthMm: 140, heightMm: 70 }, { widthMm: 150, heightMm: 75 }],
  [{ widthMm: 120, heightMm: 62 }, { widthMm: 127, heightMm: 65 }, { widthMm: 133, heightMm: 68 }, { widthMm: 140, heightMm: 72 }],
]
const SKELETON_CARDS = [0, 1, 2, 3, 2, 0, 3, 1].map((i) => SERIES[i])

/** A card's thumbnail: its first four banknotes side by side, at one scale so they keep their relative sizes */
function thumbnail<T extends Size>(notes: T[]) {
  const shown = notes.slice(0, 4)
  const totalWidth = shown.reduce((sum, n) => sum + n.widthMm, 0) + 6 * Math.max(0, shown.length - 1)
  const tallest = Math.max(...shown.map((n) => n.heightMm), 1)
  return { shown, scale: Math.min(150 / tallest, 190 / Math.max(totalWidth, 1)) }
}

export function ProjectList() {
  const projects = useProjects((s) => s.projects)
  const { legacyProjects, importing, loaded, listed } = useWorkspace()
  const [creating, setCreating] = useState(false)
  // Copies on their way (their artwork is copied first, from the cloud where this device hasn't it): each holds the place
  // its card will take, first in the list, with the banknotes it is copying
  const [copying, setCopying] = useState<{ key: string; notes: Note[] }[]>([])
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
  // Until the cloud has answered, a device with none of the workspace's projects can't tell none from still on their
  // way: their cards' skeletons show rather than No projects yet (as they do while this device's copy is read)
  const loading = !loaded || (!listed && projects.length === 0)
  const duplicate = (project: Project) => {
    const key = crypto.randomUUID()
    setCopying((all) => [...all, { key, notes: project.notes }])
    runAction(useProjects.getState().duplicate(project.id).finally(() => setCopying((all) => all.filter((copy) => copy.key !== key))))
  }

  return (
    <div className="flex h-full flex-col bg-muted/40">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-6">
        <span className="font-heading text-sm font-semibold">Banknote Playground</span>
        <div className="flex items-center gap-3">
          <CloudStatus />
          <AccountMenu />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <main className="flex min-w-0 flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <h1 className="font-heading text-lg font-semibold">
                Projects{' '}
                {loading ? (
                  <Skeleton className="inline-block h-4 w-3.5 rounded-sm align-[-1px]" />
                ) : (
                  <span className="font-normal text-muted-foreground tabular-nums">{projects.length}</span>
                )}
              </h1>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await openDemoPreview()
                    } catch (error) {
                      reportError(error)
                    }
                  }}
                >
                  <Bird />
                  Sample project
                </Button>
                <Button onClick={() => setCreating(true)}>
                  <Plus />
                  New project
                </Button>
              </div>
            </div>

            {legacyProjects.length > 0 && (
              <div className="flex items-center justify-between gap-4 rounded-lg border bg-background px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm">
                    {legacyProjects.length} browser {legacyProjects.length === 1 ? 'project' : 'projects'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{legacyProjects.map((project) => project.name).join(' · ')}</span>
                </div>
                <Button variant="outline" disabled={importing} onClick={() => runAction(importBrowserProjects())}>
                  {importing ? 'Importing…' : 'Import browser projects'}
                </Button>
              </div>
            )}

            {loading ? (
              <ul aria-busy="true" aria-label="Loading projects" className={GRID}>
                {SKELETON_CARDS.map((notes, i) => (
                  <ProjectCardSkeleton key={i} notes={notes} />
                ))}
              </ul>
            ) : sorted.length > 0 || copying.length > 0 ? (
              <ul className={GRID}>
                {copying.map((copy) => (
                  <ProjectCardSkeleton key={copy.key} notes={copy.notes} />
                ))}
                {sorted.map((project) => (
                  <ProjectCard key={project.id} project={project} onDuplicate={() => duplicate(project)} />
                ))}
              </ul>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <Plus className="size-5" />
                No projects yet
              </button>
            )}
          </main>
        </div>
      </div>

      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

/** Username and sign-out, tucked into a menu in the top bar */
function AccountMenu() {
  const workspace = useWorkspace((s) => s.workspace) ?? ''
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-2 px-1.5" aria-label={`Account: ${workspace}`}>
            <span className="flex size-6 items-center justify-center rounded-full bg-brand text-[11px] font-medium text-brand-foreground uppercase">
              {workspace.slice(0, 1)}
            </span>
            <span className="max-w-32 truncate">{workspace}</span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">Workspace · {workspace}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => runAction(signOut())}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NewProjectDialog({ open: isOpen, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  // A project can be added once this device's copy of the workspace has been read (a moment after it opens)
  const loaded = useWorkspace((s) => s.loaded)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (next) setName('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-sm" initialFocus={nameRef}>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            if (!loaded) return
            const project = createProject(name.trim() || 'Untitled project')
            useProjects.getState().add(project)
            onOpenChange(false)
            open(project.id)
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <Input ref={nameRef} placeholder="Untitled project" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
          <DialogFooter>
            <Button type="submit" disabled={!loaded}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A project's card while it is on its way: its banknotes as plain paper shimmering, as a banknote whose design is still
 * loading shows, and bars for its name and count, at the card's own sizes, so the card takes its place unchanged
 */
function ProjectCardSkeleton({ notes }: { notes: Size[] }) {
  const { shown, scale } = thumbnail(notes)
  return (
    <li aria-hidden="true" data-card-skeleton="">
      <Card className="gap-0 rounded-lg py-0">
        <div className="flex h-[196px] items-center justify-center bg-muted/50">
          <div className="flex items-end gap-1.5">
            {shown.map((note, i) => (
              <NoteSkeleton key={i} widthMm={note.widthMm} heightMm={note.heightMm} scale={scale} />
            ))}
          </div>
        </div>
        <div className="flex flex-col px-3 py-2">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3 w-28 rounded-sm" />
          </div>
          <div className="flex h-4 items-center">
            <Skeleton className="h-2.5 w-16 rounded-sm" />
          </div>
        </div>
      </Card>
    </li>
  )
}

function ProjectCard({ project, onDuplicate }: { project: Project; onDuplicate: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Thumbnails share one scale so the notes keep their relative sizes
  const { shown, scale } = thumbnail(project.notes)

  return (
    <li>
      <Card className="group gap-0 rounded-lg py-0">
        <button
          type="button"
          onClick={() => open(project.id)}
          className="flex h-[196px] items-center justify-center bg-muted/50 transition-colors group-hover:bg-muted"
        >
          {shown.length ? (
            <div className="flex items-end gap-1.5">
              {shown.map((note) => (
                <NoteView key={note.id} note={note} scale={scale} />
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Empty</span>
          )}
        </button>
        <div className="flex items-center gap-0.5 px-3 py-2">
          <button type="button" onClick={() => open(project.id)} className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-medium">{project.name}</div>
            <div className="text-xs text-muted-foreground">
              {project.notes.length} {project.notes.length === 1 ? 'banknote' : 'banknotes'}
            </div>
          </button>
          <IconButton label="Rename" onClick={() => setRenaming(true)}>
            <Pencil />
          </IconButton>
          <IconButton label="Duplicate" onClick={onDuplicate}>
            <Copy />
          </IconButton>
          <IconButton label="Delete" onClick={() => setDeleting(true)}>
            <Trash2 />
          </IconButton>
        </div>
      </Card>

      <RenameDialog key={renaming ? "open" : "closed"} project={project} open={renaming} onOpenChange={setRenaming} />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => runAction(useProjects.getState().remove(project.id))}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

function RenameDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(project.name)
  const nameRef = useRef<HTMLInputElement>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setName(project.name)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-sm" initialFocus={nameRef}>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) updateProject(project.id, (p) => ({ ...p, name: name.trim() }))
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <Input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
