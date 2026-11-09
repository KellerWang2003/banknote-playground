import { Plus } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Group, IconButton, Labeled, LengthField, ScrubField, Section, SwitchField } from '../components/controls'
import { ARC_ANGLE, ARC_BAND, ARC_COLOURS, ARC_EDGE, DEFAULT_ARC, ridgeAngle } from '../lib/arcEnCiel'
import { useBandShape } from '../lib/bandMap'
import { beginHistoryGroup, endHistoryGroup } from '../lib/history'
import type { ArcEnCiel, ArcFlow, Note } from '../lib/types'
import { ColourList } from './ColourList'
import type { NoteRef } from './frameActions'
import { setArcEnCielImage, updateArcEnCiel } from './layerActions'
import { LayerImage, PlaceFields } from './PlacedFields'

/** A fourth colour to add: one of the defaults the list doesn't have yet, or a teal */
const ADDED_COLOUR = '#1f9e89'
const nextColour = (colors: string[]) =>
  [...DEFAULT_ARC.colors, ADDED_COLOUR].find((c) => !colors.some((have) => have.toLowerCase() === c)) ?? ADDED_COLOUR

const FLOWS: { value: ArcFlow; label: string; title: string }[] = [
  { value: 'edge', label: 'Edge', title: "Inward from each separate shape's edge" },
  { value: 'holes', label: 'Holes', title: 'Outward from holes in the shape' },
  { value: 'point', label: 'Point', title: 'Rings from points on the canvas; double-click to add one' },
  { value: 'line', label: 'Line', title: 'Along a line on the canvas; double-click it to bend it' },
]

/**
 * Where the bands start, as `Segmented` picks (its look), with Holes greyed out on a shape that has none. Here and not in
 * controls.tsx as only this one greys an option out
 */
function FlowPicker({ value, holes, onChange }: { value: ArcFlow; holes: boolean; onChange: (flow: ArcFlow) => void }) {
  return (
    <ToggleGroup size="sm" spacing={0.5} className="w-full rounded-md bg-muted/90 p-0.5" value={[value]}
      onValueChange={(next) => {
        const picked = next.at(0)
        if (picked) onChange(picked as ArcFlow)
      }}>
      {FLOWS.map((f) => (
        <ToggleGroupItem key={f.value} value={f.value} title={f.title} disabled={f.value === 'holes' && !holes}
          className="flex-1 rounded-sm text-xs text-muted-foreground hover:bg-transparent disabled:opacity-40 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm">
          {f.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/**
 * Right, under the Arc-en-Ciel tab: the selected banknote's Arc-en-Ciel, in the order Keller asked for (8 November): where
 * it sits, then its image, whose shape takes the bands (whatever stands out from its background), or the bands go round it
 * with Invert, then the bands: where they start, their colours in order, how wide each is, and the ridges' angle, the tilt
 * across them sliding the bands; last the white edge of bare paper round the shape, and how wide it is (Keller,
 * 9 November). Drawing the embossed ridges themselves in the lamp's light is Realistic, beside the lamp, for every
 * banknote (`RealisticToggle` in TiltRail.tsx). Points, Line and the ridges' angle are placed on the canvas too
 * (ArcHandles.tsx). Removing it is beside the tabs.
 */
export function ArcEnCielPanel({ note, arc, noteRef, onPlace }: {
  note: Note
  arc: ArcEnCiel
  noteRef: NoteRef
  /** Shows its box on the canvas, on the banknote laid flat, to place it (with its points or line) */
  onPlace: () => void
}) {
  const change = (next: (arc: ArcEnCiel, note: Note) => ArcEnCiel) => updateArcEnCiel(noteRef, next)
  // Whether the shape has holes, once read
  const shape = useBandShape(arc)
  const holes = !!shape?.holes

  return (
    <Group>
      <Section nested>
        <PlaceFields note={note} box={arc} name="Arc-en-Ciel" onChange={change} />
      </Section>

      <Section nested>
        <LayerImage imageId={arc.imageId}
          onUpload={async (file) => {
            await setArcEnCielImage(noteRef, file)
            onPlace()
          }}
          onRemove={() => void setArcEnCielImage(noteRef, undefined)} />
        {arc.imageId && (
          <SwitchField label="Invert" title="Bands round the shape instead of in it" checked={arc.invert === true}
            onChange={(on) => change((a) => ({ ...a, invert: on }))} />
        )}
      </Section>

      <Section nested>
        <Labeled label="Bands from" title="Where the bands start">
          <FlowPicker value={arc.flow} holes={holes}
            onChange={(flow) => {
              change((a) => ({ ...a, flow }))
              // Points and Line are placed on the canvas: their handles show with its box
              if (flow === 'point' || flow === 'line') onPlace()
            }} />
        </Labeled>
        <Labeled label="Colours" title="The bands' colours, in order from where they start"
          action={(
            <IconButton label="Add colour" size="icon-xs" className="-mr-1 size-5 text-muted-foreground" disabled={arc.colors.length >= ARC_COLOURS.max}
              onClick={() => change((a) => ({ ...a, colors: [...a.colors, nextColour(a.colors)] }))}>
              <Plus />
            </IconButton>
          )}>
          <ColourList colors={arc.colors} min={ARC_COLOURS.min} onChange={(colors) => change((a) => ({ ...a, colors }))}
            onDrag={(dragging) => (dragging ? beginHistoryGroup(noteRef.projectId) : endHistoryGroup(noteRef.projectId))} />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="Band width">
            <LengthField label="B" title="How wide one colour band is" value={arc.bandMm} min={ARC_BAND.min} max={ARC_BAND.max} step={ARC_BAND.step}
              onChange={(bandMm) => change((a) => ({ ...a, bandMm }))} />
          </Labeled>
          <Labeled label="Ridge angle">
            <ScrubField label="∠" title="The ridges' angle from the banknote's horizontal: tilting across them slides the bands" value={arc.angleDeg}
              min={ARC_ANGLE.min} max={ARC_ANGLE.max} unit="°" onChange={(angleDeg) => change((a) => ({ ...a, angleDeg: ridgeAngle(angleDeg) }))} />
          </Labeled>
        </div>
      </Section>

      <Section nested>
        <SwitchField label="White edge" title="Bare paper round the shape, embossed with the ridges when Realistic is on" checked={arc.edgeMm !== undefined}
          onChange={(on) => change(({ edgeMm: _edge, ...a }) => (on ? { ...a, edgeMm: ARC_EDGE.initial } : a))} />
        {arc.edgeMm !== undefined && (
          <Labeled label="Edge width">
            <LengthField label="E" title="How wide the white edge round the shape is" value={arc.edgeMm} min={ARC_EDGE.min} max={ARC_EDGE.max}
              step={ARC_EDGE.step} onChange={(edgeMm) => change((a) => ({ ...a, edgeMm }))} />
          </Labeled>
        )}
      </Section>
    </Group>
  )
}
