import { fitArcEnCiel, newArcEnCiel } from './arcEnCiel'
import { fitMagneticInk, newMagneticInk } from './magneticInk'
import { type PlacedBox, type Size, isWhollyOn, moveBoxTo, onto } from './placed'
import type { ArcEnCiel, MagneticInk, Note, Watermark } from './types'
import { fitWatermark, newWatermark } from './watermark'

/**
 * The banknote's layers placed on it as a box (placed.ts), siblings of its thread: at most one of each, added from the +
 * on the banknote's row, listed in this order under its thread, and placed the same way on the canvas. They draw in
 * this order too, over the design and under the thread: Arc-en-Ciel's offset print under magnetic ink's screen print,
 * as the press lays them down.
 */
export const PLACED_LAYERS = ['watermark', 'arcEnCiel', 'magneticInk'] as const
export type PlacedLayer = (typeof PLACED_LAYERS)[number]

interface Placed {
  watermark: Watermark
  arcEnCiel: ArcEnCiel
  magneticInk: MagneticInk
}

export const isPlaced = (layer: string | undefined): layer is PlacedLayer => (PLACED_LAYERS as readonly (string | undefined)[]).includes(layer)

/** Each one's name in the UI */
export const LAYER_NAMES: Record<PlacedLayer, string> = { watermark: 'Watermark', arcEnCiel: 'Arc-en-Ciel', magneticInk: 'Magnetic ink' }

/** Printed on the front, so they don't show on the back: picking one turns the banknotes back round to their fronts */
export const onFront = (layer: string): boolean => layer === 'thread' || layer === 'arcEnCiel' || layer === 'magneticInk'

/**
 * Every security feature a banknote can have, at most one of each, all added from one Add menu and removed the same
 * way (Keller, 4 November: a new banknote coming with a thread made no sense): its thread, then the placed layers, the
 * order the menu and the Banknotes list show them in
 */
export const FEATURES = ['thread', ...PLACED_LAYERS] as const
export type Feature = (typeof FEATURES)[number]

export const FEATURE_NAMES: Record<Feature, string> = { thread: 'Security thread', ...LAYER_NAMES }

/** What each one is, in a line under its name in the Add menu */
export const FEATURE_LINES: Record<Feature, string> = {
  thread: 'A lenticular thread whose frames change as you tilt',
  watermark: 'In the paper, clear when tilted or held to the light',
  arcEnCiel: 'Colour bands that slide as you tilt',
  magneticInk: 'Ink that shifts colour as a bright bar rolls across it',
}

/** Whether the banknote has its thread: banknotes from before the Add menu all do, new ones not until it is added */
export const hasThread = (note: Pick<Note, 'noThread'>) => !note.noThread

export const hasFeature = (note: Note, feature: Feature) => (feature === 'thread' ? hasThread(note) : !!note[feature])

const FIT: { [K in PlacedLayer]: (box: Placed[K], note: Size) => Placed[K] } = {
  watermark: fitWatermark,
  arcEnCiel: fitArcEnCiel,
  magneticInk: fitMagneticInk,
}

const NEW: { [K in PlacedLayer]: (note: Size) => Placed[K] } = {
  watermark: newWatermark,
  arcEnCiel: newArcEnCiel,
  magneticInk: newMagneticInk,
}

/** A layer kept on its banknote, a damaged save repaired */
export const fitPlaced = <K extends PlacedLayer>(layer: K, box: Placed[K], note: Size): Placed[K] =>
  (FIT[layer] as (box: Placed[K], note: Size) => Placed[K])(box, note)

/** A new one, in its own place on the banknote */
export const newPlaced = <K extends PlacedLayer>(layer: K, note: Size): Placed[K] => (NEW[layer] as (note: Size) => Placed[K])(note)

/** The banknote with this layer set to `box`, or without it */
export function withPlaced(note: Note, layer: PlacedLayer, box: PlacedBox | undefined): Note {
  const next: Record<string, unknown> = { ...note }
  if (box) next[layer] = box
  else delete next[layer]
  return next as unknown as Note
}

/**
 * Every layer the banknote has kept on it as it is now, after a new size was typed (`from`, the size it had): each
 * where it was, as far as it fits, and one that sat wholly on the banknote still wholly on it
 */
export const fitLayers = (note: Note, from?: Size): Note =>
  PLACED_LAYERS.reduce((n, layer) => {
    const box = n[layer]
    if (!box) return n
    const fitted = fitPlaced(layer, box, n)
    return withPlaced(n, layer, from && isWhollyOn(box, from) ? fitPlaced(layer, onto(fitted, n), n) : fitted)
  }, note)

/** Every layer the banknote has in the same place after it turned from `from`: its middle at the same share across and down */
export const moveLayersTo = (note: Note, from: Size): Note =>
  PLACED_LAYERS.reduce((n, layer) => {
    const box = n[layer]
    return box ? withPlaced(n, layer, moveBoxTo(box, from, n)) : n
  }, note)
