import { clamp } from './frames'
import type { Note, NoteBack } from './types'

/**
 * The banknote's back (Keller, 3 November): its own background, shown when the banknotes are turned over. They turn
 * side to side, as a page does, so what lies in the paper and shows from both sides, the watermark, is mirrored left to
 * right there. The thread and magnetic ink are only on the front.
 */

export type Side = 'front' | 'back'

/** Seconds the banknotes take to turn over, or back: by F or Flip, and by a Flip move at 1× */
export const FLIP_SECONDS = 0.5

/** Whether banknotes `turn` of the way over (0 front, 1 back) show their backs: from halfway, edge-on, where the face changes */
export const showsBackAt = (turn: number) => turn >= 0.5

/** Turning over starts and ends gently */
const turnEase = (turn: number) => turn * turn * (3 - 2 * turn)

/**
 * The face shown partway through turning over, as rotateY degrees about the banknote's upright middle: the front from 0
 * to 90 as its right edge goes away, then, edge-on, the back from −90 to 0 as it comes round
 */
export const turnDeg = (turn: number) => {
  const deg = 180 * turnEase(clamp(turn, 0, 1))
  return showsBackAt(turn) ? deg - 180 : deg
}

/**
 * The paper every banknote is printed on, very light grey: what a side without a design shows, front or back, and what
 * shows through a design's transparent parts. Banknotes have no background colour of their own (Keller, 4 November:
 * "they have to use the design"); a colour saved before stays in its save but no longer shows
 */
export const PAPER = '#E5E5E5'

/** The back as saved, or on a banknote whose back was never set, plain paper */
export const backOf = (note: Pick<Note, 'back' | 'color'>): NoteBack => note.back ?? { background: 'solid', color: note.color }

/**
 * Where a box on the banknote lies seen from its back: left and right swap, as the banknote turns over side to side, and
 * one rotated turns the other way round there
 */
export const mirrored = <T extends { xMm: number; widthMm: number; rotationDeg?: number }>(box: T, note: Pick<Note, 'widthMm'>): T => {
  const flipped = { ...box, xMm: note.widthMm - box.xMm - box.widthMm }
  return box.rotationDeg ? { ...flipped, rotationDeg: -box.rotationDeg } : flipped
}

/**
 * The banknote with one side's background in its own fields (`background`, `color`, `faceImageId`), for what reads the
 * design a side shows: the continuous check and the checks. Its watermark stays where it is on the front.
 */
export function designFace(note: Note, side: Side): Note {
  if (side === 'front') return note
  const back = backOf(note)
  return { ...note, background: back.background, color: back.color, faceImageId: back.imageId }
}

/** The design a side shows, when it is an uploaded image */
export function sideImageId(note: Pick<Note, 'background' | 'faceImageId' | 'back' | 'color'>, side: Side) {
  const face = side === 'front' ? { background: note.background, imageId: note.faceImageId } : backOf(note)
  return face.background === 'image' ? face.imageId : undefined
}

const HEX = /^#[0-9a-f]{6}$/i

/** A saved back, kept as it was; undefined for none or a damaged one, which shows the front's paper again */
export function fitBack(raw: unknown): NoteBack | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { background, color, imageId } = raw as Partial<NoteBack>
  if (typeof color !== 'string' || !HEX.test(color)) return undefined
  const image = typeof imageId === 'string' && imageId ? { imageId } : {}
  return { background: background === 'image' && 'imageId' in image ? 'image' : 'solid', color, ...image }
}
