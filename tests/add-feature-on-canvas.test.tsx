// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { Canvas } from '../src/editor/Canvas'
import { newArcEnCiel } from '../src/lib/arcEnCiel'
import { neighboursPx } from '../src/lib/continuous'
import { newMagneticInk } from '../src/lib/magneticInk'
import { createNote } from '../src/lib/notes'
import { useProjects } from '../src/lib/store'
import type { Note } from '../src/lib/types'
import { newWatermark } from '../src/lib/watermark'
import { setTilt, useTilt } from '../src/tilt/tilt'

// Keller, 10 November: "a plus button at the bottom of the banknote so that i can add security features there. it would
// only appear on the banknote that is selected"; then "the button should appear on all of the banknotes. not just new
// ones. and also you should be able ot add multiple of the same security feature. so no limit"

vi.mock('../src/cloud/client', () => ({ cloudConfigured: true }))
vi.mock('../src/cloud/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cloud/repository')>()
  return { ...actual, createRepository: () => ({
    list: async () => [],
    save: async (record: import('../src/cloud/sync').CachedProject) => ({ project: record.project, revision: record.revision, deleted: record.deleted }),
  }) }
})
// The demo's artwork is drawn on a canvas, which jsdom lacks: Demo opens one plain banknote with a thread instead
vi.mock('../src/lib/demo', async () => {
  const { createProject, createNote } = await import('../src/lib/notes')
  return { createDemoProject: vi.fn(async () => ({
    ...createProject('Demo fixture'),
    notes: [createNote({ name: 'Demo banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#123456' })],
  })) }
})

beforeEach(() => {
  // The canvas draws only once it knows its size
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {} disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
  }
  localStorage.clear()
  location.hash = ''
  setTilt({ source: 'drag', angle: 0, angleX: 0, target: 0, targetX: 0, flipped: false, turn: 0, quarterTurns: 0 })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setTilt({ source: 'hold', angle: 0, angleX: 0, target: 0, targetX: 0, light: 0, flipped: false, turn: 0, quarterTurns: 0 })
})

/** A banknote 150 × 70 mm with no security feature yet, as New banknote makes one */
const bare = (name: string, x = 0): Note => ({ ...createNote({ name, x, y: 0, widthMm: 150, heightMm: 70, color: '#E5E5E5' }), noThread: true })
/** One that has every security feature */
const full = (name: string): Note => {
  const note = createNote({ name, x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#E5E5E5' })
  return { ...note, watermark: newWatermark(note), arcEnCiel: newArcEnCiel(note), magneticInk: newMagneticInk(note) }
}

/** The + under the selected banknote, the canvas's own (the Banknotes list has its own Add menu) */
const plus = () => document.querySelector<HTMLElement>('[data-add-feature]')
/** What it hangs from: the bottom of the box the banknote shows, as a share of its height */
const anchor = () => plus()!.closest<HTMLElement>('[data-keep-size]')!

function renderCanvas(props: Partial<ComponentProps<typeof Canvas>> & { notes: Note[] }) {
  const handlers = { onSelect: vi.fn(), onSelectLayer: vi.fn(), onWindowSelect: vi.fn(), onAddFeature: vi.fn() }
  const view = (more: Partial<ComponentProps<typeof Canvas>>) => (
    <TooltipProvider>
      <Canvas projectId="canvas-plus" selectedId={props.notes[0].id} {...handlers} {...props} {...more} />
    </TooltipProvider>
  )
  const result = render(view({}))
  return { ...handlers, rerender: (more: Partial<ComponentProps<typeof Canvas>>) => result.rerender(view(more)) }
}

describe('the + under the selected banknote', () => {
  it('shows only under the selected banknote, in the middle of its bottom edge, and under the box it shows once rotated', () => {
    const one = bare('One')
    const two = bare('Two', 200)
    const { rerender } = renderCanvas({ notes: [one, two] })
    expect(document.querySelectorAll('[data-add-feature]')).toHaveLength(1)
    // The + with its words (Keller: "the plus should be also be an icon and the text"), which name it, so no tooltip
    expect(plus()!.textContent).toBe('Add security feature')
    expect(plus()!.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Add security feature' })).toBe(plus())
    // It hangs from the banknote's own box, as the banknote's name does, in the middle of its bottom edge
    const box = (note: Note) => document.querySelector(`[data-note-body="${note.id}"]`)!.parentElement!.parentElement!
    const overBox = anchor().parentElement!
    for (const side of ['left', 'top', 'width', 'height'] as const) expect(overBox.style[side]).toBe(box(one).style[side])
    expect(anchor().className).toContain('left-1/2')
    expect(anchor().style.top).toBe('100%')

    // On its side the banknote shows 150 mm tall about the same middle: the + hangs from the bottom of that
    act(() => setTilt({ quarterTurns: 1 }))
    expect(parseFloat(anchor().style.top)).toBeCloseTo(((70 + 150) / 2 / 70) * 100, 6)
    act(() => setTilt({ quarterTurns: 2 }))
    expect(anchor().style.top).toBe('100%')
    act(() => setTilt({ quarterTurns: 0 }))

    // Another banknote picked, it moves under that one; with none, there is none
    rerender({ selectedId: two.id })
    expect(document.querySelectorAll('[data-add-feature]')).toHaveLength(1)
    for (const side of ['left', 'top'] as const) expect(anchor().parentElement!.style[side]).toBe(box(two).style[side])
    rerender({ selectedId: undefined })
    expect(plus()).toBeNull()
  })

  it('opens the Add menu of every kind of feature, whatever the banknote has, and adds the one picked', async () => {
    const user = userEvent.setup()
    const one = bare('One')
    const { onAddFeature, onSelect, onSelectLayer, rerender } = renderCanvas({ notes: [one] })
    const kinds = [/^Security thread/, /^Watermark/, /^Arc-en-Ciel/, /^Magnetic ink/].map((name) => expect.stringMatching(name))
    await user.click(plus()!)
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(kinds)
    await user.click(screen.getByRole('menuitem', { name: /^Watermark/ }))
    expect(onAddFeature).toHaveBeenCalledWith(one.id, 'watermark')
    // The menu is drawn outside the canvas, though React hands its presses up through it: neither the press that picks in
    // it nor the click clears the selection or tilts the banknotes
    expect(onSelect).not.toHaveBeenCalled()
    expect(onSelectLayer).not.toHaveBeenCalled()
    expect(useTilt.getState().source).toBe('drag')

    // On a banknote that has one of each, and more, it is there all the same, offering every kind again
    const all = full('All')
    const more = { ...all, extras: [{ id: 'second', feature: 'watermark' as const, layer: newWatermark(all) }] }
    for (const note of [all, more]) {
      rerender({ notes: [note], selectedId: note.id })
      await user.click(plus()!)
      expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(kinds)
      await user.click(screen.getByRole('menuitem', { name: /^Watermark/ }))
      expect(onAddFeature).toHaveBeenLastCalledWith(note.id, 'watermark')
    }
  })

  it('takes its own press, so a press on it neither picks nor tilts', () => {
    const one = bare('One')
    const { onSelect, onSelectLayer } = renderCanvas({ notes: [one] })
    fireEvent.pointerDown(plus()!, { button: 0, buttons: 1, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(plus()!, { buttons: 1, pointerId: 1, clientX: 60, clientY: 60 })
    fireEvent.pointerUp(plus()!, { button: 0, pointerId: 1, clientX: 60, clientY: 60 })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onSelectLayer).not.toHaveBeenCalled()
    expect(useTilt.getState()).toMatchObject({ source: 'drag', target: 0, targetX: 0 })
  })

  it('makes way while banknotes play, windows are edited or a layer is placed, and hangs past the continuous check', () => {
    const base = bare('One')
    const one = { ...base, watermark: newWatermark(base) }
    const { rerender } = renderCanvas({ notes: [one] })
    expect(plus()).not.toBeNull()
    // Playing, as the banknote's outline steps back
    act(() => setTilt({ source: 'wobble' }))
    expect(plus()).toBeNull()
    act(() => setTilt({ source: 'drag' }))
    expect(plus()).not.toBeNull()
    // Placing its watermark, whose box may hang off the bottom edge, or a further one
    rerender({ layer: 'watermark', placing: 'watermark' })
    expect(plus()).toBeNull()
    const two = { ...one, extras: [{ id: 'second', feature: 'watermark' as const, layer: newWatermark(one) }] }
    rerender({ notes: [two], layer: 'watermark/second', placing: 'watermark/second' })
    expect(plus()).toBeNull()
    rerender({ notes: [one] })
    // Picked but not being placed, it is back
    rerender({ layer: 'watermark', placing: undefined })
    expect(plus()).not.toBeNull()
    // Editing windows
    rerender({ layer: 'thread', editingWindows: true })
    expect(plus()).toBeNull()
    rerender({ layer: 'thread', editingWindows: false })
    expect(plus()).not.toBeNull()

    // The continuous check shows round an uploaded design while the banknote itself is picked, with nothing between it and
    // its neighbours: it hangs 12 px past them, as it hangs 12 px under the banknote
    const checked: Note = { ...one, background: 'image', faceImageId: 'design', continuous: { cutMm: 1 } }
    expect(plus()!.parentElement!.style.top).toBe('12px')
    rerender({ notes: [checked], layer: 'note' })
    const scale = parseFloat(anchor().parentElement!.style.width) / 150
    expect(parseFloat(plus()!.parentElement!.style.top)).toBeCloseTo(12 + neighboursPx(scale), 6)
    expect(neighboursPx(scale)).toBeGreaterThan(0)
    rerender({ notes: [checked], layer: 'watermark' })
    expect(plus()!.parentElement!.style.top).toBe('12px')

    // Not while Thread Studio is open over the canvas, which leaves the way to add out
    rerender({ notes: [one], layer: 'note', onAddFeature: undefined })
    expect(plus()).toBeNull()
  })
})

describe('adding a security feature from the canvas', () => {
  it('adds the feature picked under the selected banknote and shows it, as the Add menu in the Banknotes list does', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'canvas-plus-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Sample project', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const picked = () => screen.queryByRole('heading', { level: 2 })?.textContent
    const note = () => useProjects.getState().demoPreview!.notes[0]
    expect(picked()).toBe('Demo banknote')

    const kinds = [/^Security thread/, /^Watermark/, /^Arc-en-Ciel/, /^Magnetic ink/].map((name) => expect.stringMatching(name))
    await user.click(plus()!)
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(kinds)
    await user.click(screen.getByRole('menuitem', { name: /^Magnetic ink/ }))
    // Added and picked, its box out to place it, which the + makes way for
    expect(note().magneticInk).toBeDefined()
    expect(picked()).toBe('Magnetic ink')
    expect(plus()).toBeNull()

    // The banknote picked again, the + offers every kind again: another magnetic ink comes after the first, named so the
    // two can be told apart, and is picked
    await user.click(screen.getByRole('button', { name: 'Demo banknote', exact: true }))
    expect(picked()).toBe('Demo banknote')
    await user.click(plus()!)
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(kinds)
    await user.click(screen.getByRole('menuitem', { name: /^Magnetic ink/ }))
    expect(note().extras).toEqual([expect.objectContaining({ feature: 'magneticInk', layer: expect.objectContaining({ name: 'Magnetic ink 2' }) })])
    expect(picked()).toBe('Magnetic ink 2')
    expect(within(screen.getByRole('list', { name: 'Layers of Demo banknote' })).getAllByRole('listitem').map((row) => row.textContent))
      .toEqual(['Security thread', 'Magnetic ink', 'Magnetic ink 2'])

    // Escape closes the menu, leaving the banknote picked
    await user.click(screen.getByRole('button', { name: 'Demo banknote', exact: true }))
    await user.click(plus()!)
    await screen.findByRole('menu')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(picked()).toBe('Demo banknote')
  })
})
