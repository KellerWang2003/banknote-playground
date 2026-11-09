/** What the bucket takes as it is; any other image the browser can open is kept as a PNG */
const KEPT_AS_IS = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 50 * 1024 * 1024
const UNREADABLE = 'Couldn’t read that image. PNG, JPEG or WebP work best.'

/** An error whose message is for the person (the editor shows it as it is) */
export class ImageError extends Error {
  userMessage: string
  constructor(message: string) {
    super(message)
    this.userMessage = message
  }
}

/** A project's name from its image's file name; a pasted image (image.png) makes an Untitled project */
export function projectName(file: File) {
  const base = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120)
  return !base || base.toLowerCase() === 'image' ? 'Untitled project' : base
}

/**
 * An image ready to keep: opened once to be sure it is one, then kept as uploaded (PNG, JPEG, WebP) or made a PNG
 * (AVIF, GIF, anything else the browser opens); under 50 MB
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; type: string; name: string }> {
  const name = file.name || 'Pasted image'
  if (file.type && !file.type.startsWith('image/')) throw new ImageError('That file isn’t an image.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageError(UNREADABLE)
  }
  try {
    if (KEPT_AS_IS.has(file.type)) {
      if (file.size > MAX_BYTES) throw new ImageError('Images must be smaller than 50 MB.')
      return { blob: file, type: file.type, name }
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new ImageError(UNREADABLE)
    context.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new ImageError(UNREADABLE)
    if (png.size > MAX_BYTES) throw new ImageError('Images must be smaller than 50 MB.')
    return { blob: png, type: 'image/png', name }
  } finally {
    bitmap.close()
  }
}
