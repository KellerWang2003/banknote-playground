// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import { DemoButton } from '../src/app/DemoButton'
import { DemoView } from '../src/app/DemoView'
import { PhoneLink } from '../src/app/PhoneLink'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { demoLink, forPhone, readDemoLink } from '../src/lib/demoLink'
import { createNote, createProject } from '../src/lib/notes'
import { CARD_MM, guessPxPerMm, isChecked, realPxPerMm, screenKey, setRealPxPerMm, useRealSize, type Device } from '../src/lib/realSize'
import { useProjects } from '../src/lib/store'
import type { Project } from '../src/lib/types'
import { setTilt, useTilt } from '../src/tilt/tilt'

const cloud = vi.hoisted(() => ({ rows: [] as unknown[], fail: undefined as Error | undefined, calls: 0 }))
vi.mock('../src/cloud/client', () => ({
  cloudConfigured: true,
  WorkspaceApiError: class extends Error {},
  // The phone's page reads its project with `get`, one row after another as the laptop saves
  workspaceJson: vi.fn(async (_workspace: string, action: string) => {
    if (action !== 'get') throw new Error(`unexpected ${action}`)
    cloud.calls++
    if (cloud.fail) throw cloud.fail
    return cloud.rows.length > 1 ? cloud.rows.shift() : cloud.rows[0] ?? null
  }),
  fetchArtwork: vi.fn(async () => new Blob()),
  uploadArtwork: vi.fn(async () => {}),
}))
vi.mock('../src/cloud/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cloud/repository')>()
  return { ...actual, createRepository: () => ({
    list: async () => [],
    save: async (record: import('../src/cloud/sync').CachedProject) => ({ project: record.project, revision: record.revision, deleted: record.deleted }),
  }) }
})

// The sample project's artwork is drawn on a canvas, which jsdom lacks: it opens one plain banknote instead
vi.mock('../src/lib/demo', async () => {
  const { createProject, createNote } = await import('../src/lib/notes')
  return { createDemoProject: vi.fn(async () => ({
    ...createProject('Sample fixture'),
    notes: [createNote({ name: 'Sample banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#123456' })],
  })) }
})

/** jsdom lays nothing out: Demo, the canvas and everything measured are a 1280 × 800 window, the bar 44 px tall, Hide UI 40 */
const WINDOW = { width: 1280, height: 800 }
class SizedObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(element: Element) {
    const size = element.hasAttribute('data-demo-bar') ? { width: 600, height: 44 } : element.hasAttribute('data-demo-hide') ? { width: 110, height: 40 } : WINDOW
    this.callback([{ contentRect: size } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', SizedObserver)
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
  }
  localStorage.clear()
  useRealSize.setState({ checked: {} })
  location.hash = ''
  cloud.rows = []
  cloud.fail = undefined
  cloud.calls = 0
  setTilt({ source: 'drag', angle: 0, target: 0, angleX: 0, targetX: 0, nudge: 0, nudgeX: 0, nudged: 0, nudgedX: 0, flipped: false, turn: 0, quarterTurns: 0,
    backlit: false, peek: false })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.documentElement.classList.remove('dark')
})

const note = (name: string, x = 0) => createNote({ name, x, y: 0, widthMm: 150, heightMm: 70, color: '#E5E5E5' })
const sample = (): Project => ({ ...createProject('Demo test'), notes: [note('One'), note('Two', 170), note('Three', 340)] })
const demo = () => screen.getByRole('dialog', { name: 'Demo' })
const shownNote = () => document.querySelector('[data-demo-note]')?.getAttribute('data-demo-note')
const stage = () => document.querySelector('[data-demo-view]') as HTMLElement

/** A project opened in the editor on the laptop, as `reorder-banknotes` does */
async function openProject(project = sample()) {
  localStorage.setItem('of-thread-workspace', 'demo-ui-test')
  render(<TooltipProvider><App /></TooltipProvider>)
  await screen.findByRole('button', { name: 'New project', exact: true })
  await waitFor(() => expect(useProjects.getState().loaded).toBe(true))
  act(() => useProjects.getState().add(project))
  act(() => { location.hash = `#/p/${project.id}` })
  await screen.findByRole('button', { name: 'Move One' })
  return project
}

/** ▶ in the corner bar, then Demo on this screen in the panel it opens, under the QR code */
async function openDemoHere(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(document.querySelector('[data-corner-bar]') as HTMLElement).getByRole('button', { name: 'Demo' }))
  await user.click(await screen.findByRole('button', { name: 'Demo on this screen' }))
}

describe('Demo on the laptop', () => {
  it('opens from ▶ left of Export, the QR code first and Demo on this screen under it, on the banknote picked, over the editor, black and dark, and leaves with Esc', async () => {
    const user = userEvent.setup()
    const fullScreen = vi.fn(async () => {})
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: fullScreen })
    const project = await openProject()
    const bar = document.querySelector('[data-corner-bar]') as HTMLElement
    const play = within(bar).getByRole('button', { name: 'Demo' })
    const exportButton = within(bar).getByRole('button', { name: 'Export' })
    // An outline button, its icon alone, left of Export
    expect(play.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(play.textContent).toBe('')
    // Two picked in the Banknotes list, so the + under it shows
    await user.click(screen.getByRole('button', { name: 'Two', exact: true }))
    expect(document.querySelector('[data-add-feature]')).not.toBeNull()

    // ▶ shows the banknote picked as a QR code for a phone first, then Copy link, and Demo on this screen under them
    // (Keller, 12 November), with nothing full screen yet; the link carries the username, the project and the banknote
    await user.click(play)
    const qr = await screen.findByRole('img', { name: 'QR code for the link' })
    const panel = qr.closest('[data-demo-panel]') as HTMLElement
    const copy = within(panel).getByRole('button', { name: 'Copy link' })
    const here = within(panel).getByRole('button', { name: 'Demo on this screen' })
    expect(qr.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(copy.compareDocumentPosition(here) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(fullScreen).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Demo' })).toBeNull()
    await user.click(copy)
    expect(await navigator.clipboard.readText()).toBe(demoLink('demo-ui-test', project.id, project.notes[1].id))
    expect(await within(panel).findByRole('button', { name: 'Copied' })).toBeDefined()
    // Esc closes only the panel, Two still picked
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('img', { name: 'QR code for the link' })).toBeNull())
    expect(document.querySelector('[data-add-feature]')).not.toBeNull()

    await user.click(play)
    await user.click(await screen.findByRole('button', { name: 'Demo on this screen' }))
    expect(fullScreen).toHaveBeenCalledOnce()
    expect(demo().className).toContain('bg-black')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(shownNote()).toBe(project.notes[1].id)
    // The canvas stays, its banknotes and corner bar not drawn twice, nor the + under the banknote picked (Demo doesn't
    // trap Tab, so a Shift+Tab from its bar could reach it), and the editor's panels make way
    expect(document.querySelectorAll('[data-note-body]')).toHaveLength(0)
    expect(document.querySelector('[data-corner-bar]')).toBeNull()
    expect(document.querySelector('[data-add-feature]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move One' })).toBeNull()
    // The banknote fills the screen less a 16 px margin and the bar, 12 px clear of it: 1248 px wide is the limit
    const box = document.querySelector('[data-demo-note]') as HTMLElement
    expect(parseFloat(box.style.width)).toBeCloseTo(1248)
    // Its link for a phone carries the username, the project and the banknote
    await user.click(screen.getByRole('button', { name: 'Open on your phone' }))
    expect(await screen.findByRole('img', { name: 'QR code for the link' })).toBeDefined()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('img', { name: 'QR code for the link' })).toBeNull())
    // That Esc only closed the popup; the next leaves Demo
    expect(demo()).toBeDefined()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Demo' })).toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.querySelectorAll('[data-note-body]')).toHaveLength(3)
  })

  it('leaves full screen first: Esc there is the browser’s, and ✕ leaves both', async () => {
    const user = userEvent.setup()
    const exit = vi.fn(async () => {})
    let full: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: vi.fn(async () => { full = document.documentElement }) })
    await openProject()
    await openDemoHere(user)
    await user.keyboard('{Escape}')
    expect(demo()).toBeDefined()
    await user.click(within(demo()).getByRole('button', { name: 'Close Demo (Esc)' }))
    expect(screen.queryByRole('dialog', { name: 'Demo' })).toBeNull()
    expect(exit).toHaveBeenCalledOnce()
  })

  it('steps through the banknotes with ← and → or the picker, hides the UI with H and brings it back with a double-click', async () => {
    const user = userEvent.setup()
    const project = await openProject()
    await openDemoHere(user)
    expect(shownNote()).toBe(project.notes[0].id)
    await user.keyboard('{ArrowRight}')
    expect(shownNote()).toBe(project.notes[1].id)
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(shownNote()).toBe(project.notes[2].id)
    await user.click(screen.getByRole('combobox', { name: 'Banknote' }))
    await user.click(await screen.findByRole('option', { name: 'Two' }))
    expect(shownNote()).toBe(project.notes[1].id)

    const bar = document.querySelector('[data-demo-bar]') as HTMLElement
    await user.keyboard('h')
    expect(bar.className).toContain('invisible')
    // Only the banknote: it grows into the room the bar left, to the margin
    expect(parseFloat((document.querySelector('[data-demo-note]') as HTMLElement).style.width)).toBeCloseTo(1248)
    fireEvent.doubleClick(stage())
    expect(bar.className).not.toContain('invisible')
    // F turns it over, as on the canvas
    await user.keyboard('f')
    expect(useTilt.getState().flipped).toBe(true)
  })

  it('turns over with Flip, hides the UI from a button of its own at the top centre, saying for 2 s how to bring it back, and keeps the lamp and Realistic in ⋯, the lamp off as it opens', async () => {
    const user = userEvent.setup()
    await openProject()
    // The editor's lamp left on: Demo opens without it, and leaving gives it back
    act(() => setTilt({ backlit: true }))
    await openDemoHere(user)
    expect(useTilt.getState().backlit).toBe(false)
    const bar = document.querySelector('[data-demo-bar]') as HTMLElement
    const hide = document.querySelector('[data-demo-hide]') as HTMLElement

    // One Flip, not Front | Back (Keller, 11 November)
    expect(within(bar).queryByRole('button', { name: 'Front', exact: true })).toBeNull()
    expect(within(bar).queryByRole('button', { name: 'Back', exact: true })).toBeNull()
    await user.click(within(bar).getByRole('button', { name: 'Flip' }))
    expect(useTilt.getState().flipped).toBe(true)
    await user.click(within(bar).getByRole('button', { name: 'Flip' }))
    expect(useTilt.getState().flipped).toBe(false)

    // The lamp and Realistic aren't in the bar but its ⋯ menu, ticked while on: Realistic on, as it starts, the lamp off
    expect(within(bar).queryByRole('button', { name: /Hold up to the light/ })).toBeNull()
    expect(within(bar).queryByRole('button', { name: 'Realistic' })).toBeNull()
    await user.click(within(bar).getByRole('button', { name: 'More' }))
    const menu = await screen.findByRole('menu')
    const lamp = within(menu).getByRole('menuitemcheckbox', { name: /Hold up to the light/ })
    expect(lamp.getAttribute('aria-checked')).toBe('false')
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Realistic' }).getAttribute('aria-checked')).toBe('true')
    await user.click(lamp)
    expect(useTilt.getState().backlit).toBe(true)
    // Esc closes the menu, not Demo, and the keys are Demo's again: L switches the lamp off
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(demo()).toBeDefined()
    await user.keyboard('l')
    expect(useTilt.getState().backlit).toBe(false)

    // Hide UI is a button of its own, in words at the top centre, apart from the bar it hides, and hides with it (Keller,
    // 12 November)
    const hideButton = within(hide).getByRole('button', { name: 'Hide UI' })
    expect(hideButton.textContent).toBe('Hide UI')
    expect(hide.className).toContain('left-1/2')
    expect(hide.style.right).toBe('')
    expect(bar.contains(hideButton)).toBe(false)
    expect(screen.queryByRole('status')).toBeNull()
    vi.useFakeTimers()
    fireEvent.click(hideButton)
    expect(bar.className).toContain('invisible')
    expect(hide.className).toContain('invisible')
    // For 2 s it says how to bring the UI back, then fades out
    const hint = screen.getByRole('status')
    expect(hint.textContent).toContain('Double-click to bring back the UI')
    expect(hint.textContent).toContain('Double-tap to bring back the UI')
    act(() => { vi.advanceTimersByTime(1900) })
    expect(hint.className).not.toContain('opacity-0')
    act(() => { vi.advanceTimersByTime(200) })
    expect(hint.className).toContain('opacity-0')
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.doubleClick(stage())
    expect(bar.className).not.toContain('invisible')
    expect(hide.className).not.toContain('invisible')
    // H hides it too, saying so, and the UI coming back takes the words away at once
    fireEvent.keyDown(window, { key: 'h' })
    expect(bar.className).toContain('invisible')
    expect(screen.getByRole('status')).toBeDefined()
    fireEvent.keyDown(window, { key: 'h' })
    expect(bar.className).not.toContain('invisible')
    expect(screen.queryByRole('status')).toBeNull()
    vi.useRealTimers()

    await user.click(within(bar).getByRole('button', { name: 'Close Demo (Esc)' }))
    expect(useTilt.getState().backlit).toBe(true)
  })

  it('tilts as the pointer drags, the way it goes on the banknote, springing back to flat', async () => {
    await openProject()
    await openDemoHere(userEvent.setup())
    const view = demo()
    fireEvent.pointerDown(view, { button: 0, buttons: 1, clientX: 600, clientY: 400, pointerId: 1, pointerType: 'mouse' })
    // 80 px up and 160 px right: 15° up, 30° right
    fireEvent.pointerMove(view, { buttons: 1, clientX: 760, clientY: 320, pointerId: 1, pointerType: 'mouse' })
    expect(useTilt.getState()).toMatchObject({ source: 'drag', target: 15, targetX: 30 })
    fireEvent.pointerUp(view, { clientX: 760, clientY: 320, pointerId: 1, pointerType: 'mouse' })
    expect(useTilt.getState()).toMatchObject({ target: 0, targetX: 0 })
  })

  it('keeps the banknote clear of Hide UI above as of the bar below, taking their room back once they hide', () => {
    renderDemo({ ...createProject('Tall'), notes: [createNote({ name: 'Tall', x: 0, y: 0, widthMm: 70, heightMm: 150, color: '#E5E5E5' })] })
    const box = document.querySelector('[data-demo-note]') as HTMLElement
    // 12 px clear of Hide UI, 40 px tall 12 px from the top, and of the bar, 44 px tall 12 px from the bottom
    expect(parseFloat(box.style.top)).toBeCloseTo(64)
    expect(parseFloat(box.style.top) + parseFloat(box.style.height)).toBeCloseTo(732)
    fireEvent.keyDown(window, { key: 'h' })
    expect(parseFloat(box.style.top)).toBeCloseTo(16)
    expect(parseFloat(box.style.height)).toBeCloseTo(768)
  })
})

describe('Demo of the sample project', () => {
  it('opens here straight away from ▶, as no phone can read the sample project, and has no phone button', async () => {
    const user = userEvent.setup()
    const fullScreen = vi.fn(async () => {})
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: fullScreen })
    localStorage.setItem('of-thread-workspace', 'demo-ui-test')
    render(<TooltipProvider><App /></TooltipProvider>)
    await user.click(await screen.findByRole('button', { name: 'Sample project', exact: true }))
    const bar = await waitFor(() => {
      const found = document.querySelector('[data-corner-bar]')
      if (!(found instanceof HTMLElement)) throw new Error('no corner bar yet')
      return found
    })
    await user.click(within(bar).getByRole('button', { name: 'Demo' }))
    expect(fullScreen).toHaveBeenCalledOnce()
    expect(demo()).toBeDefined()
    expect(screen.queryByRole('img', { name: 'QR code for the link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open on your phone' })).toBeNull()
  })
})

/** The phone's sensor, as the browser sends it */
/** Demo's ⋯ menu, open: the phone's tilt and Recentre, the lamp, Realistic and Real size's check live there */
async function openMenu() {
  await userEvent.setup().click(screen.getByRole('button', { name: 'More' }))
  return screen.findByRole('menu')
}
const motionOn = () => waitFor(() => expect(useTilt.getState().source).toBe('device'))

const orient = (alpha: number, beta: number, gamma: number) =>
  act(() => { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha, beta, gamma })) })

function renderDemo(project = sample(), noteId = project.notes[0].id) {
  const onPick = vi.fn()
  render(<TooltipProvider><DemoView project={project} noteId={noteId} onPick={onPick} /></TooltipProvider>)
  return { project, onPick }
}

describe('Demo on a phone', () => {
  it('takes the phone’s tilt from how it was held as it started, 1:1, drawing the banknote flat', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    renderDemo()
    // Held tipped back 60°: that is flat
    orient(0, 60, 0)
    await motionOn()
    expect(useTilt.getState().target).toBeCloseTo(0, 9)
    expect(useTilt.getState().targetX).toBeCloseTo(0, 9)
    // Its right edge turned 20° away: 20° right, once the filter has settled
    for (let i = 0; i < 20; i++) {
      now += 100
      orient(0, 60, 20)
    }
    expect(useTilt.getState().targetX).toBeCloseTo(20, 1)
    expect(useTilt.getState().target).toBeCloseTo(0, 1)
    // Flat on the screen: only turning over would turn it, and the room's light, not the canvas's shade, falls on it
    act(() => setTilt({ angle: 25, angleX: 20 }))
    const banknote = document.querySelector('[data-demo-note] .shadow-note') as HTMLElement
    expect(banknote.style.transform).toBe('')
    expect(banknote.querySelectorAll('[data-tilt^="shade"]')).toHaveLength(0)

    // No switch for it in ⋯, as it is always on (Keller, 12 November), and Recentre there makes how it is held now flat,
    // gliding there
    const menu = await openMenu()
    expect(within(menu).queryByRole('menuitemcheckbox', { name: 'Tilt' })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Recentre' }))
    now += 100
    orient(0, 60, 20)
    expect(useTilt.getState().targetX).toBeCloseTo(20, 1)
    for (let i = 0; i < 5; i++) {
      now += 100
      orient(0, 60, 20)
    }
    expect(useTilt.getState().targetX).toBeCloseTo(0, 1)
  })

  it('turns the banknote further in the hand as a finger drags on top of the phone’s tilt, springing back, and holds it to the light while pressed', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { onPick } = renderDemo()
    orient(0, 60, 0)
    await motionOn()
    const view = demo()
    // Both at once (Keller, 12 November: "it shouldn't be two modes"): 80 px up and 160 px left turn it 15° up and 30°
    // left in the hand, the phone's own tilt still the tilt store's
    fireEvent.pointerDown(view, { clientX: 700, clientY: 400, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerMove(view, { clientX: 540, clientY: 320, pointerId: 1, pointerType: 'touch' })
    expect(useTilt.getState()).toMatchObject({ source: 'device', nudge: 15, nudgeX: -30 })
    // The phone still tilts it meanwhile
    now += 100
    orient(0, 60, 20)
    expect(useTilt.getState().targetX).toBeGreaterThan(1)
    // Let go, it springs back to the phone's tilt; no swipe through the banknotes, as a drag tilts
    fireEvent.pointerUp(view, { clientX: 540, clientY: 320, pointerId: 1, pointerType: 'touch' })
    expect(useTilt.getState()).toMatchObject({ source: 'device', nudge: 0, nudgeX: 0 })
    expect(onPick).not.toHaveBeenCalled()
    // Drawn flat, it turns on the screen only as far as the drag turned it in the hand
    const banknote = document.querySelector('[data-demo-note] .shadow-note') as HTMLElement
    act(() => setTilt({ angle: 35, angleX: -10, nudged: 15, nudgedX: -30 }))
    expect(banknote.style.transform).toBe('rotateX(15deg) rotateY(-30deg)')
    act(() => setTilt({ angle: 20, angleX: 20, nudged: 0, nudgedX: 0 }))
    expect(banknote.style.transform).toBe('')

    vi.useFakeTimers()
    fireEvent.pointerDown(view, { clientX: 600, clientY: 400, pointerId: 2, pointerType: 'touch' })
    act(() => { vi.advanceTimersByTime(400) })
    expect(useTilt.getState().peek).toBe(true)
    fireEvent.pointerUp(view, { clientX: 600, clientY: 400, pointerId: 2, pointerType: 'touch' })
    expect(useTilt.getState()).toMatchObject({ peek: false, backlit: false })
  })

  it('turns the view a quarter for a phone held sideways with rotation locked', async () => {
    renderDemo()
    // On its side with its top to the left, the page still portrait: the room's up is the page's right
    orient(0, 0, -90)
    await waitFor(() => expect(stage().style.transform).toBe('rotate(90deg)'))
    expect(stage().style.width).toBe(`${WINDOW.height}px`)
  })

  it('asks iPhone for motion as Demo opens, with a button in the middle that asks, as a tap anywhere does, and says in ⋯ when it is refused', async () => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    // Asked without a tap, Safari says it needs one rather than asking
    const noTap = async (): Promise<'granted' | 'denied'> => {
      throw new DOMException('Requesting device orientation or motion access requires a user gesture to prompt', 'NotAllowedError')
    }
    const ask = vi.fn(noTap)
    Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { configurable: true, value: ask })
    try {
      renderDemo()
      // Asked as it opens (Keller, 12 November: "it should ask for permission immediately"): never asked before, a button
      // in the middle asks, and no switch for it in ⋯
      const button = await screen.findByRole('button', { name: 'Tilt with your phone' })
      expect(ask).toHaveBeenCalledOnce()
      expect(button.closest('[data-demo-bar]')).toBeNull()
      // Its tap asks, once, though a tap anywhere asks too; allowed, the phone tilts it and the button goes
      ask.mockResolvedValueOnce('granted')
      await userEvent.setup().click(button)
      expect(ask).toHaveBeenCalledTimes(2)
      orient(0, 45, 0)
      await motionOn()
      expect(screen.queryByRole('button', { name: 'Tilt with your phone' })).toBeNull()
      const menu = await openMenu()
      expect(within(menu).queryByRole('menuitemcheckbox', { name: 'Tilt' })).toBeNull()
      expect(within(menu).getByRole('menuitem', { name: 'Recentre' })).toBeDefined()
      cleanup()

      // The first tap anywhere asks, here on the banknote: refused, it says so in ⋯
      ask.mockClear()
      renderDemo()
      await screen.findByRole('button', { name: 'Tilt with your phone' })
      ask.mockResolvedValueOnce('denied')
      fireEvent.click(stage())
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Tilt with your phone' })).toBeNull())
      expect(ask).toHaveBeenCalledTimes(2)
      const refused = within(await openMenu()).getByRole('menuitem', { name: 'Motion not allowed' })
      expect(refused.getAttribute('aria-disabled')).toBe('true')
      await userEvent.setup().keyboard('{Escape}')
      // Dragging stands in, the banknote turning in 3D, with the canvas's light and shade
      const view = demo()
      fireEvent.pointerDown(view, { clientX: 600, clientY: 400, pointerId: 1, pointerType: 'touch' })
      fireEvent.pointerMove(view, { clientX: 600, clientY: 320, pointerId: 1, pointerType: 'touch' })
      expect(useTilt.getState()).toMatchObject({ source: 'drag', target: 15 })
      expect(document.querySelectorAll('[data-demo-note] [data-tilt^="shade"]')).toHaveLength(4)
    } finally {
      delete (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission
      delete (navigator as unknown as { maxTouchPoints?: unknown }).maxTouchPoints
    }
  })

  it('tilts at once where Safari was already asked while open, without a tap or the button', async () => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    const ask = vi.fn(async () => 'granted' as const)
    Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { configurable: true, value: ask })
    try {
      renderDemo()
      await waitFor(() => expect(ask).toHaveBeenCalledOnce())
      orient(0, 45, 0)
      await motionOn()
      expect(screen.queryByRole('button', { name: 'Tilt with your phone' })).toBeNull()
    } finally {
      delete (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission
      delete (navigator as unknown as { maxTouchPoints?: unknown }).maxTouchPoints
    }
  })
})

describe('real size', () => {
  const device = (userAgent: string, dpr = 2, touchPoints = 0, width = 1470, height = 956): Device =>
    ({ userAgent, dpr, touchPoints, screen: { width, height } })
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'

  it('guesses CSS px per mm from the device until it is checked', () => {
    expect(guessPxPerMm(device(IPHONE, 3, 5, 393, 852))).toBe(6.04)
    expect(guessPxPerMm(device(IPHONE, 2, 5, 375, 667))).toBe(6.42)
    // An iPad says it is a Mac, but takes touch
    expect(guessPxPerMm(device(MAC, 2, 5, 820, 1180))).toBe(5.2)
    expect(guessPxPerMm(device(MAC, 2, 0, 1470, 956))).toBe(5.08)
    expect(guessPxPerMm(device(MAC, 2, 0, 2560, 1440))).toBe(5)
    expect(guessPxPerMm(device('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 2.6, 5, 412, 915))).toBeCloseTo(6.3, 2)
    expect(guessPxPerMm(device('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 1, 0, 1920, 1080))).toBeCloseTo(96 / 25.4)
  })

  it('keeps a check per screen, whichever way round, as device pixels so zooming keeps it', () => {
    expect(screenKey({ width: 393, height: 852 })).toBe(screenKey({ width: 852, height: 393 }))
    const laptop = device(MAC, 2)
    setRealPxPerMm(5.5, laptop)
    expect(isChecked(undefined, laptop)).toBe(true)
    expect(realPxPerMm(undefined, laptop)).toBeCloseTo(5.5)
    // Zoomed to 110%, a CSS px is bigger: fewer make a mm
    expect(realPxPerMm(undefined, { ...laptop, dpr: 2.2 })).toBeCloseTo(5)
    // Another screen keeps its own guess
    const external = device(MAC, 1, 0, 2560, 1440)
    expect(isChecked(undefined, external)).toBe(false)
    expect(realPxPerMm(undefined, external)).toBe(5)
    expect(JSON.parse(localStorage.getItem('of-playground.real-size')!)).toEqual({ '1470x956': 11 })
  })

  it('opens the card check the first time Real size is picked, and draws the banknote at the size kept', async () => {
    const user = userEvent.setup()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'Real size' }))
    const check = document.querySelector('[data-card-check]') as HTMLElement
    const outline = check.querySelector('[data-card-outline]') as HTMLElement
    const guess = realPxPerMm()
    expect(parseFloat(outline.style.width)).toBeCloseTo(CARD_MM.width * guess)
    // Bigger, then kept for this screen
    await user.click(within(check).getByRole('button', { name: 'Bigger' }))
    await user.click(within(check).getByRole('button', { name: 'Done' }))
    expect(document.querySelector('[data-card-check]')).toBeNull()
    expect(isChecked()).toBe(true)
    expect(realPxPerMm()).toBeCloseTo(guess * 1.005)
    expect(parseFloat((document.querySelector('[data-demo-note]') as HTMLElement).style.width)).toBeCloseTo(150 * guess * 1.005)
    // Checked once: Real size again doesn't ask, but ⋯ has it checked again, only with Real size picked
    await user.click(screen.getByRole('button', { name: 'Fit' }))
    expect(within(await openMenu()).queryByRole('menuitem', { name: 'Check real size' })).toBeNull()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Real size' }))
    expect(document.querySelector('[data-card-check]')).toBeNull()
    await user.click(within(await openMenu()).getByRole('menuitem', { name: 'Check real size' }))
    expect(document.querySelector('[data-card-check]')).not.toBeNull()
  })
})

describe('Demo links and the phone’s page', () => {
  it('carries the username, the project and the banknote', () => {
    const link = demoLink('keller', 'p-1', 'n 2')
    expect(link).toBe(`${location.origin}${location.pathname}#/play/keller/p-1/n%202`)
    expect(readDemoLink(new URL(link).hash)).toEqual({ workspace: 'keller', projectId: 'p-1', noteId: 'n 2' })
    expect(readDemoLink('#/play/keller/p-1')).toEqual({ workspace: 'keller', projectId: 'p-1', noteId: undefined })
    expect(readDemoLink('#/demo')).toBeUndefined()
    expect(readDemoLink('#/p/p-1')).toBeUndefined()
    expect(readDemoLink('#/play/keller')).toBeUndefined()
  })

  it('goes through the dev server’s door for phones from a page on plain http, and as it is anywhere else', () => {
    const local = 'http://localhost:5174/#/play/keller/p-1/n%202'
    expect(forPhone(local, 'https://192.168.1.23:6174', 'http:')).toBe('https://192.168.1.23:6174/#/play/keller/p-1/n%202')
    expect(forPhone(local, undefined, 'http:')).toBe(local)
    const live = 'https://banknote-playground.vercel.app/#/play/keller/p-1'
    expect(forPhone(live, 'https://192.168.1.23:6174', 'https:')).toBe(live)
  })

  it('puts the dev server’s door on the Wi-Fi in the QR code and Copy link, as a phone can’t open localhost', async () => {
    const user = userEvent.setup()
    const asked = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ origin: 'https://192.168.1.23:6174' }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', asked)
    render(<TooltipProvider><PhoneLink link="http://localhost:3000/#/play/keller/p-1/n-2" /></TooltipProvider>)
    await waitFor(() => expect(asked).toHaveBeenCalledWith('/__phone-address', expect.anything()))
    await user.click(screen.getByRole('button', { name: 'Open on your phone' }))
    await user.click(await screen.findByRole('button', { name: 'Copy link' }))
    expect(await navigator.clipboard.readText()).toBe('https://192.168.1.23:6174/#/play/keller/p-1/n-2')
  })

  it('puts the door in ▶’s panel too, its QR code and Copy link', async () => {
    const user = userEvent.setup()
    const asked = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ origin: 'https://192.168.1.23:6174' }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', asked)
    render(<TooltipProvider><DemoButton link="http://localhost:3000/#/play/keller/p-1/n-2" onOpen={vi.fn()} /></TooltipProvider>)
    await waitFor(() => expect(asked).toHaveBeenCalledWith('/__phone-address', expect.anything()))
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    await user.click(await screen.findByRole('button', { name: 'Copy link' }))
    expect(await navigator.clipboard.readText()).toBe('https://192.168.1.23:6174/#/play/keller/p-1/n-2')
  })

  it('keeps its own link where the dev server says of no door', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })))
    render(<TooltipProvider><PhoneLink link="http://localhost:3000/#/play/keller/p-1/n-2" /></TooltipProvider>)
    await user.click(screen.getByRole('button', { name: 'Open on your phone' }))
    await user.click(await screen.findByRole('button', { name: 'Copy link' }))
    expect(await navigator.clipboard.readText()).toBe('http://localhost:3000/#/play/keller/p-1/n-2')
  })

  it('opens ahead of the username screen, reads the project, and picks up the laptop’s edits every 3 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const project = sample()
    const renamed = { ...project, notes: project.notes.map((n, i) => (i === 1 ? { ...n, name: 'Two, renamed' } : n)) }
    cloud.rows = [{ data: project, revision: 'r1', deleted_at: null }, { data: project, revision: 'r1', deleted_at: null }, { data: renamed, revision: 'r2', deleted_at: null }]
    location.hash = `#/play/keller/${project.id}/${project.notes[1].id}`
    render(<TooltipProvider><App /></TooltipProvider>)
    // No workspace on this phone: the link is enough
    expect(screen.queryByPlaceholderText(/username/i)).toBeNull()
    expect(document.querySelector('[data-demo-skeleton]')).not.toBeNull()
    await screen.findByRole('dialog', { name: 'Demo' })
    expect(shownNote()).toBe(project.notes[1].id)
    expect(screen.getByRole('combobox', { name: 'Banknote' }).textContent).toContain('Two')
    // The same revision changes nothing; the next one swaps in, the banknote shown staying
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(cloud.calls).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Banknote' }).textContent).toContain('Two, renamed'))
    expect(shownNote()).toBe(project.notes[1].id)
    // Picking another keeps the address up to date, without a page in the history
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }) })
    expect(location.hash).toBe(`#/play/keller/${project.id}/${project.notes[2].id}`)
  })

  it('says in words when the project can’t be read, with Retry', async () => {
    const project = sample()
    cloud.fail = new Error('Couldn’t reach the workspace. Please retry.')
    location.hash = `#/play/keller/${project.id}`
    render(<TooltipProvider><App /></TooltipProvider>)
    expect(await screen.findByText('Couldn’t reach the workspace. Please retry.')).toBeDefined()
    cloud.fail = undefined
    cloud.rows = [{ data: project, revision: 'r1', deleted_at: null }]
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('dialog', { name: 'Demo' })
    expect(shownNote()).toBe(project.notes[0].id)
  })

  it('opens projects in Demo from the list on a phone, the tap asking iPhone for motion as it opens', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', media: query, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('screen', { width: 390, height: 844 })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    const ask = vi.fn(async () => 'granted' as const)
    Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { configurable: true, value: ask })
    try {
      localStorage.setItem('of-thread-workspace', 'demo-phone-list')
      render(<TooltipProvider><App /></TooltipProvider>)
      await waitFor(() => expect(useProjects.getState().loaded).toBe(true))
      const project = { ...sample(), name: 'Opened on a phone' }
      act(() => useProjects.getState().add(project))
      fireEvent.click(await screen.findByText('Opened on a phone'))
      expect(location.hash).toBe(`#/play/demo-phone-list/${project.id}`)
      // Asked from the tap itself, as Safari asks only from one
      expect(ask).toHaveBeenCalledOnce()
    } finally {
      delete (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission
      delete (navigator as unknown as { maxTouchPoints?: unknown }).maxTouchPoints
    }
  })
})
