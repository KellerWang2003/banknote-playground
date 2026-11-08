import { Slider } from '@/components/ui/slider'
import { Group, Labeled, ScrubField, Section, SwitchField } from '../components/controls'
import { useReading } from '../lib/relief'
import type { Note, Watermark, WatermarkLevels } from '../lib/types'
import { FULL_LEVELS, LEVELS_GAP, gammaAt, midtonesAt } from '../lib/watermark'
import type { NoteRef } from './frameActions'
import { setWatermarkImage, updateWatermark } from './layerActions'
import { LayerImage, PlaceFields } from './PlacedFields'

/**
 * Right, under the Watermark tab: the selected banknote's watermark. One image, read only by brightness, as paper has no
 * colour: its light parts are thinner paper that lets more light through, or its dark parts with Invert. Where it sits
 * comes first, then the image, whose levels, Auto or by hand, shape how thin, then how strongly it shows. Removing it is
 * beside the tabs.
 */
export function WatermarkPanel({ note, watermark, noteRef, onPlace }: {
  note: Note
  watermark: Watermark
  noteRef: NoteRef
  /** Shows it on the canvas, flat and clear, to place it */
  onPlace: () => void
}) {
  const reading = useReading(watermark)
  // By hand, or Auto's for the image as read
  const levels = watermark.levels ?? reading?.auto
  const change = (next: (w: Watermark, n: Note) => Watermark) => updateWatermark(noteRef, next)

  return (
    <Group>
      {/* Where it sits first, then its image, then how strongly it shows, as every placed layer's panel reads (Keller, 8 November) */}
      <Section nested>
        <PlaceFields note={note} box={watermark} name="Watermark" onChange={change} />
      </Section>

      <Section nested>
        {/* In greyscale, as only its brightness counts */}
        <LayerImage imageId={watermark.imageId} grayscale
          onUpload={async (file) => {
            await setWatermarkImage(noteRef, file)
            onPlace()
          }}
          onRemove={() => void setWatermarkImage(noteRef, undefined)} />
        {watermark.imageId && (
          <>
            <SwitchField label="Invert" checked={watermark.invert === true} onChange={(on) => change((w) => ({ ...w, invert: on }))} />
            {/* Off, it keeps the levels Auto had, to set by hand; moving a handle turns it off too */}
            <SwitchField label="Auto levels" title="Levels fitted to the image" checked={!watermark.levels}
              onChange={(on) => change(({ levels: _byHand, ...w }) => (on ? w : { ...w, levels: levels ?? FULL_LEVELS }))} />
            <LevelsSlider levels={levels} onChange={(next) => change((w) => ({ ...w, levels: next }))} />
          </>
        )}
      </Section>

      <Section nested>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="Depth">
            <ScrubField label="D" title="How strongly the watermark shows at its clearest, tilted or held to the light" value={Math.round(watermark.depth * 100)} min={0} max={100}
              step={5} unit="%" onChange={(depth) => change((w) => ({ ...w, depth: depth / 100 }))} />
          </Labeled>
        </div>
      </Section>
    </Group>
  )
}

/** The levels slider's handles, left to right */
const HANDLES = ['Where the watermark starts', 'Midtones', 'Where it is thinnest']
/** Black, grey and white handles, as in Photoshop's Levels */
const HANDLE_TONES = ['bg-neutral-900', 'bg-neutral-500', undefined]

/** A share 0 to 1 from the slider's percent, without float dust */
const share = (percent: number) => Math.round(percent * 10) / 1000

/**
 * Levels on how thin the paper is: where the watermark starts (anything fainter stays plain paper), its midtones, and
 * where it reaches the thinnest paper. The midtones handle keeps its place between the ends as they move.
 */
function LevelsSlider({ levels, onChange }: { levels: WatermarkLevels | undefined; onChange: (levels: WatermarkLevels) => void }) {
  const { low, high, gamma } = levels ?? FULL_LEVELS
  const percent = (x: number) => Math.round(x * 1000) / 10
  return (
    <Slider
      value={[percent(low), percent(low + (high - low) * midtonesAt(gamma)), percent(high)]}
      min={0}
      max={100}
      step={1}
      minStepsBetweenValues={1}
      disabled={!levels}
      thumbLabel={(i) => HANDLES[i]}
      thumbClassName={(i) => HANDLE_TONES[i]}
      onValueChange={(value, { activeThumbIndex: i }) => {
        if (!levels || !Array.isArray(value)) return
        const [lo, mid, hi] = value.map(share)
        if (i === 0) onChange({ ...levels, low: Math.min(lo, high - LEVELS_GAP) })
        else if (i === 2) onChange({ ...levels, high: Math.max(hi, low + LEVELS_GAP) })
        else onChange({ ...levels, gamma: gammaAt((mid - low) / (high - low)) })
      }}
    />
  )
}
