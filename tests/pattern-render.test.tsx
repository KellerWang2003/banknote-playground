// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteView } from '../src/components/NoteView'
import { drawExportFrame, drawFace, playbackTilts, type NoteAssets } from '../src/lib/exportRender'
import { settleArtwork } from '../src/lib/artwork'
import { PAPER } from '../src/lib/back'
import type { Tilt2 } from '../src/lib/lens'
import { DEFAULT_TILT, createNote, migrateProject } from '../src/lib/notes'
import { patternMix, playbackLens, preparePattern } from '../src/lib/pattern'
import { presetPattern } from '../src/lib/patternPresets'
import type { Frame, Note, ThreadPattern } from '../src/lib/types'
import { setTilt } from '../src/tilt/tilt'
import { drawFace as legacyDrawFace, playbackTilts as legacyPlaybackTilts } from './fixtures/legacyExportRender'
import { NoteView as LegacyNoteView } from './fixtures/legacyNoteView'

// Image frames get an address without touching storage, so the image path is drawn too
vi.mock('../src/lib/images', async (original) => ({
  ...(await original<typeof import('../src/lib/images')>()),
  useImageUrl: (id: string | undefined) => (id ? `blob:test/${id}` : undefined),
  loadImageUrl: async () => undefined,
}))

afterEach(() => {
  cleanup()
  setTilt({ source: 'hold', angle: 0, angleX: 0, target: 0, targetX: 0 })
})

const COLOURS = ['#F26B5B', '#F7C948', '#1F9E89', '#4A6FD1', '#7C4DBA']
const colourFrames = (count: number): Frame[] => COLOURS.slice(0, count).map((color, i) => ({ id: `f${i}`, kind: 'color', color, name: `${i + 1}`, length: 10 + i }))
const imageFrames = (count: number): Frame[] => colourFrames(count).map((f) => ({ ...f, kind: 'image', imageId: `img-${f.id}` }))

/** Banknotes as saved before thread patterns: no `pattern` field */
function legacyNotes(): Note[] {
  // On plain paper, the only paper banknotes show now, so the old renderer's own colour matches
  const base = createNote({ name: 'Plain', x: 0, y: 0, widthMm: 150, heightMm: 70, color: PAPER })
  const { pattern: _drop, ...rest } = base
  // With the windows banknotes started with then
  const plain = { ...rest, thread: { ...rest.thread, windows: { ...rest.thread.windows, enabled: true } } }
  const tilt = { ...DEFAULT_TILT, cycleDeg: 25, transition: 0.3 }
  const windows = { enabled: true, sections: [{ id: 'a', startMm: 5, endMm: 17 }, { id: 'b', startMm: 24, endMm: 32 }, { id: 'c', startMm: 40, endMm: 62 }] }
  return [
    plain,
    { ...plain, id: 'birds', frames: imageFrames(5), tilt, thread: { ...plain.thread, widthMm: 4, positionMm: 101, imageGapMm: 1.5, windows } },
    { ...plain, id: 'side', frames: colourFrames(3), tilt: { ...tilt, effect: 'both', flatAt: 'start' }, thread: { ...plain.thread, direction: 'horizontal', positionMm: 34, backgroundColor: '#eeeeee' } },
    { ...plain, id: 'reveal', frames: imageFrames(4), tilt: { ...tilt, effect: 'reveal', revealAxis: 'x', revealLevel: 1 }, thread: { ...plain.thread, windows } },
    { ...plain, id: 'custom', frames: colourFrames(5), tilt: { ...tilt, effect: 'custom', cycleXDeg: 40, yOn: true, runY: 'up', runX: 'left' } },
  ]
}
/** The same banknotes after loading, as every project is: each gets its one-section pattern */
const migrated = (notes: Note[]) => migrateProject({ id: 'p', name: 'P', createdAt: 0, updatedAt: 0, notes }).notes

const TILTS: Tilt2[] = [-63, -24, -8, 0, 3.5, 11, 19, 37, 81].flatMap((y) => [-48, 0, 6, 29].map((x) => ({ x, y })))
const FLAGS = { perspective: true, sheen: true, showWindowCuts: true, showFrameNumber: true }

describe('banknotes from before thread patterns', () => {
  it('get one section over the whole thread, playing the banknote’s own lens', () => {
    for (const note of migrated(legacyNotes())) {
      expect(note.pattern).toEqual({ repeatMm: 4, mixed: false, sections: [{ id: 'whole', name: 'Whole thread', startMm: 0, endMm: 4, acrossStart: 0, acrossEnd: 1 }] })
      expect(preparePattern(note).plain).toBe(true)
    }
  })

  it('draw colour frames exactly as before on the canvas at every tilt', () => {
    const before = legacyNotes().filter(colourOnly), after = migrated(before)
    const drawn: string[] = []
    before.forEach((legacy, i) => {
      for (const { x, y } of TILTS) {
        const old = renderToStaticMarkup(<LegacyNoteView note={legacy} scale={3} angle={y} angleX={x} {...FLAGS} />)
        expect(renderToStaticMarkup(<NoteView note={after[i]} scale={3} angle={y} angleX={x} {...FLAGS} />)).toBe(old)
        drawn.push(old)
      }
    })
    // The comparison covered fades between frames and window cuts
    expect(drawn.some((html) => /data-tilt="blend" style="opacity:0\.\d/.test(html))).toBe(true)
    expect(drawn.some((html) => html.includes('data-window-cuts'))).toBe(true)
  })

  it('draw colour frames exactly as before while following the live tilt', () => {
    const before = legacyNotes().filter(colourOnly), after = migrated(before)
    before.forEach((legacy, i) => {
      const old = render(<LegacyNoteView note={legacy} scale={2} live {...FLAGS} />)
      const now = render(<NoteView note={after[i]} scale={2} live {...FLAGS} />)
      for (const { x, y } of TILTS) {
        act(() => setTilt({ angle: y, angleX: x }))
        expect(now.container.innerHTML).toBe(old.container.innerHTML)
      }
      old.unmount()
      now.unmount()
    })
  })

  it('export exactly as before, call for call, once their images have been read', () => {
    // Frames whose images share their proportions, as one artwork's frames do: the first image sets the repeat
    const before = legacyNotes(), after = migrated(before).map((note) => settleArtwork(note, new Map(note.frames.map((f) => [f.imageId ?? '', SAME.naturalHeight / SAME.naturalWidth]))))
    const ops = new Set<unknown>()
    before.forEach((legacy, i) => {
      // The print's offset moves images with the sections now; colour frames never show it
      const offsetMm = colourOnly(legacy) ? 1.7 : 0
      for (const t of TILTS) {
        for (const frameNumbers of [false, true]) {
          const options = { sheen: true, perspective: true, frameNumbers }
          const old = recorder(), now = recorder()
          legacyDrawFace(old.ctx, legacy, sameAssets(legacy), 4, t, options)
          drawFace(now.ctx, after[i], sameAssets(after[i]), 4, t, { ...options, offsetMm })
          expect(tidyLog(now.log)).toEqual(tidyLog(old.log))
          for (const op of old.log) ops.add(op[0] === '=' && op[1] === 'globalAlpha' && op[2] !== 1 ? 'fade' : op[0])
        }
      }
    })
    expect([...ops]).toEqual(expect.arrayContaining(['drawImage', 'fade', 'fillText']))
  })

  it('play back the same tilts', () => {
    const before = legacyNotes(), after = migrated(before)
    before.forEach((legacy, i) => expect(playbackTilts(after[i], 30, 1)).toEqual(legacyPlaybackTilts(legacy, 30, 1)))
  })
})

/** Demo banknote 1's thread with distinct colours, carrying `pattern` */
function patterned(make: (note: Note) => ThreadPattern): Note {
  const note: Note = {
    ...createNote({ name: 'Sections', x: 0, y: 0, widthMm: 134, heightMm: 68, color: '#fff' }),
    frames: colourFrames(5),
    tilt: { ...DEFAULT_TILT, cycleDeg: 25, transition: 0 },
  }
  note.thread = { ...note.thread, widthMm: 4, positionMm: 101, windows: { enabled: false, sections: [] } }
  return { ...note, pattern: make(note) }
}
/** The colour each section's area shows in static markup, in section order */
function sectionColours(html: string) {
  const host = document.createElement('div')
  host.innerHTML = html
  return [...host.querySelectorAll('[data-thread] > [data-section]')].map((area) => (area.firstElementChild as HTMLElement).style.backgroundColor)
}
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

describe('a thread with sections', () => {
  it('shows each section’s own frame through its own part of the thread', () => {
    const note = patterned((n) => presetPattern(n, 'split'))
    for (const tilt of [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 0, y: -40 }, { x: 25, y: 0 }, { x: -60, y: 0 }]) {
      const html = renderToStaticMarkup(<NoteView note={note} scale={2} angle={tilt.y} angleX={tilt.x} />)
      expect(sectionColours(html)).toEqual(patternMix(note, tilt).map((m) => rgb(COLOURS[m.current])))
    }
    const html = renderToStaticMarkup(<NoteView note={note} scale={2} />)
    expect(html).toContain('clip-path:inset(0 50% 0 0%)')
    expect(html).toContain('clip-path:inset(0 0% 0 50%)')
  })

  it('masks blocks along the thread at every repeat, shifted by the offset', () => {
    const note = patterned((n) => presetPattern(n, 'alternate'))
    const repeat = note.pattern!.repeatMm
    const html = renderToStaticMarkup(<NoteView note={note} scale={1} offsetMm={1} />)
    // The first block of the second repeat starts one repeat after the offset
    expect(html).toContain(`#000 ${1 + repeat}px`)
    expect(html).toContain('-webkit-mask-image:linear-gradient(to bottom')
    expect(html).not.toContain('clip-path')
  })

  it('fades each section between its own frames, live', () => {
    const note = patterned((n) => presetPattern(n, 'split'))
    const faded: Note = { ...note, tilt: { ...note.tilt, transition: 0.6 } }
    const { container } = render(<NoteView note={faded} scale={2} live />)
    const blendOf = (i: number) => container.querySelector<HTMLElement>(`[data-tilt="blend"][data-section="${i}"]`)?.style.opacity
    for (const y of [3, 7, 13]) {
      act(() => setTilt({ angle: y, angleX: 0 }))
      patternMix(faded, { x: 0, y }).forEach((m, i) => {
        if (m.blend > 0 && m.next !== m.base) expect(Number(blendOf(i))).toBeCloseTo(m.blend)
      })
    }
  })

  it('labels the thread with every frame it shows', () => {
    const note = patterned((n) => presetPattern(n, 'split'))
    const tilt = { x: 0, y: 20 }
    const [side, updown] = patternMix(note, tilt).map((m) => m.current + 1)
    expect(side).not.toBe(updown)
    const html = renderToStaticMarkup(<NoteView note={note} scale={2} angle={tilt.y} showFrameNumber />)
    expect(html).toContain(`>${side} · ${updown}</span>`)
  })

  it('exports each section clipped to its areas, with its own frame', () => {
    const note = patterned((n) => presetPattern(n, 'split'))
    const tilt = { x: 0, y: 20 }
    const { ctx, log } = recorder()
    drawFace(ctx, note, assetsFor(note), 2, tilt, { sheen: false, perspective: false })
    // Past the banknote's own edge and the thread's
    const clips = log.filter((op) => op[0] === 'rect').slice(2)
    // 4 mm thread, 68 mm long, at 2 px/mm: one band per lane the whole length
    expect(clips).toEqual([['rect', 0, 0, 4, 136], ['rect', 4, 0, 4, 136]])
    const fills = log.filter((op) => op[0] === '=' && op[1] === 'fillStyle').map((op) => op[2])
    for (const m of patternMix(note, tilt)) expect(fills).toContain(COLOURS[m.current])
  })

  it('exports blocks at the offset the canvas previews', () => {
    const note = patterned((n) => presetPattern(n, 'alternate'))
    const repeat = note.pattern!.repeatMm
    const layout = { width: 400, height: 400, exactWidth: 400, exactHeight: 400, cells: [{ note, cx: 200, cy: 200 }] }
    const face = recorder()
    const faces = new Map([[note.id, { getContext: () => face.ctx, width: 400, height: 400 } as unknown as OffscreenCanvas]])
    const out = recorder()
    drawExportFrame(out.ctx, layout, new Map([[note.id, { front: assetsFor(note) }]]), faces, 1, 0, { sheen: false, perspective: false, offsets: { [note.id]: 1 } })
    // Past the banknote's own edge and the thread's
    const blocks = face.log.filter((op) => op[0] === 'rect').slice(2)
    // At 1 px per mm the first block starts at the offset, and again one repeat later
    expect(blocks[0]).toEqual(['rect', 0, 1, 4, repeat / 2])
    expect(blocks).toContainEqual(['rect', 0, 1 + repeat, 4, repeat / 2])
  })

  it('plays back every section’s tilt when mixed', () => {
    const note = patterned((n) => presetPattern(n, 'split'))
    const tilts = playbackTilts(note, 30, 1)
    expect(playbackLens(note).cycleX).not.toBeNull()
    expect(tilts.some((t) => Math.abs(t.x) > 1)).toBe(true)
    expect(tilts.some((t) => Math.abs(t.y) > 1)).toBe(true)
  })
})

/** A 2D context that records every call and property set, in order */
function recorder() {
  const log: unknown[][] = []
  const target: Record<string, unknown> = {}
  const gradient = { addColorStop: (offset: number, color: string) => log.push(['addColorStop', offset, color]) }
  const ctx = new Proxy(target, {
    get(_, key) {
      if (typeof key !== 'string') return undefined
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        log.push([key, ...args])
        if (key === 'createLinearGradient') return gradient
        if (key === 'measureText') return { width: 10 * String(args[0]).length }
        return undefined
      }
    },
    set(_, key, value) {
      log.push(['=', key, value === gradient ? 'gradient' : value])
      target[key as string] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log }
}

/** Stand-in images for a banknote's image frames */
/** Banknotes with no image frames */
const colourOnly = (note: Note) => note.frames.every((f) => f.kind !== 'image')
/** Every image frame's image the same size */
const SAME = { naturalWidth: 120, naturalHeight: 100 }
function sameAssets(note: Note): NoteAssets {
  return { frames: new Map(note.frames.flatMap((f) => (f.kind === 'image' ? [[f.id, SAME as HTMLImageElement] as const] : []))) }
}
/** A drawing log with float noise rounded away: image copies are now placed in mm, then scaled */
const tidyLog = (log: unknown[][]) => log.map((op) => op.map((v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)))

function assetsFor(note: Note): NoteAssets {
  const frames = new Map<string, HTMLImageElement>()
  for (const f of note.frames) if (f.kind === 'image') frames.set(f.id, { naturalWidth: 120, naturalHeight: 90 + f.length } as HTMLImageElement)
  return { frames }
}
