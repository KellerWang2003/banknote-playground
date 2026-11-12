import { Monitor, Play } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { IconButton } from '../components/controls'
import { forPhone } from '../lib/demoLink'
import { CopyLink, QrCode } from './PhoneLink'
import { usePhoneDoor } from './usePhoneDoor'

/**
 * ▶ Demo in the corner bar, just before Export, its icon alone with Demo in its tooltip (Keller, 12 November: "When people
 * press demo ... it should just show the QR code because that's the intention. And going to full screen and demoing on
 * desktop should be secondary"): a panel under the corner bar with the banknote's QR code first, for a phone to open it
 * in Demo, and Copy link, then under them Demo on this screen, which opens Demo here, full screen. The sample project has
 * no link, as no phone can read it, so there ▶ opens Demo here straight away. From the dev server on localhost the link
 * goes through its door for phones on the Wi-Fi, as Demo's phone button's does (`forPhone`, dev/phoneDoor.ts)
 */
export function DemoButton({ link, onOpen }: {
  /** The banknote it opens, by link (`demoLink`), for a phone to open in Demo; none for the sample project */
  link: string | undefined
  /** Demo here, over the editor and full screen; called from a click, which full screen needs */
  onOpen: () => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const door = usePhoneDoor()
  if (!link) {
    return (
      <IconButton variant="outline" className="rounded-lg" label="Demo" onClick={onOpen}>
        <Play />
      </IconButton>
    )
  }
  const shown = forPhone(link, door)
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger ref={button} render={<PopoverTrigger render={<Button variant="outline" size="icon-sm" className="rounded-lg" aria-label="Demo" />} />}>
          <Play />
        </TooltipTrigger>
        <TooltipContent>Demo</TooltipContent>
      </Tooltip>
      {/* Under the corner bar and as wide, its top level with the right panel's, which opens under the bar too; the QR code
          as big as that allows, to scan from further off */}
      <PopoverContent anchor={() => button.current?.closest('[data-corner-bar]') ?? button.current} align="end" sideOffset={8}
        className="w-(--panel-w)" data-demo-panel="">
        <QrCode text={shown} className="aspect-square w-full rounded-md" />
        <CopyLink link={shown} />
        <Separator className="bg-border/70" />
        <Button variant="outline" size="sm" className="w-full" onClick={onOpen}>
          <Monitor />
          Demo on this screen
        </Button>
      </PopoverContent>
    </Popover>
  )
}
