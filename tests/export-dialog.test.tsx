// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog } from '../src/editor/ExportDialog'
import { createNote, createProject } from '../src/lib/notes'
import type { Note, Project } from '../src/lib/types'
import { setTilt } from '../src/tilt/tilt'

// The encoders aren't run here: what the dialog asks them for is noted
const media = vi.hoisted(() => ({
  exportImages: vi.fn(async (..._args: unknown[]) => ({ name: 'image.png', blob: new Blob() })),
  exportTilt: vi.fn(async (..._args: unknown[]) => ({ name: 'video.mp4', blob: new Blob() })),
  downloadFile: vi.fn(),
}))
vi.mock('../src/lib/exportMedia', () => media)
// jsdom can't load an image: a design reads as Keller's FIFTEEN, 2720 × 5360 px
const artworkSize = vi.hoisted(() => vi.fn(async (_id: string) => ({ width: 2720, height: 5360 })))
vi.mock('../src/lib/exportRender', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/exportRender')>()), artworkSize }))

afterEach(() => {
  cleanup()
  setTilt({ source: 'drag', angle: 0, angleX: 0, target: 0, targetX: 0, quarterTurns: 0, flipped: false })
})

const banknote = (name: string, widthMm: number, heightMm: number, design?: string): Note => ({
  ...createNote({ name, x: 0, y: 0, widthMm, heightMm, color: '#ffffff' }),
  ...(design ? { background: 'image' as const, faceImageId: design } : {}),
})
const projectOf = (...notes: Note[]): Project => ({ ...createProject('Project'), notes })
const angle = (title: string) => screen.getByTitle(title).querySelector('input')!

describe('exporting an image', () => {
  it('exports a banknote flat at its design’s full resolution, its security features at the angle picked, starting from the canvas’s', async () => {
    const user = userEvent.setup()
    // The tilt pad holds the banknotes 12° up and 5° to the left
    setTilt({ source: 'hold', target: 12, targetX: -5 })
    const note = banknote('Fifteen', 68, 134, 'design')
    const project = projectOf(note, banknote('Other', 150, 75))
    const onOpenChange = vi.fn()
    render(<ExportDialog project={project} selectedId={note.id} open onOpenChange={onOpenChange} />)
    expect(screen.getByText('Frame rate')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Image' }))
    // None of the video's settings: no format, frame rate or background, and no side by side
    expect(screen.queryByText('Frame rate')).toBeNull()
    expect(screen.queryByText('Background')).toBeNull()
    expect(angle('Up/down tilt').value).toBe('12')
    expect(angle('Side tilt').value).toBe('-5')
    expect(await screen.findByText('2720 × 5360 · PNG')).toBeDefined()
    expect(artworkSize).toHaveBeenCalledWith('design')

    fireEvent.change(angle('Up/down tilt'), { target: { value: '20' } })
    await user.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(media.downloadFile).toHaveBeenCalledWith({ name: 'image.png', blob: expect.any(Blob) }))
    expect(media.exportTilt).not.toHaveBeenCalled()
    expect(media.exportImages).toHaveBeenCalledWith('Project', expect.objectContaining({ notes: [note], tilt: { x: -5, y: 20 } }), expect.any(Function), expect.any(AbortSignal))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('makes one image per banknote, saying so, turned and turned over as the canvas shows them, and opens on Image again', async () => {
    const user = userEvent.setup()
    setTilt({ quarterTurns: 1, flipped: true })
    const project = projectOf(banknote('One', 150, 75), banknote('Two', 150, 75))
    render(<ExportDialog project={project} open onOpenChange={() => {}} />)
    // The last export was an image, so it opens on Image
    expect(angle('Up/down tilt').value).toBe('0')
    // Without designs, 300 dpi, on their sides
    expect(screen.getByText('886 × 1772 · 2 PNGs · backs · rotated 90° right')).toBeDefined()
    expect(screen.queryByText('Export as separate files')).toBeNull()

    // Back to Video, its settings and side by side return
    await user.click(screen.getByRole('button', { name: 'Video' }))
    expect(screen.getByText('Frame rate')).toBeDefined()
    expect(screen.getByText('Export as separate files')).toBeDefined()
  })
})
