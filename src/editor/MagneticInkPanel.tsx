import { MoveHorizontal, MoveVertical } from 'lucide-react'
import { ColorField, Group, Labeled, ScrubField, Section, Segmented, SwitchField } from '../components/controls'
import { INK_BAR } from '../lib/magneticInk'
import type { MagneticInk, Note } from '../lib/types'
import type { NoteRef } from './frameActions'
import { setMagneticInkImage, updateMagneticInk } from './layerActions'
import { LayerImage, PlaceFields } from './PlacedFields'

/**
 * Right, under the Magnetic ink tab: the selected banknote's magnetic ink, SPARK Flow PRIME's look. One image, whose shape
 * takes the ink (whatever stands out from its background), or the ink goes round it with Invert. Where it sits comes
 * first, then the image, then its colour flat and tilted away, the bar that rolls across it on one tilt and how wide, and
 * whether it is lit as metal (Realistic). Removing it is beside the tabs.
 */
export function MagneticInkPanel({ note, ink, noteRef, onPlace }: {
  note: Note
  ink: MagneticInk
  noteRef: NoteRef
  /** Shows its box on the canvas, on the banknote laid flat, to place it */
  onPlace: () => void
}) {
  const change = (next: (ink: MagneticInk, note: Note) => MagneticInk) => updateMagneticInk(noteRef, next)
  const percent = (share: number) => Math.round(share * 100)

  return (
    <Group>
      {/* Where it sits first, then its image, then its look, as every placed layer's panel reads (Keller, 8 November) */}
      <Section nested>
        <PlaceFields note={note} box={ink} name="Magnetic ink" onChange={change} />
      </Section>

      <Section nested>
        <LayerImage imageId={ink.imageId}
          onUpload={async (file) => {
            await setMagneticInkImage(noteRef, file)
            onPlace()
          }}
          onRemove={() => void setMagneticInkImage(noteRef, undefined)} />
        {ink.imageId && (
          <SwitchField label="Invert" title="Ink round the shape instead of in it" checked={ink.invert === true}
            onChange={(on) => change((i) => ({ ...i, invert: on }))} />
        )}
      </Section>

      <Section nested>
        <Labeled label="Flat" title="The ink's colour seen flat">
          <ColorField value={ink.color} onChange={(color) => change((i) => ({ ...i, color }))} />
        </Labeled>
        <Labeled label="Tilted" title="Its colour as the banknote turns away, either way">
          <ColorField value={ink.tiltedColor} onChange={(tiltedColor) => change((i) => ({ ...i, tiltedColor }))} />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="Bar rolls on">
            <Segmented value={ink.barAxis}
              options={[
                { value: 'y', label: <MoveVertical className="size-3.5" aria-label="Up/down" /> },
                { value: 'x', label: <MoveHorizontal className="size-3.5" aria-label="Side to side" /> },
              ]}
              onChange={(barAxis) => change((i) => ({ ...i, barAxis }))} />
          </Labeled>
          <Labeled label="Bar width">
            <ScrubField label="B" title="How wide the bright bar is, as a share of the shape the way it rolls" value={percent(ink.barWidth)}
              min={percent(INK_BAR.min)} max={percent(INK_BAR.max)} step={percent(INK_BAR.step)} unit="%"
              onChange={(width) => change((i) => ({ ...i, barWidth: width / 100 }))} />
          </Labeled>
        </div>
        <SwitchField label="Realistic" title="Lit as metal flakes: the lamp's reflection with a soft glow, the colour shifting across the shape, and sparkle"
          checked={ink.realistic === true} onChange={(on) => change((i) => ({ ...i, realistic: on }))} />
      </Section>

    </Group>
  )
}
