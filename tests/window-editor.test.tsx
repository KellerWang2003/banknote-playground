// @vitest-environment jsdom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowEditor } from '../src/editor/WindowEditor'
import { createNote, createProject, migrateProject } from '../src/lib/notes'
import { migrateWindows, threadWindowMask } from '../src/lib/thread'
import type { Quarter } from '../src/lib/rotate'
import type { ThreadWindow } from '../src/lib/types'

const makeNote = () => createNote({ name: 'Windows', x: 0, y: 0, widthMm: 100, heightMm: 70, color: '#123456' })
const initial = [{ id: 'first', startMm: 10, endMm: 20 }, { id: 'second', startMm: 30, endMm: 40 }]
function Harness({ direction, outer, scale = 10, quarter = 0 }: { direction: 'horizontal' | 'vertical'; outer: () => void; scale?: number; quarter?: Quarter }) {
  const [sections, setSections] = useState<ThreadWindow[]>(initial)
  const [selected, setSelected] = useState<string>()
  const note = makeNote()
  note.thread.direction = direction
  note.thread.windows = { enabled: true, sections }
  return <div onPointerDown={outer}>
    <WindowEditor note={note} scale={scale} quarter={quarter} selectedId={selected} onSelect={setSelected} onChange={setSections} />
    <output data-testid="sections">{JSON.stringify(sections)}</output>
  </div>
}
const read = (): ThreadWindow[] => JSON.parse(screen.getByTestId('sections').textContent!)
beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1 }
  })
  for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
  }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const pointer = (direction: 'horizontal' | 'vertical', mm: number) => ({ pointerId: 1, button: 0, clientX: direction === 'horizontal' ? mm * 10 : 0, clientY: direction === 'vertical' ? mm * 10 : 0 })

describe.each(['vertical', 'horizontal'] as const)('%s canvas window editing', (direction) => {
  it('draws in either direction, snaps to half millimetres, and does not start canvas gestures', () => {
    const outer = vi.fn()
    render(<Harness direction={direction} outer={outer} />)
    const surface = screen.getByRole('group', { name: 'Edit thread windows' })
    fireEvent.pointerDown(surface, pointer(direction, 8))
    fireEvent.pointerMove(surface, pointer(direction, 2.3))
    fireEvent.pointerUp(surface, pointer(direction, 2.3))
    expect(read()[0]).toMatchObject({ startMm: 2.5, endMm: 8 })
    expect(outer).not.toHaveBeenCalled()
  })
  it('moves without changing length, stops at neighbours, and resizes using an end handle', () => {
    render(<Harness direction={direction} outer={vi.fn()} />)
    const surface = screen.getByRole('group', { name: 'Edit thread windows' })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Window 1', exact: true }), pointer(direction, 15))
    fireEvent.pointerMove(surface, pointer(direction, 100))
    fireEvent.pointerUp(surface, pointer(direction, 100))
    expect(read()[0]).toMatchObject({ startMm: 20, endMm: 30 })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Start of window 1' }), pointer(direction, 20))
    fireEvent.pointerMove(surface, pointer(direction, -10))
    fireEvent.pointerUp(surface, pointer(direction, -10))
    expect(read()[0]).toMatchObject({ startMm: 0, endMm: 30 })
  })
  it('measures every window’s length, and the picked one’s distance to the banknote’s edges or its neighbours, to type or scrub', () => {
    const outer = vi.fn()
    render(<Harness direction={direction} outer={outer} />)
    const field = (title: string) => screen.getByTitle(title, { exact: true }).querySelector('input')!
    const type = (title: string, value: string) => {
      fireEvent.change(field(title), { target: { value } })
      fireEvent.blur(field(title))
    }
    const [start, end] = direction === 'vertical' ? ['top', 'bottom'] : ['left', 'right']
    const length = direction === 'vertical' ? 70 : 100
    expect(field('Length of window 1').value).toBe('10')
    expect(field('Length of window 2').value).toBe('10')
    expect(screen.queryByTitle(`Window 1 from the ${start} of the banknote`, { exact: true })).toBeNull()
    // Picked, a window also measures what lies either side of it: the banknote's edge, or the next window
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Window 1', exact: true }), pointer(direction, 15))
    fireEvent.pointerUp(screen.getByRole('group', { name: 'Edit thread windows' }), pointer(direction, 15))
    expect(field(`Window 1 from the ${start} of the banknote`).value).toBe('10')
    expect(field('Gap between windows 1 and 2').value).toBe('10')
    // A length moves the window's end; a distance moves the whole window, its length kept, no further than there is room
    type('Length of window 1', '12')
    expect(read()[0]).toMatchObject({ startMm: 10, endMm: 22 })
    type('Gap between windows 1 and 2', '4')
    expect(read()[0]).toMatchObject({ startMm: 14, endMm: 26 })
    type(`Window 1 from the ${start} of the banknote`, '0')
    expect(read()[0]).toMatchObject({ startMm: 0, endMm: 12 })
    type(`Window 1 from the ${start} of the banknote`, '19')
    expect(read()[0]).toMatchObject({ startMm: 0, endMm: 12 })
    // A press on another window's measure picks that window; the last is measured to the banknote's far edge
    fireEvent.pointerDown(screen.getByText('Window 2', { exact: true }), { button: 0, pointerId: 1 })
    expect(screen.getByRole('button', { name: 'Window 2', exact: true }).getAttribute('aria-pressed')).toBe('true')
    expect(field(`Window 2 from the ${end} of the banknote`).value).toBe(String(length - 40))
    type(`Window 2 from the ${end} of the banknote`, '5')
    expect(read()[1]).toMatchObject({ startMm: length - 15, endMm: length - 5 })
    // Scrubbing a measure's label steps it and never draws or moves a window, or reaches the canvas
    const label = screen.getByTitle('Length of window 2', { exact: true }).querySelector('span')!
    fireEvent.pointerDown(label, { button: 0, pointerId: 1, clientX: 100, clientY: 0 })
    fireEvent.pointerMove(label, { buttons: 1, pointerId: 1, clientX: 108, clientY: 0 })
    fireEvent.pointerUp(label, { button: 0, pointerId: 1, clientX: 108, clientY: 0 })
    expect(read()[1]).toMatchObject({ startMm: length - 15, endMm: length - 3 })
    expect(read()).toHaveLength(2)
    expect(outer).toHaveBeenCalledTimes(0)
  })
  it('hides the lengths that have no room from their neighbours’, never the picked window’s, and all of them zoomed out too far', () => {
    // At 2.5 px a mm the two windows' cards would overlap
    const { rerender } = render(<Harness direction={direction} outer={vi.fn()} scale={2.5} />)
    expect(screen.queryByTitle('Length of window 1', { exact: true })).toBeNull()
    expect(screen.queryByTitle('Length of window 2', { exact: true })).toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Window 1', exact: true }), pointer(direction, 0))
    fireEvent.pointerUp(screen.getByRole('group', { name: 'Edit thread windows' }), pointer(direction, 0))
    expect(screen.getByTitle('Length of window 1', { exact: true })).toBeDefined()
    expect(screen.queryByTitle('Length of window 2', { exact: true })).toBeNull()
    expect(screen.getByTitle('Gap between windows 1 and 2', { exact: true })).toBeDefined()
    rerender(<Harness direction={direction} outer={vi.fn()} scale={1.5} />)
    expect(document.querySelector('[data-measure]')).toBeNull()
    // Zoomed in far enough, a length sits on its window's own tile, with no bracket
    rerender(<Harness direction={direction} outer={vi.fn()} scale={30} />)
    const card = screen.getByTitle('Length of window 1', { exact: true }).closest<HTMLElement>('[data-measure]')!
    expect(card.childElementCount).toBe(1)
    expect(direction === 'vertical' ? card.style.left : card.style.top).toBe('0px')
  })
  it('restores the original windows when a gesture is cancelled', () => {
    render(<Harness direction={direction} outer={vi.fn()} />)
    const surface = screen.getByRole('group', { name: 'Edit thread windows' })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Window 1', exact: true }), pointer(direction, 15))
    fireEvent.pointerMove(surface, pointer(direction, 17))
    expect(read()[0].startMm).toBe(12)
    fireEvent.pointerCancel(surface, pointer(direction, 17))
    expect(read()).toEqual(initial)
  })
})

describe('window editing on a rotated banknote', () => {
  // jsdom lays nothing out: the thread's box on screen starts at 0, 0, as wide as the thread is long once on its side
  it('reads the pointer along the thread as it lies, its top at the right once turned right', () => {
    render(<Harness direction="vertical" outer={vi.fn()} quarter={1} />)
    const surface = screen.getByRole('group', { name: 'Edit thread windows' })
    // 70 mm long at 10 px per mm, running from the right of the screen
    const at = (mm: number) => ({ pointerId: 1, button: 0, clientX: 700 - mm * 10, clientY: 20 })
    fireEvent.pointerDown(surface, at(8))
    fireEvent.pointerMove(surface, at(2.3))
    fireEvent.pointerUp(surface, at(2.3))
    expect(read()[0]).toMatchObject({ startMm: 2.5, endMm: 8 })
    // Its ends resize across the screen now
    expect(screen.getByRole('button', { name: 'Start of window 1' }).className).toContain('cursor-ew-resize')
  })
  it('turned left, runs a horizontal thread up the screen from its left end, now at the bottom', () => {
    render(<Harness direction="horizontal" outer={vi.fn()} quarter={3} />)
    const surface = screen.getByRole('group', { name: 'Edit thread windows' })
    const at = (mm: number) => ({ pointerId: 1, button: 0, clientX: 20, clientY: 1000 - mm * 10 })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Window 1', exact: true }), at(15))
    fireEvent.pointerMove(surface, at(17))
    fireEvent.pointerUp(surface, at(17))
    expect(read()[0]).toMatchObject({ startMm: 12, endMm: 22 })
    expect(screen.getByRole('button', { name: 'Start of window 1' }).className).toContain('cursor-ns-resize')
  })
  it('upside down, reads it from the other end', () => {
    render(<Harness direction="vertical" outer={vi.fn()} quarter={2} />)
    const surface = screen.getByRole('group', { name: 'Edit thread windows' })
    const at = (mm: number) => ({ pointerId: 1, button: 0, clientX: 20, clientY: 700 - mm * 10 })
    fireEvent.pointerDown(surface, at(2))
    fireEvent.pointerMove(surface, at(6))
    fireEvent.pointerUp(surface, at(6))
    expect(read()[0]).toMatchObject({ startMm: 2, endMm: 6 })
  })
})

it('preserves legacy window positions and stable ids through saved-project reloads', () => {
  const note = makeNote()
  const legacy = { ...createProject('Legacy'), notes: [{ ...note, thread: { ...note.thread, windows: { enabled: true, windowMm: 8, gapMm: 6, offsetMm: -3 } } }] }
  const project = migrateProject(legacy)
  expect(project.notes[0].thread.windows.sections[0]).toMatchObject({ startMm: 0, endMm: 5 })
  expect(migrateProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
  expect(project.notes[0].thread.windows).not.toHaveProperty('offsetMm')
})
it('starts new banknotes without windows, keeping the usual ones for when they are switched on', () => {
  const { windows } = makeNote().thread
  expect(windows.enabled).toBe(false)
  expect(windows.sections[0]).toMatchObject({ startMm: 0, endMm: 8 })
  expect(windows.sections[1]).toMatchObject({ startMm: 14, endMm: 22 })
})
it('distinguishes an empty windowed thread from a continuous one', () => {
  const thread = makeNote().thread
  thread.windows = { enabled: true, sections: [] }
  expect(threadWindowMask(thread, 1).maskImage).toBe('linear-gradient(to bottom, transparent 0px, transparent 100%)')
  thread.windows.enabled = false
  expect(threadWindowMask(thread, 1)).toEqual({})
  expect(migrateWindows({ enabled: true, windowMm: 5, gapMm: 0 }, 70).sections[0]).toMatchObject({ startMm: 0, endMm: 70 })
})
