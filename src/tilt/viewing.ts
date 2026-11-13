import { create } from 'zustand'
import { NEUTRAL_DEG } from '../lib/viewer'

/**
 * How Demo on a phone takes the viewing angle (Keller, 13 November; src/lib/viewer.ts), its dial in ⋯ and Recentre. A way
 * of looking, not part of a project: remembered per browser, as Realistic is
 */
interface Viewing {
  /** The neutral, degrees from lying flat: the phone held that far is looked at square on as Demo opens */
  neutralDeg: number
}

const KEY = 'of-playground.viewing'
const DEFAULTS: Viewing = { neutralDeg: NEUTRAL_DEG }

function load(): Viewing {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Viewing> | null
    return {
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
