import { describe, expect, it } from 'vitest'
import { eyesOf } from '../src/lib/faceTracker'

describe('a face’s eyes from its mesh', () => {
  /** A mesh of 478 points, all at the picture's middle but those given */
  const mesh = (points: Record<number, { x: number; y: number }>) =>
    Array.from({ length: 478 }, (_, i) => points[i] ?? { x: 0.5, y: 0.5 })

  it('are the middle of each eye’s two corners, the viewer’s right eye on the picture’s left', () => {
    const eyes = eyesOf(mesh({ 33: { x: 0.3, y: 0.4 }, 133: { x: 0.4, y: 0.42 }, 362: { x: 0.5, y: 0.42 }, 263: { x: 0.6, y: 0.4 } }))!
    expect(eyes.right.x).toBeCloseTo(0.35, 12)
    expect(eyes.right.y).toBeCloseTo(0.41, 12)
    expect(eyes.left.x).toBeCloseTo(0.55, 12)
    expect(eyes.left.y).toBeCloseTo(0.41, 12)
  })

  it('stay put as the eyes look about: the irises, which the mesh has too, don’t count', () => {
    const corners = { 33: { x: 0.3, y: 0.4 }, 133: { x: 0.4, y: 0.4 }, 362: { x: 0.5, y: 0.4 }, 263: { x: 0.6, y: 0.4 } }
    const ahead = eyesOf(mesh({ ...corners, 468: { x: 0.35, y: 0.4 }, 473: { x: 0.55, y: 0.4 } }))
    const aside = eyesOf(mesh({ ...corners, 468: { x: 0.38, y: 0.4 }, 473: { x: 0.58, y: 0.4 } }))
    expect(aside).toEqual(ahead)
  })

  it('are none for a mesh without them', () => {
    expect(eyesOf([])).toBeUndefined()
    expect(eyesOf(mesh({}).slice(0, 200))).toBeUndefined()
  })
})
