import { Copy, ImageIcon, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { runAction } from '../cloud/notices'
import { usePasteImage } from '../lib/pasteImages'
import { createProject, deleteProject, duplicateProject, refresh, renameProject, useStudio } from './store'
import { AccountMenu, SaveStatus } from './TopBar'
import type { Project } from './types'

const open = (id: string) => (location.hash = `#/p/${id}`)

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4'

/** The shapes the skeleton cards' pictures take while the projects are on their way, as images tend to be */
const SKELETON_SHAPES = [[62, 72], [90, 60], [60, 90], [70, 70], [62, 72], [100, 56], [56, 80], [80, 64]]

/** When it was last edited, in words: just now, 5 minutes ago, yesterday, Nov 3 */
function edited(at: number, now: number) {
  const minutes = Math.round((now - at) / 60_000)
  const words = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (minutes < 1) return 'Edited just now'
  if (minutes < 60) return `Edited ${words.format(-minutes, 'minute')}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Edited ${words.format(-hours, 'hour')}`
  const days = Math.round(hours / 24)
  if (days < 7) return `Edited ${words.format(-days, 'day')}`
  const date = new Date(at)
  return `Edited ${date.toLocaleDateString('en', { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) })}`
}

/** The time now, a minute at a time, so Edited 5 minutes ago keeps up */
function useMinute() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function Projects() {
  const projects = useStudio((s) => s.projects)
  const loaded = useStudio((s) => s.loaded)
  const listed = useStudio((s) => s.listed)
  const listError = useStudio((s) => s.listError)
  const now = useMinute()
  const fileRef = useRef<HTMLInputElement>(null)
  // Projects on their way (their image is being read): each holds the place its card will take, first in the list
  const [adding, setAdding] = useState<string[]>([])
  const [dropping, setDropping] = useState(0)
  const shown = projects.filter((p) => !p.deleted).sort((a, b) => b.updatedAt - a.updatedAt)
  // Until the cloud has answered, a browser with none of the workspace's projects can't tell none from still on their way
  const loading = !loaded || (!listed && shown.length === 0 && !listError)

  const start = (file: File | undefined) => {
    if (!file) return
    const key = crypto.randomUUID()
    setAdding((all) => [key, ...all])
    runAction(createProject(file).then(open).finally(() => setAdding((all) => all.filter((k) => k !== key))))
  }
  const pasteSlot = usePasteImage(start)
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

  return (
    <div
      className="relative flex h-full flex-col bg-muted/40"
      {...pasteSlot}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        setDropping((n) => n + 1)
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (hasFiles(event)) setDropping((n) => Math.max(0, n - 1))
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        setDropping(0)
        start([...event.dataTransfer.files].find((file) => !file.type || file.type.startsWith('image/')))
      }}
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-6">
        <span className="font-heading text-sm font-semibold">Intaglio Studio</span>
        <div className="flex items-center gap-3">
          <SaveStatus />
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
                  <span className="font-normal text-muted-foreground tabular-nums">{shown.length}</span>
                )}
              </h1>
              <Button onClick={() => fileRef.current?.click()} disabled={!loaded}>
                <Plus />
                New project
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  start(file)
                }}
              />
            </div>

            {loading ? (
              <ul aria-busy="true" aria-label="Loading projects" className={GRID}>
                {SKELETON_SHAPES.map(([w, h], i) => (
                  <ProjectCardSkeleton key={i} widthMm={w} heightMm={h} />
                ))}
              </ul>
            ) : shown.length > 0 || adding.length > 0 ? (
              <ul className={GRID}>
                {adding.map((key) => (
                  <ProjectCardSkeleton key={key} widthMm={62} heightMm={72} />
                ))}
                {shown.map((project) => (
                  <ProjectCard key={project.id} project={project} now={now} />
                ))}
              </ul>
            ) : listError && !listed ? (
              <div role="alert" className="flex h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-sm text-muted-foreground">
                {listError}
                <Button variant="outline" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <Plus className="size-5" />
                No projects yet
              </button>
            )}
          </main>
        </div>
      </div>

      {dropping > 0 && (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/40 bg-background/70">
          <span className="rounded-lg bg-background px-3 py-2 text-sm font-medium shadow-menu">Drop to start a project</span>
        </div>
      )}
    </div>
  )
}

/** A card's picture area, with the picture fitted inside it */
function Picture({ project }: { project: Project }) {
  if (project.thumb) return <img src={project.thumb} alt="" draggable={false} className="max-h-full max-w-full object-contain shadow-note" />
  return <ImageIcon className="size-6 text-muted-foreground/60" />
}

/** A project's card while it is on its way: a picture-shaped shimmer and bars for its name and date */
function ProjectCardSkeleton({ widthMm, heightMm }: { widthMm: number; heightMm: number }) {
  const scale = Math.min(150 / heightMm, 190 / widthMm)
  return (
    <li aria-hidden="true" data-card-skeleton="">
      <Card className="gap-0 rounded-lg py-0">
        <div className="flex h-[196px] items-center justify-center bg-muted/50 p-4">
          <Skeleton className="rounded-sm" style={{ width: widthMm * scale, height: heightMm * scale }} />
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

function ProjectCard({ project, now }: { project: Project; now: number }) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  return (
    <li>
      <Card className="group gap-0 rounded-lg py-0">
        <button
          type="button"
          onClick={() => open(project.id)}
          className="flex h-[196px] items-center justify-center bg-muted/50 p-4 transition-colors group-hover:bg-muted"
        >
          <Picture project={project} />
        </button>
        <div className="flex items-center gap-0.5 px-3 py-2">
          <button type="button" onClick={() => open(project.id)} className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-medium">{project.name}</div>
            <div className="text-xs text-muted-foreground">{edited(project.updatedAt, now)}</div>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={`More for ${project.name}`}>
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => duplicateProject(project.id)}>
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>

      <RenameDialog key={renaming ? 'open' : 'closed'} project={project} open={renaming} onOpenChange={setRenaming} />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteProject(project.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

function RenameDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
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
          onSubmit={(event) => {
            event.preventDefault()
            renameProject(project.id, name)
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <Input ref={nameRef} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} aria-label="Project name" />
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
