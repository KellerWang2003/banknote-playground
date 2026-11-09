// @vitest-environment jsdom
import React from 'react'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import { addNote, updateNote, useProjects } from '../src/lib/store'
import { createNote, createProject, migrateProject } from '../src/lib/notes'
import { createDemoProject } from '../src/lib/demo'
import { newWatermark } from '../src/lib/watermark'
import { presetPattern } from '../src/lib/patternPresets'
import { setTiltPadOpen } from '../src/lib/tiltPad'
import { useRealistic } from '../src/lib/realistic'
import { setTilt, togglePlayback, useTilt } from '../src/tilt/tilt'
import { TooltipProvider } from '../src/components/ui/tooltip'

const saves = vi.hoisted(() => vi.fn())

vi.mock('../src/cloud/client', () => ({ cloudConfigured: true }))
// Artwork a test names `fixture-…` counts as already loaded, without uploading it (jsdom has no object URLs)
vi.mock('../src/lib/images', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/images')>()
  const fixture = (id?: string) => (id?.startsWith('fixture-') ? `blob:${id}` : undefined)
  return {
    ...actual,
    useImageUrl: (id?: string) => {
      const url = actual.useImageUrl(fixture(id) ? undefined : id)
      return fixture(id) ?? url
    },
    loadImageUrl: async (id: string) => fixture(id) ?? actual.loadImageUrl(id),
  }
})
// jsdom can't read an image's pixels: a fixture reads as one Auto fits from 10% to 80%
vi.mock('../src/lib/relief', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/relief')>()
  const fixture = { key: 'fixture', thin: new Uint8ClampedArray(), width: 0, height: 0, auto: { low: 0.1, high: 0.8, gamma: 1 } }
  return {
    ...actual,
    useReading: (watermark?: { imageId?: string }) => {
      const reading = actual.useReading(watermark)
      return watermark?.imageId?.startsWith('fixture-') ? fixture : reading
    },
  }
})
// Nor can it work out magnetic ink's mask: a fixture's is ready straight away
vi.mock('../src/lib/inkMask', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/inkMask')>()
  return {
    ...actual,
    useInkMask: (ink?: { imageId?: string }) => {
      const mask = actual.useInkMask(ink)
      return ink?.imageId?.startsWith('fixture-') ? { key: 'fixture', canvas: document.createElement('canvas'), url: 'data:image/png;base64,' } : mask
    },
  }
})
vi.mock('../src/cloud/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cloud/repository')>()
  return { ...actual, createRepository: () => ({
    list: async () => [],
    save: async (record: import('../src/cloud/sync').CachedProject) => { saves(record); return { project: record.project, revision: record.revision, deleted: record.deleted } },
  }) }
})
// The demo's artwork is drawn on a canvas, which jsdom lacks: Demo opens one plain banknote instead
vi.mock('../src/lib/demo', async () => {
  const { createProject, createNote } = await import('../src/lib/notes')
  // With windows, as the real demo's first banknote has (new banknotes start without)
  return { createDemoProject: vi.fn(async () => {
    const note = createNote({ name: 'Demo banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#123456' })
    return { ...createProject('Demo fixture'), notes: [{ ...note, thread: { ...note.thread, windows: { ...note.thread.windows, enabled: true } } }] }
  }) }
})
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  localStorage.clear()
  location.hash = ''
  saves.mockClear()
  setTilt({ source: 'drag', angle: 0, target: 0 })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/**
 * What the right panel shows, by the name at its top: the picked banknote's own, or its picked feature's (Security thread,
 * Watermark…, until it is renamed)
 */
const picked = () => screen.queryByRole('heading', { level: 2 })?.textContent
/** The colours' hex fields laid out in the right panel, in order (each beside its swatch, which is an input too) */
/** The Add menu's + on the banknote's row in the list (the row under its features is another) */
const addFeature = () => screen.getAllByRole('button', { name: 'Add security feature' })[0]
const hexFields = () => (screen.getAllByDisplayValue(/^#[0-9a-f]{6}$/i) as HTMLInputElement[]).filter((input) => input.type === 'text')

describe('username workspace editor', () => {
  it('creates a project and banknote, autosaves a rename, and duplicates the project', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'disposable-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'New project', exact: true }))
    await user.type(await screen.findByPlaceholderText('Untitled project'), 'UI test project')
    await user.click(screen.getByRole('button', { name: 'Create', exact: true }))
    await user.type(await screen.findByPlaceholderText('Banknote 1'), 'UI test banknote')
    await user.click(screen.getByRole('button', { name: 'Add', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Sign out', exact: true })).toBeNull()
    const projectName = screen.getByRole('textbox', { name: 'Project name' })
    await user.clear(projectName)
    await user.type(projectName, 'Renamed UI project')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'))
    await user.click(screen.getByRole('button', { name: 'Projects', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Duplicate', exact: true }))
    await waitFor(() => expect(screen.getByText('Renamed UI project copy')).toBeDefined())
    expect(screen.getByText('Renamed UI project', { exact: true })).toBeDefined()
    expect(screen.getAllByText('1 banknote')).toHaveLength(2)
  })

  it('starts a banknote with no security feature, adds and removes its thread from the Add menu, the first with a tip by Windows', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'windows-tip-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'New project', exact: true }))
    await user.type(await screen.findByPlaceholderText('Untitled project'), 'Tip project')
    await user.click(screen.getByRole('button', { name: 'Create', exact: true }))
    await screen.findByPlaceholderText('Banknote 1')
    // New banknote asks only for a name and size (Keller, 4 November)
    expect(screen.queryByText('Colour', { exact: true })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // It comes as plain light grey paper with no security feature, not even a thread, and shows itself
    const project = () => useProjects.getState().projects.find((p) => p.name === 'Tip project')!
    expect(project().notes[0]).toMatchObject({ color: '#E5E5E5', noThread: true })
    // The right panel names what it shows at its top, with no tabs to other parts (Keller, 9 November)
    expect(picked()).toBe('Banknote 1')
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Security thread', exact: true })).toBeNull()
    expect(document.querySelector('[data-thread]')).toBeNull()
    expect(screen.queryByText('You can add windows here')).toBeNull()

    // Every feature is added from one Add menu, on the banknote's row and the row under the selected banknote's features,
    // each with a line on what it is. The project's first thread shows itself, without windows, with the tip by Windows
    // until the next click
    const add = () => screen.getAllByRole('button', { name: 'Add security feature' })
    expect(add()).toHaveLength(2)
    expect(add()[1].textContent).toBe('Add security feature')
    await user.click(add()[1])
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^Security thread/), expect.stringMatching(/^Watermark/), expect.stringMatching(/^Arc-en-Ciel/), expect.stringMatching(/^Magnetic ink/)])
    await user.click(screen.getByRole('menuitem', { name: /^Security thread/ }))
    expect(project().notes[0].noThread).toBeUndefined()
    expect(picked()).toBe('Security thread')
    expect(document.querySelector('[data-thread]')).not.toBeNull()
    const windows = screen.getByRole('switch', { name: 'Windows' })
    expect(windows.getAttribute('aria-checked')).toBe('false')
    expect(await screen.findByText('You can add windows here')).toBeDefined()
    // The click that ends it still lands: here it switches the windows on
    await user.click(windows)
    expect(windows.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(screen.queryByText('You can add windows here')).toBeNull())

    // It is removed as every feature is, from the bin on its row in the list, and the banknote itself shows again
    await user.click(screen.getByRole('button', { name: 'Remove security thread' }))
    expect(project().notes[0].noThread).toBe(true)
    expect(picked()).toBe('Banknote 1')
    expect(document.querySelector('[data-thread]')).toBeNull()

    // The next banknote shows itself, with no tip
    await user.click(screen.getByRole('button', { name: 'Add banknote', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Add', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(picked()).toBe('Banknote 2')
    expect(screen.queryByText('You can add windows here')).toBeNull()
  })
  it('edits windows on the canvas with their measures, undoes deletion, and preserves sections when windows are off', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'window-editor-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    const sections = () => useProjects.getState().demoPreview!.notes[0].thread.windows.sections
    const field = (title: string) => screen.getByTitle(title, { exact: true }).querySelector('input')!
    const type = (title: string, value: string) => {
      fireEvent.change(field(title), { target: { value } })
      fireEvent.blur(field(title))
    }
    const tile = (n: number) => screen.getByRole('button', { name: `Window ${n}`, exact: true })
    // The card keeps its switch and +; the windows themselves are only on the canvas
    expect(screen.queryByRole('group', { name: 'Edit thread windows' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete window', exact: true })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show all windows', exact: true })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add window', exact: true })).toBeDefined()
    // Switched off, the card says the sponsor requires them; on, the first window is picked to edit on the canvas
    const windows = screen.getByRole('switch', { name: 'Windows' })
    await user.click(windows)
    expect(screen.getByText('Windows are required by our sponsor, Oberthur')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add window', exact: true })).toBeNull()
    await user.click(windows)
    expect(screen.queryByText('Windows are required by our sponsor, Oberthur')).toBeNull()
    expect(screen.getByRole('group', { name: 'Edit thread windows' })).toBeDefined()
    expect(tile(1).getAttribute('aria-pressed')).toBe('true')
    // Every window's length on the canvas; the picked one's distance from the banknote's edge and to the next window
    expect([1, 2, 3, 4, 5].map((n) => field(`Length of window ${n}`).value)).toEqual(['8', '8', '8', '8', '8'])
    expect(field('Window 1 from the top of the banknote').value).toBe('0')
    expect(field('Gap between windows 1 and 2').value).toBe('6')
    // A press on another window's measure picks that window, and shows the gaps either side of it
    fireEvent.pointerDown(screen.getByText('Window 2', { exact: true }), { button: 0, pointerId: 1 })
    expect(tile(2).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTitle('Window 1 from the top of the banknote', { exact: true })).toBeNull()
    expect(field('Gap between windows 2 and 3').value).toBe('6')
    // A gap typed moves the window, its length kept; a length typed moves its end
    type('Gap between windows 1 and 2', '8')
    expect(sections()[1]).toMatchObject({ startMm: 16, endMm: 24 })
    expect(field('Gap between windows 2 and 3').value).toBe('4')
    type('Length of window 2', '9')
    expect(sections()[1]).toMatchObject({ startMm: 16, endMm: 25 })
    // Delete removes the picked window, and undo brings it back
    await user.click(tile(2))
    await user.keyboard('{Delete}')
    expect(sections()).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Undo', exact: true }))
    expect(sections()[1]).toMatchObject({ startMm: 16, endMm: 25 })
    // Clicking the banknote away from its windows ends editing and picks the banknote itself, not its thread
    fireEvent.pointerDown(document.querySelector('[data-note-body]')!, { button: 0, pointerId: 1 })
    fireEvent.pointerUp(document.querySelector('[data-note-body]')!, { button: 0, pointerId: 1 })
    expect(screen.queryByRole('group', { name: 'Edit thread windows' })).toBeNull()
    expect(picked()).toBe('Demo banknote')
    // Off and on again, the windows are as they were
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    await user.click(screen.getByRole('switch', { name: 'Windows' }))
    expect(screen.queryByRole('group', { name: 'Edit thread windows' })).toBeNull()
    await user.click(screen.getByRole('switch', { name: 'Windows' }))
    expect(screen.getByRole('group', { name: 'Edit thread windows' })).toBeDefined()
    // Window 2 now sits too close to window 3 for both their lengths to show: only the picked window's always does
    expect(screen.queryByTitle('Length of window 2', { exact: true })).toBeNull()
    await user.click(tile(2))
    expect(field('Length of window 2').value).toBe('9')
    expect(screen.queryByTitle('Length of window 3', { exact: true })).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Edit thread windows' })).toBeNull()
    expect(saves).not.toHaveBeenCalled()
  })
  it('picks only what a click lands on: the banknote itself, its thread or its watermark, never a layer picked before', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'selection-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const demo = useProjects.getState().demoPreview!
    act(() => addNote(demo.id, createNote({ name: 'Other', x: 200, y: 0, widthMm: 100, heightMm: 50, color: '#654321' })))
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, watermark: { ...newWatermark(n), imageId: 'fixture-watermark' } })))
    const width = () => screen.getByText('W', { exact: true }).parentElement!.querySelector('input')!.value
    const body = (i: number) => document.querySelectorAll('[data-note-body]')[i]
    const click = (target: Element) => {
      fireEvent.pointerDown(target, { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerUp(target, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    }

    // The thread, then another banknote: that banknote itself, not its thread
    click(body(0).querySelector('[data-thread]')!)
    expect(picked()).toBe('Security thread')
    click(body(1))
    expect(picked()).toBe('Other')
    expect(width()).toBe('100')

    // Tilting the selected banknote by dragging it leaves its layer showing; a click picks the banknote itself
    click(body(1).querySelector('[data-thread]')!)
    expect(picked()).toBe('Security thread')
    fireEvent.pointerDown(body(1), { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(body(1), { buttons: 1, pointerId: 1, clientX: 100, clientY: 60 })
    fireEvent.pointerUp(body(1), { button: 0, pointerId: 1, clientX: 100, clientY: 60 })
    expect(picked()).toBe('Security thread')
    click(body(1))
    expect(picked()).toBe('Other')

    // The watermark, then the banknote under it, then the other banknote: each time just what was clicked
    click(body(0).querySelector('[data-watermark]')!)
    expect(picked()).toBe('Watermark')
    click(body(0))
    expect(picked()).toBe('Demo banknote')
    expect(width()).toBe('150')
    click(body(0).querySelector('[data-watermark]')!)
    click(body(1))
    expect(picked()).toBe('Other')
    expect(width()).toBe('100')

    // The same in the list: a layer row, then another banknote's row
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    expect(picked()).toBe('Security thread')
    await user.click(screen.getByRole('button', { name: 'Demo banknote', exact: true }))
    expect(picked()).toBe('Demo banknote')
    expect(width()).toBe('150')

    // A layer's row picks it on the canvas too: the panel has no tabs of its own to turn to it (Keller, 9 November)
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    expect(screen.getByRole('button', { name: 'Security thread', exact: true }).classList.contains('bg-muted')).toBe(true)
    expect(body(0).querySelector('[data-outline="selected"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Watermark', exact: true }))
    expect(screen.getByRole('group', { name: 'Place watermark' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Demo banknote', exact: true }))
    expect(body(0).classList.contains('outline-2')).toBe(true)
    expect(saves).not.toHaveBeenCalled()
  })
  it('renames a security feature from its row in the list, as a banknote is renamed, and the panel’s header follows', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'rename-feature-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const note = () => useProjects.getState().demoPreview!.notes[0]
    const rename = async (row: string, field: string, typed: string) => {
      await user.dblClick(screen.getByRole('button', { name: row, exact: true }))
      await user.clear(screen.getByRole('textbox', { name: field }))
      await user.type(screen.getByRole('textbox', { name: field }), typed)
    }

    // A double-click on the thread's row makes its name a field; Enter keeps the new name, on the row and at the top of the
    // panel, and its bin still says what it is
    await rename('Security thread', 'Security thread name', 'Star thread{Enter}')
    expect(note().thread.name).toBe('Star thread')
    expect(picked()).toBe('Star thread')
    expect(screen.getByRole('button', { name: 'Star thread', exact: true })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Remove security thread' })).toBeDefined()
    // Escape leaves it as it was
    await rename('Star thread', 'Security thread name', 'Moon thread{Escape}')
    expect(note().thread.name).toBe('Star thread')
    expect(picked()).toBe('Star thread')

    // A placed layer renames the same way, and keeps its name as it is edited
    await user.click(addFeature())
    await user.click(await screen.findByRole('menuitem', { name: /^Watermark/ }))
    await rename('Watermark', 'Watermark name', 'Bird glow{Enter}')
    expect(picked()).toBe('Bird glow')
    fireEvent.change(screen.getByTitle('How strongly the watermark shows at its clearest, tilted or held to the light').querySelector('input')!, { target: { value: '30' } })
    expect(note().watermark).toMatchObject({ name: 'Bird glow', depth: 0.3 })

    // Emptied, a name goes, and the feature is called what it is again
    await rename('Star thread', 'Security thread name', '{Enter}')
    expect(note().thread.name).toBeUndefined()
    expect(picked()).toBe('Security thread')
    expect(saves).not.toHaveBeenCalled()
  })
  it('shows the thread’s frames on the timeline only while the thread itself is picked', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'timeline-thread-only-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    const demo = useProjects.getState().demoPreview!
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, watermark: { ...newWatermark(n), imageId: 'fixture-watermark' } })))
    const clips = () => document.querySelectorAll('[data-frame-clip]').length
    const play = () => screen.queryByRole('button', { name: 'Play', exact: true })
    expect(clips()).toBe(0)
    expect(play()).not.toBeNull()

    // The timeline is the thread's (Keller, 9 November: a banknote holds so many security features now): the banknote
    // itself shows none of its frames, its thread all of them, and another feature none again, play staying throughout
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    expect(picked()).toBe('Demo banknote')
    expect(clips()).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    expect(clips()).toBe(demo.notes[0].frames.length)
    await user.click(screen.getByRole('button', { name: 'Watermark', exact: true }))
    expect(picked()).toBe('Watermark')
    expect(clips()).toBe(0)
    expect(play()).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    expect(clips()).toBe(demo.notes[0].frames.length)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(picked()).toBeUndefined()
    expect(clips()).toBe(0)
  })
  it('handles frames on the timeline: a click goes to one, a drag reorders, × deletes, the pencil edits its fill, the line scrubs', async () => {
    // The canvas needs a size to draw the banknotes
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'timeline-fill-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const note = () => useProjects.getState().demoPreview!.notes[0]
    const clip = (id: string) => document.querySelector<HTMLElement>(`[data-frame-clip="${id}"]`)!
    const tilted = () => [useTilt.getState().angle, useTilt.getState().angleX, useTilt.getState().target, useTilt.getState().targetX]
    const [a, b] = note().frames.map((f) => f.id)
    // The frames show while the thread is picked
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))

    // A click on a clip shows that frame without tilting the banknote (Keller: the timeline follows manual tilt, never
    // the other way round)
    const still = tilted()
    for (const id of [a, b]) {
      fireEvent.pointerDown(clip(id), { button: 0, buttons: 1, clientX: 50, pointerId: 1 })
      fireEvent.pointerUp(clip(id), { button: 0, clientX: 50, pointerId: 1 })
      expect(clip(id).classList.contains('ring-1')).toBe(true)
      expect(tilted()).toEqual(still)
    }
    expect(picked()).toBe('Security thread')
    // Tilting by hand hands the frames back to the tilt, and the timeline follows it again
    expect(useTilt.getState().frameTilts[note().id]).toBeDefined()
    act(() => setTilt({ source: 'drag', target: 10 }))
    expect(useTilt.getState().frameTilts[note().id]).toBeUndefined()
    act(() => setTilt({ source: 'slider', angle: 0, target: 0, angleX: 0, targetX: 0 }))

    // A drag along the track moves a frame in the order, the others sliding aside while it goes
    fireEvent.pointerDown(clip(a), { button: 0, buttons: 1, clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(clip(a), { buttons: 1, clientX: 120, pointerId: 1 })
    expect(clip(a).style.transform).toBe('translateX(120px)')
    expect(clip(b).style.transform).toBe('translateX(-100px)')
    fireEvent.pointerUp(clip(a), { button: 0, clientX: 120, pointerId: 1 })
    expect(note().frames.map((f) => f.id)).toEqual([b, a])
    expect(clip(a).style.transform).toBe('')

    // × deletes a frame, shown only while there are more than the fewest
    expect(screen.queryByRole('button', { name: 'Delete frame 1' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add frame' }))
    await user.click(await screen.findByRole('menuitem', { name: /Empty frame/ }))
    expect(note().frames).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Delete frame 3' }))
    expect(note().frames.map((f) => f.id)).toEqual([b, a])

    // The pencil edits a frame's fill, in the same panel as the right panel's
    await user.click(screen.getByRole('button', { name: 'Edit frame 2' }))
    const hex = document.querySelector<HTMLInputElement>('[data-slot="popover-content"] input:not([type="color"])')!
    fireEvent.change(hex, { target: { value: '#123456' } })
    expect(note().frames[1].color).toBe('#123456')
    expect(note().frames[0].color).not.toBe('#123456')
    await user.click(screen.getByRole('button', { name: 'Edit frame 2' }))

    // The line scrubs, and so does the track round the frames (the band above them), where a press is easy to land
    // while the line runs during playback
    act(() => setTilt({ source: 'slider', angle: 0, target: 0, angleX: 0, targetX: 0 }))
    const track = clip(a).parentElement!
    fireEvent.pointerDown(track, { button: 0, buttons: 1, clientX: 30, pointerId: 1 })
    fireEvent.pointerUp(track, { button: 0, clientX: 30, pointerId: 1 })
    const scrubbed = useTilt.getState().frameTilts[note().id]
    expect(scrubbed).toBeDefined()
    expect(tilted()).toEqual([0, 0, 0, 0])
    expect(note().frames.map((f) => f.id)).toEqual([b, a])
    const line = document.querySelector<HTMLElement>('[data-playhead]')!
    fireEvent.pointerDown(line, { button: 0, buttons: 1, clientX: 30, pointerId: 1 })
    fireEvent.pointerMove(line, { buttons: 1, clientX: 190, pointerId: 1 })
    fireEvent.pointerUp(line, { button: 0, clientX: 190, pointerId: 1 })
    expect(useTilt.getState().frameTilts[note().id]).not.toEqual(scrubbed)
    expect(tilted()).toEqual([0, 0, 0, 0])
  })
  it('scrubs only the banknote whose timeline it is, until a tilt syncs them all', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'timeline-per-note-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    const demo = useProjects.getState().demoPreview!
    act(() => addNote(demo.id, createNote({ name: 'Other', x: 200, y: 0, widthMm: 100, heightMm: 50, color: '#654321' })))
    act(() => setTilt({ source: 'hold', angle: 0, target: 0, angleX: 0, targetX: 0, frameNumbers: true }))
    // The frame each banknote's thread shows, as its number on it
    const shown = () => [...document.querySelectorAll('[data-frame-number]')].map((n) => n.textContent)
    const before = shown()
    expect(before).toHaveLength(2)

    // A click on one of the first banknote's clips shows that frame on it alone (Keller: each timeline is its own)
    const frames = useProjects.getState().demoPreview!.notes[0].frames
    const other = before[0] === '1' ? 1 : 0
    const clip = document.querySelector<HTMLElement>(`[data-frame-clip="${frames[other].id}"]`)!
    fireEvent.pointerDown(clip, { button: 0, buttons: 1, clientX: 50, pointerId: 1 })
    fireEvent.pointerUp(clip, { button: 0, clientX: 50, pointerId: 1 })
    expect(shown()).toEqual([String(other + 1), before[1]])

    // A tilt syncs them all again
    act(() => setTilt({ source: 'hold', target: 0, targetX: 0 }))
    expect(shown()).toEqual(before)
    act(() => setTilt({ frameNumbers: false }))
  })
  it('names the thread’s size by its direction, leaves an image’s place to Thread Studio, and shows each side’s design as a card', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'thread-size-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const note = () => useProjects.getState().demoPreview!.notes[0]

    // Front and Back side by side, each a card to upload its design (Keller, 4 November), and no colour: a side without
    // a design is plain paper
    for (const side of ['Front', 'Back']) {
      expect(within(screen.getByRole('group', { name: side })).getByRole('button', { name: 'Upload design' })).toBeDefined()
    }
    expect(screen.queryAllByDisplayValue(/^#[0-9a-f]{6}$/i)).toHaveLength(0)

    // Across the thread: its Width when it runs down the banknote, its Height when it runs across
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    expect(screen.getByText('Width', { exact: true })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Horizontal', exact: true }))
    expect(screen.getByText('Height', { exact: true })).toBeDefined()
    expect(screen.queryByText('Width', { exact: true })).toBeNull()
    expect(screen.getByRole('button', { name: 'Fit to the height' })).toBeDefined()

    // An image fits the width here, the tile following it; where it sits in the tile is set in Thread Studio
    act(() => updateNote(useProjects.getState().demoPreview!.id, note().id, (n) => ({
      ...n, frames: n.frames.map((f) => ({ ...f, kind: 'image' as const, imageId: 'art', aspect: 1 })),
    })))
    expect(screen.getByText('Tile pattern', { exact: true })).toBeDefined()
    expect(screen.queryByText('Place', { exact: true })).toBeNull()
  })
  it('shows only the picked part under its name, labels every control, and the thread’s lens with its preview in a drawer at the foot', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'panel-lens-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    const note = () => useProjects.getState().demoPreview!.notes[0]
    // Only the part picked, named at the top, no tabs (Keller, 9 November): the banknote's own settings are its row away
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(picked()).toBe('Security thread')
    expect(screen.queryByText('H', { exact: true })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Demo banknote', exact: true }))
    expect(picked()).toBe('Demo banknote')
    expect(screen.getByText('H', { exact: true })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))

    // Small labels say what each control is
    for (const label of ['Direction', 'Width', 'Tile length', 'Position', 'Effect', 'Seen flat']) expect(screen.getByText(label, { exact: true })).toBeDefined()
    // The frame the timeline is on, filled right here as in Thread Studio's Frames tab, since they are normal controls
    // (Keller), its fill chosen in a panel of its own as Figma's; the timeline picks the frame, so no frame numbers
    expect(screen.getByText('Tile pattern', { exact: true })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Frame 1', exact: true })).toBeNull()
    // + and − add and remove it, as in Figma. It is laid out right here (Keller, 4 November): its image to upload first,
    // its colour under it, then, in a second section, the background colour under every frame (Keller), which an empty
    // frame shows. There is no Colour or Image to pick: what shows is the image when there is one, else the colour
    const upload = () => screen.queryByRole('button', { name: 'Upload image' })
    await user.click(screen.getByRole('button', { name: 'Remove tile pattern' }))
    expect(upload()).toBeNull()
    const emptied = note().frames.findIndex((f) => f.kind === 'none')
    expect(emptied).toBeGreaterThanOrEqual(0)
    await user.click(screen.getByRole('button', { name: 'Add tile pattern' }))
    expect(note().frames[emptied].kind).toBe('color')
    expect(upload()).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Image', exact: true })).toBeNull()
    fireEvent.change(hexFields()[0], { target: { value: '#abcdef' } })
    expect(note().frames[emptied].color).toBe('#abcdef')
    await user.click(screen.getByRole('switch', { name: 'Background colour' }))
    expect(note().thread.backgroundColor).toBe('#ffffff')
    await user.click(screen.getByRole('switch', { name: 'Background colour' }))
    expect(note().thread.backgroundColor).toBeUndefined()
    // There is no Image gap any more
    expect(screen.queryByTitle('Space between complete image copies along the thread')).toBeNull()

    // The lens's controls, edited for this banknote right here; Thread Studio opens from the canvas, not the panel
    expect(screen.getByRole('combobox', { name: 'Effect' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Edit thread' })).toBeNull()
    fireEvent.change(screen.getByText('Cycle', { exact: true }).closest('div')!.querySelector('input')!, { target: { value: '41' } })
    expect(note().tilt.cycleDeg).toBe(41)
    // Its preview sits in a drawer at the panel's foot
    const preview = screen.getByRole('button', { name: 'Preview' })
    if (preview.getAttribute('aria-expanded') !== 'true') await user.click(preview)
    expect(screen.getByRole('button', { name: 'Tilt map' })).toBeDefined()
    expect(screen.getByText('Frames seen', { exact: true })).toBeDefined()

    // Vertical ridges can't be printed for the sponsor (Keller), which the section says
    const sponsor = () => screen.queryByText('Not supported by our sponsor, Oberthur')
    expect(sponsor()).toBeNull()
    const demo = useProjects.getState().demoPreview!
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, tilt: { ...n.tilt, effect: 'side' } })))
    expect(sponsor()).not.toBeNull()
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, tilt: { ...n.tilt, effect: 'updown' } })))
    expect(sponsor()).toBeNull()

    // With mixed angles there is no one lens: the drawer shows the whole print instead, and the section says why, with
    // the switch to turn it off and get the one lens back (Keller missed it on such a banknote)
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, pattern: { ...presetPattern(n, 'split'), mixed: true } })))
    expect(screen.getByText('Mixed', { exact: true })).toBeDefined()
    expect(screen.getByRole('img', { name: 'Print' })).toBeDefined()
    expect(screen.queryByRole('combobox', { name: 'Effect' })).toBeNull()
    const mixed = screen.getByRole('switch', { name: 'Mixed angles' })
    expect(mixed.getAttribute('aria-checked')).toBe('true')
    await user.click(mixed)
    expect(useProjects.getState().demoPreview!.notes[0].pattern!.mixed).toBe(false)
    expect(screen.getByRole('combobox', { name: 'Effect' })).toBeDefined()
    expect(saves).not.toHaveBeenCalled()
  })
  it('outlines what a click would pick under the pointer, and only what is picked', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'hover-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const demo = useProjects.getState().demoPreview!
    act(() => addNote(demo.id, createNote({ name: 'Other', x: 200, y: 0, widthMm: 100, heightMm: 50, color: '#654321' })))
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, watermark: { ...newWatermark(n), imageId: 'fixture-watermark' } })))
    const body = (i: number) => document.querySelectorAll<HTMLElement>('[data-note-body]')[i]
    const thread = () => body(0).querySelector<HTMLElement>('[data-thread]')!
    const watermark = () => body(0).querySelector<HTMLElement>('[data-watermark]')!
    const outline = (kind: 'hover' | 'selected') => body(0).querySelector<HTMLElement>(`[data-outline="${kind}"]`)
    // Where an outline sits, to tell the thread's from the watermark's
    const box = (element: HTMLElement | null) => element && [element.style.left, element.style.top, element.style.width, element.style.height]
    const banknote = (i: number) => ['outline-0', 'outline-1', 'outline-2'].find((c) => body(i).classList.contains(c))
    const move = (target: Element) => fireEvent.pointerMove(target, { pointerId: 1, buttons: 0 })
    const click = (target: Element) => {
      fireEvent.pointerDown(target, { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerUp(target, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    }

    // The banknote itself is picked from its row; over its thread or its watermark, that part is outlined lightly
    expect(banknote(0)).toBe('outline-2')
    move(thread())
    expect(box(outline('hover'))).toEqual(box(thread()))
    move(watermark())
    expect(box(outline('hover'))).toEqual(box(watermark()))
    // Over the other banknote, that banknote is, and leaving the canvas clears it
    move(body(1))
    expect(outline('hover')).toBeNull()
    expect(banknote(1)).toBe('outline-1')
    fireEvent.pointerLeave(body(1).parentElement!.parentElement!.parentElement!)
    expect(banknote(1)).toBe('outline-0')

    // A click on the thread outlines the thread instead of the banknote, and the pointer over it adds nothing more
    click(thread())
    expect(box(outline('selected'))).toEqual(box(thread()))
    expect(banknote(0)).toBe('outline-0')
    move(thread())
    expect(outline('hover')).toBeNull()
    // Over the banknote around it, the banknote is outlined lightly, the thread still firmly
    move(body(0))
    expect(banknote(0)).toBe('outline-1')
    expect(box(outline('selected'))).toEqual(box(thread()))

    // Another banknote picked: only it is outlined
    click(body(1))
    expect(banknote(1)).toBe('outline-2')
    expect(outline('selected')).toBeNull()
    expect(saves).not.toHaveBeenCalled()
  })
  it('pans and zooms the canvas as one layer, then redraws the banknotes at the new view', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'pan-zoom-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    // The banknote's place on the canvas, round what turns with it once rotated
    const note = () => document.querySelector('[data-note-body]')!.parentElement!.parentElement as HTMLElement
    const layer = () => note().parentElement as HTMLElement
    const canvas = layer().parentElement as HTMLElement
    const left = parseFloat(note().style.left)
    // How wide the banknote is drawn: it follows the zoom once the view is committed
    const drawn = () => parseFloat((document.querySelector('[data-note-body]')!.firstElementChild as HTMLElement).style.width)

    fireEvent.wheel(canvas, { deltaX: 40, deltaY: 0 })
    fireEvent.wheel(canvas, { deltaX: 60, deltaY: 0 })
    // While the gesture runs, the layer moves and the banknote isn't re-laid out
    await waitFor(() => expect(layer().style.transform).toContain('translate(-100px, 0px)'))
    expect(parseFloat(note().style.left)).toBe(left)
    // Once it pauses, the banknote is drawn at its new place and the layer is back to no transform
    await waitFor(() => expect(parseFloat(note().style.left)).toBeCloseTo(left - 100))
    expect(layer().style.transform).toBe('')

    // The zoom shows in the corner bar, kept current while it changes
    const readout = () => document.querySelector('[data-zoom-readout]')!.textContent
    const fitted = readout()
    expect(fitted).toMatch(/^\d+%$/)
    const before = drawn()
    fireEvent.wheel(canvas, { deltaY: -40, ctrlKey: true, clientX: 0, clientY: 0 })
    await waitFor(() => expect(layer().style.transform).toContain('scale('))
    expect(drawn()).toBe(before)
    const zoomed = readout()
    expect(zoomed).not.toBe(fitted)
    await waitFor(() => expect(layer().style.transform).toBe(''))
    expect(drawn()).toBeGreaterThan(before)
    expect(readout()).toBe(zoomed)
    // A click on it goes to 100%, about true size: the 150 mm banknote drawn 150 mm wide at 96 px an inch
    await user.click(screen.getByTitle('Zoom to 100% (about true size)'))
    expect(readout()).toBe('100%')
    expect(drawn()).toBeCloseTo((150 * 96) / 25.4, 1)
  })

  it('edits the lens effect, Cycle included, for the selected banknote only', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'per-note-lens-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Duplicate', exact: true }))
    // The copy is selected, its layers open under it
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    const before = useProjects.getState().demoPreview!.notes.map((n) => n.tilt.cycleDeg)
    // The lens is edited in the panel (and in Thread Studio)
    const cycle = screen.getByText('Cycle', { exact: true }).closest('label, div')!.querySelector('input')!
    fireEvent.change(cycle, { target: { value: '47' } })
    fireEvent.blur(cycle)
    const notes = useProjects.getState().demoPreview!.notes
    const changed = notes.filter((n, i) => n.tilt.cycleDeg !== before[i])
    expect(changed).toHaveLength(1)
    expect(changed[0].tilt.cycleDeg).toBe(47)
  })
  it('opens playback settings and applies saved fade, speed, curve and a Hold to every banknote', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'playback-settings-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Duplicate', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Playback settings', exact: true }))
    const dialog = await screen.findByRole('dialog', { name: 'Playback settings' })
    expect(dialog).toBeDefined()
    fireEvent.change(screen.getByTitle('How much neighbouring frames blend into each other').querySelector('input')!, { target: { value: '60' } })
    fireEvent.change(screen.getByTitle('Playback speed multiplier; 1× takes 1.9 seconds each way').querySelector('input')!, { target: { value: '2' } })
    await user.click(within(dialog).getByRole('button', { name: 'Hold', exact: true }))
    fireEvent.change(screen.getByTitle('Seconds held flat, at 1× speed').querySelector('input')!, { target: { value: '0.4' } })
    await user.click(screen.getByRole('combobox', { name: 'Playback curve' }))
    await user.click(await screen.findByRole('option', { name: 'Linear', exact: true }))
    const project = useProjects.getState().demoPreview!
    expect(project.notes).toHaveLength(2)
    for (const note of migrateProject(JSON.parse(JSON.stringify(project))).notes) {
      expect(note.tilt).toMatchObject({ transition: 0.6, speed: 2, curve: 'linear' })
      expect(note.tilt.moves?.map((m) => [m.kind, m.seconds])).toEqual([['y', undefined], ['hold', 0.4]])
    }
    // The default Up/down stays as it was, 30° back to flat (1.4 s at 2×: a quarter sweep's glide out and half a sweep back),
    // then the hold (0.2 s at 2×)
    const field = (title: string) => (within(dialog).getByTitle(title).querySelector('input') as HTMLInputElement).value
    expect([field('Up/down tilt the move starts from; negative tilts down'), field('Up/down tilt this move reaches; negative tilts down')]).toEqual(['30', '0'])
    expect(screen.getByText('1.6 s loop')).toBeDefined()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Playback settings' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Playback settings', exact: true })).toBeDefined()
    expect(saves).not.toHaveBeenCalled()
  })
  it('adds a Flip from the playback settings, a move of its own in every banknote’s playlist', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'flip-move-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Playback settings', exact: true }))
    const dialog = await screen.findByRole('dialog', { name: 'Playback settings' })
    await user.click(within(dialog).getByRole('button', { name: 'Flip', exact: true }))
    for (const note of useProjects.getState().demoPreview!.notes) expect(note.tilt.moves?.map((m) => m.kind)).toEqual(['y', 'flip'])
    // In the playlist after the default Up/down, with nothing to set
    const rows = within(dialog).getAllByRole('listitem').filter((row) => row.closest('ol'))
    expect(rows).toHaveLength(2)
    expect(rows[1].textContent).toBe('2Flip')
    expect(rows[1].querySelector('input')).toBeNull()
    expect(saves).not.toHaveBeenCalled()
  })
  it('records a move from the playback settings: the list closes, the tilt pad opens to drag on, and Escape cancels', async () => {
    const user = userEvent.setup()
    setTiltPadOpen(false)
    localStorage.setItem('of-thread-workspace', 'record-move-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    expect(screen.queryByRole('group', { name: 'Tilt pad' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Playback settings', exact: true }))
    const dialog = await screen.findByRole('dialog', { name: 'Playback settings' })
    // Record a move is the moves list's last row
    await user.click(within(dialog).getByRole('button', { name: 'Record a move' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Playback settings' })).toBeNull())
    expect(useTilt.getState().recording).toBe(true)
    expect(screen.getByRole('group', { name: 'Tilt pad' })).toBeDefined()
    // Escape only cancels it: the banknote stays selected
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useTilt.getState().recording).toBe(false)
    expect(picked()).toBe('Demo banknote')
    // The pad stays open, as the browser remembers
    expect(screen.getByRole('group', { name: 'Tilt pad' })).toBeDefined()
    setTiltPadOpen(false)
  })
  it('drags the ends of Partial reveal’s slow-tilt lane on the timeline to hide more or fewer frames', async () => {
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'reveal-lane-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    const demo = useProjects.getState().demoPreview!
    const tilt = () => useProjects.getState().demoPreview!.notes[0].tilt
    // Five equal frames, flat in the middle of 3: side tilt can hide frames 1 and 5, or every frame but 3
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n,
      frames: Array.from({ length: 5 }, (_, i) => ({ ...n.frames[0], id: `frame-${i}`, length: 10 })),
      tilt: { ...n.tilt, cycleDeg: 30, effect: 'reveal', revealAxis: 'y', revealWobble: 1, flatAt: undefined } })))
    // The two ends of the side-tilt lane, the slow one, on the timeline
    const ends = () => [...document.querySelectorAll<HTMLElement>('[data-reach]')].filter((end) => end.parentElement?.title === 'Frames tilting side to side shows')
    expect(ends()).toHaveLength(2)
    // jsdom puts the track at 0: the cycle runs from 12 px, 100 px a frame, flat at 262. Dragged towards flat, the reach
    // narrows to the next step, hiding more; dragged back out, it widens again
    const drag = (end: HTMLElement, from: number, to: number) => {
      fireEvent.pointerDown(end, { button: 0, buttons: 1, clientX: from, pointerId: 1 })
      fireEvent.pointerMove(end, { buttons: 1, clientX: to, pointerId: 1 })
      fireEvent.pointerUp(end, { button: 0, clientX: to, pointerId: 1 })
    }
    drag(ends()[1], 412, 312)
    expect(tilt().revealLevel).toBe(1)
    drag(ends()[0], 212, 112)
    expect(tilt().revealLevel).toBe(0)
    // The tilt is left alone, and nothing is scrubbed
    expect(useTilt.getState().frameTilts[demo.notes[0].id]).toBeUndefined()
  })
  it('discards demo edits on exit and signs out without creating any project', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'demo-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await screen.findByRole('button', { name: 'New project', exact: true })
    expect(screen.queryByText('Demo fixture')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Demo', exact: true }))
    await screen.findByRole('button', { name: 'Exit demo' })
    const name = screen.getByRole('textbox', { name: 'Project name' })
    await user.clear(name)
    await user.type(name, 'Unsaved demo edit')
    expect(screen.getByRole('status').textContent).toBe('Preview')
    await user.click(screen.getByRole('button', { name: 'Exit demo' }))
    await screen.findByRole('button', { name: 'New project', exact: true })
    expect(screen.queryByText('Unsaved demo edit')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Demo', exact: true }))
    await screen.findByRole('button', { name: 'Exit demo' })
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Demo fixture')
    expect(screen.queryByRole('button', { name: 'Sign out', exact: true })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Exit demo' }))
    await screen.findByRole('button', { name: 'New project', exact: true })
    await user.click(screen.getByRole('button', { name: 'Account: demo-ui-test' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await screen.findByRole('textbox', { name: 'Username' })
    expect(localStorage.getItem('of-thread-workspace')).toBeNull()
    expect(saves).not.toHaveBeenCalled()
  })

  it('opens the demo playing its playlist, and stops and goes back to flat on leaving it', async () => {
    const user = userEvent.setup()
    vi.mocked(createDemoProject).mockImplementationOnce(async () => {
      const note = createNote({ name: 'Playing banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#123456' })
      return { ...createProject('Playing demo'), notes: [{ ...note, tilt: { ...note.tilt, moves: [{ id: 'swing', kind: 'y' }] } }] }
    })
    localStorage.setItem('of-thread-workspace', 'demo-play-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await screen.findByRole('button', { name: 'New project', exact: true })
    await user.click(screen.getByRole('button', { name: 'Demo', exact: true }))
    await screen.findByRole('button', { name: 'Exit demo' })
    expect(useTilt.getState().source).toBe('wobble')
    expect(screen.getByRole('button', { name: 'Pause', exact: true })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Exit demo' }))
    await screen.findByRole('button', { name: 'New project', exact: true })
    expect(useTilt.getState()).toMatchObject({ source: 'slider', target: 0, targetX: 0 })
  })

  it('toggles playback with a tap of Space as it comes up, ignores repeats and typing, and respects dialogs', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'keyboard-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await screen.findByRole('button', { name: 'New project', exact: true })
    await user.click(screen.getByRole('button', { name: 'Demo', exact: true }))
    await screen.findByRole('button', { name: 'Exit demo' })
    // Held down, Space is the hand that pans: playback waits for it to come up
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    fireEvent.keyDown(window, { code: 'Space', key: ' ', repeat: true })
    expect(useTilt.getState().source).toBe('drag')
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(useTilt.getState().source).toBe('wobble')
    expect(screen.getByRole('button', { name: 'Pause', exact: true })).toBeDefined()
    act(() => setTilt({ angle: 17, target: 17 }))
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(useTilt.getState().source).toBe('slider')
    expect(useTilt.getState().target).toBe(17)

    // The shortcut also works with the playback button focused, without a second toggle on keyup.
    await user.click(screen.getByRole('button', { name: 'Play', exact: true }))
    await user.keyboard(' ')
    expect(useTilt.getState().source).toBe('slider')
    const name = screen.getByRole('textbox', { name: 'Project name' })
    await user.click(name)
    await user.keyboard(' ')
    expect(useTilt.getState().source).toBe('slider')
    await user.click(screen.getByRole('button', { name: 'Add banknote', exact: true }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(useTilt.getState().source).toBe('slider')
  })

  it('supports toolbar and keyboard undo/redo in the temporary editor', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'undo-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await screen.findByRole('button', { name: 'New project', exact: true })
    await user.click(screen.getByRole('button', { name: 'Demo', exact: true }))
    await screen.findByRole('button', { name: 'Exit demo' })
    expect((screen.getByRole('button', { name: 'Undo', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    const name = screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement
    await user.clear(name)
    await user.type(name, 'Changed demo')
    await user.click(screen.getByRole('button', { name: 'Undo', exact: true }))
    expect(name.value).toBe('Demo fixture')
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true })
    expect(name.value).toBe('Changed demo')
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(name.value).toBe('Demo fixture')
    fireEvent.keyDown(window, { key: 'y', code: 'KeyY', ctrlKey: true })
    expect(name.value).toBe('Changed demo')
    expect(saves).not.toHaveBeenCalled()
  })

  it('springs a tilt drag back to flat however the drag ends, and leaves a held tilt alone on a click', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'tilt-spring-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const body = () => document.querySelector('[data-note-body]')!
    const target = () => ({ y: useTilt.getState().target, x: useTilt.getState().targetX })
    const drag = (button = 0) => {
      fireEvent.pointerDown(body(), { button, buttons: button === 0 ? 1 : 2, pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(body(), { buttons: 1, pointerId: 1, clientX: 140, clientY: 60 })
    }
    const unlock = () => setTilt({ source: 'drag', angle: 0, angleX: 0, target: 0, targetX: 0, lockX: false, lockY: false })

    // A clean release
    unlock()
    drag()
    expect(target().y).not.toBe(0)
    fireEvent.pointerUp(body(), { button: 0, pointerId: 1, clientX: 140, clientY: 60 })
    expect(target()).toEqual({ y: 0, x: 0 })

    // A release that never arrived, noticed on the next move
    drag()
    fireEvent.pointerMove(body(), { buttons: 0, pointerId: 1, clientX: 150, clientY: 50 })
    expect(target()).toEqual({ y: 0, x: 0 })

    // Losing pointer capture, or the window losing focus, mid-drag
    drag()
    fireEvent(body(), new Event('lostpointercapture', { bubbles: true }))
    expect(target()).toEqual({ y: 0, x: 0 })
    drag()
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(target()).toEqual({ y: 0, x: 0 })

    // A locked axis keeps where it was dragged
    setTilt({ lockX: true })
    drag()
    const side = target().x
    fireEvent.pointerUp(body(), { button: 0, pointerId: 1 })
    expect(target()).toEqual({ y: 0, x: side })
    unlock()

    // A right drag pans instead of tilting
    drag(2)
    expect(target()).toEqual({ y: 0, x: 0 })
    fireEvent.pointerUp(body(), { button: 2, pointerId: 1 })

    // A click with no drag leaves a held tilt where it is
    setTilt({ source: 'hold', angle: 12, target: 12, angleX: -5, targetX: -5 })
    fireEvent.pointerDown(body(), { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(body(), { buttons: 1, pointerId: 1, clientX: 101, clientY: 101 })
    fireEvent.pointerUp(body(), { button: 0, pointerId: 1, clientX: 101, clientY: 101 })
    expect(target()).toEqual({ y: 12, x: -5 })
  })

  it('tilts from a drag on a banknote or the empty canvas, and pans with the middle or right button or with Space held', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'canvas-navigation-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const body = () => document.querySelector('[data-note-body]')!
    // The banknote's place on the canvas, round what turns with it once rotated
    const note = () => body().parentElement!.parentElement as HTMLElement
    const canvas = () => note().parentElement!.parentElement as HTMLElement
    const left = () => parseFloat(note().style.left)
    const target = () => ({ y: useTilt.getState().target, x: useTilt.getState().targetX })
    const BUTTONS = [1, 4, 2]
    const drag = (on: Element, button = 0, by = { x: 40, y: 0 }) => {
      fireEvent.pointerDown(on, { button, buttons: BUTTONS[button], pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(on, { buttons: BUTTONS[button], pointerId: 1, clientX: 100 + by.x, clientY: 100 + by.y })
      fireEvent.pointerUp(on, { button, pointerId: 1, clientX: 100 + by.x, clientY: 100 + by.y })
    }

    // A drag on the empty canvas tilts every banknote, as one on a banknote does, springing back on release; the
    // banknote stays picked
    fireEvent.pointerDown(canvas(), { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas(), { buttons: 1, pointerId: 1, clientX: 100, clientY: 60 })
    expect(target().y).toBeGreaterThan(0)
    expect(useTilt.getState().source).toBe('drag')
    fireEvent.pointerUp(canvas(), { button: 0, pointerId: 1, clientX: 100, clientY: 60 })
    expect(target()).toEqual({ y: 0, x: 0 })
    expect(picked()).toBe('Demo banknote')

    // A middle or right drag pans, on the banknote too, without tilting it; the right button opens no browser menu
    for (const button of [1, 2]) {
      const before = left()
      drag(body(), button)
      expect(left()).toBeCloseTo(before + 40)
      expect(target()).toEqual({ y: 0, x: 0 })
    }
    expect(fireEvent.contextMenu(body())).toBe(false)
    expect(picked()).toBe('Demo banknote')

    // Held down, Space is the hand: a drag anywhere on the canvas pans, and letting go of Space then doesn't play
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    expect(canvas().className).toContain('cursor-grab')
    for (const on of [body(), body().querySelector('[data-thread]')!, canvas()]) {
      const before = left()
      drag(on)
      expect(left()).toBeCloseTo(before + 40)
    }
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(canvas().className).not.toContain('cursor-grab')
    expect(target()).toEqual({ y: 0, x: 0 })
    expect(useTilt.getState().source).not.toBe('wobble')
    expect(picked()).toBe('Demo banknote')

    // A click on the empty canvas clears the selection and leaves playback playing
    act(() => togglePlayback())
    fireEvent.pointerDown(canvas(), { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(canvas(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    expect(picked()).toBeUndefined()
    expect(useTilt.getState().source).toBe('wobble')
    act(() => togglePlayback())

    // The banknote's label still moves the banknote
    const { x } = useProjects.getState().demoPreview!.notes[0]
    drag(document.querySelector('[data-note-label]')!)
    expect(useProjects.getState().demoPreview!.notes[0].x).not.toBe(x)
  })

  it('adds a watermark as a layer, places it on the canvas flat and clear, and holds every banknote to the light with L', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    setTilt({ backlit: false, peek: false, light: 0 })
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'watermark-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const placing = () => screen.queryByRole('group', { name: 'Place watermark' })
    const watermark = () => useProjects.getState().demoPreview!.notes[0].watermark

    // The banknote's own row shows the banknote itself; each layer under it shows its own
    expect(picked()).toBe('Demo banknote')
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    expect(picked()).toBe('Security thread')

    // Adding the watermark selects it and shows the banknote flat with it clear, with its box to place; the tilt card stays
    await user.click(addFeature())
    await user.click(await screen.findByRole('menuitem', { name: /^Watermark/ }))
    expect(watermark()).toBeDefined()
    expect(picked()).toBe('Watermark')
    expect(placing()).not.toBeNull()
    expect(screen.getByRole('group', { name: 'Tilt' })).toBeDefined()
    const { xMm } = watermark()!
    fireEvent.keyDown(placing()!, { key: 'ArrowRight' })
    expect(watermark()!.xMm).toBe(xMm + 0.5)
    fireEvent.change(screen.getByTitle('How strongly the watermark shows at its clearest, tilted or held to the light').querySelector('input')!, { target: { value: '30' } })
    expect(watermark()!.depth).toBe(0.3)

    // Escape ends placing and keeps the watermark selected
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(placing()).toBeNull()
    expect(picked()).toBe('Watermark')
    expect(screen.getByRole('group', { name: 'Tilt' })).toBeDefined()

    // A tap of L holds every banknote to the light, as the lamp on the pad shows; typing an L doesn't
    fireEvent.keyDown(window, { key: 'l' })
    fireEvent.keyUp(window, { key: 'l' })
    expect(useTilt.getState().backlit).toBe(true)
    expect(screen.getByRole('button', { name: 'Hold up to the light' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('textbox', { name: 'Project name' }))
    await user.keyboard('l')
    expect(useTilt.getState().backlit).toBe(true)

    // Once it has an image, the watermark drags on the banknote as the thread does: a press picks it, with its box and
    // corners, and a drag moves it in 0.5 mm steps instead of tilting the banknote
    expect(screen.queryByRole('switch', { name: 'Invert' })).toBeNull()
    const demo = useProjects.getState().demoPreview!
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, watermark: { ...n.watermark!, imageId: 'fixture-watermark' } })))
    const hit = () => document.querySelector('[data-note-body] [data-watermark]')!
    const tilt = () => ({ y: useTilt.getState().target, x: useTilt.getState().targetX })
    const start = watermark()!
    const tiltBefore = tilt()
    fireEvent.pointerDown(hit(), { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    expect(placing()).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Resize watermark from its bottom-right corner' })).toBeDefined()
    // A wobble doesn't move it
    fireEvent.pointerMove(hit(), { buttons: 1, pointerId: 1, clientX: 101, clientY: 101 })
    expect(watermark()).toEqual(start)
    fireEvent.pointerMove(hit(), { buttons: 1, pointerId: 1, clientX: 140, clientY: 100 })
    const moved = watermark()!
    expect(moved.xMm).toBeGreaterThan(start.xMm)
    expect(moved.xMm % 0.5).toBe(0)
    expect(moved.yMm).toBe(start.yMm)
    expect(moved.widthMm).toBe(start.widthMm)
    fireEvent.pointerUp(hit(), { button: 0, pointerId: 1, clientX: 140, clientY: 100 })
    expect(tilt()).toEqual(tiltBefore)
    expect(placing()).not.toBeNull()
    // A click elsewhere on the banknote ends placing
    fireEvent.pointerDown(document.querySelector('[data-note-body]')!, { button: 0, buttons: 1, pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(document.querySelector('[data-note-body]')!, { button: 0, pointerId: 1, clientX: 5, clientY: 5 })
    expect(placing()).toBeNull()
    // A click on it picks it again without moving it
    fireEvent.pointerDown(hit(), { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(hit(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    expect(placing()).not.toBeNull()
    expect(watermark()).toEqual(moved)
    fireEvent.keyDown(window, { key: 'Escape' })

    // Invert reads the image the other way round, dark parts thinner; switched off, it is left unsaid
    await user.click(screen.getByRole('switch', { name: 'Invert' }))
    expect(watermark()).toEqual({ ...moved, invert: true })
    await user.click(screen.getByRole('switch', { name: 'Invert' }))
    expect(watermark()).toEqual(moved)

    // Levels start on Auto, fitted to the image; moving a handle sets them by hand and turns Auto off
    const autoLevels = () => screen.getByRole('switch', { name: 'Auto levels' })
    // jsdom has no layout, so the slider keeps its handles hidden (unnamed to a role query) until it could place them
    const handle = (name: string) => screen.getByLabelText(name)
    expect(autoLevels().getAttribute('aria-checked')).toBe('true')
    expect(handle('Where the watermark starts').getAttribute('aria-valuenow')).toBe('10')
    expect(handle('Midtones').getAttribute('aria-valuenow')).toBe('45')
    expect(handle('Where it is thinnest').getAttribute('aria-valuenow')).toBe('80')
    fireEvent.keyDown(handle('Where the watermark starts'), { key: 'ArrowRight' })
    expect(watermark()).toEqual({ ...moved, levels: { low: 0.11, high: 0.8, gamma: 1 } })
    expect(autoLevels().getAttribute('aria-checked')).toBe('false')
    // The midtones handle keeps its place between the ends; left of the middle brightens them
    expect(handle('Midtones').getAttribute('aria-valuenow')).toBe('45.5')
    fireEvent.keyDown(handle('Midtones'), { key: 'ArrowLeft' })
    expect(watermark()!.levels!.gamma).toBeGreaterThan(1)
    // Auto again leaves them unsaid; switched off, it keeps Auto's to set by hand
    await user.click(autoLevels())
    expect(watermark()).toEqual(moved)
    await user.click(autoLevels())
    expect(watermark()).toEqual({ ...moved, levels: { low: 0.1, high: 0.8, gamma: 1 } })
    await user.click(autoLevels())

    // The lamp on the pad switches it off again
    await user.click(screen.getByRole('button', { name: 'Hold up to the light' }))
    expect(useTilt.getState().backlit).toBe(false)
    expect(saves).not.toHaveBeenCalled()
  })

  it('turns every banknote over to its back, where only the watermark shows, the other way round, and sets the back as the front is set', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    setTilt({ flipped: false, turn: 0 })
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'back-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const demo = useProjects.getState().demoPreview!
    const note = () => useProjects.getState().demoPreview!.notes[0]
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, watermark: { ...newWatermark(n), imageId: 'fixture-watermark' } })))
    const shown = (selector: string) => document.querySelector(`[data-note-body] ${selector}`)
    // Turning over takes a moment, the loop easing it round; here it is done at once
    const finishTurn = () => act(() => setTilt({ turn: useTilt.getState().flipped ? 1 : 0 }))
    // Front | Back at the top of the canvas (Keller, 4 November: on the tilt card it was too hidden)
    const side = (name: 'Front' | 'Back') => screen.getByRole('button', { name, exact: true })
    // The selected banknote's frames, as clips on the timeline while its thread is picked
    const clips = () => document.querySelectorAll('[data-frame-clip]').length
    expect(screen.queryByRole('button', { name: 'Show the back' })).toBeNull()
    expect(side('Front').getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    expect(clips()).toBeGreaterThan(0)

    // F turns every banknote over, as the switch shows: the back has no thread, the watermark mirrored
    fireEvent.keyDown(window, { key: 'f' })
    expect(useTilt.getState().flipped).toBe(true)
    expect(side('Back').getAttribute('aria-pressed')).toBe('true')
    // The back has no thread, so the timeline shows no frames, though the banknote is still selected (Keller)
    expect(clips()).toBe(0)
    expect(picked()).toBe('Demo banknote')
    finishTurn()
    expect(shown('[data-back]')).not.toBeNull()
    expect(shown('[data-thread]')).toBeNull()
    expect(document.querySelector('[data-side-label]')?.textContent).toBe('Back')
    expect((shown('[data-watermark]') as HTMLElement).style.transform).toBe('scaleX(-1)')

    // On the back a drag to the right moves the watermark right there, so towards the front's left; its box does the same
    const start = note().watermark!
    fireEvent.pointerDown(shown('[data-watermark]')!, { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(shown('[data-watermark]')!, { buttons: 1, pointerId: 1, clientX: 140, clientY: 100 })
    fireEvent.pointerUp(shown('[data-watermark]')!, { button: 0, pointerId: 1, clientX: 140, clientY: 100 })
    const moved = note().watermark!
    expect(moved.xMm).toBeLessThan(start.xMm)
    expect(picked()).toBe('Watermark')
    const placing = screen.getByRole('group', { name: 'Place watermark' })
    fireEvent.keyDown(placing, { key: 'ArrowRight' })
    expect(note().watermark!.xMm).toBe(moved.xMm - 0.5)
    fireEvent.keyDown(window, { key: 'Escape' })

    // Picking the thread turns them back round to the front, where it is
    await user.click(screen.getByRole('button', { name: 'Security thread', exact: true }))
    expect(useTilt.getState().flipped).toBe(false)
    expect(clips()).toBeGreaterThan(0)
    finishTurn()
    expect(shown('[data-thread]')).not.toBeNull()
    expect(document.querySelector('[data-side-label]')).toBeNull()
    // Turned over again, the thread can't stay picked: the banknote itself is
    await user.click(side('Back'))
    expect(useTilt.getState().flipped).toBe(true)
    expect(picked()).toBe('Demo banknote')
    expect(clips()).toBe(0)
    finishTurn()

    // Working on the front's design card turns the banknotes to the front, and on the back's to the back
    fireEvent.pointerDown(within(screen.getByRole('group', { name: 'Front' })).getByRole('button', { name: 'Upload design' }))
    expect(useTilt.getState().flipped).toBe(false)
    fireEvent.pointerDown(within(screen.getByRole('group', { name: 'Back' })).getByRole('button', { name: 'Upload design' }))
    expect(useTilt.getState().flipped).toBe(true)
    finishTurn()

    // An export of the banknotes turned over starts on their backs
    await user.click(screen.getByRole('button', { name: 'Export', exact: true }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Back' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(dialog).getByRole('button', { name: 'Front' }).getAttribute('aria-pressed')).toBe('false')
    expect(saves).not.toHaveBeenCalled()
  })

  it('rotates every banknote a quarter turn left or right beside Front | Back, its name upright and drags going the way the pointer goes', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    setTilt({ flipped: false, turn: 0, quarterTurns: 0, angle: 0, angleX: 0, target: 0, targetX: 0, lockX: false, lockY: false })
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'rotate-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const demo = useProjects.getState().demoPreview!
    const note = () => useProjects.getState().demoPreview!.notes[0]
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, watermark: { ...newWatermark(n), imageId: 'fixture-watermark' } })))
    const body = () => document.querySelector('[data-note-body]')!
    const shown = (selector: string) => document.querySelector(`[data-note-body] ${selector}`)!
    // What turns with the banknote, and where its name sits, upright, over it
    const turned = () => body().parentElement!
    const name = () => document.querySelector<HTMLElement>('[data-note-label]')!
    const quarterTurns = () => useTilt.getState().quarterTurns
    const tilt = () => ({ y: useTilt.getState().target, x: useTilt.getState().targetX })
    const drag = (element: Element, dx: number, dy: number, release = true) => {
      fireEvent.pointerDown(element, { button: 0, buttons: 1, pointerId: 1, clientX: 400, clientY: 300 })
      fireEvent.pointerMove(element, { buttons: 1, pointerId: 1, clientX: 400 + dx, clientY: 300 + dy })
      if (release) fireEvent.pointerUp(element, { button: 0, pointerId: 1, clientX: 400 + dx, clientY: 300 + dy })
    }
    expect(turned().style.transform).toBe('')
    expect(turned().dataset.noteTurn).toBeUndefined()

    // Rotate right, beside Front | Back: every banknote a quarter turn clockwise about its middle
    await user.click(screen.getByRole('button', { name: 'Rotate right' }))
    expect(quarterTurns()).toBe(1)
    expect(turned().style.transform).toBe('rotate(90deg)')
    expect(turned().dataset.noteTurn).toBe('1')
    // Its name stays upright, over the top left of the banknote as it shows: 150 × 70 on its side shows 70 wide and
    // 150 tall about the same middle, so 40 mm in from its own left and 40 mm above its own top
    expect(turned().contains(name())).toBe(false)
    expect(parseFloat(name().parentElement!.style.left)).toBeCloseTo((40 / 150) * 100)
    expect(parseFloat(name().parentElement!.style.top)).toBeCloseTo((-40 / 70) * 100)

    // A drag to the right of the screen tilts it towards its top edge, which shows there, as a drag up does upright
    drag(body(), 40, 0, false)
    expect(tilt()).toEqual({ y: 7.5, x: 0 })
    fireEvent.pointerUp(body(), { button: 0, pointerId: 1 })
    expect(tilt()).toEqual({ y: 0, x: 0 })

    // Its thread now runs across the screen: a drag down moves it along the banknote's width, which runs down the screen,
    // and a drag along it leaves it where it is
    const from = note().thread.positionMm
    drag(shown('[data-thread]'), 0, 40)
    const moved = note().thread.positionMm
    expect(moved).toBeGreaterThan(from)
    drag(shown('[data-thread]'), 40, 0)
    expect(note().thread.positionMm).toBe(moved)

    // The watermark moves the way the pointer goes too, and so do its arrow keys: → is towards the banknote's top
    const placed = note().watermark!
    drag(shown('[data-watermark]'), 0, 40)
    expect(note().watermark!.xMm).toBeGreaterThan(placed.xMm)
    expect(note().watermark!.yMm).toBe(placed.yMm)
    const nudged = note().watermark!
    fireEvent.keyDown(screen.getByRole('group', { name: 'Place watermark' }), { key: 'ArrowRight' })
    expect(note().watermark!).toMatchObject({ xMm: nudged.xMm, yMm: nudged.yMm - 0.5 })
    fireEvent.keyDown(window, { key: 'Escape' })

    // R turns them right again, once for a key held down, and Shift+R left: counted on, so each turn plays the way it went
    fireEvent.keyDown(window, { key: 'r' })
    fireEvent.keyDown(window, { key: 'r', repeat: true })
    expect(quarterTurns()).toBe(2)
    expect(turned().style.transform).toBe('rotate(180deg)')
    // Upside down it covers its own box, its name back at its top left
    expect(name().parentElement!.style.left).toBe('0%')
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: 'R', shiftKey: true })
    expect(quarterTurns()).toBe(-1)
    expect(turned().style.transform).toBe('rotate(-90deg)')
    expect(turned().dataset.noteTurn).toBe('3')
    await user.click(screen.getByRole('button', { name: 'Rotate left' }))
    await user.click(screen.getByRole('button', { name: 'Rotate right' }))
    expect(quarterTurns()).toBe(-1)

    // An export of them turned comes out turned
    await user.click(screen.getByRole('button', { name: 'Export', exact: true }))
    expect(await screen.findByText(/· rotated 90° left/)).toBeDefined()
    // A way of looking, never saved, and upright again once the project closes
    expect(saves).not.toHaveBeenCalled()
    cleanup()
    expect(quarterTurns()).toBe(0)
  })

  it('keeps the watermark when a banknote is duplicated, removes it from its layer, and undoes the removal', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'watermark-remove-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    await user.click(addFeature())
    await user.click(await screen.findByRole('menuitem', { name: /^Watermark/ }))
    const notes = () => useProjects.getState().demoPreview!.notes
    const original = notes()[0].watermark

    await user.click(screen.getByRole('button', { name: 'Duplicate', exact: true }))
    await waitFor(() => expect(notes()).toHaveLength(2))
    expect(notes()[1].watermark).toEqual(original)

    // The copy is selected as a banknote, not on the layer picked before; removing its watermark leaves the original alone
    expect(picked()).toBe('Demo banknote copy')
    await user.click(screen.getByRole('button', { name: 'Watermark', exact: true }))
    expect(picked()).toBe('Watermark')
    // From its row in the list, the one place it is removed (the panel's header only names it)
    await user.click(screen.getByRole('button', { name: 'Remove watermark' }))
    expect(notes()[1].watermark).toBeUndefined()
    expect(notes()[0].watermark).toEqual(original)
    expect(screen.queryByRole('button', { name: 'Watermark', exact: true })).toBeNull()
    // The banknote itself stays selected
    expect(picked()).toBe('Demo banknote copy')

    await user.click(screen.getByRole('button', { name: 'Undo', exact: true }))
    expect(notes()[1].watermark).toEqual(original)
    expect(saves).not.toHaveBeenCalled()
  })

  it('adds magnetic ink as a layer, places it as the watermark is placed, and sets its colours and bar', async () => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      observe() { this.callback([{ contentRect: { width: 1280, height: 720 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      unobserve() {} disconnect() {}
    })
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
    }
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'magnetic-ink-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const placing = () => screen.queryByRole('group', { name: 'Place magnetic ink' })
    const ink = () => useProjects.getState().demoPreview!.notes[0].magneticInk

    // The + lists every layer the banknote doesn't have yet; adding the ink selects it and shows its box to place, the
    // banknote laid flat and the tilt card staying, as for the watermark
    await user.click(addFeature())
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent))
      .toEqual([expect.stringMatching(/^Watermark/), expect.stringMatching(/^Arc-en-Ciel/), expect.stringMatching(/^Magnetic ink/)])
    await user.click(screen.getByRole('menuitem', { name: /^Magnetic ink/ }))
    expect(ink()).toBeDefined()
    expect(picked()).toBe('Magnetic ink')
    expect(screen.getByRole('button', { name: 'Magnetic ink', exact: true }).classList.contains('bg-muted')).toBe(true)
    expect(placing()).not.toBeNull()
    expect(screen.getByRole('group', { name: 'Tilt' })).toBeDefined()

    // Arrow keys nudge it, Shift ten steps; a corner resizes it from the opposite corner, its proportions kept
    const start = ink()!
    fireEvent.keyDown(placing()!, { key: 'ArrowLeft', shiftKey: true })
    fireEvent.keyDown(placing()!, { key: 'ArrowUp' })
    expect(ink()).toEqual({ ...start, xMm: start.xMm - 5, yMm: start.yMm - 0.5 })
    const corner = screen.getByRole('button', { name: 'Resize magnetic ink from its bottom-right corner' })
    fireEvent.pointerDown(corner, { button: 0, buttons: 1, pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(corner, { buttons: 1, pointerId: 1, clientX: 340, clientY: 300 })
    fireEvent.pointerUp(corner, { button: 0, pointerId: 1, clientX: 340, clientY: 300 })
    const resized = ink()!
    expect(resized.widthMm).toBeGreaterThan(start.widthMm)
    expect(resized.widthMm % 0.5).toBe(0)
    expect(resized).toEqual({ ...start, xMm: start.xMm - 5, yMm: start.yMm - 0.5, widthMm: resized.widthMm, heightMm: resized.widthMm })

    // Its colour flat and tilted away, and the bar's tilt and width
    const hex = (value: string) => screen.getAllByDisplayValue(value).find((input) => input.getAttribute('type') !== 'color')!
    fireEvent.change(hex('#c9a227'), { target: { value: '#aa0000' } })
    fireEvent.change(hex('#2e8b57'), { target: { value: '#0000aa' } })
    await user.click(screen.getByRole('button', { name: 'Side to side' }))
    fireEvent.change(screen.getByTitle('How wide the bright bar is, as a share of the shape the way it rolls').querySelector('input')!, { target: { value: '50' } })
    expect(ink()).toEqual({ ...resized, color: '#aa0000', tiltedColor: '#0000aa', barAxis: 'x', barWidth: 0.5 })

    // Escape ends placing and keeps it selected
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(placing()).toBeNull()
    expect(picked()).toBe('Magnetic ink')

    // Once it has an image it shows on the banknote, under the thread, and drags there as the watermark does: a press
    // picks it, with its box, and a drag moves it in 0.5 mm steps instead of tilting the banknote
    expect(screen.queryByRole('switch', { name: 'Invert' })).toBeNull()
    const demo = useProjects.getState().demoPreview!
    act(() => updateNote(demo.id, demo.notes[0].id, (n) => ({ ...n, magneticInk: { ...n.magneticInk!, imageId: 'fixture-ink' } })))
    const hit = () => document.querySelector('[data-note-body] [data-magnetic-ink]')!
    expect(hit().compareDocumentPosition(document.querySelector('[data-note-body] [data-thread]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const before = ink()!
    const tilt = () => ({ y: useTilt.getState().target, x: useTilt.getState().targetX })
    const tiltBefore = tilt()
    fireEvent.pointerDown(hit(), { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    expect(placing()).not.toBeNull()
    fireEvent.pointerMove(hit(), { buttons: 1, pointerId: 1, clientX: 101, clientY: 101 })
    expect(ink()).toEqual(before)
    fireEvent.pointerMove(hit(), { buttons: 1, pointerId: 1, clientX: 100, clientY: 60 })
    fireEvent.pointerUp(hit(), { button: 0, pointerId: 1, clientX: 100, clientY: 60 })
    const moved = ink()!
    expect(moved.yMm).toBeLessThan(before.yMm)
    expect(moved.yMm % 0.5).toBe(0)
    expect(moved).toEqual({ ...before, yMm: moved.yMm })
    expect(tilt()).toEqual(tiltBefore)
    // A click elsewhere on the banknote ends placing; a click on the ink picks it again without moving it
    fireEvent.pointerDown(document.querySelector('[data-note-body]')!, { button: 0, buttons: 1, pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(document.querySelector('[data-note-body]')!, { button: 0, pointerId: 1, clientX: 5, clientY: 5 })
    expect(placing()).toBeNull()
    fireEvent.pointerDown(hit(), { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(hit(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    expect(placing()).not.toBeNull()
    expect(ink()).toEqual(moved)
    fireEvent.keyDown(window, { key: 'Escape' })

    // Invert puts the ink round the shape instead; switched off, it is left unsaid
    await user.click(screen.getByRole('switch', { name: 'Invert' }))
    expect(ink()).toEqual({ ...moved, invert: true })
    await user.click(screen.getByRole('switch', { name: 'Invert' }))
    expect(ink()).toEqual(moved)
    // Realistic isn't on the tab: it is the toggle beside the lamp, for every banknote, and saves nothing on the ink (here,
    // without WebGL, the ink keeps its flat look)
    expect(screen.queryByRole('switch', { name: 'Realistic' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Realistic' }))
    expect(useRealistic.getState().on).toBe(true)
    expect(ink()).toEqual(moved)
    expect(hit().hasAttribute('data-realistic')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Realistic' }))
    expect(useRealistic.getState().on).toBe(false)
    expect(saves).not.toHaveBeenCalled()
  })

  it('takes the + away once a banknote has every layer, keeps magnetic ink on a copy, and Delete removes it while placing', async () => {
    const user = userEvent.setup()
    localStorage.setItem('of-thread-workspace', 'magnetic-ink-remove-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Demo banknote', exact: true }))
    const notes = () => useProjects.getState().demoPreview!.notes
    await user.click(addFeature())
    await user.click(await screen.findByRole('menuitem', { name: /^Magnetic ink/ }))
    await user.click(addFeature())
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([expect.stringMatching(/^Watermark/), expect.stringMatching(/^Arc-en-Ciel/)])
    await user.click(screen.getByRole('menuitem', { name: /^Watermark/ }))
    await user.click(addFeature())
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([expect.stringMatching(/^Arc-en-Ciel/)])
    await user.click(screen.getByRole('menuitem', { name: /^Arc-en-Ciel/ }))
    expect(screen.queryAllByRole('button', { name: 'Add security feature' })).toHaveLength(0)
    // Listed under the thread in the order they draw
    expect(within(screen.getByRole('list', { name: 'Layers of Demo banknote' })).getAllByRole('listitem').map((row) => row.textContent))
      .toEqual(['Security thread', 'Watermark', 'Arc-en-Ciel', 'Magnetic ink'])
    const original = notes()[0].magneticInk

    await user.click(screen.getByRole('button', { name: 'Duplicate', exact: true }))
    await waitFor(() => expect(notes()).toHaveLength(2))
    expect(notes()[1].magneticInk).toEqual(original)

    // On the copy: picking its ink places it, and Delete removes it, leaving the banknote itself selected and the original alone
    await user.click(screen.getByRole('button', { name: 'Magnetic ink', exact: true }))
    expect(picked()).toBe('Magnetic ink')
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(notes()[1].magneticInk).toBeUndefined()
    expect(notes()[0].magneticInk).toEqual(original)
    expect(picked()).toBe('Demo banknote copy')
    // The + is back, for the ink alone
    await user.click(addFeature())
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([expect.stringMatching(/^Magnetic ink/)])
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Undo', exact: true }))
    expect(notes()[1].magneticInk).toEqual(original)
    // Its row's bin names it
    await user.click(screen.getByRole('button', { name: 'Magnetic ink', exact: true }))
    expect(screen.getAllByRole('button', { name: 'Remove magnetic ink' })).toHaveLength(1)
    expect(saves).not.toHaveBeenCalled()
  })
})
