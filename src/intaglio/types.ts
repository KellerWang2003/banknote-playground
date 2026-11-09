import type { PlaygroundSettings, PlaygroundState } from './engine/playground'

/** A project's image: kept as uploaded in the intaglio-images bucket, at `<username>/<id>`, never changed */
export interface ImageRef {
  id: string
  name: string
  /** image/png, image/jpeg or image/webp */
  type: string
  bytes: number
  /** As the editor measured it once it opened the image */
  nw?: number
  nh?: number
  widthMm?: number
}

/** What a project saves, as one JSON blob: new settings need no migration */
export interface ProjectData {
  v: 1
  /** The playground's settings; null until the editor first opens a new project */
  cfg: PlaygroundSettings | null
  ui: Partial<PlaygroundState['ui']> | null
  image: ImageRef
}

/** A project as this browser holds it: the cloud's copy, plus what hasn't reached the cloud yet */
export interface Project {
  id: string
  name: string
  data: ProjectData
  /** The result as a small picture, made each time it saves; null until the editor first makes one */
  thumb: string | null
  /** When it last changed, here or in the cloud (ms) */
  updatedAt: number
  /** The cloud revision this copy is based on; null until it first saves */
  base: string | null
  /** A revision sent whose answer never came (the connection dropped), checked before the next save */
  inflight: string | null
  /** Changed here since it last saved */
  dirty: boolean
  /** Counts its changes, so a save that started before one doesn't count it as saved */
  edits: number
  /** Deleted here, waiting to tell the cloud */
  deleted: boolean
  /** Its image isn't in the cloud yet */
  imagePending: boolean
  /** When this browser's save last landed (ms), so a list from before it doesn't undo it */
  syncedAt: number
  /** Goes up when a version from another tab or computer replaces this one, so an open editor reopens on it */
  ext: number
}

export type SaveStatus = 'saved' | 'saving' | 'error'
