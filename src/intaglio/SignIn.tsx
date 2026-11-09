import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { enterWorkspace } from '../cloud/identity'
import { errorMessage } from '../cloud/errors'

/** Engraved waves, as the app's mark */
export function StudioMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 56" className={className} aria-hidden="true">
      <rect width="56" height="56" rx="12" className="fill-foreground" />
      {[14, 21, 28, 35, 42].map((y, i) => (
        <path
          key={y}
          d={`M8 ${y} C15 ${y - 5} 21 ${y - 5} 28 ${y} S41 ${y + 5} 48 ${y}`}
          fill="none"
          className="stroke-background"
          strokeWidth={1 + i * 0.45}
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}

/** Sign-in: the same usernames as Banknote Playground; a username opens that workspace on any device */
export function SignIn() {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="flex h-full items-center justify-center bg-muted/40 p-6">
      <div className="flex w-full max-w-xs flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <StudioMark className="size-14 shadow-sm" />
          <h1 className="font-heading text-xl font-semibold">Intaglio Studio</h1>
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
