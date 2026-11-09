/** The playground's settings for one project (its `cfg`): waves, opacity line, taper, spacing, paper and ink */
export type PlaygroundSettings = Record<string, unknown>

/** What the editor keeps for a project, as the playground hands it over after each change */
export interface PlaygroundState {
  cfg: PlaygroundSettings
  ui: { view: number; guides: boolean; preset: string; edited: boolean; lastSize: [number, number] | null }
  /** The image as the playground measured it: pixels, and its width in mm (from the file, or guessed) */
  image: { name: string; nw: number; nh: number; widthMm: number } | null
}

/** A saved preset, as the playground shows it under Start from */
export interface PlaygroundPreset {
  id: string
  name: string
  cfg: PlaygroundSettings
  savedAt: number
  size?: [number, number] | null
  image?: string | null
  version?: number
  app?: string
}

/** What the studio gives the editor, and where the editor's changes go */
export interface Studio {
  /** The project's settings as last saved; none for a new project (it starts from the defaults, placed on its image) */
  initial: { cfg?: PlaygroundSettings | null; ui?: Partial<PlaygroundState['ui']> | null } | null
  /** After each change, a moment later (and once more as the editor closes) */
  onChange(state: PlaygroundState): void
  /** The project's image, from this browser's copy or the cloud */
  loadImage(onProgress: (fraction: number) => void): Promise<{ blob: Blob; name: string; widthMm?: number }>
  /** Replace image, a drop or a paste: the studio keeps the new image and gives back what to show */
  replaceImage(file: File): Promise<{ blob: Blob; name: string }>
  presets: {
    subscribe(listener: (presets: PlaygroundPreset[]) => void): () => void
    /** Saves a preset (in place of `replaceId`, a preset of the same name) and gives its id */
    save(preset: Omit<PlaygroundPreset, 'id'>, replaceId: string | null): Promise<string>
    remove(id: string): Promise<void>
  }
}

export interface Playground {
  /** Hands over the last change and empties the element */
  destroy(): void
  /** The project's card picture (the result, the whole image), as a data URL; null until the image is in */
  thumbnail(maxWidth?: number, maxHeight?: number): string | null
  /** Hands over a change still waiting for its moment */
  flush(): void
  /** The top bar's left end, where the studio puts back, the name and the save status */
  brand: HTMLElement
}

export function createPlayground(root: HTMLElement, studio: Studio): Playground
