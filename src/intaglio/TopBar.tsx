import { ChevronDown, Cloud, CloudAlert, CloudUpload, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { runAction } from '../cloud/notices'
import { retrySave, signOut, useStudio } from './store'

/** Saved, Saving… or Couldn't save (with Retry), as in Banknote Playground */
export function SaveStatus() {
  const status = useStudio((s) => s.status)
  const saveError = useStudio((s) => s.saveError)
  const listed = useStudio((s) => s.listed)
  // Until the cloud first answers there is nothing saved to tell: its place shimmers rather than say Saving…
  const finding = !listed && status === 'saved'
  const title = status === 'error' ? saveError : 'Projects are saved to this workspace'
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground" role="status" title={title}>
        {finding ? (
          <Skeleton className="h-3.5 w-14 rounded-sm" />
        ) : (
          <>
            {status === 'saved' ? <Cloud className="size-3.5" /> : status === 'saving' ? <CloudUpload className="size-3.5" /> : <CloudAlert className="size-3.5 text-destructive" />}
            {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Couldn’t save'}
          </>
        )}
      </span>
      {status === 'error' && (
        <Button variant="ghost" size="xs" onClick={retrySave}>
          Retry
        </Button>
      )}
    </div>
  )
}

/** Username and Sign out, tucked into a menu in the top bar */
export function AccountMenu() {
  const workspace = useStudio((s) => s.workspace) ?? ''
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-2 px-1.5" aria-label={`Account: ${workspace}`}>
            <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-[11px] font-medium text-background uppercase">
              {workspace.slice(0, 1)}
            </span>
            <span className="max-w-32 truncate">{workspace}</span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">Workspace · {workspace}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => runAction(signOut())}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
