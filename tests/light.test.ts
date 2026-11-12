import { describe, expect, it, vi } from 'vitest'
import { drawFace, exportReveal, playbackLights, playbackTilts } from '../src/lib/exportRender'
import {
  HELD_DEG, THROUGH_DEG, THROUGH_FROM_DEG, WATERMARK_FAINT, WATERMARK_TILTED, WATERMARK_TILT_DEG, backRise, offAxisDeg, roomThrough, tiltReveal,
  watermarkOpacity, watermarkReveal,
} from '../src/lib/light'
import { lensState } from '../src/lib/lens'
import { PAPER } from '../src/lib/back'
import { createNote } from '../src/lib/notes'
import { lightAt, playbackPlan, tiltAt } from '../src/lib/moves'
import type { TiltSettings } from '../src/lib/types'

vi.mock('../src/lib/images', () => ({ loadImageUrl: async () => undefined }))

const frames = [10, 10, 10].map((length, i) => ({ id: String(i), kind: 'color' as const, color: '#000', name: '', length }))
const base = { cycleDeg: 40, cycleXDeg: 80, effect: 'both', transition: 0, speed: 1, curve: 'linear' } as TiltSettings

describe('how clearly the watermark shows', () => {
  it('measures how far the banknote faces away, whichever way it tilts', () => {
    expect(offAxisDeg({ x: 0, y: 0 })).toBe(0)
    expect(offAxisDeg({ x: 0, y: -25 })).toBeCloseTo(25)
    expect(offAxisDeg({ x: 30, y: 0 })).toBeCloseTo(30)
    // Both at once face further away than either alone
    expect(offAxisDeg({ x: 20, y: 20 })).toBeGreaterThan(20)
  })

  it('comes out as the banknote tilts either way, as far as tilting goes from WATERMARK_TILT_DEG on', () => {
    expect(tiltReveal({ x: 0, y: 0 })).toBe(0)
    expect(tiltReveal({ x: 0, y: WATERMARK_TILT_DEG / 2 })).toBeCloseTo(0.5)
    expect(tiltReveal({ x: 0, y: -WATERMARK_TILT_DEG })).toBe(1)
    expect(tiltReveal({ x: 60, y: 0 })).toBe(1)
    expect(tiltReveal({ x: 0, y: 10 })).toBeLessThan(tiltReveal({ x: 0, y: 20 }))
    expect(tiltReveal({ x: 10, y: 0 })).toBeCloseTo(tiltReveal({ x: 0, y: -10 }))
  })

  it('shows clearly held to the light at any tilt, and the tilt can only add to the light', () => {
    expect(watermarkReveal(0, { x: 0, y: 0 })).toBe(0)
    expect(watermarkReveal(1, { x: 0, y: 0 })).toBe(1)
    expect(watermarkReveal(0.4, { x: 0, y: 0 })).toBeCloseTo(0.4)
    expect(watermarkReveal(0.2, { x: 0, y: 20 })).toBeCloseTo(tiltReveal({ x: 0, y: 20 }))
    expect(watermarkReveal(1, { x: 0, y: 70 })).toBe(1)
    expect(watermarkReveal(3, { x: 0, y: 0 })).toBe(1)
  })

  it('is only a hint flat in reflected light, comes out fully as the banknote tilts with no light, and shows flat held to the light', () => {
    const depth = 0.8
    const shown = (light: number, tilt: { x: number; y: number }) => watermarkOpacity(depth, watermarkReveal(light, tilt))
    expect(shown(0, { x: 0, y: 0 })).toBeCloseTo(depth * WATERMARK_FAINT)
    expect(WATERMARK_FAINT).toBeLessThanOrEqual(0.1)
    // Tilting alone, either way, shows it a whole lot more: all of it from WATERMARK_TILT_DEG on
    expect(shown(0, { x: 0, y: 15 })).toBeGreaterThan(depth / 2)
    expect(shown(0, { x: 0, y: -WATERMARK_TILT_DEG })).toBeCloseTo(depth * WATERMARK_TILTED)
    expect(shown(0, { x: 60, y: 0 })).toBeCloseTo(depth)
    // Held to the light, all of it even flat
    expect(shown(1, { x: 0, y: 0 })).toBeCloseTo(depth)
  })

  it('draws a faint share of its depth flat and all of it at its clearest', () => {
    expect(watermarkOpacity(0.6, 0)).toBeCloseTo(0.6 * WATERMARK_FAINT)
    expect(watermarkOpacity(0.6, 1)).toBeCloseTo(0.6)
    expect(watermarkOpacity(0.6, 0.5)).toBeCloseTo(0.6 * (WATERMARK_FAINT + (1 - WATERMARK_FAINT) / 2))
    expect(watermarkOpacity(0, 1)).toBe(0)
    expect(watermarkOpacity(1, 2)).toBe(1)
  })
})

describe('the room’s light through the watermark, in Demo on a phone', () => {
  const RAD = Math.PI / 180
  // The room's up along the banknote's own sides (x right, y down, z out of its face), the phone tipped `beta` from lying
  // flat towards upright and on past it, facing whoever holds it
  const pitched = (beta: number): [number, number, number] => [0, -Math.sin(beta * RAD), Math.cos(beta * RAD)]

  it('measures how far the banknote’s back faces up from the room’s up along its sides', () => {
    expect(backRise(pitched(0))).toBeCloseTo(-90)
    expect(backRise(pitched(HELD_DEG))).toBeCloseTo(-HELD_DEG)
    // Upright, then the camera pointing up
    expect(backRise(pitched(90))).toBeCloseTo(0)
    expect(backRise(pitched(120))).toBeCloseTo(30)
    // Face down overhead, the light behind it, and face down flat
    expect(backRise(pitched(150))).toBeCloseTo(60)
    expect(backRise(pitched(180))).toBeCloseTo(90)
    // On its side, level, whichever side; tipped back past it
    expect(backRise([1, 0, 0])).toBeCloseTo(0)
    expect(backRise([-0.5, 0, -Math.sqrt(3) / 2])).toBeCloseTo(60)
    // However long the up it is given
    expect(backRise([0, -2, 0])).toBeCloseTo(0)
  })

  it('takes a drag as turning the banknote further in the hand', () => {
    // Upright, its top pushed away: its face turns up to the room, its back as far down
    expect(backRise(pitched(90), { x: 0, y: 20 })).toBeCloseTo(-20)
    // Held, its top pulled back to upright
    expect(backRise(pitched(HELD_DEG), { x: 0, y: -HELD_DEG })).toBeCloseTo(0)
    // Lying flat, turned onto its side
    expect(backRise(pitched(0), { x: 90, y: 0 })).toBeCloseTo(0)
  })

  it('comes through only as the back turns up to the light: none lying flat or held, some upright, all of it camera up', () => {
    expect(roomThrough(pitched(0))).toBe(0)
    expect(roomThrough(pitched(HELD_DEG))).toBe(0)
    expect(roomThrough(pitched(90 + THROUGH_FROM_DEG))).toBeCloseTo(0)
    const upright = roomThrough(pitched(90))
    expect(upright).toBeGreaterThan(0)
    expect(upright).toBeLessThan(0.3)
    expect(roomThrough(pitched(100))).toBeGreaterThan(upright)
    expect(roomThrough(pitched(90 + THROUGH_DEG))).toBeCloseTo(1)
    expect(roomThrough(pitched(150))).toBe(1)
    expect(roomThrough(pitched(180))).toBe(1)
    // On its side, as upright
    expect(roomThrough([1, 0, 0])).toBeCloseTo(upright)
    // The camera pointing up, a drag turning it back to upright
    expect(roomThrough(pitched(90 + THROUGH_DEG), { x: 0, y: THROUGH_DEG })).toBeCloseTo(upright)
  })
})

describe('exported light', () => {
  it('holds each frame to the light as live playback does, in step with its tilt', () => {
    const tilt = { ...base, moves: [{ id: 'a', kind: 'y', from: -10, y: 10 }, { id: 'l', kind: 'light' }] } as TiltSettings
    const plan = playbackPlan(tilt, lensState(tilt, frames))
    const fps = 30
    const tilts = playbackTilts({ tilt, frames }, fps)
    const lights = playbackLights({ tilt, frames }, fps)
    expect(lights).toHaveLength(tilts.length)
    lights.forEach((light, i) => {
      expect(light).toBeCloseTo(lightAt(plan, i / fps))
      expect(tilts[i]).toEqual(tiltAt(plan, i / fps))
    })
    // In reflected light while it tilts, and up to the light by the end
    expect(Math.max(...lights.slice(0, fps))).toBe(0)
    expect(Math.max(...lights)).toBe(1)
  })

  it('shows the watermark as the canvas does: clear in every frame with the lamp switch on, otherwise by its light or tilt', () => {
    expect(exportReveal(0, { x: 0, y: 0 })).toBe(0)
    expect(exportReveal(0, { x: 0, y: 0 }, true)).toBe(1)
    expect(exportReveal(0.5, 0)).toBeCloseTo(0.5)
    expect(exportReveal(0.5, 0, true)).toBe(1)
    expect(exportReveal(0, 20)).toBeCloseTo(watermarkReveal(0, { x: 0, y: 20 }))
    expect(exportReveal(0, { x: 50, y: 0 })).toBe(1)
  })

  it('draws the watermark over the design and under the thread as light through it, at its reveal, and nothing else differently', () => {
    const note = { ...createNote({ name: 'N', x: 0, y: 0, widthMm: 100, heightMm: 50, color: '#336699' }), watermark: { imageId: 'w', xMm: 10, yMm: 5, widthMm: 20, heightMm: 30, depth: 0.6 } }
    const canvas = { width: 1, height: 1 } as unknown as HTMLCanvasElement
    const relief = { canvas }
    /** Every image drawn, and every fill, with the blend and opacity it was drawn at */
    const draw = (reveal?: number, tilt = 0) => {
      const calls: { what: string; blend: string; alpha: number; at?: number[] }[] = []
      const ctx = new Proxy({ globalCompositeOperation: 'source-over', globalAlpha: 1 } as Record<string, unknown>, {
        get(target, key) {
          if (key in target) return target[key as string]
          if (key === 'drawImage') return (image: unknown, ...at: number[]) => calls.push({ what: image === canvas ? 'watermark' : 'image', blend: String(target.globalCompositeOperation), alpha: Number(target.globalAlpha), at })
          if (key === 'fillRect') return () => calls.push({ what: `fill ${String(target.fillStyle)}`, blend: String(target.globalCompositeOperation), alpha: Number(target.globalAlpha) })
          if (key === 'createLinearGradient') return () => ({ addColorStop() {} })
          return () => {}
        },
        set(target, key, value) {
          target[key as string] = value
          return true
        },
      }) as unknown as CanvasRenderingContext2D
      drawFace(ctx, note, { frames: new Map(), relief }, 2, tilt, { sheen: false, perspective: true, reveal })
      return calls
    }
    const flat = draw()
    const watermark = flat.find((c) => c.what === 'watermark')!
    // Colour-dodged, so it only brightens the design, at how much light comes through
    expect(watermark).toMatchObject({ blend: 'color-dodge', alpha: watermarkOpacity(0.6, 0), at: [20, 10, 40, 60] })
    // The paper first, then the watermark, then the thread (frames are colours here), all drawn normally
    expect(flat.map((c) => c.what).slice(0, 2)).toEqual([`fill ${PAPER}`, 'watermark'])
    expect(flat.filter((c) => c.what !== 'watermark').every((c) => c.blend === 'source-over' && c.alpha === 1)).toBe(true)
    expect(draw(undefined, 20).find((c) => c.what === 'watermark')!.alpha).toBeCloseTo(watermarkOpacity(0.6, watermarkReveal(0, { x: 0, y: 20 })))
    expect(draw(1).find((c) => c.what === 'watermark')!.alpha).toBeCloseTo(0.6)
  })
})
