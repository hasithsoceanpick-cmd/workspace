-- =====================================================================
--  WORKSPACE — platform setup (step 1 of 6)
--  Departments, people, the admin, which apps each department / person
--  can use, and per-department feature switches.
--
--  Supabase → SQL Editor → New query → paste this whole file → Run.
--  Safe to run again later (keeps your data, updates rules in place).
-- =====================================================================

-- ---------- Settings ---------------------------------------------------
-- The organisation's time zone. Change it here if you ever need to.
create or replace function public.app_tz() returns text
language sql immutable as $$ select 'Asia/Colombo' $$;

create or replace function public.app_today() returns date
language sql stable as $$ select (now() at time zone public.app_tz())::date $$;

-- ---------- Tables -----------------------------------------------------
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null default '',
  email          text not null default '',
  department_id  uuid references public.departments(id) on delete restrict,
  role           text not null default 'member' check (role in ('manager', 'senior', 'member')),
  active         boolean not null default false,  -- new sign-ups wait for the admin
  color          text not null default '#2563eb',
  created_at     timestamptz not null default now()
);

-- The platform administrator(s). The app can NOT add or remove admins —
-- only someone with access to this Supabase project (SQL Editor) can.
create table if not exists public.platform_admins (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Every app in the platform. Each app's own SQL file registers itself here.
create table if not exists public.apps (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name         text not null,
  description  text not null default '',
  sort         int  not null default 100
);

-- Which apps each department has. everyone = false → only the people in app_members.
create table if not exists public.department_apps (
  department_id  uuid not null references public.departments(id) on delete cascade,
  app_key        text not null references public.apps(key) on delete cascade,
  everyone       boolean not null default true,
  primary key (department_id, app_key)
);

create table if not exists public.app_members (
  department_id  uuid not null,
  app_key        text not null,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  primary key (department_id, app_key, user_id),
  foreign key (department_id, app_key)
    references public.department_apps(department_id, app_key) on delete cascade
);

-- Department-specific features. A row here = that feature is ON for that department.
-- Feature code must check this (see CLAUDE.md) so it never shows up anywhere else.
create table if not exists public.department_features (
  department_id  uuid not null references public.departments(id) on delete cascade,
  feature_key    text not null check (feature_key ~ '^[a-z][a-z0-9_]*$'),
  primary key (department_id, feature_key)
);

-- One notification inbox shared by every app.
create table if not exists public.notifications (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  department_id  uuid references public.departments(id) on delete cascade,
  app_key        text references public.apps(key) on delete cascade,
  ref_id         bigint,     -- the item inside the app (e.g. task id)
  kind           text not null,
  message        text not null,
  actor_id       uuid references public.profiles(id) on delete set null,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists profiles_dept_idx       on public.profiles (department_id);
create index if not exists notifications_user_idx  on public.notifications (user_id, created_at desc);
create index if not exists notifications_ref_idx   on public.notifications (app_key, ref_id);

-- ---------- Helper functions (used by every security rule) --------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function public.is_admin_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = p_user)
$$;

-- My department (null if not approved yet)
create or replace function public.my_dept() returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = auth.uid() and active
$$;

-- My role inside my department (null if not approved / no department)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where id = auth.uid() and active and department_id is not null
$$;

create or replace function public.dept_of(p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = p_user
$$;

create or replace function public.role_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = p_user
$$;

create or replace function public.name_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(full_name, '') from public.profiles where id = p_user), 'Someone')
$$;

create or replace function public.fmt_date(d date) returns text
language sql immutable as $$ select to_char(d, 'Dy DD Mon') $$;

-- Is this row's department my department? (admins: every department)
create or replace function public.in_my_dept(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin() or (p_dept is not null and p_dept = public.my_dept()), false)
$$;

-- Can this person use this app in this department?
create or replace function public.user_has_app(p_user uuid, p_app text, p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.department_apps da on da.department_id = p.department_id and da.app_key = p_app
    where p.id = p_user and p.active and p.department_id = p_dept
      and (da.everyone or exists (
            select 1 from public.app_members m
            where m.department_id = p_dept and m.app_key = p_app and m.user_id = p_user))
  )
$$;

-- Can I use this app in this department? (admins: yes, if the department has it)
create or replace function public.has_app(p_app text, p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (public.is_admin() and exists (select 1 from public.department_apps
                                   where department_id = p_dept and app_key = p_app))
    or public.user_has_app(auth.uid(), p_app, p_dept), false)
$$;

-- Is a department-specific feature switched on for this department?
create or replace function public.has_feature(p_dept uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.department_features
                 where department_id = p_dept and feature_key = p_feature)
$$;

create or replace function public.manager_ids(p_dept uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.profiles
  where department_id = p_dept and role = 'manager' and active
$$;

create or replace function public.admin_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from public.platform_admins
$$;

-- Send a notification (skips blanks, inactive people and whoever did it)
create or replace function public.notify(p_users uuid[], p_dept uuid, p_app text, p_ref bigint,
                                         p_kind text, p_message text, p_exclude uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, department_id, app_key, ref_id, kind, message, actor_id)
  select distinct u, p_dept, p_app, p_ref, p_kind, p_message, p_exclude
  from unnest(p_users) as u
  join public.profiles p on p.id = u and p.active
  where u is distinct from p_exclude;
end $$;

-- ---------- Sign-up ------------------------------------------------------
-- The very first person to sign up becomes the platform admin (approved automatically).
-- Everyone after that waits until the admin approves them and picks their department and role.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_admin boolean := not exists (select 1 from public.platform_admins);
  n int;
  palette text[] := array['#2563eb','#db2777','#059669','#d97706','#7c3aed',
                          '#0891b2','#dc2626','#65a30d','#c026d3','#ea580c'];
  nm text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                      split_part(new.email, '@', 1));
begin
  select count(*) into n from public.profiles;
  insert into public.profiles (id, full_name, email, active, color)
  values (new.id, nm, coalesce(new.email, ''), first_admin,
          palette[(n % array_length(palette, 1)) + 1]);
  if first_admin then
    insert into public.platform_admins (user_id) values (new.id);
  else
    perform public.notify(public.admin_ids(), null, null, null, 'signup',
      format('%s (%s) signed up and is waiting for approval', nm, new.email), null);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- A login that exists but has no Workspace profile (for example an account made for an
-- older app in the same project) gets one on first sign-in, waiting for the admin's approval.
-- (Deleted or declined people can't sign in at all: their login is removed.)
-- >>> ensure_profile
create or replace function public.ensure_profile() returns void
language plpgsql security definer set search_path = public as $$
declare
  u  auth.users;
  nm text;
  n  int;
  palette text[] := array['#2563eb','#db2777','#059669','#d97706','#7c3aed',
                          '#0891b2','#dc2626','#65a30d','#c026d3','#ea580c'];
begin
  if auth.uid() is null or exists (select 1 from public.profiles where id = auth.uid()) then
    return;
  end if;
  select * into u from auth.users where id = auth.uid();
  if not found then return; end if;
  nm := coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1));
  select count(*) into n from public.profiles;
  insert into public.profiles (id, full_name, email, active, color)
  values (u.id, nm, coalesce(u.email, ''), false, palette[(n % array_length(palette, 1)) + 1])
  on conflict (id) do nothing;
  perform public.notify(public.admin_ids(), null, null, null, 'signup',
    format('%s (%s) signed in and is waiting for approval', nm, u.email), null);
end $$;
revoke execute on function public.ensure_profile() from public, anon;
grant  execute on function public.ensure_profile() to authenticated;
-- <<< ensure_profile

-- Only the admin can approve people or change departments, roles and colours
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.active := old.active;
    new.department_id := old.department_id;
    new.color := old.color;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Moving someone to another department removes their per-person app access in the old one
create or replace function public.profiles_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.department_id is distinct from old.department_id then
    delete from public.app_members where user_id = new.id and department_id is distinct from new.department_id;
  end if;
  return null;
end $$;

drop trigger if exists profiles_after on public.profiles;
create trigger profiles_after after update on public.profiles
  for each row execute function public.profiles_after();

-- ---------- Removing people (admin only) --------------------------------
-- Deletes someone's login completely: used to decline a sign-up or remove a wrong account.
-- Refuses while they still have work assigned in an app; deactivate them instead to keep history.
create or replace function public.admin_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can delete people.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can''t delete your own account.';
  end if;
  if public.is_admin_user(p_user) then
    raise exception 'Administrators can only be removed in the Supabase SQL Editor.';
  end if;
  begin
    delete from auth.users where id = p_user;
  exception when foreign_key_violation then
    raise exception 'This person still has tasks assigned. Reassign or delete them first, or use Deactivate to keep their history.';
  end;
end $$;

-- ---------- Row level security ------------------------------------------
alter table public.departments         enable row level security;
alter table public.profiles            enable row level security;
alter table public.platform_admins     enable row level security;
alter table public.apps                enable row level security;
alter table public.department_apps     enable row level security;
alter table public.app_members         enable row level security;
alter table public.department_features enable row level security;
alter table public.notifications       enable row level security;

-- departments: you see your own; the admin sees and manages all
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
  using (public.in_my_dept(id));
drop policy if exists departments_admin on public.departments;
create policy departments_admin on public.departments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles: you see yourself, people in your own department, and (once approved) the admin's name
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.in_my_dept(department_id)
         or (public.is_admin_user(id) and public.my_dept() is not null));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- platform_admins: you can only check whether YOU are one. Nobody can change it from the app.
drop policy if exists admins_self on public.platform_admins;
create policy admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- apps: everyone signed in can read the list
drop policy if exists apps_select on public.apps;
create policy apps_select on public.apps for select to authenticated using (true);

-- app access + features: readable inside your department; only the admin changes them
drop policy if exists department_apps_select on public.department_apps;
create policy department_apps_select on public.department_apps for select to authenticated
  using (public.in_my_dept(department_id));
drop policy if exists department_apps_admin on public.department_apps;
create policy department_apps_admin on public.department_apps for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists app_members_select on public.app_members;
create policy app_members_select on public.app_members for select to authenticated
  using (public.in_my_dept(department_id));
drop policy if exists app_members_admin on public.app_members;
create policy app_members_admin on public.app_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists department_features_select on public.department_features;
create policy department_features_select on public.department_features for select to authenticated
  using (public.in_my_dept(department_id));
drop policy if exists department_features_admin on public.department_features;
create policy department_features_admin on public.department_features for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- notifications: your own only
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- ---------- Permissions -------------------------------------------------
grant usage on schema public to authenticated;
revoke all on public.departments, public.profiles, public.platform_admins, public.apps,
              public.department_apps, public.app_members, public.department_features,
              public.notifications
  from anon, authenticated;

grant select, insert, update, delete on public.departments         to authenticated;
grant select, update                 on public.profiles            to authenticated;
grant select                         on public.platform_admins     to authenticated;
grant select                         on public.apps                to authenticated;
grant select, insert, update, delete on public.department_apps     to authenticated;
grant select, insert, delete         on public.app_members         to authenticated;
grant select, insert, delete         on public.department_features to authenticated;
grant select, delete                 on public.notifications       to authenticated;
grant update (read_at)               on public.notifications       to authenticated;

revoke execute on function public.notify(uuid[], uuid, text, bigint, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.profiles_guard()  from public, anon, authenticated;
revoke execute on function public.profiles_after()  from public, anon, authenticated;
revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant  execute on function public.admin_delete_user(uuid) to authenticated;
