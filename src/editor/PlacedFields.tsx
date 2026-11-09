import { ImageUp, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { IconButton, Labeled, LengthField, ScrubField } from '../components/controls'
import { reportError } from '../cloud/notices'
import { THUMB_PX, pickFiles, useImageUrl } from '../lib/images'
import { usePasteImage } from '../lib/pasteImages'
import { PLACE_MIN_MM, PLACE_STEP, type PlacedBox, boxRange, maxBoxWidth, normalRotation, resizeBox, rotationOf } from '../lib/placed'
import type { Note } from '../lib/types'
import { showsBack, useTilt } from '../tilt/tilt'

/**
 * A placed layer's one image (the watermark's, Arc-en-Ciel's, magnetic ink's): Upload image, or Replace beside its thumbnail (either
 * also takes an image pasted while the pointer is over it), and Remove image after it
 */
export function LayerImage({ imageId, grayscale = false, onUpload, onRemove }: {
  imageId: string | undefined
  /** The thumbnail in greyscale, when only the image's brightness counts */
  grayscale?: boolean
  onUpload: (file: File) => Promise<void>
  onRemove: () => void
}) {
  const image = useImageUrl(imageId, THUMB_PX)
  const paste = usePasteImage(onUpload)
  return (
    <Labeled label="Image">
      <div className="flex items-center gap-2">
        <Button
          {...paste}
          variant="outline"
          size="sm"
          className="h-[58px] flex-1 justify-start gap-2 overflow-hidden rounded-[calc(var(--radius-sm)+7px)] p-1.5"
          onClick={async () => {
            try {
              const [file] = await pickFiles()
              if (file) await onUpload(file)
            } catch (error) { reportError(error) }
          }}
        >
          {image ? (
            <img src={image} alt="" className={cn('h-11 w-11 shrink-0 rounded bg-muted object-contain', grayscale && 'grayscale')} />
          ) : imageId && image === undefined ? (
            // The image still on its way: its place shimmers
            <Skeleton className="size-11 shrink-0 rounded" />
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded bg-muted">
              <ImageUp />
            </span>
          )}
          {imageId ? 'Replace' : 'Upload image'}
        </Button>
        {imageId && (
          <IconButton label="Remove image" onClick={onRemove}>
            <X />
          </IconButton>
        )}
      </div>
    </Labeled>
  )
}

/**
 * Where a placed layer sits, the first thing in its panel: X and Y of its top-left corner and W, its height following its
 * image (placed.ts), then its Rotation about its middle, counterclockwise in degrees as Figma's reads (Keller, 9 November:
 * "I can also rotate elements on the banknote"; X, Y and W are still the box before it turned). Typed values are kept
 * exactly, in any unit. With the banknotes turned over, the same X is from the right edge, which is the front's left seen
 * from the back (only the watermark shows there), and the rotation reads as it shows there, the other way round.
 */
export function PlaceFields<T extends PlacedBox>({ note, box, name, onChange }: {
  note: Note
  box: T
  /** The layer, as a title starts it: "Watermark" */
  name: string
  onChange: (change: (box: T, note: Note) => T) => void
}) {
  // It may hang off the edges, as long as a quarter of it stays on the banknote
  const range = boxRange(box, note)
  const back = useTilt(showsBack)
  const edge = back ? 'right' : 'left'
  // Seen from the back, a turn counterclockwise on the front is one clockwise
  const seen = (deg: number) => (back ? -deg : deg) + 0
  return (
    <div className="grid grid-cols-2 gap-2">
      <Labeled label={`From ${edge}`}>
        <LengthField label="X" title={`${name} position from the ${edge} edge`} value={box.xMm} min={range.x[0]} max={range.x[1]}
          step={PLACE_STEP} onChange={(xMm) => onChange((b) => ({ ...b, xMm }))} />
      </Labeled>
      <Labeled label="From top">
        <LengthField label="Y" title={`${name} position from the top edge`} value={box.yMm} min={range.y[0]} max={range.y[1]}
          step={PLACE_STEP} onChange={(yMm) => onChange((b) => ({ ...b, yMm }))} />
      </Labeled>
      <Labeled label="Width">
        <LengthField label="W" title={`${name} width; its height follows the image`} value={box.widthMm} min={PLACE_MIN_MM}
          max={maxBoxWidth(box, note)} step={PLACE_STEP} onChange={(widthMm) => onChange((b, n) => resizeBox(b, widthMm, n))} />
      </Labeled>
      <Labeled label="Rotation">
        {/* Typed or scrubbed past half a turn either way, it carries on round (−180° to 180°) */}
        <ScrubField label={<RotateCcw className="size-3" aria-hidden="true" />} title={`${name} turned about its middle, counterclockwise`}
          value={seen(rotationOf(box))} min={-360} max={360} unit="°"
          onChange={(deg) => onChange((b) => ({ ...b, rotationDeg: normalRotation(seen(deg)) }))} />
      </Labeled>
    </div>
  )
}
