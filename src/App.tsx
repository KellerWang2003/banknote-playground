import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { Button } from '@/components/ui/button'
import { Editor } from './app/Editor'
import { EditorSkeleton } from './app/EditorSkeleton'
import { ProjectList } from './app/ProjectList'
import { OpenWorkspace } from './app/OpenWorkspace'
import { cloudConfigured } from './cloud/client'
import { openWorkspace, closeWorkspace, useWorkspace, watchWorkspace, retrySync, signOut, clearDemoPreview } from './cloud/workspace'
import { readWorkspaceName, WORKSPACE_EVENT } from './cloud/identity'
import { useNotice, runAction } from './cloud/notices'
import { ConflictDialog } from './components/CloudStatus'
import { DemoPage } from './app/DemoPage'
import { readDemoLink } from './lib/demoLink'

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

function Workspace({ name }: { name: string }) {
  const hash = useHash()
  const { projects, demoPreview, demoLoading, loaded, listed, error } = useWorkspace()
  useEffect(() => {
    void openWorkspace(name)
    const unwatch = watchWorkspace()
    return () => { unwatch(); closeWorkspace() }
  }, [name])
  useEffect(() => {
    if (hash !== '#/demo' && location.hash !== '#/demo') clearDemoPreview()
  }, [hash])
  if (!loaded && error) return <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
    <span role="alert">{error}</span>
    <div className="flex gap-2"><Button onClick={() => runAction(Promise.resolve(retrySync()))}>Retry</Button><Button variant="ghost" onClick={() => runAction(signOut())}>Sign out</Button></div>
  </div>
  const projectId = hash.match(/^#\/p\/(.+)$/)?.[1]
  const project = hash === '#/demo' ? demoPreview : projects.find((p) => p.id === projectId)
  // Nothing says it is loading in words (Keller): until the projects are here, the page they go on shows its layout as
  // skeletons. A project's link shows the editor's until its project comes, from this device or the cloud (the project
  // list once the cloud has answered without it), and so does the demo while it is made; the project list shows its
  // cards' itself (`ProjectList`)
  const waiting = !project && ((projectId !== undefined && (!loaded || !listed)) || (hash === '#/demo' && demoLoading))
  return <>
    {project ? <Editor key={project.id} project={project} isDemo={hash === '#/demo'} /> : waiting ? <EditorSkeleton isDemo={hash === '#/demo'} /> : <ProjectList />}
    <ConflictDialog />
  </>
}

function App() {
  const hash = useHash()
  const [name, setName] = useState(readWorkspaceName)
  const notice = useNotice((s) => s.message)
  useEffect(() => {
    const onChange = (event: Event) => setName((event as CustomEvent<string | null>).detail)
    window.addEventListener(WORKSPACE_EVENT, onChange)
    return () => window.removeEventListener(WORKSPACE_EVENT, onChange)
  }, [])
  useEffect(() => { useNotice.setState({ message: '' }) }, [name])

  if (!cloudConfigured) return <div className="flex h-full items-center justify-center text-sm" role="alert">Cloud connection is not configured.</div>
  // A Demo link (a phone, from Demo's QR code) opens its banknote ahead of the username screen, reading the workspace it
  // names without opening it
  const play = readDemoLink(hash)
  return <>
    {play ? <DemoPage key={`${play.workspace}/${play.projectId}`} {...play} /> : name ? <Workspace key={name} name={name} /> : <OpenWorkspace />}
    {notice && <div role="alert" className="fixed top-3 left-1/2 z-[100] flex max-w-lg -translate-x-1/2 items-center gap-3 rounded-lg border bg-background p-3 text-sm shadow-menu">
      <span>{notice}</span>
      <Button variant="ghost" size="sm" onClick={() => useNotice.setState({ message: '' })}>Dismiss</Button>
    </div>}
    <Analytics />
  </>
}

export default App
