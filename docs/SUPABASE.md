# Supabase backend

This version uses **username workspaces** without accounts, email, or passwords. Entering the same username opens the same workspace on any browser. This is a convenience for a small group of friends: a username is not proof of identity, and anyone who knows it can read and edit that workspace. The API does not provide a directory of usernames.

## Deployed resources

- Project: General playground (`swovjhbaoxlxodakauxo`), US West.
- Database: `public.thread_playground_projects`, indexed by workspace and update time.
- Artwork bucket: `thread-playground-artwork`, maximum 25 MB per image; PNG, JPEG, SVG, and WebP.
- Edge Function: `thread-workspace`.
- Intaglio Studio (`/intaglio`) has its own table, bucket and function next to these, by the same usernames: see [INTAGLIO.md](INTAGLIO.md).

The database holds each editor project as JSONB plus a UUID revision and deletion timestamp. The function validates the workspace and IDs, scopes every read/update to that workspace, and reads/uploads artwork only in its corresponding folder. Direct browser access to the table and bucket is denied. The function accepts the project's frontend publishable key, with no user JWT. Its service-role credentials exist only in the Supabase runtime.

RLS remains enabled. The first migration established account ownership; the second switches the app to username workspaces and moves all client operations behind the scoped function. Both are recorded in the deployed migration history. Auth email settings remain unchanged.

## Local and Vercel configuration

Put these in `.env.local` locally and in the Vercel project's environment variables for deployment:

```dotenv
VITE_SUPABASE_URL=https://swovjhbaoxlxodakauxo.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Find the publishable key under Supabase → Project Settings → API Keys. These values are compiled into the frontend. Never use a secret/service-role key or database password here. `.env.local` is ignored by Git.

Vercel uses the Vite preset, `npm run build`, and `dist`. `vercel.json` records these defaults. The existing hash-based project URLs need no rewrite. The Supabase function allows browser requests from Vercel and local development, so deploying a new Vercel domain requires no Auth redirect changes.

## Shared demo and migrated originals

**Untitled project** was imported from the original Dia browser into `keller`, with its artwork and banknote settings. **Silly bird demo** was published as the shared template in the reserved `public-demos` namespace. Its original five images were verified byte for byte. The original browser stores remain untouched.

The Demo button opens a temporary editor preview of the demo built into the app (`src/lib/demo.ts`); the shared template described here is no longer read, and stays in the database as it was. It has no project-list card and never enters the cloud save queue or the local project cache. Edits remain in memory and are discarded on Exit demo, navigating back, reloading, or signing out. The next visit starts fresh. Its artwork is drawn in the browser and kept in the workspace's local artwork cache for rendering; it is never uploaded. The canonical template remains read-only through the app API, and `public-demos` is reserved so it cannot be selected as an ordinary username.

## Saving and recovery

Edits appear immediately and are queued in IndexedDB before a cloud save. Saves are debounced, serialized, and include all referenced artwork before committing the project. The status indicator reports Saving, Saved, or Couldn’t save; Retry attempts reconnection. Returning to the tab, regaining connectivity, and a 30-second refresh also reconcile with Supabase.

A revision check prevents a stale tab or device from overwriting a newer save. On a conflict, **Keep both** saves local work as a recovered copy and loads the cloud version. **Use cloud version** discards the conflicting local version. If a save committed but its response was lost, its revision lets a retry recognize it instead of duplicating the project.

Device caches, artwork, and outboxes are separated by workspace; each browser tab keeps its own outbox to preserve simultaneous edits. Opening a new tab recovers available device drafts. Signing out waits for local persistence and retains pending edits for the next time that username is opened. Closing with pending saves triggers the browser's unsaved-work warning. Storage quota failures are reported and never marked Saved.

This is local recovery after the app has loaded, not an installable offline app: a fresh page load still needs the frontend assets, and artwork not cached on that device needs a connection. Clearing browser data removes local drafts; completed cloud saves remain in Supabase.

## Undo and redo

The editor retains up to 100 project snapshots in memory per project during the current workspace session. Undo/redo restores banknotes, positions, frames, image references, project names, and settings through the same cloud save path as an ordinary edit. Playback, selection, and canvas zoom/pan do not create history entries. Project creation/deletion from the project list is outside editor undo history.

Drag/scrub gestures are single steps; consecutive typing in the same field is grouped. New edits discard the redo branch. A different cloud project version clears stale history so undo cannot overwrite another device's newer work. Signing out, reloading, or discarding the demo clears its history. Artwork retention allows removed/replaced images to be restored without re-uploading the originals.

## Importing existing browser projects

On the project list, **Import browser projects** copies original projects and their artwork into the selected workspace. Original IndexedDB records and images remain untouched. Each source project gets a stable target ID in that workspace, so interrupted imports retry without duplicates. Images are uploaded before the imported project is considered saved.

Import from the original browser profile and origin, including port. For example, old work at `http://localhost:5174` is a different local store from `http://127.0.0.1:5174`. Use the address where the work was created before moving to the deployed app.

## Deletion and artwork retention

Deleting a project saves a tombstone rather than removing its revision history marker, so a stale device cannot silently resurrect it. Removed images and original artwork are retained for device drafts and conflict recovery. No automatic artwork garbage collection is included yet; storage usage can therefore grow after replacements or deletions. User-facing deletion is not a permanent storage purge.

## Backend updates

With the pinned CLI and an authenticated Supabase login:

```bash
npx supabase login
npx supabase link --project-ref swovjhbaoxlxodakauxo
npx supabase db push
npx supabase functions deploy thread-workspace --project-ref swovjhbaoxlxodakauxo --use-api
```

For a new Supabase project, apply both migrations, deploy the function, then set the frontend URL and publishable key. `supabase/config.toml` declares `verify_jwt = false` for this function because it checks the publishable API key instead. This is intentional for username-only access, not a user authentication mechanism.

## Verification

`npm test` covers the durable outbox, offline reload, in-flight edits, lost responses, concurrent saves, deletion conflicts, imports, sign-out, temporary demo isolation, username normalization, and the editor UI. `npm run lint` and `npm run build` check the application.

To verify a deployed backend explicitly, while logged into the CLI:

```bash
node --env-file=.env.local tests/cloud.integration.mjs
npx supabase db query --linked --project-ref swovjhbaoxlxodakauxo --file tests/rls.sql
npx supabase db advisors --linked --project-ref swovjhbaoxlxodakauxo --type security --level warn
```

The live test creates disposable project/artwork fixtures, verifies username-scoped operations and direct-access denial, and cleans up in `finally`. It reads a server test key into memory only for cleanup; that key is never written to a file or used by the frontend. The SQL assertions roll back their fixtures.
