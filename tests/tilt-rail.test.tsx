// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { TiltRail } from '../src/editor/TiltRail'
import { padToTilt, tiltToPad } from '../src/lib/pad'
import { setRealistic, useRealistic } from '../src/lib/realistic'
import { setTiltPadOpen, useTiltPad } from '../src/lib/tiltPad'
import { setTilt, springToFlat, useTilt } from '../src/tilt/tilt'

// jsdom lays the pad out at 0,0: its 136 px square is centred on 68,68 and ±90° spans 62 px each way, on a curve
const C = 68
const px = (deg: number) => tiltToPad(deg / 90) * 62

beforeEach(() => {
  setTilt({ source: 'drag', angle: 0, target: 0, angleX: 0, targetX: 0, lockX: false, lockY: false })
  Element.prototype.setPointerCapture = () => {}
})
afterEach(cleanup)

const renderPad = () => {
  setTiltPadOpen(true)
  render(<TooltipProvider><TiltRail /></TooltipProvider>)
  return screen.getByRole('group', { name: 'Tilt pad' })
}
const at = (x: number, y: number) => ({ clientX: C + px(x), clientY: C - px(y), pointerId: 1 })

describe('tilt pad', () => {
  it('tilts both ways from one drag and holds where you let go', () => {
    const pad = renderPad()
    fireEvent.pointerDown(pad, { button: 0, buttons: 1, ...at(0, 0) })
    fireEvent.pointerMove(pad, { buttons: 1, ...at(-20, 30) })
    expect(useTilt.getState().target).toBeCloseTo(30)
    expect(useTilt.getState().targetX).toBeCloseTo(-20)
    fireEvent.pointerUp(pad, at(-20, 30))
    fireEvent.pointerMove(pad, { buttons: 0, ...at(0, 0) })
    expect(useTilt.getState().source).toBe('hold')
    expect(useTilt.getState().target).toBeCloseTo(30)
  })

  it('keeps a locked axis where it is, through drags and the spring back to flat', () => {
    const pad = renderPad()
    setTilt({ source: 'hold', target: 10, lockY: true })
    fireEvent.pointerDown(pad, { button: 0, buttons: 1, ...at(25, 50) })
    expect(useTilt.getState().target).toBe(10)
    expect(useTilt.getState().targetX).toBeCloseTo(25)
    springToFlat()
    expect(useTilt.getState()).toMatchObject({ target: 10, targetX: 0 })
  })

  it('stops following when the release is missed, the capture is lost, or the gesture is cancelled', () => {
    const pad = renderPad()
    fireEvent.pointerDown(pad, { button: 0, buttons: 1, ...at(0, 0) })
    // Moving with no button pressed means the release happened somewhere we never heard about
    fireEvent.pointerMove(pad, { buttons: 0, ...at(0, 30) })
    fireEvent.pointerMove(pad, { buttons: 1, ...at(0, 30) })
    expect(useTilt.getState().target).toBeCloseTo(0)

    for (const end of ['lostPointerCapture', 'pointerCancel'] as const) {
      fireEvent.pointerDown(pad, { button: 0, buttons: 1, ...at(0, 0) })
      fireEvent[end](pad, { pointerId: 1 })
      fireEvent.pointerMove(pad, { buttons: 1, ...at(0, 30) })
      expect(useTilt.getState().target).toBeCloseTo(0)
    }
  })

  it('folds away to its angles until the chevron opens it, remembered per browser', () => {
    setTiltPadOpen(false)
    render(<TooltipProvider><TiltRail /></TooltipProvider>)
    expect(screen.queryByRole('group', { name: 'Tilt pad' })).toBeNull()
    // Folded, the angles still tilt, and the lamp and back to flat still work from the chevron's row
    fireEvent.change(screen.getByTitle('Up/down tilt').querySelector('input')!, { target: { value: '20' } })
    expect(useTilt.getState()).toMatchObject({ source: 'hold', target: 20 })
    fireEvent.click(screen.getByRole('button', { name: 'Back to flat' }))
    expect(useTilt.getState()).toMatchObject({ target: 0, targetX: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Hold up to the light' }))
    expect(useTilt.getState().backlit).toBe(true)
    setTilt({ backlit: false })
    fireEvent.click(screen.getByRole('button', { name: 'Open the tilt pad' }))
    expect(screen.getByRole('group', { name: 'Tilt pad' })).toBeDefined()
    expect(useTiltPad.getState().open).toBe(true)
    expect(localStorage.getItem('of-playground.tilt-pad')).toBe('open')
    fireEvent.click(screen.getByRole('button', { name: 'Fold the tilt pad away' }))
    expect(screen.queryByRole('group', { name: 'Tilt pad' })).toBeNull()
    expect(localStorage.getItem('of-playground.tilt-pad')).toBe('folded')
  })

  it('switches Realistic for every banknote from beside the lamp, remembered per browser', async () => {
    setRealistic(false)
    render(<TooltipProvider><TiltRail /></TooltipProvider>)
    const toggle = screen.getByRole('button', { name: 'Realistic' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    // On the lamp's row, just after it
    const lamp = screen.getByRole('button', { name: 'Hold up to the light' })
    expect(lamp.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(toggle)
    expect(useRealistic.getState().on).toBe(true)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('of-playground.realistic')).toBe('on')
    // A new visit starts as it was left
    vi.resetModules()
    expect((await import('../src/lib/realistic')).useRealistic.getState().on).toBe(true)
    fireEvent.click(toggle)
    expect(useRealistic.getState().on).toBe(false)
    expect(localStorage.getItem('of-playground.realistic')).toBe('off')
    vi.resetModules()
    expect((await import('../src/lib/realistic')).useRealistic.getState().on).toBe(false)
  })

  it('ignores a right-click', () => {
    const pad = renderPad()
    fireEvent.pointerDown(pad, { button: 2, buttons: 2, ...at(0, 30) })
    fireEvent.pointerMove(pad, { buttons: 2, ...at(0, 40) })
    expect(useTilt.getState()).toMatchObject({ source: 'drag', target: 0 })
  })
})

describe('tilt pad curve', () => {
  it('is fine near flat and fast at the edges, reaching the full tilt', () => {
    expect(padToTilt(1)).toBe(1)
    expect(padToTilt(-1)).toBe(-1)
    expect(padToTilt(0.5)).toBeCloseTo(0.379, 3)
    expect(padToTilt(0.1)).toBeCloseTo(0.0398, 3)
    expect(tiltToPad(padToTilt(-0.7))).toBeCloseTo(-0.7)
  })
})
