import { withSupabase } from '@supabase/server'

// Intaglio Studio's workspace API, built like thread-workspace: a username opens that workspace (it is not a password),
// and every read and write is scoped to it. Its own table, presets table and bucket; Banknote Playground's are untouched.
const PROJECTS = 'intaglio_projects'
const PRESETS = 'intaglio_presets'
const BUCKET = 'intaglio-images'
const MAX_IMAGE = 50 * 1024 * 1024
const MAX_DATA = 1024 * 1024
const MAX_THUMB = 400_000
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
class BadRequest extends Error {}
function username(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(value) || value === 'public-demos') throw new BadRequest('Invalid workspace name.')
  return value
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BadRequest('Invalid ID.')
  return value.toLowerCase()
}
function name(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequest('Invalid name.')
  return value.trim()
}
function object(value: unknown, max: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequest('Invalid data.')
  if (JSON.stringify(value).length > max) throw new BadRequest('Project data is too large.')
  return value as Record<string, unknown>
}
function thumb(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > MAX_THUMB) throw new BadRequest('Invalid thumbnail.')
  return value
}
function check(error: { message: string } | null) { if (error) throw new Error(error.message) }
const COLUMNS = 'id,name,data,thumb,revision,deleted_at,updated_at'

const handler = withSupabase({ auth: 'publishable' }, async (req, ctx) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 })
    const db = ctx.supabaseAdmin
    if (req.headers.get('content-type')?.includes('multipart/form-data')) {
      // an image, once, by its uuid: kept as uploaded, never overwritten
      const form = await req.formData()
      const workspace = username(form.get('workspace'))
      const id = uuid(form.get('id'))
      const file = form.get('file')
      if (!(file instanceof File) || !MIME_TYPES.has(file.type)) throw new BadRequest('Choose a PNG, JPEG or WebP image.')
      if (file.size > MAX_IMAGE) throw new BadRequest('Images must be smaller than 50 MB.')
      const { error } = await db.storage.from(BUCKET).upload(`${workspace}/${id}`, file, { contentType: file.type, upsert: false })
      if (error && String((error as { statusCode?: unknown }).statusCode) !== '409' && error.message !== 'The resource already exists') check(error)
      return Response.json({ ok: true })
    }
    const body = await req.json()
    const workspace = username(body.workspace)
    switch (body.action) {
      case 'list': {   // every project, deleted ones as bare tombstones so other devices drop them
        const offset = body.offset ?? 0
        if (!Number.isSafeInteger(offset) || offset < 0) throw new BadRequest('Invalid page.')
        const { data, error } = await db.from(PROJECTS).select(COLUMNS).eq('workspace', workspace).order('id').range(offset, offset + 99)
        check(error)
        return Response.json((data ?? []).map((p) => p.deleted_at ? { ...p, data: null, thumb: null } : p))
      }
      case 'get': {
        const id = uuid(body.id)
        const { data, error } = await db.from(PROJECTS).select(COLUMNS).eq('workspace', workspace).eq('id', id).maybeSingle()
        check(error)
        return Response.json(data)
      }
      case 'write': {   // insert, or update only from the revision the caller last saw (409 otherwise)
        const project = body.project ?? {}
        const id = uuid(project.id)
        const revision = uuid(body.revision)
        const base = body.baseRevision === null ? null : uuid(body.baseRevision)
        if (typeof body.deleted !== 'boolean') throw new BadRequest('Invalid project state.')
        const payload = {
          id, workspace, name: name(project.name, 120), data: object(project.data, MAX_DATA), thumb: thumb(project.thumb), revision,
          deleted_at: body.deleted ? new Date().toISOString() : null,
        }
        const result = base
          ? await db.from(PROJECTS).update(payload).eq('workspace', workspace).eq('id', id).eq('revision', base).select(COLUMNS).maybeSingle()
          : await db.from(PROJECTS).insert(payload).select(COLUMNS).single()
        if (result.error?.code === '23505') return Response.json({ error: 'Project revision conflict.' }, { status: 409 })
        check(result.error)
        if (!result.data) return Response.json({ error: 'Project revision conflict.' }, { status: 409 })
        return Response.json(result.data)
      }
      case 'download': {
        const id = uuid(body.id)
        const { data, error } = await db.storage.from(BUCKET).download(`${workspace}/${id}`)
        check(error)
        return new Response(data, { headers: { 'Content-Type': data!.type, 'Cache-Control': 'no-store' } })
      }
      case 'presets': {
        const { data, error } = await db.from(PRESETS).select('id,name,data,updated_at').eq('workspace', workspace).is('deleted_at', null)
          .order('updated_at', { ascending: false }).limit(500)
        check(error)
        return Response.json(data ?? [])
      }
      case 'savePreset': {   // saving the same preset twice (a retry) is fine
        const preset = body.preset ?? {}
        const row = { id: uuid(preset.id), workspace, name: name(preset.name, 80), data: object(preset.data, 200 * 1024) }
        const { error } = await db.from(PRESETS).insert(row)
        if (error?.code === '23505') {
          const { data: same, error: e2 } = await db.from(PRESETS).select('id').eq('workspace', workspace).eq('id', row.id).maybeSingle()
          check(e2)
          if (!same) throw new BadRequest('Invalid ID.')
        } else check(error)
        return Response.json({ ok: true })
      }
      case 'deletePreset': {
        const id = uuid(body.id)
        const { error } = await db.from(PRESETS).update({ deleted_at: new Date().toISOString() }).eq('workspace', workspace).eq('id', id).is('deleted_at', null)
        check(error)
        return Response.json({ ok: true })
      }
    }
    throw new BadRequest('Unknown workspace action.')
  } catch (error) {
    if (error instanceof BadRequest || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400 })
    console.error('Intaglio workspace request failed:', error)
    return Response.json({ error: 'Couldn’t complete the workspace request. Please retry.' }, { status: 500 })
  }
})

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    const response = await handler(req)
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value)
    return new Response(response.body, { status: response.status, headers })
  },
}
