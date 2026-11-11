import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NoteSkeleton } from '../components/NoteView'
import { workspaceJson } from '../cloud/client'
import { normalizeWorkspace } from '../cloud/identity'
import { setImageWorkspace } from '../lib/images'
import { lensState } from '../lib/lens'
import { playbackPlan } from '../lib/moves'
import { migrateProject } from '../lib/notes'
import type { Project } from '../lib/types'
import { useTiltLoop } from '../tilt/tilt'
import { demoLink } from '../lib/demoLink'
import { DemoView } from './DemoView'
import { useBlackPage } from './useBlackPage'

/** How often, ms, a phone looks for edits made on the laptop while the page shows */
export const CHECK_MS = 3000
/** The banknote the skeleton shows while the project is on its way, at this share of the screen's width */
const SKELETON = { widthMm: 150, heightMm: 70, share: 0.8 }

interface Row { data: Project; revision: string; deleted_at: string | null }

/**
 * Demo by link (`#/play/<username>/<project>/<banknote>`): what a phone opens from Demo's QR code, or from the project
 * list on a phone. It skips the username screen and opens no workspace, so it never saves and can't clash with the
 * laptop: it reads the project through the edge function's `get` (images by `download`, as the banknote shown needs them),
 * then looks again every 3 seconds while the page shows, swapping in an edit once its revision changes, the banknote shown
 * and the tilt staying put (Keller, 10 November: "on: checks 3s while visible"). The usual skeleton meanwhile, and a
 * failure in words with Retry.
 */
export function DemoPage({ workspace, projectId, noteId }: { workspace: string; projectId: string; noteId?: string }) {
  useBlackPage()
  const name = useMemo(() => {
    try {
      return normalizeWorkspace(workspace)
    } catch {
      return undefined
    }
  }, [workspace])
  const [loaded, setLoaded] = useState<{ project: Project; revision: string }>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [shown, setShown] = useState(noteId)

  // Its images from the workspace in the link, without opening it
  useEffect(() => {
    if (name) setImageWorkspace(name)
  }, [name])

  useEffect(() => {
    if (!name) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let revision: string | undefined
    const check = async () => {
      clearTimeout(timer)
      try {
        const row = await workspaceJson<Row | null>(name, 'get', { id: projectId })
        if (!alive) return
        if (!row || row.deleted_at) {
          revision = undefined
          setLoaded(undefined)
          setError('This project isn’t in the workspace. It may have been deleted.')
          return
        }
        if (row.revision !== revision) {
          revision = row.revision
          setLoaded({ project: migrateProject(row.data), revision: row.revision })
          setError(undefined)
        }
      } catch (failure) {
        if (!alive) return
        // Once it shows, a missed look waits for the next
        if (revision === undefined) {
          setError(failure instanceof Error ? failure.message : 'Couldn’t reach the workspace. Please retry.')
          return
        }
      }
      if (alive && document.visibilityState === 'visible') timer = setTimeout(check, CHECK_MS)
    }
    // Hidden, it asks nothing; back, it looks straight away
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
      else clearTimeout(timer)
    }
    void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [name, projectId, attempt])

  // The tilt store's loop (on the laptop the canvas runs it): the spring a drag falls back with, the lamp's fade, turning
  // over. Playback is left out of Demo, so its plan never plays
  const plan = useMemo(() => {
    const lens = lensState({ cycleDeg: 30, transition: 0 })
    return playbackPlan({ cycleDeg: 30, transition: 0 }, lens)
  }, [])
  useTiltLoop(plan)

  if (!name || error) {
    return (
      <div role="alert" className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-black p-6 text-center text-sm text-muted-foreground">
        <span>{name ? error : 'This Demo link isn’t complete. Open it again from Demo’s phone button.'}</span>
        {name && <Button variant="outline" onClick={() => { setError(undefined); setAttempt((n) => n + 1) }}>Retry</Button>}
      </div>
    )
  }
  if (!loaded) {
    const scale = Math.min(globalThis.innerWidth || 390, globalThis.innerHeight || 844) * SKELETON.share / SKELETON.widthMm
    return (
      <div aria-busy="true" aria-label="Loading project" data-demo-skeleton="" className="fixed inset-0 flex items-center justify-center bg-black">
        <NoteSkeleton widthMm={SKELETON.widthMm} heightMm={SKELETON.heightMm} scale={scale} />
      </div>
    )
  }
  return (
    <DemoView project={loaded.project} noteId={shown}
      onPick={(id) => {
        setShown(id)
        // The address follows, so a reload or a shared link opens on it, without a new page in the history
        history.replaceState(history.state, '', demoLink(name, projectId, id))
      }} />
  )
}
