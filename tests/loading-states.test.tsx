// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import { NoteView } from '../src/components/NoteView'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { createNote, createProject } from '../src/lib/notes'
import { newMagneticInk } from '../src/lib/magneticInk'
import type { CloudProject } from '../src/cloud/sync'
import type { Note } from '../src/lib/types'

vi.mock('../src/cloud/client', () => ({ cloudConfigured: true }))
// The cloud answers for the projects only when a test says so
const cloud = vi.hoisted(() => ({ rows: [] as CloudProject[], answer: undefined as undefined | (() => void) }))
vi.mock('../src/cloud/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cloud/repository')>()
  return {
    ...actual,
    createRepository: () => ({
      list: () => new Promise<CloudProject[]>((resolve) => { cloud.answer = () => resolve(structuredClone(cloud.rows)) }),
      save: async (record: import('../src/cloud/sync').CachedProject) => ({ project: record.project, revision: record.revision, deleted: record.deleted }),
    }),
  }
})
// The demo is made only when a test says so (its artwork is drawn on a canvas, which jsdom lacks)
const demo = vi.hoisted(() => ({ finish: undefined as undefined | (() => void) }))
vi.mock('../src/lib/demo', async () => {
  const { createProject, createNote } = await import('../src/lib/notes')
  return {
    createDemoProject: vi.fn(() => new Promise((resolve) => {
      demo.finish = () => resolve({ ...createProject('Demo fixture'), notes: [createNote({ name: 'Demo banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#123456' })] })
    })),
  }
})
// Artwork named `loading-…` is still on its way, `fixture-…` here, `broken-…` couldn't be had
const imageState = (id?: string) => (id?.startsWith('fixture-') ? `blob:${id}` : id?.startsWith('broken-') ? null : undefined)
vi.mock('../src/lib/images', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/images')>()
  return { ...actual, useImageUrl: (id?: string) => imageState(id), useWarmImages: () => {} }
})
vi.mock('../src/lib/inkMask', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/inkMask')>()
  return {
    ...actual,
    useInkMask: (ink?: { imageId?: string }) => {
      const state = imageState(ink?.imageId)
      return state ? { key: 'fixture', canvas: document.createElement('canvas'), url: 'data:image/png;base64,' } : state
    },
  }
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  localStorage.clear()
  location.hash = ''
  cloud.rows = []
  cloud.answer = undefined
  demo.finish = undefined
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** A workspace of its own each time, so nothing of another test's is cached on this device */
function openApp() {
  localStorage.setItem('of-thread-workspace', `waiting-${crypto.randomUUID().slice(0, 8)}`)
  return render(<TooltipProvider><App /></TooltipProvider>)
}
const answer = async () => {
  await waitFor(() => expect(cloud.answer).toBeDefined())
  await act(async () => cloud.answer?.())
}
const cardSkeletons = () => document.querySelectorAll('[data-card-skeleton]')

describe('loading states', () => {
  it('shows the project cards as skeletons, never a loading line, until the cloud answers for an empty device', async () => {
    openApp()
    await waitFor(() => expect(cardSkeletons().length).toBeGreaterThan(0))
    expect(screen.queryByText('No projects yet')).toBeNull()
    expect(screen.queryByText(/loading/i)).toBeNull()
    expect(screen.queryByText('Saving…')).toBeNull()
    // The page itself works meanwhile
    expect(screen.getByRole('button', { name: 'New project', exact: true })).toBeDefined()
    await answer()
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    expect(cardSkeletons()).toHaveLength(0)
  })

  it('turns the skeletons into the cloud’s projects', async () => {
    const project = createProject('From the cloud')
    project.notes.push(createNote({ name: 'Note', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#E5E5E5' }))
    cloud.rows = [{ project, revision: 'r1', deleted: false }]
    openApp()
    await waitFor(() => expect(cardSkeletons().length).toBeGreaterThan(0))
    await answer()
    await waitFor(() => expect(screen.getByText('From the cloud')).toBeDefined())
    expect(cardSkeletons()).toHaveLength(0)
    expect(screen.getByText('1 banknote')).toBeDefined()
  })

  it('opens a project’s link on the editor’s skeleton until its project comes from the cloud', async () => {
    const project = createProject('Linked project')
    project.notes.push(createNote({ name: 'Linked banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#E5E5E5' }))
    cloud.rows = [{ project, revision: 'r1', deleted: false }]
    location.hash = `#/p/${project.id}`
    openApp()
    await waitFor(() => expect(document.querySelector('[data-editor-skeleton]')).not.toBeNull())
    // Not the project list, as it was: that showed No projects yet before jumping into the project
    expect(screen.queryByText('No projects yet')).toBeNull()
    expect(screen.getByRole('button', { name: 'Projects', exact: true })).toBeDefined()
    await answer()
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Linked project'))
    expect(document.querySelector('[data-editor-skeleton]')).toBeNull()
  })

  it('goes to the project list once the cloud has answered without the link’s project', async () => {
    location.hash = `#/p/${crypto.randomUUID()}`
    openApp()
    await waitFor(() => expect(document.querySelector('[data-editor-skeleton]')).not.toBeNull())
    await answer()
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    expect(document.querySelector('[data-editor-skeleton]')).toBeNull()
  })

  it('opens the demo on the editor’s skeleton while it is made, and not at all if left meanwhile', async () => {
    const user = userEvent.setup()
    openApp()
    await answer()
    await user.click(await screen.findByRole('button', { name: 'Sample project', exact: true }))
    await waitFor(() => expect(document.querySelector('[data-editor-skeleton]')).not.toBeNull())
    expect(location.hash).toBe('#/demo')
    await act(async () => demo.finish?.())
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Demo fixture'))

    await user.click(screen.getByRole('button', { name: 'Exit demo', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Sample project', exact: true }))
    await user.click(await screen.findByRole('button', { name: 'Exit demo', exact: true }))
    await act(async () => demo.finish?.())
    expect(location.hash).toBe('')
    expect(await screen.findByText('No projects yet')).toBeDefined()
  })
})

describe('a banknote whose images are on their way', () => {
  const note = (change: Partial<Note> = {}): Note => ({ ...createNote({ name: 'B', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#E5E5E5' }), ...change })
  const loading = (container: HTMLElement) => container.querySelectorAll('[data-loading]').length

  it('shimmers where its design will show until it comes, and never for a banknote without one or one that couldn’t be had', () => {
    const waiting = render(<NoteView note={note({ background: 'image', faceImageId: 'loading-face' })} scale={1} />)
    expect(loading(waiting.container)).toBe(1)
    expect(waiting.container.querySelector('img')).toBeNull()
    cleanup()
    const shown = render(<NoteView note={note({ background: 'image', faceImageId: 'fixture-face' })} scale={1} />)
    expect(loading(shown.container)).toBe(0)
    expect(shown.container.querySelector('img')?.getAttribute('src')).toBe('blob:fixture-face')
    cleanup()
    expect(loading(render(<NoteView note={note()} scale={1} />).container)).toBe(0)
    cleanup()
    expect(loading(render(<NoteView note={note({ background: 'image', faceImageId: 'broken-face' })} scale={1} />).container)).toBe(0)
  })

  it('shimmers along its thread while a frame’s image comes, and in magnetic ink’s box while its shape does', () => {
    const plain = note()
    const frames = plain.frames.map((frame) => ({ ...frame, kind: 'image' as const, imageId: 'loading-frame', aspect: 0.5 }))
    const thread = render(<NoteView note={{ ...plain, frames }} scale={1} />)
    expect(thread.container.querySelector('[data-thread] [data-loading]')).not.toBeNull()
    cleanup()
    const inked = { ...plain, magneticInk: { ...newMagneticInk(plain), imageId: 'loading-ink' } }
    const ink = render(<NoteView note={inked} scale={1} />)
    expect(loading(ink.container)).toBe(1)
    expect(ink.container.querySelector('[data-magnetic-ink]')).toBeNull()
    cleanup()
    const ready = render(<NoteView note={{ ...inked, magneticInk: { ...inked.magneticInk, imageId: 'fixture-ink' } }} scale={1} />)
    expect(loading(ready.container)).toBe(0)
    expect(ready.container.querySelector('[data-magnetic-ink]')).not.toBeNull()
  })
})
