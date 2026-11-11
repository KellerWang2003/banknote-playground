// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NoteView } from '../src/components/NoteView'
import { turnDeg } from '../src/lib/back'
import { createNote } from '../src/lib/notes'
import { newWatermark } from '../src/lib/watermark'
import { lightBox, lightMove } from '../src/lib/paper'
import { setTilt } from '../src/tilt/tilt'

afterEach(() => {
  cleanup()
  setTilt({ source: 'hold', angle: 0, angleX: 0, target: 0, targetX: 0, light: 0, flipped: false, turn: 0, quarterTurns: 0 })
})

const note = createNote({ name: 'Paper', x: 0, y: 0, widthMm: 150, heightMm: 75, color: '#ffffff' })
const lightOf = (container: HTMLElement) => container.querySelector<HTMLCanvasElement>('[data-paper-light]')

describe('Realistic’s paper on a NoteView', () => {
  it('moves the lamp’s light to where the paper mirrors it as the banknote tilts, turns over and is rotated, without re-rendering', () => {
    let renders = 0
    function Counted() {
      renders++
      return <NoteView note={note} scale={2} live perspective realistic />
    }
    const { container } = render(<Counted />)
    const light = lightOf(container)!
    expect(light.style.left).toBe(`${lightBox(note, 2).left}px`)
    expect(light.style.transform).toBe(lightMove(note, 2, { x: 0, y: 0 }, 0).transform)
    const before = renders
    act(() => setTilt({ angle: 10, angleX: -4 }))
    expect(light.style.transform).toBe(lightMove(note, 2, { x: -4, y: 10 }, 0).transform)
    act(() => setTilt({ turn: 0.2 }))
    expect(light.style.transform).toBe(lightMove(note, 2, { x: -4 + turnDeg(0.2), y: 10 }, 0).transform)
    act(() => setTilt({ turn: 0, quarterTurns: 1 }))
    expect(light.style.transform).toBe(lightMove(note, 2, { x: -4, y: 10 }, 1).transform)
    expect(renders).toBe(before)
  })

  it('keeps the light on a phone, the banknote lying flat while the phone tilts', () => {
    const { container } = render(<NoteView note={note} scale={2} live perspective flat realistic />)
    act(() => setTilt({ angle: 10 }))
    expect(container.querySelector<HTMLElement>('[data-back], div')!.style.transform).toBe('')
    expect(lightOf(container)!.style.transform).toBe(lightMove(note, 2, { x: 0, y: 10 }, 0).transform)
  })

  it('lights a still note as at its own tilt', () => {
    const { container } = render(<NoteView note={note} scale={3} angle={-6} angleX={5} realistic />)
    expect(lightOf(container)!.style.transform).toBe(lightMove(note, 3, { x: 5, y: -6 }, 0).transform)
  })

  it('draws the paper once for the banknote, not again for a further feature drawn over it', () => {
    const second = { ...newWatermark(note), xMm: 80, name: 'Watermark 2' }
    const withTwo = { ...note, watermark: newWatermark(note), extras: [{ id: 'second', feature: 'watermark' as const, layer: second }] }
    const { container } = render(<NoteView note={withTwo} scale={2} live perspective realistic />)
    expect(container.querySelectorAll('[data-part-view]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-paper-light]')).toHaveLength(1)
  })

  it('draws none of it with Realistic off, as on the thumbnails', () => {
    const { container } = render(<NoteView note={note} scale={2} live perspective />)
    expect(lightOf(container)).toBeNull()
    expect(container.querySelector('[data-paper-grain]')).toBeNull()
  })
})
