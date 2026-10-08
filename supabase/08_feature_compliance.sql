-- =====================================================================
--  WORKSPACE — "Compliance calendar" department feature (step 8 of 8)
--  Run after 02_app_tasks.sql. Safe to run again.
--
--  The department's recurring obligations (tax returns, statutory payments,
--  renewals …) in one place. Each obligation is a repeating task: it has an
--  owner, a deadline, an early reminder ("N days before") and, when it is
--  finished, the next one is created on schedule. This page shows what's
--  next, who owns it, how many days are left, and whether past ones were
--  finished on time.
--
--  OFF for every department until the admin ticks it in
--  Admin console → Departments & apps.
-- =====================================================================

-- this name must be ours (the project also holds an older app's tables)
do $$
begin
  if to_regclass('public.compliance_items') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'compliance_items' and column_name = 'series_id') then
    raise exception 'A table called compliance_items already exists and was not made by Workspace. Nothing was changed — send this message to whoever looks after Workspace.';
  end if;
end $$;

create table if not exists public.compliance_items (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  authority      text not null default '',     -- who it's for: IRD, EPF, Registrar of Companies …
  notes          text not null default '',
  series_id      bigint references public.tasks(id) on delete set null,   -- the repeating task behind it
  active         boolean not null default true,
  position       double precision not null default 0,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists compliance_items_dept_idx on public.compliance_items (department_id, position);

-- ---------- Who can do what ----------------------------------------------
create or replace function public.compliance_on(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (p_dept = public.my_dept() and public.has_feature(p_dept, 'compliance')
          and public.user_has_app(auth.uid(), 'tasks', p_dept));
$$;

-- add, change and remove obligations: admin, or the department's managers and senior executives
create or replace function public.compliance_lead(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.compliance_on(p_dept) and public.my_role() in ('manager', 'senior'));
$$;

create or replace function public.compliance_items_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.department_id := case when public.is_admin() and new.department_id is not null
                              then new.department_id else public.dept_of(auth.uid()) end;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.department_id := old.department_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.series_id is not null
     and (select department_id from public.tasks where id = new.series_id) is distinct from new.department_id then
    raise exception 'That task belongs to another department.';
  end if;
  return new;
end $$;

drop trigger if exists compliance_items_before on public.compliance_items;
create trigger compliance_items_before before insert or update on public.compliance_items
  for each row execute function public.compliance_items_before();

-- Add an obligation in one step: its first (repeating) task and the calendar entry together.
-- Runs with the caller's own rights, so the usual rules decide who may give the task to whom.
create or replace function public.compliance_add(p_dept uuid, p_name text, p_authority text, p_notes text,
                                                 p_owner uuid, p_due date, p_repeat text, p_remind_days int)
returns bigint language plpgsql set search_path = public as $$
declare
  tid bigint;
  cid bigint;
begin
  if not public.compliance_lead(p_dept) then
    raise exception 'Only managers and senior executives can add obligations.' using errcode = '42501';
  end if;
  if p_repeat is null then
    raise exception 'Choose how often it repeats.';
  end if;
  insert into public.tasks (title, notes, assignee_id, due_date, repeat, remind_days, priority)
  values (trim(p_name), coalesce(p_notes, ''), p_owner, p_due, p_repeat, p_remind_days, 'high')
  returning id into tid;
  if (select department_id from public.tasks where id = tid) is distinct from p_dept then
    raise exception 'The owner must be someone in this department.';
  end if;
  insert into public.compliance_items (department_id, name, authority, notes, series_id, position)
  values (p_dept, trim(p_name), coalesce(trim(p_authority), ''), coalesce(p_notes, ''), tid,
          coalesce((select max(position) from public.compliance_items where department_id = p_dept), 0) + 1)
  returning id into cid;
  return cid;
end $$;

-- ---------- Row level security ------------------------------------------
alter table public.compliance_items enable row level security;

drop policy if exists compliance_items_select on public.compliance_items;
create policy compliance_items_select on public.compliance_items for select to authenticated
  using (public.compliance_on(department_id));
drop policy if exists compliance_items_insert on public.compliance_items;
create policy compliance_items_insert on public.compliance_items for insert to authenticated
  with check (public.compliance_lead(department_id));
drop policy if exists compliance_items_update on public.compliance_items;
create policy compliance_items_update on public.compliance_items for update to authenticated
  using (public.compliance_lead(department_id)) with check (public.compliance_lead(department_id));
drop policy if exists compliance_items_delete on public.compliance_items;
create policy compliance_items_delete on public.compliance_items for delete to authenticated
  using (public.compliance_lead(department_id));

revoke all on public.compliance_items from anon, authenticated;
grant select, insert, update, delete on public.compliance_items to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke execute on function public.compliance_items_before() from public, anon, authenticated;
revoke execute on function public.compliance_add(uuid, text, text, text, uuid, date, text, int) from public, anon;
grant  execute on function public.compliance_add(uuid, text, text, text, uuid, date, text, int) to authenticated;
