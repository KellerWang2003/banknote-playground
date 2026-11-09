/**
 * A security feature's own name (its thread's, watermark's, Arc-en-Ciel's or magnetic ink's), given by double-clicking its
 * row in the Banknotes list (Keller, 9 November: "I can rename the security threads to a certain name") and shown there and
 * at the top of the right panel; saved on the feature itself, only once it has one, so it goes when the feature does.
 * Without one it goes by what it is (`featureName` in layers.ts). Each feature's fit keeps it while it is text with
 * something in it, so a damaged save can't leave its row blank.
 */
export const keptName = (name: unknown): { name?: string } => (typeof name === 'string' && name.trim() !== '' ? { name } : {})
