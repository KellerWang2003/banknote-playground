import { create } from 'zustand'
import { NEUTRAL_DEG } from '../lib/viewer'

/**
 * How Demo on a phone takes the viewing angle (Keller, 13 November; src/lib/viewer.ts), both in its ⋯ menu. A way of
 * looking, not part of a project: remembered per browser, as Realistic is
 */
interface Viewing {
  /**
   * The gyroscope and the accelerometer: a turn round the head keeps the eye square on, only a turn of the phone in the
   * hand tilts the banknote. Off, the gyroscope alone: the eye stays put in the room as the phone turns
   */
  headAware: boolean
  /** The neutral, degrees from lying flat: the phone held that far is looked at square on as Demo opens */
  neutralDeg: number
}

const KEY = 'of-playground.viewing'
const DEFAULTS: Viewing = { headAware: true, neutralDeg: NEUTRAL_DEG }

function load(): Viewing {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Viewing> | null
    return {
      headAware: typeof saved?.headAware === 'boolean' ? saved.headAware : DEFAULTS.headAware,
      neutralDeg: typeof saved?.neutralDeg === 'number' && Number.isFinite(saved.neutralDeg)
        ? Math.min(90, Math.max(0, saved.neutralDeg))
        : DEFAULTS.neutralDeg,
    }
  } catch { /* storage blocked or garbled: the defaults */ }
  return DEFAULTS
}

export const useViewing = create<Viewing>(() => load())

export function setViewing(patch: Partial<Viewing>) {
  useViewing.setState(patch)
  try {
    localStorage.setItem(KEY, JSON.stringify(useViewing.getState()))
  } catch { /* storage blocked: it lasts until reload */ }
}
