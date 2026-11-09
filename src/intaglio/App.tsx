import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { Button } from '@/components/ui/button'
import { cloudConfigured } from '../cloud/client'
import { readWorkspaceName, WORKSPACE_EVENT } from '../cloud/identity'
import { useNotice } from '../cloud/notices'
import { Editor, EditorSkeleton } from './Editor'
import { Projects } from './Projects'
import { SignIn } from './SignIn'
import { closeStudio, openStudio, useStudio } from './store'

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

/** The open workspace: Projects, or a project's editor at #/p/<id> */
function Studio({ name }: { name: string }) {
  const hash = useHash()
  const projects = useStudio((s) => s.projects)
  const loaded = useStudio((s) => s.loaded)
  const listed = useStudio((s) => s.listed)
  useEffect(() => {
    void openStudio(name)
    return closeStudio
  }, [name])
  const projectId = hash.match(/^#\/p\/(.+)$/)?.[1]
  const project = projectId ? projects.find((p) => p.id === projectId && !p.deleted) : undefined
  // A project's link shows the editor's skeleton until its project comes, from this browser or the cloud
  if (project) return <Editor key={project.id} project={project} />
  if (projectId && (!loaded || !listed)) return <EditorSkeleton />
  return <Projects />
}

/** Intaglio Studio: its own page (/intaglio), signed in with the same usernames as Banknote Playground */
export function App() {
  const [name, setName] = useState(readWorkspaceName)
  const notice = useNotice((s) => s.message)
  useEffect(() => {
    const onChange = (event: Event) => setName((event as CustomEvent<string | null>).detail)
    window.addEventListener(WORKSPACE_EVENT, onChange)
    return () => window.removeEventListener(WORKSPACE_EVENT, onChange)
  }, [])
  useEffect(() => {
    useNotice.setState({ message: '' })
  }, [name])

  if (!cloudConfigured) return <div className="flex h-full items-center justify-center text-sm" role="alert">Cloud connection is not configured.</div>
  return (
    <>
      {name ? <Studio key={name} name={name} /> : <SignIn />}
      {notice && (
        <div role="alert" className="fixed top-3 left-1/2 z-[100] flex max-w-lg -translate-x-1/2 items-center gap-3 rounded-lg border bg-background p-3 text-sm shadow-menu">
          <span>{notice}</span>
          <Button variant="ghost" size="sm" onClick={() => useNotice.setState({ message: '' })}>
            Dismiss
          </Button>
        </div>
      )}
      <Analytics />
    </>
  )
}
