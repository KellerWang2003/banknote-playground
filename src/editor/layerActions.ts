import { lensOf } from '../lib/copyFeature'
import { type Layer, extrasOf, featurePart, nextName, partLayer, partNoteId, promoteExtra, withExtra } from '../lib/extras'
import { clamp } from '../lib/frames'
import { beginHistoryGroup, endHistoryGroup } from '../lib/history'
import { imageAspect, removeImage, storeImage } from '../lib/images'
import { FEATURE_NAMES, type Feature, type PlacedLayer, fitPlaced, hasFeature, hasThread, newPlaced, withPlaced } from '../lib/layers'
import { withNewThread } from '../lib/notes'
import { withArcImage } from '../lib/arcEnCiel'
import { withInkImage } from '../lib/magneticInk'
import { type PlacedBox, PLACE_STEP } from '../lib/placed'
import { findNote, updateNote } from '../lib/store'
import { standIn } from '../lib/standIns'
import type { ArcEnCiel, FeatureCopy, MagneticInk, Note, Watermark } from '../lib/types'
import { fitWatermark, withWatermarkImage } from '../lib/watermark'
import type { NoteRef } from './frameActions'

export type { Layer } from '../lib/extras'

/** The layer a banknote can show: a feature it doesn't have (removed or undone, say) falls back to the banknote itself */
export const layerOf = (note: Note | undefined, layer: Layer): Layer => (layer !== 'note' && featurePart(note, layer) ? layer : 'note')

/**
 * Adds a security feature from the Add menu, and returns its layer: the first of its kind as the banknote's thread (as a
 * new banknote's would be) or a placed layer, and another of a kind it has already as a further one (extras.ts), as many
 * as wanted (Keller, 10 November: "no limit")
 */
export function addFeature(ref: NoteRef, feature: Feature): Layer {
  const note = findNote(ref.projectId, ref.noteId)
  if (note && hasFeature(note, feature)) return addFurther(ref, note, feature)
  if (feature !== 'thread') {
    addLayer(ref, feature)
    return feature
  }
  updateNote(ref.projectId, ref.noteId, (n) => (hasThread(n) ? n : withNewThread(n)))
  return 'thread'
}

/**
 * Where another thread or placed layer of a kind starts, so it shows beside the ones there rather than hidden under them:
 * a thread across from the middle, in steps either side, at the first place none of the banknote's threads that way covers;
 * a placed layer a step down and right of its own place for each one of its kind before it, kept on the banknote
 */
function furtherCopy(note: Note, feature: Feature): FeatureCopy {
  const name = nextName(note, feature)
  if (feature === 'thread') {
    const fresh = withNewThread(note)
    const { direction, widthMm } = fresh.thread
    const across = direction === 'vertical' ? note.widthMm : note.heightMm
    const taken = [note, ...extrasOf(note, 'thread').map((x) => x.thread)].map((t) => t.thread).filter((t) => t.direction === direction)
    const step = Math.max(widthMm * 2, Math.round(across * 0.3) / 2)
    const spots = Array.from({ length: 9 }, (_, i) => fresh.thread.positionMm + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * step)
      .filter((at) => at >= widthMm / 2 && at <= across - widthMm / 2)
    const free = spots.find((at) => taken.every((t) => Math.abs(t.positionMm - at) >= (t.widthMm + widthMm) / 2))
    const positionMm = clamp(free ?? fresh.thread.positionMm, 0, across)
    return { feature, thread: { thread: { ...fresh.thread, name, positionMm }, frames: fresh.frames, ...(fresh.pattern ? { pattern: fresh.pattern } : {}), lens: lensOf(note.tilt) } }
  }
  const before = 1 + extrasOf(note, feature).length
  const step = Math.max(PLACE_STEP, Math.round((Math.min(note.widthMm, note.heightMm) * 0.1) / PLACE_STEP) * PLACE_STEP)
  const box = newPlaced(feature, note)
  const layer = fitPlaced(feature, { ...box, xMm: box.xMm + before * step, yMm: box.yMm + before * step, name } as never, note)
  return { feature, layer } as FeatureCopy
}

/**
 * Adds another of a kind of feature the banknote has, after the others, named as the next of its kind (Watermark 2) so the
 * two can be told apart; a placed layer gets a stand-in image, as the first one does (`addLayer`), in the same undo step
 */
function addFurther(ref: NoteRef, note: Note, feature: Feature): Layer {
  const { projectId, noteId } = ref
  const id = crypto.randomUUID()
  const copy = furtherCopy(note, feature)
  beginHistoryGroup(projectId)
  updateNote(projectId, noteId, (n) => withExtra(n, copy, id))
  const further = { projectId, noteId: partNoteId(noteId, id) }
  if (copy.feature === 'thread') endHistoryGroup(projectId)
  else {
    const layer = copy.feature
    void standIn(layer)
      .then((file) => {
        const added = findNote(further.projectId, further.noteId)?.[layer]
        if (!added || added.imageId) return
        return setLayerImage(further, layer, file)
      })
      .catch(() => {})
      .finally(() => endHistoryGroup(projectId))
  }
  return partLayer(feature, id)
}

/**
 * Removes a security feature, the thread as the others: one undo step, nothing of it kept. The first of a kind makes way
 * for the next of its kind, which moves up into its place (`promoteExtra`)
 */
export async function removeFeature(ref: NoteRef, layer: Layer) {
  const part = featurePart(findNote(ref.projectId, ref.noteId), layer)
  if (!part) return
  // The banknote for the first of a kind, the further one's view for the others
  const own = { projectId: ref.projectId, noteId: part.note.id }
  if (part.feature !== 'thread') return removeLayer(own, part.feature)
  updateNote(own.projectId, own.noteId, (n) => (hasThread(n) ? promoteExtra(withNewThread(n, true), 'thread') : n))
}

/**
 * Gives a security feature a name of its own, typed on its row in the Banknotes list (layerName.ts). Left empty, or typed
 * as what it is anyway, it takes the name off, so it goes by what it is again. A further one is renamed through its view
 */
export function renameFeature({ projectId, noteId }: NoteRef, feature: Feature, typed: string) {
  const given = typed.trim()
  const name = given && given !== FEATURE_NAMES[feature] ? given : undefined
  const named = <T extends { name?: string }>({ name: _old, ...rest }: T) => (name ? { ...rest, name } : rest)
  updateNote(projectId, noteId, (n) => {
    if (feature === 'thread') return hasThread(n) ? { ...n, thread: named(n.thread) } : n
    const layer = n[feature]
    return layer ? withPlaced(n, feature, named(layer)) : n
  })
}

/**
 * Adds the first of a kind of placed layer in its own place on the banknote, with a stand-in image so it shows what it
 * does straight away (`standIn`): the box at once, the image a moment later, both one undo step
 */
export function addLayer(ref: NoteRef, layer: PlacedLayer) {
  const { projectId, noteId } = ref
  if (findNote(projectId, noteId)?.[layer]) return
  beginHistoryGroup(projectId)
  updateNote(projectId, noteId, (n) => (n[layer] ? n : withPlaced(n, layer, newPlaced(layer, n))))
  void standIn(layer)
    .then((file) => {
      // Unless it went (undone) or got an image of its own meanwhile
      const added = findNote(projectId, noteId)?.[layer]
      if (!added || added.imageId) return
      return setLayerImage(ref, layer, file)
    })
    // Where it can't be drawn (an old browser, the tests), the layer starts empty, as it used to
    .catch(() => {})
    .finally(() => endHistoryGroup(projectId))
}

/** Removes a layer, and its image with it; the next of its kind moves up into its place (`promoteExtra`) */
export async function removeLayer({ projectId, noteId }: NoteRef, layer: PlacedLayer) {
  const old = findNote(projectId, noteId)?.[layer]?.imageId
  updateNote(projectId, noteId, (n) => (n[layer] ? promoteExtra(withPlaced(n, layer, undefined), layer) : n))
  if (old) await removeImage(old)
}

/**
 * Moves, resizes or rotates a layer's box on its banknote, kept on it (the canvas's drags and the placing box); only its
 * box changes. A box that doesn't say how it is rotated keeps the rotation the layer has
 */
export function placeLayer({ projectId, noteId }: NoteRef, layer: PlacedLayer, { xMm, yMm, widthMm, heightMm, rotationDeg }: PlacedBox) {
  updateNote(projectId, noteId, (n) => {
    const old = n[layer]
    return old ? withPlaced(n, layer, fitPlaced(layer, { ...old, xMm, yMm, widthMm, heightMm, rotationDeg: rotationDeg ?? old.rotationDeg }, n)) : n
  })
}

/** Changes the watermark, kept on the banknote */
export function updateWatermark({ projectId, noteId }: NoteRef, change: (watermark: Watermark, note: Note) => Watermark) {
  updateNote(projectId, noteId, (n) => (n.watermark ? { ...n, watermark: fitWatermark(change(n.watermark, n), n) } : n))
}

/** Changes Arc-en-Ciel, kept on the banknote */
export function updateArcEnCiel({ projectId, noteId }: NoteRef, change: (arc: ArcEnCiel, note: Note) => ArcEnCiel) {
  updateNote(projectId, noteId, (n) => (n.arcEnCiel ? { ...n, arcEnCiel: fitPlaced('arcEnCiel', change(n.arcEnCiel, n), n) } : n))
}

/** Changes the magnetic ink, kept on the banknote */
export function updateMagneticInk({ projectId, noteId }: NoteRef, change: (ink: MagneticInk, note: Note) => MagneticInk) {
  updateNote(projectId, noteId, (n) => (n.magneticInk ? { ...n, magneticInk: fitPlaced('magneticInk', change(n.magneticInk, n), n) } : n))
}

/** Uploads the watermark's image (its proportions set the height; it starts on Auto levels), or removes it */
export async function setWatermarkImage(ref: NoteRef, file: File | undefined) {
  const old = findNote(ref.projectId, ref.noteId)?.watermark?.imageId
  if (file) {
    const [imageId, aspect] = await Promise.all([storeImage(file), imageAspect(file)])
    updateWatermark(ref, (w, n) => withWatermarkImage(w, imageId, aspect, n))
  } else {
    // Its levels were for that image
    updateWatermark(ref, ({ imageId: _removed, levels: _levels, ...rest }) => rest)
  }
  if (old) await removeImage(old)
}

/** Uploads the magnetic ink's image, whose shape takes the ink (its proportions set the height), or removes it */
export async function setMagneticInkImage(ref: NoteRef, file: File | undefined) {
  const old = findNote(ref.projectId, ref.noteId)?.magneticInk?.imageId
  if (file) {
    const [imageId, aspect] = await Promise.all([storeImage(file), imageAspect(file)])
    updateMagneticInk(ref, (ink, n) => withInkImage(ink, imageId, aspect, n))
  } else {
    updateMagneticInk(ref, ({ imageId: _removed, ...rest }) => rest)
  }
  if (old) await removeImage(old)
}

/** Uploads Arc-en-Ciel's image, whose shape takes the bands (its proportions set the height), or removes it */
export async function setArcEnCielImage(ref: NoteRef, file: File | undefined) {
  const old = findNote(ref.projectId, ref.noteId)?.arcEnCiel?.imageId
  if (file) {
    const [imageId, aspect] = await Promise.all([storeImage(file), imageAspect(file)])
    updateArcEnCiel(ref, (arc, n) => withArcImage(arc, imageId, aspect, n))
  } else {
    updateArcEnCiel(ref, ({ imageId: _removed, ...rest }) => rest)
  }
  if (old) await removeImage(old)
}

/** Uploads a placed layer's image, or removes it */
export function setLayerImage(ref: NoteRef, layer: PlacedLayer, file: File | undefined) {
  if (layer === 'watermark') return setWatermarkImage(ref, file)
  return layer === 'arcEnCiel' ? setArcEnCielImage(ref, file) : setMagneticInkImage(ref, file)
}
