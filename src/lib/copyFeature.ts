import { clamp } from './frames'
import { type Feature, type PlacedLayer, fitPlaced, hasThread, withPlaced } from './layers'
import { remapTracks } from './pattern'
import { type Size, isWhollyOn, onto } from './placed'
import { fitSections, threadLength } from './thread'
import type { Frame, Note, SectionLens, ThreadPattern, ThreadSettings, TiltSettings } from './types'

/**
 * Copying a security feature from one banknote and pasting it onto another (Keller, 9 November: "if i copy one from one
 * banknote, and paste it at another, it should work"). A copy holds everything the feature is, as it was when copied;
 * pasted, it is added to the banknote, or takes the place of the one it has (a banknote has at most one of each), with
 * its own images, as Duplicate gives a copied banknote its own.
 */

/**
 * The lens a thread takes with it, what tilting does to its frames, as the right panel shows it with the thread (a
 * section's own lens holds the same): playback (Fade, speed, curve, moves, recordings) is the project's and stays
 */
const LENS_KEYS = ['effect', 'cycleDeg', 'cycleXDeg', 'yOn', 'runY', 'runX', 'revealAxis', 'revealWobble', 'revealLevel', 'flatAt'] as const satisfies readonly (keyof SectionLens)[]
type ThreadLens = SectionLens

/** A security thread is its settings (size, place, windows), its frames, its sections and its lens */
export interface ThreadCopy {
  thread: ThreadSettings
  frames: Frame[]
  pattern?: ThreadPattern
  lens: ThreadLens
}

/** A placed layer is all in its box's settings, whichever layer it is, so a new one copies with no more work */
type PlacedCopy = { [K in PlacedLayer]: { feature: K; layer: NonNullable<Note[K]> } }[PlacedLayer]

export type FeatureCopy = { feature: 'thread'; thread: ThreadCopy } | PlacedCopy

/** The banknote's feature as it is now, detached from it; undefined when the banknote hasn't got it */
export function featureCopy(note: Note, feature: Feature): FeatureCopy | undefined {
  if (feature === 'thread') {
    if (!hasThread(note)) return undefined
    const lens = Object.fromEntries(LENS_KEYS.filter((key) => note.tilt[key] !== undefined).map((key) => [key, note.tilt[key]])) as ThreadLens
    return structuredClone({ feature, thread: { thread: note.thread, frames: note.frames, ...(note.pattern ? { pattern: note.pattern } : {}), lens } })
  }
  const layer = note[feature]
  return layer ? (structuredClone({ feature, layer }) as FeatureCopy) : undefined
}

/** Every image the copy uses, each to be copied again for the banknote it is pasted onto */
export function featureImageIds(copy: FeatureCopy): string[] {
  const ids = copy.feature === 'thread' ? copy.thread.frames.map((f) => f.imageId) : [copy.layer.imageId]
  return [...new Set(ids.filter((id): id is string => !!id))]
}

/** Whether the banknote has this very feature, unchanged: pasting it there again would change nothing */
export const hasCopy = (note: Note, copy: FeatureCopy) => JSON.stringify(featureCopy(note, copy.feature)) === JSON.stringify(copy)

/**
 * The banknote with the copy pasted onto it, in place of the feature of that kind it had, using `images` for the copy's
 * images (each original's id to its copy's). It sits where it sat on the banknote it was copied from (`from`, that
 * banknote's size), as far as it fits, as the banknote's own features do when it is resized: a placed layer keeps its box
 * on the banknote and the thread its distance across, each wholly on it if it was wholly on the other, and the thread's
 * windows stay as far along as the banknote is long. A thread's frames get new ids, its sections' tracks following them,
 * and its lens becomes the banknote's.
 */
export function withFeatureCopy(note: Note, copy: FeatureCopy, from: Size, images: ReadonlyMap<string, string> = new Map()): Note {
  const image = <T extends { imageId?: string }>(item: T): T => (item.imageId ? { ...item, imageId: images.get(item.imageId) ?? item.imageId } : item)
  if (copy.feature !== 'thread') return withPlacedCopy(note, copy.feature, image(copy.layer), from)

  const { thread, frames: copied, pattern, lens } = copy.thread
  const frames = copied.map((f) => ({ ...image(f), id: crypto.randomUUID() }))
  const ids = new Map(copied.map((f, i) => [f.id, frames[i].id]))
  const across = (size: Size) => (thread.direction === 'vertical' ? size.widthMm : size.heightMm)
  // Its middle where it was, kept on the banknote, wholly if it was wholly on the other
  const half = thread.widthMm / 2
  const whollyOn = thread.positionMm >= half && thread.positionMm <= across(from) - half
  const room = Math.min(half, across(note) / 2)
  const positionMm = whollyOn ? clamp(thread.positionMm, room, across(note) - room) : clamp(thread.positionMm, 0, across(note))
  const length = threadLength({ ...note, thread })
  const tilt: Record<string, unknown> = { ...note.tilt }
  for (const key of LENS_KEYS) {
    if (lens[key] === undefined) delete tilt[key]
    else tilt[key] = lens[key]
  }
  const { noThread: _none, pattern: _old, ...rest } = note
  const sections = remapTracks(pattern, ids)
  return {
    ...rest,
    thread: { ...thread, positionMm, windows: { ...thread.windows, sections: fitSections(thread.windows.sections, length) } },
    frames,
    tilt: tilt as unknown as TiltSettings,
    ...(sections ? { pattern: sections } : {}),
  }
}

function withPlacedCopy(note: Note, layer: PlacedLayer, box: PlacedCopy['layer'], from: Size): Note {
  const fit = (b: typeof box) => fitPlaced(layer, b as never, note)
  const fitted = fit(box)
  return withPlaced(note, layer, isWhollyOn(box, from) ? fit(onto(fitted, note)) : fitted)
}
