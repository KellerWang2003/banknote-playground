import { Columns2, Droplet, Magnet, Plus, Rainbow } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { FEATURES, FEATURE_LINES, FEATURE_NAMES, hasFeature, type Feature } from '../lib/layers'
import type { Note } from '../lib/types'

/** Each feature's icon, in the Add menu and the Banknotes list, as on its tab in the right panel */
export const FEATURE_ICONS: Record<Feature, ReactNode> = { thread: <Columns2 />, watermark: <Droplet />, arcEnCiel: <Rainbow />, magneticInk: <Magnet /> }

/**
 * The one way to add a banknote's security features (Keller, 4 November): a + whose menu lists every feature the
 * banknote doesn't have yet, each with its icon and a line on what it is. The banknote's row in the Banknotes list and
 * the end of the right panel's tabs both have it, and so does the selected banknote under its features, as a row
 * (`row`, Keller: a clearer way to add them), and it goes once the banknote has them all.
 */
export function AddFeatureMenu({ note, onAdd, align = 'start', row }: {
  note: Note
  onAdd: (feature: Feature) => void
  align?: 'start' | 'end'
  /** As a row, "+ Add security feature", under the selected banknote's features; on its grey, its hover darkens it */
  row?: { onBlock: boolean }
}) {
  const addable = FEATURES.filter((f) => !hasFeature(note, f))
  if (addable.length === 0) return null
  return (
    <DropdownMenu>
      {row ? (
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-1.5 rounded-lg py-1 pr-1.5 pl-2 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground data-[popup-open]:text-foreground',
                row.onBlock ? 'hover:bg-foreground/5 data-[popup-open]:bg-foreground/5' : 'hover:bg-muted/50 data-[popup-open]:bg-muted/50',
              )}
            />
          }
        >
          <span className="flex h-5 shrink-0 items-center [&_svg]:size-3.5"><Plus /></span>
          Add security feature
        </DropdownMenuTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Add security feature" />} />}>
            <Plus />
          </TooltipTrigger>
          <TooltipContent>Add security feature</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent className="w-60" align={align}>
        {addable.map((f) => (
          <DropdownMenuItem key={f} className="items-start py-1.5" onClick={() => onAdd(f)}>
            <span className="mt-0.5 flex">{FEATURE_ICONS[f]}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>{FEATURE_NAMES[f]}</span>
              <span className="text-[11px] leading-snug whitespace-normal text-muted-foreground">{FEATURE_LINES[f]}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
