begin;

-- Intaglio Studio (the /intaglio page): its projects, presets and images, next to Banknote Playground's and with the
-- same password-free username workspaces. Nothing here touches Banknote Playground's table, bucket or function.
-- Only the intaglio-workspace function reaches these, and it scopes every request to one username.
create table public.intaglio_projects (
  id uuid primary key,
  workspace text not null check (workspace ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  name text not null check (char_length(name) between 1 and 120),
  -- the playground's settings and which image the project shows (an id in the intaglio-images bucket)
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  -- a small picture of the result for the Projects page, made each time the project saves (a data: URL)
  thumb text check (thumb is null or char_length(thumb) <= 400000),
  revision uuid not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index intaglio_projects_workspace_idx on public.intaglio_projects (workspace, updated_at desc);

create table public.intaglio_presets (
  id uuid primary key,
  workspace text not null check (workspace ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  name text not null check (char_length(name) between 1 and 80),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index intaglio_presets_workspace_idx on public.intaglio_presets (workspace, updated_at desc);

alter table public.intaglio_projects enable row level security;
alter table public.intaglio_presets enable row level security;
revoke all on public.intaglio_projects from anon, authenticated;
revoke all on public.intaglio_presets from anon, authenticated;
grant select, insert, update on public.intaglio_projects to service_role;
grant select, insert, update on public.intaglio_presets to service_role;

-- A project's every save carries a new revision, so an older tab or device can't overwrite a newer save.
create function public.intaglio_projects_stamp_update() returns trigger
  language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id or new.workspace <> old.workspace then
    raise exception 'Project identity cannot be changed';
  end if;
  if new.revision = old.revision then
    raise exception 'A new project revision is required';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.intaglio_projects_stamp_update() from public, anon, authenticated;
create trigger intaglio_projects_stamp_update
  before update on public.intaglio_projects
  for each row execute function public.intaglio_projects_stamp_update();

create function public.intaglio_presets_stamp_update() returns trigger
  language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id or new.workspace <> old.workspace then
    raise exception 'Preset identity cannot be changed';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.intaglio_presets_stamp_update() from public, anon, authenticated;
create trigger intaglio_presets_stamp_update
  before update on public.intaglio_presets
  for each row execute function public.intaglio_presets_stamp_update();

-- Each project's image, kept as uploaded (immutable, by uuid) in the username's folder. No storage policies:
-- the anonymous Storage API can't read or list it; the function reads and uploads only that username's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intaglio-images', 'intaglio-images', false, 52428800, array['image/png', 'image/jpeg', 'image/webp']);

commit;
