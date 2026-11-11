// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { popupOpen } from '../src/lib/popups'

afterEach(() => { document.body.innerHTML = '' })

describe('popupOpen', () => {
  it('counts a popup showing, but not one left in the page hidden, nor the one it is told to leave out', () => {
    expect(popupOpen()).toBe(false)
    // Base UI leaves a dropdown's list in the page, hidden on its positioner, once its trigger has had the keyboard
    document.body.innerHTML = '<div hidden><div><div role="listbox"></div></div></div>'
    expect(popupOpen()).toBe(false)
    document.body.insertAdjacentHTML('beforeend', '<div role="listbox" hidden></div>')
    expect(popupOpen()).toBe(false)
    document.body.insertAdjacentHTML('beforeend', '<div role="menu"></div>')
    expect(popupOpen()).toBe(true)
    // Only what it is asked about
    expect(popupOpen('[role="dialog"]')).toBe(false)
    // Demo's own view is a dialog that isn't a popup over it
    document.body.innerHTML = '<div role="dialog" id="demo"></div>'
    expect(popupOpen(undefined, document.getElementById('demo'))).toBe(false)
    expect(popupOpen()).toBe(true)
  })
})
