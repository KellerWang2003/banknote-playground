// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useNotice } from '../src/cloud/notices'
import { colorFrame, createNote, withNewThread } from '../src/lib/notes'
import type { Note } from '../src/lib/types'
import { newWatermark } from '../src/lib/watermark'
import type { Layer } from '../src/editor/layerActions'

// Banknotes by id in place of the project store, artwork copied at once, and a workspace to copy in
const held = vi.hoisted(() => ({ notes: {} as Record<string, Note>, edits: 0, workspace: 'mine' as string | undefined }))
vi.mock('../src/lib/store', () => ({
  findNote: (_project: string, id: string) => held.notes[id],
  updateNote: (_project: string, id: string, change: (note: Note) => Note) => {
    held.notes[id] = change(held.notes[id])
    held.edits++
  },
}))
vi.mock('../src/lib/images', () => ({ copyImage: async (id: string) => `${id} copy`, removeImage: async () => {} }))
vi.mock('../src/cloud/workspace', () => ({ useWorkspace: { getState: () => ({ workspace: held.workspace }) } }))
const { FEATURE_TYPE, copiedFeature, forgetCopiedFeature, useFeatureClipboard } = await import('../src/editor/featureClipboard')
const { usePasteImage } = await import('../src/lib/pasteImages')

/** A banknote as New banknote makes it, no security features yet, under the id the store holds it by */
const banknote = (id: string, widthMm = 150, heightMm = 70): Note =>
  ({ ...createNote({ name: id.toUpperCase(), x: 0, y: 0, widthMm, heightMm, color: '#123456' }), id, noThread: true })

/** The editor's part of it: the selected banknote and its picked part, and an upload slot beside them */
function Editor({ note, layer, enabled = true, onPasted = () => {}, take = () => {} }: {
  note?: string
  layer: Layer
  enabled?: boolean
  onPasted?: (noteId: string, layer: Layer) => void
  take?: (file: File) => unknown
}) {
  useFeatureClipboard({ projectId: 'p', note: note ? held.notes[note] : undefined, layer, enabled, onPasted })
  const slot = usePasteImage(take)
  return (
    <>
      <button type="button" {...slot}>Upload image</button>
      <input aria-label="Name" />
    </>
  )
}

/** The system clipboard: what a copy writes, a paste reads */
function clipboard({ data = {}, files = [] }: { data?: Record<string, string>; files?: File[] } = {}) {
  const held = { ...data }
  return {
    files,
    get types() { return [...(files.length ? ['Files'] : []), ...Object.keys(held)] },
    getData: (type: string) => held[type] ?? '',
    setData: (type: string, value: string) => { held[type] = value },
  } as unknown as DataTransfer
}

/** A copy or paste where the keyboard is, as ⌘C and ⌘V give one */
function send(type: 'copy' | 'paste', data: DataTransfer, target: EventTarget = document.activeElement ?? document.body) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: data })
  act(() => { target.dispatchEvent(event) })
  return event
}

/** ⌘C as a browser gives it: the keys, then the copy event, onto the clipboard */
function copyKeys(board: DataTransfer, target: Element = document.body) {
  fireEvent.keyDown(target, { key: 'c', code: 'KeyC', metaKey: true })
  return send('copy', board, target)
}

const png = () => new File(['png'], 'image.png', { type: 'image/png' })

beforeEach(() => {
  const a = banknote('a')
  held.notes = { a: { ...a, watermark: { ...newWatermark(a), imageId: 'portrait', name: 'Bird' } }, b: banknote('b', 68, 120) }
  held.edits = 0
  held.workspace = 'mine'
  forgetCopiedFeature()
  useNotice.setState({ message: '' })
})
afterEach(() => {
  cleanup()
  window.dispatchEvent(new MouseEvent('pointerout', { relatedTarget: null }))
})

describe('copying and pasting security features', () => {
  it('copies the picked feature with ⌘C and pastes it onto another banknote with ⌘V, with its own image, picking it there', async () => {
    const onPasted = vi.fn()
    const { rerender } = render(<Editor note="a" layer="watermark" onPasted={onPasted} />)
    const board = clipboard()
    expect(copyKeys(board).defaultPrevented).toBe(true)
    expect(board.getData(FEATURE_TYPE)).toBe(copiedFeature()!.id)
    expect(board.getData('text/html')).toContain(copiedFeature()!.id)

    rerender(<Editor note="b" layer="note" onPasted={onPasted} />)
    expect(send('paste', board).defaultPrevented).toBe(true)
    await waitFor(() => expect(onPasted).toHaveBeenCalledWith('b', 'watermark'))
    expect(held.notes.b.watermark).toMatchObject({ name: 'Bird', imageId: 'portrait copy', widthMm: held.notes.a.watermark!.widthMm })
    expect(held.edits).toBe(1)
    expect(held.notes.a.watermark!.imageId).toBe('portrait')
  })

  it('pastes a copied thread with its frames’ images, onto a banknote that had none', async () => {
    const threaded = withNewThread(banknote('c'))
    held.notes.c = { ...threaded, frames: [{ ...threaded.frames[0], kind: 'image', imageId: 'bird' }, colorFrame(1)] }
    const { rerender } = render(<Editor note="c" layer="thread" />)
    const board = clipboard()
    copyKeys(board)
    rerender(<Editor note="b" layer="note" />)
    send('paste', board)
    await waitFor(() => expect(held.notes.b.noThread).toBeUndefined())
    expect(held.notes.b.frames.map((f) => f.imageId)).toEqual(['bird copy', undefined])
  })

  it('pastes the feature, not an image, with the pointer over an upload slot', async () => {
    const take = vi.fn()
    const { rerender } = render(<Editor note="a" layer="watermark" take={take} />)
    const board = clipboard()
    copyKeys(board)
    rerender(<Editor note="b" layer="note" take={take} />)
    const slot = screen.getByText('Upload image')
    document.elementFromPoint = () => slot
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }))
    send('paste', board)
    await waitFor(() => expect(held.notes.b.watermark?.imageId).toBe('portrait copy'))
    expect(take).not.toHaveBeenCalled()
    expect(useNotice.getState().message).toBe('')
  })

  it('pastes whatever was copied after it instead: an image to its slot, text or Figma’s layers left alone', async () => {
    const take = vi.fn()
    const { rerender } = render(<Editor note="a" layer="watermark" take={take} />)
    copyKeys(clipboard())
    rerender(<Editor note="b" layer="note" take={take} />)
    expect(send('paste', clipboard({ data: { 'text/plain': 'Banknote 1' } })).defaultPrevented).toBe(false)
    const slot = screen.getByText('Upload image')
    document.elementFromPoint = () => slot
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }))
    const image = png()
    send('paste', clipboard({ files: [image] }))
    await waitFor(() => expect(take).toHaveBeenCalledWith(image))
    expect(held.notes.b.watermark).toBeUndefined()
  })

  it('copies on the keys alone where the browser sends no copy event, unless an image was copied since', async () => {
    const onPasted = vi.fn()
    const { rerender } = render(<Editor note="a" layer="watermark" onPasted={onPasted} />)
    fireEvent.keyDown(document.body, { key: 'c', metaKey: true })
    expect(copiedFeature()?.copy.feature).toBe('watermark')
    rerender(<Editor note="b" layer="note" onPasted={onPasted} />)
    expect(send('paste', clipboard({ files: [png()] })).defaultPrevented).toBe(false)
    expect(send('paste', clipboard()).defaultPrevented).toBe(true)
    await waitFor(() => expect(held.notes.b.watermark?.imageId).toBe('portrait copy'))
  })

  it('leaves text to the field it is typed in, and copies nothing with the banknote itself picked or in Thread Studio', () => {
    const { rerender } = render(<Editor note="a" layer="watermark" />)
    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(copyKeys(clipboard(), name).defaultPrevented).toBe(false)
    expect(copiedFeature()).toBeUndefined()

    rerender(<Editor note="a" layer="note" />)
    expect(copyKeys(clipboard()).defaultPrevented).toBe(false)
    rerender(<Editor note="a" layer="watermark" enabled={false} />)
    expect(copyKeys(clipboard()).defaultPrevented).toBe(false)
    expect(copiedFeature()).toBeUndefined()

    rerender(<Editor note="a" layer="watermark" />)
    const board = clipboard()
    copyKeys(board)
    rerender(<Editor note="b" layer="note" />)
    expect(send('paste', board, name).defaultPrevented).toBe(false)
    expect(held.edits).toBe(0)
  })

  it('pastes one more of its kind onto a banknote that has one, back onto its own banknote too, and picks the new one', async () => {
    // Keller, 10 November: "you should be able to add multiple of the same security feature. so no limit". Back onto the
    // banknote it came from it lands over the original, as Figma pastes a copy
    const onPasted = vi.fn()
    const { rerender } = render(<Editor note="a" layer="watermark" onPasted={onPasted} />)
    const board = clipboard()
    copyKeys(board)
    rerender(<Editor note="a" layer="note" onPasted={onPasted} />)
    send('paste', board)
    await waitFor(() => expect(onPasted).toHaveBeenCalledTimes(1))
    const [extra] = held.notes.a.extras!
    expect(onPasted).toHaveBeenCalledWith('a', `watermark/${extra.id}`)
    // With its own copy of the image and the name it had, the original as it was
    expect(extra).toEqual({ id: extra.id, feature: 'watermark', layer: { ...held.notes.a.watermark, imageId: 'portrait copy' } })
    expect(held.notes.a.watermark).toMatchObject({ name: 'Bird', imageId: 'portrait' })
    expect(held.edits).toBe(1)

    // Copied from a further one, it is that one
    const c = banknote('c')
    held.notes.c = { ...c, watermark: newWatermark(c), extras: [{ id: 'second', feature: 'watermark', layer: { ...newWatermark(c), xMm: 3, name: 'Watermark 2' } }] }
    rerender(<Editor note="c" layer="watermark/second" onPasted={onPasted} />)
    copyKeys(clipboard())
    expect(copiedFeature()!.copy).toMatchObject({ feature: 'watermark', layer: { xMm: 3, name: 'Watermark 2' } })
    // One without a name of its own goes by the next of its kind's
    rerender(<Editor note="c" layer="watermark" onPasted={onPasted} />)
    const again = clipboard()
    copyKeys(again)
    rerender(<Editor note="c" layer="note" onPasted={onPasted} />)
    send('paste', again)
    await waitFor(() => expect(held.notes.c.extras).toHaveLength(2))
    expect(held.notes.c.extras![1]).toMatchObject({ feature: 'watermark', layer: { name: 'Watermark 3', xMm: held.notes.c.watermark!.xMm } })
  })

  it('says what is missing: a banknote to paste onto, or a copy made on this page', () => {
    const { rerender } = render(<Editor note="a" layer="watermark" />)
    const board = clipboard()
    copyKeys(board)
    rerender(<Editor layer="note" />)
    expect(send('paste', board).defaultPrevented).toBe(true)
    expect(useNotice.getState().message).toBe('Pick a banknote to paste the watermark onto.')

    rerender(<Editor note="b" layer="note" />)
    send('paste', clipboard({ data: { [FEATURE_TYPE]: 'from another tab' } }))
    expect(useNotice.getState().message).toBe('Copy the security feature again to paste it here.')

    // Copied in another workspace, whose artwork this one hasn't got
    useNotice.setState({ message: '' })
    held.workspace = 'theirs'
    send('paste', board)
    expect(useNotice.getState().message).toBe('Copy the security feature again to paste it here.')
    expect(copiedFeature()).toBeUndefined()
    expect(held.edits).toBe(0)
  })
})
