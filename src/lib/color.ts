/**
 * Colours as the colour fields keep them, `#rrggbb`, and as their picker shows them (`ColorPicker`): a hue, and a
 * saturation and brightness, Figma's hue strip and square
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
