import { ChevronLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { createPlayground } from './engine/playground'
import { keepEditorState, keepThumb, openImage, presets, renameProject, replaceImage, setThumbMaker, useStudio } from './store'
import { SaveStatus } from './TopBar'
import type { Project } from './types'

const backToProjects = () => (location.hash = '')

/**
 * The editor: today's playground opened on one project. It saves by itself a moment after each change, with a fresh
 * picture of the result for the project's card; when another tab or computer's version replaces this one, it reopens
 * on that version.
 */
export function Editor({ project }: { project: Project }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [brand, setBrand] = useState<HTMLElement | null>(null)
  const { id, ext } = project

  useEffect(() => {
    const root = hostRef.current
    // the project as it is when the editor opens; its own changes come back from it
    const start = useStudio.getState().projects.find((p) => p.id === id)
    if (!root || !start) return
    const engine = createPlayground(root, {
      initial: start.data.cfg ? { cfg: start.data.cfg, ui: start.data.ui } : null,
      onChange: (next) => keepEditorState(id, next),
      loadImage: (onProgress) => openImage(id, onProgress),
      replaceImage: (file) => replaceImage(id, file),
      presets,
    })
    setBrand(engine.brand)
    const stopThumbs = setThumbMaker(id, () => engine.thumbnail())
    // closing the tab: the last change goes to this browser's copy first
    const onPageHide = () => engine.flush()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      engine.flush()
      keepThumb(id, engine.thumbnail())
      stopThumbs()
      engine.destroy()
      setBrand(null)
    }
  }, [id, ext])

  return (
    <div ref={hostRef} className="h-full" data-project={id}>
      {brand && createPortal(<EditorBrand project={project} />, brand)}
    </div>
  )
}

/** Top left: back to Projects and the project's name (click to rename), with the save status beside it */
function EditorBrand({ project }: { project: Project }) {
  const [renaming, setRenaming] = useState(false)
  return (
    <div className="flex min-w-0 items-center gap-1.5 font-sans">
      <Button variant="ghost" size="icon-sm" aria-label="Back to projects" title="Projects" onClick={backToProjects}>
        <ChevronLeft />
      </Button>
      {renaming ? (
        <input
          autoFocus
          aria-label="Project name"
          defaultValue={project.name}
          maxLength={120}
          className="h-7 w-56 min-w-0 rounded-md border border-input bg-background px-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            renameProject(project.id, event.currentTarget.value)
            setRenaming(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.currentTarget.value = project.name
              event.currentTarget.blur()
            }
          }}
        />
      ) : (
        <button
          type="button"
          title="Rename"
          onClick={() => setRenaming(true)}
          className="min-w-0 truncate rounded-md px-1.5 py-1 text-left text-sm font-semibold hover:bg-muted"
        >
          {project.name}
        </button>
      )}
      <SaveStatus />
    </div>
  )
}

/**
 * The editor while its project is still on its way (its link opened in a browser that hasn't it yet): the top bar,
 * the canvas and the panel where the editor puts them, their contents as skeletons. Only the way back works meanwhile.
 */
export function EditorSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading project" className="flex h-full flex-col bg-muted/40">
      <div className="flex h-[51px] shrink-0 items-center gap-3 border-b bg-background px-4">
        <Button variant="ghost" size="icon-sm" aria-label="Back to projects" onClick={backToProjects}>
          <ChevronLeft />
        </Button>
        <Skeleton className="h-4 w-36 rounded-sm" />
        <Skeleton className="ml-4 h-7 w-52 rounded-lg" />
        <div className="flex-1" />
        <Skeleton className="h-7 w-28 rounded-lg" />
        <Skeleton className="h-7 w-24 rounded-lg" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex flex-1 items-center justify-center">
          <Skeleton className="h-[60%] w-[40%] rounded-sm" />
        </div>
        <div className="hidden w-[356px] shrink-0 flex-col gap-5 border-l bg-background p-4 min-[901px]:flex">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24 rounded-sm" />
              <Skeleton className="h-2 w-full rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
