import { FlipHorizontal2, RotateCcw, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton, Panel } from '../components/controls'
import { rotateNotes, turnOver } from '../tilt/tilt'

/**
 * Flip at the top of the canvas (Keller, 4 November: on the tilt card it was far too hidden): every banknote turned
 * over to its other side, as F does, one button rather than Front | Back (Keller, 11 November: "it shouldn't be front
 * and back. It should be just a simple flip"); then Rotate left and Rotate right (Keller, 7 November), every banknote a
 * quarter turn about its own middle, as R and Shift+R do (`src/lib/rotate.ts`). Centred in the gap between the two
 * panels on its row, the Banknotes panel (12 px in, 224 px wide) and the corner bar with Export (12 px in, as wide as the
 * right panel, `--panel-w`), 8 px clear of each, so it stays put whether or not a banknote is selected: the right panel
 * opens under the corner bar, below this row (Keller, 8 November; it had moved left of the right panel whenever one
 * opened). Not in Thread Studio, as the thread is only on the front.
 */
export function SideSwitch() {
  return (
    <div className="pointer-events-none absolute top-3 right-[calc(var(--panel-w)+20px)] left-[244px] flex justify-center">
      <Panel className="pointer-events-auto flex h-11 items-center gap-0.5 p-1.5">
        <Button variant="ghost" size="sm" className="rounded-lg" title="Turn every banknote over (F)" onClick={() => turnOver()}>
          <FlipHorizontal2 />
          Flip
        </Button>
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
