import { featureCopy, featureImageIds, lensOf, withLens } from './copyFeature'
import { FEATURES, FEATURE_NAMES, type Feature, featureName, hasFeature, withPlaced } from './layers'
import type { ExtraFeature, FeatureCopy, Note } from './types'

/**
 * A banknote's further security features (Keller, 10 November: "you should be able to add multiple of the same security
 * feature. so no limit"). The first of each kind keeps its own place on the banknote (`thread`, `watermark`…), so saves
 * from before read as they did and everything written for one of each works as it was; the rest wait in `extras`, in the
 * order they were added, each a copy of its feature (copyFeature.ts) under an id of its own. A banknote has them only
 * while it has the first of their kind: when that one goes, the next moves up into its place.
 *
 * Each further one is worked on as the first is, through its view: the banknote with it in the first one's place, under
 * an id of its own (`partNoteId`), which the store reads and writes through (`findNote`, `updateNote`), so the right
 * panel, Thread Studio and the canvas's gestures work on it unchanged. A further thread has its own lens, its banknote
 * keeping the playback every banknote shares.
 */

const SEP = '/'

/** The id a further feature's view goes by: its banknote's id and its own */
export const partNoteId = (noteId: string, extraId: string) => `${noteId}${SEP}${extraId}`

/** The banknote an id belongs to, and the further feature it names, if it names one */
export function splitNoteId(id: string): { noteId: string; extraId?: string } {
  const at = id.indexOf(SEP)
  return at < 0 ? { noteId: id } : { noteId: id.slice(0, at), extraId: id.slice(at + 1) }
}

/** The banknote's own id, from its id or a view's */
export const hostNoteId = (id: string) => splitNoteId(id).noteId

/**
 * One of a banknote's parts, listed under it in the Banknotes list; the right panel shows one at a time: the banknote
 * itself, the first of a kind of security feature (named as the kind), or a further one (the kind and its id)
 */
export type Layer = 'note' | Feature | `${Feature}/${string}`

/** The layer of a banknote's feature: the kind for the first of it, the kind and its id for a further one */
export const partLayer = (feature: Feature, extraId?: string): Layer => (extraId ? `${feature}${SEP}${extraId}` : feature)

/** Which kind of security feature a layer is; undefined for the banknote itself, or what isn't a layer */
export function featureOf(layer: string | undefined): Feature | undefined {
  const kind = layer?.split(SEP)[0]
  return (FEATURES as readonly (string | undefined)[]).includes(kind) ? (kind as Feature) : undefined
}

/** A further feature's id, from its layer; undefined for the first of a kind */
export function extraIdOf(layer: string) {
  const at = layer.indexOf(SEP)
  return at < 0 ? undefined : layer.slice(at + 1)
}

/** The banknote's further features, or those of one kind, in the order they were added */
export const extrasOf = <F extends Feature = Feature>(note: Pick<Note, 'extras'>, feature?: F): Extract<ExtraFeature, { feature: F }>[] =>
  (note.extras ?? []).filter((x): x is Extract<ExtraFeature, { feature: F }> => !feature || x.feature === feature)

/** The banknote without any further features */
export function withoutExtras(note: Note): Note {
  const { extras: _none, ...rest } = note
  return rest
}

/**
 * The banknote as the code of one of its further features sees it: that feature in the place of the first of its kind,
 * the rest of the banknote as it is, without the others, under the view's own id. A further thread brings its own lens
 */
export function extraView(note: Note, extra: ExtraFeature): Note {
  const { extras: _others, ...rest } = note
  const id = partNoteId(note.id, extra.id)
  if (extra.feature !== 'thread') return { ...rest, id, [extra.feature]: extra.layer } as Note
  const { thread, frames, pattern, lens } = extra.thread
  const { noThread: _none, pattern: _first, ...base } = rest
  return { ...base, id, thread, frames, tilt: withLens(note.tilt, lens), ...(pattern ? { pattern } : {}) }
}

/**
 * What became of a further feature in its view, back on its banknote, and gone from it once the view hasn't got it any
 * more (removed through the view). Changes to a thread's playback made there go to the banknote, which keeps it for all
 * its threads (`playback`)
 */
function backFrom(note: Note, extra: ExtraFeature, view: Note, playback = true): Note {
  const copy = featureCopy(view, extra.feature)
  const extras = extrasOf(note).flatMap((x) => (x.id !== extra.id ? [x] : copy ? [{ ...copy, id: x.id }] : []))
  const kept = extras.length ? { ...note, extras } : withoutExtras(note)
  return extra.feature === 'thread' && playback ? { ...kept, tilt: withLens(view.tilt, lensOf(note.tilt)) } : kept
}

/** The banknote with `change` made to one of its further features, through its view; as it was without that feature */
export function throughExtra(note: Note, extraId: string, change: (view: Note) => Note): Note {
  const extra = note.extras?.find((x) => x.id === extraId)
  if (!extra) return note
  const view = extraView(note, extra)
  const next = change(view)
  return next === view ? note : backFrom(note, extra, next)
}

/** The banknote, or the view of its further feature an id names (`partNoteId`); undefined when it hasn't got that one */
export function noteOrPart(note: Note | undefined, id: string): Note | undefined {
  const { extraId } = splitNoteId(id)
  if (!note || extraId === undefined) return note
  const extra = note.extras?.find((x) => x.id === extraId)
  return extra && extraView(note, extra)
}

/**
 * The banknote with `change` made to it and, alike, to each of its further features through its view, each from the
 * banknote as it was: resizing or turning a banknote keeps all its features where they were, not only the first of each
 */
export function withEveryPart(note: Note, change: (n: Note) => Note): Note {
  return extrasOf(note).reduce((n, extra) => backFrom(n, extra, change(extraView(note, extra)), false), change(note))
}

/** One of a banknote's security features: which part it is, which kind, and the banknote as that feature's own code sees it */
export interface FeaturePart {
  layer: Layer
  feature: Feature
  /** The banknote itself for the first of a kind, a further one's view (`extraView`) */
  note: Note
}

/**
 * Every security feature the banknote has, in the Banknotes list's order: by kind, as the Add menu lists the kinds, each
 * kind's first one first and the rest in the order they were added
 */
export function featureParts(note: Note): FeaturePart[] {
  return FEATURES.flatMap((feature) =>
    hasFeature(note, feature)
      ? [{ layer: feature, feature, note }, ...extrasOf(note, feature).map((x) => ({ layer: partLayer(feature, x.id), feature, note: extraView(note, x) }))]
      : [],
  )
}

/** One of the banknote's security features by its layer; undefined for the banknote itself, or one it hasn't got */
export function featurePart(note: Note | undefined, layer: Layer): FeaturePart | undefined {
  const feature = featureOf(layer)
  if (!note || !feature) return undefined
  const extraId = extraIdOf(layer)
  if (extraId === undefined) return hasFeature(note, feature) ? { layer, feature, note } : undefined
  const extra = note.extras?.find((x) => x.id === extraId && x.feature === feature)
  return extra && { layer, feature, note: extraView(note, extra) }
}

/** The banknote with a further feature added after the others, under the id given */
export const withExtra = (note: Note, copy: FeatureCopy, id: string): Note => ({ ...note, extras: [...extrasOf(note), { ...copy, id } as ExtraFeature] })

/**
 * The banknote, just without the first of a kind, with the next of that kind moved up into its place, so a banknote
 * never has further features of a kind without the first
 */
export function promoteExtra(note: Note, feature: Feature): Note {
  const next = extrasOf(note, feature)[0]
  if (!next || hasFeature(note, feature)) return note
  const others = extrasOf(note).filter((x) => x !== next)
  const base = others.length ? { ...note, extras: others } : withoutExtras(note)
  if (next.feature !== 'thread') return withPlaced(base, next.feature, next.layer)
  const { thread, frames, pattern, lens } = next.thread
  const { noThread: _none, pattern: _old, ...rest } = base
  return { ...rest, thread, frames, tilt: withLens(base.tilt, lens), ...(pattern ? { pattern } : {}) }
}

/**
 * The name another of a kind the banknote has goes by from the start, so the two can be told apart: its kind and the
 * next number none of them goes by (Watermark 2, Watermark 3…)
 */
export function nextName(note: Note, feature: Feature): string {
  const taken = new Set(featureParts(note).filter((p) => p.feature === feature).map((p) => featureName(p.note, feature)))
  let n = taken.size + 1
  while (taken.has(`${FEATURE_NAMES[feature]} ${n}`)) n++
  return `${FEATURE_NAMES[feature]} ${n}`
}

/** Every image the banknote's further features use */
export const extraImageIds = (note: Pick<Note, 'extras'>): string[] => extrasOf(note).flatMap((x) => featureImageIds(x))
