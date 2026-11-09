import { describe, expect, it } from 'vitest'
import {
  ARC_BAND, ARC_LINE_POINTS, ARC_POINTS, ARC_SHEEN, ARC_SLIDE_BANDS, ARC_SLIDE_DEG, CURVE_STEPS, DEFAULT_ARC, arcLight, averageRgb,
  bandColour, bandSlide, canRemove, curveControls, curvePoints, fitArcEnCiel, lineDistance, linearRgb, newArcEnCiel, ridgeLight, sampleCurve,
  srgbBytes, withArcImage, withBend, withLineMoved, withPoint, withSpot, withoutSpot,
} from '../src/lib/arcEnCiel'
import { bandDistance, bandLook, bandPixels, convexHull, embossField, needsShape, shapeMaps, squaredDistances } from '../src/lib/bandMap'
import { LAMP_HEIGHT_DEG } from '../src/lib/realisticInk'
import { onFront } from '../src/lib/layers'
import { newMagneticInk } from '../src/lib/magneticInk'
import { createNote, createProject, migrateProject } from '../src/lib/notes'
import { projectImageIds } from '../src/cloud/repository'
import type { ArcEnCiel } from '../src/lib/types'
import { newWatermark } from '../src/lib/watermark'

const note = { widthMm: 150, heightMm: 70 }
const RAD = Math.PI / 180
const arc = (change: Partial<ArcEnCiel> = {}): ArcEnCiel => ({ ...newArcEnCiel(note), xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, ...change })
const overlaps = (a: { xMm: number; yMm: number; widthMm: number; heightMm: number }, b: typeof a) =>
  a.xMm < b.xMm + b.widthMm && b.xMm < a.xMm + a.widthMm && a.yMm < b.yMm + b.heightMm && b.yMm < a.yMm + a.heightMm

/** A coverage grid from rows of text: # is ink, anything else paper */
const grid = (rows: string[]) => ({
  coverage: Uint8ClampedArray.from(rows.join('').split(''), (c) => (c === '#' ? 255 : 0)),
  width: rows[0].length,
  height: rows.length,
})

describe('Arc-en-Ciel settings', () => {
  it('starts as a small square low and right of the middle, clear of a new watermark, magnetic ink and a middle thread', () => {
    const created = newArcEnCiel(note)
    expect(created).toMatchObject({ ...DEFAULT_ARC, widthMm: created.heightMm })
    expect(created.widthMm).toBeGreaterThan(14)
    expect(created.widthMm).toBeLessThan(17)
    expect(overlaps(created, newWatermark(note))).toBe(false)
    expect(overlaps(created, newMagneticInk(note))).toBe(false)
    const { thread } = createNote({ name: 'N', x: 0, y: 0, ...note, color: '#ffffff' })
    expect(thread.direction).toBe('vertical')
    expect(created.xMm).toBeGreaterThan(thread.positionMm + thread.widthMm / 2)
    // On a portrait banknote, high on the left
    const portrait = newArcEnCiel({ widthMm: 70, heightMm: 150 })
    expect(portrait.xMm + portrait.widthMm / 2).toBeLessThan(35)
    expect(portrait.yMm + portrait.heightMm / 2).toBeLessThan(75)
  })

  it('repairs a damaged save: colours, flow, axis, band width, points and the line, and drops what it doesn’t know', () => {
    const damaged = {
      ...arc(), imageId: 'shape', invert: 'yes', flow: 'spiral', axis: 'z', bandMm: 99, colors: ['#ff0000', 'red', '#00ff00'],
      points: [{ x: 5, y: -3 }, { x: 'a' }], line: [{ x: 0.5, y: 0.5 }], extra: true,
    } as unknown as ArcEnCiel
    const fitted = fitArcEnCiel(damaged, note)
    expect(fitted).toEqual({
      imageId: 'shape', xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, flow: 'edge', axis: 'y', bandMm: ARC_BAND.max,
      // Two good colours, and the defaults' third for the missing one
      colors: ['#ff0000', '#00ff00', DEFAULT_ARC.colors[2]],
      // Points kept within a box's size of it; a line needs both its ends
      points: [{ x: 2, y: -1 }], line: DEFAULT_ARC.line,
    })
    expect(fitArcEnCiel({ ...arc(), colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], invert: true }, note))
      .toMatchObject({ colors: ['#111111', '#222222', '#333333', '#444444'], invert: true })
    expect(fitArcEnCiel({ ...arc(), bandMm: Number.NaN }, note).bandMm).toBe(DEFAULT_ARC.bandMm)
  })

  it('keeps its width and middle when an image sets its proportions', () => {
    const before = arc({ xMm: 40, yMm: 20, widthMm: 20, heightMm: 20 })
    expect(withArcImage(before, 'img', 2, note)).toMatchObject({ imageId: 'img', xMm: 40, widthMm: 20, heightMm: 40, yMm: 10 })
  })

  it('lives on the front, comes back from a save, and its image is kept with the project’s', () => {
    expect(onFront('arcEnCiel')).toBe(true)
    const banknote = { ...createNote({ name: 'N', x: 0, y: 0, ...note, color: '#ffffff' }), arcEnCiel: arc({ imageId: 'disc' }) }
    const project = { ...createProject('P'), notes: [banknote] }
    expect(migrateProject(JSON.parse(JSON.stringify(project))).notes[0].arcEnCiel).toEqual(banknote.arcEnCiel)
    expect(migrateProject({ ...project, notes: [{ ...banknote, arcEnCiel: 'broken' }] }).notes[0].arcEnCiel).toBeUndefined()
    expect(projectImageIds(project)).toContain('disc')
  })
})

describe('Arc-en-Ciel’s bands', () => {
  it('slide half a band each way over 20° across the ridges, and not at all along them', () => {
    expect(bandSlide({ axis: 'y' }, { x: 0, y: 0 })).toBe(0)
    expect(bandSlide({ axis: 'y' }, { x: 15, y: ARC_SLIDE_DEG })).toBe(ARC_SLIDE_BANDS)
    expect(bandSlide({ axis: 'y' }, { x: 0, y: -ARC_SLIDE_DEG / 2 })).toBe(-ARC_SLIDE_BANDS / 2)
    expect(bandSlide({ axis: 'y' }, { x: 0, y: 60 })).toBe(ARC_SLIDE_BANDS)
    expect(bandSlide({ axis: 'x' }, { x: -40, y: 10 })).toBe(-ARC_SLIDE_BANDS)
  })

  it('run through the colours in order and repeat, blending into the next only at the end of each band', () => {
    const colours = ['#e0a91b', '#d23a7c', '#3a68d6'].map(linearRgb)
    const [gold, rose, blue] = colours
    expect(bandColour(colours, 0)).toEqual(gold)
    expect(bandColour(colours, 0.5)).toEqual(gold)
    expect(bandColour(colours, 1.2)).toEqual(rose)
    expect(bandColour(colours, 2.5)).toEqual(blue)
    // Round again, and before where they start the other way round
    expect(bandColour(colours, 3.4)).toEqual(gold)
    expect(bandColour(colours, -0.5)).toEqual(blue)
    // Most of the way into the next by the end of a band
    const late = bandColour(colours, 0.98)
    expect(Math.abs(late[0] - rose[0])).toBeLessThan(Math.abs(late[0] - gold[0]))
    // Too fine for the pixels: the colours' average
    expect(bandColour(colours, 0.2, 1)).toEqual(averageRgb(colours))
    expect(srgbBytes(linearRgb('#3a68d6'))).toEqual([0x3a, 0x68, 0xd6])
  })

  it('works out exact distances to the nearest seed', () => {
    const seeds = new Uint8Array(7 * 5)
    seeds[1 * 7 + 1] = 1
    seeds[4 * 7 + 6] = 1
    const squared = squaredDistances(seeds, 7, 5)
    expect(squared[1 * 7 + 1]).toBe(0)
    expect(squared[3 * 7 + 4]).toBe(5)
    expect(squared[6]).toBe(16)
  })

  it('start from the shape’s edge inward, and from holes in it, each pixel by the edge nearest it', () => {
    const solid = shapeMaps(grid(['#########', '#########', '#########', '#########', '#########', '#########', '#########', '#########', '#########']).coverage, 9, 9)
    expect(solid.holes).toBeUndefined()
    // Beyond the image is paper: the middle pixel is 4½ pixels in from the image's edge, half a box width
    expect(solid.edge.data[4 * 9 + 4]).toBeCloseTo(0.5)
    expect(solid.edge.data[0]).toBeCloseTo(0.5 / 9)
    const ring = grid([
      '.........',
      '.#######.',
      '.#######.',
      '.##...##.',
      '.##...##.',
      '.##...##.',
      '.#######.',
      '.#######.',
      '.........',
    ])
    const maps = shapeMaps(ring.coverage, ring.width, ring.height)
    expect(maps.holes).toBeDefined()
    // Paper outside isn't a hole; the hole itself is where the bands start
    expect(maps.holes!.data[0]).toBeGreaterThan(0)
    expect(maps.holes!.data[4 * 9 + 4]).toBe(0)
    expect(maps.holes!.data[4 * 9 + 2]).toBeCloseTo(0.5 / 9)
    // Inside the ring, from whichever edge is nearest
    expect(maps.edge.data[4 * 9 + 2]).toBeCloseTo(0.5 / 9)
    expect(maps.edge.data[4 * 9 + 4]).toBe(0)
  })

  it('count paper the shape closes round only at its corners as a hole', () => {
    const diamond = grid(['.....', '..#..', '.#.#.', '..#..', '.....'])
    expect(shapeMaps(diamond.coverage, 5, 5).holes!.data[2 * 5 + 2]).toBe(0)
    const open = grid(['.....', '..#..', '.#...', '..#..', '.....'])
    expect(shapeMaps(open.coverage, 5, 5).holes).toBeUndefined()
  })

  it('run along Line on both sides, straight on past its ends, and round its bends', () => {
    const straight = arc({ xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, line: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })
    const curve = curvePoints(straight).points
    expect(curve).toHaveLength(CURVE_STEPS + 1)
    expect(curve.every(([, y]) => Math.abs(y) < 1e-9)).toBe(true)
    const below = lineDistance(curve, [5, 3]).distance
    expect(Math.abs(below)).toBeCloseTo(3)
    expect(lineDistance(curve, [5, -3]).distance).toBeCloseTo(-below)
    expect(lineDistance(curve, [40, 3]).distance).toBeCloseTo(below)
    expect(lineDistance(curve, [-25, 3]).distance).toBeCloseTo(below)
    // A bent line passes through its points
    const bent = arc({ widthMm: 10, heightMm: 10, line: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }] })
    const through = sampleCurve(curveControls(bent)).points
    expect(through[CURVE_STEPS][0]).toBeCloseTo(5)
    expect(through[CURVE_STEPS][1]).toBeCloseTo(5)
  })

  it('look the same however they are drawn: by distance from the map, the points or the line, slid by the tilt', () => {
    const pointed = arc({ flow: 'point', widthMm: 20, heightMm: 10, points: [{ x: 0.5, y: 0.5 }], bandMm: 2 })
    const look = bandLook(pointed, undefined, { x: 0, y: ARC_SLIDE_DEG })!
    expect(look).toMatchObject({ from: 'point', spots: [[10, 5]], box: [20, 10], slide: ARC_SLIDE_BANDS })
    expect(bandDistance(look, [13, 9])).toBeCloseTo(5)
    // Edge and Holes wait for the maps; Holes on a shape without any start from its edge
    expect(bandLook(arc(), undefined, { x: 0, y: 0 })).toBeUndefined()
    const solid = shapeMaps(new Uint8ClampedArray(16).fill(255), 4, 4)
    expect(bandLook(arc({ flow: 'holes' }), solid, { x: 0, y: 0 })?.field).toBe(solid.edge)
    // Drawn by hand: each pixel's colour by its distance, its alpha from the mask, four pixels a millimetre
    const flat = bandLook(pointed, undefined, { x: 0, y: 0 })!
    const alpha = new Uint8ClampedArray(80 * 40).fill(255)
    alpha[0] = 0
    const pixels = bandPixels(flat, alpha, 80, 40)
    expect([...pixels.slice(0, 4)]).toEqual([0, 0, 0, 0])
    const middle = (20 * 80 + 40) * 4
    expect([...pixels.slice(middle, middle + 4)]).toEqual([...srgbBytes(linearRgb(pointed.colors[0])), 255])
    // At two pixels a band they start to fade to the colours' average, as they do to the eye
    const coarse = bandPixels(flat, new Uint8ClampedArray(20 * 10).fill(255), 20, 10)
    expect([...coarse.slice((5 * 20 + 10) * 4, (5 * 20 + 10) * 4 + 3)]).not.toEqual([...srgbBytes(linearRgb(pointed.colors[0]))])
  })
})

describe('placing where Arc-en-Ciel’s bands start', () => {
  it('adds points up to the most it takes, and bends the line between the points of the stretch nearest', () => {
    let pointed = arc()
    for (let i = 0; i < ARC_POINTS + 2; i++) pointed = withPoint(pointed, { x: i / 10, y: 0.5 })
    expect(pointed.points).toHaveLength(ARC_POINTS)
    const lined = arc({ line: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] })
    const once = withBend(lined, { x: 0.3, y: 0.6 })
    expect(once).toEqual({ arc: { ...lined, line: [{ x: 0, y: 0.5 }, { x: 0.3, y: 0.6 }, { x: 1, y: 0.5 }] }, index: 1 })
    const twice = withBend(once.arc, { x: 0.8, y: 0.55 })
    expect(twice.index).toBe(2)
    let full = lined
    for (let i = 0; i < ARC_LINE_POINTS; i++) full = withBend(full, { x: 0.1 + i / 10, y: 0.5 }).arc
    expect(full.line).toHaveLength(ARC_LINE_POINTS)
    expect(withBend(full, { x: 0.5, y: 0.5 }).index).toBe(-1)
  })

  it('takes out one of several points or a bend, never the last point or the line’s ends', () => {
    const two = arc({ points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }] })
    expect(withoutSpot(two, { kind: 'point', index: 0 }).points).toEqual([{ x: 0.8, y: 0.8 }])
    expect(canRemove(arc({ points: [{ x: 0.5, y: 0.5 }] }), { kind: 'point', index: 0 })).toBe(false)
    const bent = arc({ line: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }] })
    expect(canRemove(bent, { kind: 'line', index: 0 })).toBe(false)
    expect(canRemove(bent, { kind: 'line', index: 2 })).toBe(false)
    expect(withoutSpot(bent, { kind: 'line', index: 1 }).line).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }])
    expect(withoutSpot(bent, { kind: 'line', index: 0 })).toBe(bent)
  })

  it('moves a point, or the whole line, only as far as a box’s size off it', () => {
    expect(withSpot(arc(), { kind: 'point', index: 0 }, { x: 4, y: 0.25 }).points).toEqual([{ x: 2, y: 0.25 }])
    const lined = arc({ widthMm: 20, heightMm: 10, line: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] })
    expect(withLineMoved(lined, lined.line, 4, -2).line).toEqual([{ x: 0.2, y: 0.3 }, { x: 1.2, y: 0.3 }])
    // Its far end stops a box's width past the box, and the line keeps its shape
    expect(withLineMoved(lined, lined.line, 100, 0).line).toEqual([{ x: 1, y: 0.5 }, { x: 2, y: 0.5 }])
  })
})

describe('Arc-en-Ciel, Realistic', () => {
  it('is saved only when on', () => {
    expect(fitArcEnCiel({ ...arc(), realistic: true }, note).realistic).toBe(true)
    expect(fitArcEnCiel({ ...arc(), realistic: false }, note)).not.toHaveProperty('realistic')
    expect(fitArcEnCiel({ ...arc(), realistic: 'yes' } as unknown as ArcEnCiel, note)).not.toHaveProperty('realistic')
  })

  it('shows as much of each slope as of the other flat, and only the slopes facing the eye by 20° across the ridges', () => {
    expect(arcLight(arc(), { x: 0, y: 0 }).share).toBe(0)
    // Tilting the top away shows the slopes facing down the banknote, which carry the colours half a band back: by 20°,
    // only they show, and the bands are where step 1 slides them
    expect(arcLight(arc(), { x: 0, y: ARC_SLIDE_DEG })).toMatchObject({ across: [0, 1] })
    expect(arcLight(arc(), { x: 0, y: ARC_SLIDE_DEG }).share).toBeCloseTo(1)
    expect(arcLight(arc(), { x: 0, y: -ARC_SLIDE_DEG }).share).toBeCloseTo(-1)
    expect(arcLight(arc(), { x: 0, y: 40 }).share).toBe(1)
    // Between, as far as the slopes' shares of each ridge on screen move
    expect(arcLight(arc(), { x: 0, y: 10 }).share).toBeCloseTo(Math.tan(10 * RAD) / Math.tan(ARC_SLIDE_DEG * RAD))
    // Tilting along the ridges changes nothing; upright ones go by the side to side tilt, the right side turning away
    // showing the slopes facing left
    expect(arcLight(arc(), { x: 15, y: 0 }).share).toBeCloseTo(0)
    const upright = arc({ axis: 'x' })
    expect(arcLight(upright, { x: 0, y: 0 }).across).toEqual([-1, 0])
    expect(arcLight(upright, { x: ARC_SLIDE_DEG, y: 0 }).share).toBeCloseTo(1)
    expect(arcLight(upright, { x: 0, y: 12 }).share).toBeCloseTo(0)
  })

  it('lights the slopes from magnetic ink’s lamp over the eye, which stays put as the banknote is rotated', () => {
    const flat = arcLight(arc(), { x: 0, y: 0 })
    expect(flat.lamp[0]).toBeCloseTo(0)
    expect(flat.lamp[1]).toBeCloseTo(-Math.sin(LAMP_HEIGHT_DEG * RAD))
    expect(flat.lamp[2]).toBeCloseTo(Math.cos(LAMP_HEIGHT_DEG * RAD))
    // Rotated a quarter turn clockwise, the banknote's left edge is at the top, nearest the lamp; how much each slope shows
    // stays its own
    const rotated = arcLight(arc(), { x: 0, y: 0 }, 1)
    expect(rotated.lamp[0]).toBeCloseTo(-Math.sin(LAMP_HEIGHT_DEG * RAD))
    expect(rotated.lamp[1]).toBeCloseTo(0)
    expect(arcLight(arc(), { x: 0, y: 10 }, 1).share).toBe(arcLight(arc(), { x: 0, y: 10 }).share)
    // Seen flat, a ridge averages as much light as flat paper: the slope facing up towards the lamp more, the one facing
    // down less, and each groove darkening down to its bottom
    let up = 0
    let down = 0
    for (let i = 0; i < 1000; i++) {
      up += ridgeLight(flat, (i + 0.5) / 2000).shade / 1000
      down += ridgeLight(flat, 0.5 + (i + 0.5) / 2000).shade / 1000
    }
    expect((up + down) / 2).toBeCloseTo(1, 3)
    expect(up).toBeGreaterThan(1)
    expect(down).toBeLessThan(1)
    expect(ridgeLight(flat, 0).shade).toBeLessThan(ridgeLight(flat, 0.05).shade)
    expect(ridgeLight(flat, 1).shade).toBeLessThan(ridgeLight(flat, 0.95).shade)
    expect(ridgeLight(flat, 0.05).shade).toBeLessThan(ridgeLight(flat, 0.15).shade)
    // The sheen off a crest is strongest with the top tipped back by half the lamp's height, and broad: seen flat, the
    // crests still catch most of it
    expect(ridgeLight(arcLight(arc(), { x: 0, y: LAMP_HEIGHT_DEG / 2 }), 0.5).sheen).toBeCloseTo(ARC_SHEEN.strength)
    expect(ridgeLight(flat, 0.5).sheen).toBeGreaterThan(ARC_SHEEN.strength / 2)
  })

  it('averages each slope’s light, for ridges too fine to tell apart', () => {
    const flat = arcLight(arc(), { x: 0, y: 0 })
    const [upLight, upSheen, downLight, downSheen] = flat.means
    let light = 0
    for (let i = 0; i < 1000; i++) {
      const at = ridgeLight(flat, (i + 0.5) / 2000)
      light += (at.shade * (1 - at.sheen)) / 1000
    }
    expect(upLight).toBeCloseTo(light, 3)
    expect(upLight).toBeGreaterThan(downLight)
    expect(Math.max(upSheen, downSheen)).toBeLessThan(ARC_SHEEN.strength)
    expect(Math.min(...flat.means)).toBeGreaterThanOrEqual(0)
  })

  it('embosses the paper inside a rubber band round the shape, its bays and holes too, and nothing outside', () => {
    const bitten = grid([
      '..........',
      '..######..',
      '.########.',
      '.#####....',
      '.####.....',
      '.#####....',
      '.########.',
      '..######..',
      '..........',
    ])
    const { emboss } = shapeMaps(bitten.coverage, bitten.width, bitten.height)
    // In pixels from the hull's nearest side, worked out from its sides
    const at = (x: number, y: number) => emboss!.data[y * bitten.width + x] * bitten.width
    expect(at(6, 4)).toBeCloseTo(2.5)
    expect(at(8, 4)).toBeCloseTo(0.5)
    expect(at(9, 4)).toBe(0)
    expect(at(0, 0)).toBe(0)
    // The rubber band cuts across the corner
    expect(at(1, 1)).toBeCloseTo(0)
    const solid = embossField(new Uint8ClampedArray(81).fill(255), 9, 9)!
    expect(solid.data[4 * 9 + 4]).toBeCloseTo(0.5)
    expect(solid.max).toBeCloseTo(0.5)
    expect(embossField(new Uint8ClampedArray(81), 9, 9)).toBeUndefined()
    expect(shapeMaps(new Uint8ClampedArray(81), 9, 9).emboss).toBeUndefined()
    expect(convexHull([[0, 0], [2, 0], [1, 0], [2, 2], [0, 2], [1, 1]])).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]])
  })

  it('works out the embossed area exactly however big the shape, as the nearest of the hull’s sides', () => {
    const width = 61, height = 47
    const coverage = new Uint8ClampedArray(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inDisc = Math.hypot(x + 0.5 - 28, y + 0.5 - 23) < 19
        const bite = Math.hypot(x + 0.5 - 44, y + 0.5 - 23) < 9
        const blob = Math.hypot(x + 0.5 - 54, y + 0.5 - 8) < 4
        coverage[y * width + x] = (inDisc && !bite) || blob ? 255 : 0
      }
    }
    const field = embossField(coverage, width, height)!
    const corners: [number, number][] = []
    for (let y = 0; y < height; y++) {
      const row = [...coverage.slice(y * width, (y + 1) * width)]
      const first = row.findIndex((c) => c >= 128)
      if (first >= 0) corners.push([first, y], [first, y + 1], [row.findLastIndex((c) => c >= 128) + 1, y], [row.findLastIndex((c) => c >= 128) + 1, y + 1])
    }
    const hull = convexHull(corners)
    const area = hull.reduce((sum, a, i) => sum + a[0] * hull[(i + 1) % hull.length][1] - hull[(i + 1) % hull.length][0] * a[1], 0)
    let worst = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let nearest = Infinity
        hull.forEach((a, i) => {
          const b = hull[(i + 1) % hull.length]
          const length = Math.hypot(b[0] - a[0], b[1] - a[1])
          nearest = Math.min(nearest, (((a[1] - b[1]) * (x + 0.5 - a[0]) + (b[0] - a[0]) * (y + 0.5 - a[1])) / length) * Math.sign(area))
        })
        worst = Math.max(worst, Math.abs(Math.max(0, nearest) / width - field.data[y * width + x]))
      }
    }
    expect(worst).toBeLessThan(1e-6)
  })

  it('is drawn as lit ridges instead of sliding, with its shape’s embossed area once worked out', () => {
    const shape = shapeMaps(new Uint8ClampedArray(16).fill(255), 4, 4)
    const light = arcLight(arc(), { x: 0, y: 10 })
    expect(bandLook(arc(), shape, { x: 0, y: 10 }, light)).toMatchObject({ field: shape.edge, slide: 0, lit: light, emboss: shape.emboss })
    expect(bandLook(arc(), shape, { x: 0, y: 10 })).not.toHaveProperty('lit')
    // Point and Line are drawn at once, the embossed area joining them when it is ready
    const pointed = bandLook(arc({ flow: 'point' }), undefined, { x: 0, y: 10 }, light)!
    expect(pointed).toMatchObject({ from: 'point', lit: light })
    expect(pointed).not.toHaveProperty('emboss')
    // So it needs the shape's maps with Realistic on, whatever the bands start from
    expect(needsShape({ flow: 'point' })).toBe(false)
    expect(needsShape({ flow: 'point', realistic: true })).toBe(true)
    expect(needsShape({ flow: 'holes' })).toBe(true)
  })
})
