// @vitest-environment jsdom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScrubField } from '../src/components/controls'

// A field at 50 with a step of 1: dragging its label 2 px moves it by 1
function Harness() {
  const [value, setValue] = useState(50)
  return <ScrubField label="W" value={value} min={0} max={200} onChange={setValue} />
}
const field = () => screen.getByRole<HTMLInputElement>('spinbutton')
const label = () => screen.getByText('W')
const press = (clientX: number) => ({ pointerId: 1, button: 0, buttons: 1, clientX })
const drag = (clientX: number) => ({ pointerId: 1, button: -1, buttons: 1, clientX })
const release = (clientX: number) => ({ pointerId: 1, button: 0, buttons: 0, clientX })
/** The pointer passing over the label with no button held */
const hover = (clientX: number) => ({ pointerId: 1, button: -1, buttons: 0, clientX })

beforeEach(() => {
  // jsdom has no pointer capture
  for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn() })
  }
})
afterEach(cleanup)

describe('scrubbing a number field by its label', () => {
  it('follows the pointer while the button is held, and lets go at the release', () => {
    render(<Harness />)
    fireEvent.pointerDown(label(), press(100))
    fireEvent.pointerMove(label(), drag(110))
    expect(field().value).toBe('55')
    fireEvent.pointerUp(label(), release(110))
    fireEvent.pointerMove(label(), hover(140))
    expect(field().value).toBe('55')
  })

  // Keller (9 November): after letting go, a scrub sometimes stayed attached, and the value followed the pointer
  // whenever it came back over the field, with no button held
  it('lets go at the first move with no button held when the release never arrives', () => {
    render(<Harness />)
    fireEvent.pointerDown(label(), press(100))
    fireEvent.pointerMove(label(), drag(110))
    // No pointerup: let go somewhere the page never hears of it
    fireEvent.pointerMove(label(), hover(140))
    fireEvent.pointerMove(label(), hover(60))
    expect(field().value).toBe('55')
    // The next press scrubs afresh, from the value it was left at
    fireEvent.pointerDown(label(), press(60))
    fireEvent.pointerMove(label(), drag(64))
    expect(field().value).toBe('57')
  })

  it('does not scrub on a secondary click, whose release the context menu keeps from the page', () => {
    render(<Harness />)
    // A two-finger click on a trackpad, or a right-click: the menu opens on the press and takes the release
    fireEvent.pointerDown(label(), { pointerId: 1, button: 2, buttons: 2, clientX: 100 })
    fireEvent.contextMenu(label(), { button: 2, clientX: 100 })
    fireEvent.pointerMove(label(), hover(140))
    expect(field().value).toBe('50')
  })

  it.each<[string, (target: HTMLElement) => void]>([
    // Ctrl-click on a Mac, which can come as the main button
    ['a context menu opens', (target) => fireEvent.contextMenu(target, { button: 0, clientX: 100 })],
    ['the browser cancels the pointer', (target) => fireEvent.pointerCancel(target, { pointerId: 1 })],
    ['the pointer capture is lost', (target) => fireEvent.lostPointerCapture(target, { pointerId: 1 })],
  ])('ends the scrub when %s', (_, end) => {
    render(<Harness />)
    fireEvent.pointerDown(label(), press(100))
    end(label())
    fireEvent.pointerMove(label(), drag(130))
    expect(field().value).toBe('50')
  })
})
