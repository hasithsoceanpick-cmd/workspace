-- =====================================================================
--  TEMPLATE — a new app in the platform (e.g. "payments", "leave")
--
--  Copy to supabase/0X_app_<key>.sql, replace  my_app  with the app key,
--  shape the table, and run it. Then add the matching folder in
--  src/apps/<key>/ and register it in src/platform/registry.ts.
--  Finally switch it on for a department (and pick people) in
--  Admin → Departments.
-- =====================================================================

insert into public.apps (key, name, description, sort)
values ('my_app', 'My App', 'What this app is for', 50)
on conflict (key) do update set name = excluded.name, description = excluded.description;

create table if not exists public.my_app_items (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete restrict,
  created_by     uuid not null default auth.uid() references public.profiles(id),
  title          text not null,
  created_at     timestamptz not null default now()
);

create or replace function public.my_app_items_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.department_id := public.dept_of(new.created_by);
  else
    new.created_by := old.created_by;
    new.department_id := old.department_id;
  end if;
  return new;
end $$;

drop trigger if exists my_app_items_before on public.my_app_items;
create trigger my_app_items_before before insert or update on public.my_app_items
  for each row execute function public.my_app_items_before();

alter table public.my_app_items enable row level security;

-- Only people who have this app in their department (and the admin) can touch the data
drop policy if exists my_app_items_rw on public.my_app_items;
create policy my_app_items_rw on public.my_app_items for all to authenticated
  using (public.is_admin()
         or (department_id = public.my_dept() and public.user_has_app(auth.uid(), 'my_app', department_id)))
  with check (public.is_admin()
         or (department_id = public.my_dept() and public.user_has_app(auth.uid(), 'my_app', department_id)));

revoke all on public.my_app_items from anon, authenticated;
grant select, insert, update, delete on public.my_app_items to authenticated;
grant usage on all sequences in schema public to authenticated;
revoke execute on function public.my_app_items_before() from public, anon, authenticated;
