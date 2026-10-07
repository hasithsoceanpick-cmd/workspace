-- =====================================================================
--  WORKSPACE — Notes app (step 5 of 6)
--  Run after 02_app_tasks.sql. Safe to run again.
--
--  Pages and sub-pages. A page is private to its owner unless the owner
--  shares it with the whole department or chosen people (view or edit).
--  Sub-pages follow the sharing of their top-level page.
--  The platform admin can read every page (read-only unless it's theirs).
-- =====================================================================

insert into public.apps (key, name, description, sort)
values ('notes', 'Notes', 'Pages and sub-pages, private or shared, linked to tasks', 20)
on conflict (key) do update set name = excluded.name, description = excluded.description;

-- ---------- Tables -----------------------------------------------------
create table if not exists public.notes_pages (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  owner_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  parent_id      bigint references public.notes_pages(id) on delete cascade,
  root_id        bigint references public.notes_pages(id) on delete cascade,  -- its top-level page (itself if top-level)
  title          text not null default '',
  content        jsonb not null default '{}'::jsonb,                    -- rich text document
  position       double precision not null default 0,
  share_scope    text not null default 'private' check (share_scope in ('private', 'department', 'people')),
  dept_access    text not null default 'view' check (dept_access in ('view', 'edit')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

-- Who a page is shared with when share_scope = 'people'
create table if not exists public.notes_shares (
  note_id     bigint not null references public.notes_pages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  access      text not null default 'view' check (access in ('view', 'edit')),
  created_at  timestamptz not null default now(),
  primary key (note_id, user_id)
);

-- Files on a page (stored in the private "workspace-files" bucket under notes/<page id>/...)
create table if not exists public.notes_files (
  id             bigint generated always as identity primary key,
  note_id        bigint not null references public.notes_pages(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  path           text not null,
  size           bigint,
  mime           text,
  inline         boolean not null default false,   -- true = an image shown inside the page
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Pages linked to tasks
create table if not exists public.notes_task_links (
  note_id     bigint not null references public.notes_pages(id) on delete cascade,
  task_id     bigint not null references public.tasks(id) on delete cascade,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (note_id, task_id)
);

create index if not exists notes_pages_dept_idx          on public.notes_pages (department_id, owner_id);
create index if not exists notes_pages_parent_idx        on public.notes_pages (parent_id, position);
create index if not exists notes_pages_root_idx          on public.notes_pages (root_id);
create index if not exists notes_shares_user_idx    on public.notes_shares (user_id);
create index if not exists notes_files_note_idx on public.notes_files (note_id);
create index if not exists notes_task_links_task_idx  on public.notes_task_links (task_id);

-- ---------- Who can open a page ----------------------------------------
-- 'edit' / 'view' / null (no access). Decided by the TOP-LEVEL page:
--   owner (still in that department, with the Notes app) → edit
--   platform admin → view (edit if it's their own page)
--   same department + Notes app → department share or personal share
-- Works from the page's own fields, so a brand-new page can be checked in the
-- same statement that creates it.
create or replace function public.notes_access_row(p_id bigint, p_root bigint, p_owner uuid, p_dept uuid,
                                                  p_scope text, p_dept_access text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  share text;
begin
  if p_root is not null and p_root <> p_id then
    return public.notes_access(p_root);           -- sub-page: follow its top-level page
  end if;
  if p_owner = me and p_dept = public.my_dept()
     and (public.is_admin() or public.user_has_app(me, 'notes', p_dept)) then
    return 'edit';
  end if;
  if public.is_admin() then return 'view'; end if;
  if p_dept is distinct from public.my_dept() or not public.user_has_app(me, 'notes', p_dept) then
    return null;
  end if;
  if p_scope = 'department' then return p_dept_access; end if;
  if p_scope = 'people' then
    select access into share from public.notes_shares where note_id = p_id and user_id = me;
    return share;
  end if;
  return null;
end $$;

create or replace function public.notes_access(p_note bigint) returns text
language plpgsql stable security definer set search_path = public as $$
declare r public.notes_pages;
begin
  select root.* into r
  from public.notes_pages n join public.notes_pages root on root.id = coalesce(n.root_id, n.id)
  where n.id = p_note;
  if not found then return null; end if;
  return public.notes_access_row(r.id, r.id, r.owner_id, r.department_id, r.share_scope, r.dept_access);
end $$;

-- Storage: may I open / change files under notes/<page id>/... ?
create or replace function public.notes_file_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ref bigint; acc text;
begin
  if split_part(p_name, '/', 1) <> 'notes' then return false; end if;
  begin
    ref := split_part(p_name, '/', 2)::bigint;
  exception when others then
    return false;
  end;
  acc := public.notes_access(ref);
  return case when p_write then acc = 'edit' else acc is not null end;
end $$;

-- ---------- Rules before saving ----------------------------------------
create or replace function public.notes_pages_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare parent public.notes_pages;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(auth.uid(), new.owner_id);
    if new.parent_id is null then
      new.root_id := new.id;
      new.department_id := public.dept_of(new.owner_id);
    else
      select * into parent from public.notes_pages where id = new.parent_id;
      new.root_id := coalesce(parent.root_id, parent.id);
      new.department_id := parent.department_id;
      new.share_scope := 'private';  -- sub-pages follow their top-level page
    end if;
    new.created_at := now();
  else
    new.owner_id := old.owner_id;
    new.parent_id := old.parent_id;
    new.root_id := old.root_id;
    new.department_id := old.department_id;
    new.created_at := old.created_at;
    -- only the owner of a top-level page changes its sharing
    if old.parent_id is not null or auth.uid() is distinct from old.owner_id then
      new.share_scope := old.share_scope;
      new.dept_access := old.dept_access;
    end if;
  end if;
  -- "edited" means the words changed (not the sharing or the order)
  if tg_op = 'INSERT' or new.title is distinct from old.title or new.content is distinct from old.content then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;
  return new;
end $$;

drop trigger if exists notes_pages_before on public.notes_pages;
create trigger notes_pages_before before insert or update on public.notes_pages
  for each row execute function public.notes_pages_before();

create or replace function public.notes_files_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.department_id := (select department_id from public.notes_pages where id = new.note_id);
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end $$;

drop trigger if exists notes_files_before on public.notes_files;
create trigger notes_files_before before insert on public.notes_files
  for each row execute function public.notes_files_before();

-- tell someone when a page is shared with them
create or replace function public.notes_shares_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare n public.notes_pages;
begin
  select * into n from public.notes_pages where id = new.note_id;
  if tg_op = 'INSERT' or new.access is distinct from old.access then
    perform public.notify(array[new.user_id], n.department_id, 'notes', n.id, 'shared',
      format('%s shared "%s" with you (%s)', public.name_of(auth.uid()),
             coalesce(nullif(n.title, ''), 'Untitled page'),
             case when new.access = 'edit' then 'can edit' else 'can view' end), auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists notes_shares_after on public.notes_shares;
create trigger notes_shares_after after insert or update on public.notes_shares
  for each row execute function public.notes_shares_after();

-- deleting a page clears its notifications
create or replace function public.notes_pages_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications where app_key = 'notes' and ref_id = old.id;
  return null;
end $$;

drop trigger if exists notes_pages_deleted on public.notes_pages;
create trigger notes_pages_deleted after delete on public.notes_pages
  for each row execute function public.notes_pages_deleted();

-- ---------- Row level security ------------------------------------------
alter table public.notes_pages            enable row level security;
alter table public.notes_shares      enable row level security;
alter table public.notes_files enable row level security;
alter table public.notes_task_links  enable row level security;

drop policy if exists notes_pages_select on public.notes_pages;
create policy notes_pages_select on public.notes_pages for select to authenticated
  using (public.notes_access_row(id, root_id, owner_id, department_id, share_scope, dept_access) is not null);

-- new top-level page: your own, in your department, with the Notes app.
-- new sub-page: you need edit access to the page above it.
drop policy if exists notes_pages_insert on public.notes_pages;
create policy notes_pages_insert on public.notes_pages for insert to authenticated
  with check (owner_id = auth.uid()
              and department_id = public.my_dept()
              and public.user_has_app(auth.uid(), 'notes', department_id)
              and (parent_id is null or public.notes_access(parent_id) = 'edit'));

drop policy if exists notes_pages_update on public.notes_pages;
create policy notes_pages_update on public.notes_pages for update to authenticated
  using (public.notes_access_row(id, root_id, owner_id, department_id, share_scope, dept_access) = 'edit')
  with check (public.notes_access_row(id, root_id, owner_id, department_id, share_scope, dept_access) = 'edit');

-- top-level pages: only the owner deletes. Sub-pages: anyone who can edit.
drop policy if exists notes_pages_delete on public.notes_pages;
create policy notes_pages_delete on public.notes_pages for delete to authenticated
  using (public.notes_access_row(id, root_id, owner_id, department_id, share_scope, dept_access) = 'edit' and (parent_id is not null or owner_id = auth.uid()));

-- sharing list: visible to people who can open the page; only the page owner changes it,
-- and only with people in the same department who have Notes
drop policy if exists notes_shares_select on public.notes_shares;
create policy notes_shares_select on public.notes_shares for select to authenticated
  using (public.notes_access(note_id) is not null);
drop policy if exists notes_shares_write on public.notes_shares;
create policy notes_shares_write on public.notes_shares for all to authenticated
  using (exists (select 1 from public.notes_pages n where n.id = note_id and n.parent_id is null
                 and n.owner_id = auth.uid() and public.notes_access(n.id) = 'edit'))
  with check (exists (select 1 from public.notes_pages n where n.id = note_id and n.parent_id is null
                      and n.owner_id = auth.uid() and public.notes_access(n.id) = 'edit'
                      and public.user_has_app(user_id, 'notes', n.department_id))
              and user_id <> auth.uid());

drop policy if exists notes_files_select on public.notes_files;
create policy notes_files_select on public.notes_files for select to authenticated
  using (public.notes_access(note_id) is not null);
drop policy if exists notes_files_insert on public.notes_files;
create policy notes_files_insert on public.notes_files for insert to authenticated
  with check (public.notes_access(note_id) = 'edit' and path like 'notes/' || note_id || '/%');
drop policy if exists notes_files_delete on public.notes_files;
create policy notes_files_delete on public.notes_files for delete to authenticated
  using (public.notes_access(note_id) = 'edit');

-- links: you see a link only if you can open BOTH the page and the task
drop policy if exists notes_task_links_select on public.notes_task_links;
create policy notes_task_links_select on public.notes_task_links for select to authenticated
  using (public.notes_access(note_id) is not null
         and exists (select 1 from public.tasks t where t.id = task_id));
drop policy if exists notes_task_links_insert on public.notes_task_links;
create policy notes_task_links_insert on public.notes_task_links for insert to authenticated
  with check (public.notes_access(note_id) is not null
              and exists (select 1 from public.tasks t where t.id = task_id)
              and (select department_id from public.notes_pages where id = note_id)
                  = (select department_id from public.tasks where id = task_id));
drop policy if exists notes_task_links_delete on public.notes_task_links;
create policy notes_task_links_delete on public.notes_task_links for delete to authenticated
  using (public.notes_access(note_id) is not null
         and exists (select 1 from public.tasks t where t.id = task_id)
         and (created_by = auth.uid() or public.notes_access(note_id) = 'edit'));

-- ---------- File storage -------------------------------------------------
drop policy if exists "notes files: read" on storage.objects;
create policy "notes files: read" on storage.objects for select to authenticated
  using (bucket_id = 'workspace-files' and public.notes_file_ok(name, false));
drop policy if exists "notes files: upload" on storage.objects;
create policy "notes files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace-files' and public.notes_file_ok(name, true));
drop policy if exists "notes files: delete" on storage.objects;
create policy "notes files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'workspace-files' and public.notes_file_ok(name, true));

-- ---------- Permissions -------------------------------------------------
revoke all on public.notes_pages, public.notes_shares, public.notes_files, public.notes_task_links
  from anon, authenticated;
grant select, insert, update, delete on public.notes_pages            to authenticated;
grant select, insert, update, delete on public.notes_shares      to authenticated;
grant select, insert, delete         on public.notes_files to authenticated;
grant select, insert, delete         on public.notes_task_links  to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke execute on function public.notes_pages_before()         from public, anon, authenticated;
revoke execute on function public.notes_files_before() from public, anon, authenticated;
revoke execute on function public.notes_shares_after()    from public, anon, authenticated;
revoke execute on function public.notes_pages_deleted()        from public, anon, authenticated;
