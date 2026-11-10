import { ImagePlus } from 'lucide-react'
import { reportError } from '../cloud/notices'
import { IconButton } from '../components/controls'
import type { Side } from '../lib/back'
import { pickFiles } from '../lib/images'
import { usePasteImage } from '../lib/pasteImages'
import { setBackImage, setFaceImage, type NoteRef } from './frameActions'

/**
 * A + in the middle of a banknote side that has no design yet, to upload it straight from the canvas (Keller, 4
 * November), as its card on the Banknote tab does, or to paste one into while the pointer is over it. Drawn over the
 * banknote, never in it, so it is never exported; the canvas hides it while banknotes play or are dragged, and on
 * banknotes too small on screen to hold it.
 */
export function UploadDesignButton({ noteRef, side }: { noteRef: NoteRef; side: Side }) {
  const set = (file: File) => (side === 'back' ? setBackImage : setFaceImage)(noteRef, file)
  const upload = async () => {
    try {
      const [file] = await pickFiles()
      if (file) await set(file)
    } catch (error) { reportError(error) }
  }
  const paste = usePasteImage(set)
  return (
    // Its centre is the banknote's, which stays put however the banknote tilts
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <IconButton
        {...paste}
        label={side === 'back' ? 'Upload the back’s design' : 'Upload design'}
        variant="outline"
        size="icon"
        data-upload-design={side}
        className="pointer-events-auto size-10 rounded-full bg-background/95 shadow-sm"
        // Its own press: the canvas would take it for a tilt
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={() => void upload()}
      >
        <ImagePlus className="size-5" />
      </IconButton>
    </div>
  )
}
