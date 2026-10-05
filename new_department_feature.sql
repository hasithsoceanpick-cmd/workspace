-- =====================================================================
--  TEMPLATE — a new department-only feature
--
--  Copy this file to supabase/05_feature_<your_feature>.sql, replace
--  every  my_feature  with your feature key (lowercase_with_underscores),
--  adjust the columns, and run it in the SQL Editor.
--
--  The three rules that stop a feature leaking into other departments:
--    1. every row has department_id (set by the trigger, never by the app)
--    2. every policy checks  department_id = my_dept()  (or is_admin())
--    3. every policy checks  has_feature(department_id, 'my_feature')
--  Then switch it on for the right department in Admin → Departments.
-- =====================================================================

create table if not exists public.my_feature_items (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  created_by     uuid not null default auth.uid() references public.profiles(id),
  -- your columns here
  title          text not null,
  created_at     timestamptz not null default now()
);

create or replace function public.my_feature_items_before() returns trigger
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

drop trigger if exists my_feature_items_before on public.my_feature_items;
create trigger my_feature_items_before before insert or update on public.my_feature_items
  for each row execute function public.my_feature_items_before();

alter table public.my_feature_items enable row level security;

drop policy if exists my_feature_items_rw on public.my_feature_items;
create policy my_feature_items_rw on public.my_feature_items for all to authenticated
  using (public.is_admin()
         or (department_id = public.my_dept() and public.has_feature(department_id, 'my_feature')))
  with check (department_id = public.my_dept() and public.has_feature(department_id, 'my_feature'));

revoke all on public.my_feature_items from anon, authenticated;
grant select, insert, update, delete on public.my_feature_items to authenticated;
grant usage on all sequences in schema public to authenticated;
revoke execute on function public.my_feature_items_before() from public, anon, authenticated;
