/**
 * Demo's links (Keller, 10 November: "carry username"): `#/play/<username>/<project>/<banknote>` opens a banknote of a
 * project in Demo, reading the workspace it names without opening it, so a phone only ever reads (`DemoPage`). The
 * username is the workspace's key, so the link carries it. The sample project keeps its own address (`#/demo`).
 */

/** The link that opens a banknote in Demo, on this site */
export const demoLink = (workspace: string, projectId: string, noteId?: string) =>
  `${location.origin}${location.pathname}#/play/${encodeURIComponent(workspace)}/${encodeURIComponent(projectId)}${noteId ? `/${encodeURIComponent(noteId)}` : ''}`

/** What a Demo link opens, read from the page's address; nothing for any other */
export function readDemoLink(hash: string) {
  const match = hash.match(/^#\/play\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/)
  if (!match) return undefined
  try {
    const [workspace, projectId, noteId] = match.slice(1).map((part) => (part === undefined ? undefined : decodeURIComponent(part)))
    return workspace && projectId ? { workspace, projectId, noteId } : undefined
  } catch {
    return undefined
  }
}

/**
 * A phone: a small touch screen. The project list opens projects on one in Demo, as the editor isn't made for it; an iPad
 * still opens the editor
 */
export const isPhone = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600
