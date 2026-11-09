// @vitest-environment jsdom
import React from 'react'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { LengthField } from '../src/components/controls'
import { NOTE_SIZE, createNote } from '../src/lib/notes'
import { useHistory } from '../src/lib/history'
import { checkPattern } from '../src/lib/patternRules'
import { updateNote, useProjects } from '../src/lib/store'
import {
  formatLength, lengthField, lengthIn, parseLength, setLengthUnit, stepIn, toMm, useLengthUnit, type LengthUnit,
} from '../src/lib/units'
import { fitWatermark, moveWatermark, newWatermark } from '../src/lib/watermark'

vi.mock('../src/cloud/client', () => ({ cloudConfigured: true }))
vi.mock('../src/cloud/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cloud/repository')>()
  return { ...actual, createRepository: () => ({
    list: async () => [],
    save: async (record: import('../src/cloud/sync').CachedProject) => ({ project: record.project, revision: record.revision, deleted: record.deleted }),
  }) }
})
// The demo's artwork is drawn on a canvas, which jsdom lacks: Demo opens one plain banknote instead
vi.mock('../src/lib/demo', async () => {
  const { createProject, createNote } = await import('../src/lib/notes')
  // With windows, as the real demo's first banknote has (new banknotes start without)
  return { createDemoProject: async () => {
    const note = createNote({ name: 'Demo banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#123456' })
    return { ...createProject('Demo fixture'), notes: [{ ...note, thread: { ...note.thread, windows: { ...note.thread.windows, enabled: true } } }] }
  } }
})
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  localStorage.clear()
  location.hash = ''
  setLengthUnit('mm')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('length units', () => {
  it('reads a length in each unit to its decimals', () => {
    // A US dollar is 156.1 × 66.3 mm, a thread 4 mm thick
    const read = (unit: LengthUnit) => `${lengthIn(156.1, unit)} × ${lengthIn(66.3, unit)} · ${formatLength(4, unit)}`
    expect(read('mm')).toBe('156.1 × 66.3 · 4 mm')
    expect(read('cm')).toBe('15.61 × 6.63 · 0.4 cm')
    expect(read('in')).toBe('6.146 × 2.61 · 0.157 in')
    expect(read('pt')).toBe('442.5 × 187.9 · 11.3 pt')
  })

  it('keeps a typed length exactly, without float dust', () => {
    expect(toMm(6.14, 'in')).toBe(155.956)
    expect(toMm(15.61, 'cm')).toBe(156.1)
    expect(toMm(72, 'pt')).toBe(25.4)
    expect(toMm(85.3, 'mm')).toBe(85.3)
  })

  it('reads a unit typed after the number, converted to the field’s', () => {
    expect(parseLength('15cm', 'mm')).toBe(150)
    expect(parseLength(' 6.14 in ', 'mm')).toBeCloseTo(155.956, 9)
    expect(parseLength('6.14"', 'in')).toBe(6.14)
    expect(parseLength('6.14″', 'in')).toBe(6.14)
    expect(parseLength('442pt', 'in')).toBeCloseTo(6.1389, 4)
    expect(parseLength('15,6 CM', 'cm')).toBe(15.6)
    expect(parseLength('.5', 'mm')).toBe(0.5)
    expect(parseLength('12', 'pt')).toBe(12)
    for (const text of ['', ' ', 'abc', '1.2.3', '12 px', 'in', '12 in 3']) expect(parseLength(text, 'mm')).toBeUndefined()
  })

  it('steps a round number of each unit, never coarser than the step in mm', () => {
    const steps = (mm: number) => (['mm', 'cm', 'in', 'pt'] as const).map((unit) => stepIn(mm, unit))
    expect(steps(0.5)).toEqual([0.5, 0.05, 0.01, 1])
    expect(steps(0.1)).toEqual([0.1, 0.01, 0.002, 0.2])
    expect(steps(1)).toEqual([1, 0.1, 0.02, 2])
  })

  it('accepts the number shown at a limit, and keeps what it gives within the limits', () => {
    // Limits of 20 to 250 mm read 0.787 to 9.843 in
    const field = lengthField('in', { value: 150, min: 20, max: 250, step: 0.5 })
    expect(field.format(field.min)).toBe('0.787')
    expect(field.format(field.max)).toBe('9.843')
    expect(9.843).toBeLessThanOrEqual(field.max)
    expect(field.toMm(9.843)).toBe(250)
    expect(field.toMm(0.787)).toBe(20)
    expect(field.format(field.value)).toBe('5.906')
    expect(field.step).toBe(0.01)
    // A section's width keeps its twelfths of the thread
    expect(lengthField('in', { value: 2, min: 1 / 3, max: 4, step: 4 / 12, exactStep: true }).step).toBeCloseTo(4 / 12 / 25.4, 12)
  })

  it('remembers the unit in this browser, and starts on mm', async () => {
    setLengthUnit('pt')
    expect(localStorage.getItem('of-playground.length-unit')).toBe('pt')
    vi.resetModules()
    expect((await import('../src/lib/units')).useLengthUnit.getState().unit).toBe('pt')
    localStorage.setItem('of-playground.length-unit', 'furlong')
    vi.resetModules()
    expect((await import('../src/lib/units')).useLengthUnit.getState().unit).toBe('mm')
    localStorage.clear()
    vi.resetModules()
    expect((await import('../src/lib/units')).useLengthUnit.getState().unit).toBe('mm')
  })

  it('words the Checks in the unit picked', () => {
    const note = createNote({ name: 'Check', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#ffffff' })
    const explain = (unit: LengthUnit) => checkPattern(note, unit).find((c) => c.id === 'size')!.explain
    expect(explain('mm')).toBe('Each section at least 1 mm along and 1 mm across, less 0.2 mm where two ridge angles meet.')
    expect(explain('in')).toBe('Each section at least 0.039 in along and 0.039 in across, less 0.008 in where two ridge angles meet.')
    act(() => setLengthUnit('cm'))
    expect(checkPattern(note).find((c) => c.id === 'size')!.explain).toContain('0.1 cm along')
  })

  it('keeps a typed watermark position exactly, while moves still snap to 0.5 mm', () => {
    const note = { widthMm: 150, heightMm: 70 }
    const watermark = { ...newWatermark(note), xMm: 12.7 }
    expect(fitWatermark(watermark, note).xMm).toBe(12.7)
    expect(moveWatermark(watermark, 1, 0, note).xMm).toBe(13.5)
  })
})

describe('the unit menu', () => {
  it('switches every length to the unit picked in any length field, and reads and steps typed lengths in it', async () => {
    // A canvas with room, so the banknote and its label are drawn
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'units-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const note = () => useProjects.getState().demoPreview!.notes[0]
    const field = (label: string) => screen.getByText(label, { exact: true }).parentElement!.querySelector('input')!
    const label = () => document.querySelector('[data-note-label]')!.textContent
    expect(field('W').value).toBe('150')
    expect(label()).toContain('150 × 70 mm')

    // Height's unit menu switches Width too, the banknote's label on the canvas, and the browser's choice
    await user.click(screen.getAllByRole('button', { name: 'Unit: Millimetres' })[1])
    await user.click(await screen.findByRole('menuitemradio', { name: /Inches/ }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(field('W').value).toBe('5.906')
    expect(field('H').value).toBe('2.756')
    expect(screen.getAllByRole('button', { name: 'Unit: Inches' })).toHaveLength(2)
    expect(label()).toContain('5.906 × 2.756 in')
    expect(useLengthUnit.getState().unit).toBe('in')
    // Only how it reads: the banknote itself is untouched, and there is nothing to undo
    expect(note().widthMm).toBe(150)
    expect(useHistory.getState().entries[useProjects.getState().demoPreview!.id]?.past.length ?? 0).toBe(0)

    // Typed in inches, kept exactly; another unit typed after the number converts without switching
    fireEvent.change(field('W'), { target: { value: '6.14' } })
    fireEvent.blur(field('W'))
    expect(note().widthMm).toBe(155.956)
    expect(field('W').value).toBe('6.14')
    fireEvent.change(field('W'), { target: { value: '15cm' } })
    fireEvent.keyDown(field('W'), { key: 'Enter' })
    fireEvent.blur(field('W'))
    expect(note().widthMm).toBe(150)
    expect(field('W').value).toBe('5.906')

    // The arrow keys step to the next round number of the unit: 0.01 in for the 0.5 mm step, ten steps with Shift
    fireEvent.keyDown(field('W'), { key: 'ArrowUp' })
    expect(note().widthMm).toBe(150.114)
    expect(field('W').value).toBe('5.91')
    fireEvent.keyDown(field('W'), { key: 'ArrowDown', shiftKey: true })
    expect(note().widthMm).toBe(147.574)

    // The number shown at a limit can be typed; past it, nothing is taken, and the field keeps it and says why, in inches
    fireEvent.change(field('W'), { target: { value: '0.787' } })
    fireEvent.blur(field('W'))
    expect(note().widthMm).toBe(20)
    fireEvent.change(field('W'), { target: { value: '80' } })
    fireEvent.blur(field('W'))
    expect(note().widthMm).toBe(20)
    expect(field('W').value).toBe('80')
    expect(screen.getByRole('alert').textContent).toBe('Max 78.74 in')
    fireEvent.change(field('W'), { target: { value: '250mm' } })
    fireEvent.blur(field('W'))
    expect(note().widthMm).toBe(250)
    expect(field('W').value).toBe('9.843')
    expect(screen.queryByRole('alert')).toBeNull()

    // The thread's lengths and its windows follow
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    expect(field('W').value).toBe(String(lengthIn(note().thread.widthMm, 'in')))
    expect(field('L').value).toBe(String(lengthIn(note().pattern!.repeatMm, 'in')))
    // The first window runs 0 to 8 mm: switched off and on, it is picked, its measures on the canvas in inches too
    expect(note().thread.windows.sections[0]).toMatchObject({ startMm: 0, endMm: 8 })
    await user.click(screen.getByRole('switch', { name: 'Windows' }))
    await user.click(screen.getByRole('switch', { name: 'Windows' }))
    const length = screen.getByTitle('Length of window 1', { exact: true }).querySelector('input')!
    expect(length.value).toBe('0.315')
    fireEvent.change(length, { target: { value: '0.4' } })
    fireEvent.blur(length)
    expect(note().thread.windows.sections[0].endMm).toBe(10.16)
    expect(screen.getByTitle('Gap between windows 1 and 2', { exact: true }).querySelector('input')!.value).toBe(String(lengthIn(14 - 10.16, 'in')))

    // Back to mm from any field: nothing ever moved
    await user.click(screen.getAllByRole('button', { name: 'Unit: Inches' })[0])
    await user.click(await screen.findByRole('menuitemradio', { name: /Millimetres/ }))
    await user.click(screen.getByRole('button', { name: 'Demo banknote', exact: true }))
    expect(field('W').value).toBe('250')
    expect(note().widthMm).toBe(250)
  })

  it('types a watermark’s place exactly in any unit', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'units-watermark-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const demo = useProjects.getState().demoPreview!
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, watermark: newWatermark(n) })))
    act(() => setLengthUnit('in'))
    await user.click(screen.getByRole('button', { name: 'Watermark', exact: true }))
    const x = screen.getByTitle('Watermark position from the left edge').querySelector('input')!
    fireEvent.change(x, { target: { value: '0.5' } })
    fireEvent.blur(x)
    expect(useProjects.getState().demoPreview!.notes[0].watermark!.xMm).toBe(12.7)
    expect(x.value).toBe('0.5')
  })

  it('sizes a new banknote in the unit picked', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'units-dialog-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    act(() => setLengthUnit('cm'))
    await user.click(screen.getByRole('button', { name: 'Add banknote', exact: true }))
    const dialog = await screen.findByRole('dialog')
    const units = within(dialog).getAllByRole('button', { name: 'Unit: Centimetres' })
    expect(units).toHaveLength(2)
    const [width, height] = units.map((unit) => unit.closest('.relative')!.querySelector('input')!)
    expect(width.value).toBe('15')
    expect(height.value).toBe('7')
    fireEvent.change(width, { target: { value: '6.14in' } })
    fireEvent.blur(width)
    expect(width.value).toBe('15.596')
    await user.click(within(dialog).getByRole('button', { name: 'Add', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(useProjects.getState().demoPreview!.notes.at(-1)!.widthMm).toBe(155.956)
  })
})

describe('a banknote’s size', () => {
  it('runs up to 2 m, and keeps a size typed past a limit, marked with the limit, taking nothing past it', () => {
    expect(NOTE_SIZE).toEqual({ min: 20, max: 2000 })
    const changes: number[] = []
    function Size() {
      const [mm, setMm] = React.useState(150)
      const set = (next: number) => {
        changes.push(next)
        setMm(next)
      }
      return (
        <>
          <LengthField label="W" value={mm} min={NOTE_SIZE.min} max={NOTE_SIZE.max} step={0.5} strict onChange={set} />
          <button type="button" onClick={() => setMm(100)}>To 100</button>
          <button type="button" onClick={() => setMm(20)}>To 20</button>
        </>
      )
    }
    render(<Size />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    const alert = () => screen.queryByRole('alert')?.textContent

    // Typing takes 25 and 250 on the way to 2500, then puts back the 150 from before as soon as it passes the limit
    for (const text of ['2', '25', '250', '2500']) fireEvent.change(input, { target: { value: text } })
    expect(changes).toEqual([25, 250, 150])
    expect(input.value).toBe('2500')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(alert()).toBe('Max 2000 mm')
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
    // Enter keeps it to be fixed, without sending a form; so does leaving the field
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
    fireEvent.blur(input)
    expect(input.value).toBe('2500')
    expect(alert()).toBe('Max 2000 mm')
    expect(changes).toEqual([25, 250, 150])

    // Fixed, it is taken and the error goes
    fireEvent.change(input, { target: { value: '680' } })
    fireEvent.blur(input)
    expect(changes.at(-1)).toBe(680)
    expect(input.value).toBe('680')
    expect(alert()).toBeUndefined()

    // Under the minimum only once Enter is pressed or the field is left, as typing 150 passes 1 and 15
    fireEvent.change(input, { target: { value: '5' } })
    expect(alert()).toBeUndefined()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(alert()).toBe('Min 20 mm')
    expect(changes.at(-1)).toBe(680)
    // The arrow keys step back within the limits
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(changes.at(-1)).toBe(20)
    expect(input.value).toBe('20')
    expect(alert()).toBeUndefined()

    // The value changing some other way (a scrub, an undo) drops what was kept, even once it comes back
    fireEvent.change(input, { target: { value: '9999' } })
    fireEvent.blur(input)
    expect(alert()).toBe('Max 2000 mm')
    fireEvent.click(screen.getByRole('button', { name: 'To 100' }))
    expect(input.value).toBe('100')
    expect(alert()).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'To 20' }))
    expect(input.value).toBe('20')
    expect(alert()).toBeUndefined()
  })

  it('adds no banknote while a size in New banknote is past the limit', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'size-limit-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Add banknote', exact: true }))
    const dialog = await screen.findByRole('dialog')
    const width = within(dialog).getByText('Width', { exact: true }).parentElement!.querySelector('input')!
    const notes = () => useProjects.getState().demoPreview!.notes
    fireEvent.change(width, { target: { value: '2500' } })
    expect(within(dialog).getByRole('alert').textContent).toBe('Max 2000 mm')
    await user.click(within(dialog).getByRole('button', { name: 'Add', exact: true }))
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(document.activeElement).toBe(width)
    expect(notes()).toHaveLength(1)

    fireEvent.change(width, { target: { value: '2000' } })
    expect(within(dialog).queryByRole('alert')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Add', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(notes()).toHaveLength(2)
    expect(notes()[1]).toMatchObject({ widthMm: 2000, heightMm: 70 })
  })
})
