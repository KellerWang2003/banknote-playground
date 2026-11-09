import { CircleCheck, TriangleAlert } from 'lucide-react'
import { create } from 'zustand'
import { cn } from '@/lib/utils'
import { Drawer, Labeled, LengthField, Section, SwitchField } from '../components/controls'
import { designFace, type Side } from '../lib/back'
import { CUT_MM, designChecks, failingChecks, useDesign, type DesignCheck } from '../lib/continuous'
import { useReading } from '../lib/relief'
import { updateNote } from '../lib/store'
import type { Note } from '../lib/types'
import { useLengthUnit } from '../lib/units'
import type { NoteRef } from './frameActions'
import { Explain } from './LensVisuals'

/**
 * Under the banknote's background, for an uploaded design: the continuous check. On, the canvas shows the design's
 * neighbours on the print sheet around the banknote and where its edges break, and the Checks drawer lists the breaks.
 */
export function ContinuousSection({ note, noteRef }: { note: Note; noteRef: NoteRef }) {
  const update = (change: (n: Note) => Note) => updateNote(noteRef.projectId, noteRef.noteId, change)
  const check = note.continuous
  return (
    <Section nested>
      <SwitchField label="Continuous check" title="Check that the design carries on where its edges meet its neighbours' on the print sheet"
        checked={check !== undefined}
        onChange={(on) => update(({ continuous: _check, ...n }) => (on ? { ...n, continuous: { cutMm: CUT_MM.initial } } : n))} />
      {check && (
        <Labeled label="Cut tolerance">
          <LengthField label="±" title="How far either side of each edge the cut may land"
            value={check.cutMm} min={CUT_MM.min} max={CUT_MM.max} step={CUT_MM.step} onChange={(cutMm) => update((n) => ({ ...n, continuous: { cutMm } }))} />
        </Labeled>
      )}
    </Section>
  )
}

/** Whether the Checks drawer is open, kept from banknote to banknote as the Preview drawer is */
const useChecksDrawer = create<{ open: boolean }>(() => ({ open: false }))

/**
 * At the Banknote tab's foot, for an uploaded design, as Thread Studio's Checks: with the Continuous check on, whether
 * the design is at the banknote's size and its edges join; then whether the paper is light under the watermark and around
 * the thread. Warnings only, closed by default, the number of checks with something to look at beside its title. They
 * check the design of the side the canvas shows, the back's once the banknotes are turned over.
 */
export function ChecksDrawer({ note, side = 'front' }: { note: Note; side?: Side }) {
  const open = useChecksDrawer((s) => s.open)
  const design = useDesign(designFace(note, side))
  const reading = useReading(note.watermark)
  const unit = useLengthUnit((s) => s.unit)
  const checks = design ? designChecks(note, design, reading, unit, side) : []
  const failing = failingChecks(checks)
  return (
    <Drawer title="Checks" open={open} onOpenChange={(next) => useChecksDrawer.setState({ open: next })}
      // Marked as the back's, as the Preview drawer marks a mixed print
      action={side === 'back' || failing > 0 ? (
        <span className="flex items-center gap-2">
          {side === 'back' && <span className="text-[11px] text-muted-foreground" title="The banknotes are turned over: these check the back's design">Back</span>}
          {failing > 0 && <span className="text-xs text-amber-600 tabular-nums dark:text-amber-500">{failing}</span>}
        </span>
      ) : undefined}>
      <CheckList checks={checks} />
    </Drawer>
  )
}

/** Every check as a line, ticked or with what breaks it, as Thread Studio lists its rules */
function CheckList({ checks }: { checks: DesignCheck[] }) {
  return (
    <div className="flex flex-col gap-2">
      {checks.map((check) => {
        const clear = check.issues.length === 0
        const Icon = clear ? CircleCheck : TriangleAlert
        return (
          <div key={check.id} data-check={check.id} className="flex flex-col gap-0.5">
            <div className={cn('flex items-center gap-1.5 text-xs', clear && 'text-muted-foreground')}>
              <Icon className={cn('size-3.5 shrink-0', clear ? 'text-emerald-600 dark:text-emerald-500' : 'text-amber-600 dark:text-amber-500')} />
              <Explain label={check.title} caption={check.explain} />
            </div>
            {check.issues.map((issue, k) => (
              <p key={k} title={issue.title} className="py-1 pl-5 text-xs leading-snug text-muted-foreground">{issue.text}</p>
            ))}
          </div>
        )
      })}
    </div>
  )
}
