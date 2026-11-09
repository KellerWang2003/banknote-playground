// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteSkeleton, NoteView } from '../src/components/NoteView'
import { drawExportFrame, drawFace, drawStill, type NoteAssets } from '../src/lib/exportRender'
import { PAPER } from '../src/lib/back'
import { createNote } from '../src/lib/notes'
import type { Note } from '../src/lib/types'

// Keller, 9 November: "when you are exporting, make sure that there's no corner radius. And like banknotes shouldn't have
// corner radius at all." They had 1.5 mm, on the canvas and cut out of every export

// The design gets an address without touching storage, so it is drawn too
vi.mock('../src/lib/images', async (original) => ({
  ...(await original<typeof import('../src/lib/images')>()),
  useImageUrl: (id: string | undefined) => (id ? `blob:test/${id}` : undefined),
  loadImageUrl: async () => undefined,
}))

afterEach(cleanup)

/** A banknote with a design on both sides and a thread */
const banknote = (): Note => ({
  ...createNote({ name: 'Square', x: 0, y: 0, widthMm: 68, heightMm: 134, color: PAPER }),
  background: 'image',
  faceImageId: 'front',
  back: { background: 'image', color: PAPER, imageId: 'back' },
})

/** A banknote's own box as markup draws it (React puts a preload of its design ahead of it) */
const rootOf = (html: string) => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.querySelector<HTMLElement>(':scope > div')!
}

describe('a banknote on screen', () => {
  it('has square corners, front and back, flat or tilted', () => {
    const note = banknote()
    for (const side of ['front', 'back'] as const) {
      for (const angle of [0, 25]) {
        const root = rootOf(renderToStaticMarkup(<NoteView note={note} scale={3} side={side} angle={angle} perspective sheen />))
        expect(root.style.width).toBe('204px')
        expect(root.style.borderRadius).toBe('')
      }
    }
  })

  it('has square corners on the canvas, Realistic on, following the tilt', () => {
    const { container } = render(<NoteView note={banknote()} scale={2} live perspective realistic />)
    const root = container.querySelector<HTMLElement>(':scope > div')!
    expect(root.classList.contains('overflow-hidden')).toBe(true)
    expect(root.style.borderRadius).toBe('')
  })

  it('has square corners while its project is still on its way', () => {
    const root = rootOf(renderToStaticMarkup(<NoteSkeleton widthMm={150} heightMm={70} scale={2} />))
    expect(root.style.borderRadius).toBe('')
  })
})

/** A 2D context that records every call and property set, in order */
function recorder() {
  const log: unknown[][] = []
  const target: Record<string, unknown> = {}
  const ctx = new Proxy(target, {
    get(_, key) {
      if (typeof key !== 'string') return undefined
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        log.push([key, ...args])
        if (key === 'createLinearGradient') return { addColorStop() {} }
        if (key === 'measureText') return { width: 10 * String(args[0]).length }
        return undefined
      }
    },
    set(_, key, value) {
      log.push(['=', key, value])
      target[key as string] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log }
}

/** The banknote's edge as drawn: cut as a plain rectangle `width` × `height` px, then its paper laid over all of it */
function expectSquareEdge(log: unknown[][], width: number, height: number) {
  expect(log.some((op) => op[0] === 'roundRect')).toBe(false)
  const clip = log.findIndex((op) => op[0] === 'clip')
  expect(log.slice(clip - 2, clip + 3)).toEqual([
    ['beginPath'], ['rect', 0, 0, width, height], ['clip'], ['=', 'fillStyle', PAPER], ['fillRect', 0, 0, width, height],
  ])
}

const design = { naturalWidth: 680, naturalHeight: 1340 } as HTMLImageElement
const assets = (): NoteAssets => ({ face: design, frames: new Map() })

describe('a banknote in an export', () => {
  it('is cut square, front and back, with or without its thread', () => {
    const note = banknote()
    for (const drawn of [note, { ...note, noThread: true as const }]) {
      for (const back of [false, true]) {
        const { ctx, log } = recorder()
        drawFace(ctx, drawn, assets(), 4, { x: 10, y: 20 }, { sheen: true, perspective: true, back })
        expectSquareEdge(log, 272, 536)
      }
    }
  })

  it('fills every corner of a still image, front and back, turned or not', () => {
    const note = banknote()
    for (const back of [false, true]) {
      for (const quarter of [0, 1] as const) {
        const { ctx, log } = recorder()
        drawStill(ctx, note, assets(), 10, { x: 0, y: 15 }, { sheen: true, realistic: true, back, quarter })
        expectSquareEdge(log, 680, 1340)
      }
    }
  })

  it('is cut square in every video frame, front and back', () => {
    const note = banknote()
    for (const turn of [0, 1]) {
      const face = recorder()
      const faces = new Map([[note.id, { getContext: () => face.ctx, width: 136, height: 268 } as unknown as OffscreenCanvas]])
      const out = recorder()
      const layout = { width: 200, height: 300, exactWidth: 200, exactHeight: 300, cells: [{ note, cx: 100, cy: 150 }] }
      drawExportFrame(out.ctx, layout, new Map([[note.id, { front: assets(), back: assets() }]]), faces, 2, 0, { sheen: true, perspective: false }, 0, turn)
      expectSquareEdge(face.log, 136, 268)
      expect(out.log.some((op) => op[0] === 'roundRect')).toBe(false)
    }
  })
})
