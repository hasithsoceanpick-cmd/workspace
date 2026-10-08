-- =====================================================================
--  WORKSPACE — "Daily notes" department feature (step 3 of 8)
--  Run after 02_app_tasks.sql. Safe to run again.
--
--  An example of a DEPARTMENT-ONLY feature: each person writes a short
--  end-of-day note that shows in the Tasks → Day review page.
--  It is OFF for every department until the admin switches it on
--  (Admin → Departments → Features). Departments without it can't see
--  the notes in the app AND can't read or write them through the database.
--
--  Copy this pattern for any future department-specific feature
--  (see supabase/templates/new_department_feature.sql).
-- =====================================================================

create table if not exists public.daily_notes (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day            date not null,
  body           text not null default '',
  updated_at     timestamptz not null default now(),
  unique (user_id, day)
);

create index if not exists daily_notes_dept_day_idx on public.daily_notes (department_id, day);

create or replace function public.daily_notes_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.department_id := public.dept_of(new.user_id);   -- always the writer's own department
  else
    new.user_id := old.user_id;
    new.department_id := old.department_id;
    new.day := old.day;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists daily_notes_before on public.daily_notes;
create trigger daily_notes_before before insert or update on public.daily_notes
  for each row execute function public.daily_notes_before();

alter table public.daily_notes enable row level security;

-- Read: admin, or same department WITH the feature on, and
--       own note / manager sees all / senior sees members'
drop policy if exists daily_notes_select on public.daily_notes;
create policy daily_notes_select on public.daily_notes for select to authenticated
  using (public.is_admin()
         or (department_id = public.my_dept()
             and public.has_feature(department_id, 'daily_notes')
             and (user_id = auth.uid()
                  or public.my_role() = 'manager'
                  or (public.my_role() = 'senior' and public.role_of(user_id) = 'member'))));

-- Write: only your own note, in your department, with the feature on, not for future days
drop policy if exists daily_notes_insert on public.daily_notes;
create policy daily_notes_insert on public.daily_notes for insert to authenticated
  with check (user_id = auth.uid()
              and department_id = public.my_dept()
              and public.has_feature(department_id, 'daily_notes')
              and day <= public.app_today());

drop policy if exists daily_notes_update on public.daily_notes;
create policy daily_notes_update on public.daily_notes for update to authenticated
  using (user_id = auth.uid() and public.has_feature(department_id, 'daily_notes'))
  with check (user_id = auth.uid() and public.has_feature(department_id, 'daily_notes'));

revoke all on public.daily_notes from anon, authenticated;
grant select, insert, update on public.daily_notes to authenticated;
grant usage on all sequences in schema public to authenticated;
revoke execute on function public.daily_notes_before() from public, anon, authenticated;
