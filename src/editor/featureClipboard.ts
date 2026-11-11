import { useEffect, useRef } from 'react'
import { reportError } from '../cloud/notices'
import { useWorkspace } from '../cloud/workspace'
import { type FeatureCopy, featureCopy, featureImageIds, withFeatureCopy } from '../lib/copyFeature'
import { featurePart, nextName, partLayer, withExtra } from '../lib/extras'
import { copyImage } from '../lib/images'
import { FEATURE_NAMES, type Feature, hasFeature } from '../lib/layers'
import { clipboardImages } from '../lib/pasteImages'
import type { Size } from '../lib/placed'
import { findNote, updateNote } from '../lib/store'
import type { Note } from '../lib/types'
import type { NoteRef } from './frameActions'
import type { Layer } from './layerActions'
import { popupOpen } from '../lib/popups'

/**
 * Copying security features from one banknote and pasting them onto another, as Figma copies layers (Keller, 9
 * November): ⌘/Ctrl+C with a security feature picked, on the canvas or in the Banknotes list, copies it as it is then;
 * ⌘/Ctrl+V pastes it onto the selected banknote, whichever of its parts is picked, as one more of its kind there, and
 * picks it. The copy is kept
 * in the app, so it pastes into any banknote of any project in this tab, and the clipboard holds its id, so whatever is
 * copied after it (an image for an upload slot, text) is what ⌘V pastes.
 */

/** The clipboard's own type for a copied security feature, holding the copy's id */
export const FEATURE_TYPE = 'application/x-banknote-playground-feature'
/** The same id in the copy's HTML, which every browser keeps on the clipboard, in case one drops a type of its own */
const MARK = 'data-banknote-playground-feature'

/** The id of the copied feature a paste holds, if it holds one */
export function copiedId(data: Pick<DataTransfer, 'types' | 'getData'> | null): string | undefined {
  if (!data) return undefined
  if (data.types.includes(FEATURE_TYPE)) return data.getData(FEATURE_TYPE) || undefined
  if (!data.types.includes('text/html')) return undefined
  return new RegExp(`${MARK}="([\\w-]+)"`).exec(data.getData('text/html'))?.[1]
}

export interface FeatureClip {
  id: string
  /** The workspace it was copied in, whose artwork its images are */
  workspace?: string
  /** The size of the banknote it was copied from, to keep its place on a banknote of another size */
  from: Size
  copy: FeatureCopy
  /**
   * Whether its id went on the clipboard too (the copy event wrote it). Then a paste without it there means something
   * else was copied since; a browser that never sent the copy event leaves it off, and a paste then takes it unless the
   * clipboard holds an image
   */
  onClipboard: boolean
}

let clip: FeatureClip | undefined

/** The security feature copied last, if any */
export const copiedFeature = () => clip

/** Forgets the copied feature (a test's fresh start) */
export const forgetCopiedFeature = () => {
  clip = undefined
}

/** Copies one of the banknote's security features as it is now, for pasting onto any banknote */
export function copyFeature(note: Note, feature: Feature): FeatureClip | undefined {
  const copy = featureCopy(note, feature)
  if (!copy) return undefined
  clip = { id: crypto.randomUUID(), workspace: useWorkspace.getState().workspace, from: { widthMm: note.widthMm, heightMm: note.heightMm }, copy, onClipboard: false }
  return clip
}

/**
 * Pastes a copied security feature onto a banknote, with copies of its own of the images, as Duplicate gives a banknote's
 * copy, in one undo step: as the first of its kind if the banknote hasn't got one, or else after those it has, as many as
 * wanted (Keller, 10 November: "no limit"; extras.ts), and named as the next of its kind (Watermark 2) unless it has a
 * name of its own; back onto the banknote it came from too, as Figma pastes a copy over its original. Resolves to the
 * pasted feature's layer, or undefined if the banknote went meanwhile
 */
export async function pasteFeature({ projectId, noteId }: NoteRef, pasted: Pick<FeatureClip, 'copy' | 'from'>): Promise<Layer | undefined> {
  if (!findNote(projectId, noteId)) return undefined
  const images = new Map(await Promise.all(featureImageIds(pasted.copy).map(async (id) => [id, await copyImage(id)] as const)))
  const note = findNote(projectId, noteId)
  if (!note) return undefined
  const { feature } = pasted.copy
  if (!hasFeature(note, feature)) {
    updateNote(projectId, noteId, (n) => withFeatureCopy(n, pasted.copy, pasted.from, images))
    return feature
  }
  // Fitted onto the banknote as the first of its kind would be, then kept after the others
  const fitted = featureCopy(withFeatureCopy(note, pasted.copy, pasted.from, images), feature)
  if (!fitted) return undefined
  const name = (fitted.feature === 'thread' ? fitted.thread.thread.name : fitted.layer.name) ?? nextName(note, feature)
  const copy = (fitted.feature === 'thread'
    ? { ...fitted, thread: { ...fitted.thread, thread: { ...fitted.thread.thread, name } } }
    : { ...fitted, layer: { ...fitted.layer, name } }) as FeatureCopy
  const id = crypto.randomUUID()
  updateNote(projectId, noteId, (n) => withExtra(n, copy, id))
  return partLayer(feature, id)
}

/** Keys pressed and pastes made in these go to the text, as with the editor's other shortcuts */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]'

const typing = (event: Event) => event.target instanceof Element && !!event.target.closest(TYPING)

/** Whether a paste holds an image, which goes to an upload slot rather than being a copied feature */
function holdsImage(data: DataTransfer | null) {
  try {
    return clipboardImages(data).length > 0
  } catch {
    // An SVG that can't be read is still an image meant for a slot, which says so
    return true
  }
}

const AGAIN = 'Copy the security feature again to paste it here.'

/**
 * ⌘/Ctrl+C and ⌘/Ctrl+V for security features, while `enabled` (not in Thread Studio): copies the picked feature of the
 * selected banknote, and pastes the copied one onto the selected banknote, calling `onPasted` once it is there
 */
export function useFeatureClipboard({ projectId, note, layer, enabled, onPasted }: {
  projectId: string
  /** The selected banknote */
  note: Note | undefined
  /** Its part that is picked: the banknote itself or one of its features */
  layer: Layer
  enabled: boolean
  /** With the pasted feature's layer */
  onPasted: (noteId: string, layer: Layer) => void
}) {
  // The latest, for the listeners below
  const latest = useRef({ projectId, note, layer, onPasted })
  useEffect(() => {
    latest.current = { projectId, note, layer, onPasted }
  })

  useEffect(() => {
    if (!enabled) return
    const copyPicked = () => {
      const { note: picked, layer } = latest.current
      // The first of its kind or a further one, as its own code sees it (extras.ts)
      const part = featurePart(picked, layer)
      return part ? copyFeature(part.note, part.feature) : undefined
    }
    // Some browsers send no copy event with nothing selected on the page, so the keys copy too; where the copy event
    // follows, it copies again, now putting the copy's id on the clipboard
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing) return
      if (event.key.toLowerCase() !== 'c' || typing(event) || popupOpen()) return
      copyPicked()
    }
    const onCopy = (event: ClipboardEvent) => {
      if (event.defaultPrevented || typing(event) || popupOpen()) return
      const copied = copyPicked()
      if (!copied || !event.clipboardData) return
      event.preventDefault()
      event.clipboardData.setData(FEATURE_TYPE, copied.id)
      event.clipboardData.setData('text/html', `<meta charset="utf-8"><span ${MARK}="${copied.id}"></span>`)
      copied.onClipboard = true
    }
    // Before upload slots get the paste (pasteImages.ts), so a copied feature never reads as a paste with no image in it
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || typing(event) || popupOpen()) return
      const data = event.clipboardData
      const marked = copiedId(data)
      const current = clip
      if (marked === undefined && (!current || current.onClipboard || holdsImage(data))) return
      event.preventDefault()
      // Copied in another tab, or before the page loaded again: only its id came
      if (!current || (marked !== undefined && marked !== current.id)) return reportError(new Error(AGAIN))
      if (current.workspace !== useWorkspace.getState().workspace) {
        forgetCopiedFeature()
        return reportError(new Error(AGAIN))
      }
      const { projectId: project, note: target } = latest.current
      const feature = current.copy.feature
      if (!target) return reportError(new Error(`Pick a banknote to paste the ${FEATURE_NAMES[feature].toLowerCase()} onto.`))
      pasteFeature({ projectId: project, noteId: target.id }, current)
        .then((pastedLayer) => {
          // Unless another banknote was picked meanwhile
          if (pastedLayer && latest.current.note?.id === target.id) latest.current.onPasted(target.id, pastedLayer)
        })
        .catch(reportError)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('copy', onCopy)
    window.addEventListener('paste', onPaste, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('paste', onPaste, { capture: true })
    }
  }, [enabled])
}
