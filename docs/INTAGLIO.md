# Intaglio Studio

Intaglio Studio is the Intaglio playground (an image turned into wave lines spaced by an opacity line) as its own small app, with a gallery of projects saved to the cloud. It lives in this repo as its own page, at `/intaglio` (banknote-playground.vercel.app/intaglio, localhost:5174/intaglio), and signs in with the same usernames as Banknote Playground. Banknote Playground's own page and backend pieces don't change for it.

## Where things are

- `intaglio/index.html` is the page, a second Vite input (`build.rolldownOptions.input` in `vite.config.ts`). Without the trailing slash, Vite would serve Banknote Playground's page for `/intaglio`, so `vite.config.ts` rewrites it (the `intaglioPage` plugin, dev and preview) and `vercel.json` does the same live. `public/intaglio.svg` is its icon.
- `src/intaglio/` is the app: `App.tsx` (sign-in, then Projects, or a project's editor at `#/p/<id>`), `Projects.tsx` (the gallery), `Editor.tsx` (the playground opened on one project), `TopBar.tsx` (save status, account menu), `SignIn.tsx`, `store.ts` (projects, saving, presets), `api.ts` (the cloud), `images.ts` (checking a new image).
- `src/intaglio/engine/playground.js` and `playground.css` are the playground itself: the standalone page's script wrapped as `createPlayground(root, studio)`, its styles scoped under `.ipg`, typed in `playground.d.ts`. The editor keeps the playground's look and type (Inter and JetBrains Mono, from Google Fonts in `intaglio/index.html`); the gallery uses this app's shadcn components and Geist. This file is now the playground's source: change it here. It reads the project through `studio.initial` and `studio.loadImage`, hands each change back through `studio.onChange`, saves presets through `studio.presets`, and cleans up everything it started on `destroy()` (listeners, timers, the WebGL context). `window.__pg` is its test hook while it is open.

## Saving

Projects are kept in the browser first (IndexedDB: projects and presets in `intaglio-studio`, images in `intaglio-studio-images`), so they open at once and work offline, and go to the cloud a moment after each change, one at a time.

- Every save carries a new revision and is accepted only over the revision this browser last saw. When a project changed in another tab or on another computer meanwhile, this browser's work is kept as "<name> copy" (the editor moves to it, with a notice) and the project takes the newer version.
- A save whose answer never came is checked before the next one, so it isn't mistaken for a clash.
- A project's image goes up once, before the project row that uses it, so no other device finds a project without its image. Replace image uploads the new one the same way and keeps the lines.
- Each save of an open project takes a fresh thumbnail from the editor (WebP up to 560 × 400, JPEG where the browser can't write WebP), for its card.
- The workspace is fetched again on opening, coming back online, returning to the tab and every 30 seconds while it shows; a project with changes still to save keeps them.
- Offline, the status says Couldn't save with Retry and tries again by itself (2 s, doubling up to a minute); closing the tab keeps the changes in the browser, and they go up the next time the app opens.
- Presets belong to the username (`intaglio_presets`), not the browser.

## Backend

All in the General playground Supabase project, added by `supabase/migrations/20261109071917_intaglio_studio.sql` and next to Banknote Playground's pieces:

- `public.intaglio_projects`: id, workspace, name, `data` (the playground's settings and the image's id), `thumb` (a data URL, at most 400,000 characters), revision, `deleted_at` (deleted projects stay as tombstones so other devices drop them).
- `public.intaglio_presets`: a username's presets.
- `intaglio-images`: a private bucket, 50 MB per image, PNG, JPEG or WebP (other formats are turned into PNG in the browser), each image under its username's folder by id.
- `intaglio-workspace`: the Edge Function the app talks to (list, get, write, upload, download, presets), `verify_jwt = false` like `thread-workspace`. It scopes every request to one username; the tables and bucket have no browser access.

Deploy the function with `npx supabase functions deploy intaglio-workspace --project-ref swovjhbaoxlxodakauxo --use-api`.
