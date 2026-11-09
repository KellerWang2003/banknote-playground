import { create } from 'zustand'

/**
 * Realistic: every banknote's magnetic ink lit as metal flakes (realisticInk.ts) and its Arc-en-Ciel drawn as embossed
 * ridges (arcEnCiel.ts), both in the lamp's light, where the browser can (WebGL); off, they keep their flat looks. One
 * switch for every banknote, beside the lamp on the tilt card (Keller, 9 November: one universal toggle in place of a
 * switch on each layer's tab, which saved it on the layer). A way of looking, not part of a project: remembered per
 * browser, as the tilt pad's open or folded is, and exports follow it as they follow the lamp.
 */
const KEY = 'of-playground.realistic'

function load() {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch { /* storage blocked: off */ }
  return false
}

export const useRealistic = create<{ on: boolean }>(() => ({ on: load() }))

export function setRealistic(on: boolean) {
  useRealistic.setState({ on })
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch { /* storage blocked: it lasts until reload */ }
}
