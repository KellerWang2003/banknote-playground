// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ColorField } from '../src/components/controls'
import { hexToHsv, hsvFor, hsvToHex, pickedHex } from '../src/lib/color'

interface Pick {
  resolve: (sRGBHex: string) => void
  signal?: AbortSignal
}

/** The browser's eyedropper as Chrome has it: open() answers once a colour is clicked, and fails once it is aborted */
function stubEyeDropper() {
  const opened: Pick[] = []
  vi.stubGlobal('EyeDropper', class {
    open(options?: { signal?: AbortSignal }) {
      return new Promise<{ sRGBHex: string }>((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('The user aborted a request.', 'AbortError')))
        opened.push({ resolve: (sRGBHex) => resolve({ sRGBHex }), signal: options?.signal })
      })
    }
  })
  return opened
}

/** A colour field that keeps what it is given, and a text field elsewhere on the page */
function Harness({ initial = '#336699', onChange }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <ColorField value={value} onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }} />
      <input aria-label="Name" />
    </>
  )
}

const hexField = () => screen.getAllByRole<HTMLInputElement>('textbox')[0]
const picker = () => screen.getByRole('dialog')
const eyedropper = () => within(picker()).getByRole('button', { name: 'Eyedropper' })
const square = () => within(picker()).getByRole('slider', { name: 'Saturation and brightness' })
const hue = () => within(picker()).getByRole('slider', { name: 'Hue' })

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Pick colour' }))
  await screen.findByRole('dialog')
}

beforeEach(() => {
  // jsdom has no pointer capture
  for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn() })
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('colours as the picker shows them', () => {
  it('reads a hex as its hue, saturation and brightness, and back', () => {
    const blue = hexToHsv('#336699')!
    expect(blue.h).toBeCloseTo(210)
    expect(blue.s).toBeCloseTo(2 / 3)
    expect(blue.v).toBeCloseTo(0.6)
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00')
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff')
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: 210, s: 0, v: 1 })).toBe('#ffffff')
    expect(hexToHsv('#FFFFFF')).toEqual({ h: 0, s: 0, v: 1 })
    expect(hexToHsv('#fff')).toBeUndefined()
    expect(hexToHsv('white')).toBeUndefined()
  })

  it('gives every colour back as it was', () => {
    const steps = [0, 1, 2, 17, 51, 85, 127, 128, 170, 204, 238, 253, 254, 255]
    const byte = (n: number) => n.toString(16).padStart(2, '0')
    for (const r of steps) for (const g of steps) for (const b of steps) {
      const hex = `#${byte(r)}${byte(g)}${byte(b)}`
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex)
    }
  })

  it('keeps where it was set while that is still the colour, and the hue of a grey and the saturation of black', () => {
    const dragged = { h: 210.4, s: 0.503, v: 0.75 }
    expect(hsvFor(hsvToHex(dragged), dragged)).toBe(dragged)
    expect(hsvFor('#808080', dragged)).toEqual({ h: 210.4, s: 0, v: 128 / 255 })
    expect(hsvFor('#000000', dragged)).toEqual({ h: 210.4, s: 0.503, v: 0 })
    expect(hsvFor('#ff0000', dragged)).toEqual({ h: 0, s: 1, v: 1 })
    expect(hsvFor('not a colour', dragged)).toBe(dragged)
  })

  it('reads the colour the eyedropper picked', () => {
    expect(pickedHex('#C8A24A')).toBe('#c8a24a')
    expect(pickedHex('rgb(200, 162, 74)')).toBe('#c8a24a')
    expect(pickedHex('rgba(200,162,74,1)')).toBe('#c8a24a')
    expect(pickedHex('rgb(300, 0, 0)')).toBeUndefined()
    expect(pickedHex('transparent')).toBeUndefined()
  })
})

describe('the colour picker', () => {
  it('opens from the swatch: the square, the hue strip and the eyedropper, at the field’s colour', async () => {
    stubEyeDropper()
    const user = userEvent.setup()
    render(<Harness />)
    await openPicker(user)
    expect(square().getAttribute('aria-valuetext')).toBe('Saturation 67%, brightness 60%')
    expect(hue().getAttribute('aria-valuenow')).toBe('210')
    expect(eyedropper().getAttribute('aria-pressed')).toBe('false')
  })

  // Keller, 9 November: "when a color picker is active, i should be able to just press the key I to initiate the actual
  // color picking, just like how figma behaves"
  it('starts the eyedropper on I while it is open, the colour clicked going into the field, and stays open', async () => {
    const opened = stubEyeDropper()
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)
    await openPicker(user)
    await user.keyboard('i')
    expect(opened).toHaveLength(1)
    expect(eyedropper().getAttribute('aria-pressed')).toBe('true')
    // I again while it is picking starts nothing more
    await user.keyboard('I')
    expect(opened).toHaveLength(1)
    await act(async () => opened[0].resolve('#c8a24a'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('#c8a24a')
    expect(hexField().value).toBe('#c8a24a')
    expect(eyedropper().getAttribute('aria-pressed')).toBe('false')
    expect(square().getAttribute('aria-valuetext')).toBe('Saturation 63%, brightness 78%')
    // And again, as many times as it takes
    await user.keyboard('i')
    expect(opened).toHaveLength(2)
  })

  it('starts the eyedropper from its button too', async () => {
    const opened = stubEyeDropper()
    const user = userEvent.setup()
    render(<Harness />)
    await openPicker(user)
    await user.click(eyedropper())
    expect(opened).toHaveLength(1)
    await act(async () => opened[0].resolve('rgb(10, 20, 30)'))
    expect(hexField().value).toBe('#0a141e')
  })

  it('leaves I to text fields, and does nothing with the picker closed or with ⌘, Ctrl or Alt held', async () => {
    const opened = stubEyeDropper()
    const user = userEvent.setup()
    render(<Harness />)
    await user.keyboard('i')
    expect(opened).toHaveLength(0)
    await openPicker(user)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'i' })
    fireEvent.keyDown(hexField(), { key: 'i' })
    await user.keyboard('{Meta>}i{/Meta}{Control>}i{/Control}{Alt>}i{/Alt}')
    expect(opened).toHaveLength(0)
    expect(picker()).toBeTruthy()
  })

  it('ends a pick under way on Escape, leaving the colour as it was and the picker open; Escape again closes it', async () => {
    const opened = stubEyeDropper()
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)
    await openPicker(user)
    await user.keyboard('i')
    await user.keyboard('{Escape}')
    expect(opened[0].signal?.aborted).toBe(true)
    await waitFor(() => expect(eyedropper().getAttribute('aria-pressed')).toBe('false'))
    expect(picker()).toBeTruthy()
    // A click that comes after all changes nothing
    await act(async () => opened[0].resolve('#c8a24a'))
    expect(onChange).not.toHaveBeenCalled()
    expect(hexField().value).toBe('#336699')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('ends a pick under way when it closes', async () => {
    const opened = stubEyeDropper()
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)
    await openPicker(user)
    await user.keyboard('i')
    await user.click(screen.getByRole('textbox', { name: 'Name' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(opened[0].signal?.aborted).toBe(true)
    await act(async () => opened[0].resolve('#c8a24a'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('has no eyedropper where the browser has none (Safari, Firefox), and I does nothing there', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openPicker(user)
    expect(within(picker()).queryByRole('button', { name: 'Eyedropper' })).toBeNull()
    await user.keyboard('i')
    expect(picker()).toBeTruthy()
    expect(hexField().value).toBe('#336699')
  })

  it('sets saturation and brightness on the square and the hue on the strip, by dragging or the arrow keys', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)
    await openPicker(user)
    // Every element 200 × 200 px from the top-left corner
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}) })

    fireEvent.pointerDown(square(), { pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 50 })
    expect(hexField().value).toBe(hsvToHex({ h: 210, s: 0.5, v: 0.75 }))
    // Dragged to white, a grey, the strip keeps its hue
    fireEvent.pointerMove(square(), { pointerId: 1, button: -1, buttons: 1, clientX: -20, clientY: -20 })
    expect(hexField().value).toBe('#ffffff')
    expect(hue().getAttribute('aria-valuenow')).toBe('210')
    fireEvent.pointerUp(square(), { pointerId: 1, button: 0, buttons: 0, clientX: -20, clientY: -20 })
    // Let go, the pointer passing over it moves nothing
    fireEvent.pointerMove(square(), { pointerId: 1, button: -1, buttons: 0, clientX: 150, clientY: 150 })
    expect(hexField().value).toBe('#ffffff')

    // The hue of a grey is only where the strip is: the colour stays white until the square gives it saturation
    const calls = onChange.mock.calls.length
    fireEvent.pointerDown(hue(), { pointerId: 1, button: 0, buttons: 1, clientX: 0, clientY: 6 })
    fireEvent.pointerUp(hue(), { pointerId: 1, button: 0, buttons: 0, clientX: 0, clientY: 6 })
    expect(hue().getAttribute('aria-valuenow')).toBe('0')
    expect(onChange).toHaveBeenCalledTimes(calls)
    fireEvent.pointerDown(square(), { pointerId: 1, button: 0, buttons: 1, clientX: 200, clientY: 0 })
    fireEvent.pointerUp(square(), { pointerId: 1, button: 0, buttons: 0, clientX: 200, clientY: 0 })
    expect(hexField().value).toBe('#ff0000')

    // A secondary click (two fingers on a trackpad) sets nothing
    fireEvent.pointerDown(square(), { pointerId: 1, button: 2, buttons: 2, clientX: 0, clientY: 200 })
    expect(hexField().value).toBe('#ff0000')

    // Arrow keys: brightness and saturation on the square, 1% a press (10% with Shift); hue on the strip, 1° (10°)
    fireEvent.keyDown(square(), { key: 'ArrowDown', shiftKey: true })
    expect(hexField().value).toBe(hsvToHex({ h: 0, s: 1, v: 0.9 }))
    fireEvent.keyDown(square(), { key: 'ArrowLeft' })
    expect(hexField().value).toBe(hsvToHex({ h: 0, s: 0.99, v: 0.9 }))
    fireEvent.keyDown(hue(), { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(hue(), { key: 'ArrowRight' })
    expect(hue().getAttribute('aria-valuenow')).toBe('11')
    expect(hexField().value).toBe(hsvToHex({ h: 11, s: 0.99, v: 0.9 }))
  })

  it('follows the field when its hex is typed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openPicker(user)
    fireEvent.change(hexField(), { target: { value: '#ff8000' } })
    expect(hue().getAttribute('aria-valuenow')).toBe('30')
    expect(square().getAttribute('aria-valuetext')).toBe('Saturation 100%, brightness 100%')
  })
})
