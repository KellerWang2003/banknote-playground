import { create } from 'zustand'

/**
 * Colours as the colour fields keep them, `#rrggbb`, and as their picker shows them (`ColorPicker`): a hue, and a
 * saturation and brightness, Figma's hue strip and square, and typed in the colour mode picked (Hex, RGB, HSB, HSL)
 */

/** A colour's hue (0 to 360) and its saturation and brightness (HSV's value), each 0 to 1 */
export interface Hsv {
  h: number
  s: number
  v: number
}

const HEX = /^#([0-9a-f]{6})$/i

/** A `#rrggbb` colour's hue, saturation and brightness, or undefined for anything else */
export function hexToHsv(hex: string): Hsv | undefined {
  const match = HEX.exec(hex)
  if (!match) return undefined
  const n = parseInt(match[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const range = max - Math.min(r, g, b)
  let h = 0
  if (range > 0) {
    if (max === r) h = ((g - b) / range + 6) % 6
    else if (max === g) h = (b - r) / range + 2
    else h = (r - g) / range + 4
  }
  return { h: h * 60, s: max === 0 ? 0 : range / max, v: max }
}

/** The `#rrggbb` colour of a hue, saturation and brightness */
export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(5)}${channel(3)}${channel(1)}`
}

/**
 * The hue, saturation and brightness to show for `hex`, coming from `from`, where the picker was last set: `from` itself
 * while it is still that colour, so a thumb stays exactly where it was dragged to, else `hex`'s own; but a grey has no
 * hue of its own and black no saturation either, so those stay as they were, and the square and strip don't jump back
 * to red when a drag reaches either (Figma's)
 */
export function hsvFor(hex: string, from: Hsv): Hsv {
  if (hsvToHex(from) === hex.toLowerCase()) return from
  const next = hexToHsv(hex)
  if (!next) return from
  if (next.v === 0) return { h: from.h, s: from.s, v: 0 }
  if (next.s === 0) return { ...next, h: from.h }
  return next
}

/** The `#rrggbb` colour the browser's eyedropper picked (`#rrggbb`, or an `rgb()` some browsers may give), if it's one */
export function pickedHex(color: string): string | undefined {
  const value = color.trim().toLowerCase()
  if (HEX.test(value)) return value
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\b/.exec(value)
  if (!rgb) return undefined
  const channels = rgb.slice(1, 4).map(Number)
  if (channels.some((c) => c > 255)) return undefined
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** A `#rrggbb` colour's red, green and blue, each 0 to 255, or undefined for anything else */
export function hexToRgb(hex: string): [number, number, number] | undefined {
  const match = HEX.exec(hex)
  if (!match) return undefined
  const n = parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The `#rrggbb` colour of a red, green and blue, each rounded to a whole number from 0 to 255 */
export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

/** A colour's hue (0 to 360), and its saturation and lightness as HSL reads them, each 0 to 1 */
export interface Hsl {
  h: number
  s: number
  l: number
}

/** HSB's colour as HSL reads it: the same hue, a lightness, and a saturation of its own */
export function hsvToHsl({ h, s, v }: Hsv): Hsl {
  const l = v * (1 - s / 2)
  return { h, s: l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l }
}

/** HSL's colour as HSB reads it */
export function hslToHsv({ h, s, l }: Hsl): Hsv {
  const v = l + s * Math.min(l, 1 - l)
  return { h, s: v === 0 ? 0 : 2 * (1 - l / v), v }
}

/**
 * The `#rrggbb` colour typed into a hex field, with its # or without, any case: six digits, or three (Figma's shorthand,
 * F80 for FF8800) once `shorthand` allows it, as it does when the field is left, so typing six never stops at three
 */
export function typedHex(text: string, shorthand = false): string | undefined {
  const digits = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())?.[1].toLowerCase()
  if (!digits || (digits.length === 3 && !shorthand)) return undefined
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits}`
}

/** How the picker's colour is typed: its hex, or its three numbers in RGB, HSB or HSL, as Figma's picker offers */
export type ColorMode = 'hex' | 'rgb' | 'hsb' | 'hsl'

export const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'hex', label: 'Hex' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsb', label: 'HSB' },
  { value: 'hsl', label: 'HSL' },
]

/** The three numbers a mode types a colour as: R, G, B 0 to 255; H 0 to 360, then S and B, or S and L, 0 to 100 */
export function colorChannels(mode: Exclude<ColorMode, 'hex'>, hsv: Hsv): [number, number, number] {
  if (mode === 'rgb') return hexToRgb(hsvToHex(hsv)) ?? [0, 0, 0]
  if (mode === 'hsb') return [hsv.h, hsv.s * 100, hsv.v * 100]
  const { h, s, l } = hsvToHsl(hsv)
  return [h, s * 100, l * 100]
}

/**
 * The colour with one of its numbers in `mode` (the `channel`th, from 0) typed or scrubbed to `value`, the others kept;
 * a grey keeps the hue it was shown with, as `hsvFor` keeps it
 */
export function withColorChannel(mode: Exclude<ColorMode, 'hex'>, hsv: Hsv, channel: number, value: number): Hsv {
  const numbers = colorChannels(mode, hsv)
  numbers[channel] = value
  const [a, b, c] = numbers
  if (mode === 'rgb') return hsvFor(rgbToHex([a, b, c]), hsv)
  if (mode === 'hsb') return { h: a, s: b / 100, v: c / 100 }
  return hslToHsv({ h: a, s: b / 100, l: c / 100 })
}

const MODE_KEY = 'of-playground.colour-mode'

function loadMode(): ColorMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    const known = COLOR_MODES.find((m) => m.value === saved)
    if (known) return known.value
  } catch { /* storage blocked: Hex */ }
  return 'hex'
}

/** The colour mode every picker opens in: the last one picked in this browser, as the length unit is, Hex at first */
export const useColorMode = create<{ mode: ColorMode }>(() => ({ mode: loadMode() }))

/** Types every picker's colour in `mode` from now on, in this browser */
export function setColorMode(mode: ColorMode) {
  useColorMode.setState({ mode })
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch { /* storage blocked: it lasts until reload */ }
}
