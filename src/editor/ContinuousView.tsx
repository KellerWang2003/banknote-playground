import { DesignTiles } from '../components/DesignTiles'
import { PAPER } from '../lib/back'
import { edgeBreaks, neighboursPx, useDesign } from '../lib/continuous'
import { designPx, useImageUrl } from '../lib/images'
import type { Note } from '../lib/types'
import { useTilt } from '../tilt/tilt'

/**
 * The continuous check on the canvas, while the banknote itself is picked: its neighbours on the print sheet around it
 * and where its edges break. All of it lies flat, so it steps back while the banknote is turned, played or dragged, and
 * none of it takes a click or is exported. No line marks the cut tolerance inside the edges and nothing previews a cut
 * landing off (Keller, 9 November: the dashed line round the banknote and the drift went).
 */

/**
 * How much of that, from the banknote out, they show at full strength before fading away: at the seam they are as
 * printed, so you see whether the colour carries across (Keller: faint copies only ever showed a step)
 */
const NEIGHBOURS_FULL = 0.5
/** Tilt either way under which the banknote counts as flat: turned this little, it is out by a pixel at most */
const FLAT_DEG = 2
/** Break marks: how thick, how far out from the edge and at least how long, px */
const MARK_PX = 2
const MARK_GAP_PX = 2
const MARK_MIN_PX = 3

/**
 * Whether what is drawn flat around the banknote lines up with it: not while it is turned in perspective, turning over,
 * played or dragged
 */
function useShown(quiet: boolean) {
  const flat = useTilt((s) => (s.turn === 0 || s.turn === 1) && (!s.perspective || (Math.abs(s.angle) < FLAT_DEG && Math.abs(s.angleX) < FLAT_DEG)))
  return flat && !quiet
}

/**
 * Behind the banknote: copies of its design where its neighbours sit on the print sheet, edge to edge with it, as strong
 * as the banknote by it and fading out further away. Where an edge doesn't carry on into its copy, the seam shows.
 */
export function NeighbourRing({ note, scale, quiet }: { note: Note; scale: number; quiet: boolean }) {
  // The same copy the banknote shows, so both draw from one
  const url = useImageUrl(note.faceImageId, designPx(note, scale))
  const shown = useShown(quiet)
  if (!url) return null
  const width = note.widthMm * scale
  const height = note.heightMm * scale
  const margin = neighboursPx(scale)
  // Full strength by the banknote, fading out over the outer part of the margin
  const fading = margin * (1 - NEIGHBOURS_FULL)
  const fade = (to: string) => `linear-gradient(${to}, transparent, black ${fading}px, black calc(100% - ${fading}px), transparent)`
  const mask = `${fade('to right')}, ${fade('to bottom')}`
  return (
    <div aria-hidden="true" data-neighbours="" className="pointer-events-none absolute overflow-hidden transition-opacity duration-150"
      style={{ left: -margin, top: -margin, width: width + 2 * margin, height: height + 2 * margin, opacity: shown ? 1 : 0,
        maskImage: mask, WebkitMaskImage: mask, maskComposite: 'intersect', WebkitMaskComposite: 'source-in' }}>
      <div className="absolute" style={{ left: margin, top: margin }}>
        <DesignTiles url={url} width={width} height={height} color={PAPER} />
      </div>
    </div>
  )
}

/**
 * Round the banknote: amber bars just outside the edges along the stretches that don't carry on into the edge across, on
 * both edges of each pair
 */
export function EdgeMarks({ note, scale, quiet }: { note: Note; scale: number; quiet: boolean }) {
  const design = useDesign(note)
  const shown = useShown(quiet)
  const breaks = design ? edgeBreaks(design) : undefined
  const width = note.widthMm * scale
  const height = note.heightMm * scale
  const span = (startMm: number, endMm: number) => ({ at: startMm * scale, length: Math.max(MARK_MIN_PX, (endMm - startMm) * scale) })
  return (
    <div aria-hidden="true" data-edge-marks="" className="pointer-events-none absolute top-0 left-0 transition-opacity duration-150"
      style={{ width, height, opacity: shown ? 1 : 0 }}>
      {breaks?.topBottom.flatMap((s) => {
        const { at, length } = span(s.startMm, s.endMm)
        return [-MARK_GAP_PX - MARK_PX, height + MARK_GAP_PX].map((top) => (
          <div key={`${s.startMm}:${top}`} data-break="top" className="absolute rounded-full bg-amber-500" style={{ left: at, top, width: length, height: MARK_PX }} />
        ))
      })}
      {breaks?.leftRight.flatMap((s) => {
        const { at, length } = span(s.startMm, s.endMm)
        return [-MARK_GAP_PX - MARK_PX, width + MARK_GAP_PX].map((left) => (
          <div key={`${s.startMm}:${left}`} data-break="side" className="absolute rounded-full bg-amber-500" style={{ top: at, left, height: length, width: MARK_PX }} />
        ))
      })}
    </div>
  )
}
