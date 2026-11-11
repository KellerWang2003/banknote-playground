import { useEffect, useRef } from 'react'
import { reportError } from '../cloud/notices'
import { useWorkspace } from '../cloud/workspace'
import { type FeatureCopy, featureCopy, featureImageIds, hasCopy, withFeatureCopy } from '../lib/copyFeature'
import { copyImage, removeImage } from '../lib/images'
import { FEATURE_NAMES, type Feature } from '../lib/layers'
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
 * ⌘/Ctrl+V pastes it onto the selected banknote, whichever of its parts is picked, and picks it there. The copy is kept
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
 * Pastes a copied security feature onto a banknote: added, or in place of the one of that kind it has, with copies of
 * its own of the images, as Duplicate gives a banknote's copy, in one undo step. Pasted back onto the banknote it came
 * from, unchanged since, it changes nothing. Resolves to whether the banknote changed
 */
export async function pasteFeature({ projectId, noteId }: NoteRef, pasted: Pick<FeatureClip, 'copy' | 'from'>): Promise<boolean> {
  const target = findNote(projectId, noteId)
  if (!target || hasCopy(target, pasted.copy)) return false
  const images = new Map(await Promise.all(featureImageIds(pasted.copy).map(async (id) => [id, await copyImage(id)] as const)))
  const note = findNote(projectId, noteId)
  if (!note) return false
  const replaced = featureCopy(note, pasted.copy.feature)
  updateNote(projectId, noteId, (n) => withFeatureCopy(n, pasted.copy, pasted.from, images))
  if (replaced) await Promise.all(featureImageIds(replaced).map((id) => removeImage(id)))
  return true
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
  onPasted: (noteId: string, feature: Feature) => void
}) {
  // The latest, for the listeners below
  const latest = useRef({ projectId, note, layer, onPasted })
  useEffect(() => {
    latest.current = { projectId, note, layer, onPasted }
  })

  useEffect(() => {
    if (!enabled) return
    const copyPicked = () => {
      const { note: picked, layer: part } = latest.current
      return picked && part !== 'note' ? copyFeature(picked, part) : undefined
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
        .then(() => {
          // Unless another banknote was picked meanwhile
          if (latest.current.note?.id === target.id) latest.current.onPasted(target.id, feature)
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
