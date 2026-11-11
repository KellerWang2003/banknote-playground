import { useEffect } from 'react'
import { reportError } from '../cloud/notices'
import { needsSettling, settleArtwork } from '../lib/artwork'
import { extraView, extrasOf } from '../lib/extras'
import { loadImageUrl } from '../lib/images'
import { settleNote } from '../lib/store'
import type { Project } from '../lib/types'

// Images already read, or that couldn't be: each is read once a session, so a broken one isn't fetched on every edit
const tried = new Set<string>()

/** Height ÷ width of the image at `url` */
const aspectAt = (url: string) =>
  new Promise<number | undefined>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : undefined)
    img.onerror = () => resolve(undefined)
    img.src = url
  })

/**
 * Reads the proportions of images added before frames kept them, once each, and settles their banknotes
 * (`settleArtwork`): a thread from before images sat in the repeat takes its repeat from its first image, so it looks
 * as it did. Not an edit, so it adds no undo step. A banknote's further threads (extras.ts) are settled the same way, each
 * as its view.
 */
export function useSettleArtwork(project: Project) {
  useEffect(() => {
    const threads = project.notes.flatMap((n) => [n, ...extrasOf(n, 'thread').map((x) => extraView(n, x))])
    for (const note of threads.filter(needsSettling)) {
      const ids = [...new Set(note.frames.flatMap((f) => (f.kind === 'image' && f.imageId && !f.aspect && !tried.has(f.imageId) ? [f.imageId] : [])))]
      if (!ids.length) continue
      for (const id of ids) tried.add(id)
      // Settled from the banknote as it is by then, so an edit made meanwhile is kept
      void Promise.all(ids.map(async (id) => {
        const url = await loadImageUrl(id)
        return [id, url ? await aspectAt(url) : undefined] as const
      })).then((read) => {
        const aspects = new Map(read.flatMap(([id, aspect]) => (aspect ? [[id, aspect] as const] : [])))
        if (aspects.size) settleNote(project.id, note.id, (n) => settleArtwork(n, aspects))
      }).catch(reportError)
    }
  }, [project])
}
