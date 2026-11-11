import { create } from 'zustand'

/**
 * The right-hand control panel's width in px: drag its left edge to change it, remembered per browser. At least 280 (248
 * until 10 November), so the corner bar over it has room for ▶ Demo beside Export
 */
export const PANEL_WIDTH = { min: 280, max: 640, initial: 280 }
const KEY = 'of-playground.panel-width'

function load() {
  try {
    const saved = Number(localStorage.getItem(KEY))
    if (Number.isFinite(saved) && saved > 0) return clampWidth(saved)
  } catch { /* storage blocked: use the default */ }
  return PANEL_WIDTH.initial
}

/** Keeps the panel between its limits and never wider than half the window */
export function clampWidth(width: number) {
  const half = typeof window === 'undefined' ? PANEL_WIDTH.max : Math.max(PANEL_WIDTH.min, window.innerWidth / 2)
  return Math.round(Math.min(Math.max(width, PANEL_WIDTH.min), PANEL_WIDTH.max, half))
}

export const usePanelWidth = create<{ width: number }>(() => ({ width: load() }))

export function setPanelWidth(width: number) {
  usePanelWidth.setState({ width: clampWidth(width) })
}

export function savePanelWidth() {
  try {
    localStorage.setItem(KEY, String(usePanelWidth.getState().width))
  } catch { /* storage blocked: the width lasts until reload */ }
}

// Everything laid out beside the panel (timeline, canvas toolbar) reads this CSS variable
function apply(width: number) {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--panel-w', `${width}px`)
}
apply(usePanelWidth.getState().width)
usePanelWidth.subscribe((s) => apply(s.width))
