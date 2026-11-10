import { Plus } from 'lucide-react'
import { useEffect } from 'react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { IconButton } from '../components/controls'
import { updateNote } from '../lib/store'
import { newWindow, threadLength as lengthOf } from '../lib/thread'
import type { Note } from '../lib/types'
import { SponsorWarning } from './EffectSection'
import type { NoteRef } from './frameActions'

/**
 * The thread's windows as a compact card: a switch (off = continuous, as new banknotes start, which says the sponsor
 * requires windows) and + to add one. The windows themselves are drawn, moved, resized, measured and deleted on the
 * canvas (Keller); switching them on or adding one starts editing them there.
 */
export function WindowsCard({ note, noteRef, onWindowSelect, tip = false, onTipDone }: {
  note: Note
  noteRef: NoteRef
  onWindowSelect: (id: string | undefined) => void
  /** A tip beside the card saying windows can be added here (a new project's first banknote, Keller), until `onTipDone` */
  tip?: boolean
  /** The next click or key anywhere ends the tip */
  onTipDone?: () => void
}) {
  const { windows } = note.thread
  const length = lengthOf(note)
  const setWindows = (patch: Partial<Note['thread']['windows']>) =>
    updateNote(noteRef.projectId, noteRef.noteId, (n) => ({ ...n, thread: { ...n.thread, windows: { ...n.thread.windows, ...patch } } }))
  const canAdd = !!newWindow(windows.sections, length)

  const addWindow = () => {
    const section = newWindow(windows.sections, length)
    if (!section) return
    setWindows({ sections: [...windows.sections, section].toSorted((a, b) => a.startMm - b.startMm) })
    onWindowSelect(section.id)
  }
  // Turning windows on shows the first one ready to adjust, adding one when there are none
  const setWindowed = (enabled: boolean) => {
    if (!enabled) {
      setWindows({ enabled })
      onWindowSelect(undefined)
      return
    }
    const first = windows.sections.at(0) ?? newWindow([], length)
    setWindows({ enabled, sections: windows.sections.length ? windows.sections : first ? [first] : [] })
    if (first) onWindowSelect(first.id)
  }
  useEffect(() => {
    if (!tip || !onTipDone) return
    window.addEventListener('pointerdown', onTipDone, true)
    window.addEventListener('keydown', onTipDone, true)
    return () => {
      window.removeEventListener('pointerdown', onTipDone, true)
      window.removeEventListener('keydown', onTipDone, true)
    }
  }, [tip, onTipDone])

  return (
    <div className="relative flex flex-col gap-2 rounded-lg bg-muted/67 p-2">
      <div className="flex h-6 items-center gap-1">
        <span className="flex-1 pl-0.5 text-xs">Windows</span>
        {windows.enabled && <IconButton label="Add window" size="icon-xs" disabled={!canAdd} onClick={addWindow}><Plus /></IconButton>}
        <Switch aria-label="Windows" checked={windows.enabled} onCheckedChange={setWindowed} />
      </div>

      {/* A thread without windows can't be printed for the sponsor (Keller), said as Vertical's ridges say it */}
      {!windows.enabled && <SponsorWarning className="pl-0.5">Windows are required by our sponsor, Oberthur</SponsorWarning>}

      {/* Anchored to a box over the card rather than the card itself, so the card stays as it is when the tip goes and
          the click that ends it still lands (on the switch, say) */}
      {tip && (
        <Tooltip open>
          <TooltipTrigger render={<span aria-hidden className="pointer-events-none absolute inset-0" />} />
          {/* Past the panel's inset, so it sits over the canvas with its arrow at the card */}
          <TooltipContent side="left" sideOffset={22}>You can add windows here</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
