import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Panel } from '../components/controls'
import { NoteSkeleton } from '../components/NoteView'
import { DOTS } from '../editor/Canvas'
import { TILT_PANEL_PX } from '../editor/TiltRail'
import { useTiltPad } from '../lib/tiltPad'
// The corner bar is as wide as the right panel, which this sets for the page (`--panel-w`)
import '../lib/panelWidth'

/** The canvas's dots 10 mm apart at about the scale the banknotes show at */
const SCALE = 2.4
/** The banknotes' rows in the list, and the two on the canvas */
const NOTES = [0, 1, 2]

/**
 * The editor while its project is still on its way (its link opened on a device that hasn't it yet, or read from this
 * one): the canvas with every floating panel where the editor puts it, as with nothing selected, their contents as
 * skeletons, and banknotes as plain paper shimmering, as banknotes whose designs are still loading show. Only the way
 * back to Projects works meanwhile (Exit demo, for the demo being made).
 */
export function EditorSkeleton({ isDemo = false }: { isDemo?: boolean }) {
  const padOpen = useTiltPad((s) => s.open)
  return (
    <div aria-busy="true" aria-label="Loading project" data-editor-skeleton=""
      className="relative flex h-full overflow-hidden bg-muted/40"
      style={{ backgroundImage: DOTS, backgroundSize: `${10 * SCALE}px ${10 * SCALE}px` }}>
      <div className="flex flex-1 items-center justify-center gap-6 pb-24">
        <NoteSkeleton widthMm={150} heightMm={70} scale={SCALE} />
        <NoteSkeleton widthMm={150} heightMm={70} scale={SCALE} />
      </div>

      {/* Top middle: Flip, then Rotate left and right, centred between the Banknotes panel and the corner bar, as
          `SideSwitch` is, each mark where the real button's icon or word sits */}
      <div className="pointer-events-none absolute top-3 right-[calc(var(--panel-w)+20px)] left-[244px] flex justify-center">
        <Panel className="flex h-11 items-center gap-0.5 p-1.5">
          <div className="flex h-7 items-center gap-1 px-2.5">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3 w-6 rounded-sm" />
          </div>
          <div className="flex size-7 items-center justify-center"><Skeleton className="size-4 rounded" /></div>
          <div className="flex size-7 items-center justify-center"><Skeleton className="size-4 rounded" /></div>
        </Panel>
      </div>

      {/* Top left: back to Projects, the project's name, its banknotes */}
      <Panel className="absolute top-3 left-3 flex w-[224px] flex-col">
        <div className="flex items-center justify-between gap-1 p-1.5">
          <Button variant="ghost" size="sm" className="rounded-lg px-1.5" onClick={() => (location.hash = '')}>
            <ChevronLeft />
            {isDemo ? 'Exit demo' : 'Projects'}
          </Button>
          <div className="flex items-center gap-2 pr-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="size-4 rounded" />
          </div>
        </div>
        <div className="flex h-9.5 items-center pr-3 pb-1.5 pl-4">
          <Skeleton className="h-3.5 w-28 rounded-sm" />
        </div>
        <Separator />
        <div className="flex h-9 items-center px-3">
          <Skeleton className="h-2.5 w-20 rounded-sm" />
        </div>
        <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5">
          {NOTES.map((i) => (
            <li key={i} className="flex items-center gap-2 py-1 pr-1.5 pl-6">
              <span className="flex size-7 shrink-0 items-center justify-center">
                <NoteSkeleton widthMm={150} heightMm={70} scale={28 / 150} />
              </span>
              <Skeleton className="h-3 rounded-sm" style={{ width: 96 - 16 * i }} />
            </li>
          ))}
        </ul>
      </Panel>

      {/* Top right: the corner bar, zoom on its left, ▶ Demo and Export on its right */}
      <Panel className="absolute top-3 right-3 flex h-11 w-(--panel-w) items-center gap-3 px-3">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-3.5 w-9 rounded-sm" />
        <Skeleton className="size-4 rounded" />
        <Skeleton className="size-4 rounded" />
        <div className="ml-auto flex items-center gap-1">
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="h-7 w-[78px] rounded-lg" />
        </div>
      </Panel>

      {/* Bottom left: the tilt card, its pad as it was left, over the playback bar */}
      <Panel className="absolute bottom-[108px] left-3 p-1.5">
        <div className="flex flex-col gap-1.5" style={{ width: TILT_PANEL_PX - 2 * 6 - 2 }}>
          <div className="flex h-6 items-center justify-between">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="size-4 rounded" />
          </div>
          {padOpen && <Skeleton className="aspect-square w-full rounded-lg" />}
          <div className="flex gap-1">
            <Skeleton className="h-7 flex-1 rounded-lg" />
            <Skeleton className="h-7 flex-1 rounded-lg" />
          </div>
        </div>
      </Panel>
      <Panel className="absolute bottom-3 left-3 flex h-[88px] gap-2 p-2" >
        <div className="flex shrink-0 gap-2" style={{ width: TILT_PANEL_PX - 2 * 8 - 2 }}>
          <Skeleton className="flex-1 rounded-lg" />
          <div className="flex w-8 flex-col items-center justify-center gap-4">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="size-4 rounded" />
          </div>
        </div>
      </Panel>
    </div>
  )
}
