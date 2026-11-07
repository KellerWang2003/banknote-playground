export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)

/**
 * Degrees of tilt each frame shows for: its share of the timeline applied to the full cycle. The cycle
 * starts flat at 0° and reaches its final frame at the full cycle angle, then loops.
 */
export function frameSpans(note: { frames: { length: number }[]; tilt: { cycleDeg: number } }) {
  const total = sum(note.frames.map((f) => f.length)) || 1
  return note.frames.map((f) => (f.length / total) * note.tilt.cycleDeg)
}

const cycleDeg = (spans: number[]) => sum(spans)

/** Flat is the start; retain the endpoint at the right edge before angles beyond it loop. */
export function cyclePhase(angle: number, cycle: number) {
  if (cycle <= 0) return 0
  if (angle >= 0 && angle <= cycle) return angle / cycle
  return (((angle % cycle) + cycle) % cycle) / cycle
}

/** The angle range that shows frame `index` */
export function sliceRange(index: number, spans: number[]): [number, number] {
  const start = spans.slice(0, index).reduce((sum, s) => sum + s, 0)
  return [start, start + (spans.at(index) ?? 0)]
}

/** Dragging, the tilt pad and playback can tilt a banknote this far either way: edge-on, as far as a real one goes */
export const TILT_LIMIT = 90
/** The tilt at which light and shade on a banknote reach full strength (they keep growing past it) */
export const SHADE_DEG = 60
/**
 * How far the viewer is from a banknote turning in 3D, px at `scale` px per mm, the canvas's and the exports' perspective:
 * a short one, relative to the banknote's size, so the near edge visibly widens and the far edge narrows
 */
export const perspectiveFor = (note: { widthMm: number; heightMm: number }, scale: number) => 2.2 * Math.max(note.widthMm, note.heightMm) * scale

/**
 * Which frames show at a tilt angle, with frames of any length. The cycle starts flat and loops:
 * tilting past either end starts the frames again. `base` is drawn fully and `next` on top of it at
 * `blend` opacity, so a crossfade never dips through to the paper. The crossfade straddles each
 * boundary, the loop's included, and is a fraction of the shorter of the two frames meeting there.
 */
export function frameMix(angle: number, spans: number[], transition: number) {
  const count = spans.length
  const total = cycleDeg(spans)
  if (count === 0 || total <= 0) return { base: 0, next: 0, blend: 0, current: 0 }
  const span = (i: number) => spans.at(i) ?? 0
  // Position within one cycle, from 0 at its start
  const a = cyclePhase(angle, total) * total
  let start = 0
  let i = 0
  while (i < count - 1 && a >= start + span(i)) {
    start += span(i)
    i++
  }
  const end = start + span(i)
  const nextI = (i + 1) % count
  const prevI = (i - 1 + count) % count
  if (count > 1 && transition > 0) {
    const toNext = (transition / 2) * Math.min(span(i), span(nextI))
    if (a > end - toNext) {
      const blend = smoothstep(end - toNext, end + toNext, a)
      return { base: i, next: nextI, blend, current: blend >= 0.5 ? nextI : i }
    }
    const fromPrev = (transition / 2) * Math.min(span(prevI), span(i))
    if (a < start + fromPrev) {
      const blend = smoothstep(start - fromPrev, start + fromPrev, a)
      return { base: prevI, next: i, blend, current: blend >= 0.5 ? i : prevI }
    }
  }
  return { base: i, next: i, blend: 0, current: i }
}

export const formatDeg = (deg: number) => {
  const rounded = Math.round(deg)
  return `${rounded < 0 ? '−' : rounded > 0 ? '+' : ''}${Math.abs(rounded)}°`
}
