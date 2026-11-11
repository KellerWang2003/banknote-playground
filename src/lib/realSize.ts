/**
 * Real size in Demo (Keller, 10 November: "select which banknote to display full screen, in real size"): the banknote as
 * big on the screen as it prints. Browsers don't say how big a screen really is (a CSS px is only nominally 1/96 inch),
 * so how many CSS px make a millimetre is guessed from the device, about 5 on a MacBook at its usual scaling and 6 on a
 * recent iPhone, until it is checked once against a bank card, which is the same size everywhere (ISO/IEC 7810 ID-1,
 * 85.60 × 53.98 mm). A check is kept in this browser for each screen, by its size, so a laptop and an external display
 * keep their own, and as device pixels per mm, so the browser's zoom, which changes the CSS px, doesn't throw it off.
 */
import { create } from 'zustand'

/** A bank card, mm */
export const CARD_MM = { width: 85.6, height: 53.98 } as const
/** A bank card's corners, mm */
export const CARD_RADIUS_MM = 3.18
const KEY = 'of-playground.real-size'

/** What the guess goes by */
export interface Device {
  userAgent: string
  /** Device pixels per CSS px */
  dpr: number
  /** Touch points the screen takes (an iPad says it is a Mac, but takes touch) */
  touchPoints: number
  /** The screen's size, CSS px */
  screen: { width: number; height: number }
}

/** MacBook screens at their usual scaling, by their size in CSS px: px per mm from each panel's width */
const MACBOOKS: Record<string, number> = {
  '1470x956': 5.08, // MacBook Air 13" (M2 and later): 1470 px across 289.6 mm
  '1440x932': 4.41, // MacBook Air 15": 1440 px across 326.2 mm
  '1512x982': 5.0, // MacBook Pro 14": 1512 px across 302.5 mm
  '1728x1117': 5.0, // MacBook Pro 16": 1728 px across 345.6 mm
}

export function currentDevice(): Device {
  const screen = globalThis.screen
  return {
    userAgent: globalThis.navigator?.userAgent ?? '',
    dpr: globalThis.devicePixelRatio || 1,
    touchPoints: globalThis.navigator?.maxTouchPoints ?? 0,
    screen: { width: screen?.width ?? 0, height: screen?.height ?? 0 },
  }
}

/**
 * CSS px per mm on this device, guessed: an iPhone's from its pixel density (460 ppi at 3× on recent ones, 326 at 2×), an
 * iPad's (264 ppi at 2×, the mini 326), Android's from its CSS px of a 160th of an inch, a MacBook's from its screen, and
 * anything else the nominal 96 to the inch
 */
export function guessPxPerMm(device: Device = currentDevice()) {
  const { userAgent: ua, dpr, touchPoints, screen } = device
  if (/iPhone|iPod/.test(ua)) return dpr >= 3 ? 6.04 : 6.42
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return Math.min(screen.width, screen.height) === 744 ? 6.42 : 5.2
  if (/Android/.test(ua)) return 160 / 25.4
  if (/Macintosh/.test(ua)) return MACBOOKS[`${screen.width}x${screen.height}`] ?? 5
  return 96 / 25.4
}

/** Which screen a check belongs to: its size, whichever way round it is held */
export const screenKey = ({ width, height }: Device['screen']) => `${Math.max(width, height)}x${Math.min(width, height)}`

/** Device pixels per mm, by screen, as checked against a card */
type Checked = Record<string, number>

function read(): Checked {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!saved || typeof saved !== 'object') return {}
    return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0))
  } catch {
    return {}
  }
}

export const useRealSize = create<{ checked: Checked }>(() => ({ checked: read() }))

/** CSS px per mm at real size on this screen: as checked against a card, else guessed */
export function realPxPerMm(checked: Checked = useRealSize.getState().checked, device: Device = currentDevice()) {
  const stored = checked[screenKey(device.screen)]
  return stored ? stored / device.dpr : guessPxPerMm(device)
}

/** Whether this screen has been checked against a card */
export const isChecked = (checked: Checked = useRealSize.getState().checked, device: Device = currentDevice()) =>
  screenKey(device.screen) in checked

/** Keeps a card check for this screen: `cssPxPerMm` CSS px per mm at the browser's zoom now */
export function setRealPxPerMm(cssPxPerMm: number, device: Device = currentDevice()) {
  const checked = { ...useRealSize.getState().checked, [screenKey(device.screen)]: cssPxPerMm * device.dpr }
  useRealSize.setState({ checked })
  try {
    localStorage.setItem(KEY, JSON.stringify(checked))
  } catch { /* storage blocked: the check lasts until reload */ }
}
