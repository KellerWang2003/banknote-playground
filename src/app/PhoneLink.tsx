import { Check, Copy, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import { encode } from 'uqr'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { reportError } from '../cloud/notices'
import { forPhone } from '../lib/demoLink'
import { usePhoneDoor } from './usePhoneDoor'

/** A QR code, drawn as one SVG path of square modules, black on white with the quiet border scanners need */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 })
    let d = ''
    qr.data.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`
    }))
    return { size: qr.size, path: d }
  }, [text])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={cn('shrink-0', className)} role="img" aria-label="QR code for the link" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

/**
 * The phone button in Demo's bar on the laptop: the banknote shown, on a phone, by its QR code, or its link to copy
 * (Keller, 10 November: like Figma's prototype mode, mirrored on the phone). From the dev server on localhost both go
 * through its door for phones on the Wi-Fi (Keller, 11 November: "when im on local, the link on my phone still works")
 */
export function PhoneLink({ link, finalFocus = true }: {
  link: string
  /** Where the keys go once it closes (Demo itself), rather than back to the button, whose tooltip would take the next Esc */
  finalFocus?: ComponentProps<typeof PopoverContent>['finalFocus']
}) {
  const shown = forPhone(link, usePhoneDoor())
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open on your phone" />} />}>
          <Smartphone />
        </TooltipTrigger>
        <TooltipContent>Open on your phone</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" sideOffset={12} className="w-56 items-center" finalFocus={finalFocus}>
        <QrCode text={shown} className="size-48 rounded-md" />
        <CopyLink link={shown} />
      </PopoverContent>
    </Popover>
  )
}

/** Copy link, under a QR code: the link for a phone, to send it there another way; Copied for a moment once it is */
export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button variant="outline" size="sm" className="w-full"
      onClick={() => {
        navigator.clipboard.writeText(link).then(() => setCopied(true), reportError)
      }}>
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  )
}
