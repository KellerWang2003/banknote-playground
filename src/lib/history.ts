import { create } from 'zustand'
import { hostNoteId } from './extras'
import type { Note, Project, TiltSettings } from './types'

const LIMIT = 100
const COALESCE_MS = 750
interface HistoryEntry {
  past: Project[]
  future: Project[]
  current: string
  group?: string
  lastEdit: number
}
export const useHistory = create<{ entries: Record<string, HistoryEntry> }>(() => ({ entries: {} }))
const gestures = new Map<string, string>()

// Save timestamps are transport metadata, not user edits. Projects are never mutated, so each one is
// stringified once: a drag edits on every pointer move, and re-stringifying every project each time lagged
const fingerprints = new WeakMap<Project, string>()
function fingerprint(project: Project) {
  let value = fingerprints.get(project)
  if (value === undefined) {
    value = JSON.stringify({ ...project, updatedAt: 0 })
    fingerprints.set(project, value)
  }
  return value
}

function changedPaths(before: unknown, after: unknown, path = ''): string[] {
  if (before === after) return []
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return [`${path}[]`]
    return before.flatMap((value, i) => changedPaths(value, after[i], `${path}.${i}`))
  }
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => path || key !== 'updatedAt')
      .flatMap((key) => changedPaths(a[key], b[key], path ? `${path}.${key}` : key))
  }
  return [path]
}

function setEntry(id: string, entry: HistoryEntry) {
  useHistory.setState((state) => ({ entries: { ...state.entries, [id]: entry } }))
}
export function breakHistoryGroup(id: string) {
  const entry = useHistory.getState().entries[id]
  if (entry?.group) setEntry(id, { ...entry, group: undefined })
}
export function beginHistoryGroup(id: string) {
  breakHistoryGroup(id)
  gestures.set(id, crypto.randomUUID())
}
export function endHistoryGroup(id: string) {
  if (gestures.delete(id)) breakHistoryGroup(id)
}

/** Record one user edit; continuous changes to the same field share an undo step. */
export function recordEdit(before: Project, after: Project): boolean {
  const current = fingerprint(after)
  if (fingerprint(before) === current) return false
  const existing = useHistory.getState().entries[before.id]
  const entry = existing?.current === fingerprint(before) ? existing : undefined
  const paths = changedPaths(before, after).sort()
  const structural = paths.some((path) => /\[\]$|\.(id|imageId|faceImageId|kind)$/.test(path))
  const gesture = gestures.get(before.id)
  const group = gesture ?? (structural ? undefined : paths.join('|'))
  const now = Date.now()
  const merge = entry && group && entry.group === group && (gesture || now - entry.lastEdit < COALESCE_MS)
  setEntry(before.id, {
    past: merge ? entry.past : [...(entry?.past ?? []), structuredClone(before)].slice(-LIMIT),
    future: [], current, group, lastEdit: now,
  })
  return true
}

/** Undo/redo produces a normal project edit, so cloud autosave still applies. */
export function historyStep(project: Project, direction: 'undo' | 'redo'): Project | undefined {
  const entry = useHistory.getState().entries[project.id]
  if (!entry || entry.current !== fingerprint(project)) return undefined
  const from = direction === 'undo' ? entry.past : entry.future
  if (!from.length) return undefined
  const snapshot = from.at(-1)!
  const opposite = [...(direction === 'undo' ? entry.future : entry.past), structuredClone(project)].slice(-LIMIT)
  endHistoryGroup(project.id)
  setEntry(project.id, {
    past: direction === 'undo' ? from.slice(0, -1) : opposite,
    future: direction === 'redo' ? from.slice(0, -1) : opposite,
    current: fingerprint(snapshot), lastEdit: 0,
  })
  return { ...structuredClone(snapshot), updatedAt: Date.now() }
}

/** Playback settings every banknote keeps a copy of but the whole project shares (saved to all of them at once) */
const SHARED_TILT = ['speed', 'curve', 'transition', 'moves', 'recordings', 'playTilt'] as const
// A banknote's own settings, without the playback it shares; worked out once per note, as notes are never mutated
const ownParts = new WeakMap<Note, string>()
function ownPart(note: Note) {
  let value = ownParts.get(note)
  if (value === undefined) {
    const tilt: Partial<TiltSettings> = { ...note.tilt }
    for (const key of SHARED_TILT) delete tilt[key]
    value = JSON.stringify({ ...note, tilt })
    ownParts.set(note, value)
  }
  return value
}

/**
 * Whether the next undo or redo belongs to one banknote: it leaves every other banknote's own settings alone (it may
 * change that banknote, or what the whole project shares: playback, the name) and adds, removes or reorders none. The
 * thread editor steps through these alone, so it never changes a banknote out of sight. A playback change saved to
 * every banknote is shared even where the open one already had it, so it never strands the editor's undo.
 */
export function canStepNote(project: Project, id: string, direction: 'undo' | 'redo', entry = useHistory.getState().entries[project.id]): boolean {
  if (!entry || entry.current !== fingerprint(project)) return false
  // Thread Studio open on a further thread knows it by its view's id (extras.ts): its step is its banknote's
  const noteId = hostNoteId(id)
  const next = (direction === 'undo' ? entry.past : entry.future).at(-1)
  const { notes } = project
  if (!next || next.notes.length !== notes.length || !notes.some((n) => n.id === noteId)) return false
  return notes.every((n, i) => n.id === next.notes[i].id && (n.id === noteId || ownPart(n) === ownPart(next.notes[i])))
}

/** A cloud refresh must never leave undo steps that can overwrite someone else's newer work. */
export function reconcileHistory(projects: Project[]) {
  const current = new Map(projects.map((project) => [project.id, fingerprint(project)]))
  const entries = useHistory.getState().entries
  const retained = Object.fromEntries(Object.entries(entries).filter(([id, entry]) => current.get(id) === entry.current))
  if (Object.keys(retained).length !== Object.keys(entries).length) useHistory.setState({ entries: retained })
}
export function resetHistory() {
  gestures.clear()
  useHistory.setState({ entries: {} })
}
