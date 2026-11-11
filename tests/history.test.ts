import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNote, createProject } from '../src/lib/notes'
import { beginHistoryGroup, canStepNote, endHistoryGroup, historyStep, recordEdit, reconcileHistory, resetHistory, useHistory } from '../src/lib/history'
import type { Project } from '../src/lib/types'

beforeEach(() => { resetHistory(); vi.useRealTimers() })
function fixture(): Project {
  return { ...createProject('Test'), notes: [createNote({ name: 'Banknote', x: 0, y: 0, widthMm: 150, heightMm: 70, color: '#123456' })] }
}

describe('project undo history', () => {
  it('undoes and redoes deletion with artwork references intact', () => {
    const before = fixture()
    before.notes[0].frames[0].imageId = 'retained-artwork'
    before.notes[0].frames[0].kind = 'image'
    const after = { ...before, notes: [] }
    recordEdit(before, after)
    const restored = historyStep(after, 'undo')!
    expect(restored.notes).toEqual(before.notes)
    expect(historyStep(restored, 'redo')!.notes).toEqual([])
  })

  it('groups a long drag into one undo even across pauses between pointer moves', () => {
    vi.useFakeTimers()
    let project = fixture()
    const initial = structuredClone(project)
    beginHistoryGroup(project.id)
    for (let x = 1; x <= 25; x++) {
      vi.advanceTimersByTime(1000)
      const next = { ...project, notes: project.notes.map((note) => ({ ...note, x })) }
      recordEdit(project, next)
      project = next
    }
    endHistoryGroup(project.id)
    expect(useHistory.getState().entries[project.id].past).toHaveLength(1)
    const restored = historyStep(project, 'undo')!
    expect(restored.notes).toEqual(initial.notes)
    expect(historyStep(restored, 'undo')).toBeUndefined()
    vi.useRealTimers()
  })

  it('coalesces typing but separates different properties and structural edits', () => {
    const original = fixture()
    let project = original
    for (const name of ['B', 'Ba', 'Banknote name']) {
      const next = { ...project, name }
      recordEdit(project, next)
      project = next
    }
    const resized = { ...project, notes: project.notes.map((note) => ({ ...note, widthMm: 160 })) }
    recordEdit(project, resized)
    const extraNote = { ...resized, notes: [...resized.notes, { ...resized.notes[0], id: crypto.randomUUID() }] }
    recordEdit(resized, extraNote)
    const undoAdd = historyStep(extraNote, 'undo')!
    expect(undoAdd.notes).toHaveLength(1)
    const undoSize = historyStep(undoAdd, 'undo')!
    expect(undoSize.notes[0].widthMm).toBe(150)
    expect(historyStep(undoSize, 'undo')!.name).toBe(original.name)
  })

  it('ignores timestamp-only changes and clears redo after a new edit', () => {
    const original = fixture()
    expect(recordEdit(original, { ...original, updatedAt: original.updatedAt + 100 })).toBe(false)
    const renamed = { ...original, name: 'Renamed' }
    recordEdit(original, renamed)
    const restored = historyStep(renamed, 'undo')!
    const other = { ...restored, name: 'Another edit' }
    recordEdit(restored, other)
    expect(historyStep(other, 'redo')).toBeUndefined()
  })

  it('invalidates history when a cloud version replaces the local project', () => {
    const original = fixture()
    const local = { ...original, name: 'Local edit' }
    recordEdit(original, local)
    reconcileHistory([{ ...local, name: 'Another device' }])
    expect(useHistory.getState().entries[original.id]).toBeUndefined()
    expect(historyStep(local, 'undo')).toBeUndefined()
  })

  it('caps history and keeps separate projects independent', () => {
    let project = fixture()
    const other = fixture()
    for (let i = 0; i < 110; i++) {
      beginHistoryGroup(project.id)
      const next = { ...project, name: String(i) }
      recordEdit(project, next)
      project = next
      endHistoryGroup(project.id)
    }
    recordEdit(other, { ...other, name: 'Other' })
    expect(useHistory.getState().entries[project.id].past).toHaveLength(100)
    expect(useHistory.getState().entries[other.id].past).toHaveLength(1)
  })
})

describe('undo in one banknote’s thread editor', () => {
  function twoNotes(): Project {
    const make = (name: string, x: number) => createNote({ name, x, y: 0, widthMm: 150, heightMm: 70, color: '#123456' })
    return { ...createProject('Two'), notes: [make('A', 0), make('B', 200)] }
  }
  /** Records one edit, as the store does, and returns the project after it */
  function edit(project: Project, change: (p: Project) => Project) {
    const next = change(project)
    beginHistoryGroup(project.id)
    recordEdit(project, next)
    endHistoryGroup(project.id)
    return next
  }
  const editNote = (project: Project, i: number, change: (n: Project['notes'][number]) => Project['notes'][number]) =>
    edit(project, (p) => ({ ...p, notes: p.notes.map((n, k) => (k === i ? change(n) : n)) }))

  it('steps only through the open banknote’s edits, and the project-wide undo still reaches the rest', () => {
    let project = twoNotes()
    const [a, b] = project.notes.map((n) => n.id)
    project = editNote(project, 1, (n) => ({ ...n, widthMm: 160 }))
    project = editNote(project, 0, (n) => ({ ...n, name: 'A2' }))
    expect(canStepNote(project, a, 'undo')).toBe(true)
    expect(canStepNote(project, b, 'undo')).toBe(false)
    project = historyStep(project, 'undo')!
    expect(project.notes[0].name).toBe('A')
    // Next back is B's resize: not A's to undo, though the canvas can
    expect(canStepNote(project, a, 'undo')).toBe(false)
    expect(canStepNote(project, a, 'redo')).toBe(true)
    expect(canStepNote(project, b, 'undo')).toBe(true)
    const canvas = historyStep(project, 'undo')!
    expect(canvas.notes[1].widthMm).toBe(150)
  })

  it('steps through a further thread’s edits from Thread Studio open on it, by its view’s id, as its banknote’s', () => {
    let project = twoNotes()
    const [a, b] = project.notes.map((n) => n.id)
    project = editNote(project, 0, (n) => ({ ...n, name: 'A2' }))
    // Thread Studio knows a further thread by its banknote's id and its own (extras.ts)
    expect(canStepNote(project, `${a}/second`, 'undo')).toBe(true)
    expect(canStepNote(project, `${b}/second`, 'undo')).toBe(false)
  })

  it('takes playback saved to every banknote as shared, even where the open one already had it', () => {
    let project = twoNotes()
    const [a] = project.notes.map((n) => n.id)
    // An older project where B plays faster than A: playback set to A's speed for every banknote leaves A as it was
    project = { ...project, notes: project.notes.map((n, i) => (i === 1 ? { ...n, tilt: { ...n.tilt, speed: 2 } } : n)) }
    const before = JSON.stringify(project.notes[0])
    const { speed } = project.notes[0].tilt
    project = edit(project, (p) => ({ ...p, notes: p.notes.map((n) => ({ ...n, tilt: { ...n.tilt, speed } })) }))
    expect(JSON.stringify(project.notes[0])).toBe(before)
    // Still undoable from A's editor, and an edit to A on top of it too, one after the other
    project = editNote(project, 0, (n) => ({ ...n, tilt: { ...n.tilt, cycleDeg: 40 } }))
    expect(canStepNote(project, a, 'undo')).toBe(true)
    project = historyStep(project, 'undo')!
    expect(canStepNote(project, a, 'undo')).toBe(true)
    project = historyStep(project, 'undo')!
    expect(project.notes[1].tilt.speed).toBe(2)
    expect(canStepNote(project, a, 'redo')).toBe(true)
  })

  it('never adds, removes or reorders banknotes, and stops when the cloud replaced the project', () => {
    let project = twoNotes()
    const [a] = project.notes.map((n) => n.id)
    project = edit(project, (p) => ({ ...p, notes: [...p.notes, { ...p.notes[1], id: crypto.randomUUID(), name: 'C' }] }))
    expect(canStepNote(project, a, 'undo')).toBe(false)
    project = edit(project, (p) => ({ ...p, notes: [p.notes[1], p.notes[0], p.notes[2]] }))
    expect(canStepNote(project, a, 'undo')).toBe(false)
    project = edit(project, (p) => ({ ...p, name: 'Renamed' }))
    expect(canStepNote(project, a, 'undo')).toBe(true)
    expect(canStepNote({ ...project, name: 'From another device' }, a, 'undo')).toBe(false)
    expect(canStepNote(project, 'not-a-banknote', 'undo')).toBe(false)
  })
})
