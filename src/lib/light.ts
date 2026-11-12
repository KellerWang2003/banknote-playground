import { clamp } from './frames'
import type { Tilt2 } from './lens'
import { type Quarter, unturn } from './rotate'

/**
 * How clearly the watermark shows (Keller, 3 November). Flat in reflected light it is only a hint; tilting the banknote
 * either way brings it out with no light needed, clear from WATERMARK_TILT_DEG on; held to the light (the lamp, L, or a
 * Hold to light move) it shows clearly even flat. Nothing else changes: the design and the thread look the same in any
 * light. Both views and the export use these numbers. Demo on a phone shows it by the room's light instead (below).
 */

/** Share of the watermark's depth that shows flat in reflected light: only a hint */
export const WATERMARK_FAINT = 0.05
/** Share of its depth that tilting alone shows, from WATERMARK_TILT_DEG on: all of it, as clear as held to the light */
export const WATERMARK_TILTED = 1
/** Tilt, whichever way, from which tilting shows the watermark as much as it can */
export const WATERMARK_TILT_DEG = 30
/** Seconds the light switch takes to fade the light in or out */
export const LIGHT_RAMP_SECONDS = 0.25

const RAD = Math.PI / 180

/** How far the banknote faces away from the viewer, in degrees, for both tilts together */
export function offAxisDeg(tilt: Tilt2) {
  return Math.acos(clamp(Math.cos(tilt.y * RAD) * Math.cos(tilt.x * RAD), -1, 1)) / RAD
}

/** How far a tilt brings the watermark out, of as far as tilting can: 0 flat, easing up to 1 at WATERMARK_TILT_DEG and beyond */
export function tiltReveal(tilt: Tilt2) {
  const t = clamp(offAxisDeg(tilt) / WATERMARK_TILT_DEG, 0, 1)
  return t * t * (3 - 2 * t)
}

/** How far tilting alone reveals it, on the scale from flat in reflected light (0) to held to the light (1) */
const TILTED_REVEAL = (WATERMARK_TILTED - WATERMARK_FAINT) / (1 - WATERMARK_FAINT)

/**
 * How clearly the watermark shows, 0 (flat in reflected light) to 1 (held to the light): the light from behind or the
 * tilt, whichever shows it more; tilting alone only takes it to WATERMARK_TILTED of its depth
 */
export const watermarkReveal = (light: number, tilt: Tilt2) => Math.max(clamp(light, 0, 1), TILTED_REVEAL * tiltReveal(tilt))

/** The watermark layer's opacity at a reveal: WATERMARK_FAINT of its depth at 0, all of it at 1 */
export const watermarkOpacity = (depth: number, reveal: number) =>
  depth * (WATERMARK_FAINT + (1 - WATERMARK_FAINT) * clamp(reveal, 0, 1))

/**
 * Demo on a phone lights the banknote as a room does (Keller, 12 November: lit by "the actual orientation of the device",
 * which Recentre doesn't reset, as "recenter only recenters ... the security features, not how light works. And how light
 * works includes like how watermark behaves"; "when I'm laying the phone flat on the table, it should still be bright"):
 * its light comes from above, so how the phone lies in the room (`roomTilt`, deviceTilt.ts) is the tilt the lamp lights
 * the paper at, and its watermark shows by the light that comes through it, not by tilting. Held HELD_DEG from lying flat,
 * facing whoever holds it, the paper is lit as the canvas's banknote at no tilt; lying flat it is as bright; pointing the
 * camera up puts the light behind it, the paper darker and the watermark glowing through it.
 */

/** How far from lying flat a banknote is held to look at it: in Demo on a phone, the room lights it there as the canvas does at no tilt */
export const HELD_DEG = 45
/** How far below level a banknote's back faces as the room's light starts to come through it, degrees: about upright, a little short of it */
export const THROUGH_FROM_DEG = -10
/** How far above level its back faces once the room's light through it shows the watermark as clearly as held to the lamp */
export const THROUGH_DEG = 30

/**
 * The room's up as a banknote at no tilt in the room sees it, along its own sides untilted (x right, y down, z out of its
 * face), rotated `quarter` quarter turns on the view: HELD_DEG off straight out of its face, towards the view's top
 */
export function roomUp(quarter: Quarter = 0): [number, number, number] {
  const top = unturn(0, -1, quarter)
  const s = Math.sin(HELD_DEG * RAD)
  return [s * top.x + 0, s * top.y + 0, Math.cos(HELD_DEG * RAD)]
}

/**
 * How far above level a banknote's back faces, degrees, with the room's up `up` along its own sides (x right, y down, z
 * out of its face: `roomTilt`), and the banknote turned `by` further in the hand (rotateX(y) rotateY(x)): −90 lying flat,
 * −HELD_DEG held, 0 upright
 */
export function backRise(up: readonly number[], by: Tilt2 = { x: 0, y: 0 }) {
  const sx = Math.sin(by.x * RAD), cx = Math.cos(by.x * RAD), sy = Math.sin(by.y * RAD), cy = Math.cos(by.y * RAD)
  // The banknote's face, so turned, against the room's up
  const facing = sx * up[0] - sy * cx * up[1] + cy * cx * up[2]
  return Math.asin(clamp(-facing / (Math.hypot(up[0], up[1], up[2]) || 1), -1, 1)) / RAD
}

/**
 * How much of the room's light comes through a banknote, with the room's up `up` along its own sides (`roomTilt`) and the
 * banknote turned `by` further in the hand, on the scale from flat in reflected light (0) to held to the light (1): none
 * while it lies or is held facing up, some as it comes upright, all of it once its back faces THROUGH_DEG up, as pointing
 * the phone's camera up does
 */
export function roomThrough(up: readonly number[], by?: Tilt2) {
  const t = clamp((backRise(up, by) - THROUGH_FROM_DEG) / (THROUGH_DEG - THROUGH_FROM_DEG), 0, 1)
  return t * t * (3 - 2 * t)
}
