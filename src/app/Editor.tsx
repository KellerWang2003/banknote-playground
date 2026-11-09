import { undoProject, redoProject, updateNote } from '../lib/store'
import { beginHistoryGroup, endHistoryGroup, breakHistoryGroup } from '../lib/history'
import { pressLight, releaseLight, rotateNotes, setTilt, springToFlat, togglePlayback, turnOver, useTilt } from '../tilt/tilt'
import { playbackLens, playbackTilt } from '../lib/pattern'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Project } from '../lib/types'
import { AddNoteDialog } from '../editor/AddNoteDialog'
import { Canvas } from '../editor/Canvas'
import { ExportDialog } from '../editor/ExportDialog'
import { Inspector } from '../editor/Inspector'
import { ProjectPanel } from '../editor/ProjectPanel'
import { ThreadEditor } from '../editor/ThreadEditor'
import { TimelineBar } from '../editor/TimelineBar'
import { SideSwitch } from '../editor/SideSwitch'
import { TiltRail } from '../editor/TiltRail'
import { useSettleArtwork } from '../editor/useSettleArtwork'
import { addFeature, layerOf, removeFeature, removeLayer, type Layer } from '../editor/layerActions'
import { pressSpace, releaseSpace, useSpaceHand } from '../editor/spaceHand'
import { hasThread, isPlaced, onFront, type Feature, type PlacedLayer } from '../lib/layers'

/** Keys typed into these, or pressed while a dialog or menu is open, are not shortcuts */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]'
const POPUP = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * A full-screen canvas with floating panels: project and banknotes top left, the frame timeline along
 * the bottom, and the selected banknote's selected layer on the right. The thread editor opens over it all.
 */
export function Editor({ project, isDemo = false }: { project: Project; isDemo?: boolean }) {
  // Banknotes whose images came before frames kept their proportions are brought up to date once
  useSettleArtwork(project)
  const [selectedId, setSelectedId] = useState<string>()
  // Which part of the selected banknote the right panel shows: the one last clicked, the banknote itself, its thread,
  // watermark or magnetic ink. Every selection sets it, so picking a banknote never brings back a layer picked before
  const [layer, setLayer] = useState<Layer>('note')
  const [editingNoteId, setEditingNoteId] = useState<string>()
  const [selectedWindowId, setSelectedWindowId] = useState<string>()
  const [placingNoteId, setPlacingNoteId] = useState<string>()
  const note = project.notes.find((n) => n.id === selectedId)
  const shownLayer = layerOf(note, layer)
  // Window editing has no mode of its own: it starts when a window is picked (on the canvas or in the panel,
  // or by turning windows on) and ends on a click elsewhere on the banknote, on the canvas, or with Escape
  const editingWindows = editingNoteId !== undefined && editingNoteId === selectedId && shownLayer === 'thread'
  // Placing the watermark or magnetic ink works the same way: it starts when the layer is picked (its row, a press on
  // it on the canvas, adding it or uploading its image) and shows the banknote flat (the watermark clear) with the
  // layer's box until it ends
  const placing: PlacedLayer | undefined = placingNoteId !== undefined && placingNoteId === selectedId && isPlaced(shownLayer) ? shownLayer : undefined
  const exitWindows = () => {
    setEditingNoteId(undefined)
    setSelectedWindowId(undefined)
  }
  const exitPlacing = () => setPlacingNoteId(undefined)
  /**
   * Selects exactly what was picked: a banknote itself, or one of its layers; picking a placed layer places it. The thread,
   * Arc-en-Ciel and magnetic ink are only on the front, so picking one turns the banknotes back round to it
   */
  const selectLayer = (noteId: string, next: Layer) => {
    if (noteId !== selectedId || next !== 'thread') exitWindows()
    setSelectedId(noteId)
    setLayer(next)
    setPlacingNoteId(isPlaced(next) ? noteId : undefined)
    if (onFront(next)) turnOver(false)
  }
  /** Selects a banknote itself, or nothing */
  const selectNote = (noteId: string | undefined) => {
    if (noteId) return selectLayer(noteId, 'note')
    exitWindows()
    exitPlacing()
    setSelectedId(undefined)
  }
  // The thread editor shows the selected banknote while open; selecting another (or none) leaves it.
  // It belongs to the thread, so the right panel shows the thread when it closes
  const [threadNoteId, setThreadNoteId] = useState<string>()
  const editThread = (noteId: string) => {
    selectLayer(noteId, 'thread')
    exitWindows()
    setThreadNoteId(noteId)
  }
  const closeThread = () => setThreadNoteId(undefined)
  const [adding, setAdding] = useState(false)
  // A new project's first thread opens on its tab, with a tip by Windows saying they can be added there, since threads
  // start without them (Keller); it goes at the next click or key. Banknotes come without a thread (Keller, 4
  // November), so the tip waits for the first one added in a project that opened empty
  const [windowsTip, setWindowsTip] = useState<string>()
  const [openedEmpty] = useState(() => project.notes.length === 0)
  const [exporting, setExporting] = useState(false)
  const [focus, setFocus] = useState<{ noteId: string; token: number }>()
  const isEmpty = project.notes.length === 0

  // A new project has no notes yet, so it opens straight into adding the first one. Opening after mount
  // rather than on the first render keeps the dialog from dismissing itself during mount.
  useEffect(() => {
    if (isEmpty) setAdding(true)
    // Only on opening the project, not every time the last note is deleted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  // The demo opens playing its playlist, so its banknotes move before anyone knows to tilt them. Leaving it stops
  // playback and goes back to flat, so the next project opens still
  const [playsOnOpen] = useState(() => isDemo && project.notes.some((n) => n.tilt.moves?.length))
  useEffect(() => {
    if (!playsOnOpen) return
    if (useTilt.getState().source !== 'wobble') togglePlayback()
    return () => {
      if (useTilt.getState().source === 'wobble') togglePlayback()
      springToFlat()
    }
  }, [playsOnOpen])

  // Turned over, the banknotes show only their backs and watermarks: a thread, Arc-en-Ciel or magnetic ink picked on the
  // front leaves the banknote itself picked, and window editing ends
  const flipped = useTilt((s) => s.flipped)
  useEffect(() => {
    if (!flipped) return
    exitWindows()
    if (onFront(layer)) {
      setLayer('note')
      exitPlacing()
    }
    // Only on turning over
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped])
  // Each project opens on its fronts, upright
  useEffect(() => () => setTilt({ flipped: false, turn: 0, quarterTurns: 0 }), [])

  // Escape leaves window editing or placing a layer, otherwise clears the selection, unless a field or dialog is handling it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement) && !document.querySelector('[role=dialog]')) {
        // Clearing the selection always leaves window editing and placing; avoids reading a stale selectedId here
        exitWindows()
        exitPlacing()
        if (!editingWindows && !placing) setSelectedId(undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingWindows, placing])

  useEffect(() => {
    if (!editingWindows) return
    const onDelete = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const element = event.target instanceof Element ? event.target : null
      if (element?.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return
      if (!selectedWindowId || document.querySelector('[role="dialog"], [role="menu"]')) return
      event.preventDefault()
      updateNote(project.id, editingNoteId!, (n) => ({ ...n, thread: { ...n.thread,
        windows: { ...n.thread.windows, sections: n.thread.windows.sections.filter((s) => s.id !== selectedWindowId) } } }))
      setSelectedWindowId(undefined)
    }
    window.addEventListener('keydown', onDelete)
    return () => window.removeEventListener('keydown', onDelete)
  }, [editingWindows, editingNoteId, selectedWindowId, project.id])

  // Delete while placing a layer removes it, as it removes a selected window
  useEffect(() => {
    if (!placing || !placingNoteId) return
    const onDelete = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const element = event.target instanceof Element ? event.target : null
      if (element?.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      event.preventDefault()
      void removeLayer({ projectId: project.id, noteId: placingNoteId }, placing)
      setLayer('note')
      exitPlacing()
    }
    window.addEventListener('keydown', onDelete)
    return () => window.removeEventListener('keydown', onDelete)
  }, [placing, placingNoteId, project.id])

  // L holds every banknote up to the light: a tap flips the lamp switch, holding it peeks at the other light
  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'l' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.defaultPrevented) return
      const element = event.target instanceof Element ? event.target : null
      if (element?.closest(TYPING) || document.querySelector(POPUP)) return
      event.preventDefault()
      if (!event.repeat) pressLight()
    }
    const onUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'l') releaseLight()
    }
    // A release that happens in another window never arrives: end the peek without flipping the switch
    const onBlur = () => releaseLight(performance.now(), false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      onBlur()
    }
  }, [])

  // F turns every banknote over to its back, or back to its front, and R rotates every banknote a quarter turn right
  // (Shift+R left), as the buttons beside Front | Back do; not in Thread Studio, as the thread is only on the front
  const inStudio = threadNoteId !== undefined && note?.id === threadNoteId
  useEffect(() => {
    if (inStudio) return
    const onDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if ((key !== 'f' && key !== 'r') || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.defaultPrevented) return
      const element = event.target instanceof Element ? event.target : null
      if (element?.closest(TYPING) || document.querySelector(POPUP)) return
      event.preventDefault()
      if (event.repeat) return
      if (key === 'f') turnOver()
      else rotateNotes(event.shiftKey ? -1 : 1)
    }
    window.addEventListener('keydown', onDown)
    return () => window.removeEventListener('keydown', onDown)
  }, [inStudio])

  // Space: a tap plays or pauses, and held down it is the hand, a press on the canvas panning (Figma's). So playback
  // toggles when Space comes up, and only if no pan started meanwhile; never while editing windows or placing a layer,
  // which pause playback, though the hand still pans then
  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      const element = event.target instanceof Element ? event.target : null
      if (element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"]')) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
      event.preventDefault()
      if (!event.repeat) pressSpace()
    }
    const onUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !useSpaceHand.getState().held) return
      // Or a focused button would take the release as a click
      event.preventDefault()
      if (releaseSpace() && !editingWindows && !placing) togglePlayback()
    }
    window.addEventListener('keydown', onDown, { capture: true })
    window.addEventListener('keyup', onUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', onDown, { capture: true })
      window.removeEventListener('keyup', onUp, { capture: true })
    }
  }, [editingWindows, placing])
  // A release in another window never arrives: the hand goes away without playing, as it does when the project closes
  useEffect(() => {
    const onBlur = () => releaseSpace(false)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      onBlur()
    }
  }, [])

  useEffect(() => {
    const onHistory = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const element = event.target instanceof Element ? event.target : null
      // Text fields keep native text undo while they are being edited.
      if (element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
      event.preventDefault()
      if (key === 'y' || event.shiftKey) redoProject(project.id)
      else undoProject(project.id)
    }
    const endGesture = () => endHistoryGroup(project.id)
    window.addEventListener('keydown', onHistory)
    window.addEventListener('pointerup', endGesture, true)
    window.addEventListener('pointercancel', endGesture, true)
    window.addEventListener('blur', endGesture)
    return () => {
      window.removeEventListener('keydown', onHistory)
      window.removeEventListener('pointerup', endGesture, true)
      window.removeEventListener('pointercancel', endGesture, true)
      window.removeEventListener('blur', endGesture)
      endGesture()
    }
  }, [project.id])

  // Each banknote has its own lens; playback and the tilt pad follow the selected one (or the first)
  const reference = note ?? project.notes.at(0)
  const lens = reference ? playbackLens(reference) : undefined
  const noteRef = note ? { projectId: project.id, noteId: note.id } : undefined
  // The tilt card stays whatever is picked, placing a layer or editing windows included (Keller, 9 November: "That
  // should be always there"); only an empty project, with nothing to tilt, goes without it
  const tiltPad = !isEmpty
  const threadNote = note && note.id === threadNoteId ? note : undefined

  const selectAndFocus = (noteId: string) => {
    selectNote(noteId)
    setFocus({ noteId, token: Date.now() })
  }
  /** A new banknote shows itself, brought into view */
  const added = (noteId: string) => selectAndFocus(noteId)
  /** From the Banknotes list: a banknote row (or a new copy) shows the banknote itself, a layer row that layer; a new banknote is brought into view */
  const selectFromList = (noteId: string, next: Layer = 'note') => {
    const elsewhere = noteId !== selectedId
    selectLayer(noteId, next)
    if (elsewhere || next === 'note') setFocus({ noteId, token: Date.now() })
  }
  /** Adds a security feature from the Add menu and shows it; the first thread in a project that opened empty comes with the windows tip */
  const addFrom = (noteId: string, added: Feature) => {
    const firstThread = added === 'thread' && openedEmpty && !project.notes.some(hasThread)
    addFeature({ projectId: project.id, noteId }, added)
    selectFromList(noteId, added)
    if (firstThread) setWindowsTip(noteId)
  }
  // Removing the feature it shows leaves the banknote itself selected
  const dropLayer = (noteId: string, removed: Feature) => {
    void removeFeature({ projectId: project.id, noteId }, removed)
    if (noteId === selectedId && shownLayer === removed) setLayer('note')
    if (noteId === placingNoteId && placing === removed) exitPlacing()
    if (removed === 'thread' && noteId === editingNoteId) exitWindows()
  }

  return (
    <div className="relative flex h-full bg-muted/40"
      onPointerDownCapture={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest('input, textarea, [contenteditable]')) beginHistoryGroup(project.id)
      }}
      onFocusCapture={() => breakHistoryGroup(project.id)}
      onBlurCapture={() => breakHistoryGroup(project.id)}
    >
      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center">
          <Button onClick={() => setAdding(true)}>
            <Plus />
            Add a banknote
          </Button>
        </div>
      ) : (
        <Canvas projectId={project.id} notes={project.notes} selectedId={note?.id} layer={shownLayer} onSelect={selectNote} onSelectLayer={selectLayer} onExitWindows={exitWindows} focus={focus} editingWindows={editingWindows} selectedWindowId={selectedWindowId} onWindowSelect={setSelectedWindowId} onExport={threadNote ? undefined : () => setExporting(true)}
          placing={placing} onExitPlacing={exitPlacing} onEditThread={threadNote ? undefined : editThread} inStudio={inStudio}
          onEditWindow={(noteId, windowId) => {
            selectLayer(noteId, 'thread')
            setEditingNoteId(noteId)
            setSelectedWindowId(windowId)
          }} />
      )}

      {threadNote ? (
        // The canvas stays underneath: it runs playback
        <ThreadEditor key={threadNote.id} project={project} note={threadNote} onClose={closeThread} />
      ) : (
        <>
          {tiltPad && <TiltRail limit={lens?.viewDeg} playback={reference && lens ? { projectId: project.id, tilt: playbackTilt(reference), lens } : undefined} />}
          {/* Front | Back and Rotate left and right, where they can't be missed (Keller); F, Shift+R and R do the same */}
          {!isEmpty && <SideSwitch besidePanel={note !== undefined} />}
          <ProjectPanel isDemo={isDemo} project={project} selectedId={note?.id} layer={shownLayer} onSelect={selectFromList} onAdd={() => setAdding(true)} aboveTilt={tiltPad}
            onAddLayer={addFrom} onRemoveLayer={dropLayer} />
          {!isEmpty && (
            // The timeline is the thread's: its frames show only while the thread itself is picked (Keller, 9 November, as a
            // banknote now holds so many security features); otherwise the bar stays as it is with nothing selected
            <TimelineBar projectId={project.id} notes={project.notes} note={note && hasThread(note) ? note : undefined}
              noteRef={note && shownLayer === 'thread' ? noteRef : undefined} besidePanel={note !== undefined} />
          )}
          {/* The way into Thread Studio while a thread is picked: above the timeline, in the middle of the workspace (Keller) */}
          {note && shownLayer === 'thread' && (
            <div data-edit-thread="" className="pointer-events-none absolute right-[calc(var(--panel-w)+20px)] bottom-[112px] left-3 flex justify-center">
              <Button size="sm" className="pointer-events-auto shadow-panel" onClick={() => editThread(note.id)}>Edit in Thread Studio</Button>
            </div>
          )}
          {note && noteRef && <Inspector key={note.id} note={note} noteRef={noteRef} layer={shownLayer}
            onWindowSelect={(windowId) => {
              if (!windowId) return exitWindows()
              setEditingNoteId(note.id)
              setSelectedWindowId(windowId)
            }}
            onPlace={() => setPlacingNoteId(note.id)}
            windowsTip={windowsTip === note.id} onWindowsTipDone={() => setWindowsTip(undefined)} />}
        </>
      )}

      {exporting && <ExportDialog project={project} selectedId={note?.id} open={exporting} onOpenChange={setExporting} />}

      {adding && (
        <AddNoteDialog
          projectId={project.id}
          notes={project.notes}
          open={adding}
          onOpenChange={setAdding}
          onAdded={added}
        />
      )}
    </div>
  )
}
