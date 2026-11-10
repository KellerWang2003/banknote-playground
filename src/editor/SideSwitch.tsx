import { RotateCcw, RotateCw } from 'lucide-react'
import { IconButton, Panel, Segmented } from '../components/controls'
import type { Side } from '../lib/back'
import { rotateNotes, turnOver, useTilt } from '../tilt/tilt'

const SIDES: { value: Side; label: string }[] = [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]

/**
 * Front | Back at the top of the canvas (Keller, 4 November: on the tilt card it was far too hidden): every banknote
 * turned over to its back, or round to its front, as F does; then Rotate left and Rotate right (Keller, 7 November),
 * every banknote a quarter turn about its own middle, as R and Shift+R do (`src/lib/rotate.ts`). Centred in the gap
 * between the two panels on its row, the Banknotes panel (12 px in, 224 px wide) and the corner bar with Export (12 px
 * in, as wide as the right panel, `--panel-w`), 8 px clear of each, so it stays put whether or not a banknote is selected:
 * the right panel opens under the corner bar, below this row (Keller, 8 November; it had moved left of the right panel
 * whenever one opened). Not in Thread Studio, as the thread is only on the front.
 */
export function SideSwitch() {
  const side: Side = useTilt((s) => (s.flipped ? 'back' : 'front'))
  return (
    <div className="pointer-events-none absolute top-3 right-[calc(var(--panel-w)+20px)] left-[244px] flex justify-center">
      <Panel className="pointer-events-auto flex h-11 items-center gap-0.5 p-1.5">
        <div className="mr-1 w-44" title="Turn every banknote over (F)">
          <Segmented value={side} options={SIDES} onChange={(next) => turnOver(next === 'back')} />
        </div>
        <IconButton className="rounded-lg" label="Rotate left" title="Rotate every banknote 90° left (Shift+R)" onClick={() => rotateNotes(-1)}>
          <RotateCcw />
        </IconButton>
        <IconButton className="rounded-lg" label="Rotate right" title="Rotate every banknote 90° right (R)" onClick={() => rotateNotes(1)}>
          <RotateCw />
        </IconButton>
      </Panel>
    </div>
  )
}
