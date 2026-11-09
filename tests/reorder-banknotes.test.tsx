// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { createNote, createProject } from '../src/lib/notes'
import { useProjects } from '../src/lib/store'
import type { Project } from '../src/lib/types'

const saves = vi.hoisted(() => vi.fn())

vi.mock('../src/cloud/client', () => ({ cloudConfigured: true }))
vi.mock('../src/cloud/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cloud/repository')>()
  return { ...actual, createRepository: () => ({
    list: async () => [],
    save: async (record: import('../src/cloud/sync').CachedProject) => { saves(record); return { project: record.project, revision: record.revision, deleted: record.deleted } },
  }) }
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn(() => true) })
  }
  localStorage.clear()
  location.hash = ''
  saves.mockClear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** Where the list starts on screen, and the gap between its banknotes' blocks (its `gap-0.5`) */
const LIST_TOP = 100
const GAP = 2
/**
 * jsdom lays nothing out, so the Banknotes list is laid out here as the browser does: each banknote's row 36 px tall,
 * an open one's block 26 px taller for each feature row and the Add security feature row under them
 */
function layOutList() {
  const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 224, width: 224, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  // Its own row, then its feature rows and the row adding more
  const height = (block: Element) => 36 + 26 * (block.querySelectorAll('ul li').length + block.querySelectorAll(':scope > div:not(.group)').length)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const list = this.tagName === 'UL' ? this : this.tagName === 'LI' ? this.parentElement : null
    if (!list?.querySelector(':scope > li [data-note-grip]')) return rect(0, 0)
    if (this === list) return rect(LIST_TOP, 400)
    const blocks = [...list.children]
    const before = blocks.slice(0, blocks.indexOf(this))
    return rect(LIST_TOP + before.reduce((sum, block) => sum + height(block) + GAP, 0), height(this))
  })
}

/** A project of three plain banknotes, side by side on the canvas, opened in the editor */
async function openProject() {
  localStorage.setItem('of-thread-workspace', 'reorder-ui-test')
  render(<TooltipProvider><App /></TooltipProvider>)
  await screen.findByRole('button', { name: 'New project', exact: true })
  await waitFor(() => expect(useProjects.getState().loaded).toBe(true))
  const note = (name: string, x: number) => createNote({ name, x, y: 0, widthMm: 150, heightMm: 70, color: '#E5E5E5' })
  const project: Project = { ...createProject('Reorder test'), notes: [note('One', 0), note('Two', 170), note('Three', 340)] }
  act(() => useProjects.getState().add(project))
  act(() => { location.hash = `#/p/${project.id}` })
  await screen.findByRole('button', { name: 'Move One' })
  layOutList()
  return project.id
}

const notesOf = (id: string) => useProjects.getState().projects.find((p) => p.id === id)!.notes
const names = (id: string) => notesOf(id).map((n) => n.name)
const grip = (name: string) => screen.getByRole('button', { name: `Move ${name}` })
/** A banknote's block in the list, which moves as a whole */
const block = (name: string) => grip(name).closest('li')!
const press = (name: string, clientY: number) => fireEvent.pointerDown(grip(name), { button: 0, buttons: 1, clientY, pointerId: 1 })
const drag = (name: string, clientY: number) => fireEvent.pointerMove(grip(name), { buttons: 1, clientY, pointerId: 1 })
const release = (name: string, clientY: number) => fireEvent.pointerUp(grip(name), { button: 0, clientY, pointerId: 1 })

describe('reordering the Banknotes list', () => {
  it('drags a banknote by its grip to another place, the others making room, saved with the project and one undo step', async () => {
    const id = await openProject()
    const placed = Object.fromEntries(notesOf(id).map((n) => [n.id, [n.x, n.y]]))
    // Rows at 100, 138 and 176 px: One taken by its grip in the middle of its row
    press('One', 118)
    drag('One', 135)
    // Not yet halfway to the next place: nothing makes room
    expect(block('One').style.transform).toBe('translateY(17px)')
    expect(block('Two').style.transform).toBe('')
    drag('One', 163)
    expect(block('One').style.transform).toBe('translateY(45px)')
    expect(block('Two').style.transform).toBe('translateY(-38px)')
    expect(block('Three').style.transform).toBe('')
    // Past the list's end it stops at the bottom, the last place
    drag('One', 400)
    expect(block('One').style.transform).toBe('translateY(76px)')
    expect(block('Three').style.transform).toBe('translateY(-38px)')
    // Nothing is saved or changed until it is let go
    expect(names(id)).toEqual(['One', 'Two', 'Three'])
    release('One', 400)
    expect(names(id)).toEqual(['Two', 'Three', 'One'])
    for (const name of ['One', 'Two', 'Three']) expect(block(name).style.transform).toBe('')
    // In that order in the list, and only the order changed: every banknote stays where it was on the canvas
    expect(screen.getAllByRole('button', { name: /^Move / }).map((g) => g.getAttribute('aria-label'))).toEqual(['Move Two', 'Move Three', 'Move One'])
    expect(Object.fromEntries(notesOf(id).map((n) => [n.id, [n.x, n.y]]))).toEqual(placed)
    await waitFor(() => expect(saves.mock.calls.at(-1)?.[0].project.notes.map((n: { name: string }) => n.name)).toEqual(['Two', 'Three', 'One']))

    // One undo step puts it back, and redo moves it again
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(names(id)).toEqual(['One', 'Two', 'Three'])
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(names(id)).toEqual(['Two', 'Three', 'One'])

    // Let go where it began, or a cancelled drag, changes nothing
    press('Three', 156)
    drag('Three', 170)
    release('Three', 156)
    press('Three', 156)
    drag('Three', 100)
    expect(block('Two').style.transform).toBe('translateY(38px)')
    fireEvent.pointerCancel(grip('Three'), { pointerId: 1 })
    expect(names(id)).toEqual(['Two', 'Three', 'One'])
    expect(block('Two').style.transform).toBe('')
  })

  it('moves an open banknote with its features, and moves one a place with the arrow keys on its grip', async () => {
    const id = await openProject()
    // Picked, Two opens to its thread and the Add security feature row: a block 88 px tall, from 138 px down
    fireEvent.click(screen.getByRole('button', { name: 'Two', exact: true }))
    expect(screen.getByRole('list', { name: 'Layers of Two' })).toBeDefined()
    expect(block('Two').getBoundingClientRect().height).toBe(88)
    // Dragged to the top, One makes room for all of it
    press('Two', 156)
    drag('Two', 100)
    expect(block('Two').style.transform).toBe('translateY(-38px)')
    expect(block('One').style.transform).toBe('translateY(90px)')
    release('Two', 100)
    expect(names(id)).toEqual(['Two', 'One', 'Three'])
    // And the short last one taken up past it, to the top
    press('Three', 246)
    drag('Three', 0)
    expect(block('Three').style.transform).toBe('translateY(-128px)')
    expect(block('Two').style.transform).toBe('translateY(38px)')
    release('Three', 0)
    expect(names(id)).toEqual(['Three', 'Two', 'One'])

    // With the grip focused, ↑ and ↓ move it a place, the grip going with it
    grip('One').focus()
    fireEvent.keyDown(grip('One'), { key: 'ArrowUp' })
    expect(names(id)).toEqual(['Three', 'One', 'Two'])
    await waitFor(() => expect(document.activeElement).toBe(grip('One')))
    fireEvent.keyDown(grip('Three'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Two'), { key: 'ArrowDown' })
    expect(names(id)).toEqual(['Three', 'One', 'Two'])
    fireEvent.keyDown(grip('Three'), { key: 'ArrowDown' })
    expect(names(id)).toEqual(['One', 'Three', 'Two'])
  })

  it('shows no grip while there is only one banknote', async () => {
    const id = await openProject()
    act(() => useProjects.getState().update(id, (p) => ({ ...p, notes: p.notes.slice(0, 1) })))
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull()
  })
})
