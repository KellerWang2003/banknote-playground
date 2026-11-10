import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { enterWorkspace } from '../cloud/identity'
import { errorMessage } from '../cloud/errors'

/** Sign-in: a username opens that workspace on any device */
export function OpenWorkspace() {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="flex h-full items-center justify-center bg-muted/40 p-6">
      <div className="flex w-full max-w-xs flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          {/* A banknote with a windowed thread, as the app's mark */}
          <span className="relative h-14 w-24 rounded-md bg-brand shadow-sm">
            <span className="absolute inset-y-0 left-[66%] w-1.5 bg-[repeating-linear-gradient(180deg,var(--background)_0_7px,transparent_7px_11px)]" />
          </span>
          <h1 className="font-heading text-xl font-semibold">Banknote Playground</h1>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            try {
              enterWorkspace(username)
            } catch (error) {
              setError(errorMessage(error))
            }
          }}
        >
          <Label htmlFor="workspace-username" className="text-xs font-normal text-muted-foreground">
            Username
          </Label>
          <Input
            id="workspace-username"
            autoFocus
            aria-label="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="h-9"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            maxLength={32}
          />
          <Button type="submit" size="lg" className="h-9">
            Continue
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
